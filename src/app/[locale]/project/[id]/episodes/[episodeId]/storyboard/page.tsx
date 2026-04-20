"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Film } from "lucide-react";
import { useEpisodeStore } from "@/stores/episode-store";
import { useModelStore } from "@/stores/model-store";
import {
  getReferenceAssets,
  getReferenceVideoUrl,
  getSceneRefFrameUrl,
  getStoryboardGridUrl,
  getStoryboardPanelPrompts,
  getStoryboardVideoUrl,
  useProjectStore,
} from "@/stores/project-store";
import type { Shot, StoryboardVersion } from "@/stores/project-store";
import { ShotCard } from "@/components/editor/shot-card";
import { ShotDrawer } from "@/components/editor/shot-drawer";
import { ShotKanban } from "@/components/editor/shot-kanban";
import { VersionCompare } from "@/components/editor/version-compare";
import { useModelGuard } from "@/hooks/use-model-guard";
import type { DirectorControl } from "./storyboard-preflight-utils";
import {
  DEFAULT_DIRECTOR_CONTROL,
  parseDirectorControl,
} from "./storyboard-preflight-utils";
import { StoryboardControlPanel } from "./storyboard-control-panel";
import { useStoryboardPreflight } from "./use-storyboard-preflight";
import { useStoryboardGeneration } from "./use-storyboard-generation";

export default function EpisodeStoryboardPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { project, fetchProject } = useProjectStore();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const [videoRatio, setVideoRatio] = useState("16:9");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [versions, setVersions] = useState<StoryboardVersion[]>([]);
  const [openDrawerShotId, setOpenDrawerShotId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const [versionDropdownOpen, setVersionDropdownOpen] = useState(false);
  const versionDropdownRef = useRef<HTMLDivElement>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [directorControl, setDirectorControl] = useState<DirectorControl>(
    DEFAULT_DIRECTOR_CONTROL
  );

  const currentEpisodeId = useProjectStore((s) => s.currentEpisodeId);
  const episodeStoreEpisodes = useEpisodeStore((s) => s.episodes);
  const fetchEpisodes = useEpisodeStore((s) => s.fetchEpisodes);
  const textGuard = useModelGuard("text");
  const imageGuard = useModelGuard("image");
  const videoGuard = useModelGuard("video");

  useEffect(() => {
    if (project?.id && episodeStoreEpisodes.length === 0) {
      fetchEpisodes(project.id);
    }
  }, [episodeStoreEpisodes.length, fetchEpisodes, project?.id]);

  function switchView(mode: "list" | "kanban") {
    setViewMode(mode);
    if (project) localStorage.setItem(`storyboardView:${project.id}`, mode);
  }

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

  useEffect(() => {
    if (!project?.id) return;
    const saved = localStorage.getItem(`storyboardDirectorControl:${project.id}`);
    setDirectorControl(parseDirectorControl(saved));
  }, [project?.id]);

  useEffect(() => {
    if (!project?.id) return;
    localStorage.setItem(
      `storyboardDirectorControl:${project.id}`,
      JSON.stringify(directorControl)
    );
  }, [directorControl, project?.id]);

  const shots = useMemo(() => project?.shots ?? [], [project?.shots]);
  const projectCharacters = useMemo(() => project?.characters ?? [], [project?.characters]);

  const sceneGroups = useMemo(() => {
    const groupMap = new Map<string, { sceneId: string; shots: typeof shots }>();
    const ungrouped: typeof shots = [];

    for (const shot of shots) {
      if (shot.sceneId) {
        const existing = groupMap.get(shot.sceneId);
        if (existing) existing.shots.push(shot);
        else groupMap.set(shot.sceneId, { sceneId: shot.sceneId, shots: [shot] });
      } else {
        ungrouped.push(shot);
      }
    }

    return { groups: Array.from(groupMap.values()), ungrouped };
  }, [shots]);

  const generationMode = (project?.generationMode || "storyboard_grid") as
    | "storyboard_grid"
    | "reference";
  const getShotWorkflow = (shot: Shot) =>
    shot.workflowState?.mode === generationMode ? shot.workflowState : null;
  const hasReferenceFrameForShot = (shot: Shot) =>
    getShotWorkflow(shot)?.frameReady ?? !!getSceneRefFrameUrl(shot);
  const hasStoryboardFrameForShot = (shot: Shot) =>
    getShotWorkflow(shot)?.frameReady ?? !!getStoryboardGridUrl(shot);
  const hasVideoPromptForShot = (shot: Shot) =>
    getShotWorkflow(shot)?.videoPromptReady ?? !!shot.videoPrompt?.trim();
  const hasStoryboardVideoForShot = (shot: Shot) =>
    getShotWorkflow(shot)?.videoReady ?? !!getStoryboardVideoUrl(shot);
  const hasReferenceVideoForShot = (shot: Shot) =>
    getShotWorkflow(shot)?.videoReady ?? !!getReferenceVideoUrl(shot);
  const isShotWorkflowStale = (shot: Shot) =>
    getShotWorkflow(shot)?.stale ?? !!shot.isStale;

  const totalShots = shots.length;
  const charactersWithRefs = projectCharacters.filter((c: any) => c.referenceImage);
  const hasReferenceImages = charactersWithRefs.length > 0;

  const shotsWithRefPrompts = useMemo(() => {
    return shots.filter((shot) => {
      const refOnly = getReferenceAssets(shot);
      return refOnly.length > 0 && refOnly.some((ref) => ref.prompt);
    }).length;
  }, [shots]);

  const shotsWithStoryboardPrompts = useMemo(() => {
    return shots.filter((shot) => getStoryboardPanelPrompts(shot).filter(Boolean).length >= 4)
      .length;
  }, [shots]);

  const workflowSummary = useMemo(() => {
    let framesReady = 0;
    let videoPromptsReady = 0;
    let videosReady = 0;
    let stale = 0;
    let preflightPassed = 0;
    let preflightFailed = 0;

    for (const shot of shots) {
      const workflow = getShotWorkflow(shot);
      if (generationMode === "reference" ? hasReferenceFrameForShot(shot) : hasStoryboardFrameForShot(shot)) {
        framesReady += 1;
      }
      if (hasVideoPromptForShot(shot)) videoPromptsReady += 1;
      if (generationMode === "reference" ? hasReferenceVideoForShot(shot) : hasStoryboardVideoForShot(shot)) {
        videosReady += 1;
      }
      if (isShotWorkflowStale(shot)) stale += 1;
      if (workflow?.preflightStatus === "pass") preflightPassed += 1;
      if (workflow?.preflightStatus === "fail") preflightFailed += 1;
    }

    return {
      framesReady,
      videoPromptsReady,
      videosReady,
      stale,
      preflightPassed,
      preflightFailed,
      needsFrames: Math.max(0, shots.length - framesReady),
      needsVideoPrompts: Math.max(0, shots.length - videoPromptsReady),
      needsVideos: Math.max(0, shots.length - videosReady),
    };
  }, [generationMode, shots]);

  const getBatchFailureDetail = (
    results: Array<{ status: string; error?: string }>
  ): string | null => {
    const uniqueErrors = Array.from(
      new Set(
        results
          .filter((item) => item.status === "error")
          .map((item) => (item.error || "").trim())
          .filter(Boolean)
      )
    );
    if (uniqueErrors.length === 0) return null;
    const first = uniqueErrors[0];
    return first.length > 120 ? `${first.slice(0, 120)}...` : first;
  };

  const tr = (
    key: string,
    fallback: string,
    values?: Record<string, string | number>
  ): string => {
    if (t.has(key)) return t(key, values);
    if (!values) return fallback;
    return fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
  };

  async function refreshCurrentStoryboardView() {
    if (!project) return;
    await fetchProject(project.id, currentEpisodeId || undefined, selectedVersionId || undefined);
  }

  function updateDirectorControl(key: keyof DirectorControl, value: number) {
    setDirectorControl((prev) => ({
      ...prev,
      [key]: Math.max(0, Math.min(100, Math.round(value))),
    }));
  }

  function scrollToPreflightShot(shotId: string) {
    const element =
      typeof document !== "undefined"
        ? document.getElementById(`preflight-shot-${shotId}`)
        : null;
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const {
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
  } = useStoryboardPreflight({
    directorControl,
    fetchProject,
    generationMode,
    getModelConfig,
    project,
    selectedVersionId,
    shots,
    tr,
  });

  const {
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
  } = useStoryboardGeneration({
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
  });

  const previewHref = `/${locale}/project/${project?.id}/episodes/${currentEpisodeId}/preview${
    selectedVersionId ? `?versionId=${selectedVersionId}` : ""
  }`;

  function handleDownloadAll() {
    if (!project) return;
    const a = document.createElement("a");
    a.href = `/api/projects/${project.id}/download?episodeId=${currentEpisodeId}`;
    a.download = "";
    a.click();
  }

  function handleSelectVersion(versionId: string) {
    if (!project) return;
    setSelectedVersionId(versionId);
    void fetchProject(project.id, undefined, versionId);
  }

  const drawerShots = shots;

  if (!project) return null;

  return (
    <div className="animate-page-in space-y-4">
      <StoryboardControlPanel
        anyGenerating={anyGenerating}
        batchProgress={batchProgress}
        compareMode={compareMode}
        directorControl={directorControl}
        fixingAllPreflight={fixingAllPreflight}
        fixingPreflightShotId={fixingPreflightShotId}
        generationMode={generationMode}
        generating={generating}
        generatingFrames={generatingFrames}
        generatingFramesOverwrite={generatingFramesOverwrite}
        generatingRefPrompts={generatingRefPrompts}
        generatingSceneFrames={generatingSceneFrames}
        generatingStoryboardPrompts={generatingStoryboardPrompts}
        generatingVideoPrompts={generatingVideoPrompts}
        generatingVideos={generatingVideos}
        generatingVideosOverwrite={generatingVideosOverwrite}
        handleApplyAllPreflightFixes={handleApplyAllPreflightFixes}
        handleApplyPreflightFix={handleApplyPreflightFix}
        handleAutoRun={handleAutoRun}
        handleBatchGenerateFrames={handleBatchGenerateFrames}
        handleBatchGenerateReferenceVideos={handleBatchGenerateReferenceVideos}
        handleBatchGenerateSceneFrames={handleBatchGenerateSceneFrames}
        handleBatchGenerateVideoPrompts={handleBatchGenerateVideoPrompts}
        handleBatchGenerateVideos={handleBatchGenerateVideos}
        handleGenerateRefPrompts={handleGenerateRefPrompts}
        handleGenerateShots={handleGenerateShots}
        handleGenerateStoryboardPrompts={handleGenerateStoryboardPrompts}
        handlePreviewReplanLongShots={handlePreviewReplanLongShots}
        handleReplanLongShots={handleReplanLongShots}
        handleRetryFailed={handleRetryFailed}
        handleRunVideoPreflight={handleRunVideoPreflight}
        hasReferenceImages={hasReferenceImages}
        lastFailedShots={lastFailedShots}
        locale={locale}
        onDownloadAll={handleDownloadAll}
        onRefreshStoryboardView={refreshCurrentStoryboardView}
        onSelectVersion={handleSelectVersion}
        onSetCompareMode={setCompareMode}
        onToggleVersionDropdown={setVersionDropdownOpen}
        onUpdateDirectorControl={updateDirectorControl}
        preflightDisplayItems={preflightDisplayItems}
        preflightDisplayMap={preflightDisplayMap}
        preflightFixDiffs={preflightFixDiffs}
        preflightFixProgress={preflightFixProgress}
        preflightProgress={preflightProgress}
        preflightResult={preflightResult}
        previewHref={previewHref}
        previewingReplanLongShots={previewingReplanLongShots}
        project={project}
        replanningLongShots={replanningLongShots}
        runningVideoPreflight={runningVideoPreflight}
        sceneFramesOverwrite={sceneFramesOverwrite}
        selectedVersionId={selectedVersionId}
        shotsWithRefPrompts={shotsWithRefPrompts}
        shotsWithStoryboardPrompts={shotsWithStoryboardPrompts}
        switchView={switchView}
        t={t}
        totalShots={totalShots}
        tr={tr}
        versionDropdownOpen={versionDropdownOpen}
        versionDropdownRef={versionDropdownRef}
        versions={versions}
        viewMode={viewMode}
        videoRatio={videoRatio}
        setVideoRatio={setVideoRatio}
        workflowSummary={workflowSummary}
      />

      {compareMode ? (
        <VersionCompare
          versions={versions}
          currentVersionId={selectedVersionId}
          onVersionChange={setSelectedVersionId}
          getShotsForVersion={() =>
            project.shots.map((s) => ({
              id: s.id,
              sequence: s.sequence,
              firstFrame: getStoryboardGridUrl(s),
              lastFrame: null,
              prompt: s.prompt,
              duration: s.duration,
            }))
          }
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
          const renderShotCard = (shot: Shot) => {
            const preflightDisplay = preflightDisplayMap.get(shot.id);
            return (
              <ShotCard
                key={shot.id}
                shot={shot}
                projectId={project.id}
                onUpdate={refreshCurrentStoryboardView}
                onGenerateVideo={handleSingleVideoGenerateWithPreflight}
                generationMode={generationMode}
                videoRatio={videoRatio}
                selectedVersionId={selectedVersionId}
                isCompact={openDrawerShotId !== null}
                onOpenDrawer={(id) => setOpenDrawerShotId(id)}
                batchGeneratingFrames={
                  generationMode === "reference" ? generatingSceneFrames : generatingFrames
                }
                batchGeneratingVideoPrompts={generatingVideoPrompts}
                batchGeneratingVideos={generatingVideos}
                preflightState={preflightDisplay?.runState}
                preflightPassed={preflightDisplay?.result?.pass ?? null}
                preflightScore={preflightDisplay?.result?.score ?? null}
                preflightIssueSummary={preflightDisplay?.result?.issues?.[0] ?? null}
                preflightFixing={fixingPreflightShotId === shot.id}
                onOpenPreflight={scrollToPreflightShot}
                onApplyPreflightFix={(shotId) => {
                  const item = preflightDisplayMap.get(shotId)?.result;
                  if (item) {
                    void handleApplyPreflightFix(item);
                  }
                }}
              />
            );
          };

          if (sceneGroups.groups.length > 0) {
            return (
              <div className="space-y-6">
                {sceneGroups.groups.map((group, groupIndex) => (
                  <div key={group.sceneId} className="space-y-3">
                    <div className="flex items-center gap-2 border-b pb-2 pt-4">
                      <Film className="h-4 w-4 text-[--text-muted]" />
                      <h3 className="text-sm font-medium">Scene {groupIndex + 1}</h3>
                      <span className="text-xs text-[--text-muted]">
                        {group.shots.length} {group.shots.length === 1 ? "shot" : "shots"}
                      </span>
                    </div>
                    {group.shots.map((shot) => renderShotCard(shot))}
                  </div>
                ))}

                {sceneGroups.ungrouped.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 border-b pb-2 pt-4">
                      <h3 className="text-sm font-medium text-[--text-muted]">Other Shots</h3>
                    </div>
                    {sceneGroups.ungrouped.map((shot) => renderShotCard(shot))}
                  </div>
                )}
              </div>
            );
          }

          return <div className="space-y-3">{project.shots.map((shot) => renderShotCard(shot))}</div>;
        })()
      )}

      {openDrawerShotId && (
        <ShotDrawer
          shots={drawerShots}
          openShotId={openDrawerShotId}
          onClose={() => setOpenDrawerShotId(null)}
          onShotChange={(id) => setOpenDrawerShotId(id)}
          onUpdate={refreshCurrentStoryboardView}
          onGenerateVideo={handleSingleVideoGenerateWithPreflight}
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
