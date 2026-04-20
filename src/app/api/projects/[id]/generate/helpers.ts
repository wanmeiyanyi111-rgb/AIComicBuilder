import path from "path";
import { db } from "@/lib/db";
import {
  characters,
  episodes,
  projects,
  storyboardVersions,
} from "@/lib/db/schema";
import { getScopedEpisodeCharacters } from "@/lib/episode-resources";
import {
  normalizeDirectorControl,
  type DirectorControl,
} from "@/lib/video/shot-intent";
import { eq } from "drizzle-orm";

/** Map user-facing ratio string to ImageOptions fields */
export function ratioToImageOpts(
  ratio?: string
): { aspectRatio?: string; size?: string } {
  switch (ratio) {
    case "16:9":
      return { aspectRatio: "16:9", size: "2560x1440" };
    case "9:16":
      return { aspectRatio: "9:16", size: "1440x2560" };
    case "1:1":
      return { aspectRatio: "1:1", size: "2048x2048" };
    default:
      return { aspectRatio: "16:9", size: "2560x1440" };
  }
}

export function ratioToDisplayLabel(ratio?: string): string {
  switch (ratio) {
    case "9:16":
      return "9:16 竖屏画幅";
    case "1:1":
      return "1:1 方形画幅";
    case "2.35:1":
      return "2.35:1 宽银幕画幅";
    case "16:9":
    default:
      return "16:9 横屏画幅";
  }
}

export function stripAspectRatioMentions(text: string): string {
  return (text || "")
    .replace(
      /画幅比例[:：]?\s*(?:16:9\s*横屏|9:16\s*竖屏|2\.35:1\s*宽银幕|1:1\s*方形|16:9|9:16|2\.35:1|1:1)/giu,
      ""
    )
    .replace(/\b(?:16:9|9:16|2\.35:1|1:1)\s*(?:横屏|竖屏|宽银幕|方形)?画幅/giu, "")
    .replace(/\b(?:横屏|竖屏|横版|竖版)\s*(?:16:9|9:16|2\.35:1|1:1)?/giu, "")
    .replace(/(^|[\s，,。；;:：\(（\[【])(?:16:9|9:16|2\.35:1|1:1)(?=($|[\s，,。；;:：\)）\]】]))/giu, "$1")
    .replace(/[，,。；;:\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function enforceFramePromptRatio(text: string, ratio?: string): string {
  const cleaned = stripAspectRatioMentions(text);

  const ratioLabel = ratioToDisplayLabel(ratio);
  if (!cleaned) {
    return `画幅比例严格锁定为${ratioLabel}。`;
  }
  return `${cleaned}。画幅比例严格锁定为${ratioLabel}。`;
}

export function enforceVideoPromptRatio(text: string, ratio?: string): string {
  const cleaned = stripAspectRatioMentions(text);
  const ratioLabel = ratioToDisplayLabel(ratio);
  if (!cleaned) {
    return `画幅比例：${ratioLabel}。`;
  }
  if (cleaned.startsWith(`画幅比例：${ratioLabel}`)) {
    return cleaned;
  }
  return `画幅比例：${ratioLabel}。\n${cleaned}`.trim();
}

export function buildStoryboardPanelImagePrompt(params: {
  basePrompt: string;
  ratio?: string;
  panelIndex?: number | null;
  stage?: string | null;
  beat?: string | null;
  storyGoal?: string | null;
  primaryScene?: string | null;
  startingAction?: string | null;
  endingAction?: string | null;
  continuityBeats?: unknown;
  mustKeep?: unknown;
  delta?: string | null;
}): string {
  const basePrompt = enforceFramePromptRatio(params.basePrompt || "", params.ratio);
  const continuityBeats = Array.isArray(params.continuityBeats)
    ? params.continuityBeats.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const mustKeep = Array.isArray(params.mustKeep)
    ? params.mustKeep.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  const contextBlocks = [
    "当前任务：你只生成四宫格连续剧情分镜中的单独一格画面，不是整张分镜板，不是拼贴海报，不是多镜头排版。",
    params.panelIndex ? `当前格序号：第${params.panelIndex}格。` : "",
    params.stage ? `当前格阶段：${params.stage}。` : "",
    params.beat ? `当前格剧情职责：${params.beat}。` : "",
    params.storyGoal ? `本段剧情唯一目标：${params.storyGoal}。` : "",
    params.primaryScene ? `主场景锁定：${params.primaryScene}。` : "",
    params.startingAction ? `起始动作：${params.startingAction}。` : "",
    params.endingAction ? `结束动作：${params.endingAction}。` : "",
    continuityBeats.length > 0
      ? `中段连续变化：${continuityBeats.join("；")}。`
      : "",
    mustKeep.length > 0
      ? `本格必须继承不变：${mustKeep.join("、")}。`
      : "",
    params.delta ? `本格相对上一格只允许的变化：${params.delta}。` : "",
    "导演约束：这是一张服务剧情演绎的单帧电影画面，只表现当前时间切片，不得额外发散成多个同时发生的镜头。",
    "硬性禁止：四联画、九宫格、拼贴、分屏、漫画页、故事板版式、接触表、画中画、重复人物排版、文字标题、字幕、编号、注释箭头、排版边框。",
    "输出要求：只生成一张完整、干净、单镜头、单时间切片的电影级画面。",
    `单格生图提示词：${basePrompt}`,
  ].filter(Boolean);

  return contextBlocks.join("\n");
}

export function enforceVisualStyleRatio(
  visualStyle: string,
  ratio?: string
): string {
  const target = ratioToDisplayLabel(ratio).replace("画幅", "");
  const base = (visualStyle || "").trim();
  if (!base) {
    return `画幅比例：${target}`;
  }

  if (/画幅比例[:：]/.test(base)) {
    return base.replace(
      /画幅比例[:：]\s*(?:16:9\s*横屏|9:16\s*竖屏|2\.35:1\s*宽银幕|1:1\s*方形)/giu,
      `画幅比例：${target}`
    );
  }

  return `${base}；画幅比例：${target}`;
}

export async function getEpisodeCharacters(projectId: string, epId?: string | null) {
  return getScopedEpisodeCharacters(projectId, epId);
}

/** Load script text from episode when epId exists, else from project. */
export async function getScriptForScope(projectId: string, epId?: string): Promise<string> {
  if (epId) {
    const source = await db
      .select({ script: episodes.script })
      .from(episodes)
      .where(eq(episodes.id, epId));
    return source[0]?.script || "";
  }
  const source = await db
    .select({ script: projects.script })
    .from(projects)
    .where(eq(projects.id, projectId));
  return source[0]?.script || "";
}

/** Parse VISUAL STYLE machine-readable block from script text. */
export function buildVisualStyleFromScript(script: string): string {
  const pickField = (label: string): string => {
    const re = new RegExp(`${label}[：:]\\s*(.+?)(?:\\n|$)`);
    const m = script.match(re);
    return m?.[1]?.trim() || "";
  };
  const metaVisualStyle = pickField("视觉风格") || pickField("Visual Style");
  const metaColorTone = pickField("色彩基调");
  const metaEra = pickField("时代美学");
  const metaMood = pickField("氛围情绪");
  const metaRatio = pickField("画幅比例");
  return [
    metaVisualStyle,
    metaColorTone && `色彩基调：${metaColorTone}`,
    metaEra && `时代美学：${metaEra}`,
    metaMood && `氛围情绪：${metaMood}`,
    metaRatio && `画幅比例：${metaRatio}`,
  ]
    .filter(Boolean)
    .join("；");
}

/**
 * Check if a character is visible on-screen by looking for their name
 * in the videoScript or startFrameDesc fields.
 */
export function isCharacterOnScreen(
  characterName: string,
  videoScript: string,
  startFrameDesc: string | null | undefined
): boolean {
  const text = `${videoScript} ${startFrameDesc ?? ""}`;
  return text.includes(characterName);
}

/**
 * Build character mapping prompt prefix for image generation.
 * Includes character name, height, body type, description, and strict
 * proportion enforcement when multiple characters are present.
 */
export function buildCharMappingPrefix(
  chars: Array<typeof characters.$inferSelect>
): string {
  if (chars.length === 0) return "";
  const charMapping = chars.map((c, i) => `图片${i + 1}=${c.name}`).join("，");
  const charDescriptions = chars
    .map((c) => {
      const heightInfo = c.heightCm ? `身高约${c.heightCm}cm` : "";
      const bodyInfo = c.bodyType ? `${c.bodyType}体型` : "";
      const physicalTags = [heightInfo, bodyInfo].filter(Boolean).join("，");
      return `${c.name}${physicalTags ? `（${physicalTags}）` : ""}: ${c.description || ""}`;
    })
    .join("\n");
  const heightHint =
    chars.length > 1
      ? "\n\n【角色比例严格要求】画面中角色的相对身高/体型必须严格遵循上述身高数据。儿童必须明显小于成人，体型矮小、头身比例符合实际年龄，绝不可画成与成人同等大小。"
      : "";
  return `角色映射：${charMapping}\n\n角色描述：\n${charDescriptions}${heightHint}\n\n严格按照参考图的角色外观（面部、服装、发型）和相对比例生成。\n\n场景描述：`;
}

export async function getVersionedUploadDir(
  versionId: string | null | undefined
): Promise<string> {
  if (!versionId) return process.env.UPLOAD_DIR || "./uploads";
  const [version] = await db
    .select({
      label: storyboardVersions.label,
      projectId: storyboardVersions.projectId,
    })
    .from(storyboardVersions)
    .where(eq(storyboardVersions.id, versionId));
  if (!version) return process.env.UPLOAD_DIR || "./uploads";
  return path.join(
    process.env.UPLOAD_DIR || "./uploads",
    "projects",
    version.projectId,
    version.label
  );
}

type ProviderErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
  code?: string;
  message?: string;
};

function getRawErrorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function tryParseProviderErrorPayload(text: string): ProviderErrorPayload | null {
  const source = text.trim();
  if (!source) return null;

  const parse = (candidate: string): ProviderErrorPayload | null => {
    try {
      const parsed = JSON.parse(candidate) as ProviderErrorPayload;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
    return null;
  };

  // Case 1: plain JSON string
  const direct = parse(source);
  if (direct) return direct;

  // Case 2: provider prefixes JSON after status text, e.g.:
  // "Seedance submit failed: 400 { ...json... }"
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const embedded = parse(source.slice(firstBrace, lastBrace + 1));
    if (embedded) return embedded;
  }

  return null;
}

function extractProviderErrorInfo(err: unknown): {
  code?: string;
  message?: string;
  raw: string;
} {
  const raw = getRawErrorText(err);
  const payload = tryParseProviderErrorPayload(raw);
  const nested = payload?.error;
  return {
    code: nested?.code || payload?.code,
    message: nested?.message || payload?.message,
    raw,
  };
}

export function isSensitiveInputImageError(err: unknown): boolean {
  const info = extractProviderErrorInfo(err);
  const code = (info.code || "").toLowerCase();
  if (code.includes("inputimagesensitivecontentdetected")) return true;

  const text = `${info.message || ""} ${info.raw}`.toLowerCase();
  return (
    text.includes("input image may contain sensitive information") ||
    (text.includes("sensitive") &&
      text.includes("input image") &&
      text.includes("request failed"))
  );
}

export function buildSensitiveInputImageErrorMessage(err: unknown): string {
  const info = extractProviderErrorInfo(err);
  const detail = info.message || info.code || "InputImageSensitiveContentDetected";
  return [
    "视频生成被安全策略拦截：输入参考图可能包含敏感内容。",
    "建议先重新生成该镜头的首尾帧/参考图（避免暴露、血腥、未成年人敏感、真实证件或高风险元素），再重试视频生成。",
    `模型返回：${detail}`,
  ].join(" ");
}

export function extractVideoErrorMessage(err: unknown): string {
  if (isSensitiveInputImageError(err)) {
    return buildSensitiveInputImageErrorMessage(err);
  }
  return extractErrorMessage(err);
}

export function extractErrorMessage(err: unknown): string {
  const info = extractProviderErrorInfo(err);
  if (info.message) return info.message;
  return info.raw;
}

type UnknownRecord = Record<string, unknown>;

export function getDirectorControlFromPayload(
  payload?: UnknownRecord
): DirectorControl {
  const raw = payload?.directorControl;
  if (!raw || typeof raw !== "object") {
    return normalizeDirectorControl();
  }
  const obj = raw as UnknownRecord;
  return normalizeDirectorControl({
    actionIntensity:
      typeof obj.actionIntensity === "number"
        ? obj.actionIntensity
        : Number(obj.actionIntensity),
    cameraMotion:
      typeof obj.cameraMotion === "number"
        ? obj.cameraMotion
        : Number(obj.cameraMotion),
    emotionIntensity:
      typeof obj.emotionIntensity === "number"
        ? obj.emotionIntensity
        : Number(obj.emotionIntensity),
  });
}
