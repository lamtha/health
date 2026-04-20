import { NextResponse } from "next/server";

import { HasPendingProposalsError, applyRun } from "@/lib/bulk-map";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isFinite(runId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const url = new URL(req.url);
  const includeUnreviewed = url.searchParams.get("includeUnreviewed") === "true";

  try {
    const result = applyRun(runId, { includeUnreviewed });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof HasPendingProposalsError) {
      return NextResponse.json(
        {
          error: err.message,
          pendingCount: err.pendingCount,
          hint: "Append ?includeUnreviewed=true to apply anyway (treats pending as rejected).",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
