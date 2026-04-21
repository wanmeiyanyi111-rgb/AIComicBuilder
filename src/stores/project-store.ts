import { create } from "zustand";
import { ApiError, apiFetch } from "@/lib/api-fetch";

interface Character {
  id: string;
  name: string;
  description: string;
  referenceImage: string | null;
  referenceImageHistory?: string | null;
  visualHint?: string | null;
  scope?: string;
  episodeId?: string | null;
}

interface Dialogue {
  id: string;
  text: string;
  characterId: string;
  characterName: string;
  sequence: number;
}

/**
 * One row from the unified `shot_assets` table, exposed to the frontend.
 * type discriminates the role:
 *   - 'storyboard_panel'            → four-panel storyboard image assets
 *   - 'storyboard_grid'             → stitched 2x2 storyboard board
 *   - 'storyboard_video'            → four-panel video output
 *   - 'reference'                   → reference-mode image assets (multi)
 *   - 'reference_video'             → reference-mode video output
 *   - legacy keyframe asset types are kept for compatibility reads only
 */
export type ShotAssetType =
  | "storyboard_panel"
  | "storyboard_grid"
  | "storyboard_video"
  | "first_frame"
  | "last_frame"
  | "reference"
  | "keyframe_video"
  | "reference_video";

export interface ShotAsset {
  id: string;
  shotId: string;
  type: ShotAssetType;
  sequenceInType: number;
  assetVersion: number;
  isActive: number;
  prompt: string;
  fileUrl: string | null;
  status: "pending" | "generating" | "completed" | "failed";
  characters: string[] | null;
  modelProvider?: string | null;
  modelId?: string | null;
  meta?:
    | ({
        sceneName?: string;
        continuityAuditScore?: number;
        continuityAuditPass?: boolean;
        continuityAuditIssues?: string[];
        continuityAuditAttempts?: number;
        stage?: string;
        beat?: string;
        panelIndex?: number;
      } & Record<string, unknown>)
    | null;
}

export interface StoryboardPromptAuditSnapshot {
  score: number | null;
  pass: boolean | null;
  issues: string[];
  attempts: number;
}

export interface StoryboardImageAuditSnapshot {
  score: number | null;
  pass: boolean | null;
  stage: string | null;
  summary: string | null;
  issues: string[];
}

export interface StoryboardWorkflowState {
  mode: "storyboard_grid" | "reference" | "keyframe";
  promptReady: boolean;
  frameReady: boolean;
  videoPromptReady: boolean;
  videoReady: boolean;
  preflightStatus: "idle" | "pass" | "fail";
  lastPreflightScore: number | null;
  lastPreflightSummary: string;
  lastPreflightStage: "image_prompt" | "video_prompt" | "full" | "";
  lastPreflightAt: string;
  lastPreflightIssues: string[];
  stale: boolean;
  running: boolean;
  updatedAt: string;
}

export interface StoryboardResolvedResourceSnapshot {
  matchedCharacterIds: string[];
  matchedCharacterNames: string[];
  matchedSceneAssetIds: string[];
  matchedPropAssetIds: string[];
  referenceImages: Array<{
    kind: "character" | "scene" | "prop" | "panel";
    label: string;
    imageUrl: string;
  }>;
  resourceSummary: string;
  resourceConfidence: "none" | "low" | "medium" | "high";
  updatedAt: string;
}

export interface Shot {
  id: string;
  sequence: number;
  prompt: string;
  videoScript: string | null;
  motionScript: string | null;
  cameraDirection: string;
  duration: number;
  sceneId?: string;
  transitionIn?: string;
  transitionOut?: string;
  videoPrompt: string | null;
  compositionGuide?: string;
  focalPoint?: string;
  depthOfField?: string;
  soundDesign?: string;
  musicCue?: string;
  qualityScore?: number;
  qualityIssues?: string[];
  isStale?: boolean;
  workflowState?: StoryboardWorkflowState;
  resolvedResourceSnapshot?: StoryboardResolvedResourceSnapshot;
  chainGroupId?: string | null;
  chainIndex?: number;
  chainTotal?: number;
  prevShotId?: string | null;
  inheritPrevLastFrame?: number;
  originalDuration?: number;
  status: string;
  dialogues: Dialogue[];
  /** Active shot_assets rows for this shot, all types mixed. */
  assets: ShotAsset[];
}

export type GenerationMode = "storyboard_grid" | "reference" | "keyframe";

// ─── Asset access helpers (use these in UI instead of legacy fields) ─────
// All helpers are null-safe — accept any object that may or may not have an
// `assets` field, falling back to empty array. Necessary because in-flight
// optimistic updates and partial fetches may produce shot objects without
// the assets field populated.

type ShotLike = { assets?: ShotAsset[] | null };

function safeAssets(shot: ShotLike): ShotAsset[] {
  return Array.isArray(shot?.assets) ? shot.assets : [];
}

/** Active assets only — `isActive === 1`. Use this for "current" reads. */
function activeAssets(shot: ShotLike): ShotAsset[] {
  return safeAssets(shot).filter((a) => a.isActive === 1);
}

/**
 * All version history rows for one slot (shot, type, sequenceInType),
 * sorted newest first by assetVersion. Use this to render history arrows.
 */
export function getAssetHistoryForSlot(
  shot: ShotLike,
  type: ShotAssetType,
  sequenceInType = 0
): ShotAsset[] {
  return safeAssets(shot)
    .filter((a) => a.type === type && a.sequenceInType === sequenceInType)
    .sort((a, b) => b.assetVersion - a.assetVersion);
}

/** Get the active first_frame image URL for a shot, or null. */
export function getFirstFrameUrl(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "first_frame" && a.sequenceInType === 0
    )?.fileUrl ?? null
  );
}

/** Active storyboard panels ordered left-to-right, top-to-bottom. */
export function getStoryboardPanels(shot: ShotLike): ShotAsset[] {
  return activeAssets(shot)
    .filter((a) => a.type === "storyboard_panel")
    .sort((a, b) => a.sequenceInType - b.sequenceInType);
}

/** Stitched 2x2 storyboard grid preview URL. */
export function getStoryboardGridUrl(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "storyboard_grid" && a.sequenceInType === 0
    )?.fileUrl ?? null
  );
}

/** Four-panel-mode video URL. */
export function getStoryboardVideoUrl(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "storyboard_video" && a.sequenceInType === 0
    )?.fileUrl ?? null
  );
}

/** Prompt text for each storyboard panel. */
export function getStoryboardPanelPrompts(shot: ShotLike): string[] {
  return getStoryboardPanels(shot).map((asset) => asset.prompt || "");
}

export function getStoryboardPromptAudit(
  shot: ShotLike
): StoryboardPromptAuditSnapshot {
  const panels = getStoryboardPanels(shot).slice(0, 4);
  const metas = panels.map((panel) => panel.meta).filter(Boolean);
  const score = metas.find((meta) => typeof meta?.continuityAuditScore === "number")
    ?.continuityAuditScore;
  const pass = metas.find((meta) => typeof meta?.continuityAuditPass === "boolean")
    ?.continuityAuditPass;
  const attempts = metas.reduce((max, meta) => {
    const value =
      typeof meta?.continuityAuditAttempts === "number"
        ? meta.continuityAuditAttempts
        : 0;
    return Math.max(max, value);
  }, 0);
  const issues = [
    ...new Set(
      metas.flatMap((meta) =>
        Array.isArray(meta?.continuityAuditIssues)
          ? meta.continuityAuditIssues
              .map((item) => String(item || "").trim())
              .filter(Boolean)
          : []
      )
    ),
  ];
  return {
    score: typeof score === "number" ? score : null,
    pass: typeof pass === "boolean" ? pass : null,
    issues,
    attempts,
  };
}

export function getStoryboardImageAudit(
  shot: ShotLike
): StoryboardImageAuditSnapshot {
  const grid = activeAssets(shot).find(
    (asset) => asset.type === "storyboard_grid" && asset.sequenceInType === 0
  );
  const meta = grid?.meta;
  const issues = Array.isArray(meta?.continuityImageAuditIssues)
    ? meta.continuityImageAuditIssues
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    : [];
  return {
    score:
      typeof meta?.continuityImageAuditScore === "number"
        ? meta.continuityImageAuditScore
        : null,
    pass:
      typeof meta?.continuityImageAuditPass === "boolean"
        ? meta.continuityImageAuditPass
        : null,
    stage:
      typeof meta?.continuityImageAuditStage === "string"
        ? meta.continuityImageAuditStage
        : null,
    summary:
      typeof meta?.continuityImageAuditSummary === "string"
        ? meta.continuityImageAuditSummary
        : null,
    issues,
  };
}

/** Whether all four storyboard panels have files generated. */
export function hasStoryboardGridPanels(shot: ShotLike): boolean {
  const panels = getStoryboardPanels(shot);
  return panels.length >= 4 && panels.slice(0, 4).every((panel) => !!panel.fileUrl);
}

/** Get the active last_frame image URL for a shot, or null. */
export function getLastFrameUrl(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "last_frame" && a.sequenceInType === 0
    )?.fileUrl ?? null
  );
}

/** Get the keyframe-mode video URL, or null. */
export function getKeyframeVideoUrl(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "keyframe_video" && a.sequenceInType === 0
    )?.fileUrl ?? null
  );
}

/** Get the reference-mode video URL, or null. */
export function getReferenceVideoUrl(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "reference_video" && a.sequenceInType === 0
    )?.fileUrl ?? null
  );
}

/** Get all active reference image assets ordered by sequence_in_type. */
export function getReferenceAssets(shot: ShotLike): ShotAsset[] {
  return activeAssets(shot)
    .filter((a) => a.type === "reference")
    .sort((a, b) => a.sequenceInType - b.sequenceInType);
}

/** First reference image URL (used as the "scene reference frame"). */
export function getSceneRefFrameUrl(shot: ShotLike): string | null {
  return getReferenceAssets(shot)[0]?.fileUrl ?? null;
}

/** First-frame prompt text (the LLM-generated description). */
export function getFirstFramePrompt(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "first_frame" && a.sequenceInType === 0
    )?.prompt ?? null
  );
}

/** Last-frame prompt text. */
export function getLastFramePrompt(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "last_frame" && a.sequenceInType === 0
    )?.prompt ?? null
  );
}

/** Whether all reference images for a shot have been generated (have file_url). */
export function hasAllReferenceImages(shot: ShotLike): boolean {
  const refs = getReferenceAssets(shot);
  return refs.length > 0 && refs.every((r) => !!r.fileUrl);
}

/** Whether the shot has both first and last frame image URLs. */
export function hasKeyframePair(shot: ShotLike): boolean {
  return !!getFirstFrameUrl(shot) && !!getLastFrameUrl(shot);
}

export type StoryboardVersion = {
  id: string;
  label: string;
  versionNum: number;
  createdAt: number;
};

interface Project {
  id: string;
  styleId?: string;
  title: string;
  idea: string;
  script: string;
  outline?: string;
  worldSetting?: string;
  colorPalette?: string;
  targetDuration?: number;
  splitMeta?: {
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
  } | null;
  status: string;
  finalVideoUrl: string | null;
  generationMode: GenerationMode;
  characters: Character[];
  shots: Shot[];
  versions: StoryboardVersion[];
}

interface ProjectStore {
  project: Project | null;
  loading: boolean;
  fetchError: string | null;
  currentEpisodeId: string | null;
  fetchProject: (id: string, episodeId?: string, versionId?: string) => Promise<void>;
  updateIdea: (idea: string) => void;
  updateScript: (script: string) => void;
  setProject: (project: Project) => void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  loading: false,
  fetchError: null,
  currentEpisodeId: null,

  fetchProject: async (id: string, episodeId?: string, versionId?: string) => {
    // Only show loading spinner on initial load (no project yet).
    // Version switches are background refreshes — don't unmount children.
    if (!get().project) set({ loading: true });

    let url: string;
    if (episodeId) {
      url = `/api/projects/${id}/episodes/${episodeId}${versionId ? `?versionId=${versionId}` : ""}`;
    } else {
      url = `/api/projects/${id}${versionId ? `?versionId=${versionId}` : ""}`;
    }

    try {
      const res = await apiFetch(url);
      const data = await res.json();
      set({
        project: data,
        loading: false,
        fetchError: null,
        currentEpisodeId: episodeId ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ApiError && err.status === 404) {
        // Keep the app interactive instead of crashing the whole route.
        set({
          project: null,
          loading: false,
          fetchError: "not_found",
          currentEpisodeId: null,
        });
        return;
      }
      set({ loading: false, fetchError: message });
      throw err;
    }
  },

  updateIdea: (idea: string) => {
    set((state) => ({
      project: state.project ? { ...state.project, idea } : null,
    }));
  },

  updateScript: (script: string) => {
    set((state) => ({
      project: state.project ? { ...state.project, script } : null,
    }));
  },

  setProject: (project: Project) => {
    set({ project, fetchError: null });
  },
}));
