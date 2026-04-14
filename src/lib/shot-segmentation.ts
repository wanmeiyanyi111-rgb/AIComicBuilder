export const SEGMENT_DURATION_TARGET = 4;
export const SEGMENT_DURATION_MIN = 3;
export const SEGMENT_DURATION_MAX = 5;

type ChainFields = {
  chainGroupId: string | null;
  chainIndex: number;
  chainTotal: number;
  inheritPrevLastFrame: number;
  originalDuration: number;
};

type SegmentableShot = {
  sequence: number;
  duration: number;
  prompt?: string | null;
  motionScript?: string | null;
  videoScript?: string | null;
};

function normalizeText(input: string | null | undefined, maxLen = 240): string {
  const text = (input || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function chooseCoreAction(input: string | null | undefined): string {
  const normalized = normalizeText(input, 480);
  if (!normalized) return "";
  const parts = normalized
    .split(/[。！？.!?；;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts[0] || normalized;
}

function phaseText(index: number, total: number): string {
  if (total <= 1) return "single beat";
  if (index === 1) return "action setup";
  if (index === total) return "action resolve";
  if (index <= Math.ceil(total / 2)) return "action continuation";
  return "action peak";
}

function segmentPrompt(basePrompt: string, index: number, total: number): string {
  const core = chooseCoreAction(basePrompt) || "Keep the current scene and character continuity.";
  return [
    `Segment ${index}/${total} (${phaseText(index, total)}).`,
    "Keep one clear visual action beat only.",
    core,
  ].join(" ");
}

function segmentMotion(
  source: string,
  index: number,
  total: number
): string {
  const core = chooseCoreAction(source) || "Character performs one clear action.";
  const continuity =
    index > 1
      ? "Start exactly from the provided first frame state and continue naturally."
      : "Establish stable start pose and begin motion clearly.";
  return [
    `Segment ${index}/${total} (${phaseText(index, total)}).`,
    continuity,
    "Single major movement only. Avoid combining multiple action objectives.",
    core,
  ].join(" ");
}

export function computeSegmentDurations(totalDuration: number): number[] {
  const total = Math.max(1, Math.round(totalDuration));
  if (total <= SEGMENT_DURATION_MAX) return [total];

  const minSegments = Math.ceil(total / SEGMENT_DURATION_MAX);
  const maxSegments = Math.max(minSegments, Math.floor(total / SEGMENT_DURATION_MIN));

  let bestSegments = minSegments;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let n = minSegments; n <= maxSegments; n++) {
    const avg = total / n;
    const distance = Math.abs(avg - SEGMENT_DURATION_TARGET);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestSegments = n;
    }
  }

  const durations: number[] = [];
  let remaining = total;
  let remainingSegments = bestSegments;

  while (remainingSegments > 0) {
    const minForRest = SEGMENT_DURATION_MIN * (remainingSegments - 1);
    const maxForRest = SEGMENT_DURATION_MAX * (remainingSegments - 1);
    const minCurrent = Math.max(SEGMENT_DURATION_MIN, remaining - maxForRest);
    const maxCurrent = Math.min(SEGMENT_DURATION_MAX, remaining - minForRest);
    let current = Math.min(SEGMENT_DURATION_TARGET, maxCurrent);
    if (current < minCurrent) current = minCurrent;
    durations.push(current);
    remaining -= current;
    remainingSegments -= 1;
  }

  return durations;
}

export function expandShotsForVideoControl<
  T extends SegmentableShot
>(
  shots: T[],
  newGroupId: () => string
): Array<T & ChainFields> {
  const expanded: Array<T & ChainFields> = [];

  for (const shot of shots) {
    const originalDuration = Math.max(1, Math.round(shot.duration || 0));
    const durations = computeSegmentDurations(originalDuration);
    if (durations.length <= 1) {
      expanded.push({
        ...shot,
        duration: originalDuration,
        chainGroupId: null,
        chainIndex: 1,
        chainTotal: 1,
        inheritPrevLastFrame: 0,
        originalDuration,
      });
      continue;
    }

    const groupId = newGroupId();
    const basePrompt = normalizeText(shot.prompt);
    const sourceMotion = normalizeText(
      shot.videoScript || shot.motionScript || shot.prompt
    );

    for (let i = 0; i < durations.length; i++) {
      const idx = i + 1;
      expanded.push({
        ...shot,
        duration: durations[i],
        prompt: segmentPrompt(basePrompt, idx, durations.length),
        motionScript: segmentMotion(sourceMotion, idx, durations.length),
        videoScript: segmentMotion(sourceMotion, idx, durations.length),
        chainGroupId: groupId,
        chainIndex: idx,
        chainTotal: durations.length,
        inheritPrevLastFrame: idx > 1 ? 1 : 0,
        originalDuration,
      });
    }
  }

  return expanded.map((shot, i) => ({
    ...shot,
    sequence: i + 1,
  }));
}
