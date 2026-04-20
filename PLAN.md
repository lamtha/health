# Implementation Plan

> Status: **v0.5 — Phases 0→6 shipped; Phase 7 distribution next.**
> Each phase lists: **Goal** · **Deliverables** · **Exit criteria**. Phases ship end-to-end; no phase "in progress" for weeks.

## Design reference

The `./design/` directory is the visual source of truth for the UI. Treat it as a **reference, not runtime code**:

- `design/shadcn/theme.css` — tokenized light theme (shadcn CSS-variable contract + health-specific semantics: flag high/low/ok, per-lab chart colors).
- `design/shadcn/ui.jsx` — shadcn-shaped primitives (Card, Button, Badge, Input, …) written to port 1:1 onto the real shadcn/ui library.
- `design/shadcn/lab-chart.jsx` — Recharts lab chart reference.
- `design/screens/` — chosen page layouts: `dashboard`, `metric`, `compare`, `upload`, `report`, `dna`. Each phase below cites the screen it realizes.
- `design/hifi/`, `design/wireframes/` — exploration archive. Not shipped.

Adoption is folded into the phases that touch each screen (see phase notes). Phase 1 includes a **Visual foundations** slice so everything after inherits the design system.

---

## Phase 0 — Foundations ✅

**Status:** Complete (2026-04-17).

**Goal:** docs aligned, scaffold up, DB schema in place, nothing real extracted yet.

**Deliverables**
- `VISION.md`, `ARCH.md`, `PLAN.md` reviewed and agreed.
- Next.js app scaffolded at repo root (TypeScript, App Router, Tailwind, shadcn/ui).
- `better-sqlite3` wired; `db.ts` exposes a singleton.
- `drizzle-orm` + `drizzle-kit` installed; schema defined in Drizzle; initial migration generated and applied (see ARCH.md for entities).
- `.env.example` with `ANTHROPIC_API_KEY`; `.env` gitignored.
- `pnpm dev` runs; visiting `/` shows an empty dashboard shell.

**Exit criteria**
- Paul can clone, `pnpm install`, `pnpm dev`, and see the empty dashboard.
- `sqlite3 data/health.db ".schema"` shows the expected tables.

---

## Phase 1 — Blood panel ingest ✅

**Status:** Complete (2026-04-17). See `PROGRESS_LOG.md`.

**Goal:** every existing blood-panel PDF in the archive becomes rows in the DB, rendered against the chosen design system. Ingest happens through the browser, not a CLI.

**Design reference:** `design/screens/dashboard.jsx` + `design/screens/upload.jsx` + `design/shadcn/theme.css` + `design/shadcn/ui.jsx`.

**Deliverables**
- **Visual foundations** (up front, before ingest):
  - Port `design/shadcn/theme.css` tokens into `app/globals.css` (shadcn CSS-variable contract + flag + chart semantics).
  - Wire fonts via `next/font`: Inter (sans), Fraunces (serif display), JetBrains Mono (mono).
  - Install the real shadcn primitives the screens use (`card`, `button`, `badge`, `input`, `separator`, `table`, `tabs`).
- Claude-based extractor (`lib/extract.ts`) that takes a PDF path and returns structured `{ report, metrics[] }`, validated by Zod.
- `/upload` route built against `design/screens/upload.jsx` — drag-and-drop → extract & review → confirm & save. Handles blood panels; GI stress-test is Phase 3.
- `POST /api/upload` stages the PDF under `uploads/.staging/{id}/`, runs extraction, returns preview; `POST /api/upload/{id}/confirm` persists `Report + Extraction + Panels + Metrics` in one transaction; `DELETE /api/upload/{id}` discards staging.
- Idempotent ingest via `reports.file_hash` unique constraint (detected on both upload and confirm).
- Raw Claude output persisted in `extractions.raw_json` for replay.
- `/` dashboard rebuilt against `design/screens/dashboard.jsx` — flagged-first metric grid, recent-reports sidebar, search input (search wiring is Phase 4).

**Exit criteria**
- Paul can drop any of the archived PDFs into `/upload`, review the extraction, and commit it to the DB.
- `/` matches the `dashboard.jsx` layout at the component + token level (no placeholder styling left).

---

## Phase 2 — Time-series charts ✅

**Status:** Complete (2026-04-17). See `PROGRESS_LOG.md`.

**Goal:** chart any metric over time, grouped by provider.

**Design reference:** `design/screens/metric.jsx` + `design/shadcn/lab-chart.jsx`.

**Deliverables**
- `/metric/[name]` route — Recharts line chart built from `design/shadcn/lab-chart.jsx` (one line per provider using `--lab-*` tokens, reference-range band using `--chart-ref`).
- `/` dashboard links to each metric's chart.
- Global time filter (last year / 2y / all).
- Provider legend with toggle.

**Exit criteria**
- Paul can click WBC and see a multi-year, multi-provider chart within one click from `/`.
- Units mismatches (mg/dL vs mg/L etc.) are flagged, not silently plotted.

---

## Phase 3 — Upload UI + GI ingest ✅

**Status:** Complete (2026-04-17). See `PROGRESS_LOG.md`.

**Goal:** drop a PDF in the browser → it's parsed, stored, charted. GI reports work too.

**Design reference:** `design/screens/report.jsx` (upload UI shipped in Phase 1).

**Deliverables**
- `/reports/[id]` detail view built against `design/screens/report.jsx` — raw PDF beside extracted values for spot-checking.
- Extend the existing extractor to handle GI-MAP, GI-360, Viome, Gut Zoomer, SIBO, MARCoNS, etc. (stress-test extraction prompt on GI formats).
- Bulk re-extraction tool for older reports when the prompt improves (replays from `extractions.raw_json` where possible; re-sends PDF only when the schema forces it).

**Exit criteria**
- All existing GI PDFs ingest successfully.
- Paul can upload a new report from the browser and see its metrics in the dashboard within ~60s.

---

## MVP COMPLETE → pause, evaluate, iterate based on real use.

---

## Post-MVP polish ✅ (2026-04-18)

**Goal:** smooth the two friction points that surface the moment you ingest the backlog for real — uploading one file at a time, and no first-class way to see all ingested reports.

**Shipped**
- **Mass ingest** on `/upload`. Multi-file drop/picker; when more than one file is selected, a confirm prompt offers auto-confirm. Files then process 3-way parallel with a live status table (queued / extracting / saved / duplicate / error) and direct links to each resulting (or pre-existing) report. Duplicate detection hashes before calling Claude, so dupes cost zero API spend.
- **`autoConfirm=1`** mode on `POST /api/upload` — single-shot stage → hash-dedupe → extract → promote → persist, skipping the staged review step. Existing single-file review flow is unchanged.
- **Reports tab + `/reports` index** — full listing of every ingested report (date, provider, category, metric count, flagged count, ingested date), sorted newest first. Top-bar gains a third tab; the report detail page now highlights it.

**Exit criteria**
- Paul can drop a folder of PDFs into `/upload`, hit OK on the auto-confirm prompt, and watch them all save (or skip as duplicates) without further clicks. ✅
- `/reports` shows every ingested report in a single scrollable table. ✅

---

## Phase 4 — Canonical metrics + exploration + clinician export ✅

**Status:** Complete (2026-04-18). See `PROGRESS_LOG.md`.

**Goal:** "WBC" and "White Blood Cell Count" and "Leukocytes" all plot as one line; let Paul search, compare, annotate, and hand a clean summary to a doctor.

**Design reference:** `design/screens/compare.jsx` (also wired up the dashboard search input from Phase 1).

**Shipped**
- `canonical_metrics` fully wired — 147 seeded entries across 18 categories + 8 cross-cutting tags. `metric_aliases` table (provider-scoped composite PK with global fallback). `/mappings` queue for human review.
- Dashboard + `/reports` group by canonical and filter by category / tag / "Unmapped" via a chip strip.
- Global search (`⌘K` or dashboard trigger) over canonical names + aliases + providers + report dates.
- `/compare` view — up to 4 canonical metrics on a shared time axis with per-metric ref bands and curated suggested pairings.
- `interventions` entity (supplement / med / diet / protocol) with create / stop / change / delete. Events widened to `start | stop | change | singleton`. Charts render interventions as translucent bands and singletons as dashed vertical lines.
- Clinician export at `/export` — pick date window + metrics, download PDF (cover + per-metric page with trend chart and observations table + interventions-in-window page) or CSV.

**Exit criteria**
- Searching "WBC" yields one canonical metric with all provider aliases unified. ✅
- Paul can annotate at least one real intervention and see it on a chart. ✅
- Paul can download a clinician-ready PDF summarizing the last 12 months of selected metrics. ✅

---

## Phase 5 — Electron shell + userData migration ✅

**Status:** Complete (2026-04-18). See `PROGRESS_LOG.md`.

**Goal:** wrap the Next.js app in an Electron shell so it runs as a native macOS application. All runtime state (SQLite DB, uploaded PDFs, staging, logs) routes through OS-conventional per-user locations rather than project-relative paths. Still a dev artifact — not distributed yet.

**Deliverables**
- Electron shell wrapping the current Next.js app. Web-dev loop (`pnpm dev`) still works; a new `pnpm app:dev` launches the shell against the app.
- `better-sqlite3` rebuilt against Electron's Node ABI during app build (`electron-rebuild` or equivalent).
- `lib/paths.ts` — single source of truth for `dbPath`, `uploadsDir`, `stagingDir`, `logsDir`. In web-dev uses `./data/` and `./uploads/`; in Electron uses `app.getPath('userData')`. All current hardcoded-path call sites migrate to it.
- Drop hardcoded `paul` references from app code and copy. The shipped artifact is the generic "Health" app.
- Unsigned macOS dev build via `electron-builder` — a `.app` bundle that launches, reads/writes into `~/Library/Application Support/Health/`, and behaves identically to the dev server.

**Exit criteria**
- `pnpm app:dev` brings up a native window with the full existing UI.
- The unsigned `.app` ingests a PDF and persists it under `~/Library/Application Support/Health/` — not under the project directory.
- No `paul` left in application code (repo search is clean; doc references OK).

---

## Phase 6 — First-run experience + error surfaces ✅

**Status:** Complete (2026-04-19). First-run key slice shipped with Phase 5; remaining UX landed in a five-slice run that also stood up the test harness + CI. See `PROGRESS_LOG.md`.

**Goal:** a user who has never opened a terminal can install, configure, and use the app without help.

**Shipped**
- **First-run setup** — `electron/main.ts#ensureApiKey` shows `electron/first-run.html` on launch when no stored key is present (packaged builds only). Welcome + consent copy explains the Anthropic egress, a password field accepts the key, a "Where do I get one?" link opens `console.anthropic.com` via `shell.openExternal`, and `sk-ant-` prefix is sanity-checked client-side. Keys persist via `safeStorage.encryptString` to `userData/keychain.bin` (macOS Keychain-backed). IPC channel: `health:save-api-key`.
- **API-key validation** — `electron/validate-key.ts` runs a cheap `GET /v1/models?beta=true` before writing to Keychain; 401/403 surface as "Anthropic rejected that key", network errors surface as unreachable, other non-2xx include status + body snippet. First-run button switches to "Validating…" during the call.
- **Settings screen** — `/settings` route with four cards (API key view + Replace dialog, Data folder + Reveal in Finder, Logs + Open log folder, Updates + Check for updates stub, About). Reachable from the top-bar and from ⌘, via a custom Electron app menu. A new main-window preload (`electron/preload-main.js`) exposes `window.health.{getMaskedKey, replaceApiKey, revealUserData, revealLogs, getUserDataPath, getLogsPath, checkForUpdates}`. Feature-detects the bridge so the page still renders in `pnpm dev`.
- **Onboarding screen** — `/welcome` menu-reachable page explaining what the app does, what stays local (naming Claude API as the only egress), supported report formats per provider group, and a Get started row. App menu gains a "Welcome to Health" item.
- **Global error boundary** — `lib/error-details.ts` formatter powers both surfaces: `app/error.tsx` + `app/global-error.tsx` render `components/health/error-screen.tsx` with Copy details / Continue / Quit. Electron main's `installCrashHandlers()` handles `uncaughtException` + `unhandledRejection` with a native `showMessageBoxSync` loop so Copy doesn't dismiss.
- **Rolling local log** in `userData/logs/` — `electron/logs.ts` pure helpers (`currentLogFilename`, `pruneOldLogs`, `openLogFile`, `installConsoleTee`, `formatLogLine`) drive daily `health-YYYY-MM-DD.log` rotation with a 14-day keep window. In packaged mode Electron main tee's its own console and pipes the Next child's stdout/stderr into the same file; dev keeps `stdio: inherit` and doesn't write files.

**Test harness + CI (shipped alongside)** — vitest with three projects (`unit` / `api` / `smoke`), `server-only` aliased to a stub, per-worker tmpdir DB for api + smoke via `tests/setup-data-dir.ts`. GitHub Actions `.github/workflows/ci.yml` runs `typecheck → lint → app:build-main → test` on every PR and every push to `main`. See the new **Tests** section in `CLAUDE.md`.

**Exit criteria**
- A fresh install with no stored key lands on setup; entering a valid key takes the user to an empty dashboard. ✅
- Entering an invalid key on first-run surfaces a red error before the dashboard loads. ✅
- Forcing a bad PDF produces the friendly error dialog, not a stack trace or blank screen. ✅ (route + root error boundaries; main-process uncaughtException handler)
- Onboarding screen reachable from the menu at any time. ✅

---

## Phase 7 — Distribution + auto-update (friends & family release)

**Goal:** Paul can send a download link to a friend; they install and run without developer tooling, and subsequent versions update themselves.

**Deliverables**
- Apple Developer Program membership ($99/yr operational cost) and code-signing certificates configured locally.
- Signing + notarization pipeline in `electron-builder` — produces a signed, notarized DMG. `.env.example` gains the cert identifier fields.
- `electron-updater` wired against a releases feed (GitHub Releases as the starting point). Check-on-launch, silent background download, "Restart to update" prompt. First version ships the updater enabled with nothing newer to fetch.
- Release script: bump version → tag → build → notarize → upload to the releases feed. Run from Paul's machine; no CI yet.
- One-page `INSTALL.md` for F&F recipients: download link, first-run notes, how to update, how to reach Paul if something breaks.
- Short release notes surfaced in-app after an update.

**Exit criteria**
- A friend on a stock macOS install downloads the DMG, drags to Applications, and opens without Gatekeeper warnings.
- Paul tags a v0.2 release; an existing v0.1 install detects and applies the update on next launch.

---

## Phase 8 — Lower-priority categories

**Goal:** imaging, clinical notes, epigenetics, wearables parsed and browsable (less quantitative, more document-centric).

**Deliverables**
- Extraction strategy for narrative/image-heavy reports (summaries + key findings rather than numeric metrics).
- `/reports` index — browse raw PDFs with extracted summaries.
- TruDiagnostic biological-age metrics plotted on main dashboard.
- Whoop monthly aggregates (if structured) plotted.

**Exit criteria**
- Paul can find any of his ~50 reports in the UI and see an extracted summary alongside.

---

## Phase 9 — DNA sidecar

**Goal:** integrate the 100x sequence once it arrives.

**Design reference:** `design/screens/dna.jsx`.

**Deliverables**
- Decision on delivery format (VCF? raw FASTQ? provider portal?) — drives sidecar design.
- Python sidecar (FastAPI) for variant annotation and querying (scikit-allel / hail / pysam TBD).
- Next.js talks to sidecar over local HTTP.
- `/dna` tab built against `design/screens/dna.jsx` — gene–metric cross-reference view (e.g. MTHFR variants alongside homocysteine trend).

**Exit criteria**
- Paul can look up a gene and see its variants alongside any relevant blood/GI metric over time.

---

## Phase 10 — Deterministic ingestion + local-first mapping

**Goal:** eliminate mandatory LLM egress for the most common blood + GI formats. Fresh installs without an Anthropic key get working extraction and canonical mapping out of the box. Claude becomes a fallback for unparsed providers and genuinely-semantic decisions rather than the default path.

**Motivation:** VISION is local-first personal health. Today every ingest ships the PDF to Claude — a real adoption barrier for privacy-conscious users and a real cost concern at scale. LabCorp / Quest / GI-MAP layouts are structured enough to parse deterministically; alias resolution is largely `normalize + fuzzy-match` and doesn't need a model.

**Deliverables** (high level — scope properly when approached)
- Provider-detection pass that routes a PDF to the right deterministic parser based on file signature.
- Deterministic parsers for the highest-volume formats. Starting set: LabCorp, Quest, GI-MAP. Each its own module with a fixture-based test suite so format drift fails loudly.
- Rules-first canonical mapping — normalize + fuzzy-match alias resolution and regex skip detection. LLM retained only for category assignment on genuine create_new decisions.
- LLM extraction retained as a fallback when no deterministic parser claims the PDF, and for imaging / narrative formats that won't ever parse structurally.
- API key becomes **optional** at first-run rather than mandatory; Settings gains a "No key — local-only mode" state.

**Exit criteria**
- A fresh install with no Anthropic key can ingest a LabCorp, Quest, and GI-MAP PDF end-to-end.
- The bulk-map review flow completes ≥80% of typical unmapped rows without any Claude calls.
- Parser fixture suites run in CI; a LabCorp layout change fails a test before it breaks a real ingest.

---

## Cross-cutting / ongoing

- **Extraction quality** — periodically spot-check a random report; log low-confidence extractions for review.
- **Backup** — the SQLite DB is the crown jewel. Dev: `./data/health.db`. Packaged app: `~/Library/Application Support/Health/health.db`. Document a simple backup cadence.
- **Memory/notes** — keep VISION/ARCH/PLAN in sync as decisions are made across sessions.

## Open questions

- [ ] How aggressive to be about units normalization at ingest vs at chart time? (Revisit during Phase 4 canonical-metric work.)
- [ ] Distribution channel — public GitHub Releases vs a private bucket for F&F-only? (Phase 7.)
- [ ] Error reporting — in-app "copy logs to clipboard" only, or opt-in telemetry back to Paul? Latter crosses the local-first line; default is to avoid. (Phase 6.)
- [ ] API-key handling if a user's key is revoked mid-session — prompt for a new one vs. lock to read-only? (Phase 6.)
- [ ] Public-beta trigger — what signal flips us from F&F to a broader release? (Phase 7+.)

## Resolved decisions

- Interventions/journal ships in **Phase 4** (not MVP).
- Re-extractions **append** a new `Extraction` row.
- Schema managed via **Drizzle** (`drizzle-orm` + `drizzle-kit`).
- **Clinician export** is a Phase 4 deliverable.
- **Design system adoption** folds into the phase that needs each screen (not a standalone phase). Phase 1 does a "Visual foundations" slice up front so later phases inherit the tokens, fonts, and shadcn primitives. `./design/` is the reference; JSX is ported to typed TSX as we go.
- **Distribution** — Electron wrapper around the existing Next.js app; macOS (Apple Silicon) first, Windows contributor-built later. F&F signed DMG precedes any public release. Packaging (Phases 5–7) sequences *after* Phase 4 so distributed users get unified metrics + clinician export in the first release. (2026-04-18)
