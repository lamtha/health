import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CategoryFilter } from "@/components/health/category-filter";
import { PageHeader, Stat } from "@/components/health/page-header";
import { TopBar } from "@/components/health/top-bar";
import { cn } from "@/lib/utils";
import { providerDisplayName } from "@/lib/providers";
import { CATEGORY_LABELS, TAG_LABELS } from "@/db/seeds/taxonomy";
import {
  type MetricsFilter,
  type ReportListRow,
  getAllReports,
  resolveMetricsFilter,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

const REPORT_TYPE_LABEL: Record<string, string> = {
  blood: "Blood",
  gi: "GI",
  imaging: "Imaging",
  aging: "Aging",
  clinical: "Clinical",
  wearable: "Wearable",
  other: "Other",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface PageProps {
  searchParams: Promise<{
    cat?: string;
    tag?: string;
    unmapped?: string;
  }>;
}

export default async function ReportsIndexPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filter = resolveMetricsFilter(params);
  const data = getAllReports(filter);
  const rows = data.rows;

  const byCategory = new Map<string, number>();
  let totalFlagged = 0;
  for (const r of rows) {
    byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
    totalFlagged += r.flaggedCount;
  }
  const categoryBits = Array.from(byCategory.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `${n} ${REPORT_TYPE_LABEL[cat] ?? cat}`)
    .join(" · ");

  const subtitle =
    rows.length === 0
      ? filter.kind === "all"
        ? "No reports ingested yet."
        : `No reports match this filter.`
      : filter.kind === "all"
        ? `Every ingested report, newest first. ${categoryBits}`
        : `${filterHeading(filter)} — ${categoryBits}`;

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="reports" />
      <PageHeader
        title="Reports"
        subtitle={subtitle}
        stats={
          <>
            <Stat label="Reports" value={rows.length} sub={filter.kind === "all" ? "ingested" : "in filter"} />
            <Stat
              label="Flagged"
              value={totalFlagged}
              sub="across reports"
              accent={totalFlagged > 0 ? "text-flag-high" : undefined}
            />
          </>
        }
        actions={
          <Button asChild>
            <Link href="/uploads">+ Upload</Link>
          </Button>
        }
      />

      <div className="px-8 pb-10">
        <CategoryFilter
          basePath="/reports"
          filter={filter}
          categoryCounts={data.categoryCounts}
          tagCounts={data.tagCounts}
          unmappedCount={data.unmappedReportCount}
          entityLabel="report"
        />

        {rows.length === 0 ? (
          <Card className="border-dashed">
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="font-serif-display text-[22px]">
                {filter.kind === "all" ? "Nothing here yet" : "No reports match"}
              </div>
              <p className="max-w-md text-[13px] text-muted-foreground">
                {filter.kind === "all"
                  ? "Upload a PDF to extract metrics with Claude."
                  : "Try a different filter, or clear it."}
              </p>
              <Button asChild className="mt-2" variant={filter.kind === "all" ? "default" : "outline"}>
                <Link href={filter.kind === "all" ? "/uploads" : "/reports"}>
                  {filter.kind === "all" ? "Upload a report →" : "Clear filter"}
                </Link>
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Date</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Metrics</TableHead>
                  <TableHead className="text-right">Flagged</TableHead>
                  <TableHead className="pr-5 text-right">Ingested</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <ReportRow key={r.id} r={r} />
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
}

function filterHeading(filter: MetricsFilter): string {
  if (filter.kind === "all") return "All reports";
  if (filter.kind === "unmapped") return "Reports with unmapped metrics";
  if (filter.kind === "category")
    return `Reports containing ${CATEGORY_LABELS[filter.slug as keyof typeof CATEGORY_LABELS] ?? filter.slug}`;
  if (filter.kind === "tag")
    return `Reports tagged ${TAG_LABELS[filter.slug as keyof typeof TAG_LABELS] ?? filter.slug}`;
  return "All reports";
}

function ReportRow({ r }: { r: ReportListRow }) {
  return (
    <TableRow className="cursor-pointer hover:bg-muted/40">
      <TableCell className="pl-5 font-mono text-[12px]">
        <Link href={`/reports/${r.id}`} className="block">
          {formatDate(r.reportDate)}
        </Link>
      </TableCell>
      <TableCell className="text-[13px] font-medium">
        <Link href={`/reports/${r.id}`} className="block">
          {providerDisplayName(r.provider)}
        </Link>
      </TableCell>
      <TableCell className="text-[12.5px] text-muted-foreground">
        <Link href={`/reports/${r.id}`} className="block">
          {REPORT_TYPE_LABEL[r.category] ?? r.category}
        </Link>
      </TableCell>
      <TableCell className="text-right font-mono text-[12.5px]">
        <Link href={`/reports/${r.id}`} className="block">
          {r.metricCount}
        </Link>
      </TableCell>
      <TableCell
        className={cn(
          "text-right font-mono text-[12.5px]",
          r.flaggedCount > 0 ? "text-flag-high" : "text-muted-foreground",
        )}
      >
        <Link href={`/reports/${r.id}`} className="block">
          {r.flaggedCount}
        </Link>
      </TableCell>
      <TableCell className="pr-5 text-right font-mono text-[11.5px] text-muted-foreground">
        <Link href={`/reports/${r.id}`} className="block">
          {formatDate(r.uploadedAt)}
        </Link>
      </TableCell>
    </TableRow>
  );
}
