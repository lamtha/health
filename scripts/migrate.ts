import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { dbPath, migrationsDir } from "@/lib/paths";

const file = dbPath();
fs.mkdirSync(path.dirname(file), { recursive: true });

const sqlite = new Database(file);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite);
migrate(db, { migrationsFolder: migrationsDir() });

sqlite.close();
console.log(`Migrations applied → ${file}`);
