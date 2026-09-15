import { NextResponse, type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { recentTrades } from "@/lib/server/pool";
import { fail, limited } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Recent swaps, decoded from the DBC program's own events. Loaded after the snapshot. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const stop = limited(req, "trades", 60);
  if (stop) return stop;
  const { address } = await params;
  try {
    new PublicKey(address);
    return NextResponse.json(await recentTrades(address));
  } catch (e) {
    return fail(e, 502);
  }
}
