"use client";

import { use } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import {
  FileText, Users, Layers, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useModelStore } from "@/stores/model-store";
import { useModelGuard } from "@/hooks/use-model-guard";
import { ImportHistoryReview } from "./import-history-review";
import {
  type Step,
  STEPS as STEP_LABELS,
} from "./import-types";
import { ImportEpisodeReview } from "./import-episode-review";
import { ImportSidebar } from "./import-sidebar";
import { ImportUploadArea } from "./import-upload-area";
import { useImportPipeline } from "./use-import-pipeline";

const STEPS = [
  { ...STEP_LABELS[0], icon: FileText },
  { ...STEP_LABELS[1], icon: Users },
  { ...STEP_LABELS[2], icon: Layers },
  { ...STEP_LABELS[3], icon: Layers },
  { ...STEP_LABELS[4], icon: Sparkles },
] as const;

export default function ImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("import");
  const textGuard = useModelGuard("text");
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const {
    characters,
    currentStep,
    dragOver,
    episodes,
    file,
    handleFile,
    historyMode,
    inputRef,
    logs,
    logsEndRef,
    propCandidates,
    retryStep,
    runGenerate,
    runSplit,
    sceneCandidates,
    selectedStep,
    setCurrentStep,
    setDragOver,
    setFile,
    setHistoryMode,
    setSelectedStep,
    setStepStatus,
    startPipeline,
    stepStatus,
    toggleScope,
    updateEpisode,
    removeEpisode,
  } = useImportPipeline({
    getModelConfig,
    projectId,
    routerPush: router.push,
    locale,
    t,
    textGuard,
  });

  // Pipeline now auto-runs parse -> characters -> scene/prop -> split.
  const showCharReview = false;
  // Show episodes review after split done and before final create.
  const showEpReview = stepStatus[4] === "done" && stepStatus[5] === "idle" && !historyMode;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Left: Steps sidebar */}
      <ImportSidebar
        currentLocale={locale}
        projectId={projectId}
        routerPush={router.push}
        selectedStep={selectedStep}
        setSelectedStep={setSelectedStep}
        stepStatus={stepStatus}
        steps={STEPS}
        t={t}
        historyMode={historyMode}
      />

      {/* Right: Content area */}
      <div className="flex flex-1 flex-col overflow-y-auto bg-[--surface] p-6">
        {/* Upload area (only when no step started) */}
        {currentStep === 0 && !historyMode && (
          <ImportUploadArea
            dragOver={dragOver}
            file={file}
            handleFile={handleFile}
            inputRef={inputRef}
            setDragOver={setDragOver}
            setFile={setFile}
            startPipeline={startPipeline}
            t={t}
          />
        )}

        {/* Characters review (after step 2) */}
        {showCharReview && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-[--text-primary]">
                {t("reviewCharacters")}
              </h3>
              <Button onClick={() => runSplit()} className="rounded-xl">
                {t("confirmAndSplit")}
              </Button>
            </div>
            <p className="text-sm text-[--text-muted]">{t("reviewCharactersHint")}</p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              {characters.map((char, idx) => (
                <div
                  key={idx}
                  className="group relative overflow-hidden rounded-[14px] border border-[--border-subtle] bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 hover:border-[--border-hover]"
                >
                  {/* Top accent strip */}
                  <div className={`h-1 w-full ${char.scope === "main" ? "bg-gradient-to-r from-blue-500 to-blue-400" : "bg-gradient-to-r from-purple-500 to-purple-400"}`} />
                  <div className="p-3.5">
                    {/* Avatar + Name */}
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
                    {/* Visual hint tag */}
                    {char.visualHint && (
                      <div className="mb-2 inline-block rounded-md bg-[--surface] px-2 py-0.5 text-[10px] font-medium text-[--text-muted]">
                        {char.visualHint}
                      </div>
                    )}
                    {/* Description */}
                    <p className="line-clamp-2 text-[11px] leading-relaxed text-[--text-muted]">{char.description}</p>
                  </div>
                  {/* Scope badge (floating, clickable) */}
                  <button
                    onClick={() => toggleScope(idx)}
                    className={`absolute right-3 top-3 rounded-[8px] px-2 py-0.5 text-[9px] font-bold tracking-wide transition-colors ${
                      char.scope === "main"
                        ? "bg-blue-50 text-blue-600 hover:bg-blue-100"
                        : "bg-purple-50 text-purple-600 hover:bg-purple-100"
                    }`}
                  >
                    {char.scope === "main" ? t("main") : t("guest")}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Episodes review (after step 3) */}
        {showEpReview && (
          <ImportEpisodeReview
            characters={characters}
            episodes={episodes}
            runGenerate={runGenerate}
            removeEpisode={removeEpisode}
            t={t}
            updateEpisode={updateEpisode}
          />
        )}

        {/* Logs panel */}
        <ImportHistoryReview
          currentStep={currentStep}
          historyMode={historyMode}
          logs={logs}
          logsEndRef={logsEndRef}
          propCandidates={propCandidates}
          retryStep={retryStep}
          sceneCandidates={sceneCandidates}
          selectedStep={selectedStep}
          setCurrentStep={setCurrentStep}
          setHistoryMode={setHistoryMode}
          setSelectedStep={setSelectedStep}
          setStepStatus={setStepStatus}
          showCharReview={showCharReview}
          showEpReview={showEpReview}
          stepStatus={stepStatus}
          t={t}
        />
      </div>
    </div>
  );
}
