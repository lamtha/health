import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryFilter } from "@/components/health/category-filter";
import { Flag, type FlagValue } from "@/components/health/flag";
import { PageHeader, Stat } from "@/components/health/page-header";
import { SearchTrigger } from "@/components/health/search-trigger";
import { Sparkline } from "@/components/health/sparkline";
import { TopBar } from "@/components/health/top-bar";
import { UnmappedBanner } from "@/components/health/unmapped-banner";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS, TAG_LABELS } from "@/db/seeds/taxonomy";
import {
  type DashboardMetric,
  type DashboardReportRow,
  type MetricsFilter,
  getDashboardSummary,
  resolveMetricsFilter,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    cat?: string;
    tag?: string;
    unmapped?: string;
  }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filter = resolveMetricsFilter(params);
  const data = getDashboardSummary(filter);
  const flagged = data.metrics.filter(
    (m) => m.lastFlag === "high" || m.lastFlag === "low",
  );
  const normal = data.metrics.filter(
    (m) => m.lastFlag === "ok" || m.lastFlag === null,
  );

  const filterLabel = filterHeading(filter);

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="dashboard" />
      <PageHeader
        title="Dashboard"
        subtitle={
          filter.kind === "all"
            ? "All tracked metrics across blood, GI, and imaging — surfaced by what needs attention."
            : `Filtering to ${filterLabel}.`
        }
        stats={
          <>
            <Stat label="Metrics" value={data.metricCount} sub={filter.kind === "all" ? "tracked" : "in filter"} />
            <Stat
              label="Flagged"
              value={data.flaggedCount}
              sub="out of range"
              accent={data.flaggedCount > 0 ? "text-flag-high" : undefined}
            />
            <Stat label="Reports" value={data.reportCount} sub="ingested" />
          </>
        }
      />

      <div className="px-8 pb-6">
        {data.reportCount === 0 ? (
          <EmptyState />
        ) : (
          <>
            {data.unmappedDistinctNames > 0 && (
              <UnmappedBanner
                metricRows={data.unmappedMetricRows}
                distinctNames={data.unmappedDistinctNames}
              />
            )}

            <div className="mb-3">
              <SearchTrigger variant="full" />
            </div>

            <CategoryFilter
              basePath="/"
              filter={filter}
              categoryCounts={data.categoryCounts}
              tagCounts={data.tagCounts}
              unmappedCount={data.unmappedDistinctNames}
              entityLabel="metric"
            />

            <div className="grid grid-cols-[1fr_320px] gap-6">
              <div>
                {data.metrics.length === 0 ? (
                  <EmptyFilter filter={filter} />
                ) : (
                  <>
                    <SectionRow title="Needs attention" count={flagged.length} tone="flagged" />
                    {flagged.length > 0 ? (
                      <div className="mb-8 grid grid-cols-3 gap-3">
                        {flagged.map((m) => (
                          <MetricCard key={m.name} m={m} />
                        ))}
                      </div>
                    ) : (
                      <p className="mb-8 text-[13px] text-muted-foreground">
                        Nothing flagged. All tracked metrics are in range.
                      </p>
                    )}

                    <SectionRow title="In range" count={normal.length} tone="ok" />
                    <div className="grid grid-cols-3 gap-3">
                      {normal.map((m) => (
                        <MetricCard key={m.name} m={m} />
                      ))}
                    </div>
                  </>
                )}
              </div>

              <aside className="flex flex-col gap-4">
                <RecentReportsCard reports={data.recentReports} />
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function filterHeading(filter: MetricsFilter): string {
  if (filter.kind === "all") return "all metrics";
  if (filter.kind === "unmapped") return "metrics not yet linked to a canonical";
  if (filter.kind === "category")
    return `${CATEGORY_LABELS[filter.slug as keyof typeof CATEGORY_LABELS] ?? filter.slug} metrics`;
  if (filter.kind === "tag")
    return `${TAG_LABELS[filter.slug as keyof typeof TAG_LABELS] ?? filter.slug} metrics`;
  return "all metrics";
}

function SectionRow({
  title,
  count,
  tone,
}: {
  title: string;
  count: number;
  tone: "flagged" | "ok";
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[16px] font-semibold text-foreground">{title}</h2>
        <span
          className={cn(
            "font-mono text-[12px]",
            tone === "flagged" ? "text-flag-high" : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      </div>
    </div>
  );
}

function MetricCard({ m }: { m: DashboardMetric }) {
  const trendGlyph = { up: "↗", down: "↘", flat: "→" }[m.trend];
  const trendCol =
    m.lastFlag === "high"
      ? "text-flag-high"
      : m.lastFlag === "low"
        ? "text-flag-low"
        : "text-muted-foreground";
  const display =
    m.lastValue != null
      ? `${m.lastValue}${m.lastUnits ? ` ${m.lastUnits}` : ""}`
      : (m.lastValueText ?? "—");

  const categoryLabel =
    CATEGORY_LABELS[m.category as keyof typeof CATEGORY_LABELS] ?? m.category;

  return (
    <Link
      href={`/metric/${encodeURIComponent(m.name)}`}
      className="group block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Card className="py-0 transition-shadow group-hover:shadow-md">
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                {categoryLabel} · {m.reportCount} report
                {m.reportCount === 1 ? "" : "s"}
              </div>
              <div className="font-serif-display mt-1 truncate text-[22px] leading-none">
                {m.name}
              </div>
            </div>
            <Flag flag={m.lastFlag as FlagValue} />
          </div>
          <div className="my-3">
            <Sparkline
              values={m.history}
              flag={m.lastFlag}
              width={240}
              height={38}
            />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[13px] text-foreground">
              {display}
            </span>
            <span className={cn("font-mono text-[11.5px]", trendCol)}>
              {trendGlyph} {m.trend}
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function RecentReportsCard({ reports }: { reports: DashboardReportRow[] }) {
  return (
    <Card className="py-0">
      <CardHeader className="flex flex-row items-center justify-between border-b px-5 py-3">
        <CardTitle className="text-[13px]">Recent reports</CardTitle>
        <span className="font-mono text-[11px] text-muted-foreground">last 5</span>
      </CardHeader>
      <div className="divide-y divide-border">
        {reports.length === 0 ? (
          <div className="px-4 py-3 text-[12.5px] text-muted-foreground">
            No reports yet.
          </div>
        ) : (
          reports.map((r) => (
            <Link
              key={r.id}
              href={`/reports/${r.id}`}
              className="block px-4 py-2.5 transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="truncate text-[13px] font-medium text-foreground">
                  {r.provider}
                </div>
                <div className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {r.reportDate ?? "—"}
                </div>
              </div>
              <div className="font-mono text-[11.5px] text-muted-foreground">
                {r.category} · {r.metricCount} metrics
              </div>
            </Link>
          ))
        )}
      </div>
      <CardContent className="border-t px-5 py-3">
        <div className="flex flex-col gap-2">
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link href="/uploads">+ Upload new report</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link href="/export">Export for doctor →</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="font-serif-display text-[26px]">No reports yet</div>
        <p className="max-w-md text-[13px] text-muted-foreground">
          Drop a PDF to extract metrics with Claude and populate the dashboard.
          Nothing is sent anywhere except the Anthropic API for extraction.
        </p>
        <Button asChild className="mt-2">
          <Link href="/uploads">Upload your first report →</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptyFilter({ filter }: { filter: MetricsFilter }) {
  return (
    <Card className="border-dashed py-12">
      <CardContent className="text-center">
        <div className="font-serif-display text-[20px]">No metrics match</div>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Nothing in this category yet.
          {filter.kind === "unmapped" ? " (All metrics are mapped — nice.)" : null}
        </p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link href="/">Clear filter</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
