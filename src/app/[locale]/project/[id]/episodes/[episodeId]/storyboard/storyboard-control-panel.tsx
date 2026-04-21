"use client";

import Link from "next/link";
import { Loader2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CharactersInlinePanel } from "@/components/editor/characters-inline-panel";
import { GenerationModeTab } from "@/components/editor/generation-mode-tab";
import { StoryboardPreflightPanel } from "./storyboard-preflight-panel";
import type { StoryboardControlPanelProps as Props } from "./storyboard-control-panel-types";
import { StoryboardBatchActions } from "./storyboard-batch-actions";
import { StoryboardPanelHeader } from "./storyboard-panel-header";

export function StoryboardControlPanel({
  anyGenerating,
  batchProgress,
  compareMode,
  directorControl,
  fixingAllPreflight,
  fixingPreflightShotId,
  generationMode,
  generating,
  generatingFrames,
  generatingFramesOverwrite,
  generatingRefPrompts,
  generatingSceneFrames,
  generatingStoryboardPrompts,
  hasContinuityRepairTargets,
  hasImageAuditRepairTargets,
  generatingVideoPrompts,
  generatingVideos,
  generatingVideosOverwrite,
  handleApplyAllPreflightFixes,
  handleApplyPreflightFix,
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
  handleRunVideoPreflight,
  hasReferenceImages,
  lastFailedShots,
  locale,
  onDownloadAll,
  onRefreshStoryboardView,
  onSelectVersion,
  onSetCompareMode,
  onToggleContinuityOnly,
  onToggleVersionDropdown,
  onUpdateDirectorControl,
  preflightDisplayItems,
  preflightDisplayMap,
  preflightFixDiffs,
  preflightFixProgress,
  preflightProgress,
  preflightResult,
  previewHref,
  previewingReplanLongShots,
  project,
  replanningLongShots,
  runningVideoPreflight,
  sceneFramesOverwrite,
  selectedVersionId,
  shotsWithRefPrompts,
  shotsWithStoryboardPrompts,
  switchView,
  t,
  totalShots,
  tr,
  versionDropdownOpen,
  versionDropdownRef,
  versions,
  viewMode,
  workflowSummary,
  showContinuityOnly,
  videoRatio,
  setVideoRatio,
}: Props) {
  return (
    <div className="rounded-2xl border border-[--border-subtle] bg-white p-4 space-y-3">
      <StoryboardPanelHeader
        anyGenerating={anyGenerating}
        compareMode={compareMode}
        handleGenerateShots={handleGenerateShots}
        locale={locale}
        onDownloadAll={onDownloadAll}
        onSelectVersion={onSelectVersion}
        onSetCompareMode={onSetCompareMode}
        onToggleVersionDropdown={onToggleVersionDropdown}
        previewHref={previewHref}
        selectedVersionId={selectedVersionId}
        switchView={switchView}
        t={t}
        totalShots={totalShots}
        versionDropdownOpen={versionDropdownOpen}
        versionDropdownRef={versionDropdownRef}
        versions={versions}
        viewMode={viewMode}
      />

      <GenerationModeTab />

      {totalShots > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-md border border-[--border-subtle] bg-[--surface] px-2 py-1 text-[--text-secondary]">
            画面 {workflowSummary.framesReady}/{totalShots}
          </span>
          <span className="rounded-md border border-[--border-subtle] bg-[--surface] px-2 py-1 text-[--text-secondary]">
            视频词 {workflowSummary.videoPromptsReady}/{totalShots}
          </span>
          <span className="rounded-md border border-[--border-subtle] bg-[--surface] px-2 py-1 text-[--text-secondary]">
            视频 {workflowSummary.videosReady}/{totalShots}
          </span>
          {workflowSummary.preflightPassed > 0 && (
            <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">
              预检通过 {workflowSummary.preflightPassed}
            </span>
          )}
          {workflowSummary.preflightFailed > 0 && (
            <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
              待修复 {workflowSummary.preflightFailed}
            </span>
          )}
          {generationMode === "storyboard_grid" && workflowSummary.continuityFailed > 0 && (
            <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700">
              连续性待修复 {workflowSummary.continuityFailed}
            </span>
          )}
          {generationMode === "storyboard_grid" && workflowSummary.imageAuditPassed > 0 && (
            <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-sky-700">
              成图审计通过 {workflowSummary.imageAuditPassed}
            </span>
          )}
          {workflowSummary.stale > 0 && (
            <span className="rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-orange-700">
              待刷新 {workflowSummary.stale}
            </span>
          )}
        </div>
      )}

      <CharactersInlinePanel
        characters={project.characters}
        projectId={project.id}
        generationMode={generationMode}
        onUpdate={onRefreshStoryboardView}
      />

      <div className="rounded-xl border border-[--border-subtle] bg-[--surface]/35 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
              <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[--text-primary]">
                {tr("storyboard.directorControlTitle", "导演控制")}
              </p>
              <p className="text-xs text-[--text-muted]">
                {tr(
                  "storyboard.directorControlHint",
                  "控制动作密度、运镜强度与情绪表达，再统一生成视频提示词与视频。"
                )}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRunVideoPreflight}
            disabled={anyGenerating || runningVideoPreflight || totalShots === 0}
            className="gap-1.5"
          >
            {runningVideoPreflight ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            {runningVideoPreflight
              ? tr("storyboard.preflightRunning", "预检中...")
              : tr("storyboard.runVideoPreflight", "运行连续性预检")}
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[--text-secondary]">
                {tr("storyboard.directorActionIntensity", "动作强度")}
              </span>
              <span className="font-mono text-[--text-muted]">
                {directorControl.actionIntensity}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={directorControl.actionIntensity}
              onChange={(e) => onUpdateDirectorControl("actionIntensity", Number(e.target.value))}
              className="w-full accent-primary"
            />
          </label>
          <label className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[--text-secondary]">
                {tr("storyboard.directorCameraMotion", "运镜强度")}
              </span>
              <span className="font-mono text-[--text-muted]">{directorControl.cameraMotion}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={directorControl.cameraMotion}
              onChange={(e) => onUpdateDirectorControl("cameraMotion", Number(e.target.value))}
              className="w-full accent-primary"
            />
          </label>
          <label className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[--text-secondary]">
                {tr("storyboard.directorEmotionIntensity", "情绪强度")}
              </span>
              <span className="font-mono text-[--text-muted]">
                {directorControl.emotionIntensity}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={directorControl.emotionIntensity}
              onChange={(e) => onUpdateDirectorControl("emotionIntensity", Number(e.target.value))}
              className="w-full accent-primary"
            />
          </label>
        </div>

        <StoryboardPreflightPanel
          anyGenerating={anyGenerating}
          fixingAllPreflight={fixingAllPreflight}
          fixingPreflightShotId={fixingPreflightShotId}
          handleApplyAllPreflightFixes={handleApplyAllPreflightFixes}
          handleApplyPreflightFix={handleApplyPreflightFix}
          preflightDisplayItems={preflightDisplayItems}
          preflightDisplayMap={preflightDisplayMap}
          preflightFixDiffs={preflightFixDiffs}
          preflightFixProgress={preflightFixProgress}
          preflightProgress={preflightProgress}
          preflightResult={preflightResult}
          runningVideoPreflight={runningVideoPreflight}
          tr={tr}
        />
      </div>

      {viewMode === "list" && (
        <StoryboardBatchActions
          anyGenerating={anyGenerating}
          batchProgress={batchProgress}
          generationMode={generationMode}
          generating={generating}
          generatingFrames={generatingFrames}
          generatingFramesOverwrite={generatingFramesOverwrite}
          generatingRefPrompts={generatingRefPrompts}
          generatingSceneFrames={generatingSceneFrames}
          generatingStoryboardPrompts={generatingStoryboardPrompts}
          hasContinuityRepairTargets={hasContinuityRepairTargets}
          hasImageAuditRepairTargets={hasImageAuditRepairTargets}
          generatingVideoPrompts={generatingVideoPrompts}
          generatingVideos={generatingVideos}
          generatingVideosOverwrite={generatingVideosOverwrite}
          handleAutoRun={handleAutoRun}
          handleBatchGenerateFrames={handleBatchGenerateFrames}
          handleBatchGenerateReferenceVideos={handleBatchGenerateReferenceVideos}
          handleBatchGenerateSceneFrames={handleBatchGenerateSceneFrames}
          handleBatchGenerateVideoPrompts={handleBatchGenerateVideoPrompts}
          handleBatchGenerateVideos={handleBatchGenerateVideos}
          handleGenerateRefPrompts={handleGenerateRefPrompts}
          handleRepairContinuityImages={handleRepairContinuityImages}
          handleRepairContinuityPrompts={handleRepairContinuityPrompts}
          handleGenerateShots={handleGenerateShots}
          handleGenerateStoryboardPrompts={handleGenerateStoryboardPrompts}
          handlePreviewReplanLongShots={handlePreviewReplanLongShots}
          handleReplanLongShots={handleReplanLongShots}
          handleRetryFailed={handleRetryFailed}
          hasReferenceImages={hasReferenceImages}
          lastFailedShots={lastFailedShots}
          onToggleContinuityOnly={onToggleContinuityOnly}
          previewingReplanLongShots={previewingReplanLongShots}
          replanningLongShots={replanningLongShots}
          sceneFramesOverwrite={sceneFramesOverwrite}
          shotsWithRefPrompts={shotsWithRefPrompts}
          shotsWithStoryboardPrompts={shotsWithStoryboardPrompts}
          t={t}
          totalShots={totalShots}
          videoRatio={videoRatio}
          setVideoRatio={setVideoRatio}
          workflowSummary={workflowSummary}
          showContinuityOnly={showContinuityOnly}
        />
      )}
    </div>
  );
}
