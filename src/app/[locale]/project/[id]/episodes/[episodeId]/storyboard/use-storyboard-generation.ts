import { useState } from "react";
import { toast } from "sonner";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { useProjectStore } from "@/stores/project-store";
import type { Shot } from "@/stores/project-store";
import {
  getStoryboardImageAudit,
  getStoryboardPromptAudit,
} from "@/stores/project-store";
import type { BatchProgress, UseStoryboardGenerationParams } from "./storyboard-generation-types";
import { useStoryboardBatchProgress } from "./use-storyboard-batch-progress";
import { useStoryboardAutoRun } from "./use-storyboard-auto-run";
import { useStoryboardBatchGenerators } from "./use-storyboard-batch-generators";
import { useStoryboardReplan } from "./use-storyboard-replan";
import { useStoryboardPromptGeneration } from "./use-storyboard-prompt-generation";
import { useStoryboardRetry } from "./use-storyboard-retry";
import { useStoryboardSingleVideoGenerate } from "./use-storyboard-single-video-generate";

export function useStoryboardGeneration({
  directorControl,
  ensureStoryboardPromptTargetsPassedPrecheck,
  ensureVideoTargetsPassedPreflight,
  executePreflightFix,
  fetchProject,
  generationMode,
  getBatchFailureDetail,
  getModelConfig,
  hasReferenceFrameForShot,
  hasReferenceVideoForShot,
  hasStoryboardFrameForShot,
  hasStoryboardVideoForShot,
  hasVideoPromptForShot,
  imageGuard,
  project,
  refreshCurrentStoryboardView,
  runVideoPreflightRequest,
  mergeSinglePreflightResult,
  selectedVersionId,
  setSelectedVersionId,
  t,
  textGuard,
  videoGuard,
  videoRatio,
}: UseStoryboardGenerationParams) {
  const currentEpisodeId = useProjectStore((s) => s.currentEpisodeId);
  const [generating, setGenerating] = useState(false);
  const [generatingFrames, setGeneratingFrames] = useState(false);
  const [generatingVideos, setGeneratingVideos] = useState(false);
  const [generatingSceneFrames, setGeneratingSceneFrames] = useState(false);
  const [generatingVideoPrompts, setGeneratingVideoPrompts] = useState(false);
  const [sceneFramesOverwrite, setSceneFramesOverwrite] = useState(false);
  const [generatingFramesOverwrite, setGeneratingFramesOverwrite] = useState(false);
  const [generatingVideosOverwrite, setGeneratingVideosOverwrite] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress>(null);
  const [lastFailedShots, setLastFailedShots] = useState<string[]>([]);
  const [lastBatchAction, setLastBatchAction] = useState<string | null>(null);
  const [generatingRefPrompts, setGeneratingRefPrompts] = useState(false);
  const [generatingStoryboardPrompts, setGeneratingStoryboardPrompts] = useState(false);

  const anyGenerating =
    generating ||
    generatingFrames ||
    generatingVideos ||
    generatingSceneFrames ||
    generatingVideoPrompts ||
    generatingRefPrompts ||
    generatingStoryboardPrompts;

  const {
    handlePreviewReplanLongShots,
    handleReplanLongShots,
    previewingReplanLongShots,
    replanningLongShots,
  } = useStoryboardReplan({
    fetchProject,
    project,
    selectedVersionId,
    t,
  });

  async function handleGenerateShots() {
    if (!project) return;
    if (!textGuard()) return;
    setGenerating(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "shot_split",
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });

      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message || t("common.generationFailed"));
      } else {
        toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
      }
    }

    setGenerating(false);
    setSelectedVersionId(null);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId || undefined);
  }

  const {
    handleBatchGenerateFrames,
    handleBatchGenerateReferenceVideos,
    handleBatchGenerateSceneFrames,
    handleBatchGenerateVideos,
  } = useStoryboardBatchGenerators({
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
  });

  const {
    handleBatchGenerateVideoPrompts,
    handleGenerateRefPrompts,
    handleGenerateStoryboardPrompts,
  } = useStoryboardPromptGeneration({
    directorControl,
    fetchProject,
    generationMode,
    getModelConfig,
    hasReferenceFrameForShot,
    hasStoryboardFrameForShot,
    hasVideoPromptForShot,
    project,
    refreshCurrentStoryboardView,
    selectedVersionId,
    setBatchProgress,
    setGeneratingRefPrompts,
    setGeneratingStoryboardPrompts,
    setGeneratingVideoPrompts,
    setLastBatchAction,
    setLastFailedShots,
    t,
    textGuard,
    videoRatio,
  });

  const { handleSingleVideoGenerateWithPreflight } = useStoryboardSingleVideoGenerate({
    directorControl,
    executePreflightFix,
    fetchProject,
    generationMode,
    getModelConfig,
    mergeSinglePreflightResult,
    project,
    runVideoPreflightRequest,
    selectedVersionId,
    videoRatio,
  });

  const { handleRetryFailed } = useStoryboardRetry({
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
  });

  const { handleAutoRun } = useStoryboardAutoRun({
    generationMode,
    handleBatchGenerateFrames,
    handleBatchGenerateReferenceVideos,
    handleBatchGenerateSceneFrames,
    handleBatchGenerateVideoPrompts,
    handleBatchGenerateVideos,
    handleGenerateRefPrompts,
    handleGenerateShots,
    hasReferenceFrameForShot,
    hasReferenceVideoForShot,
    hasStoryboardFrameForShot,
    hasStoryboardVideoForShot,
    hasVideoPromptForShot,
    project,
    t,
  });

  useStoryboardBatchProgress({
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
  });

  async function handleRepairContinuityPrompts() {
    if (!project) return;
    const targetShotIds = project.shots
      .filter((shot) => {
        const audit = getStoryboardPromptAudit(shot);
        return audit.pass === false || audit.issues.length > 0;
      })
      .map((shot) => shot.id);
    if (targetShotIds.length === 0) {
      toast.info("当前没有需要修复连续性提示词的镜头");
      return;
    }
    await handleGenerateStoryboardPrompts(targetShotIds);
  }

  async function handleRepairContinuityImages() {
    if (!project) return;
    const targetShotIds = project.shots
      .filter((shot) => {
        const promptAudit = getStoryboardPromptAudit(shot);
        const imageAudit = getStoryboardImageAudit(shot);
        return (
          promptAudit.pass === false ||
          promptAudit.issues.length > 0 ||
          imageAudit.pass === false
        );
      })
      .map((shot) => shot.id);
    if (targetShotIds.length === 0) {
      toast.info("当前没有需要重生图片的连续性问题镜头");
      return;
    }
    await handleBatchGenerateFrames(true, targetShotIds);
  }

  return {
    anyGenerating,
    batchProgress,
    generating,
    generatingFrames,
    generatingFramesOverwrite,
    generatingRefPrompts,
    generatingSceneFrames,
    generatingStoryboardPrompts,
    generatingVideoPrompts,
    generatingVideos,
    generatingVideosOverwrite,
    handleAutoRun,
    handleBatchGenerateFrames,
    handleBatchGenerateReferenceVideos,
    handleBatchGenerateSceneFrames,
    handleBatchGenerateVideoPrompts,
    handleBatchGenerateVideos,
    handleGenerateRefPrompts,
    handleRepairContinuityImages,
    handleRepairContinuityPrompts,
    handleGenerateShots,
    handleGenerateStoryboardPrompts,
    handlePreviewReplanLongShots,
    handleReplanLongShots,
    handleRetryFailed,
    handleSingleVideoGenerateWithPreflight,
    lastFailedShots,
    previewingReplanLongShots,
    replanningLongShots,
    sceneFramesOverwrite,
  };
}
