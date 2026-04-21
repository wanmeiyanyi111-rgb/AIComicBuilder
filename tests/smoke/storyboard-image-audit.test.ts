import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { auditGeneratedStoryboardImages } from "../../src/app/api/projects/[id]/generate/handlers/storyboard-image-audit";

function writePpm(filePath: string, pixels: number[][]): void {
  const height = pixels.length;
  const width = pixels[0]?.length ?? 0;
  const rows = pixels
    .map((row) =>
      row.map((value) => `${value} ${value} ${value}`).join(" ")
    )
    .join("\n");
  fs.writeFileSync(filePath, `P3\n${width} ${height}\n255\n${rows}\n`, "utf8");
}

function makePattern(seed: number): number[][] {
  return Array.from({ length: 8 }, (_, y) =>
    Array.from({ length: 8 }, (_, x) => ((x * 37 + y * 53 + seed * 61) % 256))
  );
}

test("auditGeneratedStoryboardImages passes when four panels are visually distinct", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyboard-audit-"));
  const files = [0, 1, 2, 3].map((seed) => {
    const filePath = path.join(tempDir, `panel-${seed}.ppm`);
    writePpm(filePath, makePattern(seed));
    return filePath;
  });

  const result = await auditGeneratedStoryboardImages(
    files.map((fileUrl) => ({
      fileUrl,
      meta: { continuityAuditScore: 92, continuityAuditPass: true },
    }))
  );

  assert.equal(result.pass, true);
  assert.equal(result.stage, "perceptual_hash");
  assert.equal(result.issues.length, 0);
});

test("auditGeneratedStoryboardImages fails when panels collapse into duplicates", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyboard-audit-"));
  const repeated = path.join(tempDir, "repeat.ppm");
  const unique = path.join(tempDir, "unique.ppm");
  writePpm(repeated, makePattern(7));
  writePpm(unique, makePattern(17));

  const result = await auditGeneratedStoryboardImages([
    { fileUrl: repeated, meta: { continuityAuditScore: 78, continuityAuditPass: true } },
    { fileUrl: repeated, meta: { continuityAuditScore: 78, continuityAuditPass: true } },
    { fileUrl: unique, meta: { continuityAuditScore: 78, continuityAuditPass: true } },
    { fileUrl: repeated, meta: { continuityAuditScore: 78, continuityAuditPass: true } },
  ]);

  assert.equal(result.pass, false);
  assert.equal(result.stage, "perceptual_hash");
  assert.ok(result.issues.some((item) => item.includes("视觉相似度过高")));
});
