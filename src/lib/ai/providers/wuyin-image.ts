import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { id as genId } from "@/lib/id";
import type { AIProvider, ImageOptions, TextOptions } from "../types";
import {
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
} from "./wuyin-image-utils";
import type {
  WuyinImageTaskResult,
  WuyinReferenceMode,
  WuyinTaskState,
} from "./wuyin-image-utils";

export class WuyinImageProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly uploadDir: string;
  private readonly createEndpoint: string;
  private readonly detailEndpoint: string;
  private readonly pollIntervalMs: number;
  private readonly pollMaxAttempts: number;
  private readonly pollTimeoutMs: number;
  private readonly refMaxDimension: number;
  private readonly refMaxBytes: number;

  constructor(params?: {
    apiKey?: string;
    baseURL?: string;
    uploadDir?: string;
    createEndpoint?: string;
    detailEndpoint?: string;
    pollIntervalMs?: number;
    pollMaxAttempts?: number;
    pollTimeoutMs?: number;
    refMaxDimension?: number;
    refMaxBytes?: number;
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
    this.pollTimeoutMs = clampPositiveInt(
      params?.pollTimeoutMs ??
        parsePositiveInt(process.env.WUYINKEJI_IMAGE_TIMEOUT_MS, 10 * 60 * 1000),
      30_000,
      30 * 60 * 1000
    );
    this.refMaxDimension = clampPositiveInt(
      params?.refMaxDimension ??
        parsePositiveInt(
          process.env.WUYINKEJI_REFERENCE_MAX_DIMENSION,
          DEFAULT_REF_MAX_DIMENSION
        ),
      128,
      2048
    );
    this.refMaxBytes = clampPositiveInt(
      params?.refMaxBytes ??
        parsePositiveInt(
          process.env.WUYINKEJI_REFERENCE_MAX_BYTES,
          DEFAULT_REF_MAX_BYTES
        ),
      8 * 1024,
      2 * 1024 * 1024
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
      [],
    ].filter(
      (plan, index, plans) =>
        plan.length > 0 &&
        plans.findIndex(
          (candidate) => candidate.join("|") === plan.join("|")
        ) === index
    );

    if (!retryPlans.some((plan) => plan.length === 0)) {
      retryPlans.push([]);
    }

    let lastErrorMessage = "unknown error";
    for (let index = 0; index < retryPlans.length; index += 1) {
      const refs = retryPlans[index];
      try {
        return await runTask(
          refs,
          refs.length === 0
            ? "prompt_only"
            : index === 0
              ? "image_urls"
              : "reduced_image_urls"
        );
      } catch (err) {
        lastErrorMessage = err instanceof Error ? err.message : String(err);
        console.warn(
          `[WuyinImage] with refs failed (refs=${refs.length}): ${lastErrorMessage}`
        );
      }
    }

    throw new Error(
      `Wuyin reference image request failed after ${retryPlans.length} attempts: ${lastErrorMessage}`
    );
  }

  private async createAsyncTask(payload: Record<string, unknown>): Promise<string> {
    const url = new URL(this.createEndpoint, this.baseUrl);
    url.searchParams.set("key", this.apiKey);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          Authorization: this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      throw new Error(
        `Wuyin async task create network error (${url.origin}${this.createEndpoint}): ${describeFetchError(error)}`
      );
    }

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
    let lastObservedState: WuyinTaskState = "queued";
    const effectiveMaxAttempts = Math.min(
      600,
      Math.max(
        this.pollMaxAttempts,
        Math.ceil(this.pollTimeoutMs / this.pollIntervalMs) + 1
      )
    );

    for (let attempt = 0; attempt < effectiveMaxAttempts; attempt += 1) {
      if (attempt > 0) {
        await this.sleep(this.pollIntervalMs);
      }

      const detailRaw = await this.fetchAsyncDetail(taskId);
      const result = this.parseImageTaskResult(detailRaw);
      lastObservedState = result.state;

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

      if (Date.now() - startedAt >= this.pollTimeoutMs) {
        break;
      }
    }

    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    throw new Error(
      lastFailureReason ||
        `Wuyin image generation timed out after ${effectiveMaxAttempts} attempts (~${elapsedSeconds}s, state=${lastObservedState}), taskId=${taskId}`
    );
  }

  private async fetchAsyncDetail(taskId: string): Promise<unknown> {
    const url = new URL(this.detailEndpoint, this.baseUrl);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("id", taskId);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: {
          Authorization: this.apiKey,
        },
      });
    } catch (error) {
      throw new Error(
        `Wuyin detail request network error (${url.origin}${this.detailEndpoint}): ${describeFetchError(error)}`
      );
    }
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
    const normalized = imagePathOrUrl.trim();
    if (!normalized) return "";
    if (/^https?:\/\//i.test(normalized)) {
      return normalized;
    }
    if (/^data:image\//i.test(normalized)) {
      const match = normalized.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
      return (match?.[1] || "").trim();
    }

    const resolved = path.resolve(normalized);
    if (!fs.existsSync(resolved)) return "";

    const prepared = this.prepareLocalReferenceForWuyin(resolved);
    if (prepared) {
      return prepared;
    }

    const fallback = this.toImageInputUrl(resolved);
    if (!fallback) return "";
    const match = fallback.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    return (match?.[1] || "").trim();
  }

  private prepareLocalReferenceForWuyin(resolvedPath: string): string {
    const stats = fs.statSync(resolvedPath);
    const compressed = this.compressReferenceImage(resolvedPath);
    if (!compressed) {
      if (stats.size > this.refMaxBytes) {
        return "";
      }
      const original = this.toImageInputUrl(resolvedPath);
      const match = original.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
      return (match?.[1] || "").trim();
    }

    const resizedStats = fs.statSync(compressed);
    console.log(
      `[WuyinImage] compressed local ref ${path.basename(resolvedPath)} ${Math.round(
        stats.size / 1024
      )}KB -> ${Math.round(resizedStats.size / 1024)}KB`
    );
    return fs.readFileSync(compressed).toString("base64");
  }

  private compressReferenceImage(resolvedPath: string): string {
    const tempDir = path.join(os.tmpdir(), "aicomicbuilder-wuyin-refs");
    fs.mkdirSync(tempDir, { recursive: true });
    const outputPath = path.join(tempDir, `${genId()}.jpg`);

    const ffmpegArgs = [
      "-y",
      "-i",
      resolvedPath,
      "-vf",
      `scale=${this.refMaxDimension}:${this.refMaxDimension}:force_original_aspect_ratio=decrease`,
      "-frames:v",
      "1",
      "-q:v",
      "4",
      outputPath,
    ];

    try {
      execFileSync("ffmpeg", ffmpegArgs, { stdio: "ignore" });
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        return outputPath;
      }
    } catch (error) {
      console.warn(
        `[WuyinImage] ffmpeg ref compression failed for ${path.basename(resolvedPath)}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if (process.platform === "darwin") {
      try {
        execFileSync(
          "sips",
          ["-s", "format", "jpeg", "-Z", String(this.refMaxDimension), resolvedPath, "--out", outputPath],
          { stdio: "ignore" }
        );
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
          return outputPath;
        }
      } catch (error) {
        console.warn(
          `[WuyinImage] sips ref compression failed for ${path.basename(resolvedPath)}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return "";
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

    let response: Response;
    try {
      response = await fetch(imageUrl);
    } catch (error) {
      throw new Error(
        `Wuyin remote image fetch network error (${imageUrl}): ${describeFetchError(error)}`
      );
    }
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
