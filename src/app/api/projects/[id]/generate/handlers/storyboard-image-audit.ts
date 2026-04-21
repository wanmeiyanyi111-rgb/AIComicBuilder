import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type PanelAuditLike = {
  fileUrl: string | null;
  meta?: Record<string, unknown> | null;
};

export type StoryboardImageAuditResult = {
  score: number;
  pass: boolean;
  stage: "rule_based" | "perceptual_hash";
  summary: string;
  issues: string[];
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

async function computeAverageHash(imagePath: string): Promise<string> {
  const { stdout } = await execFileAsync("ffmpeg", [
    "-v",
    "error",
    "-i",
    imagePath,
    "-vf",
    "scale=8:8:force_original_aspect_ratio=decrease,pad=8:8:(ow-iw)/2:(oh-ih)/2:black,format=gray",
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "pipe:1",
  ], {
    encoding: "buffer",
    maxBuffer: 1024 * 1024,
  });
  const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  if (buffer.length < 64) {
    throw new Error(`Invalid hash frame buffer for ${imagePath}`);
  }
  const pixels = Array.from(buffer.subarray(0, 64));
  const avg = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
  return pixels.map((value) => (value >= avg ? "1" : "0")).join("");
}

function hammingDistance(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let distance = Math.abs(a.length - b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) distance += 1;
  }
  return distance;
}

export async function auditGeneratedStoryboardImages(
  panels: PanelAuditLike[]
): Promise<StoryboardImageAuditResult> {
  const issues: string[] = [];
  const promptScores = panels
    .map((panel) => numberOrNull(panel.meta?.continuityAuditScore))
    .filter((value): value is number => value !== null);
  const promptPassStates = panels
    .map((panel) => boolOrNull(panel.meta?.continuityAuditPass))
    .filter((value): value is boolean => value !== null);
  const completedPanels = panels.filter((panel) => !!panel.fileUrl).length;

  if (completedPanels < 4) {
    issues.push("四宫格图片未完整生成，当前不足 4 格。");
  }

  if (promptPassStates.some((value) => value === false)) {
    issues.push("四宫格提示词连续性审计未通过，当前成图需要人工复核。");
  }

  const readyPaths = panels
    .map((panel) => (typeof panel.fileUrl === "string" ? panel.fileUrl.trim() : ""))
    .filter(Boolean);

  let stage: StoryboardImageAuditResult["stage"] = "rule_based";
  if (readyPaths.length === 4) {
    try {
      const hashes = await Promise.all(readyPaths.map((imagePath) => computeAverageHash(imagePath)));
      const duplicatePairs: string[] = [];
      for (let left = 0; left < hashes.length; left += 1) {
        for (let right = left + 1; right < hashes.length; right += 1) {
          const distance = hammingDistance(hashes[left], hashes[right]);
          if (distance <= 8) {
            duplicatePairs.push(`第${left + 1}格与第${right + 1}格`);
          }
        }
      }
      if (duplicatePairs.length > 0) {
        issues.push(
          `${duplicatePairs.join("、")} 视觉相似度过高，四宫格疑似塌成重复画面。`
        );
      }
      stage = "perceptual_hash";
    } catch (error) {
      issues.push(
        `成图相似度审计未完成：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const avgPromptScore =
    promptScores.length > 0
      ? Math.round(promptScores.reduce((sum, value) => sum + value, 0) / promptScores.length)
      : null;
  const score = Math.max(
    0,
    Math.min(
      100,
      (avgPromptScore ?? 72) -
        (completedPanels < 4 ? 25 : 0) -
        (promptPassStates.some((value) => value === false) ? 12 : 0) -
        (issues.some((item) => item.includes("视觉相似度过高")) ? 36 : 0)
    )
  );
  const pass =
    !issues.some(
      (item) =>
        item.includes("未完整生成") ||
        item.includes("提示词连续性审计未通过") ||
        item.includes("视觉相似度过高")
    );
  return {
    score,
    pass,
    stage,
    summary: pass
      ? "四宫格成图已完成结构与相似度审计，当前不存在明显重复塌缩。"
      : "四宫格成图已完成审计，检测到结构或视觉重复问题，建议优先修复提示词并重生问题图片。",
    issues,
  };
}
