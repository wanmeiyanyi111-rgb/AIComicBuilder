import { toast } from "sonner";
import { apiFetch } from "@/lib/api-fetch";
import { useProjectStore } from "@/stores/project-store";
import type { Shot } from "@/stores/project-store";
import type {
  BatchProgressSetter,
  BooleanSetter,
  StoryboardGenerationMode,
  StoryboardProject,
  StringArraySetter,
} from "./storyboard-generation-types";

type Params = {
  directorControl: {
    actionIntensity: number;
    cameraMotion: number;
    emotionIntensity: number;
  };
  ensureStoryboardPromptTargetsPassedPrecheck: (
    shots: Shot[],
    options?: { autoFixBlocked?: boolean }
  ) => Promise<Shot[] | null>;
  ensureVideoTargetsPassedPreflight: (
    shots: Shot[],
    mode: StoryboardGenerationMode,
    options?: { autoFixBlocked?: boolean }
  ) => Promise<Shot[] | null>;
  fetchProject: (projectId: string, episodeId?: string, versionId?: string) => Promise<unknown>;
  getBatchFailureDetail: (results: Array<{ status: string; error?: string }>) => string | null;
  getModelConfig: () => unknown;
  hasReferenceFrameForShot: (shot: Shot) => boolean;
  hasReferenceVideoForShot: (shot: Shot) => boolean;
  hasStoryboardFrameForShot: (shot: Shot) => boolean;
  hasStoryboardVideoForShot: (shot: Shot) => boolean;
  hasVideoPromptForShot: (shot: Shot) => boolean;
  imageGuard: () => boolean;
  project: StoryboardProject;
  selectedVersionId: string | null;
  setBatchProgress: BatchProgressSetter;
  setGeneratingFrames: BooleanSetter;
  setGeneratingFramesOverwrite: BooleanSetter;
  setGeneratingSceneFrames: BooleanSetter;
  setGeneratingVideos: BooleanSetter;
  setGeneratingVideosOverwrite: BooleanSetter;
  setLastBatchAction: (value: string | null) => void;
  setLastFailedShots: StringArraySetter;
  setSceneFramesOverwrite: BooleanSetter;
  t: (key: string, values?: Record<string, string | number>) => string;
  videoGuard: () => boolean;
  videoRatio: string;
};

export function useStoryboardBatchGenerators({
  directorControl,
  ensureStoryboardPromptTargetsPassedPrecheck,
  ensureVideoTargetsPassedPreflight,
  fetchProject,
  getBatchFailureDetail,
  getModelConfig,
  hasReferenceFrameForShot,
  hasReferenceVideoForShot,
  hasStoryboardFrameForShot,
  hasStoryboardVideoForShot,
  hasVideoPromptForShot,
  imageGuard,
  project,
  selectedVersionId,
  setBatchProgress,
  setGeneratingFrames,
  setGeneratingFramesOverwrite,
  setGeneratingSceneFrames,
  setGeneratingVideos,
  setGeneratingVideosOverwrite,
  setLastBatchAction,
  setLastFailedShots,
  setSceneFramesOverwrite,
  t,
  videoGuard,
  videoRatio,
}: Params) {
  async function handleBatchGenerateFrames(overwrite = false) {
    if (!project) return;
    if (!imageGuard()) return;
    setGeneratingFramesOverwrite(overwrite);
    setGeneratingFrames(true);
    setLastBatchAction("batch_storyboard_generate");

    const targets = project.shots.filter((shot) =>
      overwrite ? true : !hasStoryboardFrameForShot(shot)
    );
    if (targets.length === 0) {
      toast.info("暂无可生成四宫格分镜图的镜头");
      setGeneratingFramesOverwrite(false);
      setGeneratingFrames(false);
      return;
    }

    let approvedTargets: Shot[] | null = null;
    try {
      approvedTargets = await ensureStoryboardPromptTargetsPassedPrecheck(targets, {
        autoFixBlocked: true,
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "生图前提示词预审失败，请稍后重试"
      );
      setGeneratingFramesOverwrite(false);
      setGeneratingFrames(false);
      return;
    }
    if (!approvedTargets || approvedTargets.length === 0) {
      setGeneratingFramesOverwrite(false);
      setGeneratingFrames(false);
      return;
    }

    setBatchProgress({
      total: approvedTargets.length,
      completed: 0,
      inProgress: 0,
      failed: [],
      targetShotIds: approvedTargets.map((shot) => shot.id),
      action: "batch_storyboard_generate",
    });

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_storyboard_generate",
          payload: {
            ratio: videoRatio,
            overwrite,
            versionId: selectedVersionId,
            shotIds: approvedTargets.map((shot) => shot.id),
          },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      const data = (await response.json()) as {
        results?: Array<{ shotId?: string; status: string }>;
        failed?: Array<{ shotId?: string }>;
      };
      const failedIds = [
        ...(data.results || [])
          .filter((item) => item.status === "error")
          .map((item) => item.shotId!)
          .filter(Boolean),
        ...(data.failed || []).map((item) => item.shotId!).filter(Boolean),
      ];
      const totalProcessed = data.results?.length || approvedTargets.length;
      setBatchProgress({ total: totalProcessed, completed: totalProcessed, failed: failedIds });

      if (failedIds.length > 0) {
        setLastFailedShots(failedIds);
        toast.error(`${failedIds.length}/${totalProcessed} shots failed`);
      } else {
        setLastFailedShots([]);
        toast.success(`All ${totalProcessed} shots completed`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGeneratingFramesOverwrite(false);
    setGeneratingFrames(false);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId || undefined);
    setBatchProgress(null);
  }

  async function handleBatchGenerateVideos(overwrite = false) {
    if (!project) return;
    if (!videoGuard()) return;
    setGeneratingVideosOverwrite(overwrite);
    setGeneratingVideos(true);
    setLastBatchAction("batch_video_generate");

    const targets = project.shots.filter((shot) =>
      overwrite ? true : !hasStoryboardVideoForShot(shot)
    );
    const readyTargets = targets.filter(
      (shot) => hasStoryboardFrameForShot(shot) && hasVideoPromptForShot(shot)
    );
    if (readyTargets.length === 0) {
      toast.info("暂无可生成视频的镜头：请先生成四宫格分镜图并生成视频提示词");
      setGeneratingVideosOverwrite(false);
      setGeneratingVideos(false);
      return;
    }

    let approvedTargets: Shot[] | null = null;
    try {
      approvedTargets = await ensureVideoTargetsPassedPreflight(
        readyTargets,
        "storyboard_grid",
        { autoFixBlocked: true }
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "视频预检失败，请稍后重试");
      setGeneratingVideosOverwrite(false);
      setGeneratingVideos(false);
      return;
    }
    if (!approvedTargets || approvedTargets.length === 0) {
      setGeneratingVideosOverwrite(false);
      setGeneratingVideos(false);
      return;
    }

    setBatchProgress({
      total: approvedTargets.length,
      completed: 0,
      inProgress: 0,
      failed: [],
      targetShotIds: approvedTargets.map((shot) => shot.id),
      action: "batch_video_generate",
    });

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_video_generate",
          payload: {
            ratio: videoRatio,
            overwrite,
            versionId: selectedVersionId,
            directorControl,
            shotIds: approvedTargets.map((shot) => shot.id),
          },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      const data = (await response.json()) as {
        results: Array<{ shotId?: string; status: string; error?: string }>;
      };
      const failedIds = data.results
        .filter((item) => item.status === "error")
        .map((item) => item.shotId!)
        .filter(Boolean);
      const totalProcessed = data.results?.length || approvedTargets.length;
      setBatchProgress({ total: totalProcessed, completed: totalProcessed, failed: failedIds });

      if (failedIds.length > 0) {
        setLastFailedShots(failedIds);
        const detail = getBatchFailureDetail(data.results || []);
        toast.error(
          detail
            ? `${failedIds.length}/${totalProcessed} shots failed: ${detail}`
            : `${failedIds.length}/${totalProcessed} shots failed`
        );
      } else {
        setLastFailedShots([]);
        toast.success(`All ${totalProcessed} shots completed`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGeneratingVideosOverwrite(false);
    setGeneratingVideos(false);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId || undefined);
    setBatchProgress(null);
  }

  async function handleBatchGenerateSceneFrames(overwrite = false) {
    if (!project) return;
    if (!imageGuard()) return;
    setSceneFramesOverwrite(overwrite);
    setGeneratingSceneFrames(true);
    setLastBatchAction("batch_scene_frame");

    const targets = project.shots.filter((shot) =>
      overwrite ? true : !hasReferenceFrameForShot(shot)
    );
    if (targets.length === 0) {
      toast.info("暂无可生成参考图的镜头");
      setSceneFramesOverwrite(false);
      setGeneratingSceneFrames(false);
      return;
    }
    setBatchProgress({
      total: targets.length,
      completed: 0,
      inProgress: 0,
      failed: [],
      targetShotIds: targets.map((shot) => shot.id),
      action: "batch_scene_frame",
    });

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_scene_frame",
          payload: { overwrite, versionId: selectedVersionId, ratio: videoRatio },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      const data = (await response.json()) as {
        results: Array<{ shotId?: string; status: string }>;
      };
      const failedIds = data.results
        .filter((item) => item.status === "error")
        .map((item) => item.shotId!)
        .filter(Boolean);
      const totalProcessed = data.results?.length || targets.length;
      setBatchProgress({ total: totalProcessed, completed: totalProcessed, failed: failedIds });

      if (failedIds.length > 0) {
        setLastFailedShots(failedIds);
        toast.error(`${failedIds.length}/${totalProcessed} shots failed`);
      } else {
        setLastFailedShots([]);
        toast.success(`All ${totalProcessed} shots completed`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setSceneFramesOverwrite(false);
    setGeneratingSceneFrames(false);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId || undefined);
    setBatchProgress(null);
  }

  async function handleBatchGenerateReferenceVideos(overwrite = false) {
    if (!project) return;
    if (!videoGuard()) return;
    setGeneratingVideosOverwrite(overwrite);
    setGeneratingVideos(true);
    setLastBatchAction("batch_reference_video");

    const targets = project.shots.filter((shot) =>
      overwrite ? true : !hasReferenceVideoForShot(shot)
    );
    const readyTargets = targets.filter(
      (shot) => hasReferenceFrameForShot(shot) && hasVideoPromptForShot(shot)
    );
    if (readyTargets.length === 0) {
      toast.info("暂无可生成视频的镜头：请先补齐参考图并生成视频提示词");
      setGeneratingVideosOverwrite(false);
      setGeneratingVideos(false);
      return;
    }

    let approvedTargets: Shot[] | null = null;
    try {
      approvedTargets = await ensureVideoTargetsPassedPreflight(
        readyTargets,
        "reference",
        { autoFixBlocked: true }
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "参考视频预检失败，请稍后重试");
      setGeneratingVideosOverwrite(false);
      setGeneratingVideos(false);
      return;
    }
    if (!approvedTargets || approvedTargets.length === 0) {
      setGeneratingVideosOverwrite(false);
      setGeneratingVideos(false);
      return;
    }

    setBatchProgress({
      total: approvedTargets.length,
      completed: 0,
      inProgress: 0,
      failed: [],
      targetShotIds: approvedTargets.map((shot) => shot.id),
      action: "batch_reference_video",
    });

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_reference_video",
          payload: {
            ratio: videoRatio,
            overwrite,
            versionId: selectedVersionId,
            directorControl,
            shotIds: approvedTargets.map((shot) => shot.id),
          },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      const data = (await response.json()) as {
        results: Array<{ shotId?: string; status: string; error?: string }>;
      };
      const failedIds = data.results
        .filter((item) => item.status === "error")
        .map((item) => item.shotId!)
        .filter(Boolean);
      const totalProcessed = data.results?.length || approvedTargets.length;
      setBatchProgress({ total: totalProcessed, completed: totalProcessed, failed: failedIds });

      if (failedIds.length > 0) {
        setLastFailedShots(failedIds);
        const detail = getBatchFailureDetail(data.results || []);
        toast.error(
          detail
            ? `${failedIds.length}/${totalProcessed} shots failed: ${detail}`
            : `${failedIds.length}/${totalProcessed} shots failed`
        );
      } else {
        setLastFailedShots([]);
        toast.success(`All ${totalProcessed} shots completed`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGeneratingVideosOverwrite(false);
    setGeneratingVideos(false);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId || undefined);
    setBatchProgress(null);
  }

  return {
    handleBatchGenerateFrames,
    handleBatchGenerateReferenceVideos,
    handleBatchGenerateSceneFrames,
    handleBatchGenerateVideos,
  };
}
