import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MappingRow } from "@/components/health/mapping-row";
import { PageHeader, Stat } from "@/components/health/page-header";
import { TopBar } from "@/components/health/top-bar";
import { getCanonicalOptions, getUnmappedSummary } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function MappingsPage() {
  const summary = getUnmappedSummary();
  const canonicals = getCanonicalOptions();

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="dashboard" />
      <PageHeader
        crumbs={["Dashboard", "Mappings"]}
        title="Map unknown metrics"
        subtitle={
          summary.totalUnmappedMetrics === 0
            ? "Nothing unmapped — every metric row is linked to a canonical."
            : "Each row below is a raw metric name that hasn't been seen before. Mapping one backfills every metric with that name so charts + filters pick it up."
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

      <div className="px-8 pb-10">
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
        )}
      </div>
    </div>
  );
}
