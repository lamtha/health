// Canonical unit map. Keys are lowercased raw units; values are the
// canonical form used only for grouping/comparison. Raw units stay on each
// row for display. Extend this map as new aliases are observed (callers
// should log a warning when an unmapped collision is detected).
//
// GI-MAP reports the same qPCR quantity as either "copies/g" or "org/g"
// across different sections/revisions — on a qPCR assay each organism
// contributes ~1 DNA copy of the target, so the labels are interchangeable.
const UNIT_ALIASES: Record<string, string> = {
  "org/g": "copies/g",
  "organisms/g": "copies/g",
};

export function canonicalUnit(u: string | null | undefined): string | null {
  if (!u) return null;
  const key = u.trim().toLowerCase();
  if (key === "") return null;
  return UNIT_ALIASES[key] ?? key;
}
