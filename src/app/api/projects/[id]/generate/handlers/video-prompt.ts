import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters, dialogues, episodes, projects, shots } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { getModelMaxDuration } from "@/lib/ai/model-limits";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { buildRefVideoPromptRequest } from "@/lib/ai/prompts/ref-video-prompt-generate";
import { loadShotLegacyView, loadShotLegacyViewsBatch } from "@/lib/shot-asset-utils";
import {
  extractErrorMessage,
  getEpisodeCharacters,
  isCharacterOnScreen,
} from "../helpers";
import type { ModelConfig } from "../types";

function clampSegmentDuration(duration: number): number {
  const rounded = Math.max(1, Math.round(duration || 0));
  return Math.min(5, Math.max(3, rounded));
}

function buildSegmentMotionContext(shot: {
  chainIndex?: number | null;
  chainTotal?: number | null;
  inheritPrevLastFrame?: number | null;
  videoScript?: string | null;
  motionScript?: string | null;
  prompt?: string | null;
}): string {
  const chainIndex = shot.chainIndex ?? 1;
  const chainTotal = shot.chainTotal ?? 1;
  const base = (shot.videoScript || shot.motionScript || shot.prompt || "").trim();
  if (chainTotal <= 1) return base;

  const continuityLine =
    chainIndex > 1 && shot.inheritPrevLastFrame === 1
      ? "Start exactly from the provided first-frame state and continue naturally."
      : "Establish a clean start state before motion.";
  const phase =
    chainIndex === 1
      ? "setup"
      : chainIndex === chainTotal
        ? "resolve"
        : "continuation";

  return [
    `Segment ${chainIndex}/${chainTotal} (${phase}).`,
    continuityLine,
    "Use one major movement objective only. Avoid multiple simultaneous actions.",
    base,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function handleSingleVideoPrompt(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const shotId = payload?.shotId as string;
  console.log(`[SingleVideoPrompt] called, shotId=${shotId}`);
  if (!shotId) return NextResponse.json({ error: "shotId required" }, { status: 400 });

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId)).limit(1);
  if (!shot) return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  const shotView = await loadShotLegacyView(shot.id);

  let genMode = "keyframe";
  if (shot.episodeId) {
    const [ep] = await db
      .select({ generationMode: episodes.generationMode })
      .from(episodes)
      .where(eq(episodes.id, shot.episodeId));
    genMode = ep?.generationMode ?? "keyframe";
  } else {
    const [proj] = await db
      .select({ generationMode: projects.generationMode })
      .from(projects)
      .where(eq(projects.id, projectId));
    genMode = proj?.generationMode ?? "keyframe";
  }

  const visionFrames: string[] = [];
  const sceneMetaList: Array<{ sceneName?: string } | null> = [];
  if (genMode === "reference") {
    const sceneAssets = shotView.referenceImages
      .filter((r) => r.fileUrl)
      .sort((a, b) => a.sequenceInType - b.sequenceInType);
    for (const r of sceneAssets) {
      visionFrames.push(r.fileUrl as string);
      sceneMetaList.push((r.meta as { sceneName?: string } | null) ?? null);
    }
    if (visionFrames.length === 0 && shotView.sceneRefFrame) {
      visionFrames.push(shotView.sceneRefFrame);
      sceneMetaList.push(null);
    }
  } else {
    if (shotView.firstFrame) visionFrames.push(shotView.firstFrame);
    if (shotView.lastFrame) visionFrames.push(shotView.lastFrame);
    if (visionFrames.length === 0 && shotView.sceneRefFrame) visionFrames.push(shotView.sceneRefFrame);
  }
  console.log(
    `[SingleVideoPrompt] shot.sequence=${shot.sequence}, mode=${genMode}, frames=${visionFrames.length}`
  );
  if (visionFrames.length === 0) {
    return NextResponse.json(
      { error: "No frame available. Generate frames first." },
      { status: 400 }
    );
  }

  const shotCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, shot.projectId));
  const shotDialogues = await db
    .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
    .from(dialogues)
    .where(eq(dialogues.shotId, shotId))
    .orderBy(asc(dialogues.sequence));
  const videoContextForDialogue = shot.videoScript || shot.motionScript || shot.prompt || "";

  const dialogueList = shotDialogues.map((d) => {
    const char = shotCharacters.find((c) => c.id === d.characterId);
    const characterName = char?.name ?? "Unknown";
    const onScreen = isCharacterOnScreen(
      characterName,
      videoContextForDialogue,
      shotView.startFrameDesc
    );
    const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
    return {
      characterName,
      text: d.text,
      offscreen: !onScreen,
      visualHint,
    };
  });

  try {
    const videoModelId = modelConfig?.video?.modelId;
    const videoMaxDuration = getModelMaxDuration(videoModelId);
    const preferredDuration =
      (shot.chainTotal ?? 1) > 1
        ? clampSegmentDuration(shot.duration ?? 4)
        : (shot.duration ?? 10);
    const effectiveDuration = Math.min(preferredDuration, videoMaxDuration);
    const textProvider = resolveAIProvider(modelConfig);
    const refVideoSystem = await resolvePrompt("ref_video_prompt", { userId, projectId });
    const motionContext = buildSegmentMotionContext(shot);

    const shotCharNameSetVP = new Set<string>();
    for (const r of shotView.referenceImages) {
      for (const n of r.characters ?? []) shotCharNameSetVP.add(n);
    }
    const charsWithRefsHere = shotCharacters.filter(
      (c) => !!c.referenceImage && (shotCharNameSetVP.size === 0 || shotCharNameSetVP.has(c.name))
    );
    const characterRefInfos = charsWithRefsHere.map((c, i) => ({
      name: c.name,
      index: i + 1,
      visualHint: c.visualHint,
    }));
    const sceneFrameInfos = visionFrames.map((_, i) => {
      const name = sceneMetaList[i]?.sceneName || (visionFrames.length > 1 ? `场景-${i + 1}` : "场景");
      return { label: name, index: charsWithRefsHere.length + i + 1 };
    });
    const promptRequest = buildRefVideoPromptRequest({
      motionScript: motionContext,
      cameraDirection: shot.cameraDirection || "static",
      duration: effectiveDuration,
      characters: characterRefInfos,
      sceneFrames: sceneFrameInfos,
      dialogues: dialogueList.length > 0 ? dialogueList : undefined,
    });
    console.log(`[SingleVideoPrompt] Shot ${shot.sequence} promptRequest:\n${promptRequest}`);
    const rawPrompt = await textProvider.generateText(promptRequest, {
      systemPrompt: refVideoSystem,
      images: visionFrames,
    });
    const videoPrompt = `Duration: ${effectiveDuration}s.\n\n${rawPrompt.trim()}`;
    console.log(`[SingleVideoPrompt] Shot ${shot.sequence} videoPrompt:\n${videoPrompt}`);
    await db.update(shots).set({ videoPrompt }).where(eq(shots.id, shotId));
    return NextResponse.json({ shotId, videoPrompt, status: "ok" });
  } catch (err) {
    console.error("[SingleVideoPrompt] Error:", err);
    return NextResponse.json(
      { status: "error", error: extractErrorMessage(err) },
      { status: 500 }
    );
  }
}

export async function handleBatchVideoPrompt(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  const batchVersionId = payload?.versionId as string | undefined;

  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const batchShots = await db
    .select()
    .from(shots)
    .where(and(...shotWhereConditions))
    .orderBy(asc(shots.sequence));
  const batchShotsLegacy = await loadShotLegacyViewsBatch(batchShots.map((s) => s.id));

  const batchCharacters = await getEpisodeCharacters(projectId, episodeId);

  const eligible = batchShots.filter((s) => {
    const v = batchShotsLegacy.get(s.id);
    return v?.firstFrame || v?.lastFrame || v?.sceneRefFrame;
  });

  let batchGenMode = "keyframe";
  if (episodeId) {
    const [ep] = await db
      .select({ generationMode: episodes.generationMode })
      .from(episodes)
      .where(eq(episodes.id, episodeId));
    batchGenMode = ep?.generationMode ?? "keyframe";
  } else {
    const [proj] = await db
      .select({ generationMode: projects.generationMode })
      .from(projects)
      .where(eq(projects.id, projectId));
    batchGenMode = proj?.generationMode ?? "keyframe";
  }

  const textProvider = resolveAIProvider(modelConfig);
  const refVideoSystem = await resolvePrompt("ref_video_prompt", { userId, projectId });
  const videoMaxDuration = getModelMaxDuration(modelConfig?.video?.modelId);

  console.log(
    `[BatchVideoPrompt] Processing ${eligible.length} shots (${batchShots.length} total, ${batchCharacters.length} chars, mode=${batchGenMode})`
  );
  const bvpStartTime = Date.now();

  const results = await Promise.all(
    eligible.map(async (shot) => {
      try {
        const shotLegacy = batchShotsLegacy.get(shot.id);
        const shotStart = Date.now();
        const preferredDuration =
          (shot.chainTotal ?? 1) > 1
            ? clampSegmentDuration(shot.duration ?? 4)
            : (shot.duration ?? 10);
        const effectiveDuration = Math.min(preferredDuration, videoMaxDuration);

        const visionFrames: string[] = [];
        let sceneMetaList: Array<{ sceneName?: string } | null> = [];
        if (batchGenMode === "reference") {
          const sceneAssets = (shotLegacy?.referenceImages ?? [])
            .filter((r) => r.fileUrl)
            .sort((a, b) => a.sequenceInType - b.sequenceInType);
          for (const r of sceneAssets) {
            visionFrames.push(r.fileUrl as string);
            sceneMetaList.push((r.meta as { sceneName?: string } | null) ?? null);
          }
          if (visionFrames.length === 0 && shotLegacy?.sceneRefFrame) {
            visionFrames.push(shotLegacy.sceneRefFrame);
            sceneMetaList.push(null);
          }
        } else {
          if (shotLegacy?.firstFrame) visionFrames.push(shotLegacy.firstFrame);
          if (shotLegacy?.lastFrame) visionFrames.push(shotLegacy.lastFrame);
          if (visionFrames.length === 0 && shotLegacy?.sceneRefFrame) {
            visionFrames.push(shotLegacy.sceneRefFrame);
          }
          sceneMetaList = visionFrames.map(() => null);
        }
        const shotDialogues = await db
          .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
          .from(dialogues)
          .where(eq(dialogues.shotId, shot.id))
          .orderBy(asc(dialogues.sequence));
        const videoContextForDialogue = shot.videoScript || shot.motionScript || shot.prompt || "";

        const dialogueList = shotDialogues.map((d) => {
          const char = batchCharacters.find((c) => c.id === d.characterId);
          const characterName = char?.name ?? "Unknown";
          const onScreen = isCharacterOnScreen(
            characterName,
            videoContextForDialogue,
            shotLegacy?.startFrameDesc ?? null
          );
          const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
          return {
            characterName,
            text: d.text,
            offscreen: !onScreen,
            visualHint,
          };
        });

        const motionContext = buildSegmentMotionContext(shot);
        const shotCharNameSetBVP = new Set<string>();
        for (const r of shotLegacy?.referenceImages ?? []) {
          for (const n of r.characters ?? []) shotCharNameSetBVP.add(n);
        }
        const batchCharsWithRefs = batchCharacters.filter(
          (c) => !!c.referenceImage && (shotCharNameSetBVP.size === 0 || shotCharNameSetBVP.has(c.name))
        );
        const characterRefInfos = batchCharsWithRefs.map((c, i) => ({
          name: c.name,
          index: i + 1,
          visualHint: c.visualHint,
        }));
        const sceneFrameInfos = visionFrames.map((_, i) => {
          const name = sceneMetaList[i]?.sceneName || (visionFrames.length > 1 ? `场景-${i + 1}` : "场景");
          return { label: name, index: batchCharsWithRefs.length + i + 1 };
        });
        const promptRequest = buildRefVideoPromptRequest({
          motionScript: motionContext,
          cameraDirection: shot.cameraDirection || "static",
          duration: effectiveDuration,
          characters: characterRefInfos,
          sceneFrames: sceneFrameInfos,
          dialogues: dialogueList.length > 0 ? dialogueList : undefined,
        });
        const rawPrompt = await textProvider.generateText(promptRequest, {
          systemPrompt: refVideoSystem,
          images: visionFrames,
        });
        const videoPrompt = `Duration: ${effectiveDuration}s.\n\n${rawPrompt.trim()}`;
        await db.update(shots).set({ videoPrompt }).where(eq(shots.id, shot.id));
        console.log(
          `[BatchVideoPrompt] Shot ${shot.sequence} done (${((Date.now() - shotStart) / 1000).toFixed(1)}s, ${visionFrames.length} frames)`
        );
        return { shotId: shot.id, status: "ok" };
      } catch (err) {
        console.error(`[BatchVideoPrompt] Shot ${shot.sequence} failed:`, err);
        return { shotId: shot.id, status: "error" };
      }
    })
  );

  const okCount = results.filter((r) => r.status === "ok").length;
  const errCount = results.filter((r) => r.status === "error").length;
  console.log(
    `[BatchVideoPrompt] Done: ${okCount} ok, ${errCount} errors, total ${((Date.now() - bvpStartTime) / 1000).toFixed(1)}s`
  );
  return NextResponse.json({ results, status: "ok" });
}
