import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { useProjectStore } from "@/stores/project-store";
import type { Shot } from "@/stores/project-store";
import type {
  BatchProgress,
  StoryboardProject,
  StoryboardGenerationMode,
} from "./storyboard-generation-types";

type Params = {
  directorControl: {
    actionIntensity: number;
    cameraMotion: number;
    emotionIntensity: number;
  };
  ensureVideoTargetsPassedPreflight: (
    shots: Shot[],
    mode: StoryboardGenerationMode,
    options?: { autoFixBlocked?: boolean }
  ) => Promise<Shot[] | null>;
  getModelConfig: () => unknown;
  lastBatchAction: string | null;
  lastFailedShots: string[];
  project: StoryboardProject;
  refreshCurrentStoryboardView: () => Promise<void>;
  selectedVersionId: string | null;
  setBatchProgress: Dispatch<SetStateAction<BatchProgress>>;
  setGeneratingFrames: Dispatch<SetStateAction<boolean>>;
  setGeneratingSceneFrames: Dispatch<SetStateAction<boolean>>;
  setGeneratingStoryboardPrompts: Dispatch<SetStateAction<boolean>>;
  setGeneratingVideoPrompts: Dispatch<SetStateAction<boolean>>;
  setGeneratingVideos: Dispatch<SetStateAction<boolean>>;
  setLastFailedShots: Dispatch<SetStateAction<string[]>>;
  videoRatio: string;
};

export function useStoryboardRetry({
  directorControl,
  ensureVideoTargetsPassedPreflight,
  getModelConfig,
  lastBatchAction,
  lastFailedShots,
  project,
  refreshCurrentStoryboardView,
  selectedVersionId,
  setBatchProgress,
  setGeneratingFrames,
  setGeneratingSceneFrames,
  setGeneratingStoryboardPrompts,
  setGeneratingVideoPrompts,
  setGeneratingVideos,
  setLastFailedShots,
  videoRatio,
}: Params) {
  async function handleRetryFailed() {
    if (!project) return;
    let failedShots = project.shots.filter((shot) => lastFailedShots.includes(shot.id));
    if (failedShots.length === 0) return;

    const actionMap: Record<string, string> = {
      batch_storyboard_prompt: "generate_storyboard_prompts",
      batch_storyboard_generate: "single_storyboard_generate",
      batch_video_generate: "single_video_generate",
      batch_scene_frame: "single_scene_frame",
      batch_reference_video: "single_reference_video",
      batch_video_prompt: "single_video_prompt",
    };
    const singleAction = lastBatchAction ? actionMap[lastBatchAction] : null;
    if (!singleAction) return;

    if (
      lastBatchAction === "batch_video_generate" ||
      lastBatchAction === "batch_reference_video"
    ) {
      try {
        const approvedShots = await ensureVideoTargetsPassedPreflight(
          failedShots,
          lastBatchAction === "batch_reference_video" ? "reference" : "storyboard_grid",
          { autoFixBlocked: true }
        );
        if (!approvedShots || approvedShots.length === 0) return;
        failedShots = approvedShots;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "重试前预检失败，请稍后再试");
        return;
      }
    }

    if (lastBatchAction === "batch_storyboard_prompt") setGeneratingStoryboardPrompts(true);
    else if (lastBatchAction === "batch_storyboard_generate") setGeneratingFrames(true);
    else if (
      lastBatchAction === "batch_video_generate" ||
      lastBatchAction === "batch_reference_video"
    ) setGeneratingVideos(true);
    else if (lastBatchAction === "batch_scene_frame") setGeneratingSceneFrames(true);
    else if (lastBatchAction === "batch_video_prompt") setGeneratingVideoPrompts(true);

    setBatchProgress({ total: failedShots.length, completed: 0, failed: [] });
    const newFailedIds: string[] = [];
    const newFailedMessages: string[] = [];

    for (const shot of failedShots) {
      try {
        const resp = await apiFetch(`/api/projects/${project.id}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: singleAction,
            payload: {
              shotId: shot.id,
              ratio: videoRatio,
              versionId: selectedVersionId,
              directorControl,
            },
            modelConfig: getModelConfig(),
            episodeId: useProjectStore.getState().currentEpisodeId,
          }),
        });
        if (!resp.ok) throw new Error(`Shot ${shot.sequence} failed`);
      } catch (err) {
        newFailedIds.push(shot.id);
        if (err instanceof ApiError && err.message) newFailedMessages.push(err.message);
        else if (err instanceof Error && err.message) newFailedMessages.push(err.message);
      }
      setBatchProgress((prev) =>
        prev ? { ...prev, completed: prev.completed + 1, failed: newFailedIds.slice() } : null
      );
    }

    setGeneratingStoryboardPrompts(false);
    setGeneratingFrames(false);
    setGeneratingVideos(false);
    setGeneratingSceneFrames(false);
    setGeneratingVideoPrompts(false);

    await refreshCurrentStoryboardView();
    setLastFailedShots(newFailedIds);
    setBatchProgress(null);

    if (newFailedIds.length === 0) {
      toast.success("All retries succeeded");
    } else {
      const detail = newFailedMessages[0]
        ? newFailedMessages[0].length > 120
          ? `${newFailedMessages[0].slice(0, 120)}...`
          : newFailedMessages[0]
        : null;
      toast.error(
        detail
          ? `${newFailedIds.length} shots still failing: ${detail}`
          : `${newFailedIds.length} shots still failing`
      );
    }
  }

  return { handleRetryFailed };
}
