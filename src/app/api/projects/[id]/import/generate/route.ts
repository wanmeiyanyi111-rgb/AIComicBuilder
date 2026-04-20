import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  episodes,
  characters,
  episodeCharacters,
  characterRelations,
  projects,
} from "@/lib/db/schema";
import { eq, max } from "drizzle-orm";
import { id as genId } from "@/lib/id";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { addImportLog } from "@/lib/import-utils";
import { ensureEpisodeVisualAsset, normalizeScopedResourceName } from "@/lib/episode-resources";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { hasTextModelConfig } from "@/lib/ai/config-presence";
import {
  buildEpisodeScriptReviewPatch,
  generateScriptText,
} from "../../generate/handlers/script";

export const maxDuration = 300;

interface EpisodeData {
  title: string;
  description: string;
  keywords: string;
  idea: string;
  storyMode?: string;
  targetDurationSec?: number;
  durationMinSec?: number;
  durationMaxSec?: number;
  estimatedDurationSec?: number;
  hook?: string;
  coreConflict?: string;
  turningPoint?: string;
  cliffhanger?: string;
  pacingNotes?: string;
  beats?: Array<{ name: string; durationSec: number; summary: string }>;
  validationIssues?: string[];
  characters?: string[];
  scenes?: string[];
  props?: string[];
}

interface CharacterData {
  name: string;
  scope: "main" | "guest";
  description: string;
  visualHint?: string;
}

interface ScenePropCandidate {
  name: string;
  prompt: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const project = await assertProjectOwnership(request, projectId);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    episodes: EpisodeData[];
    characters: CharacterData[];
    relationships?: Array<{
      characterA: string;
      characterB: string;
      relationType: string;
      description?: string;
    }>;
    sceneCandidates?: ScenePropCandidate[];
    propCandidates?: ScenePropCandidate[];
    modelConfig?: { text?: ProviderConfig | null };
    autoGenerateScripts?: boolean;
  };

  const scenePromptByName = new Map<string, string>();
  for (const item of body.sceneCandidates || []) {
    const key = item.name.toLowerCase().trim();
    if (!key) continue;
    scenePromptByName.set(key, item.prompt?.trim() || item.name);
  }
  const propPromptByName = new Map<string, string>();
  for (const item of body.propCandidates || []) {
    const key = item.name.toLowerCase().trim();
    if (!key) continue;
    propPromptByName.set(key, item.prompt?.trim() || item.name);
  }

  await addImportLog(
    projectId, 5, "running",
    `开始创建 ${body.episodes.length} 集和 ${body.characters.length} 个角色`
  );

  // 1. Create all characters (main + guest), build name→id map
  const charIdByName = new Map<string, string>();
  for (const char of body.characters) {
    const charId = genId();
    await db.insert(characters).values({
      id: charId,
      projectId,
      name: char.name,
      description: char.description,
      visualHint: char.visualHint ?? "",
      scope: char.scope,
      episodeId: null, // all characters are project-level now
    });
    charIdByName.set(char.name.toLowerCase().trim(), charId);
  }

  // 1b. Create character relationships
  if (body.relationships?.length) {
    for (const rel of body.relationships) {
      const aId = charIdByName.get(rel.characterA.toLowerCase().trim());
      const bId = charIdByName.get(rel.characterB.toLowerCase().trim());
      if (aId && bId && aId !== bId) {
        try {
          await db.insert(characterRelations).values({
            id: genId(),
            projectId,
            characterAId: aId,
            characterBId: bId,
            relationType: rel.relationType || "neutral",
            description: rel.description || "",
          });
        } catch {
          // skip duplicates
        }
      }
    }
  }

  await addImportLog(
    projectId, 5, "running",
    `已创建 ${body.characters.length} 个角色${body.relationships?.length ? `和 ${body.relationships.length} 个关系` : ""}`
  );

  // 2. Create episodes
  const [seqResult] = await db
    .select({ maxSeq: max(episodes.sequence) })
    .from(episodes)
    .where(eq(episodes.projectId, projectId));

  let seq = (seqResult?.maxSeq ?? 0) + 1;

  const created = [];
  for (const ep of body.episodes) {
    const [row] = await db
      .insert(episodes)
      .values({
        id: genId(),
        projectId,
        title: ep.title,
        description: ep.description || "",
        keywords: ep.keywords || "",
        idea: ep.idea || "",
        colorPalette: project.colorPalette || "",
        targetDuration: ep.targetDurationSec || 150,
        splitMeta: JSON.stringify({
          storyMode: ep.storyMode || "short_drama",
          targetDurationSec: ep.targetDurationSec || 150,
          durationMinSec: ep.durationMinSec || 120,
          durationMaxSec: ep.durationMaxSec || 180,
          estimatedDurationSec: ep.estimatedDurationSec || ep.targetDurationSec || 150,
          hook: ep.hook || "",
          coreConflict: ep.coreConflict || "",
          turningPoint: ep.turningPoint || "",
          cliffhanger: ep.cliffhanger || "",
          pacingNotes: ep.pacingNotes || "",
          beats: ep.beats || [],
          validationIssues: ep.validationIssues || [],
        }),
        sequence: seq++,
      })
      .returning();
    created.push(row);
  }

  if (!project.targetDuration || project.targetDuration <= 0) {
    await db
      .update(projects)
      .set({
        targetDuration: 150,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));
  }

  // 3. Create episode_characters relations and per-episode scene/prop assets
  let relationCount = 0;
  let visualAssetCount = 0;
  let generatedScriptCount = 0;
  const scriptDurationSummary: Record<"short" | "ok" | "long", number> = {
    short: 0,
    ok: 0,
    long: 0,
  };
  for (let i = 0; i < body.episodes.length; i++) {
    const epData = body.episodes[i];
    const episodeId = created[i]?.id;
    if (!episodeId) continue;

    if (epData.characters?.length) {
      const seenCharacterIds = new Set<string>();
      for (const charName of epData.characters) {
        const charId = charIdByName.get(charName.toLowerCase().trim());
        if (!charId || seenCharacterIds.has(charId)) continue;
        seenCharacterIds.add(charId);
        await db.insert(episodeCharacters).values({
          id: genId(),
          episodeId,
          characterId: charId,
        });
        relationCount++;
      }
    }

    const seenSceneNames = new Set<string>();
    for (const sceneName of epData.scenes || []) {
      const normalized = normalizeScopedResourceName(sceneName);
      if (!normalized) continue;
      const dedupeKey = normalized.toLowerCase();
      if (seenSceneNames.has(dedupeKey)) continue;
      seenSceneNames.add(dedupeKey);
      const prompt = scenePromptByName.get(dedupeKey) || normalized;
      const result = await ensureEpisodeVisualAsset({
        projectId,
        episodeId,
        type: "scene",
        name: normalized,
        prompt,
        updatePromptIfExists: false,
      });
      if (result.created) visualAssetCount++;
    }

    const seenPropNames = new Set<string>();
    for (const propName of epData.props || []) {
      const normalized = normalizeScopedResourceName(propName);
      if (!normalized) continue;
      const dedupeKey = normalized.toLowerCase();
      if (seenPropNames.has(dedupeKey)) continue;
      seenPropNames.add(dedupeKey);
      const prompt = propPromptByName.get(dedupeKey) || normalized;
      const result = await ensureEpisodeVisualAsset({
        projectId,
        episodeId,
        type: "prop",
        name: normalized,
        prompt,
        updatePromptIfExists: false,
      });
      if (result.created) visualAssetCount++;
    }
  }

  const shouldAutoGenerateScripts =
    body.autoGenerateScripts === true && hasTextModelConfig(body.modelConfig);

  if (shouldAutoGenerateScripts) {
    for (let i = 0; i < body.episodes.length; i++) {
      const episodeId = created[i]?.id;
      const epData = body.episodes[i];
      if (!episodeId || !epData?.idea?.trim()) continue;
      await addImportLog(
        projectId,
        5,
        "running",
        `正在生成第 ${i + 1}/${body.episodes.length} 集剧本：${epData.title || `第${i + 1}集`}`
      );
      try {
        const scriptText = await generateScriptText(
          projectId,
          project.userId,
          epData.idea,
          body.modelConfig,
          episodeId
        );
        const { patch, durationReview } = await buildEpisodeScriptReviewPatch(
          episodeId,
          scriptText
        );
        await db
          .update(episodes)
          .set(patch)
          .where(eq(episodes.id, episodeId));
        generatedScriptCount++;
        if (durationReview) {
          scriptDurationSummary[durationReview.status] += 1;
          await addImportLog(
            projectId,
            5,
            "running",
            `第 ${i + 1} 集剧本复核约 ${durationReview.estimatedDurationSec}s（${durationReview.status === "ok" ? "达标" : durationReview.status === "long" ? "偏长" : "偏短"}）`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        await addImportLog(
          projectId,
          5,
          "running",
          `第 ${i + 1} 集剧本生成失败：${msg}`
        );
      }
    }
  }

  await addImportLog(
    projectId, 5, "done",
    `导入完成！创建了 ${body.characters.length} 个角色和 ${created.length} 集（${relationCount} 个角色分配，${visualAssetCount} 个场景/道具资产，${generatedScriptCount} 集剧本）`,
    {
      episodeCount: created.length,
      characterCount: body.characters.length,
      visualAssetCount,
      generatedScriptCount,
      scriptDurationSummary,
    }
  );

  return NextResponse.json({
    episodes: created,
    characterCount: body.characters.length,
    visualAssetCount,
    generatedScriptCount,
    scriptDurationSummary,
  }, { status: 201 });
}
