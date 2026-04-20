// Pure helpers for bulk canonical mapping — prompt, response parsing,
// deterministic fixups. No DB, no `server-only` guard, no Anthropic SDK.
// All unit-testable in isolation; see tests/unit/bulk-map.test.ts.

import { z } from "zod";

import {
  CATEGORIES,
  TAGS,
  isCategorySlug,
  isTagSlug,
  type CategorySlug,
  type TagSlug,
} from "@/db/seeds/taxonomy";
import { normalizeRawName } from "@/lib/canonical-util";

export const SYSTEM_PROMPT = `You are a medical-informatics assistant mapping raw lab-report metric names to a fixed canonical taxonomy.

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

// Claude's raw output shape. Category + tags are parsed as plain strings
// here and sanitised downstream — the model occasionally invents a slug
// outside the allowed set, and we don't want one stray tag to fail the
// whole 40-row batch.
export const ClaudeProposal = z.discriminatedUnion("action", [
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
export type ClaudeProposal = z.infer<typeof ClaudeProposal>;

export const ClaudeBatch = z.object({ proposals: z.array(ClaudeProposal) });
export type ClaudeBatch = z.infer<typeof ClaudeBatch>;

export interface ExistingCanonicalForPrompt {
  canonicalName: string;
  category: string;
}

export interface UnmappedRow {
  rawName: string;
  occurrenceCount: number;
  sampleProviders: string[];
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function buildClaudePrompt(
  existing: ExistingCanonicalForPrompt[],
  batch: UnmappedRow[],
): string {
  const existingList = existing
    .map((c) => `- "${c.canonicalName}"  (${c.category})`)
    .join("\n");

  return (
    `EXISTING CANONICALS (${existing.length}):\n${existingList}\n\n` +
    `ALLOWED CATEGORIES: ${CATEGORIES.join(", ")}\n` +
    `ALLOWED TAGS: ${TAGS.join(", ")}\n\n` +
    `RAW NAMES TO MAP (${batch.length}):\n` +
    batch
      .map(
        (r) =>
          `- "${r.rawName}"  (seen ${r.occurrenceCount}× across providers: ${r.sampleProviders.join(", ") || "unknown"})`,
      )
      .join("\n")
  );
}

export function parseClaudeResponse(text: string): ClaudeBatch {
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

// Coerce an unknown category to "other" and drop unknown tags. Used when
// ingesting Claude output so a single stray slug doesn't invalidate the
// whole batch.
export interface SanitizedCreateNew {
  canonicalName: string;
  category: CategorySlug;
  tags: TagSlug[];
  preferredUnits: string | null;
  description: string;
  droppedTags: string[];
  originalCategory: string;
}

export function sanitizeNewCanonical(newCanonical: {
  canonicalName: string;
  category: string;
  tags: string[];
  preferredUnits: string | null;
  description: string;
}): SanitizedCreateNew {
  const category: CategorySlug = isCategorySlug(newCanonical.category)
    ? newCanonical.category
    : "other";
  const tags = newCanonical.tags.filter(isTagSlug) as TagSlug[];
  const droppedTags = newCanonical.tags.filter((t) => !isTagSlug(t));
  return {
    canonicalName: newCanonical.canonicalName,
    category,
    tags,
    preferredUnits: newCanonical.preferredUnits,
    description: newCanonical.description,
    droppedTags,
    originalCategory: newCanonical.category,
  };
}

// ─── Deterministic fixups ────────────────────────────────────────────────
//
// These mirror the three correction classes the CLI's `--fixup` phase
// handles. Operating on an in-memory proposal shape that the UI/CLI
// share, so tests don't need a DB.

export interface FixupCreateNew {
  canonicalName: string;
  category: CategorySlug;
  tags: TagSlug[];
  preferredUnits: string | null;
  description: string;
}

export interface FixupProposal {
  rawName: string;
  action: "map_existing" | "create_new" | "skip";
  proposedCanonicalName?: string | null;
  newCanonical?: FixupCreateNew | null;
  extraAliases?: string[];
  reason?: string | null;
}

// Lossy `map_existing` corrections. The two cases confirmed wrong by
// hand-review during the GI-mapping run; everything else flagged by the
// heuristic turned out to be legitimate genus-level equivalence.
export const LOSSY_FIXES: Record<string, FixupCreateNew> = {
  "escherichia spp.": {
    canonicalName: "Escherichia spp.",
    category: "gi-microbiome",
    tags: [],
    preferredUnits: null,
    description:
      "Escherichia genus-level abundance on stool microbiome panels. Distinct from Escherichia coli at the species level.",
  },
  "pseudomonas aeruginosa": {
    canonicalName: "Pseudomonas aeruginosa",
    category: "gi-pathogens",
    tags: [],
    preferredUnits: null,
    description:
      "Opportunistic pathogen, sometimes detected on stool pathogen panels; clinically distinct from genus-level Pseudomonas.",
  },
};

export interface LossyFixResult<P> {
  proposals: P[];
  fixed: number;
}

export function applyLossyFixes<P extends FixupProposal>(
  input: P[],
): LossyFixResult<P> {
  const proposals = input.slice();
  let fixed = 0;
  for (let i = 0; i < proposals.length; i += 1) {
    const p = proposals[i];
    if (p.action !== "map_existing") continue;
    const fix = LOSSY_FIXES[normalizeRawName(p.rawName)];
    if (!fix) continue;
    proposals[i] = {
      ...p,
      action: "create_new",
      proposedCanonicalName: fix.canonicalName,
      newCanonical: fix,
      reason: `Bumped from map_existing (was "${p.proposedCanonicalName ?? "?"}") — specific/genus distinction preserved`,
    };
    fixed += 1;
  }
  return { proposals, fixed };
}

// Self-heal skips of the form `Claude proposed map_existing to "X" but
// no such canonical exists`. If X matches a create_new in this same
// set, fold the skipped rawName into its extraAliases and drop the
// skip.
const SELF_HEAL_SKIP_RE = /proposed map_existing to "([^"]+)"/i;

export interface SelfHealResult<P> {
  proposals: P[];
  selfHealed: number;
}

export function applySelfHealSkips<P extends FixupProposal>(
  input: P[],
): SelfHealResult<P> {
  const proposals = input.slice();
  const createNewByName = new Map<string, P>();
  for (const p of proposals) {
    if (p.action === "create_new" && p.newCanonical) {
      createNewByName.set(p.newCanonical.canonicalName.toLowerCase(), p);
    }
  }
  let selfHealed = 0;
  for (let i = proposals.length - 1; i >= 0; i -= 1) {
    const p = proposals[i];
    if (p.action !== "skip" || !p.reason) continue;
    const m = p.reason.match(SELF_HEAL_SKIP_RE);
    if (!m) continue;
    const target = createNewByName.get(m[1].toLowerCase());
    if (!target) continue;
    const existing = target.extraAliases ?? [];
    if (!existing.includes(p.rawName)) existing.push(p.rawName);
    target.extraAliases = existing;
    proposals.splice(i, 1);
    selfHealed += 1;
  }
  return { proposals, selfHealed };
}

// Recategorize create_new proposals that landed in "other" when a
// better category slug applies. Keyword-based; conservative. Mirrors
// the CLI --fixup logic.
const MYCOTOXIN_KEYWORDS = [
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

export interface RecategorizeResult<P> {
  proposals: P[];
  recategorized: number;
  countsByCategory: Record<string, number>;
}

export function recategorizeOther<P extends FixupProposal>(
  input: P[],
): RecategorizeResult<P> {
  const proposals = input.slice();
  const countsByCategory: Record<string, number> = {};
  let recategorized = 0;
  for (const p of proposals) {
    if (p.action !== "create_new" || !p.newCanonical) continue;
    if (p.newCanonical.category !== "other") continue;

    const name = p.newCanonical.canonicalName.toLowerCase();
    const desc = p.newCanonical.description.toLowerCase();
    const units = (p.newCanonical.preferredUnits ?? "").toLowerCase();

    const isMycotoxin =
      MYCOTOXIN_KEYWORDS.some((k) => name.includes(k)) ||
      /\b(mycotoxin|mold|fungal exposure)\b/.test(desc);
    if (isMycotoxin) {
      p.newCanonical.category = "mycotoxins";
      recategorized += 1;
      countsByCategory.mycotoxins = (countsByCategory.mycotoxins ?? 0) + 1;
      continue;
    }

    const isOrganicAcid =
      /\borganic acid\b/.test(desc) || units.includes("creatinine");
    if (isOrganicAcid) {
      p.newCanonical.category = "organic-acids";
      recategorized += 1;
      countsByCategory["organic-acids"] =
        (countsByCategory["organic-acids"] ?? 0) + 1;
      continue;
    }

    if (
      /\b(linoleic|omega|arachidonic|eicosapentaenoic|docosahexaenoic)\b/.test(
        name,
      )
    ) {
      p.newCanonical.category = "lipids";
      recategorized += 1;
      countsByCategory.lipids = (countsByCategory.lipids ?? 0) + 1;
      continue;
    }

    if (
      /\b(neurotransmitter|catecholamine|serotonin|dopamine|epinephrine|norepinephrine)\b/.test(
        desc,
      )
    ) {
      p.newCanonical.category = "hormones";
      recategorized += 1;
      countsByCategory.hormones = (countsByCategory.hormones ?? 0) + 1;
      continue;
    }
  }
  return { proposals, recategorized, countsByCategory };
}
