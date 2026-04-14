import { NextResponse } from "next/server";
import {
  CANONICAL_DOUBAO_SEED_2_PRO,
  CANONICAL_NANO_BANANA_2,
  CANONICAL_SEEDANCE_1_5_PRO,
} from "@/lib/ai/model-aliases";

interface ListRequest {
  protocol: string;
  baseUrl: string;
  apiKey: string;
}

interface ModelItem {
  id: string;
  name: string;
}

const OPENAI_RECOMMENDED_MODELS: ModelItem[] = [
  { id: CANONICAL_DOUBAO_SEED_2_PRO, name: "Doubao-Seed-2.0-pro" },
  { id: CANONICAL_NANO_BANANA_2, name: "NanoBanana2" },
];

const SEEDANCE_PRESET_MODELS: ModelItem[] = [
  { id: CANONICAL_SEEDANCE_1_5_PRO, name: "seedance1.5pro" },
  { id: "doubao-seedance-1-5-pro-250528", name: "Seedance 1.5 Pro (250528)" },
  { id: "doubao-seedance-2-0-260128", name: "Seedance 2.0 (260128)" },
];

const WUYIN_PRESET_MODELS: ModelItem[] = [
  { id: CANONICAL_NANO_BANANA_2, name: "NanoBanana2" },
];

function buildModelsUrl(baseUrl: string): string {
  const url = baseUrl.replace(/\/+$/, "");
  // Volcengine Ark models endpoint
  if (url.endsWith("/api/v3")) {
    return url + "/models";
  }
  // If baseUrl already ends with /v1, don't duplicate
  if (url.endsWith("/v1")) {
    return url + "/models";
  }
  // Common Ark host form: https://ark.cn-beijing.volces.com
  if (/ark\.cn-beijing\.volces\.com$/i.test(url)) {
    return url + "/api/v3/models";
  }
  return url + "/v1/models";
}

async function fetchModels(baseUrl: string, apiKey: string): Promise<ModelItem[]> {
  const url = buildModelsUrl(baseUrl);
  console.log("[models/list] Fetching:", url);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { data?: { id: string }[] };
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error("Unexpected response format: missing data array");
  }
  return data.data.map((m) => ({ id: m.id, name: m.id }));
}

function mergeRecommendedModels(models: ModelItem[], recommended: ModelItem[]) {
  const dedup = new Map<string, ModelItem>();
  for (const m of [...recommended, ...models]) {
    if (!dedup.has(m.id)) dedup.set(m.id, m);
  }
  return Array.from(dedup.values());
}

async function fetchGeminiModels(baseUrl: string, apiKey: string): Promise<ModelItem[]> {
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  console.log("[models/list] Fetching Gemini:", url.replace(apiKey, "***"));

  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { models?: { name: string; displayName?: string }[] };
  if (!data.models || !Array.isArray(data.models)) {
    throw new Error("Unexpected Gemini response format: missing models array");
  }
  return data.models.map((m) => {
    const id = m.name.replace(/^models\//, "");
    return { id, name: m.displayName || id };
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ListRequest;

    if (body.protocol === "seedance") {
      return NextResponse.json({ models: SEEDANCE_PRESET_MODELS });
    }

    if (body.protocol === "kling") {
      return NextResponse.json({
        models: [
          { id: "kling-v1", name: "Kling v1" },
          { id: "kling-v1-5", name: "Kling v1.5" },
          { id: "kling-v1-6", name: "Kling v1.6" },
          { id: "kling-v2", name: "Kling v2" },
          { id: "kling-v2-new", name: "Kling v2 New" },
          { id: "kling-v2-1", name: "Kling v2.1" },
          { id: "kling-v2-master", name: "Kling v2 Master" },
          { id: "kling-v2-1-master", name: "Kling v2.1 Master" },
          { id: "kling-v2-5-turbo", name: "Kling v2.5 Turbo" },
        ],
      });
    }

    if (body.protocol === "ucloud-seedance") {
      return NextResponse.json({
        models: [
          { id: "doubao-seedance-1-5-pro-251215", name: "Seedance 1.5 Pro (UCloud)" },
          { id: "doubao-seedance-2-0-260128", name: "Seedance 2.0 (UCloud)" },
        ],
      });
    }

    if (body.protocol === "wan") {
      return NextResponse.json({
        models: [
          { id: "wan2.7-t2v", name: "Wan 2.7 文生视频" },
          { id: "wan2.7-r2v", name: "Wan 2.7 参考生视频" },
          { id: "wan2.6-t2v", name: "Wan 2.6 文生视频" },
          { id: "wan2.6-i2v-flash", name: "Wan 2.6 图生视频 Flash" },
          { id: "wan2.6-i2v", name: "Wan 2.6 图生视频" },
          { id: "wan2.6-r2v", name: "Wan 2.6 参考生视频" },
          { id: "wan2.6-r2v-flash", name: "Wan 2.6 参考生视频 Flash" },
        ],
      });
    }

    if (body.protocol === "wuyin") {
      return NextResponse.json({ models: WUYIN_PRESET_MODELS });
    }

    if (!body.baseUrl) {
      return NextResponse.json({ error: "Base URL is required" }, { status: 400 });
    }
    if (!body.apiKey) {
      return NextResponse.json({ error: "API Key is required" }, { status: 400 });
    }

    if (body.protocol === "openai") {
      try {
        const models = await fetchModels(body.baseUrl, body.apiKey);
        return NextResponse.json({
          models: mergeRecommendedModels(models, OPENAI_RECOMMENDED_MODELS),
        });
      } catch {
        // Some OpenAI-compatible services disable model listing; keep UX usable.
        return NextResponse.json({ models: OPENAI_RECOMMENDED_MODELS });
      }
    }

    const models = body.protocol === "gemini"
      ? await fetchGeminiModels(body.baseUrl, body.apiKey)
      : await fetchModels(body.baseUrl, body.apiKey);
    return NextResponse.json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[models/list] Error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
