import { episodes, projects } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { eq } from "drizzle-orm";
import { normalizeVideoDurationForModel } from "@/lib/ai/model-limits";
import {
  buildShotIntentCard,
  evaluateVideoContinuityPreflight,
  type DirectorControl,
} from "@/lib/video/shot-intent";
import { normalizeRuntimeGenerationMode } from "@/lib/generation-mode";
import { isCharacterOnScreen } from "../helpers";
import type { ModelConfig } from "../types";
import type {
  AuditStatus,
  PrecheckStage,
  ShotLlmAudit,
} from "./video-preflight-audit";

export function clampSegmentDuration(duration: number): number {
  const rounded = Math.max(1, Math.round(duration || 0));
  return Math.min(5, Math.max(3, rounded));
}

export function normalizeText(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function resolveGenerationMode(
  projectId: string,
  episodeId?: string
): Promise<"storyboard_grid" | "reference"> {
  if (episodeId) {
    const [ep] = await db
      .select({ generationMode: episodes.generationMode })
      .from(episodes)
      .where(eq(episodes.id, episodeId));
    return normalizeRuntimeGenerationMode(ep?.generationMode);
  }

  const [proj] = await db
    .select({ generationMode: projects.generationMode })
    .from(projects)
    .where(eq(projects.id, projectId));
  return normalizeRuntimeGenerationMode(proj?.generationMode);
}

export function createEmptyPreflightPayload(params: {
  directorControl: DirectorControl;
  precheckStage: PrecheckStage;
}) {
  return {
    status: "ok" as const,
    mode: "storyboard_grid" as const,
    stage: params.precheckStage,
    directorControl: params.directorControl,
    summary: {
      total: 0,
      pass: 0,
      fail: 0,
      passRate: 0,
      averageScore: 0,
      audit: {
        ok: 0,
        failed: 0,
        skipped: 0,
        pass: 0,
        fail: 0,
        averageScore: 0,
      },
    },
    results: [],
  };
}

export function evaluateBasePreflightShots(params: {
  characters: any[];
  directorControl: DirectorControl;
  generationMode: "storyboard_grid" | "reference";
  modelConfig?: ModelConfig;
  precheckStage: PrecheckStage;
  scopedShots: any[];
  shotLegacyMap: Map<string, any>;
}) {
  const videoModelId = params.modelConfig?.video?.modelId;
  return params.scopedShots.map((shot) => {
    const shotLegacy = params.shotLegacyMap.get(shot.id);
    const preferredDuration =
      (shot.chainTotal ?? 1) > 1
        ? clampSegmentDuration(shot.duration ?? 4)
        : (shot.duration ?? 10);
    const effectiveDuration = normalizeVideoDurationForModel(
      videoModelId,
      preferredDuration
    );
    const videoContextForDialogue =
      shot.videoScript || shot.motionScript || shot.prompt || "";
    const visibleCharacterNames = params.characters
      .filter((char) =>
        isCharacterOnScreen(
          char.name,
          videoContextForDialogue,
          shotLegacy?.startFrameDesc ?? null
        )
      )
      .map((char) => char.name);
    const hasReferenceImages =
      (shotLegacy?.referenceImages ?? []).some((item: any) => !!item.fileUrl) ||
      !!shotLegacy?.sceneRefFrame;
    const hasStoryboardPanels =
      (shotLegacy?.storyboardPanels ?? []).filter((item: any) => !!item.fileUrl).length >= 2;
    const hasFirstFrame =
      params.generationMode === "storyboard_grid"
        ? hasStoryboardPanels
        : !!shotLegacy?.firstFrame;
    const hasLastFrame =
      params.generationMode === "storyboard_grid"
        ? !!shotLegacy?.storyboardGrid?.fileUrl
        : !!shotLegacy?.lastFrame;
    const panelPrompts = (shotLegacy?.storyboardPanels ?? [])
      .sort((a: any, b: any) => a.sequenceInType - b.sequenceInType)
      .map((panel: any) => panel.prompt || "");
    const storyboardPromptCount = panelPrompts.filter((item: string) => normalizeText(item)).length;

    const intentCard = buildShotIntentCard({
      shotId: shot.id,
      sequence: shot.sequence,
      duration: effectiveDuration,
      mode:
        params.generationMode === "reference" ? "reference" : params.generationMode,
      prompt: shot.prompt,
      motionScript: shot.motionScript,
      videoScript: shot.videoScript,
      cameraDirection: shot.cameraDirection,
      startFrameDesc: shotLegacy?.startFrameDesc,
      endFrameDesc: shotLegacy?.endFrameDesc,
      panelPrompts,
      chainIndex: shot.chainIndex,
      chainTotal: shot.chainTotal,
      inheritPrevLastFrame: shot.inheritPrevLastFrame,
      hasReferenceImages,
      characterNames: visibleCharacterNames,
      characterHints: params.characters.map((char) => ({
        name: char.name,
        visualHint: char.visualHint,
      })),
      directorControl: params.directorControl,
    });

    const preflight = evaluateVideoContinuityPreflight(intentCard);
    let ruleScore = preflight.score;
    let rulePass = preflight.pass;
    const ruleIssues = [...preflight.issues];
    const ruleSuggestions = [...preflight.suggestions];
    const missingScenePrompt = !normalizeText(shot.prompt);
    const missingVideoPrompt = !normalizeText(shot.videoPrompt);
    const missingStoryboardPrompts =
      params.generationMode === "storyboard_grid" && storyboardPromptCount < 4;
    const missingMotionScript = !normalizeText(shot.motionScript);
    const missingKeyframes =
      params.generationMode !== "reference" && (!hasFirstFrame || !hasLastFrame);
    const missingReferences =
      params.generationMode === "reference" && !hasReferenceImages;

    if (missingScenePrompt) {
      ruleScore = Math.max(0, ruleScore - 18);
      rulePass = false;
      ruleIssues.unshift("镜头描述缺失，无法判断剧情目标与画面核心。");
      ruleSuggestions.unshift("先补齐该镜头的剧情描述，再执行提示词预审。");
    }

    if (missingStoryboardPrompts) {
      ruleScore = Math.max(0, ruleScore - 26);
      rulePass = false;
      ruleIssues.unshift("四宫格提示词不完整，无法判断四格连续节拍是否成立。");
      ruleSuggestions.unshift("先补齐 4 个四宫格提示词，再执行提示词预审。");
    }

    if (missingMotionScript && params.precheckStage !== "image_prompt") {
      ruleScore = Math.max(0, ruleScore - 10);
      rulePass = false;
      ruleIssues.unshift("动作脚本缺失，无法评估动作推进和运镜预算。");
      ruleSuggestions.unshift("先生成或补齐动作脚本，再执行预检。");
    }

    if (
      (params.precheckStage === "video_prompt" || params.precheckStage === "full") &&
      missingVideoPrompt
    ) {
      ruleScore = Math.max(0, ruleScore - 24);
      rulePass = false;
      ruleIssues.unshift(
        params.generationMode === "storyboard_grid"
          ? "视频提示词缺失，无法判断四宫格动作推进是否真正可执行。"
          : "视频提示词缺失，无法判断首尾帧动作过渡是否真正可执行。"
      );
      ruleSuggestions.unshift("先生成视频提示词，再执行连续性预检。");
    }

    if (params.precheckStage === "full" && missingKeyframes) {
      ruleScore = Math.max(0, ruleScore - 30);
      rulePass = false;
      ruleIssues.unshift(
        params.generationMode === "storyboard_grid"
          ? "四宫格素材不完整，无法进行基于分镜图的视频生成。"
          : "首尾帧素材不完整，无法进行基于首尾帧的视频生成。"
      );
      ruleSuggestions.unshift(
        params.generationMode === "storyboard_grid"
          ? "先生成完整四宫格分镜图，再执行视频生成。"
          : "先补齐该镜头的首帧与尾帧，再执行视频生成。"
      );
    }

    if (params.precheckStage === "full" && missingReferences) {
      ruleScore = Math.max(0, ruleScore - 30);
      rulePass = false;
      ruleIssues.unshift("参考图素材缺失，无法进行基于参考图的视频生成。");
      ruleSuggestions.unshift("先批量生成场景/角色参考图，再执行视频生成。");
    }

    return {
      shot,
      shotLegacy,
      intentCard,
      hasReferenceImages,
      preflight,
      ruleIssues,
      rulePass,
      ruleScore,
      ruleSuggestions,
      missingKeyframes,
      missingReferences,
      missingStoryboardPrompts,
      missingVideoPrompt,
    };
  });
}

export function finalizePreflightResults(params: {
  audited: Array<{ shotId: string; audit: any }>;
  baseEvaluations: ReturnType<typeof evaluateBasePreflightShots>;
  precheckStage: PrecheckStage;
  mergeIssues: (ruleIssues: string[], llmIssues?: ShotLlmAudit["issues"], auditMessage?: string) => string[];
  mergeResultScore: (ruleScore: number, llmScore?: number) => number;
  mergeSuggestions: (
    ruleSuggestions: string[],
    llmSuggestions: string[] | undefined,
    auditStatus: AuditStatus,
    auditMessage?: string
  ) => string[];
  runFullAudit: boolean;
  scopedShotsLength: number;
}) {
  const results: Array<{
    shotId: string;
    sequence: number;
    pass: boolean;
    score: number;
    ruleScore: number;
    summary: string;
    issues: string[];
    suggestions: string[];
    auditStatus: AuditStatus;
    auditMessage?: string;
    llmAudit?: ShotLlmAudit;
    chain: {
      index: number;
      total: number;
      inheritPrevLastFrame: boolean;
    };
    assets: {
      panelCount: number;
      hasStoryboardGrid: boolean;
      hasReferenceImages: boolean;
    };
  }> = [];

  const auditByShotId = new Map(params.audited.map((item) => [item.shotId, item.audit]));
  for (const item of params.baseEvaluations) {
    const auditResult = auditByShotId.get(item.shot.id) ?? {
      auditStatus: "skipped" as AuditStatus,
      auditMessage: params.runFullAudit
        ? "AI 审查已跳过。"
        : "规则已通过，已跳过 AI 深度审查以缩短整集预检时间。",
    };

    const score = params.mergeResultScore(item.ruleScore, auditResult.llmAudit?.overallScore);
    const pass =
      item.rulePass &&
      (auditResult.auditStatus !== "ok" || auditResult.llmAudit?.pass === true);
    const issues = params.mergeIssues(
      item.ruleIssues,
      auditResult.llmAudit?.issues,
      auditResult.auditMessage
    );
    const suggestions = params.mergeSuggestions(
      item.ruleSuggestions,
      auditResult.llmAudit?.suggestions,
      auditResult.auditStatus,
      auditResult.auditMessage
    );

    const stageLabel =
      params.precheckStage === "image_prompt"
        ? " 生图前提示词预审"
        : params.precheckStage === "video_prompt"
          ? " 生视频前提示词预审"
          : " 预检";
    const summary =
      auditResult.auditStatus === "ok" && auditResult.llmAudit
        ? `${"镜头"} ${item.shot.sequence}${stageLabel}${pass ? "通过" : "未通过"}（规则 ${
            item.ruleScore
          } / AI ${auditResult.llmAudit.overallScore} / 综合 ${score}）`
        : `${"镜头"} ${item.shot.sequence}${stageLabel}${pass ? "通过" : "未通过"}（规则 ${
            item.ruleScore
          } / 综合 ${score}）`;

    results.push({
      shotId: item.shot.id,
      sequence: item.shot.sequence,
      pass,
      score,
      ruleScore: item.ruleScore,
      summary,
      issues,
      suggestions,
      auditStatus: auditResult.auditStatus,
      auditMessage: auditResult.auditMessage,
      llmAudit: auditResult.llmAudit,
      chain: {
        index: item.shot.chainIndex ?? 1,
        total: item.shot.chainTotal ?? 1,
        inheritPrevLastFrame: item.shot.inheritPrevLastFrame === 1,
      },
      assets: {
        panelCount: (item.shotLegacy?.storyboardPanels ?? []).length,
        hasStoryboardGrid: !!item.shotLegacy?.storyboardGrid?.fileUrl,
        hasReferenceImages: item.hasReferenceImages,
      },
    });
  }

  return results;
}
