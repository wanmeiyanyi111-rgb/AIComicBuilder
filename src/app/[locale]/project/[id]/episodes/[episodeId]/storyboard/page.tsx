"use client";

import {
  useProjectStore,
  getFirstFrameUrl,
  getLastFrameUrl,
  getSceneRefFrameUrl,
  getKeyframeVideoUrl,
  getReferenceVideoUrl,
  getReferenceAssets,
  hasKeyframePair,
  getFirstFramePrompt,
  getLastFramePrompt,
} from "@/stores/project-store";
import { useEpisodeStore } from "@/stores/episode-store";
import { useModelStore } from "@/stores/model-store";
import { ShotCard } from "@/components/editor/shot-card";
import { Button } from "@/components/ui/button";
import { useTranslations, useLocale } from "next-intl";
import { useState, useEffect, useRef, useMemo } from "react";
import type { StoryboardVersion } from "@/stores/project-store";
import { useModelGuard } from "@/hooks/use-model-guard";
import {
  Film,
  Sparkles,
  ImageIcon,
  VideoIcon,
  Loader2,
  Download,
  RefreshCw,
  Play,
  Plus,
  LayoutGrid,
  List,
  ChevronDown,
  GitCompare,
} from "lucide-react";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { VideoRatioPicker } from "@/components/editor/video-ratio-picker";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { GenerationModeTab } from "@/components/editor/generation-mode-tab";
import { ShotDrawer } from "@/components/editor/shot-drawer";
import { CharactersInlinePanel } from "@/components/editor/characters-inline-panel";
import { ShotKanban } from "@/components/editor/shot-kanban";
import { VersionCompare } from "@/components/editor/version-compare";
import { PromptEditButton } from "@/components/prompt-templates/prompt-edit-button";
import Link from "next/link";

export default function EpisodeStoryboardPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { project, fetchProject } = useProjectStore();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const [generating, setGenerating] = useState(false);
  const [generatingFrames, setGeneratingFrames] = useState(false);
  const [generatingVideos, setGeneratingVideos] = useState(false);
  const [generatingSceneFrames, setGeneratingSceneFrames] = useState(false);
  const [generatingRefImages, setGeneratingRefImages] = useState(false);
  const [generatingVideoPrompts, setGeneratingVideoPrompts] = useState(false);
  const [sceneFramesOverwrite, setSceneFramesOverwrite] = useState(false);
  const [generatingFramesOverwrite, setGeneratingFramesOverwrite] = useState(false);
  const [generatingVideosOverwrite, setGeneratingVideosOverwrite] = useState(false);
  const [videoRatio, setVideoRatio] = useState("16:9");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [versions, setVersions] = useState<StoryboardVersion[]>([]);
  const [openDrawerShotId, setOpenDrawerShotId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const [versionDropdownOpen, setVersionDropdownOpen] = useState(false);
  const versionDropdownRef = useRef<HTMLDivElement>(null);
  const [batchProgress, setBatchProgress] = useState<{
    total: number;
    completed: number;
    inProgress?: number;
    failed: string[]; // shot IDs that failed
    targetShotIds?: string[];
    action?: string;
  } | null>(null);
  const [lastFailedShots, setLastFailedShots] = useState<string[]>([]);
  const [lastBatchAction, setLastBatchAction] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [generatingRefPrompts, setGeneratingRefPrompts] = useState(false);
  const [generatingKeyframeAssets, setGeneratingKeyframeAssets] = useState(false);
  const [replanningLongShots, setReplanningLongShots] = useState(false);
  const [previewingReplanLongShots, setPreviewingReplanLongShots] = useState(false);

  const currentEpisodeId = useProjectStore((s) => s.currentEpisodeId);
  const episodeStoreEpisodes = useEpisodeStore((s) => s.episodes);
  const fetchEpisodes = useEpisodeStore((s) => s.fetchEpisodes);

  useEffect(() => {
    if (project?.id && episodeStoreEpisodes.length === 0) {
      fetchEpisodes(project.id);
    }
  }, [project?.id, episodeStoreEpisodes.length, fetchEpisodes]);


  function switchView(mode: "list" | "kanban") {
    setViewMode(mode);
    if (project) localStorage.setItem(`storyboardView:${project.id}`, mode);
  }

  const textGuard = useModelGuard("text");
  const imageGuard = useModelGuard("image");
  const videoGuard = useModelGuard("video");

  useEffect(() => {
    if (!project?.id) return;
    const stored = localStorage.getItem(`storyboardView:${project.id}`);
    if (stored === "list" || stored === "kanban") setViewMode(stored);
  }, [project?.id]);

  useEffect(() => {
    if (!project?.versions) return;
    setVersions(project.versions);
    setSelectedVersionId((current) => {
      if (current === null && project.versions!.length > 0) {
        return project.versions![0].id;
      }
      return current;
    });
  }, [project?.versions]);

  const shots = useMemo(() => project?.shots ?? [], [project?.shots]);
  const projectCharacters = useMemo(
    () => project?.characters ?? [],
    [project?.characters]
  );

  const sceneGroups = useMemo(() => {
    const groupMap = new Map<string, { sceneId: string; shots: typeof shots }>();
    const ungrouped: typeof shots = [];

    for (const shot of shots) {
      if (shot.sceneId) {
        const existing = groupMap.get(shot.sceneId);
        if (existing) {
          existing.shots.push(shot);
        } else {
          groupMap.set(shot.sceneId, { sceneId: shot.sceneId, shots: [shot] });
        }
      } else {
        ungrouped.push(shot);
      }
    }

    return {
      groups: Array.from(groupMap.values()),
      ungrouped,
    };
  }, [shots]);

  const generationMode = (project?.generationMode || "keyframe") as "keyframe" | "reference";

  const totalShots = shots.length;
  const shotsWithFrames = shots.filter((s) => hasKeyframePair(s)).length;
  const shotsWithVideo = shots.filter((s) =>
    generationMode === "reference" ? getReferenceVideoUrl(s) : getKeyframeVideoUrl(s)
  ).length;
  const shotsWithVideoPrompts = shots.filter((s) => s.videoPrompt).length;
  const shotsWithSceneFrames = shots.filter((s) => getSceneRefFrameUrl(s)).length;
  const shotsWithFrameAny = shots.filter(
    (s) => getSceneRefFrameUrl(s) || getFirstFrameUrl(s) || getLastFrameUrl(s)
  ).length;
  const charactersWithRefs = projectCharacters.filter((c) => c.referenceImage);
  const hasReferenceImages = charactersWithRefs.length > 0;

  // Check if all reference images are generated (for reference mode blocking)
  const allRefImagesGenerated = useMemo(() => {
    if (generationMode !== "reference") return true;
    for (const shot of shots) {
      const refOnly = getReferenceAssets(shot);
      if (refOnly.length === 0) continue;
      if (refOnly.some((r) => r.status !== "completed" && r.prompt)) {
        return false;
      }
    }
    return true;
  }, [shots, generationMode]);

  const shotsWithRefPrompts = useMemo(() => {
    return shots.filter((s) => {
      const refOnly = getReferenceAssets(s);
      return refOnly.length > 0 && refOnly.some((r) => r.prompt);
    }).length;
  }, [shots]);

  const shotsWithKeyframePrompts = useMemo(() => {
    return shots.filter((s) => {
      const ff = getFirstFramePrompt(s);
      const lf = getLastFramePrompt(s);
      return !!ff && !!lf;
    }).length;
  }, [shots]);

  const shotsWithAllRefImages = useMemo(() => {
    return shots.filter((s) => {
      const refOnly = getReferenceAssets(s);
      return refOnly.length > 0 && refOnly.every((r) => r.status === "completed" && r.fileUrl);
    }).length;
  }, [shots]);

  const anyGenerating = generating || generatingFrames || generatingVideos || generatingSceneFrames || generatingRefImages || generatingVideoPrompts || generatingRefPrompts;

  const drawerShots = shots;

  if (!project) return null;

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
        console.error("Shot split error:", err);
        toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
      }
    }

    setGenerating(false);
    setSelectedVersionId(null);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
  }

  async function handleReplanLongShots() {
    if (!project) return;
    setReplanningLongShots(true);
    try {
      const res = await apiFetch(`/api/projects/${project.id}/shots/replan-long`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodeId: useProjectStore.getState().currentEpisodeId,
          versionId: selectedVersionId ?? undefined,
        }),
      });
      const data = await res.json();
      if (data.status === "noop") {
        toast.info(t("storyboard.noLongShotsToReplan"));
      } else {
        toast.success(
          t("storyboard.replanLongShotsSuccess", {
            split: data.splitShots ?? 0,
            added: data.addedShots ?? 0,
          })
        );
      }
      await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t("storyboard.replanLongShotsError");
      toast.error(msg);
    } finally {
      setReplanningLongShots(false);
    }
  }

  async function handlePreviewReplanLongShots() {
    if (!project) return;
    setPreviewingReplanLongShots(true);
    try {
      const res = await apiFetch(`/api/projects/${project.id}/shots/replan-long`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodeId: useProjectStore.getState().currentEpisodeId,
          versionId: selectedVersionId ?? undefined,
          dryRun: true,
        }),
      });
      const data = await res.json();
      if (data.status === "noop") {
        toast.info(t("storyboard.noLongShotsToReplan"));
      } else {
        toast.info(
          t("storyboard.replanLongShotsDryRunSummary", {
            before: data.beforeCount ?? 0,
            after: data.afterCount ?? 0,
            split: data.splitShots ?? 0,
            added: data.addedShots ?? 0,
          })
        );
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t("storyboard.replanLongShotsError");
      toast.error(msg);
    } finally {
      setPreviewingReplanLongShots(false);
    }
  }

  async function handleBatchGenerateFrames(overwrite = false) {
    if (!project) return;
    if (!imageGuard()) return;
    setGeneratingFramesOverwrite(overwrite);
    setGeneratingFrames(true);
    setLastBatchAction("batch_frame_generate");

    const targets = project.shots.filter((s) => overwrite ? true : !getFirstFrameUrl(s));
    setBatchProgress({
      total: targets.length,
      completed: 0,
      inProgress: 0,
      failed: [],
      targetShotIds: targets.map((s) => s.id),
      action: "batch_frame_generate",
    });

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_frame_generate",
          payload: { ratio: videoRatio, overwrite, versionId: selectedVersionId },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      const data = await response.json() as { results: Array<{ shotId?: string; status: string }> };
      const failedIds = (data.results || []).filter((r) => r.status === "error").map((r) => r.shotId!).filter(Boolean);
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
      console.error("Batch frame generate error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGeneratingFramesOverwrite(false);
    setGeneratingFrames(false);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
    setBatchProgress(null);
  }

  async function handleBatchGenerateVideos(overwrite = false) {
    if (!project) return;
    if (!videoGuard()) return;
    setGeneratingVideosOverwrite(overwrite);
    setGeneratingVideos(true);
    setLastBatchAction("batch_video_generate");

    const targets = project.shots.filter((s) => overwrite ? true : !getKeyframeVideoUrl(s));
    setBatchProgress({
      total: targets.length,
      completed: 0,
      inProgress: 0,
      failed: [],
      targetShotIds: targets.map((s) => s.id),
      action: "batch_video_generate",
    });

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_video_generate",
          payload: { ratio: videoRatio, overwrite, versionId: selectedVersionId },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      const data = await response.json() as { results: Array<{ shotId?: string; status: string }> };
      const failedIds = (data.results || []).filter((r) => r.status === "error").map((r) => r.shotId!).filter(Boolean);
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
      console.error("Batch video generate error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGeneratingVideosOverwrite(false);
    setGeneratingVideos(false);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
    setBatchProgress(null);
  }

  async function handleBatchGenerateSceneFrames(overwrite = false) {
    if (!project) return;
    if (!imageGuard()) return;
    setSceneFramesOverwrite(overwrite);
    setGeneratingSceneFrames(true);
    setLastBatchAction("batch_scene_frame");

    const targets = project.shots.filter((s) => overwrite ? true : !getSceneRefFrameUrl(s));
    setBatchProgress({
      total: targets.length,
      completed: 0,
      inProgress: 0,
      failed: [],
      targetShotIds: targets.map((s) => s.id),
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
      const data = await response.json() as { results: Array<{ shotId?: string; status: string }> };
      const failedIds = (data.results || []).filter((r) => r.status === "error").map((r) => r.shotId!).filter(Boolean);
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
      console.error("Batch scene frame error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setSceneFramesOverwrite(false);
    setGeneratingSceneFrames(false);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
    setBatchProgress(null);
  }

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
      await fetchProject(project.id, currentEpisodeId || undefined);
    } catch (err) {
      toast.error("Failed to generate ref prompts");
      console.error(err);
    } finally {
      setGeneratingRefPrompts(false);
    }
  }

  // Synchronous batch generator for keyframe (first/last frame) image prompts.
  // Mirrors handleGenerateRefPrompts — single LLM call, returns immediately.

  async function handleGenerateKeyframeAssets() {
    if (!project) return;
    if (!textGuard()) return;
    setGeneratingKeyframeAssets(true);
    try {
      const resp = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_keyframe_prompts",
          payload: { versionId: selectedVersionId },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      if (!resp.ok) throw new Error("Failed");
      const data = await resp.json();
      toast.success(`已生成 ${data.updatedCount}/${data.totalShots} 个镜头的首尾帧提示词`);
      await fetchProject(project.id, currentEpisodeId || undefined);
    } catch (err) {
      toast.error("生成首尾帧提示词失败");
      console.error(err);
    } finally {
      setGeneratingKeyframeAssets(false);
    }
  }

  async function handleBatchGenerateRefImages() {
    if (!project) return;
    if (!imageGuard()) return;
    setGeneratingRefImages(true);

    try {
      const modelConfig = getModelConfig();
      const resp = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_ref_image_generate",
          modelConfig,
          episodeId: currentEpisodeId,
          payload: { versionId: selectedVersionId },
        }),
      });

      if (!resp.ok) throw new Error("Failed");
      const data = await resp.json() as {
        results?: Array<{ generated?: number; failed?: number }>;
      };

      const totalGenerated = data.results?.reduce((sum, r) => sum + (r.generated || 0), 0) || 0;
      const totalFailed = data.results?.reduce((sum, r) => sum + (r.failed || 0), 0) || 0;

      if (totalFailed > 0) {
        toast.error(`${totalFailed} reference images failed`);
      } else if (totalGenerated > 0) {
        toast.success(`${totalGenerated} reference images generated`);
      } else {
        toast.info("No pending reference images to generate");
      }

      await fetchProject(project.id, currentEpisodeId || undefined);
    } catch (err) {
      toast.error("Batch reference image generation failed");
    } finally {
      setGeneratingRefImages(false);
    }
  }

  async function handleBatchGenerateVideoPrompts() {
    if (!project) return;
    setGeneratingVideoPrompts(true);
    setLastBatchAction("batch_video_prompt");

    const targets = project.shots.filter((s) => !s.videoPrompt);
    setBatchProgress({
      total: targets.length,
      completed: 0,
      inProgress: 0,
      failed: [],
      targetShotIds: targets.map((s) => s.id),
      action: "batch_video_prompt",
    });

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_video_prompt",
          payload: { versionId: selectedVersionId },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      const data = await response.json() as { results: Array<{ shotId?: string; status: string }> };
      const failedIds = (data.results || []).filter((r) => r.status === "error").map((r) => r.shotId!).filter(Boolean);
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
      console.error("Batch video prompt error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGeneratingVideoPrompts(false);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
    setBatchProgress(null);
  }

  async function handleBatchGenerateReferenceVideos(overwrite = false) {
    if (!project) return;
    if (!videoGuard()) return;
    setGeneratingVideosOverwrite(overwrite);
    setGeneratingVideos(true);
    setLastBatchAction("batch_reference_video");

    const targets = project.shots.filter((s) => overwrite ? true : !getReferenceVideoUrl(s));
    setBatchProgress({
      total: targets.length,
      completed: 0,
      inProgress: 0,
      failed: [],
      targetShotIds: targets.map((s) => s.id),
      action: "batch_reference_video",
    });

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_reference_video",
          payload: { ratio: videoRatio, overwrite, versionId: selectedVersionId },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      const data = await response.json() as { results: Array<{ shotId?: string; status: string }> };
      const failedIds = (data.results || []).filter((r) => r.status === "error").map((r) => r.shotId!).filter(Boolean);
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
      console.error("Batch reference video error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGeneratingVideosOverwrite(false);
    setGeneratingVideos(false);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
    setBatchProgress(null);
  }

  async function handleRetryFailed() {
    if (!project) return;
    const failedShots = project.shots.filter((s) => lastFailedShots.includes(s.id));
    if (failedShots.length === 0) return;

    // Map batch action to single-shot action
    const actionMap: Record<string, string> = {
      batch_frame_generate: "single_frame_generate",
      batch_video_generate: "single_video_generate",
      batch_scene_frame: "single_scene_frame",
      batch_reference_video: "single_reference_video",
      batch_video_prompt: "single_video_prompt",
    };
    const singleAction = lastBatchAction ? actionMap[lastBatchAction] : null;
    if (!singleAction) return;

    // Set appropriate generating state
    if (lastBatchAction === "batch_frame_generate") setGeneratingFrames(true);
    else if (lastBatchAction === "batch_video_generate" || lastBatchAction === "batch_reference_video") setGeneratingVideos(true);
    else if (lastBatchAction === "batch_scene_frame") setGeneratingSceneFrames(true);
    else if (lastBatchAction === "batch_video_prompt") setGeneratingVideoPrompts(true);

    setBatchProgress({ total: failedShots.length, completed: 0, failed: [] });
    const newFailedIds: string[] = [];

    for (const shot of failedShots) {
      try {
        const resp = await apiFetch(`/api/projects/${project.id}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: singleAction,
            payload: { shotId: shot.id, ratio: videoRatio, versionId: selectedVersionId },
            modelConfig: getModelConfig(),
            episodeId: useProjectStore.getState().currentEpisodeId,
          }),
        });
        if (!resp.ok) throw new Error(`Shot ${shot.sequence} failed`);
      } catch (err) {
        console.error(`Retry failed for shot ${shot.id}:`, err);
        newFailedIds.push(shot.id);
      }
      setBatchProgress((prev) =>
        prev ? { ...prev, completed: prev.completed + 1, failed: newFailedIds.slice() } : null
      );
    }

    // Reset generating states
    setGeneratingFrames(false);
    setGeneratingVideos(false);
    setGeneratingSceneFrames(false);
    setGeneratingVideoPrompts(false);

    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
    setLastFailedShots(newFailedIds);
    setBatchProgress(null);

    if (newFailedIds.length === 0) {
      toast.success("All retries succeeded");
    } else {
      toast.error(`${newFailedIds.length} shots still failing`);
    }
  }

  async function handleAutoRun() {
    if (!project) return;
    if (!confirm(t("project.autoRunConfirm"))) return;

    const shots = project.shots;
    const needsText = shots.some((s) => !s.prompt && !s.motionScript);
    const needsFrame = shots.some((s) =>
      generationMode === "reference" ? !getSceneRefFrameUrl(s) : !getFirstFrameUrl(s) || !getLastFrameUrl(s)
    );
    const needsPrompt = shots.some((s) => !s.videoPrompt);
    const needsVideo = shots.some((s) =>
      generationMode === "reference" ? !getReferenceVideoUrl(s) : !getKeyframeVideoUrl(s)
    );

    if (needsText) await handleGenerateShots();
    if (generationMode === "reference") {
      // Step 2a: Generate ref image prompts if needed
      const needsRefPrompts = shots.some((s) => getReferenceAssets(s).length === 0);
      if (needsRefPrompts) await handleGenerateRefPrompts();

      // Step 2b: Generate ref images
      if (needsFrame) await handleBatchGenerateSceneFrames(false);
    } else {
      if (needsFrame) await handleBatchGenerateFrames(false);
    }
    if (needsPrompt) await handleBatchGenerateVideoPrompts();
    if (needsVideo) {
      if (generationMode === "reference") await handleBatchGenerateReferenceVideos(false);
      else await handleBatchGenerateVideos(false);
    }
  }

  useEffect(() => {
    if (!project || !batchProgress?.targetShotIds || !batchProgress.action) return;

    const isActionRunning =
      (batchProgress.action === "batch_frame_generate" && generatingFrames) ||
      (batchProgress.action === "batch_scene_frame" && generatingSceneFrames) ||
      (batchProgress.action === "batch_video_prompt" && generatingVideoPrompts) ||
      (batchProgress.action === "batch_video_generate" && generatingVideos) ||
      (batchProgress.action === "batch_reference_video" && generatingVideos);
    if (!isActionRunning) return;

    let cancelled = false;
    let inflight = false;

    const computeCompleted = (shot: typeof shots[number], action: string): boolean => {
      if (shot.status === "completed") return true;
      if (action === "batch_frame_generate") return hasKeyframePair(shot);
      if (action === "batch_scene_frame") return !!getSceneRefFrameUrl(shot);
      if (action === "batch_video_prompt") return !!shot.videoPrompt;
      if (action === "batch_video_generate") return !!getKeyframeVideoUrl(shot);
      if (action === "batch_reference_video") return !!getReferenceVideoUrl(shot);
      return false;
    };

    const tick = async () => {
      if (cancelled || inflight) return;
      inflight = true;
      try {
        await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
        if (cancelled) return;
        const latestShots = useProjectStore.getState().project?.shots ?? [];
        const idSet = new Set(batchProgress.targetShotIds);
        const targetShots = latestShots.filter((s) => idSet.has(s.id));
        const completed = targetShots.filter((s) =>
          computeCompleted(s, batchProgress.action!)
        ).length;
        const inProgress = targetShots.filter((s) => s.status === "generating").length;
        const failed = targetShots
          .filter((s) => s.status === "failed")
          .map((s) => s.id);
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
      } catch (err) {
        console.warn("[BatchProgress] polling failed:", err);
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
    project?.id,
    batchProgress?.action,
    batchProgress?.targetShotIds,
    generatingFrames,
    generatingSceneFrames,
    generatingVideoPrompts,
    generatingVideos,
    fetchProject,
    shots,
  ]);

  return (
    <div className="animate-page-in space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Film className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
              {t("project.storyboard")}
            </h2>
            <p className="text-xs text-[--text-muted]">
              {totalShots} shots
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PromptEditButton
            // Full set of storyboard-related prompts — matches the
            // settings/prompts page "分镜" tab exactly (9 prompts across
            // shot / frame / video categories). Both keyframe and
            // reference modes share the same list so the quick-access
            // drawer and the backend menu are 1:1 consistent.
            promptKeys={[
              // shot
              "shot_split",
              "shot_split_keyframe_assets",
              // frame
              "frame_generate_first",
              "frame_generate_last",
              "scene_frame_generate",
              "ref_image_prompts",
              // video
              "video_generate",
              "ref_video_generate",
              "ref_video_prompt",
            ]}
            projectId={project.id}
          />
          {totalShots > 0 && (
            <div className="inline-flex gap-1 rounded-xl border border-[--border-subtle] bg-[--surface] p-1">
              <button
                onClick={() => switchView("list")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all duration-150 ${
                  viewMode === "list"
                    ? "bg-white text-primary shadow ring-1 ring-primary/20"
                    : "text-[--text-muted] hover:bg-white/60 hover:text-[--text-secondary]"
                }`}
              >
                <List className={`h-3.5 w-3.5 ${viewMode === "list" ? "text-primary" : ""}`} />
                {t("project.viewList")}
              </button>
              <button
                onClick={() => switchView("kanban")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all duration-150 ${
                  viewMode === "kanban"
                    ? "bg-white text-primary shadow ring-1 ring-primary/20"
                    : "text-[--text-muted] hover:bg-white/60 hover:text-[--text-secondary]"
                }`}
              >
                <LayoutGrid className={`h-3.5 w-3.5 ${viewMode === "kanban" ? "text-primary" : ""}`} />
                {t("project.viewKanban")}
              </button>
            </div>
          )}
          {totalShots > 0 && versions.length >= 2 && (
            <Button
              variant={compareMode ? "default" : "outline"}
              size="sm"
              onClick={() => setCompareMode(!compareMode)}
            >
              <GitCompare className="h-3.5 w-3.5" />
              {compareMode ? t("project.exitCompare") || "Exit Compare" : t("project.compareVersions") || "Compare Versions"}
            </Button>
          )}
          {totalShots > 0 && (
            <Link
              href={`/${locale}/project/${project!.id}/episodes/${useProjectStore.getState().currentEpisodeId}/preview${selectedVersionId ? `?versionId=${selectedVersionId}` : ""}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
            >
              <Film className="h-3.5 w-3.5" />
              {t("project.preview")}
            </Link>
          )}
          {totalShots > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const a = document.createElement("a");
                a.href = `/api/projects/${project!.id}/download?episodeId=${useProjectStore.getState().currentEpisodeId}`;
                a.download = "";
                a.click();
              }}
            >
              <Download className="h-3.5 w-3.5" />
              {t("project.downloadAll")}
            </Button>
          )}
        </div>
      </div>

      {/* ── Control Panel ── */}
      <div className="rounded-2xl border border-[--border-subtle] bg-white p-4 space-y-3">
        {/* Generation mode + version tabs row */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <GenerationModeTab />

          {/* Version tabs */}
          {versions.length > 0 && (
            <div className="flex items-center gap-1">
              {/* Show 2 newest versions */}
              {versions.slice(0, 2).map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    setSelectedVersionId(v.id);
                    fetchProject(project!.id, undefined, v.id);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    selectedVersionId === v.id
                      ? "bg-primary/10 text-primary"
                      : "text-[--text-muted] hover:bg-[--surface] hover:text-[--text-secondary]"
                  }`}
                >
                  {v.label}
                </button>
              ))}
              {/* Older versions dropdown */}
              {versions.length > 2 && (
                <div className="relative" ref={versionDropdownRef}>
                  <button
                    onClick={() => setVersionDropdownOpen((o) => !o)}
                    className={`flex items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                      versions.slice(2).some((v) => v.id === selectedVersionId)
                        ? "bg-primary/10 text-primary"
                        : "text-[--text-muted] hover:bg-[--surface] hover:text-[--text-secondary]"
                    }`}
                  >
                    {versions.slice(2).some((v) => v.id === selectedVersionId)
                      ? versions.find((v) => v.id === selectedVersionId)?.label
                      : `+${versions.length - 2}`}
                    <ChevronDown className={`h-3 w-3 transition-transform ${versionDropdownOpen ? "rotate-180" : ""}`} />
                  </button>
                  {versionDropdownOpen && (
                    <div
                      className="absolute right-0 top-full z-20 mt-1 min-w-[140px] overflow-hidden rounded-xl border border-[--border-subtle] bg-white shadow-lg"
                      onMouseLeave={() => setVersionDropdownOpen(false)}
                    >
                      {versions.slice(2).map((v) => (
                        <button
                          key={v.id}
                          onClick={() => {
                            setSelectedVersionId(v.id);
                            fetchProject(project!.id, undefined, v.id);
                            setVersionDropdownOpen(false);
                          }}
                          className={`w-full px-3 py-2 text-left text-[13px] font-medium transition-colors hover:bg-[--surface] ${
                            selectedVersionId === v.id ? "text-primary" : "text-[--text-secondary]"
                          }`}
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={handleGenerateShots}
                disabled={anyGenerating}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-secondary] disabled:opacity-40"
                title={t("project.generateShots")}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Characters inline panel (Feature B) */}
        <CharactersInlinePanel
          characters={project.characters}
          projectId={project.id}
          generationMode={generationMode}
          onUpdate={() => fetchProject(project.id, useProjectStore.getState().currentEpisodeId!)}
        />

        {/* Batch operations */}
        {viewMode === "list" && (
        <div className="space-y-2">
          {/* Row 1: Generate text / shots */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-[--surface] text-[10px] font-bold text-[--text-muted]">1</span>
            <InlineModelPicker capability="text" />
            <Button
              onClick={handleGenerateShots}
              disabled={anyGenerating}
              variant="default"
              size="sm"
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {generating ? t("common.generating") : t("project.generateShots")}
            </Button>
            <Button
              onClick={handlePreviewReplanLongShots}
              disabled={anyGenerating || previewingReplanLongShots || totalShots === 0}
              variant="ghost"
              size="sm"
              title={t("storyboard.replanLongShotsPreviewHelp")}
            >
              {previewingReplanLongShots ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {previewingReplanLongShots
                ? t("storyboard.replanLongShotsPreviewRunning")
                : t("storyboard.replanLongShotsPreview")}
            </Button>
            <Button
              onClick={handleReplanLongShots}
              disabled={anyGenerating || replanningLongShots || totalShots === 0}
              variant="outline"
              size="sm"
              title={t("storyboard.replanLongShotsHelp")}
            >
              {replanningLongShots ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {replanningLongShots
                ? t("storyboard.replanLongShotsRunning")
                : t("storyboard.replanLongShots")}
            </Button>
          </div>

          {/* Row 2: Frames */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-[--surface] text-[10px] font-bold text-[--text-muted]">2</span>
            <InlineModelPicker capability="image" />
            {generationMode === "reference" ? (
              <>
                <Button
                  size="sm"
                  onClick={handleGenerateRefPrompts}
                  disabled={generatingRefPrompts || anyGenerating || totalShots === 0}
                >
                  {generatingRefPrompts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {generatingRefPrompts ? t("common.generating") : (t("storyboard.generateRefPrompts") || "Generate Ref Prompts")}
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => handleBatchGenerateSceneFrames(false)}
                  disabled={anyGenerating || totalShots === 0 || !hasReferenceImages || shotsWithRefPrompts === 0}
                >
                  {generatingSceneFrames && !sceneFramesOverwrite ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  {generatingSceneFrames && !sceneFramesOverwrite ? t("common.generating") : (t("storyboard.batchGenerateRefImages") || "Batch Generate Ref Images")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleBatchGenerateSceneFrames(true)}
                  disabled={anyGenerating || totalShots === 0 || !hasReferenceImages}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  onClick={handleGenerateKeyframeAssets}
                  disabled={generatingKeyframeAssets || anyGenerating || totalShots === 0}
                  title="基于已有的镜头元数据生成首尾帧的图像提示词"
                >
                  {generatingKeyframeAssets ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {generatingKeyframeAssets ? "生成中…" : "生成首尾帧提示词"}
                </Button>
                <Button
                  onClick={() => handleBatchGenerateFrames(false)}
                  disabled={anyGenerating || totalShots === 0 || shotsWithKeyframePrompts === 0}
                  variant="default"
                  size="sm"
                >
                  {generatingFrames && !generatingFramesOverwrite ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5" />
                  )}
                  {generatingFrames && !generatingFramesOverwrite
                    ? t("common.generating")
                    : t("project.batchGenerateFrames")}
                </Button>
                <Button
                  onClick={() => handleBatchGenerateFrames(true)}
                  disabled={anyGenerating || totalShots === 0 || shotsWithKeyframePrompts === 0}
                  variant="ghost"
                  size="icon"
                  title={t("project.batchGenerateFramesOverwrite")}
                >
                  {generatingFrames && generatingFramesOverwrite ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </Button>
              </>
            )}
          </div>

          {/* Row 3: Video prompts */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-[--surface] text-[10px] font-bold text-[--text-muted]">3</span>
            <InlineModelPicker capability="text" />
            <Button
              onClick={handleBatchGenerateVideoPrompts}
              disabled={anyGenerating || shotsWithFrameAny === 0}
              variant="default"
              size="sm"
            >
              {generatingVideoPrompts ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {generatingVideoPrompts ? t("common.generating") : t("project.batchGenerateVideoPrompts")}
            </Button>
          </div>

          {/* Row 4: Videos */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-[--surface] text-[10px] font-bold text-[--text-muted]">4</span>
            <InlineModelPicker capability="video" />
            <VideoRatioPicker value={videoRatio} onChange={setVideoRatio} />
            <Button
              onClick={() =>
                generationMode === "reference"
                  ? handleBatchGenerateReferenceVideos(false)
                  : handleBatchGenerateVideos(false)
              }
              disabled={
  anyGenerating ||
  totalShots === 0 ||
  shotsWithVideoPrompts !== totalShots ||
  (generationMode === "reference"
    ? !hasReferenceImages || !allRefImagesGenerated || shotsWithRefPrompts !== totalShots
    : shotsWithFrames !== totalShots)
}
              variant="default"
              size="sm"
            >
              {generatingVideos && !generatingVideosOverwrite ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <VideoIcon className="h-3.5 w-3.5" />
              )}
              {generatingVideos && !generatingVideosOverwrite
                ? t("common.generating")
                : generationMode === "reference"
                  ? t("project.batchGenerateReferenceVideos")
                  : t("project.batchGenerateVideos")}
            </Button>
            <Button
              onClick={() =>
                generationMode === "reference"
                  ? handleBatchGenerateReferenceVideos(true)
                  : handleBatchGenerateVideos(true)
              }
              disabled={
  anyGenerating ||
  totalShots === 0 ||
  shotsWithVideoPrompts !== totalShots ||
  (generationMode === "reference"
    ? !hasReferenceImages || !allRefImagesGenerated || shotsWithRefPrompts !== totalShots
    : shotsWithFrames !== totalShots)
}
              variant="ghost"
              size="icon"
              title={t("project.batchGenerateVideosOverwrite")}
            >
              {generatingVideos && generatingVideosOverwrite ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>

          {/* Divider + Auto-run */}
          {totalShots > 0 && (
            <>
              <div className="h-px bg-[--border-subtle]" />
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleAutoRun}
                  disabled={anyGenerating}
                  variant="default"
                  size="sm"
                  className="gap-1.5"
                >
                  {anyGenerating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  {t("project.autoRun")}
                </Button>
                {lastFailedShots.length > 0 && !batchProgress && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRetryFailed}
                    disabled={anyGenerating}
                    className="border-destructive/50 text-destructive hover:bg-destructive/10"
                  >
                    <RefreshCw className="mr-1 h-4 w-4" />
                    Retry {lastFailedShots.length} failed
                  </Button>
                )}
              </div>
            </>
          )}

          {/* Batch progress bar */}
          {batchProgress && (
            <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              <div className="flex-1">
                {(() => {
                  const progressNow = Math.min(
                    batchProgress.total,
                    batchProgress.completed +
                      (batchProgress.inProgress || 0) +
                      batchProgress.failed.length
                  );
                  return (
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{
                      width: `${batchProgress.total > 0 ? (progressNow / batchProgress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
                  );
                })()}
              </div>
              <span className="text-sm text-muted-foreground tabular-nums">
                {Math.min(
                  batchProgress.total,
                  batchProgress.completed +
                    (batchProgress.inProgress || 0) +
                    batchProgress.failed.length
                )}
                /{batchProgress.total}
                {(batchProgress.inProgress || 0) > 0 && (
                  <span className="ml-1">({batchProgress.inProgress} running)</span>
                )}
                {batchProgress.failed.length > 0 && (
                  <span className="text-destructive ml-1">
                    ({batchProgress.failed.length} failed)
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Shot cards */}
      {compareMode ? (
        <VersionCompare
          versions={versions}
          currentVersionId={selectedVersionId}
          onVersionChange={setSelectedVersionId}
          getShotsForVersion={() => {
            // UI shell: returns current shots as placeholder for both versions
            // Full per-version fetching would require additional API calls
            return project.shots.map((s) => ({
              id: s.id,
              sequence: s.sequence,
              firstFrame: getFirstFrameUrl(s),
              lastFrame: getLastFrameUrl(s),
              prompt: s.prompt,
              duration: s.duration,
            }));
          }}
        />
      ) : totalShots === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[--border-subtle] bg-[--surface]/50 py-24">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10">
            <Film className="h-7 w-7 text-primary" />
          </div>
          <h3 className="font-display text-lg font-semibold text-[--text-primary]">
            {t("project.storyboard")}
          </h3>
          <p className="mt-2 max-w-sm text-center text-sm text-[--text-secondary]">
            {t("shot.noShots")}
          </p>
        </div>
      ) : viewMode === "kanban" ? (
        <ShotKanban
          shots={project.shots}
          generationMode={generationMode}
          anyGenerating={anyGenerating}
          onOpenDrawer={(id) => setOpenDrawerShotId(id)}
          onBatchFrames={() => handleBatchGenerateFrames(false)}
          onBatchSceneFrames={() => handleBatchGenerateSceneFrames(false)}
          onBatchVideoPrompts={handleBatchGenerateVideoPrompts}
          onBatchVideos={() => handleBatchGenerateVideos(false)}
          onBatchReferenceVideos={() => handleBatchGenerateReferenceVideos(false)}
          generatingFrames={generatingFrames}
          generatingSceneFrames={generatingSceneFrames}
          generatingVideoPrompts={generatingVideoPrompts}
          generatingVideos={generatingVideos}
        />
      ) : (
        (() => {
          const renderShotCard = (shot: typeof project.shots[number]) => (
            <ShotCard
              key={shot.id}
              shot={shot}
              projectId={project.id}
              onUpdate={() => fetchProject(project.id, useProjectStore.getState().currentEpisodeId!)}
              generationMode={generationMode}
              videoRatio={videoRatio}
              isCompact={openDrawerShotId !== null}
              onOpenDrawer={(id) => setOpenDrawerShotId(id)}
              batchGeneratingFrames={generationMode === "reference" ? generatingSceneFrames : generatingFrames}
              batchGeneratingVideoPrompts={generatingVideoPrompts}
              batchGeneratingVideos={generatingVideos}
            />
          );

          return sceneGroups.groups.length > 0 ? (
            <div className="space-y-6">
              {sceneGroups.groups.map((group, groupIndex) => (
                <div key={group.sceneId} className="space-y-3">
                  {/* Scene header */}
                  <div className="flex items-center gap-2 border-b pb-2 pt-4">
                    <Film className="h-4 w-4 text-[--text-muted]" />
                    <h3 className="text-sm font-medium">
                      Scene {groupIndex + 1}
                    </h3>
                    <span className="text-xs text-[--text-muted]">
                      {group.shots.length} {group.shots.length === 1 ? "shot" : "shots"}
                    </span>
                  </div>
                  {/* Shots in this scene */}
                  {group.shots.map((shot) => renderShotCard(shot))}
                </div>
              ))}

              {/* Ungrouped shots */}
              {sceneGroups.ungrouped.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 border-b pb-2 pt-4">
                    <h3 className="text-sm font-medium text-[--text-muted]">Other Shots</h3>
                  </div>
                  {sceneGroups.ungrouped.map((shot) => renderShotCard(shot))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {project.shots.map((shot) => renderShotCard(shot))}
            </div>
          );
        })()
      )}

      {openDrawerShotId && (
        <ShotDrawer
          shots={drawerShots}
          openShotId={openDrawerShotId}
          onClose={() => setOpenDrawerShotId(null)}
          onShotChange={(id) => setOpenDrawerShotId(id)}
          onUpdate={() => fetchProject(project.id, useProjectStore.getState().currentEpisodeId!)}
          projectId={project.id}
          generationMode={generationMode}
          videoRatio={videoRatio}
          selectedVersionId={selectedVersionId}
          anyGenerating={anyGenerating}
        />
      )}
    </div>
  );
}
