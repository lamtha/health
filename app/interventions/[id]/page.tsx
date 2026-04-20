import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, Stat } from "@/components/health/page-header";
import { TopBar } from "@/components/health/top-bar";
import {
  ChangeDose,
  DeleteIntervention,
  StopIntervention,
} from "@/components/health/intervention-actions";
import { BAND_COLORS } from "@/lib/overlay-colors";
import { getInterventionDetail } from "@/lib/interventions";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

const KIND_LABEL: Record<string, string> = {
  supplement: "Supplement",
  med: "Medication",
  diet: "Diet",
  protocol: "Protocol",
};

const EVENT_LABEL: Record<string, string> = {
  start: "Start",
  stop: "Stop",
  change: "Change",
  singleton: "Note",
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

function daysBetween(fromIso: string, toIso: string | null): number {
  const start = Date.parse(fromIso);
  if (!Number.isFinite(start)) return 0;
  const end = toIso ? Date.parse(toIso) : Date.now();
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / (24 * 60 * 60 * 1000)));
}

export default async function InterventionDetailPage({ params }: PageProps) {
  const { id: idRaw } = await params;
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const detail = getInterventionDetail(id);
  if (!detail) notFound();

  const { row, events } = detail;
  const active = row.stoppedOn == null;
  const color = BAND_COLORS[row.kind] ?? BAND_COLORS.other;
  const days = daysBetween(row.startedOn, row.stoppedOn);

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="interventions" />
      <PageHeader
        crumbs={["Interventions", row.name]}
        title={row.name}
        subtitle={
          active
            ? `Active · ${KIND_LABEL[row.kind] ?? row.kind}${row.dose ? ` · ${row.dose}` : ""}`
            : `Stopped ${formatDate(row.stoppedOn)} · ${KIND_LABEL[row.kind] ?? row.kind}`
        }
        stats={
          <>
            <Stat label="Started" value={formatDate(row.startedOn)} sub="" />
            <Stat
              label="Stopped"
              value={row.stoppedOn ? formatDate(row.stoppedOn) : "—"}
              sub={active ? "currently active" : undefined}
            />
            <Stat
              label="Duration"
              value={`${days}d`}
              sub={active ? "so far" : "total"}
            />
          </>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/interventions">Back</Link>
          </Button>
        }
      />

      <div className="space-y-6 px-8 pb-10">
        <Card className="py-0">
          <CardHeader className="border-b px-5 py-3">
            <CardTitle className="flex items-center gap-2 text-[13px]">
              <span
                className="inline-block h-3 w-6 rounded-sm"
                style={{
                  background: color.fill,
                  border: `1px solid ${color.stroke}`,
                }}
                aria-hidden
              />
              Band preview on charts
            </CardTitle>
          </CardHeader>
          <div className="grid grid-cols-2 gap-6 p-5 text-[13px]">
            <div>
              <div className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                Notes
              </div>
              <div className="mt-1 whitespace-pre-wrap text-foreground">
                {row.notes ?? <span className="text-muted-foreground">—</span>}
              </div>
            </div>
            <div className="flex flex-col items-end justify-start gap-3">
              {active && <ChangeDose id={row.id} currentDose={row.dose} />}
              {active ? (
                <StopIntervention id={row.id} />
              ) : (
                <span className="font-mono text-[11px] text-muted-foreground">
                  Stopped — no further actions.
                </span>
              )}
              <DeleteIntervention id={row.id} />
            </div>
          </div>
        </Card>

        <Card className="py-0">
          <CardHeader className="border-b px-5 py-3">
            <CardTitle className="text-[13px]">
              Timeline · {events.length} event{events.length === 1 ? "" : "s"}
            </CardTitle>
          </CardHeader>
          <ul className="divide-y divide-border">
            {events.length === 0 ? (
              <li className="px-5 py-4 text-[13px] text-muted-foreground">
                No events recorded.
              </li>
            ) : (
              events.map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-4 px-5 py-3 text-[13px]">
                  <div className="min-w-0">
                    <div className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                      {EVENT_LABEL[e.kind] ?? e.kind}
                    </div>
                    <div className="mt-0.5 text-foreground">
                      {e.description ?? <span className="text-muted-foreground">—</span>}
                    </div>
                  </div>
                  <div className="shrink-0 font-mono text-[11.5px] text-muted-foreground">
                    {formatDate(e.occurredOn)}
                  </div>
                </li>
              ))
            )}
          </ul>
        </Card>
      </div>
    </div>
  );
}
