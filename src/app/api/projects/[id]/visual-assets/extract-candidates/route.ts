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
import { id as genId } from "@/lib/id";
import type { ModelConfig } from "../../generate/types";
import { buildProjectStyleHint } from "../helpers";

type CandidateItem = {
  name: string;
  prompt: string;
};

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

function buildExtractionInput(
  script: string,
  maxScenes: number,
  maxProps: number,
  projectStyleHint: string
): string {
  return [
    `提取数量上限：场景 ${maxScenes} 条，道具 ${maxProps} 条。`,
    projectStyleHint ? `项目风格信息：${projectStyleHint}` : "",
    "硬性要求：每条 scene/prop 的 prompt 必须明确包含与项目风格一致的画风、材质、光照和色彩线索，禁止只写物体名；场景还必须带景别/机位/焦段等镜头语言。",
    "剧本：",
    script,
  ]
    .filter(Boolean)
    .join("\n");
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
  const { text } = await generateText({
    model,
    system: systemPrompt,
    temperature: 0.2,
    maxOutputTokens: 1800,
    prompt: buildExtractionInput(script, maxScenes, maxProps, projectStyleHint),
  });

  let parsed: { scenes?: unknown[]; props?: unknown[] };
  try {
    parsed = JSON.parse(extractJSON(text)) as { scenes?: unknown[]; props?: unknown[] };
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
    (Array.isArray(parsed.scenes) ? parsed.scenes : [])
      .map((item, index) => normalizeCandidate(item, "场景", index))
      .filter((item): item is CandidateItem => !!item)
      .slice(0, maxScenes)
  );

  const props = dedupeCandidates(
    (Array.isArray(parsed.props) ? parsed.props : [])
      .map((item, index) => normalizeCandidate(item, "道具", index))
      .filter((item): item is CandidateItem => !!item)
      .slice(0, maxProps)
  );

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

  const now = new Date();
  const inserts: Array<typeof visualAssets.$inferInsert> = [];
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
    existingByKey.set(key, {
      id: "",
      type: "scene",
      name: item.name,
      prompt: item.prompt,
    });
    inserts.push({
      id: genId(),
      projectId,
      episodeId,
      type: "scene",
      name: item.name,
      prompt: item.prompt,
      status: "pending",
      errorMessage: "",
      createdAt: now,
      updatedAt: now,
    });
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
    existingByKey.set(key, {
      id: "",
      type: "prop",
      name: item.name,
      prompt: item.prompt,
    });
    inserts.push({
      id: genId(),
      projectId,
      episodeId,
      type: "prop",
      name: item.name,
      prompt: item.prompt,
      status: "pending",
      errorMessage: "",
      createdAt: now,
      updatedAt: now,
    });
  }

  if (inserts.length > 0) {
    await db.insert(visualAssets).values(inserts);
  }
  if (updates.length > 0) {
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
      `场景/道具提取完成：场景 ${scenes.length}，道具 ${props.length}，新增 ${inserts.length}，更新 ${updates.length}`,
      { scenes, props, created: inserts.length, updated: updates.length }
    );
  }

  const createdScenes = inserts.filter((item) => item.type === "scene").length;
  const createdProps = inserts.filter((item) => item.type === "prop").length;
  const updatedScenes = updates.filter((item) => item.type === "scene").length;
  const updatedProps = updates.filter((item) => item.type === "prop").length;

  return NextResponse.json({
    extractedScenes: scenes.length,
    extractedProps: props.length,
    created: inserts.length,
    createdScenes,
    createdProps,
    updated: updates.length,
    updatedScenes,
    updatedProps,
    scenes,
    props,
  });
}
