import { NextResponse, type NextRequest } from "next/server";
import { buildDocument, publicBase, storeDocument, type MetadataInput } from "@/lib/server/metadata";
import { fail, limited } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Stores the token's metadata document and returns the URL to write on chain. */
export async function POST(req: NextRequest) {
  const stop = limited(req, "metadata", 20);
  if (stop) return stop;
  try {
    const doc = buildDocument((await req.json()) as MetadataInput);
    if (!doc.name || !doc.symbol) throw new Error("Name and ticker are required.");
    const id = storeDocument(doc);
    return NextResponse.json({ uri: `${publicBase(req.nextUrl.origin)}/meta/${id}`, document: doc });
  } catch (e) {
    return fail(e);
  }
}
