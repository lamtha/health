import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  BulkMappingPanel,
  type BulkRunView,
} from "@/components/health/bulk-mapping-panel";
import { MappingRow } from "@/components/health/mapping-row";
import { PageHeader, Stat } from "@/components/health/page-header";
import { TopBar } from "@/components/health/top-bar";
import { getLatestActiveRun } from "@/lib/bulk-map";
import { getCanonicalOptions, getUnmappedSummary } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function MappingsPage() {
  const summary = getUnmappedSummary();
  const canonicals = getCanonicalOptions();
  const activeRun = getLatestActiveRun() as BulkRunView | null;

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="dashboard" />
      <PageHeader
        crumbs={["Dashboard", "Mappings"]}
        title="Map unknown metrics"
        subtitle={
          summary.totalUnmappedMetrics === 0
            ? "Nothing unmapped — every metric row is linked to a canonical."
            : "Propose mappings with Claude in bulk, or map individually below. Either path backfills every matching metric row."
        }
        stats={
          <>
            <Stat
              label="Unmapped metrics"
              value={summary.totalUnmappedMetrics}
              sub={`${summary.distinctRawNames} distinct names`}
              accent={
                summary.totalUnmappedMetrics > 0 ? "text-flag-high" : undefined
              }
            />
            <Stat
              label="Canonical metrics"
              value={canonicals.length}
              sub="in taxonomy"
            />
          </>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/">Back to dashboard</Link>
          </Button>
        }
      />

      <div className="space-y-6 px-8 pb-10">
        <BulkMappingPanel initialRun={activeRun} />

        {activeRun?.status === "applied" && (
          <Card className="border-dashed">
            <CardContent className="py-3 text-[12.5px] text-muted-foreground">
              <span className="font-mono text-[10.5px] uppercase tracking-wider text-foreground">
                dev tip
              </span>{" "}
              · Run{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">
                pnpm bulk-map --export-seed --out=/tmp/seed-diff.ts
              </code>{" "}
              to capture the new canonicals + aliases into a fragment you can
              paste into{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">
                db/seeds/canonical-metrics.ts
              </code>{" "}
              so future installs ship with them.
            </CardContent>
          </Card>
        )}

        {summary.rows.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="font-serif-display text-[22px]">All clear</div>
              <p className="max-w-md text-[13px] text-muted-foreground">
                Every metric currently in the database resolves to a canonical
                metric. Upload another report to see new mappings land here.
              </p>
              <Button asChild className="mt-2">
                <Link href="/uploads">Upload →</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <div className="font-serif-display text-[18px]">
                Manual review
              </div>
              <div className="text-[12px] text-muted-foreground">
                one-off mappings — useful for small handfuls or anything the
                bulk pass got wrong
              </div>
            </div>
            <div className="grid gap-3">
              {summary.rows.map((r) => (
                <MappingRow
                  key={r.rawName}
                  rawName={r.rawName}
                  occurrenceCount={r.occurrenceCount}
                  providers={r.providers}
                  sampleReportId={r.sampleReportId}
                  sampleReportDate={r.sampleReportDate}
                  sampleValue={r.sampleValue}
                  sampleUnits={r.sampleUnits}
                  canonicals={canonicals}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
