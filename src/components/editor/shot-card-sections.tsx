"use client";

import { Button } from "@/components/ui/button";
import { uploadUrl } from "@/lib/utils/upload-url";
import {
  AlertTriangle,
  Eye,
  ImageIcon,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { stageTone } from "./shot-card-utils";

interface ShotCardPreviewSectionProps {
  generationMode: "storyboard_grid" | "reference";
  hasBoard: boolean;
  hasPromptGroup: boolean;
  previewUrl: string | null;
  sequence: number;
  videoUrl: string | null;
}

export function ShotCardPreviewSection({
  generationMode,
  hasBoard,
  hasPromptGroup,
  previewUrl,
  sequence,
  videoUrl,
}: ShotCardPreviewSectionProps) {
  return (
    <div className="rounded-[26px] border border-[--border-subtle] bg-gradient-to-br from-slate-50 to-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[--text-muted]">
            画面预览
          </div>
          <div className="mt-1 text-sm font-medium text-[--text-primary]">
            {generationMode === "reference" ? "参考图成品" : "四宫格分镜成品"}
          </div>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${stageTone(hasBoard)}`}
        >
          {hasBoard ? "已生成" : "待生成"}
        </span>
      </div>

      <div className="overflow-hidden rounded-[22px] border border-[--border-subtle] bg-white shadow-inner">
        {previewUrl ? (
          <img
            src={uploadUrl(previewUrl)}
            alt={`Shot ${sequence}`}
            className="aspect-video w-full object-cover"
          />
        ) : (
          <div className="flex aspect-[16/8.8] flex-col items-center justify-center bg-[radial-gradient(circle_at_top,#fff7ed,transparent_40%),linear-gradient(180deg,#ffffff,#f8fafc)] px-6 text-[--text-muted] sm:aspect-[16/8.4]">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/80 shadow-sm">
              <ImageIcon className="h-5 w-5" />
            </div>
            <div className="mt-3 text-sm font-medium text-[--text-primary]">
              暂无分镜图
            </div>
            <div className="mt-1 text-center text-xs text-[--text-muted]">
              生成后会在这里展示当前镜头成品
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-2xl bg-white px-3 py-2 shadow-sm ring-1 ring-slate-100">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[--text-muted]">
            图像
          </div>
          <div className="mt-1 text-sm font-semibold text-[--text-primary]">
            {hasBoard ? "已就绪" : "待生成"}
          </div>
        </div>
        <div className="rounded-2xl bg-white px-3 py-2 shadow-sm ring-1 ring-slate-100">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[--text-muted]">
            词组
          </div>
          <div className="mt-1 text-sm font-semibold text-[--text-primary]">
            {generationMode === "reference"
              ? "参考模式"
              : hasPromptGroup
                ? "已就绪"
                : "待生成"}
          </div>
        </div>
        <div className="rounded-2xl bg-white px-3 py-2 shadow-sm ring-1 ring-slate-100">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[--text-muted]">
            视频
          </div>
          <div className="mt-1 text-sm font-semibold text-[--text-primary]">
            {videoUrl ? "已生成" : "待生成"}
          </div>
        </div>
      </div>
    </div>
  );
}

interface ShotCardPromptSectionProps {
  generationMode: "storyboard_grid" | "reference";
  hasPromptGroup: boolean;
  hasVideoPrompt: boolean;
  onOpenPanelPrompts: () => void;
  onOpenVideoPrompt: () => void;
}

export function ShotCardPromptSection({
  generationMode,
  hasPromptGroup,
  hasVideoPrompt,
  onOpenPanelPrompts,
  onOpenVideoPrompt,
}: ShotCardPromptSectionProps) {
  return (
    <div className="rounded-[26px] border border-[--border-subtle] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[--text-muted]">
            提示词模块
          </div>
          <div className="mt-1 text-sm font-medium text-[--text-primary]">
            四宫格提示词与视频提示词统一查看
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {generationMode !== "reference" && (
            <span
              className={`rounded-full px-2.5 py-1 font-medium ${stageTone(hasPromptGroup)}`}
            >
              四宫格 {hasPromptGroup ? "已生成" : "未生成"}
            </span>
          )}
          <span
            className={`rounded-full px-2.5 py-1 font-medium ${stageTone(hasVideoPrompt)}`}
          >
            视频词 {hasVideoPrompt ? "已生成" : "未生成"}
          </span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {generationMode !== "reference" && (
          <div className="rounded-2xl bg-slate-50 px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium text-[--text-primary]">
                  四宫格提示词
                </div>
                <div className="text-xs leading-6 text-[--text-muted]">
                  {hasPromptGroup
                    ? "已收起显示，按需查看 4 格剧情锚点。"
                    : "先生成四宫格提示词，再查看完整内容。"}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <Button
                size="sm"
                variant="outline"
                onClick={onOpenPanelPrompts}
                disabled={!hasPromptGroup}
              >
                <Eye className="h-4 w-4" />
                查看提示词
              </Button>
            </div>
          </div>
        )}

        <div className="rounded-2xl bg-slate-50 px-3 py-3">
          <div className="space-y-1">
            <div className="text-sm font-medium text-[--text-primary]">视频提示词</div>
            <div className="text-xs leading-6 text-[--text-muted]">
              {hasVideoPrompt
                ? "已收起显示，按需查看导演指令全文。"
                : "先生成视频提示词，再查看完整内容。"}
            </div>
          </div>
          <div className="mt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={onOpenVideoPrompt}
              disabled={!hasVideoPrompt}
            >
              <Eye className="h-4 w-4" />
              查看视频提示词
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ShotCardPreflightSectionProps {
  preflightFixing: boolean;
  preflightIssueSummary: string | null;
  preflightPassed: boolean | null;
  preflightScore: number | null;
  preflightState?: "pending" | "running" | "done" | "error";
  shotId: string;
  onApplyPreflightFix?: (shotId: string) => void;
  onOpenPreflight?: (shotId: string) => void;
}

export function ShotCardPreflightSection({
  preflightFixing,
  preflightIssueSummary,
  preflightPassed,
  preflightScore,
  preflightState,
  shotId,
  onApplyPreflightFix,
  onOpenPreflight,
}: ShotCardPreflightSectionProps) {
  return (
    <div className="rounded-[26px] border border-[--border-subtle] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[--text-muted]">
        <ShieldCheck className="h-4 w-4" />
        AI 检测
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
          状态 {preflightState || "pending"}
        </span>
        {preflightPassed !== null && (
          <span
            className={`rounded-full px-2.5 py-1 font-medium ${
              preflightPassed
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-700"
            }`}
          >
            {preflightPassed ? "通过" : "未通过"}
          </span>
        )}
        {preflightScore !== null && (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
            {preflightScore} 分
          </span>
        )}
      </div>
      {preflightIssueSummary && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2.5 text-xs leading-6 text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{preflightIssueSummary}</span>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        {onOpenPreflight && (
          <Button size="sm" variant="outline" onClick={() => onOpenPreflight(shotId)}>
            查看检测
          </Button>
        )}
        {onApplyPreflightFix && !preflightPassed && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onApplyPreflightFix(shotId)}
            disabled={preflightFixing}
          >
            {preflightFixing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            AI 修复
          </Button>
        )}
      </div>
    </div>
  );
}

interface ShotCardContinuitySectionProps {
  auditAttempts?: number;
  auditIssues: string[];
  imageAuditPassed: boolean | null;
  imageAuditScore: number | null;
  imageAuditSummary: string | null;
  auditPassed: boolean | null;
  auditScore: number | null;
  hasPromptGroup: boolean;
  repairingImages: boolean;
  repairingPrompts: boolean;
  onRepairImages: () => void;
  onRepairPrompts: () => void;
}

export function ShotCardContinuitySection({
  auditAttempts = 0,
  auditIssues,
  imageAuditPassed,
  imageAuditScore,
  imageAuditSummary,
  auditPassed,
  auditScore,
  hasPromptGroup,
  repairingImages,
  repairingPrompts,
  onRepairImages,
  onRepairPrompts,
}: ShotCardContinuitySectionProps) {
  return (
    <div className="rounded-[26px] border border-[--border-subtle] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[--text-muted]">
        <ShieldCheck className="h-4 w-4" />
        四宫格连续性
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
          状态 {!hasPromptGroup ? "待生成" : auditPassed === null ? "未评估" : auditPassed ? "通过" : "待修复"}
        </span>
        {auditScore !== null && (
          <span
            className={`rounded-full px-2.5 py-1 font-medium ${
              auditPassed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
            }`}
          >
            {auditScore} 分
          </span>
        )}
        {auditAttempts > 0 && (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
            {auditAttempts} 次尝试
          </span>
        )}
        {imageAuditScore !== null && (
          <span
            className={`rounded-full px-2.5 py-1 font-medium ${
              imageAuditPassed ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600"
            }`}
          >
            成图审计 {imageAuditScore} 分
          </span>
        )}
      </div>
      {!hasPromptGroup ? (
        <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2.5 text-xs leading-6 text-[--text-muted]">
          先生成四宫格提示词，系统才会给出连续性分数和修复建议。
        </div>
      ) : auditIssues.length > 0 ? (
        <div className="mt-3 rounded-2xl bg-amber-50 px-3 py-2.5 text-xs leading-6 text-amber-800">
          <div className="mb-1 font-medium">当前问题</div>
          <ul className="space-y-1">
            {auditIssues.slice(0, 3).map((issue, index) => (
              <li key={`${issue}-${index}`}>- {issue}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-3 rounded-2xl bg-emerald-50 px-3 py-2.5 text-xs leading-6 text-emerald-700">
          当前四宫格的镜头路径、景别推进和空间锚点基本稳定，可以继续生图或生视频。
        </div>
      )}
      {imageAuditSummary && (
        <div className="mt-3 rounded-2xl bg-sky-50 px-3 py-2.5 text-xs leading-6 text-sky-700">
          {imageAuditSummary}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onRepairPrompts} disabled={repairingPrompts}>
          {repairingPrompts ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {auditPassed === false ? "修复四宫格提示词" : "重生成四宫格提示词"}
        </Button>
        <Button size="sm" variant="outline" onClick={onRepairImages} disabled={repairingImages}>
          {repairingImages ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImageIcon className="h-4 w-4" />
          )}
          {auditPassed === false ? "重生四宫格图片" : "重生成四宫格图片"}
        </Button>
      </div>
    </div>
  );
}
