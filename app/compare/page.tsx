import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompareView } from "@/components/health/compare-view";
import { PageHeader, Stat } from "@/components/health/page-header";
import { TopBar } from "@/components/health/top-bar";
import { getCompareCandidates, getCompareSeries } from "@/lib/compare";
import { getAllOverlays } from "@/lib/overlays";
import { getSuggestedPairings } from "@/lib/suggested-pairings";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    m?: string;
  }>;
}

const MAX_METRICS = 4;

function parseIds(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, MAX_METRICS);
}

export default async function ComparePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const ids = parseIds(params.m);
  const { series, domainStart, domainEnd } = getCompareSeries(ids);
  const candidates = getCompareCandidates();
  const pairings = getSuggestedPairings();
  const overlays = getAllOverlays();

  const domainYears =
    domainStart != null && domainEnd != null
      ? Math.max(
          1,
          new Date(domainEnd).getFullYear() - new Date(domainStart).getFullYear() + 1,
        )
      : 0;

  const subtitle =
    series.length === 0
      ? "Stack up to 4 canonical metrics on a shared time axis."
      : `${series.length}/${MAX_METRICS} metrics · ${domainYears}y span.`;

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="compare" />
      <PageHeader
        crumbs={["Dashboard", "Compare"]}
        title="Compare metrics over time"
        subtitle={subtitle}
        stats={
          series.length > 0
            ? (
              <>
                <Stat label="Metrics" value={series.length} sub={`of ${MAX_METRICS}`} />
                <Stat
                  label="Observations"
                  value={series.reduce((a, s) => a + s.points.length, 0)}
                  sub="across series"
                />
                <Stat
                  label="Providers"
                  value={new Set(series.flatMap((s) => s.providers)).size}
                  sub="represented"
                />
              </>
            )
            : null
        }
      />

      <div className="px-8 pb-10">
        <CompareView
          series={series}
          domainStart={domainStart}
          domainEnd={domainEnd}
          candidates={candidates}
          bands={overlays.bands}
          markers={overlays.markers}
        />

        <div className="mt-8 grid grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-[13px]">Suggested pairings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0 p-0">
              {pairings.length === 0 ? (
                <div className="px-5 py-4 text-[13px] text-muted-foreground">
                  Suggested pairings appear after the canonical taxonomy is seeded.
                </div>
              ) : (
                pairings.map((p) => (
                  <div
                    key={p.title}
                    className="flex items-center justify-between border-b border-border px-5 py-3 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                        {p.title}
                      </div>
                      <div className="mt-0.5 truncate text-[13px]">
                        {p.canonicalNames.join(" · ")}
                      </div>
                      <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                        {p.hint}
                      </div>
                    </div>
                    <Button asChild variant="ghost" size="sm" className="shrink-0 text-muted-foreground">
                      <Link href={`/compare?m=${p.canonicalIds.slice(0, MAX_METRICS).join(",")}`}>
                        Load →
                      </Link>
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-[13px]">Overlays</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-5 text-[13px]">
              <OverlayRow
                label="Reference-range bands"
                hint="shown on every chart"
                enabled
              />
              <OverlayRow
                label="Intervention markers"
                hint={
                  overlays.bands.length > 0 || overlays.markers.length > 0
                    ? `showing ${overlays.bands.length} band${overlays.bands.length === 1 ? "" : "s"} · ${overlays.markers.length} marker${overlays.markers.length === 1 ? "" : "s"}`
                    : "none logged — add at /interventions"
                }
                enabled={overlays.bands.length > 0 || overlays.markers.length > 0}
              />
              <OverlayRow
                label="Pinned date cursor"
                hint="drag to scrub across charts"
                pending
              />
              <Link
                href="/export"
                className="-mx-5 block px-5 py-1.5 transition-colors hover:bg-muted/40"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-foreground">Clinician PDF + CSV</div>
                    <div className="font-mono text-[10.5px] text-muted-foreground">
                      per-metric pages, trend charts, raw values
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    /export →
                  </span>
                </div>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function OverlayRow({
  label,
  hint,
  enabled,
  pending,
}: {
  label: string;
  hint: string;
  enabled?: boolean;
  pending?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div>
        <div className={pending ? "text-muted-foreground" : "text-foreground"}>
          {label}
        </div>
        <div className="font-mono text-[10.5px] text-muted-foreground">{hint}</div>
      </div>
      <div
        className={
          "relative h-5 w-9 rounded-full transition-colors " +
          (enabled
            ? "bg-foreground"
            : pending
              ? "bg-muted"
              : "bg-muted")
        }
      >
        <div
          className={
            "absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-all " +
            (enabled ? "left-[18px]" : "left-0.5")
          }
        />
      </div>
    </div>
  );
}
