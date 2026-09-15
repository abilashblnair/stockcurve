import { NextResponse, type NextRequest } from "next/server";
import { buildClaim } from "@/lib/server/trade";
import { fail, limited } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Unsigned claim-trading-fees transaction for the pool's fee claimer and/or creator, simulated. */
export async function POST(req: NextRequest) {
  const stop = limited(req, "claim", 20);
  if (stop) return stop;
  try {
    const { pool, wallet } = (await req.json()) as { pool: string; wallet: string };
    return NextResponse.json(await buildClaim(pool, wallet));
  } catch (e) {
    return fail(e);
  }
}
