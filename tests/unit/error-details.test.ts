import { describe, expect, it } from "vitest";

import { formatErrorDetails } from "../../lib/error-details";

describe("formatErrorDetails", () => {
  const frozen = new Date("2026-04-19T12:00:00.000Z");

  it("formats a plain Error with timestamp, message, and stack", () => {
    const err = new Error("boom");
    const out = formatErrorDetails(err, frozen);
    expect(out).toContain("Time: 2026-04-19T12:00:00.000Z");
    expect(out).toContain("Message: boom");
    expect(out).toContain("Stack:");
    expect(out).toContain("Error: boom");
  });

  it("includes the digest when Next.js attaches one", () => {
    const err = Object.assign(new Error("server render failed"), {
      digest: "abc123",
    });
    const out = formatErrorDetails(err, frozen);
    expect(out).toContain("Digest: abc123");
  });

  it("includes the name when it isn't the default 'Error'", () => {
    const err = new TypeError("bad argument");
    const out = formatErrorDetails(err, frozen);
    expect(out).toContain("Name: TypeError");
    expect(out).toContain("Message: bad argument");
  });

  it("omits the name line for generic Error instances", () => {
    const err = new Error("plain");
    const out = formatErrorDetails(err, frozen);
    expect(out).not.toContain("Name:");
  });

  it("falls back to placeholders when message / stack are missing", () => {
    const out = formatErrorDetails({}, frozen);
    expect(out).toContain("Message: (no message)");
    expect(out).toContain("Stack:\n(no stack)");
  });
});
