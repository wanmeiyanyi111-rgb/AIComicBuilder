import fs from "node:fs";
import path from "node:path";
import { id as genId } from "@/lib/id";
import type { AIProvider, ImageOptions, TextOptions } from "../types";

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
  | "prompt_only_fallback";

const DEFAULT_BASE_URL = "https://api.wuyinkeji.com";
const DEFAULT_CREATE_ENDPOINT = "/api/async/image_nanoBanana2";
const DEFAULT_DETAIL_ENDPOINT = "/api/async/detail";

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

export class WuyinImageProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly uploadDir: string;
  private readonly createEndpoint: string;
  private readonly detailEndpoint: string;
  private readonly pollIntervalMs: number;
  private readonly pollMaxAttempts: number;

  constructor(params?: {
    apiKey?: string;
    baseURL?: string;
    uploadDir?: string;
    createEndpoint?: string;
    detailEndpoint?: string;
    pollIntervalMs?: number;
    pollMaxAttempts?: number;
  }) {
    this.apiKey =
      params?.apiKey?.trim() || process.env.WUYINKEJI_API_KEY?.trim() || "";
    this.baseUrl = normalizeBaseUrl(
      params?.baseURL || process.env.WUYINKEJI_BASE_URL || DEFAULT_BASE_URL
    );
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
    this.createEndpoint = params?.createEndpoint || DEFAULT_CREATE_ENDPOINT;
    this.detailEndpoint = params?.detailEndpoint || DEFAULT_DETAIL_ENDPOINT;
    this.pollIntervalMs = Math.min(
      60000,
      Math.max(
        500,
        params?.pollIntervalMs ??
          parsePositiveInt(process.env.WUYINKEJI_IMAGE_POLL_INTERVAL_MS, 3000)
      )
    );
    this.pollMaxAttempts = Math.min(
      300,
      Math.max(
        3,
        params?.pollMaxAttempts ??
          parsePositiveInt(process.env.WUYINKEJI_IMAGE_POLL_MAX_ATTEMPTS, 80)
      )
    );
  }

  async generateText(_prompt: string, _options?: TextOptions): Promise<string> {
    throw new Error("WuyinImageProvider does not support text generation");
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error("WuyinImageProvider missing API key");
    }

    const allReferences = (options?.referenceImages || [])
      .map((item) => this.toWuyinReferenceInput(item))
      .filter(Boolean)
      .slice(0, 4);
    const aspectRatio = options?.aspectRatio || this.inferAspectRatio(options?.size);

    const runTask = async (
      refs: string[],
      mode: WuyinReferenceMode
    ): Promise<string> => {
      const payload: Record<string, unknown> = {
        prompt,
        size: "1K",
      };
      if (aspectRatio) payload.aspectRatio = aspectRatio;
      if (refs.length > 0) payload.urls = refs;

      console.log(
        `[WuyinImage] create task mode=${mode}, refs=${refs.length}, promptLength=${prompt.length}`
      );

      const taskId = await this.createAsyncTask(payload);
      const result = await this.pollImageTask(taskId);

      if (result.imageUrl) {
        return this.writeFromRemoteUrl(result.imageUrl);
      }
      if (result.imageBase64) {
        return this.writeFromBase64(result.imageBase64);
      }

      throw new Error("Wuyin image task succeeded but no decodable image returned");
    };

    if (allReferences.length === 0) {
      return runTask([], "none");
    }

    const retryPlans = [
      allReferences,
      allReferences.slice(0, 2),
      allReferences.slice(0, 1),
    ].filter(
      (plan, index, plans) =>
        plan.length > 0 &&
        plans.findIndex(
          (candidate) => candidate.join("|") === plan.join("|")
        ) === index
    );

    let lastErrorMessage = "unknown error";
    for (let index = 0; index < retryPlans.length; index += 1) {
      const refs = retryPlans[index];
      try {
        return await runTask(refs, index === 0 ? "image_urls" : "reduced_image_urls");
      } catch (err) {
        lastErrorMessage = err instanceof Error ? err.message : String(err);
        console.warn(
          `[WuyinImage] with refs failed (refs=${refs.length}): ${lastErrorMessage}`
        );
      }
    }

    console.warn(
      `[WuyinImage] retrying prompt-only fallback, last error: ${lastErrorMessage}`
    );
    return runTask([], "prompt_only_fallback");
  }

  private async createAsyncTask(payload: Record<string, unknown>): Promise<string> {
    const url = new URL(this.createEndpoint, this.baseUrl);
    url.searchParams.set("key", this.apiKey);

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    const raw = rawText ? (JSON.parse(rawText) as unknown) : null;

    if (!response.ok) {
      throw new Error(
        `Wuyin async task create failed (${response.status}): ${rawText.slice(0, 400)}`
      );
    }

    const payloadRecord = getRecord(raw);
    const code =
      typeof payloadRecord?.code === "number"
        ? payloadRecord.code
        : typeof payloadRecord?.code === "string"
          ? Number(payloadRecord.code)
          : 200;
    const message = firstNonEmptyString([
      payloadRecord?.msg,
      payloadRecord?.message,
    ]);
    if (Number.isFinite(code) && code !== 200) {
      throw new Error(
        `Wuyin async task create rejected (${code}): ${message || rawText.slice(0, 400)}`
      );
    }

    const data = getRecord(payloadRecord?.data);
    const id = typeof data?.id === "string" ? data.id.trim() : "";
    if (!id) {
      throw new Error(
        `Wuyin async task create succeeded but did not return task id${
          message ? `: ${message}` : ""
        }`
      );
    }
    return id;
  }

  private async pollImageTask(taskId: string): Promise<WuyinImageTaskResult> {
    let lastFailureReason = "";
    const startedAt = Date.now();

    for (let attempt = 0; attempt < this.pollMaxAttempts; attempt += 1) {
      if (attempt > 0) {
        await this.sleep(this.pollIntervalMs);
      }

      const detailRaw = await this.fetchAsyncDetail(taskId);
      const result = this.parseImageTaskResult(detailRaw);

      if (result.state === "failed") {
        throw new Error(result.failReason || "Wuyin image generation failed");
      }
      if (result.state === "succeeded") {
        if (!result.imageUrl && !result.imageBase64) {
          lastFailureReason =
            result.failReason ||
            "Wuyin image detail succeeded without a usable image payload";
          continue;
        }
        return result;
      }
    }

    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    throw new Error(
      lastFailureReason ||
        `Wuyin image generation timed out after ${this.pollMaxAttempts} attempts (~${elapsedSeconds}s), taskId=${taskId}`
    );
  }

  private async fetchAsyncDetail(taskId: string): Promise<unknown> {
    const url = new URL(this.detailEndpoint, this.baseUrl);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("id", taskId);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: this.apiKey,
      },
    });
    const rawText = await response.text();
    const raw = rawText ? (JSON.parse(rawText) as unknown) : null;
    if (!response.ok) {
      throw new Error(
        `Wuyin detail request failed (${response.status}): ${rawText.slice(0, 400)}`
      );
    }
    return raw;
  }

  private parseImageTaskResult(raw: unknown): WuyinImageTaskResult {
    const root = getRecord(raw);
    const data = getRecord(root?.data) ?? {};
    const state = normalizeTaskState(data.status);
    return {
      state,
      imageUrl: extractImageUrlCandidates(data),
      imageBase64: extractImageBase64Candidates(data),
      failReason: firstNonEmptyString([
        data.fail_reason,
        data.failReason,
        data.message,
        root?.msg,
      ]),
    };
  }

  private toWuyinReferenceInput(imagePathOrUrl: string): string {
    const normalized = this.toImageInputUrl(imagePathOrUrl);
    if (!normalized) return "";
    if (/^data:image\//i.test(normalized)) {
      const match = normalized.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
      return (match?.[1] || "").trim();
    }
    return normalized;
  }

  private toImageInputUrl(imagePathOrUrl: string): string {
    if (!imagePathOrUrl) return "";
    if (/^https?:\/\//i.test(imagePathOrUrl) || /^data:image\//i.test(imagePathOrUrl)) {
      return imagePathOrUrl;
    }

    const resolved = path.resolve(imagePathOrUrl);
    if (!fs.existsSync(resolved)) return "";

    const data = fs.readFileSync(resolved).toString("base64");
    const ext = path.extname(resolved).toLowerCase();
    const mimeType =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : "image/jpeg";
    return `data:${mimeType};base64,${data}`;
  }

  private inferAspectRatio(size?: string): string | undefined {
    if (!size) return undefined;
    const match = size.match(/^(\d{2,5})x(\d{2,5})$/i);
    if (!match) return undefined;
    const width = Number.parseInt(match[1], 10);
    const height = Number.parseInt(match[2], 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return undefined;
    }
    if (Math.abs(width / height - 16 / 9) < 0.2) return "16:9";
    if (Math.abs(width / height - 9 / 16) < 0.2) return "9:16";
    if (Math.abs(width / height - 1) < 0.1) return "1:1";
    return undefined;
  }

  private async writeFromRemoteUrl(imageUrl: string): Promise<string> {
    if (/^data:image\//i.test(imageUrl)) {
      return this.writeFromBase64(imageUrl);
    }

    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Wuyin remote image fetch failed (${response.status})`);
    }
    const contentType =
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      "image/png";
    const extension = this.extensionFromContentType(contentType);
    const buffer = Buffer.from(await response.arrayBuffer());
    return this.writeImageBuffer(buffer, extension);
  }

  private writeFromBase64(base64Input: string): string {
    let contentType = "image/png";
    let payload = base64Input.trim();

    const dataUrlMatch = payload.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (dataUrlMatch) {
      contentType = dataUrlMatch[1];
      payload = dataUrlMatch[2];
    }

    const extension = this.extensionFromContentType(contentType);
    const buffer = Buffer.from(payload, "base64");
    return this.writeImageBuffer(buffer, extension);
  }

  private extensionFromContentType(contentType: string): string {
    switch (contentType) {
      case "image/png":
        return "png";
      case "image/webp":
        return "webp";
      case "image/gif":
        return "gif";
      case "image/jpeg":
      case "image/jpg":
      default:
        return "jpg";
    }
  }

  private writeImageBuffer(buffer: Buffer, extension = "png"): string {
    const filename = `${genId()}.${extension}`;
    const dir = path.join(this.uploadDir, "frames");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);
    return filepath;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
