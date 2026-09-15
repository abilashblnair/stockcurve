import { NextResponse, type NextRequest } from "next/server";
import bs58 from "bs58";
import { limited } from "@/lib/server/http";
import { RPC_URL } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

// Broadcast a signed transaction through more than one RPC. A single
// non-staked endpoint drops transactions under load; sending the same bytes
// to several paths (and re-sending until confirmed) is what makes them land.
const EXTRA_RPCS = (process.env.SEND_RPCS ?? "https://api.mainnet-beta.solana.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export async function POST(req: NextRequest) {
  const stop = limited(req, "send", 120);
  if (stop) return stop;
  let tx: string;
  try {
    tx = String(((await req.json()) as { tx?: string }).tx ?? "");
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const bytes = Buffer.from(tx, "base64");
  if (bytes.length < 100 || bytes.length > 1232) return NextResponse.json({ error: "not a transaction" }, { status: 400 });
  // First signature = transaction id (after the compact-u16 signature count).
  const sig = bytes.subarray(1, 65);
  if (bytes[0] < 1 || sig.every((b) => b === 0)) return NextResponse.json({ error: "transaction is not signed" }, { status: 400 });
  const signature = bs58.encode(sig);

  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [tx, { encoding: "base64", skipPreflight: true, maxRetries: 0 }] });
  const results = await Promise.allSettled(
    [RPC_URL, ...EXTRA_RPCS].map(async (url) => {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(5000), cache: "no-store" });
      const j = (await r.json()) as { result?: string; error?: { message?: string } };
      if (j.error) throw new Error(j.error.message ?? "rpc error");
      return j.result;
    }),
  );
  const accepted = results.filter((r) => r.status === "fulfilled").length;
  if (!accepted) {
    const reason = results.map((r) => (r.status === "rejected" ? String(r.reason?.message ?? r.reason) : "")).find(Boolean);
    return NextResponse.json({ error: reason ?? "no RPC accepted the transaction", signature }, { status: 502 });
  }
  return NextResponse.json({ signature, accepted });
}
