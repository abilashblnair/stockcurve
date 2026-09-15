import "server-only";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getMint, getTokenMetadata } from "@solana/spl-token";
import { BorshCoder } from "@coral-xyz/anchor";
import bs58 from "bs58";
import {
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  DynamicBondingCurveIdl,
  Rounding,
  getDeltaAmountBaseUnsigned,
  getPriceFromSqrtPrice,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { cached, connection, dbc } from "./solana.ts";
import { curveModel, feeBpsAt, feeModel, type CurveModel, type FeeModel } from "./curve.ts";
import { stockInfo, type StockInfo } from "./stockInfo.ts";
import { readDocument } from "./metadata.ts";

// Speed notes (measured on the live server, Sept 2026):
// - Recent swaps need getTransaction, which Helius can take 20-40 s to answer
//   for transactions it has not served before. Trades are therefore a separate
//   endpoint the page loads after the snapshot, and parsed transactions are
//   memoised by signature so each poll only fetches new ones.
// - The SDK's getCurrentPoint asks the RPC for the latest block time, which
//   is often not available yet and retries for seconds. Timestamp-activated
//   pools only need the wall clock.
// - Configs never change after creation; they are cached for an hour.

const METAPLEX = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

export type TokenMeta = { name: string; symbol: string; uri: string; image: string | null; description: string | null; launchedWithStockcurve: boolean };
export type Trade = { signature: string; time: number | null; side: "buy" | "sell"; stock: number; tokens: number; price: number; trader: string | null };

/** Stock amounts in the snapshot are display amounts (raw x scaled-UI multiplier), priced with stock.usd. */
export type PoolSnapshot = {
  address: string;
  baseMint: string;
  config: string;
  creator: string;
  feeClaimer: string;
  token: TokenMeta;
  stock: StockInfo;
  price: number; // stock per token
  priceUsd: number | null;
  fdvUsd: number | null;
  quoteReserve: number; // stock
  quoteReserveUsd: number | null;
  graduationRaise: number;
  graduationUsd: number | null;
  progressPct: number;
  sold: number; // tokens bought out of the curve
  isMigrated: boolean;
  curveComplete: boolean;
  feeNowBps: number;
  feeElapsedSec: number;
  fees: FeeModel;
  unclaimed: { partner: number; creator: number; protocol: number };
  lifetime: { trading: number; protocol: number };
  curve: CurveModel; // raised in raw stock units; chart with usd x multiplier
  lp: { partnerLocked: number; partnerUnlocked: number; creatorLocked: number; creatorUnlocked: number; migratedFeeBps: number };
  activationType: "slot" | "timestamp";
  fetchedAt: number;
};

function readBorshString(buf: Buffer, offset: number): [string, number] {
  const len = buf.readUInt32LE(offset);
  const s = buf.subarray(offset + 4, offset + 4 + len).toString("utf8").replace(/\0+$/, "");
  return [s, offset + 4 + len];
}

const OWN_META = /^https:\/\/[^/]+\/meta\/([0-9a-f]{24})$/;

async function metadataJson(uri: string): Promise<any | null> {
  // Documents we host are read from disk: no round trip out through Caddy and back.
  const own = uri.match(OWN_META);
  const base = process.env.PUBLIC_BASE_URL;
  if (own && base && uri.startsWith(base)) {
    const body = readDocument(own[1]);
    if (body) return JSON.parse(body);
  }
  if (!/^https:\/\//.test(uri)) return null;
  try {
    const r = await fetch(uri, { signal: AbortSignal.timeout(2500), cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function tokenMeta(mint: PublicKey, token2022: boolean): Promise<TokenMeta> {
  return cached(`meta:${mint.toBase58()}`, 10 * 60_000, async () => {
    let name = "";
    let symbol = "";
    let uri = "";
    if (token2022) {
      const m = await getTokenMetadata(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID).catch(() => null);
      if (m) ({ name, symbol, uri } = m);
    } else {
      const [pda] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), METAPLEX.toBuffer(), mint.toBuffer()], METAPLEX);
      const acct = await connection.getAccountInfo(pda);
      if (acct) {
        let o = 1 + 32 + 32;
        [name, o] = readBorshString(acct.data, o);
        [symbol, o] = readBorshString(acct.data, o);
        [uri] = readBorshString(acct.data, o);
      }
    }
    const j = await metadataJson(uri);
    return {
      name: name.trim() || "Unnamed",
      symbol: symbol.trim() || "?",
      uri,
      image: typeof j?.image === "string" && /^https:\/\//.test(j.image) ? j.image : null,
      description: typeof j?.description === "string" ? j.description.slice(0, 600) : null,
      launchedWithStockcurve: j?.extensions?.launched_with === "stockcurve",
    };
  });
}

const coder = new BorshCoder(DynamicBondingCurveIdl as any);
// Anchor emit_cpi!: events arrive as inner instructions to the program itself, tagged with this prefix.
const EVENT_IX_TAG = Buffer.from("e445a52e51cb9a1d", "hex");
const pick = (o: any, ...keys: string[]) => {
  for (const k of keys) if (o?.[k] !== undefined) return o[k];
  return undefined;
};
const num = (v: any) => (v === undefined || v === null ? 0 : Number(v.toString()));

/** Swaps in one transaction, as raw amounts (no decimals applied). Null = no swap in it. */
type RawTrade = { signature: string; time: number | null; buy: boolean; stockRaw: number; tokenRaw: number; trader: string | null };
const parsedTx = new Map<string, RawTrade[]>();
const fillJobs = new Map<string, Promise<void>>();

function parseSwaps(signature: string, tx: any, pool: string): RawTrade[] {
  const out: RawTrade[] = [];
  if (!tx?.meta?.innerInstructions) return out;
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
  const trader = keys.get(0)?.toBase58() ?? null;
  for (const group of tx.meta.innerInstructions) {
    // A swap emits EvtSwap and EvtSwap2 for the same trade; keep one per instruction.
    for (const ix of group.instructions) {
      if (!keys.get(ix.programIdIndex)?.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID)) continue;
      const raw = Buffer.from(bs58.decode(ix.data));
      if (raw.length < 16 || !raw.subarray(0, 8).equals(EVENT_IX_TAG)) continue;
      let ev: { name: string; data: any } | null = null;
      try {
        ev = coder.events.decode(raw.subarray(8).toString("base64"));
      } catch {
        continue;
      }
      if (!ev || !ev.name.toLowerCase().startsWith("evtswap")) continue;
      const d = ev.data;
      if (String(pick(d, "pool")) !== pool) continue;
      const buy = num(pick(d, "trade_direction", "tradeDirection")) === 1;
      const res = pick(d, "swap_result", "swapResult");
      const input = num(pick(res, "actual_input_amount", "actualInputAmount", "included_fee_input_amount", "includedFeeInputAmount"));
      const output = num(pick(res, "output_amount", "outputAmount"));
      out.push({ signature, time: tx.blockTime ?? null, buy, stockRaw: buy ? input : output, tokenRaw: buy ? output : input, trader });
      break;
    }
  }
  return out;
}

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export async function recentTrades(address: string, limit = 20): Promise<{ trades: Trade[]; pending: number }> {
  return cached(`trades:${address}`, 5000, async () => {
    const pool = new PublicKey(address);
    const ctx = await basics(address);
    if (!ctx) return { trades: [], pending: 0 };
    const sigs = (await connection.getSignaturesForAddress(pool, { limit })).filter((s) => !s.err);
    const missing = sigs.map((s) => s.signature).filter((s) => !parsedTx.has(s));
    let pending = 0;
    if (missing.length) {
      // One background fetch per pool at a time; wait briefly, never for the whole slow RPC call.
      let job = fillJobs.get(address);
      if (!job) {
        job = connection
          .getTransactions(missing, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })
          .then((txs) => {
            txs.forEach((tx, i) => {
              // A null tx is not indexed yet: leave it for the next poll.
              if (tx) parsedTx.set(missing[i], parseSwaps(missing[i], tx, address));
            });
            if (parsedTx.size > 20_000) parsedTx.clear();
          })
          .catch(() => {})
          .finally(() => fillJobs.delete(address));
        fillJobs.set(address, job);
      }
      await withTimeout(job, 2500).catch(() => {});
      pending = missing.filter((s) => !parsedTx.has(s)).length;
    }
    const scale = ctx.multiplier / 10 ** ctx.stockDecimals;
    const trades = sigs
      .flatMap((s) => parsedTx.get(s.signature) ?? [])
      .map((t) => {
        const stock = t.stockRaw * scale;
        const tokens = t.tokenRaw / 10 ** ctx.baseDecimals;
        return { signature: t.signature, time: t.time, side: t.buy ? ("buy" as const) : ("sell" as const), stock, tokens, price: tokens ? stock / tokens : 0, trader: t.trader };
      });
    return { trades, pending };
  });
}

/** Pool + config + stock, cached: the config is immutable, the pool state for a few seconds. */
async function basics(address: string) {
  const state: any = await cached(`pool:${address}`, 4000, async () => {
    const w: any = await dbc.state.getPool(new PublicKey(address));
    return w?.poolState ?? w ?? null;
  });
  if (!state?.config) return null;
  const cfg: any = await cached(`cfg:${state.config.toBase58()}`, 3600_000, () => dbc.state.getPoolConfig(state.config));
  if (!cfg) return null;
  const stock = await stockInfo(cfg.quoteMint.toBase58());
  if (!stock) throw new Error("This pool is not quoted in a supported tokenized stock.");
  return { state, cfg, stock, multiplier: stock.multiplier, stockDecimals: stock.decimals, baseDecimals: cfg.tokenDecimal as number };
}

export async function poolSnapshot(address: string): Promise<PoolSnapshot | null> {
  return cached(`snap:${address}`, 4000, () => buildSnapshot(address));
}

async function buildSnapshot(address: string): Promise<PoolSnapshot | null> {
  const b = await basics(address);
  if (!b) return null;
  const { state, cfg, stock } = b;
  const baseDec = b.baseDecimals;
  const quoteDec = stock.decimals;
  const token2022 = cfg.tokenType === 1;
  const [meta, supplyRaw] = await Promise.all([
    tokenMeta(state.baseMint, token2022),
    cached(`supply:${state.baseMint.toBase58()}`, 3600_000, async () =>
      (await getMint(connection, state.baseMint, "confirmed", token2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID)).supply.toString(),
    ),
  ]);
  const timestamp = cfg.activationType === 1;
  const nowPoint = timestamp ? Math.floor(Date.now() / 1000) : await connection.getSlot();
  const elapsedPoints = Math.max(0, nowPoint - num(state.activationPoint));

  const curvePoints = (cfg.curve as any[]).filter((c) => !c.liquidity.isZero());
  const curve = curveModel(
    { sqrtStartPrice: cfg.sqrtStartPrice, curve: curvePoints, migrationQuoteThreshold: cfg.migrationQuoteThreshold, tokenDecimal: baseDec },
    quoteDec,
    new BN(supplyRaw),
  );

  // Tokens bought out of the curve so far: base delta from start to the current sqrt price.
  let soldRaw = new BN(0);
  let lower: BN = cfg.sqrtStartPrice;
  for (const seg of curvePoints) {
    if (lower.gte(state.sqrtPrice)) break;
    const upper = BN.min(seg.sqrtPrice, state.sqrtPrice);
    if (upper.gt(lower)) soldRaw = soldRaw.add(getDeltaAmountBaseUnsigned(lower, upper, seg.liquidity, Rounding.Down));
    lower = BN.max(lower, upper);
  }

  const m = stock.multiplier;
  const usd = stock.usd;
  const stockUi = (raw: any) => (num(raw) / 10 ** quoteDec) * m;
  const price = Number(getPriceFromSqrtPrice(state.sqrtPrice, baseDec, quoteDec).toString()) * m;
  const quoteReserve = stockUi(state.quoteReserve);
  const graduationRaise = stockUi(cfg.migrationQuoteThreshold);
  const supply = Number(supplyRaw) / 10 ** baseDec;
  const fees = feeModel(cfg.poolFees.baseFee, cfg.creatorTradingFeePercentage, !!cfg.poolFees.dynamicFee?.binStep);

  return {
    address,
    baseMint: state.baseMint.toBase58(),
    config: state.config.toBase58(),
    creator: state.creator.toBase58(),
    feeClaimer: cfg.feeClaimer.toBase58(),
    token: meta,
    stock,
    price,
    priceUsd: usd !== null ? price * usd : null,
    fdvUsd: usd !== null ? price * usd * supply : null,
    quoteReserve,
    quoteReserveUsd: usd !== null ? quoteReserve * usd : null,
    graduationRaise,
    graduationUsd: usd !== null ? graduationRaise * usd : null,
    progressPct: Math.min(100, (quoteReserve / graduationRaise) * 100),
    sold: Number(soldRaw.toString()) / 10 ** baseDec,
    isMigrated: !!state.isMigrated,
    curveComplete: num(state.quoteReserve) >= num(cfg.migrationQuoteThreshold),
    feeNowBps: feeBpsAt(cfg.poolFees.baseFee, elapsedPoints),
    feeElapsedSec: timestamp ? elapsedPoints : Math.round(elapsedPoints * 0.4),
    fees,
    unclaimed: { partner: stockUi(state.partnerQuoteFee), creator: stockUi(state.creatorQuoteFee), protocol: stockUi(state.protocolQuoteFee) },
    lifetime: { trading: stockUi(state.metrics?.totalTradingQuoteFee), protocol: stockUi(state.metrics?.totalProtocolQuoteFee) },
    curve,
    lp: {
      partnerLocked: cfg.partnerPermanentLockedLiquidityPercentage,
      partnerUnlocked: cfg.partnerLiquidityPercentage,
      creatorLocked: cfg.creatorPermanentLockedLiquidityPercentage,
      creatorUnlocked: cfg.creatorLiquidityPercentage,
      migratedFeeBps: [25, 30, 100, 200, 400, 600][cfg.migrationFeeOption] ?? 0,
    },
    activationType: timestamp ? "timestamp" : "slot",
    fetchedAt: Date.now(),
  };
}

// ---- external market data (chart embeds) ----

export type MarketLinks = { gecko: boolean; dexscreener: boolean };

export async function marketLinks(address: string): Promise<MarketLinks> {
  return cached(`market:${address}`, 5 * 60_000, async () => {
    const [gecko, dexscreener] = await Promise.all([
      fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${address}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000), cache: "no-store" })
        .then((r) => r.ok)
        .catch(() => false),
      fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${address}`, { signal: AbortSignal.timeout(5000), cache: "no-store" })
        .then(async (r) => (r.ok ? !!((await r.json()) as any)?.pairs?.length : false))
        .catch(() => false),
    ]);
    return { gecko, dexscreener };
  });
}
