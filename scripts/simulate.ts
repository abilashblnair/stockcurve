// Stage 2 of the go/no-go: mainnet simulation, nothing signed or sent.
//
//   A. Our equity preset: create config + pool quoted in the stock, as one
//      transaction, simulated with signature verification off.
//   B. Swap path: buy then sell in one transaction on an existing, still
//      bonding pool quoted in the same stock, simulated from a wallet that
//      really holds the stock.
//
//   npm run simulate                 NVDAx
//   npm run simulate -- SPYx
import "dotenv/config";
import BN from "bn.js";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  DynamicBondingCurveClient,
  deriveTokenBadgeAddress,
  getCurrentPoint,
  swapQuote,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { STOCKS, equityPreset, graduationInStock, stockUsd } from "../lib/preset.ts";

const RPC = process.env.SOLANA_RPC;
if (!RPC) throw new Error("SOLANA_RPC missing from .env");
const symbol = process.argv.slice(2).find((a) => !a.startsWith("-")) ?? "NVDAx";
const stock = STOCKS[symbol];
if (!stock) throw new Error(`unknown stock ${symbol}; known: ${Object.keys(STOCKS).join(", ")}`);

const connection = new Connection(RPC, "confirmed");
const client = DynamicBondingCurveClient.create(connection, "confirmed");
const quoteMint = new PublicKey(stock.mint);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function simulate(label: string, tx: Transaction, feePayer: PublicKey) {
  const { blockhash } = await connection.getLatestBlockhash();
  const msg = new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: tx.instructions }).compileToV0Message();
  const vtx = new VersionedTransaction(msg);
  const size = vtx.serialize().length;
  const res = await connection.simulateTransaction(vtx, { sigVerify: false, replaceRecentBlockhash: true });
  const ok = !res.value.err;
  console.log(`\n[${label}] ${ok ? "OK" : "FAILED"}  size ${size}/1232 bytes  units ${res.value.unitsConsumed ?? "?"}`);
  if (!ok) {
    console.log("  error", JSON.stringify(res.value.err));
    for (const l of (res.value.logs ?? []).slice(-15)) console.log("  " + l);
  }
  return { ok, size, logs: res.value.logs ?? [] };
}

// A wallet (system-owned, has SOL) that holds the stock. Largest holders first.
async function findHolder(minRaw: bigint): Promise<{ owner: PublicKey; raw: bigint } | null> {
  const largest = await connection.getTokenLargestAccounts(quoteMint);
  for (const a of largest.value) {
    if (BigInt(a.amount) < minRaw) continue;
    const parsed: any = (await connection.getParsedAccountInfo(a.address)).value?.data;
    const owner = parsed?.parsed?.info?.owner;
    if (!owner) continue;
    const ownerInfo = await connection.getAccountInfo(new PublicKey(owner));
    if (ownerInfo && ownerInfo.owner.equals(SystemProgram.programId) && ownerInfo.lamports > 20_000_000) {
      return { owner: new PublicKey(owner), raw: BigInt(a.amount) };
    }
    await sleep(100);
  }
  return null;
}

// A pool quoted in this stock that has traded and has not graduated.
async function findBondingPool() {
  const configs = await connection.getProgramAccounts(DYNAMIC_BONDING_CURVE_PROGRAM_ID, {
    dataSlice: { offset: 0, length: 0 },
    filters: [{ dataSize: 1048 }, { memcmp: { offset: 8, bytes: quoteMint.toBase58() } }],
  });
  for (const c of configs) {
    const pools = (await client.state.getPoolsByConfig(c.pubkey).catch(() => [] as any[])).map((p: any) => ({ publicKey: p.publicKey, raw: p.account, account: p.account?.poolState ?? p.account }));
    const live = pools.filter((p) => p.account?.quoteReserve && !p.account.isMigrated && !p.account.quoteReserve.isZero());
    if (live.length) {
      const cfg = await client.state.getPoolConfig(c.pubkey);
      // Still on the curve: reserve below the graduation threshold.
      const p = live.find((p) => cfg && p.account.quoteReserve.lt(cfg.migrationQuoteThreshold));
      if (p) return { pool: p.publicKey as PublicKey, state: p.raw, config: c.pubkey }; // swapQuote wants the { poolState } wrapper
    }
    await sleep(120);
  }
  return null;
}

async function main() {
  const price = await stockUsd(stock.mint);
  const threshold = graduationInStock(price);
  console.log(`${symbol} = $${price.toFixed(2)} · graduation ${threshold} ${symbol} (~$${(threshold * price).toFixed(0)})`);

  const badge = deriveTokenBadgeAddress(quoteMint);
  const holder = await findHolder(BigInt(10 ** stock.decimals / 100)); // >= 0.01 stock
  if (!holder) throw new Error(`no system-owned ${symbol} holder with SOL found among largest accounts`);
  console.log(`simulating as ${holder.owner.toBase58()} (holds ${(Number(holder.raw) / 10 ** stock.decimals).toFixed(4)} ${symbol})`);

  // ---- A: our preset, config + pool in one tx ----
  const params = equityPreset({ stock, stockUsd: price });
  const config = Keypair.generate();
  const baseMint = Keypair.generate();
  const createTx = await client.partner.createConfigAndPool({
    ...params,
    config: config.publicKey,
    feeClaimer: holder.owner,
    leftoverReceiver: holder.owner,
    quoteMint,
    payer: holder.owner,
    tokenBadge: badge,
    preCreatePoolParam: {
      name: "Stockcurve Test",
      symbol: "SCTEST",
      uri: "https://pewcake.fun/stockcurve/test.json",
      poolCreator: holder.owner,
      baseMint: baseMint.publicKey,
    },
  });
  const a = await simulate(`A preset config+pool quoted in ${symbol}`, createTx, holder.owner);
  let aSplit: boolean | null = null;
  if (!a.ok && a.size > 1232) {
    // Too big for one tx: simulate the config on its own (the pool needs the config to exist).
    const cfgTx = await client.partner.createConfig({ ...params, config: config.publicKey, feeClaimer: holder.owner, leftoverReceiver: holder.owner, quoteMint, payer: holder.owner, tokenBadge: badge });
    aSplit = (await simulate(`A' preset config only`, cfgTx, holder.owner)).ok;
  }

  // ---- B: buy + sell on an existing bonding pool ----
  const found = await findBondingPool();
  let b: { ok: boolean } = { ok: false };
  if (!found) {
    console.log(`\n[B] no bonding ${symbol} pool with trades found; skipped`);
  } else {
    const cfg = await client.state.getPoolConfig(found.config);
    const amountIn = new BN(10 ** stock.decimals / 100); // 0.01 stock
    const currentPoint = await getCurrentPoint(connection, cfg!.activationType);
    const q = swapQuote(found.state, cfg!, false, amountIn, 500, false, currentPoint, false);
    const outBase: BN = q.outputAmount;
    const sellIn = outBase.muln(95).divn(100);
    console.log(`\npool ${found.pool.toBase58()} · 0.01 ${symbol} buys ~${outBase.toString()} base units; selling back ${sellIn.toString()}`);

    const buy = await client.pool.swap({ owner: holder.owner, pool: found.pool, amountIn, minimumAmountOut: new BN(0), swapBaseForQuote: false, referralTokenAccount: null });
    const sell = await client.pool.swap({ owner: holder.owner, pool: found.pool, amountIn: sellIn, minimumAmountOut: new BN(0), swapBaseForQuote: true, referralTokenAccount: null });
    const both = new Transaction().add(...buy.instructions, ...sell.instructions);
    b = await simulate(`B buy then sell, ${symbol} quote (Token-2022)`, both, holder.owner);
    if (b.ok) {
      const t22 = (b as any).logs?.some((l: string) => l.includes(TOKEN_2022_PROGRAM_ID.toBase58()));
      console.log(`  Token-2022 program invoked: ${t22 ? "yes" : "not seen in logs"}`);
    }
  }

  const aOk = a.ok || aSplit === true;
  console.log(`\nVerdict for ${symbol}: preset ${aOk ? "GO" : "NO-GO"}${aSplit !== null ? " (config and pool need separate txs)" : ""} · swap path ${b.ok ? "GO" : "NO-GO"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
