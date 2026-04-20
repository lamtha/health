import "server-only";

import { and, eq, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { events, interventions } from "@/db/schema";

export interface OverlayBand {
  interventionId: number;
  name: string;
  kind: string;
  dose: string | null;
  // ISO date strings. `toDate` null means currently active — chart can treat
  // as today / chart's right edge.
  fromDate: string;
  toDate: string | null;
}

export interface OverlayMarker {
  eventId: number;
  kind: string; // singleton | change | start | stop
  date: string;
  description: string | null;
  interventionId: number | null;
  interventionName: string | null;
}

export interface OverlaySet {
  bands: OverlayBand[];
  markers: OverlayMarker[];
}

// Fetch bands (interventions) + markers (events) overlapping the given
// date window. `fromIso` and `toIso` are inclusive and use YYYY-MM-DD
// string comparison, which works on ISO dates.
//
// Band overlap: intervention.started_on ≤ toIso AND
//               (intervention.stopped_on IS NULL OR stopped_on ≥ fromIso)
//
// Markers always render — singleton events in the window + every event
// attached to an intervention that overlaps.
export function getOverlaysInWindow(
  fromIso: string,
  toIso: string,
): OverlaySet {
  const bandRows = db
    .select()
    .from(interventions)
    .where(
      and(
        lte(interventions.startedOn, toIso),
        or(
          isNull(interventions.stoppedOn),
          sql`${interventions.stoppedOn} >= ${fromIso}`,
        ),
      ),
    )
    .all();

  const bands: OverlayBand[] = bandRows.map((b) => ({
    interventionId: b.id,
    name: b.name,
    kind: b.kind,
    dose: b.dose,
    fromDate: b.startedOn,
    toDate: b.stoppedOn,
  }));

  const bandIds = new Set(bands.map((b) => b.interventionId));

  // Markers: all events in window (singletons + any event bound to an
  // intervention we're showing).
  const eventRows = db
    .select({
      id: events.id,
      kind: events.kind,
      date: events.occurredOn,
      description: events.description,
      interventionId: events.interventionId,
      interventionName: interventions.name,
    })
    .from(events)
    .leftJoin(interventions, eq(events.interventionId, interventions.id))
    .where(
      and(
        sql`${events.occurredOn} >= ${fromIso}`,
        sql`${events.occurredOn} <= ${toIso}`,
      ),
    )
    .all();

  const markers: OverlayMarker[] = eventRows
    .filter((e) => {
      if (e.interventionId == null) return true;
      return bandIds.has(e.interventionId);
    })
    .map((e) => ({
      eventId: e.id,
      kind: e.kind,
      date: e.date,
      description: e.description,
      interventionId: e.interventionId,
      interventionName: e.interventionName,
    }));

  return { bands, markers };
}

// Entire history — used by /interventions list to show "latest band"
// across the whole DB. No window clipping.
export function getAllOverlays(): OverlaySet {
  const bandRows = db.select().from(interventions).all();
  const bands: OverlayBand[] = bandRows.map((b) => ({
    interventionId: b.id,
    name: b.name,
    kind: b.kind,
    dose: b.dose,
    fromDate: b.startedOn,
    toDate: b.stoppedOn,
  }));
  const eventRows = db
    .select({
      id: events.id,
      kind: events.kind,
      date: events.occurredOn,
      description: events.description,
      interventionId: events.interventionId,
      interventionName: interventions.name,
    })
    .from(events)
    .leftJoin(interventions, eq(events.interventionId, interventions.id))
    .all();
  const markers: OverlayMarker[] = eventRows.map((e) => ({
    eventId: e.id,
    kind: e.kind,
    date: e.date,
    description: e.description,
    interventionId: e.interventionId,
    interventionName: e.interventionName,
  }));
  return { bands, markers };
}
