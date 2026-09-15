import { NextResponse, type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { chartData, type Timeframe } from "@/lib/server/chart";
import { fail, limited } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** USD candles: GeckoTerminal (following graduation to DAMM v2) or built from on-chain swaps. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const stop = limited(req, "chart", 60);
  if (stop) return stop;
  const { address } = await params;
  try {
    new PublicKey(address);
    const tf = (req.nextUrl.searchParams.get("tf") ?? "15m") as Timeframe;
    return NextResponse.json(await chartData(address, tf));
  } catch (e) {
    return fail(e, 502);
  }
}
