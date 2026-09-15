import { NextResponse, type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { trackPool } from "@/lib/server/indexer";
import { fail, limited } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Called after a launch confirms: puts the pool in the index without waiting for the next scan. */
export async function POST(req: NextRequest) {
  const stop = limited(req, "track", 10);
  if (stop) return stop;
  try {
    const { pool } = (await req.json()) as { pool: string };
    new PublicKey(pool);
    const entry = await trackPool(pool);
    if (!entry) return NextResponse.json({ error: "Not a pool quoted in a supported stock." }, { status: 404 });
    return NextResponse.json(entry);
  } catch (e) {
    return fail(e);
  }
}
