import Link from "next/link";

import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InterventionForm } from "@/components/health/intervention-form";
import { PageHeader, Stat } from "@/components/health/page-header";
import { TopBar } from "@/components/health/top-bar";
import {
  type InterventionRow,
  listInterventions,
} from "@/lib/interventions";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  supplement: "Supplement",
  med: "Medication",
  diet: "Diet",
  protocol: "Protocol",
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

export default function InterventionsPage() {
  const { active, past } = listInterventions();
  const all = [...active, ...past];

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="interventions" />
      <PageHeader
        title="Interventions"
        subtitle={
          all.length === 0
            ? "Nothing logged yet. Start an intervention to see it as a band on your charts."
            : "Things you're on (or were on). Start/stop events overlay on every metric chart."
        }
        stats={
          <>
            <Stat label="Active" value={active.length} sub="in progress" />
            <Stat label="Past" value={past.length} sub="stopped" />
          </>
        }
      />

      <div className="px-8 pb-10">
        <div className="mb-6">
          <InterventionForm />
        </div>

        <section className="mb-8">
          <SectionHeader title="Active" count={active.length} tone="active" />
          {active.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No active interventions.
            </p>
          ) : (
            <InterventionTable rows={active} now />
          )}
        </section>

        <section>
          <SectionHeader title="Past" count={past.length} tone="past" />
          {past.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No stopped interventions yet.
            </p>
          ) : (
            <InterventionTable rows={past} />
          )}
        </section>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  count,
  tone,
}: {
  title: string;
  count: number;
  tone: "active" | "past";
}) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <h2 className="text-[16px] font-semibold">{title}</h2>
      <span className="font-mono text-[12px] text-muted-foreground">
        {count}
      </span>
      {tone === "active" && count > 0 && (
        <span className="ml-2 rounded-full bg-foreground/5 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
          on now
        </span>
      )}
    </div>
  );
}

function InterventionTable({
  rows,
  now,
}: {
  rows: InterventionRow[];
  now?: boolean;
}) {
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Name</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Dose</TableHead>
            <TableHead className="text-right">Started</TableHead>
            <TableHead className="text-right">{now ? "Stopped" : "Stopped"}</TableHead>
            <TableHead className="pr-5 text-right">Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const days = daysBetween(r.startedOn, r.stoppedOn);
            return (
              <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40">
                <TableCell className="pl-5">
                  <Link
                    href={`/interventions/${r.id}`}
                    className="block text-[13px] font-medium"
                  >
                    {r.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/interventions/${r.id}`}
                    className="block text-[12.5px] text-muted-foreground"
                  >
                    {KIND_LABEL[r.kind] ?? r.kind}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/interventions/${r.id}`}
                    className="block font-mono text-[12px] text-muted-foreground"
                  >
                    {r.dose ?? "—"}
                  </Link>
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/interventions/${r.id}`}
                    className="block font-mono text-[12px] text-muted-foreground"
                  >
                    {formatDate(r.startedOn)}
                  </Link>
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/interventions/${r.id}`}
                    className="block font-mono text-[12px] text-muted-foreground"
                  >
                    {r.stoppedOn ? formatDate(r.stoppedOn) : "— active —"}
                  </Link>
                </TableCell>
                <TableCell className="pr-5 text-right">
                  <Link
                    href={`/interventions/${r.id}`}
                    className="block font-mono text-[12px] text-muted-foreground"
                  >
                    {days}d
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
