import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters, shots } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import {
  hasImageModelConfig,
  hasVideoModelConfig,
} from "@/lib/ai/config-presence";
import {
  resolveAIProvider,
  resolveVideoProvider,
} from "@/lib/ai/provider-factory";
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
import { executeReferenceVideoGeneration } from "./reference-video-execution";

export async function handleSingleReferenceVideo(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const directorControl = getDirectorControlFromPayload(payload);
  const shotId = payload?.shotId as string | undefined;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!hasVideoModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }
  if (!hasImageModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }
  const shotView = await loadShotLegacyView(shot.id);
  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);
  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, shot.projectId));
  const ratio = (payload?.ratio as string) || "16:9";

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));
    const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);
    const textProvider = resolveAIProvider(modelConfig);
    const result = await executeReferenceVideoGeneration({
      directorControl,
      modelConfig,
      projectCharacters,
      projectId,
      ratio,
      shot,
      shotId,
      shotView,
      textProvider,
      userId,
      videoProvider,
    });

    return NextResponse.json({
      shotId,
      referenceVideoUrl: result.referenceVideoUrl,
      status: "ok",
    });
  } catch (err) {
    console.error(`[SingleReferenceVideo] Error for shot ${shot.sequence}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json(
      { shotId, status: "error", error: extractVideoErrorMessage(err) },
      { status: 422 }
    );
  }
}

export async function handleBatchReferenceVideo(
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
  if (!hasImageModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
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
  const eligible = allShots.filter((shot) => {
    const view = allShotsLegacy.get(shot.id);
    const requested =
      requestedShotIds.length === 0 || requestedShotIds.includes(shot.id);
    return requested && shot.status !== "generating" && (overwrite || !view?.referenceVideoUrl);
  });
  if (eligible.length === 0) {
    return NextResponse.json({ results: [], message: "No eligible shots" });
  }

  const projectCharacters = await getEpisodeCharacters(projectId, episodeId);
  const charsWithRefsAll = projectCharacters.filter((c) => !!c.referenceImage);
  if (charsWithRefsAll.length === 0) {
    return NextResponse.json(
      { error: "No character reference images available." },
      { status: 400 }
    );
  }

  const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);
  const textProvider = resolveAIProvider(modelConfig);
  const ratio = (payload?.ratio as string) || "16:9";

  await Promise.all(
    eligible.map((shot) =>
      db.update(shots).set({ status: "generating" }).where(eq(shots.id, shot.id))
    )
  );

  const results = await Promise.all(
    eligible.map(async (shot) => {
      try {
        const shotView = allShotsLegacy.get(shot.id)!;
        const result = await executeReferenceVideoGeneration({
          directorControl,
          modelConfig,
          projectCharacters,
          projectId,
          ratio,
          shot,
          shotId: shot.id,
          shotView,
          textProvider,
          userId,
          videoProvider,
        });

        console.log(
          `[BatchReferenceVideo] Shot ${shot.sequence}: ${result.sceneFramePaths.length} scenes + ${result.orderedRefImages.length - result.sceneFramePaths.length} chars -> video`
        );
        return {
          shotId: shot.id,
          sequence: shot.sequence,
          status: "ok" as const,
          referenceVideoUrl: result.referenceVideoUrl,
        };
      } catch (err) {
        console.error(`[BatchReferenceVideo] Error for shot ${shot.sequence}:`, err);
        await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shot.id));
        return {
          shotId: shot.id,
          sequence: shot.sequence,
          status: "error" as const,
          error: extractVideoErrorMessage(err),
        };
      }
    })
  );

  return NextResponse.json({ results });
}
