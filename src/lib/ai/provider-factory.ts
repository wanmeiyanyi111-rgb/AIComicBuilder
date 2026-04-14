import { OpenAIProvider } from "./providers/openai";
import { GeminiProvider } from "./providers/gemini";
import { SeedanceProvider } from "./providers/seedance";
import { VeoProvider } from "./providers/veo";
import { KlingImageProvider } from "./providers/kling-image";
import { KlingVideoProvider } from "./providers/kling-video";
import { WanVideoProvider } from "./providers/wan-video";
import { UCloudSeedanceProvider } from "./providers/ucloud-seedance";
import { WuyinImageProvider } from "./providers/wuyin-image";
import { getAIProvider, getVideoProvider } from "./index";
import type { AIProvider, VideoProvider } from "./types";
import {
  CANONICAL_DOUBAO_SEED_2_PRO,
  CANONICAL_NANO_BANANA_2,
  CANONICAL_SEEDANCE_1_5_PRO,
  normalizeImageModelId,
  normalizeTextModelId,
  normalizeVideoModelId,
} from "./model-aliases";

interface ProviderConfig {
  protocol: string;
  baseUrl: string;
  apiKey: string;
  secretKey?: string;
  modelId: string;
}

export interface ModelConfigPayload {
  text?: ProviderConfig | null;
  image?: ProviderConfig | null;
  video?: ProviderConfig | null;
}

function trimAndNormalizeBaseUrl(baseUrl?: string | null): string {
  return (baseUrl || "").trim().replace(/\/+$/, "");
}

function isWuyinBaseUrl(baseUrl?: string | null): boolean {
  const normalized = trimAndNormalizeBaseUrl(baseUrl);
  if (!normalized) return false;
  return /(^https?:\/\/)?([^/]+\.)?wuyinkeji\.com(\/|$)/i.test(normalized);
}

function getEnvTextConfig(): ProviderConfig | null {
  const apiKey =
    process.env.OPENAI_COMPAT_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "";
  if (!apiKey) return null;

  const baseUrl = trimAndNormalizeBaseUrl(
    process.env.OPENAI_COMPAT_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    "https://ark.cn-beijing.volces.com/api/v3"
  );

  const modelId = normalizeTextModelId(
    process.env.OPENAI_COMPAT_MODEL ||
    process.env.OPENAI_MODEL ||
    CANONICAL_DOUBAO_SEED_2_PRO
  );

  return {
    protocol: "openai",
    baseUrl,
    apiKey,
    modelId,
  };
}

function getEnvImageConfig(): ProviderConfig | null {
  const explicitProvider = (process.env.IMAGE_MODEL_PROVIDER || "")
    .trim()
    .toLowerCase();
  const imageApiKey = process.env.IMAGE_MODEL_API_KEY?.trim() || "";
  const fallbackOpenAIKey =
    process.env.OPENAI_COMPAT_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "";
  const wuyinApiKey = process.env.WUYINKEJI_API_KEY?.trim() || "";

  const baseUrl = trimAndNormalizeBaseUrl(
    process.env.IMAGE_MODEL_BASE_URL ||
    process.env.OPENAI_COMPAT_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    "https://ark.cn-beijing.volces.com/api/v3"
  );

  const modelId = normalizeImageModelId(
    process.env.IMAGE_MODEL_NAME ||
    process.env.OPENAI_IMAGE_MODEL ||
    CANONICAL_NANO_BANANA_2
  );

  const wantsWuyin =
    explicitProvider === "wuyin" ||
    isWuyinBaseUrl(baseUrl) ||
    (!imageApiKey && !!wuyinApiKey);

  if (wantsWuyin) {
    const apiKey = wuyinApiKey || imageApiKey;
    if (!apiKey) return null;
    const wuyinBaseUrl = trimAndNormalizeBaseUrl(
      process.env.WUYINKEJI_BASE_URL ||
      (isWuyinBaseUrl(baseUrl) ? baseUrl : "https://api.wuyinkeji.com")
    );
    return {
      protocol: "wuyin",
      baseUrl: wuyinBaseUrl,
      apiKey,
      modelId,
    };
  }

  const apiKey = imageApiKey || fallbackOpenAIKey;
  if (!apiKey) return null;

  return {
    protocol: "openai",
    baseUrl,
    apiKey,
    modelId,
  };
}

function getEnvVideoConfig(): ProviderConfig | null {
  const apiKey =
    process.env.VOLCENGINE_VIDEO_API_KEY?.trim() ||
    process.env.SEEDANCE_API_KEY?.trim() ||
    process.env.OPENAI_COMPAT_API_KEY?.trim() ||
    "";
  if (!apiKey) return null;

  const baseUrl = trimAndNormalizeBaseUrl(
    process.env.VOLCENGINE_VIDEO_BASE_URL ||
    process.env.SEEDANCE_BASE_URL ||
    "https://ark.cn-beijing.volces.com/api/v3"
  );

  const modelId = normalizeVideoModelId(
    process.env.VOLCENGINE_VIDEO_MODEL ||
    process.env.SEEDANCE_MODEL ||
    CANONICAL_SEEDANCE_1_5_PRO
  );

  return {
    protocol: "seedance",
    baseUrl,
    apiKey,
    modelId,
  };
}

export function createAIProvider(
  config: ProviderConfig,
  capability: "text" | "image",
  uploadDir?: string
): AIProvider {
  const forceWuyinForImage =
    capability === "image" &&
    (config.protocol === "wuyin" ||
      (config.protocol === "openai" && isWuyinBaseUrl(config.baseUrl)));
  if (forceWuyinForImage) {
    return new WuyinImageProvider({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      ...(uploadDir && { uploadDir }),
    });
  }

  const normalizedModelId =
    capability === "image"
      ? normalizeImageModelId(config.modelId)
      : normalizeTextModelId(config.modelId);

  switch (config.protocol) {
    case "openai":
      return new OpenAIProvider({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        model: normalizedModelId,
        ...(uploadDir && { uploadDir }),
      });
    case "gemini":
      return new GeminiProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: normalizedModelId,
        ...(uploadDir && { uploadDir }),
      });
    case "kling":
      return new KlingImageProvider({
        apiKey: config.apiKey,
        secretKey: config.secretKey,
        baseUrl: config.baseUrl,
        model: normalizedModelId,
        ...(uploadDir && { uploadDir }),
      });
    default:
      throw new Error(`Unsupported AI protocol: ${config.protocol}`);
  }
}

export function createVideoProvider(config: ProviderConfig, uploadDir?: string): VideoProvider {
  const normalizedModelId = normalizeVideoModelId(config.modelId);
  switch (config.protocol) {
    case "seedance":
      return new SeedanceProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: normalizedModelId,
        ...(uploadDir && { uploadDir }),
      });
    case "gemini":
      return new VeoProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: normalizedModelId,
        ...(uploadDir && { uploadDir }),
      });
    case "kling":
      return new KlingVideoProvider({
        apiKey: config.apiKey,
        secretKey: config.secretKey,
        baseUrl: config.baseUrl,
        model: normalizedModelId,
        ...(uploadDir && { uploadDir }),
      });
    case "wan":
      return new WanVideoProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "ucloud-seedance":
      return new UCloudSeedanceProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    default:
      throw new Error(`Unsupported video protocol: ${config.protocol}`);
  }
}

export function resolveAIProvider(modelConfig?: ModelConfigPayload): AIProvider {
  if (modelConfig?.text) {
    return createAIProvider(modelConfig.text, "text");
  }
  const envText = getEnvTextConfig();
  if (envText) {
    return createAIProvider(envText, "text");
  }
  return getAIProvider();
}

export function resolveImageProvider(modelConfig?: ModelConfigPayload, uploadDir?: string): AIProvider {
  if (modelConfig?.image) {
    return createAIProvider(modelConfig.image, "image", uploadDir);
  }
  const envImage = getEnvImageConfig();
  if (envImage) {
    return createAIProvider(envImage, "image", uploadDir);
  }
  return getAIProvider(uploadDir);
}

export function resolveVideoProvider(modelConfig?: ModelConfigPayload, uploadDir?: string): VideoProvider {
  if (modelConfig?.video) {
    return createVideoProvider(modelConfig.video, uploadDir);
  }
  const envVideo = getEnvVideoConfig();
  if (envVideo) {
    return createVideoProvider(envVideo, uploadDir);
  }
  return getVideoProvider(uploadDir);
}
