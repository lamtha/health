export async function validateApiKey(
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl("https://api.anthropic.com/v1/models?beta=true", {
      method: "GET",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Couldn't reach Anthropic (${msg}). Check your internet and try again.`,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "Anthropic rejected that key. Double-check it at console.anthropic.com.",
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const snippet = body ? `: ${body.slice(0, 120)}` : "";
    throw new Error(`Anthropic returned ${res.status}${snippet}`);
  }
}
