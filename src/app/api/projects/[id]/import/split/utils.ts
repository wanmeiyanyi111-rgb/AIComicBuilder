import { extractJSON } from "@/lib/ai/ai-sdk";
import {
  SHORT_DRAMA_MAX_DURATION_SEC,
  SHORT_DRAMA_MIN_DURATION_SEC,
  SHORT_DRAMA_TARGET_DURATION_SEC,
  estimateShortDramaDuration,
  normalizeShortDramaBeats,
  summarizeShortDramaIssues,
  validateShortDramaEpisode,
  type ShortDramaEpisodePlan,
} from "@/lib/story/short-drama";
import { estimateEpisodeCountGuidance } from "@/lib/story/import-episode-count";
import type { GenerateTextResult } from "ai";

export type SplitEpisode = ShortDramaEpisodePlan;

export interface CharacterSummary {
  name: string;
  scope: string;
}

export interface NamedCandidate {
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

function toPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return null;
}

function normalizeNameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toStringSafe(item)).filter(Boolean).slice(0, 50);
}

function normalizeName(value: string): string {
  return toStringSafe(value);
}

function normalizeListToCandidates(items: string[] | undefined, candidates: string[]): string[] {
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
      storyMode: "short_drama",
      targetDurationSec: SHORT_DRAMA_TARGET_DURATION_SEC,
      durationMinSec: SHORT_DRAMA_MIN_DURATION_SEC,
      durationMaxSec: SHORT_DRAMA_MAX_DURATION_SEC,
      estimatedDurationSec: SHORT_DRAMA_TARGET_DURATION_SEC,
      hook: "",
      coreConflict: "",
      turningPoint: "",
      cliffhanger: "",
      beats: [],
      validationIssues: [],
      characters: [],
      scenes: [],
      props: [],
    };
  }

  const title =
    toStringSafe(value.title) ||
    toStringSafe(value.name) ||
    toStringSafe(value.episodeTitle) ||
    `第${index + 1}集`;
  const description = toStringSafe(value.description) || toStringSafe(value.summary) || toStringSafe(value.logline) || "";
  const keywords = toStringSafe(value.keywords) || toStringSafe(value.tags) || "";
  const idea = toStringSafe(value.idea) || toStringSafe(value.plot) || description;
  const characters = normalizeNameList(value.characters ?? value.characterNames ?? value.cast);
  const scenes = normalizeNameList(value.scenes ?? value.sceneNames ?? value.locations);
  const props = normalizeNameList(value.props ?? value.propNames ?? value.objects);
  const beats = normalizeShortDramaBeats(value.beats);
  const targetDurationSec = toPositiveInt(value.targetDurationSec ?? value.targetDuration) ?? SHORT_DRAMA_TARGET_DURATION_SEC;
  const durationMinSec = toPositiveInt(value.durationMinSec ?? value.minDurationSec) ?? SHORT_DRAMA_MIN_DURATION_SEC;
  const durationMaxSec = toPositiveInt(value.durationMaxSec ?? value.maxDurationSec) ?? SHORT_DRAMA_MAX_DURATION_SEC;
  const estimatedDurationSec = toPositiveInt(value.estimatedDurationSec ?? value.durationSec ?? value.duration) ?? 0;

  return {
    title,
    description,
    keywords,
    idea,
    storyMode: "short_drama",
    targetDurationSec,
    durationMinSec,
    durationMaxSec,
    estimatedDurationSec,
    hook: toStringSafe(value.hook ?? value.openingHook),
    coreConflict: toStringSafe(value.coreConflict ?? value.conflict),
    turningPoint: toStringSafe(value.turningPoint ?? value.reversal),
    cliffhanger: toStringSafe(value.cliffhanger ?? value.endingHook),
    pacingNotes: toStringSafe(value.pacingNotes ?? value.rhythmNotes),
    beats,
    validationIssues: [],
    characters,
    scenes,
    props,
  };
}

function collectEpisodeLikeArrays(root: unknown): Array<Record<string, unknown>[]> {
  const queue: unknown[] = [root];
  const found: Array<Record<string, unknown>[]> = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (Array.isArray(current)) {
      const episodeLikeItems = current.filter(isEpisodeLike);
      if (episodeLikeItems.length > 0) found.push(episodeLikeItems);
      for (const item of current) queue.push(item);
      continue;
    }
    if (isRecord(current)) {
      for (const value of Object.values(current)) queue.push(value);
    }
  }
  return found;
}

function extractEpisodesFromParsed(parsed: unknown): SplitEpisode[] {
  if (Array.isArray(parsed)) {
    const normalized = parsed.filter(isEpisodeLike).map((item, index) => normalizeEpisode(item, index));
    if (normalized.length > 0) return normalized;
  }
  if (isRecord(parsed)) {
    const directCandidates = [parsed.episodes, parsed.data, parsed.result, parsed.items, parsed.list];
    for (const candidate of directCandidates) {
      if (!Array.isArray(candidate)) continue;
      const normalized = candidate.filter(isEpisodeLike).map((item, index) => normalizeEpisode(item, index));
      if (normalized.length > 0) return normalized;
    }
    if (isEpisodeLike(parsed)) return [normalizeEpisode(parsed, 0)];
  }
  const nested = collectEpisodeLikeArrays(parsed);
  if (nested.length > 0) return nested[0].map((item, index) => normalizeEpisode(item, index));
  throw new Error("Invalid JSON structure");
}

export function parseEpisodesFromModelText(text: string): SplitEpisode[] {
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
    } catch {}
  }
  throw new Error("Invalid JSON structure");
}

export function buildEmergencySplitPrompt(
  scriptChunk: string,
  allCharacterNames: string[],
  allSceneNames: string[],
  allPropNames: string[],
  styleContext: string,
  countGuidanceText: string
): string {
  return [
    "你是短剧分集 JSON 生成器。请将文本拆成适合短剧的分集策划结果。",
    "仅输出有效 JSON，格式必须是：",
    '{"episodes":[{"title":"...","description":"...","keywords":"...","idea":"...","estimatedDurationSec":150,"targetDurationSec":150,"durationMinSec":120,"durationMaxSec":180,"hook":"...","coreConflict":"...","turningPoint":"...","cliffhanger":"...","pacingNotes":"...","beats":[{"name":"hook","durationSec":15,"summary":"..."},{"name":"setup","durationSec":40,"summary":"..."},{"name":"confrontation","durationSec":55,"summary":"..."},{"name":"cliffhanger","durationSec":40,"summary":"..."}],"characters":["..."],"scenes":["..."],"props":["..."]}]}',
    "硬约束：",
    "- 每一集必须是短剧风格，单集时长严格控制在 120-180 秒",
    "- targetDurationSec 固定 150",
    "- beats 的 durationSec 总和必须接近 estimatedDurationSec",
    "- 必须包含 hook、coreConflict、turningPoint、cliffhanger",
    "- 角色、场景、道具只能使用给定候选名单中的名字",
    "- 只输出 JSON，不要解释文字",
    countGuidanceText,
    "",
    styleContext ? `项目风格：${styleContext}` : "",
    `角色名单：${allCharacterNames.join(", ") || "无"}`,
    `场景名单：${allSceneNames.join(", ") || "无"}`,
    `道具名单：${allPropNames.join(", ") || "无"}`,
    "",
    "待拆分文本：",
    scriptChunk,
  ].filter(Boolean).join("\n");
}

export function applyCandidateLists(
  episode: SplitEpisode,
  allNames: string[],
  allSceneNames: string[],
  allPropNames: string[]
): SplitEpisode {
  const withCandidates = {
    ...episode,
    targetDurationSec: episode.targetDurationSec || SHORT_DRAMA_TARGET_DURATION_SEC,
    durationMinSec: episode.durationMinSec || SHORT_DRAMA_MIN_DURATION_SEC,
    durationMaxSec: episode.durationMaxSec || SHORT_DRAMA_MAX_DURATION_SEC,
    characters: normalizeListToCandidates(episode.characters, allNames),
    scenes: normalizeListToCandidates(episode.scenes, allSceneNames),
    props: normalizeListToCandidates(episode.props, allPropNames),
  };
  const estimatedDurationSec = estimateShortDramaDuration(withCandidates).estimatedDurationSec;
  const validation = validateShortDramaEpisode({ ...withCandidates, estimatedDurationSec });
  return {
    ...withCandidates,
    estimatedDurationSec: validation.estimatedDurationSec,
    validationIssues: validation.issues.map((issue) => issue.message),
  };
}

export function collectHardValidationFailures(episodes: SplitEpisode[]) {
  return episodes
    .map((episode, index) => ({
      index,
      title: episode.title,
      validation: validateShortDramaEpisode(episode),
    }))
    .filter((item) => !item.validation.pass);
}

export function pruneSingleUseProps(episodes: SplitEpisode[]): SplitEpisode[] {
  const counts = new Map<string, number>();
  for (const episode of episodes) {
    for (const prop of episode.props || []) {
      const key = normalizeName(prop);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return episodes.map((episode) => ({
    ...episode,
    props: (episode.props || []).filter((prop) => {
      const key = normalizeName(prop);
      return !!key && (counts.get(key) || 0) >= 2;
    }),
  }));
}

export function buildEpisodeCountGuidanceText(
  guidance: ReturnType<typeof estimateEpisodeCountGuidance>,
  scopeLabel: string
): string {
  const unitLabel = guidance.unitType === "cjk_chars" ? "中文字符" : "英文词";
  return [
    `【${scopeLabel}集数约束】`,
    `当前文本约 ${guidance.sourceUnits} ${unitLabel}，复杂度系数 ${guidance.complexityFactor.toFixed(2)}。`,
    `至少拆成 ${guidance.minEpisodes} 集，理想为 ${guidance.targetEpisodes}-${guidance.maxEpisodes} 集。`,
    "如果剧情很多，必须增加集数，绝对不能为了省事把多个重大情节合并成 1-2 集。",
  ].join("\n");
}

export function summarizeModelOutput(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 800);
}

export async function requestEpisodesFromPrompt(params: {
  addImportLog: (projectId: string, step: number, status: "running" | "done" | "error", message: string, metadata?: unknown) => Promise<unknown>;
  chunkLabel: string;
  model: any;
  projectId: string;
  prompt: string;
  providerOptions: any;
  system: string;
}) {
  const { addImportLog, chunkLabel, model, projectId, prompt, providerOptions, system } = params;
  let invalidOutput = "";

  async function logInvalidOutput(stage: string, output: string, err?: unknown) {
    const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
    await addImportLog(projectId, 4, "running", `${chunkLabel} ${stage}`, {
      reason: message || "Invalid JSON structure",
      outputLength: output.length,
      preview: summarizeModelOutput(output),
    });
  }

  const { generateText } = await import("ai");

  try {
    const result: GenerateTextResult<any, any> = await generateText({
      model,
      system,
      prompt,
      providerOptions,
      maxOutputTokens: 6000,
    });
    invalidOutput = result.text;
    return parseEpisodesFromModelText(result.text);
  } catch (err) {
    if (invalidOutput) await logInvalidOutput("首次返回无法解析，正在重试...", invalidOutput, err);
    await addImportLog(projectId, 4, "running", `${chunkLabel} JSON 解析失败，正在重试...`);
    try {
      const retry: GenerateTextResult<any, any> = await generateText({
        model,
        system,
        prompt: `${prompt}\n\nIMPORTANT: Return COMPLETE, VALID JSON ONLY. Every episode must include short-drama duration fields and beats.`,
        providerOptions,
        maxOutputTokens: 6000,
      });
      invalidOutput = retry.text;
      return parseEpisodesFromModelText(retry.text);
    } catch (retryErr) {
      if (invalidOutput) await logInvalidOutput("二次返回仍无法解析，准备进行 JSON 修复...", invalidOutput, retryErr);
      await addImportLog(projectId, 4, "running", `${chunkLabel} 二次解析失败，尝试 AI 修复 JSON...`);
      const repair: GenerateTextResult<any, any> = await generateText({
        model,
        providerOptions,
        maxOutputTokens: 6000,
        prompt: [
          "你是 JSON 修复器。请把下面文本修复为“有效 JSON”。",
          "目标结构必须是：",
          '{"episodes":[{"title":"...","description":"...","keywords":"...","idea":"...","estimatedDurationSec":150,"targetDurationSec":150,"durationMinSec":120,"durationMaxSec":180,"hook":"...","coreConflict":"...","turningPoint":"...","cliffhanger":"...","pacingNotes":"...","beats":[{"name":"hook","durationSec":15,"summary":"..."}],"characters":["..."],"scenes":["..."],"props":["..."]}]}',
          "要求：",
          "- 只输出 JSON，不要解释文字",
          "- 若字段缺失，用空字符串或空数组补齐",
          "- 保留原始信息，不能编造无关剧情",
          "",
          "待修复文本：",
          invalidOutput || prompt,
        ].join("\n"),
      });
      try {
        return parseEpisodesFromModelText(repair.text);
      } catch (repairErr) {
        await logInvalidOutput("JSON 修复结果仍无法解析", repair.text, repairErr);
        throw repairErr;
      }
    }
  }
}

export async function repairChunkEpisodes(params: {
  addImportLog: (projectId: string, step: number, status: "running" | "done" | "error", message: string, metadata?: unknown) => Promise<unknown>;
  allNames: string[];
  allPropNames: string[];
  allSceneNames: string[];
  chunk: string;
  chunkIndex: number;
  episodes: SplitEpisode[];
  issueSummary: string;
  ownedProjectWorldSetting: string;
  projectId: string;
  requestEpisodesFromPrompt: (prompt: string, chunkLabel: string) => Promise<SplitEpisode[]>;
  styleContext: string;
}) {
  const { addImportLog, allNames, allPropNames, allSceneNames, chunk, chunkIndex, episodes, issueSummary, ownedProjectWorldSetting, projectId, requestEpisodesFromPrompt, styleContext } = params;
  await addImportLog(projectId, 4, "running", `第 ${chunkIndex + 1} 块未通过短剧校验，正在请求 AI 重切分/修复...`);
  const prompt = [
    "请重新规划这一块内容的分集，使其成为合格的短剧分集方案。",
    `失败原因：${issueSummary}`,
    `硬约束：每集 ${SHORT_DRAMA_MIN_DURATION_SEC}-${SHORT_DRAMA_MAX_DURATION_SEC} 秒，目标 ${SHORT_DRAMA_TARGET_DURATION_SEC} 秒。`,
    "如果当前内容过长，请直接拆成更多集；如果过短，请合并事件并补强冲突与悬念。",
    "每集必须包含：hook、coreConflict、turningPoint、cliffhanger、beats。",
    "每集 beats 至少 4 段，durationSec 累计必须接近 estimatedDurationSec。",
    "角色、场景、道具只能使用给定候选名单。",
    styleContext ? `项目风格：${ownedProjectWorldSetting}` : "",
    `角色名单：${allNames.join(", ") || "无"}`,
    `场景名单：${allSceneNames.join(", ") || "无"}`,
    `道具名单：${allPropNames.join(", ") || "无"}`,
    "",
    "当前失败的分集结果：",
    JSON.stringify({ episodes }, null, 2),
    "",
    "原始文本：",
    chunk,
  ].filter(Boolean).join("\n");
  return requestEpisodesFromPrompt(prompt, `第 ${chunkIndex + 1} 块修复结果`);
}
