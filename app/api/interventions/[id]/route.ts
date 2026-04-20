import { NextResponse } from "next/server";
import { z } from "zod";

import {
  changeIntervention,
  deleteIntervention,
  stopIntervention,
} from "@/lib/interventions";

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const PatchBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("stop"),
    stoppedOn: DateStr,
    note: z.string().optional().nullable(),
  }),
  z.object({
    action: z.literal("change"),
    name: z.string().min(1).optional(),
    dose: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    occurredOn: DateStr,
    changeNote: z.string().optional().nullable(),
  }),
]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idRaw } = await params;
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const json = await req.json();
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.action === "stop") {
      const row = stopIntervention({
        id,
        stoppedOn: parsed.data.stoppedOn,
        note: parsed.data.note,
      });
      return NextResponse.json({ ok: true, intervention: row });
    }
    const result = changeIntervention({
      id,
      name: parsed.data.name,
      dose: parsed.data.dose,
      notes: parsed.data.notes,
      occurredOn: parsed.data.occurredOn,
      changeNote: parsed.data.changeNote,
    });
    return NextResponse.json({
      ok: true,
      intervention: result.row,
      eventId: result.eventId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 404 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idRaw } = await params;
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  deleteIntervention(id);
  return NextResponse.json({ ok: true });
}
