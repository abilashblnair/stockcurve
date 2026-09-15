import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { marketLinks } from "@/lib/server/pool";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Which external chart sources (GeckoTerminal, DexScreener) have indexed this pool. */
export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  try {
    new PublicKey(address);
    return NextResponse.json(await marketLinks(address));
  } catch (e) {
    return fail(e);
  }
}
