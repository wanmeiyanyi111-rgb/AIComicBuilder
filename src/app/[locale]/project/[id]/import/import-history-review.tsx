"use client";

import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EMPTY_STEP_STATUS, STEPS } from "./import-types";
import type {
  ExtractedCharacter,
  LogEntry,
  ScenePropCandidate,
  SplitEpisode,
  Step,
} from "./import-types";

type ImportHistoryReviewProps = {
  currentStep: Step | 0;
  historyMode: boolean;
  logs: LogEntry[];
  logsEndRef: React.RefObject<HTMLDivElement | null>;
  propCandidates: ScenePropCandidate[];
  retryStep: () => void;
  sceneCandidates: ScenePropCandidate[];
  selectedStep: Step | null;
  setCurrentStep: (value: Step | 0) => void;
  setHistoryMode: (value: boolean) => void;
  setSelectedStep: (value: Step | null) => void;
  setStepStatus: (value: Record<Step, "idle" | "running" | "done" | "error">) => void;
  showCharReview: boolean;
  showEpReview: boolean;
  stepStatus: Record<Step, "idle" | "running" | "done" | "error">;
  t: (key: string) => string;
};

export function ImportHistoryReview({
  currentStep,
  historyMode,
  logs,
  logsEndRef,
  propCandidates,
  retryStep,
  sceneCandidates,
  selectedStep,
  setCurrentStep,
  setHistoryMode,
  setSelectedStep,
  setStepStatus,
  showCharReview,
  showEpReview,
  stepStatus,
  t,
}: ImportHistoryReviewProps) {
  if ((currentStep <= 0 && !historyMode) || showCharReview || showEpReview) {
    return null;
  }

  const filteredLogs = selectedStep ? logs.filter((log) => log.step === selectedStep) : logs;
  const stepDoneLog = selectedStep
    ? logs.find((log) => log.step === selectedStep && log.status === "done" && log.metadata)
    : null;
  const meta = stepDoneLog?.metadata as Record<string, unknown> | null;
  const metaCharacters = meta?.characters as ExtractedCharacter[] | undefined;
  const metaEpisodes = meta?.episodes as SplitEpisode[] | undefined;
  const metaScenes = meta?.scenes as ScenePropCandidate[] | undefined;
  const metaProps = meta?.props as ScenePropCandidate[] | undefined;
  const step2DoneLog = selectedStep === 4
    ? logs.find((log) => log.step === 2 && log.status === "done" && log.metadata)
    : null;
  const step2Meta = step2DoneLog?.metadata as Record<string, unknown> | null;
  const step2Characters = step2Meta?.characters as ExtractedCharacter[] | undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-[--text-secondary]">
          {t("processLog")}
          {selectedStep && (
            <span className="ml-2 text-xs font-normal text-[--text-muted]">
              {" "}— {t(STEPS[selectedStep - 1].label)}
            </span>
          )}
        </h3>
        {selectedStep && (
          <button onClick={() => setSelectedStep(null)} className="text-xs text-primary hover:underline">
            {t("showAll")}
          </button>
        )}
      </div>

      <div className="rounded-xl border border-[--border-subtle] bg-white p-4">
        <div className="max-h-[30vh] space-y-1.5 overflow-y-auto font-mono text-xs">
          {filteredLogs.map((log, idx) => (
            <div key={`${log.id}-${log.createdAt}-${idx}`} className="flex items-start gap-2">
              <span
                className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                  log.status === "done"
                    ? "bg-emerald-500"
                    : log.status === "error"
                      ? "bg-red-500"
                      : "bg-amber-400"
                }`}
              />
              {!selectedStep && (
                <span className="shrink-0 text-[--text-muted]">[Step {log.step}]</span>
              )}
              <span className={log.status === "error" ? "text-red-500" : "text-[--text-primary]"}>
                {log.message}
              </span>
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>

      {([1, 2, 3, 4, 5] as Step[]).some((step) => stepStatus[step] === "error") && !historyMode && (
        <Button variant="outline" size="sm" onClick={retryStep} className="self-start">
          <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
          {t("retry")}
        </Button>
      )}

      {selectedStep === 2 && metaCharacters && metaCharacters.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-[--text-secondary]">
            {t("reviewCharacters")} ({metaCharacters.length})
          </h4>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {metaCharacters.map((char, idx) => (
              <div
                key={idx}
                className="group relative overflow-hidden rounded-[14px] border border-[--border-subtle] bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-[--border-hover] hover:shadow-lg hover:shadow-black/5"
              >
                <div className={`h-1 w-full ${char.scope === "main" ? "bg-gradient-to-r from-blue-500 to-blue-400" : "bg-gradient-to-r from-purple-500 to-purple-400"}`} />
                <div className="p-3.5">
                  <div className="mb-2.5 flex items-center gap-2.5">
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-sm font-bold text-white"
                      style={{ background: `linear-gradient(135deg, hsl(${(char.name.charCodeAt(0) * 37) % 360}, 45%, 45%), hsl(${(char.name.charCodeAt(0) * 37) % 360}, 50%, 55%))` }}
                    >
                      {char.name.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-bold text-[--text-primary]">{char.name}</div>
                      <div className="flex items-center gap-1.5 text-[10px] text-[--text-muted]">
                        <span>{t("frequency")} {char.frequency}</span>
                        {char.visualHint && (
                          <>
                            <span className="h-[3px] w-[3px] rounded-full bg-[#ddd]" />
                            <span className="truncate">{char.visualHint}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {char.visualHint && (
                    <div className="mb-2 inline-block rounded-md bg-[--surface] px-2 py-0.5 text-[10px] font-medium text-[--text-muted]">
                      {char.visualHint}
                    </div>
                  )}
                  <p className="line-clamp-2 text-[11px] leading-relaxed text-[--text-muted]">{char.description}</p>
                </div>
                <span className={`absolute right-3 top-3 rounded-[8px] px-2 py-0.5 text-[9px] font-bold tracking-wide ${
                  char.scope === "main" ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"
                }`}>
                  {char.scope === "main" ? t("main") : t("guest")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedStep === 3 && ((metaScenes && metaScenes.length > 0) || (metaProps && metaProps.length > 0) || sceneCandidates.length > 0 || propCandidates.length > 0) && (
        <div className="space-y-3">
          {(metaScenes?.length || sceneCandidates.length) > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-medium text-[--text-secondary]">场景候选 ({metaScenes?.length || sceneCandidates.length})</h4>
              <div className="flex flex-wrap gap-1">
                {(metaScenes || sceneCandidates).map((scene) => (
                  <span key={`scene-candidate-${scene.name}`} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                    {scene.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {(metaProps?.length || propCandidates.length) > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-medium text-[--text-secondary]">道具候选 ({metaProps?.length || propCandidates.length})</h4>
              <div className="flex flex-wrap gap-1">
                {(metaProps || propCandidates).map((prop) => (
                  <span key={`prop-candidate-${prop.name}`} className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    {prop.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {selectedStep === 4 && metaEpisodes && metaEpisodes.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-[--text-secondary]">
            {t("reviewEpisodes")} ({metaEpisodes.length})
          </h4>
          <div className="space-y-2">
            {metaEpisodes.map((ep, idx) => (
              <div key={idx} className="rounded-xl border border-[--border-subtle] bg-white p-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                    EP.{String(idx + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm font-semibold text-[--text-primary]">{ep.title}</span>
                </div>
                <p className="text-xs text-[--text-muted]">{ep.description}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">目标 {ep.targetDurationSec || 150}s</span>
                  <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-medium text-cyan-700">预计 {ep.estimatedDurationSec || ep.targetDurationSec || 150}s</span>
                </div>
                {(ep.hook || ep.cliffhanger) && (
                  <div className="mt-2 grid gap-1 rounded-lg bg-[--surface] p-2 text-[11px] text-[--text-secondary]">
                    {ep.hook && <div><span className="font-semibold text-[--text-primary]">钩子：</span>{ep.hook}</div>}
                    {ep.cliffhanger && <div><span className="font-semibold text-[--text-primary]">悬念：</span>{ep.cliffhanger}</div>}
                  </div>
                )}
                {ep.characters && ep.characters.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {ep.characters.map((name) => {
                      const isMain = step2Characters?.some((char) => char.name === name && char.scope === "main");
                      return (
                        <span key={name} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isMain ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"}`}>
                          {name}
                        </span>
                      );
                    })}
                  </div>
                )}
                {ep.scenes && ep.scenes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {ep.scenes.map((name) => (
                      <span key={`meta-scene-${name}`} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                        场景·{name}
                      </span>
                    ))}
                  </div>
                )}
                {ep.props && ep.props.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {ep.props.map((name) => (
                      <span key={`meta-prop-${name}`} className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        道具·{name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {historyMode && (
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setHistoryMode(false);
              setSelectedStep(null);
              setCurrentStep(0);
              setStepStatus(EMPTY_STEP_STATUS);
            }}
          >
            {t("newImport")}
          </Button>
        </div>
      )}
    </div>
  );
}
