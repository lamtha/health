import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { uploadBatches, uploadBatchItems } from "@/db/schema";
import {
  kickBatchRunner,
  listRecentBatches,
  recoverStuckItems,
} from "@/lib/batch-runner";
import { stagePdf } from "@/lib/staging";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const form = await request.formData();
  const entries = form.getAll("files");
  const files = entries.filter((e): e is File => e instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "no files provided" }, { status: 400 });
  }
  for (const f of files) {
    if (f.type && f.type !== "application/pdf") {
      return NextResponse.json(
        { error: `${f.name}: only PDFs are supported` },
        { status: 400 },
      );
    }
  }

  // Stage every file before we enqueue so the Claude call only ever reads
  // from local disk — matches the existing single-upload flow in
  // app/api/upload/route.ts.
  const staged = await Promise.all(
    files.map(async (f) => {
      const bytes = Buffer.from(await f.arrayBuffer());
      const s = await stagePdf({
        originalFilename: f.name || "upload.pdf",
        bytes,
      });
      return s;
    }),
  );

  const batchId = db.transaction((tx) => {
    const [batch] = tx
      .insert(uploadBatches)
      .values({ totalCount: staged.length })
      .returning()
      .all();

    tx.insert(uploadBatchItems)
      .values(
        staged.map((s) => ({
          batchId: batch.id,
          originalFilename: s.originalFilename,
          sizeBytes: s.sizeBytes,
          fileHash: s.fileHash,
          stagingId: s.id,
          status: "queued",
          updatedAt: sql`(CURRENT_TIMESTAMP)`,
        })),
      )
      .run();
    return batch.id;
  });

  // Best-effort recovery of items left behind by a prior process. Bounded
  // by a staleness threshold so we never re-queue an actively-extracting
  // item.
  try {
    const recovered = recoverStuckItems();
    if (recovered > 0) {
      console.warn(`[batch-runner] recovered ${recovered} stuck item(s)`);
    }
  } catch (err) {
    console.error("[batch-runner] recovery failed:", err);
  }

  kickBatchRunner();

  return NextResponse.json({ batchId });
}

export async function GET() {
  return NextResponse.json({ batches: listRecentBatches() });
}
