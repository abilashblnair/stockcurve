// Stage 3 of the go/no-go: the real thing, with your own wallet.
//
//   1. create config + pool with the equity preset, quoted in the stock
//   2. buy a small amount (default 0.005 stock, about $1 of NVDAx)
//   3. sell everything bought back to the pool
//
// Default is a DRY RUN: every transaction is built, signed and simulated,
// nothing is sent. Add --send to broadcast.
//
//   KEYPAIR=keys/test-wallet.json npm run live -- NVDAx
//   KEYPAIR=keys/test-wallet.json npm run live -- NVDAx --send
//   options: --buy 0.005   (stock units)
//
// Notes
// - The preset's opening fee starts at 25% and decays over an hour, so a
//   buy+sell right after launch pays a lot of fee. You are feeClaimer and
//   creator, so most of it is claimable by you afterwards; the protocol
//   keeps its share.
// - Token metadata is immutable. The test token keeps its name forever.
// - The dry run can only simulate step 1; steps 2-3 need the pool to exist.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import BN from "bn.js";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  DynamicBondingCurveClient,
  deriveDbcPoolAddress,
  deriveTokenBadgeAddress,
  getCurrentPoint,
  swapQuote,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { STOCKS, equityPreset, graduationInStock, stockUsd } from "../lib/preset.ts";

const RPC = process.env.SOLANA_RPC;
if (!RPC) throw new Error("SOLANA_RPC missing from .env");
const args = process.argv.slice(2);
const SEND = args.includes("--send");
const symbol = args.find((a, i) => !a.startsWith("-") && args[i - 1] !== "--buy") ?? "NVDAx";
const stock = STOCKS[symbol];
if (!stock) throw new Error(`unknown stock ${symbol}; known: ${Object.keys(STOCKS).join(", ")}`);
const buyIdx = args.indexOf("--buy");
const BUY_STOCK = buyIdx >= 0 ? Number(args[buyIdx + 1]) : 0.005;
if (!(BUY_STOCK > 0 && BUY_STOCK <= 0.05)) throw new Error("--buy must be between 0 and 0.05 stock units for this test");

const keypairPath = process.env.KEYPAIR;
if (!keypairPath) throw new Error("set KEYPAIR to a solana-keygen JSON file (e.g. keys/test-wallet.json). Use a fresh test wallet.");
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8"))));

const connection = new Connection(RPC, "confirmed");
const client = DynamicBondingCurveClient.create(connection, "confirmed");
const quoteMint = new PublicKey(stock.mint);
const PRIORITY = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(label: string, tx: Transaction, signers: Keypair[]) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash,
    instructions: [PRIORITY, ...tx.instructions],
  }).compileToV0Message();
  const vtx = new VersionedTransaction(msg);
  vtx.sign(signers);
  const sim = await connection.simulateTransaction(vtx, { sigVerify: true });
  if (sim.value.err) {
    console.log(`[${label}] simulation FAILED ${JSON.stringify(sim.value.err)}`);
    for (const l of (sim.value.logs ?? []).slice(-12)) console.log("  " + l);
    throw new Error(`${label} failed in simulation`);
  }
  console.log(`[${label}] simulation OK (${sim.value.unitsConsumed} units, ${vtx.serialize().length} bytes)`);
  if (!SEND) return null;
  const sig = await connection.sendRawTransaction(vtx.serialize(), { skipPreflight: true, maxRetries: 3 });
  const conf = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (conf.value.err) throw new Error(`${label} failed on chain: ${sig} ${JSON.stringify(conf.value.err)}`);
  console.log(`[${label}] confirmed https://solscan.io/tx/${sig}`);
  return sig;
}

async function tokenBalance(mint: PublicKey, program: PublicKey): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, program);
  const b = await connection.getTokenAccountBalance(ata).catch(() => null);
  return b ? BigInt(b.value.amount) : 0n;
}

async function main() {
  const price = await stockUsd(stock.mint);
  const sol = (await connection.getBalance(wallet.publicKey)) / LAMPORTS_PER_SOL;
  const stockRaw = await tokenBalance(quoteMint, TOKEN_2022_PROGRAM_ID);
  const buyRaw = new BN(Math.round(BUY_STOCK * 10 ** stock.decimals));

  console.log(`mode      ${SEND ? "SEND (real transactions)" : "dry run (simulate only)"}`);
  console.log(`wallet    ${wallet.publicKey.toBase58()}`);
  console.log(`balances  ${sol.toFixed(4)} SOL · ${(Number(stockRaw) / 10 ** stock.decimals).toFixed(6)} ${symbol}`);
  console.log(`${symbol}     $${price.toFixed(2)} · graduation ${graduationInStock(price)} ${symbol} · test buy ${BUY_STOCK} ${symbol} (~$${(BUY_STOCK * price).toFixed(2)})`);
  if (sol < 0.05) throw new Error("need at least 0.05 SOL for rent + fees (config, pool, vaults, metadata)");
  if (SEND && stockRaw < BigInt(buyRaw.toString())) throw new Error(`need at least ${BUY_STOCK} ${symbol} for the test buy`);

  // Keys for the new accounts are saved before anything is sent.
  const config = Keypair.generate();
  const baseMint = Keypair.generate();
  const runDir = path.join("runs", new Date().toISOString().replace(/[:.]/g, "-"));
  if (SEND) {
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "config.json"), JSON.stringify(Array.from(config.secretKey)));
    fs.writeFileSync(path.join(runDir, "base-mint.json"), JSON.stringify(Array.from(baseMint.secretKey)));
  }

  const params = equityPreset({ stock, stockUsd: price });
  const createTx = await client.partner.createConfigAndPool({
    ...params,
    config: config.publicKey,
    feeClaimer: wallet.publicKey,
    leftoverReceiver: wallet.publicKey,
    quoteMint,
    payer: wallet.publicKey,
    tokenBadge: deriveTokenBadgeAddress(quoteMint),
    preCreatePoolParam: {
      name: `Stockcurve ${symbol} Test`,
      symbol: "SCTEST",
      uri: "https://pewcake.fun/stockcurve/test.json",
      poolCreator: wallet.publicKey,
      baseMint: baseMint.publicKey,
    },
  });
  const pool = deriveDbcPoolAddress(quoteMint, baseMint.publicKey, config.publicKey);
  console.log(`config    ${config.publicKey.toBase58()}`);
  console.log(`base mint ${baseMint.publicKey.toBase58()}`);
  console.log(`pool      ${pool.toBase58()}`);

  const createSig = await run("1 create config + pool", createTx, [wallet, config, baseMint]);
  if (!SEND) {
    console.log("\nDry run done. Steps 2-3 (buy, sell) need the pool to exist; rerun with --send.");
    return;
  }

  // Wait for the pool account to be readable.
  let poolWrapped: any = null;
  for (let i = 0; i < 20 && !poolWrapped; i++) {
    poolWrapped = await client.state.getPool(pool);
    if (!poolWrapped) await sleep(1000);
  }
  if (!poolWrapped) throw new Error("pool not readable after 20s");
  const cfg = await client.state.getPoolConfig(config.publicKey);

  // 2. buy
  const point = await getCurrentPoint(connection, cfg!.activationType);
  const q = swapQuote(poolWrapped, cfg!, false, buyRaw, 1000, false, point, false);
  console.log(`buy quote ${buyRaw.toString()} raw ${symbol} -> ${q.outputAmount.toString()} base (min ${q.minimumAmountOut.toString()})`);
  const buyTx = await client.pool.swap({
    owner: wallet.publicKey,
    pool,
    amountIn: buyRaw,
    minimumAmountOut: q.minimumAmountOut,
    swapBaseForQuote: false,
    referralTokenAccount: null,
  });
  const buySig = await run("2 buy", buyTx, [wallet]);

  // 3. sell everything bought
  await sleep(1500);
  const baseRaw = await tokenBalance(baseMint.publicKey, TOKEN_PROGRAM_ID);
  if (baseRaw === 0n) throw new Error("base balance is zero after buy");
  const sellTx = await client.pool.swap({
    owner: wallet.publicKey,
    pool,
    amountIn: new BN(baseRaw.toString()),
    minimumAmountOut: new BN(0),
    swapBaseForQuote: true,
    referralTokenAccount: null,
  });
  const sellSig = await run("3 sell", sellTx, [wallet]);

  const after = await tokenBalance(quoteMint, TOKEN_2022_PROGRAM_ID);
  const summary = {
    stock: symbol,
    wallet: wallet.publicKey.toBase58(),
    config: config.publicKey.toBase58(),
    baseMint: baseMint.publicKey.toBase58(),
    pool: pool.toBase58(),
    txs: { create: createSig, buy: buySig, sell: sellSig },
    stockBefore: stockRaw.toString(),
    stockAfter: after.toString(),
    buyRaw: buyRaw.toString(),
    baseBought: baseRaw.toString(),
  };
  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\nLIVE GO: created, bought and sold on mainnet. Net ${symbol} change ${(Number(after - stockRaw) / 10 ** stock.decimals).toFixed(6)} (fees, most claimable by you).`);
  console.log(`saved ${runDir}/summary.json`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
