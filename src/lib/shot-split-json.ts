import { extractJSON } from "@/lib/ai/ai-sdk";

type ShotLike = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toStringSafe(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function isShotLike(value: unknown): value is ShotLike {
  if (!isRecord(value)) return false;
  return Boolean(
    toStringSafe(value.sceneDescription) ||
      toStringSafe(value.prompt) ||
      toStringSafe(value.startFrame) ||
      toStringSafe(value.endFrame) ||
      toStringSafe(value.motionScript) ||
      typeof value.duration === "number" ||
      Array.isArray(value.dialogues)
  );
}

function normalizeShotArray(
  input: unknown,
  inheritedSceneDescription = ""
): ShotLike[] {
  if (Array.isArray(input)) {
    return input.flatMap((item) => normalizeShotArray(item, inheritedSceneDescription));
  }

  if (!isRecord(input)) return [];

  const ownSceneDescription =
    toStringSafe(input.sceneDescription) ||
    toStringSafe(input.sceneTitle) ||
    inheritedSceneDescription;

  if (Array.isArray(input.shots)) {
    return input.shots.flatMap((item) =>
      normalizeShotArray(item, ownSceneDescription)
    );
  }

  if (isShotLike(input)) {
    return [
      {
        ...input,
        sceneDescription:
          toStringSafe(input.sceneDescription) || ownSceneDescription,
      },
    ];
  }

  for (const key of ["shots", "data", "result", "items", "list", "scenes", "sceneGroups"]) {
    if (Array.isArray(input[key])) {
      const normalized = normalizeShotArray(input[key], ownSceneDescription);
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }

  return [];
}

function collectNestedShotArrays(root: unknown): ShotLike[][] {
  const queue: unknown[] = [root];
  const found: ShotLike[][] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    if (Array.isArray(current)) {
      const normalized = normalizeShotArray(current);
      if (normalized.length > 0) {
        found.push(normalized);
      }
      for (const item of current) queue.push(item);
      continue;
    }

    if (isRecord(current)) {
      for (const value of Object.values(current)) {
        queue.push(value);
      }
    }
  }

  return found;
}

export function extractShotsFromParsed(parsed: unknown): ShotLike[] {
  const direct = normalizeShotArray(parsed);
  if (direct.length > 0) {
    return direct;
  }

  const nested = collectNestedShotArrays(parsed);
  if (nested.length > 0) {
    return nested[0];
  }

  throw new Error("Invalid shot JSON structure");
}

function extractBalancedJsonFragments(text: string): string[] {
  const fragments: string[] = [];

  for (let start = 0; start < text.length; start++) {
    const openChar = text[start];
    if (openChar !== "[" && openChar !== "{") continue;

    const closeChar = openChar === "[" ? "]" : "}";
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index++) {
      const char = text[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "\"") {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === openChar) {
        depth += 1;
        continue;
      }

      if (char === closeChar) {
        depth -= 1;
        if (depth === 0) {
          fragments.push(text.slice(start, index + 1));
          start = index;
          break;
        }
      }
    }
  }

  return fragments;
}

function recoverShotObjectsFromFragments(fragments: string[]): ShotLike[] {
  const recovered: ShotLike[] = [];

  for (const fragment of fragments) {
    if (!fragment.trim().startsWith("{")) continue;
    try {
      const parsed = JSON.parse(fragment) as unknown;
      const shots = extractShotsFromParsed(parsed);
      if (shots.length === 1) {
        recovered.push(shots[0]);
      } else if (shots.length > 1) {
        recovered.push(...shots);
      }
    } catch {
      continue;
    }
  }

  const deduped = new Map<string, ShotLike>();
  for (const shot of recovered) {
    const key = [
      toStringSafe(shot.sequence),
      toStringSafe(shot.startFrame),
      toStringSafe(shot.endFrame),
      toStringSafe(shot.motionScript),
    ].join("::");
    if (!deduped.has(key)) {
      deduped.set(key, shot);
    }
  }

  return Array.from(deduped.values());
}

export function parseShotSplitPayload(rawText: string): ShotLike[] {
  const raw = rawText.trim();
  const cleaned = extractJSON(rawText).trim();
  const rawFragments = extractBalancedJsonFragments(raw);
  const cleanedFragments = extractBalancedJsonFragments(cleaned);
  const balancedFragments = [...rawFragments, ...cleanedFragments];
  const candidates = [
    raw,
    cleaned,
    ...balancedFragments,
    raw.includes("[")
      ? raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)
      : "",
    cleaned.includes("[")
      ? cleaned.slice(cleaned.indexOf("["), cleaned.lastIndexOf("]") + 1)
      : "",
    raw.includes("{")
      ? raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)
      : "",
    cleaned.includes("{")
      ? cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)
      : "",
  ].filter((item, index, arr) => !!item && arr.indexOf(item) === index);

  let lastError: unknown = null;
  let bestShots: ShotLike[] = [];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const shots = extractShotsFromParsed(parsed);
      if (shots.length > bestShots.length) {
        bestShots = shots;
      }
    } catch (err) {
      lastError = err;
    }
  }

  const recoveredShots = recoverShotObjectsFromFragments([
    ...rawFragments,
    ...cleanedFragments,
  ]);
  if (recoveredShots.length > bestShots.length) {
    return recoveredShots;
  }

  if (bestShots.length > 0) {
    return bestShots;
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Invalid shot JSON structure");
}
