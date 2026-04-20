import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  episodes,
  shots,
  characters,
  episodeCharacters,
  visualAssets,
} from "@/lib/db/schema";
import { eq, asc, max, and, inArray } from "drizzle-orm";
import { id as genId } from "@/lib/id";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";

function parseSplitMeta(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await assertProjectOwnership(request, id);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allEpisodes = await db
    .select()
    .from(episodes)
    .where(eq(episodes.projectId, id))
    .orderBy(asc(episodes.sequence));

  const episodeIds = allEpisodes.map((ep) => ep.id);
  const charLinks =
    episodeIds.length > 0
      ? await db
          .select({
            episodeId: episodeCharacters.episodeId,
            characterName: characters.name,
          })
          .from(episodeCharacters)
          .innerJoin(characters, eq(episodeCharacters.characterId, characters.id))
          .where(inArray(episodeCharacters.episodeId, episodeIds))
      : [];

  const assetLinks =
    episodeIds.length > 0
      ? await db
          .select({
            episodeId: visualAssets.episodeId,
            type: visualAssets.type,
            name: visualAssets.name,
          })
          .from(visualAssets)
          .where(
            and(
              eq(visualAssets.projectId, id),
              inArray(visualAssets.episodeId, episodeIds)
            )
          )
      : [];

  const charsByEpisode = new Map<string, Set<string>>();
  for (const row of charLinks) {
    const key = row.episodeId;
    if (!charsByEpisode.has(key)) charsByEpisode.set(key, new Set<string>());
    charsByEpisode.get(key)?.add(row.characterName);
  }

  const scenesByEpisode = new Map<string, Set<string>>();
  const propsByEpisode = new Map<string, Set<string>>();
  for (const row of assetLinks) {
    if (!row.episodeId) continue;
    if (row.type === "scene") {
      if (!scenesByEpisode.has(row.episodeId)) {
        scenesByEpisode.set(row.episodeId, new Set<string>());
      }
      scenesByEpisode.get(row.episodeId)?.add(row.name);
    }
    if (row.type === "prop") {
      if (!propsByEpisode.has(row.episodeId)) {
        propsByEpisode.set(row.episodeId, new Set<string>());
      }
      propsByEpisode.get(row.episodeId)?.add(row.name);
    }
  }

  // Enrich each episode with preview images and linked resources for cards
  const enriched = await Promise.all(
    allEpisodes.map(async (ep) => {
      const linkedCharacters = [...(charsByEpisode.get(ep.id) || new Set<string>())];
      const linkedScenes = [...(scenesByEpisode.get(ep.id) || new Set<string>())];
      const linkedProps = [...(propsByEpisode.get(ep.id) || new Set<string>())];

      if (ep.finalVideoUrl) {
        return {
          ...ep,
          splitMeta: parseSplitMeta(ep.splitMeta),
          previewImages: [],
          characters: linkedCharacters,
          scenes: linkedScenes,
          props: linkedProps,
        };
      }

      // 1) Collect frame images from shot_assets, deduplicated
      const epShots = await db
        .select({ id: shots.id })
        .from(shots)
        .where(eq(shots.episodeId, ep.id));
      const { loadShotLegacyViewsBatch } = await import("@/lib/shot-asset-utils");
      const legacy = await loadShotLegacyViewsBatch(epShots.map((s) => s.id));

      const frameSet = new Set<string>();
      const isReference = ep.generationMode === "reference";
      for (const s of epShots) {
        const view = legacy.get(s.id);
        if (!view) continue;
        if (isReference) {
          if (view.sceneRefFrame) frameSet.add(view.sceneRefFrame);
        } else {
          if (view.firstFrame) frameSet.add(view.firstFrame);
          if (view.lastFrame) frameSet.add(view.lastFrame);
        }
      }

      if (frameSet.size > 0) {
        return {
          ...ep,
          splitMeta: parseSplitMeta(ep.splitMeta),
          previewImages: [...frameSet],
          characters: linkedCharacters,
          scenes: linkedScenes,
          props: linkedProps,
        };
      }

      // 2) Fall back to project-wide character reference images
      const charImages = await db
        .select({
          name: characters.name,
          referenceImage: characters.referenceImage,
        })
        .from(characters)
        .where(eq(characters.projectId, id));
      const charUrls = charImages
        .filter((c) => linkedCharacters.includes(c.name))
        .map((c) => c.referenceImage)
        .filter((url): url is string => !!url);

      return {
        ...ep,
        splitMeta: parseSplitMeta(ep.splitMeta),
        previewImages: charUrls,
        characters: linkedCharacters,
        scenes: linkedScenes,
        props: linkedProps,
      };
    })
  );

  return NextResponse.json(enriched);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await assertProjectOwnership(request, id);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as { title: string; description?: string; keywords?: string };

  // Get the max sequence number for this project
  const [result] = await db
    .select({ maxSeq: max(episodes.sequence) })
    .from(episodes)
    .where(eq(episodes.projectId, id));

  const nextSequence = (result?.maxSeq ?? 0) + 1;

  const [episode] = await db
    .insert(episodes)
    .values({
      id: genId(),
      projectId: id,
      title: body.title,
      description: body.description || "",
      keywords: body.keywords || "",
      colorPalette: project.colorPalette || "",
      sequence: nextSequence,
    })
    .returning();

  return NextResponse.json(episode, { status: 201 });
}
