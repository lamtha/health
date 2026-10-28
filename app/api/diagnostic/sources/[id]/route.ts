import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { readDiagnosticReview } from "@/lib/diagnostic-review";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const review = await readDiagnosticReview();
  const source = review?.sources.find(s => s.id === id);
  if (!source) return new Response("Source not found", { status: 404 });
  let bytes: Buffer;
  try { bytes = await fs.readFile(source.path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Response("Original source file is unavailable", { status: 404 }); throw error; }
  if (createHash("sha256").update(bytes).digest("hex") !== source.sha256) return new Response("Source changed since review; verify it before using this citation", { status: 409 });
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": source.format === "csv" ? "text/csv; charset=utf-8" : source.format === "html" ? "text/plain; charset=utf-8" : "application/pdf", "Content-Disposition": `${source.format === "pdf" ? "inline" : "attachment"}; filename="${source.id}.${source.format}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
