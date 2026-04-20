# Health

A local-first personal health dashboard. Ingests varied-format lab, GI, and clinical PDFs via the Claude API, stores normalized metrics in SQLite, and charts them over time across providers.

Single-user, runs entirely on your machine. The only network egress is to the Claude API for PDF extraction.

## Quick start

Requirements: Node 22+ (tested on Node 25), pnpm 10+, and an Anthropic API key.

```bash
git clone git@github.com:lamtha/health.git
cd health
pnpm install
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-...
pnpm db:migrate
pnpm dev
```

Open http://localhost:3000. First load shows an empty dashboard; head to `/uploads` to ingest your first PDF.

## Using it

### Upload reports

Go to **`/uploads`** and drop one or many PDFs (blood panel, GI-MAP, GI-360, Gut Zoomer, Viome, MARCoNS, imaging, etc.). Each drop creates a server-tracked upload you can navigate away from and return to via `/uploads/[id]`. PDFs are staged, hashed, and extracted by Claude in the background; duplicates are skipped by hash before any API call. Results land in `uploads/<sha256>.pdf` and the SQLite store.

### Browse

- **`/`** — dashboard grouped by flagged vs in-range, with a recent-reports sidebar.
- **`/metric/[name]`** — time-series chart for a single metric across providers, with reference-range band, per-provider toggles, and a units-mismatch guard.
- **`/reports/[id]`** — per-report detail: panels, the source PDF inline, extraction metadata, raw-JSON link, and an out-of-range sidecar. Each report has **Re-extract** and **Open source PDF** actions.

### Re-extract

Each report's **Re-extract** button re-sends the PDF to Claude and atomically replaces the stored metrics. Previous extractions are appended — never overwritten.

For bulk operations after a prompt upgrade:

```bash
pnpm re-extract                 # live re-run every report
pnpm re-extract -- --replay     # re-derive metrics from stored raw JSON (no Claude calls)
pnpm re-extract -- --only=1,3   # restrict to specific report IDs
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | *(required)* | Extraction credential |
| `ANTHROPIC_EXTRACTION_MODEL` | `claude-sonnet-4-6` | Override the extraction model |

## Data

- SQLite lives at `data/health.db` (gitignored). **This is the crown jewel — back it up.**
- User-uploaded PDFs live at `uploads/<hash>.pdf` (gitignored).
- Raw Claude output is kept in `extractions.raw_json` so metrics can be re-derived without re-spending API calls.

The app treats `~/Documents/health/reports/...` (or any path outside the repo) as **read-only**. It never writes, moves, or mutates source archives.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` / `pnpm start` | Production build + serve |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | `next lint` |
| `pnpm db:generate` | Drizzle: generate a migration from schema diff |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm re-extract` | Bulk re-extraction CLI (see above) |

## Stack

Next.js 15 (App Router, TypeScript) · Tailwind v4 + shadcn/ui · Recharts · SQLite via better-sqlite3 · Drizzle ORM · Anthropic SDK with native PDF input.

See [`VISION.md`](./VISION.md), [`ARCH.md`](./ARCH.md), and [`PLAN.md`](./PLAN.md) for scope, architecture, and roadmap. Per-phase changelog is in [`PROGRESS_LOG.md`](./PROGRESS_LOG.md).

## License

MIT — see [`LICENSE`](./LICENSE).
