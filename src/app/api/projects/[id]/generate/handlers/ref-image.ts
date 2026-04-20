import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasImageModelConfig, hasTextModelConfig } from "@/lib/ai/config-presence";
import { resolveAIProvider, resolveImageProvider } from "@/lib/ai/provider-factory";
import {
  loadShotLegacyView,
  loadShotLegacyViewsBatch,
} from "@/lib/shot-asset-utils";
import {
  buildCharMappingPrefix,
  getEpisodeCharacters,
} from "../helpers";
import type { ModelConfig } from "../types";
import {
  executeReferencePromptGeneration,
  generateReferenceImages,
  loadOrderedShots,
  resolveVersionedUploadDir,
} from "./ref-image-execution";

export async function handleBatchRefImageGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!hasImageModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const batchVersionId = payload?.versionId as string | undefined;
  const allShots = await loadOrderedShots({
    episodeId,
    projectId,
    versionId: batchVersionId,
  });

  const versionedUploadDir = await resolveVersionedUploadDir(batchVersionId);

  const imageProvider = resolveImageProvider(modelConfig, versionedUploadDir);
  const batchRatio = (payload?.ratio as string) || "16:9";

  const results: Array<{
    shotId: string;
    sequence: number;
    generated: number;
    failed: number;
  }> = [];

  const allShotsLegacy = await loadShotLegacyViewsBatch(allShots.map((s) => s.id));
  for (const shot of allShots) {
    const refImages = allShotsLegacy.get(shot.id)?.referenceImages ?? [];
    const pending = refImages.filter((r) => r.status === "pending" && r.prompt.trim());

    if (pending.length === 0) {
      results.push({ shotId: shot.id, sequence: shot.sequence, generated: 0, failed: 0 });
      continue;
    }

    let generated = 0;
    let failed = 0;

    ({ generated, failed } = await generateReferenceImages({
      entries: pending,
      generateImage: imageProvider.generateImage.bind(imageProvider),
      ratio: batchRatio,
      shotId: shot.id,
      typeLabel: `BatchRefImage:${shot.sequence}`,
    }));

    results.push({ shotId: shot.id, sequence: shot.sequence, generated, failed });
  }

  return NextResponse.json({ results });
}

export async function handleSingleRefImageGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const shotId = payload?.shotId as string;
  const refImageId = payload?.refImageId as string;

  if (!shotId || !refImageId) {
    return NextResponse.json({ error: "Missing shotId or refImageId" }, { status: 400 });
  }
  if (!hasImageModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }

  const shotView = await loadShotLegacyView(shot.id);
  const refImages = shotView.referenceImages;
  const entry = refImages.find((r) => r.id === refImageId);
  if (!entry) {
    return NextResponse.json({ error: "Reference image not found" }, { status: 404 });
  }
  if (!entry.prompt.trim()) {
    return NextResponse.json({ error: "No prompt provided" }, { status: 400 });
  }

  console.log(`[SingleRefImage] Shot ${shot.sequence}: generating scene-only ref image "${refImageId}"`);

  const ratio = (payload?.ratio as string) || "16:9";
  const imageProvider = resolveImageProvider(modelConfig);

  try {
    const result = await generateReferenceImages({
      entries: [entry],
      generateImage: imageProvider.generateImage.bind(imageProvider),
      ratio,
      shotId,
      typeLabel: `SingleRefImage:${shot.sequence}`,
    });

    return NextResponse.json({ ok: true, generated: result.generated });
  } catch (err) {
    return NextResponse.json({ error: `Generation failed: ${err}` }, { status: 500 });
  }
}

export async function handleGenerateRefPrompts(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!hasTextModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No text model configured" }, { status: 400 });
  }
  try {
    const result = await executeReferencePromptGeneration({
      episodeId,
      modelConfig,
      projectId,
      userId,
      versionId: payload?.versionId as string | undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate ref prompts" },
      { status: 400 }
    );
  }
}

export async function handleSingleShotRefImageGenerateAll(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const shotId = payload?.shotId as string;
  if (!shotId) return NextResponse.json({ error: "No shotId" }, { status: 400 });
  if (!hasImageModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No image model" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  const shotView = await loadShotLegacyView(shot.id);

  const refImages = shotView.referenceImages;
  const pending = refImages.filter((r) => r.status === "pending" && r.prompt.trim());
  if (pending.length === 0) {
    return NextResponse.json({ message: "No pending ref images", generated: 0 });
  }

  // Scope characters to the shot's episode (or fall back to project-wide if shot has no episode)
  const projectCharacters = await getEpisodeCharacters(projectId, shot.episodeId);
  const charsWithRefs = projectCharacters.filter((c) => !!c.referenceImage);

  // Use pre-stored character names from ref prompt generation (no AI matching needed)
  const storedCharNames = pending[0]?.characters || [];
  const relevantChars =
    storedCharNames.length > 0
      ? charsWithRefs.filter((c) => storedCharNames.includes(c.name))
      : charsWithRefs.slice(0, 3); // fallback for legacy data without characters field
  const charRefsForShot = relevantChars.map((c) => c.referenceImage as string);

  // Build character mapping prompt prefix
  const promptPrefix = buildCharMappingPrefix(relevantChars);

  console.log(
    `[RefImageGenAll] Shot ${shot.sequence}: using ${relevantChars.length} chars: ${relevantChars.map((c) => c.name).join(", ")}`
  );

  const ratio = (payload?.ratio as string) || "16:9";
  const imageProvider = resolveImageProvider(modelConfig);

  const { generated } = await generateReferenceImages({
    entries: pending,
    generateImage: imageProvider.generateImage.bind(imageProvider),
    promptPrefix,
    ratio,
    referenceImages: charRefsForShot,
    shotId,
    typeLabel: `RefImageGenAll:${shot.sequence}`,
  });

  return NextResponse.json({ generated, total: pending.length });
}
