import { NextResponse } from "next/server";

import { getExtractionRaw } from "@/lib/report-detail";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string; extractionId: string }> },
) {
  const { id: rawId, extractionId: rawExt } = await ctx.params;
  const reportId = Number(rawId);
  const extractionId = Number(rawExt);
  if (!Number.isFinite(reportId) || !Number.isFinite(extractionId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const raw = getExtractionRaw(reportId, extractionId);
  if (raw == null) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return new NextResponse(JSON.stringify(raw, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
