# Progress Log

> Append-only record of what shipped per phase. See `PLAN.md` for forward-looking scope and exit criteria.

---

## Phase 0 — Foundations ✅ (2026-04-17)

Docs aligned, Next.js scaffolded, schema in place. No real data yet.

**Shipped**
- `VISION.md`, `ARCH.md`, `PLAN.md`, `CLAUDE.md` agreed.
- Next.js 15 (App Router, TypeScript, Tailwind v4) at the repo root; `pnpm dev` serves an empty dashboard shell.
- `better-sqlite3` wired through `lib/db.ts` singleton; `data/health.db` created on first run with WAL + foreign keys on.
- Drizzle schema (`db/schema.ts`) covering `reports`, `panels`, `metrics`, `canonical_metrics`, `extractions`, `events`. Initial migration generated (`drizzle/0000_mean_marrow.sql`) and applied via `pnpm db:migrate`.
- `.env.example` with `ANTHROPIC_API_KEY`; `.env`, `data/`, `uploads/` gitignored.

**Verified**
- `pnpm install && pnpm dev` shows the empty dashboard.
- `sqlite3 data/health.db ".schema"` shows the seven app tables.

---

## Phase 1 — Blood panel ingest ✅ (2026-04-17)

End-to-end thin slice: drop a PDF in the browser → Claude extracts → review preview → confirm → metrics land in SQLite and surface on the dashboard.

**Scope change from PLAN v0.1**
- Original Phase 1 specified a `pnpm ingest` CLI; replaced with the browser upload flow (`/upload`) so the full ingest path matches the production UX from day one. The CLI is dropped from the roadmap entirely.

**Shipped**
- **Visual foundations**
  - Tailwind v4 theme tokens in `app/globals.css` (shadcn CSS-variable contract + flag/lab/chart semantics).
  - Inter (sans), Fraunces (serif display), JetBrains Mono (mono) wired via `next/font`.
  - Real shadcn primitives installed under `components/ui/`: card, button, badge, input, separator, table, tabs.
  - Local design-system components under `components/health/`: `PageHeader` + `Stat`, `TopBar`, `Flag`, `Sparkline`.
- **Extraction service** (`lib/extract.ts`)
  - `@anthropic-ai/sdk` with native PDF input (`document` content block, base64 source).
  - System prompt enforces a single JSON object: `{ provider, category, reportDate, metrics[] }`.
  - Each metric carries `name`, `panel`, `valueNumeric|valueText`, `units`, `refLow|refHigh|refText`, `flag`, `confidence`.
  - Zod validates the response; raw Claude output passed through for replay.
  - Default model `claude-sonnet-4-6`, overridable via `ANTHROPIC_EXTRACTION_MODEL`.
- **Upload flow**
  - `/upload` page (`app/upload/`) ports `design/screens/upload.jsx`: 3-step stepper, drag-and-drop zone, preview table with confidences, detected/safety/low-confidence sidecars.
  - `POST /api/upload` — accepts multipart, stages PDF under `uploads/.staging/{id}/source.pdf`, computes sha256, runs extractor, persists `extraction.json` next to the PDF, returns preview + dedupe info.
  - `POST /api/upload/{id}/confirm` — re-validates staged extraction, dedupes by `file_hash`, promotes the PDF to `uploads/{hash}.pdf`, inserts `Report + Extraction + Panels + Metrics` in one transaction, deletes the staging dir.
  - `DELETE /api/upload/{id}` — discards staging.
  - Idempotency: `reports.file_hash` unique constraint, checked on both upload (warning) and confirm (409).
- **Dashboard** (`app/page.tsx`)
  - Rebuilt against `design/screens/dashboard.jsx`: flagged-first metric grid, sparkline per metric, "in range" grid, recent-reports sidebar, upload CTA.
  - Empty state for a fresh DB.
  - Search input present but disabled — wiring lands in Phase 4.
  - Data layer in `lib/queries.ts` groups all metrics by raw name (canonical mapping is Phase 4).

**Verified**
- `pnpm typecheck` and `pnpm lint` clean.
- Live ingest of an archived blood-panel PDF through `/upload` end-to-end (Paul, 2026-04-17).

**Known gaps deferred to later phases**
- Per-metric chart route (Phase 2).
- GI / microbiome formats stress-tested (Phase 3).
- Canonical metric mapping unifying provider aliases (Phase 4).
- Search input wired up (Phase 4).

---

## Phase 2 — Time-series charts ✅ (2026-04-17)

Any ingested metric now charts over time, grouped by provider, reachable in one click from the dashboard.

**Shipped**
- **Recharts** added as a dependency; lab-color palette extended in `app/globals.css` with `--lab-{lifeforce,function,genova,vibrant,gimap,other}` on top of the existing labcorp/quest tokens, plus `--chart-ref-band` for the reference-range fill.
- **Provider color assignment** in `lib/providers.ts` — deterministic mapping from provider string (quest, labcorp, lifeforce, function-health, genova, vibrant-america, gi-map, …) to a `--lab-*` HSL token, with a cycling fallback for unknown providers.
- **Server query** `lib/metric-series.ts#getMetricSeries(name)` — gathers every row for a metric name joined with its report (date, provider), sorts chronologically, computes a dominant units string and flags units mismatches (excluded rows surfaced separately), picks a dominant reference range and flags when providers disagree, and returns latest / mean / min / max summary stats.
- **`/metric/[name]` route** (`app/metric/[name]/page.tsx`) ports `design/screens/metric.jsx`'s A-variant (no AI chat panel — Phase 4+):
  - Breadcrumb + latest / 5-yr mean / range stats.
  - `MetricChart` client component (`components/health/metric-chart.tsx`) — Recharts `LineChart` with one `Line` per provider, a `ReferenceArea` reference-range band plus dashed `ReferenceLine`s using `--chart-ref`, time-scaled X axis, custom tooltip with per-provider swatches and flag hints, custom dot that halos high/low readings.
  - Time filter segmented control (1Y / 2Y / 5Y / All).
  - Provider legend buttons toggle visibility per series; disabled providers also drop out of the visible Y-domain calculation.
  - Raw-values table (newest first) with per-provider color, numeric flag, reference range per row.
- **Units mismatch banner** — when rows for the same raw metric name disagree on units, a red warning card lists all unit variants, identifies which dominant unit is being plotted, and enumerates excluded rows so nothing is silently converted or merged.
- **Dashboard links** — each metric card wraps in `<Link href="/metric/{encodeURIComponent(name)}">`, so one click from `/` gets to the chart. Keyboard focus ring preserved.
- **404 on unknown metric names** via `notFound()`.

**Scope notes**
- The ARCH sequence diagram sketches a separate `GET /api/metrics/:name` JSON route. In practice the page is a Server Component that calls `getMetricSeries` directly and hands the series to the client chart — no redundant API endpoint.
- Raw metric grouping only; canonical-name unification ("WBC" = "White Blood Cell Count" = "Leukocytes") stays in Phase 4 per the resolved plan.
- AI chat panel from variant E of `design/screens/metric.jsx` deliberately deferred — not a Phase 2 deliverable and depends on infrastructure that belongs to Phase 4+.

**Verified**
- `pnpm typecheck` / `pnpm lint` / `pnpm build` all clean.
- Dev server renders `/`, `/metric/WHITE%20BLOOD%20CELL%20COUNT` (flagged low across two reports), `/metric/TESTOSTERONE%2C%20TOTAL%2C%20MS` (comma-in-name), `/metric/APOLIPOPROTEIN%20B` (single-provider flagged high). Non-existent metric returns 404.

**Known gaps deferred to later phases**
- GI / microbiome extraction stress-test (Phase 3).
- Report detail page (`/reports/[id]`) with PDF side-by-side (Phase 3).
- Canonical metric unification + compare view + search (Phase 4).

---

## Phase 3 — Upload UI + GI ingest ✅ (2026-04-17)

Closed the MVP loop: GI formats extract cleanly, every stored report has its own detail page with the PDF inline, and a report can be re-extracted one-off or in bulk when the prompt improves.

**Shipped**
- **GI-aware extractor** — `lib/extract.ts` prompt rewritten to cover GI-MAP, GI-360, Gut Zoomer (Vibrant America), Viome Gut Intelligence, Meridian Valley MARCoNS, Mosaic OAT, and Great Plains. Explicit rules for the GI idioms that tripped the generic prompt: scientific notation → numeric, `<dl` / "Not Detected" → `valueNumeric: null` + `valueText`, abundance percentages → number + `%`, qPCR units (CFU/g, copies/g), categorical Viome scores, and GI panel headers (Commensal/Opportunistic Bacteria, Parasites, Intestinal Health Markers, SCFAs). `max_tokens` raised 16k → 32k so long microbiome panels don't truncate.
- **Report detail page** (`app/reports/[id]`) ports `design/screens/report.jsx`:
  - Header with provider · category, date, metric count, short file hash, and two actions: `Re-extract` and `Open source PDF`.
  - Left column: one `Card` per panel, with panel-level metric count + flagged count, rows showing value/unit/range/flag and a per-row `Trend →` link into `/metric/[name]`. Un-paneled metrics collapse into an "Other" card.
  - Right sidecar: `Source PDF` with an inline `<iframe>` PDF viewer (aspect 8.5/11, `#view=FitH`) + filename + size; `Extraction` card with model, run date, low-confidence count, run count, and a `View raw JSON` link; `Out of range` card listing flagged metrics with per-row links into `/metric/[name]`.
  - Missing-PDF fallback: placeholder card + disabled button when the uploads file is gone.
- **API routes**
  - `GET /api/reports/[id]/pdf` — streams the stored PDF as `application/pdf` with an inline disposition.
  - `GET /api/reports/[id]/extractions/[extractionId]` — returns the raw Claude output as JSON (double-checks the extraction belongs to the report).
  - `POST /api/reports/[id]/re-extract` — re-sends the source PDF to Claude, appends a new `Extraction` row, and atomically replaces that report's panels + metrics in a single transaction.
- **Re-extract helpers** (`lib/re-extract.ts`)
  - `reExtractReport(id)` — live re-run; used by the per-report button.
  - `replayReportFromLatestExtraction(id)` — no-API path; re-derives panels + metrics from the latest stored `raw_json`. Useful after parser-only changes.
  - Both paths share a single transactional `replacePanelsAndMetrics` so an update never leaves orphans.
- **Bulk CLI** — `pnpm re-extract` (`scripts/re-extract-all.ts`) iterates every report (or `--only=1,3,5`), live re-extracts by default, or re-derives from stored JSON with `--replay`. Ships with a tiny `.env` loader so the script runs without a new dotenv dependency.
- **Dashboard → report links** — recent-reports sidebar entries on `/` are now `<Link>`s to `/reports/[id]`.
- **Report-detail data layer** (`lib/report-detail.ts`) — single `getReportDetail(id)` server-only query that joins report + panels + metrics + latest extraction, computes low-confidence count from `raw_json`, and stats the uploads file for size/presence.

**Scope notes**
- Canonical-name unification, search, and intervention overlays are still Phase 4.
- The bulk re-extract CLI is intentionally coarse — no parallelism, no cost cap — because it's a rare "prompt upgrade" operation, not a hot path.
- The report header's `Re-extract` button requires the source PDF to be present (pre-`uploads/` reports would not qualify); disabled otherwise with a visible note.

**Verified**
- `pnpm typecheck` · `pnpm lint` · `pnpm build` all clean.
- Dev server: `/reports/1` renders Quest blood panel with all panels + sidecar, `/reports/999` → 404, `/api/reports/1/pdf` returns `application/pdf`, `/api/reports/1/extractions/1` returns the raw JSON with `application/json; charset=utf-8`.
- Real GI ingest via `/upload` is left to Paul to run interactively with the archived GI PDFs (the exit-criteria check).

---

## Post-MVP polish ✅ (2026-04-18)

First real-use iteration on top of the MVP: a mass-ingest path so the archive backlog goes in without one-file-at-a-time clicking, plus a dedicated Reports tab so all ingested reports are browsable beyond the dashboard's "recent 5" slice.

**Shipped**
- **Auto-confirm ingest path** — `POST /api/upload` gained an `autoConfirm=1` form field. With it, the request stages the PDF, hashes it, and either short-circuits as `{ status: "duplicate", duplicate: { reportId } }` (no Claude call) or runs extraction → `promoteStaged` → `insertExtractedReport` in a single round-trip and returns `{ status: "saved", reportId, metricCount, detected }`. The original staged-review flow (no `autoConfirm`) is unchanged.
- **Multi-file upload UI** (`app/upload/upload-client.tsx`)
  - File input now accepts `multiple`; drag-and-drop forwards every dropped file.
  - One file → existing review/confirm flow. Many files → `window.confirm` prompt ("Auto-confirm each extraction? Duplicates will be skipped."), then a new `phase: "batch"` view.
  - Client-side worker pool (`BATCH_CONCURRENCY = 3`) processes files in parallel; each file transitions `queued → extracting → saved | duplicate | error` with inline detected-provider hints, metric counts, and links into `/reports/[id]` (either the newly saved row or the existing duplicate).
  - `router.refresh()` after the batch completes so dashboard + `/reports` reflect the new rows immediately.
- **Reports tab + index page**
  - `components/health/top-bar.tsx` gains a `Reports` tab (between Dashboard and Upload). `app/reports/[id]/page.tsx` now passes `current="reports"` so the tab stays highlighted in report detail.
  - `app/reports/page.tsx` (new) — full-width table of every report, sorted newest-first, with date / provider / category / metric count / flagged count / ingested date columns, plus header stats (total reports, total flagged) and an "+ Upload" action. Empty-state card matches the dashboard's tone.
  - `lib/queries.ts#getAllReports()` — single pass over `reports` joined to an in-memory tally of metrics per report (total + flagged). Ordered by `reportDate DESC, uploadedAt DESC` to match the dashboard's "Recent reports" sort.

**Scope notes**
- Duplicate detection stays exactly as it was (`reports.file_hash` unique index, hash computed in `stagePdf`) — the auto-confirm path just reads the existing check result earlier and aborts before the API call. No schema changes.
- Batch concurrency of 3 is a straightforward bound against Anthropic rate limits on a single local user; no backoff logic beyond the default SDK behavior was added. If the archive ever produces sustained 429s we can revisit.
- The confirm dialog is a plain `window.confirm` rather than a shadcn Dialog component — lightest-weight option that still makes the auto-confirm opt-in explicit.

**Verified**
- `pnpm typecheck` and `pnpm lint` clean.
- Dev server returns 200 on `/`, `/reports`, `/upload`.
- Actual mass-ingest run over the archive is left to Paul to execute interactively.

---

## Phase 5 — Electron shell + userData migration ✅ (2026-04-18)

Packaged macOS app: `pnpm app:build` produces `dist/mac-arm64/Health.app`, an unsigned Electron bundle that hosts the existing Next.js app against per-user OS storage. Dev loop (`pnpm dev` in a browser tab) unchanged; a new `pnpm app:dev` launches the same app inside an Electron window.

**Shipped**
- **Path helper** (`lib/paths.ts`) — single source of truth for `dbPath`, `uploadsDir`, `stagingDir`, `logsDir`, `migrationsDir`. Branches on `HEALTH_USER_DATA_DIR` + `HEALTH_APP_DIR` env vars (set by Electron main); falls back to `process.cwd()` in web-dev so the `./data/` + `./uploads/` behavior from prior phases is unchanged.
- **Electron main** (`electron/main.ts` → `electron/main.js` via `tsc`) — in dev, spawns `next dev` on port 3000; in packaged mode, spawns `next start` on a free port via `process.execPath` + `ELECTRON_RUN_AS_NODE=1`. Inherits `stdio` so server logs surface normally. Passes userData + app dir + API key env vars to the spawned child.
- **Auto-migrate on startup** — `lib/db.ts` runs `migrate()` on DB init when `HEALTH_USER_DATA_DIR` is set (packaged-app context). Web-dev keeps manual `pnpm db:migrate` semantics so in-progress schema work doesn't auto-apply.
- **Packaging config** (`package.json` `build` section) — `appId: com.lamthalabs.health`, `productName: Health`, `asar: false`, explicit `files` include/exclude list, `npmRebuild: false`, `mac.identity: null` (unsigned; signing is Phase 7). Target is currently `dir` on `arm64`; flipping to `dmg` lands in Phase 7.
- **Build scripts** — `pnpm app:build-main` (compile main.ts), `pnpm app:dev` (compile + launch Electron in dev), `pnpm app:rebuild-sys` / `app:rebuild-electron` (native-module ABI helpers), `pnpm app:build` (the full pipeline).
- **Repo state** — `electron/` dir added (tracked: `main.ts`, `preload.js`, `first-run.html`, `tsconfig.json`; gitignored: `main.js`). `next.config.ts` → `next.config.js`. `.npmrc` added with `node-linker=hoisted`. `.gitignore` extended for `electron/main.js`.

**Scope changes from `PH5_ARCH_DELTA.md`**
- **pnpm layout.** The delta didn't anticipate needing `.npmrc` with `node-linker=hoisted`. Both `electron-builder`'s native-module rebuild and `next start` at runtime were flaky against pnpm's `.pnpm/` symlink tree; a flat `node_modules` makes both reliable. Project-wide pnpm config change.
- **better-sqlite3 ABI handling.** Tried `buildDependenciesFromSource: true` first — `@electron/rebuild` silently no-op'd (reported "finished" without touching the binary, because the existing prebuilt binary was the wrong ABI but considered a cache hit). Final pattern: `npmRebuild: false` in the builder config + explicit `electron-rebuild --only better-sqlite3 --force` between `next build` and `electron-builder`, bookended by `pnpm rebuild better-sqlite3` to flip the workspace binary back to system-Node ABI after packaging so `pnpm dev` still works.
- **Next config format.** `next.config.ts` → `next.config.js`. Inside the packaged app, `next start` otherwise tries to install TypeScript at runtime to parse the `.ts` config. Our config has two real lines of content; plain JS is a wash.
- **`asar: false`.** Chose an unpacked bundle for simplicity — the trade-off is a ~950 MB `.app`. The delta's "Extension Points" entry still holds; asar + selective `asarUnpack` for native modules is revisitable in Phase 7 if size becomes a user complaint.
- **No `.bin/` reliance.** pnpm's `.bin` symlinks don't survive electron-builder's packaging, so the spawn pattern targets `node_modules/next/dist/bin/next` via `process.execPath` in both dev and prod — a single code path rather than two.

**Verified**
- `pnpm app:dev` — Electron window opens, dashboard renders, DB/uploads route to `~/Library/Application Support/Health/data/` and `.../uploads/`.
- `pnpm app:build` — produces `dist/mac-arm64/Health.app` (~950 MB). Boot + `/`, `/reports`, `/uploads` all return 200.
- **End-to-end PDF ingest through the packaged `.app`** — confirmed on 2026-04-18. Extraction, persistence, dashboard update all work. (This required the Phase 6 first-run API-key slice landing on top of Phase 5 to provide a key path in the packaged context, since `.env` isn't bundled.)

**Known gaps deferred**
- **Full Phase 6** — first-run key slice shipped; still owed: key validation on save, settings screen, onboarding, global error boundary, rolling log.
- **Phase 7** — signing, notarization, DMG, `electron-updater`, `INSTALL.md`. Packaging currently produces an unsigned `.app` only.
- **Bundle id `com.lamthalabs.health`** now keys macOS Keychain for the stored API key — treat as permanent; changing it post-distribution would orphan users' saved keys.
- **Phase 4** (canonical metrics, search, compare, clinician export) remains sequenced before any real F&F distribution per the PLAN's ordering decision.

---

## Phase 4 — Canonical metrics + exploration + clinician export ✅ (2026-04-18)

Six-slice landing, merged to main as a single coherent phase (per the "not shipping until this whole thing is done" constraint). Went back to this after Phase 5 (Electron packaging) so distributed builds will include unified metrics + clinician export from day one.

**Shipped** (in order of landing)

- **Slice 1 · Canonical metrics + category taxonomy.**
  - Schema: `canonical_metrics.tags` (TEXT json); new `metric_aliases` table (composite PK on `raw_name_lower` + `provider`, empty-string provider = global fallback; FK cascade from `canonical_metrics`).
  - Seeds: 147 canonical entries across 18 categories (`cbc`, `cmp`, `lipids`, `inflammation`, `thyroid`, `hormones`, `nutrients`, `kidney`, `liver`, `glycemic`, `gi-microbiome`, `gi-pathogens`, `gi-inflammation`, `gi-digestion`, `sibo`, `aging`, `imaging`, `other`) and 8 cross-cutting tags (`longevity`, `cardio-risk`, `autoimmunity`, `methylation`, `iron-status`, `insulin-resistance`, `gut-barrier`, `sibo-theme`) with 423 seeded aliases. `applySeeds()` idempotent, auto-applied after migrate in packaged-app boot; `pnpm db:seed` for dev.
  - `lib/canonical.ts#resolveCanonicalId(rawName, provider?)` — two-pass lookup (provider-scoped → global). Wired into `insertExtractedReport` and the re-extract path.
  - `pnpm db:backfill-canonical` — idempotent retrofit of existing metric rows. First run linked 311 of 2153 rows to canonicals.
  - `/mappings` review queue: distinct unmapped raw names sorted by occurrence, map-to-existing search + create-new-canonical inline form. `POST /api/mappings` atomically inserts alias + backfills matching rows.
  - Dashboard banner surfaces unmapped count → `/mappings`.
- **Slice 2 · Category + tag filter UI.**
  - Dashboard metric grouping switched from raw name to canonical (unifies WBC + Leukocytes across providers) with raw-name fallback for un-mapped rows.
  - `/metric/[name]` resolves canonical name first, aggregates rows across every alias; raw-name fallback kept for stragglers.
  - `<CategoryFilter>` chip strip on `/` + `/reports` — categories, tags, "Unmapped", live counts, URL-driven (`?cat=`, `?tag=`, `?unmapped=1`). Single chip active at a time.
  - `getAllReports` and `getDashboardSummary` accept `MetricsFilter`, surface `categoryCounts` + `tagCounts` (always unfiltered, for stable chip totals).
  - Report-detail "Trend →" links point at canonical names when available.
- **Slice 3 · Global search (⌘K).**
  - `lib/search.ts#searchAll` LIKE-matches canonical names, every alias, provider slugs, and report-date substrings. Returns grouped hits (Metrics / Unmapped / Reports).
  - `GET /api/search?q=` wrapper.
  - `components/ui/{command,dialog}.tsx` installed via shadcn (cmdk-backed).
  - `<SearchPortal>` at layout level owns dialog state, listens for `⌘K` + `/` globally, listens for `health:open-search` window events dispatched by triggers.
  - `<SearchTrigger>` compact (top-bar) + full (dashboard) variants. One dialog, two triggers.
- **Slice 4 · `/compare` multi-metric view.**
  - `/compare?m=id,id,...` renders up to 4 canonical series on a shared time axis.
  - `lib/compare.ts` — `getCompareSeries` (grouped by canonical, dedupe via canonical unit), `getCompareCandidates` (canonicals with ≥1 metric row).
  - `CompareChart` Recharts component: per-series mini chart, per-series ref band, shared x-domain (union of all observation timestamps).
  - `CompareView` client: chips with × remove, inline picker (search canonicals by name / category), live URL update on add/remove.
  - Suggested-pairings card — 6 curated groupings (Immune / Inflammation / Cardio risk / Insulin-glucose / Gut barrier / SIBO breath) resolved against seeded canonicals at render; missing ones dropped silently.
  - Top-bar gains "Compare" between Reports and Upload.
- **Slice 5 · Interventions + events overlay.**
  - Schema: new `interventions` table (`{ id, name, kind, dose?, notes?, started_on, stopped_on?, created_at }`); `events` widened — `kind` now `start|stop|change|singleton`, nullable `intervention_id` FK (CASCADE on delete), new `created_at`.
  - `lib/interventions.ts` — transactional helpers: `createIntervention` (row + start event), `stopIntervention` (row update + stop event), `changeIntervention` (row update + change event with dose-diff description), plain `deleteIntervention`, `getInterventionDetail`.
  - `lib/events.ts` — singleton CRUD (travel, illness, one-off notes).
  - `lib/overlays.ts` — `getOverlaysInWindow(from, to)` and `getAllOverlays()` returning `{ bands, markers }`. Bands = interventions (span `started_on → stopped_on` or `→ today` while active). Markers = singleton events.
  - `components/health/overlay.tsx#overlayPrimitives` — returns Recharts `ReferenceArea` (bands, color-coded by kind via `lib/overlay-colors.ts`) + `ReferenceLine` (dashed markers). Slotted into MetricChart and CompareChart.
  - `/interventions` (active + past tables + inline "+ Start" form), `/interventions/[id]` (timeline, record dose change, stop today / custom date, delete with confirm), `/events` (singleton CRUD).
  - API: `POST /api/interventions`, `PATCH/DELETE /api/interventions/[id]` with discriminated-union body (`{ action: "stop" | "change", ... }`), `POST /api/events`, `PATCH/DELETE /api/events/[id]`.
  - Top-bar: `Dashboard · Reports · Compare · Interventions · Upload` (Events reached from Interventions).
- **Slice 6 · Clinician export (PDF + CSV).**
  - `@react-pdf/renderer` integrated; PDF generation happens in-process (no headless Chrome).
  - `lib/export.ts#buildExportDataset` — given date window + canonical ids, returns series with observations, latest/mean/min/max stats, dominant units + ref range, plus every intervention active during the window.
  - `lib/pdf/clinician-pdf.tsx` — cover page (window, contents summary, privacy note) + one page per metric (header, 4-stat row, inline SVG trend chart with ref band + flagged-dot highlighting, observations table) + interventions-in-window page.
  - `lib/export.ts#datasetToCsv` — one row per observation (canonical name, category, raw name, provider, date, value, unit, ref range, flag) + a trailing interventions block.
  - `GET /api/export/pdf` (`renderToBuffer` → `application/pdf`), `GET /api/export/csv`.
  - `/export` page: date presets (3/6/12/24 mo / all / custom), metric picker with filter + "Select flagged" + "Clear", PDF + CSV download buttons. Flagged metrics from the past 12 months pre-selected by default.
  - Entry points: "Export for doctor →" on dashboard Recent-Reports card; wired row in `/compare` Overlays card.

**Scope notes**
- Not shipped incrementally. All six slices merged before flipping Phase 4 to ✅ per the "land the whole thing, then close" directive.
- `@react-pdf/renderer` + `cmdk` are new top-level dependencies (added to Tech Stack in `ARCH.md`).
- Bundle ID `com.lamthalabs.health` unchanged; canonical taxonomy + aliases + interventions all live inside the existing user-data SQLite database, so the Phase 5 packaged-app layout carries Phase 4 content without change.
- `events.report_id` (shown in ARCH's ER diagram) stays deferred — no UI wires it up in Phase 4. Schema change when/if it lands.

**Verified**
- `pnpm typecheck` / `pnpm lint` / `pnpm build` clean after every slice.
- End-to-end HTTP smoke tests (dev server): all new routes return 200; sample mappings flow (raw → canonical → backfill) works against live data; sample intervention (Berberine) creates bands visible on metric + compare charts; PDF export against 3 canonicals produces a valid 5-page PDF (cover + 3 metric pages + interventions); CSV carries the expected columns and blank-separated interventions block.
- `pnpm db:backfill-canonical` leaves 1,842 raw names unmapped in the existing archive — expected (GI-MAP species-level entries beyond the seed). `/mappings` is the human loop.

**Deferred to later phases**
- Seed expansion for long-tail GI-MAP species. Easier to do in-place via `/mappings` as Paul encounters new reports.
- Per-provider overrides on alias scope — `/mappings` only creates global aliases today; provider-scoped overrides require a tweak to the inline form.
- Fuzzy search fallback. Substring matching feels sufficient at current data size; revisit if signal:noise drops.
- Pinned date cursor + lab-calibration bands from the `compare.jsx` design — listed as "(phase 4+)" toggles on `/compare`.

---

## Phase 6 — First-run experience + error surfaces ✅ (2026-04-19)

Closed the remaining Phase 6 deliverables in a five-slice run that also stood up the project's first test harness + CI. First-run key slice landed with Phase 5 on 2026-04-18; this entry covers what shipped on 2026-04-19.

**Shipped**

- **Slice 1 · API-key validation + test harness + CI.**
  - `electron/validate-key.ts` — `validateApiKey(key, fetchImpl?)` does `GET /v1/models?beta=true` with `x-api-key` + `anthropic-version: 2023-06-01` and a 15 s `AbortSignal.timeout`. 401/403 → "Anthropic rejected that key", network error → "Couldn't reach Anthropic", other non-2xx → "Anthropic returned `<status>`" plus a 120-char body snippet. Injected `fetch` for testability.
  - `electron/main.ts` — save-api-key IPC validates before writing to Keychain. `handleOnce` → `handle` with explicit `removeHandler` on success so a failed validation leaves the handler up for retry. `electron/first-run.html` flips the button to "Validating…" during the call.
  - **Vitest harness (new).** `vitest.config.ts` with three projects (`unit` / `api` / `smoke`), `server-only` aliased to a stub, per-worker tmpdir DB via `tests/setup-data-dir.ts` (sets `HEALTH_USER_DATA_DIR` + `HEALTH_APP_DIR` before any DB module loads; `lib/db.ts`'s auto-migrate + seed path provisions the schema). `maxWorkers: 1` for api + smoke because they share a per-worker singleton.
  - Tests: `tests/unit/validate-key.test.ts` (5 cases via mocked fetch), `tests/api/search.test.ts` (invokes `app/api/search/route.ts#GET` directly with a `Request` and asserts the seeded WBC aliases resolve to "White Blood Cells"), `tests/smoke/boot.test.ts` (spawns `next dev` on a free port, asserts `/`, `/reports`, `/api/search?q=wbc`). Scripts: `pnpm test` / `test:unit` / `test:api` / `test:smoke` / `test:watch`.
  - **CI.** `.github/workflows/ci.yml` runs on every PR + every push to `main`. `pnpm install --frozen-lockfile` → `typecheck` → `lint` → `app:build-main` → `test`. Node 22, pnpm from `package.json#packageManager`.
  - `CLAUDE.md` gains a **Tests** section: layers, when to write which, the `maxWorkers`/singleton constraint, the "extract from Electron main when needed" rule so the harness gets used going forward.

- **Slice 2 · Rolling local log in `userData/logs/`.**
  - `electron/logs.ts` — pure helpers: `currentLogFilename(now)` → `health-YYYY-MM-DD.log`; `pruneOldLogs(dir, days, now)` deletes files past the keep window (ignores unrelated names); `openLogFile(dir, now)` appends via `createWriteStream`; `installConsoleTee(handle)` mirrors `console.{log,warn,error,info}` to the file with an ISO timestamp + level tag; `formatLogLine` centralises the format.
  - `electron/main.ts` — packaged-only `initLogging()` runs after `whenReady`, prunes files older than 14 days, opens today's file, tees console. Child next-server spawn switches to `stdio: ["ignore", "pipe", "pipe"]` and tees stdout/stderr into the same file. `logHandle` closed on `before-quit`.
  - `tests/unit/logs.test.ts` covers filename format, line format with plain args + Error stack, prune semantics (keeps recent / drops old / ignores non-matching / missing dir), and an end-to-end append via `openLogFile`.

- **Slice 3 · Global error boundary on both surfaces.**
  - `lib/error-details.ts` — pure `formatErrorDetails(err, now?)` → ISO timestamp, message, Next.js digest, non-default `name`, stack. Shaped for paste-into-issue triage.
  - `components/health/error-screen.tsx` — shared friendly UI: `Card` with message, collapsible stack, Copy details / Continue / Quit. Copy uses `navigator.clipboard`; Quit uses `window.close`.
  - `app/error.tsx` (route-level) + `app/global-error.tsx` (root, includes `<html>`/`<body>`) both delegate to `ErrorScreen`.
  - `electron/main.ts#installCrashHandlers` runs before `whenReady` (catches startup crashes too). `showCrashDialog` uses `dialog.showMessageBoxSync` in a loop so Copy details doesn't dismiss — user copies, then still picks Continue or Quit. Pre-ready crashes log and `app.exit(1)` since the dialog API needs app ready.
  - `tests/unit/error-details.test.ts` covers plain error, digest, non-default name, missing message + stack fallback.

- **Slice 4 · Settings screen + main-window IPC bridge.**
  - `electron/preload-main.js` (new) — `contextBridge` exposes `window.health` with `getMaskedKey`, `replaceApiKey`, `revealUserData`, `revealLogs`, `getUserDataPath`, `getLogsPath`, `checkForUpdates`, `isElectron`. Main `BrowserWindow` now loads this preload.
  - `electron/main.ts#registerIpc()` wires the channels. `replaceApiKey` reuses `validateApiKey` + `saveApiKey`. `checkForUpdates` is a stub returning `{ status: "not-implemented" }` ahead of Phase 7.
  - `electron/main.ts#installAppMenu` — custom `Menu.buildFromTemplate` with a "Welcome to Health" + "Settings…" (⌘,) above the standard macOS items. `navigateTo(path)` `loadURL`s `${serverBaseUrl}${path}` on the main window.
  - `electron/mask-key.ts` — `maskApiKey(key)` keeps the `sk-ant-` prefix + last 4. Lives under `electron/` because only the main process needs it (for masking before sending over IPC). Unit-tested.
  - `app/settings/page.tsx` + `components/health/settings-client.tsx` — feature-detects `window.health` (`getBridge()`) so the page still renders under `pnpm dev`; Electron-only actions are disabled with a "requires the packaged app" notice. Four cards: API key (masked display + Replace dialog that validates + saves), Data folder (path + Reveal in Finder), Logs (path + Open log folder), Updates (Check button + Phase-7 notice), About.
  - Replace-key flow uses the existing `Dialog` primitive + same `sk-ant-` prefix sanity-check from first-run. "Validating…" state while the call runs.
  - Top-bar gains a "Settings" tab; `TopBar.current` widened to optional string so menu-reachable pages (Welcome) can pass through without a union-type fight.

- **Slice 5 · Onboarding + Open log folder.**
  - `app/welcome/page.tsx` — menu-reachable reference page. Four cards: what the app does, what stays local (naming Claude API as the only egress), supported report formats per provider group (blood panels / GI-microbiome / imaging-Phase-8), and a Get started row into `/uploads` / `/settings` / `/`. `force-static` since the content is evergreen.
  - App menu gains "Welcome to Health"; `navigateTo` generalised from `navigateToSettings` since both menu items share the load-URL pattern.
  - Settings page gains a Logs card backed by new IPC channels `health:reveal-logs` + `health:get-logs-path`; "Open log folder" matches the exit-criterion wording in PLAN.
  - Smoke test extended to assert `/settings` + `/welcome` return 200.

**Scope notes**
- CI workflow's first run caught a pnpm version conflict (`version: 10` in the action plus `packageManager: pnpm@10.29.2` in package.json). Fixed by dropping `version:` so the action reads `packageManager`.
- Testing standard is now load-bearing going forward: any new pure/testable code ships with a unit test; route handlers get an API test; only genuinely new surfaces get a smoke test. `tests/setup-data-dir.ts` is the reusable DB-isolation pattern.
- `checkForUpdates` is intentionally a stub — wiring `electron-updater` against a release feed is Phase 7's responsibility.
- All new Electron `.ts` modules (`validate-key.ts`, `logs.ts`, `mask-key.ts`) registered in `electron/tsconfig.json` include list; compiled `.js` siblings gitignored. The main-process crash dialog inlines its format string rather than importing `lib/error-details.ts` to avoid cross-rootDir gymnastics.
- Bundle id `com.lamthalabs.health` unchanged — Keychain entries from the first-run slice remain valid.

**Verified**
- `pnpm typecheck` / `pnpm lint` / `pnpm app:build-main` clean after every slice.
- `pnpm test` — 6 test files, 27 tests passing (5 validate-key · 6 logs · 5 error-details · 4 mask-key · 2 api/search · 5 smoke).
- CI green after the pnpm-version fix.
- Manual packaged-build walkthrough (first-run validation, Settings dialog, Reveal folder, Welcome menu, crash dialog) still owed to Paul — the smoke layer only exercises the Next side, not the Electron bridge.
