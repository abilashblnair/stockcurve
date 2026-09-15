"use client";

import { useEffect, useRef, useState } from "react";
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { Candle, ChartData, Timeframe } from "@/lib/server/chart";
import { geckoCandles, successorPool } from "@/lib/client/gecko";

type View = { source: "geckoterminal" | "onchain"; candles: Candle[]; note: string | null; chartPool: string };
import { usd } from "@/lib/format";

const TIMEFRAMES: Timeframe[] = ["5m", "15m", "1h", "4h", "1d"];

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Candlestick price chart (USD) drawn locally with TradingView's open-source lightweight-charts. */
export default function PoolChart({ address, refreshKey }: { address: string; refreshKey?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [tf, setTf] = useState<Timeframe>("15m");
  const [data, setData] = useState<View | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create the chart once.
  useEffect(() => {
    if (!box.current) return;
    const up = cssVar("--accent", "#0b7a53");
    const down = cssVar("--down", "#b83a26");
    const c = createChart(box.current, {
      autoSize: true,
      height: 340,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: cssVar("--muted", "#6d7179"), fontFamily: cssVar("--mono", "monospace"), fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: cssVar("--line", "#e0dcd2") }, horzLines: { color: cssVar("--line", "#e0dcd2") } },
      rightPriceScale: { borderColor: cssVar("--line-2", "#cfcabd") },
      timeScale: { borderColor: cssVar("--line-2", "#cfcabd"), timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { priceFormatter: (p: number) => usd(p) },
    });
    candles.current = c.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      borderUpColor: up,
      borderDownColor: down,
      wickUpColor: up,
      wickDownColor: down,
      priceFormat: { type: "custom", formatter: (p: number) => usd(p), minMove: 1e-12 },
    });
    volume.current = c.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, color: cssVar("--line-2", "#cfcabd") });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
    };
  }, []);

  // Load candles for the timeframe; refresh every minute (and after trades).
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/pool/${address}/chart?tf=${tf}`, { cache: "no-store" });
        const server: ChartData & { error?: string } = await r.json();
        if (!r.ok) throw new Error(server.error ?? "Chart unavailable");
        const onchain: View = { source: "onchain", candles: server.candles, note: server.note, chartPool: address };
        let view: View = onchain;
        try {
          // GeckoTerminal from this browser; after graduation, follow the token to the pool it trades in now.
          let chartPool = address;
          let note: string | null = null;
          if (server.isMigrated) {
            const succ = await successorPool(server.baseMint);
            if (succ) {
              chartPool = succ.address;
              note = `Graduated: showing the ${succ.dex === "meteora-damm-v2" ? "DAMM v2" : succ.dex} pool where it trades now.`;
            }
          }
          const gc = await geckoCandles(chartPool, tf);
          // GeckoTerminal lags on brand-new pools; keep our on-chain candles when they are more recent.
          const lastSwap = [...server.candles].reverse().find((c) => c.volume > 0)?.time ?? 0;
          const fresh = gc.length > 0 && gc[gc.length - 1].time >= lastSwap;
          if (fresh || (server.isMigrated && gc.length)) view = { source: "geckoterminal", candles: gc, note, chartPool };
          else if (server.isMigrated) view = { source: "geckoterminal", candles: [], note: note ?? "No candles yet for the graduated pool.", chartPool };
        } catch {
          if (server.isMigrated) view = { source: "geckoterminal", candles: [], note: "GeckoTerminal is rate-limiting this browser; the chart retries in a minute.", chartPool: address };
        }
        if (!alive) return;
        setData(view);
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Chart unavailable");
      } finally {
        if (alive) setLoading(false);
        if (alive) timer = setTimeout(load, 60_000);
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [address, tf, refreshKey]);

  // Push data into the chart.
  useEffect(() => {
    if (!data || !candles.current || !volume.current || !chart.current) return;
    const up = cssVar("--accent", "#0b7a53");
    const down = cssVar("--down", "#b83a26");
    candles.current.setData(data.candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    volume.current.setData(
      data.candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume, color: `${c.close >= c.open ? up : down}55` })),
    );
    chart.current.timeScale().fitContent();
  }, [data]);

  const last = data?.candles.at(-1);
  const first = data?.candles[0];
  const change = last && first && first.open > 0 ? ((last.close - first.open) / first.open) * 100 : null;

  return (
    <div className="stack-sm">
      <div className="spread">
        <div className="seg" role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((t) => (
            <button key={t} type="button" aria-pressed={tf === t} onClick={() => setTf(t)}>{t}</button>
          ))}
        </div>
        <div className="hstack tiny muted" style={{ gap: 10 }}>
          {last && <span className="mono">{usd(last.close)}{change !== null && <span className={change >= 0 ? "trade-buy" : "trade-sell"}> {change >= 0 ? "+" : ""}{change.toFixed(1)}%</span>}</span>}
          {loading && <span>loading…</span>}
        </div>
      </div>
      <div style={{ position: "relative" }}>
        <div ref={box} style={{ width: "100%", height: 340 }} />
        {!loading && data && data.candles.length === 0 && (
          <div className="note small" style={{ position: "absolute", inset: "40% 10% auto", textAlign: "center" }}>{data.note ?? "No price data yet."}</div>
        )}
        {error && !data && <div className="note note-bad small" style={{ position: "absolute", inset: "40% 10% auto", textAlign: "center" }}>{error}</div>}
      </div>
      <div className="spread tiny muted">
        <span>
          {data?.source === "geckoterminal" ? "Candles: GeckoTerminal (USD)" : data ? "Candles: Stockcurve, from on-chain swaps" : ""}
          {data?.note && data.candles.length > 0 ? ` · ${data.note}` : ""}
        </span>
        {data && (
          <span className="hstack" style={{ gap: 10 }}>
            <a href={`https://www.geckoterminal.com/solana/pools/${data.chartPool}`} target="_blank" rel="noreferrer">GeckoTerminal ↗</a>
            <a href={`https://dexscreener.com/solana/${data.chartPool}`} target="_blank" rel="noreferrer">DexScreener ↗</a>
          </span>
        )}
      </div>
    </div>
  );
}
