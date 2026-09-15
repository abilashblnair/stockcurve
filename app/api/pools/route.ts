import { NextResponse } from "next/server";
import { poolIndex } from "@/lib/server/indexer";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(poolIndex());
}
