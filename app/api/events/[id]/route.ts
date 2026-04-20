import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteEvent, updateSingleton } from "@/lib/events";

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const PatchBody = z.object({
  occurredOn: DateStr.optional(),
  description: z.string().min(1).optional(),
});

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
  const row = updateSingleton({ id, ...parsed.data });
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, event: row });
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
  deleteEvent(id);
  return NextResponse.json({ ok: true });
}
