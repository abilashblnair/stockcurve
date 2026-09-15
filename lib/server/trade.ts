import "server-only";
import BN from "bn.js";
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { U64_MAX, swapQuote } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { cached, connection, dbc } from "./solana.ts";
import { stockInfo } from "./stockInfo.ts";

// Buy and sell a DBC token. Jupiter first: it routes from SOL or USDC through
// the stock into the curve (and into DAMM v2 after graduation). When Jupiter
// has not indexed a brand-new pool yet and the user pays or receives the stock
// itself, the swap goes straight to the DBC program instead.

export const PAY_ASSETS = {
  SOL: { mint: "So11111111111111111111111111111111111111112", decimals: 9, symbol: "SOL" },
  USDC: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, symbol: "USDC" },
} as const;

export type PayAsset = "SOL" | "USDC" | "STOCK";
export type TradeRequest = {
  pool: string;
  side: "buy" | "sell";
  asset: PayAsset; // what you pay with (buy) or receive (sell)
  amount: string; // UI amount of the input: pay asset for buys, pool token for sells
  slippageBps: number;
  wallet?: string;
  route?: "auto" | "dbc"; // dbc skips Jupiter and swaps on the curve directly (stock only)
};

export type TradeQuote = {
  route: "jupiter" | "dbc";
  routeLabel: string;
  inputSymbol: string;
  outputSymbol: string;
  inAmount: number; // UI
  outAmount: number; // UI
  minOut: number; // UI
  priceImpactPct: number | null;
};

export type TradeBuild = TradeQuote & {
  tx: string;
  lastValidBlockHeight: number;
  simulation: { ok: boolean; error: string | null; logs: string[] };
};

type PoolCtx = {
  pool: PublicKey;
  wrapped: any;
  state: any;
  cfg: any;
  baseMint: string;
  baseDecimals: number;
  baseProgram: PublicKey;
  stockMint: string;
  stockSymbol: string;
  stockDecimals: number;
  multiplier: number;
};

async function poolCtx(address: string): Promise<PoolCtx> {
  const pool = new PublicKey(address);
  const wrapped: any = await dbc.state.getPool(pool);
  const state = wrapped?.poolState ?? wrapped;
  if (!state?.config) throw new Error("No DBC pool at this address.");
  const cfg: any = await cached(`cfg:${state.config.toBase58()}`, 3600_000, () => dbc.state.getPoolConfig(state.config));
  const stock = await stockInfo(cfg.quoteMint.toBase58());
  if (!stock) throw new Error("Pool is not quoted in a supported stock.");
  if (stock.paused) throw new Error(`${stock.symbol} transfers are paused by the issuer; trading is frozen until they resume.`);
  return {
    pool,
    wrapped: wrapped?.poolState ? wrapped : { poolState: state },
    state,
    cfg,
    baseMint: state.baseMint.toBase58(),
    baseDecimals: cfg.tokenDecimal,
    baseProgram: cfg.tokenType === 1 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    stockMint: stock.mint,
    stockSymbol: stock.symbol,
    stockDecimals: stock.decimals,
    multiplier: stock.multiplier,
  };
}

function assetMeta(ctx: PoolCtx, asset: PayAsset) {
  if (asset === "STOCK") return { mint: ctx.stockMint, decimals: ctx.stockDecimals, symbol: ctx.stockSymbol, scale: ctx.multiplier };
  return { ...PAY_ASSETS[asset], scale: 1 };
}

/** UI amount -> raw units. Scaled-UI tokens (xStocks) display raw x multiplier. */
function toRaw(ui: string, decimals: number, scale = 1): BN {
  const n = Number(ui);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Enter an amount above zero.");
  const raw = Math.floor((n / scale) * 10 ** decimals);
  if (raw <= 0) throw new Error("Amount is too small.");
  return new BN(raw.toString());
}
const toUi = (raw: BN | string | number, decimals: number, scale = 1) => (Number(raw.toString()) / 10 ** decimals) * scale;

async function jupiterQuote(inputMint: string, outputMint: string, amount: BN, slippageBps: number) {
  const url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount.toString()}&slippageBps=${slippageBps}&restrictIntermediateTokens=true`;
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = (await r.json()) as any;
  if (!j?.outAmount || j.error) return null;
  return j;
}

async function quoteInternal(req: TradeRequest) {
  const ctx = await poolCtx(req.pool);
  const slippageBps = Math.max(10, Math.min(5000, Math.round(req.slippageBps || 300)));
  const asset = assetMeta(ctx, req.asset);
  const buy = req.side === "buy";
  const input = buy ? asset : { mint: ctx.baseMint, decimals: ctx.baseDecimals, symbol: "token", scale: 1 };
  const output = buy ? { mint: ctx.baseMint, decimals: ctx.baseDecimals, symbol: "token", scale: 1 } : asset;
  const amountIn = toRaw(req.amount, input.decimals, input.scale);

  const jq = req.route === "dbc" ? null : await jupiterQuote(input.mint, output.mint, amountIn, slippageBps);
  if (jq) {
    const labels = [...new Set((jq.routePlan ?? []).map((r: any) => r.swapInfo?.label).filter(Boolean))].join(" → ");
    return {
      ctx,
      jq,
      amountIn,
      quote: {
        route: "jupiter" as const,
        routeLabel: labels ? `Jupiter: ${labels}` : "Jupiter",
        inputSymbol: input.symbol,
        outputSymbol: output.symbol,
        inAmount: toUi(amountIn, input.decimals, input.scale),
        outAmount: toUi(jq.outAmount, output.decimals, output.scale),
        minOut: toUi(jq.otherAmountThreshold, output.decimals, output.scale),
        priceImpactPct: jq.priceImpactPct !== undefined ? Number(jq.priceImpactPct) * 100 : null,
      },
    };
  }

  if (req.asset !== "STOCK") throw new Error(`Jupiter has no route for this pool yet. Pay or receive ${ctx.stockSymbol} directly, or try again in a few minutes.`);
  if (ctx.state.isMigrated) throw new Error("This pool has graduated and Jupiter did not return a route. Try again shortly.");
  // Wall clock for timestamp pools: the SDK helper waits on getBlockTime, which is slow on this RPC.
  const point = new BN(ctx.cfg.activationType === 1 ? Math.floor(Date.now() / 1000) : await connection.getSlot());
  const q = swapQuote(ctx.wrapped, ctx.cfg, !buy, amountIn, slippageBps, false, point, false);
  return {
    ctx,
    jq: null,
    amountIn,
    dbcMinOut: q.minimumAmountOut,
    quote: {
      route: "dbc" as const,
      routeLabel: "Meteora Dynamic Bonding Curve (direct)",
      inputSymbol: input.symbol,
      outputSymbol: output.symbol,
      inAmount: toUi(amountIn, input.decimals, input.scale),
      outAmount: toUi(q.outputAmount, output.decimals, output.scale),
      minOut: toUi(q.minimumAmountOut, output.decimals, output.scale),
      priceImpactPct: null,
    },
  };
}

export async function quoteTrade(req: TradeRequest): Promise<TradeQuote> {
  return (await quoteInternal(req)).quote;
}

async function simulate(vtx: VersionedTransaction) {
  const sim = await connection.simulateTransaction(vtx, { sigVerify: false, replaceRecentBlockhash: true });
  const logs = sim.value.logs ?? [];
  if (!sim.value.err) return { ok: true, error: null, logs: [] };
  const anchor = logs.find((l) => l.includes("Error Message:"))?.split("Error Message:")[1]?.trim();
  const slippage = logs.some((l) => /slippage|ExceededSlippage|0x1771|exceeds desired slippage/i.test(l));
  const funds = sim.value.err === "AccountNotFound" || logs.some((l) => /insufficient (funds|lamports)/i.test(l));
  return {
    ok: false,
    error: funds ? "Not enough balance for this trade plus network fees." : slippage ? "Price moved past your slippage limit. Raise slippage or try a smaller amount." : anchor ?? JSON.stringify(sim.value.err),
    logs: logs.slice(-10),
  };
}

async function priorityFee(): Promise<number> {
  const fees = await connection.getRecentPrioritizationFees().catch(() => []);
  const sorted = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
  const p75 = sorted.length ? sorted[Math.floor(sorted.length * 0.75)] : 50_000;
  return Math.min(Math.max(p75, 10_000), 500_000);
}

async function compile(wallet: PublicKey, tx: Transaction, units: number) {
  const [microLamports, { blockhash, lastValidBlockHeight }] = await Promise.all([priorityFee(), connection.getLatestBlockhash("confirmed")]);
  const message = new TransactionMessage({
    payerKey: wallet,
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports }), ...tx.instructions],
  }).compileToV0Message();
  return { vtx: new VersionedTransaction(message), lastValidBlockHeight };
}

export async function buildTrade(req: TradeRequest): Promise<TradeBuild> {
  if (!req.wallet) throw new Error("Connect a wallet first.");
  const wallet = new PublicKey(req.wallet);
  const q = await quoteInternal(req);

  if (q.jq) {
    const r = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quoteResponse: q.jq,
        userPublicKey: wallet.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: "high" } },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await r.json()) as any;
    if (!r.ok || !j.swapTransaction) throw new Error(j?.error ?? "Jupiter could not build this swap.");
    const vtx = VersionedTransaction.deserialize(Buffer.from(j.swapTransaction, "base64"));
    return { ...q.quote, tx: j.swapTransaction, lastValidBlockHeight: j.lastValidBlockHeight, simulation: await simulate(vtx) };
  }

  const tx = await dbc.pool.swap({
    owner: wallet,
    pool: q.ctx.pool,
    amountIn: q.amountIn,
    minimumAmountOut: q.dbcMinOut!,
    swapBaseForQuote: req.side === "sell",
    referralTokenAccount: null,
    payer: wallet,
  });
  const { vtx, lastValidBlockHeight } = await compile(wallet, tx, 200_000);
  return { ...q.quote, tx: Buffer.from(vtx.serialize()).toString("base64"), lastValidBlockHeight, simulation: await simulate(vtx) };
}

// ---- balances ----

export type Balances = { sol: number; usdc: number; stock: number; token: number };

export async function balances(wallet: string, pool: string): Promise<Balances> {
  const owner = new PublicKey(wallet);
  const ctx = await poolCtx(pool);
  return cached(`bal:${wallet}:${pool}`, 4000, async () => {
    const [lamports, classic, t22] = await Promise.all([
      connection.getBalance(owner),
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
    ]);
    const sum = (mint: string) =>
      [...classic.value, ...t22.value]
        .filter((a) => a.account.data.parsed?.info?.mint === mint)
        .reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmountString ?? 0), 0);
    return { sol: lamports / 1e9, usdc: sum(PAY_ASSETS.USDC.mint), stock: sum(ctx.stockMint), token: sum(ctx.baseMint) };
  });
}

// ---- claim trading fees ----

export type ClaimBuild = { tx: string; lastValidBlockHeight: number; claims: string[]; simulation: { ok: boolean; error: string | null; logs: string[] } };

export async function buildClaim(poolAddress: string, walletAddress: string): Promise<ClaimBuild> {
  const wallet = new PublicKey(walletAddress);
  const ctx = await poolCtx(poolAddress);
  const isPartner = ctx.cfg.feeClaimer.equals(wallet);
  const isCreator = ctx.state.creator.equals(wallet);
  if (!isPartner && !isCreator) throw new Error("Only the pool's fee claimer or creator can claim its trading fees.");
  const tx = new Transaction();
  const claims: string[] = [];
  const max = new BN(U64_MAX.toString());
  if (isPartner && (!ctx.state.partnerQuoteFee.isZero() || !ctx.state.partnerBaseFee.isZero())) {
    tx.add(await dbc.partner.claimPartnerTradingFee({ feeClaimer: wallet, payer: wallet, pool: ctx.pool, maxBaseAmount: max, maxQuoteAmount: max, receiver: wallet }));
    claims.push(`partner: ${toUi(ctx.state.partnerQuoteFee, ctx.stockDecimals, ctx.multiplier)} ${ctx.stockSymbol}`);
  }
  if (isCreator && (!ctx.state.creatorQuoteFee.isZero() || !ctx.state.creatorBaseFee.isZero())) {
    tx.add(await dbc.creator.claimCreatorTradingFee({ creator: wallet, payer: wallet, pool: ctx.pool, maxBaseAmount: max, maxQuoteAmount: max, receiver: wallet }));
    claims.push(`creator: ${toUi(ctx.state.creatorQuoteFee, ctx.stockDecimals, ctx.multiplier)} ${ctx.stockSymbol}`);
  }
  if (!claims.length) throw new Error("Nothing to claim yet.");
  const { vtx, lastValidBlockHeight } = await compile(wallet, tx, 250_000);
  return { tx: Buffer.from(vtx.serialize()).toString("base64"), lastValidBlockHeight, claims, simulation: await simulate(vtx) };
}
