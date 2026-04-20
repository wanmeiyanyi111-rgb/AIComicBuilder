import { toast } from "sonner";
import type { Dispatch, SetStateAction } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { getStoryboardPanelPrompts, useProjectStore } from "@/stores/project-store";
import type { Shot } from "@/stores/project-store";
import type {
  PrecheckStage,
  PreflightFixDiffRecord,
  PreflightFixSnapshot,
  VideoPreflightResponse,
  VideoPreflightShotResult,
} from "./storyboard-preflight-utils";
import { normalizeDiffText } from "./storyboard-preflight-utils";

type Params = {
  directorControl: {
    actionIntensity: number;
    cameraMotion: number;
    emotionIntensity: number;
  };
  fetchProject: (projectId: string, episodeId?: string, versionId?: string) => Promise<unknown>;
  getModelConfig: () => unknown;
  mergeSinglePreflightResult: (next: VideoPreflightResponse) => void;
  preflightResult: VideoPreflightResponse | null;
  project: {
    id: string;
    generationMode?: string;
    shots: Shot[];
  } | null;
  runPreflightRequest: (
    shotIds?: string[],
    precheckStage?: PrecheckStage
  ) => Promise<VideoPreflightResponse>;
  setFixingAllPreflight: Dispatch<SetStateAction<boolean>>;
  setFixingPreflightShotId: Dispatch<SetStateAction<string | null>>;
  setPreflightFixDiffs: Dispatch<
    SetStateAction<Record<string, PreflightFixDiffRecord>>
  >;
  setPreflightFixProgress: Dispatch<
    SetStateAction<{
      total: number;
      completed: number;
      succeeded: number;
      failed: number;
      currentShotId?: string | null;
    } | null>
  >;
};

export function useStoryboardPreflightFixes({
  directorControl,
  fetchProject,
  getModelConfig,
  mergeSinglePreflightResult,
  preflightResult,
  project,
  runPreflightRequest,
  setFixingAllPreflight,
  setFixingPreflightShotId,
  setPreflightFixDiffs,
  setPreflightFixProgress,
}: Params) {
  function buildPreflightFixSnapshot(shot?: Shot): PreflightFixSnapshot | null {
    if (!shot) return null;
    const panelPrompts = getStoryboardPanelPrompts(shot);
    return {
      prompt: normalizeDiffText(shot.prompt),
      firstPanelPrompt: normalizeDiffText(panelPrompts[0]),
      fourthPanelPrompt: normalizeDiffText(panelPrompts[3]),
      motionScript: normalizeDiffText(shot.motionScript),
      videoPrompt: normalizeDiffText(shot.videoPrompt),
      cameraDirection: normalizeDiffText(shot.cameraDirection),
    };
  }

  function computePreflightFixDiff(
    before: PreflightFixSnapshot | null,
    after: PreflightFixSnapshot | null
  ): PreflightFixDiffRecord | null {
    if (!before || !after) return null;
    const fields: Array<keyof PreflightFixSnapshot> = [
      "prompt",
      "firstPanelPrompt",
      "fourthPanelPrompt",
      "motionScript",
      "videoPrompt",
      "cameraDirection",
    ];
    const changedFields = fields.filter((field) => before[field] !== after[field]);
    if (changedFields.length === 0) return null;
    return { before, after, changedFields };
  }

  async function applyPreflightFixApis(
    item: VideoPreflightShotResult,
    options?: { stage?: PrecheckStage }
  ): Promise<{
    shouldRewriteShotText: boolean;
    shouldRefreshVideoPrompt: boolean;
  }> {
    if (!project) {
      throw new Error("Project not loaded");
    }

    const stage = options?.stage ?? "full";
    const rawFixTarget = item.llmAudit?.fixTarget || "video_prompt";
    const fixTarget =
      stage === "image_prompt" &&
      (!rawFixTarget || /video[_\\s-]?prompt|assets/i.test(rawFixTarget))
        ? "panel_flow"
        : rawFixTarget;
    const auditPayload = {
      shotId: item.shotId,
      directorControl,
      auditSummary: item.llmAudit?.summary || item.summary,
      auditFixTarget: fixTarget,
      auditIssues:
        item.llmAudit?.issues?.map(
          (issue) => `${issue.field}/${issue.severity}: ${issue.evidence} ${issue.reason}`
        ) || item.issues,
      auditSuggestions:
        item.llmAudit?.suggestions?.length ? item.llmAudit.suggestions : item.suggestions,
    };

    const isVideoPromptTarget = /video[_\\s-]?prompt/i.test(fixTarget);
    const shouldRewriteShotText =
      stage === "image_prompt"
        ? true
        : /start|end|frame|motion|prompt|camera|style|continuity|story|director|panel|asset/i.test(
            fixTarget
          ) && !isVideoPromptTarget;
    const shouldRefreshVideoPrompt = stage !== "image_prompt";

    if (shouldRewriteShotText) {
      await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_shot_rewrite",
          payload: auditPayload,
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
    }

    if (shouldRefreshVideoPrompt) {
      await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_video_prompt",
          payload: auditPayload,
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
    }

    return { shouldRewriteShotText, shouldRefreshVideoPrompt };
  }

  async function executePreflightFix(
    item: VideoPreflightShotResult,
    options?: { silent?: boolean; postCheckStage?: PrecheckStage }
  ): Promise<boolean> {
    if (!project) return false;

    const beforeShot = project.shots.find((shot) => shot.id === item.shotId);
    const beforeSnapshot = buildPreflightFixSnapshot(beforeShot);

    try {
      const { shouldRewriteShotText, shouldRefreshVideoPrompt } =
        await applyPreflightFixApis(item, {
          stage: options?.postCheckStage ?? "full",
        });

      await fetchProject(project.id, useProjectStore.getState().currentEpisodeId || undefined);
      const afterShot = useProjectStore.getState().project?.shots?.find(
        (shot) => shot.id === item.shotId
      );
      const afterSnapshot = buildPreflightFixSnapshot(afterShot);
      const diffRecord = computePreflightFixDiff(beforeSnapshot, afterSnapshot);

      setPreflightFixDiffs((current) => {
        if (!diffRecord) {
          if (!current[item.shotId]) return current;
          const next = { ...current };
          delete next[item.shotId];
          return next;
        }
        return { ...current, [item.shotId]: diffRecord };
      });

      const next = await runPreflightRequest([item.shotId], options?.postCheckStage ?? "full");
      mergeSinglePreflightResult(next);

      if (!options?.silent) {
        toast.success(
          shouldRewriteShotText
            ? shouldRefreshVideoPrompt
              ? "已按 AI 审查建议重写镜头描述与视频提示词"
              : "已按 AI 审查建议重写镜头描述与四宫格提示词"
            : shouldRefreshVideoPrompt
              ? "已按 AI 审查建议重写视频提示词"
              : "已按 AI 审查建议更新提示词内容"
        );
      }
      return true;
    } catch (err) {
      if (!options?.silent) {
        toast.error(err instanceof Error ? err.message : "AI 修复失败，请稍后再试");
      }
      return false;
    }
  }

  async function executeBatchPreflightFixes(
    items: VideoPreflightShotResult[],
    options?: { postCheckStage?: PrecheckStage }
  ): Promise<number> {
    if (!project || items.length === 0) return 0;

    let successCount = 0;
    let failedCount = 0;
    setPreflightFixProgress({
      total: items.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      currentShotId: null,
    });

    for (const item of items) {
      setFixingPreflightShotId(item.shotId);
      setPreflightFixProgress((current) =>
        current ? { ...current, currentShotId: item.shotId } : current
      );
      const ok = await executePreflightFix(item, {
        silent: true,
        postCheckStage: options?.postCheckStage ?? "full",
      });
      if (ok) successCount += 1;
      else failedCount += 1;
      setPreflightFixProgress((current) =>
        current
          ? {
              ...current,
              completed: current.completed + 1,
              succeeded: successCount,
              failed: failedCount,
            }
          : current
      );
    }

    setFixingPreflightShotId(null);
    setPreflightFixProgress((current) =>
      current ? { ...current, currentShotId: null } : current
    );
    return successCount;
  }

  async function handleApplyPreflightFix(item: VideoPreflightShotResult) {
    setFixingPreflightShotId(item.shotId);
    try {
      await executePreflightFix(item, {
        postCheckStage: preflightResult?.stage ?? "full",
      });
    } finally {
      setFixingPreflightShotId(null);
    }
  }

  async function handleApplyAllPreflightFixes() {
    if (!preflightResult) return;
    const failedItems = preflightResult.results.filter((item) => !item.pass);
    if (failedItems.length === 0) {
      toast.info("当前没有需要 AI 修复的预检项");
      return;
    }

    setFixingAllPreflight(true);
    const successCount = await executeBatchPreflightFixes(failedItems, {
      postCheckStage: preflightResult.stage ?? "full",
    });
    setFixingPreflightShotId(null);
    setFixingAllPreflight(false);

    if (successCount === failedItems.length) {
      toast.success(`已完成 ${successCount} 条未通过镜头的 AI 修复`);
    } else if (successCount > 0) {
      toast.info(`已完成 ${successCount}/${failedItems.length} 条镜头的 AI 修复，其余镜头需继续人工调整`);
    } else {
      toast.error("批量 AI 修复未成功，请根据预检建议继续调整");
    }
    setPreflightFixProgress(null);
  }

  return {
    executeBatchPreflightFixes,
    executePreflightFix,
    handleApplyAllPreflightFixes,
    handleApplyPreflightFix,
  };
}
