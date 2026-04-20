import fs from "node:fs/promises";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { reports } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = Number(raw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const report = db.select().from(reports).where(eq(reports.id, id)).get();
  if (!report) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(report.filePath);
  } catch {
    return NextResponse.json(
      { error: "source PDF missing" },
      { status: 410 },
    );
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${report.fileHash.slice(0, 12)}.pdf"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
