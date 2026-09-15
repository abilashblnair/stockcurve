"use client";

import { useEffect, useState } from "react";
import type { MarketLinks, Trade } from "@/lib/server/pool";
import { ago, tiny, usd } from "@/lib/format";

type Source = "gecko" | "dexscreener" | "trades";

function prefersDark() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

/** Price from our own decoded swaps, for pools no chart site has indexed yet. */
function TradesChart({ trades, usdPerStock }: { trades: Trade[]; usdPerStock: number | null }) {
  const pts = trades.filter((t) => t.time && t.price > 0).sort((a, b) => a.time! - b.time!);
  if (pts.length < 2) {
    return <div className="note small" style={{ minHeight: 120, display: "grid", placeItems: "center", textAlign: "center" }}>The price chart appears after a couple of trades. GeckoTerminal and DexScreener usually index a new pool within minutes of its first trades.</div>;
  }
  const W = 560, H = 220, P = { l: 64, r: 12, t: 12, b: 28 };
  const conv = (p: number) => (usdPerStock ? p * usdPerStock : p);
  const t0 = pts[0].time!, t1 = pts.at(-1)!.time!;
  const ys = pts.map((p) => conv(p.price));
  const yMin = Math.min(...ys) * 0.98, yMax = Math.max(...ys) * 1.02;
  const sx = (t: number) => P.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r);
  const sy = (y: number) => H - P.b - ((y - yMin) / Math.max(1e-30, yMax - yMin)) * (H - P.t - P.b);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.time!).toFixed(1)},${sy(conv(p.price)).toFixed(1)}`).join(" ");
  const label = (v: number) => (usdPerStock ? usd(v) : tiny(v));
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Trade prices from ${label(ys[0])} to ${label(ys.at(-1)!)}`}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line className="grid" x1={P.l} x2={W - P.r} y1={sy(yMin + (yMax - yMin) * f)} y2={sy(yMin + (yMax - yMin) * f)} />
          <text x={P.l - 8} y={sy(yMin + (yMax - yMin) * f) + 4} textAnchor="end">{label(yMin + (yMax - yMin) * f)}</text>
        </g>
      ))}
      <path className="line" d={d} />
      {pts.map((p) => (
        <circle key={p.signature + p.time} cx={sx(p.time!)} cy={sy(conv(p.price))} r={3} fill={p.side === "buy" ? "var(--accent)" : "var(--down)"} />
      ))}
      <text x={P.l} y={H - 8}>{ago(t0)}</text>
      <text x={W - P.r} y={H - 8} textAnchor="end">{ago(t1)}</text>
    </svg>
  );
}

export default function PoolChart({ address, trades, usdPerStock }: { address: string; trades: Trade[]; usdPerStock: number | null }) {
  const [links, setLinks] = useState<MarketLinks | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(prefersDark());
    let alive = true;
    const load = () =>
      fetch(`/api/pool/${address}/market`).then((r) => r.json()).then((j: MarketLinks) => {
        if (!alive) return;
        setLinks(j);
        setSource((cur) => cur ?? (j.gecko ? "gecko" : j.dexscreener ? "dexscreener" : "trades"));
        // Not indexed yet: look again in a few minutes.
        if (!j.gecko && !j.dexscreener) setTimeout(load, 5 * 60_000);
      }).catch(() => alive && setSource((cur) => cur ?? "trades"));
    load();
    return () => { alive = false; };
  }, [address]);

  const gecko = `https://www.geckoterminal.com/solana/pools/${address}?embed=1&info=0&swaps=0&grayscale=0&light_chart=${dark ? 0 : 1}&chart_type=price&resolution=15m`;
  const dexs = `https://dexscreener.com/solana/${address}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartDefaultOnMobile=1&chartTheme=${dark ? "dark" : "light"}&theme=${dark ? "dark" : "light"}&chartStyle=1&chartType=usd&interval=15`;

  return (
    <div className="stack-sm">
      <div className="spread">
        <div className="seg" role="group" aria-label="Chart source">
          <button type="button" aria-pressed={source === "gecko"} disabled={!links?.gecko} onClick={() => setSource("gecko")} title={links && !links.gecko ? "Not indexed on GeckoTerminal yet" : undefined}>GeckoTerminal</button>
          <button type="button" aria-pressed={source === "dexscreener"} disabled={!links?.dexscreener} onClick={() => setSource("dexscreener")} title={links && !links.dexscreener ? "Not indexed on DexScreener yet" : undefined}>DexScreener</button>
          <button type="button" aria-pressed={source === "trades"} onClick={() => setSource("trades")}>On-chain trades</button>
        </div>
        {source === "gecko" && <a className="tiny muted" href={`https://www.geckoterminal.com/solana/pools/${address}`} target="_blank" rel="noreferrer">Open on GeckoTerminal ↗</a>}
        {source === "dexscreener" && <a className="tiny muted" href={`https://dexscreener.com/solana/${address}`} target="_blank" rel="noreferrer">Open on DexScreener ↗</a>}
      </div>
      {source === null ? (
        <div className="skeleton" style={{ height: 360 }} />
      ) : source === "trades" ? (
        <TradesChart trades={trades} usdPerStock={usdPerStock} />
      ) : (
        <iframe
          key={source + dark}
          title={source === "gecko" ? "GeckoTerminal price chart" : "DexScreener price chart"}
          src={source === "gecko" ? gecko : dexs}
          style={{ width: "100%", height: 420, border: 0, borderRadius: 10, background: "var(--sunk)" }}
          loading="lazy"
          allow="clipboard-write"
        />
      )}
    </div>
  );
}
