const PALETTE = [
  { key: "labcorp", hsl: "217 91% 60%" },
  { key: "quest", hsl: "0 72% 51%" },
  { key: "lifeforce", hsl: "262 83% 58%" },
  { key: "function", hsl: "173 80% 36%" },
  { key: "genova", hsl: "32 95% 44%" },
  { key: "vibrant", hsl: "292 76% 50%" },
  { key: "gimap", hsl: "340 82% 52%" },
  { key: "other", hsl: "240 4% 46%" },
] as const;

const DIRECT_MAP: Record<string, (typeof PALETTE)[number]["key"]> = {
  labcorp: "labcorp",
  "lab-corp": "labcorp",
  quest: "quest",
  "quest-diagnostics": "quest",
  lifeforce: "lifeforce",
  "function-health": "function",
  function: "function",
  genova: "genova",
  "genova-diagnostics": "genova",
  "vibrant-america": "vibrant",
  vibrant: "vibrant",
  "gi-map": "gimap",
  gimap: "gimap",
};

export function providerDisplayName(provider: string): string {
  const base = provider.trim();
  if (!base) return "Unknown";
  return base
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export interface ProviderColor {
  key: string;
  cssVar: string;
  hsl: string;
}

export function providerColor(
  provider: string,
  assignmentIndex = 0,
): ProviderColor {
  const norm = provider.trim().toLowerCase();
  const mapped = DIRECT_MAP[norm];
  if (mapped) {
    const hit = PALETTE.find((p) => p.key === mapped)!;
    return { key: hit.key, cssVar: `--lab-${hit.key}`, hsl: hit.hsl };
  }
  const fallback = PALETTE[assignmentIndex % (PALETTE.length - 1)];
  return {
    key: fallback.key,
    cssVar: `--lab-${fallback.key}`,
    hsl: fallback.hsl,
  };
}

export function assignProviderColors(
  providers: string[],
): Map<string, ProviderColor> {
  const out = new Map<string, ProviderColor>();
  let unknownIdx = 2;
  for (const p of providers) {
    const norm = p.trim().toLowerCase();
    if (DIRECT_MAP[norm]) {
      out.set(p, providerColor(p));
    } else {
      out.set(p, providerColor(p, unknownIdx));
      unknownIdx += 1;
    }
  }
  return out;
}
