import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { resolveImageProvider } from "@/lib/ai/provider-factory";
import { composeStoryboardGrid } from "@/lib/storyboard-grid-image";
import { buildStoryboardShotResourceContext } from "@/lib/storyboard-resources";
import {
  deleteAssetsByType,
  getActiveAssets,
  insertAssetVersion,
} from "@/lib/shot-asset-utils";
import {
  buildStoryboardPanelImagePrompt,
  getVersionedUploadDir,
  ratioToImageOpts,
} from "../helpers";
import type { ModelConfig } from "../types";

export async function generateStoryboardPanelsForShot(params: {
  projectId: string;
  userId: string;
  shotId: string;
  ratio: string;
  overwrite?: boolean;
  modelConfig?: ModelConfig;
  episodeId?: string;
  versionId?: string;
}) {
  const [shot] = await db.select().from(shots).where(eq(shots.id, params.shotId));
  if (!shot) {
    throw new Error("Shot not found");
  }

  const panelAssets = await getActiveAssets(shot.id, "storyboard_panel");
  if (panelAssets.length < 4) {
    throw new Error("No storyboard panel prompts found. Please generate prompts first.");
  }

  const resources = await buildStoryboardShotResourceContext({
    projectId: params.projectId,
    episodeId: params.episodeId,
    shot,
  });
  const versionedUploadDir = params.versionId
    ? await getVersionedUploadDir(params.versionId)
    : process.env.UPLOAD_DIR || "./uploads";
  const imageProvider = resolveImageProvider(params.modelConfig, versionedUploadDir);
  const imageOpts = ratioToImageOpts(params.ratio);

  const panelPaths: string[] = [];
  for (const panel of panelAssets.slice(0, 4)) {
    if (!params.overwrite && panel.fileUrl) {
      panelPaths.push(panel.fileUrl);
      continue;
    }
    const imagePrompt = buildStoryboardPanelImagePrompt({
      basePrompt: panel.prompt,
      ratio: params.ratio,
      panelIndex: panel.sequenceInType + 1,
      stage: typeof panel.meta?.stage === "string" ? panel.meta.stage : null,
      beat: typeof panel.meta?.beat === "string" ? panel.meta.beat : null,
      storyGoal:
        typeof panel.meta?.storyGoal === "string" ? panel.meta.storyGoal : null,
      primaryScene:
        typeof panel.meta?.primaryScene === "string" ? panel.meta.primaryScene : null,
      startingAction:
        typeof panel.meta?.startingAction === "string"
          ? panel.meta.startingAction
          : null,
      endingAction:
        typeof panel.meta?.endingAction === "string"
          ? panel.meta.endingAction
          : null,
      continuityBeats: panel.meta?.continuityBeats,
      mustKeep: panel.meta?.mustKeep,
      delta: typeof panel.meta?.delta === "string" ? panel.meta.delta : null,
    });
    const imagePath = await imageProvider.generateImage(imagePrompt, {
      quality: "hd",
      ...imageOpts,
      referenceImages: resources.referenceImages.map((item) => item.imageUrl),
      referenceLabels: resources.referenceImages.map(
        (item) => `${item.kind}:${item.label}`
      ),
    });
    await insertAssetVersion({
      shotId: shot.id,
      type: "storyboard_panel",
      sequenceInType: panel.sequenceInType,
      prompt: panel.prompt,
      fileUrl: imagePath,
      status: "completed",
      characters: panel.characters,
      meta: {
        ...(panel.meta || {}),
        workflow: "storyboard_grid",
      },
    });
    panelPaths.push(imagePath);
  }

  await deleteAssetsByType(shot.id, "storyboard_grid");
  await deleteAssetsByType(shot.id, "storyboard_video");

  const gridPath = await composeStoryboardGrid({
    panelPaths,
    outputDir: versionedUploadDir,
  });
  await insertAssetVersion({
    shotId: shot.id,
    type: "storyboard_grid",
    sequenceInType: 0,
    prompt: panelAssets.map((panel) => panel.prompt).join("\n\n"),
    fileUrl: gridPath,
    status: "completed",
    characters: resources.matchedCharacterNames,
    meta: {
      storyGoal:
        typeof panelAssets[0]?.meta?.storyGoal === "string"
          ? panelAssets[0].meta.storyGoal
          : null,
      primaryScene:
        typeof panelAssets[0]?.meta?.primaryScene === "string"
          ? panelAssets[0].meta.primaryScene
          : null,
      sceneCount:
        typeof panelAssets[0]?.meta?.sceneCount === "number"
          ? panelAssets[0].meta.sceneCount
          : null,
      eventCount:
        typeof panelAssets[0]?.meta?.eventCount === "number"
          ? panelAssets[0].meta.eventCount
          : null,
      complexityLevel:
        typeof panelAssets[0]?.meta?.complexityLevel === "string"
          ? panelAssets[0].meta.complexityLevel
          : null,
      startingAction:
        typeof panelAssets[0]?.meta?.startingAction === "string"
          ? panelAssets[0].meta.startingAction
          : null,
      endingAction:
        typeof panelAssets[0]?.meta?.endingAction === "string"
          ? panelAssets[0].meta.endingAction
          : null,
      continuityBeats:
        Array.isArray(panelAssets[0]?.meta?.continuityBeats)
          ? panelAssets[0].meta.continuityBeats
          : null,
      microDynamics:
        Array.isArray(panelAssets[0]?.meta?.microDynamics)
          ? panelAssets[0].meta.microDynamics
          : null,
      continuityRules:
        panelAssets[0]?.meta?.continuityRules &&
        typeof panelAssets[0].meta.continuityRules === "object"
          ? panelAssets[0].meta.continuityRules
          : null,
      workflow: "storyboard_grid",
      ratio: params.ratio,
    },
  });

  return {
    shotId: shot.id,
    sequence: shot.sequence,
    panelCount: panelPaths.length,
    gridPath,
  };
}
