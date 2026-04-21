import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { dialogues } from "@/lib/db/schema";
import { normalizeVideoDurationForModel } from "@/lib/ai/model-limits";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { buildRefVideoPromptRequest } from "@/lib/ai/prompts/ref-video-prompt-generate";
import { buildStoryboardShotResourceContext } from "@/lib/storyboard-resources";
import { buildShotIntentCard } from "@/lib/video/shot-intent";
import {
  enforceVideoPromptRatio,
  isCharacterOnScreen,
  ratioToDisplayLabel,
  stripAspectRatioMentions,
} from "../helpers";
import type { ModelConfig } from "../types";
import {
  KEYFRAME_VIDEO_PROMPT_SYSTEM,
  STORYBOARD_VIDEO_PROMPT_SYSTEM,
  buildAuditRevisionHints,
  buildKeyframePromptModelRequest,
  buildStoryboardVideoPromptModelRequest,
  clampSegmentDuration,
  ensureDialogueCoverage,
  ensureDurationPrefix,
  getPanelContinuityRules,
  getPanelMetaNumber,
  getPanelMetaString,
  getPanelMetaStringArray,
  sanitizeKeyframeModelOutput,
  sanitizeModelPrompt,
} from "./video-prompt-builders";

type GenerationMode = "storyboard_grid" | "reference" | "keyframe";

function normalizeHandlerGenerationMode(mode: string): GenerationMode {
  return mode === "reference" || mode === "storyboard_grid" ? mode : "keyframe";
}

export async function buildVideoPromptForShot(params: {
  directorControl: {
    actionIntensity: number;
    cameraMotion: number;
    emotionIntensity: number;
  };
  episodeId?: string;
  generationMode: string;
  modelConfig?: ModelConfig;
  projectId: string;
  ratio: string;
  shot: any;
  shotCharacters: any[];
  shotLegacy: any;
  textProvider: any;
  userId: string;
  auditPayload?: Record<string, unknown>;
}) {
  const genMode = normalizeHandlerGenerationMode(params.generationMode);
  const auditHints = buildAuditRevisionHints(params.auditPayload);
  const ratioLabel = ratioToDisplayLabel(params.ratio);
  const visionFrames: string[] = [];
  const sceneMetaList: Array<{ sceneName?: string } | null> = [];
  const storyboardPanelPrompts = (params.shotLegacy?.storyboardPanels ?? [])
    .sort((a: any, b: any) => a.sequenceInType - b.sequenceInType)
    .map((panel: any) => stripAspectRatioMentions(panel.prompt || ""))
    .filter((prompt: string) => prompt.trim().length > 0);

  if (genMode === "reference") {
    const sceneAssets = (params.shotLegacy?.referenceImages ?? [])
      .filter((r: any) => r.fileUrl)
      .sort((a: any, b: any) => a.sequenceInType - b.sequenceInType);
    for (const r of sceneAssets) {
      visionFrames.push(r.fileUrl as string);
      sceneMetaList.push((r.meta as { sceneName?: string } | null) ?? null);
    }
    if (visionFrames.length === 0 && params.shotLegacy?.sceneRefFrame) {
      visionFrames.push(params.shotLegacy.sceneRefFrame);
      sceneMetaList.push(null);
    }
  } else if (genMode === "storyboard_grid") {
    if (params.shotLegacy?.storyboardGrid?.fileUrl) {
      visionFrames.push(params.shotLegacy.storyboardGrid.fileUrl);
    }
    for (const panel of params.shotLegacy?.storyboardPanels ?? []) {
      if (panel.fileUrl) visionFrames.push(panel.fileUrl);
    }
  } else {
    if (params.shotLegacy?.firstFrame) visionFrames.push(params.shotLegacy.firstFrame);
    if (params.shotLegacy?.lastFrame) visionFrames.push(params.shotLegacy.lastFrame);
    if (visionFrames.length === 0 && params.shotLegacy?.sceneRefFrame) {
      visionFrames.push(params.shotLegacy.sceneRefFrame);
    }
  }

  if (genMode === "reference" && visionFrames.length === 0) {
    throw new Error("No frame available. Generate frames first.");
  }
  if (genMode === "storyboard_grid" && storyboardPanelPrompts.length < 4) {
    throw new Error("No storyboard panel prompts found. Please generate prompts first.");
  }

  const shotDialogues = await db
    .select({
      text: dialogues.text,
      characterId: dialogues.characterId,
      sequence: dialogues.sequence,
    })
    .from(dialogues)
    .where(eq(dialogues.shotId, params.shot.id))
    .orderBy(asc(dialogues.sequence));
  const videoContextForDialogue =
    params.shot.videoScript || params.shot.motionScript || params.shot.prompt || "";

  const dialogueList = shotDialogues.map((d) => {
    const char = params.shotCharacters.find((c) => c.id === d.characterId);
    const characterName = char?.name ?? "Unknown";
    const onScreen = isCharacterOnScreen(
      characterName,
      videoContextForDialogue,
      params.shotLegacy?.startFrameDesc ?? null
    );
    const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
    return {
      characterName,
      text: d.text,
      offscreen: !onScreen,
      visualHint,
    };
  });

  const videoModelId = params.modelConfig?.video?.modelId;
  const preferredDuration =
    (params.shot.chainTotal ?? 1) > 1
      ? clampSegmentDuration(params.shot.duration ?? 4)
      : (params.shot.duration ?? 10);
  const effectiveDuration = normalizeVideoDurationForModel(
    videoModelId,
    preferredDuration
  );

  const visibleCharacterNames = Array.from(
    new Set([
      ...params.shotCharacters
        .filter((c) =>
          isCharacterOnScreen(
            c.name,
            videoContextForDialogue,
            params.shotLegacy?.startFrameDesc ?? null
          )
        )
        .map((c) => c.name),
      ...dialogueList
        .filter((d) => !d.offscreen)
        .map((d) => d.characterName)
        .filter((name) => name && name !== "Unknown"),
    ])
  );

  const intentCard = buildShotIntentCard({
    shotId: params.shot.id,
    sequence: params.shot.sequence,
    duration: effectiveDuration,
    mode: genMode === "reference" ? "reference" : genMode,
    prompt: params.shot.prompt,
    motionScript: params.shot.motionScript,
    videoScript: params.shot.videoScript,
    cameraDirection: params.shot.cameraDirection,
    startFrameDesc: params.shotLegacy?.startFrameDesc,
    endFrameDesc: params.shotLegacy?.endFrameDesc,
    panelPrompts: storyboardPanelPrompts,
    chainIndex: params.shot.chainIndex,
    chainTotal: params.shot.chainTotal,
    inheritPrevLastFrame: params.shot.inheritPrevLastFrame,
    hasReferenceImages: visionFrames.length > 0,
    characterNames: visibleCharacterNames,
    characterHints: params.shotCharacters.map((c) => ({
      name: c.name,
      visualHint: c.visualHint,
    })),
    directorControl: params.directorControl,
  });

  let videoPrompt = "";

  if (genMode === "storyboard_grid") {
    const resources = await buildStoryboardShotResourceContext({
      projectId: params.projectId,
      episodeId: params.episodeId,
      shot: params.shot,
    });
    const commonMeta = params.shotLegacy?.storyboardPanels?.[0]?.meta || null;
    const panels = (params.shotLegacy?.storyboardPanels ?? [])
      .slice(0, 4)
      .map((panel: any) => ({
        index: panel.sequenceInType + 1,
        stage:
          typeof panel.meta?.stage === "string" ? String(panel.meta.stage) : undefined,
        beat:
          typeof panel.meta?.beat === "string" ? String(panel.meta.beat) : undefined,
        mustKeep: getPanelMetaStringArray(panel.meta, "mustKeep"),
        delta:
          typeof panel.meta?.delta === "string" ? String(panel.meta.delta) : undefined,
        prompt: stripAspectRatioMentions(panel.prompt),
      }));
    const request = buildStoryboardVideoPromptModelRequest({
      duration: effectiveDuration,
      ratioLabel,
      cameraDirection: params.shot.cameraDirection || "static",
      storyGoal: getPanelMetaString(commonMeta, "storyGoal"),
      primaryScene: getPanelMetaString(commonMeta, "primaryScene"),
      sceneCount: getPanelMetaNumber(commonMeta, "sceneCount"),
      eventCount: getPanelMetaNumber(commonMeta, "eventCount"),
      complexityLevel: getPanelMetaString(commonMeta, "complexityLevel"),
      startingAction: getPanelMetaString(commonMeta, "startingAction"),
      endingAction: getPanelMetaString(commonMeta, "endingAction"),
      continuityBeats: getPanelMetaStringArray(commonMeta, "continuityBeats"),
      microDynamics: getPanelMetaStringArray(commonMeta, "microDynamics"),
      continuityRules: getPanelContinuityRules(commonMeta),
      panels,
      resourceSummary: resources.resourceSummary,
      dialogues: dialogueList.length > 0 ? dialogueList : undefined,
      directorControl: params.directorControl,
      auditHints,
    });
    const rawPrompt = await params.textProvider.generateText(request, {
      systemPrompt: STORYBOARD_VIDEO_PROMPT_SYSTEM,
      ...(visionFrames.length > 0 ? { images: visionFrames } : {}),
    });
    videoPrompt = ensureDurationPrefix(
      ensureDialogueCoverage({
        dialogues: dialogueList,
        mode: "storyboard_grid",
        prompt: enforceVideoPromptRatio(sanitizeModelPrompt(rawPrompt), params.ratio),
      }),
      effectiveDuration
    );
  } else if (genMode === "reference") {
    const refVideoSystem = await resolvePrompt("ref_video_prompt", {
      userId: params.userId,
      projectId: params.projectId,
    });
    const shotCharNameSet = new Set<string>();
    for (const r of params.shotLegacy?.referenceImages ?? []) {
      for (const n of r.characters ?? []) shotCharNameSet.add(n);
    }
    const charsWithRefs = params.shotCharacters.filter(
      (c) => !!c.referenceImage && (shotCharNameSet.size === 0 || shotCharNameSet.has(c.name))
    );
    const characterRefInfos = charsWithRefs.map((c, i) => ({
      name: c.name,
      index: i + 1,
      visualHint: c.visualHint,
    }));
    const sceneFrameInfos = visionFrames.map((_, i) => {
      const name =
        sceneMetaList[i]?.sceneName || (visionFrames.length > 1 ? `场景-${i + 1}` : "场景");
      return { label: name, index: charsWithRefs.length + i + 1 };
    });
    const promptRequest = buildRefVideoPromptRequest({
      motionScript: videoContextForDialogue,
      cameraDirection: params.shot.cameraDirection || "static",
      duration: effectiveDuration,
      characters: characterRefInfos,
      sceneFrames: sceneFrameInfos,
      dialogues: dialogueList.length > 0 ? dialogueList : undefined,
    });
    const finalPromptRequest = auditHints
      ? `${promptRequest}\n\nAI修复任务：\n${auditHints}`
      : promptRequest;
    const rawPrompt = await params.textProvider.generateText(finalPromptRequest, {
      systemPrompt: refVideoSystem,
      images: visionFrames,
    });
    videoPrompt = ensureDurationPrefix(
      ensureDialogueCoverage({
        dialogues: dialogueList,
        mode: "reference",
        prompt: enforceVideoPromptRatio(sanitizeModelPrompt(rawPrompt), params.ratio),
      }),
      effectiveDuration
    );
  } else {
    const modelRequest = buildKeyframePromptModelRequest({
      duration: effectiveDuration,
      cameraDirection: params.shot.cameraDirection || "static",
      motionScript: videoContextForDialogue,
      startFrameDesc: params.shotLegacy?.startFrameDesc,
      endFrameDesc: params.shotLegacy?.endFrameDesc,
      actionIntensity: intentCard.directorControl.actionIntensity,
      cameraMotion: intentCard.directorControl.cameraMotion,
      emotionIntensity: intentCard.directorControl.emotionIntensity,
      maxPrimaryActions: intentCard.motionBudget.maxPrimaryActions,
      maxCameraMoves: intentCard.motionBudget.maxCameraMoves,
      dialogues: dialogueList.length > 0 ? dialogueList : undefined,
      auditHints,
    });
    const rawPrompt = await params.textProvider.generateText(modelRequest, {
      systemPrompt: KEYFRAME_VIDEO_PROMPT_SYSTEM,
      images: visionFrames,
    });
    const cleaned = sanitizeKeyframeModelOutput(rawPrompt);
    if (!cleaned || cleaned.includes("@图片") || cleaned.includes("写作要点")) {
      throw new Error("invalid keyframe prompt output");
    }
    videoPrompt = ensureDurationPrefix(
      ensureDialogueCoverage({
        dialogues: dialogueList,
        mode: "keyframe",
        prompt: enforceVideoPromptRatio(cleaned, params.ratio),
      }),
      effectiveDuration
    );
  }

  return {
    dialogueList,
    effectiveDuration,
    genMode,
    intentCard,
    storyboardPanelPrompts,
    videoPrompt,
    visionFrames,
  };
}
