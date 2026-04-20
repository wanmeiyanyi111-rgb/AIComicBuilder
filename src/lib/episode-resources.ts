import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { characters, episodeCharacters, visualAssets } from "@/lib/db/schema";
import { id as genId } from "@/lib/id";

type CharacterRow = typeof characters.$inferSelect;
type VisualAssetRow = typeof visualAssets.$inferSelect;
type VisualAssetInsert = typeof visualAssets.$inferInsert;
type VisualAssetType = "scene" | "prop";

export function normalizeScopedResourceName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function buildScopedVisualAssetKey(type: string, name: string): string {
  return `${type}:${normalizeScopedResourceName(name).toLowerCase()}`;
}

export async function getScopedEpisodeCharacters(
  projectId: string,
  episodeId?: string | null
): Promise<CharacterRow[]> {
  if (!episodeId) {
    return db
      .select()
      .from(characters)
      .where(eq(characters.projectId, projectId))
      .orderBy(asc(characters.name));
  }

  const [linkedRows, directRows] = await Promise.all([
    db
      .select({ characterId: episodeCharacters.characterId })
      .from(episodeCharacters)
      .innerJoin(characters, eq(episodeCharacters.characterId, characters.id))
      .where(
        and(
          eq(episodeCharacters.episodeId, episodeId),
          eq(characters.projectId, projectId)
        )
      ),
    db
      .select({ id: characters.id })
      .from(characters)
      .where(
        and(
          eq(characters.projectId, projectId),
          eq(characters.episodeId, episodeId)
        )
      ),
  ]);

  const ids = [...linkedRows.map((row) => row.characterId), ...directRows.map((row) => row.id)];
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(characters)
    .where(
      and(
        eq(characters.projectId, projectId),
        inArray(characters.id, uniqueIds)
      )
    )
    .orderBy(asc(characters.name));
}

export function pickReusableVisualAssetSource(
  rows: VisualAssetRow[],
  params: {
    episodeId?: string | null;
    type: VisualAssetType;
    name: string;
  }
): {
  currentEpisodeMatch?: VisualAssetRow;
  reusableSource?: VisualAssetRow;
} {
  const key = buildScopedVisualAssetKey(params.type, params.name);
  const currentEpisodeMatch = rows.find(
    (row) =>
      row.episodeId === (params.episodeId ?? null) &&
      buildScopedVisualAssetKey(row.type, row.name) === key
  );
  if (currentEpisodeMatch) {
    return { currentEpisodeMatch };
  }

  const reusableSource = [...rows]
    .filter((row) => buildScopedVisualAssetKey(row.type, row.name) === key)
    .sort((a, b) => {
      const aCompleted = a.status === "completed" && !!a.imageUrl ? 1 : 0;
      const bCompleted = b.status === "completed" && !!b.imageUrl ? 1 : 0;
      if (aCompleted !== bCompleted) return bCompleted - aCompleted;

      const aUpdated = new Date(a.updatedAt).getTime();
      const bUpdated = new Date(b.updatedAt).getTime();
      return bUpdated - aUpdated;
    })[0];

  return reusableSource ? { reusableSource } : {};
}

export async function ensureEpisodeVisualAsset(params: {
  projectId: string;
  episodeId?: string | null;
  type: VisualAssetType;
  name: string;
  prompt?: string;
  updatePromptIfExists?: boolean;
}): Promise<{
  asset: VisualAssetRow;
  created: boolean;
  reusedSourceId?: string;
}> {
  const episodeId = params.episodeId ?? null;
  const name = normalizeScopedResourceName(params.name);
  const prompt = normalizeScopedResourceName(params.prompt || "") || name;
  const now = new Date();

  const candidateRows = await db
    .select()
    .from(visualAssets)
    .where(
      and(
        eq(visualAssets.projectId, params.projectId),
        eq(visualAssets.type, params.type)
      )
    );

  const { currentEpisodeMatch, reusableSource } = pickReusableVisualAssetSource(
    candidateRows,
    {
      episodeId,
      type: params.type,
      name,
    }
  );

  if (currentEpisodeMatch) {
    if (
      params.updatePromptIfExists &&
      normalizeScopedResourceName(currentEpisodeMatch.prompt || "") !== prompt
    ) {
      const [updated] = await db
        .update(visualAssets)
        .set({
          name,
          prompt,
          updatedAt: now,
        })
        .where(eq(visualAssets.id, currentEpisodeMatch.id))
        .returning();
      return { asset: updated, created: false };
    }

    return { asset: currentEpisodeMatch, created: false };
  }

  const canReuseImage = reusableSource?.status === "completed" && !!reusableSource.imageUrl;
  const insertRow: VisualAssetInsert = {
    id: genId(),
    projectId: params.projectId,
    episodeId,
    type: params.type,
    name,
    prompt: reusableSource?.prompt?.trim() || prompt,
    imageUrl: canReuseImage ? reusableSource.imageUrl : null,
    status: canReuseImage ? "completed" : "pending",
    errorMessage: "",
    modelProvider: canReuseImage ? reusableSource?.modelProvider || null : null,
    modelId: canReuseImage ? reusableSource?.modelId || null : null,
    createdAt: now,
    updatedAt: now,
  };

  const [created] = await db.insert(visualAssets).values(insertRow).returning();
  return {
    asset: created,
    created: true,
    reusedSourceId: reusableSource?.id,
  };
}
