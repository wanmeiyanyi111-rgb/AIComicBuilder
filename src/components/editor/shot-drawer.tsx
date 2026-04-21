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
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Loader2,
  PlayCircle,
  Sparkles,
  X,
} from "lucide-react";

function stageTone(ready: boolean) {
  return ready
    ? "bg-emerald-100 text-emerald-700"
    : "bg-slate-100 text-slate-500";
}

interface ShotDrawerProps {
  shots: Shot[];
  openShotId: string | null;
  onClose: () => void;
  onShotChange: (id: string) => void;
  onUpdate: () => void;
  onGenerateVideo?: (shot: Shot) => Promise<void>;
  projectId: string;
  generationMode: "storyboard_grid" | "reference";
  videoRatio: string;
  selectedVersionId: string | null;
  anyGenerating: boolean;
}

export function ShotDrawer({
  shots,
  openShotId,
  onClose,
  onShotChange,
  onUpdate,
  onGenerateVideo,
  projectId,
  generationMode,
  videoRatio,
  selectedVersionId,
  anyGenerating,
}: ShotDrawerProps) {
  const t = useTranslations();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const [busyAction, setBusyAction] = useState<"board" | "prompt" | "video" | null>(null);
  const [generatingStoryboardPrompt, setGeneratingStoryboardPrompt] = useState(false);

  const currentIndex = shots.findIndex((shot) => shot.id === openShotId);
  const shot = currentIndex >= 0 ? shots[currentIndex] : null;
  const storyboardGridUrl = shot ? getStoryboardGridUrl(shot) : null;
  const storyboardPanels = shot ? getStoryboardPanels(shot).slice(0, 4) : [];
  const previewVideoUrl = shot
    ? generationMode === "reference"
      ? getReferenceVideoUrl(shot)
      : getStoryboardVideoUrl(shot)
    : null;
  const fallbackImage = shot ? getSceneRefFrameUrl(shot) : null;
  const panelPrompts = useMemo(
    () => storyboardPanels.map((panel) => panel.prompt || ""),
    [storyboardPanels]
  );
  const hasBoard =
    generationMode === "reference" ? !!fallbackImage : !!storyboardGridUrl;
  const storyboardAudit =
    generationMode === "reference" || !shot ? null : getStoryboardPromptAudit(shot);
  const storyboardImageAudit =
    generationMode === "reference" || !shot ? null : getStoryboardImageAudit(shot);
  const hasPromptGroup =
    generationMode === "reference" ? false : panelPrompts.some((prompt) => !!prompt.trim());
  const hasVideoPrompt = !!shot?.videoPrompt?.trim();

  async function callGenerate(action: string, payload?: Record<string, unknown>) {
    if (!shot) return;
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
    await onUpdate();
  }

  async function handleGenerateBoard() {
    if (!shot) return;
    setBusyAction("board");
    try {
      await callGenerate(
        generationMode === "reference"
          ? "single_scene_frame"
          : "single_storyboard_generate",
        {
          overwrite: hasBoard,
        }
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成分镜图失败");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleGeneratePrompt() {
    if (!shot) return;
    setBusyAction("prompt");
    try {
      await callGenerate("single_video_prompt");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成视频提示词失败");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleGenerateStoryboardPrompt() {
    if (!shot) return;
    setGeneratingStoryboardPrompt(true);
    try {
      await callGenerate("generate_storyboard_prompts");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成四宫格提示词失败");
    } finally {
      setGeneratingStoryboardPrompt(false);
    }
  }

  async function handleRepairStoryboardImages() {
    if (!shot) return;
    setBusyAction("board");
    try {
      await callGenerate("single_storyboard_generate", { overwrite: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重生四宫格图片失败");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleGenerateVideo() {
    if (!shot) return;
    setBusyAction("video");
    try {
      if (onGenerateVideo) {
        await onGenerateVideo(shot);
      } else {
        await callGenerate(
          generationMode === "reference"
            ? "single_reference_video"
            : "single_video_generate"
        );
      }
      await onUpdate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成视频失败");
    } finally {
      setBusyAction(null);
    }
  }

  if (!shot) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm">
      <div className="absolute right-0 top-0 flex h-full w-full max-w-5xl flex-col border-l border-[--border-subtle] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[--border-subtle] px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[--text-muted]">
              Shot #{shot.sequence}
            </div>
            <div className="mt-1 text-lg font-semibold text-[--text-primary]">
              {shot.prompt || t("shot.noPrompt")}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => currentIndex > 0 && onShotChange(shots[currentIndex - 1].id)}
              disabled={currentIndex <= 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                currentIndex < shots.length - 1 && onShotChange(shots[currentIndex + 1].id)
              }
              disabled={currentIndex >= shots.length - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid flex-1 gap-6 overflow-y-auto p-5 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <div className="overflow-hidden rounded-3xl border border-[--border-subtle] bg-[--surface]">
              {storyboardGridUrl || fallbackImage ? (
                <img
                  src={uploadUrl(storyboardGridUrl || fallbackImage!)}
                  alt={`Shot ${shot.sequence}`}
                  className="aspect-video w-full object-cover"
                />
              ) : (
                <div className="flex aspect-video items-center justify-center text-[--text-muted]">
                  <ImageIcon className="mr-2 h-5 w-5" />
                  暂无分镜图
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[--text-muted]">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium">
                {generationMode === "reference" ? "参考图成品" : "四宫格分镜成品"}
              </span>
              <span className={`rounded-full px-2.5 py-1 font-medium ${stageTone(hasBoard)}`}>
                {hasBoard ? "已生成" : "待生成"}
              </span>
            </div>

            {previewVideoUrl && (
              <div className="overflow-hidden rounded-3xl border border-[--border-subtle] bg-black">
                <video
                  src={uploadUrl(previewVideoUrl)}
                  controls
                  className="aspect-video w-full object-cover"
                />
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-[--border-subtle] bg-[--surface]/50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-[--text-muted]">
                    当前生成组
                  </div>
                  <div className="mt-1 text-sm text-[--text-secondary]">
                    这个镜头的成品图、提示词和视频都归在同一组里查看
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className={`rounded-full px-2 py-1 font-medium ${stageTone(hasBoard)}`}>
                    图 {hasBoard ? "已就绪" : "待生成"}
                  </span>
                  {generationMode !== "reference" && (
                    <span
                      className={`rounded-full px-2 py-1 font-medium ${stageTone(hasPromptGroup)}`}
                    >
                      词组 {hasPromptGroup ? "已就绪" : "待生成"}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2 py-1 font-medium ${stageTone(hasVideoPrompt)}`}
                  >
                    视频词 {hasVideoPrompt ? "已就绪" : "待生成"}
                  </span>
                  <span
                    className={`rounded-full px-2 py-1 font-medium ${stageTone(!!previewVideoUrl)}`}
                  >
                    视频 {previewVideoUrl ? "已就绪" : "待生成"}
                  </span>
                </div>
              </div>

              <div className="mt-4 rounded-2xl bg-white/85 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[--text-muted]">
                  镜头信息
                </div>
                <div className="mt-3 space-y-2 text-sm text-[--text-secondary]">
                  <div>时长：{shot.duration}s</div>
                  <div>镜头运动：{shot.cameraDirection || "static"}</div>
                  <div>状态：{shot.status}</div>
                  {shot.motionScript && <div>动作脚本：{shot.motionScript}</div>}
                </div>
              </div>

              {generationMode !== "reference" && (
                <div className="mt-4 rounded-2xl bg-white/85 p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[--text-muted]">
                      四宫格提示词组
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${stageTone(hasPromptGroup)}`}>
                      {hasPromptGroup ? "已生成" : "未生成"}
                    </span>
                  </div>
                  {panelPrompts.length === 0 ? (
                    <div className="text-sm text-[--text-muted]">暂无四宫格提示词</div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {panelPrompts.map((prompt, index) => (
                        <div key={`${shot.id}-drawer-panel-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                          <div className="mb-1 text-xs font-semibold text-primary">
                            第 {index + 1} 格
                          </div>
                          <div className="whitespace-pre-wrap text-xs text-[--text-secondary]">
                            {prompt || "暂无提示词"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {generationMode !== "reference" && (
                <div className="mt-4 rounded-2xl bg-white/85 p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[--text-muted]">
                      四宫格连续性
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-600">
                        {!hasPromptGroup
                          ? "待生成"
                          : storyboardAudit?.pass === null
                            ? "未评估"
                            : storyboardAudit?.pass
                              ? "通过"
                              : "待修复"}
                      </span>
                      {storyboardAudit?.score !== null && storyboardAudit?.score !== undefined && (
                        <span
                          className={`rounded-full px-2 py-1 font-medium ${
                            storyboardAudit.pass
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {storyboardAudit.score} 分
                        </span>
                      )}
                      {(storyboardAudit?.attempts || 0) > 0 && (
                        <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-600">
                          {storyboardAudit?.attempts} 次尝试
                        </span>
                      )}
                      {storyboardImageAudit?.score !== null &&
                        storyboardImageAudit?.score !== undefined && (
                          <span
                            className={`rounded-full px-2 py-1 font-medium ${
                              storyboardImageAudit.pass
                                ? "bg-sky-100 text-sky-700"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            成图审计 {storyboardImageAudit.score} 分
                          </span>
                        )}
                    </div>
                  </div>
                  {storyboardAudit?.issues?.length ? (
                    <div className="rounded-2xl bg-amber-50 p-3 text-xs leading-6 text-amber-800">
                      {storyboardAudit.issues.slice(0, 4).map((issue, index) => (
                        <div key={`${shot.id}-audit-issue-${index}`}>- {issue}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl bg-emerald-50 p-3 text-xs leading-6 text-emerald-700">
                      {hasPromptGroup
                        ? "当前四宫格的镜头推进与空间锚点基本稳定。"
                        : "先生成四宫格提示词，系统才会给出连续性审计。"}
                    </div>
                  )}
                  {storyboardImageAudit?.summary && (
                    <div className="mt-3 rounded-2xl bg-sky-50 p-3 text-xs leading-6 text-sky-700">
                      {storyboardImageAudit.summary}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={handleGenerateStoryboardPrompt}
                      disabled={generatingStoryboardPrompt || anyGenerating}
                    >
                      {generatingStoryboardPrompt ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      {storyboardAudit?.pass === false ? "修复四宫格提示词" : "重生成四宫格提示词"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleRepairStoryboardImages}
                      disabled={busyAction === "board" || anyGenerating}
                    >
                      {busyAction === "board" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ImageIcon className="h-4 w-4" />
                      )}
                      {storyboardAudit?.pass === false ? "重生四宫格图片" : "重生成四宫格图片"}
                    </Button>
                  </div>
                </div>
              )}

              <div className="mt-4 rounded-2xl bg-white/85 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[--text-muted]">
                    视频提示词
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${stageTone(hasVideoPrompt)}`}>
                    {hasVideoPrompt ? "已生成" : "未生成"}
                  </span>
                </div>
                <div className="mt-3 whitespace-pre-wrap text-xs text-[--text-secondary]">
                  {shot.videoPrompt || "暂无视频提示词"}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-[--border-subtle] px-5 py-4">
          <Button
            variant="outline"
            onClick={handleGenerateBoard}
            disabled={busyAction === "board" || anyGenerating}
          >
            {busyAction === "board" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
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
              variant="outline"
              onClick={handleGenerateStoryboardPrompt}
              disabled={generatingStoryboardPrompt || anyGenerating}
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
            variant="outline"
            onClick={handleGeneratePrompt}
            disabled={busyAction === "prompt" || anyGenerating}
          >
            {busyAction === "prompt" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {hasVideoPrompt ? "重新生成视频提示词" : "生成视频提示词"}
          </Button>
          <Button onClick={handleGenerateVideo} disabled={busyAction === "video" || anyGenerating}>
            {busyAction === "video" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            生成视频
          </Button>
        </div>
      </div>
    </div>
  );
}
