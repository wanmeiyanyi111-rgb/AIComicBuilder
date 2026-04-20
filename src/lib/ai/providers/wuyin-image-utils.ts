type WuyinTaskState = "queued" | "processing" | "succeeded" | "failed";

type WuyinImageTaskResult = {
  state: WuyinTaskState;
  imageUrl: string;
  imageBase64: string;
  failReason: string;
};

type WuyinReferenceMode =
  | "none"
  | "image_urls"
  | "reduced_image_urls"
  | "prompt_only";

const DEFAULT_BASE_URL = "https://api.wuyinkeji.com";
const DEFAULT_CREATE_ENDPOINT = "/api/async/image_nanoBanana2";
const DEFAULT_DETAIL_ENDPOINT = "/api/async/detail";
const DEFAULT_REF_MAX_DIMENSION = 512;
const DEFAULT_REF_MAX_BYTES = 128 * 1024;

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function firstNonEmptyString(values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeTaskState(statusValue: unknown): WuyinTaskState {
  if (typeof statusValue === "number") {
    if (statusValue === 1) return "processing";
    if (statusValue === 2) return "succeeded";
    if (statusValue === 3) return "failed";
    return "queued";
  }

  if (typeof statusValue === "string") {
    const normalized = statusValue.trim().toLowerCase();
    if (
      normalized === "success" ||
      normalized === "succeeded" ||
      normalized === "completed" ||
      normalized === "done"
    ) {
      return "succeeded";
    }
    if (
      normalized === "fail" ||
      normalized === "failed" ||
      normalized === "error"
    ) {
      return "failed";
    }
    if (
      normalized === "running" ||
      normalized === "processing" ||
      normalized === "in_progress"
    ) {
      return "processing";
    }
  }

  return "queued";
}

function extractImageUrlCandidates(data: Record<string, unknown>): string {
  const direct = firstNonEmptyString([
    data.remote_url,
    data.remoteUrl,
    data.image_url,
    data.imageUrl,
    data.result_url,
    data.resultUrl,
    data.output_url,
    data.outputUrl,
    data.file_url,
    data.fileUrl,
    data.cdn_url,
    data.cdnUrl,
  ]);
  if (direct) return direct;

  if (Array.isArray(data.urls)) {
    const fromUrls = firstNonEmptyString(data.urls);
    if (fromUrls) return fromUrls;
  }

  if (Array.isArray(data.images)) {
    for (const item of data.images) {
      const record = getRecord(item);
      const imageUrl = firstNonEmptyString(
        record
          ? [
              record.remote_url,
              record.remoteUrl,
              record.url,
              record.image_url,
              record.imageUrl,
            ]
          : []
      );
      if (imageUrl) return imageUrl;
    }
  }

  if (Array.isArray(data.result)) {
    const fromResult = firstNonEmptyString(data.result);
    if (fromResult) return fromResult;

    for (const item of data.result) {
      const record = getRecord(item);
      const resultUrl = firstNonEmptyString(
        record
          ? [
              record.remote_url,
              record.remoteUrl,
              record.url,
              record.image_url,
              record.imageUrl,
            ]
          : []
      );
      if (resultUrl) return resultUrl;
    }
  }

  return "";
}

function extractImageBase64Candidates(data: Record<string, unknown>): string {
  return firstNonEmptyString([
    data.image_base64,
    data.imageBase64,
    data.base64,
    data.result_base64,
    data.resultBase64,
  ]);
}

function normalizeBaseUrl(baseUrl?: string | null) {
  return (baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function clampPositiveInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function describeFetchError(error: unknown): string {
  if (error instanceof Error) {
    const cause = getRecord((error as Error & { cause?: unknown }).cause);
    const causeCode =
      typeof cause?.code === "string"
        ? cause.code
        : typeof (error as Error & { cause?: { code?: unknown } }).cause?.code === "string"
          ? String((error as Error & { cause?: { code?: unknown } }).cause?.code)
          : "";
    const pieces = [error.message];
    if (causeCode) pieces.push(`code=${causeCode}`);
    return pieces.filter(Boolean).join(", ");
  }
  return String(error);
}

export {
  clampPositiveInt,
  DEFAULT_BASE_URL,
  DEFAULT_CREATE_ENDPOINT,
  DEFAULT_DETAIL_ENDPOINT,
  DEFAULT_REF_MAX_BYTES,
  DEFAULT_REF_MAX_DIMENSION,
  describeFetchError,
  extractImageBase64Candidates,
  extractImageUrlCandidates,
  firstNonEmptyString,
  getRecord,
  normalizeBaseUrl,
  normalizeTaskState,
  parsePositiveInt,
};

export type { WuyinImageTaskResult, WuyinReferenceMode, WuyinTaskState };
