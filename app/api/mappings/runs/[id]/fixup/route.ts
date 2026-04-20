import { NextResponse } from "next/server";

import { runFixupOnRun } from "@/lib/bulk-map";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isFinite(runId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const summary = runFixupOnRun(runId);
  return NextResponse.json(summary);
}
