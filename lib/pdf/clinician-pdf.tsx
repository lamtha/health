import "server-only";

import React from "react";
import {
  Document,
  Page,
  StyleSheet,
  Svg,
  Text,
  View,
  Line as PdfLine,
  Path,
  Rect,
} from "@react-pdf/renderer";

import type {
  ExportDataset,
  ExportIntervention,
  ExportObservation,
  ExportSeries,
} from "@/lib/export";

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 40,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#111",
  },
  cover: {
    paddingTop: 120,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    color: "#111",
  },
  coverTitle: {
    fontSize: 28,
    fontFamily: "Times-Roman",
    marginBottom: 12,
  },
  coverSub: {
    fontSize: 11,
    color: "#555",
    marginBottom: 24,
  },
  coverBox: {
    borderTopWidth: 0.5,
    borderTopColor: "#888",
    paddingTop: 10,
    marginTop: 10,
    fontSize: 10,
    color: "#333",
  },
  h1: {
    fontSize: 18,
    fontFamily: "Times-Roman",
    marginBottom: 4,
  },
  h2: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginTop: 16,
    marginBottom: 6,
  },
  meta: {
    fontSize: 9,
    color: "#666",
    marginBottom: 12,
  },
  row: { flexDirection: "row" },
  stat: {
    flex: 1,
    borderRightWidth: 0.5,
    borderRightColor: "#ccc",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statLast: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statLabel: {
    fontSize: 8,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  statValue: { fontSize: 14 },
  chartBox: {
    marginTop: 10,
    marginBottom: 10,
    borderWidth: 0.5,
    borderColor: "#ddd",
    padding: 4,
  },
  table: {
    marginTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: "#ccc",
  },
  th: {
    fontSize: 8,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#ccc",
    flexDirection: "row",
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.25,
    borderBottomColor: "#eee",
    paddingVertical: 3,
    fontSize: 9,
  },
  cellDate: { width: 68 },
  cellProvider: { width: 90 },
  cellValue: { width: 70, textAlign: "right", paddingRight: 6 },
  cellUnit: { width: 52 },
  cellRange: { width: 70 },
  cellFlag: { width: 34, textAlign: "right" },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#999",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  interventionRow: {
    flexDirection: "row",
    borderBottomWidth: 0.25,
    borderBottomColor: "#eee",
    paddingVertical: 4,
    fontSize: 9,
  },
  flagHigh: { color: "#c0392b" },
  flagLow: { color: "#2e6fb8" },
});

const CHART_W = 515;
const CHART_H = 140;
const CHART_PAD = { top: 8, right: 8, bottom: 14, left: 36 };

function formatValue(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 100 && Number.isInteger(v)) return v.toString();
  return Number(v.toFixed(3)).toString();
}

// The built-in Helvetica in @react-pdf/renderer is WinAnsi-encoded, which
// includes the micro sign (µ, U+00B5) but not the Greek letter mu (μ, U+03BC).
// Extracted lab units arrive as both; normalize so units render cleanly.
function sanitizeUnit(u: string | null | undefined): string {
  if (!u) return "";
  return u.replace(/\u03BC/g, "\u00B5");
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function SeriesChart({ series }: { series: ExportSeries }) {
  const obs = series.observations.filter((o) => o.value != null);
  if (obs.length === 0) {
    return (
      <View style={styles.chartBox}>
        <Text style={{ fontSize: 9, color: "#888", padding: 10 }}>
          No numeric observations in window.
        </Text>
      </View>
    );
  }

  const xs = obs.map((o) => Date.parse(o.date)).filter((n) => Number.isFinite(n));
  const ys = obs
    .map((o) => o.value)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const refs: number[] = [];
  if (series.refLow != null) refs.push(series.refLow);
  if (series.refHigh != null) refs.push(series.refHigh);
  const allY = [...ys, ...refs];

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xSpan = xMax === xMin ? 1 : xMax - xMin;
  const yMin = Math.min(...allY);
  const yMax = Math.max(...allY);
  const ySpan = yMax === yMin ? Math.max(Math.abs(yMax) * 0.1, 1) : yMax - yMin;
  const yPad = ySpan * 0.1;
  // Lab quantities are almost always non-negative; don't let axis padding
  // push the lower bound below zero and produce meaningless negative ticks.
  const yLo = yMin >= 0 ? Math.max(0, yMin - yPad) : yMin - yPad;
  const yHi = yMax + yPad;

  const plotW = CHART_W - CHART_PAD.left - CHART_PAD.right;
  const plotH = CHART_H - CHART_PAD.top - CHART_PAD.bottom;

  const xFor = (t: number) =>
    CHART_PAD.left + ((t - xMin) / xSpan) * plotW;
  const yFor = (v: number) =>
    CHART_PAD.top + (1 - (v - yLo) / (yHi - yLo)) * plotH;

  const pts = obs
    .filter((o) => o.value != null && Number.isFinite(Date.parse(o.date)))
    .map((o) => ({
      x: xFor(Date.parse(o.date)),
      y: yFor(o.value!),
      flag: o.flag,
    }));

  const pathD = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");

  const refBand =
    series.refLow != null && series.refHigh != null
      ? {
          y: yFor(series.refHigh),
          h: yFor(series.refLow) - yFor(series.refHigh),
        }
      : null;

  return (
    <View style={styles.chartBox}>
      <Svg width={CHART_W} height={CHART_H}>
        {refBand && (
          <Rect
            x={CHART_PAD.left}
            y={refBand.y}
            width={plotW}
            height={refBand.h}
            fill="#1fa06b"
            opacity={0.07}
          />
        )}
        {series.refLow != null && (
          <PdfLine
            x1={CHART_PAD.left}
            x2={CHART_PAD.left + plotW}
            y1={yFor(series.refLow)}
            y2={yFor(series.refLow)}
            stroke="#1fa06b"
            strokeOpacity={0.5}
            strokeDasharray="3 3"
          />
        )}
        {series.refHigh != null && (
          <PdfLine
            x1={CHART_PAD.left}
            x2={CHART_PAD.left + plotW}
            y1={yFor(series.refHigh)}
            y2={yFor(series.refHigh)}
            stroke="#1fa06b"
            strokeOpacity={0.5}
            strokeDasharray="3 3"
          />
        )}
        <PdfLine
          x1={CHART_PAD.left}
          x2={CHART_PAD.left + plotW}
          y1={CHART_PAD.top + plotH}
          y2={CHART_PAD.top + plotH}
          stroke="#ccc"
        />
        <PdfLine
          x1={CHART_PAD.left}
          x2={CHART_PAD.left}
          y1={CHART_PAD.top}
          y2={CHART_PAD.top + plotH}
          stroke="#ccc"
        />
        <Path d={pathD} stroke="#111" strokeWidth={1} fill="none" />
        {pts.map((p, i) => (
          <Rect
            key={i}
            x={p.x - 1.5}
            y={p.y - 1.5}
            width={3}
            height={3}
            fill={
              p.flag === "high"
                ? "#c0392b"
                : p.flag === "low"
                  ? "#2e6fb8"
                  : "#111"
            }
          />
        ))}
        <Text
          x={CHART_PAD.left}
          y={CHART_H - 2}
          style={{ fontSize: 7, fill: "#888" }}
        >
          {formatDate(new Date(xMin).toISOString().slice(0, 10))}
        </Text>
        <Text
          x={CHART_PAD.left + plotW - 40}
          y={CHART_H - 2}
          style={{ fontSize: 7, fill: "#888" }}
        >
          {formatDate(new Date(xMax).toISOString().slice(0, 10))}
        </Text>
        <Text
          x={2}
          y={CHART_PAD.top + 4}
          style={{ fontSize: 7, fill: "#888" }}
        >
          {formatValue(yHi)}
        </Text>
        <Text
          x={2}
          y={CHART_PAD.top + plotH}
          style={{ fontSize: 7, fill: "#888" }}
        >
          {formatValue(yLo)}
        </Text>
      </Svg>
    </View>
  );
}

function seriesStats(series: ExportSeries) {
  const obs = series.observations.filter((o) => o.value != null);
  const nums = obs.map((o) => o.value!) as number[];
  if (nums.length === 0) {
    return { latest: null, mean: null, min: null, max: null, n: 0 };
  }
  const latest = obs[obs.length - 1];
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return { latest: latest.value, latestRow: latest, mean, min, max, n: nums.length };
}

function ObservationRow({
  o,
  unitFallback,
}: {
  o: ExportObservation;
  unitFallback: string | null;
}) {
  const flagStyle =
    o.flag === "high" ? styles.flagHigh : o.flag === "low" ? styles.flagLow : undefined;
  return (
    <View style={styles.tr}>
      <Text style={styles.cellDate}>{formatDate(o.date)}</Text>
      <Text style={styles.cellProvider}>{o.provider}</Text>
      <Text style={[styles.cellValue, flagStyle ?? {}]}>
        {o.value != null ? formatValue(o.value) : o.valueText ?? "—"}
      </Text>
      <Text style={styles.cellUnit}>{sanitizeUnit(o.units ?? unitFallback)}</Text>
      <Text style={styles.cellRange}>
        {o.refLow != null || o.refHigh != null
          ? `${o.refLow != null ? formatValue(o.refLow) : "—"} – ${
              o.refHigh != null ? formatValue(o.refHigh) : "—"
            }`
          : "—"}
      </Text>
      <Text style={[styles.cellFlag, flagStyle ?? {}]}>
        {o.flag ? o.flag.toUpperCase() : ""}
      </Text>
    </View>
  );
}

function SeriesPage({ series, windowLabel }: { series: ExportSeries; windowLabel: string }) {
  const s = seriesStats(series);
  return (
    <Page size="LETTER" style={styles.page}>
      <Text style={styles.h1}>{series.canonicalName}</Text>
      <Text style={styles.meta}>
        {series.categoryLabel} · {sanitizeUnit(series.units) || "—"} · {series.observations.length}{" "}
        observation{series.observations.length === 1 ? "" : "s"} · {windowLabel}
      </Text>

      <View style={styles.row}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Latest</Text>
          <Text style={styles.statValue}>
            {formatValue(s.latest)}
            {series.units ? ` ${sanitizeUnit(series.units)}` : ""}
          </Text>
          <Text style={styles.meta}>
            {s.latestRow ? formatDate(s.latestRow.date) : ""}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Mean</Text>
          <Text style={styles.statValue}>{formatValue(s.mean)}</Text>
          <Text style={styles.meta}>n = {s.n}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Range</Text>
          <Text style={styles.statValue}>
            {formatValue(s.min)} – {formatValue(s.max)}
          </Text>
        </View>
        <View style={styles.statLast}>
          <Text style={styles.statLabel}>Ref range</Text>
          <Text style={styles.statValue}>
            {series.refLow != null && series.refHigh != null
              ? `${formatValue(series.refLow)} – ${formatValue(series.refHigh)}`
              : series.refLow != null
                ? `≥ ${formatValue(series.refLow)}`
                : series.refHigh != null
                  ? `≤ ${formatValue(series.refHigh)}`
                  : "—"}
          </Text>
          <Text style={styles.meta}>{sanitizeUnit(series.units)}</Text>
        </View>
      </View>

      <SeriesChart series={series} />

      <Text style={styles.h2}>Observations</Text>
      <View style={styles.table}>
        <View style={styles.th}>
          <Text style={styles.cellDate}>Date</Text>
          <Text style={styles.cellProvider}>Provider</Text>
          <Text style={styles.cellValue}>Value</Text>
          <Text style={styles.cellUnit}>Unit</Text>
          <Text style={styles.cellRange}>Range</Text>
          <Text style={styles.cellFlag}>Flag</Text>
        </View>
        {series.observations.map((o) => (
          <ObservationRow key={`${o.date}-${o.provider}-${o.rawName}`} o={o} unitFallback={series.units} />
        ))}
      </View>

      <View style={styles.footer}>
        <Text>
          Health dashboard export · {series.canonicalName}
        </Text>
        <Text render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`} />
      </View>
    </Page>
  );
}

function InterventionsPage({
  items,
  windowLabel,
}: {
  items: ExportIntervention[];
  windowLabel: string;
}) {
  return (
    <Page size="LETTER" style={styles.page}>
      <Text style={styles.h1}>Interventions during window</Text>
      <Text style={styles.meta}>{windowLabel}</Text>

      <View style={styles.table}>
        <View style={styles.th}>
          <Text style={{ width: 160 }}>Name</Text>
          <Text style={{ width: 70 }}>Kind</Text>
          <Text style={{ width: 110 }}>Dose</Text>
          <Text style={{ width: 78 }}>Started</Text>
          <Text style={{ width: 78 }}>Stopped</Text>
        </View>
        {items.length === 0 ? (
          <View style={styles.interventionRow}>
            <Text style={{ color: "#888" }}>
              None recorded in this window.
            </Text>
          </View>
        ) : (
          items.map((i) => (
            <View key={i.id} style={styles.interventionRow}>
              <Text style={{ width: 160 }}>{i.name}</Text>
              <Text style={{ width: 70 }}>{i.kind}</Text>
              <Text style={{ width: 110 }}>{i.dose ?? ""}</Text>
              <Text style={{ width: 78 }}>{formatDate(i.startedOn)}</Text>
              <Text style={{ width: 78 }}>
                {i.stoppedOn ? formatDate(i.stoppedOn) : "active"}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.footer}>
        <Text>Health dashboard export · interventions</Text>
        <Text render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`} />
      </View>
    </Page>
  );
}

export function ClinicianPdf({ dataset }: { dataset: ExportDataset }) {
  const windowLabel = `${formatDate(dataset.fromDate)} – ${formatDate(dataset.toDate)}`;
  return (
    <Document
      title={`Health export — ${windowLabel}`}
      author="Health dashboard"
    >
      <Page size="LETTER" style={styles.cover}>
        <Text style={styles.coverTitle}>Health data — clinician export</Text>
        <Text style={styles.coverSub}>
          Window: {windowLabel} · Generated {formatDate(dataset.generatedAt.slice(0, 10))}
        </Text>
        <View style={styles.coverBox}>
          <Text>
            Contents:
            {"\n"}- {dataset.series.length} metric series ({dataset.series.reduce(
              (a, s) => a + s.observations.length,
              0,
            )} observations total)
            {"\n"}- {dataset.interventions.length} intervention
            {dataset.interventions.length === 1 ? "" : "s"} active during window
            {"\n\n"}
            Each metric page lists: a per-metric trend chart, summary stats
            (latest, mean, range, ref range), and every observation in the
            window. Values and reference ranges are copied verbatim from the
            source lab reports. Aberrant unit rows have been excluded from
            per-metric aggregates to avoid silent conversion.
            {"\n\n"}
            Source: locally-ingested PDF reports, extracted via Claude API and
            persisted in a local SQLite database on the user&apos;s machine. No
            data is shared externally other than with the Anthropic API for
            the extraction step.
          </Text>
        </View>
      </Page>
      {dataset.series.map((s) => (
        <SeriesPage
          key={s.canonicalMetricId}
          series={s}
          windowLabel={windowLabel}
        />
      ))}
      <InterventionsPage
        items={dataset.interventions}
        windowLabel={windowLabel}
      />
    </Document>
  );
}
