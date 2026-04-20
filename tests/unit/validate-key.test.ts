import { describe, expect, it, vi } from "vitest";

import { validateApiKey } from "../../electron/validate-key";

function mockFetch(response: Partial<Response> | Error) {
  if (response instanceof Error) {
    return vi.fn().mockRejectedValue(response);
  }
  return vi.fn().mockResolvedValue(response as Response);
}

describe("validateApiKey", () => {
  it("resolves on 200", async () => {
    const fetchImpl = mockFetch({
      ok: true,
      status: 200,
      text: async () => "",
    });
    await expect(
      validateApiKey("sk-ant-test", fetchImpl as unknown as typeof fetch),
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/models?beta=true");
    expect((init as RequestInit).method).toBe("GET");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("rejects with a friendly message on 401", async () => {
    const fetchImpl = mockFetch({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });
    await expect(
      validateApiKey("bad", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/Anthropic rejected that key/i);
  });

  it("rejects with a friendly message on 403", async () => {
    const fetchImpl = mockFetch({
      ok: false,
      status: 403,
      text: async () => "forbidden",
    });
    await expect(
      validateApiKey("bad", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/Anthropic rejected that key/i);
  });

  it("surfaces status + body snippet on other non-2xx", async () => {
    const fetchImpl = mockFetch({
      ok: false,
      status: 500,
      text: async () => "internal error boom",
    });
    await expect(
      validateApiKey("sk-ant-test", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/Anthropic returned 500.*internal error boom/);
  });

  it("surfaces an unreachable message on network errors", async () => {
    const fetchImpl = mockFetch(new TypeError("fetch failed"));
    await expect(
      validateApiKey("sk-ant-test", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/Couldn't reach Anthropic .*fetch failed/);
  });
});
