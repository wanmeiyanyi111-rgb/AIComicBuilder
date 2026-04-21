import { NextResponse } from "next/server";
import { hasImageModelConfig, hasTextModelConfig } from "@/lib/ai/config-presence";
import { resolveAIProvider, resolveImageProvider } from "@/lib/ai/provider-factory";
import {
  buildStoryboardGridPromptRequest,
  STORYBOARD_GRID_SYSTEM_PROMPT,
} from "@/lib/ai/prompts/storyboard-grid-prompts";
import { buildStoryboardShotResourceContext } from "@/lib/storyboard-resources";
import {
  deleteAssetsByType,
  getActiveAssets,
  insertAssetVersion,
} from "@/lib/shot-asset-utils";
import {
  buildVisualStyleFromScript,
  extractErrorMessage,
  enforceFramePromptRatio,
  getScriptForScope,
  ratioToDisplayLabel,
} from "../helpers";
import type { ModelConfig } from "../types";
import { generateStoryboardPanelsForShot } from "./storyboard-image-generate";
import {
  auditStoryboardPromptPayload,
  buildStoryboardAuditRevisionHints,
} from "./storyboard-audit";
import {
  loadTargetShots,
  normalizeStoryboardDuration,
  parseStoryboardPromptPayload,
} from "./storyboard-utils";

type StoryboardShotRecord = Awaited<ReturnType<typeof loadTargetShots>>[number];

function isUpstreamStoryboardImageServiceError(error: unknown): boolean {
  const message = extractErrorMessage(error).toLowerCase();
  return (
    (message.includes("wuyin") &&
      (message.includes("create rejected (500)") || message.includes("create failed (500)"))) ||
    message.includes("转发请求失败") ||
    (message.includes("目标服务器") && message.includes("500"))
  );
}

async function generateStoryboardPromptAssetsForShot(params: {
  projectId: string;
  episodeId?: string;
  shot: StoryboardShotRecord;
  ratio: string;
  textProvider: ReturnType<typeof resolveAIProvider>;
  visualStyle: string;
}) {
  const { projectId, episodeId, shot, ratio, textProvider, visualStyle } = params;
  const resources = await buildStoryboardShotResourceContext({
    projectId,
    episodeId,
    shot,
  });
  const request = buildStoryboardGridPromptRequest({
    shot: {
      sequence: shot.sequence,
      prompt: shot.prompt || "",
      motionScript: shot.motionScript,
      videoScript: shot.videoScript,
      cameraDirection: shot.cameraDirection,
      duration: normalizeStoryboardDuration(shot.duration),
    },
    visualStyle,
    ratio: ratioToDisplayLabel(ratio),
    resourceSummary: resources.resourceSummary,
  });
  let parsed = null as ReturnType<typeof parseStoryboardPromptPayload> | null;
  let auditResult = null as ReturnType<typeof auditStoryboardPromptPayload> | null;
  let revisionHints = "";
  let attempts = 0;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    attempts = attempt + 1;
    const response = await textProvider.generateText(
      revisionHints ? `${request}\n\n修复任务：\n${revisionHints}` : request,
      {
        systemPrompt: STORYBOARD_GRID_SYSTEM_PROMPT,
        temperature: 0.4,
      }
    );
    const candidate = parseStoryboardPromptPayload(response);
    const candidateAudit = auditStoryboardPromptPayload(candidate);
    parsed = candidate;
    auditResult = candidateAudit;
    if (candidateAudit.pass || attempt === 1) {
      break;
    }
    revisionHints = buildStoryboardAuditRevisionHints(candidateAudit);
  }

  if (!parsed || !auditResult) {
    throw new Error("Storyboard prompt generation returned empty result");
  }

  await deleteAssetsByType(shot.id, "storyboard_panel");
  await deleteAssetsByType(shot.id, "storyboard_grid");
  await deleteAssetsByType(shot.id, "storyboard_video");

  for (const panel of parsed.panels) {
    await insertAssetVersion({
      shotId: shot.id,
      type: "storyboard_panel",
      sequenceInType: panel.index - 1,
      prompt: enforceFramePromptRatio(panel.prompt, ratio),
      status: "pending",
      characters: parsed.characters,
      meta: {
        storyGoal: parsed.storyGoal,
        primaryScene: parsed.primaryScene,
        progressionMode: parsed.progressionMode,
        modeRationale: parsed.modeRationale,
        sceneCount: parsed.sceneCount,
        eventCount: parsed.eventCount,
        complexityLevel: parsed.complexityLevel,
        startingAction: parsed.startingAction,
        endingAction: parsed.endingAction,
        continuityBeats: parsed.continuityBeats,
        microDynamics: parsed.microDynamics,
        continuityRules: parsed.continuityRules,
        stage: panel.stage,
        beat: panel.beat,
        panelFunction: panel.panelFunction,
        activeCharacters: panel.activeCharacters,
        forbiddenDrift: panel.forbiddenDrift,
        resultSignal: panel.resultSignal,
        cameraPlan: panel.cameraPlan,
        shotScale: panel.shotScale,
        subjectPosition: panel.subjectPosition,
        bodyFacing: panel.bodyFacing,
        gazeTarget: panel.gazeTarget,
        interactionState: panel.interactionState,
        worldLock: panel.worldLock,
        continuityGoal: panel.continuityGoal,
        mustKeep: panel.mustKeep,
        delta: panel.delta,
        continuityAuditScore: auditResult.score,
        continuityAuditPass: auditResult.pass,
        continuityAuditIssues: auditResult.issues.map((item) => item.message),
        continuityAuditAttempts: attempts,
        panelIndex: panel.index,
        workflow: "storyboard_grid",
      },
    });
  }

  return {
    attempts,
    score: auditResult.score,
    pass: auditResult.pass,
    issues: auditResult.issues.map((item) => item.message),
  };
}

async function ensureStoryboardPromptsReadyForShot(params: {
  projectId: string;
  episodeId?: string;
  shot: StoryboardShotRecord;
  ratio: string;
  modelConfig?: ModelConfig;
  textProvider?: ReturnType<typeof resolveAIProvider>;
  visualStyle?: string;
}) {
  const { shot, modelConfig } = params;
  const panelAssets = await getActiveAssets(shot.id, "storyboard_panel");
  const promptReady =
    panelAssets.length >= 4 &&
    panelAssets.every((panel) => panel.meta?.continuityAuditPass === true);
  if (promptReady) {
    const score =
      typeof panelAssets[0]?.meta?.continuityAuditScore === "number"
        ? panelAssets[0].meta.continuityAuditScore
        : 100;
    return { repaired: false, score, pass: true, issues: [] as string[] };
  }
  if (!hasTextModelConfig(modelConfig)) {
    throw new Error("Storyboard prompts missing or failed continuity audit, and no text model is configured for auto-repair.");
  }
  const textProvider = params.textProvider ?? resolveAIProvider(modelConfig);
  const script = await getScriptForScope(params.projectId, params.episodeId);
  const visualStyle = params.visualStyle ?? buildVisualStyleFromScript(script);
  const result = await generateStoryboardPromptAssetsForShot({
    projectId: params.projectId,
    episodeId: params.episodeId,
    shot,
    ratio: params.ratio,
    textProvider,
    visualStyle,
  });
  return { repaired: true, ...result };
}

export async function handleGenerateStoryboardPrompts(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!hasTextModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No text model configured" }, { status: 400 });
  }

  const versionId = typeof payload?.versionId === "string" ? payload.versionId : undefined;
  const ratio = typeof payload?.ratio === "string" ? payload.ratio : "16:9";
  const allShots = await loadTargetShots(projectId, episodeId, versionId);
  const requestedShotIds = [
    ...(Array.isArray(payload?.shotIds)
      ? payload?.shotIds.map((value) => String(value || "").trim()).filter(Boolean)
      : []),
    ...(typeof payload?.shotId === "string" && payload.shotId.trim()
      ? [payload.shotId.trim()]
      : []),
  ];
  const targetShots = allShots.filter(
    (shot) => requestedShotIds.length === 0 || requestedShotIds.includes(shot.id)
  );
  if (targetShots.length === 0) {
    return NextResponse.json({ error: "No shots found" }, { status: 400 });
  }

  const textProvider = resolveAIProvider(modelConfig);
  const script = await getScriptForScope(projectId, episodeId);
  const visualStyle = buildVisualStyleFromScript(script);
  let updatedCount = 0;
  const failed: Array<{ shotId: string; sequence: number; error: string }> = [];
  const audited: Array<{
    shotId: string;
    sequence: number;
    attempts: number;
    score: number;
    pass: boolean;
    issues: string[];
  }> = [];

  for (const shot of targetShots) {
    try {
      const promptResult = await generateStoryboardPromptAssetsForShot({
        projectId,
        episodeId,
        shot,
        ratio,
        textProvider,
        visualStyle,
      });
      audited.push({
        shotId: shot.id,
        sequence: shot.sequence,
        attempts: promptResult.attempts,
        score: promptResult.score,
        pass: promptResult.pass,
        issues: promptResult.issues,
      });
      updatedCount += 1;
    } catch (error) {
      failed.push({
        shotId: shot.id,
        sequence: shot.sequence,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({
    updatedCount,
    totalShots: targetShots.length,
    audited,
    failed,
  });
}

export async function handleBatchStoryboardGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!hasImageModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const versionId = typeof payload?.versionId === "string" ? payload.versionId : undefined;
  const requestedShotIds = Array.isArray(payload?.shotIds)
    ? payload.shotIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const ratio = typeof payload?.ratio === "string" ? payload.ratio : "16:9";
  const overwrite = payload?.overwrite === true;
  const allShots = await loadTargetShots(projectId, episodeId, versionId);
  const targetShots = allShots.filter(
    (shot) => requestedShotIds.length === 0 || requestedShotIds.includes(shot.id)
  );

  const results = [];
  const failed: Array<{ shotId: string; sequence: number; error: string }> = [];
  let aborted = false;
  let abortReason: string | null = null;
  const textProvider = hasTextModelConfig(modelConfig)
    ? resolveAIProvider(modelConfig)
    : undefined;
  const visualStyle = hasTextModelConfig(modelConfig)
    ? buildVisualStyleFromScript(await getScriptForScope(projectId, episodeId))
    : undefined;
  for (const shot of targetShots) {
    try {
      await ensureStoryboardPromptsReadyForShot({
        projectId,
        episodeId,
        shot,
        ratio,
        modelConfig,
        textProvider,
        visualStyle,
      });
      results.push(
        await generateStoryboardPanelsForShot({
          projectId,
          userId,
          shotId: shot.id,
          ratio,
          overwrite,
          modelConfig,
          episodeId,
          versionId,
        })
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failed.push({
        shotId: shot.id,
        sequence: shot.sequence,
        error: detail,
      });
      if (isUpstreamStoryboardImageServiceError(error)) {
        aborted = true;
        abortReason =
          "上游生图服务当前返回 500，批量四宫格已提前中止。请稍后重试，或先切换/检查图片模型服务。";
        break;
      }
    }
  }

  return NextResponse.json({ results, failed, aborted, abortReason });
}

export async function handleSingleStoryboardGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!hasImageModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }
  const shotId = typeof payload?.shotId === "string" ? payload.shotId : "";
  if (!shotId) {
    return NextResponse.json({ error: "Missing shotId" }, { status: 400 });
  }
  try {
    const ratio = typeof payload?.ratio === "string" ? payload.ratio : "16:9";
    const versionId = typeof payload?.versionId === "string" ? payload.versionId : undefined;
    const allShots = await loadTargetShots(projectId, episodeId, versionId);
    const shot = allShots.find((item) => item.id === shotId);
    if (!shot) {
      return NextResponse.json({ error: "Shot not found" }, { status: 404 });
    }
    await ensureStoryboardPromptsReadyForShot({
      projectId,
      episodeId,
      shot,
      ratio,
      modelConfig,
    });
    const result = await generateStoryboardPanelsForShot({
      projectId,
      userId,
      shotId,
      ratio,
      overwrite: payload?.overwrite === true,
      modelConfig,
      episodeId,
      versionId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
