import { NextResponse } from "next/server";

import { PatchProposalBody, patchProposal } from "@/lib/bulk-map";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; pid: string }> },
) {
  const { pid } = await params;
  const proposalId = Number(pid);
  if (!Number.isFinite(proposalId)) {
    return NextResponse.json({ error: "invalid proposal id" }, { status: 400 });
  }

  const json = await request.json().catch(() => ({}));
  const parsed = PatchProposalBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const updated = patchProposal(proposalId, parsed.data);
    if (!updated) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ proposal: updated });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
