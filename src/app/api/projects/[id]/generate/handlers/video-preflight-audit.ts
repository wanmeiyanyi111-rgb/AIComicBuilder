import { extractJSON } from "@/lib/ai/ai-sdk";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import type { DirectorControl, ShotIntentCard } from "@/lib/video/shot-intent";
import { extractErrorMessage } from "../helpers";

export type AuditStatus = "ok" | "failed" | "skipped";
export type AuditSeverity = "low" | "medium" | "high";
export type PrecheckStage = "full" | "image_prompt" | "video_prompt";

export type AuditDimensionScores = {
  story: number;
  director: number;
  continuity: number;
  camera: number;
  executability: number;
  style: number;
};

export type AuditIssue = {
  severity: AuditSeverity;
  field: string;
  evidence: string;
  reason: string;
};

export type ShotLlmAudit = {
  pass: boolean;
  overallScore: number;
  dimensionScores: AuditDimensionScores;
  issues: AuditIssue[];
  suggestions: string[];
  fixTarget: string;
  summary: string;
};

export const PRECHECK_FULL_AUDIT_MAX_SHOTS = 6;
export const PRECHECK_AUDIT_CONCURRENCY = 3;
export const PRECHECK_AUDIT_TIMEOUT_MS = 120_000;

function clampScore(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function clampSeverity(value: unknown): AuditSeverity {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "medium";
}

function normalizeText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, 6);
}

function dedupeList(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function shorten(value: string, max = 180): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function safeStringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runWorker = async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function buildAuditSystemPrompt(stage: PrecheckStage) {
  const stageLine =
    stage === "image_prompt"
      ? "当前任务是生图前提示词预审，只检查文字提示词、剧情节拍、导演控制与生图可执行性，不应因为图片或视频素材尚未生成而直接判 fail。"
      : stage === "video_prompt"
        ? "当前任务是生视频前提示词预审，只检查文字提示词、四宫格锚点、动作连续性与视频可执行性，不应因为视频文件尚未生成而直接判 fail。"
        : "当前任务是完整视频生成前预检，需要同时检查文字质量、素材完整性与视频可执行性。";
  const fieldHint =
    stage === "image_prompt"
      ? '  "issues": [\n    { "severity": "low|medium|high", "field": "prompt|panel_1|panel_2|panel_3|panel_4|panel_flow|motion_script|camera|style", "evidence": "string", "reason": "string" }\n  ],'
      : '  "issues": [\n    { "severity": "low|medium|high", "field": "panel_1|panel_4|panel_flow|video_prompt|motion_script|camera|style|chain|assets", "evidence": "string", "reason": "string" }\n  ],';
  const fixTargetHint =
    stage === "image_prompt"
      ? '- fixTarget 只能填与生图前文本修复相关的字段，例如 "prompt"、"panel_1"、"panel_flow"、"motion_script"、"camera"、"style"，禁止输出 "video_prompt" 或 "assets"。'
      : '- fixTarget 填最应该优先修的字段，例如 "video_prompt"、"panel_4"、"panel_flow"、"camera"。';
  return [
    "你是一个漫剧分镜视频提示词审查官，负责检查四宫格锚点、参考图锚点、视频提示词是否真正服务剧情和导演意图。",
    "你的目标不是润色文字，而是找出会导致视频表现奇怪、跳轴、角色失真、动作失控、剧情不连贯的真实问题。",
    "必须严格依据输入信息评分，不可脑补不存在的角色、场景、动作。",
    stageLine,
    "只输出 JSON，不要输出 markdown，不要解释。",
    "JSON 结构必须是：",
    "{",
    '  "pass": boolean,',
    '  "overallScore": 0-100 integer,',
    '  "dimensionScores": {',
    '    "story": 0-100,',
    '    "director": 0-100,',
    '    "continuity": 0-100,',
    '    "camera": 0-100,',
    '    "executability": 0-100,',
    '    "style": 0-100',
    "  },",
    fieldHint,
    '  "suggestions": ["string"],',
    '  "fixTarget": "string",',
    '  "summary": "string"',
    "}",
    "评分准则：",
    "1. story: 是否忠于该镜头剧情目标，而不是出现无关表演。",
    "2. director: 是否服从导演控制参数与镜头意图。",
    "3. continuity: 四宫格前后锚点、拆分镜头链路、角色/场景/道具锚点是否连续。",
    "4. camera: 运镜是否清晰、单一、可执行，避免短镜头里塞复杂机位。",
    "5. executability: 是否适合弱视频模型，尤其是规划为 4-7 秒、但落地时可能收敛成更短视频片段的镜头。",
    "6. style: 风格、材质、光线、人物状态是否稳定一致。",
    "判定原则：",
    ...(stage === "image_prompt"
      ? ["- 当前阶段不要因为 videoPrompt 缺失而判 fail，重点检查四宫格提示词本身是否值得进入生图。"]
      : ["- 如果 videoPrompt 缺失或明显无法用于当前模式的视频生成，必须判 fail。"]),
    "- 如果短镜头包含多个主动作、多个机位、跳跃式场景变化，必须显著扣分。",
    "- 如果是拆分小分镜且要求继承上一段终格，但提示词没体现承接关系，必须指出。",
    "- issues 只写最重要的 1-4 条。",
    fixTargetHint,
  ].join("\n");
}

function buildAuditUserPrompt(params: {
  sequence: number;
  precheckStage: PrecheckStage;
  generationMode: "storyboard_grid" | "keyframe" | "reference";
  intentCard: ShotIntentCard;
  shot: {
    prompt?: string | null;
    motionScript?: string | null;
    videoScript?: string | null;
    videoPrompt?: string | null;
    cameraDirection?: string | null;
  };
  panelPrompts?: string[];
  startFrameDesc?: string | null;
  endFrameDesc?: string | null;
  styleBrief: string;
  assets: {
    panelCount: number;
    hasStoryboardGrid: boolean;
    hasReferenceImages: boolean;
  };
  ruleSummary: {
    pass: boolean;
    score: number;
    issues: string[];
    suggestions: string[];
    summary: string;
  };
  directorControl: DirectorControl;
  compact?: boolean;
}) {
  const issueSummary = params.ruleSummary.issues.slice(0, 3);
  const suggestionSummary = params.ruleSummary.suggestions.slice(0, 3);
  return [
    `镜头序号: ${params.sequence}`,
    `预检阶段: ${params.precheckStage}`,
    `生成模式: ${params.generationMode}`,
    `项目风格: ${params.styleBrief || "未提供明确风格说明"}`,
    "",
    "剧情与创作输入:",
    safeStringify({
      shotPrompt: normalizeText(params.shot.prompt),
      motionScript: normalizeText(params.shot.motionScript),
      videoScript: normalizeText(params.shot.videoScript),
      videoPrompt:
        params.precheckStage === "image_prompt"
          ? undefined
          : normalizeText(params.shot.videoPrompt),
      cameraDirection: normalizeText(params.shot.cameraDirection),
      panelPrompts:
        params.generationMode === "storyboard_grid"
          ? (params.panelPrompts ?? []).map((item) => normalizeText(item)).filter(Boolean)
          : undefined,
      startFrameDesc:
        params.generationMode === "storyboard_grid"
          ? undefined
          : normalizeText(params.startFrameDesc),
      endFrameDesc:
        params.generationMode === "storyboard_grid"
          ? undefined
          : normalizeText(params.endFrameDesc),
    }),
    "",
    "导演控制:",
    safeStringify(params.directorControl),
    "",
    "IntentCard:",
    safeStringify(
      params.compact
        ? {
            shotId: params.intentCard.shotId,
            duration: params.intentCard.duration,
            mode: params.intentCard.mode,
            immutableAnchors: params.intentCard.immutableAnchors,
            openingState: params.intentCard.openingState,
            movementObjective: params.intentCard.movementObjective,
            cameraPlan: params.intentCard.cameraPlan,
            closingState: params.intentCard.closingState,
            chain: params.intentCard.chain,
            motionBudget: params.intentCard.motionBudget,
          }
        : params.intentCard
    ),
    "",
    "素材状态:",
    safeStringify(params.assets),
    "",
    "规则预检结果:",
    safeStringify(
      params.compact
        ? {
            pass: params.ruleSummary.pass,
            score: params.ruleSummary.score,
            summary: params.ruleSummary.summary,
            issues: issueSummary,
            suggestions: suggestionSummary,
          }
        : params.ruleSummary
    ),
    "",
    "请基于以上信息，审查这组提示词是否真正符合剧情、导演控制、镜头连贯性与弱视频模型可执行性，并按指定 JSON 输出。",
  ].join("\n");
}

function normalizeLlmAudit(payload: unknown): ShotLlmAudit {
  if (!payload || typeof payload !== "object") {
    throw new Error("AI audit returned empty payload");
  }
  const record = payload as Record<string, unknown>;
  const dimensionInput =
    record.dimensionScores && typeof record.dimensionScores === "object"
      ? (record.dimensionScores as Record<string, unknown>)
      : {};
  const issuesInput = Array.isArray(record.issues) ? record.issues : [];

  const issues: AuditIssue[] = issuesInput
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const issue = item as Record<string, unknown>;
      const evidence = normalizeText(issue.evidence);
      const reason = normalizeText(issue.reason);
      const field = normalizeText(issue.field);
      if (!evidence || !field) return null;
      return {
        severity: clampSeverity(issue.severity),
        field,
        evidence: shorten(evidence, 180),
        reason: shorten(reason || "存在影响视频控制力的风险。", 180),
      };
    })
    .filter((item): item is AuditIssue => !!item)
    .slice(0, 4);

  return {
    pass: Boolean(record.pass),
    overallScore: clampScore(record.overallScore, 0),
    dimensionScores: {
      story: clampScore(dimensionInput.story, 0),
      director: clampScore(dimensionInput.director, 0),
      continuity: clampScore(dimensionInput.continuity, 0),
      camera: clampScore(dimensionInput.camera, 0),
      executability: clampScore(dimensionInput.executability, 0),
      style: clampScore(dimensionInput.style, 0),
    },
    issues,
    suggestions: normalizeTextArray(record.suggestions),
    fixTarget: normalizeText(record.fixTarget) || "video_prompt",
    summary:
      shorten(normalizeText(record.summary), 220) ||
      "AI 审查未给出摘要，请优先检查视频提示词与四宫格锚点。",
  };
}

export async function runShotLlmAudit(params: {
  provider: ReturnType<typeof resolveAIProvider> | null;
  sequence: number;
  precheckStage: PrecheckStage;
  generationMode: "storyboard_grid" | "keyframe" | "reference";
  intentCard: ShotIntentCard;
  shot: {
    prompt?: string | null;
    motionScript?: string | null;
    videoScript?: string | null;
    videoPrompt?: string | null;
    cameraDirection?: string | null;
  };
  panelPrompts?: string[];
  startFrameDesc?: string | null;
  endFrameDesc?: string | null;
  styleBrief: string;
  assets: {
    panelCount: number;
    hasStoryboardGrid: boolean;
    hasReferenceImages: boolean;
  };
  ruleSummary: {
    pass: boolean;
    score: number;
    issues: string[];
    suggestions: string[];
    summary: string;
  };
  directorControl: DirectorControl;
  providerError: string | null;
  compact?: boolean;
}): Promise<{
  auditStatus: AuditStatus;
  auditMessage?: string;
  llmAudit?: ShotLlmAudit;
}> {
  if (!params.provider) {
    return {
      auditStatus: "skipped",
      auditMessage: params.providerError || "未配置文本模型，已跳过 AI 连贯性审查。",
    };
  }

  try {
    const raw = await withTimeout(
      params.provider.generateText(buildAuditUserPrompt(params), {
        systemPrompt: buildAuditSystemPrompt(params.precheckStage),
        temperature: 0.2,
        maxTokens: 1200,
      }),
      PRECHECK_AUDIT_TIMEOUT_MS,
      `Shot ${params.sequence} AI audit`
    );

    const parsed = JSON.parse(extractJSON(raw));
    return {
      auditStatus: "ok",
      llmAudit: normalizeLlmAudit(parsed),
    };
  } catch (error) {
    const message = extractErrorMessage(error);
    if (/timed out/i.test(message)) {
      return {
        auditStatus: "skipped",
        auditMessage: shorten(`AI 审查超时：${message}`, 220),
      };
    }
    return {
      auditStatus: "failed",
      auditMessage: shorten(message, 220),
    };
  }
}

export function mergeResultScore(ruleScore: number, llmScore?: number): number {
  if (typeof llmScore !== "number") return ruleScore;
  return clampScore(Math.round(ruleScore * 0.45 + llmScore * 0.55), ruleScore);
}

export function mergeIssues(
  ruleIssues: string[],
  llmIssues?: AuditIssue[],
  auditMessage?: string
): string[] {
  const aiIssues =
    llmIssues?.map(
      (item) =>
        `[AI ${item.severity}/${item.field}] ${item.evidence}${item.reason ? `：${item.reason}` : ""}`
    ) ?? [];
  const merged = dedupeList([...ruleIssues, ...aiIssues]);
  if (auditMessage && merged.length === 0) {
    merged.push(`AI 审查未完成：${auditMessage}`);
  }
  return merged.slice(0, 6);
}

export function mergeSuggestions(
  ruleSuggestions: string[],
  llmSuggestions?: string[],
  auditStatus?: AuditStatus,
  auditMessage?: string
): string[] {
  const merged = dedupeList([...(ruleSuggestions || []), ...(llmSuggestions || [])]);
  if ((auditStatus === "failed" || auditStatus === "skipped") && auditMessage) {
    merged.push(`AI 审查状态：${auditMessage}`);
  }
  return merged.slice(0, 6);
}
