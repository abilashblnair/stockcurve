"use client";

import { duration, usd } from "@/lib/format";

type Pt = { x: number; y: number };

const W = 560;
const H = 220;
const PAD = { l: 58, r: 14, t: 14, b: 34 };

const axisUsd = (v: number) =>
  v === 0 ? "$0" : v >= 1000 ? "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v) : v >= 1 ? "$" + Math.round(v) : usd(v);

function scale(points: Pt[], h = H) {
  const xMax = Math.max(...points.map((p) => p.x), 1e-12);
  const yMax = Math.max(...points.map((p) => p.y), 1e-12);
  const yMin = 0;
  const sx = (x: number) => PAD.l + (x / xMax) * (W - PAD.l - PAD.r);
  const sy = (y: number) => h - PAD.b - ((y - yMin) / (yMax - yMin)) * (h - PAD.t - PAD.b);
  return { xMax, yMax, sx, sy };
}

function paths(points: Pt[], sx: (x: number) => number, sy: (y: number) => number) {
  const line = points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const area = `${line} L${sx(points.at(-1)!.x).toFixed(1)},${sy(0)} L${sx(points[0].x).toFixed(1)},${sy(0)} Z`;
  return { line, area };
}

/** Market cap (USD) against USD raised into the curve, with an optional "now" marker. */
export function CurveChart({
  points,
  supply,
  usdPerStock,
  stockSymbol,
  current,
  label = "Curve",
}: {
  points: { raised: number; price: number }[];
  supply: number;
  usdPerStock: number;
  stockSymbol: string;
  current?: number | null; // stock raised so far
  label?: string;
}) {
  if (points.length < 2) return null;
  const pts = points.map((p) => ({ x: p.raised * usdPerStock, y: p.price * supply * usdPerStock }));
  const { xMax, yMax, sx, sy } = scale(pts);
  const { line, area } = paths(pts, sx, sy);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  let marker: Pt | null = null;
  if (current !== null && current !== undefined) {
    const x = Math.min(current * usdPerStock, xMax);
    const after = pts.findIndex((p) => p.x >= x);
    if (after <= 0) marker = pts[0];
    else {
      const a = pts[after - 1];
      const b = pts[after];
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      marker = { x, y: a.y + (b.y - a.y) * t };
    }
  }
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: market cap from ${usd(pts[0].y, { compact: true })} to ${usd(yMax, { compact: true })} as ${usd(xMax, { compact: true })} of ${stockSymbol} is raised`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={sy(yMax * t)} y2={sy(yMax * t)} />
            <text x={PAD.l - 8} y={sy(yMax * t) + 4} textAnchor="end">{axisUsd(yMax * t)}</text>
            <text x={sx(xMax * t)} y={H - PAD.b + 18} textAnchor={t === 0 ? "start" : t === 1 ? "end" : "middle"}>{axisUsd(xMax * t)}</text>
          </g>
        ))}
        <line className="axis" x1={PAD.l} x2={W - PAD.r} y1={sy(0)} y2={sy(0)} />
        <path className="area" d={area} />
        <path className="line" d={line} />
        {marker && (
          <g>
            <line className="guide" x1={sx(marker.x)} x2={sx(marker.x)} y1={PAD.t} y2={sy(0)} />
            <circle className="mark" cx={sx(marker.x)} cy={sy(marker.y)} r={5} />
          </g>
        )}
      </svg>
      <figcaption className="tiny muted spread" style={{ marginTop: 2 }}>
        <span>↑ market cap (USD)</span>
        <span>{stockSymbol} raised, in USD →</span>
      </figcaption>
    </figure>
  );
}

/** Base fee (%) over the opening window. */
export function FeeChart({ points, nowSec }: { points: { t: number; bps: number }[]; nowSec?: number | null }) {
  if (points.length < 2) return null;
  const h = 160;
  const pts = points.map((p) => ({ x: p.t, y: p.bps / 100 }));
  const { xMax, yMax, sx, sy } = scale(pts, h);
  // Step line: the fee changes once per period, not continuously.
  const step = pts.map((p, i) => (i === 0 ? `M${sx(p.x)},${sy(p.y)}` : `H${sx(p.x)} V${sy(p.y)}`)).join(" ");
  const now = nowSec !== null && nowSec !== undefined ? Math.min(nowSec, xMax) : null;
  const ticks = [0, 0.5, 1];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${h}`} role="img" aria-label={`Fee falls from ${pts[0].y}% to ${pts.at(-1)!.y}% over ${duration(xMax)}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={sy(yMax * t)} y2={sy(yMax * t)} />
          <text x={PAD.l - 8} y={sy(yMax * t) + 4} textAnchor="end">{(yMax * t).toFixed(yMax < 5 ? 2 : 0)}%</text>
        </g>
      ))}
      <line className="axis" x1={PAD.l} x2={W - PAD.r} y1={sy(0)} y2={sy(0)} />
      <path className="line" d={step} />
      {now !== null && <line className="guide" x1={sx(now)} x2={sx(now)} y1={PAD.t} y2={sy(0)} />}
      <text x={PAD.l} y={h - PAD.b + 18} textAnchor="start">0</text>
      <text x={W - PAD.r} y={h - PAD.b + 18} textAnchor="end">{duration(xMax)}</text>
    </svg>
  );
}
