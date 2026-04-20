// Pure helpers for canonical-metric handling. Split out from
// `lib/canonical.ts` (which is server-only and hits the DB) so that
// seed / migration scripts can use them without dragging in the
// `server-only` guard.

// Raw metric names are matched case-insensitively with surrounding
// whitespace trimmed. Nothing else is normalized — punctuation and word
// ordering carry meaning (e.g. "Testosterone Free" vs "Free Testosterone"
// both appear in the alias list, both resolve to the same canonical).
export function normalizeRawName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().toLowerCase();
}

export function normalizeProvider(
  provider: string | null | undefined,
): string {
  return (provider ?? "").trim().toLowerCase();
}
