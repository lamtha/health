# CLAUDE.md — Health project handoff

> Orientation for Claude Code sessions working on this repo.
> Read this file fully at the start of every session, then read the three living docs before writing code.

## What this project is

A **local-first personal health dashboard** for one user (Paul). It ingests varied-format health PDFs (blood panels, GI tests, imaging, etc.) via Claude API extraction, stores normalized metrics in SQLite, and charts them over time across providers.

## Read these first, every session

1. [`VISION.md`](./VISION.md) — mission, users, success criteria, non-goals. **The "why."**
2. [`ARCH.md`](./ARCH.md) — systems, components, entity model, key flows, extension points. **The "what and how, high-level."**
3. [`PLAN.md`](./PLAN.md) — phased roadmap with exit criteria per phase. **The "in what order."**
4. [`PROGRESS_LOG.md`](./PROGRESS_LOG.md) — append-only record of what actually shipped per phase (and post-MVP iterations). **The "what's already done, concretely."**

The first three are **living** — update them as decisions land. `PROGRESS_LOG.md` is **append-only** — add a new section when a phase (or notable iteration) ships; don't rewrite history. Do **not** let implementation drift from any of these without syncing.

## Working conventions (non-negotiable)

- **MVP end-to-end first.** Thin slice across the full stack before deepening any layer. If you catch yourself gold-plating a single phase, stop.
- **Collaborate on major decisions.** Before making architectural, scope, or tech-choice changes, propose options to the user and wait. Silently picking is not OK.
- **Read-only source archive.** `~/Documents/health/reports/paul/` is Paul's canonical archive. The app **never** writes, moves, renames, or mutates anything in that directory. Reference by absolute path only. User-uploaded PDFs go to a project-local `uploads/` dir.
- **Docs stay in sync.** When you finish a phase in `PLAN.md`, mark it done. When an architectural decision changes, update `ARCH.md`. When scope shifts, update `VISION.md`. **`ARCH.md` stays above the engineering/class layer** — no file trees, no class diagrams.
- **Schema goes through Drizzle.** All schema changes via `drizzle-orm` + `drizzle-kit`. No ad-hoc SQL migrations.
- **Extraction is replayable.** Persist raw Claude output in the `extractions` table so we can re-derive metrics without re-spending API calls.

## Engineering philosophy

- **DRY.** One source of truth per concept. If you're copy-pasting a third time, extract — but not before (two is fine, three is the smell).
- **Root-cause fixes.** When something breaks, find the actual cause and fix it there. No try/except-swallow, no defensive workarounds layered over a broken invariant, no "make the symptom go away" patches.
- **Fail-fast.** Raise on exceptional conditions; don't catch-and-continue. A malformed extraction, a missing env var, a corrupt row — surface it loudly. Silent fallbacks hide real bugs, and in a single-user local app there is no user to protect from a stack trace.
- **Log at the right level, generously.** `debug` for flow, `info` for ingestion milestones (file received, extraction complete, metrics written), `warn` for recoverable-but-weird, `error` for failures. Include the report id / file name / phase so logs are greppable across a multi-file ingest.
- **YAGNI.** Don't build for hypothetical future reports, providers, or users. Three concrete cases beat one premature abstraction — especially true pre-MVP.
- **Validate at boundaries, trust within.** User uploads, Claude API output, and data read back from SQLite are boundaries — validate there (zod or explicit checks). Internal code trusts its callers.
- **Idempotent ingestion.** Re-uploading the same PDF, or re-running extraction on a stored raw payload, must not double-count metrics or corrupt state. Derive, don't accumulate.
- **Isolate the non-deterministic.** Claude extraction is the only non-deterministic seam in the app. Keep it behind a clean interface so the rest of the system (canonical mapping, charting, queries) stays pure and testable.
- **Small, reversible commits.** Each commit should leave the app runnable. Matches the MVP-first ethos and makes `git bisect` useful when extraction quality regresses.

## Current phase

**Phase 0 — Foundations** (not yet started at handoff).

Deliverables for Phase 0 (from `PLAN.md`):
- Next.js 15 app scaffolded at the repo root (TypeScript, App Router, Tailwind, shadcn/ui).
- `better-sqlite3` wired; `db.ts` exposes a singleton.
- `drizzle-orm` + `drizzle-kit` installed; schema defined in Drizzle matching the ER model in `ARCH.md`; initial migration generated and applied.
- `.env.example` with `ANTHROPIC_API_KEY`; `.env` gitignored.
- `pnpm dev` runs; `/` shows an empty dashboard shell.

Exit criteria: clone → `pnpm install` → `pnpm dev` → empty dashboard loads; `sqlite3 data/health.db ".schema"` shows the expected tables.

## Stack (brief — full details in `ARCH.md`)

- **Runtime:** Node **22+** (see `engines` in `package.json`; actively tested on Node 25).
- **Package manager:** pnpm.
- **Framework:** Next.js 15 (App Router, TypeScript).
- **UI:** Tailwind + shadcn/ui; Recharts for charts.
- **DB:** SQLite via `better-sqlite3`, schema via `drizzle-orm` + `drizzle-kit`.
- **Extraction:** `@anthropic-ai/sdk` with native PDF input.
- **Target platform:** macOS arm64 (Paul's machine). Single-user, local-only.

## Layout

```
/Users/paul/projects/health/
├── VISION.md, ARCH.md, PLAN.md, CLAUDE.md   ← docs
├── PROGRESS_LOG.md                           ← append-only shipped-state log
├── app/                                      ← Next.js App Router
├── lib/                                      ← db, extraction service, canonical mapper, paths helper
├── db/                                       ← drizzle schema + generated migrations
├── drizzle/                                  ← drizzle-kit migration output
├── electron/                                 ← Electron main + preload + first-run HTML (main.js is generated)
├── scripts/                                  ← db migrate, re-extract
├── data/health.db                            ← SQLite (dev), gitignored
├── uploads/                                  ← user-uploaded PDFs (dev), gitignored
├── dist/                                     ← packaged .app output, gitignored
└── .env                                      ← ANTHROPIC_API_KEY (dev only), gitignored
```

The canonical source archive at `~/Documents/health/reports/paul/` is **outside** the repo and read-only.

Under Electron, DB and uploads route to `~/Library/Application Support/Health/` instead of the project-relative paths above — the `lib/paths.ts` helper handles the branching.

## Environment

- `.env` (gitignored) must contain:
  - `ANTHROPIC_API_KEY=...` (Paul will provide)
- Commit a `.env.example` with the key names and empty values.

## Commands

- `pnpm dev` — Next.js dev server in the browser
- `pnpm build` / `pnpm start` — production build + serve
- `pnpm app:dev` — launch the Electron shell against a `next dev` child
- `pnpm app:build` — produce an unsigned macOS `.app` at `dist/mac-arm64/Health.app` (full pipeline, including native-module ABI handling)
- `pnpm db:generate` — drizzle-kit: generate migration from schema diff
- `pnpm db:migrate` — apply pending migrations (dev only; packaged app auto-migrates on startup)
- `pnpm lint` / `pnpm typecheck` — keep green
- `pnpm test` — run every test layer (unit + api + smoke); CI runs this on every PR
- `pnpm test:unit` / `pnpm test:api` / `pnpm test:smoke` — run one layer
- `pnpm test:watch` — vitest watch mode for iterative work

Ingest happens through the `/uploads` page in the browser (or the Electron window), not a CLI. Single- and multi-file drops both go through the server-tracked upload flow.

## Tests

Tests live under `tests/` and run via **vitest**. Three layers, each a named vitest project:

- **`tests/unit/`** — pure functions, mocked I/O. Fast (ms). Example: `validate-key.test.ts` exercises `electron/validate-key.ts` with a mocked `fetch`.
- **`tests/api/`** — Next.js route handlers invoked directly with a `Request` object. `tests/setup-data-dir.ts` points `HEALTH_USER_DATA_DIR` at a tmpdir before any DB module loads, and `lib/db.ts`'s auto-migrate-on-load path provisions the schema + canonical seeds. No HTTP server, so these run in ~500ms.
- **`tests/smoke/`** — spin `next dev` on a free port in `beforeAll` and hit real URLs. Slower (3–5s boot). Catches integration gaps the other layers miss.

When to write which:

- **Pure function, no DB / network / Electron?** → unit test, mock any deps.
- **Touches the DB or a route handler?** → api test. Reuse the `tests/setup-data-dir.ts` pattern.
- **Something only the full stack can break (routing, middleware, RSC/SSR wiring)?** → smoke test. Keep these lean — add one when a layer is new, not one per page.

Rules:

- New pure/testable code ships with a test. Extracting logic out of `electron/main.ts` or a route handler into a testable module is part of the task, not follow-up.
- Tests must pass in CI before merge. Local verification: `pnpm typecheck && pnpm lint && pnpm test`.
- `server-only` is aliased to an empty stub under vitest (`tests/stubs/server-only.ts`) so server modules can be imported directly.
- API + smoke projects run `maxWorkers: 1` because they share a per-worker DB singleton; don't parallelise.

## Don't

- Don't write to `~/Documents/health/reports/paul/`. Ever.
- Don't hand-write SQL migrations — use Drizzle.
- Don't skip the `extractions` table to "save a row" — replayability is load-bearing.
- Don't invent providers or categories in the schema without discussing first.
- Don't push Python into the main app. The DNA sidecar is post-MVP and lives in a separate process.
- Don't expand `ARCH.md` into class/file-level detail. Keep it conceptual.
- Don't commit `data/health.db`, `uploads/`, `dist/`, or `.env`.
- Don't change the bundle identifier `com.lamthalabs.health`. It keys the macOS Keychain entry holding each user's stored API key (Phase 6) and will key the auto-update channel (Phase 7). Changing it post-distribution orphans saved keys.

## When in doubt

- **Scope ambiguity?** → `VISION.md` + ask the user.
- **How do entities relate?** → `ARCH.md` ER diagram.
- **What's next?** → `PLAN.md` current phase.
- **Changing a decision?** → propose to the user, then update the relevant doc in the same commit as the code change.

## Using Claude Code features

- When asked about a library/framework/SDK, prefer **Context7 MCP** (`resolve-library-id` → `query-docs`) over web search or training data. This repo uses Next.js 15, Drizzle, and the Anthropic SDK — all actively evolving.
- Use the **architecture skill** only when `ARCH.md` needs a material structural update — don't regenerate from scratch.
