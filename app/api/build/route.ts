import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_SETTINGS } from "@/lib/preset";
import { buildLaunch, type BuildRequest } from "@/lib/server/launch";
import { fail, limited } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Builds the unsigned create-config-and-pool transaction and simulates it. Nothing is sent. */
export async function POST(req: NextRequest) {
  const stop = limited(req, "build", 20);
  if (stop) return stop;
  try {
    const body = (await req.json()) as BuildRequest;
    return NextResponse.json(await buildLaunch({ ...body, settings: { ...DEFAULT_SETTINGS, ...body.settings } }));
  } catch (e) {
    return fail(e);
  }
}
