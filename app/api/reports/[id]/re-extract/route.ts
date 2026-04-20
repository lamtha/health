import { NextResponse } from "next/server";

import { reExtractReport } from "@/lib/re-extract";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = Number(raw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const result = await reExtractReport(id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
