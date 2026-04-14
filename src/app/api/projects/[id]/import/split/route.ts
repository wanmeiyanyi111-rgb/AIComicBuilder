import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import { hasTextModelConfig } from "@/lib/ai/config-presence";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { addImportLog, chunkText } from "@/lib/import-utils";
import {
  buildScriptSplitPrompt,
  SCRIPT_SPLIT_ASSET_RULES,
} from "@/lib/ai/prompts/script-split";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";

export const maxDuration = 300;

interface SplitEpisode {
  title: string;
  description: string;
  keywords: string;
  idea: string;
  characters?: string[];
  scenes?: string[];
  props?: string[];
}

interface CharacterSummary {
  name: string;
  scope: string;
}

interface NamedCandidate {
  name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toStringSafe(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeCharacters(value: unknown): string[] {
  return normalizeNameList(value);
}

function normalizeNameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toStringSafe(item))
    .filter(Boolean)
    .slice(0, 50);
}

function normalizeListToCandidates(
  items: string[] | undefined,
  candidates: string[]
): string[] {
  const source = items || [];
  if (source.length === 0) return [];
  if (candidates.length === 0) {
    return [...new Set(source.map((s) => s.trim()).filter(Boolean))].slice(0, 20);
  }

  const candidateByKey = new Map<string, string>();
  for (const name of candidates) {
    const key = name.toLowerCase().trim();
    if (!key) continue;
    candidateByKey.set(key, name);
  }

  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    const key = item.toLowerCase().trim();
    if (!key) continue;
    const canonical = candidateByKey.get(key);
    if (!canonical) continue;
    const dedupeKey = canonical.toLowerCase().trim();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    output.push(canonical);
    if (output.length >= 20) break;
  }
  return output;
}

function isEpisodeLike(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const title = toStringSafe(value.title);
  const description = toStringSafe(value.description);
  const idea = toStringSafe(value.idea);
  const summary = toStringSafe(value.summary);
  return !!(title || description || idea || summary);
}

function normalizeEpisode(value: unknown, index: number): SplitEpisode {
  if (!isRecord(value)) {
    return {
      title: `第${index + 1}集`,
      description: "",
      keywords: "",
      idea: "",
      characters: [],
    };
  }

  const title =
    toStringSafe(value.title) ||
    toStringSafe(value.name) ||
    toStringSafe(value.episodeTitle) ||
    `第${index + 1}集`;

  const description =
    toStringSafe(value.description) ||
    toStringSafe(value.summary) ||
    toStringSafe(value.logline) ||
    "";

  const keywords =
    toStringSafe(value.keywords) ||
    toStringSafe(value.tags) ||
    "";

  const idea =
    toStringSafe(value.idea) ||
    toStringSafe(value.plot) ||
    description;

  const characters = normalizeCharacters(
    value.characters ?? value.characterNames ?? value.cast
  );
  const scenes = normalizeNameList(value.scenes ?? value.sceneNames ?? value.locations);
  const props = normalizeNameList(value.props ?? value.propNames ?? value.objects);

  return { title, description, keywords, idea, characters, scenes, props };
}

function collectEpisodeLikeArrays(root: unknown): Array<Record<string, unknown>[]> {
  const queue: unknown[] = [root];
  const found: Array<Record<string, unknown>[]> = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    if (Array.isArray(current)) {
      const episodeLikeItems = current.filter(isEpisodeLike);
      if (episodeLikeItems.length > 0) {
        found.push(episodeLikeItems);
      }
      for (const item of current) queue.push(item);
      continue;
    }

    if (isRecord(current)) {
      for (const value of Object.values(current)) {
        queue.push(value);
      }
    }
  }

  return found;
}

function extractEpisodesFromParsed(parsed: unknown): SplitEpisode[] {
  if (Array.isArray(parsed)) {
    const normalized = parsed
      .filter(isEpisodeLike)
      .map((item, index) => normalizeEpisode(item, index));
    if (normalized.length > 0) return normalized;
  }

  if (isRecord(parsed)) {
    const directCandidates = [
      parsed.episodes,
      parsed.data,
      parsed.result,
      parsed.items,
      parsed.list,
    ];

    for (const candidate of directCandidates) {
      if (!Array.isArray(candidate)) continue;
      const normalized = candidate
        .filter(isEpisodeLike)
        .map((item, index) => normalizeEpisode(item, index));
      if (normalized.length > 0) return normalized;
    }

    if (isEpisodeLike(parsed)) {
      return [normalizeEpisode(parsed, 0)];
    }
  }

  const nested = collectEpisodeLikeArrays(parsed);
  if (nested.length > 0) {
    return nested[0].map((item, index) => normalizeEpisode(item, index));
  }

  throw new Error("Invalid JSON structure");
}

function parseEpisodesFromModelText(text: string): SplitEpisode[] {
  const cleaned = extractJSON(text).trim();
  const candidates = [
    cleaned,
    cleaned.slice(cleaned.indexOf("["), cleaned.lastIndexOf("]") + 1),
    cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1),
  ].filter((item, index, arr) => !!item && arr.indexOf(item) === index);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      return extractEpisodesFromParsed(parsed);
    } catch {
      // try next candidate
    }
  }

  throw new Error("Invalid JSON structure");
}

function buildEmergencySplitPrompt(
  scriptChunk: string,
  allCharacterNames: string[],
  allSceneNames: string[],
  allPropNames: string[]
): string {
  return [
    "你是分集 JSON 生成器。请把文本拆分成可执行分集结果。",
    "仅输出有效 JSON，格式必须是：",
    '{"episodes":[{"title":"...","description":"...","keywords":"...","idea":"...","characters":["..."],"scenes":["..."],"props":["..."]}]}',
    "硬约束：",
    "- 只输出 JSON，不要任何解释",
    "- episodes 控制在 1-4 集",
    "- idea 保持 120-300 字，不要超长",
    "- characters 只能使用给定角色名单中的名字",
    "- scenes 只能使用给定场景名单中的名字",
    "- props 只能使用给定道具名单中的名字",
    "",
    `角色名单：${allCharacterNames.join(", ") || "无"}`,
    `场景名单：${allSceneNames.join(", ") || "无"}`,
    `道具名单：${allPropNames.join(", ") || "无"}`,
    "",
    "待拆分文本：",
    scriptChunk,
  ].join("\n");
}

function deterministicFallbackEpisode(
  chunk: string,
  chunkIndex: number,
  allCharacterNames: string[],
  allSceneNames: string[],
  allPropNames: string[]
): SplitEpisode[] {
  const compact = chunk.replace(/\s+/g, " ").trim();
  const short = compact.slice(0, 220);
  const idea = compact.slice(0, 1800);
  return [
    {
      title: `第${chunkIndex + 1}集`,
      description: short || "剧情推进",
      keywords: "",
      idea: idea || short || "待补充",
      characters: allCharacterNames.slice(0, 6),
      scenes: allSceneNames.slice(0, 3),
      props: allPropNames.slice(0, 5),
    },
  ];
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const project = await assertProjectOwnership(request, projectId);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const userId = project.userId;

  const body = (await request.json()) as {
    text: string;
    allCharacters: CharacterSummary[];
    sceneCandidates?: NamedCandidate[];
    propCandidates?: NamedCandidate[];
    modelConfig: { text: ProviderConfig | null };
  };

  if (!hasTextModelConfig(body.modelConfig)) {
    return NextResponse.json({ error: "No text model" }, { status: 400 });
  }

  const chunks = chunkText(body.text);
  const model = createLanguageModel(body.modelConfig?.text);
  const scriptSplitSystem = await resolvePrompt("script_split", { userId, projectId });

  await addImportLog(
    projectId, 4, "running",
    `开始自动分集，共 ${chunks.length} 块`
  );

  // Build character context for prompt
  const allNames = body.allCharacters.map((c) => c.name);
  const allSceneNames = (body.sceneCandidates || [])
    .map((s) => toStringSafe(s?.name))
    .filter(Boolean);
  const allPropNames = (body.propCandidates || [])
    .map((p) => toStringSafe(p?.name))
    .filter(Boolean);
  const charContext = allNames.length > 0
    ? `\n\nAll extracted characters (assign each to ONLY the episodes where they actually appear): ${allNames.join(", ")}`
    : "";
  const sceneContext = allSceneNames.length > 0
    ? `\n\nScene candidates (assign each to ONLY episodes where they truly appear): ${allSceneNames.join(", ")}`
    : "";
  const propContext = allPropNames.length > 0
    ? `\n\nProp candidates (assign each to ONLY episodes where they are truly used/present): ${allPropNames.join(", ")}`
    : "";
  const styleContext = project.worldSetting
    ? `\n\n【项目风格】\n${project.worldSetting}\n\n请保证分集设计与该风格一致。`
    : "";

  let allEpisodes: SplitEpisode[];
  try {
    const chunkResults = await Promise.all(
      chunks.map(async (chunk, idx) => {
        await addImportLog(
          projectId, 4, "running",
          `正在处理第 ${idx + 1}/${chunks.length} 块...`
        );

        const prompt = buildScriptSplitPrompt(
          chunk + charContext + sceneContext + propContext + styleContext + `\n\n${SCRIPT_SPLIT_ASSET_RULES}`,
          { chunkIndex: idx, totalChunks: chunks.length, episodeOffset: 0 }
        );

        const jsonMode = {
          openai: { response_format: { type: "json_object" } },
        };
        const result = await generateText({
          model,
          system: scriptSplitSystem,
          prompt,
          providerOptions: jsonMode,
          maxOutputTokens: 4000,
        });

        try {
          return parseEpisodesFromModelText(result.text);
        } catch {
          console.error(`[ImportSplit] Chunk ${idx + 1} JSON parse failed. Raw output:\n${result.text.slice(0, 500)}...`);
          await addImportLog(
            projectId, 4, "running",
            `第 ${idx + 1} 块 JSON 解析失败，正在重试...`
          );
          const retry = await generateText({
            model,
            system: scriptSplitSystem,
            prompt: prompt + "\n\nIMPORTANT: Return COMPLETE, VALID JSON. Fewer episodes is better than broken JSON.",
            providerOptions: jsonMode,
            maxOutputTokens: 4000,
          });
          try {
            return parseEpisodesFromModelText(retry.text);
          } catch {
            await addImportLog(
              projectId, 4, "running",
              `第 ${idx + 1} 块二次解析失败，尝试自动修复 JSON...`
            );

            const repair = await generateText({
              model,
              providerOptions: jsonMode,
              maxOutputTokens: 4000,
              prompt: [
                "你是 JSON 修复器。请把下面文本修复为“有效 JSON”。",
                "目标结构只能是以下两种之一：",
                "1) [{\"title\":\"...\",\"description\":\"...\",\"keywords\":\"...\",\"idea\":\"...\",\"characters\":[\"...\"]}]",
                "2) {\"episodes\":[...同上结构...]}",
                "要求：",
                "- 只输出 JSON，不要解释文字",
                "- 若字段缺失，用空字符串补齐（characters 缺失则用空数组）",
                "- 保留可解析的原始信息，禁止编造剧情",
                "",
                "待修复文本：",
                retry.text,
              ].join("\n"),
            });

            try {
              return parseEpisodesFromModelText(repair.text);
            } catch {
              await addImportLog(
                projectId, 4, "running",
                `第 ${idx + 1} 块修复失败，启用应急分集模式...`
              );

              const emergency = await generateText({
                model,
                providerOptions: jsonMode,
                maxOutputTokens: 3000,
                prompt: buildEmergencySplitPrompt(
                  chunk,
                  allNames,
                  allSceneNames,
                  allPropNames
                ),
              });

              try {
                return parseEpisodesFromModelText(emergency.text);
              } catch {
                await addImportLog(
                  projectId, 4, "running",
                  `第 ${idx + 1} 块应急模式仍失败，使用保底单集结果。`
                );
                return deterministicFallbackEpisode(
                  chunk,
                  idx,
                  allNames,
                  allSceneNames,
                  allPropNames
                );
              }
            }
          }
        }
      })
    );
    allEpisodes = chunkResults.flat();

    allEpisodes = allEpisodes.map((episode) => ({
      ...episode,
      characters: normalizeListToCandidates(episode.characters, allNames),
      scenes: normalizeListToCandidates(episode.scenes, allSceneNames),
      props: normalizeListToCandidates(episode.props, allPropNames),
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await addImportLog(projectId, 4, "error", `分集失败: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  await addImportLog(
    projectId, 4, "done",
    `分集完成，共 ${allEpisodes.length} 集`,
    { episodes: allEpisodes }
  );

  return NextResponse.json({ episodes: allEpisodes });
}
