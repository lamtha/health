import { NextResponse } from "next/server";
import { z } from "zod";

import { createIntervention } from "@/lib/interventions";
import { INTERVENTION_KINDS } from "@/lib/interventions-kinds";

const Body = z.object({
  name: z.string().min(1),
  kind: z.enum(INTERVENTION_KINDS),
  dose: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: Request) {
  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const row = createIntervention(parsed.data);
  return NextResponse.json({ ok: true, intervention: row });
}
