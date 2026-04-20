"use client";

import type { StoryboardVersion } from "@/stores/project-store";

export type StoryboardBatchProgress = {
  total: number;
  completed: number;
  inProgress?: number;
  failed: string[];
} | null;

export type StoryboardControlPanelProps = {
  anyGenerating: boolean;
  batchProgress: StoryboardBatchProgress;
  compareMode: boolean;
  directorControl: {
    actionIntensity: number;
    cameraMotion: number;
    emotionIntensity: number;
  };
  generationMode: "storyboard_grid" | "reference";
  generating: boolean;
  generatingFrames: boolean;
  generatingFramesOverwrite: boolean;
  generatingRefPrompts: boolean;
  generatingSceneFrames: boolean;
  generatingStoryboardPrompts: boolean;
  generatingVideoPrompts: boolean;
  generatingVideos: boolean;
  generatingVideosOverwrite: boolean;
  handleApplyAllPreflightFixes: () => void;
  handleApplyPreflightFix: (item: any) => void;
  handleAutoRun: () => void;
  handleBatchGenerateFrames: (overwrite?: boolean) => void;
  handleBatchGenerateReferenceVideos: (overwrite?: boolean) => void;
  handleBatchGenerateSceneFrames: (overwrite?: boolean) => void;
  handleBatchGenerateVideoPrompts: () => void;
  handleBatchGenerateVideos: (overwrite?: boolean) => void;
  handleGenerateRefPrompts: () => void;
  handleGenerateShots: () => void;
  handleGenerateStoryboardPrompts: () => void;
  handlePreviewReplanLongShots: () => void;
  handleReplanLongShots: () => void;
  handleRetryFailed: () => void;
  handleRunVideoPreflight: () => void;
  hasReferenceImages: boolean;
  lastFailedShots: string[];
  locale: string;
  onDownloadAll: () => void;
  onRefreshStoryboardView: () => Promise<void>;
  onSelectVersion: (versionId: string) => void;
  onSetCompareMode: (value: boolean) => void;
  onToggleVersionDropdown: (value: boolean | ((prev: boolean) => boolean)) => void;
  onUpdateDirectorControl: (
    key: "actionIntensity" | "cameraMotion" | "emotionIntensity",
    value: number
  ) => void;
  preflightDisplayItems: Array<{
    shotId: string;
    sequence: number;
    result?: any;
    runState: string;
    errorMessage?: string;
  }>;
  preflightDisplayMap: Map<string, { sequence: number; result?: any }>;
  preflightFixDiffs: Record<string, any>;
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
  previewHref: string;
  previewingReplanLongShots: boolean;
  project: {
    id: string;
    characters: any[];
  };
  replanningLongShots: boolean;
  runningVideoPreflight: boolean;
  sceneFramesOverwrite: boolean;
  selectedVersionId: string | null;
  shotsWithRefPrompts: number;
  shotsWithStoryboardPrompts: number;
  switchView: (mode: "list" | "kanban") => void;
  t: (key: string, values?: Record<string, string | number>) => string;
  totalShots: number;
  tr: (key: string, fallback: string, values?: Record<string, string | number>) => string;
  versionDropdownOpen: boolean;
  versionDropdownRef: React.RefObject<HTMLDivElement | null>;
  versions: StoryboardVersion[];
  viewMode: "list" | "kanban";
  workflowSummary: {
    framesReady: number;
    videoPromptsReady: number;
    videosReady: number;
    stale: number;
    preflightPassed: number;
    preflightFailed: number;
    needsFrames: number;
    needsVideoPrompts: number;
    needsVideos: number;
  };
  fixingAllPreflight: boolean;
  fixingPreflightShotId: string | null;
  videoRatio: string;
  setVideoRatio: (value: string) => void;
};
