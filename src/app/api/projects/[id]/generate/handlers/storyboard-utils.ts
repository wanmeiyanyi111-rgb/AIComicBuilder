import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";

export type StoryboardPanelPayload = {
  index: number;
  stage: string;
  beat: string;
  panelFunction: string;
  activeCharacters: string[];
  forbiddenDrift: string[];
  resultSignal: string;
  cameraPlan: string;
  shotScale: string;
  subjectPosition: string;
  bodyFacing: string;
  gazeTarget: string;
  interactionState: string;
  worldLock: string[];
  continuityGoal: string;
  mustKeep: string[];
  delta: string;
  prompt: string;
};

export type StoryboardContinuityRulesPayload = {
  locationLocked: boolean;
  timeContinuous: boolean;
  sameCharacterDesign: boolean;
  samePropSet: boolean;
  cameraAxisLocked: boolean;
};

export type StoryboardPromptPayload = {
  shotSequence: number;
  storyGoal: string;
  primaryScene: string;
  progressionMode:
    | "action_progression"
    | "emotional_shift"
    | "dialogue_exchange"
    | "reveal_discovery"
    | "atmosphere_transition";
  modeRationale: string;
  sceneCount: number;
  eventCount: number;
  complexityLevel: "low" | "medium";
  startingAction: string;
  endingAction: string;
  continuityBeats: string[];
  microDynamics: string[];
  continuityRules: StoryboardContinuityRulesPayload;
  characters: string[];
  panels: StoryboardPanelPayload[];
};

const STORYBOARD_PANEL_STAGES = [
  "setup",
  "development",
  "escalation",
  "outcome",
] as const;

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function parsePositiveCount(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

function parseContinuityRules(
  value: unknown
): StoryboardContinuityRulesPayload {
  const record =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    locationLocked: record.locationLocked !== false,
    timeContinuous: record.timeContinuous !== false,
    sameCharacterDesign: record.sameCharacterDesign !== false,
    samePropSet: record.samePropSet !== false,
    cameraAxisLocked: record.cameraAxisLocked !== false,
  };
}

export function normalizeStoryboardDuration(
  value: number | null | undefined
): number {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 12;
  return Math.min(14, Math.max(10, Math.round(parsed)));
}

export function parseStoryboardPromptPayload(
  rawText: string
): StoryboardPromptPayload {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Invalid storyboard prompt JSON");
  }
  const parsed = JSON.parse(match[0]) as {
    shotSequence?: unknown;
    storyGoal?: unknown;
    primaryScene?: unknown;
    progressionMode?: unknown;
    modeRationale?: unknown;
    sceneCount?: unknown;
    eventCount?: unknown;
    complexityLevel?: unknown;
    startingAction?: unknown;
    endingAction?: unknown;
    continuityBeats?: unknown;
    microDynamics?: unknown;
    continuityRules?: unknown;
    characters?: unknown;
    panels?: unknown;
  };
  const rawPanels = Array.isArray(parsed.panels) ? parsed.panels : [];
  const panels = rawPanels
    .map((panel, index) => {
      const record =
        panel && typeof panel === "object"
          ? (panel as Record<string, unknown>)
          : {};
      const prompt = String(record.prompt || "").trim();
      if (!prompt) return null;
      const mustKeep = parseStringArray(record.mustKeep);
      const worldLock = parseStringArray(record.worldLock);
      return {
        index: Number(record.index) || index + 1,
        stage:
          String(record.stage || "").trim() ||
          STORYBOARD_PANEL_STAGES[index] ||
          `panel_${index + 1}`,
        beat: String(record.beat || "").trim(),
        panelFunction:
          String(record.panelFunction || "").trim() ||
          `第${index + 1}格的叙事职责`,
        activeCharacters: parseStringArray(record.activeCharacters),
        forbiddenDrift: parseStringArray(record.forbiddenDrift),
        resultSignal:
          String(record.resultSignal || "").trim() ||
          (index === 3 ? "outcome_anchor" : `panel_${index + 1}_state`),
        cameraPlan: String(record.cameraPlan || "").trim() || "static",
        shotScale: String(record.shotScale || "").trim() || "medium",
        subjectPosition:
          String(record.subjectPosition || "").trim() ||
          `延续第${index}格后的主体位置推进`,
        bodyFacing:
          String(record.bodyFacing || "").trim() || "保持上一格主体朝向逻辑",
        gazeTarget:
          String(record.gazeTarget || "").trim() || "保持当前剧情焦点方向",
        interactionState:
          String(record.interactionState || "").trim() || "关系持续推进中",
        worldLock: worldLock.length > 0 ? worldLock : mustKeep.slice(0, 3),
        continuityGoal:
          String(record.continuityGoal || "").trim() ||
          String(record.delta || "").trim() ||
          String(record.beat || "").trim(),
        mustKeep,
        delta: String(record.delta || "").trim(),
        prompt,
      };
    })
    .filter((panel): panel is StoryboardPanelPayload => !!panel)
    .sort((a, b) => a.index - b.index)
    .slice(0, 4);

  if (panels.length !== 4) {
    throw new Error(`Expected 4 storyboard panels, received ${panels.length}`);
  }
  for (let index = 0; index < panels.length; index += 1) {
    const panel = panels[index];
    const expectedIndex = index + 1;
    const expectedStage = STORYBOARD_PANEL_STAGES[index];
    if (panel.index !== expectedIndex) {
      throw new Error(
        `Storyboard panel ${expectedIndex} has invalid index=${panel.index}`
      );
    }
    if (panel.stage !== expectedStage) {
      throw new Error(
        `Storyboard panel ${expectedIndex} must use stage=${expectedStage}, received ${panel.stage}`
      );
    }
    if (!panel.beat) {
      throw new Error(`Storyboard panel ${expectedIndex} missing beat`);
    }
    if (!panel.panelFunction) {
      throw new Error(`Storyboard panel ${expectedIndex} missing panelFunction`);
    }
    if (panel.activeCharacters.length === 0) {
      throw new Error(`Storyboard panel ${expectedIndex} missing activeCharacters`);
    }
    if (panel.forbiddenDrift.length === 0) {
      throw new Error(`Storyboard panel ${expectedIndex} missing forbiddenDrift`);
    }
    if (!panel.resultSignal) {
      throw new Error(`Storyboard panel ${expectedIndex} missing resultSignal`);
    }
    if (!panel.cameraPlan) {
      throw new Error(`Storyboard panel ${expectedIndex} missing cameraPlan`);
    }
    if (!panel.shotScale) {
      throw new Error(`Storyboard panel ${expectedIndex} missing shotScale`);
    }
    if (!panel.subjectPosition) {
      throw new Error(`Storyboard panel ${expectedIndex} missing subjectPosition`);
    }
    if (!panel.bodyFacing) {
      throw new Error(`Storyboard panel ${expectedIndex} missing bodyFacing`);
    }
    if (!panel.gazeTarget) {
      throw new Error(`Storyboard panel ${expectedIndex} missing gazeTarget`);
    }
    if (!panel.interactionState) {
      throw new Error(`Storyboard panel ${expectedIndex} missing interactionState`);
    }
    if (panel.worldLock.length === 0) {
      throw new Error(`Storyboard panel ${expectedIndex} missing worldLock`);
    }
    if (!panel.continuityGoal) {
      throw new Error(`Storyboard panel ${expectedIndex} missing continuityGoal`);
    }
    if (panel.mustKeep.length === 0) {
      throw new Error(`Storyboard panel ${expectedIndex} missing mustKeep anchors`);
    }
    if (!panel.delta) {
      throw new Error(`Storyboard panel ${expectedIndex} missing delta`);
    }
  }

  const storyGoal = String(parsed.storyGoal || "").trim();
  const primaryScene = String(parsed.primaryScene || "").trim();
  const progressionMode = String(parsed.progressionMode || "")
    .trim()
    .toLowerCase() as StoryboardPromptPayload["progressionMode"];
  const normalizedProgressionMode: StoryboardPromptPayload["progressionMode"] =
    progressionMode === "emotional_shift" ||
    progressionMode === "dialogue_exchange" ||
    progressionMode === "reveal_discovery" ||
    progressionMode === "atmosphere_transition"
      ? progressionMode
      : "action_progression";
  const modeRationale = String(parsed.modeRationale || "").trim();
  const sceneCount = parsePositiveCount(parsed.sceneCount, 1);
  const eventCount = parsePositiveCount(parsed.eventCount, 1);
  const complexityLevel = String(parsed.complexityLevel || "")
    .trim()
    .toLowerCase();
  const normalizedComplexity =
    complexityLevel === "medium" ? "medium" : "low";
  const startingAction = String(parsed.startingAction || "").trim();
  const endingAction = String(parsed.endingAction || "").trim();
  const continuityBeats = parseStringArray(parsed.continuityBeats);
  const microDynamics = parseStringArray(parsed.microDynamics);
  const continuityRules = parseContinuityRules(parsed.continuityRules);

  if (!storyGoal) {
    throw new Error("Storyboard prompt missing storyGoal");
  }
  if (!primaryScene) {
    throw new Error("Storyboard prompt missing primaryScene");
  }
  if (!modeRationale) {
    throw new Error("Storyboard prompt missing modeRationale");
  }
  if (sceneCount !== 1) {
    throw new Error(
      `Storyboard prompt invalid sceneCount=${sceneCount}; one storyboard shot must stay in one scene`
    );
  }
  if (eventCount !== 1) {
    throw new Error(
      `Storyboard prompt invalid eventCount=${eventCount}; one storyboard shot must focus on one event`
    );
  }
  if (complexityLevel && !["low", "medium"].includes(complexityLevel)) {
    throw new Error(`Storyboard prompt invalid complexityLevel=${complexityLevel}`);
  }
  if (!startingAction) {
    throw new Error("Storyboard prompt missing startingAction");
  }
  if (!endingAction) {
    throw new Error("Storyboard prompt missing endingAction");
  }
  if (continuityBeats.length < 2) {
    throw new Error(
      `Storyboard prompt invalid continuityBeats=${continuityBeats.length}; expected at least 2`
    );
  }
  if (microDynamics.length < 2) {
    throw new Error(
      `Storyboard prompt invalid microDynamics=${microDynamics.length}; expected at least 2`
    );
  }

  return {
    shotSequence: Number(parsed.shotSequence || 0),
    storyGoal,
    primaryScene,
    progressionMode: normalizedProgressionMode,
    modeRationale,
    sceneCount,
    eventCount,
    complexityLevel: normalizedComplexity as "low" | "medium",
    startingAction,
    endingAction,
    continuityBeats,
    microDynamics,
    continuityRules,
    characters: parseStringArray(parsed.characters),
    panels,
  };
}

export async function loadTargetShots(
  projectId: string,
  episodeId?: string,
  versionId?: string
) {
  const conditions = [eq(shots.projectId, projectId)];
  if (episodeId) conditions.push(eq(shots.episodeId, episodeId));
  if (versionId) conditions.push(eq(shots.versionId, versionId));
  return db
    .select()
    .from(shots)
    .where(and(...conditions))
    .orderBy(asc(shots.sequence));
}
