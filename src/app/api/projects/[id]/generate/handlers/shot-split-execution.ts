import { generateText } from "ai";
import {
  countScriptSceneMarkers,
  countScriptShotCues,
  estimateMinimumDurationForChunk,
  estimateMinimumShotsForChunk,
  type ParsedShot,
  parseShotSplitPayload,
  summarizeModelOutput,
  validateShotCoverage,
} from "./shot-split-utils";

const RETRY_INSTRUCTION =
  "\n\nIMPORTANT: Return COMPLETE, VALID JSON only. Do not use markdown fences. Ensure all strings are closed and escaped.";

export async function processShotSplitChunk(params: {
  chunk: string;
  chunkIndex: number;
  sceneChunksLength: number;
  model: any;
  prompt: string;
  providerOptions: any;
  systemPrompt: string;
  targetShotBudget: {
    targetShotCount: number;
    minShotCount: number;
    maxShotCount: number;
  } | null;
  totalSceneCount: number;
}) {
  const sceneCount = countScriptSceneMarkers(params.chunk);
  const shotCueCount = countScriptShotCues(params.chunk);
  const minimumShotsForChunk = estimateMinimumShotsForChunk(
    params.chunk,
    params.targetShotBudget,
    params.totalSceneCount
  );
  const minimumDurationForChunk = estimateMinimumDurationForChunk(params.chunk);
  let prompt = params.prompt;

  if (sceneCount > 0 || shotCueCount > 0) {
    prompt += [
      "",
      "【强制覆盖约束】",
      sceneCount > 0
        ? `当前剧本块包含 ${sceneCount} 个场景标记，每个场景都必须至少产出 1 个镜头，绝不能只拆第一场。`
        : "",
      shotCueCount > 0
        ? `当前剧本块包含 ${shotCueCount} 个显式镜头提示（如“（特写，4s）”），你可以合并极少数相邻提示，但绝不能压缩成少量镜头草草交差。`
        : "",
      minimumShotsForChunk > 0
        ? `当前剧本块最少应产出 ${minimumShotsForChunk} 个镜头，少于这个数量将视为无效输出。`
        : "",
      minimumDurationForChunk > 0
        ? `当前剧本块镜头总时长至少应接近 ${minimumDurationForChunk}s，明显低于此时长将视为覆盖不足。`
        : "",
      "如果镜头数量明显偏少，将视为无效输出。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const maxAttempts = 2;
  let lastErr: unknown = null;
  let invalidOutput = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await generateText({
        model: params.model,
        system: params.systemPrompt,
        prompt: attempt === 1 ? prompt : `${prompt}${RETRY_INSTRUCTION}`,
        providerOptions: params.providerOptions,
        temperature: attempt === 1 ? 0.7 : 0.4,
        maxOutputTokens: 8192,
      });
      invalidOutput = result.text;

      const shotList = parseShotSplitPayload(result.text);
      if (shotList.length === 0) {
        throw new Error("empty shot list");
      }
      const coverageIssues = validateShotCoverage(
        shotList,
        params.chunk,
        params.targetShotBudget,
        params.totalSceneCount
      );
      if (coverageIssues.length > 0) {
        throw new Error(coverageIssues.join("；"));
      }

      console.log(
        `[ShotSplit] Chunk ${params.chunkIndex + 1}/${params.sceneChunksLength} attempt ${attempt}: ${shotList.length} shots, keys: ${shotList[0] ? Object.keys(shotList[0]).join(",") : "empty"}`
      );
      return { ok: true as const, shots: shotList };
    } catch (err) {
      lastErr = err;
      console.warn(
        `[ShotSplit] Chunk ${params.chunkIndex + 1}/${params.sceneChunksLength} attempt ${attempt} failed:`,
        err
      );
      if (invalidOutput) {
        console.warn(
          `[ShotSplit] Chunk ${params.chunkIndex + 1} invalid output preview (attempt ${attempt}, ${invalidOutput.length} chars): ${summarizeModelOutput(
            invalidOutput
          )}`
        );
      }
    }
  }

  if (invalidOutput) {
    try {
      const repair = await generateText({
        model: params.model,
        providerOptions: params.providerOptions,
        temperature: 0.2,
        maxOutputTokens: 8192,
        prompt: [
          "你是 JSON 修复器。请把下面的分镜模型输出修复成有效 JSON。",
          "允许的输出结构只有两种：",
          '1. {"shots":[{"sequence":1,"sceneDescription":"","startFrame":"","endFrame":"","motionScript":"","videoScript":"","duration":12,"dialogues":[{"character":"","text":""}],"cameraDirection":"static","transitionIn":"cut","transitionOut":"cut","compositionGuide":"","focalPoint":"","depthOfField":"medium","soundDesign":"","musicCue":"","characters":[""],"referenceImagePrompts":[""]}]}',
          '2. [{"sceneTitle":"","sceneDescription":"","shots":[{"sequence":1,"sceneDescription":"","startFrame":"","endFrame":"","motionScript":"","videoScript":"","duration":12,"dialogues":[{"character":"","text":""}],"cameraDirection":"static","transitionIn":"cut","transitionOut":"cut","compositionGuide":"","focalPoint":"","depthOfField":"medium","soundDesign":"","musicCue":"","characters":[""],"referenceImagePrompts":[""]}]}]',
          "要求：",
          "- 只输出 JSON，不要解释文字，不要 markdown 代码块",
          "- 保留原始镜头信息，不要删掉有效镜头",
          "- 如果字段缺失，用空字符串、空数组或合理默认值补齐",
          "- duration 必须是数字，且应保持在 10-14 秒区间内，dialogues 必须是数组",
          sceneCount > 0
            ? `- 当前剧本块有 ${sceneCount} 个场景，必须全部覆盖，不能只输出第一场`
            : "",
          shotCueCount > 0
            ? `- 当前剧本块有 ${shotCueCount} 个显式镜头提示，修复后镜头数不能少得离谱`
            : "",
          "",
          "待修复文本：",
          invalidOutput,
        ].join("\n"),
      });

      const repairedShots = parseShotSplitPayload(repair.text);
      const repairedCoverageIssues = validateShotCoverage(
        repairedShots,
        params.chunk,
        params.targetShotBudget,
        params.totalSceneCount
      );
      if (repairedCoverageIssues.length > 0) {
        throw new Error(repairedCoverageIssues.join("；"));
      }
      if (repairedShots.length > 0) {
        console.log(
          `[ShotSplit] Chunk ${params.chunkIndex + 1}/${params.sceneChunksLength} repaired successfully: ${repairedShots.length} shots`
        );
        return { ok: true as const, shots: repairedShots };
      }
    } catch (repairErr) {
      lastErr = repairErr;
      console.warn(
        `[ShotSplit] Chunk ${params.chunkIndex + 1}/${params.sceneChunksLength} repair failed:`,
        repairErr
      );
    }
  }

  return {
    ok: false as const,
    chunkIndex: params.chunkIndex + 1,
    error: lastErr instanceof Error ? lastErr.message : String(lastErr),
  };
}
