import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { dbPath } from "@/lib/paths";

const Source = z.object({ id: z.string(), title: z.string(), path: z.string(), filename: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), format: z.enum(["pdf", "csv", "html"]).default("pdf"), pages: z.number().int().positive().nullable(), recordCount: z.number().int().min(2).optional(), reportId: z.number().int().nullable() });
const MedicationRecord = z.object({ name: z.string(), lastLoggedAt: z.string().nullable(), amount: z.string(), unit: z.string(), instructions: z.string(), timedLogs: z.number().int().nonnegative(), records: z.array(z.number().int().min(2)).min(1) });
const Answer = z.object({ recordedOn: z.string(), source: z.string(), verbatim: z.string(), summary: z.string() });
const AssessmentItem = z.object({ title: z.string(), detail: z.string(), factIds: z.array(z.string()).min(1) });
const Assessment = z.object({
  asOf: z.string(), summary: z.string(), uncertainty: z.string(),
  explanations: z.array(z.object({ id: z.string(), title: z.string(), level: z.string(), support: z.string(), limits: z.string(), nextStep: z.string(), factIds: z.array(z.string()).min(1) })).min(1),
  otherConsiderations: z.array(AssessmentItem), nextSteps: z.array(z.string()), questionIds: z.array(z.string()), referenceUrls: z.array(z.string().url()),
});
export const DiagnosticReview = z.object({
  schemaVersion: z.literal(1), title: z.string(), createdOn: z.string(), updatedOn: z.string(), status: z.string(), scope: z.string(),
  inventory: z.object({ databaseReports: z.number(), databaseMetrics: z.number(), archivePdfFiles: z.number(), uniqueArchivePdfs: z.number(), exactMatchedFiles: z.number(), unmatchedFiles: z.number(), latestDatabaseReportDate: z.string(), databaseWrites: z.literal(0), note: z.string() }),
  sources: z.array(Source),
  assessment: Assessment.optional(),
  tracking: z.object({ sourceId: z.string(), dataRecords: z.number().int(), timedTrackingRecords: z.number().int(), daysWithEntries: z.number().int(), firstDate: z.string(), lastDate: z.string(), note: z.string(), byMonth: z.array(z.object({ month: z.string(), records: z.number().int(), days: z.number().int(), categories: z.record(z.string(), z.number().int()) })) }).optional(),
  medications: z.object({ sourceId: z.string(), asOf: z.string(), note: z.string(), recent: z.array(MedicationRecord), earlier: z.array(MedicationRecord) }).optional(),
  facts: z.array(z.object({ id: z.string(), group: z.string(), kind: z.string(), date: z.string(), statement: z.string(), boundary: z.string(), interviewQuestionIds: z.array(z.string()).default([]), sources: z.array(z.object({ sourceId: z.string(), pages: z.array(z.number().int().positive()), records: z.array(z.number().int().min(2)).default([]) })) })),
  questions: z.array(z.object({ id: z.string(), phase: z.string(), status: z.enum(["partial", "asked", "planned", "answered"]), askedOn: z.string().nullable(), question: z.string(), answers: z.array(Answer) })),
  unmatchedReports: z.array(z.object({ filename: z.string(), path: z.string(), sha256: z.string(), priority: z.string(), note: z.string() })),
  gaps: z.array(z.string()), dataIssues: z.array(z.object({ title: z.string(), detail: z.string(), action: z.string() })), approach: z.array(z.string()),
  references: z.array(z.object({ title: z.string(), url: z.string().url(), use: z.string() })),
}).superRefine((review, ctx) => {
  const sources = new Map(review.sources.map(s => [s.id, s]));
  for (const source of review.sources) {
    if ((source.format === "pdf" && source.pages === null) || (source.format !== "pdf" && (source.pages !== null || !source.recordCount))) ctx.addIssue({ code: "custom", message: `Invalid source dimensions for ${source.id}` });
  }
  const questions = new Set(review.questions.map(q => q.id));
  if (review.assessment) {
    const facts = new Set(review.facts.map(f => f.id));
    const references = new Set(review.references.map(r => r.url));
    const items = [...review.assessment.explanations, ...review.assessment.otherConsiderations];
    if (items.some(item => item.factIds.some(id => !facts.has(id)))) ctx.addIssue({ code: "custom", message: "Invalid assessment fact reference" });
    if (review.assessment.questionIds.some(id => !questions.has(id))) ctx.addIssue({ code: "custom", message: "Invalid assessment question reference" });
    if (review.assessment.referenceUrls.some(url => !references.has(url))) ctx.addIssue({ code: "custom", message: "Invalid assessment guidance reference" });
  }
  for (const fact of review.facts) {
    if (fact.interviewQuestionIds.some(id => !questions.has(id))) ctx.addIssue({ code: "custom", message: `Invalid interview reference in ${fact.id}` });
  }
  if (review.tracking && sources.get(review.tracking.sourceId)?.format !== "csv") ctx.addIssue({ code: "custom", message: "Tracking source must be a CSV" });
  if (review.medications) {
    const source = sources.get(review.medications.sourceId);
    if (source?.format !== "csv" || [...review.medications.recent, ...review.medications.earlier].some(m => m.records.some(record => record > (source.recordCount ?? 0)))) ctx.addIssue({ code: "custom", message: "Invalid medication source reference" });
  }
  for (const fact of review.facts) for (const ref of fact.sources) {
    const source = sources.get(ref.sourceId);
    if (!source || (source.format === "pdf" ? (!ref.pages.length || ref.records.length > 0 || ref.pages.some(page => page > (source.pages ?? 0))) : (ref.pages.length > 0 || ref.records.some(record => record > (source.recordCount ?? 0))))) ctx.addIssue({ code: "custom", message: `Invalid source reference in ${fact.id}` });
  }
  for (const question of review.questions) {
    if (question.status === "answered" && question.answers.length === 0) ctx.addIssue({ code: "custom", message: `Answered question ${question.id} has no answer` });
  }
});
export type DiagnosticReview = z.infer<typeof DiagnosticReview>;

// A clinician-review document, kept in per-user files, separate from imported
// lab records. This reader never opens or writes the SQLite database.
export async function readDiagnosticReview(): Promise<DiagnosticReview | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(path.dirname(dbPath()), "gi-diagnostic-review.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return DiagnosticReview.parse(JSON.parse(raw));
}
