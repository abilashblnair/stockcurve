import { NextResponse, type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { balances } from "@/lib/server/trade";
import { fail, limited } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** SOL, USDC, quote stock and pool token balances for one wallet. */
export async function GET(req: NextRequest) {
  const stop = limited(req, "balances", 60);
  if (stop) return stop;
  const wallet = req.nextUrl.searchParams.get("wallet") ?? "";
  const pool = req.nextUrl.searchParams.get("pool") ?? "";
  try {
    new PublicKey(wallet);
    new PublicKey(pool);
    return NextResponse.json(await balances(wallet, pool));
  } catch (e) {
    return fail(e);
  }
}
