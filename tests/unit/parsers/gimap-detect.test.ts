import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { detect } from "@/lib/parsers/gimap";

const fixturesDir = path.resolve(__dirname, "../../fixtures/gimap");

function fixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), "utf8");
}

describe("gimap detect", () => {
  it("returns true for the 2025-12 GI-MAP fixture", () => {
    expect(detect(fixture("2025-12.txt"))).toBe(true);
  });

  it("returns true for the 2024-12 GI-MAP fixture", () => {
    expect(detect(fixture("2024-12.txt"))).toBe(true);
  });

  it("returns false for a generic blood-panel-like text", () => {
    const text = `LabCorp Result Report\nPatient: Test\nWBC 6.2 4.0-11.0 K/uL\nRBC 4.5 4.5-5.9 M/uL\nHemoglobin 14.2 13.5-17.5 g/dL`;
    expect(detect(text)).toBe(false);
  });

  it("returns false when only the lab footer is present without sections", () => {
    const text = `Some unrelated document. Diagnostic Solutions Laboratory may be mentioned in passing.`;
    expect(detect(text)).toBe(false);
  });

  it("returns false on empty input", () => {
    expect(detect("")).toBe(false);
  });
});
