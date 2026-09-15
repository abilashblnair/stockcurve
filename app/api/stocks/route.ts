import { NextResponse } from "next/server";
import { allStockInfo } from "@/lib/server/stockInfo";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ stocks: await allStockInfo() });
  } catch (e) {
    return fail(e, 502);
  }
}
