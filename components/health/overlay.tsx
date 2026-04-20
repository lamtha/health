"use client";

import { ReferenceArea, ReferenceLine } from "recharts";

import { BAND_COLORS, MARKER_COLOR, bandColor } from "@/lib/overlay-colors";
import type { OverlayBand, OverlayMarker } from "@/lib/overlays";

// Recharts requires its reference primitives as direct children of
// <LineChart>. Call this inside the chart JSX and the returned array
// will render as those children.
export function overlayPrimitives({
  bands,
  markers,
  domainEnd,
}: {
  bands: OverlayBand[];
  markers: OverlayMarker[];
  // Right-edge timestamp used for "currently active" bands whose
  // toDate is NULL.
  domainEnd: number;
}): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  for (const b of bands) {
    const x1 = Date.parse(b.fromDate);
    if (!Number.isFinite(x1)) continue;
    const x2 = b.toDate ? Date.parse(b.toDate) : domainEnd;
    const color = bandColor(b.kind);
    out.push(
      <ReferenceArea
        key={`band:${b.interventionId}`}
        x1={x1}
        x2={x2}
        fill={color.fill}
        stroke={color.stroke}
        strokeOpacity={0.6}
        strokeWidth={0.5}
      />,
    );
  }
  for (const m of markers) {
    if (m.kind !== "singleton") continue;
    const x = Date.parse(m.date);
    if (!Number.isFinite(x)) continue;
    out.push(
      <ReferenceLine
        key={`marker:${m.eventId}`}
        x={x}
        stroke={MARKER_COLOR}
        strokeDasharray="3 3"
      />,
    );
  }
  return out;
}

export { BAND_COLORS };
