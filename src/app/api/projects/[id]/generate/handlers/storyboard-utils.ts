import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";

export type StoryboardPanelPayload = {
  index: number;
  stage: string;
  beat: string;
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
      return {
        index: Number(record.index) || index + 1,
        stage:
          String(record.stage || "").trim() ||
          STORYBOARD_PANEL_STAGES[index] ||
          `panel_${index + 1}`,
        beat: String(record.beat || "").trim(),
        mustKeep: parseStringArray(record.mustKeep),
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
    if (panel.mustKeep.length === 0) {
      throw new Error(`Storyboard panel ${expectedIndex} missing mustKeep anchors`);
    }
    if (!panel.delta) {
      throw new Error(`Storyboard panel ${expectedIndex} missing delta`);
    }
  }

  const storyGoal = String(parsed.storyGoal || "").trim();
  const primaryScene = String(parsed.primaryScene || "").trim();
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
