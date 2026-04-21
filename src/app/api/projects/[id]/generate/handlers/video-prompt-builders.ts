import { stripAspectRatioMentions } from "../helpers";

export function clampSegmentDuration(duration: number): number {
  const rounded = Math.max(1, Math.round(duration || 0));
  return Math.min(5, Math.max(3, rounded));
}

export function sanitizeModelPrompt(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  const noFence = trimmed
    .replace(/^```[a-zA-Z]*\s*/g, "")
    .replace(/```$/g, "")
    .trim();
  return noFence.replace(/\n{3,}/g, "\n\n").trim();
}

type DialogueItem = {
  characterName: string;
  text: string;
  offscreen?: boolean;
  visualHint?: string;
};

function normalizePromptText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildDialogueLine(
  item: DialogueItem,
  mode: "storyboard_grid" | "reference" | "keyframe"
): string {
  const cleanText = item.text.trim();
  if (mode === "reference") {
    return item.offscreen
      ? `画外音：${item.characterName}："${cleanText}"`
      : `${item.characterName}台词："${cleanText}"`;
  }

  const name = item.visualHint
    ? `${item.characterName}（${item.visualHint}）`
    : item.characterName;
  return item.offscreen
    ? `【画外音】${name}: "${cleanText}"`
    : `【对白口型】${name}: "${cleanText}"`;
}

export function ensureDialogueCoverage(params: {
  dialogues?: DialogueItem[];
  mode: "storyboard_grid" | "reference" | "keyframe";
  prompt: string;
}) {
  const prompt = (params.prompt || "").trim();
  const dialogues = (params.dialogues || []).filter((item) => item.text?.trim());
  if (dialogues.length === 0) return prompt;

  const normalizedPrompt = normalizePromptText(prompt);
  const missingLines = dialogues
    .filter((item) => !normalizedPrompt.includes(normalizePromptText(item.text)))
    .map((item) => buildDialogueLine(item, params.mode));

  if (missingLines.length === 0) return prompt;

  return `${prompt}\n\n${missingLines.join("\n")}`.trim();
}

export function ensureDurationPrefix(prompt: string, duration: number): string {
  const p = (prompt || "").trim();
  if (!p) return `Duration: ${duration}s.`;
  if (/^(duration|时长)\s*[:：]/i.test(p)) return p;
  return `Duration: ${duration}s.\n\n${p}`;
}

function compactAnchorText(input?: string | null): string | null {
  const text = stripAspectRatioMentions((input || "").replace(/\s+/g, " ")).trim();
  if (!text) return null;
  const first =
    text.split(/[。！？.!?；;\n]/).map((s) => s.trim()).filter(Boolean)[0] || text;
  return first.length > 140 ? `${first.slice(0, 140)}...` : first;
}

function normalizeText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function getPanelMetaString(
  meta: Record<string, unknown> | null | undefined,
  key: string
): string | undefined {
  const value = meta?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getPanelMetaNumber(
  meta: Record<string, unknown> | null | undefined,
  key: string
): number | undefined {
  const value = meta?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function getPanelMetaStringArray(
  meta: Record<string, unknown> | null | undefined,
  key: string
): string[] | undefined {
  const value = meta?.[key];
  if (!Array.isArray(value)) return undefined;
  const normalized = value.map((item) => String(item || "").trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

export function getPanelContinuityRules(
  meta: Record<string, unknown> | null | undefined
):
  | {
      locationLocked?: boolean;
      timeContinuous?: boolean;
      sameCharacterDesign?: boolean;
      samePropSet?: boolean;
      cameraAxisLocked?: boolean;
    }
  | undefined {
  const value = meta?.continuityRules;
  return value && typeof value === "object"
    ? (value as {
        locationLocked?: boolean;
        timeContinuous?: boolean;
        sameCharacterDesign?: boolean;
        samePropSet?: boolean;
        cameraAxisLocked?: boolean;
      })
    : undefined;
}

export function buildAuditRevisionHints(payload?: Record<string, unknown>): string {
  if (!payload) return "";
  const summary = normalizeText(payload.auditSummary);
  const fixTarget = normalizeText(payload.auditFixTarget);
  const issues = Array.isArray(payload.auditIssues)
    ? payload.auditIssues
        .map((item) => normalizeText(item))
        .filter(Boolean)
        .slice(0, 4)
    : [];
  const suggestions = Array.isArray(payload.auditSuggestions)
    ? payload.auditSuggestions
        .map((item) => normalizeText(item))
        .filter(Boolean)
        .slice(0, 4)
    : [];

  const lines: string[] = [];
  if (summary) lines.push(`AI审查摘要: ${summary}`);
  if (fixTarget) lines.push(`优先修复字段: ${fixTarget}`);
  if (issues.length > 0) lines.push(`AI指出的问题: ${issues.join("；")}`);
  if (suggestions.length > 0) lines.push(`AI修复建议: ${suggestions.join("；")}`);
  if (lines.length === 0) return "";
  lines.push("本次生成必须优先修复以上问题，同时保持剧情目标、角色身份、空间关系与导演控制不变。");
  return lines.join("\n");
}

export const KEYFRAME_VIDEO_PROMPT_SYSTEM = `
你是一位“首尾帧视频提示词”专家。请把输入素材整理成可直接用于视频模型的最终提示词。

硬性要求：
1) 只输出最终提示词正文，不要解释、不要标题、不要清单、不要示例。
2) 严禁输出 @图片N / 图片N / 图N 以及任何 @ 符号。
3) 严禁输出 [CONTINUITY_INTENT] 或任何内部控制块。
4) 严禁复述“写作要点/时长策略/模板说明”等教学文本。
5) 输出必须像导演写给视频模型的镜头稿，优先写成连续的电影化散文，而不是说明文。
6) 允许在正文最后单独补一行 【音效设计】：... ，用于补充关键环境音、材质声、低频氛围声。
7) 输出应简洁，保留：时长、动作、镜头、首尾帧锚点（如有）、对白（如有）、结尾禁项。
`;

export const STORYBOARD_VIDEO_PROMPT_SYSTEM = `
你是一位“四宫格分镜 -> 视频提示词”专家。

你的工作不是复述规则，而是根据 4 个 panel 的连续画面锚点，写出一个适合当前视频模型的最终视频提示词。

硬性要求：
1) 只输出最终提示词正文。
2) 这是图生视频流程，必须把四格理解为同一镜头中的连续时间锚点。
3) 必须强调动作从 panel1 逐步推进到 panel4，不可跳变，不可新增无关动作。
4) 必须保持单场景、单事件、单主动作线、单主情绪线，不得把多个复杂事件塞进一个视频提示词。
5) 若给定角色/场景/道具参考，必须明确保持外观、空间、道具一致性。
6) 若项目是写实风格，必须使用写实电影摄影语言，禁止 2.5D、动漫化、插画化。
7) 严禁输出 @图片、列表解释、模板说明、系统规则。
8) 输出风格必须接近“导演分镜散文稿”：画面起势、镜头推进、情绪捕捉、环境回应、结尾揭示，形成完整镜头体验。
9) 允许在结尾补一行 【音效设计】：... ，但正文主体仍然必须是电影化散文。
`.trim();

export function sanitizeKeyframeModelOutput(raw: string): string {
  return sanitizeModelPrompt(raw)
    .replace(/@/g, "")
    .replace(/\[CONTINUITY_INTENT\][\s\S]*?\[\/CONTINUITY_INTENT\]/g, "")
    .trim();
}

export function buildKeyframePromptModelRequest(params: {
  duration: number;
  cameraDirection: string;
  motionScript: string;
  startFrameDesc?: string | null;
  endFrameDesc?: string | null;
  actionIntensity: number;
  cameraMotion: number;
  emotionIntensity: number;
  maxPrimaryActions: number;
  maxCameraMoves: number;
  dialogues?: Array<{ characterName: string; text: string; offscreen?: boolean; visualHint?: string }>;
  auditHints?: string;
}): string {
  const opening = compactAnchorText(params.startFrameDesc);
  const closing = compactAnchorText(params.endFrameDesc);
  const lines: string[] = [];
  lines.push(`时长: ${params.duration}s`);
  lines.push("输出风格: 电影导演分镜散文稿。像在描述一条已经拍出来的镜头，不要写成功能说明。");
  lines.push(`镜头: ${params.cameraDirection}`);
  lines.push(`动作目标: ${params.motionScript || "完成一个清晰主动作并稳定收束到终点状态。"}`);
  lines.push(
    `导演控制: 动作 ${params.actionIntensity}/100, 运镜 ${params.cameraMotion}/100, 情绪 ${params.emotionIntensity}/100`
  );
  lines.push(`预算: 主动作<=${params.maxPrimaryActions}, 机位变化<=${params.maxCameraMoves}`);
  lines.push(
    "写作结构: 先交代画面起势与主体状态，再写动作推进与镜头变化，随后捕捉情绪/细节，最后收束到稳定终点。"
  );
  lines.push(
    "语言要求: 运镜必须写具体词，例如“缓慢推近 / 环绕至正面 / 低角度上摇 / 顺势下摇 / 拉远揭示”；避免空泛修饰词。"
  );
  if (opening) lines.push(`首帧锚点: ${opening}`);
  if (closing) lines.push(`尾帧锚点: ${closing}`);
  if (params.dialogues?.length) {
    lines.push(`对白: ${params.dialogues.map((d) => `${d.characterName}: "${d.text}"`).join("; ")}`);
  }
  if (params.auditHints) {
    lines.push(`AI修复任务:\n${params.auditHints}`);
  }
  lines.push(
    "音效要求: 把关键环境声、材质声、呼吸声自然融入正文；如有必要，可在最后单独补一行【音效设计】：..."
  );
  lines.push("结尾禁项: 禁止出现水印、字幕、文字LOGO、标识、时间码、画面边框");
  return lines.join("\n");
}

export function buildStoryboardVideoPromptModelRequest(params: {
  duration: number;
  ratioLabel?: string;
  cameraDirection: string;
  storyGoal?: string;
  primaryScene?: string;
  sceneCount?: number;
  eventCount?: number;
  complexityLevel?: string;
  startingAction?: string;
  endingAction?: string;
  continuityBeats?: string[];
  microDynamics?: string[];
  continuityRules?: {
    locationLocked?: boolean;
    timeContinuous?: boolean;
    sameCharacterDesign?: boolean;
    samePropSet?: boolean;
    cameraAxisLocked?: boolean;
  };
  panels: Array<{
    index: number;
    stage?: string;
    prompt: string;
    beat?: string;
    mustKeep?: string[];
    delta?: string;
  }>;
  resourceSummary?: string;
  dialogues?: Array<{ characterName: string; text: string; offscreen?: boolean; visualHint?: string }>;
  directorControl: { actionIntensity: number; cameraMotion: number; emotionIntensity: number };
  auditHints?: string;
}): string {
  const lines: string[] = [];
  lines.push(`时长: ${params.duration}s`);
  lines.push("输出风格: 电影导演分镜散文稿，不要写成规则复述或技术说明。");
  if (params.ratioLabel) lines.push(`输出画幅: ${params.ratioLabel}`);
  lines.push(`镜头运动倾向: ${params.cameraDirection}`);
  if (params.storyGoal) lines.push(`本镜头唯一剧情目标: ${params.storyGoal}`);
  if (params.primaryScene) lines.push(`唯一主场景: ${params.primaryScene}`);
  if (params.startingAction) lines.push(`起始动作: ${params.startingAction}`);
  if (params.endingAction) lines.push(`结束动作: ${params.endingAction}`);
  if (params.continuityBeats?.length) lines.push(`中间连续变化: ${params.continuityBeats.join(" -> ")}`);
  if (params.microDynamics?.length) lines.push(`微动态要求: ${params.microDynamics.join("；")}`);
  lines.push(
    `复杂度预算: sceneCount=${params.sceneCount ?? 1}, eventCount=${params.eventCount ?? 1}, complexity=${params.complexityLevel || "low"}`
  );
  if (params.continuityRules) {
    lines.push(
      `连续性硬规则: locationLocked=${params.continuityRules.locationLocked !== false}, timeContinuous=${params.continuityRules.timeContinuous !== false}, sameCharacterDesign=${params.continuityRules.sameCharacterDesign !== false}, samePropSet=${params.continuityRules.samePropSet !== false}, cameraAxisLocked=${params.continuityRules.cameraAxisLocked !== false}`
    );
  }
  lines.push(
    "写作结构: 以画面建立开头，顺着四宫格锚点逐步推进动作与镜头，在中后段压近情绪或关键细节，最后拉出阶段性结果或悬念揭示。"
  );
  lines.push(
    "语言要求: 把 Panel1->Panel4 理解成同一镜头里的连续呼吸，运镜与主体动作必须自然串起来；不要写成“第一格/第二格说明书”。"
  );
  lines.push(
    `导演控制: 动作 ${params.directorControl.actionIntensity}/100, 运镜 ${params.directorControl.cameraMotion}/100, 情绪 ${params.directorControl.emotionIntensity}/100`
  );
  if (params.resourceSummary) lines.push(`严格参考资源:\n${params.resourceSummary}`);
  lines.push(
    `四宫格锚点:\n${params.panels
      .map((panel) => {
        const pieces = [
          panel.stage ? `stage=${panel.stage}` : "",
          panel.beat ? `beat=${panel.beat}` : "",
          panel.mustKeep?.length ? `mustKeep=${panel.mustKeep.join(" / ")}` : "",
          panel.delta ? `delta=${panel.delta}` : "",
          compactAnchorText(panel.prompt) || panel.prompt,
        ].filter(Boolean);
        return `Panel ${panel.index}: ${pieces.join("｜")}`;
      })
      .join("\n")}`
  );
  if (params.dialogues?.length) {
    lines.push(
      `对白: ${params.dialogues.map((item) => `${item.characterName}: "${item.text}"`).join("; ")}`
    );
  }
  if (params.auditHints) lines.push(`AI修复任务:\n${params.auditHints}`);
  lines.push(
    "音效要求: 关键声音要写进镜头过程；若声音层很重要，可在最后单独补一行【音效设计】：..."
  );
  lines.push("结尾禁项: 禁止水印、字幕、LOGO、边框、角色变脸、场景跳变、道具消失");
  return lines.join("\n");
}
