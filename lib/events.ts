import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { events } from "@/db/schema";

export interface EventRow {
  id: number;
  occurredOn: string;
  kind: string;
  description: string | null;
  interventionId: number | null;
  createdAt: string;
}

// Singletons only — start/stop/change events live under /interventions/[id].
export function listSingletons(): EventRow[] {
  return db
    .select()
    .from(events)
    .where(
      and(eq(events.kind, "singleton"), isNull(events.interventionId)),
    )
    .orderBy(desc(events.occurredOn), desc(events.id))
    .all();
}

export function getEvent(id: number): EventRow | null {
  const row = db.select().from(events).where(eq(events.id, id)).get();
  return row ?? null;
}

export function createSingleton(input: {
  occurredOn: string;
  description: string;
}): EventRow {
  const [row] = db
    .insert(events)
    .values({
      occurredOn: input.occurredOn,
      kind: "singleton",
      description: input.description.trim(),
      interventionId: null,
    })
    .returning()
    .all();
  return row;
}

export function updateSingleton(input: {
  id: number;
  occurredOn?: string;
  description?: string;
}): EventRow | null {
  const update: Record<string, string> = {};
  if (input.occurredOn) update.occurredOn = input.occurredOn;
  if (input.description != null) update.description = input.description.trim();
  if (Object.keys(update).length === 0) return getEvent(input.id);
  db.update(events).set(update).where(eq(events.id, input.id)).run();
  return getEvent(input.id);
}

export function deleteEvent(id: number): void {
  db.delete(events).where(eq(events.id, id)).run();
}
