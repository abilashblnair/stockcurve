// Display helpers shared by client components.

export function usd(v: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  if (opts.compact && Math.abs(v) >= 10_000) {
    return "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  }
  if (Math.abs(v) >= 1) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: Math.abs(v) < 100 ? 2 : 0 });
  if (v === 0) return "$0";
  return "$" + tiny(v);
}

/** Small prices: 0.0₆1234 style (count of zeros after the point as a subscript). */
export function tiny(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return "–";
  if (v === 0) return "0";
  if (Math.abs(v) >= 0.001) return v.toLocaleString("en-US", { maximumSignificantDigits: digits });
  const s = v.toExponential(digits - 1); // 1.234e-9
  const [m, e] = s.split("e");
  const zeros = -Number(e) - 1;
  const sub = String(zeros).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]).join("");
  return `0.0${sub}${m.replace(".", "").replace("-", "")}`;
}

export function amount(v: number | null | undefined, max = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  if (Math.abs(v) >= 1_000_000) return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);
  if (Math.abs(v) > 0 && Math.abs(v) < 0.0001) return tiny(v);
  return v.toLocaleString("en-US", { maximumFractionDigits: max });
}

export const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${v.toFixed(d)}%` : "–");
export const bps = (v: number) => pct(v / 100, v % 100 === 0 ? 0 : 2);
export const short = (a: string, n = 4) => (a ? `${a.slice(0, n)}…${a.slice(-n)}` : "");

export function ago(unixSec: number | null): string {
  if (!unixSec) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unixSec));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function duration(sec: number): string {
  if (sec <= 0) return "0m";
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const solscan = (kind: "account" | "tx" | "token", id: string) => `https://solscan.io/${kind}/${id}`;
