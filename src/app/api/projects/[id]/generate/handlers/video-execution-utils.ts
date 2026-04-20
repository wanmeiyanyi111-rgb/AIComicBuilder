import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { dialogues, shots } from "@/lib/db/schema";
import { normalizeVideoDurationForModel } from "@/lib/ai/model-limits";
import { buildVideoPrompt } from "@/lib/ai/prompts/video-generate";
import { buildStoryboardShotResourceContext } from "@/lib/storyboard-resources";
import { assembleVideo } from "@/lib/video/ffmpeg";
import {
  appendIntentToVideoPrompt,
  buildShotIntentCard,
  evaluateVideoContinuityPreflight,
} from "@/lib/video/shot-intent";
import { insertAssetVersion } from "@/lib/shot-asset-utils";
import { isCharacterOnScreen } from "../helpers";

export function buildStoryboardSegmentPrompts(params: {
  videoPrompt: string;
  panelCount: number;
}): string[] {
  const prompts: string[] = [];
  const segmentCount = Math.max(1, Math.min(3, params.panelCount - 1));
  for (let index = 0; index < segmentCount; index += 1) {
    prompts.push(
      `Segment ${index + 1}/${segmentCount}. 从当前画面自然推进到下一格锚点，保持角色外观、场景空间、关键道具一致。 ${params.videoPrompt}`
    );
  }
  return prompts;
}

export function resolveVideoBatchConcurrency(): number {
  const raw =
    process.env.BATCH_VIDEO_CONCURRENCY || process.env.VIDEO_BATCH_CONCURRENCY;
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed)) return 2;
  return Math.min(4, Math.max(1, parsed));
}

export async function generateStoryboardModeVideo(params: {
  episodeId?: string;
  projectId: string;
  ratio: string;
  shot: any;
  shotLegacy: any;
  videoModelId?: string;
  videoPrompt: string;
  videoProvider: any;
}) {
  const panelImages = (params.shotLegacy?.storyboardPanels ?? [])
    .filter((panel: any) => !!panel.fileUrl)
    .sort((a: any, b: any) => a.sequenceInType - b.sequenceInType)
    .map((panel: any) => panel.fileUrl as string);
  if (panelImages.length < 2) {
    throw new Error("Storyboard panels not generated yet");
  }

  const storyboardResources = await buildStoryboardShotResourceContext({
    projectId: params.projectId,
    episodeId: params.episodeId,
    shot: params.shot,
  });
  const segmentPrompts = buildStoryboardSegmentPrompts({
    videoPrompt: params.videoPrompt,
    panelCount: panelImages.length,
  });
  const segmentDuration = normalizeVideoDurationForModel(params.videoModelId, 4);
  const segmentPaths: string[] = [];
  for (let index = 0; index < segmentPrompts.length; index += 1) {
    const initialImage = panelImages[index];
    const nextPanel = panelImages[Math.min(index + 1, panelImages.length - 1)];
    const segment = await params.videoProvider.generateVideo({
      initialImage,
      referenceImages: [
        nextPanel,
        ...storyboardResources.referenceImages.map((item) => item.imageUrl),
      ].filter(Boolean),
      prompt: segmentPrompts[index],
      duration: segmentDuration,
      ratio: params.ratio,
    });
    segmentPaths.push(segment.filePath);
  }
  const assembled = await assembleVideo({
    videoPaths: segmentPaths,
    subtitles: [],
    projectId: params.shot.id,
    shotDurations: segmentPaths.map(() => segmentDuration),
    transitions: segmentPaths.slice(0, -1).map(() => "cut"),
  });
  await insertAssetVersion({
    shotId: params.shot.id,
    type: "storyboard_video",
    sequenceInType: 0,
    prompt: params.videoPrompt,
    fileUrl: assembled.videoPath,
    status: "completed",
  });
  await db
    .update(shots)
    .set({ status: "completed" })
    .where(eq(shots.id, params.shot.id));

  return {
    videoUrl: assembled.videoPath,
  };
}

export async function generateKeyframeModeVideo(params: {
  directorControl: {
    actionIntensity: number;
    cameraMotion: number;
    emotionIntensity: number;
  };
  projectId: string;
  ratio: string;
  shot: any;
  shotCharacters: any[];
  shotId: string;
  shotLegacy: any;
  slotContents: Record<string, string>;
  videoModelId?: string;
  videoProvider: any;
}) {
  const effectiveDuration = normalizeVideoDurationForModel(
    params.videoModelId,
    params.shot.duration ?? 10
  );
  const shotDialogues = await db
    .select({
      text: dialogues.text,
      characterId: dialogues.characterId,
      sequence: dialogues.sequence,
    })
    .from(dialogues)
    .where(eq(dialogues.shotId, params.shotId))
    .orderBy(asc(dialogues.sequence));

  const videoScript =
    params.shot.videoScript || params.shot.motionScript || params.shot.prompt || "";
  const videoContextForDialogue = videoScript;

  const dialogueList = shotDialogues.map((d) => {
    const char = params.shotCharacters.find((c) => c.id === d.characterId);
    const characterName = char?.name ?? "Unknown";
    const onScreen = isCharacterOnScreen(
      characterName,
      videoContextForDialogue,
      params.shotLegacy.startFrameDesc ?? null
    );
    const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
    return {
      characterName,
      text: d.text,
      offscreen: !onScreen,
      visualHint,
    };
  });
  const visibleCharacterNames = params.shotCharacters
    .filter((c) =>
      isCharacterOnScreen(
        c.name,
        videoContextForDialogue,
        params.shotLegacy.startFrameDesc ?? null
      )
    )
    .map((c) => c.name);
  const baseVideoPrompt =
    params.shot.videoPrompt ||
    buildVideoPrompt({
      videoScript,
      cameraDirection: params.shot.cameraDirection || "static",
      startFrameDesc: params.shotLegacy.startFrameDesc ?? undefined,
      endFrameDesc: params.shotLegacy.endFrameDesc ?? undefined,
      duration: effectiveDuration,
      characters: params.shotCharacters,
      dialogues: dialogueList.length > 0 ? dialogueList : undefined,
      slotContents: params.slotContents,
    });
  const intentCard = buildShotIntentCard({
    shotId: params.shotId,
    sequence: params.shot.sequence,
    duration: effectiveDuration,
    mode: "keyframe",
    prompt: params.shot.prompt,
    motionScript: params.shot.motionScript,
    videoScript: params.shot.videoScript,
    cameraDirection: params.shot.cameraDirection,
    startFrameDesc: params.shotLegacy.startFrameDesc,
    endFrameDesc: params.shotLegacy.endFrameDesc,
    chainIndex: params.shot.chainIndex,
    chainTotal: params.shot.chainTotal,
    inheritPrevLastFrame: params.shot.inheritPrevLastFrame,
    characterNames: visibleCharacterNames,
    characterHints: params.shotCharacters.map((c) => ({
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
  const videoPrompt = appendIntentToVideoPrompt(baseVideoPrompt, intentCard);

  const result = await params.videoProvider.generateVideo({
    firstFrame: params.shotLegacy.firstFrame!,
    lastFrame: params.shotLegacy.lastFrame!,
    prompt: videoPrompt,
    duration: effectiveDuration,
    ratio: params.ratio,
  });

  await insertAssetVersion({
    shotId: params.shotId,
    type: "keyframe_video",
    sequenceInType: 0,
    prompt: videoPrompt,
    fileUrl: result.filePath,
    status: "completed",
  });
  await db
    .update(shots)
    .set({ status: "completed" })
    .where(eq(shots.id, params.shotId));

  return {
    preflight,
    videoPrompt,
    videoUrl: result.filePath,
  };
}
