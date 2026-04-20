import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters, dialogues, episodes, projects, shots, storyboardVersions } from "@/lib/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { assembleVideo } from "@/lib/video/ffmpeg";
import { loadShotLegacyViewsBatch } from "@/lib/shot-asset-utils";
import { extractErrorMessage } from "../helpers";
import { normalizeRuntimeGenerationMode } from "@/lib/generation-mode";

type TransitionType =
  | "cut"
  | "dissolve"
  | "fade_in"
  | "fade_out"
  | "wipeleft"
  | "slideright"
  | "circleopen";

export async function handleVideoAssembleSync(
  projectId: string,
  payload?: Record<string, unknown>,
  episodeId?: string
) {
  let generationModeValue: string = "storyboard_grid";
  if (episodeId) {
    const [episode] = await db
      .select({ generationMode: episodes.generationMode })
      .from(episodes)
      .where(eq(episodes.id, episodeId));
    generationModeValue = normalizeRuntimeGenerationMode(episode?.generationMode);
  } else {
    const [project] = await db
      .select({ generationMode: projects.generationMode })
      .from(projects)
      .where(eq(projects.id, projectId));
    generationModeValue = normalizeRuntimeGenerationMode(project?.generationMode);
  }

  let versionId = payload?.versionId as string | undefined;

  // If no versionId provided, fall back to the latest version for this project/episode
  if (!versionId) {
    const versionWhere = episodeId
      ? and(eq(storyboardVersions.projectId, projectId), eq(storyboardVersions.episodeId, episodeId))
      : eq(storyboardVersions.projectId, projectId);
    const [latestVersion] = await db
      .select({ id: storyboardVersions.id })
      .from(storyboardVersions)
      .where(versionWhere)
      .orderBy(desc(storyboardVersions.versionNum))
      .limit(1);
    versionId = latestVersion?.id;
  }

  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (versionId) shotWhereConditions.push(eq(shots.versionId, versionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const projectShots = await db
    .select()
    .from(shots)
    .where(and(...shotWhereConditions))
    .orderBy(asc(shots.sequence));

  const isReference = generationModeValue === "reference";
  const projectShotsLegacy = await loadShotLegacyViewsBatch(projectShots.map((s) => s.id));
  const videoPaths = projectShots
    .map((s) => {
      const v = projectShotsLegacy.get(s.id);
      return isReference ? v?.referenceVideoUrl : v?.videoUrl;
    })
    .filter(Boolean) as string[];

  if (videoPaths.length === 0) {
    return NextResponse.json({ error: "No video clips to assemble" }, { status: 400 });
  }

  // Build transitions array from shot transitionOut / transitionIn fields
  const completedShots = projectShots.filter((s) => {
    const v = projectShotsLegacy.get(s.id);
    return isReference ? v?.referenceVideoUrl : v?.videoUrl;
  });
  const transitions: TransitionType[] = completedShots.slice(0, -1).map((shot, i) => {
    const nextShot = completedShots[i + 1];
    return ((shot.transitionOut && shot.transitionOut !== "cut")
      ? shot.transitionOut
      : nextShot?.transitionIn || "cut") as TransitionType;
  });

  // Get dialogues for subtitles
  const allSubtitles: {
    text: string;
    shotSequence: number;
    dialogueSequence: number;
    dialogueCount: number;
    startRatio?: number;
    endRatio?: number;
  }[] = [];
  for (const shot of completedShots) {
    const shotDialogues = await db
      .select({
        text: dialogues.text,
        characterName: characters.name,
        sequence: dialogues.sequence,
        shotSequence: shots.sequence,
        startRatio: dialogues.startRatio,
        endRatio: dialogues.endRatio,
      })
      .from(dialogues)
      .innerJoin(characters, eq(dialogues.characterId, characters.id))
      .innerJoin(shots, eq(dialogues.shotId, shots.id))
      .where(eq(dialogues.shotId, shot.id))
      .orderBy(asc(dialogues.sequence));

    const count = shotDialogues.length;
    shotDialogues.forEach((d, idx) => {
      const sr = d.startRatio ? parseFloat(String(d.startRatio)) : undefined;
      const er = d.endRatio ? parseFloat(String(d.endRatio)) : undefined;
      allSubtitles.push({
        text: `${d.characterName}: ${d.text}`,
        shotSequence: d.shotSequence,
        dialogueSequence: idx,
        dialogueCount: count,
        startRatio: sr,
        endRatio: er,
      });
    });
  }

  try {
    const result = await assembleVideo({
      videoPaths,
      subtitles: allSubtitles,
      projectId,
      shotDurations: completedShots.map((s) => s.duration ?? 10),
      transitions,
    });

    if (episodeId) {
      await db
        .update(episodes)
        .set({ status: "completed", finalVideoUrl: result.videoPath, updatedAt: new Date() })
        .where(eq(episodes.id, episodeId));
    } else {
      await db
        .update(projects)
        .set({ status: "completed", finalVideoUrl: result.videoPath, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
    }

    console.log(`[VideoAssemble] Completed: ${result.videoPath}`);
    return NextResponse.json({ outputPath: result.videoPath, srtPath: result.srtPath, status: "ok" });
  } catch (err) {
    console.error("[VideoAssemble] Error:", err);
    return NextResponse.json(
      { status: "error", error: extractErrorMessage(err) },
      { status: 500 }
    );
  }
}
