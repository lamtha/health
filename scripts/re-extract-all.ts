import fs from "node:fs";
import path from "node:path";

// Tiny .env loader so the script runs without adding a dotenv dependency.
function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

import { db } from "@/lib/db";
import { reports } from "@/db/schema";
import {
  reExtractReport,
  replayReportFromLatestExtraction,
} from "@/lib/re-extract";

async function main() {
  const args = process.argv.slice(2);
  const replay = args.includes("--replay");
  const only = args
    .find((a) => a.startsWith("--only="))
    ?.split("=", 2)[1]
    ?.split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));

  if (!replay && !process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for a live re-extract. Set it in .env, or pass --replay to re-derive metrics from the stored raw JSON.",
    );
  }

  const rows = db
    .select({ id: reports.id, provider: reports.provider, reportDate: reports.reportDate })
    .from(reports)
    .all();
  const targets = only ? rows.filter((r) => only.includes(r.id)) : rows;

  if (targets.length === 0) {
    console.log("No reports selected.");
    return;
  }

  const mode = replay ? "replay" : "live re-extract";
  console.log(`Re-processing ${targets.length} report(s) — mode: ${mode}`);

  let ok = 0;
  let failed = 0;
  for (const r of targets) {
    const label = `#${r.id} · ${r.provider} · ${r.reportDate ?? "?"}`;
    try {
      const result = replay
        ? replayReportFromLatestExtraction(r.id)
        : await reExtractReport(r.id);
      ok += 1;
      console.log(
        `✓ ${label} — ${result.metricCount} metrics · ${result.panelCount} panels · ${(
          result.elapsedMs / 1000
        ).toFixed(1)}s (${result.mode})`,
      );
    } catch (err) {
      failed += 1;
      console.error(`✗ ${label} — ${(err as Error).message}`);
    }
  }

  console.log(`\nDone. ${ok} ok, ${failed} failed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
