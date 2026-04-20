import { describe, expect, it } from "vitest";

import { maskApiKey } from "../../electron/mask-key";

describe("maskApiKey", () => {
  it("keeps the sk-ant- prefix and the last 4 chars, masking the middle", () => {
    expect(maskApiKey("sk-ant-api03-abcdefghijklmnop-ZYXW")).toBe(
      "sk-ant-…ZYXW",
    );
  });

  it("handles non-Anthropic keys by keeping a short prefix + last 4", () => {
    expect(maskApiKey("my-custom-key-abcdefg123")).toBe("my-c…g123");
  });

  it("returns a fixed-width dot string for very short inputs", () => {
    expect(maskApiKey("abc")).toBe("••••••");
    expect(maskApiKey("shortkey")).toBe("••••••••");
  });

  it("trims surrounding whitespace before masking", () => {
    expect(maskApiKey("  sk-ant-api03-abcdef-1234  ")).toBe("sk-ant-…1234");
  });
});
