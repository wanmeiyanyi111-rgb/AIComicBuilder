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
import { auditGeneratedStoryboardImages } from "./storyboard-image-audit";

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
  const orderedPanels = panelAssets
    .slice(0, 4)
    .sort((a, b) => a.sequenceInType - b.sequenceInType);

  const renderPanels = async (antiCollapseHint?: string | null) => {
    const panelPaths: string[] = [];
    for (let panelIndex = 0; panelIndex < orderedPanels.length; panelIndex += 1) {
      const panel = orderedPanels[panelIndex];
      const previousPanel = panelIndex > 0 ? orderedPanels[panelIndex - 1] : null;
      if (!params.overwrite && !antiCollapseHint && panel.fileUrl) {
        panelPaths.push(panel.fileUrl);
        continue;
      }
      const imagePrompt = buildStoryboardPanelImagePrompt({
        basePrompt: panel.prompt,
        ratio: params.ratio,
      panelIndex: panel.sequenceInType + 1,
      stage: typeof panel.meta?.stage === "string" ? panel.meta.stage : null,
      beat: typeof panel.meta?.beat === "string" ? panel.meta.beat : null,
      panelFunction:
        typeof panel.meta?.panelFunction === "string"
          ? panel.meta.panelFunction
          : null,
      activeCharacters: panel.meta?.activeCharacters,
      forbiddenDrift: panel.meta?.forbiddenDrift,
      resultSignal:
        typeof panel.meta?.resultSignal === "string"
          ? panel.meta.resultSignal
          : null,
      cameraPlan:
          typeof panel.meta?.cameraPlan === "string" ? panel.meta.cameraPlan : null,
        shotScale:
          typeof panel.meta?.shotScale === "string" ? panel.meta.shotScale : null,
        subjectPosition:
          typeof panel.meta?.subjectPosition === "string"
            ? panel.meta.subjectPosition
            : null,
        bodyFacing:
          typeof panel.meta?.bodyFacing === "string" ? panel.meta.bodyFacing : null,
        gazeTarget:
          typeof panel.meta?.gazeTarget === "string" ? panel.meta.gazeTarget : null,
        interactionState:
          typeof panel.meta?.interactionState === "string"
            ? panel.meta.interactionState
            : null,
        worldLock: panel.meta?.worldLock,
        continuityGoal:
          typeof panel.meta?.continuityGoal === "string"
            ? panel.meta.continuityGoal
            : null,
        progressionMode:
          typeof panel.meta?.progressionMode === "string"
            ? panel.meta.progressionMode
            : null,
        storyGoal:
          typeof panel.meta?.storyGoal === "string" ? panel.meta.storyGoal : null,
        modeRationale:
          typeof panel.meta?.modeRationale === "string"
            ? panel.meta.modeRationale
            : null,
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
        previousPanelSummary:
          previousPanel
            ? [
                typeof previousPanel.meta?.shotScale === "string"
                  ? `上一格景别=${previousPanel.meta.shotScale}`
                  : "",
                typeof previousPanel.meta?.subjectPosition === "string"
                  ? `上一格主体位置=${previousPanel.meta.subjectPosition}`
                  : "",
                typeof previousPanel.meta?.bodyFacing === "string"
                  ? `上一格朝向=${previousPanel.meta.bodyFacing}`
                  : "",
                typeof previousPanel.meta?.interactionState === "string"
                  ? `上一格关系状态=${previousPanel.meta.interactionState}`
                  : "",
                typeof previousPanel.meta?.continuityGoal === "string"
                  ? `上一格连续性目标=${previousPanel.meta.continuityGoal}`
                  : "",
              ]
                .filter(Boolean)
                .join("；")
            : null,
        antiCollapseHint,
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
    return panelPaths;
  };

  let panelPaths = await renderPanels(null);

  await deleteAssetsByType(shot.id, "storyboard_grid");
  await deleteAssetsByType(shot.id, "storyboard_video");

  let imageAudit = await auditGeneratedStoryboardImages(
    orderedPanels.map((panel, index) => ({
      fileUrl: panelPaths[index] || panel.fileUrl,
      meta: panel.meta && typeof panel.meta === "object" ? panel.meta : null,
    }))
  );

  if (
    !imageAudit.pass &&
    imageAudit.issues.some((item) => item.includes("视觉相似度过高"))
  ) {
    panelPaths = await renderPanels(
      "上一轮四宫格出现了相邻格高度重复。你这次必须让四格形成清晰递进：每一格都要有明显不同的主体位置、动作阶段和构图，不允许任何两格看起来像同一张图。"
    );
    imageAudit = await auditGeneratedStoryboardImages(
      orderedPanels.map((panel, index) => ({
        fileUrl: panelPaths[index] || panel.fileUrl,
        meta: panel.meta && typeof panel.meta === "object" ? panel.meta : null,
      }))
    );
  }

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
      continuityImageAuditScore: imageAudit.score,
      continuityImageAuditPass: imageAudit.pass,
      continuityImageAuditStage: imageAudit.stage,
      continuityImageAuditSummary: imageAudit.summary,
      continuityImageAuditIssues: imageAudit.issues,
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
