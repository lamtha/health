"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS, type CategorySlug } from "@/db/seeds/taxonomy";

// These types mirror the server ones in lib/bulk-map.ts. They're duplicated
// intentionally so the client bundle doesn't pull in `server-only` modules.
export interface BulkRunView {
  id: number;
  status:
    | "queued"
    | "proposing"
    | "ready_for_review"
    | "applying"
    | "applied"
    | "error"
    | "canceled";
  model: string;
  batchSize: number;
  limit: number | null;
  totalUnmapped: number;
  batchesTotal: number;
  batchesDone: number;
  proposedCount: number;
  failedBatches: { batchIdx: number; error: string; names: string[] }[];
  missingNames: string[];
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  appliedAt: string | null;
  actionCounts: Record<string, number>;
  statusCounts: Record<string, number>;
}

export interface BulkProposalView {
  id: number;
  runId: number;
  rawName: string;
  occurrenceCount: number;
  sampleProviders: string[];
  action: "map_existing" | "create_new" | "skip";
  canonicalMetricId: number | null;
  proposedCanonicalName: string | null;
  newCanonical: {
    canonicalName: string;
    category: string;
    tags: string[];
    preferredUnits: string | null;
    description: string;
  } | null;
  extraAliases: string[];
  confidence: number;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "applied" | "apply_error";
  editedByUser: boolean;
  applyError: string | null;
}

type ActionFilter = "all" | "map_existing" | "create_new" | "skip";
type StatusFilter = "all" | "pending" | "approved" | "rejected";

export function BulkMappingPanel({
  initialRun,
}: {
  initialRun: BulkRunView | null;
}) {
  const router = useRouter();
  const [run, setRun] = useState<BulkRunView | null>(initialRun);
  const [proposals, setProposals] = useState<BulkProposalView[]>([]);
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const isActive =
    run?.status === "queued" ||
    run?.status === "proposing" ||
    run?.status === "applying";
  const isReviewable = run?.status === "ready_for_review";
  const isTerminal = run?.status === "applied" || run?.status === "canceled";

  // Poll run status while the run is active.
  useEffect(() => {
    if (!run || !isActive) return;
    const id = run.id;
    let stopped = false;
    async function tick() {
      if (stopped) return;
      const res = await fetch(`/api/mappings/runs/${id}`);
      if (res.ok) {
        const body = await res.json();
        setRun(body.run);
      }
    }
    const iv = setInterval(tick, 2000);
    tick();
    return () => {
      stopped = true;
      clearInterval(iv);
    };
  }, [run, isActive]);

  const fetchProposals = useCallback(async () => {
    if (!run) return;
    const res = await fetch(`/api/mappings/runs/${run.id}/proposals`);
    if (res.ok) {
      const body = await res.json();
      setProposals(body.proposals);
    }
  }, [run]);

  // Load proposals when we enter reviewable state.
  useEffect(() => {
    if (isReviewable) void fetchProposals();
  }, [isReviewable, fetchProposals]);

  const filteredProposals = useMemo(() => {
    return proposals.filter((p) => {
      if (actionFilter !== "all" && p.action !== actionFilter) return false;
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      return true;
    });
  }, [proposals, actionFilter, statusFilter]);

  // ─── Handlers ──────────────────────────────────────────────────────────

  async function startRun() {
    setError(null);
    setBusy("Starting run…");
    const res = await fetch("/api/mappings/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `HTTP ${res.status}`);
      return;
    }
    const body = await res.json();
    const fresh = await fetch(`/api/mappings/runs/${body.runId}`);
    const freshBody = await fresh.json();
    setRun(freshBody.run);
  }

  async function cancelRun() {
    if (!run) return;
    setBusy("Canceling…");
    await fetch(`/api/mappings/runs/${run.id}/cancel`, { method: "POST" });
    const fresh = await fetch(`/api/mappings/runs/${run.id}`);
    const body = await fresh.json();
    setRun(body.run);
    setBusy(null);
  }

  async function runFixup() {
    if (!run) return;
    setBusy("Running fixup…");
    await fetch(`/api/mappings/runs/${run.id}/fixup`, { method: "POST" });
    await refreshAll();
    setBusy(null);
  }

  async function patchProposal(
    id: number,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    if (!run) return false;
    const res = await fetch(`/api/mappings/runs/${run.id}/proposals/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? `HTTP ${res.status}`);
      return false;
    }
    const json = await res.json();
    setProposals((cur) =>
      cur.map((p) => (p.id === id ? json.proposal : p)),
    );
    return true;
  }

  async function approve(id: number) {
    await patchProposal(id, { status: "approved" });
  }

  async function reject(id: number) {
    await patchProposal(id, { status: "rejected" });
  }

  async function approveAllVisible() {
    const ids = filteredProposals
      .filter((p) => p.status === "pending")
      .map((p) => p.id);
    if (!ids.length) return;
    setBusy(`Approving ${ids.length}…`);
    await Promise.all(
      ids.map((id) => patchProposal(id, { status: "approved" })),
    );
    setBusy(null);
  }

  async function applyRun(includeUnreviewed: boolean) {
    if (!run) return;
    setError(null);
    setBusy("Applying…");
    const qs = includeUnreviewed ? "?includeUnreviewed=true" : "";
    const res = await fetch(`/api/mappings/runs/${run.id}/apply${qs}`, {
      method: "POST",
    });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && typeof body.pendingCount === "number") {
        setError(
          `${body.pendingCount} proposals still pending. Review them, or force with "Apply (include unreviewed)".`,
        );
        return;
      }
      setError(body.error ?? `HTTP ${res.status}`);
      return;
    }
    await refreshAll();
    router.refresh();
  }

  async function refreshAll() {
    if (!run) return;
    const [rRun, rProp] = await Promise.all([
      fetch(`/api/mappings/runs/${run.id}`).then((r) => r.json()),
      fetch(`/api/mappings/runs/${run.id}/proposals`).then((r) => r.json()),
    ]);
    setRun(rRun.run);
    setProposals(rProp.proposals);
  }

  // ─── UI ────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-serif-display text-[20px] leading-tight">
              Bulk propose with Claude
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Send every unmapped raw name to Claude in one pass. Review the
              proposed mappings, then apply in a single transaction.
            </p>
          </div>
          {run && (
            <Badge variant="outline" className="font-mono text-[11px]">
              run #{run.id} · {run.status.replace(/_/g, " ")}
            </Badge>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-flag-high/40 bg-flag-high/5 px-3 py-2 text-[12.5px] text-flag-high">
            {error}
          </div>
        )}

        {!run || isTerminal ? (
          <IdleState
            lastRun={run}
            onStart={startRun}
            busy={busy}
          />
        ) : isActive ? (
          <RunningState
            run={run}
            busy={busy}
            onCancel={cancelRun}
          />
        ) : isReviewable ? (
          <ReviewState
            run={run}
            proposals={proposals}
            filteredProposals={filteredProposals}
            actionFilter={actionFilter}
            setActionFilter={setActionFilter}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            busy={busy}
            onApprove={approve}
            onReject={reject}
            onApproveAllVisible={approveAllVisible}
            onRunFixup={runFixup}
            onApply={applyRun}
            onPatchProposal={patchProposal}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

// ─── Idle ──────────────────────────────────────────────────────────────

function IdleState({
  lastRun,
  onStart,
  busy,
}: {
  lastRun: BulkRunView | null;
  onStart: () => void;
  busy: string | null;
}) {
  return (
    <div className="mt-5 flex items-center justify-between gap-4">
      <div className="text-[12.5px] text-muted-foreground">
        {lastRun
          ? `Last run: ${lastRun.proposedCount} proposals, ${lastRun.status.replace(/_/g, " ")}.`
          : "No runs yet."}
      </div>
      <Button onClick={onStart} disabled={!!busy}>
        {busy ?? "Propose all unmapped →"}
      </Button>
    </div>
  );
}

// ─── Running ───────────────────────────────────────────────────────────

function RunningState({
  run,
  busy,
  onCancel,
}: {
  run: BulkRunView;
  busy: string | null;
  onCancel: () => void;
}) {
  const pct =
    run.batchesTotal > 0
      ? Math.round((run.batchesDone / run.batchesTotal) * 100)
      : 0;
  const elapsed = useElapsed(run.startedAt);

  return (
    <div className="mt-5 space-y-3">
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="font-mono text-muted-foreground">
          batch {run.batchesDone} / {run.batchesTotal} · {pct}% · elapsed{" "}
          {elapsed}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={!!busy}
        >
          {busy ?? "Cancel"}
        </Button>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-foreground transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-2 text-[11.5px] font-mono text-muted-foreground">
        <span>
          proposed: <span className="text-foreground">{run.proposedCount}</span>
        </span>
        {Object.entries(run.actionCounts).map(([a, n]) => (
          <span key={a}>
            {a}: <span className="text-foreground">{n}</span>
          </span>
        ))}
      </div>
      {run.failedBatches.length > 0 && (
        <div className="rounded-md border border-flag-high/30 bg-flag-high/5 p-2 text-[11.5px]">
          <div className="font-medium text-flag-high">
            {run.failedBatches.length} batch(es) failed — will retry in next run
          </div>
          {run.failedBatches.slice(0, 2).map((b) => (
            <div key={b.batchIdx} className="mt-1 font-mono text-muted-foreground">
              batch {b.batchIdx}: {b.error.slice(0, 120)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function useElapsed(startedAt: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!startedAt) return "—";
  const started = new Date(startedAt + "Z").getTime();
  const ms = Math.max(0, now - started);
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

// ─── Review ────────────────────────────────────────────────────────────

function ReviewState({
  run,
  proposals,
  filteredProposals,
  actionFilter,
  setActionFilter,
  statusFilter,
  setStatusFilter,
  busy,
  onApprove,
  onReject,
  onApproveAllVisible,
  onRunFixup,
  onApply,
  onPatchProposal,
}: {
  run: BulkRunView;
  proposals: BulkProposalView[];
  filteredProposals: BulkProposalView[];
  actionFilter: ActionFilter;
  setActionFilter: (v: ActionFilter) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (v: StatusFilter) => void;
  busy: string | null;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  onApproveAllVisible: () => void;
  onRunFixup: () => void;
  onApply: (includeUnreviewed: boolean) => void;
  onPatchProposal: (id: number, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const approvedCount = proposals.filter((p) => p.status === "approved").length;
  const pendingCount = proposals.filter((p) => p.status === "pending").length;

  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="font-mono text-muted-foreground">filter:</span>
        <ChipGroup
          options={[
            ["all", `all (${proposals.length})`],
            ["map_existing", `map_existing (${run.actionCounts.map_existing ?? 0})`],
            ["create_new", `create_new (${run.actionCounts.create_new ?? 0})`],
            ["skip", `skip (${run.actionCounts.skip ?? 0})`],
          ]}
          value={actionFilter}
          onChange={(v) => setActionFilter(v as ActionFilter)}
        />
        <ChipGroup
          options={[
            ["all", "all statuses"],
            ["pending", `pending (${run.statusCounts.pending ?? 0})`],
            ["approved", `approved (${run.statusCounts.approved ?? 0})`],
            ["rejected", `rejected (${run.statusCounts.rejected ?? 0})`],
          ]}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
        />
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={onRunFixup} disabled={!!busy}>
            Run fixup
          </Button>
          <Button variant="outline" size="sm" onClick={onApproveAllVisible} disabled={!!busy}>
            Approve all visible
          </Button>
        </div>
      </div>

      {busy && (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
          {busy}
        </div>
      )}

      <div className="rounded-xl border border-border">
        {filteredProposals.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
            No proposals match the current filters.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filteredProposals.map((p) => (
              <ProposalRow
                key={p.id}
                proposal={p}
                onApprove={() => onApprove(p.id)}
                onReject={() => onReject(p.id)}
                onPatch={(body) => onPatchProposal(p.id, body)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <div className="text-[12.5px] text-muted-foreground">
          <span className="font-mono text-foreground">{approvedCount}</span>{" "}
          approved · <span className="font-mono text-foreground">{pendingCount}</span>{" "}
          pending
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!!busy}
            onClick={() => onApply(true)}
          >
            Apply (include unreviewed)
          </Button>
          <Button
            disabled={!!busy || approvedCount === 0}
            onClick={() => onApply(false)}
          >
            {busy ?? `Apply ${approvedCount} approved →`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ChipGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium transition-colors",
            value === v
              ? "border-foreground bg-foreground text-background"
              : "border-border text-muted-foreground hover:bg-muted/40",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ProposalRow({
  proposal,
  onApprove,
  onReject,
  onPatch,
}: {
  proposal: BulkProposalView;
  onApprove: () => void;
  onReject: () => void;
  onPatch: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const isPending = proposal.status === "pending";
  const statusTone =
    proposal.status === "approved"
      ? "text-flag-ok"
      : proposal.status === "rejected"
        ? "text-muted-foreground line-through"
        : proposal.status === "applied"
          ? "text-flag-ok"
          : proposal.status === "apply_error"
            ? "text-flag-high"
            : "text-foreground";

  return (
    <li className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-serif-display text-[15px]">{proposal.rawName}</span>
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {proposal.occurrenceCount}× · conf {proposal.confidence.toFixed(2)}
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-2 text-[12px]">
            <ActionBadge action={proposal.action} />
            <ProposalSummary proposal={proposal} />
          </div>
          {proposal.reason && (
            <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">
              {proposal.reason}
            </div>
          )}
          {proposal.applyError && (
            <div className="mt-1 font-mono text-[10.5px] text-flag-high">
              apply error: {proposal.applyError}
            </div>
          )}
          {expanded && (
            <ExpandedDetails proposal={proposal} onPatch={onPatch} />
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn("font-mono text-[10.5px]", statusTone)}>
            {proposal.status}
          </span>
          {isPending && (
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={onReject}>
                Reject
              </Button>
              <Button size="sm" onClick={onApprove}>
                Approve
              </Button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
          >
            {expanded ? "hide details" : "edit / details"}
          </button>
        </div>
      </div>
    </li>
  );
}

function ActionBadge({ action }: { action: BulkProposalView["action"] }) {
  const color =
    action === "map_existing"
      ? "bg-flag-ok/10 text-flag-ok border-flag-ok/40"
      : action === "create_new"
        ? "bg-foreground/5 text-foreground border-border"
        : "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded border px-1.5 font-mono text-[10px]",
        color,
      )}
    >
      {action}
    </span>
  );
}

function ProposalSummary({ proposal }: { proposal: BulkProposalView }) {
  if (proposal.action === "map_existing") {
    return (
      <span>
        → <span className="font-medium">{proposal.proposedCanonicalName ?? "(unresolved)"}</span>
      </span>
    );
  }
  if (proposal.action === "create_new" && proposal.newCanonical) {
    const cat = proposal.newCanonical.category as CategorySlug;
    return (
      <span>
        + <span className="font-medium">{proposal.newCanonical.canonicalName}</span>{" "}
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {CATEGORY_LABELS[cat] ?? proposal.newCanonical.category}
        </span>
      </span>
    );
  }
  return <span className="text-muted-foreground">skip</span>;
}

function ExpandedDetails({
  proposal,
  onPatch,
}: {
  proposal: BulkProposalView;
  onPatch: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const descRef = useRef<HTMLInputElement>(null);

  if (proposal.action === "create_new" && proposal.newCanonical) {
    return (
      <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/20 p-2 text-[12px]">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="mb-0.5 font-mono text-[10px] uppercase text-muted-foreground">
              canonicalName
            </div>
            <input
              ref={nameRef}
              defaultValue={proposal.newCanonical.canonicalName}
              className="h-7 w-full rounded border border-input bg-transparent px-2 text-[12px]"
            />
          </div>
          <div>
            <div className="mb-0.5 font-mono text-[10px] uppercase text-muted-foreground">
              category
            </div>
            <select
              ref={categoryRef}
              defaultValue={proposal.newCanonical.category}
              className="h-7 w-full rounded border border-input bg-transparent px-1 text-[12px]"
            >
              {Object.entries(CATEGORY_LABELS).map(([slug, label]) => (
                <option key={slug} value={slug}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <div className="mb-0.5 font-mono text-[10px] uppercase text-muted-foreground">
            description
          </div>
          <input
            ref={descRef}
            defaultValue={proposal.newCanonical.description}
            className="h-7 w-full rounded border border-input bg-transparent px-2 text-[12px]"
          />
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onPatch({
                newCanonical: {
                  canonicalName: nameRef.current?.value ?? proposal.newCanonical?.canonicalName,
                  category: categoryRef.current?.value ?? proposal.newCanonical?.category,
                  tags: proposal.newCanonical?.tags ?? [],
                  preferredUnits: proposal.newCanonical?.preferredUnits ?? null,
                  description: descRef.current?.value ?? proposal.newCanonical?.description ?? "",
                },
              })
            }
          >
            Save & approve
          </Button>
        </div>
      </div>
    );
  }

  if (proposal.extraAliases.length) {
    return (
      <div className="mt-2 rounded-md border border-border bg-muted/20 p-2 text-[11.5px] text-muted-foreground">
        <span className="font-mono text-[10px] uppercase">extra aliases:</span>{" "}
        {proposal.extraAliases.join(", ")}
      </div>
    );
  }

  return null;
}
