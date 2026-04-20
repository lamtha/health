import path from "node:path";

// Single source of truth for per-user writable paths.
//
// When HEALTH_USER_DATA_DIR is set (Electron main sets it to
// `app.getPath('userData')` before starting the embedded server), the app
// writes under that directory. Otherwise — web-dev, CLI scripts — paths are
// project-relative, matching behavior that predates the Electron shell.

function baseDir(): string {
  return process.env.HEALTH_USER_DATA_DIR ?? process.cwd();
}

function appDir(): string {
  return process.env.HEALTH_APP_DIR ?? process.cwd();
}

export function dbPath(): string {
  return path.join(baseDir(), "data", "health.db");
}

export function uploadsDir(): string {
  return path.join(baseDir(), "uploads");
}

export function stagingDir(): string {
  return path.join(uploadsDir(), ".staging");
}

export function logsDir(): string {
  return path.join(baseDir(), "logs");
}

// Drizzle-generated migrations. Immutable app resource, not per-user state.
// In the packaged app, Electron main sets HEALTH_APP_DIR to app.getAppPath()
// so the server finds drizzle/ inside the bundle.
export function migrationsDir(): string {
  return path.join(appDir(), "drizzle");
}
