import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterRelations, shots } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { hasImageModelConfig, hasTextModelConfig } from "@/lib/ai/config-presence";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { resolveAIProvider, resolveImageProvider } from "@/lib/ai/provider-factory";
import {
  insertAssetVersion,
  loadShotLegacyView,
  loadShotLegacyViewsBatch,
} from "@/lib/shot-asset-utils";
import { buildRefImagePromptsRequest } from "@/lib/ai/prompts/ref-image-prompts";
import {
  buildVisualStyleFromScript,
  buildCharMappingPrefix,
  getEpisodeCharacters,
  getScriptForScope,
  getVersionedUploadDir,
  ratioToImageOpts,
} from "../helpers";
import type { ModelConfig } from "../types";

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

    for (const entry of pending) {
      try {
        const batchRatio = (payload?.ratio as string) || "16:9";
        const batchImageOpts = ratioToImageOpts(batchRatio);

        // Scene-only: do NOT inject character references. Scene frames are
        // pure environments; character consistency is handled at the video
        // generation step via Seedance 2 multi-reference mode.
        const imagePath = await imageProvider.generateImage(entry.prompt, {
          quality: "hd",
          ...batchImageOpts,
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
        generated++;
        console.log(`[BatchRefImage] Shot ${shot.sequence}: generated ref image "${entry.id}"`);
      } catch (err) {
        failed++;
        console.warn(`[BatchRefImage] Shot ${shot.sequence}: failed ref image "${entry.id}":`, err);
      }
    }

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
  const imgOpts = ratioToImageOpts(ratio);
  const imageProvider = resolveImageProvider(modelConfig);

  try {
    // Scene-only: do NOT inject character references here.
    const imagePath = await imageProvider.generateImage(entry.prompt, {
      quality: "hd",
      ...imgOpts,
    });

    await insertAssetVersion({
      shotId,
      type: "reference",
      sequenceInType: entry.sequenceInType,
      prompt: entry.prompt,
      fileUrl: imagePath,
      status: "completed",
      characters: entry.characters ?? undefined,
    });

    return NextResponse.json({ ok: true, imagePath });
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

  const batchVersionId = payload?.versionId as string | undefined;
  const buildWhere = (includeVersion: boolean) => {
    const conds = [eq(shots.projectId, projectId)];
    if (includeVersion && batchVersionId) conds.push(eq(shots.versionId, batchVersionId));
    if (episodeId) conds.push(eq(shots.episodeId, episodeId));
    return and(...conds);
  };

  let allShots = await db
    .select()
    .from(shots)
    .where(buildWhere(true))
    .orderBy(asc(shots.sequence));

  // Fallback: if the strict version filter returns empty (e.g. stale
  // selectedVersionId on the client), retry without version — use the
  // shots that actually exist for this project+episode.
  if (allShots.length === 0 && batchVersionId) {
    console.warn(
      `[GenerateRefPrompts] strict filter empty (versionId=${batchVersionId}), falling back to no-version filter`
    );
    allShots = await db
      .select()
      .from(shots)
      .where(buildWhere(false))
      .orderBy(asc(shots.sequence));
  }

  if (allShots.length === 0) {
    return NextResponse.json({ error: "No shots found" }, { status: 400 });
  }

  const projectCharacters = await getEpisodeCharacters(projectId, episodeId);

  // Get visual style from script — parse the fixed machine-readable meta block
  // (see src/lib/ai/prompts/script-generate.ts VISUAL STYLE section)
  const script = await getScriptForScope(projectId, episodeId);
  // 参考导演 is intentionally NOT injected into visualStyle anymore —
  // it carries real person names that trigger content filters at both
  // the text LLM (400) and the image API (400 invalid_request_error).
  const visualStyle = buildVisualStyleFromScript(script);

  // Load character relationships — drives on-screen interaction framing
  // when scene frames plan out the space for enemies / allies.
  const refRelations = await db
    .select()
    .from(characterRelations)
    .where(eq(characterRelations.projectId, projectId));
  let refRelationsText = "";
  if (refRelations.length > 0) {
    refRelationsText = "\n\n## 角色关系（必须用于决定场景空间规划）\n";
    for (const rel of refRelations) {
      const charA = projectCharacters.find((c) => c.id === rel.characterAId);
      const charB = projectCharacters.find((c) => c.id === rel.characterBId);
      if (charA && charB) {
        refRelationsText += `- ${charA.name} ↔ ${charB.name}：${rel.relationType}${rel.description ? `（${rel.description}）` : ""}\n`;
      }
    }
    refRelationsText += `
**关系驱动场景规划规则**：
- **敌对**：场景需要有明确的对峙空间轴线——两个站位点之间留出视觉通道。
- **友好/父女/师徒**：场景留出并肩站位的空间。
- 这些只影响场景帧的空间布局（景别/构图/空间轴线），场景帧本身**仍然不画任何人物**。
`;
  }

  const textProvider = resolveAIProvider(modelConfig);
  const refImageSystem = await resolvePrompt("ref_image_prompts", { userId, projectId });
  const { deleteAssetsByType } = await import("@/lib/shot-asset-utils");

  // Batch generation strategy — each LLM call receives a chunk of 8
  // consecutive shots so the AI can maintain narrative continuity across
  // them (lighting evolution, spatial flow, prop reuse). Batches run
  // SEQUENTIALLY so each batch can see the previous batch's last shot as
  // continuity context. Concurrent per-shot calls broke story coherence —
  // each shot got a near-duplicate "intro scene" from the LLM.
  const total = allShots.length;
  const BATCH_SIZE = 8;
  const batches: typeof allShots[] = [];
  for (let i = 0; i < allShots.length; i += BATCH_SIZE) {
    batches.push(allShots.slice(i, i + BATCH_SIZE));
  }
  console.log(
    `[GenerateRefPrompts] Starting sequential batched generation: ${batches.length} batch(es) of up to ${BATCH_SIZE} shots, total ${total}`
  );

  let updatedCount = 0;
  const failed: Array<{ seq: number; err: string }> = [];
  let previousBatchTail: { sequence: number; sceneName?: string; prompt: string } | null = null;

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const batchStart = Date.now();
    try {
      const baseRefRequest = buildRefImagePromptsRequest(
        batch.map((s) => ({
          sequence: s.sequence,
          prompt: s.prompt || "",
          motionScript: s.motionScript,
          cameraDirection: s.cameraDirection,
          duration: s.duration,
        })),
        projectCharacters.map((c) => ({ name: c.name, description: c.description })),
        visualStyle
      );

      let promptRequest = refRelationsText ? baseRefRequest + refRelationsText : baseRefRequest;

      // Continuity context from the last shot of the previous batch.
      if (previousBatchTail) {
        promptRequest += `\n\n## 剧情连续性上下文\n本批次的镜头 ${batch[0].sequence} 紧接上一批次镜头 ${previousBatchTail.sequence} 之后。上一个镜头的结束场景是"${previousBatchTail.sceneName || "未命名"}"：${previousBatchTail.prompt.slice(0, 160)}...\n请让本批次第一个镜头的场景在空间/光线/色调上与之自然衔接，避免突兀重置到"起始场景"风格。`;
      }

      const result = await textProvider.generateText(promptRequest, {
        systemPrompt: refImageSystem,
        temperature: 0.7,
      });

      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error(`Batch ${bi + 1}: invalid JSON response`);
      }
      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        shotSequence: number;
        characters?: string[];
        scenes?: Array<{ name: string; prompt: string }>;
        prompts?: string[];
      }>;

      let batchUpdated = 0;
      let lastEntryForContinuity: { sequence: number; sceneName?: string; prompt: string } | null = null;
      for (const shot of batch) {
        try {
          const entry = parsed.find((e) => e.shotSequence === shot.sequence);
          if (!entry) {
            console.warn(
              `[GenerateRefPrompts] batch ${bi + 1}: shot ${shot.sequence} missing from LLM output`
            );
            failed.push({ seq: shot.sequence, err: "missing from batch output" });
            continue;
          }

          // Normalize: accept new { scenes: [{name, prompt}] } or legacy
          // { prompts: [string] } format.
          let sceneList: Array<{ name: string; prompt: string }> = [];
          if (Array.isArray(entry.scenes) && entry.scenes.length > 0) {
            sceneList = entry.scenes.filter((s) => s && typeof s.prompt === "string" && s.prompt.trim());
          } else if (Array.isArray(entry.prompts) && entry.prompts.length > 0) {
            sceneList = entry.prompts.map((p, i) => ({ name: `场景 ${i + 1}`, prompt: p }));
          }
          if (sceneList.length === 0) {
            failed.push({ seq: shot.sequence, err: "empty scenes/prompts" });
            continue;
          }

          const shotCharacters = Array.isArray(entry.characters) ? entry.characters : [];
          if (shotCharacters.length === 0) {
            console.warn(`[GenerateRefPrompts] Shot ${shot.sequence}: AI did not emit 'characters' field`);
          }
          await deleteAssetsByType(shot.id, "reference");
          for (let pi = 0; pi < sceneList.length; pi++) {
            const scene = sceneList[pi];
            await insertAssetVersion({
              shotId: shot.id,
              type: "reference",
              sequenceInType: pi,
              prompt: scene.prompt,
              status: "pending",
              characters: shotCharacters,
              meta: { sceneName: scene.name || `场景 ${pi + 1}` },
            });
          }
          updatedCount++;
          batchUpdated++;
          // Track the last successfully parsed shot in this batch — fed
          // into the next batch as continuity context.
          const lastScene = sceneList[sceneList.length - 1];
          lastEntryForContinuity = {
            sequence: shot.sequence,
            sceneName: lastScene.name,
            prompt: lastScene.prompt,
          };
        } catch (shotErr) {
          failed.push({ seq: shot.sequence, err: String(shotErr) });
        }
      }
      if (lastEntryForContinuity) previousBatchTail = lastEntryForContinuity;
      const elapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
      console.log(
        `[GenerateRefPrompts] ✓ batch ${bi + 1}/${batches.length} (${batch[0].sequence}..${batch[batch.length - 1].sequence}): ${batchUpdated}/${batch.length} shots in ${elapsed}s`
      );
    } catch (err) {
      const elapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
      console.warn(`[GenerateRefPrompts] ✗ batch ${bi + 1}/${batches.length} failed in ${elapsed}s: ${String(err)}`);
      for (const shot of batch) failed.push({ seq: shot.sequence, err: String(err) });
    }
  }

  if (failed.length > 0) {
    console.warn(`[GenerateRefPrompts] ${failed.length} shots failed:`, failed);
  }
  console.log(`[GenerateRefPrompts] Updated ${updatedCount}/${total} shots (sequential batched)`);
  return NextResponse.json({ updatedCount, totalShots: total });
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
  const imgOpts = ratioToImageOpts(ratio);
  const imageProvider = resolveImageProvider(modelConfig);

  let generated = 0;
  for (const entry of pending) {
    try {
      const fullPrompt = promptPrefix + entry.prompt;
      const imagePath = await imageProvider.generateImage(fullPrompt, {
        quality: "hd",
        ...imgOpts,
        referenceImages: charRefsForShot,
      });
      await insertAssetVersion({
        shotId,
        type: "reference",
        sequenceInType: entry.sequenceInType,
        prompt: entry.prompt,
        fileUrl: imagePath,
        status: "completed",
        characters: entry.characters ?? undefined,
      });
      generated++;
      console.log(`[RefImageGenAll] Shot ${shot.sequence}: generated ref "${entry.id}"`);
    } catch (err) {
      console.warn(`[RefImageGenAll] Shot ${shot.sequence} ref ${entry.id} failed:`, err);
    }
  }

  return NextResponse.json({ generated, total: pending.length });
}
