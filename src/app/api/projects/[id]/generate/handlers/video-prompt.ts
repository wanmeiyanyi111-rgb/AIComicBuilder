import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters, dialogues, episodes, projects, shots } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import { loadShotLegacyView, loadShotLegacyViewsBatch } from "@/lib/shot-asset-utils";
import {
  extractErrorMessage,
  getDirectorControlFromPayload,
  getEpisodeCharacters,
} from "../helpers";
import type { ModelConfig } from "../types";
import { normalizeRuntimeGenerationMode } from "@/lib/generation-mode";
import { buildVideoPromptForShot } from "./video-prompt-execution";

export async function handleSingleVideoPrompt(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const directorControl = getDirectorControlFromPayload(payload);
  const ratio = typeof payload?.ratio === "string" ? payload.ratio : "16:9";
  const shotId = payload?.shotId as string;
  console.log(`[SingleVideoPrompt] called, shotId=${shotId}`);
  if (!shotId) return NextResponse.json({ error: "shotId required" }, { status: 400 });

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId)).limit(1);
  if (!shot) return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  const shotView = await loadShotLegacyView(shot.id);

  let genMode = "storyboard_grid";
  if (shot.episodeId) {
    const [ep] = await db
      .select({ generationMode: episodes.generationMode })
      .from(episodes)
      .where(eq(episodes.id, shot.episodeId));
    genMode = normalizeRuntimeGenerationMode(ep?.generationMode);
  } else {
    const [proj] = await db
      .select({ generationMode: projects.generationMode })
      .from(projects)
      .where(eq(projects.id, projectId));
    genMode = normalizeRuntimeGenerationMode(proj?.generationMode);
  }

  const shotCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, shot.projectId));

  try {
    const textProvider = resolveAIProvider(modelConfig);
    const { videoPrompt, visionFrames } = await buildVideoPromptForShot({
      directorControl,
      episodeId: shot.episodeId ?? undefined,
      generationMode: genMode,
      modelConfig,
      projectId,
      ratio,
      shot,
      shotCharacters,
      shotLegacy: shotView,
      textProvider,
      userId,
      auditPayload: payload,
    });

    console.log(
      `[SingleVideoPrompt] shot.sequence=${shot.sequence}, mode=${genMode}, frames=${visionFrames.length}`
    );
    console.log(`[SingleVideoPrompt] Shot ${shot.sequence} videoPrompt:\n${videoPrompt}`);
    await db.update(shots).set({ videoPrompt }).where(eq(shots.id, shotId));
    return NextResponse.json({ shotId, videoPrompt, status: "ok" });
  } catch (err) {
    console.error("[SingleVideoPrompt] Error:", err);
    return NextResponse.json(
      { status: "error", error: extractErrorMessage(err) },
      { status: 500 }
    );
  }
}

export async function handleBatchVideoPrompt(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  const directorControl = getDirectorControlFromPayload(payload);
  const batchVersionId = payload?.versionId as string | undefined;
  const ratio = typeof payload?.ratio === "string" ? payload.ratio : "16:9";

  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const batchShots = await db
    .select()
    .from(shots)
    .where(and(...shotWhereConditions))
    .orderBy(asc(shots.sequence));
  const batchShotsLegacy = await loadShotLegacyViewsBatch(batchShots.map((s) => s.id));

  const batchCharacters = await getEpisodeCharacters(projectId, episodeId);

  let batchGenMode = "storyboard_grid";
  if (episodeId) {
    const [ep] = await db
      .select({ generationMode: episodes.generationMode })
      .from(episodes)
      .where(eq(episodes.id, episodeId));
    batchGenMode = normalizeRuntimeGenerationMode(ep?.generationMode);
  } else {
    const [proj] = await db
      .select({ generationMode: projects.generationMode })
      .from(projects)
      .where(eq(projects.id, projectId));
    batchGenMode = normalizeRuntimeGenerationMode(proj?.generationMode);
  }

  const eligible = batchShots.filter((s) => {
    if (batchGenMode === "storyboard_grid") {
      const view = batchShotsLegacy.get(s.id);
      return !!(
        view?.storyboardGrid?.fileUrl ||
        (view?.storyboardPanels ?? []).some((panel) => !!panel.fileUrl)
      );
    }
    if (batchGenMode !== "reference") return true;
    const v = batchShotsLegacy.get(s.id);
    return !!(v?.firstFrame || v?.lastFrame || v?.sceneRefFrame);
  });

  const textProvider = resolveAIProvider(modelConfig);

  console.log(
    `[BatchVideoPrompt] Processing ${eligible.length} shots (${batchShots.length} total, ${batchCharacters.length} chars, mode=${batchGenMode})`
  );
  const bvpStartTime = Date.now();

  const results = await Promise.all(
    eligible.map(async (shot) => {
      try {
        const shotLegacy = batchShotsLegacy.get(shot.id);
        const shotStart = Date.now();
        const { videoPrompt, visionFrames } = await buildVideoPromptForShot({
          directorControl,
          episodeId,
          generationMode: batchGenMode,
          modelConfig,
          projectId,
          ratio,
          shot,
          shotCharacters: batchCharacters,
          shotLegacy,
          textProvider,
          userId,
        });

        await db.update(shots).set({ videoPrompt }).where(eq(shots.id, shot.id));
        console.log(
          `[BatchVideoPrompt] Shot ${shot.sequence} done (${((Date.now() - shotStart) / 1000).toFixed(1)}s, ${visionFrames.length} frames)`
        );
        return { shotId: shot.id, status: "ok" };
      } catch (err) {
        console.error(`[BatchVideoPrompt] Shot ${shot.sequence} failed:`, err);
        return {
          shotId: shot.id,
          status: "error",
          error: extractErrorMessage(err),
        };
      }
    })
  );

  const okCount = results.filter((r) => r.status === "ok").length;
  const errCount = results.filter((r) => r.status === "error").length;
  console.log(
    `[BatchVideoPrompt] Done: ${okCount} ok, ${errCount} errors, total ${((Date.now() - bvpStartTime) / 1000).toFixed(1)}s`
  );
  return NextResponse.json({ results, status: "ok" });
}
