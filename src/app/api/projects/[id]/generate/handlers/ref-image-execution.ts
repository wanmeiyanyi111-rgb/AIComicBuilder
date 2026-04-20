import { db } from "@/lib/db";
import { characterRelations, shots } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { buildRefImagePromptsRequest } from "@/lib/ai/prompts/ref-image-prompts";
import { insertAssetVersion } from "@/lib/shot-asset-utils";
import type { ModelConfig } from "../types";
import {
  buildVisualStyleFromScript,
  getEpisodeCharacters,
  getScriptForScope,
  getVersionedUploadDir,
  ratioToImageOpts,
} from "../helpers";

export async function loadOrderedShots(params: {
  projectId: string;
  episodeId?: string;
  versionId?: string;
}) {
  const conditions = [eq(shots.projectId, params.projectId)];
  if (params.versionId) conditions.push(eq(shots.versionId, params.versionId));
  if (params.episodeId) conditions.push(eq(shots.episodeId, params.episodeId));
  return db
    .select()
    .from(shots)
    .where(and(...conditions))
    .orderBy(asc(shots.sequence));
}

export async function resolveVersionedUploadDir(versionId?: string) {
  return versionId
    ? getVersionedUploadDir(versionId)
    : process.env.UPLOAD_DIR || "./uploads";
}

export async function generateReferenceImages(params: {
  entries: Array<{
    id: string;
    prompt: string;
    sequenceInType: number;
    characters?: string[] | null;
  }>;
  generateImage: (
    prompt: string,
    options: Record<string, unknown>
  ) => Promise<string>;
  promptPrefix?: string;
  quality?: "hd";
  ratio: string;
  referenceImages?: string[];
  shotId: string;
  typeLabel: string;
}) {
  const imageOptions = {
    quality: params.quality ?? "hd",
    ...ratioToImageOpts(params.ratio),
    ...(params.referenceImages?.length
      ? { referenceImages: params.referenceImages }
      : {}),
  };

  let generated = 0;
  let failed = 0;
  for (const entry of params.entries) {
    try {
      const imagePath = await params.generateImage(
        `${params.promptPrefix || ""}${entry.prompt}`,
        imageOptions
      );
      await insertAssetVersion({
        shotId: params.shotId,
        type: "reference",
        sequenceInType: entry.sequenceInType,
        prompt: entry.prompt,
        fileUrl: imagePath,
        status: "completed",
        characters: entry.characters ?? undefined,
      });
      generated++;
      console.log(
        `[${params.typeLabel}] Shot ${params.shotId}: generated ref image "${entry.id}"`
      );
    } catch (err) {
      failed++;
      console.warn(
        `[${params.typeLabel}] Shot ${params.shotId}: failed ref image "${entry.id}":`,
        err
      );
    }
  }

  return { generated, failed };
}

function parseBatchPromptResponse(text: string) {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("invalid JSON response");
  }
  return JSON.parse(jsonMatch[0]) as Array<{
    shotSequence: number;
    characters?: string[];
    scenes?: Array<{ name: string; prompt: string }>;
    prompts?: string[];
  }>;
}

function normalizeSceneList(entry: {
  scenes?: Array<{ name: string; prompt: string }>;
  prompts?: string[];
}) {
  if (Array.isArray(entry.scenes) && entry.scenes.length > 0) {
    return entry.scenes.filter((item) => item && typeof item.prompt === "string" && item.prompt.trim());
  }
  if (Array.isArray(entry.prompts) && entry.prompts.length > 0) {
    return entry.prompts.map((prompt, index) => ({ name: `场景 ${index + 1}`, prompt }));
  }
  return [];
}

async function buildRefRelationsText(projectId: string, projectCharacters: Awaited<ReturnType<typeof getEpisodeCharacters>>) {
  const refRelations = await db
    .select()
    .from(characterRelations)
    .where(eq(characterRelations.projectId, projectId));

  if (refRelations.length === 0) return "";

  let text = "\n\n## 角色关系（必须用于决定场景空间规划）\n";
  for (const relation of refRelations) {
    const charA = projectCharacters.find((c) => c.id === relation.characterAId);
    const charB = projectCharacters.find((c) => c.id === relation.characterBId);
    if (charA && charB) {
      text += `- ${charA.name} ↔ ${charB.name}：${relation.relationType}${relation.description ? `（${relation.description}）` : ""}\n`;
    }
  }
  text += `
**关系驱动场景规划规则**：
- **敌对**：场景需要有明确的对峙空间轴线——两个站位点之间留出视觉通道。
- **友好/父女/师徒**：场景留出并肩站位的空间。
- 这些只影响场景帧的空间布局（景别/构图/空间轴线），场景帧本身**仍然不画任何人物**。
`;
  return text;
}

export async function executeReferencePromptGeneration(params: {
  episodeId?: string;
  modelConfig?: ModelConfig;
  projectId: string;
  userId: string;
  versionId?: string;
}) {
  type BatchTail = { sequence: number; sceneName?: string; prompt: string } | null;
  const buildWhereVersionIds = [params.versionId, undefined].filter(
    (value, index, arr) => value || index === arr.length - 1
  ) as Array<string | undefined>;

  let allShots: Awaited<ReturnType<typeof loadOrderedShots>> = [];
  for (const versionId of buildWhereVersionIds) {
    allShots = await loadOrderedShots({
      projectId: params.projectId,
      episodeId: params.episodeId,
      versionId,
    });
    if (allShots.length > 0 || !versionId) break;
    console.warn(
      `[GenerateRefPrompts] strict filter empty (versionId=${versionId}), falling back to no-version filter`
    );
  }

  if (allShots.length === 0) {
    throw new Error("No shots found");
  }

  const projectCharacters = await getEpisodeCharacters(
    params.projectId,
    params.episodeId
  );
  const script = await getScriptForScope(params.projectId, params.episodeId);
  const visualStyle = buildVisualStyleFromScript(script);
  const refRelationsText = await buildRefRelationsText(
    params.projectId,
    projectCharacters
  );
  const refImageSystem = await resolvePrompt("ref_image_prompts", {
    userId: params.userId,
    projectId: params.projectId,
  });
  const { deleteAssetsByType } = await import("@/lib/shot-asset-utils");
  const textProvider = (await import("@/lib/ai/provider-factory")).resolveAIProvider(
    params.modelConfig
  );

  const total = allShots.length;
  const batchSize = 8;
  const batches: typeof allShots[] = [];
  for (let index = 0; index < allShots.length; index += batchSize) {
    batches.push(allShots.slice(index, index + batchSize));
  }

  console.log(
    `[GenerateRefPrompts] Starting sequential batched generation: ${batches.length} batch(es) of up to ${batchSize} shots, total ${total}`
  );

  let updatedCount = 0;
  const failed: Array<{ seq: number; err: string }> = [];
  let previousBatchTail: BatchTail = null;

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const batchStart = Date.now();
    try {
      const baseRefRequest = buildRefImagePromptsRequest(
        batch.map((shot) => ({
          sequence: shot.sequence,
          prompt: shot.prompt || "",
          motionScript: shot.motionScript,
          cameraDirection: shot.cameraDirection,
          duration: shot.duration,
        })),
        projectCharacters.map((character) => ({
          name: character.name,
          description: character.description,
        })),
        visualStyle
      );

      let promptRequest = refRelationsText
        ? baseRefRequest + refRelationsText
        : baseRefRequest;

      if (previousBatchTail) {
        promptRequest += `\n\n## 剧情连续性上下文\n本批次的镜头 ${batch[0].sequence} 紧接上一批次镜头 ${previousBatchTail.sequence} 之后。上一个镜头的结束场景是"${previousBatchTail.sceneName || "未命名"}"：${previousBatchTail.prompt.slice(0, 160)}...\n请让本批次第一个镜头的场景在空间/光线/色调上与之自然衔接，避免突兀重置到"起始场景"风格。`;
      }

      const parsed = parseBatchPromptResponse(
        await textProvider.generateText(promptRequest, {
          systemPrompt: refImageSystem,
          temperature: 0.7,
        })
      );

      let batchUpdated = 0;
      let lastEntryForContinuity: BatchTail = null;
      for (const shot of batch) {
        try {
          const entry = parsed.find((item) => item.shotSequence === shot.sequence);
          if (!entry) {
            failed.push({ seq: shot.sequence, err: "missing from batch output" });
            continue;
          }

          const sceneList = normalizeSceneList(entry);
          if (sceneList.length === 0) {
            failed.push({ seq: shot.sequence, err: "empty scenes/prompts" });
            continue;
          }

          const shotCharacters = Array.isArray(entry.characters) ? entry.characters : [];
          if (shotCharacters.length === 0) {
            console.warn(
              `[GenerateRefPrompts] Shot ${shot.sequence}: AI did not emit 'characters' field`
            );
          }

          await deleteAssetsByType(shot.id, "reference");
          for (let index = 0; index < sceneList.length; index++) {
            const scene = sceneList[index];
            await insertAssetVersion({
              shotId: shot.id,
              type: "reference",
              sequenceInType: index,
              prompt: scene.prompt,
              status: "pending",
              characters: shotCharacters,
              meta: { sceneName: scene.name || `场景 ${index + 1}` },
            });
          }

          updatedCount++;
          batchUpdated++;
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
      console.warn(
        `[GenerateRefPrompts] ✗ batch ${bi + 1}/${batches.length} failed in ${elapsed}s: ${String(err)}`
      );
      for (const shot of batch) {
        failed.push({ seq: shot.sequence, err: String(err) });
      }
    }
  }

  if (failed.length > 0) {
    console.warn(`[GenerateRefPrompts] ${failed.length} shots failed:`, failed);
  }
  console.log(
    `[GenerateRefPrompts] Updated ${updatedCount}/${total} shots (sequential batched)`
  );

  return { totalShots: total, updatedCount };
}
