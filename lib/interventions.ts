import "server-only";

import { asc, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { events, interventions } from "@/db/schema";

export {
  INTERVENTION_KINDS,
  type InterventionKind,
} from "@/lib/interventions-kinds";
import type { InterventionKind } from "@/lib/interventions-kinds";

export interface InterventionRow {
  id: number;
  name: string;
  kind: string;
  dose: string | null;
  notes: string | null;
  startedOn: string;
  stoppedOn: string | null;
  createdAt: string;
}

export interface InterventionEvent {
  id: number;
  occurredOn: string;
  kind: string;
  description: string | null;
  createdAt: string;
}

export interface InterventionDetail {
  row: InterventionRow;
  events: InterventionEvent[];
}

export function listInterventions(): {
  active: InterventionRow[];
  past: InterventionRow[];
} {
  const active = db
    .select()
    .from(interventions)
    .where(isNull(interventions.stoppedOn))
    .orderBy(desc(interventions.startedOn))
    .all();
  const past = db
    .select()
    .from(interventions)
    .where(sql`${interventions.stoppedOn} IS NOT NULL`)
    .orderBy(desc(interventions.stoppedOn))
    .all();
  return { active, past };
}

export function getInterventionDetail(id: number): InterventionDetail | null {
  const row = db
    .select()
    .from(interventions)
    .where(eq(interventions.id, id))
    .get();
  if (!row) return null;
  const evs = db
    .select()
    .from(events)
    .where(eq(events.interventionId, id))
    .orderBy(asc(events.occurredOn), asc(events.id))
    .all();
  return { row, events: evs };
}

export function createIntervention(input: {
  name: string;
  kind: InterventionKind;
  dose?: string | null;
  notes?: string | null;
  startedOn: string;
}): InterventionRow {
  return db.transaction((tx) => {
    const [row] = tx
      .insert(interventions)
      .values({
        name: input.name.trim(),
        kind: input.kind,
        dose: input.dose?.trim() || null,
        notes: input.notes?.trim() || null,
        startedOn: input.startedOn,
        stoppedOn: null,
      })
      .returning()
      .all();
    tx
      .insert(events)
      .values({
        occurredOn: input.startedOn,
        kind: "start",
        description: formatStartDescription(row),
        interventionId: row.id,
      })
      .run();
    return row;
  });
}

export function stopIntervention(input: {
  id: number;
  stoppedOn: string;
  note?: string | null;
}): InterventionRow {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(interventions)
      .where(eq(interventions.id, input.id))
      .get();
    if (!existing) throw new Error(`intervention ${input.id} not found`);

    tx
      .update(interventions)
      .set({ stoppedOn: input.stoppedOn })
      .where(eq(interventions.id, input.id))
      .run();

    tx
      .insert(events)
      .values({
        occurredOn: input.stoppedOn,
        kind: "stop",
        description:
          input.note?.trim() ||
          `Stopped ${existing.name}${existing.dose ? ` (${existing.dose})` : ""}`,
        interventionId: input.id,
      })
      .run();

    const [row] = tx
      .select()
      .from(interventions)
      .where(eq(interventions.id, input.id))
      .all();
    return row;
  });
}

export function changeIntervention(input: {
  id: number;
  name?: string;
  dose?: string | null;
  notes?: string | null;
  occurredOn: string;
  changeNote?: string | null;
}): { row: InterventionRow; eventId: number | null } {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(interventions)
      .where(eq(interventions.id, input.id))
      .get();
    if (!existing) throw new Error(`intervention ${input.id} not found`);

    const update: Partial<InterventionRow> = {};
    if (input.name != null) update.name = input.name.trim();
    if (input.dose !== undefined) update.dose = input.dose?.trim() || null;
    if (input.notes !== undefined) update.notes = input.notes?.trim() || null;

    if (Object.keys(update).length > 0) {
      tx
        .update(interventions)
        .set(update)
        .where(eq(interventions.id, input.id))
        .run();
    }

    let eventId: number | null = null;
    const doseChanged =
      input.dose !== undefined && (input.dose ?? null) !== (existing.dose ?? null);
    const nameChanged = input.name != null && input.name.trim() !== existing.name;
    if (doseChanged || nameChanged || input.changeNote) {
      const pieces: string[] = [];
      if (doseChanged) {
        pieces.push(
          `dose ${existing.dose ?? "—"} → ${input.dose?.trim() || "—"}`,
        );
      }
      if (nameChanged) {
        pieces.push(`renamed to ${input.name!.trim()}`);
      }
      if (input.changeNote?.trim()) pieces.push(input.changeNote.trim());
      const desc = pieces.join("; ");
      const [ev] = tx
        .insert(events)
        .values({
          occurredOn: input.occurredOn,
          kind: "change",
          description: desc || "Updated",
          interventionId: input.id,
        })
        .returning({ id: events.id })
        .all();
      eventId = ev.id;
    }

    const [row] = tx
      .select()
      .from(interventions)
      .where(eq(interventions.id, input.id))
      .all();
    return { row, eventId };
  });
}

export function deleteIntervention(id: number): void {
  db.delete(interventions).where(eq(interventions.id, id)).run();
}

function formatStartDescription(row: InterventionRow): string {
  const parts: string[] = [`Started ${row.name}`];
  if (row.dose) parts.push(row.dose);
  return parts.join(" · ");
}
