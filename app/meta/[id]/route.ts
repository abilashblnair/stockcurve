import { NextResponse } from "next/server";
import { readDocument } from "@/lib/server/metadata";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = readDocument(id.replace(/\.json$/, ""));
  if (!body) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(body, {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" },
  });
}
