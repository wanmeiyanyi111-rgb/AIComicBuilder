import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  dialogues,
  shotActions,
  shotAssets,
  shots,
} from "@/lib/db/schema";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { expandShotsForVideoControl } from "@/lib/shot-segmentation";
import { id as genId } from "@/lib/id";

interface ReplanRequest {
  episodeId?: string;
  versionId?: string;
  dryRun?: boolean;
  maxDuration?: number;
}

interface PlannedSegment {
  id: string;
  sourceShotId: string;
  isNew: boolean;
  sequence: number;
  prompt: string;
  motionScript: string;
  videoScript: string;
  duration: number;
  chainGroupId: string | null;
  chainIndex: number;
  chainTotal: number;
  prevShotId: string | null;
  inheritPrevLastFrame: number;
  originalDuration: number;
  sourceRow: typeof shots.$inferSelect;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const project = await assertProjectOwnership(request, projectId);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as ReplanRequest;
  const maxDuration = Math.max(5, Math.round(body.maxDuration ?? 5));

  const where = [eq(shots.projectId, projectId)];
  if (body.episodeId) where.push(eq(shots.episodeId, body.episodeId));
  if (body.versionId) where.push(eq(shots.versionId, body.versionId));

  const existingShots = await db
    .select()
    .from(shots)
    .where(and(...where))
    .orderBy(asc(shots.sequence));

  if (existingShots.length === 0) {
    return NextResponse.json(
      { error: "No shots found for selected scope" },
      { status: 404 }
    );
  }

  const longShots = existingShots.filter((s) => (s.duration ?? 0) > maxDuration);
  if (longShots.length === 0) {
    return NextResponse.json({
      status: "noop",
      message: `No shots exceed ${maxDuration}s`,
      beforeCount: existingShots.length,
      afterCount: existingShots.length,
    });
  }

  const longShotIds = longShots.map((s) => s.id);
  const [assetConflict, actionConflict] = await Promise.all([
    db
      .select({ shotId: shotAssets.shotId })
      .from(shotAssets)
      .where(inArray(shotAssets.shotId, longShotIds))
      .limit(1),
    db
      .select({ shotId: shotActions.shotId })
      .from(shotActions)
      .where(inArray(shotActions.shotId, longShotIds))
      .limit(1),
  ]);

  if (assetConflict.length > 0 || actionConflict.length > 0) {
    return NextResponse.json(
      {
        error:
          "Some long shots already have generated assets/actions. Replan is blocked to avoid data loss.",
      },
      { status: 409 }
    );
  }

  const planned: PlannedSegment[] = [];
  for (const row of existingShots) {
    const expanded = expandShotsForVideoControl(
      [
        {
          sequence: row.sequence,
          duration: row.duration,
          prompt: row.prompt || "",
          motionScript: row.motionScript || "",
          videoScript: row.videoScript || "",
        },
      ],
      () => genId()
    );

    for (let i = 0; i < expanded.length; i++) {
      const segment = expanded[i];
      planned.push({
        id: i === 0 ? row.id : genId(),
        sourceShotId: row.id,
        isNew: i !== 0,
        sequence: 0,
        prompt: segment.prompt || "",
        motionScript: segment.motionScript || "",
        videoScript: segment.videoScript || "",
        duration: segment.duration,
        chainGroupId: segment.chainGroupId,
        chainIndex: segment.chainIndex,
        chainTotal: segment.chainTotal,
        prevShotId: null,
        inheritPrevLastFrame: segment.inheritPrevLastFrame,
        originalDuration: segment.originalDuration,
        sourceRow: row,
      });
    }
  }

  // Re-sequence and resolve prevShotId references using final IDs.
  const lastByGroup = new Map<string, string>();
  for (let i = 0; i < planned.length; i++) {
    const item = planned[i];
    item.sequence = i + 1;
    if (!item.chainGroupId) {
      item.prevShotId = null;
      continue;
    }
    item.prevShotId = lastByGroup.get(item.chainGroupId) ?? null;
    lastByGroup.set(item.chainGroupId, item.id);
  }

  if (body.dryRun) {
    return NextResponse.json({
      status: "dry_run",
      beforeCount: existingShots.length,
      afterCount: planned.length,
      splitShots: longShots.length,
      addedShots: planned.filter((p) => p.isNew).length,
    });
  }

  const sourceDialogueRows = await db
    .select()
    .from(dialogues)
    .where(inArray(dialogues.shotId, existingShots.map((s) => s.id)))
    .orderBy(asc(dialogues.sequence));
  const dialogueByShotId = new Map<string, typeof sourceDialogueRows>();
  for (const row of sourceDialogueRows) {
    if (!dialogueByShotId.has(row.shotId)) dialogueByShotId.set(row.shotId, []);
    dialogueByShotId.get(row.shotId)!.push(row);
  }

  await db.transaction(async (tx) => {
    for (const item of planned) {
      const source = item.sourceRow;
      const payload = {
        projectId: source.projectId,
        sequence: item.sequence,
        prompt: item.prompt,
        motionScript: item.motionScript,
        cameraDirection: source.cameraDirection,
        duration: item.duration,
        videoScript: item.videoScript || null,
        videoPrompt: null,
        transitionIn: source.transitionIn,
        transitionOut: source.transitionOut,
        episodeId: source.episodeId,
        versionId: source.versionId,
        sceneId: source.sceneId,
        compositionGuide: source.compositionGuide || "",
        focalPoint: source.focalPoint || "",
        depthOfField: source.depthOfField || "medium",
        soundDesign: source.soundDesign || "",
        musicCue: source.musicCue || "",
        costumeOverrides: source.costumeOverrides || "",
        isStale: 1,
        status: "pending" as const,
        chainGroupId: item.chainGroupId,
        chainIndex: item.chainIndex,
        chainTotal: item.chainTotal,
        prevShotId: item.prevShotId,
        inheritPrevLastFrame: item.inheritPrevLastFrame,
        originalDuration: item.originalDuration,
      };

      if (item.isNew) {
        await tx.insert(shots).values({
          id: item.id,
          ...payload,
        });
        const sourceDialogues = dialogueByShotId.get(item.sourceShotId) ?? [];
        if (sourceDialogues.length > 0) {
          await tx.insert(dialogues).values(
            sourceDialogues.map((d) => ({
              id: genId(),
              shotId: item.id,
              characterId: d.characterId,
              text: d.text,
              sequence: d.sequence,
              audioUrl: null,
              startRatio: d.startRatio ?? "0",
              endRatio: d.endRatio ?? "1",
            }))
          );
        }
      } else {
        await tx.update(shots).set(payload).where(eq(shots.id, item.id));
      }
    }
  });

  return NextResponse.json({
    status: "ok",
    beforeCount: existingShots.length,
    afterCount: planned.length,
    splitShots: longShots.length,
    addedShots: planned.filter((p) => p.isNew).length,
  });
}
