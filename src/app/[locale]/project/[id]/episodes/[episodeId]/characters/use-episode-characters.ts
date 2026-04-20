"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useProjectStore } from "@/stores/project-store";
import { apiFetch, ApiError } from "@/lib/api-fetch";

export type VisualAssetType = "scene" | "prop";

export type VisualAsset = {
  id: string;
  projectId: string;
  episodeId: string | null;
  type: VisualAssetType;
  name: string;
  prompt: string;
  imageUrl: string | null;
  status: "pending" | "generating" | "completed" | "failed";
  errorMessage: string | null;
};

type Params = {
  currentEpisodeId: string | null;
  fetchProject: (projectId: string, episodeId?: string, versionId?: string) => Promise<unknown>;
  getModelConfig: () => unknown;
  imageGuard: () => boolean;
  locale: string;
  project: { id: string } | null;
  routerPush: (href: string) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
  textGuard: () => boolean;
};

export function useEpisodeCharacters({
  currentEpisodeId,
  fetchProject,
  getModelConfig,
  imageGuard,
  locale,
  project,
  routerPush,
  t,
  textGuard,
}: Params) {
  const [extracting, setExtracting] = useState(false);
  const [generatingImages, setGeneratingImages] = useState(false);
  const [visualAssets, setVisualAssets] = useState<VisualAsset[]>([]);
  const [loadingVisualAssets, setLoadingVisualAssets] = useState(false);
  const [creatingSceneAsset, setCreatingSceneAsset] = useState(false);
  const [creatingPropAsset, setCreatingPropAsset] = useState(false);
  const [batchGeneratingScene, setBatchGeneratingScene] = useState(false);
  const [batchGeneratingProp, setBatchGeneratingProp] = useState(false);
  const [extractingVisualCandidates, setExtractingVisualCandidates] = useState(false);
  const [generatingAssetIds, setGeneratingAssetIds] = useState<string[]>([]);

  const fetchVisualAssets = useCallback(async () => {
    if (!project?.id || !currentEpisodeId) {
      setVisualAssets([]);
      return;
    }

    setLoadingVisualAssets(true);
    try {
      const res = await apiFetch(`/api/projects/${project.id}/visual-assets?episodeId=${currentEpisodeId}`);
      const rows = (await res.json()) as VisualAsset[];
      setVisualAssets(rows);
    } catch (err) {
      console.error("Visual assets fetch error:", err);
      toast.error(t("common.generationFailed"));
    } finally {
      setLoadingVisualAssets(false);
    }
  }, [currentEpisodeId, project?.id, t]);

  useEffect(() => {
    void fetchVisualAssets();
  }, [fetchVisualAssets]);

  async function refreshProject() {
    if (!project?.id) return;
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId || undefined);
  }

  async function handleExtractCharacters() {
    if (!project || !textGuard()) return;
    setExtracting(true);
    try {
      await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "character_extract",
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) {
        const message = err.message || t("common.generationFailed");
        toast.warning(message, {
          action: {
            label: t("project.script"),
            onClick: () => {
              const target = currentEpisodeId
                ? `/${locale}/project/${project.id}/episodes/${currentEpisodeId}/script`
                : `/${locale}/project/${project.id}/script`;
              routerPush(target);
            },
          },
        });
      } else {
        console.error("Character extract error:", err);
        toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
      }
    } finally {
      setExtracting(false);
      await refreshProject();
    }
  }

  async function handleBatchGenerateImages() {
    if (!project || !imageGuard()) return;
    setGeneratingImages(true);
    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_character_image",
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      const data = (await response.json()) as { results: Array<{ status: string }> };
      if (data.results?.some((r) => r.status === "error")) {
        toast.warning(t("common.batchPartialFailed"));
      }
    } catch (err) {
      console.error("Batch character image error:", err);
      toast.error(t("common.generationFailed"));
    } finally {
      setGeneratingImages(false);
      await refreshProject();
    }
  }

  async function createVisualAsset(type: VisualAssetType) {
    if (!project?.id || !currentEpisodeId) return;
    if (type === "scene") setCreatingSceneAsset(true);
    if (type === "prop") setCreatingPropAsset(true);
    try {
      await apiFetch(`/api/projects/${project.id}/visual-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodeId: currentEpisodeId,
          type,
          name: type === "scene" ? t("visualAsset.defaultSceneName") : t("visualAsset.defaultPropName"),
          prompt: "",
        }),
      });
      await fetchVisualAssets();
    } catch (err) {
      console.error("Create visual asset error:", err);
      toast.error(t("common.generationFailed"));
    } finally {
      if (type === "scene") setCreatingSceneAsset(false);
      if (type === "prop") setCreatingPropAsset(false);
    }
  }

  async function updateVisualAsset(assetId: string, patch: { name?: string; prompt?: string }) {
    if (!project?.id) return;
    try {
      await apiFetch(`/api/projects/${project.id}/visual-assets/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await fetchVisualAssets();
    } catch (err) {
      console.error("Update visual asset error:", err);
      toast.error(t("common.generationFailed"));
    }
  }

  async function deleteVisualAsset(assetId: string) {
    if (!project?.id) return;
    try {
      await apiFetch(`/api/projects/${project.id}/visual-assets/${assetId}`, { method: "DELETE" });
      await fetchVisualAssets();
    } catch (err) {
      console.error("Delete visual asset error:", err);
      toast.error(t("common.generationFailed"));
    }
  }

  async function generateVisualAssetImage(assetId: string) {
    if (!project?.id || !imageGuard()) return;
    setGeneratingAssetIds((prev) => [...prev, assetId]);
    try {
      await apiFetch(`/api/projects/${project.id}/visual-assets/${assetId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelConfig: getModelConfig() }),
      });
      await fetchVisualAssets();
    } catch (err) {
      console.error("Generate visual asset error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    } finally {
      setGeneratingAssetIds((prev) => prev.filter((id) => id !== assetId));
    }
  }

  async function batchGenerateVisualAssets(type: VisualAssetType) {
    if (!project?.id || !currentEpisodeId || !imageGuard()) return;
    if (type === "scene") setBatchGeneratingScene(true);
    if (type === "prop") setBatchGeneratingProp(true);
    const pollTimer = window.setInterval(() => {
      void fetchVisualAssets();
    }, 5000);
    try {
      const res = await apiFetch(`/api/projects/${project.id}/visual-assets/generate-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodeId: currentEpisodeId,
          type,
          modelConfig: getModelConfig(),
        }),
      });
      const data = (await res.json()) as { results?: Array<{ status: "ok" | "error" }> };
      if (data.results?.some((item) => item.status === "error")) {
        toast.warning(t("common.batchPartialFailed"));
      }
      await fetchVisualAssets();
    } catch (err) {
      console.error("Batch generate visual assets error:", err);
      toast.error(t("common.generationFailed"));
    } finally {
      window.clearInterval(pollTimer);
      if (type === "scene") setBatchGeneratingScene(false);
      if (type === "prop") setBatchGeneratingProp(false);
    }
  }

  async function handleExtractVisualCandidates() {
    if (!project?.id || !currentEpisodeId || !textGuard()) return;
    setExtractingVisualCandidates(true);
    try {
      const response = await apiFetch(`/api/projects/${project.id}/visual-assets/extract-candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodeId: currentEpisodeId,
          refreshExisting: true,
          modelConfig: getModelConfig(),
        }),
      });
      const data = (await response.json()) as {
        created: number;
        createdScenes: number;
        createdProps: number;
        updated?: number;
        updatedScenes?: number;
        updatedProps?: number;
      };
      const changedTotal = data.created + (data.updated || 0);
      const changedScenes = data.createdScenes + (data.updatedScenes || 0);
      const changedProps = data.createdProps + (data.updatedProps || 0);
      if (changedTotal > 0) {
        toast.success(t("visualAsset.extractSuccess", { count: changedTotal, scenes: changedScenes, props: changedProps }));
      } else {
        toast.message(t("visualAsset.extractNoNew"));
      }
      await fetchVisualAssets();
    } catch (err) {
      console.error("Extract visual candidates error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    } finally {
      setExtractingVisualCandidates(false);
    }
  }

  return {
    batchGeneratingProp,
    batchGeneratingScene,
    createVisualAsset,
    creatingPropAsset,
    creatingSceneAsset,
    deleteVisualAsset,
    extracting,
    extractingVisualCandidates,
    fetchVisualAssets,
    generateVisualAssetImage,
    generatingAssetIds,
    generatingImages,
    handleBatchGenerateImages,
    handleExtractCharacters,
    handleExtractVisualCandidates,
    loadingVisualAssets,
    updateVisualAsset,
    visualAssets,
    batchGenerateVisualAssets,
  };
}
