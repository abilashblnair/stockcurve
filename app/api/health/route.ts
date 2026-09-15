import { NextResponse } from "next/server";
import { connection } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

/** Container health check: the RPC answers. */
export async function GET() {
  try {
    const slot = await Promise.race([connection.getSlot(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000))]);
    return NextResponse.json({ ok: true, slot });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
