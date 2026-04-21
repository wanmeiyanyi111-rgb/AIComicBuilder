"use client";

import { ImageIcon, Loader2, Play, RefreshCw, Sparkles, VideoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { VideoRatioPicker } from "@/components/editor/video-ratio-picker";
import type { StoryboardControlPanelProps } from "./storyboard-control-panel-types";

type Props = Pick<
  StoryboardControlPanelProps,
  | "anyGenerating"
  | "batchProgress"
  | "generationMode"
  | "generating"
  | "generatingFrames"
  | "generatingFramesOverwrite"
  | "generatingRefPrompts"
  | "generatingSceneFrames"
  | "generatingStoryboardPrompts"
  | "hasContinuityRepairTargets"
  | "hasImageAuditRepairTargets"
  | "generatingVideoPrompts"
  | "generatingVideos"
  | "generatingVideosOverwrite"
  | "handleAutoRun"
  | "handleBatchGenerateFrames"
  | "handleBatchGenerateReferenceVideos"
  | "handleBatchGenerateSceneFrames"
  | "handleBatchGenerateVideoPrompts"
  | "handleBatchGenerateVideos"
  | "handleGenerateRefPrompts"
  | "handleRepairContinuityImages"
  | "handleRepairContinuityPrompts"
  | "handleGenerateShots"
  | "handleGenerateStoryboardPrompts"
  | "handlePreviewReplanLongShots"
  | "handleReplanLongShots"
  | "handleRetryFailed"
  | "hasReferenceImages"
  | "lastFailedShots"
  | "onToggleContinuityOnly"
  | "previewingReplanLongShots"
  | "replanningLongShots"
  | "sceneFramesOverwrite"
  | "shotsWithRefPrompts"
  | "shotsWithStoryboardPrompts"
  | "t"
  | "totalShots"
  | "videoRatio"
  | "setVideoRatio"
  | "workflowSummary"
  | "showContinuityOnly"
>;

export function StoryboardBatchActions({
  anyGenerating,
  batchProgress,
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
  hasReferenceImages,
  lastFailedShots,
  onToggleContinuityOnly,
  previewingReplanLongShots,
  replanningLongShots,
  sceneFramesOverwrite,
  shotsWithRefPrompts,
  shotsWithStoryboardPrompts,
  t,
  totalShots,
  videoRatio,
  setVideoRatio,
  workflowSummary,
  showContinuityOnly,
}: Props) {
  if (totalShots === 0) return null;

  const canBatchGenerateVideoPrompts =
    generationMode === "reference"
      ? workflowSummary.framesReady > 0
      : workflowSummary.framesReady > 0 || shotsWithStoryboardPrompts > 0;
  const videoPromptButtonLabel =
    workflowSummary.videoPromptsReady > 0 ? "批量重新生成视频提示词" : t("project.batchGenerateVideoPrompts");

  const progressNow = batchProgress
    ? Math.min(
        batchProgress.total,
        batchProgress.completed + (batchProgress.inProgress || 0) + batchProgress.failed.length
      )
    : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-[--surface] text-[10px] font-bold text-[--text-muted]">1</span>
        <InlineModelPicker capability="text" />
        <Button onClick={handleGenerateShots} disabled={anyGenerating} variant="default" size="sm">
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {generating ? t("common.generating") : t("project.generateShots")}
        </Button>
        <Button
          onClick={handlePreviewReplanLongShots}
          disabled={anyGenerating || previewingReplanLongShots}
          variant="ghost"
          size="sm"
          title={t("storyboard.replanLongShotsPreviewHelp")}
        >
          {previewingReplanLongShots ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {previewingReplanLongShots ? t("storyboard.replanLongShotsPreviewRunning") : t("storyboard.replanLongShotsPreview")}
        </Button>
        <Button
          onClick={handleReplanLongShots}
          disabled={anyGenerating || replanningLongShots}
          variant="outline"
          size="sm"
          title={t("storyboard.replanLongShotsHelp")}
        >
          {replanningLongShots ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {replanningLongShots ? t("storyboard.replanLongShotsRunning") : t("storyboard.replanLongShots")}
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-[--surface] text-[10px] font-bold text-[--text-muted]">2</span>
        <InlineModelPicker capability="image" />
        {generationMode === "reference" ? (
          <>
            <Button size="sm" onClick={handleGenerateRefPrompts} disabled={generatingRefPrompts || anyGenerating}>
              {generatingRefPrompts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generatingRefPrompts ? t("common.generating") : t("storyboard.generateRefPrompts") || "Generate Ref Prompts"}
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() => handleBatchGenerateSceneFrames(false)}
              disabled={anyGenerating || !hasReferenceImages || shotsWithRefPrompts === 0 || workflowSummary.needsFrames === 0}
            >
              {generatingSceneFrames && !sceneFramesOverwrite ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
              {generatingSceneFrames && !sceneFramesOverwrite ? t("common.generating") : t("storyboard.batchGenerateRefImages") || "Batch Generate Ref Images"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleBatchGenerateSceneFrames(true)} disabled={anyGenerating || !hasReferenceImages}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              onClick={handleGenerateStoryboardPrompts}
              disabled={generatingStoryboardPrompts || anyGenerating}
              title="基于镜头信息、角色、场景和道具生成四宫格提示词"
            >
              {generatingStoryboardPrompts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generatingStoryboardPrompts ? "生成中…" : "生成四宫格提示词"}
            </Button>
            <Button
              onClick={() => handleBatchGenerateFrames(false)}
              disabled={anyGenerating || shotsWithStoryboardPrompts === 0 || workflowSummary.needsFrames === 0}
              variant="default"
              size="sm"
            >
              {generatingFrames && !generatingFramesOverwrite ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
              {generatingFrames && !generatingFramesOverwrite ? t("common.generating") : "批量生成四宫格"}
            </Button>
            <Button onClick={() => handleBatchGenerateFrames(true)} disabled={anyGenerating || shotsWithStoryboardPrompts === 0} variant="ghost" size="icon" title="覆盖重生成四宫格">
              {generatingFrames && generatingFramesOverwrite ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-[--surface] text-[10px] font-bold text-[--text-muted]">3</span>
        <InlineModelPicker capability="text" />
        <Button onClick={handleBatchGenerateVideoPrompts} disabled={anyGenerating || !canBatchGenerateVideoPrompts} variant="default" size="sm">
          {generatingVideoPrompts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {generatingVideoPrompts ? t("common.generating") : videoPromptButtonLabel}
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-[--surface] text-[10px] font-bold text-[--text-muted]">4</span>
        <InlineModelPicker capability="video" />
        <VideoRatioPicker value={videoRatio} onChange={setVideoRatio} />
        <Button
          onClick={() => (generationMode === "reference" ? handleBatchGenerateReferenceVideos(false) : handleBatchGenerateVideos(false))}
          disabled={anyGenerating || workflowSummary.needsVideos === 0}
          variant="default"
          size="sm"
        >
          {generatingVideos && !generatingVideosOverwrite ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <VideoIcon className="h-3.5 w-3.5" />}
          {generatingVideos && !generatingVideosOverwrite ? t("common.generating") : generationMode === "reference" ? t("project.batchGenerateReferenceVideos") : t("project.batchGenerateVideos")}
        </Button>
        <Button
          onClick={() => (generationMode === "reference" ? handleBatchGenerateReferenceVideos(true) : handleBatchGenerateVideos(true))}
          disabled={anyGenerating}
          variant="ghost"
          size="icon"
          title={t("project.batchGenerateVideosOverwrite")}
        >
          {generatingVideos && generatingVideosOverwrite ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="h-px bg-[--border-subtle]" />
      <div className="flex items-center gap-2">
        <Button onClick={handleAutoRun} disabled={anyGenerating} variant="default" size="sm" className="gap-1.5">
          {anyGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {t("project.autoRun")}
        </Button>
        {generationMode === "storyboard_grid" && (
          <Button
            onClick={onToggleContinuityOnly}
            disabled={workflowSummary.continuityFailed === 0}
            variant={showContinuityOnly ? "default" : "outline"}
            size="sm"
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            {showContinuityOnly
              ? `显示全部镜头`
              : `只看待修复连续性镜头 (${workflowSummary.continuityFailed})`}
          </Button>
        )}
        {generationMode === "storyboard_grid" && (
          <Button
            onClick={handleRepairContinuityPrompts}
            disabled={anyGenerating || !hasContinuityRepairTargets}
            variant="outline"
            size="sm"
          >
            <Sparkles className="mr-1 h-4 w-4" />
            批量修复连续性提示词
          </Button>
        )}
        {generationMode === "storyboard_grid" && (
          <Button
            onClick={handleRepairContinuityImages}
            disabled={anyGenerating || !hasImageAuditRepairTargets}
            variant="outline"
            size="sm"
          >
            <ImageIcon className="mr-1 h-4 w-4" />
            批量重生问题四宫格
          </Button>
        )}
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

      {batchProgress && (
        <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          <div className="flex-1">
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{
                  width: `${batchProgress.total > 0 ? (progressNow / batchProgress.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          <span className="text-sm text-muted-foreground tabular-nums">
            {progressNow}/{batchProgress.total}
            {(batchProgress.inProgress || 0) > 0 && <span className="ml-1">({batchProgress.inProgress} running)</span>}
            {batchProgress.failed.length > 0 && <span className="text-destructive ml-1">({batchProgress.failed.length} failed)</span>}
          </span>
        </div>
      )}
    </div>
  );
}
