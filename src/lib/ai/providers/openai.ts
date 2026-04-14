import OpenAI from "openai";
import type { AIProvider, TextOptions, ImageOptions } from "../types";
import fs from "node:fs";
import path from "node:path";
import { id as genId } from "@/lib/id";
import {
  isNanoBananaModel,
  normalizeImageModelId,
  normalizeTextModelId,
} from "../model-aliases";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private defaultTextModel: string;
  private defaultImageModel: string;
  private uploadDir: string;
  private nanoBananaMaxAttempts: number;
  private nanoBananaRetryBaseMs: number;
  private nanoBananaTimeoutMs: number;

  constructor(params?: {
    apiKey?: string;
    baseURL?: string;
    model?: string;
    uploadDir?: string;
  }) {
    this.client = new OpenAI({
      apiKey:
        params?.apiKey ||
        process.env.OPENAI_COMPAT_API_KEY ||
        process.env.OPENAI_API_KEY,
      baseURL:
        params?.baseURL ||
        process.env.OPENAI_COMPAT_BASE_URL ||
        process.env.OPENAI_BASE_URL,
    });

    const configuredTextModel =
      params?.model ||
      process.env.OPENAI_COMPAT_MODEL ||
      process.env.OPENAI_MODEL ||
      "gpt-4o";

    this.defaultTextModel = normalizeTextModelId(configuredTextModel);
    this.defaultImageModel = normalizeImageModelId(
      process.env.OPENAI_IMAGE_MODEL ||
        process.env.IMAGE_MODEL_NAME ||
        this.defaultTextModel
    );
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
    this.nanoBananaMaxAttempts = Math.min(
      5,
      parsePositiveInt(process.env.NANOBANANA_MAX_ATTEMPTS, 3)
    );
    this.nanoBananaRetryBaseMs = Math.min(
      15000,
      parsePositiveInt(process.env.NANOBANANA_RETRY_BASE_MS, 1500)
    );
    this.nanoBananaTimeoutMs = Math.min(
      300000,
      parsePositiveInt(process.env.NANOBANANA_TIMEOUT_MS, 120000)
    );
  }

  async generateText(prompt: string, options?: TextOptions): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }

    if (options?.images?.length) {
      const content: OpenAI.Chat.ChatCompletionContentPart[] = [];
      for (const imgPath of options.images) {
        try {
          const imageUrl = this.toImageInputUrl(imgPath);
          if (imageUrl) {
            content.push({ type: "image_url", image_url: { url: imageUrl } });
          }
        } catch {
          // skip unreadable image
        }
      }
      content.push({ type: "text", text: prompt });
      messages.push({ role: "user", content });
    } else {
      messages.push({ role: "user", content: prompt });
    }

    const response = await this.client.chat.completions.create({
      model: normalizeTextModelId(options?.model || this.defaultTextModel),
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
    });
    return response.choices[0]?.message?.content || "";
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    const model = normalizeImageModelId(
      options?.model || this.defaultImageModel || this.defaultTextModel
    );

    if (isNanoBananaModel(model)) {
      return this.generateImageWithNanoBanana(prompt, options, model);
    }

    const isDallE = model.startsWith("dall-e");

    // Build extra params for non-DALL-E OpenAI-compatible providers (e.g. seedream, doubao).
    // These APIs typically accept `size` as "WxH" and/or `aspect_ratio` as "W:H".
    const compatParams: Record<string, unknown> = {};
    if (!isDallE) {
      if (options?.size) compatParams.size = options.size;
      if (options?.aspectRatio) compatParams.aspect_ratio = options.aspectRatio;
      if (!options?.size && !options?.aspectRatio) compatParams.aspect_ratio = "16:9";
    }

    const response = await (
      this.client.images.generate as unknown as (
        params: Record<string, unknown>
      ) => Promise<OpenAI.ImagesResponse>
    )({
      model,
      prompt,
      ...(isDallE && {
        size: (["1024x1024", "1792x1024", "1024x1792"].includes(options?.size ?? "")
          ? options!.size
          : "1792x1024") as "1024x1024" | "1792x1024" | "1024x1792",
        quality: (options?.quality as "standard" | "hd") || "standard",
      }),
      ...compatParams,
      n: 1,
    });

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) throw new Error("No image URL returned from OpenAI");

    const imageResponse = await fetch(imageUrl);
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    return this.writeImageBuffer(buffer, "png");
  }

  private async generateImageWithNanoBanana(
    prompt: string,
    options: ImageOptions | undefined,
    model: string
  ): Promise<string> {
    const userContent = this.buildNanoBananaUserContent(prompt, options);

    const requestParams: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: userContent }],
    };

    if (options?.size) requestParams.size = options.size;
    if (options?.aspectRatio) requestParams.aspect_ratio = options.aspectRatio;

    const createCompletion = (
      params: Record<string, unknown>
    ): Promise<OpenAI.Chat.ChatCompletion> =>
      (
        this.client.chat.completions.create as unknown as (
          input: Record<string, unknown>,
          requestOptions?: { timeout?: number }
        ) => Promise<OpenAI.Chat.ChatCompletion>
      )(params, { timeout: this.nanoBananaTimeoutMs });

    let response: OpenAI.Chat.ChatCompletion | null = null;
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.nanoBananaMaxAttempts; attempt++) {
      try {
        response = await this.tryNanoBananaCompletion(
          createCompletion,
          requestParams,
          options
        );
        break;
      } catch (err) {
        lastError = err;
        const shouldRetry =
          attempt < this.nanoBananaMaxAttempts && this.isTimeoutLikeError(err);
        if (!shouldRetry) {
          throw err;
        }
        const delayMs = this.nanoBananaRetryBaseMs * attempt;
        console.warn(
          `[NanoBanana] Timeout on attempt ${attempt}/${this.nanoBananaMaxAttempts}, retry in ${delayMs}ms`
        );
        await this.sleep(delayMs);
      }
    }

    if (!response) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    const extracted = await this.extractImageAssetFromPayload(response);
    return this.writeImageBuffer(extracted.buffer, extracted.extension);
  }

  private async tryNanoBananaCompletion(
    createCompletion: (
      params: Record<string, unknown>
    ) => Promise<OpenAI.Chat.ChatCompletion>,
    requestParams: Record<string, unknown>,
    options?: ImageOptions
  ): Promise<OpenAI.Chat.ChatCompletion> {
    try {
      return await createCompletion(requestParams);
    } catch (err) {
      if (!options?.size && !options?.aspectRatio) {
        throw err;
      }
      // Some OpenAI-compatible image chat models reject explicit size/aspect fields.
      const fallbackParams = { ...requestParams };
      delete fallbackParams.size;
      delete fallbackParams.aspect_ratio;
      return await createCompletion(fallbackParams);
    }
  }

  private buildNanoBananaUserContent(
    prompt: string,
    options?: ImageOptions
  ): string | OpenAI.Chat.ChatCompletionContentPart[] {
    const refs = options?.referenceImages ?? [];
    if (refs.length === 0) {
      return prompt;
    }

    const text =
      prompt +
      "\n\n以下附带的是已锁定参考图，请严格继承这些已批准资产的稳定造型、空间关系和主识别特征。";

    const content: OpenAI.Chat.ChatCompletionContentPart[] = [
      { type: "text", text },
    ];

    for (const ref of refs) {
      const imageUrl = this.toImageInputUrl(ref);
      if (!imageUrl) continue;
      content.push({
        type: "image_url",
        image_url: {
          url: imageUrl,
          detail: "high",
        },
      });
    }

    return content.length > 1 ? content : prompt;
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isTimeoutLikeError(err: unknown): boolean {
    if (err instanceof Error) {
      if (/timeout|timed out|ETIMEDOUT|ECONNRESET|UND_ERR_CONNECT_TIMEOUT/i.test(err.message)) {
        return true;
      }
      if (/timeout/i.test(err.name)) {
        return true;
      }
    }

    if (!err || typeof err !== "object") {
      return false;
    }

    const record = err as Record<string, unknown>;
    const status = typeof record.status === "number" ? record.status : null;
    if (status === 408 || status === 504 || status === 524) {
      return true;
    }

    const code = typeof record.code === "string" ? record.code : "";
    if (/ETIMEDOUT|ECONNRESET|UND_ERR_CONNECT_TIMEOUT/i.test(code)) {
      return true;
    }

    const cause = record.cause;
    if (cause && cause !== err) {
      return this.isTimeoutLikeError(cause);
    }

    return false;
  }

  private extractImageReferenceFromText(text: string): string | null {
    const dataUrlMatch = text.match(
      /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/
    );
    if (dataUrlMatch?.[0]) return dataUrlMatch[0];

    const markdownImageMatch = text.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i);
    if (markdownImageMatch?.[1]) return markdownImageMatch[1];

    const urlMatch = text.match(/https?:\/\/[^\s)"'>]+/i);
    if (urlMatch?.[0]) return urlMatch[0];

    return null;
  }

  private extractImageReference(payload: unknown, depth = 0): string | null {
    if (depth > 8 || payload === null || payload === undefined) return null;

    if (typeof payload === "string") {
      return this.extractImageReferenceFromText(payload);
    }

    if (Array.isArray(payload)) {
      for (const item of payload) {
        const extracted = this.extractImageReference(item, depth + 1);
        if (extracted) return extracted;
      }
      return null;
    }

    if (typeof payload !== "object") {
      return null;
    }

    const record = payload as Record<string, unknown>;

    const imageUrl = record.image_url;
    if (imageUrl && typeof imageUrl === "object") {
      const url = (imageUrl as Record<string, unknown>).url;
      if (typeof url === "string") {
        const extracted = this.extractImageReferenceFromText(url);
        if (extracted) return extracted;
      }
    }

    if (typeof record.url === "string") {
      const extracted = this.extractImageReferenceFromText(record.url);
      if (extracted) return extracted;
    }

    const mimeType =
      typeof record.mime_type === "string"
        ? record.mime_type
        : typeof record.mimeType === "string"
          ? record.mimeType
          : null;
    const base64Data =
      typeof record.b64_json === "string"
        ? record.b64_json
        : typeof record.data === "string" && mimeType?.startsWith("image/")
          ? record.data
          : null;
    if (mimeType?.startsWith("image/") && base64Data) {
      return `data:${mimeType};base64,${base64Data}`;
    }

    const priorityKeys = [
      "choices",
      "message",
      "content",
      "parts",
      "candidates",
      "data",
      "output",
      "result",
      "response",
      "inline_data",
      "inlineData",
      "file_data",
      "fileData",
    ];

    for (const key of priorityKeys) {
      if (!(key in record)) continue;
      const extracted = this.extractImageReference(record[key], depth + 1);
      if (extracted) return extracted;
    }

    for (const value of Object.values(record)) {
      const extracted = this.extractImageReference(value, depth + 1);
      if (extracted) return extracted;
    }

    return null;
  }

  private async extractImageAssetFromPayload(payload: unknown): Promise<{ buffer: Buffer; extension: string }> {
    const extracted = this.extractImageReference(payload);
    if (!extracted) {
      const preview =
        typeof payload === "string"
          ? payload
          : JSON.stringify(payload).slice(0, 1200);
      throw new Error(`Image model did not return a decodable image payload: ${preview}`);
    }

    if (/^data:image\//i.test(extracted)) {
      const match = extracted.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) {
        throw new Error("Invalid image data URL returned by model");
      }
      const contentType = match[1];
      const extension = this.extensionFromContentType(contentType);
      return {
        buffer: Buffer.from(match[2], "base64"),
        extension,
      };
    }

    const response = await fetch(extracted);
    if (!response.ok) {
      throw new Error(`Remote image fetch failed (${response.status})`);
    }
    const contentType =
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      "image/jpeg";
    const extension = this.extensionFromContentType(contentType);
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, extension };
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
}
