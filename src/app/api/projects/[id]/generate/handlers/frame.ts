import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots, visualAssets } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { hasImageModelConfig } from "@/lib/ai/config-presence";
import { resolveImageProvider } from "@/lib/ai/provider-factory";
import {
  buildFirstFramePrompt,
  buildLastFramePrompt,
} from "@/lib/ai/prompts/frame-generate";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import {
  getActiveAsset,
  insertAssetVersion,
  loadShotLegacyViewsBatch,
  patchAsset,
} from "@/lib/shot-asset-utils";
import {
  extractErrorMessage,
  getEpisodeCharacters,
  getVersionedUploadDir,
  ratioToImageOpts,
} from "../helpers";
import type { ModelConfig } from "../types";

const DEFAULT_FRAME_BATCH_CONCURRENCY = 3;
const MAX_FRAME_BATCH_CONCURRENCY = 8;
const MAX_FRAME_REFERENCE_IMAGES = 4;
const MAX_SCENE_PROP_REFERENCE_IMAGES = 2;

type NamedImageRef = {
  path: string;
  label: string;
};

type VisualAssetRef = {
  episodeId: string | null;
  type: "scene" | "prop";
  name: string;
  imageUrl: string;
};

function requiresChainContinuity(shot: {
  inheritPrevLastFrame?: number | null;
  prevShotId?: string | null;
}): boolean {
  return shot.inheritPrevLastFrame === 1 && !!shot.prevShotId;
}

function buildShotReferenceContext(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part || "").toLowerCase().trim())
    .filter(Boolean)
    .join("\n");
}

function dedupeNamedRefs(refs: NamedImageRef[]): NamedImageRef[] {
  const seen = new Set<string>();
  const output: NamedImageRef[] = [];
  for (const ref of refs) {
    const key = ref.path.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(ref);
  }
  return output;
}

function summarizeRefLabels(refs: NamedImageRef[]): string {
  return refs.map((ref) => ref.label).join(" | ") || "none";
}

function composeFirstFrameRefs(
  charRefs: NamedImageRef[],
  scenePropRefs: NamedImageRef[]
): NamedImageRef[] {
  const ordered: NamedImageRef[] = [];
  if (scenePropRefs[0]) ordered.push(scenePropRefs[0]);
  if (charRefs[0]) ordered.push(charRefs[0]);
  if (scenePropRefs[1]) ordered.push(scenePropRefs[1]);
  if (charRefs[1]) ordered.push(charRefs[1]);
  ordered.push(...charRefs.slice(2), ...scenePropRefs.slice(2));
  return dedupeNamedRefs(ordered).slice(0, MAX_FRAME_REFERENCE_IMAGES);
}

function composeLastFrameRefs(
  firstFramePath: string,
  charRefs: NamedImageRef[],
  scenePropRefs: NamedImageRef[]
): NamedImageRef[] {
  const ordered: NamedImageRef[] = [
    { path: firstFramePath, label: "首帧/First Frame" },
    ...composeFirstFrameRefs(charRefs, scenePropRefs),
  ];
  return dedupeNamedRefs(ordered).slice(0, MAX_FRAME_REFERENCE_IMAGES);
}

function pickScenePropRefsForShot(
  pool: VisualAssetRef[],
  context: string
): NamedImageRef[] {
  if (pool.length === 0) return [];

  const ranked = pool
    .map((asset) => ({
      ...asset,
      score: context.includes(asset.name.toLowerCase()) ? 100 : 0,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.type !== b.type) return a.type === "scene" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const preferred = ranked.some((item) => item.score > 0)
    ? ranked.filter((item) => item.score > 0)
    : ranked;

  const picked: typeof preferred = [];
  const takeOne = (type: "scene" | "prop") => {
    const found = preferred.find(
      (item) => item.type === type && !picked.includes(item)
    );
    if (found) picked.push(found);
  };

  takeOne("scene");
  takeOne("prop");
  for (const item of preferred) {
    if (picked.includes(item)) continue;
    picked.push(item);
    if (picked.length >= MAX_SCENE_PROP_REFERENCE_IMAGES) break;
  }

  return picked.slice(0, MAX_SCENE_PROP_REFERENCE_IMAGES).map((item) => ({
    path: item.imageUrl,
    label: item.type === "scene" ? `场景:${item.name}` : `道具:${item.name}`,
  }));
}

function resolveFrameBatchConcurrency(): number {
  const raw =
    process.env.BATCH_FRAME_CONCURRENCY ||
    process.env.FRAME_BATCH_CONCURRENCY ||
    process.env.IMAGE_BATCH_CONCURRENCY;
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_FRAME_BATCH_CONCURRENCY;
  return Math.min(MAX_FRAME_BATCH_CONCURRENCY, Math.max(1, parsed));
}

function isInsufficientQuotaError(err: unknown): boolean {
  const message = extractErrorMessage(err).toLowerCase();
  if (
    message.includes("insufficient_user_quota") ||
    message.includes("额度") ||
    message.includes("quota")
  ) {
    return true;
  }

  if (!err || typeof err !== "object") {
    return false;
  }

  const code = (err as Record<string, unknown>).code;
  return typeof code === "string" && code.toLowerCase() === "insufficient_user_quota";
}

function buildQuotaErrorMessage(err: unknown): string {
  const detail = extractErrorMessage(err);
  return `图片模型额度不足，无法继续生成首尾帧。请先充值对应通道，或切换到有可用额度的图片模型后重试。详情：${detail}`;
}

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
  const imageOpts = ratioToImageOpts(payload?.ratio as string | undefined);
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

  const versionedUploadDir = batchVersionId
    ? await getVersionedUploadDir(batchVersionId)
    : process.env.UPLOAD_DIR || "./uploads";

  const frameCharacters = await getEpisodeCharacters(projectId, episodeId);
  const characterDescriptions = frameCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const charsWithImages = frameCharacters.filter((c) => c.referenceImage);
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

  const ai = resolveImageProvider(modelConfig, versionedUploadDir);
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

      const ffAssetExisting = await getActiveAsset(shot.id, "first_frame", 0);
      const lfAssetExisting = await getActiveAsset(shot.id, "last_frame", 0);
      const shotCharNameSet = new Set<string>([
        ...(ffAssetExisting?.characters ?? []),
        ...(lfAssetExisting?.characters ?? []),
      ]);
      const filteredChars =
        shotCharNameSet.size > 0
          ? charsWithImages.filter((c) => shotCharNameSet.has(c.name))
          : charsWithImages;
      const shotCharRefImages = filteredChars.map((c) => c.referenceImage!);
      const shotCharRefLabels = filteredChars.map((c) => c.name);
      const shotCharRefs: NamedImageRef[] = shotCharRefImages.map((path, idx) => ({
        path,
        label: `角色:${shotCharRefLabels[idx] || `角色${idx + 1}`}`,
      }));
      const shotCharsForPersist =
        filteredChars.length > 0 ? filteredChars.map((c) => c.name) : undefined;
      const shotContext = buildShotReferenceContext([
        shot.prompt,
        shot.motionScript,
        shot.videoScript,
        shotLegacy?.startFrameDesc,
        shotLegacy?.endFrameDesc,
      ]);
      const shotVisualPool = [
        ...(shot.episodeId ? visualRefsByEpisode.get(shot.episodeId) || [] : []),
        ...globalVisualRefs,
      ];
      const shotScenePropRefs = pickScenePropRefsForShot(shotVisualPool, shotContext);
      const firstFrameRefs = composeFirstFrameRefs(shotCharRefs, shotScenePropRefs);
      const forceChainContinuity = requiresChainContinuity(shot);
      const continuitySourceShotId = forceChainContinuity ? shot.prevShotId! : undefined;
      console.log(
        `[BatchFrameGenerate] Shot ${shot.sequence} ref pick -> chars=${summarizeRefLabels(
          shotCharRefs
        )}; scene/prop=${summarizeRefLabels(shotScenePropRefs)}; first=${summarizeRefLabels(
          firstFrameRefs
        )}; chain=${forceChainContinuity ? `on(${continuitySourceShotId})` : "off"}`
      );

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
          allShotsLegacy.get(continuitySourceShotId!)?.lastFrame ??
          "";
        if (!prevLastFrameUrl) {
          throw new Error(
            `Shot ${shot.sequence} requires previous last frame for continuity, but prev shot (${continuitySourceShotId}) has no last frame`
          );
        }
        firstFramePath = prevLastFrameUrl;
        console.log(
          `[BatchFrameGenerate] Shot ${shot.sequence}: reused previous shot last frame as first frame (${continuitySourceShotId})`
        );
      } else {
        const firstPrompt = buildFirstFramePrompt({
          sceneDescription: shot.prompt || "",
          startFrameDesc: shotLegacy?.startFrameDesc || shot.prompt || "",
          characterDescriptions,
          slotContents: frameFirstSlots,
        });
        firstFramePath = await ai.generateImage(firstPrompt, {
          ...imageOpts,
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
        sceneDescription: shot.prompt || "",
        endFrameDesc: shotLegacy?.endFrameDesc || shot.prompt || "",
        characterDescriptions,
        firstFramePath,
        slotContents: frameLastSlots,
      });
      const lastFramePath = await ai.generateImage(lastPrompt, {
        ...imageOpts,
        quality: "hd",
        referenceImages: lastFrameRefs.map((ref) => ref.path),
        referenceLabels: lastFrameRefs.map((ref) => ref.label),
      });

      await db.update(shots).set({ status: "completed" }).where(eq(shots.id, shot.id));

      if (ffAssetExisting) {
        await patchAsset(ffAssetExisting.id, {
          fileUrl: firstFramePath,
          status: "completed",
        });
      } else {
        await insertAssetVersion({
          shotId: shot.id,
          type: "first_frame",
          sequenceInType: 0,
          prompt: shotLegacy?.startFrameDesc ?? "",
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
          shotId: shot.id,
          type: "last_frame",
          sequenceInType: 0,
          prompt: shotLegacy?.endFrameDesc ?? "",
          fileUrl: lastFramePath,
          status: "completed",
          characters: shotCharsForPersist,
        });
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      doneCount++;
      console.log(
        `[BatchFrameGenerate] ✓ shot ${shot.sequence} (${doneCount}/${total}) ${elapsed}s`
      );

      return {
        shotId: shot.id,
        sequence: shot.sequence,
        status: "ok",
        firstFrame: firstFramePath,
        lastFrame: lastFramePath,
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

  const ffAsset = await getActiveAsset(shotId, "first_frame", 0);
  const lfAsset = await getActiveAsset(shotId, "last_frame", 0);
  const startFramePromptText = ffAsset?.prompt || shot.prompt || "";
  const endFramePromptText = lfAsset?.prompt || shot.prompt || "";

  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);
  const shotEpisodeId = episodeId || shot.episodeId;
  const projectCharacters = await getEpisodeCharacters(projectId, shotEpisodeId);

  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const shotCharNameSet = new Set<string>([
    ...(ffAsset?.characters ?? []),
    ...(lfAsset?.characters ?? []),
  ]);
  const filteredChars =
    shotCharNameSet.size > 0
      ? projectCharacters.filter((c) => c.referenceImage && shotCharNameSet.has(c.name))
      : projectCharacters.filter((c) => c.referenceImage);
  const shotCharRefImages = filteredChars.map((c) => c.referenceImage as string);
  const shotCharRefLabels = filteredChars.map((c) => c.name);
  const shotCharRefs: NamedImageRef[] = shotCharRefImages.map((path, idx) => ({
    path,
    label: `角色:${shotCharRefLabels[idx] || `角色${idx + 1}`}`,
  }));
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
  const visualPool: VisualAssetRef[] = allVisualAssetRows
    .filter(
      (row): row is typeof row & { imageUrl: string } =>
        row.status === "completed" &&
        !!row.imageUrl &&
        (!row.episodeId || row.episodeId === shot.episodeId)
    )
    .map((row) => ({
      episodeId: row.episodeId,
      type: row.type,
      name: row.name,
      imageUrl: row.imageUrl,
    }));
  const shotContext = buildShotReferenceContext([
    shot.prompt,
    shot.motionScript,
    shot.videoScript,
    startFramePromptText,
    endFramePromptText,
  ]);
  const shotScenePropRefs = pickScenePropRefsForShot(visualPool, shotContext);
  const firstFrameRefs = composeFirstFrameRefs(shotCharRefs, shotScenePropRefs);
  const forceChainContinuity = requiresChainContinuity(shot);
  const continuitySourceShotId = forceChainContinuity ? shot.prevShotId! : undefined;
  console.log(
    `[SingleFrameGenerate] Shot ${shot.sequence} ref pick -> chars=${summarizeRefLabels(
      shotCharRefs
    )}; scene/prop=${summarizeRefLabels(shotScenePropRefs)}; first=${summarizeRefLabels(
      firstFrameRefs
    )}; chain=${forceChainContinuity ? `on(${continuitySourceShotId})` : "off"}`
  );

  const ai = resolveImageProvider(modelConfig, versionedUploadDir);
  const imageOpts = ratioToImageOpts(payload?.ratio as string | undefined);

  const frameFirstSlots = await resolveSlotContents("frame_generate_first", { userId, projectId });
  const frameLastSlots = await resolveSlotContents("frame_generate_last", { userId, projectId });

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));
    if (ffAsset && !forceChainContinuity) {
      await patchAsset(ffAsset.id, { status: "generating" });
    }
    if (lfAsset) {
      await patchAsset(lfAsset.id, { status: "generating" });
    }

    const shotCharsForPersist =
      filteredChars.length > 0 ? filteredChars.map((c) => c.name) : undefined;
    let firstFramePath = "";
    if (forceChainContinuity) {
      const prevLastFrameUrl =
        (await getActiveAsset(continuitySourceShotId!, "last_frame", 0))?.fileUrl ?? "";
      if (!prevLastFrameUrl) {
        throw new Error(
          `Shot ${shot.sequence} requires previous last frame for continuity, but prev shot (${continuitySourceShotId}) has no last frame`
        );
      }
      firstFramePath = prevLastFrameUrl;
      console.log(
        `[SingleFrameGenerate] Shot ${shot.sequence}: reused previous shot last frame as first frame (${continuitySourceShotId})`
      );
    } else {
      const firstPrompt = buildFirstFramePrompt({
        sceneDescription: shot.prompt || "",
        startFrameDesc: startFramePromptText,
        characterDescriptions,
        slotContents: frameFirstSlots,
      });
      firstFramePath = await ai.generateImage(firstPrompt, {
        ...imageOpts,
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
      sceneDescription: shot.prompt || "",
      endFrameDesc: endFramePromptText,
      characterDescriptions,
      firstFramePath,
      slotContents: frameLastSlots,
    });
    const lastFramePath = await ai.generateImage(lastPrompt, {
      ...imageOpts,
      quality: "hd",
      referenceImages: lastFrameRefs.map((ref) => ref.path),
      referenceLabels: lastFrameRefs.map((ref) => ref.label),
    });

    await db.update(shots).set({ status: "completed" }).where(eq(shots.id, shotId));

    if (ffAsset) {
      await patchAsset(ffAsset.id, { fileUrl: firstFramePath, status: "completed" });
    } else {
      await insertAssetVersion({
        shotId,
        type: "first_frame",
        sequenceInType: 0,
        prompt: startFramePromptText,
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
    if (lfAsset) {
      await patchAsset(lfAsset.id, { fileUrl: lastFramePath, status: "completed" });
    } else {
      await insertAssetVersion({
        shotId,
        type: "last_frame",
        sequenceInType: 0,
        prompt: endFramePromptText,
        fileUrl: lastFramePath,
        status: "completed",
      });
    }

    return NextResponse.json({
      shotId,
      firstFrame: firstFramePath,
      lastFrame: lastFramePath,
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
