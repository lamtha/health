import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Route the health DB + uploads to a per-worker tmpdir before any test file
// imports `lib/db.ts`. `lib/paths.ts` keys every writable path off
// `HEALTH_USER_DATA_DIR`; setting it here isolates each vitest worker.
//
// `HEALTH_APP_DIR` controls where `lib/db.ts` looks for drizzle migrations.
// We point it at the project root so the embedded `migrate(...)` call picks
// up the real `drizzle/` folder and provisions the schema + canonical seeds.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "health-test-"));
process.env.HEALTH_USER_DATA_DIR = tmp;
process.env.HEALTH_APP_DIR = process.cwd();
