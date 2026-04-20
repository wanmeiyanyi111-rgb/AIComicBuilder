import { useEffect } from "react";
import { useProjectStore } from "@/stores/project-store";
import type { Shot } from "@/stores/project-store";
import type { BatchProgress } from "./storyboard-generation-types";

type Params = {
  batchProgress: BatchProgress;
  fetchProject: (projectId: string, episodeId?: string, versionId?: string) => Promise<unknown>;
  generatingFrames: boolean;
  generatingSceneFrames: boolean;
  generatingVideoPrompts: boolean;
  generatingVideos: boolean;
  hasReferenceFrameForShot: (shot: Shot) => boolean;
  hasReferenceVideoForShot: (shot: Shot) => boolean;
  hasStoryboardFrameForShot: (shot: Shot) => boolean;
  hasStoryboardVideoForShot: (shot: Shot) => boolean;
  hasVideoPromptForShot: (shot: Shot) => boolean;
  project: { id: string } | null;
  setBatchProgress: React.Dispatch<React.SetStateAction<BatchProgress>>;
};

export function useStoryboardBatchProgress({
  batchProgress,
  fetchProject,
  generatingFrames,
  generatingSceneFrames,
  generatingVideoPrompts,
  generatingVideos,
  hasReferenceFrameForShot,
  hasReferenceVideoForShot,
  hasStoryboardFrameForShot,
  hasStoryboardVideoForShot,
  hasVideoPromptForShot,
  project,
  setBatchProgress,
}: Params) {
  useEffect(() => {
    if (!project || !batchProgress?.targetShotIds || !batchProgress.action) return;

    const isActionRunning =
      (batchProgress.action === "batch_storyboard_generate" && generatingFrames) ||
      (batchProgress.action === "batch_scene_frame" && generatingSceneFrames) ||
      (batchProgress.action === "batch_video_prompt" && generatingVideoPrompts) ||
      (batchProgress.action === "batch_video_generate" && generatingVideos) ||
      (batchProgress.action === "batch_reference_video" && generatingVideos);
    if (!isActionRunning) return;

    let cancelled = false;
    let inflight = false;

    const computeCompleted = (shot: Shot, action: string): boolean => {
      if (shot.status === "completed") return true;
      if (action === "batch_storyboard_generate") return hasStoryboardFrameForShot(shot);
      if (action === "batch_scene_frame") return hasReferenceFrameForShot(shot);
      if (action === "batch_video_prompt") return hasVideoPromptForShot(shot);
      if (action === "batch_video_generate") return hasStoryboardVideoForShot(shot);
      if (action === "batch_reference_video") return hasReferenceVideoForShot(shot);
      return false;
    };

    const tick = async () => {
      if (cancelled || inflight) return;
      inflight = true;
      try {
        await fetchProject(project.id, useProjectStore.getState().currentEpisodeId || undefined);
        if (cancelled) return;
        const latestShots = useProjectStore.getState().project?.shots ?? [];
        const idSet = new Set(batchProgress.targetShotIds);
        const targetShots = latestShots.filter((shot) => idSet.has(shot.id));
        const completed = targetShots.filter((shot) =>
          computeCompleted(shot, batchProgress.action || "")
        ).length;
        const inProgress = targetShots.filter((shot) => shot.status === "generating").length;
        const failed = targetShots.filter((shot) => shot.status === "failed").map((shot) => shot.id);
        setBatchProgress((prev) =>
          prev
            ? {
                ...prev,
                completed: Math.min(prev.total, completed),
                inProgress,
                failed,
              }
            : null
        );
      } finally {
        inflight = false;
      }
    };

    const timer = setInterval(tick, 3000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    batchProgress,
    fetchProject,
    generatingFrames,
    generatingSceneFrames,
    generatingVideoPrompts,
    generatingVideos,
    hasReferenceFrameForShot,
    hasReferenceVideoForShot,
    hasStoryboardFrameForShot,
    hasStoryboardVideoForShot,
    hasVideoPromptForShot,
    project,
    setBatchProgress,
  ]);
}
