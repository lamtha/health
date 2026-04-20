import { NextResponse } from "next/server";

import { listProposals, type ListProposalsFilter } from "@/lib/bulk-map";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isFinite(runId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const url = new URL(req.url);
  const filter: ListProposalsFilter = {};
  const action = url.searchParams.get("action");
  if (
    action === "map_existing" ||
    action === "create_new" ||
    action === "skip"
  ) {
    filter.action = action;
  }
  const status = url.searchParams.get("status");
  if (
    status === "pending" ||
    status === "approved" ||
    status === "rejected" ||
    status === "applied" ||
    status === "apply_error"
  ) {
    filter.status = status;
  }
  const minConf = url.searchParams.get("minConfidence");
  if (minConf != null) {
    const n = Number(minConf);
    if (Number.isFinite(n)) filter.minConfidence = n;
  }

  return NextResponse.json({ proposals: listProposals(runId, filter) });
}
