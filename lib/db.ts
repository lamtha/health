import "server-only";

import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { applySeeds } from "@/db/seeds/apply";
import { dbPath, migrationsDir } from "@/lib/paths";

function createDb() {
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const database = drizzle(sqlite, { schema });

  // Under Electron, apply pending migrations and seed the canonical
  // taxonomy on first open — distributed users have no CLI to run
  // `pnpm db:migrate` or `pnpm db:seed`. applySeeds is idempotent.
  // Web-dev keeps both steps manual so in-progress schema / taxonomy
  // work doesn't auto-apply.
  if (process.env.HEALTH_USER_DATA_DIR) {
    migrate(database, { migrationsFolder: migrationsDir() });
    applySeeds(database);
  }

  return database;
}

declare global {
  // eslint-disable-next-line no-var
  var __healthDb: ReturnType<typeof createDb> | undefined;
}

export const db = globalThis.__healthDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalThis.__healthDb = db;
