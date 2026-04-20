import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "@/db/schema";
import { applySeeds, canonicalCount, aliasCount } from "@/db/seeds/apply";
import { dbPath } from "@/lib/paths";

const file = dbPath();
fs.mkdirSync(path.dirname(file), { recursive: true });

const sqlite = new Database(file);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite, { schema });

const report = applySeeds(db);

console.log(
  [
    `Seeds applied → ${file}`,
    `  canonical_metrics: ${canonicalCount(db)} total (+${report.canonicalInserted} inserted, ${report.canonicalUpdated} updated)`,
    `  metric_aliases:    ${aliasCount(db)} total (+${report.aliasInserted} inserted, ${report.aliasSkipped} already present)`,
  ].join("\n"),
);

sqlite.close();
