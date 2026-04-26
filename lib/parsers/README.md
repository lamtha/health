# Adding a deterministic parser

A pragmatic playbook for the next provider parser (LabCorp, Quest, Genova, …). Reflects what we learned shipping GI-MAP v2.

> Read this before building. Then read `gimap/` as a worked example. The header comments in `gimap/parse.ts` and `gimap/sections.ts` show the patterns in real use.

## What "done" looks like

- Detects its own format narrowly enough not to claim other PDFs.
- Captures every metric the format reports **that has actual data** — same canonical mapping as Claude's output, values within ~5%.
- Returns a Zod-validated `ExtractedReport` shape (`provider`, `category`, `reportDate`, `metrics`).
- Throws if its own output is implausibly small so the dispatcher falls back to Claude.
- Survives layout drift between vintages of the same provider's report.
- Has fixture-driven unit tests in `tests/unit/parsers/<provider>-{detect,parse}.test.ts`.

The bar is **fewer-correct-rows over more-garbled-rows**. Don't chase byte-identical match with Claude.

---

## Quick-start

1. Pick the provider, find 2+ representative PDFs in `~/Documents/health/reports/paul/<category>/`. Confirm at least one Claude-extracted record exists in the DB so you have a ground truth (`SELECT id FROM extractions WHERE …`).
2. Throwaway script: extract the PDF text via `extractPdfText` from `lib/parsers/pdf-text.ts` and dump it. Look at the structure. Write a `peek-line.ts`-style helper if you need to grep specific lines with surrounding context. **Delete these helpers when you're done — they're not part of the deliverable.**
3. Sketch the section list. PDF section headers are usually all-caps; data rows are Title Case. This case difference matters (see §"Pitfalls" below).
4. Build the modules under `lib/parsers/<name>/`:
   - `index.ts` — exports `name`, `version`, `detect`, `parseText`, `parsePdf`.
   - `detect.ts` — narrow signature detection.
   - `sections.ts` — section header patterns, noise-line filters, umbrella banners.
   - `rows.ts` — token classification, value/range parsing, flag stripping.
   - `parse.ts` — the state machine and `parseText`.
5. Register in `lib/parsers/index.ts`'s `PARSERS` array.
6. Sanitize a couple of real PDFs to text fixtures under `tests/fixtures/<name>/` (redact patient name, DOB, accession, ordered-by, address). Add `tests/unit/parsers/<name>-{detect,parse}.test.ts` with assertions for the metrics you care about.
7. `pnpm compare-extract <pdf-path-or-report-id>` against a Claude-extracted ground truth. Iterate.
8. Bump `version` in `index.ts` whenever parser rules meaningfully change. The `extractor_version` column lets us re-extract reports parsed by an older parser.

---

## The contract

```ts
// lib/parsers/index.ts
export interface DeterministicParser {
  name: string;
  version: number;
  detect: (text: string) => boolean;
  parseText: (text: string) => ExtractedReport;
}
```

The dispatcher (`tryDeterministicExtract`) hands every parser the PDF text. The first parser whose `detect` returns true wins; its `parseText` runs. If `parseText` throws, the dispatcher falls back to Claude.

`parseText` returns the same `ExtractedReport` shape as `lib/extract.ts`. Re-validate with `ExtractedReport.parse(...)` before returning so a regression fails loud.

---

## Lessons from GI-MAP

### pdfjs-dist quirks

- **Bold text renders twice** — same glyph drawn at slight x-offset for emphasis. `pdf-text.ts` does a position-keyed dedupe (round x, y to ints) and a within-row consecutive-string dedupe to collapse them. Without this you get `"Bacteroides fragilis Bacteroides fragilis 1.07e10 1.07e10 …"`.
- **Y-tolerance is a tradeoff.** Too tight → row pieces split across "lines". Too loose → adjacent rows merge. `Y_TOLERANCE=4` worked for GI-MAP. If your provider has tighter line spacing, tune.
- **Some logical rows don't share a Y position.** Page-8 Caproate had value at Y=A, label at Y=B, range at Y=C — three separate "lines" in pdfjs's view. Fix this in the parser, not by widening Y_TOLERANCE further (which causes worse merge problems elsewhere).
- **Large X-gap → tab.** `pdf-text.ts` inserts a `\t` between text items separated by more than `COLUMN_GAP_PX`. Real columns become real separators downstream.
- **Next.js bundling fails pdfjs-dist.** It throws `Object.defineProperty called on non-object` if webpack tries to bundle the legacy build. Already handled in `next.config.js`'s `serverExternalPackages: ["pdfjs-dist"]`. Don't undo it.

### Detection: narrow but resilient

- Brand names live in **logo images**, not text. Don't search for the brand. We searched for `"GI-MAP"` for hours and found zero matches before realizing.
- Combine 2-3 signature checks. For GI-MAP: `"Diagnostic Solutions Laboratory"` (footer) + ≥3 known section headers + CLIA number. Require a quorum, not all-or-nothing — tolerates minor footer variations.
- Detection should be **cheap** and **never throw**. Only `parseText` should throw, and only when the result is implausibly small.

### Section patterns: case-sensitive, end-anchored

- **Drop the `/i` flag.** PDF section headers are all-caps; data rows are Title Case. Without case sensitivity, `/^PRIMARY BILE ACIDS\b/i` matches `"Primary Bile Acids - %"` (a SCFA-summary data row) and routes the wrong rows into the wrong panel. Cost us ~25 mismatches.
- **Anchor banners to `\s*$`.** A pattern like `/^HELICOBACTER PYLORI\b/i` matches `"Helicobacter pylori 1.91e2 < 1.00e3"` and silently drops the data row as if it were a banner.
- **Strip column-header tails.** When a section line collapses with its column headers (e.g. `"PRIMARY BILE ACIDS Abbreviation Conjugation** Result ng/g Reference ng/g"`), `processLine`'s section handler should strip the headers before re-parsing the remainder. Otherwise the column header words pollute `pendingAnalyte`.

### Row state machine

Default model: a row is `[analyte] [value] [range]` with optional `[flag]` glued to `value`. Walk lines top-to-bottom maintaining a `currentPanel` cursor and pending row pieces.

- `pendingAnalyte` — analyte name on its own line, awaiting value+range on the next.
- `pendingValueLine = {value, range}` — value+range on a line that arrived **before** its analyte (pdfjs ordering oddity).

If your provider gets weirder than that — pieces arriving in unpredictable orders — extend with `pendingValue` and `pendingRange` and a `tryEmitTriple` helper that emits when all three are present (see GI-MAP's page-8 Caproate handling). **But each addition is a maintenance cost**. If you're past three pending fields, you're heading for the templatize option (see §"When to escalate" below).

Reset all pending state on every section change.

### Per-panel column handlers

Sometimes a panel has unique column structure that doesn't fit the generic `[analyte value range]` shape. GI-MAP's bile-acid table has `[Analyte] [Abbreviation] [Conjugation U|C] [Result] [Reference]` — five columns, not three. The fix: a panel-aware token strip that runs before the generic logic when the panel matches.

- Strip after tokenize, before isAnalyteOnlyRow / isValueOnlyRow / full-row dispatch.
- Handle both single-line ("[analyte] [abbrev] [conj] [value] [range]") and multi-line ("[analyte]" + "[abbrev] [conj] [value] [range]") cases — pdfjs sometimes splits.
- The strip should be a function of (tokens, hasPendingAnalyte). When pendingAnalyte is set, the abbreviation is at `tokens[0]`; otherwise it's between analyte and value.

### Drop ghost rows

```ts
if (value.numeric == null && value.text == null) return;
```

When the parser can't recover a numeric or qualitative value, **don't emit**. Ghost rows pollute `/mappings` without adding signal. The user explicitly directed this for GI-MAP's antibiotic-resistance gene table (all N/A when H. pylori is below detection); apply the same rule generically.

### Filter prose

Reports interleave explanatory captions with table rows ("Results are reported as genome equivalents per gram of stool…"). A simple filter: count `\b[a-z]{3,}\b` matches; ≥5 → prose, skip. Real data rows have very few all-lowercase words even with multi-word taxa.

### Detection of "data row" vs "section / banner"

When in doubt, lean towards "this is data" — missing a metric is cheaper than misrouting a row. Section detection should be strict (case-sensitive + anchored).

### Cross-vintage handling

Most providers evolve their reports additively (new panels added, existing layout preserved). One parser handles both vintages — sections that don't exist in v1 simply don't fire on v1 reports. Track this in two ways:

- Test fixtures from at least one report per vintage, asserting per-panel coverage.
- Bump `version` when parser rules change so an `extractor_version` re-extraction sweep can re-extract older reports.

If a future vintage redesigns the *spine* (page 1 / page 2 layout) rather than adding panels, then split into `provider-v1.ts` / `provider-v2.ts` and let the dispatcher's `detect` pick which to run.

---

## Test fixture rules

- **Don't commit real PDFs.** PII. And we don't ship pdfjs into the test runner.
- **Sanitize text once.** Run the real PDF through `extractPdfText` (locally), redact patient name / DOB / accession / orderer / address / phone with `sed`, save as `tests/fixtures/<provider>/<vintage>.txt`. Verify with `grep -i "<patient name>"` returns nothing.
- **Test `parseText`, not `parsePdf`.** Pure inputs and pure outputs. Fast, CI-runnable, no pdfjs in tests.
- **Cover at least 2 vintages.** Catches additive layout changes early.
- **Assert specific metrics, not just counts.** "Calprotectin = 40 in panel containing 'Inflammation'" is a stable assertion; "metric_count >= 100" is brittle to your own future cleanups.

---

## The iteration loop

```bash
# 1. Pick a report you have both Claude + raw PDF for.
sqlite3 data/health.db "SELECT id, model, extractor_kind FROM extractions WHERE report_id = N;"

# 2. Diff your parser against Claude's stored output.
pnpm compare-extract N

# 3. Read the output. Buckets:
#    - VALUE mismatches → real bugs in your parser.
#    - ONLY-CLAUDE rows that are clinically empty → drop ghosts.
#    - ONLY-CLAUDE rows that are real data → root-cause why your parser missed them.
#    - ONLY-GIMAP rows → either your parser hallucinating, or rows Claude skipped
#      (Claude does sometimes miss things — verify against the raw PDF).
```

When iterating, write **throwaway** debug scripts (`peek-line.ts`, `trace-parse.ts` etc) to inspect specific lines / metrics. Delete them before committing. The compare-extract tool stays.

---

## When to escalate

The default approach (row-stream + state machine + per-panel handlers) is robust to layout drift but can't extract:

- Donut-chart legends, bar-chart data labels, anything where pdfjs's text positions don't reflect the visual table structure.
- Dense multi-column grids where pdfjs's row reconstruction shuffles cells unpredictably.

When you find yourself adding a fifth pending-* state field or a third per-panel handler, stop and consider **templatize**: hard-code each panel as a `(page, x-range, y-range)` zone and pull text directly from those zones. Highest accuracy on a single template version, near-zero state-machine complexity, but breaks when the lab redesigns the report.

For Paul's archive at single-user scale, the row-stream approach is the right default. Reach for templatize only on a high-volume format that hits the row-stream limits.

---

## Pitfalls — quick list

- `\b` word boundaries between two word chars don't match. `\borg/g\b` doesn't match `8.2e6org/g`. Use `(?<![A-Za-z])` for the leading side instead. (See `lib/parsers/gimap/rows.ts`'s `UNIT_PATTERNS`.)
- `/i` on section patterns will eat data rows. Drop it.
- A regex that's prefix-anchored without an end anchor will match strict-prefix data rows. Anchor banners to `\s*$`.
- "Single-token value-like line" is ambiguous — could be a stray fragment or the value half of a 3-line split row. Save as `pendingValue` and only emit when the rest arrives.
- Multi-line analyte names with parens (e.g. `"Eosinophil Activation Protein (EDN, EPX)"`) often split across pdfjs rows. `cleanAnalyte` drops trailing unclosed-paren fragments — better to lose the suffix than emit a malformed name.
- Don't trust pdfjs's "items in document order". Y-bucketed reconstruction is necessary even if you think the items are already ordered.

---

## Reference: file layout

```
lib/parsers/
  index.ts            # tryDeterministicExtract dispatcher; PARSERS registry
  pdf-text.ts         # extractPdfText: pdfjs-dist legacy build, position-keyed dedupe, tab insertion
  <provider>/
    index.ts          # exports name, version, detect, parseText, parsePdf
    detect.ts         # narrow signature detection
    sections.ts       # SECTION_SPECS, HEADER_NOISE_RE, UMBRELLA_BANNERS
    rows.ts           # tokenize, classifyValue, parseRange, leadsWithValue
    parse.ts          # walkLines state machine, processLine, emit, cleanAnalyte

tests/
  fixtures/<provider>/<vintage>.txt   # sanitized text fixtures (PII redacted)
  unit/parsers/<provider>-detect.test.ts
  unit/parsers/<provider>-parse.test.ts
```

---

## When you ship

- All 8 archived <provider> reports parse without throwing.
- `pnpm compare-extract` against ≥1 Claude-extracted report shows >90% matched and 0 value mismatches outside known cosmetic name diffs.
- Tests cover detection on/off and key markers across at least 2 vintages.
- Update `lib/parsers/index.ts` to register the new parser.
- Update PLAN.md if the work was a phase milestone; append PROGRESS_LOG.md.
