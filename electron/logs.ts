import fs from "node:fs";
import path from "node:path";

const LOG_NAME_RE = /^health-(\d{4})-(\d{2})-(\d{2})\.log$/;

export function currentLogFilename(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `health-${y}-${m}-${d}.log`;
}

export function pruneOldLogs(
  dir: string,
  keepDays: number,
  now: Date = new Date(),
): string[] {
  if (!fs.existsSync(dir)) return [];
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - keepDays);
  const deleted: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const m = LOG_NAME_RE.exec(name);
    if (!m) continue;
    const [, yy, mm, dd] = m;
    const fileDate = new Date(Number(yy), Number(mm) - 1, Number(dd));
    if (fileDate < cutoff) {
      fs.unlinkSync(path.join(dir, name));
      deleted.push(name);
    }
  }
  return deleted;
}

export interface LogHandle {
  logPath: string;
  write: (chunk: string) => void;
  close: () => void;
}

export function openLogFile(dir: string, now: Date = new Date()): LogHandle {
  fs.mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, currentLogFilename(now));
  const stream = fs.createWriteStream(logPath, { flags: "a" });
  return {
    logPath,
    write: (chunk) => {
      stream.write(chunk);
    },
    close: () => stream.end(),
  };
}

function stringifyArg(x: unknown): string {
  if (x instanceof Error) return x.stack ?? x.message;
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

export function formatLogLine(
  level: string,
  args: unknown[],
  now: Date = new Date(),
): string {
  const ts = now.toISOString();
  const msg = args.map(stringifyArg).join(" ");
  return `${ts} ${level.padEnd(5)} ${msg}\n`;
}

type ConsoleLevel = "log" | "warn" | "error" | "info";

export function installConsoleTee(handle: LogHandle): () => void {
  const levels: ConsoleLevel[] = ["log", "warn", "error", "info"];
  const originals = {} as Record<ConsoleLevel, (...args: unknown[]) => void>;
  for (const level of levels) {
    originals[level] = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      originals[level](...args);
      handle.write(formatLogLine(level, args));
    };
  }
  return () => {
    for (const level of levels) {
      console[level] = originals[level];
    }
  };
}
