import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { hasImageModelConfig } from "@/lib/ai/config-presence";
import { resolveImageProvider } from "@/lib/ai/provider-factory";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { buildSceneFramePrompt } from "@/lib/ai/prompts/scene-frame-generate";
import {
  getActiveAsset,
  insertAssetVersion,
  loadShotLegacyView,
  loadShotLegacyViewsBatch,
  patchAsset,
} from "@/lib/shot-asset-utils";
import {
  extractErrorMessage,
  getVersionedUploadDir,
  ratioToImageOpts,
} from "../helpers";
import type { ModelConfig } from "../types";

export async function handleSingleSceneFrame(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const shotId = payload?.shotId as string | undefined;
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

  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    const imageProvider = resolveImageProvider(modelConfig, versionedUploadDir);
    const slotContents = await resolveSlotContents("scene_frame_generate", { userId, projectId });
    const sceneFrameView = await loadShotLegacyView(shot.id);
    const sceneFramePrompt = buildSceneFramePrompt({
      sceneDescription: shot.prompt || "",
      charRefMapping: "",
      characterDescriptions: "",
      cameraDirection: shot.cameraDirection,
      startFrameDesc: sceneFrameView.startFrameDesc,
      motionScript: shot.motionScript,
      slotContents,
    });

    console.log(
      `[SingleSceneFrame] Shot ${shot.sequence}: generating scene-only frame (no character refs)`
    );

    const sceneFramePath = await imageProvider.generateImage(sceneFramePrompt, {
      quality: "hd",
    });

    {
      const refEx = await getActiveAsset(shotId, "reference", 0);
      if (refEx) {
        await patchAsset(refEx.id, { fileUrl: sceneFramePath, status: "completed" });
      } else {
        const siblingChars = sceneFrameView.referenceImages[0]?.characters ?? undefined;
        await insertAssetVersion({
          shotId,
          type: "reference",
          sequenceInType: 0,
          prompt: "",
          fileUrl: sceneFramePath,
          status: "completed",
          characters: siblingChars,
        });
      }
    }
    await db.update(shots).set({ status: "pending" }).where(eq(shots.id, shotId));

    return NextResponse.json({ shotId, sceneRefFrame: sceneFramePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleSceneFrame] Error for shot ${shot.sequence}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json(
      { shotId, status: "error", error: extractErrorMessage(err) },
      { status: 500 }
    );
  }
}

export async function handleBatchSceneFrame(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!hasImageModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const overwrite = payload?.overwrite === true;
  const ratio = (payload?.ratio as string) || "16:9";
  const imageOpts = ratioToImageOpts(ratio);
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

  const imageProvider = resolveImageProvider(modelConfig, versionedUploadDir);
  const allShotsLegacy = await loadShotLegacyViewsBatch(allShots.map((s) => s.id));

  const eligible = allShots.filter((shot) => {
    const refImages = allShotsLegacy.get(shot.id)?.referenceImages ?? [];
    const targets = overwrite
      ? refImages.filter((r) => r.prompt.trim())
      : refImages.filter((r) => r.status === "pending" && r.prompt.trim());
    return targets.length > 0;
  });

  await Promise.all(
    eligible.map((shot) =>
      db.update(shots).set({ status: "generating" }).where(eq(shots.id, shot.id))
    )
  );

  const results = await Promise.all(
    allShots.map(async (shot) => {
      const refImages = allShotsLegacy.get(shot.id)?.referenceImages ?? [];
      const targets = overwrite
        ? refImages.filter((r) => r.prompt.trim())
        : refImages.filter((r) => r.status === "pending" && r.prompt.trim());

      if (targets.length === 0) {
        return { shotId: shot.id, sequence: shot.sequence, status: "ok" as const, generated: 0 };
      }

      console.log(
        `[BatchSceneFrame] Shot ${shot.sequence}: ${targets.length} scene-only refs (no character injection)`
      );

      const genResults = await Promise.all(
        targets.map(async (entry) => {
          try {
            const imagePath = await imageProvider.generateImage(entry.prompt, {
              quality: "hd",
              ...imageOpts,
            });
            await insertAssetVersion({
              shotId: shot.id,
              type: "reference",
              sequenceInType: entry.sequenceInType,
              prompt: entry.prompt,
              fileUrl: imagePath,
              status: "completed",
              characters: entry.characters ?? undefined,
            });
            console.log(`[BatchRefImage] Shot ${shot.sequence}: ref "${entry.id}" done`);
            return true;
          } catch (err) {
            console.warn(`[BatchRefImage] Shot ${shot.sequence} ref ${entry.id} failed:`, err);
            return false;
          }
        })
      );

      const generated = genResults.filter(Boolean).length;

      await db.update(shots).set({ status: "pending" }).where(eq(shots.id, shot.id));

      return { shotId: shot.id, sequence: shot.sequence, status: "ok" as const, generated };
    })
  );

  return NextResponse.json({ results });
}
