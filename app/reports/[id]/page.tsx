import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Flag } from "@/components/health/flag";
import { PageHeader } from "@/components/health/page-header";
import { TopBar } from "@/components/health/top-bar";
import { cn } from "@/lib/utils";
import { providerDisplayName } from "@/lib/providers";
import {
  getReportDetail,
  type ReportMetric,
  type ReportPanel,
} from "@/lib/report-detail";

import { ReExtractButton } from "./report-actions";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

function formatValue(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 100 && Number.isInteger(v)) return v.toString();
  return Number(v.toFixed(3)).toString();
}

function formatRange(m: ReportMetric): string {
  if (m.refLow != null && m.refHigh != null) {
    return `${formatValue(m.refLow)}–${formatValue(m.refHigh)}`;
  }
  if (m.refLow != null) return `≥ ${formatValue(m.refLow)}`;
  if (m.refHigh != null) return `≤ ${formatValue(m.refHigh)}`;
  return "—";
}

function formatValueCell(m: ReportMetric): string {
  if (m.valueNumeric != null) return formatValue(m.valueNumeric);
  if (m.valueText) return m.valueText;
  return "—";
}

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

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const CATEGORY_LABEL: Record<string, string> = {
  blood: "Blood",
  gi: "GI",
  imaging: "Imaging",
  aging: "Aging",
  clinical: "Clinical",
  wearable: "Wearable",
  other: "Other",
};

export default async function ReportDetailPage({ params }: PageProps) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isFinite(id)) notFound();

  const detail = getReportDetail(id);
  if (!detail) notFound();

  const { report, panels, flagged, latestExtraction, extractionCount } = detail;
  const providerLabel = providerDisplayName(report.provider);
  const categoryLabel = CATEGORY_LABEL[report.category] ?? report.category;
  const totalMetrics = panels.reduce((acc, p) => acc + p.metrics.length, 0);
  const subtitleBits = [
    formatDate(report.reportDate),
    `${totalMetrics} metric${totalMetrics === 1 ? "" : "s"}`,
    categoryLabel.toLowerCase(),
    `hash ${report.fileHash.slice(0, 8)}…${report.fileHash.slice(-4)}`,
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="reports" />
      <PageHeader
        crumbs={["Dashboard", "Reports"]}
        title={`${providerLabel} · ${categoryLabel}`}
        subtitle={subtitleBits.join(" · ")}
        actions={
          <>
            <ReExtractButton reportId={report.id} disabled={!report.pdfExists} />
            {report.pdfExists ? (
              <Button variant="outline" asChild>
                <a
                  href={`/api/reports/${report.id}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open source PDF
                </a>
              </Button>
            ) : (
              <Button variant="outline" disabled>
                PDF missing
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-[1fr_340px] items-start gap-4 px-8 pb-10">
        <div className="flex flex-col gap-4">
          {panels.length === 0 ? (
            <Card className="border-dashed">
              <div className="p-8 text-center text-[13px] text-muted-foreground">
                No metrics were extracted from this report.
              </div>
            </Card>
          ) : (
            panels.map((p, i) => <PanelCard key={p.id ?? `orphan-${i}`} panel={p} />)
          )}
        </div>

        <aside className="sticky top-20 flex flex-col gap-4">
          <SourceCard report={report} />
          <ExtractionCard
            reportId={report.id}
            latest={latestExtraction}
            extractionCount={extractionCount}
          />
          <OutOfRangeCard flagged={flagged} />
        </aside>
      </div>
    </div>
  );
}

function PanelCard({ panel }: { panel: ReportPanel }) {
  const flaggedCount = panel.metrics.filter(
    (m) => m.flag === "high" || m.flag === "low",
  ).length;
  return (
    <Card className="py-0">
      <CardHeader className="flex flex-row items-center justify-between border-b px-5 py-3">
        <CardTitle className="text-[13px]">{panel.name}</CardTitle>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {panel.metrics.length} metric{panel.metrics.length === 1 ? "" : "s"}
          {flaggedCount > 0 && ` · ${flaggedCount} flagged`}
        </span>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Metric</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Unit</TableHead>
            <TableHead className="text-right">Ref</TableHead>
            <TableHead className="text-right">Flag</TableHead>
            <TableHead className="pr-5 text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {panel.metrics.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="pl-5 text-[13px]">{m.name}</TableCell>
              <TableCell
                className={cn(
                  "text-right font-mono text-[13px] font-medium",
                  m.flag === "high" && "text-flag-high",
                  m.flag === "low" && "text-flag-low",
                )}
              >
                {formatValueCell(m)}
              </TableCell>
              <TableCell className="text-right font-mono text-[11.5px] text-muted-foreground">
                {m.units ?? ""}
              </TableCell>
              <TableCell className="text-right font-mono text-[11.5px] text-muted-foreground">
                {formatRange(m)}
              </TableCell>
              <TableCell className="text-right">
                <Flag flag={m.flag} />
              </TableCell>
              <TableCell className="pr-5 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  asChild
                >
                  <Link href={`/metric/${encodeURIComponent(m.canonicalName ?? m.name)}`}>
                    Trend →
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function SourceCard({
  report,
}: {
  report: {
    id: number;
    originalFilename: string;
    sizeBytes: number | null;
    pdfExists: boolean;
  };
}) {
  return (
    <Card className="py-0">
      <CardHeader className="flex flex-row items-center justify-between border-b px-5 py-3">
        <CardTitle className="text-[13px]">Source PDF</CardTitle>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {formatBytes(report.sizeBytes)}
        </span>
      </CardHeader>
      <div className="p-4">
        {report.pdfExists ? (
          <div className="aspect-[8.5/11] overflow-hidden rounded-md border border-border bg-muted/40">
            <iframe
              src={`/api/reports/${report.id}/pdf#view=FitH`}
              title="Source PDF"
              className="h-full w-full"
            />
          </div>
        ) : (
          <div className="flex aspect-[8.5/11] items-center justify-center rounded-md border border-dashed border-border bg-muted/20 p-4 text-center font-mono text-[11px] text-muted-foreground">
            Source PDF missing from <br />
            uploads/{report.originalFilename}
          </div>
        )}
        <div className="mt-2 truncate font-mono text-[10.5px] text-muted-foreground">
          {report.originalFilename}
        </div>
      </div>
    </Card>
  );
}

function ExtractionCard({
  reportId,
  latest,
  extractionCount,
}: {
  reportId: number;
  latest:
    | {
        id: number;
        model: string;
        extractorKind: "claude" | "deterministic";
        extractorVersion: number | null;
        elapsedMs: number | null;
        metricCount: number;
        createdAt: string;
        lowConfidenceCount: number;
        rawMetricCount: number;
      }
    | null;
  extractionCount: number;
}) {
  return (
    <Card className="py-0">
      <CardHeader className="border-b px-5 py-3">
        <CardTitle className="text-[13px]">Extraction</CardTitle>
      </CardHeader>
      <div className="space-y-1.5 p-4 text-[13px] text-foreground">
        {latest ? (
          <>
            <div className="flex items-center gap-2">
              <span>{latest.model}</span>
              {latest.extractorVersion != null && (
                <span className="font-mono text-[11px] text-muted-foreground">
                  v{latest.extractorVersion}
                </span>
              )}
              <span
                className={cn(
                  "rounded-sm border px-1.5 py-px font-mono text-[10px] uppercase tracking-wider",
                  latest.extractorKind === "deterministic"
                    ? "border-flag-ok/40 text-flag-ok"
                    : "border-border text-muted-foreground",
                )}
              >
                {latest.extractorKind === "deterministic" ? "offline" : "claude"}
              </span>
            </div>
            <div className="font-mono text-[11px] text-muted-foreground">
              {formatDate(latest.createdAt)} · {latest.rawMetricCount} metrics ·{" "}
              {latest.lowConfidenceCount} low-confidence
              {latest.elapsedMs != null
                ? ` · ${(latest.elapsedMs / 1000).toFixed(1)}s`
                : ""}
            </div>
            {extractionCount > 1 && (
              <div className="font-mono text-[11px] text-muted-foreground">
                {extractionCount} extraction runs total
              </div>
            )}
            <Button variant="outline" size="sm" className="mt-2" asChild>
              <a
                href={`/api/reports/${reportId}/extractions/${latest.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View raw JSON
              </a>
            </Button>
          </>
        ) : (
          <div className="font-mono text-[11px] text-muted-foreground">
            No extraction records stored.
          </div>
        )}
      </div>
    </Card>
  );
}

function OutOfRangeCard({ flagged }: { flagged: ReportMetric[] }) {
  return (
    <Card className="py-0">
      <CardHeader className="flex flex-row items-center justify-between border-b px-5 py-3">
        <CardTitle className="text-[13px]">Out of range</CardTitle>
        <span
          className={cn(
            "font-mono text-[10.5px]",
            flagged.length > 0 ? "text-flag-high" : "text-muted-foreground",
          )}
        >
          {flagged.length}
        </span>
      </CardHeader>
      <div className="space-y-2 p-4 text-[13px]">
        {flagged.length === 0 ? (
          <div className="font-mono text-[11px] text-muted-foreground">
            Everything in range.
          </div>
        ) : (
          flagged.map((m) => (
            <OutRow key={m.id} metric={m} />
          ))
        )}
      </div>
    </Card>
  );
}

function OutRow({ metric }: { metric: ReportMetric }) {
  const display = `${formatValueCell(metric)}${metric.units ? ` ${metric.units}` : ""}`;
  return (
    <div className="flex items-center justify-between gap-3">
      <Link
        href={`/metric/${encodeURIComponent(metric.canonicalName ?? metric.name)}`}
        className="truncate text-foreground hover:underline"
      >
        {metric.name}
      </Link>
      <span
        className={cn(
          "shrink-0 font-mono text-[12px]",
          metric.flag === "high" ? "text-flag-high" : "text-flag-low",
        )}
      >
        {display}
      </span>
    </div>
  );
}
