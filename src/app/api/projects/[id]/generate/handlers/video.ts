import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters, dialogues, shots } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { hasVideoModelConfig } from "@/lib/ai/config-presence";
import { resolveVideoProvider } from "@/lib/ai/provider-factory";
import { getModelMaxDuration } from "@/lib/ai/model-limits";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { buildVideoPrompt } from "@/lib/ai/prompts/video-generate";
import {
  insertAssetVersion,
  loadShotLegacyView,
  loadShotLegacyViewsBatch,
} from "@/lib/shot-asset-utils";
import {
  extractErrorMessage,
  getEpisodeCharacters,
  getVersionedUploadDir,
  isCharacterOnScreen,
} from "../helpers";
import type { ModelConfig } from "../types";

const DEFAULT_VIDEO_BATCH_CONCURRENCY = 2;
const MAX_VIDEO_BATCH_CONCURRENCY = 4;

function resolveVideoBatchConcurrency(): number {
  const raw =
    process.env.BATCH_VIDEO_CONCURRENCY || process.env.VIDEO_BATCH_CONCURRENCY;
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_VIDEO_BATCH_CONCURRENCY;
  return Math.min(MAX_VIDEO_BATCH_CONCURRENCY, Math.max(1, parsed));
}

export async function handleBatchVideoGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!hasVideoModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }

  const batchVersionId = payload?.versionId as string | undefined;
  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const allShots = await db
    .select()
    .from(shots)
    .where(and(...shotWhereConditions))
    .orderBy(asc(shots.sequence));

  const versionedUploadDir = batchVersionId
    ? await getVersionedUploadDir(batchVersionId)
    : process.env.UPLOAD_DIR || "./uploads";

  const overwrite = payload?.overwrite === true;
  const allShotsLegacy = await loadShotLegacyViewsBatch(allShots.map((s) => s.id));
  const eligible = allShots.filter((s) => {
    const v = allShotsLegacy.get(s.id);
    return v?.firstFrame && v?.lastFrame && (overwrite || !v?.videoUrl);
  });
  if (eligible.length === 0) {
    return NextResponse.json({ results: [], message: "No eligible shots" });
  }

  const batchCharacters = await getEpisodeCharacters(projectId, episodeId);

  const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);
  const ratio = (payload?.ratio as string) || "16:9";
  const videoMaxDuration = getModelMaxDuration(modelConfig?.video?.modelId);
  const videoSlots = await resolveSlotContents("video_generate", { userId, projectId });

  await Promise.all(
    eligible.map((shot) =>
      db.update(shots).set({ status: "generating" }).where(eq(shots.id, shot.id))
    )
  );

  type BatchVideoResult = {
    shotId: string;
    sequence: number;
    status: "ok" | "error";
    videoUrl?: string;
    error?: string;
  };

  const processShot = async (shot: (typeof eligible)[number]): Promise<BatchVideoResult> => {
    try {
      const shotLegacy = allShotsLegacy.get(shot.id);
      const effectiveDuration = Math.min(shot.duration ?? 10, videoMaxDuration);
      const shotDialogues = await db
        .select({
          text: dialogues.text,
          characterId: dialogues.characterId,
          sequence: dialogues.sequence,
        })
        .from(dialogues)
        .where(eq(dialogues.shotId, shot.id))
        .orderBy(asc(dialogues.sequence));

      const videoScript = shot.videoScript || shot.motionScript || shot.prompt || "";
      const videoContextForDialogue = videoScript;

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

      const videoPrompt =
        shot.videoPrompt ||
        buildVideoPrompt({
          videoScript,
          cameraDirection: shot.cameraDirection || "static",
          startFrameDesc: shotLegacy?.startFrameDesc ?? undefined,
          endFrameDesc: shotLegacy?.endFrameDesc ?? undefined,
          duration: effectiveDuration,
          characters: batchCharacters,
          dialogues: dialogueList.length > 0 ? dialogueList : undefined,
          slotContents: videoSlots,
        });

      const result = await videoProvider.generateVideo({
        firstFrame: shotLegacy!.firstFrame!,
        lastFrame: shotLegacy!.lastFrame!,
        prompt: videoPrompt,
        duration: effectiveDuration,
        ratio,
      });

      await insertAssetVersion({
        shotId: shot.id,
        type: "keyframe_video",
        sequenceInType: 0,
        prompt: videoPrompt,
        fileUrl: result.filePath,
        status: "completed",
      });
      await db
        .update(shots)
        .set({ status: "completed" })
        .where(eq(shots.id, shot.id));

      console.log(`[BatchVideoGenerate] Shot ${shot.sequence} completed`);
      return {
        shotId: shot.id,
        sequence: shot.sequence,
        status: "ok",
        videoUrl: result.filePath,
      };
    } catch (err) {
      console.error(`[BatchVideoGenerate] Error for shot ${shot.sequence}:`, err);
      await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shot.id));
      return {
        shotId: shot.id,
        sequence: shot.sequence,
        status: "error",
        error: extractErrorMessage(err),
      };
    }
  };

  const concurrency = resolveVideoBatchConcurrency();
  console.log(
    `[BatchVideoGenerate] Eligible: ${eligible.length}, concurrency=${concurrency}`
  );
  const queue = eligible.map((_, index) => index);
  const resultByIndex: Array<BatchVideoResult | null> = new Array(eligible.length).fill(
    null
  );
  const workerCount = Math.min(concurrency, eligible.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = queue.shift();
        if (index === undefined) break;
        resultByIndex[index] = await processShot(eligible[index]);
      }
    })
  );

  const results = resultByIndex.filter((item): item is BatchVideoResult => item !== null);

  return NextResponse.json({ results });
}

export async function handleSingleVideoGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const shotId = payload?.shotId as string;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!hasVideoModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }
  const shotView = await loadShotLegacyView(shot.id);
  if (!shotView.firstFrame || !shotView.lastFrame) {
    return NextResponse.json({ error: "Shot frames not generated yet" }, { status: 400 });
  }

  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);
  const shotCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, shot.projectId));

  const shotDialogues = await db
    .select({
      text: dialogues.text,
      characterId: dialogues.characterId,
      sequence: dialogues.sequence,
    })
    .from(dialogues)
    .where(eq(dialogues.shotId, shotId))
    .orderBy(asc(dialogues.sequence));

  const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);
  const videoSlots = await resolveSlotContents("video_generate", { userId, projectId });

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    const ratio = (payload?.ratio as string) || "16:9";
    const videoModelId = modelConfig?.video?.modelId;
    const videoMaxDuration = getModelMaxDuration(videoModelId);
    const effectiveDuration = Math.min(shot.duration ?? 10, videoMaxDuration);

    const videoScript = shot.videoScript || shot.motionScript || shot.prompt || "";
    const videoContextForDialogue = videoScript;

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
    const videoPrompt =
      shot.videoPrompt ||
      buildVideoPrompt({
        videoScript,
        cameraDirection: shot.cameraDirection || "static",
        startFrameDesc: shotView.startFrameDesc ?? undefined,
        endFrameDesc: shotView.endFrameDesc ?? undefined,
        duration: effectiveDuration,
        characters: shotCharacters,
        dialogues: dialogueList.length > 0 ? dialogueList : undefined,
        slotContents: videoSlots,
      });

    const result = await videoProvider.generateVideo({
      firstFrame: shotView.firstFrame,
      lastFrame: shotView.lastFrame,
      prompt: videoPrompt,
      duration: effectiveDuration,
      ratio,
    });

    await insertAssetVersion({
      shotId,
      type: "keyframe_video",
      sequenceInType: 0,
      prompt: videoPrompt,
      fileUrl: result.filePath,
      status: "completed",
    });

    await db.update(shots).set({ status: "completed" }).where(eq(shots.id, shotId));
    return NextResponse.json({ shotId, videoUrl: result.filePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleVideoGenerate] Error for shot ${shotId}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json(
      { shotId, status: "error", error: extractErrorMessage(err) },
      { status: 500 }
    );
  }
}
