import { NextResponse, type NextRequest } from "next/server";
import { quoteTrade, type TradeRequest } from "@/lib/server/trade";
import { fail, limited } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const stop = limited(req, "trade-quote", 120);
  if (stop) return stop;
  try {
    return NextResponse.json(await quoteTrade((await req.json()) as TradeRequest));
  } catch (e) {
    return fail(e);
  }
}
