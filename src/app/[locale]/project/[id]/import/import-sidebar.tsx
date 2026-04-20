"use client";

import { AlertCircle, ArrowLeft, Check, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Step } from "./import-types";

type Props = {
  currentLocale: string;
  projectId: string;
  routerPush: (href: string) => void;
  selectedStep: Step | null;
  setSelectedStep: (step: Step | null) => void;
  stepStatus: Record<Step, "idle" | "running" | "done" | "error">;
  steps: ReadonlyArray<{ num: Step; icon: LucideIcon; label: string }>;
  t: (key: string) => string;
  historyMode: boolean;
};

function stepIcon(status: string, Icon: LucideIcon) {
  switch (status) {
    case "running":
      return <Loader2 className="h-4 w-4 animate-spin" />;
    case "done":
      return <Check className="h-4 w-4" />;
    case "error":
      return <AlertCircle className="h-4 w-4" />;
    default:
      return <Icon className="h-4 w-4" />;
  }
}

function stepColor(status: string, selected: boolean) {
  const base =
    status === "running"
      ? "border-primary/30 bg-primary/5 text-primary"
      : status === "done"
        ? "border-transparent bg-[--surface] text-[--text-primary]"
        : status === "error"
          ? "border-red-300 bg-red-50 text-red-500"
          : "border-transparent bg-[--surface] text-[--text-muted]";
  return selected ? `${base} !bg-primary/10 !border-primary/40 !text-primary shadow-sm` : base;
}

export function ImportSidebar({
  currentLocale,
  projectId,
  routerPush,
  selectedStep,
  setSelectedStep,
  stepStatus,
  steps,
  t,
  historyMode,
}: Props) {
  return (
    <div className="flex w-56 shrink-0 flex-col border-r border-[--border-subtle] bg-white p-4">
      <button
        onClick={() => routerPush(`/${currentLocale}/project/${projectId}/episodes`)}
        className="mb-6 flex items-center gap-2 text-sm text-[--text-muted] hover:text-primary transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("backToEpisodes")}
      </button>

      <h2 className="mb-4 font-display text-lg font-bold text-[--text-primary]">{t("title")}</h2>

      <div className="flex flex-col gap-2">
        {steps.map(({ num, icon: Icon, label }) => {
          const isClickable = historyMode && stepStatus[num] !== "idle";
          const isSelected = selectedStep === num;
          return (
            <button
              key={num}
              disabled={!isClickable}
              onClick={() => isClickable && setSelectedStep(isSelected ? null : num)}
              className={`relative flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-200 ${stepColor(stepStatus[num], isSelected)} ${isClickable ? "cursor-pointer hover:bg-primary/5" : ""}`}
            >
              {isSelected && <div className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />}
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                stepStatus[num] === "done"
                  ? isSelected ? "bg-primary/15 text-primary" : "bg-emerald-100 text-emerald-600"
                  : stepStatus[num] === "running" ? "bg-primary/15"
                  : stepStatus[num] === "error" ? "bg-red-100"
                  : "bg-white"
              }`}>
                {stepIcon(stepStatus[num], Icon)}
              </div>
              <span className="text-sm font-medium">{t(label)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
