import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import { loadShotLegacyViewsBatch } from "@/lib/shot-asset-utils";
import { type DirectorControl } from "@/lib/video/shot-intent";
import {
  buildVisualStyleFromScript,
  extractErrorMessage,
  getDirectorControlFromPayload,
  getEpisodeCharacters,
  getScriptForScope,
} from "../helpers";
import type { ModelConfig } from "../types";
import { refreshShotWorkflowState } from "@/lib/storyboard/shot-workflow";
import {
  type AuditStatus,
  type PrecheckStage,
  type ShotLlmAudit,
  PRECHECK_AUDIT_CONCURRENCY,
  PRECHECK_FULL_AUDIT_MAX_SHOTS,
  mapWithConcurrency,
  mergeIssues,
  mergeResultScore,
  mergeSuggestions,
  runShotLlmAudit,
} from "./video-preflight-audit";
import {
  createEmptyPreflightPayload,
  evaluateBasePreflightShots,
  finalizePreflightResults,
  normalizeText,
  resolveGenerationMode,
} from "./video-preflight-utils";

export async function handleVideoPreflight(
  projectId: string,
  _userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  void _userId;
  const directorControl = getDirectorControlFromPayload(payload);
  const requestedStage = normalizeText(payload?.precheckStage);
  const precheckStage: PrecheckStage =
    requestedStage === "image_prompt" || requestedStage === "video_prompt"
      ? requestedStage
      : "full";
  const versionId = payload?.versionId as string | undefined;
  const shotId = payload?.shotId as string | undefined;
  const shotIds = Array.isArray(payload?.shotIds)
    ? (payload?.shotIds as unknown[])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];

  const whereConditions = [eq(shots.projectId, projectId)];
  if (versionId) whereConditions.push(eq(shots.versionId, versionId));
  if (episodeId) whereConditions.push(eq(shots.episodeId, episodeId));
  if (shotId) whereConditions.push(eq(shots.id, shotId));

  const selectedShots = await db
    .select()
    .from(shots)
    .where(and(...whereConditions))
    .orderBy(asc(shots.sequence));
  const scopedShots =
    shotIds.length > 0
      ? selectedShots.filter((shot) => shotIds.includes(shot.id))
      : selectedShots;

  if (shotId && scopedShots.length === 0) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }

  if (scopedShots.length === 0) {
    return NextResponse.json(
      createEmptyPreflightPayload({ directorControl, precheckStage })
    );
  }

  const generationMode = await resolveGenerationMode(projectId, episodeId);
  const characters = await getEpisodeCharacters(projectId, episodeId);
  const shotLegacyMap = await loadShotLegacyViewsBatch(scopedShots.map((s) => s.id));
  const scopeScript = await getScriptForScope(projectId, episodeId);
  const styleBrief = buildVisualStyleFromScript(scopeScript);

  let textProvider: ReturnType<typeof resolveAIProvider> | null = null;
  let providerError: string | null = null;
  try {
    textProvider = resolveAIProvider(modelConfig);
  } catch (error) {
    providerError = extractErrorMessage(error);
  }

  const baseEvaluations = evaluateBasePreflightShots({
    characters,
    directorControl,
    generationMode,
    modelConfig,
    precheckStage,
    scopedShots,
    shotLegacyMap,
  });

  const runFullAudit =
    scopedShots.length <= PRECHECK_FULL_AUDIT_MAX_SHOTS || shotIds.length > 0;
  const auditCandidates = baseEvaluations.filter((item) => {
    if (runFullAudit) return true;
    return (
      !item.rulePass ||
      item.missingVideoPrompt ||
      item.missingStoryboardPrompts ||
      item.missingKeyframes ||
      item.missingReferences
    );
  });

  console.log(
    `[VideoPreflight] total=${scopedShots.length}, fullAudit=${runFullAudit}, aiAudit=${auditCandidates.length}, skippedAi=${Math.max(
      0,
      scopedShots.length - auditCandidates.length
    )}`
  );

  const audited = await mapWithConcurrency(
    auditCandidates,
    PRECHECK_AUDIT_CONCURRENCY,
    async (item) => ({
      shotId: item.shot.id,
      audit: await runShotLlmAudit({
        provider: textProvider,
        sequence: item.shot.sequence,
        precheckStage,
        generationMode,
        intentCard: item.intentCard,
        shot: {
          prompt: item.shot.prompt,
          motionScript: item.shot.motionScript,
          videoScript: item.shot.videoScript,
          videoPrompt: item.shot.videoPrompt,
          cameraDirection: item.shot.cameraDirection,
        },
        panelPrompts: (item.shotLegacy?.storyboardPanels ?? [])
          .sort(
            (a: { sequenceInType: number }, b: { sequenceInType: number }) =>
              a.sequenceInType - b.sequenceInType
          )
          .map((panel: { prompt?: string | null }) => panel.prompt || ""),
        startFrameDesc: item.shotLegacy?.startFrameDesc,
        endFrameDesc: item.shotLegacy?.endFrameDesc,
        styleBrief,
        assets: {
          panelCount: (item.shotLegacy?.storyboardPanels ?? []).length,
          hasStoryboardGrid: !!item.shotLegacy?.storyboardGrid?.fileUrl,
          hasReferenceImages: item.hasReferenceImages,
        },
        ruleSummary: {
          pass: item.rulePass,
          score: item.ruleScore,
          issues: item.ruleIssues,
          suggestions: item.ruleSuggestions,
          summary: item.preflight.summary,
        },
        directorControl,
        providerError,
        compact: !runFullAudit || scopedShots.length === 1,
      }),
    })
  );
  const results = finalizePreflightResults({
    audited,
    baseEvaluations,
    mergeIssues,
    mergeResultScore,
    mergeSuggestions,
    precheckStage,
    runFullAudit,
    scopedShotsLength: scopedShots.length,
  });

  const total = results.length;
  const passCount = results.filter((item) => item.pass).length;
  const failCount = total - passCount;
  const avgScore = Math.round(
    results.reduce((sum, item) => sum + item.score, 0) / Math.max(1, total)
  );
  const okAudits = results.filter((item) => item.auditStatus === "ok");
  const auditPass = okAudits.filter((item) => item.llmAudit?.pass).length;
  const auditFail = okAudits.length - auditPass;
  const auditAverageScore = Math.round(
    okAudits.reduce((sum, item) => sum + (item.llmAudit?.overallScore ?? 0), 0) /
      Math.max(1, okAudits.length)
  );

  await Promise.all(
    results.map((item) =>
      refreshShotWorkflowState(item.shotId, {
        workflowPatch: {
          preflightStatus: item.pass ? "pass" : "fail",
          lastPreflightScore: item.score,
          lastPreflightSummary: item.summary,
          lastPreflightStage: precheckStage,
          lastPreflightAt: new Date().toISOString(),
          lastPreflightIssues: item.issues,
        },
      })
    )
  );

  return NextResponse.json({
    status: "ok",
    mode: generationMode,
    stage: precheckStage,
    directorControl,
    summary: {
      total,
      pass: passCount,
      fail: failCount,
      passRate: Math.round((passCount / Math.max(1, total)) * 100),
      averageScore: avgScore,
      audit: {
        ok: okAudits.length,
        failed: results.filter((item) => item.auditStatus === "failed").length,
        skipped: results.filter((item) => item.auditStatus === "skipped").length,
        pass: auditPass,
        fail: auditFail,
        averageScore: auditAverageScore,
      },
    },
    results,
  });
}
