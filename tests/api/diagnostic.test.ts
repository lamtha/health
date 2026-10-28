import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { readDiagnosticReview } from "@/lib/diagnostic-review";
import { GET as sourceGet } from "@/app/api/diagnostic/sources/[id]/route";
import { GET as exportGet } from "@/app/api/diagnostic/export/route";

const base = process.env.HEALTH_USER_DATA_DIR!;
const dataFile = path.join(base, "data", "gi-diagnostic-review.json");
const pdfFile = path.join(base, "source.pdf");
const pdf = Buffer.from("%PDF-1.4 test fixture");
function fixture() {
  return {
    schemaVersion: 1, title: "Test review", createdOn: "2026-10-27", updatedOn: "2026-10-27", status: "In progress", scope: "Synthetic fixture",
    inventory: { databaseReports: 0, databaseMetrics: 0, archivePdfFiles: 1, uniqueArchivePdfs: 1, exactMatchedFiles: 0, unmatchedFiles: 1, latestDatabaseReportDate: "2026-01-01", databaseWrites: 0, note: "Synthetic" },
    sources: [{ id: "S01", title: "Test source", path: pdfFile, filename: "source.pdf", sha256: createHash("sha256").update(pdf).digest("hex"), pages: 1, reportId: null }],
    facts: [{ id: "F01", group: "Tests", kind: "Measured result", date: "2026-01-01", statement: "Value >750", boundary: "A bound, not an exact number", sources: [{ sourceId: "S01", pages: [1] }] }],
    questions: [{ id: "Q01", phase: "Symptoms", status: "partial", askedOn: "2026-10-27", question: "Any warning symptoms?", answers: [{ recordedOn: "2026-10-27", source: "Patient", verbatim: "Bloating", summary: "Warning symptoms not answered" }] }],
    unmatchedReports: [], gaps: ["Unanswered is not absent"], dataIssues: [], approach: [], references: [],
  };
}
async function save(value: unknown = fixture()) {
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(value));
  await fs.writeFile(pdfFile, pdf);
}
afterEach(async () => { await fs.rm(dataFile, { force: true }); await fs.rm(pdfFile, { force: true }); });
describe("file-backed diagnostic review", () => {
  it("has an honest empty state and never creates a database", async () => {
    expect(await readDiagnosticReview()).toBeNull();
    expect((await exportGet()).status).toBe(404);
    await expect(fs.access(path.join(base, "data", "health.db"))).rejects.toThrow();
  });
  it("retains a partial answer verbatim without inferring absence", async () => {
    await save();
    const review = await readDiagnosticReview();
    expect(review?.questions[0].status).toBe("partial");
    expect(review?.questions[0].answers[0].verbatim).toBe("Bloating");
    expect(review?.facts[0].statement).toContain(">750");
    const exported = await exportGet();
    expect(exported.headers.get("Cache-Control")).toContain("no-store");
    expect((await exported.json()).questions[0].status).toBe("partial");
  });
  it("exports interpretations separately and rejects unsupported assessment citations", async () => {
    const value = { ...fixture(), references: [{ title: "Synthetic guidance", url: "https://example.org/guidance", use: "Test" }], assessment: {
      asOf: "2026-10-27", summary: "A working hypothesis", uncertainty: "Not a diagnosis",
      explanations: [{ id: "H01", title: "Possible mechanism", level: "Uncertain", support: "A cited observation", limits: "Not proven", nextStep: "Discuss", factIds: ["F01"] }],
      otherConsiderations: [], nextSteps: [], questionIds: ["Q01"], referenceUrls: ["https://example.org/guidance"],
    } };
    await save(value);
    const exported = await (await exportGet()).json();
    expect(exported.assessment).toEqual(value.assessment);
    expect(exported.facts).toHaveLength(1);
    expect(exported.questions[0].answers[0].verbatim).toBe("Bloating");
    value.assessment.explanations[0].factIds = ["F99"];
    await save(value);
    await expect(readDiagnosticReview()).rejects.toThrow("Invalid assessment fact reference");
    value.assessment.explanations[0].factIds = ["F01"];
    value.assessment.questionIds = ["Q99"];
    await save(value);
    await expect(readDiagnosticReview()).rejects.toThrow("Invalid assessment question reference");
    value.assessment.questionIds = ["Q01"];
    value.assessment.referenceUrls = ["https://example.org/uncited"];
    await save(value);
    await expect(readDiagnosticReview()).rejects.toThrow("Invalid assessment guidance reference");
  });
  it("serves only a cited source with matching bytes and rejects arbitrary paths", async () => {
    await save();
    const response = await sourceGet(new Request("http://localhost/api/diagnostic/sources/S01"), { params: Promise.resolve({ id: "S01" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf);
    const arbitrary = await sourceGet(new Request("http://localhost"), { params: Promise.resolve({ id: "../../secrets" }) });
    expect(arbitrary.status).toBe(404);
    await fs.writeFile(pdfFile, "%PDF changed");
    expect((await sourceGet(new Request("http://localhost"), { params: Promise.resolve({ id: "S01" }) })).status).toBe(409);
  });
  it("serves CSV sources as downloads and validates logical record citations", async () => {
    const value = fixture();
    const csvValue = { ...value, sources: [{ ...value.sources[0], format: "csv", pages: null, recordCount: 3 }], facts: [{ ...value.facts[0], sources: [{ sourceId: "S01", pages: [], records: [3] }] }] };
    await save(csvValue);
    const response = await sourceGet(new Request("http://localhost"), { params: Promise.resolve({ id: "S01" }) });
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="S01.csv"');
    csvValue.facts[0].sources[0].records = [4];
    await save(csvValue);
    await expect(readDiagnosticReview()).rejects.toThrow("Invalid source reference");
  });
  it("downloads HTML source bytes without rendering active content and validates row citations", async () => {
    const value = fixture();
    const html = Buffer.from('<table><tr><th>Header</th></tr><tr><td>Entry</td></tr></table><script>alert(1)</script>');
    const htmlValue = { ...value, sources: [{ ...value.sources[0], format: "html", pages: null, recordCount: 2, sha256: createHash("sha256").update(html).digest("hex") }], facts: [{ ...value.facts[0], sources: [{ sourceId: "S01", pages: [], records: [2] }] }] };
    await save(htmlValue);
    await fs.writeFile(pdfFile, html);
    const response = await sourceGet(new Request("http://localhost"), { params: Promise.resolve({ id: "S01" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="S01.html"');
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(html);
    htmlValue.facts[0].sources[0].records = [3];
    await save(htmlValue);
    await expect(readDiagnosticReview()).rejects.toThrow("Invalid source reference");
    htmlValue.facts[0].sources[0].records = [2];
    await save({ ...htmlValue, sources: [{ ...htmlValue.sources[0], recordCount: undefined }] });
    await expect(readDiagnosticReview()).rejects.toThrow("Invalid source dimensions");
  });
  it("rejects medication records with unsupported source citations", async () => {
    const value = fixture();
    await save({ ...value, sources: [{ ...value.sources[0], format: "csv", pages: null, recordCount: 3 }], facts: [], medications: { sourceId: "S01", asOf: "2026-10-27", note: "Synthetic", recent: [{ name: "Synthetic medication", lastLoggedAt: null, amount: "", unit: "", instructions: "", timedLogs: 0, records: [4] }], earlier: [] } });
    await expect(readDiagnosticReview()).rejects.toThrow("Invalid medication source reference");
  });
  it("rejects interview citations that do not exist", async () => {
    const value = fixture();
    await save({ ...value, facts: [{ ...value.facts[0], interviewQuestionIds: ["Q99"] }] });
    await expect(readDiagnosticReview()).rejects.toThrow("Invalid interview reference");
  });
  it("surfaces invalid citation pages instead of displaying an unsupported claim", async () => {
    const value = fixture(); value.facts[0].sources[0].pages = [2]; await save(value);
    await expect(readDiagnosticReview()).rejects.toThrow("Invalid source reference");
  });
});
