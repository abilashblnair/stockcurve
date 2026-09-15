import { NextResponse, type NextRequest } from "next/server";
import { buildTrade, type TradeRequest } from "@/lib/server/trade";
import { fail, limited } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Fresh quote + unsigned transaction + simulation. Nothing is sent. */
export async function POST(req: NextRequest) {
  const stop = limited(req, "trade-build", 30);
  if (stop) return stop;
  try {
    return NextResponse.json(await buildTrade((await req.json()) as TradeRequest));
  } catch (e) {
    return fail(e);
  }
}
