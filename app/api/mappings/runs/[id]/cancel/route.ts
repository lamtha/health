import { NextResponse } from "next/server";

import { cancelRun } from "@/lib/bulk-map";

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
  const canceled = cancelRun(runId);
  if (!canceled) {
    return NextResponse.json(
      { error: "run is not cancelable (only queued/proposing runs can be canceled)" },
      { status: 409 },
    );
  }
  return NextResponse.json({ canceled: true });
}
