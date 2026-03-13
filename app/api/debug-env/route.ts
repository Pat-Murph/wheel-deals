import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "(not set)",
    origin_header: req.headers.get("origin") ?? "(none)",
    host_header: req.headers.get("host") ?? "(none)",
    referer: req.headers.get("referer") ?? "(none)",
    req_url: req.url,
  });
}
