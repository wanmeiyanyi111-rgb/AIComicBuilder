import { db } from "@/lib/db";
import {
  shots,
  characters,
  projects,
  episodes,
  characterCostumes,
  visualAssets,
} from "@/lib/db/schema";
import { resolveImageProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import {
  buildFirstFramePrompt,
  buildLastFramePrompt,
} from "@/lib/ai/prompts/frame-generate";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { eq } from "drizzle-orm";
import type { Task } from "@/lib/task-queue";
import { getActiveAsset, insertAssetVersion, patchAsset } from "@/lib/shot-asset-utils";

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

export async function handleFrameGenerate(task: Task) {
  const payload = task.payload as {
    shotId: string;
    projectId: string;
    userId?: string;
    modelConfig?: ModelConfigPayload;
  };

  const [shot] = await db
    .select()
    .from(shots)
    .where(eq(shots.id, payload.shotId));

  if (!shot) throw new Error("Shot not found");

  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, payload.projectId));

  // Parse costume overrides from shot
  const rawCostumeOverrides = shot.costumeOverrides as string | null | undefined;
  const costumeOverrides: Record<string, string> = rawCostumeOverrides && rawCostumeOverrides.trim()
    ? JSON.parse(rawCostumeOverrides)
    : {};

  // Build character descriptions, applying costume overrides when present
  const characterDescParts: string[] = [];
  for (const c of projectCharacters) {
    let description = c.description;
    const costumeId = costumeOverrides[c.id];
    if (costumeId) {
      const [costume] = await db
        .select()
        .from(characterCostumes)
        .where(eq(characterCostumes.id, costumeId));
      if (costume?.description) {
        description = `${c.description}. Current outfit: ${costume.description}`;
      }
    }
    let desc = `${c.name}: ${description}`;
    if (c.performanceStyle) {
      desc += ` [Performance: ${c.performanceStyle}]`;
    }
    characterDescParts.push(desc);
  }
  const characterDescriptions = characterDescParts.join("\n");

  const ai = resolveImageProvider(payload.modelConfig);

  const userId = payload.userId ?? "";
  const projectId = payload.projectId;
  const frameFirstSlots = await resolveSlotContents("frame_generate_first", { userId, projectId });
  const frameLastSlots = await resolveSlotContents("frame_generate_last", { userId, projectId });

  // Fetch color palette from project (or episode)
  let colorPalette = "";
  if (shot.episodeId) {
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, shot.episodeId));
    if (episode?.colorPalette) colorPalette = episode.colorPalette;
  }
  if (!colorPalette) {
    const [project] = await db.select().from(projects).where(eq(projects.id, payload.projectId));
    if (project?.colorPalette) colorPalette = project.colorPalette;
  }

  // Build composition suffix
  let compositionSuffix = "";
  if (shot.compositionGuide) {
    compositionSuffix += `, ${shot.compositionGuide.replace(/_/g, " ")} composition`;
  }
  if (shot.focalPoint) {
    compositionSuffix += `, focus on ${shot.focalPoint}`;
  }
  if (shot.depthOfField === "shallow") {
    compositionSuffix += `, shallow depth of field, bokeh background`;
  } else if (shot.depthOfField === "deep") {
    compositionSuffix += `, deep focus, everything sharp`;
  }
  if (colorPalette) {
    compositionSuffix += `\n\nGLOBAL COLOR PALETTE (mandatory): ${colorPalette}. All frames must adhere to this color scheme.`;
  }

  // Build character height context for multi-character shots
  const shotPrompt = shot.prompt || "";
  const charsInPrompt = projectCharacters.filter(c => shotPrompt.includes(c.name));
  if (charsInPrompt.length > 1) {
    const heightInfo = charsInPrompt
      .filter(c => c.heightCm && c.heightCm > 0)
      .sort((a, b) => (b.heightCm || 170) - (a.heightCm || 170))
      .map(c => `${c.name}: ${c.heightCm}cm (${c.bodyType || "average"})`)
      .join(", ");
    if (heightInfo) {
      compositionSuffix += `. Character heights: ${heightInfo}. Maintain correct relative proportions`;
    }
  }

  await db
    .update(shots)
    .set({ status: "generating" })
    .where(eq(shots.id, payload.shotId));

  // Read first/last frame ASSET PROMPTS from the unified shot_assets table.
  // These were generated independently by `shot_keyframe_assets_generate`.
  // Fall back to legacy startFrameDesc/endFrameDesc if no asset rows exist (back-compat).
  const firstFrameAsset = await getActiveAsset(payload.shotId, "first_frame", 0);
  const lastFrameAsset = await getActiveAsset(payload.shotId, "last_frame", 0);

  const startFrameDescText = firstFrameAsset?.prompt || shot.prompt || "";
  const endFrameDescText = lastFrameAsset?.prompt || shot.prompt || "";

  // Pick character refs to attach as visual anchors. Prefer characters listed
  // on the asset row; fall back to first 3 chars with reference images.
  const charsWithRefs = projectCharacters.filter((c) => !!c.referenceImage);
  const storedCharNames: string[] =
    firstFrameAsset?.characters && firstFrameAsset.characters.length > 0
      ? firstFrameAsset.characters
      : [];

  const relevantChars =
    storedCharNames.length > 0
      ? charsWithRefs.filter((c) => storedCharNames.includes(c.name))
      : charsWithRefs.slice(0, 3);
  const charRefImages = relevantChars.map((c) => c.referenceImage as string);
  const shotCharRefs: NamedImageRef[] = relevantChars.map((c) => ({
    path: c.referenceImage as string,
    label: `角色:${c.name}`,
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
    .where(eq(visualAssets.projectId, payload.projectId));
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
    startFrameDescText,
    endFrameDescText,
  ]);
  const shotScenePropRefs = pickScenePropRefsForShot(visualPool, shotContext);
  const firstFrameRefs = composeFirstFrameRefs(shotCharRefs, shotScenePropRefs);

  console.log(
    `[FrameGenerate] Shot ${shot.sequence} ref pick -> chars=${summarizeRefLabels(
      shotCharRefs
    )}; scene/prop=${summarizeRefLabels(shotScenePropRefs)}; first=${summarizeRefLabels(
      firstFrameRefs
    )}`
  );

  const forceChainContinuity =
    shot.inheritPrevLastFrame === 1 && !!shot.prevShotId;

  // Mark assets as generating
  if (firstFrameAsset && !forceChainContinuity) {
    await patchAsset(firstFrameAsset.id, { status: "generating" });
  }
  if (lastFrameAsset) await patchAsset(lastFrameAsset.id, { status: "generating" });

  // Continuity source is only valid for segmented chain shots.
  // Normal shots must NOT consume previous shot tail frames.
  const continuitySourceShotId = forceChainContinuity ? shot.prevShotId : undefined;
  const prevLastFrameUrl = continuitySourceShotId
    ? (await getActiveAsset(continuitySourceShotId, "last_frame", 0))?.fileUrl ??
      undefined
    : undefined;

  let firstFramePath = "";
  if (forceChainContinuity) {
    if (!prevLastFrameUrl) {
      throw new Error(
        `Shot ${shot.sequence} requires previous last frame for continuity, but prev shot (${shot.prevShotId}) has no last frame`
      );
    }
    firstFramePath = prevLastFrameUrl;
    console.log(
      `[FrameGenerate] Shot ${shot.sequence}: reused previous shot last frame as first frame (${shot.prevShotId})`
    );
  } else {
    // Generate first frame
    let firstFramePrompt = buildFirstFramePrompt({
      sceneDescription: shot.prompt || "",
      startFrameDesc: startFrameDescText,
      characterDescriptions,
      // Keep normal shots independent; tail-frame continuity is chain-only.
      previousLastFrame: undefined,
      slotContents: frameFirstSlots,
    });
    if (compositionSuffix) firstFramePrompt += compositionSuffix;
    firstFramePath = await ai.generateImage(firstFramePrompt, {
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
  // Generate last frame
  let lastFramePrompt = buildLastFramePrompt({
    sceneDescription: shot.prompt || "",
    endFrameDesc: endFrameDescText,
    characterDescriptions,
    firstFramePath,
    slotContents: frameLastSlots,
  });
  if (compositionSuffix) lastFramePrompt += compositionSuffix;
  const lastFramePath = await ai.generateImage(lastFramePrompt, {
    quality: "hd",
    referenceImages: lastFrameRefs.map((ref) => ref.path),
    referenceLabels: lastFrameRefs.map((ref) => ref.label),
  });

  // Patch asset rows with the resulting file URLs (or insert if they didn't
  // exist yet — happens for shots whose keyframe asset prompts haven't been
  // generated by the LLM step).
  if (firstFrameAsset) {
    await patchAsset(firstFrameAsset.id, {
      fileUrl: firstFramePath,
      status: "completed",
      meta: forceChainContinuity
        ? {
            continuity: "inherit_prev_last_frame",
            sourceShotId: shot.prevShotId,
          }
        : undefined,
    });
  } else {
    await insertAssetVersion({
      shotId: payload.shotId,
      type: "first_frame",
      sequenceInType: 0,
      prompt: startFrameDescText,
      fileUrl: firstFramePath,
      status: "completed",
      characters: relevantChars.map((c) => c.name),
      meta: forceChainContinuity
        ? {
            continuity: "inherit_prev_last_frame",
            sourceShotId: shot.prevShotId,
          }
        : undefined,
    });
  }
  if (lastFrameAsset) {
    await patchAsset(lastFrameAsset.id, {
      fileUrl: lastFramePath,
      status: "completed",
    });
  } else {
    await insertAssetVersion({
      shotId: payload.shotId,
      type: "last_frame",
      sequenceInType: 0,
      prompt: endFrameDescText,
      fileUrl: lastFramePath,
      status: "completed",
      characters: relevantChars.map((c) => c.name),
    });
  }

  await db
    .update(shots)
    .set({ status: "completed" })
    .where(eq(shots.id, payload.shotId));

  return { firstFrame: firstFramePath, lastFrame: lastFramePath };
}
