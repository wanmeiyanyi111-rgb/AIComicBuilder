import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  episodes,
  shots,
  characters,
  dialogues,
  storyboardVersions,
} from "@/lib/db/schema";
import { eq, asc, and, desc, inArray } from "drizzle-orm";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { markDownstreamStale } from "@/lib/staleness";
import { resolveProjectStyleFromSource } from "@/lib/project-style";
import { getScopedEpisodeCharacters } from "@/lib/episode-resources";
import { normalizeRuntimeGenerationMode } from "@/lib/generation-mode";
import {
  parseStoryboardResolvedResourceSnapshot,
  parseStoryboardWorkflowState,
} from "@/lib/storyboard/shot-workflow";

function parseSplitMeta(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function resolveEpisode(projectId: string, episodeId: string) {
  const [episode] = await db
    .select()
    .from(episodes)
    .where(
      and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId))
    );

  return episode ?? null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id, episodeId } = await params;
  const project = await assertProjectOwnership(request, id);
  const episode = project ? await resolveEpisode(id, episodeId) : null;

  if (!project || !episode) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const versionId = url.searchParams.get("versionId") ?? undefined;

  // Fetch versions for this episode
  const allVersions = await db
    .select()
    .from(storyboardVersions)
    .where(
      and(
        eq(storyboardVersions.projectId, id),
        eq(storyboardVersions.episodeId, episodeId)
      )
    )
    .orderBy(desc(storyboardVersions.versionNum));

  const resolvedVersionId = versionId ?? allVersions[0]?.id;

  const epCharacters = await getScopedEpisodeCharacters(id, episodeId);

  // Fetch shots for this episode + version
  const episodeShots = resolvedVersionId
    ? await db
        .select()
        .from(shots)
        .where(
          and(
            eq(shots.projectId, id),
            eq(shots.episodeId, episodeId),
            eq(shots.versionId, resolvedVersionId)
          )
        )
        .orderBy(asc(shots.sequence))
    : [];

  // Bulk-load ALL shot assets (all versions, not just active) so the UI
  // can render version history arrows and switch between historical fileUrls.
  const { shotAssets } = await import("@/lib/db/schema");
  const { desc: descOrder } = await import("drizzle-orm");
  const assetRows = episodeShots.length
    ? await db
        .select()
        .from(shotAssets)
        .where(inArray(shotAssets.shotId, episodeShots.map((s) => s.id)))
        .orderBy(shotAssets.type, shotAssets.sequenceInType, descOrder(shotAssets.assetVersion))
    : [];
  const assetsByShot = new Map<string, typeof assetRows>();
  for (const row of assetRows) {
    if (!assetsByShot.has(row.shotId)) assetsByShot.set(row.shotId, []);
    assetsByShot.get(row.shotId)!.push(row);
  }

  // Enrich each shot with its dialogues + active asset rows
  const enrichedShots = await Promise.all(
    episodeShots.map(async (shot) => {
      const shotDialogues = await db
        .select({
          id: dialogues.id,
          text: dialogues.text,
          characterId: dialogues.characterId,
          characterName: characters.name,
          sequence: dialogues.sequence,
        })
        .from(dialogues)
        .innerJoin(characters, eq(dialogues.characterId, characters.id))
        .where(eq(dialogues.shotId, shot.id))
        .orderBy(asc(dialogues.sequence));
      const assets = (assetsByShot.get(shot.id) ?? []).map((a) => ({
        id: a.id,
        shotId: a.shotId,
        type: a.type,
        sequenceInType: a.sequenceInType,
        assetVersion: a.assetVersion,
        isActive: a.isActive,
        prompt: a.prompt,
        fileUrl: a.fileUrl,
        status: a.status,
        characters: a.characters ? JSON.parse(a.characters) : null,
        modelProvider: a.modelProvider,
        modelId: a.modelId,
        meta: a.meta ? JSON.parse(a.meta) : null,
      }));
      return {
        ...shot,
        workflowState: parseStoryboardWorkflowState(shot.workflowState),
        resolvedResourceSnapshot: parseStoryboardResolvedResourceSnapshot(
          shot.resolvedResourceSnapshot
        ),
        dialogues: shotDialogues,
        assets,
      };
    })
  );

  const normalizedStyle = resolveProjectStyleFromSource({
    styleId: project.styleId,
    worldSetting: project.worldSetting,
    colorPalette: project.colorPalette,
  });

  return NextResponse.json({
    ...episode,
    splitMeta: parseSplitMeta(episode.splitMeta),
    id: project.id,
    episodeId: episode.id,
    title: project.title,
    styleId: normalizedStyle.styleId,
    worldSetting: project.worldSetting,
    colorPalette: episode.colorPalette || project.colorPalette,
    idea: episode.idea,
    script: episode.script,
    status: episode.status,
    finalVideoUrl: episode.finalVideoUrl,
    generationMode: normalizeRuntimeGenerationMode(episode.generationMode),
    characters: epCharacters,
    shots: enrichedShots,
    versions: allVersions.map((v) => ({
      id: v.id,
      label: v.label,
      versionNum: v.versionNum,
      createdAt:
        v.createdAt instanceof Date
          ? Math.floor(v.createdAt.getTime() / 1000)
          : v.createdAt,
    })),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id, episodeId } = await params;
  const project = await assertProjectOwnership(request, id);
  const episode = project ? await resolveEpisode(id, episodeId) : null;

  if (!project || !episode) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as Partial<{
    title: string;
    description: string;
    keywords: string;
    idea: string;
    script: string;
    outline: string;
    status: "draft" | "processing" | "completed";
    generationMode: "storyboard_grid" | "keyframe" | "reference";
    targetDuration: number;
    splitMeta: Record<string, unknown> | string | null;
  }>;

  const {
    title,
    description,
    keywords,
    idea,
    script,
    outline,
    status,
    generationMode,
    targetDuration,
    splitMeta,
  } = body;

  const [updated] = await db
    .update(episodes)
    .set({
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(keywords !== undefined && { keywords }),
      ...(idea !== undefined && { idea }),
      ...(script !== undefined && { script }),
      ...(outline !== undefined && { outline }),
      ...(status !== undefined && { status }),
      ...(generationMode !== undefined && {
        generationMode: normalizeRuntimeGenerationMode(generationMode),
      }),
      ...(targetDuration !== undefined && { targetDuration }),
      ...(splitMeta !== undefined && {
        splitMeta:
          splitMeta === null
            ? ""
            : typeof splitMeta === "string"
              ? splitMeta
              : JSON.stringify(splitMeta),
      }),
      updatedAt: new Date(),
    })
    .where(eq(episodes.id, episodeId))
    .returning();

  if (script !== undefined) {
    await markDownstreamStale("episode", episodeId);
  }

  return NextResponse.json({
    ...updated,
    generationMode: normalizeRuntimeGenerationMode(updated.generationMode),
    splitMeta: parseSplitMeta(updated.splitMeta),
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id, episodeId } = await params;
  const project = await assertProjectOwnership(request, id);
  const episode = project ? await resolveEpisode(id, episodeId) : null;

  if (!project || !episode) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Refuse to delete the last episode
  const allEpisodes = await db
    .select()
    .from(episodes)
    .where(eq(episodes.projectId, id));

  if (allEpisodes.length <= 1) {
    return NextResponse.json(
      { error: "Cannot delete the last episode" },
      { status: 400 }
    );
  }

  await db.delete(episodes).where(eq(episodes.id, episodeId));
  return new NextResponse(null, { status: 204 });
}
