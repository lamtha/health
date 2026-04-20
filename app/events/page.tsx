import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader, Stat } from "@/components/health/page-header";
import { TopBar } from "@/components/health/top-bar";
import {
  DeleteSingleton,
  SingletonForm,
} from "@/components/health/singleton-form";
import { listSingletons } from "@/lib/events";

export const dynamic = "force-dynamic";

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

export default function EventsPage() {
  const events = listSingletons();

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="interventions" />
      <PageHeader
        crumbs={["Interventions", "Events"]}
        title="One-off events"
        subtitle={
          events.length === 0
            ? "Log travel, illness, or other one-time events that might show up in your data."
            : "Each event renders as a dashed vertical line on every metric chart that spans its date."
        }
        stats={
          <Stat label="Events" value={events.length} sub="logged" />
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/interventions">Back to interventions</Link>
          </Button>
        }
      />

      <div className="space-y-6 px-8 pb-10">
        <SingletonForm />

        {events.length === 0 ? (
          <Card className="border-dashed">
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="font-serif-display text-[22px]">
                Nothing here yet
              </div>
              <p className="max-w-md text-[13px] text-muted-foreground">
                Use the form above to log an event.
              </p>
            </div>
          </Card>
        ) : (
          <Card className="py-0">
            <ul className="divide-y divide-border">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="flex items-baseline justify-between gap-4 px-5 py-3 text-[13px]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-foreground">
                      {e.description ?? <span className="text-muted-foreground">—</span>}
                    </div>
                    <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                      {formatDate(e.occurredOn)}
                    </div>
                  </div>
                  <DeleteSingleton id={e.id} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
