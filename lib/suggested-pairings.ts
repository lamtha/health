import "server-only";

import { inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { canonicalMetrics as canonicalMetricsTable } from "@/db/schema";

export interface SuggestedPairing {
  title: string;
  // Human-readable hint for the row ("3 lipids", "immune balance", etc.)
  hint: string;
  canonicalIds: number[];
  canonicalNames: string[];
}

// Curated starting pairings. Each entry references canonical names from
// db/seeds/canonical-metrics.ts — at render time we resolve names → ids
// and drop any that don't exist in this DB (e.g., before a seed update).
const PAIRINGS: Array<{ title: string; hint: string; names: string[] }> = [
  {
    title: "Immune panel",
    hint: "Immune cell balance",
    names: ["White Blood Cells", "Neutrophils (Absolute)", "Lymphocytes (Absolute)"],
  },
  {
    title: "Inflammation",
    hint: "Systemic load",
    names: ["hsCRP", "Homocysteine", "Ferritin"],
  },
  {
    title: "Cardio risk",
    hint: "Atherogenic burden",
    names: ["Apolipoprotein B", "Lipoprotein (a)", "LDL Cholesterol", "hsCRP"],
  },
  {
    title: "Insulin / glucose",
    hint: "Metabolic control",
    names: ["HbA1c", "Fasting Insulin", "Glucose (Fasting)"],
  },
  {
    title: "Gut barrier",
    hint: "Intestinal permeability",
    names: ["Akkermansia muciniphila", "Zonulin", "Calprotectin"],
  },
  {
    title: "SIBO breath",
    hint: "Gas-producing overgrowth",
    names: ["Breath Hydrogen (Peak)", "Breath Methane (Peak)", "Methanobrevibacter smithii"],
  },
];

export function getSuggestedPairings(): SuggestedPairing[] {
  const allNames = Array.from(new Set(PAIRINGS.flatMap((p) => p.names)));
  if (allNames.length === 0) return [];
  const rows = db
    .select({
      id: canonicalMetricsTable.id,
      canonicalName: canonicalMetricsTable.canonicalName,
    })
    .from(canonicalMetricsTable)
    .where(inArray(canonicalMetricsTable.canonicalName, allNames))
    .all();

  const idByName = new Map<string, number>();
  for (const r of rows) idByName.set(r.canonicalName, r.id);

  const out: SuggestedPairing[] = [];
  for (const p of PAIRINGS) {
    const ids: number[] = [];
    const names: string[] = [];
    for (const n of p.names) {
      const id = idByName.get(n);
      if (id != null) {
        ids.push(id);
        names.push(n);
      }
    }
    if (ids.length >= 2) {
      out.push({
        title: p.title,
        hint: p.hint,
        canonicalIds: ids,
        canonicalNames: names,
      });
    }
  }
  return out;
}
