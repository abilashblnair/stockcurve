import { NextResponse, type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { poolSnapshot, type PoolSnapshot } from "@/lib/server/pool";
import { fail, limited } from "@/lib/server/http";

/** What an agent wallet can claim, derived from the snapshot. No extra RPC. */
function forWallet(snap: PoolSnapshot, wallet: string) {
  const me = new PublicKey(wallet).toBase58();
  const isFeeClaimer = me === snap.feeClaimer;
  const isCreator = me === snap.creator;
  const claimable = (isFeeClaimer ? snap.unclaimed.partner : 0) + (isCreator ? snap.unclaimed.creator : 0);
  const usd = snap.stock.usd;
  const sharePct = (isFeeClaimer ? snap.fees.partnerPct : 0) + (isCreator ? snap.fees.creatorPct : 0);
  return {
    wallet: me,
    isFeeClaimer,
    isCreator,
    claimable,
    claimableUsd: usd == null ? null : claimable * usd,
    paidIn: snap.stock.symbol,
    sharePct,
    note: isFeeClaimer || isCreator
      ? `This wallet can claim ${sharePct}% of trading fees, paid in ${snap.stock.symbol}. Meteora keeps the protocol share.`
      : `This wallet cannot claim. Fees in ${snap.stock.symbol} go to the fee claimer and the creator.`,
  };
}

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
    const snap = await poolSnapshot(address, req.nextUrl.searchParams.get("fresh") === "1");
    if (!snap) return NextResponse.json({ error: "No DBC pool at this address." }, { status: 404 });
    const wallet = req.nextUrl.searchParams.get("wallet");
    if (!wallet) return NextResponse.json(snap);
    try {
      new PublicKey(wallet);
    } catch {
      return NextResponse.json({ error: "wallet is not a Solana address." }, { status: 400 });
    }
    return NextResponse.json({ ...snap, forWallet: forWallet(snap, wallet) });
  } catch (e) {
    return fail(e, 502);
  }
}
