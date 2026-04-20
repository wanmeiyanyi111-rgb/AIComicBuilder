import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters, dialogues, episodes, projects, shots } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { hasVideoModelConfig } from "@/lib/ai/config-presence";
import { resolveVideoProvider } from "@/lib/ai/provider-factory";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import {
  loadShotLegacyView,
  loadShotLegacyViewsBatch,
} from "@/lib/shot-asset-utils";
import {
  extractVideoErrorMessage,
  getDirectorControlFromPayload,
  getEpisodeCharacters,
  getVersionedUploadDir,
} from "../helpers";
import type { ModelConfig } from "../types";
import { normalizeRuntimeGenerationMode } from "@/lib/generation-mode";
import {
  generateKeyframeModeVideo,
  generateStoryboardModeVideo,
  resolveVideoBatchConcurrency,
} from "./video-execution-utils";

export async function handleBatchVideoGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  const directorControl = getDirectorControlFromPayload(payload);
  if (!hasVideoModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }

  const batchVersionId = payload?.versionId as string | undefined;
  const requestedShotIds = Array.isArray(payload?.shotIds)
    ? (payload.shotIds as unknown[])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];
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
  let generationModeValue = "storyboard_grid";
  if (episodeId) {
    const [episode] = await db
      .select({ generationMode: episodes.generationMode })
      .from(episodes)
      .where(eq(episodes.id, episodeId));
    generationModeValue = normalizeRuntimeGenerationMode(episode?.generationMode);
  } else {
    const [project] = await db
      .select({ generationMode: projects.generationMode })
      .from(projects)
      .where(eq(projects.id, projectId));
    generationModeValue = normalizeRuntimeGenerationMode(project?.generationMode);
  }
  const eligible = allShots.filter((s) => {
    const v = allShotsLegacy.get(s.id);
    const requested =
      requestedShotIds.length === 0 || requestedShotIds.includes(s.id);
    if (!requested) return false;
    if (generationModeValue === "storyboard_grid") {
      const completedPanels =
        (v?.storyboardPanels ?? []).filter((panel) => !!panel.fileUrl).length;
      return completedPanels >= 2 && (overwrite || !v?.storyboardVideo?.fileUrl);
    }
    return requested && v?.firstFrame && v?.lastFrame && (overwrite || !v?.videoUrl);
  });
  if (eligible.length === 0) {
    return NextResponse.json({ results: [], message: "No eligible shots" });
  }

  const batchCharacters = await getEpisodeCharacters(projectId, episodeId);

  const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);
  const ratio = (payload?.ratio as string) || "16:9";
  const videoModelId = modelConfig?.video?.modelId;
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
      if (generationModeValue === "storyboard_grid") {
        const basePrompt = shot.videoPrompt?.trim();
        if (!basePrompt) {
          throw new Error("No storyboard video prompt found. Please generate video prompts first.");
        }
        const result = await generateStoryboardModeVideo({
          episodeId,
          projectId,
          shot,
          shotLegacy,
          ratio,
          videoModelId,
          videoPrompt: basePrompt,
          videoProvider,
        });
        return {
          shotId: shot.id,
          sequence: shot.sequence,
          status: "ok",
          videoUrl: result.videoUrl,
        };
      }
      const result = await generateKeyframeModeVideo({
        directorControl,
        projectId,
        ratio,
        shot,
        shotCharacters: batchCharacters,
        shotId: shot.id,
        shotLegacy,
        slotContents: videoSlots,
        videoModelId,
        videoProvider,
      });
      console.log(`[BatchVideoGenerate] Shot ${shot.sequence} completed`);
      return {
        shotId: shot.id,
        sequence: shot.sequence,
        status: "ok",
        videoUrl: result.videoUrl,
      };
    } catch (err) {
      console.error(`[BatchVideoGenerate] Error for shot ${shot.sequence}:`, err);
      await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shot.id));
      return {
        shotId: shot.id,
        sequence: shot.sequence,
        status: "error",
        error: extractVideoErrorMessage(err),
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
  const directorControl = getDirectorControlFromPayload(payload);
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
  let generationModeValue = "storyboard_grid";
  if (shot.episodeId) {
    const [episode] = await db
      .select({ generationMode: episodes.generationMode })
      .from(episodes)
      .where(eq(episodes.id, shot.episodeId));
    generationModeValue = normalizeRuntimeGenerationMode(episode?.generationMode);
  } else {
    const [project] = await db
      .select({ generationMode: projects.generationMode })
      .from(projects)
      .where(eq(projects.id, shot.projectId));
    generationModeValue = normalizeRuntimeGenerationMode(project?.generationMode);
  }
  if (
    generationModeValue !== "storyboard_grid" &&
    (!shotView.firstFrame || !shotView.lastFrame)
  ) {
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

    if (generationModeValue === "storyboard_grid") {
      if (!shot.videoPrompt?.trim()) {
        return NextResponse.json(
          { error: "No storyboard video prompt found. Generate prompt first." },
          { status: 400 }
        );
      }
      const result = await generateStoryboardModeVideo({
        episodeId: shot.episodeId ?? undefined,
        projectId,
        shot,
        shotLegacy: shotView,
        ratio,
        videoModelId,
        videoPrompt: shot.videoPrompt,
        videoProvider,
      });
      return NextResponse.json({ shotId, videoUrl: result.videoUrl, status: "ok" });
    }

    const result = await generateKeyframeModeVideo({
      directorControl,
      projectId,
      ratio,
      shot,
      shotCharacters,
      shotId,
      shotLegacy: shotView,
      slotContents: videoSlots,
      videoModelId,
      videoProvider,
    });
    if (!result.preflight.pass) {
      return NextResponse.json(
        {
          shotId,
          status: "error",
          error: `[VideoPreflight] ${result.preflight.summary} 问题：${result.preflight.issues.join("；")}。建议：${result.preflight.suggestions.join("；")}`,
        },
        { status: 422 }
      );
    }
    return NextResponse.json({ shotId, videoUrl: result.videoUrl, status: "ok" });
  } catch (err) {
    console.error(`[SingleVideoGenerate] Error for shot ${shotId}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json(
      { shotId, status: "error", error: extractVideoErrorMessage(err) },
      { status: 422 }
    );
  }
}
