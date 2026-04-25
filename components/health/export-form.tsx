"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ExportCategoryFilter } from "@/components/health/export-category-filter";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS } from "@/db/seeds/taxonomy";
import type { ExportCandidate } from "@/lib/export";

export interface ExportFormProps {
  candidates: ExportCandidate[];
  categoryCounts: Record<string, number>;
  tagCounts: Record<string, number>;
  defaultFrom: string;
  defaultTo: string;
  preselectedIds: number[];
}

type Preset = "3m" | "6m" | "12m" | "24m" | "all" | "custom";

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ExportForm({
  candidates,
  categoryCounts,
  tagCounts,
  defaultFrom,
  defaultTo,
  preselectedIds,
}: ExportFormProps) {
  const [preset, setPreset] = useState<Preset>("12m");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(preselectedIds),
  );
  const [query, setQuery] = useState("");
  const [activeCategories, setActiveCategories] = useState<Set<string>>(
    () => new Set(),
  );
  const [activeTags, setActiveTags] = useState<Set<string>>(() => new Set());

  function applyPreset(p: Preset) {
    setPreset(p);
    const now = todayIso();
    if (p === "custom") return;
    if (p === "all") {
      setFrom("2000-01-01");
      setTo(now);
      return;
    }
    const months = p === "3m" ? 3 : p === "6m" ? 6 : p === "12m" ? 12 : 24;
    setFrom(daysAgoIso(Math.round(months * 30.5)));
    setTo(now);
  }

  const chipFiltered = useMemo(() => {
    if (activeCategories.size === 0 && activeTags.size === 0) return candidates;
    return candidates.filter((c) => {
      if (activeCategories.has(c.category)) return true;
      for (const t of c.tags) if (activeTags.has(t)) return true;
      return false;
    });
  }, [candidates, activeCategories, activeTags]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chipFiltered;
    return chipFiltered.filter(
      (c) =>
        c.canonicalName.toLowerCase().includes(q) ||
        c.categoryLabel.toLowerCase().includes(q),
    );
  }, [chipFiltered, query]);

  const chipsActive = activeCategories.size > 0 || activeTags.size > 0;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleToggleCategory(slug: string) {
    const wasActive = activeCategories.has(slug);
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (wasActive) next.delete(slug);
      else next.add(slug);
      return next;
    });
    const matchingIds = candidates
      .filter((c) => c.category === slug)
      .map((c) => c.id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (wasActive) for (const id of matchingIds) next.delete(id);
      else for (const id of matchingIds) next.add(id);
      return next;
    });
  }

  function handleToggleTag(slug: string) {
    const wasActive = activeTags.has(slug);
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (wasActive) next.delete(slug);
      else next.add(slug);
      return next;
    });
    const matchingIds = candidates
      .filter((c) => c.tags.includes(slug))
      .map((c) => c.id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (wasActive) for (const id of matchingIds) next.delete(id);
      else for (const id of matchingIds) next.add(id);
      return next;
    });
  }

  function clearAllChips() {
    setActiveCategories(new Set());
    setActiveTags(new Set());
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of filtered) next.add(c.id);
      return next;
    });
  }

  const valid = selected.size > 0 && !!from && !!to && from <= to;
  const ids = [...selected].join(",");
  const pdfHref = valid
    ? `/api/export/pdf?from=${from}&to=${to}&m=${ids}`
    : "#";
  const csvHref = valid
    ? `/api/export/csv?from=${from}&to=${to}&m=${ids}`
    : "#";

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-2 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
          Date window
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["3m", "6m", "12m", "24m", "all", "custom"] as Preset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => applyPreset(p)}
              className={cn(
                "inline-flex h-7 items-center rounded-full border px-3 text-[12px] font-medium",
                preset === p
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:bg-muted/40",
              )}
            >
              {p === "3m" && "3 mo"}
              {p === "6m" && "6 mo"}
              {p === "12m" && "12 mo"}
              {p === "24m" && "24 mo"}
              {p === "all" && "All-time"}
              {p === "custom" && "Custom"}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPreset("custom");
              }}
              className="h-8 w-36"
            />
            <span className="text-[11px] text-muted-foreground">→</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPreset("custom");
              }}
              className="h-8 w-36"
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-baseline gap-3">
          <div className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
            Metrics
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            {selected.size} selected ·{" "}
            {chipsActive
              ? `${chipFiltered.length} of ${candidates.length} visible`
              : `${candidates.length} available in window`}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={selectAllVisible}
              disabled={filtered.length === 0}
            >
              Select all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
        <ExportCategoryFilter
          categoryCounts={categoryCounts}
          tagCounts={tagCounts}
          activeCategories={activeCategories}
          activeTags={activeTags}
          onToggleCategory={handleToggleCategory}
          onToggleTag={handleToggleTag}
          onClearAll={clearAllChips}
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter metric list…"
          className="mb-3 h-9"
        />
        <ul className="max-h-[360px] overflow-y-auto rounded-md border border-border">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-[12.5px] text-muted-foreground">
              {candidates.length === 0
                ? "No metrics with data in this window."
                : "No matches — try a different term."}
            </li>
          ) : (
            filtered.map((c) => {
              const isSelected = selected.has(c.id);
              return (
                <li
                  key={c.id}
                  onClick={() => toggle(c.id)}
                  className={cn(
                    "flex cursor-pointer items-baseline justify-between gap-2 border-b border-border px-3 py-2 text-[13px] last:border-b-0",
                    isSelected ? "bg-muted/60" : "hover:bg-muted/30",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "grid h-4 w-4 place-items-center rounded-sm border",
                        isSelected
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-background",
                      )}
                      aria-hidden
                    >
                      {isSelected ? "✓" : ""}
                    </span>
                    <div>
                      <div className="font-medium">{c.canonicalName}</div>
                      <div className="font-mono text-[10.5px] text-muted-foreground">
                        {CATEGORY_LABELS[c.category as keyof typeof CATEGORY_LABELS] ??
                          c.categoryLabel}
                        {" · "}
                        {c.observationsInWindow} obs
                        {c.flaggedInWindow > 0 ? ` · ${c.flaggedInWindow} flagged` : ""}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
          Download
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild disabled={!valid}>
            <a
              href={pdfHref}
              onClick={(e) => {
                if (!valid) e.preventDefault();
              }}
            >
              Download PDF
            </a>
          </Button>
          <Button asChild variant="outline" disabled={!valid}>
            <a
              href={csvHref}
              onClick={(e) => {
                if (!valid) e.preventDefault();
              }}
            >
              Download CSV
            </a>
          </Button>
          {!valid && (
            <span className="text-[12px] text-muted-foreground">
              Pick at least one metric and a valid date range.
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
