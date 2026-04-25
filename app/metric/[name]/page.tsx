import { notFound } from "next/navigation";

import { Flag } from "@/components/health/flag";
import { pointKey } from "@/components/health/metric-chart-types";
import { MetricDetailShell } from "@/components/health/metric-detail-shell";
import { PageHeader, Stat } from "@/components/health/page-header";
import { TopBar } from "@/components/health/top-bar";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  getMetricSeries,
  type MetricConflict,
  type MetricPoint,
} from "@/lib/metric-series";
import { getAllOverlays } from "@/lib/overlays";
import { providerDisplayName } from "@/lib/providers";
import { CATEGORY_LABELS } from "@/db/seeds/taxonomy";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ name: string }>;
}

function formatValue(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 100 && Number.isInteger(v)) return v.toString();
  return Number(v.toFixed(3)).toString();
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

export default async function MetricPage({ params }: PageProps) {
  const { name: encoded } = await params;
  const metricName = decodeURIComponent(encoded);
  const data = getMetricSeries(metricName);
  if (!data) notFound();
  const overlays = getAllOverlays();

  const displayName = data.name;

  const categoryLabel = data.category
    ? (CATEGORY_LABELS[data.category as keyof typeof CATEGORY_LABELS] ??
        (data.category.charAt(0).toUpperCase() + data.category.slice(1)))
    : null;

  const latestDisplay = data.latest
    ? `${formatValue(data.latest.value)}${data.units ? ` ${data.units}` : ""}`
    : "—";
  const meanDisplay =
    data.mean != null
      ? `${formatValue(data.mean)}${data.units ? ` ${data.units}` : ""}`
      : "—";
  const rangeDisplay =
    data.refLow != null && data.refHigh != null
      ? `${formatValue(data.refLow)} – ${formatValue(data.refHigh)}`
      : data.refLow != null
        ? `≥ ${formatValue(data.refLow)}`
        : data.refHigh != null
          ? `≤ ${formatValue(data.refHigh)}`
          : "—";
  const rangeSub =
    data.refLow != null || data.refHigh != null
      ? data.refLowVaries || data.refHighVaries
        ? "varies by provider"
        : data.units
          ? `${data.units}`
          : undefined
      : undefined;

  // Tag excluded points by the shared pointKey so the table can visually
  // mark them "not charted" and the shell can suppress hover->highlight for
  // rows the chart can't reach.
  const excludedKeys = new Set(data.excludedForUnits.map(pointKey));

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="dashboard" />
      <PageHeader
        crumbs={["Dashboard", categoryLabel ?? "Metric"]}
        title={displayName}
        subtitle={
          data.units
            ? `${data.providers.length} provider${
                data.providers.length === 1 ? "" : "s"
              } · ${data.units}`
            : `${data.providers.length} provider${
                data.providers.length === 1 ? "" : "s"
              }`
        }
        stats={
          <>
            <Stat
              label="Latest"
              value={latestDisplay}
              sub={formatDate(data.latest?.date ?? null)}
              accent={
                data.latest?.flag === "high"
                  ? "text-flag-high"
                  : data.latest?.flag === "low"
                    ? "text-flag-low"
                    : "text-foreground"
              }
            />
            <Stat
              label="Mean"
              value={meanDisplay}
              sub={`n = ${data.points.length}`}
            />
            <Stat label="Range" value={rangeDisplay} sub={rangeSub} />
          </>
        }
      />

      <div className="space-y-6 px-8 pb-10">
        {data.convertedFromUnits.length > 0 && data.units && (
          <UnitsConversionNote
            from={data.convertedFromUnits}
            to={data.units}
          />
        )}

        {data.excludedForUnits.length > 0 && (
          <UnitsExclusionWarning
            unitsAll={data.unitsAll}
            kept={data.units}
            excluded={data.excludedForUnits}
          />
        )}

        {data.conflicts.length > 0 && (
          <ConflictsWarning conflicts={data.conflicts} units={data.units} />
        )}

        <MetricDetailShell
          metricName={data.name}
          units={data.units}
          chartPoints={data.points}
          providers={data.providers}
          refLow={data.refLow}
          refHigh={data.refHigh}
          refLowVaries={data.refLowVaries}
          refHighVaries={data.refHighVaries}
          bands={overlays.bands}
          markers={overlays.markers}
          tablePoints={data.pointsAll}
          excludedKeys={excludedKeys}
        />
      </div>
    </div>
  );
}

function ConflictsWarning({
  conflicts,
  units,
}: {
  conflicts: MetricConflict[];
  units: string | null;
}) {
  const unitLabel = units ? ` ${units}` : "";
  return (
    <Card
      className={cn(
        "border-flag-high/30 bg-flag-high-bg py-0 text-[13px]",
        "flex flex-col",
      )}
    >
      <div className="flex items-start gap-3 px-5 py-3">
        <Flag flag="high" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-foreground">
            {conflicts.length} conflicting value
            {conflicts.length === 1 ? "" : "s"} — showing latest report
          </div>
          <div className="mt-1 text-muted-foreground">
            Multiple reports disagree for the same date. Keeping the value
            from the most recently uploaded report in each case.
          </div>
          <ul className="mt-2 space-y-0.5 font-mono text-[11.5px] text-muted-foreground">
            {conflicts.map((c) => (
              <li key={`${c.date}-${c.kept.reportId}`}>
                {c.date} · kept{" "}
                <span className="text-foreground">
                  {formatValue(c.kept.value)}
                  {unitLabel}
                </span>{" "}
                ({providerDisplayName(c.kept.provider)} · report{" "}
                {c.kept.reportId}) · discarded{" "}
                {c.discarded
                  .map(
                    (d) =>
                      `${formatValue(d.value)}${unitLabel} (report ${d.reportId})`,
                  )
                  .join(", ")}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

function UnitsConversionNote({
  from,
  to,
}: {
  from: string[];
  to: string;
}) {
  return (
    <Card className="border-border bg-muted/40 py-0 text-[13px]">
      <div className="flex items-start gap-3 px-5 py-3">
        <div className="min-w-0 flex-1 text-muted-foreground">
          Units normalized for charting: values in{" "}
          <span className="font-mono text-foreground">
            {from.join(", ")}
          </span>{" "}
          rescaled to{" "}
          <span className="font-mono text-foreground">{to}</span>. Original
          values and units preserved in the table below.
        </div>
      </div>
    </Card>
  );
}

function UnitsExclusionWarning({
  unitsAll,
  kept,
  excluded,
}: {
  unitsAll: string[];
  kept: string | null;
  excluded: MetricPoint[];
}) {
  return (
    <Card
      className={cn(
        "border-flag-high/30 bg-flag-high-bg py-0 text-[13px]",
        "flex flex-col",
      )}
    >
      <div className="flex items-start gap-3 px-5 py-3">
        <Flag flag="high" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-foreground">
            {excluded.length} row{excluded.length === 1 ? "" : "s"} excluded
            from chart — no known conversion
          </div>
          <div className="mt-1 text-muted-foreground">
            Observed units:{" "}
            <span className="font-mono text-foreground">
              {unitsAll.join(", ")}
            </span>
            . Charting{" "}
            <span className="font-mono text-foreground">{kept ?? "—"}</span>;
            the following rows need a conversion in{" "}
            <span className="font-mono">lib/units.ts</span> before they can
            plot alongside.
          </div>
          <ul className="mt-2 space-y-0.5 font-mono text-[11.5px] text-muted-foreground">
            {excluded.map((p) => (
              <li key={`${p.reportId}-${p.provider}-${p.date}`}>
                {p.date} · {providerDisplayName(p.provider)} ·{" "}
                {formatValue(p.originalValue)} {p.units ?? "—"}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
