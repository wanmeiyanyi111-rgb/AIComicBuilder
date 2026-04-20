export const MODEL_MAX_DURATIONS: Record<string, number> = {
  "veo-2.0-generate-001": 8,
  "veo-3.0-generate-001": 8,
  "veo-3.0-fast-generate-001": 8,
  "veo-3.1-generate-001": 8,
  "veo-3.1-fast-generate-001": 8,
  "kling-v1": 10,
  "kling-v1-5": 10,
  "kling-v2.5-turbo": 10,
  "kling-v3": 15,
  "doubao-seedance-1-5-pro-250528": 10,
  "doubao-seedance-1-5-pro-251215": 10,
  "doubao-seedance-1-0-lite-250528": 5,
  "wan2.7-t2v": 15,
  "wan2.7-r2v": 15,
  "wan2.6-t2v": 15,
  "wan2.6-i2v-flash": 15,
  "wan2.6-i2v": 10,
  "wan2.6-r2v": 10,
  "wan2.6-r2v-flash": 10,
};

/** Family-level fallback: if modelId contains this substring, use this duration */
const FAMILY_MAX_DURATIONS: [string, number][] = [
  ["veo", 8],
  ["kling-v3", 15],
  ["kling", 10],
  ["seedance-2", 15],
  ["seedance-1-5", 10],
  ["seedance-1-0", 5],
  ["seedance", 10],
  ["wan2.7", 15],
  ["wan2.6", 15],
  ["wan", 15],
];

export const DEFAULT_MAX_DURATION = 12;

/** Returns the maximum supported video duration (seconds) for the given model ID. Unknown models return 12. */
export function getModelMaxDuration(modelId?: string | null): number {
  if (!modelId) return DEFAULT_MAX_DURATION;

  const lowerModelId = modelId.toLowerCase();

  // Exact match
  if (lowerModelId in MODEL_MAX_DURATIONS) {
    return MODEL_MAX_DURATIONS[lowerModelId];
  }

  // Prefix match
  for (const key of Object.keys(MODEL_MAX_DURATIONS).sort((a, b) => b.length - a.length)) {
    if (lowerModelId.startsWith(key) || key.startsWith(lowerModelId)) {
      return MODEL_MAX_DURATIONS[key];
    }
  }

  // Family substring match (order matters — more specific first)
  for (const [family, duration] of FAMILY_MAX_DURATIONS) {
    if (lowerModelId.includes(family)) {
      return duration;
    }
  }

  return DEFAULT_MAX_DURATION;
}

function toRoundedPositiveInt(value: number | null | undefined, fallback: number): number {
  const rounded = Math.round(Number(value ?? fallback));
  if (!Number.isFinite(rounded) || rounded <= 0) return fallback;
  return rounded;
}

/**
 * Normalize a requested video duration to a value that the target model accepts.
 *
 * Why this exists:
 * - Some providers only accept discrete durations (e.g. Seedance 1.5: 5s/10s).
 * - Our shot planner may produce 10-14s storyboard segments, while some providers still
 *   need shorter discrete render durations at submit time.
 * - If we pass unsupported values directly, provider submit fails with 400.
 */
export function normalizeVideoDurationForModel(
  modelId: string | null | undefined,
  requestedDuration: number | null | undefined
): number {
  const requested = toRoundedPositiveInt(requestedDuration, 5);
  const lowerModelId = (modelId || "").toLowerCase();

  // Seedance 1.0-lite effectively behaves as fixed 5s.
  if (lowerModelId.includes("seedance-1-0")) {
    return 5;
  }

  // Seedance 1.5/2.x: keep actual render requests inside a 4-5s window for stability,
  // even if storyboard planning uses broader 10-14s pacing.
  // Mapping rule: <=4 -> 4s, >4 -> 5s.
  if (
    lowerModelId.includes("seedance-1-5") ||
    lowerModelId.includes("doubao-seedance-1-5") ||
    lowerModelId.includes("seedance-2") ||
    lowerModelId.includes("doubao-seedance-2")
  ) {
    return requested <= 4 ? 4 : 5;
  }

  // Fallback: clamp by known max capability.
  const maxDuration = getModelMaxDuration(modelId);
  return Math.min(maxDuration, Math.max(1, requested));
}
