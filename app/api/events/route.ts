import { NextResponse } from "next/server";
import { z } from "zod";

import { createSingleton } from "@/lib/events";

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Body = z.object({
  occurredOn: DateStr,
  description: z.string().min(1),
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
  const row = createSingleton(parsed.data);
  return NextResponse.json({ ok: true, event: row });
}
