import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-fetch";
import { useProjectStore } from "@/stores/project-store";
import type { Shot } from "@/stores/project-store";
import {
  type DirectorControl,
  type PrecheckStage,
  type PreflightFixDiffRecord,
  type PreflightRunState,
  type VideoPreflightResponse,
  type VideoPreflightShotResult,
} from "./storyboard-preflight-utils";
import { mergePreflightResponses } from "./storyboard-preflight-utils";
import { useStoryboardPreflightFixes } from "./use-storyboard-preflight-fixes";
import { useStoryboardPreflightRunner } from "./use-storyboard-preflight-runner";

type StoryboardGenerationMode = "storyboard_grid" | "reference";

type UseStoryboardPreflightParams = {
  directorControl: DirectorControl;
  fetchProject: (projectId: string, episodeId?: string, versionId?: string) => Promise<unknown>;
  generationMode: StoryboardGenerationMode;
  getModelConfig: () => unknown;
  project: {
    id: string;
    generationMode?: string;
    shots: Shot[];
  } | null;
  selectedVersionId: string | null;
  shots: Shot[];
  tr: (key: string, fallback: string, values?: Record<string, string | number>) => string;
};

export function useStoryboardPreflight({
  directorControl,
  fetchProject,
  generationMode,
  getModelConfig,
  project,
  selectedVersionId,
  shots,
  tr,
}: UseStoryboardPreflightParams) {
  const currentEpisodeId = useProjectStore((s) => s.currentEpisodeId);
  const [runningVideoPreflight, setRunningVideoPreflight] = useState(false);
  const [preflightResult, setPreflightResult] =
    useState<VideoPreflightResponse | null>(null);
  const [preflightShotStates, setPreflightShotStates] = useState<
    Record<string, PreflightRunState>
  >({});
  const [preflightShotErrors, setPreflightShotErrors] = useState<
    Record<string, string>
  >({});
  const [preflightProgress, setPreflightProgress] = useState<{
    total: number;
    completed: number;
    running: number;
    failed: number;
  } | null>(null);
  const [fixingPreflightShotId, setFixingPreflightShotId] = useState<string | null>(
    null
  );
  const [fixingAllPreflight, setFixingAllPreflight] = useState(false);
  const [preflightFixProgress, setPreflightFixProgress] = useState<{
    total: number;
    completed: number;
    succeeded: number;
    failed: number;
    currentShotId?: string | null;
  } | null>(null);
  const [preflightFixDiffs, setPreflightFixDiffs] = useState<
    Record<string, PreflightFixDiffRecord>
  >({});

  useEffect(() => {
    setPreflightResult(null);
    setPreflightFixDiffs({});
    setPreflightShotStates({});
    setPreflightShotErrors({});
    setPreflightProgress(null);
    setPreflightFixProgress(null);
  }, [selectedVersionId, currentEpisodeId, project?.generationMode]);

  const preflightDisplayItems = useMemo(() => {
    const resultById = new Map(
      (preflightResult?.results || []).map((item) => [item.shotId, item])
    );
    return shots
      .map((shot) => ({
        shotId: shot.id,
        sequence: shot.sequence,
        result: resultById.get(shot.id),
        runState:
          preflightShotStates[shot.id] ??
          (resultById.has(shot.id) ? "done" : "pending"),
        errorMessage: preflightShotErrors[shot.id],
      }))
      .sort((a, b) => a.sequence - b.sequence);
  }, [shots, preflightResult, preflightShotStates, preflightShotErrors]);

  const preflightDisplayMap = useMemo(
    () => new Map(preflightDisplayItems.map((item) => [item.shotId, item])),
    [preflightDisplayItems]
  );

  async function runPreflightRequest(
    shotIds?: string[],
    precheckStage: PrecheckStage = "full"
  ): Promise<VideoPreflightResponse> {
    if (!project) {
      throw new Error("Project not loaded");
    }
    const response = await apiFetch(`/api/projects/${project.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "video_preflight",
        payload: {
          versionId: selectedVersionId,
          directorControl,
          precheckStage,
          ...(shotIds && shotIds.length > 0 ? { shotIds } : {}),
        },
        modelConfig: getModelConfig(),
        episodeId: useProjectStore.getState().currentEpisodeId,
      }),
    });
    return (await response.json()) as VideoPreflightResponse;
  }

  async function runVideoPreflightRequest(
    shotIds?: string[]
  ): Promise<VideoPreflightResponse> {
    return runPreflightRequest(shotIds, "full");
  }

  function mergeSinglePreflightResult(next: VideoPreflightResponse) {
    setPreflightResult((current) => {
      if (!current) return next;
      return mergePreflightResponses(current, next);
    });
  }

  const { handleRunVideoPreflight } = useStoryboardPreflightRunner({
    directorControl,
    generationMode,
    runVideoPreflightRequest,
    setPreflightFixDiffs,
    setPreflightProgress,
    setPreflightResult,
    setPreflightShotErrors,
    setPreflightShotStates,
    setRunningVideoPreflight,
    shots,
    tr,
  });

  async function ensureVideoTargetsPassedPreflight(
    candidateShots: Shot[],
    mode: StoryboardGenerationMode,
    options?: { autoFixBlocked?: boolean }
  ): Promise<Shot[] | null> {
    if (!project || candidateShots.length === 0) return [];

    const candidateShotIds = candidateShots.map((shot) => shot.id);
    const pickApprovedShots = (data: VideoPreflightResponse): Shot[] => {
      const passIdSet = new Set(
        data.results.filter((item) => item.pass).map((item) => item.shotId)
      );
      const latestShots = useProjectStore.getState().project?.shots ?? [];
      return latestShots.filter(
        (shot) => candidateShotIds.includes(shot.id) && passIdSet.has(shot.id)
      );
    };

    let preflightData = await runVideoPreflightRequest(candidateShotIds);
    setPreflightResult(preflightData);

    let blocked = preflightData.results.filter((item) => !item.pass);
    let approvedShots = pickApprovedShots(preflightData);

    if (blocked.length > 0 && options?.autoFixBlocked) {
      toast.info(`预检拦截 ${blocked.length} 条镜头，正在尝试 AI 自动修复...`);
      setFixingAllPreflight(true);
      await executeBatchPreflightFixes(blocked, { postCheckStage: "full" });
      setFixingPreflightShotId(null);
      setFixingAllPreflight(false);
      setPreflightFixProgress(null);

      preflightData = await runVideoPreflightRequest(candidateShotIds);
      setPreflightResult(preflightData);
      blocked = preflightData.results.filter((item) => !item.pass);
      approvedShots = pickApprovedShots(preflightData);

      if (approvedShots.length === 0) {
        toast.error(
          mode === "reference"
            ? "AI 自动修复后仍无可生成的参考视频镜头，请查看预检面板继续调整"
            : "AI 自动修复后仍无可生成的视频镜头，请查看预检面板继续调整"
        );
        return null;
      }

      if (blocked.length > 0) {
        toast.info(
          `AI 自动修复后仍有 ${blocked.length} 条镜头未通过，本次继续生成 ${approvedShots.length} 条通过镜头`
        );
      } else {
        toast.success(`AI 自动修复完成，${approvedShots.length} 条镜头已通过预检`);
      }
      return approvedShots;
    }

    if (approvedShots.length === 0) {
      toast.error(
        mode === "reference"
          ? "预检已拦截全部参考视频镜头，请先按面板建议修复后再生成"
          : "预检已拦截全部视频镜头，请先按面板建议修复后再生成"
      );
      return null;
    }

    if (blocked.length > 0) {
      toast.info(`预检已拦截 ${blocked.length} 条镜头，本次仅继续生成 ${approvedShots.length} 条通过镜头`);
    }

    return approvedShots;
  }

  async function ensureStoryboardPromptTargetsPassedPrecheck(
    candidateShots: Shot[],
    options?: { autoFixBlocked?: boolean }
  ): Promise<Shot[] | null> {
    if (!project || candidateShots.length === 0) return [];

    const candidateShotIds = candidateShots.map((shot) => shot.id);
    const pickApprovedShots = (data: VideoPreflightResponse): Shot[] => {
      const passIdSet = new Set(
        data.results.filter((item) => item.pass).map((item) => item.shotId)
      );
      const latestShots = useProjectStore.getState().project?.shots ?? [];
      return latestShots.filter(
        (shot) => candidateShotIds.includes(shot.id) && passIdSet.has(shot.id)
      );
    };

    let precheckData = await runPreflightRequest(candidateShotIds, "image_prompt");
    setPreflightResult(precheckData);

    let blocked = precheckData.results.filter((item) => !item.pass);
    let approvedShots = pickApprovedShots(precheckData);

    if (blocked.length > 0 && options?.autoFixBlocked) {
      toast.info(`提示词预审拦截 ${blocked.length} 条镜头，正在尝试 AI 自动修复...`);
      setFixingAllPreflight(true);
      await executeBatchPreflightFixes(blocked, { postCheckStage: "image_prompt" });
      setFixingPreflightShotId(null);
      setFixingAllPreflight(false);
      setPreflightFixProgress(null);

      precheckData = await runPreflightRequest(candidateShotIds, "image_prompt");
      setPreflightResult(precheckData);
      blocked = precheckData.results.filter((item) => !item.pass);
      approvedShots = pickApprovedShots(precheckData);

      if (approvedShots.length === 0) {
        toast.error("AI 自动修复后仍无可生图的镜头，请先查看提示词预审面板");
        return null;
      }
      return approvedShots;
    }

    if (approvedShots.length === 0) {
      toast.error("提示词预审已拦截全部镜头，请先按建议修复后再生成四宫格图");
      return null;
    }

    if (blocked.length > 0) {
      toast.info(`提示词预审已拦截 ${blocked.length} 条镜头，本次仅继续生成 ${approvedShots.length} 条通过镜头`);
    }

    return approvedShots;
  }

  const {
    executeBatchPreflightFixes,
    executePreflightFix,
    handleApplyAllPreflightFixes,
    handleApplyPreflightFix,
  } = useStoryboardPreflightFixes({
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
  });

  return {
    ensureStoryboardPromptTargetsPassedPrecheck,
    ensureVideoTargetsPassedPreflight,
    executePreflightFix,
    fixingAllPreflight,
    fixingPreflightShotId,
    handleApplyAllPreflightFixes,
    handleApplyPreflightFix,
    handleRunVideoPreflight,
    mergeSinglePreflightResult,
    preflightDisplayItems,
    preflightDisplayMap,
    preflightFixDiffs,
    preflightFixProgress,
    preflightProgress,
    preflightResult,
    runVideoPreflightRequest,
    runningVideoPreflight,
  };
}
