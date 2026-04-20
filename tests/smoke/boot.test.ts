import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error("could not pick free port"));
      }
    });
  });
}

async function waitForServer(
  url: string,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server never became ready at ${url}`);
}

describe("smoke: next server boot", () => {
  let server: ChildProcess | null = null;
  let baseUrl = "";

  beforeAll(async () => {
    const port = await pickFreePort();
    const nextBin = path.join(
      process.cwd(),
      "node_modules",
      "next",
      "dist",
      "bin",
      "next",
    );
    server = spawn(
      process.execPath,
      [nextBin, "dev", "--port", String(port)],
      {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: "development" },
        stdio: "ignore",
      },
    );
    baseUrl = `http://localhost:${port}`;
    await waitForServer(baseUrl);
  }, 120_000);

  afterAll(() => {
    if (server && !server.killed) server.kill("SIGTERM");
  });

  it("GET / returns 200", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
  });

  it("GET /reports returns 200", async () => {
    const res = await fetch(`${baseUrl}/reports`);
    expect(res.status).toBe(200);
  });

  it("GET /settings returns 200", async () => {
    const res = await fetch(`${baseUrl}/settings`);
    expect(res.status).toBe(200);
  });

  it("GET /welcome returns 200", async () => {
    const res = await fetch(`${baseUrl}/welcome`);
    expect(res.status).toBe(200);
  });

  it("GET /api/search?q=wbc returns JSON with canonical hits", async () => {
    const res = await fetch(`${baseUrl}/api/search?q=wbc`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      metrics: Array<{ canonicalName: string }>;
    };
    expect(
      body.metrics.some((m) => m.canonicalName === "White Blood Cells"),
    ).toBe(true);
  });
});
