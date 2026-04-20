import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { dialogues, shots, visualAssets } from "@/lib/db/schema";
import { getScopedEpisodeCharacters } from "@/lib/episode-resources";
import {
  buildStoryboardResourceConfidence,
  persistShotResolvedResourceSnapshot,
  type StoryboardResolvedResourceSnapshot,
} from "@/lib/storyboard/shot-workflow";

type VisualAssetKind = "scene" | "prop";

export type StoryboardReference = {
  kind: "character" | VisualAssetKind | "panel";
  label: string;
  imageUrl: string;
};

export type StoryboardShotResourceContext = {
  characters: Awaited<ReturnType<typeof getScopedEpisodeCharacters>>;
  matchedCharacterIds: string[];
  matchedCharacterNames: string[];
  matchedScenes: Array<typeof visualAssets.$inferSelect>;
  matchedProps: Array<typeof visualAssets.$inferSelect>;
  referenceImages: StoryboardReference[];
  resourceSummary: string;
  resourceSnapshot: StoryboardResolvedResourceSnapshot;
};

function normalizeText(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function includesLoose(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  return haystack.includes(needle.toLowerCase());
}

function dedupeReferences(items: StoryboardReference[]): StoryboardReference[] {
  const seen = new Set<string>();
  const result: StoryboardReference[] = [];
  for (const item of items) {
    const key = `${item.kind}:${item.label}:${item.imageUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export async function loadEpisodeVisualAssets(
  projectId: string,
  episodeId?: string
) {
  const conditions = [eq(visualAssets.projectId, projectId)];
  if (episodeId) conditions.push(eq(visualAssets.episodeId, episodeId));
  return db
    .select()
    .from(visualAssets)
    .where(and(...conditions))
    .orderBy(asc(visualAssets.type), asc(visualAssets.name));
}

export async function buildStoryboardShotResourceContext(params: {
  projectId: string;
  episodeId?: string;
  shot: Pick<
    typeof shots.$inferSelect,
    "id" | "prompt" | "motionScript" | "videoScript" | "sceneId"
  >;
}) : Promise<StoryboardShotResourceContext> {
  const [characters, assets, shotDialogues] = await Promise.all([
    getScopedEpisodeCharacters(params.projectId, params.episodeId),
    loadEpisodeVisualAssets(params.projectId, params.episodeId),
    db
      .select({ text: dialogues.text })
      .from(dialogues)
      .where(eq(dialogues.shotId, params.shot.id))
      .orderBy(asc(dialogues.sequence)),
  ]);

  const corpus = normalizeText(
    [
      params.shot.prompt,
      params.shot.motionScript,
      params.shot.videoScript,
      ...shotDialogues.map((row) => row.text),
    ].join("\n")
  );

  const matchedCharacters = characters.filter((character) =>
    includesLoose(corpus, normalizeText(character.name))
  );
  const matchedScenes = assets.filter(
    (asset) =>
      asset.type === "scene" &&
      asset.status === "completed" &&
      !!asset.imageUrl &&
      (includesLoose(corpus, normalizeText(asset.name)) ||
        includesLoose(corpus, normalizeText(asset.prompt)))
  );
  const matchedProps = assets.filter(
    (asset) =>
      asset.type === "prop" &&
      asset.status === "completed" &&
      !!asset.imageUrl &&
      (includesLoose(corpus, normalizeText(asset.name)) ||
        includesLoose(corpus, normalizeText(asset.prompt)))
  );

  const fallbackScene =
    matchedScenes[0] ??
    assets.find(
      (asset) => asset.type === "scene" && asset.status === "completed" && !!asset.imageUrl
    );

  const references = dedupeReferences([
    ...matchedCharacters
      .filter((character) => !!character.referenceImage)
      .map((character) => ({
        kind: "character" as const,
        label: character.name,
        imageUrl: character.referenceImage as string,
      })),
    ...(fallbackScene?.imageUrl
      ? [
          {
            kind: "scene" as const,
            label: fallbackScene.name,
            imageUrl: fallbackScene.imageUrl,
          },
        ]
      : []),
    ...matchedProps
      .filter((asset) => !!asset.imageUrl)
      .slice(0, 2)
      .map((asset) => ({
        kind: "prop" as const,
        label: asset.name,
        imageUrl: asset.imageUrl as string,
      })),
  ]).slice(0, 4);

  const summaryParts: string[] = [];
  if (matchedCharacters.length > 0) {
    summaryParts.push(
      `角色参考：${matchedCharacters
        .map((character) => `${character.name}（${character.visualHint || character.description || "无额外视觉备注"}）`)
        .join("；")}`
    );
  }
  if (fallbackScene) {
    summaryParts.push(`场景参考：${fallbackScene.name}｜${fallbackScene.prompt || fallbackScene.name}`);
  }
  if (matchedProps.length > 0) {
    summaryParts.push(
      `道具参考：${matchedProps
        .map((asset) => `${asset.name}｜${asset.prompt || asset.name}`)
        .join("；")}`
    );
  }

  const resourceSnapshot: StoryboardResolvedResourceSnapshot = {
    matchedCharacterIds: matchedCharacters.map((character) => character.id),
    matchedCharacterNames: matchedCharacters.map((character) => character.name),
    matchedSceneAssetIds: fallbackScene ? [fallbackScene.id] : [],
    matchedPropAssetIds: matchedProps.map((asset) => asset.id),
    referenceImages: references,
    resourceSummary: summaryParts.join("\n"),
    resourceConfidence: buildStoryboardResourceConfidence({
      matchedCharacterCount: matchedCharacters.length,
      matchedSceneCount: fallbackScene ? 1 : 0,
      matchedPropCount: matchedProps.length,
      referenceCount: references.length,
    }),
    updatedAt: new Date().toISOString(),
  };

  await persistShotResolvedResourceSnapshot(params.shot.id, resourceSnapshot);

  return {
    characters,
    matchedCharacterIds: matchedCharacters.map((character) => character.id),
    matchedCharacterNames: matchedCharacters.map((character) => character.name),
    matchedScenes: fallbackScene ? [fallbackScene] : [],
    matchedProps,
    referenceImages: references,
    resourceSummary: summaryParts.join("\n"),
    resourceSnapshot,
  };
}
