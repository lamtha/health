import { NextResponse } from "next/server";

import { getRun } from "@/lib/bulk-map";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isFinite(runId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const run = getRun(runId);
  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ run });
}
