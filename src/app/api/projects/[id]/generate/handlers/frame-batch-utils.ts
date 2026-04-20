import { extractErrorMessage } from "../helpers";

export const DEFAULT_FRAME_BATCH_CONCURRENCY = 3;
export const MAX_FRAME_BATCH_CONCURRENCY = 8;
export const MAX_FRAME_REFERENCE_IMAGES = 4;
export const MAX_SCENE_PROP_REFERENCE_IMAGES = 2;

export type NamedImageRef = {
  path: string;
  label: string;
};

export type VisualAssetRef = {
  episodeId: string | null;
  type: "scene" | "prop";
  name: string;
  imageUrl: string;
};

export function requiresChainContinuity(shot: {
  inheritPrevLastFrame?: number | null;
  prevShotId?: string | null;
}) {
  return shot.inheritPrevLastFrame === 1 && !!shot.prevShotId;
}

export function buildShotReferenceContext(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => (part || "").toLowerCase().trim())
    .filter(Boolean)
    .join("\n");
}

export function dedupeNamedRefs(refs: NamedImageRef[]) {
  const seen = new Set<string>();
  const output: NamedImageRef[] = [];
  for (const ref of refs) {
    const key = ref.path.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(ref);
  }
  return output;
}

export function summarizeRefLabels(refs: NamedImageRef[]) {
  return refs.map((ref) => ref.label).join(" | ") || "none";
}

export function composeFirstFrameRefs(charRefs: NamedImageRef[], scenePropRefs: NamedImageRef[]) {
  const ordered: NamedImageRef[] = [];
  if (scenePropRefs[0]) ordered.push(scenePropRefs[0]);
  if (charRefs[0]) ordered.push(charRefs[0]);
  if (scenePropRefs[1]) ordered.push(scenePropRefs[1]);
  if (charRefs[1]) ordered.push(charRefs[1]);
  ordered.push(...charRefs.slice(2), ...scenePropRefs.slice(2));
  return dedupeNamedRefs(ordered).slice(0, MAX_FRAME_REFERENCE_IMAGES);
}

export function composeLastFrameRefs(
  firstFramePath: string,
  charRefs: NamedImageRef[],
  scenePropRefs: NamedImageRef[]
) {
  const ordered: NamedImageRef[] = [
    { path: firstFramePath, label: "首帧/First Frame" },
    ...composeFirstFrameRefs(charRefs, scenePropRefs),
  ];
  return dedupeNamedRefs(ordered).slice(0, MAX_FRAME_REFERENCE_IMAGES);
}

export function pickScenePropRefsForShot(pool: VisualAssetRef[], context: string): NamedImageRef[] {
  if (pool.length === 0) return [];
  const ranked = pool
    .map((asset) => ({
      ...asset,
      score: context.includes(asset.name.toLowerCase()) ? 100 : 0,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.type !== b.type) return a.type === "scene" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const preferred = ranked.some((item) => item.score > 0)
    ? ranked.filter((item) => item.score > 0)
    : ranked;

  const picked: typeof preferred = [];
  const takeOne = (type: "scene" | "prop") => {
    const found = preferred.find((item) => item.type === type && !picked.includes(item));
    if (found) picked.push(found);
  };

  takeOne("scene");
  takeOne("prop");
  for (const item of preferred) {
    if (picked.includes(item)) continue;
    picked.push(item);
    if (picked.length >= MAX_SCENE_PROP_REFERENCE_IMAGES) break;
  }

  return picked.slice(0, MAX_SCENE_PROP_REFERENCE_IMAGES).map((item) => ({
    path: item.imageUrl,
    label: item.type === "scene" ? `场景:${item.name}` : `道具:${item.name}`,
  }));
}

export function resolveFrameBatchConcurrency() {
  const raw =
    process.env.BATCH_FRAME_CONCURRENCY ||
    process.env.FRAME_BATCH_CONCURRENCY ||
    process.env.IMAGE_BATCH_CONCURRENCY;
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_FRAME_BATCH_CONCURRENCY;
  return Math.min(MAX_FRAME_BATCH_CONCURRENCY, Math.max(1, parsed));
}

export function isInsufficientQuotaError(err: unknown) {
  const message = extractErrorMessage(err).toLowerCase();
  if (
    message.includes("insufficient_user_quota") ||
    message.includes("额度") ||
    message.includes("quota")
  ) {
    return true;
  }
  if (!err || typeof err !== "object") return false;
  const code = (err as Record<string, unknown>).code;
  return typeof code === "string" && code.toLowerCase() === "insufficient_user_quota";
}

export function buildQuotaErrorMessage(err: unknown) {
  const detail = extractErrorMessage(err);
  return `图片模型额度不足，无法继续生成首尾帧。请先充值对应通道，或切换到有可用额度的图片模型后重试。详情：${detail}`;
}
