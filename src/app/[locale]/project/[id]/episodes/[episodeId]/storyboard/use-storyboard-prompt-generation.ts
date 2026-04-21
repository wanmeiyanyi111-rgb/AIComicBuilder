import { toast } from "sonner";
import { apiFetch } from "@/lib/api-fetch";
import { getStoryboardPanelPrompts, useProjectStore } from "@/stores/project-store";
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
  fetchProject: (projectId: string, episodeId?: string, versionId?: string) => Promise<unknown>;
  generationMode: StoryboardGenerationMode;
  getModelConfig: () => unknown;
  hasReferenceFrameForShot: (shot: Shot) => boolean;
  hasStoryboardFrameForShot: (shot: Shot) => boolean;
  hasVideoPromptForShot: (shot: Shot) => boolean;
  project: StoryboardProject;
  refreshCurrentStoryboardView: () => Promise<void>;
  selectedVersionId: string | null;
  setBatchProgress: BatchProgressSetter;
  setGeneratingRefPrompts: BooleanSetter;
  setGeneratingStoryboardPrompts: BooleanSetter;
  setGeneratingVideoPrompts: BooleanSetter;
  setLastBatchAction: (value: string | null) => void;
  setLastFailedShots: StringArraySetter;
  t: (key: string, values?: Record<string, string | number>) => string;
  textGuard: () => boolean;
  videoRatio: string;
};

function normalizeTargetShotIds(targetShotIds?: string | string[] | null): string[] {
  if (Array.isArray(targetShotIds)) {
    return targetShotIds.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof targetShotIds === "string") {
    const normalized = targetShotIds.trim();
    return normalized ? [normalized] : [];
  }
  return [];
}

export function useStoryboardPromptGeneration({
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
}: Params) {
  async function handleGenerateRefPrompts() {
    if (!project) return;
    if (!textGuard()) return;
    setGeneratingRefPrompts(true);
    try {
      const resp = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_ref_prompts",
          payload: { versionId: selectedVersionId },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      if (!resp.ok) throw new Error("Failed");
      const data = await resp.json();
      toast.success(`已生成 ${data.updatedCount}/${data.totalShots} 个镜头的参考图提示词`);
      await fetchProject(project.id, useProjectStore.getState().currentEpisodeId || undefined);
    } catch {
      toast.error("Failed to generate ref prompts");
    } finally {
      setGeneratingRefPrompts(false);
    }
  }

  async function handleGenerateStoryboardPrompts(targetShotIds?: string | string[] | null) {
    if (!project) return;
    if (!textGuard()) return;
    const targetIdSet = new Set(normalizeTargetShotIds(targetShotIds));
    const targets = [...project.shots]
      .filter((shot) => targetIdSet.size === 0 || targetIdSet.has(shot.id))
      .sort((a, b) => a.sequence - b.sequence);
    if (targets.length === 0) {
      toast.info("暂无可生成四宫格提示词的镜头");
      return;
    }

    setGeneratingStoryboardPrompts(true);
    setLastBatchAction("batch_storyboard_prompt");
    setLastFailedShots([]);
    setBatchProgress({
      total: targets.length,
      completed: 0,
      inProgress: 0,
      failed: [],
    });

    const failedIds: string[] = [];
    const failedMessages: string[] = [];
    try {
      for (const shot of targets) {
        let succeeded = false;
        setBatchProgress((prev) => (prev ? { ...prev, inProgress: 1 } : null));
        try {
          const resp = await apiFetch(`/api/projects/${project.id}/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "generate_storyboard_prompts",
              payload: {
                shotId: shot.id,
                versionId: selectedVersionId,
                ratio: videoRatio,
              },
              modelConfig: getModelConfig(),
              episodeId: useProjectStore.getState().currentEpisodeId,
            }),
          });
          const data = (await resp.json()) as {
            updatedCount?: number;
            failed?: Array<{ error?: string }>;
          };
          const shotError = data.failed?.[0]?.error;
          if ((data.updatedCount || 0) < 1) {
            throw new Error(shotError || `镜头 ${shot.sequence} 四宫格提示词生成失败`);
          }
          await refreshCurrentStoryboardView();
          succeeded = true;
        } catch (err) {
          failedIds.push(shot.id);
          failedMessages.push(
            err instanceof Error ? err.message : `镜头 ${shot.sequence} 四宫格提示词生成失败`
          );
        } finally {
          setBatchProgress((prev) =>
            prev
              ? {
                  ...prev,
                  completed: Math.min(prev.total, prev.completed + (succeeded ? 1 : 0)),
                  inProgress: 0,
                  failed: failedIds.slice(),
                }
              : null
          );
        }
      }

      setLastFailedShots(failedIds);
      if (failedIds.length > 0) {
        const detail = failedMessages[0]
          ? failedMessages[0].length > 120
            ? `${failedMessages[0].slice(0, 120)}...`
            : failedMessages[0]
          : null;
        toast.error(
          detail
            ? `${failedIds.length}/${targets.length} 个镜头提示词生成失败：${detail}`
            : `${failedIds.length}/${targets.length} 个镜头提示词生成失败`
        );
      } else {
        toast.success(`已逐条生成 ${targets.length} 个镜头的四宫格提示词`);
      }
    } catch {
      toast.error("生成四宫格提示词失败");
    } finally {
      setGeneratingStoryboardPrompts(false);
      setBatchProgress(null);
      try {
        await refreshCurrentStoryboardView();
      } catch {
        // ignore refresh jitter after batch prompt generation
      }
    }
  }

  async function handleBatchGenerateVideoPrompts() {
    if (!project) return;
    const targets = [...project.shots]
      .filter((shot) => {
        if (generationMode === "reference") {
          return hasReferenceFrameForShot(shot);
        }
        return (
          hasStoryboardFrameForShot(shot) ||
          getStoryboardPanelPrompts(shot).filter((prompt) => prompt.trim()).length >= 4
        );
      })
      .sort((a, b) => a.sequence - b.sequence);

    if (targets.length === 0) {
      toast.info(
        generationMode === "reference"
          ? "当前没有可生成视频提示词的镜头，请先补齐参考图"
          : "当前没有可生成视频提示词的镜头，请先补齐四宫格提示词"
      );
      return;
    }

    setGeneratingVideoPrompts(true);
    setLastBatchAction("batch_video_prompt");
    setLastFailedShots([]);
    setBatchProgress({
      total: targets.length,
      completed: 0,
      inProgress: 0,
      failed: [],
    });

    try {
      const failedIds: string[] = [];
      const failedMessages: string[] = [];

      for (const shot of targets) {
        let succeeded = false;
        setBatchProgress((prev) => (prev ? { ...prev, inProgress: 1 } : null));
        try {
          await apiFetch(`/api/projects/${project.id}/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "single_video_prompt",
              payload: {
                shotId: shot.id,
                versionId: selectedVersionId,
                directorControl,
              },
              modelConfig: getModelConfig(),
              episodeId: useProjectStore.getState().currentEpisodeId,
            }),
          });
          await refreshCurrentStoryboardView();
          succeeded = true;
        } catch (err) {
          failedIds.push(shot.id);
          failedMessages.push(
            err instanceof Error ? err.message : `镜头 ${shot.sequence} 视频提示词生成失败`
          );
        } finally {
          setBatchProgress((prev) =>
            prev
              ? {
                  ...prev,
                  completed: Math.min(prev.total, prev.completed + (succeeded ? 1 : 0)),
                  inProgress: 0,
                  failed: failedIds.slice(),
                }
              : null
          );
        }
      }

      setLastFailedShots(failedIds);
      if (failedIds.length > 0) {
        const detail = failedMessages[0]
          ? failedMessages[0].length > 120
            ? `${failedMessages[0].slice(0, 120)}...`
            : failedMessages[0]
          : null;
        toast.error(
          detail
            ? `${failedIds.length}/${targets.length} 个镜头视频提示词生成失败：${detail}`
            : `${failedIds.length}/${targets.length} 个镜头视频提示词生成失败`
        );
      } else {
        toast.success(`已逐条更新 ${targets.length} 个镜头的视频提示词`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    } finally {
      setGeneratingVideoPrompts(false);
      setBatchProgress(null);
      try {
        await refreshCurrentStoryboardView();
      } catch {
        // ignore refresh jitter after batch prompt generation
      }
    }
  }

  return {
    handleBatchGenerateVideoPrompts,
    handleGenerateRefPrompts,
    handleGenerateStoryboardPrompts,
  };
}
