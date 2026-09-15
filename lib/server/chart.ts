import "server-only";
import { PublicKey } from "@solana/web3.js";
import { getPriceFromSqrtPrice } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { cached, dbc } from "./solana.ts";
import { stockInfo } from "./stockInfo.ts";
import { recentTrades } from "./pool.ts";

// Candles for the pool page, server half.
//
// DexScreener indexes these pools but has no USD price for pairs quoted in an
// xStock, so its embed never renders. GeckoTerminal does price them, but its
// free API throttles this server's IP (Pewcake polls it from the same host),
// so the browser fetches GeckoTerminal candles itself (CORS is open) and this
// endpoint supplies the fallback: candles built from our own decoded swaps,
// anchored at the curve's start price and its current price.

export type Timeframe = "5m" | "15m" | "1h" | "4h" | "1d";
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type ChartData = {
  pool: string;
  baseMint: string;
  isMigrated: boolean;
  timeframe: Timeframe;
  candles: Candle[]; // on-chain fallback (empty for graduated pools)
  note: string;
};

export const TF_SECONDS: Record<Timeframe, number> = { "5m": 300, "15m": 900, "1h": 3600, "4h": 14_400, "1d": 86_400 };

export async function chartData(address: string, timeframe: Timeframe): Promise<ChartData> {
  const tf: Timeframe = TF_SECONDS[timeframe] ? timeframe : "15m";
  const state: any = await cached(`pool:${address}`, 4000, async () => {
    const w: any = await dbc.state.getPool(new PublicKey(address));
    return w?.poolState ?? w ?? null;
  });
  if (!state?.config) throw new Error("No DBC pool at this address.");
  const base = { pool: address, baseMint: state.baseMint.toBase58(), isMigrated: !!state.isMigrated, timeframe: tf };
  if (state.isMigrated) return { ...base, candles: [], note: "Graduated: trading continues in its DAMM v2 pool." };

  return cached(`chart:${address}:${tf}`, 10_000, async () => {
    const cfg: any = await cached(`cfg:${state.config.toBase58()}`, 3600_000, () => dbc.state.getPoolConfig(state.config));
    const stock = await stockInfo(cfg.quoteMint.toBase58());
    const displayUsd = stock?.usd ?? 0; // per displayed stock unit
    const rawUsd = displayUsd * (stock?.multiplier ?? 1); // per raw stock unit
    const spotUsd = (sqrt: any) => Number(getPriceFromSqrtPrice(sqrt, cfg.tokenDecimal, stock!.decimals).toString()) * rawUsd;

    const { trades } = await recentTrades(address, 100);
    const points: { t: number; p: number; v: number }[] = [];
    if (cfg.activationType === 1) points.push({ t: Number(state.activationPoint.toString()), p: spotUsd(cfg.sqrtStartPrice), v: 0 });
    // Pool price right after each swap (fee-free); fall back to the fee-inclusive execution price.
    for (const tr of trades) {
      const px = tr.spot ?? tr.price;
      if (tr.time && px > 0) points.push({ t: tr.time, p: px * displayUsd, v: tr.stock * displayUsd });
    }
    points.push({ t: Math.floor(Date.now() / 1000), p: spotUsd(state.sqrtPrice), v: 0 });
    points.sort((a, b) => a.t - b.t);

    const size = TF_SECONDS[tf];
    const buckets = new Map<number, Candle>();
    let prevClose: number | null = null;
    for (const pt of points) {
      const time = Math.floor(pt.t / size) * size;
      const c = buckets.get(time);
      if (!c) {
        const open = prevClose ?? pt.p;
        buckets.set(time, { time, open, high: Math.max(open, pt.p), low: Math.min(open, pt.p), close: pt.p, volume: pt.v });
      } else {
        c.high = Math.max(c.high, pt.p);
        c.low = Math.min(c.low, pt.p);
        c.close = pt.p;
        c.volume += pt.v;
      }
      prevClose = pt.p;
    }
    // Fill gaps with flat candles at the last price so the chart reads as continuous time.
    const filled: Candle[] = [];
    for (const c of [...buckets.values()].sort((a, b) => a.time - b.time)) {
      const prev = filled.at(-1);
      if (prev) for (let t = prev.time + size; t < c.time && filled.length < 2000; t += size) filled.push({ time: t, open: prev.close, high: prev.close, low: prev.close, close: prev.close, volume: 0 });
      filled.push(c);
    }
    return {
      ...base,
      candles: filled.slice(-500),
      note: `Built from ${trades.length} on-chain swap${trades.length === 1 ? "" : "s"}, in USD at today's ${stock?.symbol ?? "stock"} price.`,
    };
  });
}
