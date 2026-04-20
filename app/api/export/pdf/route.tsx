import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";

import { buildExportDataset } from "@/lib/export";
import { ClinicianPdf } from "@/lib/pdf/clinician-pdf";

export const runtime = "nodejs";

function parseIds(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function parseDate(raw: string | null): string | null {
  if (!raw) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = parseDate(url.searchParams.get("from"));
  const to = parseDate(url.searchParams.get("to"));
  const ids = parseIds(url.searchParams.get("m"));

  if (!from || !to) {
    return NextResponse.json(
      { error: "from and to (YYYY-MM-DD) required" },
      { status: 400 },
    );
  }
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "at least one metric id required" },
      { status: 400 },
    );
  }

  const dataset = buildExportDataset({ fromDate: from, toDate: to, canonicalIds: ids });
  const buffer = await renderToBuffer(<ClinicianPdf dataset={dataset} />);

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="health-export-${from}-${to}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
