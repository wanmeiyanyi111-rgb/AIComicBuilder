import { generateText } from "ai";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import { hasTextModelConfig } from "@/lib/ai/config-presence";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { addImportLog } from "@/lib/import-utils";
import { db } from "@/lib/db";
import { episodes, visualAssets } from "@/lib/db/schema";
import {
  ensureEpisodeVisualAsset,
  normalizeScopedResourceName,
} from "@/lib/episode-resources";
import type { ModelConfig } from "../../generate/types";
import { buildProjectStyleHint } from "../helpers";

type CandidateItem = {
  name: string;
  prompt: string;
};

type ExtractionResult = {
  scenes?: unknown[];
  props?: unknown[];
  sceneCandidates?: unknown[];
  propCandidates?: unknown[];
};

type ExtractionKind = "scenes" | "props";

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeCandidate(raw: unknown, fallbackPrefix: string, index: number): CandidateItem | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const rawName =
    (typeof record.name === "string" && record.name) ||
    (typeof record.title === "string" && record.title) ||
    (typeof record.label === "string" && record.label) ||
    "";

  const rawPrompt =
    (typeof record.prompt === "string" && record.prompt) ||
    (typeof record.description === "string" && record.description) ||
    "";

  const name = normalizeText(rawName);
  const prompt = normalizeText(rawPrompt || rawName || `${fallbackPrefix}${index + 1}`);

  if (!name) return null;

  return {
    name: name.slice(0, 80),
    prompt: prompt.slice(0, 1200),
  };
}

function dedupeCandidates(items: CandidateItem[]): CandidateItem[] {
  const keys = new Set<string>();
  const output: CandidateItem[] = [];

  for (const item of items) {
    const key = item.name.toLowerCase().trim();
    if (!key || keys.has(key)) continue;
    keys.add(key);
    output.push(item);
  }

  return output;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s"'`“”‘’《》〈〉【】（）()\[\]、，。！？；：:,.!?/\\\-_=+]/g, "");
}

function countNameOccurrences(script: string, name: string): number {
  const normalizedName = normalizeText(name);
  if (!normalizedName) return 0;

  const regex = new RegExp(escapeRegExp(normalizedName), "giu");
  const directMatches = script.match(regex)?.length ?? 0;
  if (directMatches > 0) return directMatches;

  const compactScript = normalizeForMatch(script);
  const compactName = normalizeForMatch(normalizedName);
  if (!compactName) return 0;

  let count = 0;
  let startIndex = 0;
  while (startIndex < compactScript.length) {
    const index = compactScript.indexOf(compactName, startIndex);
    if (index < 0) break;
    count += 1;
    startIndex = index + compactName.length;
  }
  return count;
}

function filterRecurringProps(items: CandidateItem[], script: string): CandidateItem[] {
  const recurring = items.filter((item) => countNameOccurrences(script, item.name) >= 2);
  return recurring;
}

function buildExtractionInput(
  script: string,
  maxScenes: number,
  maxProps: number,
  projectStyleHint: string,
  kind: ExtractionKind
): string {
  return [
    `提取数量上限：场景 ${maxScenes} 条，道具 ${maxProps} 条。`,
    projectStyleHint ? `项目风格信息：${projectStyleHint}` : "",
    "硬性要求：每条 scene/prop 的 prompt 必须明确包含与项目风格一致的画风、材质、光照和色彩线索，禁止只写物体名；场景还必须带景别/机位/焦段等镜头语言。",
    kind === "scenes"
      ? "本轮只提取 scenes。props 必须返回空数组 []。优先覆盖关键物理场景，不要输出道具。"
      : "本轮只提取 props。scenes 必须返回空数组 []。优先提取可单独成图、对白底或可抠图的关键道具，不要输出场景。只保留反复出现、推动剧情、作为证据/象征物/标志性物件持续复用的道具；一次性路过的小物件、餐具、普通陈设、只出现一次就消失的消耗品不要提取。",
    "剧本：",
    script,
  ]
    .filter(Boolean)
    .join("\n");
}

function parseExtractionResult(text: string): ExtractionResult {
  return JSON.parse(extractJSON(text)) as ExtractionResult;
}

async function runExtractionPass(params: {
  model: ReturnType<typeof createLanguageModel>;
  systemPrompt: string;
  prompt: string;
  kind: ExtractionKind;
  projectId: string;
  shouldLogImport: boolean;
}): Promise<ExtractionResult> {
  const { model, systemPrompt, prompt, kind, projectId, shouldLogImport } = params;
  const jsonMode = {
    openai: { response_format: { type: "json_object" } },
  };

  const firstPass = await generateText({
    model,
    system: systemPrompt,
    temperature: 0.2,
    maxOutputTokens: 2200,
    providerOptions: jsonMode,
    prompt,
  });

  try {
    return parseExtractionResult(firstPass.text);
  } catch (firstError) {
    console.error(
      `[ScenePropExtract:${kind}] JSON parse failed on first pass. Raw:\n${firstPass.text.slice(0, 1600)}`
    );
    if (shouldLogImport) {
      await addImportLog(
        projectId,
        3,
        "running",
        `${kind === "scenes" ? "场景" : "道具"}候选解析失败，正在重试紧凑 JSON 输出...`
      );
    }

    const retry = await generateText({
      model,
      system: systemPrompt,
      temperature: 0.1,
      maxOutputTokens: 2200,
      providerOptions: jsonMode,
      prompt: [
        prompt,
        "",
        "IMPORTANT:",
        "- Return COMPLETE, VALID JSON only.",
        "- Do not include any explanation before or after the JSON object.",
        "- Use compact JSON with minimal whitespace and no markdown fences.",
        `- ${kind === "scenes" ? "scenes" : "props"} must contain the extracted results for this pass.`,
        `- ${kind === "scenes" ? "props" : "scenes"} must be [].`,
      ].join("\n"),
    });

    try {
      return parseExtractionResult(retry.text);
    } catch {
      console.error(
        `[ScenePropExtract:${kind}] JSON parse failed on retry. Raw:\n${retry.text.slice(0, 1600)}`
      );
      throw firstError;
    }
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const ownedProject = await assertProjectOwnership(request, projectId);
  if (!ownedProject) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    episodeId?: string;
    maxScenes?: number;
    maxProps?: number;
    text?: string;
    importMode?: boolean;
    refreshExisting?: boolean;
    modelConfig?: ModelConfig;
  };

  if (!hasTextModelConfig(body.modelConfig)) {
    return NextResponse.json({ error: "No text model configured" }, { status: 400 });
  }

  const maxScenes = Math.min(20, Math.max(1, Number(body.maxScenes) || 8));
  const maxProps = Math.min(30, Math.max(1, Number(body.maxProps) || 12));
  const episodeId = body.episodeId?.trim() || null;
  const shouldLogImport = !!body.importMode;
  const refreshExisting = body.refreshExisting === true;

  let script = body.text?.trim() || "";
  if (!script && episodeId) {
    const [episode] = await db
      .select({ script: episodes.script })
      .from(episodes)
      .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)));

    if (!episode) {
      return NextResponse.json({ error: "Episode not found" }, { status: 404 });
    }
    script = episode.script || "";
  } else if (!script) {
    script = ownedProject.script || "";
  }

  if (!script.trim()) {
    if (shouldLogImport) {
      await addImportLog(projectId, 3, "error", "场景/道具提取失败：未找到可用剧本");
    }
    return NextResponse.json(
      { error: "No script found. Please generate or import script first." },
      { status: 400 }
    );
  }

  if (shouldLogImport) {
    await addImportLog(projectId, 3, "running", "开始提取场景与道具候选...");
  }
  const projectStyleHint = buildProjectStyleHint(ownedProject);

  const model = createLanguageModel(body.modelConfig?.text);
  const systemPrompt = await resolvePrompt("scene_prop_extract", {
    userId: ownedProject.userId,
    projectId,
  });

  let sceneParsed: ExtractionResult;
  let propParsed: ExtractionResult;
  try {
    sceneParsed = await runExtractionPass({
      model,
      systemPrompt,
      kind: "scenes",
      projectId,
      shouldLogImport,
      prompt: buildExtractionInput(
        script,
        maxScenes,
        maxProps,
        projectStyleHint,
        "scenes"
      ),
    });
    propParsed = await runExtractionPass({
      model,
      systemPrompt,
      kind: "props",
      projectId,
      shouldLogImport,
      prompt: buildExtractionInput(
        script,
        maxScenes,
        maxProps,
        projectStyleHint,
        "props"
      ),
    });
  } catch {
    if (shouldLogImport) {
      await addImportLog(projectId, 3, "error", "场景/道具提取失败：模型输出解析失败");
    }
    return NextResponse.json(
      { error: "Failed to parse extraction result" },
      { status: 500 }
    );
  }

  const scenes = dedupeCandidates(
    (
      Array.isArray(sceneParsed.scenes)
        ? sceneParsed.scenes
        : Array.isArray(sceneParsed.sceneCandidates)
          ? sceneParsed.sceneCandidates
          : []
    )
      .map((item, index) => normalizeCandidate(item, "场景", index))
      .filter((item): item is CandidateItem => !!item)
      .slice(0, maxScenes)
  );

  const rawProps = dedupeCandidates(
    (
      Array.isArray(propParsed.props)
        ? propParsed.props
        : Array.isArray(propParsed.propCandidates)
          ? propParsed.propCandidates
          : []
    )
      .map((item, index) => normalizeCandidate(item, "道具", index))
      .filter((item): item is CandidateItem => !!item)
      .slice(0, maxProps)
  );
  const props = filterRecurringProps(rawProps, script).slice(0, maxProps);

  const scopeCondition = episodeId
    ? eq(visualAssets.episodeId, episodeId)
    : isNull(visualAssets.episodeId);

  const existing = await db
    .select({
      id: visualAssets.id,
      type: visualAssets.type,
      name: visualAssets.name,
      prompt: visualAssets.prompt,
    })
    .from(visualAssets)
    .where(and(eq(visualAssets.projectId, projectId), scopeCondition));

  const existingByKey = new Map(
    existing.map((item) => [
      `${item.type}:${normalizeText(item.name).toLowerCase()}`,
      item,
    ])
  );

  const createdRows: Array<{ type: "scene" | "prop"; id: string; reusedSourceId?: string }> = [];
  const updates: Array<{ id: string; type: "scene" | "prop"; prompt: string }> = [];

  for (const item of scenes) {
    const key = `scene:${item.name.toLowerCase()}`;
    const existingRow = existingByKey.get(key);
    if (existingRow) {
      if (refreshExisting && normalizeText(existingRow.prompt || "") !== item.prompt) {
        updates.push({ id: existingRow.id, type: "scene", prompt: item.prompt });
      }
      continue;
    }
    const result = await ensureEpisodeVisualAsset({
      projectId,
      episodeId,
      type: "scene",
      name: normalizeScopedResourceName(item.name),
      prompt: item.prompt,
      updatePromptIfExists: false,
    });
    existingByKey.set(key, {
      id: result.asset.id,
      type: "scene",
      name: result.asset.name,
      prompt: result.asset.prompt,
    });
    if (result.created) {
      createdRows.push({
        type: "scene",
        id: result.asset.id,
        reusedSourceId: result.reusedSourceId,
      });
    }
  }

  for (const item of props) {
    const key = `prop:${item.name.toLowerCase()}`;
    const existingRow = existingByKey.get(key);
    if (existingRow) {
      if (refreshExisting && normalizeText(existingRow.prompt || "") !== item.prompt) {
        updates.push({ id: existingRow.id, type: "prop", prompt: item.prompt });
      }
      continue;
    }
    const result = await ensureEpisodeVisualAsset({
      projectId,
      episodeId,
      type: "prop",
      name: normalizeScopedResourceName(item.name),
      prompt: item.prompt,
      updatePromptIfExists: false,
    });
    existingByKey.set(key, {
      id: result.asset.id,
      type: "prop",
      name: result.asset.name,
      prompt: result.asset.prompt,
    });
    if (result.created) {
      createdRows.push({
        type: "prop",
        id: result.asset.id,
        reusedSourceId: result.reusedSourceId,
      });
    }
  }
  if (updates.length > 0) {
    const now = new Date();
    for (const item of updates) {
      await db
        .update(visualAssets)
        .set({ prompt: item.prompt, updatedAt: now })
        .where(eq(visualAssets.id, item.id));
    }
  }

  if (shouldLogImport) {
    await addImportLog(
      projectId,
      3,
      "done",
      `场景/道具提取完成：场景 ${scenes.length}，道具 ${props.length}，新增 ${createdRows.length}，更新 ${updates.length}`,
      {
        scenes,
        props,
        filteredSingleUseProps: Math.max(0, rawProps.length - props.length),
        created: createdRows.length,
        reusedFromOtherEpisode: createdRows.filter((item) => !!item.reusedSourceId).length,
        updated: updates.length,
      }
    );
  }

  const createdScenes = createdRows.filter((item) => item.type === "scene").length;
  const createdProps = createdRows.filter((item) => item.type === "prop").length;
  const updatedScenes = updates.filter((item) => item.type === "scene").length;
  const updatedProps = updates.filter((item) => item.type === "prop").length;

  return NextResponse.json({
    extractedScenes: scenes.length,
    extractedProps: props.length,
    filteredSingleUseProps: Math.max(0, rawProps.length - props.length),
    created: createdRows.length,
    createdScenes,
    createdProps,
    updated: updates.length,
    updatedScenes,
    updatedProps,
    scenes,
    props,
  });
}
