import "server-only";
import BN from "bn.js";
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { deriveDbcPoolAddress, deriveTokenBadgeAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { checkSettings, toConfigParameters, type LaunchSettings } from "../preset.ts";
import { connection, dbc } from "./solana.ts";
import { curveModel, feeModel, sdkValidation, type CurveModel, type FeeModel } from "./curve.ts";
import { stockInfo, type StockInfo } from "./stockInfo.ts";

export type LaunchPreview = {
  ok: boolean;
  problems: string[];
  stock: StockInfo | null;
  usdPerStock: number | null;
  curve: CurveModel | null;
  fees: FeeModel | null;
  startFdvUsd: number | null;
  graduationFdvUsd: number | null;
};

export async function previewLaunch(s: LaunchSettings): Promise<LaunchPreview> {
  const stock = await stockInfo(s.stockMint);
  const problems = checkSettings(s);
  if (!stock) return { ok: false, problems: ["Pick a supported stock."], stock: null, usdPerStock: null, curve: null, fees: null, startFdvUsd: null, graduationFdvUsd: null };
  if (!stock.badge) problems.push(`${stock.symbol} has no DBC token badge, so it cannot be a quote token.`);
  if (stock.paused) problems.push(`${stock.symbol} transfers are paused by the issuer right now.`);
  if (stock.usd === null) problems.push(`No live price for ${stock.symbol}; graduation cannot be converted from USD.`);
  const usdPerStock = stock.usd !== null ? stock.usd * stock.multiplier : null;
  if (problems.length || usdPerStock === null) return { ok: false, problems, stock, usdPerStock, curve: null, fees: null, startFdvUsd: null, graduationFdvUsd: null };

  try {
    const cp: any = toConfigParameters(s, { decimals: stock.decimals, usd: stock.usd!, multiplier: stock.multiplier });
    const sdkError = sdkValidation(cp);
    if (sdkError) problems.push(`Meteora SDK: ${sdkError}`);
    const curve = curveModel(
      { sqrtStartPrice: cp.sqrtStartPrice, curve: cp.curve, migrationQuoteThreshold: cp.migrationQuoteThreshold, tokenDecimal: cp.tokenDecimal },
      stock.decimals,
      cp.tokenSupply?.preMigrationTokenSupply ?? new BN(s.totalSupply).mul(new BN(10).pow(new BN(s.baseDecimals))),
    );
    const fees = feeModel(cp.poolFees.baseFee, s.creatorFeeShare, s.dynamicFee);
    return {
      ok: problems.length === 0,
      problems,
      stock,
      usdPerStock,
      curve,
      fees,
      startFdvUsd: curve.startPrice * curve.totalSupply * usdPerStock,
      graduationFdvUsd: curve.graduationPrice * curve.totalSupply * usdPerStock,
    };
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
    return { ok: false, problems, stock, usdPerStock, curve: null, fees: null, startFdvUsd: null, graduationFdvUsd: null };
  }
}

export type BuildRequest = {
  settings: LaunchSettings;
  wallet: string;
  config: string; // pubkey of a keypair generated in the browser
  baseMint: string; // pubkey of a keypair generated in the browser
  name: string;
  symbol: string;
  uri: string;
};

export type BuildResult = {
  tx: string; // base64 v0 transaction, unsigned
  pool: string;
  lastValidBlockHeight: number;
  simulation: { ok: boolean; units: number | null; error: string | null; logs: string[] };
};

export async function buildLaunch(req: BuildRequest): Promise<BuildResult> {
  const wallet = new PublicKey(req.wallet);
  const config = new PublicKey(req.config);
  const baseMint = new PublicKey(req.baseMint);
  const name = req.name.trim().slice(0, 32);
  const symbol = req.symbol.trim().toUpperCase().slice(0, 10);
  if (!name || !symbol) throw new Error("Name and ticker are required.");
  // The create transaction is ~1190 bytes with short strings and the limit is 1232, so the link must stay short.
  if (!/^https:\/\/[^\s]+$/.test(req.uri) || req.uri.length > 80) throw new Error("Metadata link must be a public https URL of 80 characters or fewer.");
  if (/\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(req.uri)) throw new Error("Metadata link points at this computer. Token metadata is permanent, so it must be a public URL.");

  const preview = await previewLaunch(req.settings);
  if (!preview.ok || !preview.stock) throw new Error(preview.problems[0] ?? "Settings are not buildable.");
  const stock = preview.stock;
  const quoteMint = new PublicKey(stock.mint);

  const cp = toConfigParameters(req.settings, { decimals: stock.decimals, usd: stock.usd!, multiplier: stock.multiplier });
  // The three RPC round trips are independent; run them together.
  const [tx, fees, { blockhash, lastValidBlockHeight }] = await Promise.all([
    dbc.partner.createConfigAndPool({
      ...cp,
      config,
      feeClaimer: wallet,
      leftoverReceiver: wallet,
      quoteMint,
      payer: wallet,
      tokenBadge: deriveTokenBadgeAddress(quoteMint),
      preCreatePoolParam: { name, symbol, uri: req.uri, poolCreator: wallet, baseMint },
    }),
    connection.getRecentPrioritizationFees().catch(() => []),
    connection.getLatestBlockhash("confirmed"),
  ]);
  const sorted = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
  const p75 = sorted.length ? sorted[Math.floor(sorted.length * 0.75)] : 50_000;
  const microLamports = Math.min(Math.max(p75, 10_000), 500_000);

  const message = new TransactionMessage({
    payerKey: wallet,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 260_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
      ...tx.instructions,
    ],
  }).compileToV0Message();
  const vtx = new VersionedTransaction(message);
  let size = 0;
  try {
    size = vtx.serialize().length;
  } catch {
    size = Infinity;
  }
  if (size > 1232) throw new Error("Transaction too large: shorten the name, ticker or metadata link.");

  const sim = await connection.simulateTransaction(vtx, { sigVerify: false, replaceRecentBlockhash: true });
  const logs = sim.value.logs ?? [];
  const anchorErr = logs.find((l) => l.includes("Error Message:"))?.split("Error Message:")[1]?.trim();
  const insufficient = logs.some((l) => /insufficient lamports|insufficient funds/i.test(l));
  return {
    tx: Buffer.from(vtx.serialize()).toString("base64"),
    pool: deriveDbcPoolAddress(quoteMint, baseMint, config).toBase58(),
    lastValidBlockHeight,
    simulation: {
      ok: !sim.value.err,
      units: sim.value.unitsConsumed ?? null,
      error: sim.value.err ? (insufficient || sim.value.err === "AccountNotFound" ? "Not enough SOL for rent and fees (about 0.04 SOL needed)." : anchorErr ?? JSON.stringify(sim.value.err)) : null,
      logs: sim.value.err ? logs.slice(-12) : [],
    },
  };
}
