import { NextResponse } from "next/server";

import { getBatch } from "@/lib/batch-runner";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const batchId = Number(id);
  if (!Number.isFinite(batchId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const batch = getBatch(batchId);
  if (!batch) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ batch });
}
