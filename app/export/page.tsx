import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ExportForm } from "@/components/health/export-form";
import { PageHeader, Stat } from "@/components/health/page-header";
import { TopBar } from "@/components/health/top-bar";
import { computeExportCounts, getExportCandidates } from "@/lib/export";

export const dynamic = "force-dynamic";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function aYearAgoIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

export default function ExportPage() {
  const from = aYearAgoIso();
  const to = todayIso();
  const candidates = getExportCandidates(from, to);
  const { categoryCounts, tagCounts } = computeExportCounts(candidates);

  // Pre-select flagged metrics from the past year — a sensible starting
  // point for a clinician export.
  const preselected = candidates
    .filter((c) => c.flaggedInWindow > 0)
    .map((c) => c.id);

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="export" />
      <PageHeader
        crumbs={["Export"]}
        title="Export for doctor"
        subtitle="Pick a window and a set of canonical metrics. PDF and CSV download directly."
        stats={
          <>
            <Stat label="Window" value={`${12} mo`} sub="default" />
            <Stat
              label="Metrics"
              value={candidates.length}
              sub="have data in default window"
            />
            <Stat
              label="Flagged"
              value={preselected.length}
              sub="pre-selected"
            />
          </>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/">Back</Link>
          </Button>
        }
      />

      <div className="px-8 pb-10">
        <ExportForm
          candidates={candidates}
          categoryCounts={categoryCounts}
          tagCounts={tagCounts}
          defaultFrom={from}
          defaultTo={to}
          preselectedIds={preselected}
        />
      </div>
    </div>
  );
}
