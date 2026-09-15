import "server-only";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getMint,
  getPausableConfig,
  getPermanentDelegate,
  getScaledUiAmountConfig,
  getTransferHook,
} from "@solana/spl-token";
import { deriveTokenBadgeAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { STOCKS, STOCK_BY_MINT, type StockMeta } from "../stocks.ts";
import { cached, connection } from "./solana.ts";

export type StockInfo = StockMeta & {
  usd: number | null;
  /** Scaled UI multiplier in force now (corporate actions). Display amount = raw amount x multiplier. */
  multiplier: number;
  nextMultiplier: number | null;
  nextMultiplierAt: number | null; // unix seconds, only if in the future
  paused: boolean;
  permanentDelegate: string | null;
  transferHook: string | null;
  badge: boolean;
  badgeAddress: string;
};

async function prices(mints: string[]): Promise<Record<string, number>> {
  return cached(`prices:${mints.join(",")}`, 30_000, async () => {
    const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mints.join(",")}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`price ${r.status}`);
    const j = (await r.json()) as Record<string, { usdPrice?: number }>;
    return Object.fromEntries(Object.entries(j).filter(([, v]) => v?.usdPrice).map(([k, v]) => [k, v.usdPrice!]));
  });
}

async function controls(meta: StockMeta) {
  return cached(`controls:${meta.mint}`, 120_000, async () => {
    const mintKey = new PublicKey(meta.mint);
    const badgeAddress = deriveTokenBadgeAddress(mintKey);
    const [mint, badgeAcct] = await Promise.all([
      getMint(connection, mintKey, "confirmed", TOKEN_2022_PROGRAM_ID),
      connection.getAccountInfo(badgeAddress),
    ]);
    const scaled = getScaledUiAmountConfig(mint);
    const now = Date.now() / 1000;
    let multiplier = 1;
    let nextMultiplier: number | null = null;
    let nextMultiplierAt: number | null = null;
    if (scaled) {
      const at = Number(scaled.newMultiplierEffectiveTimestamp);
      if (at && now >= at) multiplier = scaled.newMultiplier;
      else {
        multiplier = scaled.multiplier;
        if (at && scaled.newMultiplier !== scaled.multiplier) {
          nextMultiplier = scaled.newMultiplier;
          nextMultiplierAt = at;
        }
      }
    }
    const pd = getPermanentDelegate(mint)?.delegate;
    const hook = getTransferHook(mint)?.programId;
    return {
      multiplier,
      nextMultiplier,
      nextMultiplierAt,
      paused: !!getPausableConfig(mint)?.paused,
      permanentDelegate: pd && !pd.equals(PublicKey.default) ? pd.toBase58() : null,
      transferHook: hook && !hook.equals(PublicKey.default) ? hook.toBase58() : null,
      badge: !!badgeAcct,
      badgeAddress: badgeAddress.toBase58(),
    };
  });
}

export async function stockInfo(mint: string): Promise<StockInfo | null> {
  const meta = STOCK_BY_MINT.get(mint);
  if (!meta) return null;
  const [p, c] = await Promise.all([prices(STOCKS.map((s) => s.mint)).catch(() => ({}) as Record<string, number>), controls(meta)]);
  return { ...meta, usd: p[mint] ?? null, ...c };
}

export async function allStockInfo(): Promise<StockInfo[]> {
  const out: StockInfo[] = [];
  // Sequential: the RPC rate-limits bursts and results are cached for minutes.
  for (const s of STOCKS) {
    const info = await stockInfo(s.mint).catch(() => null);
    if (info) out.push(info);
  }
  return out;
}
