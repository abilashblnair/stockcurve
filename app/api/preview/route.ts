import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_SETTINGS, type LaunchSettings } from "@/lib/preset";
import { previewLaunch } from "@/lib/server/launch";
import { fail, limited } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const stop = limited(req, "preview", 240);
  if (stop) return stop;
  try {
    const body = (await req.json()) as Partial<LaunchSettings>;
    return NextResponse.json(await previewLaunch({ ...DEFAULT_SETTINGS, ...body }));
  } catch (e) {
    return fail(e);
  }
}
