import { getUserId } from "@/lib/fingerprint";

export const ACCEPTED = ".txt,.docx,.pdf,.md,.markdown";
export const MAX_SIZE = 20 * 1024 * 1024;

export interface ExtractedCharacter {
  name: string;
  frequency: number;
  description: string;
  visualHint?: string;
  scope: "main" | "guest";
}

export interface SplitEpisode {
  title: string;
  description: string;
  keywords: string;
  idea: string;
  storyMode?: string;
  targetDurationSec?: number;
  durationMinSec?: number;
  durationMaxSec?: number;
  estimatedDurationSec?: number;
  hook?: string;
  coreConflict?: string;
  turningPoint?: string;
  cliffhanger?: string;
  pacingNotes?: string;
  beats?: Array<{ name: string; durationSec: number; summary: string }>;
  validationIssues?: string[];
  scriptEstimatedDurationSec?: number;
  scriptDurationStatus?: "short" | "ok" | "long";
  scriptDurationNotes?: string[];
  characters?: string[];
  scenes?: string[];
  props?: string[];
}

export interface ScenePropCandidate {
  name: string;
  prompt: string;
}

export interface LogEntry {
  id: string;
  step: number;
  status: "running" | "done" | "error";
  message: string;
  metadata?: unknown;
  createdAt: string | number;
}

export type Step = 1 | 2 | 3 | 4 | 5;

export const STEPS = [
  { num: 1 as Step, label: "importStep.parse" },
  { num: 2 as Step, label: "importStep.characters" },
  { num: 3 as Step, label: "importStep.sceneProps" },
  { num: 4 as Step, label: "importStep.split" },
  { num: 5 as Step, label: "importStep.generate" },
] as const;

export const EMPTY_STEP_STATUS: Record<Step, "idle" | "running" | "done" | "error"> = {
  1: "idle",
  2: "idle",
  3: "idle",
  4: "idle",
  5: "idle",
};

export async function fetchImportLogs(projectId: string): Promise<LogEntry[] | null> {
  const headers = new Headers();
  const userId = getUserId();
  if (userId) {
    headers.set("x-user-id", userId);
  }

  const response = await fetch(`/api/projects/${projectId}/import/logs`, {
    headers,
    credentials: "same-origin",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as LogEntry[];
}
