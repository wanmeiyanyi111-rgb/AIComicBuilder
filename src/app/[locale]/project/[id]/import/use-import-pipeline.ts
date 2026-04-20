"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-fetch";
import type {
  ExtractedCharacter,
  LogEntry,
  ScenePropCandidate,
  SplitEpisode,
  Step,
} from "./import-types";
import { EMPTY_STEP_STATUS, fetchImportLogs, MAX_SIZE } from "./import-types";

type Params = {
  getModelConfig: () => unknown;
  projectId: string;
  routerPush: (href: string) => void;
  locale: string;
  t: (key: string) => string;
  textGuard: () => boolean;
};

export function useImportPipeline({
  getModelConfig,
  projectId,
  routerPush,
  locale,
  t,
  textGuard,
}: Params) {
  const [currentStep, setCurrentStep] = useState<Step | 0>(0);
  const [stepStatus, setStepStatus] = useState<Record<Step, "idle" | "running" | "done" | "error">>({
    ...EMPTY_STEP_STATUS,
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [fullText, setFullText] = useState("");
  const [characters, setCharacters] = useState<ExtractedCharacter[]>([]);
  const [relationships, setRelationships] = useState<Array<{ characterA: string; characterB: string; relationType: string; description?: string }>>([]);
  const [sceneCandidates, setSceneCandidates] = useState<ScenePropCandidate[]>([]);
  const [propCandidates, setPropCandidates] = useState<ScenePropCandidate[]>([]);
  const [episodes, setEpisodes] = useState<SplitEpisode[]>([]);
  const [historyMode, setHistoryMode] = useState(false);
  const [selectedStep, setSelectedStep] = useState<Step | null>(null);

  const applyLogState = useCallback((data: LogEntry[]) => {
    setLogs(data);
    const nextStatus: Record<Step, "idle" | "running" | "done" | "error"> = { ...EMPTY_STEP_STATUS };
    for (const step of [1, 2, 3, 4, 5] as Step[]) {
      const stepLogs = data.filter((log) => log.step === step);
      if (stepLogs.some((log) => log.status === "error")) nextStatus[step] = "error";
      else if (stepLogs.some((log) => log.status === "done")) nextStatus[step] = "done";
      else if (stepLogs.some((log) => log.status === "running")) nextStatus[step] = "running";
    }
    setStepStatus(nextStatus);
    const maxLoggedStep = Math.max(0, ...data.map((log) => (typeof log.step === "number" ? log.step : 0))) as Step | 0;
    setCurrentStep(maxLoggedStep);
  }, []);

  useEffect(() => {
    async function loadLogs() {
      try {
        const data = await fetchImportLogs(projectId);
        if (data && data.length > 0) {
          applyLogState(data);
          setHistoryMode(true);
        }
      } catch {}
    }
    void loadLogs();
  }, [applyLogState, projectId]);

  useEffect(() => {
    const hasRunningStep = Object.values(stepStatus).some((status) => status === "running");
    if (!hasRunningStep) return;
    const timer = window.setInterval(async () => {
      try {
        const data = await fetchImportLogs(projectId);
        if (data === null) {
          window.clearInterval(timer);
          return;
        }
        if (Array.isArray(data) && data.length > 0) applyLogState(data);
      } catch {}
    }, 3000);
    return () => window.clearInterval(timer);
  }, [applyLogState, projectId, stepStatus]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = useCallback((step: Step, status: LogEntry["status"], message: string, metadata?: unknown) => {
    const randomId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setLogs((prev) => [...prev, { id: randomId, step, status, message, metadata, createdAt: Date.now() }]);
  }, []);

  const handleFile = useCallback((f: File) => {
    if (f.size > MAX_SIZE) {
      toast.error(t("fileTooLarge"));
      return;
    }
    setFile(f);
  }, [t]);

  const runSplit = useCallback(async (
    textInput = fullText,
    characterInput = characters,
    sceneInput = sceneCandidates,
    propInput = propCandidates
  ) => {
    if (!textGuard()) return;
    setCurrentStep(4);
    setStepStatus((prev) => ({ ...prev, 4: "running" }));
    addLog(4, "running", "开始自动分集...");
    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: textInput,
          allCharacters: characterInput.map((c) => ({ name: c.name, scope: c.scope })),
          sceneCandidates: sceneInput.map((s) => ({ name: s.name })),
          propCandidates: propInput.map((p) => ({ name: p.name })),
          modelConfig: getModelConfig(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setEpisodes(data.episodes);
      addLog(4, "done", `分集完成，共 ${data.episodes.length} 集`, { episodes: data.episodes });
      setStepStatus((prev) => ({ ...prev, 4: "done" }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Split failed";
      addLog(4, "error", `分集失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 4: "error" }));
    }
  }, [addLog, characters, fullText, getModelConfig, projectId, propCandidates, sceneCandidates, textGuard]);

  const runScenePropExtract = useCallback(async (sourceText: string) => {
    if (!textGuard()) return null;
    setCurrentStep(3);
    setStepStatus((prev) => ({ ...prev, 3: "running" }));
    addLog(3, "running", "开始提取场景和道具候选...");
    try {
      const res = await apiFetch(`/api/projects/${projectId}/visual-assets/extract-candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelConfig: getModelConfig(),
          maxScenes: 12,
          maxProps: 20,
          refreshExisting: true,
          text: sourceText,
          importMode: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const scenes = (data.scenes || []) as ScenePropCandidate[];
      const props = (data.props || []) as ScenePropCandidate[];
      setSceneCandidates(scenes);
      setPropCandidates(props);
      addLog(3, "done", `提取完成: ${scenes.length} 个场景候选, ${props.length} 个道具候选`, { scenes, props });
      setStepStatus((prev) => ({ ...prev, 3: "done" }));
      return { scenes, props };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Scene/prop extract failed";
      addLog(3, "error", `场景/道具提取失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 3: "error" }));
      return null;
    }
  }, [addLog, getModelConfig, projectId, textGuard]);

  const retryCharacterExtract = useCallback(async () => {
    if (!fullText || !textGuard()) return;
    setStepStatus((prev) => ({ ...prev, 2: "running" }));
    addLog(2, "running", "重试角色提取...");
    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fullText, modelConfig: getModelConfig() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setCharacters(data.characters);
      setRelationships(data.relationships || []);
      const extractedCharacters = (data.characters || []) as ExtractedCharacter[];
      const mainCount = data.characters.filter((c: ExtractedCharacter) => c.scope === "main").length;
      const guestCount = data.characters.length - mainCount;
      addLog(2, "done", `提取完成: ${mainCount} 个主角, ${guestCount} 个配角`, {
        characters: data.characters,
        relationships: data.relationships || [],
      });
      setStepStatus((prev) => ({ ...prev, 2: "done" }));
      const assets = await runScenePropExtract(fullText);
      if (!assets) return;
      await runSplit(fullText, extractedCharacters, assets.scenes, assets.props);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Extract failed";
      addLog(2, "error", `角色提取失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 2: "error" }));
    }
  }, [addLog, fullText, getModelConfig, projectId, runScenePropExtract, runSplit, textGuard]);

  const startPipeline = useCallback(async () => {
    if (!file || !textGuard()) return;
    setHistoryMode(false);
    setLogs([]);
    await apiFetch(`/api/projects/${projectId}/import/logs`, { method: "DELETE" });
    setCurrentStep(1);
    setStepStatus((prev) => ({ ...prev, 1: "running" }));
    addLog(1, "running", `解析文件: ${file.name}`);
    let text: string;
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch(`/api/projects/${projectId}/import/parse`, { method: "POST", body: form });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      text = data.text;
      setFullText(text);
      addLog(1, "done", `解析完成，共 ${data.charCount} 字`);
      setStepStatus((prev) => ({ ...prev, 1: "done" }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Parse failed";
      addLog(1, "error", `文件解析失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 1: "error" }));
      return;
    }
    setCurrentStep(2);
    setStepStatus((prev) => ({ ...prev, 2: "running" }));
    addLog(2, "running", "开始角色提取...");
    let extractedCharacters: ExtractedCharacter[] = [];
    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, modelConfig: getModelConfig() }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setCharacters(data.characters);
      setRelationships(data.relationships || []);
      extractedCharacters = data.characters || [];
      const mainCount = data.characters.filter((c: ExtractedCharacter) => c.scope === "main").length;
      const guestCount = data.characters.length - mainCount;
      addLog(2, "done", `提取完成: ${mainCount} 个主角, ${guestCount} 个配角`, { characters: data.characters, relationships: data.relationships || [] });
      setStepStatus((prev) => ({ ...prev, 2: "done" }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Extract failed";
      addLog(2, "error", `角色提取失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 2: "error" }));
      return;
    }
    const assets = await runScenePropExtract(text);
    if (!assets) return;
    await runSplit(text, extractedCharacters, assets.scenes, assets.props);
  }, [addLog, file, getModelConfig, projectId, runScenePropExtract, runSplit, textGuard]);

  const runGenerate = useCallback(async () => {
    setCurrentStep(5);
    setStepStatus((prev) => ({ ...prev, 5: "running" }));
    addLog(5, "running", `创建 ${episodes.length} 集、角色与每集资产...`);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodes,
          characters,
          relationships,
          sceneCandidates,
          propCandidates,
          modelConfig: getModelConfig(),
          autoGenerateScripts: false,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const durationSummary = data.scriptDurationSummary as { short?: number; ok?: number; long?: number } | undefined;
      const durationSummaryText = durationSummary
        ? `，剧本复核 ${durationSummary.ok || 0} 集达标 / ${durationSummary.short || 0} 集偏短 / ${durationSummary.long || 0} 集偏长`
        : "";
      addLog(5, "done", `导入完成！创建了 ${data.characterCount} 个角色和 ${data.episodes.length} 集（${data.visualAssetCount || 0} 个场景/道具，${data.generatedScriptCount || 0} 集剧本${durationSummaryText}）`);
      setStepStatus((prev) => ({ ...prev, 5: "done" }));
      toast.success(t("complete"));
      setTimeout(() => {
        routerPush(`/${locale}/project/${projectId}/episodes`);
      }, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generate failed";
      addLog(5, "error", `创建失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 5: "error" }));
    }
  }, [addLog, characters, episodes, getModelConfig, locale, projectId, propCandidates, relationships, routerPush, sceneCandidates, t]);

  const retryStep = useCallback(() => {
    const failedStep = ([1, 2, 3, 4, 5] as Step[]).find((s) => stepStatus[s] === "error");
    if (!failedStep) return;
    switch (failedStep) {
      case 1:
        void startPipeline();
        break;
      case 2:
        void retryCharacterExtract();
        break;
      case 3:
        if (fullText) {
          void runScenePropExtract(fullText).then((assets) => {
            if (!assets) return;
            void runSplit(fullText, characters, assets.scenes, assets.props);
          });
        }
        break;
      case 4:
        void runSplit();
        break;
      case 5:
        void runGenerate();
        break;
    }
  }, [characters, fullText, retryCharacterExtract, runGenerate, runScenePropExtract, runSplit, startPipeline, stepStatus]);

  function toggleScope(idx: number) {
    setCharacters((prev) => prev.map((c, i) => (i === idx ? { ...c, scope: c.scope === "main" ? "guest" : "main" } : c)));
  }
  function updateEpisode(idx: number, field: keyof SplitEpisode, value: string) {
    setEpisodes((prev) => prev.map((ep, i) => (i === idx ? { ...ep, [field]: value } : ep)));
  }
  function removeEpisode(idx: number) {
    setEpisodes((prev) => prev.filter((_, i) => i !== idx));
  }

  return {
    addLog,
    characters,
    currentStep,
    dragOver,
    episodes,
    file,
    fullText,
    handleFile,
    historyMode,
    inputRef,
    logs,
    logsEndRef,
    propCandidates,
    relationships,
    retryCharacterExtract,
    retryStep,
    runGenerate,
    runScenePropExtract,
    runSplit,
    sceneCandidates,
    selectedStep,
    setCurrentStep,
    setDragOver,
    setEpisodes,
    setFile,
    setHistoryMode,
    setSelectedStep,
    setStepStatus,
    startPipeline,
    stepStatus,
    toggleScope,
    updateEpisode,
    removeEpisode,
  };
}
