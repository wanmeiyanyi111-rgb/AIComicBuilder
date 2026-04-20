import { toast } from "sonner";
import { apiFetch } from "@/lib/api-fetch";
import { useProjectStore } from "@/stores/project-store";
import type { Shot } from "@/stores/project-store";
import type { StoryboardGenerationMode, StoryboardProject } from "./storyboard-generation-types";

type Params = {
  directorControl: {
    actionIntensity: number;
    cameraMotion: number;
    emotionIntensity: number;
  };
  executePreflightFix: (
    item: any,
    options?: { silent?: boolean; postCheckStage?: any }
  ) => Promise<boolean>;
  fetchProject: (projectId: string, episodeId?: string, versionId?: string) => Promise<unknown>;
  generationMode: StoryboardGenerationMode;
  getModelConfig: () => unknown;
  mergeSinglePreflightResult: (next: any) => void;
  project: StoryboardProject;
  runVideoPreflightRequest: (shotIds?: string[]) => Promise<any>;
  selectedVersionId: string | null;
  videoRatio: string;
};

export function useStoryboardSingleVideoGenerate({
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
}: Params) {
  async function handleSingleVideoGenerateWithPreflight(shot: Shot) {
    if (!project) return;
    const firstPreflight = await runVideoPreflightRequest([shot.id]);
    mergeSinglePreflightResult(firstPreflight);
    let approvedShots = firstPreflight.results.filter((item: any) => item.pass);

    if (approvedShots.length === 0) {
      const blockedItem = firstPreflight.results[0];
      if (!blockedItem) return;
      toast.info("当前镜头预检未通过，正在尝试 AI 自动修复...");
      const fixed = await executePreflightFix(blockedItem, { silent: true });
      if (!fixed) {
        toast.error("AI 自动修复失败，请查看预检面板后再手动调整");
        return;
      }
      const secondPreflight = await runVideoPreflightRequest([shot.id]);
      mergeSinglePreflightResult(secondPreflight);
      approvedShots = secondPreflight.results.filter((item: any) => item.pass);
      if (approvedShots.length === 0) {
        toast.error("AI 自动修复后该镜头仍未通过预检，请查看修复差异后继续调整");
        return;
      }
      toast.success("AI 自动修复完成，镜头已通过预检，继续生成视频");
    }

    await apiFetch(`/api/projects/${project.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action:
          generationMode === "reference" ? "single_reference_video" : "single_video_generate",
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

    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId || undefined);
    const refreshed = await runVideoPreflightRequest([shot.id]);
    mergeSinglePreflightResult(refreshed);
  }

  return { handleSingleVideoGenerateWithPreflight };
}
