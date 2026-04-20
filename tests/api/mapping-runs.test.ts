import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  canonicalMetrics,
  mappingProposals,
  mappingRuns,
  metrics as metricsTable,
  metricAliases,
  reports,
} from "@/db/schema";
import {
  applyRun,
  createMappingRun,
  drainMappingRuns,
  getRun,
  HasPendingProposalsError,
  listProposals,
  patchProposal,
  runFixupOnRun,
} from "@/lib/bulk-map";
import type { ClaudeBatch } from "@/lib/bulk-map-util";

import { POST as POST_RUNS } from "../../app/api/mappings/runs/route";
import { GET as GET_RUN } from "../../app/api/mappings/runs/[id]/route";
import { GET as GET_PROPOSALS } from "../../app/api/mappings/runs/[id]/proposals/route";
import { PATCH as PATCH_PROPOSAL } from "../../app/api/mappings/runs/[id]/proposals/[pid]/route";
import { POST as POST_APPLY } from "../../app/api/mappings/runs/[id]/apply/route";
import { POST as POST_FIXUP } from "../../app/api/mappings/runs/[id]/fixup/route";

// ─── Test fixtures ───────────────────────────────────────────────────────

// Stub Anthropic SDK — drainMappingRuns calls `client.messages.create`.
// We'll set stubResponse before each test and the stub will return it.
let stubResponse: ClaudeBatch = { proposals: [] };
function makeClient() {
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: "text", text: JSON.stringify(stubResponse) }],
      })),
    },
  } as unknown as import("@anthropic-ai/sdk").default;
}

function seedReport(provider: string): number {
  const [row] = db
    .insert(reports)
    .values({
      filePath: `/tmp/${provider}.pdf`,
      fileHash: `hash-${provider}-${Math.random()}`,
      provider,
      category: "blood",
      reportDate: "2026-01-01",
    })
    .returning({ id: reports.id })
    .all();
  return row.id;
}

function seedUnmappedMetric(reportId: number, name: string, count = 1) {
  for (let i = 0; i < count; i += 1) {
    db.insert(metricsTable)
      .values({
        reportId,
        name,
        valueNumeric: 1.0,
      })
      .run();
  }
}

function clearRunState() {
  db.delete(mappingProposals).run();
  db.delete(mappingRuns).run();
}

function clearFixtures() {
  // Clear everything we seed per-test. Canonicals + seeded aliases stay
  // (provisioned once per worker via applySeeds in lib/db.ts).
  db.delete(mappingProposals).run();
  db.delete(mappingRuns).run();
  db.delete(metricsTable).run();
  db.delete(reports).run();
  // Also drop any aliases/canonicals inserted by earlier apply() calls
  // so per-test assertions aren't polluted.
  db.run(
    sql`DELETE FROM metric_aliases WHERE raw_name_lower LIKE 'stub-%' OR raw_name_lower LIKE 'synthetic-%' OR raw_name_lower LIKE 'escherichia spp.%' OR raw_name_lower LIKE 'foo-%'`,
  );
  db.run(
    sql`DELETE FROM canonical_metrics WHERE canonical_name LIKE 'Stub %' OR canonical_name LIKE 'Synthetic %' OR canonical_name LIKE 'Escherichia spp.%' OR canonical_name LIKE 'Foo %'`,
  );
}

beforeEach(clearFixtures);
afterEach(clearFixtures);

// ─── createMappingRun + gatherUnmapped ──────────────────────────────────

describe("createMappingRun", () => {
  it("counts unmapped metrics and batches them by the configured size", () => {
    const reportId = seedReport("quest");
    seedUnmappedMetric(reportId, "Stub Metric A");
    seedUnmappedMetric(reportId, "Stub Metric B");
    seedUnmappedMetric(reportId, "Stub Metric C");

    const created = createMappingRun({ batchSize: 2 });
    expect(created.totalUnmapped).toBe(3);
    expect(created.batchesTotal).toBe(2);

    const view = getRun(created.runId);
    expect(view).not.toBeNull();
    expect(view?.status).toBe("queued");
    expect(view?.batchSize).toBe(2);
  });
});

// ─── drainMappingRuns with stubbed Claude ────────────────────────────────

describe("drainMappingRuns", () => {
  it("persists map_existing and create_new proposals and marks the run ready_for_review", async () => {
    const reportId = seedReport("gi-map");
    seedUnmappedMetric(reportId, "WBC Count");
    seedUnmappedMetric(reportId, "Synthetic Species One");

    stubResponse = {
      proposals: [
        {
          rawName: "WBC Count",
          action: "map_existing",
          canonicalName: "White Blood Cells",
          confidence: 0.95,
        },
        {
          rawName: "Synthetic Species One",
          action: "create_new",
          newCanonical: {
            canonicalName: "Synthetic Species One",
            category: "gi-microbiome",
            tags: [],
            preferredUnits: null,
            description: "synthetic test species",
          },
          confidence: 0.8,
        },
      ],
    };

    const created = createMappingRun({ batchSize: 10 });
    await drainMappingRuns(makeClient());

    const view = getRun(created.runId);
    expect(view?.status).toBe("ready_for_review");
    expect(view?.proposedCount).toBe(2);
    expect(view?.actionCounts.map_existing).toBe(1);
    expect(view?.actionCounts.create_new).toBe(1);

    const proposals = listProposals(created.runId);
    const existing = proposals.find((p) => p.rawName === "WBC Count");
    expect(existing?.action).toBe("map_existing");
    expect(existing?.canonicalMetricId).toBeTypeOf("number");
    const creating = proposals.find((p) => p.rawName === "Synthetic Species One");
    expect(creating?.action).toBe("create_new");
    expect(creating?.newCanonical?.canonicalName).toBe("Synthetic Species One");
  });

  it("converts map_existing to skip when Claude references a non-existent canonical", async () => {
    const reportId = seedReport("quest");
    seedUnmappedMetric(reportId, "Foo Species");

    stubResponse = {
      proposals: [
        {
          rawName: "Foo Species",
          action: "map_existing",
          canonicalName: "Not a Real Canonical",
          confidence: 0.4,
        },
      ],
    };

    const created = createMappingRun({ batchSize: 10 });
    await drainMappingRuns(makeClient());

    const proposals = listProposals(created.runId);
    expect(proposals[0].action).toBe("skip");
    expect(proposals[0].reason).toMatch(/no such canonical exists/);
  });
});

// ─── runFixupOnRun ───────────────────────────────────────────────────────

describe("runFixupOnRun", () => {
  it("folds self-healed skips into the target create_new's extraAliases", async () => {
    const reportId = seedReport("gi-map");
    seedUnmappedMetric(reportId, "Synthetic Species Two");
    seedUnmappedMetric(reportId, "S. species two");

    stubResponse = {
      proposals: [
        {
          rawName: "Synthetic Species Two",
          action: "create_new",
          newCanonical: {
            canonicalName: "Synthetic Species Two",
            category: "gi-microbiome",
            tags: [],
            preferredUnits: null,
            description: "x",
          },
          confidence: 0.9,
        },
        {
          rawName: "S. species two",
          action: "map_existing",
          canonicalName: "Synthetic Species Two",
          confidence: 0.7,
        },
      ],
    };

    const created = createMappingRun({ batchSize: 10 });
    await drainMappingRuns(makeClient());

    const before = listProposals(created.runId);
    const skip = before.find((p) => p.rawName === "S. species two");
    expect(skip?.action).toBe("skip");

    const summary = runFixupOnRun(created.runId);
    expect(summary.selfHealed).toBe(1);

    const after = listProposals(created.runId);
    const target = after.find((p) => p.rawName === "Synthetic Species Two");
    expect(target?.extraAliases).toContain("S. species two");
    const rejected = after.find((p) => p.rawName === "S. species two");
    expect(rejected?.status).toBe("rejected");
  });
});

// ─── applyRun ────────────────────────────────────────────────────────────

describe("applyRun", () => {
  it("refuses when pending proposals exist without includeUnreviewed", async () => {
    const reportId = seedReport("quest");
    seedUnmappedMetric(reportId, "Stub Pending Metric");

    stubResponse = {
      proposals: [
        {
          rawName: "Stub Pending Metric",
          action: "map_existing",
          canonicalName: "White Blood Cells",
          confidence: 0.9,
        },
      ],
    };
    const created = createMappingRun({ batchSize: 10 });
    await drainMappingRuns(makeClient());

    expect(() => applyRun(created.runId)).toThrow(HasPendingProposalsError);
  });

  it("applies approved proposals: inserts alias, backfills metric rows, updates proposal status", async () => {
    const reportId = seedReport("quest");
    seedUnmappedMetric(reportId, "Stub WBC", 3);

    stubResponse = {
      proposals: [
        {
          rawName: "Stub WBC",
          action: "map_existing",
          canonicalName: "White Blood Cells",
          confidence: 0.95,
        },
      ],
    };
    const created = createMappingRun({ batchSize: 10 });
    await drainMappingRuns(makeClient());

    const [proposal] = listProposals(created.runId);
    patchProposal(proposal.id, { status: "approved" });

    const result = applyRun(created.runId);
    expect(result.proposalsApplied).toBe(1);
    expect(result.metricsBackfilled).toBe(3);
    expect(result.aliasesInserted).toBe(1);

    const view = getRun(created.runId);
    expect(view?.status).toBe("applied");
    const updatedProposal = listProposals(created.runId)[0];
    expect(updatedProposal.status).toBe("applied");

    // Metric rows now carry the canonical link.
    const stillNull = db
      .select({ id: metricsTable.id })
      .from(metricsTable)
      .where(sql`${metricsTable.canonicalMetricId} IS NULL`)
      .all();
    expect(stillNull).toHaveLength(0);

    // Alias landed globally.
    const alias = db
      .select()
      .from(metricAliases)
      .where(sql`${metricAliases.rawNameLower} = 'stub wbc'`)
      .all();
    expect(alias).toHaveLength(1);
    expect(alias[0].provider).toBe("");
  });

  it("creates new canonicals for create_new proposals", async () => {
    const reportId = seedReport("gi-map");
    seedUnmappedMetric(reportId, "Synthetic Species Three", 2);

    stubResponse = {
      proposals: [
        {
          rawName: "Synthetic Species Three",
          action: "create_new",
          newCanonical: {
            canonicalName: "Synthetic Species Three",
            category: "gi-microbiome",
            tags: [],
            preferredUnits: null,
            description: "a test species",
          },
          confidence: 0.9,
        },
      ],
    };
    const created = createMappingRun({ batchSize: 10 });
    await drainMappingRuns(makeClient());

    const [proposal] = listProposals(created.runId);
    patchProposal(proposal.id, { status: "approved" });

    const result = applyRun(created.runId);
    expect(result.canonicalsInserted).toBe(1);
    expect(result.metricsBackfilled).toBe(2);

    const canonical = db
      .select()
      .from(canonicalMetrics)
      .where(sql`${canonicalMetrics.canonicalName} = 'Synthetic Species Three'`)
      .get();
    expect(canonical).toBeDefined();
    expect(canonical?.category).toBe("gi-microbiome");
  });
});

// ─── patchProposal ───────────────────────────────────────────────────────

describe("patchProposal", () => {
  it("auto-approves when the user edits newCanonical", async () => {
    const reportId = seedReport("gi-map");
    seedUnmappedMetric(reportId, "Synthetic Species Four");

    stubResponse = {
      proposals: [
        {
          rawName: "Synthetic Species Four",
          action: "create_new",
          newCanonical: {
            canonicalName: "Synthetic Species Four",
            category: "other",
            tags: [],
            preferredUnits: null,
            description: "wrong category",
          },
          confidence: 0.6,
        },
      ],
    };
    const created = createMappingRun({ batchSize: 10 });
    await drainMappingRuns(makeClient());

    const [proposal] = listProposals(created.runId);
    expect(proposal.status).toBe("pending");

    const updated = patchProposal(proposal.id, {
      newCanonical: {
        canonicalName: "Synthetic Species Four",
        category: "gi-microbiome",
        tags: [],
        preferredUnits: null,
        description: "edited category",
      },
    });
    expect(updated?.status).toBe("approved");
    expect(updated?.editedByUser).toBe(true);
    expect(updated?.newCanonical?.category).toBe("gi-microbiome");
  });
});

// ─── Route handlers ──────────────────────────────────────────────────────

describe("POST /api/mappings/runs", () => {
  it("creates a run and returns 202 with runId", async () => {
    const reportId = seedReport("quest");
    seedUnmappedMetric(reportId, "Stub Route Metric");

    const res = await POST_RUNS(
      new Request("http://localhost/api/mappings/runs", {
        method: "POST",
        body: JSON.stringify({ batchSize: 5 }),
      }),
    );
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.runId).toBeTypeOf("number");
    expect(body.totalUnmapped).toBe(1);
    expect(body.batchesTotal).toBe(1);
  });
});

describe("GET /api/mappings/runs/[id]", () => {
  it("returns the run view with action + status counts", async () => {
    const created = createMappingRun({ batchSize: 10 });
    const res = await GET_RUN(new Request("http://localhost/irrelevant"), {
      params: Promise.resolve({ id: String(created.runId) }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.id).toBe(created.runId);
    expect(body.run.status).toBe("queued");
  });

  it("returns 404 for an unknown run", async () => {
    const res = await GET_RUN(new Request("http://localhost/irrelevant"), {
      params: Promise.resolve({ id: "999999" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/mappings/runs/[id]/proposals", () => {
  it("filters by action and status", async () => {
    const reportId = seedReport("quest");
    seedUnmappedMetric(reportId, "Stub Route Proposal");

    stubResponse = {
      proposals: [
        {
          rawName: "Stub Route Proposal",
          action: "map_existing",
          canonicalName: "White Blood Cells",
          confidence: 0.9,
        },
      ],
    };
    const created = createMappingRun({ batchSize: 10 });
    await drainMappingRuns(makeClient());

    const res = await GET_PROPOSALS(
      new Request(`http://localhost/?action=map_existing`),
      { params: Promise.resolve({ id: String(created.runId) }) },
    );
    const body = await res.json();
    expect(body.proposals).toHaveLength(1);
    expect(body.proposals[0].action).toBe("map_existing");

    const missRes = await GET_PROPOSALS(
      new Request(`http://localhost/?action=skip`),
      { params: Promise.resolve({ id: String(created.runId) }) },
    );
    const missBody = await missRes.json();
    expect(missBody.proposals).toHaveLength(0);
  });
});

describe("PATCH /api/mappings/runs/[id]/proposals/[pid]", () => {
  it("approves a proposal via status update", async () => {
    const reportId = seedReport("quest");
    seedUnmappedMetric(reportId, "Stub Patch Me");

    stubResponse = {
      proposals: [
        {
          rawName: "Stub Patch Me",
          action: "map_existing",
          canonicalName: "White Blood Cells",
          confidence: 0.9,
        },
      ],
    };
    const created = createMappingRun({ batchSize: 10 });
    await drainMappingRuns(makeClient());
    const [proposal] = listProposals(created.runId);

    const res = await PATCH_PROPOSAL(
      new Request("http://localhost/", {
        method: "PATCH",
        body: JSON.stringify({ status: "approved" }),
      }),
      {
        params: Promise.resolve({
          id: String(created.runId),
          pid: String(proposal.id),
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposal.status).toBe("approved");
  });
});

describe("POST /api/mappings/runs/[id]/apply", () => {
  it("returns 409 with pendingCount when pending proposals remain", async () => {
    const reportId = seedReport("quest");
    seedUnmappedMetric(reportId, "Stub Apply Route");

    stubResponse = {
      proposals: [
        {
          rawName: "Stub Apply Route",
          action: "map_existing",
          canonicalName: "White Blood Cells",
          confidence: 0.9,
        },
      ],
    };
    const created = createMappingRun({ batchSize: 10 });
    await drainMappingRuns(makeClient());

    const res = await POST_APPLY(new Request("http://localhost/"), {
      params: Promise.resolve({ id: String(created.runId) }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.pendingCount).toBe(1);
  });

  it("applies when includeUnreviewed=true", async () => {
    const reportId = seedReport("quest");
    seedUnmappedMetric(reportId, "Stub Apply Forced");

    stubResponse = {
      proposals: [
        {
          rawName: "Stub Apply Forced",
          action: "map_existing",
          canonicalName: "White Blood Cells",
          confidence: 0.9,
        },
      ],
    };
    const created = createMappingRun({ batchSize: 10 });
    await drainMappingRuns(makeClient());

    // Pending proposal — force it.
    const res = await POST_APPLY(
      new Request(
        `http://localhost/?includeUnreviewed=true`,
      ),
      { params: Promise.resolve({ id: String(created.runId) }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposalsApplied + body.proposalsSkipped).toBeGreaterThan(0);
  });
});

describe("POST /api/mappings/runs/[id]/fixup", () => {
  it("is idempotent", async () => {
    const created = createMappingRun({ batchSize: 10 });
    const res1 = await POST_FIXUP(new Request("http://localhost/"), {
      params: Promise.resolve({ id: String(created.runId) }),
    });
    const res2 = await POST_FIXUP(new Request("http://localhost/"), {
      params: Promise.resolve({ id: String(created.runId) }),
    });
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const b1 = await res1.json();
    const b2 = await res2.json();
    expect(b1).toEqual(b2);
  });
});
