import { describe, expect, it } from "vitest";

import { GET } from "../../app/api/search/route";

describe("GET /api/search", () => {
  it("returns an empty result for an empty query", async () => {
    const res = await GET(new Request("http://localhost/api/search?q="));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      query: "",
      metrics: [],
      unmapped: [],
      reports: [],
    });
  });

  it("resolves WBC aliases to the White Blood Cells canonical", async () => {
    const res = await GET(new Request("http://localhost/api/search?q=wbc"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.query).toBe("wbc");
    expect(body.metrics.length).toBeGreaterThan(0);
    const hit = body.metrics.find(
      (m: { canonicalName: string }) => m.canonicalName === "White Blood Cells",
    );
    expect(hit).toBeDefined();
    expect(hit.matchedAlias).toBe("wbc");
    expect(hit.category).toBe("cbc");
  });
});
