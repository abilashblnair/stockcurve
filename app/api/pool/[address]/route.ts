import { NextResponse, type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { poolSnapshot } from "@/lib/server/pool";
import { fail, limited } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const stop = limited(req, "pool", 90);
  if (stop) return stop;
  const { address } = await params;
  try {
    new PublicKey(address);
  } catch {
    return NextResponse.json({ error: "Not a Solana address." }, { status: 400 });
  }
  try {
    const snap = await poolSnapshot(address);
    if (!snap) return NextResponse.json({ error: "No DBC pool at this address." }, { status: 404 });
    return NextResponse.json(snap);
  } catch (e) {
    return fail(e, 502);
  }
}
