// Basic smoke test for the /uploads + /api/uploads surface.
// Usage: PORT=3001 pnpm tsx scripts/smoke-uploads.ts

const PORT = process.env.PORT ?? "3001";
const BASE = `http://localhost:${PORT}`;

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

const checks: Check[] = [];

async function expectStatus(
  name: string,
  res: Response,
  want: number,
): Promise<Response> {
  checks.push({
    name,
    pass: res.status === want,
    detail: `want ${want}, got ${res.status}`,
  });
  return res;
}

async function run() {
  // 1. Page shell renders
  await expectStatus("GET /uploads", await fetch(`${BASE}/uploads`), 200);

  // 2. API list returns an array
  const listRes = await expectStatus(
    "GET /api/uploads",
    await fetch(`${BASE}/api/uploads`),
    200,
  );
  const listJson = (await listRes.json()) as { batches: unknown };
  checks.push({
    name: "GET /api/uploads body.batches is array",
    pass: Array.isArray(listJson.batches),
    detail: JSON.stringify(listJson).slice(0, 200),
  });

  // 3. Empty POST is rejected
  const postEmpty = await expectStatus(
    "POST /api/uploads (empty)",
    await fetch(`${BASE}/api/uploads`, {
      method: "POST",
      body: new FormData(),
    }),
    400,
  );
  const postEmptyJson = (await postEmpty.json()) as { error?: string };
  checks.push({
    name: "POST /api/uploads (empty) has error",
    pass: typeof postEmptyJson.error === "string",
    detail: JSON.stringify(postEmptyJson),
  });

  // 4. Non-PDF is rejected
  const fd = new FormData();
  fd.append(
    "files",
    new Blob(["not a pdf"], { type: "text/plain" }),
    "not.txt",
  );
  await expectStatus(
    "POST /api/uploads (non-pdf)",
    await fetch(`${BASE}/api/uploads`, { method: "POST", body: fd }),
    400,
  );

  // 5. Unknown batch detail is 404
  await expectStatus(
    "GET /api/uploads/99999",
    await fetch(`${BASE}/api/uploads/99999`),
    404,
  );

  // 6. Invalid id is 400
  await expectStatus(
    "GET /api/uploads/abc",
    await fetch(`${BASE}/api/uploads/abc`),
    400,
  );
}

run()
  .catch((err) => {
    console.error("smoke test crashed:", err);
    process.exit(2);
  })
  .then(() => {
    let failed = 0;
    for (const c of checks) {
      const mark = c.pass ? "✓" : "✗";
      const detail = c.pass ? "" : ` — ${c.detail ?? ""}`;
      console.log(`${mark} ${c.name}${detail}`);
      if (!c.pass) failed += 1;
    }
    console.log(`\n${checks.length - failed}/${checks.length} passed`);
    process.exit(failed === 0 ? 0 : 1);
  });
