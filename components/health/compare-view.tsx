"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  COMPARE_PALETTE,
  CompareChart,
} from "@/components/health/compare-chart";
import type { CompareCanonicalOption, CompareSeries } from "@/lib/compare";
import type { OverlayBand, OverlayMarker } from "@/lib/overlays";
import { CATEGORY_LABELS } from "@/db/seeds/taxonomy";

const MAX_METRICS = 4;

interface CompareViewProps {
  series: CompareSeries[];
  domainStart: number | null;
  domainEnd: number | null;
  candidates: CompareCanonicalOption[];
  bands: OverlayBand[];
  markers: OverlayMarker[];
}

export function CompareView({
  series,
  domainStart,
  domainEnd,
  candidates,
  bands,
  markers,
}: CompareViewProps) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedIds = useMemo(() => new Set(series.map((s) => s.canonicalMetricId)), [series]);

  const navigate = (ids: number[]) => {
    if (ids.length === 0) {
      router.push("/compare");
    } else {
      router.push(`/compare?m=${ids.join(",")}`);
    }
  };

  const remove = (id: number) => {
    const next = series.filter((s) => s.canonicalMetricId !== id).map((s) => s.canonicalMetricId);
    navigate(next);
  };

  const add = (id: number) => {
    if (selectedIds.has(id)) return;
    const next = [...series.map((s) => s.canonicalMetricId), id];
    navigate(next.slice(0, MAX_METRICS));
    setPickerOpen(false);
    setQuery("");
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = candidates.filter((c) => !selectedIds.has(c.id));
    if (!q) return base.slice(0, 20);
    return base
      .filter(
        (c) =>
          c.canonicalName.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [candidates, selectedIds, query]);

  const atMax = series.length >= MAX_METRICS;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3">
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
          Chart includes
        </span>
        {series.length === 0 ? (
          <span className="text-[12.5px] text-muted-foreground">
            Nothing selected — add up to 4 metrics.
          </span>
        ) : (
          series.map((s, i) => {
            const color = COMPARE_PALETTE[i % COMPARE_PALETTE.length];
            return (
              <span
                key={s.canonicalMetricId}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium"
                style={{ borderColor: color, color }}
              >
                {s.canonicalName}
                <button
                  type="button"
                  onClick={() => remove(s.canonicalMetricId)}
                  aria-label={`Remove ${s.canonicalName}`}
                  className="grid h-4 w-4 place-items-center rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                >
                  ×
                </button>
              </span>
            );
          })
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-1 h-7"
          disabled={atMax}
          onClick={() => setPickerOpen((v) => !v)}
        >
          {pickerOpen ? "Close" : "+ Metric"}
        </Button>
        <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">
          {series.length}/{MAX_METRICS} · max 4
        </span>
      </div>

      {pickerOpen && !atMax && (
        <div className="mb-4 rounded-xl border border-border bg-card p-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search canonical metrics…"
            className="h-9"
            autoFocus
          />
          <ul className="mt-2 max-h-60 overflow-y-auto rounded-md border border-border">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-[12.5px] text-muted-foreground">
                No canonical metrics match — or all matching are already selected.
              </li>
            ) : (
              filtered.map((c) => (
                <li
                  key={c.id}
                  className="flex cursor-pointer items-baseline justify-between gap-2 border-b border-border px-3 py-2 text-[13px] last:border-b-0 hover:bg-muted/40"
                  onClick={() => add(c.id)}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.canonicalName}</div>
                    <div className="font-mono text-[10.5px] text-muted-foreground">
                      {CATEGORY_LABELS[c.category as keyof typeof CATEGORY_LABELS] ?? c.category}
                      {" · "}
                      {c.metricRowCount} row{c.metricRowCount === 1 ? "" : "s"}
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {series.length === 0 ? (
        <EmptyCompare />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {series.map((s, i) => (
            <CompareChart
              key={s.canonicalMetricId}
              series={s}
              domainStart={domainStart ?? Date.now()}
              domainEnd={domainEnd ?? Date.now()}
              colorIndex={i}
              bands={bands}
              markers={markers}
            />
          ))}
        </div>
      )}

      <SharedAxisStrip
        domainStart={domainStart}
        domainEnd={domainEnd}
        hasData={series.length > 0 && domainStart != null && domainEnd != null}
      />
    </div>
  );
}

function SharedAxisStrip({
  domainStart,
  domainEnd,
  hasData,
}: {
  domainStart: number | null;
  domainEnd: number | null;
  hasData: boolean;
}) {
  if (!hasData || domainStart == null || domainEnd == null) return null;
  const startYear = new Date(domainStart).getFullYear();
  const endYear = new Date(domainEnd).getFullYear();
  const years: number[] = [];
  for (let y = startYear; y <= endYear; y++) years.push(y);
  return (
    <div className={cn("mt-3 flex justify-between border-t border-border px-10 pt-3 font-mono text-[10.5px] text-muted-foreground")}>
      {years.map((y) => (
        <span key={y}>{y}</span>
      ))}
    </div>
  );
}

function EmptyCompare() {
  return (
    <div className="rounded-xl border border-dashed border-border p-12 text-center">
      <div className="font-serif-display text-[20px]">Nothing to compare yet</div>
      <p className="mt-2 text-[13px] text-muted-foreground">
        Pick up to four canonical metrics to plot them side-by-side on a shared time axis.
      </p>
    </div>
  );
}
