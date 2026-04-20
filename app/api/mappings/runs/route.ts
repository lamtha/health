import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createMappingRun,
  kickMappingRunner,
  listRuns,
  recoverStuckMappingRuns,
} from "@/lib/bulk-map";

export const runtime = "nodejs";
export const maxDuration = 300;

const PostBody = z
  .object({
    limit: z.number().int().positive().optional(),
    batchSize: z.number().int().positive().max(200).optional(),
    model: z.string().optional(),
  })
  .default({});

export async function POST(request: Request) {
  const json = await request.json().catch(() => ({}));
  const parsed = PostBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const recovered = recoverStuckMappingRuns();
    if (recovered > 0) {
      console.warn(`[bulk-map] recovered ${recovered} stuck run(s)`);
    }
  } catch (err) {
    console.error("[bulk-map] recovery failed:", err);
  }

  const created = createMappingRun(parsed.data);
  kickMappingRunner();
  return NextResponse.json(created, { status: 202 });
}

export async function GET() {
  return NextResponse.json({ runs: listRuns() });
}
