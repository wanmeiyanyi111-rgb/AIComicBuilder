import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { episodes, projects, shotAssets, shots } from "@/lib/db/schema";
import { normalizeRuntimeGenerationMode } from "@/lib/generation-mode";

export type StoryboardWorkflowMode =
  | "storyboard_grid"
  | "reference"
  | "keyframe";
export type StoryboardPreflightStatus = "idle" | "pass" | "fail";
export type StoryboardResourceConfidence =
  | "none"
  | "low"
  | "medium"
  | "high";

export interface StoryboardWorkflowState {
  mode: StoryboardWorkflowMode;
  promptReady: boolean;
  frameReady: boolean;
  videoPromptReady: boolean;
  videoReady: boolean;
  preflightStatus: StoryboardPreflightStatus;
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
  resourceConfidence: StoryboardResourceConfidence;
  updatedAt: string;
}

type AssetLike = {
  type: string;
  fileUrl: string | null;
  status: string;
};

type ShotWorkflowSource = {
  workflowState: string | null;
  resolvedResourceSnapshot: string | null;
  status: string | null;
  prompt: string | null;
  videoPrompt: string | null;
  isStale: number | null;
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeText(item)).filter(Boolean);
}

function normalizeIso(value: Date | string | number | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return "";
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export function parseStoryboardWorkflowState(
  value: string | null | undefined
): StoryboardWorkflowState {
  const record = parseJsonRecord(value);
  return {
    mode:
      record.mode === "reference" || record.mode === "keyframe"
        ? record.mode
        : "storyboard_grid",
    promptReady: record.promptReady === true,
    frameReady: record.frameReady === true,
    videoPromptReady: record.videoPromptReady === true,
    videoReady: record.videoReady === true,
    preflightStatus:
      record.preflightStatus === "pass" || record.preflightStatus === "fail"
        ? record.preflightStatus
        : "idle",
    lastPreflightScore:
      typeof record.lastPreflightScore === "number" &&
      Number.isFinite(record.lastPreflightScore)
        ? Math.round(record.lastPreflightScore)
        : null,
    lastPreflightSummary: normalizeText(record.lastPreflightSummary),
    lastPreflightStage:
      record.lastPreflightStage === "image_prompt" ||
      record.lastPreflightStage === "video_prompt" ||
      record.lastPreflightStage === "full"
        ? record.lastPreflightStage
        : "",
    lastPreflightAt: normalizeText(record.lastPreflightAt),
    lastPreflightIssues: normalizeStringArray(record.lastPreflightIssues),
    stale: record.stale === true,
    running: record.running === true,
    updatedAt: normalizeText(record.updatedAt),
  };
}

export function parseStoryboardResolvedResourceSnapshot(
  value: string | null | undefined
): StoryboardResolvedResourceSnapshot {
  const record = parseJsonRecord(value);
  const referenceImages = Array.isArray(record.referenceImages)
    ? record.referenceImages
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const ref = item as Record<string, unknown>;
          const kind = normalizeText(ref.kind);
          const label = normalizeText(ref.label);
          const imageUrl = normalizeText(ref.imageUrl);
          if (!label || !imageUrl) return null;
          return {
            kind:
              kind === "character" ||
              kind === "scene" ||
              kind === "prop" ||
              kind === "panel"
                ? kind
                : "panel",
            label,
            imageUrl,
          };
        })
        .filter(
          (
            item
          ): item is StoryboardResolvedResourceSnapshot["referenceImages"][number] =>
            !!item
        )
    : [];
  return {
    matchedCharacterIds: normalizeStringArray(record.matchedCharacterIds),
    matchedCharacterNames: normalizeStringArray(record.matchedCharacterNames),
    matchedSceneAssetIds: normalizeStringArray(record.matchedSceneAssetIds),
    matchedPropAssetIds: normalizeStringArray(record.matchedPropAssetIds),
    referenceImages,
    resourceSummary: normalizeText(record.resourceSummary),
    resourceConfidence:
      record.resourceConfidence === "low" ||
      record.resourceConfidence === "medium" ||
      record.resourceConfidence === "high"
        ? record.resourceConfidence
        : "none",
    updatedAt: normalizeText(record.updatedAt),
  };
}

export function buildStoryboardResourceConfidence(input: {
  matchedCharacterCount: number;
  matchedSceneCount: number;
  matchedPropCount: number;
  referenceCount: number;
}): StoryboardResourceConfidence {
  const weightedScore =
    input.referenceCount +
    input.matchedCharacterCount +
    input.matchedSceneCount +
    Math.min(1, input.matchedPropCount);
  if (weightedScore >= 4) return "high";
  if (weightedScore >= 2) return "medium";
  if (weightedScore >= 1) return "low";
  return "none";
}

export function computeStoryboardWorkflowState(params: {
  shot: ShotWorkflowSource;
  assets: AssetLike[];
  mode: StoryboardWorkflowMode;
  current?: StoryboardWorkflowState | null;
}): StoryboardWorkflowState {
  const nowIso = new Date().toISOString();
  const current = params.current ?? parseStoryboardWorkflowState(null);
  const completedAssets = params.assets.filter(
    (asset) => asset.status === "completed" && !!asset.fileUrl
  );
  const countByType = (type: string) =>
    completedAssets.filter((asset) => asset.type === type).length;
  const hasType = (type: string) => countByType(type) > 0;
  const frameReady =
    params.mode === "reference"
      ? hasType("reference")
      : params.mode === "keyframe"
        ? hasType("first_frame") && hasType("last_frame")
        : countByType("storyboard_panel") >= 4 || hasType("storyboard_grid");
  const videoReady =
    params.mode === "reference"
      ? hasType("reference_video")
      : params.mode === "keyframe"
        ? hasType("keyframe_video")
        : hasType("storyboard_video");
  const stale = params.shot.isStale === 1;
  return {
    mode: params.mode,
    promptReady: !!normalizeText(params.shot.prompt),
    frameReady,
    videoPromptReady: !!normalizeText(params.shot.videoPrompt),
    videoReady,
    preflightStatus: stale ? "idle" : current.preflightStatus,
    lastPreflightScore: stale ? null : current.lastPreflightScore,
    lastPreflightSummary: stale ? "" : current.lastPreflightSummary,
    lastPreflightStage: stale ? "" : current.lastPreflightStage,
    lastPreflightAt: stale ? "" : current.lastPreflightAt,
    lastPreflightIssues: stale ? [] : current.lastPreflightIssues,
    stale,
    running: params.shot.status === "generating",
    updatedAt: nowIso || current.updatedAt,
  };
}

async function loadShotWorkflowContext(shotId: string) {
  const [row] = await db
    .select({
      id: shots.id,
      prompt: shots.prompt,
      videoPrompt: shots.videoPrompt,
      status: shots.status,
      isStale: shots.isStale,
      workflowState: shots.workflowState,
      resolvedResourceSnapshot: shots.resolvedResourceSnapshot,
      episodeGenerationMode: episodes.generationMode,
      projectGenerationMode: projects.generationMode,
    })
    .from(shots)
    .leftJoin(episodes, eq(shots.episodeId, episodes.id))
    .innerJoin(projects, eq(shots.projectId, projects.id))
    .where(eq(shots.id, shotId))
    .limit(1);
  if (!row) {
    throw new Error(`Shot ${shotId} not found`);
  }

  const assets = await db
    .select({
      type: shotAssets.type,
      fileUrl: shotAssets.fileUrl,
      status: shotAssets.status,
    })
    .from(shotAssets)
    .where(and(eq(shotAssets.shotId, shotId), eq(shotAssets.isActive, 1)));

  const runtimeMode = normalizeRuntimeGenerationMode(
    row.episodeGenerationMode || row.projectGenerationMode
  );
  const workflowMode: StoryboardWorkflowMode =
    runtimeMode === "reference" ? "reference" : "storyboard_grid";

  return { row, assets, workflowMode };
}

export async function refreshShotWorkflowState(
  shotId: string,
  options?: {
    workflowPatch?: Partial<StoryboardWorkflowState>;
    resourceSnapshot?: StoryboardResolvedResourceSnapshot;
  }
): Promise<{
  workflowState: StoryboardWorkflowState;
  resourceSnapshot: StoryboardResolvedResourceSnapshot;
}> {
  const { row, assets, workflowMode } = await loadShotWorkflowContext(shotId);
  const currentWorkflow = parseStoryboardWorkflowState(row.workflowState);
  const mergedWorkflow = {
    ...currentWorkflow,
    ...(options?.workflowPatch ?? {}),
  };
  const workflowState = computeStoryboardWorkflowState({
    shot: row,
    assets,
    mode: workflowMode,
    current: mergedWorkflow,
  });
  const resourceSnapshot =
    options?.resourceSnapshot ??
    parseStoryboardResolvedResourceSnapshot(row.resolvedResourceSnapshot);

  await db
    .update(shots)
    .set({
      workflowState: JSON.stringify(workflowState),
      ...(options?.resourceSnapshot
        ? {
            resolvedResourceSnapshot: JSON.stringify(resourceSnapshot),
          }
        : {}),
    })
    .where(eq(shots.id, shotId));

  return { workflowState, resourceSnapshot };
}

export async function persistShotResolvedResourceSnapshot(
  shotId: string,
  snapshot: StoryboardResolvedResourceSnapshot
): Promise<void> {
  await refreshShotWorkflowState(shotId, { resourceSnapshot: snapshot });
}
