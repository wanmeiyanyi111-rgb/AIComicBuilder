import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { hasImageModelConfig } from "@/lib/ai/config-presence";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import {
  loadShotLegacyView,
  loadShotLegacyViewsBatch,
} from "@/lib/shot-asset-utils";
import {
  extractErrorMessage,
  getEpisodeCharacters,
  ratioToImageOpts,
} from "../helpers";
import type { ModelConfig } from "../types";
import {
  buildQuotaErrorMessage,
  isInsufficientQuotaError,
  requiresChainContinuity,
  resolveFrameBatchConcurrency,
} from "./frame-batch-utils";
import {
  executeFrameGeneration,
  loadVisualRefsForProject,
} from "./frame-execution-utils";

export async function handleBatchFrameGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!hasImageModelConfig(modelConfig)) {
    return NextResponse.json(
      { error: "No image model configured" },
      { status: 400 }
    );
  }

  const batchVersionId = payload?.versionId as string | undefined;
  const ratio = (payload?.ratio as string) || "16:9";
  const imageOpts = ratioToImageOpts(ratio);
  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const allShots = await db
    .select()
    .from(shots)
    .where(and(...shotWhereConditions))
    .orderBy(asc(shots.sequence));

  if (allShots.length === 0) {
    return NextResponse.json({ results: [], message: "No shots found" });
  }
  const allShotsLegacy = await loadShotLegacyViewsBatch(allShots.map((s) => s.id));

  const frameCharacters = await getEpisodeCharacters(projectId, episodeId);
  const characterDescriptions = frameCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const charsWithImages = frameCharacters.filter((c) => c.referenceImage);
  const { globalVisualRefs, visualRefsByEpisode } =
    await loadVisualRefsForProject(projectId);
  type BatchFrameResult = {
    shotId: string;
    sequence: number;
    status: string;
    firstFrame?: string;
    lastFrame?: string;
    error?: string;
  };
  const results: BatchFrameResult[] = [];

  const overwrite = payload?.overwrite === true;
  const needProcess = allShots.filter((s) => {
    const v = allShotsLegacy.get(s.id);
    return overwrite || !v?.firstFrame || !v?.lastFrame;
  });
  const skipCount = allShots.length - needProcess.length;

  console.log(
    `[BatchFrameGenerate] Total: ${allShots.length} shots, need: ${needProcess.length}, skip: ${skipCount}, characters: ${frameCharacters.length}`
  );

  const frameFirstSlots = await resolveSlotContents("frame_generate_first", {
    userId,
    projectId,
  });
  const frameLastSlots = await resolveSlotContents("frame_generate_last", {
    userId,
    projectId,
  });

  const total = allShots.length;
  let doneCount = 0;
  let quotaAbortMessage: string | null = null;
  const configuredConcurrency = resolveFrameBatchConcurrency();
  const hasChainContinuityShots = allShots.some((shot) =>
    requiresChainContinuity(shot)
  );
  const concurrency = hasChainContinuityShots
    ? 1
    : configuredConcurrency;
  console.log(
    `[BatchFrameGenerate] Starting generation with concurrency=${concurrency} (configured=${configuredConcurrency}, chainContinuity=${hasChainContinuityShots}): 0/${total}`
  );

  const processShot = async (shot: (typeof allShots)[number]): Promise<BatchFrameResult> => {
    const shotLegacy = allShotsLegacy.get(shot.id);

    if (!overwrite && shotLegacy?.firstFrame && shotLegacy?.lastFrame) {
      doneCount++;
      console.log(
        `[BatchFrameGenerate] ⊙ shot ${shot.sequence} skipped (${doneCount}/${total})`
      );
      return {
        shotId: shot.id,
        sequence: shot.sequence,
        status: "skipped",
      };
    }

    const startTime = Date.now();
    try {
      await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shot.id));
      const generated = await executeFrameGeneration({
        characterDescriptions,
        frameCharacters: charsWithImages,
        frameFirstSlots,
        frameLastSlots,
        globalVisualRefs,
        imageOpts,
        legacyLastFrameByShotId: new Map(
          Array.from(allShotsLegacy.entries()).map(([id, value]) => [id, value?.lastFrame])
        ),
        modelConfig,
        overwrite,
        projectId,
        ratio,
        shot,
        shotLegacy,
        userId,
        versionId: batchVersionId,
        visualRefsByEpisode,
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      doneCount++;
      console.log(
        `[BatchFrameGenerate] ✓ shot ${shot.sequence} (${doneCount}/${total}) ${elapsed}s`
      );

      return {
        shotId: shot.id,
        sequence: shot.sequence,
        status: "ok",
        firstFrame: generated.firstFrame,
        lastFrame: generated.lastFrame,
      };
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      doneCount++;
      if (!quotaAbortMessage && isInsufficientQuotaError(err)) {
        quotaAbortMessage = buildQuotaErrorMessage(err);
      }
      console.error(
        `[BatchFrameGenerate] ✗ shot ${shot.sequence} (${doneCount}/${total}) ${elapsed}s:`,
        err
      );
      await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shot.id));
      return {
        shotId: shot.id,
        sequence: shot.sequence,
        status: "error",
        error: quotaAbortMessage || extractErrorMessage(err),
      };
    }
  };

  const queue = allShots.map((_, index) => index);
  const resultByIndex: Array<BatchFrameResult | null> = new Array(allShots.length).fill(
    null
  );
  const workerCount = Math.min(concurrency, allShots.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        if (quotaAbortMessage) break;
        const index = queue.shift();
        if (index === undefined) break;
        resultByIndex[index] = await processShot(allShots[index]);
      }
    })
  );

  for (const item of resultByIndex) {
    if (item) {
      results.push(item);
    }
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  const errCount = results.filter((r) => r.status === "error").length;
  console.log(
    `[BatchFrameGenerate] Done: ${okCount} ok, ${errCount} errors, ${skipCount} skipped`
  );

  if (quotaAbortMessage) {
    return NextResponse.json({ error: quotaAbortMessage, results }, { status: 402 });
  }

  return NextResponse.json({ results });
}

export async function handleSingleFrameGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  const shotId = payload?.shotId as string;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!hasImageModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }
  const shotLegacy = await loadShotLegacyView(shotId);
  const ratio = (payload?.ratio as string) || "16:9";
  const shotEpisodeId = episodeId || shot.episodeId;
  const projectCharacters = await getEpisodeCharacters(projectId, shotEpisodeId);

  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");
  const imageOpts = ratioToImageOpts(ratio);
  const { globalVisualRefs, visualRefsByEpisode } =
    await loadVisualRefsForProject(projectId);

  const frameFirstSlots = await resolveSlotContents("frame_generate_first", { userId, projectId });
  const frameLastSlots = await resolveSlotContents("frame_generate_last", { userId, projectId });

  try {
    const generated = await executeFrameGeneration({
      characterDescriptions,
      frameCharacters: projectCharacters,
      frameFirstSlots,
      frameLastSlots,
      globalVisualRefs,
      imageOpts,
      modelConfig,
      projectId,
      projectVisualRefs: [
        ...(shot.episodeId ? visualRefsByEpisode.get(shot.episodeId) || [] : []),
        ...globalVisualRefs,
      ],
      ratio,
      shot,
      shotLegacy,
      userId,
      versionId: shot.versionId ?? undefined,
    });

    return NextResponse.json({
      shotId,
      firstFrame: generated.firstFrame,
      lastFrame: generated.lastFrame,
      status: "ok",
    });
  } catch (err) {
    console.error(`[SingleFrameGenerate] Error for shot ${shotId}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    if (isInsufficientQuotaError(err)) {
      return NextResponse.json(
        {
          shotId,
          status: "error",
          error: buildQuotaErrorMessage(err),
        },
        { status: 402 }
      );
    }
    return NextResponse.json(
      { shotId, status: "error", error: extractErrorMessage(err) },
      { status: 500 }
    );
  }
}
