import { readDiagnosticReview } from "@/lib/diagnostic-review";
export const dynamic = "force-dynamic";
export async function GET() {
  const review = await readDiagnosticReview();
  if (!review) return new Response("No diagnostic review found", { status: 404 });
  return new Response(JSON.stringify(review, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="gi-diagnostic-review.json"', "Cache-Control": "private, no-store" } });
}
