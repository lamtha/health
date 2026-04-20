// Band fill + stroke palette for intervention overlays. Kept in a plain
// (non-client) module so both server components and the client-side
// chart overlay can import it.

export const BAND_COLORS: Record<string, { fill: string; stroke: string }> = {
  supplement: {
    fill: "hsla(150 50% 45% / 0.09)",
    stroke: "hsla(150 50% 30% / 0.5)",
  },
  med: {
    fill: "hsla(217 91% 60% / 0.09)",
    stroke: "hsla(217 91% 45% / 0.5)",
  },
  diet: {
    fill: "hsla(36 80% 55% / 0.1)",
    stroke: "hsla(36 80% 40% / 0.55)",
  },
  protocol: {
    fill: "hsla(270 50% 60% / 0.1)",
    stroke: "hsla(270 50% 45% / 0.55)",
  },
  other: {
    fill: "hsla(0 0% 50% / 0.07)",
    stroke: "hsla(0 0% 40% / 0.4)",
  },
};

export const MARKER_COLOR = "hsla(0 0% 25% / 0.6)";

export function bandColor(kind: string) {
  return BAND_COLORS[kind] ?? BAND_COLORS.other;
}
