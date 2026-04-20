type ShotIntentInput = {
  shotId: string;
  sequence: number;
  duration: number;
  mode: "storyboard_grid" | "keyframe" | "reference";
  prompt?: string | null;
  motionScript?: string | null;
  videoScript?: string | null;
  cameraDirection?: string | null;
  startFrameDesc?: string | null;
  endFrameDesc?: string | null;
  panelPrompts?: Array<string | null | undefined>;
  chainIndex?: number | null;
  chainTotal?: number | null;
  inheritPrevLastFrame?: number | null;
  hasReferenceImages?: boolean;
  characterNames?: string[];
  characterHints?: Array<{ name: string; visualHint?: string | null }>;
  directorControl?: Partial<DirectorControl> | null;
};

export type DirectorControl = {
  actionIntensity: number;
  cameraMotion: number;
  emotionIntensity: number;
};

export type ShotIntentCard = {
  shotId: string;
  sequence: number;
  duration: number;
  mode: "storyboard_grid" | "keyframe" | "reference";
  chain: {
    index: number;
    total: number;
    inheritPrevLastFrame: boolean;
  };
  immutableAnchors: string[];
  openingState: string;
  closingState: string;
  movementObjective: string;
  cameraPlan: string;
  directorControl: DirectorControl;
  motionBudget: {
    maxPrimaryActions: number;
    maxCameraMoves: number;
    maxSceneSwitches: number;
  };
};

export type ContinuityPreflightResult = {
  pass: boolean;
  score: number;
  issues: string[];
  suggestions: string[];
  summary: string;
};

const DEFAULT_DIRECTOR_CONTROL: DirectorControl = {
  actionIntensity: 50,
  cameraMotion: 50,
  emotionIntensity: 50,
};

function normalizeText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function firstSentence(value: string): string {
  if (!value) return "";
  const parts = value
    .split(/[。！？.!?；;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts[0] || value;
}

function truncate(value: string, max = 180): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function clampPercent(value: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

export function normalizeDirectorControl(
  input?: Partial<DirectorControl> | null
): DirectorControl {
  return {
    actionIntensity: clampPercent(
      input?.actionIntensity ?? DEFAULT_DIRECTOR_CONTROL.actionIntensity,
      DEFAULT_DIRECTOR_CONTROL.actionIntensity
    ),
    cameraMotion: clampPercent(
      input?.cameraMotion ?? DEFAULT_DIRECTOR_CONTROL.cameraMotion,
      DEFAULT_DIRECTOR_CONTROL.cameraMotion
    ),
    emotionIntensity: clampPercent(
      input?.emotionIntensity ?? DEFAULT_DIRECTOR_CONTROL.emotionIntensity,
      DEFAULT_DIRECTOR_CONTROL.emotionIntensity
    ),
  };
}

function countActionBeats(text: string): number {
  if (!text) return 0;
  const tokens = text
    .split(/[。！？.!?；;，,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return Math.max(1, Math.min(6, tokens.length));
}

function isCameraAggressive(cameraDirection: string): boolean {
  const value = cameraDirection.toLowerCase();
  return (
    value.includes("orbit") ||
    value.includes("crane") ||
    value.includes("dolly") ||
    value.includes("push in") ||
    value.includes("tracking")
  );
}

function similarityByWords(a: string, b: string): number {
  const wordsA = new Set(a.split(/[\s,，。.!?；;]+/).filter(Boolean));
  const wordsB = new Set(b.split(/[\s,，。.!?；;]+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let inter = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) inter += 1;
  }
  return inter / Math.max(wordsA.size, wordsB.size);
}

function buildCharacterAnchor(input: ShotIntentInput): string {
  const names = input.characterNames ?? [];
  const hints =
    input.characterHints
      ?.filter((item) => names.includes(item.name))
      .map((item) =>
        item.visualHint
          ? `${item.name}（${item.visualHint}）`
          : item.name
      ) ?? [];
  if (hints.length > 0) {
    return `角色外观锚点：${hints.join("、")}`;
  }
  if (names.length > 0) {
    return `角色外观锚点：${names.join("、")}`;
  }
  return "角色外观锚点：无角色镜头，仅保持环境连续性";
}

function buildSceneAnchor(input: ShotIntentInput): string {
  const sceneText = normalizeText(input.prompt || "");
  if (!sceneText) return "场景锚点：沿用既有空间结构与光线层次";
  return `场景锚点：${truncate(firstSentence(sceneText), 90)}`;
}

export function buildShotIntentCard(input: ShotIntentInput): ShotIntentCard {
  const duration = Math.max(1, Math.round(input.duration || 0));
  const directorControl = normalizeDirectorControl(input.directorControl);
  const motionSource = normalizeText(
    input.videoScript || input.motionScript || input.prompt || ""
  );
  const panelPrompts = (input.panelPrompts ?? [])
    .map((item) => normalizeText(item))
    .filter(Boolean);
  const openingFromFrame = normalizeText(input.startFrameDesc);
  const closingFromFrame = normalizeText(input.endFrameDesc);
  const openingFromPanel = panelPrompts[0] || "";
  const closingFromPanel =
    panelPrompts[Math.min(3, Math.max(0, panelPrompts.length - 1))] || "";
  const openingFallback = `镜头起点保持稳定构图，动作尚未展开。${motionSource ? `线索：${truncate(firstSentence(motionSource), 80)}` : ""}`.trim();
  const closingFallback = `镜头终点为动作完成后的稳定停驻姿态，作为后续镜头衔接锚点。`;
  const openingState =
    input.mode === "storyboard_grid"
      ? openingFromPanel || openingFromFrame || openingFallback
      : openingFromFrame || openingFallback;
  const closingState =
    input.mode === "storyboard_grid"
      ? closingFromPanel || closingFromFrame || closingFallback
      : closingFromFrame || closingFallback;

  const chainIndex = input.chainIndex ?? 1;
  const chainTotal = input.chainTotal ?? 1;
  const inheritPrevLastFrame = input.inheritPrevLastFrame === 1;

  const immutableAnchors: string[] = [
    buildCharacterAnchor(input),
    buildSceneAnchor(input),
    "风格锚点：画风、材质语言、色温、光线方向不可漂移",
    `导演控制：动作强度=${directorControl.actionIntensity}/100，运镜强度=${directorControl.cameraMotion}/100，情绪强度=${directorControl.emotionIntensity}/100`,
  ];
  if (chainIndex > 1 && inheritPrevLastFrame) {
    immutableAnchors.push(
      input.mode === "storyboard_grid"
        ? "链路锚点：本段第1格必须无缝承接上一段终格状态"
        : "链路锚点：本镜头必须从上一镜头尾帧状态无缝续接"
    );
  }
  if (input.mode === "storyboard_grid") {
    immutableAnchors.push("四宫格锚点：四格必须在同一空间与同一动作链内连续推进");
  }
  if (input.mode === "reference") {
    immutableAnchors.push("参考锚点：严格服从参考图中的角色与场景身份映射");
  }

  const movementObjective = motionSource
    ? truncate(firstSentence(motionSource), 120)
    : "完成一个清晰主动作目标，避免多任务并发动作";

  const cameraPlan = normalizeText(input.cameraDirection || "static") || "static";

  const actionBoost =
    directorControl.actionIntensity >= 70
      ? 1
      : directorControl.actionIntensity <= 30
        ? -1
        : 0;
  const cameraBoost =
    directorControl.cameraMotion >= 70
      ? 1
      : directorControl.cameraMotion <= 30
        ? -1
        : 0;
  const maxPrimaryActions = Math.max(
    1,
    Math.min(3, (duration <= 5 ? 1 : 2) + actionBoost)
  );
  const maxCameraMoves = Math.max(
    1,
    Math.min(3, (duration <= 5 ? 1 : 2) + cameraBoost)
  );
  const maxSceneSwitches =
    duration <= 5
      ? 0
      : directorControl.actionIntensity >= 75 || directorControl.cameraMotion >= 75
        ? 1
        : 0;

  return {
    shotId: input.shotId,
    sequence: input.sequence,
    duration,
    mode: input.mode,
    chain: {
      index: chainIndex,
      total: chainTotal,
      inheritPrevLastFrame,
    },
    immutableAnchors,
    openingState,
    closingState,
    movementObjective,
    cameraPlan,
    directorControl,
    motionBudget: {
      maxPrimaryActions,
      maxCameraMoves,
      maxSceneSwitches,
    },
  };
}

export function buildIntentDrivenMotionContext(card: ShotIntentCard): string {
  const lines: string[] = [];
  lines.push(`IntentCard Shot ${card.sequence} (${card.duration}s, ${card.mode})`);
  if (card.chain.total > 1) {
    lines.push(
      `Segment ${card.chain.index}/${card.chain.total}. ${card.chain.inheritPrevLastFrame ? "必须以上一尾帧作为当前起点。" : "本段建立稳定起始态。"}`
    );
  }
  lines.push(`起点状态：${card.openingState}`);
  lines.push(`终点状态：${card.closingState}`);
  lines.push(`主动作目标：${card.movementObjective}`);
  lines.push(`镜头路径：${card.cameraPlan}`);
  lines.push(
    `导演控制：动作强度 ${card.directorControl.actionIntensity}/100；运镜强度 ${card.directorControl.cameraMotion}/100；情绪强度 ${card.directorControl.emotionIntensity}/100。`
  );
  lines.push(
    `动作预算：最多 ${card.motionBudget.maxPrimaryActions} 个主动作，最多 ${card.motionBudget.maxCameraMoves} 次机位变化。`
  );
  lines.push(`不变锚点：${card.immutableAnchors.join("；")}`);
  lines.push("禁止多角色同时执行互不相关动作；禁止风格、服装、光线、空间关系跳变。");
  return lines.join("\n");
}

export function appendIntentToVideoPrompt(
  basePrompt: string,
  card: ShotIntentCard
): string {
  const prompt = (basePrompt || "").trim();
  const intentBlock = [
    "[CONTINUITY_INTENT]",
    `Shot=${card.sequence},Duration=${card.duration}s,Mode=${card.mode}`,
    `Opening=${card.openingState}`,
    `Closing=${card.closingState}`,
    `MotionObjective=${card.movementObjective}`,
    `Camera=${card.cameraPlan}`,
    `Director=Action:${card.directorControl.actionIntensity},Camera:${card.directorControl.cameraMotion},Emotion:${card.directorControl.emotionIntensity}`,
    `Budget=Actions<=${card.motionBudget.maxPrimaryActions},CameraMoves<=${card.motionBudget.maxCameraMoves}`,
    `Anchors=${card.immutableAnchors.join(" | ")}`,
    "[/CONTINUITY_INTENT]",
  ].join("\n");

  if (!prompt) return intentBlock;
  if (prompt.includes("[CONTINUITY_INTENT]")) return prompt;
  return `${intentBlock}\n\n${prompt}`;
}

export function evaluateVideoContinuityPreflight(
  card: ShotIntentCard
): ContinuityPreflightResult {
  let score = 100;
  const issues: string[] = [];
  const suggestions: string[] = [];
  const openingAnchorLabel =
    card.mode === "storyboard_grid" ? "第1格锚点" : "首帧状态";
  const closingAnchorLabel =
    card.mode === "storyboard_grid" ? "第4格锚点" : "尾帧状态";
  const anchorPairLabel =
    card.mode === "storyboard_grid" ? "四宫格前后锚点" : "首尾帧";
  const rewriteHint =
    card.mode === "storyboard_grid"
      ? "先重生四宫格提示词，补齐构图、姿态、光线三个要素。"
      : "先重生首尾帧提示词，补齐构图、姿态、光线三个要素。";
  const closingHint =
    card.mode === "storyboard_grid"
      ? "在第4格明确结果态，强调动作完成后的稳定停驻姿态。"
      : "先重生尾帧提示词，强调动作完成后的稳定停驻姿态。";

  const opening = normalizeText(card.openingState);
  const closing = normalizeText(card.closingState);
  const openingLen = opening.length;
  const closingLen = closing.length;

  if (card.mode === "keyframe" || card.mode === "storyboard_grid") {
    if (openingLen < 24) {
      score -= 22;
      issues.push(`${openingAnchorLabel}描述过短，模型无法稳定锁定起点。`);
      suggestions.push(rewriteHint);
    }
    if (closingLen < 24) {
      score -= 22;
      issues.push(`${closingAnchorLabel}描述过短，模型无法稳定锁定终点。`);
      suggestions.push(closingHint);
    }
  }

  const beatCount = countActionBeats(card.movementObjective);
  if (beatCount > card.motionBudget.maxPrimaryActions) {
    const penalty = 12 + (beatCount - card.motionBudget.maxPrimaryActions) * 5;
    score -= penalty;
    issues.push(
      `动作目标过于复杂（估计 ${beatCount} 个动作节拍），超出 ${card.duration}s 镜头预算。`
    );
    suggestions.push("将该镜头动作简化为一个主动作目标，或继续拆分成更小分镜。");
  }

  if (card.directorControl.actionIntensity <= 30 && beatCount > 1) {
    score -= 10;
    issues.push("导演设定为低动作强度，但当前动作节拍仍偏复杂。");
    suggestions.push("将动作收敛到单一主动作，避免多段连续行为。");
  }

  if (card.duration <= 4 && isCameraAggressive(card.cameraPlan)) {
    const cameraPenalty = card.directorControl.cameraMotion <= 35 ? 18 : 12;
    score -= cameraPenalty;
    issues.push("短镜头使用高强度机位运动，容易导致主体抖动与轨迹漂移。");
    suggestions.push("将机位改为 static / slow zoom in / pan，并保留单一运动路径。");
  }

  if (card.directorControl.emotionIntensity >= 70) {
    const emotionalDensity =
      `${opening} ${closing}`.match(/(眼神|表情|呼吸|停顿|犹豫|紧张|愤怒|悲伤|喜悦|怒|哭|笑|注视|神情)/g)
        ?.length ?? 0;
    if (emotionalDensity < 2) {
      score -= 8;
      issues.push(
        `导演设定为高情绪强度，但${anchorPairLabel}缺少明确表情/情绪锚点。`
      );
      suggestions.push(
        card.mode === "storyboard_grid"
          ? "在第1格和第4格补充眼神、面部表情或肢体细节的情绪描述。"
          : "在首尾帧补充眼神、面部表情或肢体细节的情绪描述。"
      );
    }
  }

  if (card.chain.total > 1 && card.chain.index > 1 && !card.chain.inheritPrevLastFrame) {
    score -= 18;
    issues.push(
      card.mode === "storyboard_grid"
        ? "分段镜头未启用终格继承，连续性锚点断裂。"
        : "分段镜头未启用尾帧继承，连续性锚点断裂。"
    );
    suggestions.push(
      card.mode === "storyboard_grid"
        ? "为该段开启 inheritPrevLastFrame，使用上一段终格作为本段首格锚点。"
        : "为该段开启 inheritPrevLastFrame，使用上一段尾帧作为本段首帧。"
    );
  }

  const similarity = similarityByWords(opening, closing);
  if (similarity < 0.05) {
    score -= 8;
    issues.push(`${anchorPairLabel}语义跨度过大，弱模型易出现不连贯补偿动作。`);
    suggestions.push(
      card.mode === "storyboard_grid"
        ? "缩小第1格与第4格的状态跨度，保留相同主体朝向与空间参照物。"
        : "缩小首尾帧位移差异，保留相同主体朝向与空间参照物。"
    );
  }

  if (similarity > 0.92 && card.duration >= 4) {
    score -= 6;
    issues.push(`${anchorPairLabel}过于接近，可能导致视频无有效动作推进。`);
    suggestions.push(
      card.mode === "storyboard_grid"
        ? "在第4格增加明确结果态变化（姿态、视线或位置其一）。"
        : "在尾帧增加明确结果态变化（姿态、视线或位置其一）。"
    );
  }

  const pass = score >= 70 && issues.length < 3;
  const summary = pass
    ? `预检通过（${score}分）：可执行视频生成。`
    : `预检未通过（${score}分）：请先修复${
        card.mode === "storyboard_grid" ? "四宫格锚点" : "首尾帧"
      }或动作预算后再生成。`;

  return {
    pass,
    score: Math.max(0, Math.min(100, score)),
    issues,
    suggestions,
    summary,
  };
}
