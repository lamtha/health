import fs from "node:fs";
import path from "node:path";

// Tiny .env loader so the script runs without adding a dotenv dependency.
function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { and, eq, isNull, sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import * as schema from "@/db/schema";
import {
  canonicalMetrics,
  metricAliases,
  metrics as metricsTable,
  reports,
} from "@/db/schema";
import { dbPath } from "@/lib/paths";
import { normalizeRawName } from "@/lib/canonical-util";
import {
  CATEGORIES,
  TAGS,
  isCategorySlug,
  isTagSlug,
  type CategorySlug,
  type TagSlug,
} from "@/db/seeds/taxonomy";
import { CANONICAL_METRICS } from "@/db/seeds/canonical-metrics";

// ─── Config ──────────────────────────────────────────────────────────────

const DEFAULT_PROPOSALS_PATH = path.join(
  process.cwd(),
  "scripts",
  "bulk-map-proposals.json",
);
const DEFAULT_BATCH_SIZE = 40;
const DEFAULT_MODEL = process.env.ANTHROPIC_MAPPING_MODEL ?? "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 16_000;

// ─── Proposal shape (what gets written to disk) ──────────────────────────

const Proposal = z.discriminatedUnion("action", [
  z.object({
    rawName: z.string().min(1),
    occurrenceCount: z.number().int().positive(),
    sampleProviders: z.array(z.string()),
    action: z.literal("map_existing"),
    canonicalMetricId: z.number().int().positive(),
    canonicalName: z.string().min(1),
    confidence: z.number().min(0).max(1),
    reason: z.string().optional(),
  }),
  z.object({
    rawName: z.string().min(1),
    occurrenceCount: z.number().int().positive(),
    sampleProviders: z.array(z.string()),
    action: z.literal("create_new"),
    newCanonical: z.object({
      canonicalName: z.string().min(1),
      category: z.string().refine(isCategorySlug),
      tags: z.array(z.string().refine(isTagSlug)),
      preferredUnits: z.string().nullable(),
      description: z.string(),
    }),
    // Strain / substrain variants that were folded into this canonical
    // during --fixup self-heal. Each becomes an additional global alias
    // on apply.
    extraAliases: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1),
    reason: z.string().optional(),
  }),
  z.object({
    rawName: z.string().min(1),
    occurrenceCount: z.number().int().positive(),
    sampleProviders: z.array(z.string()),
    action: z.literal("skip"),
    reason: z.string(),
    confidence: z.number().min(0).max(1),
  }),
]);
type Proposal = z.infer<typeof Proposal>;

const ProposalsFile = z.object({
  generatedAt: z.string(),
  model: z.string(),
  totalUnmapped: z.number().int().nonnegative(),
  proposed: z.number().int().nonnegative(),
  proposals: z.array(Proposal),
});

// What Claude returns per row, before we enrich with occurrence data.
// Category + tags are parsed loosely here (plain strings) and sanitised
// downstream — Claude occasionally invents a slug outside the allowed set,
// and we don't want one stray tag to fail the whole 40-row batch.
const ClaudeProposal = z.discriminatedUnion("action", [
  z.object({
    rawName: z.string().min(1),
    action: z.literal("map_existing"),
    canonicalName: z.string().min(1),
    confidence: z.number().min(0).max(1),
    reason: z.string().optional(),
  }),
  z.object({
    rawName: z.string().min(1),
    action: z.literal("create_new"),
    newCanonical: z.object({
      canonicalName: z.string().min(1),
      category: z.string(),
      tags: z.array(z.string()),
      preferredUnits: z.string().nullable(),
      description: z.string(),
    }),
    confidence: z.number().min(0).max(1),
    reason: z.string().optional(),
  }),
  z.object({
    rawName: z.string().min(1),
    action: z.literal("skip"),
    reason: z.string(),
    confidence: z.number().min(0).max(1),
  }),
]);
const ClaudeBatch = z.object({ proposals: z.array(ClaudeProposal) });

// ─── DB setup ────────────────────────────────────────────────────────────

function openDb() {
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

interface UnmappedRow {
  rawName: string;
  occurrenceCount: number;
  sampleProviders: string[];
}

function gatherUnmapped(
  db: ReturnType<typeof openDb>["db"],
): UnmappedRow[] {
  const rows = db
    .select({
      name: metricsTable.name,
      provider: reports.provider,
      count: sql<number>`COUNT(*)`,
    })
    .from(metricsTable)
    .innerJoin(reports, eq(metricsTable.reportId, reports.id))
    .where(isNull(metricsTable.canonicalMetricId))
    .groupBy(metricsTable.name, reports.provider)
    .all();

  const byRaw = new Map<string, UnmappedRow>();
  for (const row of rows) {
    const key = normalizeRawName(row.name);
    if (!key) continue;
    const existing = byRaw.get(key);
    if (existing) {
      existing.occurrenceCount += Number(row.count);
      if (row.provider && !existing.sampleProviders.includes(row.provider)) {
        existing.sampleProviders.push(row.provider);
      }
    } else {
      byRaw.set(key, {
        rawName: row.name.trim(),
        occurrenceCount: Number(row.count),
        sampleProviders: row.provider ? [row.provider] : [],
      });
    }
  }
  return [...byRaw.values()].sort(
    (a, b) => b.occurrenceCount - a.occurrenceCount,
  );
}

interface ExistingCanonical {
  id: number;
  canonicalName: string;
  category: string;
}

function loadExistingCanonicals(
  db: ReturnType<typeof openDb>["db"],
): ExistingCanonical[] {
  return db
    .select({
      id: canonicalMetrics.id,
      canonicalName: canonicalMetrics.canonicalName,
      category: canonicalMetrics.category,
    })
    .from(canonicalMetrics)
    .all();
}

// ─── Propose phase ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a medical-informatics assistant mapping raw lab-report metric names to a fixed canonical taxonomy.

You will receive:
1. The full list of existing canonical metrics (with category).
2. The allowed category slugs and tag slugs (fixed — do not invent new ones).
3. A batch of raw names that appeared on lab reports but did not resolve to any existing canonical.

For each raw name, pick exactly one action:

- "map_existing" — the raw name is a known synonym / spelling variant of an existing canonical. Return the exact canonicalName from the list.
- "create_new" — the raw name is a genuine new metric not yet in the taxonomy. Return canonicalName (Title Case, concise), category (one allowed slug), tags (zero or more allowed slugs), preferredUnits (string or null — use null for categorical or species-abundance metrics), and a one-sentence description. Prefer existing over new whenever the match is reasonable.
- "skip" — the raw name is unparseable, a header/footer artifact, truly ambiguous, or clearly not a health metric. Always include a reason.

Rules for GI species (very common in this dataset):
- Individual bacterial species from GI-MAP / Gut Zoomer / Viome go under "gi-microbiome" for commensals/beneficial/general residents, "gi-pathogens" for known pathogens (H. pylori, C. difficile, Salmonella, parasites, worms, Candida spp. when flagged as pathogen). Species names should keep the scientific binomial as the canonicalName (e.g. "Akkermansia muciniphila").
- Functional markers (calprotectin, zonulin, secretory IgA, elastase) go under "gi-inflammation" or "gi-digestion" as appropriate.
- SCFAs (butyrate, acetate, propionate, etc.) go under "gi-digestion".
- SIBO breath-test gases (hydrogen, methane at time points) go under "sibo".

Output format: return ONLY a single JSON object, no prose, no markdown fences:

{
  "proposals": [
    {
      "rawName": "<echo back exactly>",
      "action": "map_existing",
      "canonicalName": "<exact match from existing list>",
      "confidence": 0.92,
      "reason": "optional — why this mapping"
    },
    {
      "rawName": "...",
      "action": "create_new",
      "newCanonical": {
        "canonicalName": "...",
        "category": "gi-microbiome",
        "tags": [],
        "preferredUnits": null,
        "description": "..."
      },
      "confidence": 0.85
    },
    {
      "rawName": "...",
      "action": "skip",
      "reason": "looks like a panel header, not a metric",
      "confidence": 0.95
    }
  ]
}`;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function callClaudeForBatch(
  client: Anthropic,
  existing: ExistingCanonical[],
  batch: UnmappedRow[],
): Promise<z.infer<typeof ClaudeBatch>> {
  const existingList = existing
    .map((c) => `- "${c.canonicalName}"  (${c.category})`)
    .join("\n");

  const userMsg =
    `EXISTING CANONICALS (${existing.length}):\n${existingList}\n\n` +
    `ALLOWED CATEGORIES: ${CATEGORIES.join(", ")}\n` +
    `ALLOWED TAGS: ${TAGS.join(", ")}\n\n` +
    `RAW NAMES TO MAP (${batch.length}):\n` +
    batch
      .map(
        (r) =>
          `- "${r.rawName}"  (seen ${r.occurrenceCount}× across providers: ${r.sampleProviders.join(", ") || "unknown"})`,
      )
      .join("\n");

  const resp = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: DEFAULT_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMsg }],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error(
      `Claude returned no JSON object. First 200 chars: ${text.slice(0, 200)}`,
    );
  }

  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  return ClaudeBatch.parse(parsed);
}

async function propose(opts: {
  outputPath: string;
  limit?: number;
  batchSize: number;
}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is required. Set it in .env before running bulk-map.",
    );
  }

  const { sqlite, db } = openDb();
  const existing = loadExistingCanonicals(db);
  let unmapped = gatherUnmapped(db);
  const totalUnmapped = unmapped.length;
  if (opts.limit && opts.limit < unmapped.length) {
    unmapped = unmapped.slice(0, opts.limit);
  }
  sqlite.close();

  console.log(
    `[bulk-map] ${totalUnmapped} distinct unmapped raw names; existing canonicals: ${existing.length}`,
  );
  console.log(
    `[bulk-map] proposing for ${unmapped.length} (${opts.batchSize}/batch)…`,
  );

  const client = new Anthropic();
  const batches = chunk(unmapped, opts.batchSize);
  const byRaw = new Map<string, UnmappedRow>(
    unmapped.map((r) => [normalizeRawName(r.rawName), r]),
  );
  const canonicalByName = new Map<string, ExistingCanonical>(
    existing.map((c) => [c.canonicalName.toLowerCase(), c]),
  );

  const proposals: Proposal[] = [];
  const failedBatches: { batchIdx: number; error: string; names: string[] }[] = [];
  let batchIdx = 0;
  for (const batch of batches) {
    batchIdx += 1;
    console.log(
      `[bulk-map]   batch ${batchIdx}/${batches.length} (${batch.length} names)…`,
    );

    let result: z.infer<typeof ClaudeBatch>;
    try {
      result = await callClaudeForBatch(client, existing, batch);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[bulk-map]   ⚠ batch ${batchIdx} failed: ${msg.slice(0, 200)} — continuing`,
      );
      failedBatches.push({
        batchIdx,
        error: msg,
        names: batch.map((r) => r.rawName),
      });
      continue;
    }

    for (const p of result.proposals) {
      const key = normalizeRawName(p.rawName);
      const source = byRaw.get(key);
      if (!source) {
        console.warn(
          `[bulk-map]   ⚠ Claude returned a raw name not in the batch: ${p.rawName} — skipping`,
        );
        continue;
      }
      const common = {
        rawName: source.rawName,
        occurrenceCount: source.occurrenceCount,
        sampleProviders: source.sampleProviders,
        confidence: p.confidence,
      };
      if (p.action === "map_existing") {
        const match = canonicalByName.get(p.canonicalName.toLowerCase());
        if (!match) {
          proposals.push({
            ...common,
            action: "skip",
            reason: `Claude proposed map_existing to "${p.canonicalName}" but no such canonical exists — needs human review`,
          });
          continue;
        }
        proposals.push({
          ...common,
          action: "map_existing",
          canonicalMetricId: match.id,
          canonicalName: match.canonicalName,
          reason: p.reason,
        });
      } else if (p.action === "create_new") {
        // Sanitise Claude output: coerce unknown category → "other", drop
        // unknown tags. Keeps the run robust when the model strays outside
        // the fixed taxonomy.
        const rawCategory = p.newCanonical.category;
        const category: CategorySlug = isCategorySlug(rawCategory)
          ? rawCategory
          : "other";
        if (!isCategorySlug(rawCategory)) {
          console.warn(
            `[bulk-map]   ⚠ unknown category "${rawCategory}" for "${p.rawName}" → coerced to "other"`,
          );
        }
        const rawTags = p.newCanonical.tags;
        const tags = rawTags.filter(isTagSlug) as TagSlug[];
        const droppedTags = rawTags.filter((t) => !isTagSlug(t));
        if (droppedTags.length) {
          console.warn(
            `[bulk-map]   ⚠ dropped unknown tag(s) on "${p.rawName}": ${droppedTags.join(", ")}`,
          );
        }
        proposals.push({
          ...common,
          action: "create_new",
          newCanonical: {
            canonicalName: p.newCanonical.canonicalName,
            category,
            tags,
            preferredUnits: p.newCanonical.preferredUnits,
            description: p.newCanonical.description,
          },
          reason: p.reason,
        });
      } else {
        proposals.push({ ...common, action: "skip", reason: p.reason });
      }
    }

    // Incremental checkpoint after every successful batch so a crash
    // doesn't lose prior work.
    writeProposalsFile(opts.outputPath, {
      generatedAt: new Date().toISOString(),
      model: DEFAULT_MODEL,
      totalUnmapped,
      proposed: proposals.length,
      proposals,
    });
  }

  // Check for raw names Claude didn't return at all.
  const returned = new Set(
    proposals.map((p) => normalizeRawName(p.rawName)),
  );
  const missing = unmapped.filter(
    (u) => !returned.has(normalizeRawName(u.rawName)),
  );
  if (missing.length) {
    console.warn(
      `[bulk-map] ⚠ ${missing.length} raw names had no proposal from Claude (will be retained as unmapped):`,
    );
    for (const m of missing.slice(0, 10))
      console.warn(`            · ${m.rawName} (${m.occurrenceCount}×)`);
    if (missing.length > 10)
      console.warn(`            … and ${missing.length - 10} more`);
  }

  writeProposalsFile(opts.outputPath, {
    generatedAt: new Date().toISOString(),
    model: DEFAULT_MODEL,
    totalUnmapped,
    proposed: proposals.length,
    proposals,
  });

  const byAction = proposals.reduce<Record<string, number>>((acc, p) => {
    acc[p.action] = (acc[p.action] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    [
      `[bulk-map] wrote ${proposals.length} proposals → ${opts.outputPath}`,
      `             map_existing:   ${byAction.map_existing ?? 0}`,
      `             create_new:     ${byAction.create_new ?? 0}`,
      `             skip:           ${byAction.skip ?? 0}`,
      `             (missing:       ${missing.length})`,
      `             (failed batches: ${failedBatches.length})`,
      ``,
      `Review the JSON file, then run:  pnpm bulk-map --apply`,
    ].join("\n"),
  );

  if (failedBatches.length) {
    console.warn(
      `[bulk-map] ⚠ ${failedBatches.length} batch(es) failed. Names not proposed:`,
    );
    for (const b of failedBatches) {
      console.warn(`            batch ${b.batchIdx}: ${b.error.slice(0, 120)}`);
      console.warn(`              first names: ${b.names.slice(0, 3).join(", ")}${b.names.length > 3 ? ", …" : ""}`);
    }
    console.warn(
      `            Re-run \`pnpm bulk-map\` to retry — already-proposed names won't be re-queried (they're no longer unmapped once --apply runs).`,
    );
  }
}

function writeProposalsFile(
  filePath: string,
  output: z.infer<typeof ProposalsFile>,
) {
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2) + "\n");
}

// ─── Apply phase ─────────────────────────────────────────────────────────

function apply(opts: { inputPath: string }) {
  if (!fs.existsSync(opts.inputPath)) {
    throw new Error(
      `Proposals file not found at ${opts.inputPath}. Run \`pnpm bulk-map\` first.`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(opts.inputPath, "utf8"));
  const parsed = ProposalsFile.parse(raw);

  const actionable = parsed.proposals.filter(
    (p) => p.action === "map_existing" || p.action === "create_new",
  );
  const skipped = parsed.proposals.filter((p) => p.action === "skip");

  console.log(
    [
      `[bulk-map] applying from ${opts.inputPath}`,
      `             proposals:    ${parsed.proposals.length}`,
      `             actionable:   ${actionable.length}`,
      `             skipped:      ${skipped.length}`,
    ].join("\n"),
  );

  const { sqlite, db } = openDb();

  let canonicalsInserted = 0;
  let aliasesInserted = 0;
  let aliasesUpdated = 0;
  let metricsBackfilled = 0;

  const updateMetricsStmt = sqlite.prepare(
    "UPDATE metrics SET canonical_metric_id = ? WHERE canonical_metric_id IS NULL AND LOWER(TRIM(name)) = ?",
  );

  db.transaction((tx) => {
    for (const p of parsed.proposals) {
      if (p.action === "skip") continue;

      let canonicalId: number;
      if (p.action === "map_existing") {
        canonicalId = p.canonicalMetricId;
      } else {
        // create_new — upsert by canonical_name (another proposal this
        // batch may have invented the same name, or a prior run did).
        const existing = tx
          .select({ id: canonicalMetrics.id })
          .from(canonicalMetrics)
          .where(
            eq(canonicalMetrics.canonicalName, p.newCanonical.canonicalName),
          )
          .get();
        if (existing) {
          canonicalId = existing.id;
        } else {
          const [row] = tx
            .insert(canonicalMetrics)
            .values({
              canonicalName: p.newCanonical.canonicalName,
              category: p.newCanonical.category,
              tags: p.newCanonical.tags,
              preferredUnits: p.newCanonical.preferredUnits,
              description: p.newCanonical.description,
            })
            .returning({ id: canonicalMetrics.id })
            .all();
          canonicalId = row.id;
          canonicalsInserted += 1;
        }
      }

      const rawKey = normalizeRawName(p.rawName);
      if (!rawKey) continue;

      // Upsert global alias (provider = ""). Matches POST /api/mappings.
      const existingAlias = tx
        .select({ canonicalMetricId: metricAliases.canonicalMetricId })
        .from(metricAliases)
        .where(
          and(
            eq(metricAliases.rawNameLower, rawKey),
            eq(metricAliases.provider, ""),
          ),
        )
        .get();

      if (existingAlias) {
        if (existingAlias.canonicalMetricId !== canonicalId) {
          tx
            .update(metricAliases)
            .set({ canonicalMetricId: canonicalId })
            .where(
              and(
                eq(metricAliases.rawNameLower, rawKey),
                eq(metricAliases.provider, ""),
              ),
            )
            .run();
          aliasesUpdated += 1;
        }
      } else {
        tx
          .insert(metricAliases)
          .values({
            rawNameLower: rawKey,
            provider: "",
            canonicalMetricId: canonicalId,
          })
          .run();
        aliasesInserted += 1;
      }

      const res = updateMetricsStmt.run(canonicalId, rawKey);
      metricsBackfilled += res.changes ?? 0;

      // Fold any extra aliases (strain/substrain variants self-healed
      // during --fixup). Each gets its own global alias row + backfills
      // any matching metric rows.
      if (p.action === "create_new" && p.extraAliases?.length) {
        for (const extra of p.extraAliases) {
          const extraKey = normalizeRawName(extra);
          if (!extraKey || extraKey === rawKey) continue;

          const existingExtra = tx
            .select({ canonicalMetricId: metricAliases.canonicalMetricId })
            .from(metricAliases)
            .where(
              and(
                eq(metricAliases.rawNameLower, extraKey),
                eq(metricAliases.provider, ""),
              ),
            )
            .get();

          if (existingExtra) {
            if (existingExtra.canonicalMetricId !== canonicalId) {
              tx
                .update(metricAliases)
                .set({ canonicalMetricId: canonicalId })
                .where(
                  and(
                    eq(metricAliases.rawNameLower, extraKey),
                    eq(metricAliases.provider, ""),
                  ),
                )
                .run();
              aliasesUpdated += 1;
            }
          } else {
            tx
              .insert(metricAliases)
              .values({
                rawNameLower: extraKey,
                provider: "",
                canonicalMetricId: canonicalId,
              })
              .run();
            aliasesInserted += 1;
          }

          const r = updateMetricsStmt.run(canonicalId, extraKey);
          metricsBackfilled += r.changes ?? 0;
        }
      }
    }
  });

  const remaining = db
    .select({ n: sql<number>`count(*)` })
    .from(metricsTable)
    .where(isNull(metricsTable.canonicalMetricId))
    .get();

  sqlite.close();

  console.log(
    [
      `[bulk-map] applied.`,
      `             canonicals inserted:  ${canonicalsInserted}`,
      `             aliases inserted:     ${aliasesInserted}`,
      `             aliases updated:      ${aliasesUpdated}`,
      `             metric rows linked:   ${metricsBackfilled}`,
      `             metrics still null:   ${remaining?.n ?? 0}`,
    ].join("\n"),
  );
}

// ─── Fixup phase ─────────────────────────────────────────────────────────

// Post-process the proposals JSON to correct three known classes of
// Claude-side quality issues:
//   1. Lossy map_existing where a specific species was collapsed into a
//      genus canonical (or vice-versa). Bump these to create_new.
//   2. Self-heal skips: "Claude proposed map_existing to X but no such
//      canonical exists" — find the matching create_new in this same file
//      and fold the skipped rawName into its extraAliases.
//   3. Recategorize create_new rows in "other" that look like urine
//      organic acids, mycotoxins, specific fatty acids, or neurotransmitter
//      metabolites into the proper category slug (requires the taxonomy
//      expansion for `organic-acids` + `mycotoxins`).
//
// Idempotent: running --fixup twice produces the same output.
function fixup(opts: { inputPath: string }) {
  if (!fs.existsSync(opts.inputPath)) {
    throw new Error(
      `Proposals file not found at ${opts.inputPath}. Run \`pnpm bulk-map\` first.`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(opts.inputPath, "utf8"));
  const parsed = ProposalsFile.parse(raw);
  const proposals = parsed.proposals.slice(); // copy; we mutate entries

  // ── (1) Lossy map_existing corrections ──────────────────────────────
  //
  // Only the two cases confirmed wrong by hand-review. Everything else
  // flagged by the heuristic (genus "family"/"species" strings → "spp.")
  // turned out to be legitimate genus-level equivalence.
  const lossyFixes: Record<
    string,
    { canonicalName: string; category: CategorySlug; tags: TagSlug[]; description: string }
  > = {
    "escherichia spp.": {
      canonicalName: "Escherichia spp.",
      category: "gi-microbiome",
      tags: [],
      description:
        "Escherichia genus-level abundance on stool microbiome panels. Distinct from Escherichia coli at the species level.",
    },
    "pseudomonas aeruginosa": {
      canonicalName: "Pseudomonas aeruginosa",
      category: "gi-pathogens",
      tags: [],
      description:
        "Opportunistic pathogen, sometimes detected on stool pathogen panels; clinically distinct from genus-level Pseudomonas.",
    },
  };
  let lossyFixed = 0;
  for (let i = 0; i < proposals.length; i += 1) {
    const p = proposals[i];
    if (p.action !== "map_existing") continue;
    const fix = lossyFixes[normalizeRawName(p.rawName)];
    if (!fix) continue;
    proposals[i] = {
      rawName: p.rawName,
      occurrenceCount: p.occurrenceCount,
      sampleProviders: p.sampleProviders,
      action: "create_new",
      newCanonical: {
        canonicalName: fix.canonicalName,
        category: fix.category,
        tags: fix.tags,
        preferredUnits: null,
        description: fix.description,
      },
      confidence: p.confidence,
      reason: `Bumped from map_existing (was "${p.canonicalName}") — specific/genus distinction preserved`,
    };
    lossyFixed += 1;
  }

  // ── (2) Self-heal skips ─────────────────────────────────────────────
  //
  // The skip pattern we created in propose(): `Claude proposed
  // map_existing to "X" but no such canonical exists`. If "X" matches a
  // create_new proposal already in this file, fold the skipped rawName
  // into that proposal's extraAliases and drop the skip.
  const createNewByName = new Map<string, Proposal>();
  for (const p of proposals) {
    if (p.action === "create_new") {
      createNewByName.set(
        p.newCanonical.canonicalName.toLowerCase(),
        p,
      );
    }
  }
  const selfHealSkipRe = /proposed map_existing to "([^"]+)"/i;
  let selfHealed = 0;
  for (let i = proposals.length - 1; i >= 0; i -= 1) {
    const p = proposals[i];
    if (p.action !== "skip") continue;
    const m = p.reason.match(selfHealSkipRe);
    if (!m) continue;
    const target = createNewByName.get(m[1].toLowerCase());
    if (!target || target.action !== "create_new") continue;
    const existing = target.extraAliases ?? [];
    if (!existing.includes(p.rawName)) existing.push(p.rawName);
    target.extraAliases = existing;
    proposals.splice(i, 1);
    selfHealed += 1;
  }

  // ── (3) Recategorize "other" bucket ─────────────────────────────────
  //
  // Keyword-based. Conservative — if none of the rules match, leave as
  // "other" and let Paul curate manually.
  let recategorized = 0;
  const recatCounts: Record<string, number> = {};
  for (const p of proposals) {
    if (p.action !== "create_new") continue;
    if (p.newCanonical.category !== "other") continue;

    const name = p.newCanonical.canonicalName.toLowerCase();
    const desc = p.newCanonical.description.toLowerCase();
    const units = (p.newCanonical.preferredUnits ?? "").toLowerCase();

    // Mycotoxins — explicit known-name list (mold exposure panels are
    // structurally distinct from urine organic acids and deserve their
    // own bucket).
    const mycotoxinKeywords = [
      "aflatoxin",
      "citrinin",
      "enniatin",
      "gliotoxin",
      "ochratoxin",
      "roridin",
      "sterigmatocystin",
      "verrucarin",
      "zearalenone",
      "chaetoglobosin",
      "mycophenolic",
    ];
    const isMycotoxin =
      mycotoxinKeywords.some((k) => name.includes(k)) ||
      /\b(mycotoxin|mold|fungal exposure)\b/.test(desc);

    if (isMycotoxin) {
      p.newCanonical.category = "mycotoxins";
      recategorized += 1;
      recatCounts.mycotoxins = (recatCounts.mycotoxins ?? 0) + 1;
      continue;
    }

    // Organic acids — description explicitly mentions "organic acid" (the
    // Mosaic / Great Plains OAT panel language), or units are
    // creatinine-normalized which is the OAT signature.
    const isOrganicAcid =
      /\borganic acid\b/.test(desc) ||
      units.includes("creatinine");

    if (isOrganicAcid) {
      p.newCanonical.category = "organic-acids";
      recategorized += 1;
      recatCounts["organic-acids"] = (recatCounts["organic-acids"] ?? 0) + 1;
      continue;
    }

    // Specific fatty acids landed in "other" — they're lipids.
    if (/\b(linoleic|omega|arachidonic|eicosapentaenoic|docosahexaenoic)\b/.test(name)) {
      p.newCanonical.category = "lipids";
      recategorized += 1;
      recatCounts.lipids = (recatCounts.lipids ?? 0) + 1;
      continue;
    }

    // Neurotransmitter metabolites when not already captured as organic
    // acids (i.e. not creatinine-normalized — e.g. Serotonin measured in
    // ng/mL or nmol/L). These sit under hormones/endocrine signalling.
    if (
      /\b(neurotransmitter|catecholamine|serotonin|dopamine|epinephrine|norepinephrine)\b/.test(desc)
    ) {
      p.newCanonical.category = "hormones";
      recategorized += 1;
      recatCounts.hormones = (recatCounts.hormones ?? 0) + 1;
      continue;
    }
  }

  // Write back.
  writeProposalsFile(opts.inputPath, {
    generatedAt: new Date().toISOString(),
    model: parsed.model,
    totalUnmapped: parsed.totalUnmapped,
    proposed: proposals.length,
    proposals,
  });

  console.log(
    [
      `[bulk-map] fixup applied → ${opts.inputPath}`,
      `             lossy map_existing fixed: ${lossyFixed}`,
      `             skips self-healed:         ${selfHealed}`,
      `             "other" recategorized:     ${recategorized}`,
      ...Object.entries(recatCounts).map(
        ([slug, n]) => `                 → ${slug}: ${n}`,
      ),
      `             final proposal count:      ${proposals.length}`,
    ].join("\n"),
  );
}

// ─── Export-seed phase ───────────────────────────────────────────────────

// Emit a TS fragment listing canonicals + global aliases present in the DB
// but not in the static seed. Paul pastes the output into
// `db/seeds/canonical-metrics.ts` so future installs ship the expanded
// taxonomy.
function exportSeed(opts: { outPath?: string }) {
  const { sqlite, db } = openDb();

  const dbCanonicals = db
    .select({
      id: canonicalMetrics.id,
      canonicalName: canonicalMetrics.canonicalName,
      category: canonicalMetrics.category,
      tags: canonicalMetrics.tags,
      preferredUnits: canonicalMetrics.preferredUnits,
      description: canonicalMetrics.description,
    })
    .from(canonicalMetrics)
    .all();

  const dbGlobalAliases = db
    .select({
      rawNameLower: metricAliases.rawNameLower,
      canonicalMetricId: metricAliases.canonicalMetricId,
    })
    .from(metricAliases)
    .where(eq(metricAliases.provider, ""))
    .all();

  sqlite.close();

  const aliasesByCanonicalId = new Map<number, string[]>();
  for (const a of dbGlobalAliases) {
    const arr = aliasesByCanonicalId.get(a.canonicalMetricId) ?? [];
    arr.push(a.rawNameLower);
    aliasesByCanonicalId.set(a.canonicalMetricId, arr);
  }

  const seedByName = new Map(
    CANONICAL_METRICS.map((s) => [s.canonicalName, s]),
  );

  const newCanonicals: typeof dbCanonicals = [];
  const aliasAdditions: { canonicalName: string; newAliases: string[] }[] = [];

  for (const c of dbCanonicals) {
    const seed = seedByName.get(c.canonicalName);
    const dbAliases = aliasesByCanonicalId.get(c.id) ?? [];
    if (!seed) {
      newCanonicals.push(c);
      continue;
    }
    const seededSet = new Set(
      seed.aliases.map((a) => normalizeRawName(a)).filter(Boolean),
    );
    const newAliases = dbAliases
      .filter((a) => !seededSet.has(a))
      .sort((a, b) => a.localeCompare(b));
    if (newAliases.length) {
      aliasAdditions.push({ canonicalName: c.canonicalName, newAliases });
    }
  }

  const lines: string[] = [];
  lines.push(`// Exported by \`pnpm bulk-map --export-seed\` on ${new Date().toISOString()}`);
  lines.push(`// Paste the block(s) below into db/seeds/canonical-metrics.ts.`);
  lines.push("");

  if (newCanonicals.length) {
    lines.push(`// ── New canonicals (append inside CANONICAL_METRICS array) ──`);
    for (const c of newCanonicals.sort((a, b) =>
      a.canonicalName.localeCompare(b.canonicalName),
    )) {
      const aliases = (aliasesByCanonicalId.get(c.id) ?? []).sort(
        (a, b) => a.localeCompare(b),
      );
      const tagsArr = Array.isArray(c.tags) ? c.tags : [];
      lines.push(`  {`);
      lines.push(`    canonicalName: ${JSON.stringify(c.canonicalName)},`);
      lines.push(`    category: ${JSON.stringify(c.category)},`);
      lines.push(`    tags: [${tagsArr.map((t) => JSON.stringify(t)).join(", ")}],`);
      lines.push(
        `    preferredUnits: ${c.preferredUnits === null ? "null" : JSON.stringify(c.preferredUnits)},`,
      );
      lines.push(`    description: ${JSON.stringify(c.description ?? "")},`);
      lines.push(`    aliases: [`);
      for (const a of aliases) lines.push(`      ${JSON.stringify(a)},`);
      lines.push(`    ],`);
      lines.push(`  },`);
    }
    lines.push("");
  }

  if (aliasAdditions.length) {
    lines.push(`// ── New aliases on existing canonicals ──`);
    lines.push(`// For each entry, add the listed aliases to the existing`);
    lines.push(`// canonical's aliases array in canonical-metrics.ts.`);
    for (const a of aliasAdditions.sort((a, b) =>
      a.canonicalName.localeCompare(b.canonicalName),
    )) {
      lines.push(`//   ${a.canonicalName}:`);
      for (const alias of a.newAliases) lines.push(`//     + ${alias}`);
    }
    lines.push("");
  }

  if (!newCanonicals.length && !aliasAdditions.length) {
    lines.push(`// No new canonicals or aliases to export. Seed is in sync with DB.`);
  }

  const output = lines.join("\n") + "\n";

  if (opts.outPath) {
    fs.writeFileSync(opts.outPath, output);
    console.log(
      `[bulk-map] wrote ${newCanonicals.length} new canonicals + ${aliasAdditions.length} alias additions → ${opts.outPath}`,
    );
  } else {
    process.stdout.write(output);
    console.error(
      `[bulk-map] exported ${newCanonicals.length} new canonicals + ${aliasAdditions.length} alias additions`,
    );
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes("--apply");
  const isExportSeed = args.includes("--export-seed");
  const isFixup = args.includes("--fixup");
  const fileArg = args.find((a) => a.startsWith("--file="))?.split("=", 2)[1];
  const outArg = args.find((a) => a.startsWith("--out="))?.split("=", 2)[1];
  const limitArg = args.find((a) => a.startsWith("--limit="))?.split("=", 2)[1];
  const batchArg = args
    .find((a) => a.startsWith("--batch-size="))
    ?.split("=", 2)[1];

  const outputPath = fileArg ? path.resolve(fileArg) : DEFAULT_PROPOSALS_PATH;

  if (isExportSeed) {
    exportSeed({ outPath: outArg ? path.resolve(outArg) : undefined });
    return;
  }

  if (isFixup) {
    fixup({ inputPath: outputPath });
    return;
  }

  if (isApply) {
    apply({ inputPath: outputPath });
    return;
  }

  const limit = limitArg ? Number(limitArg) : undefined;
  const batchSize = batchArg ? Number(batchArg) : DEFAULT_BATCH_SIZE;
  if (limit !== undefined && !Number.isFinite(limit))
    throw new Error(`--limit must be a number, got ${limitArg}`);
  if (!Number.isFinite(batchSize) || batchSize < 1)
    throw new Error(`--batch-size must be a positive number, got ${batchArg}`);

  await propose({ outputPath, limit, batchSize });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
