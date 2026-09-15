// GeckoTerminal candles, fetched from the viewer's browser.
// The free API rate-limits per IP (about 30 calls a minute), and our server's IP
// is shared with other apps, so each visitor uses their own allowance instead.
import type { Candle, Timeframe } from "@/lib/server/chart";

const API = "https://api.geckoterminal.com/api/v2/networks/solana";
const TF: Record<Timeframe, { unit: string; agg: number }> = {
  "5m": { unit: "minute", agg: 5 },
  "15m": { unit: "minute", agg: 15 },
  "1h": { unit: "hour", agg: 1 },
  "4h": { unit: "hour", agg: 4 },
  "1d": { unit: "day", agg: 1 },
};

const memo = new Map<string, { at: number; value: unknown }>();
async function get<T>(path: string, ttlMs: number): Promise<T | null> {
  const hit = memo.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const r = await fetch(`${API}${path}`, { headers: { accept: "application/json" } });
  if (r.status === 429) throw new Error("rate-limited");
  const value = r.ok ? ((await r.json()) as T) : null;
  memo.set(path, { at: Date.now(), value });
  return value;
}

/** Where a graduated token trades now: its most liquid pool that is not the old DBC curve. */
export async function successorPool(baseMint: string): Promise<{ address: string; dex: string } | null> {
  const j = await get<any>(`/tokens/${baseMint}/pools?page=1`, 30 * 60_000);
  const pools = (j?.data ?? []).filter((p: any) => p?.relationships?.dex?.data?.id !== "meteora-dbc");
  pools.sort((a: any, b: any) => Number(b.attributes?.reserve_in_usd ?? 0) - Number(a.attributes?.reserve_in_usd ?? 0));
  const top = pools[0];
  return top ? { address: top.attributes.address, dex: top.relationships.dex.data.id } : null;
}

export async function geckoCandles(pool: string, tf: Timeframe): Promise<Candle[]> {
  const t = TF[tf];
  const j = await get<any>(`/pools/${pool}/ohlcv/${t.unit}?aggregate=${t.agg}&limit=300&currency=usd&token=base`, 60_000);
  const list: number[][] = j?.data?.attributes?.ohlcv_list ?? [];
  return list
    .map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
    .filter((c) => c.close > 0)
    .sort((a, b) => a.time - b.time);
}
