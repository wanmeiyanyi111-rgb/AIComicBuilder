import { NextResponse } from "next/server";
import { hasImageModelConfig, hasTextModelConfig } from "@/lib/ai/config-presence";
import { resolveAIProvider, resolveImageProvider } from "@/lib/ai/provider-factory";
import {
  buildStoryboardGridPromptRequest,
  STORYBOARD_GRID_SYSTEM_PROMPT,
} from "@/lib/ai/prompts/storyboard-grid-prompts";
import { buildStoryboardShotResourceContext } from "@/lib/storyboard-resources";
import {
  deleteAssetsByType,
  insertAssetVersion,
} from "@/lib/shot-asset-utils";
import {
  buildVisualStyleFromScript,
  enforceFramePromptRatio,
  getScriptForScope,
  ratioToDisplayLabel,
} from "../helpers";
import type { ModelConfig } from "../types";
import { generateStoryboardPanelsForShot } from "./storyboard-image-generate";
import {
  loadTargetShots,
  normalizeStoryboardDuration,
  parseStoryboardPromptPayload,
} from "./storyboard-utils";

export async function handleGenerateStoryboardPrompts(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!hasTextModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No text model configured" }, { status: 400 });
  }

  const versionId = typeof payload?.versionId === "string" ? payload.versionId : undefined;
  const ratio = typeof payload?.ratio === "string" ? payload.ratio : "16:9";
  const allShots = await loadTargetShots(projectId, episodeId, versionId);
  const requestedShotIds = [
    ...(Array.isArray(payload?.shotIds)
      ? payload?.shotIds.map((value) => String(value || "").trim()).filter(Boolean)
      : []),
    ...(typeof payload?.shotId === "string" && payload.shotId.trim()
      ? [payload.shotId.trim()]
      : []),
  ];
  const targetShots = allShots.filter(
    (shot) => requestedShotIds.length === 0 || requestedShotIds.includes(shot.id)
  );
  if (targetShots.length === 0) {
    return NextResponse.json({ error: "No shots found" }, { status: 400 });
  }

  const textProvider = resolveAIProvider(modelConfig);
  const script = await getScriptForScope(projectId, episodeId);
  const visualStyle = buildVisualStyleFromScript(script);
  let updatedCount = 0;
  const failed: Array<{ shotId: string; sequence: number; error: string }> = [];

  for (const shot of targetShots) {
    try {
      const resources = await buildStoryboardShotResourceContext({
        projectId,
        episodeId,
        shot,
      });
      const request = buildStoryboardGridPromptRequest({
        shot: {
          sequence: shot.sequence,
          prompt: shot.prompt || "",
          motionScript: shot.motionScript,
          videoScript: shot.videoScript,
          cameraDirection: shot.cameraDirection,
          duration: normalizeStoryboardDuration(shot.duration),
        },
        visualStyle,
        ratio: ratioToDisplayLabel(ratio),
        resourceSummary: resources.resourceSummary,
      });
      const response = await textProvider.generateText(request, {
        systemPrompt: STORYBOARD_GRID_SYSTEM_PROMPT,
        temperature: 0.4,
      });
      const parsed = parseStoryboardPromptPayload(response);

      await deleteAssetsByType(shot.id, "storyboard_panel");
      await deleteAssetsByType(shot.id, "storyboard_grid");
      await deleteAssetsByType(shot.id, "storyboard_video");

      for (const panel of parsed.panels) {
        await insertAssetVersion({
          shotId: shot.id,
          type: "storyboard_panel",
          sequenceInType: panel.index - 1,
          prompt: enforceFramePromptRatio(panel.prompt, ratio),
          status: "pending",
          characters: parsed.characters,
          meta: {
            storyGoal: parsed.storyGoal,
            primaryScene: parsed.primaryScene,
            sceneCount: parsed.sceneCount,
            eventCount: parsed.eventCount,
            complexityLevel: parsed.complexityLevel,
            startingAction: parsed.startingAction,
            endingAction: parsed.endingAction,
            continuityBeats: parsed.continuityBeats,
            microDynamics: parsed.microDynamics,
            continuityRules: parsed.continuityRules,
            stage: panel.stage,
            beat: panel.beat,
            mustKeep: panel.mustKeep,
            delta: panel.delta,
            panelIndex: panel.index,
            workflow: "storyboard_grid",
          },
        });
      }

      updatedCount += 1;
    } catch (error) {
      failed.push({
        shotId: shot.id,
        sequence: shot.sequence,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({
    updatedCount,
    totalShots: targetShots.length,
    failed,
  });
}

export async function handleBatchStoryboardGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!hasImageModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const versionId = typeof payload?.versionId === "string" ? payload.versionId : undefined;
  const requestedShotIds = Array.isArray(payload?.shotIds)
    ? payload.shotIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const ratio = typeof payload?.ratio === "string" ? payload.ratio : "16:9";
  const overwrite = payload?.overwrite === true;
  const allShots = await loadTargetShots(projectId, episodeId, versionId);
  const targetShots = allShots.filter(
    (shot) => requestedShotIds.length === 0 || requestedShotIds.includes(shot.id)
  );

  const results = [];
  const failed: Array<{ shotId: string; sequence: number; error: string }> = [];
  for (const shot of targetShots) {
    try {
      results.push(
        await generateStoryboardPanelsForShot({
          projectId,
          userId,
          shotId: shot.id,
          ratio,
          overwrite,
          modelConfig,
          episodeId,
          versionId,
        })
      );
    } catch (error) {
      failed.push({
        shotId: shot.id,
        sequence: shot.sequence,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({ results, failed });
}

export async function handleSingleStoryboardGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!hasImageModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }
  const shotId = typeof payload?.shotId === "string" ? payload.shotId : "";
  if (!shotId) {
    return NextResponse.json({ error: "Missing shotId" }, { status: 400 });
  }
  try {
    const result = await generateStoryboardPanelsForShot({
      projectId,
      userId,
      shotId,
      ratio: typeof payload?.ratio === "string" ? payload.ratio : "16:9",
      overwrite: payload?.overwrite === true,
      modelConfig,
      episodeId,
      versionId: typeof payload?.versionId === "string" ? payload.versionId : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
