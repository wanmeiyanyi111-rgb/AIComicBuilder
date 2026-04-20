"use client";

import { AlertTriangle, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PreflightFixSnapshot } from "./storyboard-preflight-utils";
import { getPrecheckStageLabel, isAuditTimeout } from "./storyboard-preflight-utils";

type PreflightDisplayItem = {
  shotId: string;
  sequence: number;
  result?: any;
  runState: string;
  errorMessage?: string;
};

type PreflightDisplayMapItem = {
  sequence: number;
  result?: any;
};

type Props = {
  anyGenerating: boolean;
  fixingAllPreflight: boolean;
  fixingPreflightShotId: string | null;
  handleApplyAllPreflightFixes: () => void;
  handleApplyPreflightFix: (item: any) => void;
  preflightDisplayItems: PreflightDisplayItem[];
  preflightDisplayMap: Map<string, PreflightDisplayMapItem>;
  preflightFixDiffs: Record<
    string,
    {
      before: PreflightFixSnapshot;
      after: PreflightFixSnapshot;
      changedFields: Array<keyof PreflightFixSnapshot>;
    }
  >;
  preflightFixProgress: {
    total: number;
    completed: number;
    succeeded: number;
    failed: number;
    currentShotId?: string | null;
  } | null;
  preflightProgress: {
    total: number;
    completed: number;
    running: number;
    failed: number;
  } | null;
  preflightResult: any;
  runningVideoPreflight: boolean;
  tr: (key: string, fallback: string, values?: Record<string, string | number>) => string;
};

export function StoryboardPreflightPanel({
  anyGenerating,
  fixingAllPreflight,
  fixingPreflightShotId,
  handleApplyAllPreflightFixes,
  handleApplyPreflightFix,
  preflightDisplayItems,
  preflightDisplayMap,
  preflightFixDiffs,
  preflightFixProgress,
  preflightProgress,
  preflightResult,
  runningVideoPreflight,
  tr,
}: Props) {
  if (!(preflightResult || runningVideoPreflight || preflightProgress)) {
    return null;
  }

  return (
    <div className="rounded-lg border border-[--border-subtle] bg-white p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="space-y-1">
          <p className="text-xs text-[--text-secondary]">
            {runningVideoPreflight && preflightProgress
              ? tr(
                  "storyboard.preflightProgressSummary",
                  "{stage}进行中：已完成 {completed}/{total}，检测中 {running}，失败请求 {failed}",
                  {
                    stage: getPrecheckStageLabel(preflightResult?.stage),
                    completed: preflightProgress.completed,
                    total: preflightProgress.total,
                    running: preflightProgress.running,
                    failed: preflightProgress.failed,
                  }
                )
              : tr(
                  "storyboard.preflightResultSummary",
                  "{stage}结果：通过 {pass}/{total}，平均分 {score}，通过率 {rate}%",
                  {
                    stage: getPrecheckStageLabel(preflightResult?.stage),
                    pass: preflightResult?.summary.pass ?? 0,
                    total: preflightResult?.summary.total ?? 0,
                    score: preflightResult?.summary.averageScore ?? 0,
                    rate: preflightResult?.summary.passRate ?? 0,
                  }
                )}
          </p>
          <p className="text-[11px] text-[--text-muted]">
            {preflightResult?.summary.audit
              ? tr(
                  "storyboard.preflightAuditSummary",
                  "AI审查：已完成 {ok} 条，通过 {pass} 条，失败 {fail} 条，跳过 {skipped} 条，均分 {score}",
                  {
                    ok: preflightResult.summary.audit.ok,
                    pass: preflightResult.summary.audit.pass,
                    fail: preflightResult.summary.audit.fail,
                    skipped: preflightResult.summary.audit.skipped,
                    score: preflightResult.summary.audit.averageScore,
                  }
                )
              : tr(
                  "storyboard.preflightAuditSummaryFallback",
                  "AI审查：当前结果未返回额外审查信息"
                )}
          </p>
        </div>
        {runningVideoPreflight ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
            <Loader2 className="h-3 w-3 animate-spin" />
            {`${getPrecheckStageLabel(preflightResult?.stage)}中...`}
          </span>
        ) : (preflightResult?.summary.fail ?? 0) > 0 ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
              <AlertTriangle className="h-3 w-3" />
              {tr("storyboard.preflightNeedFix", "待修复 {count} 条", {
                count: preflightResult?.summary.fail ?? 0,
              })}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={anyGenerating || fixingAllPreflight || runningVideoPreflight}
              onClick={handleApplyAllPreflightFixes}
              className="h-7 gap-1.5 text-[11px]"
            >
              {fixingAllPreflight ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {fixingAllPreflight
                ? tr("storyboard.preflightFixingAll", "批量AI修复中...")
                : tr("storyboard.preflightFixAllAction", "批量AI修复")}
            </Button>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            <ShieldCheck className="h-3 w-3" />
            {tr("storyboard.preflightAllPassed", "全部通过")}
          </span>
        )}
      </div>

      {preflightProgress && (
        <div className="h-2 overflow-hidden rounded-full bg-[--surface]">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{
              width: `${
                preflightProgress.total > 0
                  ? ((preflightProgress.completed + preflightProgress.failed) /
                      preflightProgress.total) *
                    100
                  : 0
              }%`,
            }}
          />
        </div>
      )}

      {fixingAllPreflight && preflightFixProgress && (
        <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50/70 p-2.5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <div className="text-sky-800">
              {`批量 AI 修复进行中：已完成 ${preflightFixProgress.completed}/${preflightFixProgress.total}，成功 ${preflightFixProgress.succeeded}，失败 ${preflightFixProgress.failed}`}
            </div>
            <div className="font-medium text-sky-700">
              {preflightFixProgress.currentShotId
                ? (() => {
                    const currentItem = preflightDisplayMap.get(
                      preflightFixProgress.currentShotId
                    );
                    return currentItem ? `当前：镜头 #${currentItem.sequence}` : "当前：处理中";
                  })()
                : "正在收尾"}
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/80">
            <div
              className="h-full rounded-full bg-sky-500 transition-all duration-300"
              style={{
                width: `${
                  preflightFixProgress.total > 0
                    ? (preflightFixProgress.completed / preflightFixProgress.total) * 100
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      )}

      <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
        {preflightDisplayItems.map((entry) => {
          const item = entry.result;
          const pendingCardClass =
            entry.runState === "running"
              ? "border-sky-200 bg-sky-50/70"
              : entry.runState === "error"
                ? "border-amber-200 bg-amber-50/70"
                : "border-[--border-subtle] bg-[--surface]/40";

          if (!item) {
            return (
              <div
                id={`preflight-shot-${entry.shotId}`}
                key={entry.shotId}
                className={`rounded-md border px-2.5 py-2 text-xs space-y-2 ${pendingCardClass}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-[--text-primary]">
                      {tr("storyboard.preflightShotLabel", "镜头 #{sequence}", {
                        sequence: entry.sequence,
                      })}
                    </span>
                    {entry.runState === "running" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {tr("storyboard.preflightShotRunning", "检测中")}
                      </span>
                    ) : entry.runState === "error" ? (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        {tr("storyboard.preflightShotError", "检测失败")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600">
                        {tr("storyboard.preflightShotPending", "待检测")}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-[--text-muted]">
                  {entry.runState === "running"
                    ? tr(
                        "storyboard.preflightShotRunningHint",
                        "当前镜头正在进行连续性检测与 AI 审查。"
                      )
                    : entry.runState === "error"
                      ? entry.errorMessage ||
                        tr(
                          "storyboard.preflightShotErrorHint",
                          "当前镜头检测请求失败，请稍后重试。"
                        )
                      : tr(
                          "storyboard.preflightShotPendingHint",
                          "当前镜头尚未开始检测。"
                        )}
                </p>
              </div>
            );
          }

          return (
            <div
              id={`preflight-shot-${entry.shotId}`}
              key={entry.shotId}
              className={`rounded-md border px-2.5 py-2 text-xs space-y-2 ${
                item.pass
                  ? "border-emerald-200 bg-emerald-50/70"
                  : "border-destructive/25 bg-destructive/5"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-[--text-primary]">
                    {tr("storyboard.preflightShotLabel", "镜头 #{sequence}", {
                      sequence: item.sequence,
                    })}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    {tr("storyboard.preflightShotDone", "已完成检测")}
                  </span>
                  {fixingPreflightShotId === item.shotId ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      AI修复中
                    </span>
                  ) : item.auditStatus === "ok" ? (
                    <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                      {tr("storyboard.preflightAuditOk", "AI审查完成")}
                    </span>
                  ) : item.auditStatus === "failed" ? (
                    <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                      {tr("storyboard.preflightAuditFailed", "AI审查失败")}
                    </span>
                  ) : item.auditStatus === "skipped" ? (
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        isAuditTimeout(item.auditMessage)
                          ? "bg-orange-100 text-orange-700"
                          : "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {isAuditTimeout(item.auditMessage)
                        ? tr("storyboard.preflightAuditTimeout", "AI审查超时")
                        : tr("storyboard.preflightAuditSkipped", "AI审查跳过")}
                    </span>
                  ) : null}
                </div>
                <div className="text-right">
                  <div className="font-mono text-[--text-muted]">
                    {tr("storyboard.preflightCombinedScore", "综合 {score}", {
                      score: item.score,
                    })}
                  </div>
                  <div className="text-[10px] text-[--text-muted]">
                    {tr("storyboard.preflightRuleScore", "规则 {score}", {
                      score: item.ruleScore,
                    })}
                    {item.llmAudit
                      ? ` / ${tr("storyboard.preflightAiScore", "AI {score}", {
                          score: item.llmAudit.overallScore,
                        })}`
                      : ""}
                  </div>
                </div>
              </div>
              <p className="text-[--text-secondary]">{item.summary}</p>
              {preflightFixDiffs[item.shotId] && (
                <p className="text-[11px] font-medium text-sky-700">
                  已应用 AI 修复，当前分数与建议已更新，可直接查看是否达到预期。
                </p>
              )}
              {item.llmAudit && (
                <div className="grid grid-cols-2 gap-1.5 text-[10px] text-[--text-muted] sm:grid-cols-3">
                  <div className="rounded bg-white/70 px-2 py-1">
                    {tr("storyboard.preflightScoreStory", "剧情 {score}", {
                      score: item.llmAudit.dimensionScores.story,
                    })}
                  </div>
                  <div className="rounded bg-white/70 px-2 py-1">
                    {tr("storyboard.preflightScoreDirector", "导演 {score}", {
                      score: item.llmAudit.dimensionScores.director,
                    })}
                  </div>
                  <div className="rounded bg-white/70 px-2 py-1">
                    {tr("storyboard.preflightScoreContinuity", "连贯 {score}", {
                      score: item.llmAudit.dimensionScores.continuity,
                    })}
                  </div>
                  <div className="rounded bg-white/70 px-2 py-1">
                    {tr("storyboard.preflightScoreCamera", "镜头 {score}", {
                      score: item.llmAudit.dimensionScores.camera,
                    })}
                  </div>
                  <div className="rounded bg-white/70 px-2 py-1">
                    {tr("storyboard.preflightScoreExecutable", "可执行 {score}", {
                      score: item.llmAudit.dimensionScores.executability,
                    })}
                  </div>
                  <div className="rounded bg-white/70 px-2 py-1">
                    {tr("storyboard.preflightScoreStyle", "风格 {score}", {
                      score: item.llmAudit.dimensionScores.style,
                    })}
                  </div>
                </div>
              )}
              {item.llmAudit?.summary && (
                <p className="text-[11px] text-[--text-secondary]">
                  {tr("storyboard.preflightAiSummaryPrefix", "AI判断：")}
                  {item.llmAudit.summary}
                </p>
              )}
              {item.auditMessage && item.auditStatus !== "ok" && (
                <p className="text-[11px] text-amber-700">
                  {tr("storyboard.preflightAuditMessagePrefix", "AI状态：")}
                  {item.auditMessage}
                </p>
              )}
              {preflightFixDiffs[item.shotId] && (
                <div className="rounded-md border border-sky-200 bg-sky-50/70 p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-sky-800">
                      {tr("storyboard.preflightFixDiffTitle", "AI修复差异")}
                    </p>
                    <span className="text-[10px] text-sky-700">
                      {tr("storyboard.preflightFixDiffCount", "已变更 {count} 项", {
                        count: preflightFixDiffs[item.shotId].changedFields.length,
                      })}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {preflightFixDiffs[item.shotId].changedFields.map((field) => {
                      const labels: Record<keyof PreflightFixSnapshot, string> = {
                        prompt: tr("storyboard.diffPrompt", "镜头描述"),
                        firstPanelPrompt: tr("storyboard.diffStartFrame", "第1格提示词"),
                        fourthPanelPrompt: tr("storyboard.diffEndFrame", "第4格提示词"),
                        motionScript: tr("storyboard.diffMotion", "动作脚本"),
                        videoPrompt: tr("storyboard.diffVideoPrompt", "视频提示词"),
                        cameraDirection: tr("storyboard.diffCamera", "运镜"),
                      };
                      const diff = preflightFixDiffs[item.shotId];
                      return (
                        <div key={field} className="space-y-1">
                          <p className="text-[10px] font-medium text-sky-900">{labels[field]}</p>
                          <div className="grid gap-1 sm:grid-cols-2">
                            <div className="rounded bg-white/80 p-2">
                              <p className="mb-1 text-[10px] font-semibold text-[--text-muted]">
                                {tr("storyboard.diffBefore", "修复前")}
                              </p>
                              <p className="line-clamp-4 whitespace-pre-wrap break-words text-[10px] text-[--text-secondary]">
                                {diff.before[field] || tr("storyboard.diffEmpty", "空")}
                              </p>
                            </div>
                            <div className="rounded bg-white p-2 ring-1 ring-sky-200">
                              <p className="mb-1 text-[10px] font-semibold text-sky-700">
                                {tr("storyboard.diffAfter", "修复后")}
                              </p>
                              <p className="line-clamp-4 whitespace-pre-wrap break-words text-[10px] text-[--text-primary]">
                                {diff.after[field] || tr("storyboard.diffEmpty", "空")}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {item.issues[0] && <p className="text-[--text-secondary]">{item.issues[0]}</p>}
              {(item.llmAudit?.fixTarget || item.suggestions[0]) && (
                <p className="text-[--text-muted]">
                  {tr("storyboard.preflightSuggestionPrefix", "建议：")}
                  {item.suggestions[0]}
                  {item.llmAudit?.fixTarget
                    ? ` ${tr("storyboard.preflightFixTarget", "优先修复：{target}", {
                        target: item.llmAudit.fixTarget,
                      })}`
                    : ""}
                </p>
              )}
              {!item.pass && (
                <div className="pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      anyGenerating ||
                      fixingPreflightShotId === item.shotId ||
                      runningVideoPreflight
                    }
                    onClick={() => handleApplyPreflightFix(item)}
                    className="h-7 gap-1.5 text-[11px]"
                  >
                    {fixingPreflightShotId === item.shotId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    {fixingPreflightShotId === item.shotId
                      ? tr("storyboard.preflightFixing", "AI修复中...")
                      : tr("storyboard.preflightFixAction", "按AI建议修复")}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
