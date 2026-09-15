import { NextResponse, type NextRequest } from "next/server";
import { limited } from "@/lib/server/http";
import { RPC_URL } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

// Browser -> server -> RPC, so the RPC key never ships to the client.
// Only what wallet signing and confirmation need.
const ALLOWED = new Set([
  "getLatestBlockhash", "getBlockHeight", "getSlot", "getHealth", "getVersion", "getEpochInfo",
  "sendTransaction", "simulateTransaction", "getSignatureStatuses",
  "getAccountInfo", "getMultipleAccounts", "getBalance", "getTokenAccountBalance", "getTokenAccountsByOwner",
  "getMinimumBalanceForRentExemption", "getFeeForMessage", "getRecentPrioritizationFees",
]);

export async function POST(req: NextRequest) {
  const stop = limited(req, "rpc", 180);
  if (stop) return stop;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length > 10 || calls.some((c) => !c || typeof c.method !== "string" || !ALLOWED.has(c.method))) {
    return NextResponse.json({ error: "method not allowed" }, { status: 403 });
  }
  const res = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  return new NextResponse(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
}
