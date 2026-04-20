export type TransitionType =
  | "cut"
  | "dissolve"
  | "fade_in"
  | "fade_out"
  | "wipeleft"
  | "slideright"
  | "circleopen";

import { getShotTransitionProfileConfig } from "@/lib/shot-transition-profile";

const SUPPORTED_TRANSITIONS = new Set<TransitionType>([
  "cut",
  "dissolve",
  "fade_in",
  "fade_out",
  "wipeleft",
  "slideright",
  "circleopen",
]);

const FANCY_TRANSITIONS: TransitionType[] = ["wipeleft", "circleopen", "slideright"];
const FANCY_TRANSITION_SET = new Set<TransitionType>(FANCY_TRANSITIONS);

const TIME_JUMP_CUE =
  /(?:later|meanwhile|flashback|flash forward|time lapse|next day|hours later|days later|months later|years later|第二天|次日|次晨|后来|随后|不久后|若干年后|多年后|回忆|闪回|转场到|与此同时|镜头切到)/i;
const MONTAGE_CUE =
  /(?:montage|training montage|sequence|rapid cuts|组接|蒙太奇|快切|连续片段|并行剪辑|回忆片段)/i;

export type TransitionPlanningShot = {
  sequence: number;
  sceneDescription?: string | null;
  prompt?: string | null;
  motionScript?: string | null;
  videoScript?: string | null;
  transitionIn?: string | null;
  transitionOut?: string | null;
  chainGroupId?: string | null;
  inheritPrevLastFrame?: number | null;
};

export type PlanShotTransitionOptions = {
  profileId?: string | null;
};

function normalizeText(input: string | null | undefined): string {
  return (input || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeTransition(value: string | null | undefined): TransitionType | null {
  const normalized = normalizeText(value).replace(/-/g, "_");
  if (!normalized) return null;
  if (normalized === "fadein") return "fade_in";
  if (normalized === "fadeout") return "fade_out";
  if (!SUPPORTED_TRANSITIONS.has(normalized as TransitionType)) return null;
  return normalized as TransitionType;
}

function isChainContinuation(prev: TransitionPlanningShot, next: TransitionPlanningShot): boolean {
  if ((next.inheritPrevLastFrame ?? 0) > 0) return true;
  return !!(prev.chainGroupId && next.chainGroupId && prev.chainGroupId === next.chainGroupId);
}

function hasCue(shot: TransitionPlanningShot, regex: RegExp): boolean {
  const joined = [
    shot.sceneDescription,
    shot.prompt,
    shot.motionScript,
    shot.videoScript,
  ]
    .filter(Boolean)
    .join(" ");
  return regex.test(joined);
}

function isSceneJump(prev: TransitionPlanningShot, next: TransitionPlanningShot): boolean {
  const prevScene = normalizeText(prev.sceneDescription);
  const nextScene = normalizeText(next.sceneDescription);
  if (prevScene && nextScene) return prevScene !== nextScene;
  return false;
}

function chooseFancyTransition(index: number): TransitionType {
  return FANCY_TRANSITIONS[index % FANCY_TRANSITIONS.length];
}

export function planShotTransitions<T extends TransitionPlanningShot>(
  shots: T[],
  options?: PlanShotTransitionOptions
): Array<T & Pick<TransitionPlanningShot, "transitionIn" | "transitionOut">> {
  if (shots.length === 0) return [];

  const planned = shots.map((shot) => ({ ...shot }));
  const profileConfig = getShotTransitionProfileConfig(options?.profileId);
  const pairCount = Math.max(0, planned.length - 1);
  const maxNonCut = pairCount > 0 ? Math.max(1, Math.floor(pairCount * profileConfig.maxNonCutRatio)) : 0;
  const maxFancy = pairCount > 0 ? Math.max(1, Math.floor(pairCount * profileConfig.maxFancyRatio)) : 0;
  let usedNonCut = 0;
  let usedFancy = 0;

  for (let i = 0; i < pairCount; i++) {
    const current = planned[i];
    const next = planned[i + 1];
    const existingOut = normalizeTransition(current.transitionOut);
    const existingIn = normalizeTransition(next.transitionIn);
    const existingPair =
      existingOut && existingOut !== "cut"
        ? existingOut
        : existingIn && existingIn !== "cut"
          ? existingIn
          : null;

    const sceneJump = isSceneJump(current, next);
    const timeJump = hasCue(current, TIME_JUMP_CUE) || hasCue(next, TIME_JUMP_CUE);
    const montage = hasCue(current, MONTAGE_CUE) || hasCue(next, MONTAGE_CUE);

    let pairTransition: TransitionType = "cut";
    if (isChainContinuation(current, next)) {
      pairTransition = "cut";
    } else if (existingPair && profileConfig.preserveExistingNonCut) {
      pairTransition = existingPair;
    } else if (montage && (sceneJump || timeJump)) {
      pairTransition = chooseFancyTransition(i);
    } else if (sceneJump || timeJump) {
      pairTransition = "dissolve";
    }

    if (pairTransition !== "cut") {
      if (usedNonCut >= maxNonCut) {
        pairTransition = "cut";
      } else if (FANCY_TRANSITION_SET.has(pairTransition) && usedFancy >= maxFancy) {
        pairTransition = sceneJump || timeJump ? "dissolve" : "cut";
      }
    }

    if (pairTransition !== "cut") usedNonCut += 1;
    if (FANCY_TRANSITION_SET.has(pairTransition)) usedFancy += 1;

    current.transitionOut = pairTransition;
    next.transitionIn = pairTransition;
  }

  for (let i = 0; i < planned.length; i++) {
    const shot = planned[i];
    const safeIn = normalizeTransition(shot.transitionIn) ?? "cut";
    const safeOut = normalizeTransition(shot.transitionOut) ?? "cut";
    shot.transitionIn = i === 0 ? (safeIn === "cut" ? "fade_in" : safeIn) : safeIn;
    shot.transitionOut =
      i === planned.length - 1 ? (safeOut === "cut" ? "fade_out" : safeOut) : safeOut;
  }

  return planned;
}

export function summarizeTransitionUsage(
  shots: Array<{ transitionIn?: string | null; transitionOut?: string | null }>
): Record<TransitionType, number> {
  const summary: Record<TransitionType, number> = {
    cut: 0,
    dissolve: 0,
    fade_in: 0,
    fade_out: 0,
    wipeleft: 0,
    slideright: 0,
    circleopen: 0,
  };

  for (let i = 0; i < shots.length; i++) {
    if (i === 0) {
      const firstIn = normalizeTransition(shots[i].transitionIn);
      if (firstIn) summary[firstIn] += 1;
    }
    const out = normalizeTransition(shots[i].transitionOut);
    if (out) summary[out] += 1;
  }

  return summary;
}
