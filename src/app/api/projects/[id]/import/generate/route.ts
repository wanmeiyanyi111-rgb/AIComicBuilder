import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  episodes,
  characters,
  episodeCharacters,
  characterRelations,
  visualAssets,
} from "@/lib/db/schema";
import { eq, max } from "drizzle-orm";
import { id as genId } from "@/lib/id";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { addImportLog } from "@/lib/import-utils";

export const maxDuration = 60;

interface EpisodeData {
  title: string;
  description: string;
  keywords: string;
  idea: string;
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
        sequence: seq++,
      })
      .returning();
    created.push(row);
  }

  // 3. Create episode_characters relations and per-episode scene/prop assets
  let relationCount = 0;
  let visualAssetCount = 0;
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

    const normalizeName = (value: string) => value.trim();
    const seenSceneNames = new Set<string>();
    for (const sceneName of epData.scenes || []) {
      const normalized = normalizeName(sceneName);
      if (!normalized) continue;
      const dedupeKey = normalized.toLowerCase();
      if (seenSceneNames.has(dedupeKey)) continue;
      seenSceneNames.add(dedupeKey);
      const prompt = scenePromptByName.get(dedupeKey) || normalized;
      await db.insert(visualAssets).values({
        id: genId(),
        projectId,
        episodeId,
        type: "scene",
        name: normalized,
        prompt,
        status: "pending",
        errorMessage: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      visualAssetCount++;
    }

    const seenPropNames = new Set<string>();
    for (const propName of epData.props || []) {
      const normalized = normalizeName(propName);
      if (!normalized) continue;
      const dedupeKey = normalized.toLowerCase();
      if (seenPropNames.has(dedupeKey)) continue;
      seenPropNames.add(dedupeKey);
      const prompt = propPromptByName.get(dedupeKey) || normalized;
      await db.insert(visualAssets).values({
        id: genId(),
        projectId,
        episodeId,
        type: "prop",
        name: normalized,
        prompt,
        status: "pending",
        errorMessage: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      visualAssetCount++;
    }
  }

  await addImportLog(
    projectId, 5, "done",
    `导入完成！创建了 ${body.characters.length} 个角色和 ${created.length} 集（${relationCount} 个角色分配，${visualAssetCount} 个场景/道具资产）`,
    {
      episodeCount: created.length,
      characterCount: body.characters.length,
      visualAssetCount,
    }
  );

  return NextResponse.json({
    episodes: created,
    characterCount: body.characters.length,
    visualAssetCount,
  }, { status: 201 });
}
