import "server-only";
import { NextResponse, type NextRequest } from "next/server";

// Fixed-window per-IP limits. One process, so memory is enough.
const hits = new Map<string, { at: number; n: number }>();

export function limited(req: NextRequest, bucket: string, perMinute: number): NextResponse | null {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.at > 60_000) {
    hits.set(key, { at: now, n: 1 });
    if (hits.size > 20_000) for (const [k, v] of hits) if (now - v.at > 60_000) hits.delete(k);
    return null;
  }
  h.n++;
  if (h.n > perMinute) return NextResponse.json({ error: "Too many requests, slow down a little." }, { status: 429 });
  return null;
}

export function fail(e: unknown, status = 400) {
  const message = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: message }, { status });
}
