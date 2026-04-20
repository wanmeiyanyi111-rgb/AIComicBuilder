import type { Dispatch, SetStateAction } from "react";
import type { Shot } from "@/stores/project-store";

export type StoryboardGenerationMode = "storyboard_grid" | "reference";

export type BatchProgress = {
  total: number;
  completed: number;
  inProgress?: number;
  failed: string[];
  targetShotIds?: string[];
  action?: string;
} | null;

export type StoryboardProject = {
  id: string;
  shots: Shot[];
} | null;

export type BatchProgressSetter = Dispatch<SetStateAction<BatchProgress>>;
export type BooleanSetter = Dispatch<SetStateAction<boolean>>;
export type StringArraySetter = Dispatch<SetStateAction<string[]>>;

export type UseStoryboardGenerationParams = {
  directorControl: {
    actionIntensity: number;
    cameraMotion: number;
    emotionIntensity: number;
  };
  ensureStoryboardPromptTargetsPassedPrecheck: (
    shots: Shot[],
    options?: { autoFixBlocked?: boolean }
  ) => Promise<Shot[] | null>;
  ensureVideoTargetsPassedPreflight: (
    shots: Shot[],
    mode: StoryboardGenerationMode,
    options?: { autoFixBlocked?: boolean }
  ) => Promise<Shot[] | null>;
  executePreflightFix: (
    item: any,
    options?: { silent?: boolean; postCheckStage?: any }
  ) => Promise<boolean>;
  fetchProject: (projectId: string, episodeId?: string, versionId?: string) => Promise<unknown>;
  generationMode: StoryboardGenerationMode;
  getBatchFailureDetail: (results: Array<{ status: string; error?: string }>) => string | null;
  getModelConfig: () => unknown;
  hasReferenceFrameForShot: (shot: Shot) => boolean;
  hasReferenceVideoForShot: (shot: Shot) => boolean;
  hasStoryboardFrameForShot: (shot: Shot) => boolean;
  hasStoryboardVideoForShot: (shot: Shot) => boolean;
  hasVideoPromptForShot: (shot: Shot) => boolean;
  imageGuard: () => boolean;
  project: StoryboardProject;
  refreshCurrentStoryboardView: () => Promise<void>;
  runVideoPreflightRequest: (shotIds?: string[]) => Promise<any>;
  mergeSinglePreflightResult: (next: any) => void;
  selectedVersionId: string | null;
  setSelectedVersionId: (value: string | null) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
  textGuard: () => boolean;
  videoGuard: () => boolean;
  videoRatio: string;
};
