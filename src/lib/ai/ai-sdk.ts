import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { CANONICAL_DOUBAO_SEED_2_PRO, normalizeTextModelId } from "./model-aliases";

export interface ProviderConfig {
  protocol: string;
  baseUrl: string;
  apiKey: string;
  secretKey?: string;
  modelId: string;
}

function resolveTextProviderConfig(config?: ProviderConfig | null): ProviderConfig | null {
  if (config?.apiKey?.trim()) {
    return {
      ...config,
      protocol: (config.protocol || "openai").trim(),
      baseUrl: (config.baseUrl || "").trim(),
      apiKey: config.apiKey.trim(),
      modelId: normalizeTextModelId(config.modelId),
    };
  }

  const openaiApiKey =
    process.env.OPENAI_COMPAT_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "";
  if (openaiApiKey) {
    return {
      protocol: "openai",
      baseUrl:
        process.env.OPENAI_COMPAT_BASE_URL?.trim() ||
        process.env.OPENAI_BASE_URL?.trim() ||
        "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: openaiApiKey,
      modelId: normalizeTextModelId(
        process.env.OPENAI_COMPAT_MODEL ||
          process.env.OPENAI_MODEL ||
          CANONICAL_DOUBAO_SEED_2_PRO
      ),
    };
  }

  const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || "";
  if (geminiApiKey) {
    return {
      protocol: "gemini",
      baseUrl:
        process.env.GEMINI_BASE_URL?.trim() ||
        "https://generativelanguage.googleapis.com",
      apiKey: geminiApiKey,
      modelId: process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash",
    };
  }

  return null;
}

export function createLanguageModel(config?: ProviderConfig | null): LanguageModel {
  const resolved = resolveTextProviderConfig(config);
  if (!resolved) {
    throw new Error("No text model configured");
  }

  switch (resolved.protocol) {
    case "openai": {
      const provider = createOpenAI({
        apiKey: resolved.apiKey,
        baseURL: resolved.baseUrl,
      });
      return provider.chat(resolved.modelId);
    }
    case "gemini": {
      const provider = createGoogleGenerativeAI({
        apiKey: resolved.apiKey,
      });
      return provider(resolved.modelId);
    }
    default:
      throw new Error(`Unsupported protocol: ${resolved.protocol}`);
  }
}

/**
 * Strip markdown code fences from AI response if present.
 */
export function extractJSON(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = match ? match[1].trim() : text.trim();
  // Remove control characters that break JSON.parse (except \n \r \t)
  return raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}
