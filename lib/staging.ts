import "server-only";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { stagingDir, uploadsDir } from "@/lib/paths";

const STAGING_ROOT = stagingDir();
const FINAL_ROOT = uploadsDir();

export interface StagingManifest {
  id: string;
  originalFilename: string;
  sizeBytes: number;
  fileHash: string;
  createdAt: string;
}

export async function stagePdf(file: {
  originalFilename: string;
  bytes: Buffer;
}): Promise<StagingManifest & { pdfPath: string }> {
  await fs.mkdir(STAGING_ROOT, { recursive: true });
  const id = crypto.randomUUID();
  const dir = path.join(STAGING_ROOT, id);
  await fs.mkdir(dir);

  const pdfPath = path.join(dir, "source.pdf");
  await fs.writeFile(pdfPath, file.bytes);

  const fileHash = crypto
    .createHash("sha256")
    .update(file.bytes)
    .digest("hex");

  const manifest: StagingManifest = {
    id,
    originalFilename: file.originalFilename,
    sizeBytes: file.bytes.byteLength,
    fileHash,
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  return { ...manifest, pdfPath };
}

export async function writeStagedExtraction(
  id: string,
  extraction: unknown,
): Promise<void> {
  const dir = path.join(STAGING_ROOT, id);
  await fs.writeFile(
    path.join(dir, "extraction.json"),
    JSON.stringify(extraction, null, 2),
  );
}

export async function readStaged(id: string): Promise<{
  manifest: StagingManifest;
  pdfPath: string;
  extraction: unknown;
}> {
  const dir = path.join(STAGING_ROOT, id);
  const manifest = JSON.parse(
    await fs.readFile(path.join(dir, "manifest.json"), "utf8"),
  ) as StagingManifest;
  const extraction = JSON.parse(
    await fs.readFile(path.join(dir, "extraction.json"), "utf8"),
  );
  return { manifest, pdfPath: path.join(dir, "source.pdf"), extraction };
}

export async function promoteStaged(
  id: string,
  fileHash: string,
): Promise<string> {
  const stagingDir = path.join(STAGING_ROOT, id);
  const stagingPdf = path.join(stagingDir, "source.pdf");
  await fs.mkdir(FINAL_ROOT, { recursive: true });
  const finalPath = path.join(FINAL_ROOT, `${fileHash}.pdf`);
  await fs.rename(stagingPdf, finalPath).catch(async (err) => {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      await fs.copyFile(stagingPdf, finalPath);
      await fs.unlink(stagingPdf);
    } else {
      throw err;
    }
  });
  await fs.rm(stagingDir, { recursive: true, force: true });
  return finalPath;
}

export async function discardStaged(id: string): Promise<void> {
  const dir = path.join(STAGING_ROOT, id);
  await fs.rm(dir, { recursive: true, force: true });
}
