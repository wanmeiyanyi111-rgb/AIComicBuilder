"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { uploadUrl } from "@/lib/utils/upload-url";
import { useModelStore } from "@/stores/model-store";
import { toast } from "sonner";
import {
  type Shot,
  getStoryboardImageAudit,
  getStoryboardPromptAudit,
  getReferenceVideoUrl,
  getSceneRefFrameUrl,
  getStoryboardGridUrl,
  getStoryboardPanels,
  getStoryboardVideoUrl,
} from "@/stores/project-store";
import {
  ChevronRight,
  ImageIcon,
  Loader2,
  PlayCircle,
  Sparkles,
} from "lucide-react";
import { ShotCardDialogs } from "./shot-card-dialogs";
import {
  ShotCardContinuitySection,
  ShotCardPreflightSection,
  ShotCardPreviewSection,
  ShotCardPromptSection,
} from "./shot-card-sections";
import {
  stageTone,
  statusLabel,
  statusTone,
  workflowBadgeLabel,
  workflowBadgeTone,
} from "./shot-card-utils";

interface ShotCardProps {
  shot: Shot;
  projectId: string;
  onUpdate: () => void;
  onGenerateVideo?: (shot: Shot) => Promise<void>;
  generationMode?: "storyboard_grid" | "reference";
  videoRatio?: string;
  selectedVersionId?: string | null;
  isCompact?: boolean;
  onOpenDrawer?: (id: string) => void;
  batchGeneratingFrames?: boolean;
  batchGeneratingVideoPrompts?: boolean;
  batchGeneratingVideos?: boolean;
  preflightState?: "pending" | "running" | "done" | "error";
  preflightPassed?: boolean | null;
  preflightScore?: number | null;
  preflightIssueSummary?: string | null;
  preflightFixing?: boolean;
  onOpenPreflight?: (shotId: string) => void;
  onApplyPreflightFix?: (shotId: string) => void;
}

export function ShotCard({
  shot,
  projectId,
  onUpdate,
  onGenerateVideo,
  generationMode = "storyboard_grid",
  videoRatio = "16:9",
  selectedVersionId = null,
  isCompact = false,
  onOpenDrawer,
  batchGeneratingFrames = false,
  batchGeneratingVideoPrompts = false,
  batchGeneratingVideos = false,
  preflightState,
  preflightPassed = null,
  preflightScore = null,
  preflightIssueSummary = null,
  preflightFixing = false,
  onOpenPreflight,
  onApplyPreflightFix,
}: ShotCardProps) {
  const t = useTranslations();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const [generatingFrames, setGeneratingFrames] = useState(false);
  const [generatingStoryboardPrompt, setGeneratingStoryboardPrompt] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [panelDialogOpen, setPanelDialogOpen] = useState(false);
  const [videoPromptDialogOpen, setVideoPromptDialogOpen] = useState(false);

  const storyboardGridUrl = getStoryboardGridUrl(shot);
  const storyboardPanels = getStoryboardPanels(shot);
  const referenceFrameUrl = getSceneRefFrameUrl(shot);
  const videoUrl =
    generationMode === "reference"
      ? getReferenceVideoUrl(shot)
      : getStoryboardVideoUrl(shot);

  const previewUrl = storyboardGridUrl || referenceFrameUrl || null;
  const panelPrompts = useMemo(
    () => storyboardPanels.slice(0, 4).map((panel) => panel.prompt || ""),
    [storyboardPanels]
  );
  const workflow = shot.workflowState;
  const storyboardAudit =
    generationMode === "reference" ? null : getStoryboardPromptAudit(shot);
  const storyboardImageAudit =
    generationMode === "reference" ? null : getStoryboardImageAudit(shot);
  const hasBoard =
    workflow?.mode === generationMode
      ? workflow.frameReady
      : generationMode === "reference"
        ? !!referenceFrameUrl
        : !!storyboardGridUrl;
  const hasPromptGroup =
    generationMode === "reference" ? false : panelPrompts.some((prompt) => !!prompt.trim());
  const hasVideoPrompt =
    workflow?.mode === generationMode
      ? workflow.videoPromptReady
      : !!shot.videoPrompt?.trim();

  async function runAction(action: string, payload?: Record<string, unknown>) {
    await apiFetch(`/api/projects/${projectId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        payload: {
          shotId: shot.id,
          ratio: videoRatio,
          versionId: selectedVersionId,
          ...payload,
        },
        modelConfig: getModelConfig(),
      }),
    });
  }

  async function handleGenerateStoryboard() {
    setGeneratingFrames(true);
    try {
      await runAction(
        generationMode === "reference"
          ? "single_scene_frame"
          : "single_storyboard_generate",
        {
          overwrite: hasBoard,
        }
      );
      await onUpdate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成分镜图失败");
    } finally {
      setGeneratingFrames(false);
    }
  }

  async function handleGeneratePrompt() {
    setGeneratingPrompt(true);
    try {
      await runAction("single_video_prompt");
      await onUpdate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成视频提示词失败");
    } finally {
      setGeneratingPrompt(false);
    }
  }

  async function handleGenerateStoryboardPrompt() {
    setGeneratingStoryboardPrompt(true);
    try {
      await runAction("generate_storyboard_prompts");
      await onUpdate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成四宫格提示词失败");
    } finally {
      setGeneratingStoryboardPrompt(false);
    }
  }

  async function handleRepairStoryboardImages() {
    setGeneratingFrames(true);
    try {
      await runAction("single_storyboard_generate", {
        overwrite: true,
      });
      await onUpdate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重生四宫格图片失败");
    } finally {
      setGeneratingFrames(false);
    }
  }

  async function handleGenerateVideo() {
    setGeneratingVideo(true);
    try {
      if (onGenerateVideo) {
        await onGenerateVideo(shot);
      } else {
        await runAction(
          generationMode === "reference"
            ? "single_reference_video"
            : "single_video_generate"
        );
      }
      await onUpdate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成视频失败");
    } finally {
      setGeneratingVideo(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-[--border-subtle] bg-white shadow-sm shadow-slate-200/60">
      <div className="border-b border-[--border-subtle] bg-gradient-to-r from-slate-50 via-white to-orange-50/40 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                #{shot.sequence}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusTone(shot.status)}`}
              >
                {statusLabel(shot.status)}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                {shot.duration}s
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                {generationMode === "reference" ? "参考图模式" : "四宫格模式"}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${workflowBadgeTone(
                  workflow?.preflightStatus,
                  workflow?.stale
                )}`}
              >
                {workflowBadgeLabel(workflow?.preflightStatus, workflow?.stale)}
              </span>
            </div>
            <div className="mt-3 rounded-2xl border border-white/70 bg-white/80 px-3 py-3 shadow-sm backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[--text-muted]">
                镜头目标
              </div>
              <p className="mt-1.5 line-clamp-3 text-[15px] leading-7 text-[--text-primary]">
                {shot.prompt || t("shot.noPrompt")}
              </p>
            </div>
          </div>
          {onOpenDrawer && (
            <Button variant="ghost" size="sm" onClick={() => onOpenDrawer(shot.id)}>
              详情
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div
          className={`grid items-start gap-4 ${
            isCompact ? "lg:grid-cols-[1.18fr_0.82fr]" : "lg:grid-cols-[1.1fr_0.9fr]"
          }`}
        >
          <ShotCardPreviewSection
            generationMode={generationMode}
            hasBoard={hasBoard}
            hasPromptGroup={hasPromptGroup}
            previewUrl={previewUrl}
            sequence={shot.sequence}
            videoUrl={videoUrl}
          />

          <div className="space-y-4">
            <div className="rounded-[26px] border border-[--border-subtle] bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[--text-muted]">
                    当前生成组
                  </div>
                  <div className="mt-1 text-sm font-medium text-[--text-primary]">
                    当前镜头的提示词、成图和视频状态
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className={`rounded-full px-2.5 py-1 font-medium ${stageTone(hasBoard)}`}>
                    图 {hasBoard ? "已就绪" : "待生成"}
                  </span>
                  {generationMode !== "reference" && (
                    <span
                      className={`rounded-full px-2.5 py-1 font-medium ${stageTone(hasPromptGroup)}`}
                    >
                      词组 {hasPromptGroup ? "已就绪" : "待生成"}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2.5 py-1 font-medium ${stageTone(hasVideoPrompt)}`}
                  >
                    视频词 {hasVideoPrompt ? "已就绪" : "待生成"}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 font-medium ${stageTone(!!videoUrl)}`}
                  >
                    视频 {videoUrl ? "已就绪" : "待生成"}
                  </span>
                </div>
              </div>
            </div>

            <ShotCardPromptSection
              generationMode={generationMode}
              hasPromptGroup={hasPromptGroup}
              hasVideoPrompt={hasVideoPrompt}
              onOpenPanelPrompts={() => setPanelDialogOpen(true)}
              onOpenVideoPrompt={() => setVideoPromptDialogOpen(true)}
            />

            {generationMode !== "reference" && (
              <ShotCardContinuitySection
                auditAttempts={storyboardAudit?.attempts ?? 0}
                auditIssues={storyboardAudit?.issues ?? []}
                auditPassed={storyboardAudit?.pass ?? null}
                auditScore={storyboardAudit?.score ?? null}
                imageAuditPassed={storyboardImageAudit?.pass ?? null}
                imageAuditScore={storyboardImageAudit?.score ?? null}
                imageAuditSummary={storyboardImageAudit?.summary ?? null}
                hasPromptGroup={hasPromptGroup}
                repairingImages={generatingFrames || batchGeneratingFrames}
                repairingPrompts={generatingStoryboardPrompt}
                onRepairImages={handleRepairStoryboardImages}
                onRepairPrompts={handleGenerateStoryboardPrompt}
              />
            )}

            <ShotCardPreflightSection
              preflightFixing={preflightFixing}
              preflightIssueSummary={preflightIssueSummary}
              preflightPassed={preflightPassed}
              preflightScore={preflightScore}
              preflightState={preflightState}
              shotId={shot.id}
              onApplyPreflightFix={onApplyPreflightFix}
              onOpenPreflight={onOpenPreflight}
            />

            {videoUrl && (
              <div className="overflow-hidden rounded-[24px] border border-[--border-subtle] bg-black shadow-sm">
                <video
                  className="aspect-video w-full object-cover"
                  src={uploadUrl(videoUrl)}
                  controls
                  preload="metadata"
                />
              </div>
            )}
          </div>
        </div>

      </div>

      <div className="flex flex-wrap gap-2 border-t border-[--border-subtle] bg-slate-50/70 px-4 py-3">
        <Button
          size="sm"
          variant="outline"
          onClick={handleGenerateStoryboard}
          disabled={generatingFrames || batchGeneratingFrames}
        >
          {generatingFrames ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
          {generationMode === "reference"
            ? hasBoard
              ? "重新生成参考图"
              : "生成参考图"
            : hasBoard
              ? "重新生成四宫格"
              : "生成四宫格"}
        </Button>
        {generationMode !== "reference" && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleGenerateStoryboardPrompt}
            disabled={generatingStoryboardPrompt}
          >
            {generatingStoryboardPrompt ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {hasPromptGroup ? "重新生成四宫格提示词" : "生成四宫格提示词"}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={handleGeneratePrompt}
          disabled={generatingPrompt || batchGeneratingVideoPrompts}
        >
          {generatingPrompt ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {hasVideoPrompt ? "重新生成视频提示词" : "生成视频提示词"}
        </Button>
        <Button
          size="sm"
          onClick={handleGenerateVideo}
          disabled={generatingVideo || batchGeneratingVideos}
        >
          {generatingVideo ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          生成视频
        </Button>
      </div>

      <ShotCardDialogs
        openPanelPrompts={panelDialogOpen}
        openVideoPrompt={videoPromptDialogOpen}
        panelPrompts={panelPrompts}
        shotId={shot.id}
        videoPrompt={shot.videoPrompt}
        onOpenPanelPromptsChange={setPanelDialogOpen}
        onOpenVideoPromptChange={setVideoPromptDialogOpen}
      />
    </div>
  );
}
