import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  currentLogFilename,
  formatLogLine,
  openLogFile,
  pruneOldLogs,
} from "../../electron/logs";

describe("currentLogFilename", () => {
  it("formats as health-YYYY-MM-DD.log with zero-padded month + day", () => {
    expect(currentLogFilename(new Date(2026, 0, 3))).toBe(
      "health-2026-01-03.log",
    );
    expect(currentLogFilename(new Date(2026, 3, 19))).toBe(
      "health-2026-04-19.log",
    );
    expect(currentLogFilename(new Date(2026, 11, 31))).toBe(
      "health-2026-12-31.log",
    );
  });
});

describe("formatLogLine", () => {
  it("prefixes ISO timestamp + level tag and joins args with spaces", () => {
    const now = new Date("2026-04-19T12:00:00.000Z");
    expect(formatLogLine("info", ["hello", "world"], now)).toBe(
      "2026-04-19T12:00:00.000Z info  hello world\n",
    );
    expect(formatLogLine("warn", ["count:", 42], now)).toBe(
      "2026-04-19T12:00:00.000Z warn  count: 42\n",
    );
  });

  it("renders Error values with their stack when present", () => {
    const now = new Date("2026-04-19T12:00:00.000Z");
    const err = new Error("boom");
    const line = formatLogLine("error", ["failed:", err], now);
    expect(line).toContain("2026-04-19T12:00:00.000Z error failed:");
    expect(line).toContain("Error: boom");
  });
});

describe("pruneOldLogs", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "health-logs-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty list when the directory is missing", () => {
    const missing = path.join(dir, "does-not-exist");
    expect(pruneOldLogs(missing, 14)).toEqual([]);
  });

  it("deletes only files older than the keep window, ignores non-matching names", () => {
    const now = new Date(2026, 3, 19);
    const keep = ["health-2026-04-19.log", "health-2026-04-05.log"];
    const drop = ["health-2026-04-04.log", "health-2024-11-02.log"];
    const unrelated = ["notes.txt", "debug.log", "health-bogus.log"];
    for (const name of [...keep, ...drop, ...unrelated]) {
      fs.writeFileSync(path.join(dir, name), "x");
    }

    const deleted = pruneOldLogs(dir, 14, now).sort();
    expect(deleted).toEqual(drop.sort());

    const remaining = fs.readdirSync(dir).sort();
    expect(remaining).toEqual([...keep, ...unrelated].sort());
  });
});

describe("openLogFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "health-logs-open-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates the directory (if missing) and writes appendably", async () => {
    const nested = path.join(dir, "nested");
    const now = new Date(2026, 3, 19);
    const handle = openLogFile(nested, now);
    expect(handle.logPath).toBe(path.join(nested, "health-2026-04-19.log"));

    handle.write("line one\n");
    handle.write("line two\n");
    await new Promise<void>((resolve) => {
      handle.close();
      setTimeout(resolve, 50);
    });

    const contents = fs.readFileSync(handle.logPath, "utf8");
    expect(contents).toBe("line one\nline two\n");
  });
});
