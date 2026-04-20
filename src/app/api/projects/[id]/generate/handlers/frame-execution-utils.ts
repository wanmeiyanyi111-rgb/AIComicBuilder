import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shots, visualAssets } from "@/lib/db/schema";
import { resolveImageProvider } from "@/lib/ai/provider-factory";
import {
  buildFirstFramePrompt,
  buildLastFramePrompt,
} from "@/lib/ai/prompts/frame-generate";
import {
  getActiveAsset,
  insertAssetVersion,
  patchAsset,
} from "@/lib/shot-asset-utils";
import {
  enforceFramePromptRatio,
  getVersionedUploadDir,
} from "../helpers";
import type { ModelConfig } from "../types";
import {
  type NamedImageRef,
  type VisualAssetRef,
  buildShotReferenceContext,
  composeFirstFrameRefs,
  composeLastFrameRefs,
  pickScenePropRefsForShot,
  requiresChainContinuity,
  summarizeRefLabels,
} from "./frame-batch-utils";

export async function loadVisualRefsForProject(projectId: string) {
  const allVisualAssetRows = await db
    .select({
      episodeId: visualAssets.episodeId,
      type: visualAssets.type,
      name: visualAssets.name,
      imageUrl: visualAssets.imageUrl,
      status: visualAssets.status,
    })
    .from(visualAssets)
    .where(eq(visualAssets.projectId, projectId));

  const allVisualRefs: VisualAssetRef[] = allVisualAssetRows
    .filter(
      (row): row is typeof row & { imageUrl: string } =>
        row.status === "completed" && !!row.imageUrl
    )
    .map((row) => ({
      episodeId: row.episodeId,
      type: row.type,
      name: row.name,
      imageUrl: row.imageUrl,
    }));

  const globalVisualRefs = allVisualRefs.filter((row) => !row.episodeId);
  const visualRefsByEpisode = new Map<string, VisualAssetRef[]>();
  for (const row of allVisualRefs) {
    if (!row.episodeId) continue;
    if (!visualRefsByEpisode.has(row.episodeId)) {
      visualRefsByEpisode.set(row.episodeId, []);
    }
    visualRefsByEpisode.get(row.episodeId)?.push(row);
  }

  return { globalVisualRefs, visualRefsByEpisode };
}

export async function executeFrameGeneration(params: {
  characterDescriptions: string;
  frameCharacters: any[];
  frameFirstSlots: Record<string, string>;
  frameLastSlots: Record<string, string>;
  globalVisualRefs: VisualAssetRef[];
  imageOpts: Record<string, unknown>;
  modelConfig?: ModelConfig;
  overwrite?: boolean;
  projectId: string;
  projectVisualRefs?: VisualAssetRef[];
  ratio: string;
  shot: any;
  shotLegacy: any;
  userId: string;
  versionId?: string;
  legacyLastFrameByShotId?: Map<string, string | null | undefined>;
  visualRefsByEpisode?: Map<string, VisualAssetRef[]>;
}) {
  const ffAssetExisting = await getActiveAsset(params.shot.id, "first_frame", 0);
  const lfAssetExisting = await getActiveAsset(params.shot.id, "last_frame", 0);
  const shotCharNameSet = new Set<string>([
    ...(ffAssetExisting?.characters ?? []),
    ...(lfAssetExisting?.characters ?? []),
  ]);
  const filteredChars =
    shotCharNameSet.size > 0
      ? params.frameCharacters.filter(
          (c) => c.referenceImage && shotCharNameSet.has(c.name)
        )
      : params.frameCharacters.filter((c) => c.referenceImage);
  const shotCharRefs: NamedImageRef[] = filteredChars.map((c, idx) => ({
    path: c.referenceImage as string,
    label: `角色:${c.name || `角色${idx + 1}`}`,
  }));
  const shotCharsForPersist =
    filteredChars.length > 0 ? filteredChars.map((c) => c.name) : undefined;
  const shotContext = buildShotReferenceContext([
    params.shot.prompt,
    params.shot.motionScript,
    params.shot.videoScript,
    params.shotLegacy?.startFrameDesc,
    params.shotLegacy?.endFrameDesc,
  ]);
  const shotVisualPool = params.projectVisualRefs
    ? params.projectVisualRefs
    : [
        ...(params.shot.episodeId
          ? params.visualRefsByEpisode?.get(params.shot.episodeId) || []
          : []),
        ...params.globalVisualRefs,
      ];
  const shotScenePropRefs = pickScenePropRefsForShot(shotVisualPool, shotContext);
  const firstFrameRefs = composeFirstFrameRefs(shotCharRefs, shotScenePropRefs);
  const forceChainContinuity = requiresChainContinuity(params.shot);
  const continuitySourceShotId = forceChainContinuity
    ? params.shot.prevShotId!
    : undefined;
  console.log(
    `[FrameGenerate] Shot ${params.shot.sequence} ref pick -> chars=${summarizeRefLabels(
      shotCharRefs
    )}; scene/prop=${summarizeRefLabels(shotScenePropRefs)}; first=${summarizeRefLabels(
      firstFrameRefs
    )}; chain=${forceChainContinuity ? `on(${continuitySourceShotId})` : "off"}`
  );

  const versionedUploadDir = params.versionId
    ? await getVersionedUploadDir(params.versionId)
    : process.env.UPLOAD_DIR || "./uploads";
  const ai = resolveImageProvider(params.modelConfig, versionedUploadDir);

  await db
    .update(shots)
    .set({ status: "generating" })
    .where(eq(shots.id, params.shot.id));
  if (ffAssetExisting && !forceChainContinuity) {
    await patchAsset(ffAssetExisting.id, { status: "generating" });
  }
  if (lfAssetExisting) {
    await patchAsset(lfAssetExisting.id, { status: "generating" });
  }

  let firstFramePath = "";
  if (forceChainContinuity) {
    const prevLastFrameUrl =
      (await getActiveAsset(continuitySourceShotId!, "last_frame", 0))?.fileUrl ??
      params.legacyLastFrameByShotId?.get(continuitySourceShotId!) ??
      "";
    if (!prevLastFrameUrl) {
      throw new Error(
        `Shot ${params.shot.sequence} requires previous last frame for continuity, but prev shot (${continuitySourceShotId}) has no last frame`
      );
    }
    firstFramePath = prevLastFrameUrl;
    console.log(
      `[FrameGenerate] Shot ${params.shot.sequence}: reused previous shot last frame as first frame (${continuitySourceShotId})`
    );
  } else {
    const firstPrompt = buildFirstFramePrompt({
      sceneDescription: params.shot.prompt || "",
      startFrameDesc: enforceFramePromptRatio(
        params.shotLegacy?.startFrameDesc || params.shot.prompt || "",
        params.ratio
      ),
      characterDescriptions: params.characterDescriptions,
      slotContents: params.frameFirstSlots,
    });
    firstFramePath = await ai.generateImage(firstPrompt, {
      ...params.imageOpts,
      quality: "hd",
      referenceImages: firstFrameRefs.map((ref) => ref.path),
      referenceLabels: firstFrameRefs.map((ref) => ref.label),
    });
  }

  const lastFrameRefs = composeLastFrameRefs(
    firstFramePath,
    shotCharRefs,
    shotScenePropRefs
  );
  const lastPrompt = buildLastFramePrompt({
    sceneDescription: params.shot.prompt || "",
    endFrameDesc: enforceFramePromptRatio(
      params.shotLegacy?.endFrameDesc || params.shot.prompt || "",
      params.ratio
    ),
    characterDescriptions: params.characterDescriptions,
    firstFramePath,
    slotContents: params.frameLastSlots,
  });
  const lastFramePath = await ai.generateImage(lastPrompt, {
    ...params.imageOpts,
    quality: "hd",
    referenceImages: lastFrameRefs.map((ref) => ref.path),
    referenceLabels: lastFrameRefs.map((ref) => ref.label),
  });

  await db
    .update(shots)
    .set({ status: "completed" })
    .where(eq(shots.id, params.shot.id));

  if (ffAssetExisting) {
    await patchAsset(ffAssetExisting.id, {
      fileUrl: firstFramePath,
      status: "completed",
    });
  } else {
    await insertAssetVersion({
      shotId: params.shot.id,
      type: "first_frame",
      sequenceInType: 0,
      prompt: params.shotLegacy?.startFrameDesc ?? "",
      fileUrl: firstFramePath,
      status: "completed",
      characters: shotCharsForPersist,
      meta: forceChainContinuity
        ? {
            continuity: "inherit_prev_last_frame",
            sourceShotId: continuitySourceShotId,
          }
        : undefined,
    });
  }

  if (lfAssetExisting) {
    await patchAsset(lfAssetExisting.id, {
      fileUrl: lastFramePath,
      status: "completed",
    });
  } else {
    await insertAssetVersion({
      shotId: params.shot.id,
      type: "last_frame",
      sequenceInType: 0,
      prompt: params.shotLegacy?.endFrameDesc ?? "",
      fileUrl: lastFramePath,
      status: "completed",
      characters: shotCharsForPersist,
    });
  }

  return {
    firstFrame: firstFramePath,
    lastFrame: lastFramePath,
  };
}
