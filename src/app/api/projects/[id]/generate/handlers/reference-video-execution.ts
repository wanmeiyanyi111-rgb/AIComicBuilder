import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { dialogues, shots } from "@/lib/db/schema";
import { normalizeVideoDurationForModel } from "@/lib/ai/model-limits";
import { resolvePrompt, resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { buildReferenceVideoPrompt } from "@/lib/ai/prompts/video-generate";
import { buildRefVideoPromptRequest } from "@/lib/ai/prompts/ref-video-prompt-generate";
import {
  appendIntentToVideoPrompt,
  buildShotIntentCard,
  evaluateVideoContinuityPreflight,
} from "@/lib/video/shot-intent";
import { insertAssetVersion } from "@/lib/shot-asset-utils";
import { isCharacterOnScreen } from "../helpers";
import type { ModelConfig } from "../types";

export async function buildReferenceVideoExecutionInput(params: {
  projectCharacters: any[];
  shot: any;
  shotId: string;
  shotView: any;
}) {
  const shotCharNameSet = new Set<string>();
  for (const r of params.shotView.referenceImages) {
    for (const n of r.characters ?? []) shotCharNameSet.add(n);
  }

  const charRefs = params.projectCharacters
    .filter((c) => !!c.referenceImage && (shotCharNameSet.size === 0 || shotCharNameSet.has(c.name)))
    .map((c) => ({ name: c.name, imagePath: c.referenceImage as string }));

  const shotDialogues = await db
    .select({
      text: dialogues.text,
      characterId: dialogues.characterId,
      sequence: dialogues.sequence,
    })
    .from(dialogues)
    .where(eq(dialogues.shotId, params.shotId))
    .orderBy(asc(dialogues.sequence));
  const videoContextForDialogue =
    params.shot.motionScript || params.shot.videoScript || params.shot.prompt || "";

  const dialogueList = shotDialogues.map((d) => {
    const char = params.projectCharacters.find((c) => c.id === d.characterId);
    const characterName = char?.name ?? "Unknown";
    const onScreen = isCharacterOnScreen(
      characterName,
      videoContextForDialogue,
      params.shotView.startFrameDesc
    );
    const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
    return {
      characterName,
      text: d.text,
      offscreen: !onScreen,
      visualHint,
    };
  });

  const sceneFramePaths: string[] = params.shotView.referenceImages
    .filter((r: any) => r.fileUrl)
    .sort((a: any, b: any) => a.sequenceInType - b.sequenceInType)
    .map((r: any) => r.fileUrl as string);

  if (sceneFramePaths.length === 0) {
    throw new Error("No scene reference images. Please generate scene reference images first.");
  }

  const orderedRefImages: string[] = [
    ...charRefs.map((c) => c.imagePath),
    ...sceneFramePaths,
  ];
  const characterRefInfos = charRefs.map((c, i) => ({
    name: c.name,
    index: i + 1,
    visualHint: params.projectCharacters.find((pc) => pc.name === c.name)?.visualHint,
  }));
  const sceneAssetList = params.shotView.referenceImages
    .filter((r: any) => r.fileUrl)
    .sort((a: any, b: any) => a.sequenceInType - b.sequenceInType);
  const sceneFrameInfos = sceneFramePaths.map((_, i) => {
    const metaObj = sceneAssetList[i]?.meta as { sceneName?: string } | null;
    const name =
      metaObj?.sceneName || (sceneFramePaths.length > 1 ? `场景-${i + 1}` : "场景");
    return { label: name, index: charRefs.length + i + 1 };
  });
  const fullMapping = [
    ...characterRefInfos.map((c) => `@图片${c.index}是${c.name}`),
    ...sceneFrameInfos.map((s) => `@图片${s.index}是${s.label}`),
  ].join("，") + "。";

  return {
    charRefs,
    characterRefInfos,
    dialogueList,
    fullMapping,
    orderedRefImages,
    sceneFrameInfos,
    sceneFramePaths,
  };
}

export async function buildReferenceVideoPromptValue(params: {
  effectiveDuration: number;
  projectCharacters: any[];
  projectId: string;
  sceneFrameInfos: Array<{ label: string; index: number }>;
  sceneFramePaths: string[];
  shot: any;
  dialogueList: Array<{
    characterName: string;
    text: string;
    offscreen: boolean;
    visualHint?: string;
  }>;
  characterRefInfos: Array<{ name: string; index: number; visualHint?: string }>;
  fullMapping: string;
  textProvider: any;
  userId: string;
}) {
  if (params.shot.videoPrompt) {
    return params.shot.videoPrompt.includes("图像映射")
      ? params.shot.videoPrompt
      : `图像映射：${params.fullMapping}。\n\n${params.shot.videoPrompt}`;
  }

  const refVideoSystem = await resolvePrompt("ref_video_prompt", {
    userId: params.userId,
    projectId: params.projectId,
  });
  try {
    const motionContext =
      params.shot.motionScript || params.shot.videoScript || params.shot.prompt || "";
    const promptRequest = buildRefVideoPromptRequest({
      motionScript: motionContext,
      cameraDirection: params.shot.cameraDirection || "static",
      duration: params.effectiveDuration,
      characters: params.characterRefInfos,
      sceneFrames: params.sceneFrameInfos,
      dialogues: params.dialogueList.length > 0 ? params.dialogueList : undefined,
    });
    const rawPrompt = await params.textProvider.generateText(promptRequest, {
      systemPrompt: refVideoSystem,
      images: params.sceneFramePaths,
      temperature: 0.7,
    });
    return `Duration: ${params.effectiveDuration}s.\n\n${rawPrompt.trim()}`;
  } catch (err) {
    console.warn("[ReferenceVideo] Vision prompt generation failed, falling back:", err);
    const refVideoSlots = await resolveSlotContents("ref_video_generate", {
      userId: params.userId,
      projectId: params.projectId,
    });
    const fallback = buildReferenceVideoPrompt({
      videoScript:
        params.shot.videoScript || params.shot.motionScript || params.shot.prompt || "",
      cameraDirection: params.shot.cameraDirection || "static",
      duration: params.effectiveDuration,
      characters: params.projectCharacters,
      dialogues: params.dialogueList.length > 0 ? params.dialogueList : undefined,
      slotContents: refVideoSlots,
    });
    return `图像映射：${params.fullMapping}。\n\n${fallback}`;
  }
}

export async function executeReferenceVideoGeneration(params: {
  directorControl: {
    actionIntensity: number;
    cameraMotion: number;
    emotionIntensity: number;
  };
  modelConfig?: ModelConfig;
  projectCharacters: any[];
  projectId: string;
  ratio: string;
  shot: any;
  shotId: string;
  shotView: any;
  textProvider: any;
  userId: string;
  videoProvider: any;
}) {
  const input = await buildReferenceVideoExecutionInput({
    projectCharacters: params.projectCharacters,
    shot: params.shot,
    shotId: params.shotId,
    shotView: params.shotView,
  });
  const videoModelId = params.modelConfig?.video?.modelId;
  const effectiveDuration = normalizeVideoDurationForModel(
    videoModelId,
    params.shot.duration ?? 10
  );
  let videoPrompt = await buildReferenceVideoPromptValue({
    characterRefInfos: input.characterRefInfos,
    dialogueList: input.dialogueList,
    effectiveDuration,
    fullMapping: input.fullMapping,
    projectCharacters: params.projectCharacters,
    projectId: params.projectId,
    sceneFrameInfos: input.sceneFrameInfos,
    sceneFramePaths: input.sceneFramePaths,
    shot: params.shot,
    textProvider: params.textProvider,
    userId: params.userId,
  });

  const visibleCharacterNames = Array.from(
    new Set([
      ...input.charRefs.map((c) => c.name),
      ...input.dialogueList
        .filter((d) => !d.offscreen)
        .map((d) => d.characterName)
        .filter((name) => name && name !== "Unknown"),
    ])
  );
  const intentCard = buildShotIntentCard({
    shotId: params.shotId,
    sequence: params.shot.sequence,
    duration: effectiveDuration,
    mode: "reference",
    prompt: params.shot.prompt,
    motionScript: params.shot.motionScript,
    videoScript: params.shot.videoScript,
    cameraDirection: params.shot.cameraDirection,
    startFrameDesc: params.shotView.startFrameDesc,
    endFrameDesc: params.shotView.endFrameDesc,
    chainIndex: params.shot.chainIndex,
    chainTotal: params.shot.chainTotal,
    inheritPrevLastFrame: params.shot.inheritPrevLastFrame,
    hasReferenceImages: input.sceneFramePaths.length > 0,
    characterNames: visibleCharacterNames,
    characterHints: params.projectCharacters.map((c) => ({
      name: c.name,
      visualHint: c.visualHint,
    })),
    directorControl: params.directorControl,
  });
  const preflight = evaluateVideoContinuityPreflight(intentCard);
  if (!preflight.pass) {
    throw new Error(
      `[VideoPreflight] ${preflight.summary} 问题：${preflight.issues.join("；")}。建议：${preflight.suggestions.join("；")}`
    );
  }
  videoPrompt = appendIntentToVideoPrompt(videoPrompt, intentCard);

  const result = await params.videoProvider.generateVideo({
    initialImage: input.sceneFramePaths[0],
    prompt: videoPrompt,
    duration: effectiveDuration,
    ratio: params.ratio,
    referenceImages: input.orderedRefImages,
  });

  await insertAssetVersion({
    shotId: params.shotId,
    type: "reference_video",
    sequenceInType: 0,
    prompt: videoPrompt,
    fileUrl: result.filePath,
    status: "completed",
    meta: result.lastFrameUrl ? { lastFrameUrl: result.lastFrameUrl } : null,
  });
  await db.update(shots).set({ status: "completed" }).where(eq(shots.id, params.shotId));

  return {
    effectiveDuration,
    orderedRefImages: input.orderedRefImages,
    referenceVideoUrl: result.filePath,
    sceneFramePaths: input.sceneFramePaths,
    videoPrompt,
  };
}
