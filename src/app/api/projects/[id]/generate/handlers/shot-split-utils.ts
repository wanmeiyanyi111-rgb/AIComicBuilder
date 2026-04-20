import { parseShotSplitPayload as parseShotSplitPayloadFromJson } from "@/lib/shot-split-json";

export type ParsedShot = {
  sequence: number;
  sceneDescription: string;
  startFrame: string;
  endFrame: string;
  motionScript: string;
  videoScript?: string;
  duration: number;
  dialogues: Array<{ character: string; text: string }>;
  cameraDirection?: string;
  transitionIn?: string;
  transitionOut?: string;
  compositionGuide?: string;
  focalPoint?: string;
  depthOfField?: string;
  soundDesign?: string;
  musicCue?: string;
  characters?: string[];
  referenceImagePrompts?: string[];
};

export function parseShotSplitPayload(rawText: string): ParsedShot[] {
  return parseShotSplitPayloadFromJson(rawText) as ParsedShot[];
}

export function summarizeModelOutput(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 800);
}

export function countScriptSceneMarkers(script: string) {
  return script.match(/^[\s]*(?:场景|SCENE)\s*\d+/gimu)?.length || 0;
}

export function countScriptShotCues(script: string) {
  return script.match(/^[\s]*[（(][^\n]*?(\d+)\s*s[）)]/gimu)?.length || 0;
}

export function estimateMinimumShotsForChunk(
  scriptChunk: string,
  targetShotBudget: {
    targetShotCount: number;
    minShotCount: number;
    maxShotCount: number;
  } | null,
  totalSceneCount?: number
) {
  const sceneCount = countScriptSceneMarkers(scriptChunk);
  const shotCueCount = countScriptShotCues(scriptChunk);
  let minimumShots = sceneCount;
  if (shotCueCount >= 8) {
    minimumShots = Math.max(minimumShots, Math.ceil(shotCueCount * 0.5));
  }
  if (targetShotBudget) {
    const proratedMinShotCount =
      totalSceneCount && totalSceneCount > 0 && sceneCount > 0
        ? Math.max(sceneCount, Math.ceil(targetShotBudget.minShotCount * (sceneCount / totalSceneCount)))
        : targetShotBudget.minShotCount;
    minimumShots = Math.max(
      minimumShots,
      Math.max(sceneCount, Math.min(proratedMinShotCount, Math.max(6, Math.floor(proratedMinShotCount * 0.35))))
    );
  }
  return minimumShots;
}

export function estimateMinimumDurationForChunk(scriptChunk: string) {
  const shotCueCount = countScriptShotCues(scriptChunk);
  if (shotCueCount < 8) return 0;
  return Math.max(20, Math.floor(shotCueCount * 2.5));
}

export function validateShotCoverage(
  shotList: ParsedShot[],
  scriptChunk: string,
  targetShotBudget: {
    targetShotCount: number;
    minShotCount: number;
    maxShotCount: number;
  } | null,
  totalSceneCount?: number
) {
  const issues: string[] = [];
  const sceneCount = countScriptSceneMarkers(scriptChunk);
  const shotCueCount = countScriptShotCues(scriptChunk);
  const totalDuration = shotList.reduce((sum, shot) => sum + (Number.isFinite(shot.duration) ? shot.duration : 0), 0);
  const invalidDurationShots = shotList.filter((shot) => !Number.isFinite(shot.duration) || shot.duration < 10 || shot.duration > 14);

  if (invalidDurationShots.length > 0) {
    const preview = invalidDurationShots.slice(0, 4).map((shot) => `#${shot.sequence}:${shot.duration}`).join("、");
    issues.push(`存在不在 10-14 秒区间内的镜头时长（${preview}${invalidDurationShots.length > 4 ? "…" : ""}）`);
  }
  if (sceneCount > 0 && shotList.length < sceneCount) {
    issues.push(`仅生成 ${shotList.length} 个镜头，少于剧本中的 ${sceneCount} 个场景`);
  }
  if (shotCueCount >= 8) {
    const minimumFromCues = Math.max(sceneCount, Math.ceil(shotCueCount * 0.5));
    if (shotList.length < minimumFromCues) {
      issues.push(`剧本中已有 ${shotCueCount} 个显式镜头提示，但只拆出 ${shotList.length} 个镜头`);
    }
  }
  if (targetShotBudget) {
    const proratedMinShotCount =
      totalSceneCount && totalSceneCount > 0 && sceneCount > 0
        ? Math.max(sceneCount, Math.ceil(targetShotBudget.minShotCount * (sceneCount / totalSceneCount)))
        : targetShotBudget.minShotCount;
    const minimumBudgetShots = estimateMinimumShotsForChunk(scriptChunk, targetShotBudget, totalSceneCount);
    if (shotList.length < minimumBudgetShots) {
      issues.push(`镜头数 ${shotList.length} 明显低于预算下限（至少应接近 ${minimumBudgetShots}，当前块折算预算约 ${proratedMinShotCount}）`);
    }
  }
  if (shotCueCount >= 8) {
    const minimumDuration = estimateMinimumDurationForChunk(scriptChunk);
    if (totalDuration < minimumDuration) {
      issues.push(`镜头总时长仅 ${totalDuration}s，明显低于剧本文本所暗示的镜头覆盖时长`);
    }
  }
  return issues;
}

export function splitScriptByScenes(script: string, maxScenes: number): string[] {
  const scenePattern = /^[\s*#]*(?:SCENE|场景)\s*\d+/i;
  const lines = script.split("\n");
  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (scenePattern.test(lines[i].trim())) boundaries.push(i);
  }
  if (boundaries.length <= maxScenes) return [script];
  const header = lines.slice(0, boundaries[0]).join("\n").trim();
  const chunks: string[] = [];
  for (let i = 0; i < boundaries.length; i += maxScenes) {
    const start = boundaries[i];
    const end = i + maxScenes < boundaries.length ? boundaries[i + maxScenes] : lines.length;
    const scenesText = lines.slice(start, end).join("\n");
    chunks.push(header ? `${header}\n\n${scenesText}` : scenesText);
  }
  return chunks;
}
