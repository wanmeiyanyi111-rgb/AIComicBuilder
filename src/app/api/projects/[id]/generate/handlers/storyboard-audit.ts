import type { StoryboardPromptPayload } from "./storyboard-utils";

type AuditSeverity = "high" | "medium";

export type StoryboardAuditIssue = {
  severity: AuditSeverity;
  message: string;
  suggestion: string;
};

export type StoryboardPromptAuditResult = {
  pass: boolean;
  score: number;
  issues: StoryboardAuditIssue[];
};

const SHOT_SCALE_LEVELS: Record<string, number> = {
  wide: 1,
  medium: 2,
  close: 3,
  extreme_close: 4,
};

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeCameraPlan(value: string): string {
  const token = normalizeToken(value);
  if (token.includes("push") || token.includes("推进") || token.includes("推近")) {
    return "push_in";
  }
  if (token.includes("pull") || token.includes("拉远") || token.includes("后拉")) {
    return "pull_out";
  }
  if (token.includes("orbit") || token.includes("环绕")) {
    return "orbit";
  }
  if (token.includes("tilt_down") || token.includes("下摇")) {
    return "tilt_down";
  }
  if (token.includes("tilt_up") || token.includes("上摇")) {
    return "tilt_up";
  }
  if (
    token.includes("pan_left") ||
    token.includes("左摇") ||
    token.includes("向左摇")
  ) {
    return "pan_left";
  }
  if (
    token.includes("pan_right") ||
    token.includes("右摇") ||
    token.includes("向右摇")
  ) {
    return "pan_right";
  }
  if (
    token.includes("static") ||
    token.includes("固定") ||
    token.includes("静止") ||
    token.includes("锁定")
  ) {
    return "static";
  }
  return token;
}

function normalizeShotScale(value: string): string {
  const token = normalizeToken(value);
  if (token.includes("extreme_close") || token.includes("特写") || token.includes("大特写")) {
    return "extreme_close";
  }
  if (token.includes("close") || token.includes("近景")) {
    return "close";
  }
  if (token.includes("medium") || token.includes("中景")) {
    return "medium";
  }
  if (token.includes("wide") || token.includes("全景") || token.includes("远景")) {
    return "wide";
  }
  return token;
}

function normalizeFacingDirection(value: string): "left" | "right" | "front" | "back" | "" {
  const token = normalizeToken(value);
  if (token.includes("左") || token.includes("left")) return "left";
  if (token.includes("右") || token.includes("right")) return "right";
  if (token.includes("背") || token.includes("back")) return "back";
  if (token.includes("正面") || token.includes("front") || token.includes("朝前")) return "front";
  return "";
}

function uniqueNormalized(values: string[]): string[] {
  return [...new Set(values.map((item) => normalizeToken(item)).filter(Boolean))];
}

export function auditStoryboardPromptPayload(
  payload: StoryboardPromptPayload
): StoryboardPromptAuditResult {
  const issues: StoryboardAuditIssue[] = [];
  const mode = payload.progressionMode;
  const characterUniverse = new Set(payload.characters.map((name) => normalizeToken(name)));
  const cameraPlans = payload.panels.map((panel) => normalizeCameraPlan(panel.cameraPlan));
  const shotScales = payload.panels.map((panel) => normalizeShotScale(panel.shotScale));
  const facingDirections = payload.panels.map((panel) =>
    normalizeFacingDirection(panel.bodyFacing)
  );
  const beats = uniqueNormalized(payload.panels.map((panel) => panel.beat));
  const interactionStates = uniqueNormalized(
    payload.panels.map((panel) => panel.interactionState)
  );
  const gazeTargets = uniqueNormalized(payload.panels.map((panel) => panel.gazeTarget));
  const panelFunctions = uniqueNormalized(
    payload.panels.map((panel) => panel.panelFunction)
  );
  const subjectPositions = uniqueNormalized(
    payload.panels.map((panel) => panel.subjectPosition)
  );
  const deltas = uniqueNormalized(payload.panels.map((panel) => panel.delta));
  const continuityGoals = uniqueNormalized(
    payload.panels.map((panel) => panel.continuityGoal)
  );
  const resultSignals = uniqueNormalized(
    payload.panels.map((panel) => panel.resultSignal)
  );

  for (let index = 0; index < payload.panels.length; index += 1) {
    const panel = payload.panels[index];
    const normalizedCharacters = uniqueNormalized(panel.activeCharacters);
    if (normalizedCharacters.some((name) => !characterUniverse.has(name))) {
      issues.push({
        severity: "high",
        message: `第${index + 1}格 activeCharacters 出现了未在全局角色表中的人物。`,
        suggestion: "activeCharacters 只能从全局 characters 里选，禁止中途平白换人。",
      });
      break;
    }
  }

  const primaryCharacters = uniqueNormalized(
    payload.panels.slice(0, 2).flatMap((panel) => panel.activeCharacters)
  );
  if (primaryCharacters.length > 0) {
    for (let index = 2; index < payload.panels.length; index += 1) {
      const panelCharacters = new Set(
        uniqueNormalized(payload.panels[index].activeCharacters)
      );
      const missingPrimary = primaryCharacters.filter((name) => !panelCharacters.has(name));
      if (
        missingPrimary.length > 0 &&
        payload.panels[index].stage !== "outcome"
      ) {
        issues.push({
          severity: "high",
          message: `第${index + 1}格无故丢失关键角色：${missingPrimary.join("、")}。`,
          suggestion: "中段格必须保持关键角色组合连续，除非剧情明确写出谁离场且该离场本身是结果。",
        });
        break;
      }
    }
  }

  const firstCameraPlan = cameraPlans[0];
  const incompatibleCameraPlan = cameraPlans.find(
    (plan) => plan && firstCameraPlan && plan !== firstCameraPlan
  );
  if (incompatibleCameraPlan) {
    issues.push({
      severity: "high",
      message: "四格镜头主路径不统一，出现了跨格换镜头语言。",
      suggestion:
        "四格必须共用一条主镜头路径，例如持续推近、持续固定机位，不能在相邻格之间切成另一套镜头运动。",
    });
  }

  for (let index = 1; index < shotScales.length; index += 1) {
    const prevLevel = SHOT_SCALE_LEVELS[shotScales[index - 1]] ?? 0;
    const nextLevel = SHOT_SCALE_LEVELS[shotScales[index]] ?? 0;
    if (prevLevel > 0 && nextLevel > 0 && Math.abs(nextLevel - prevLevel) > 1) {
      issues.push({
        severity: "high",
        message: `第${index}格到第${index + 1}格景别跳变过大。`,
        suggestion: "相邻格景别最多只变化一级，例如 wide -> medium 或 medium -> close。",
      });
      break;
    }
  }

  for (let index = 1; index < facingDirections.length; index += 1) {
    const prevFacing = facingDirections[index - 1];
    const nextFacing = facingDirections[index];
    if (
      (prevFacing === "left" && nextFacing === "right") ||
      (prevFacing === "right" && nextFacing === "left")
    ) {
      issues.push({
        severity: "medium",
        message: `第${index}格到第${index + 1}格主体朝向疑似反转。`,
        suggestion: "保持主体身体朝向连续，只允许微调，避免左右直接对翻。",
      });
      break;
    }
  }

  const sharedWorldLock = payload.panels.reduce<string[]>((acc, panel, index) => {
    const normalized = uniqueNormalized(panel.worldLock);
    if (index === 0) return normalized;
    return acc.filter((item) => normalized.includes(item));
  }, []);
  if (sharedWorldLock.length === 0) {
    issues.push({
      severity: "high",
      message: "四格 worldLock 没有稳定重叠项，空间锚点不够统一。",
      suggestion:
        "至少保留 2-3 个跨四格重复出现的世界锚点，例如窗框位置、主光方向、背景朝向、室内外关系。",
    });
  }

  if (mode === "action_progression" && subjectPositions.length <= 1) {
    issues.push({
      severity: "medium",
      message: "四格主体位置描述几乎没有推进，容易生成成四张雷同图。",
      suggestion: "subjectPosition 需要体现小步推进，例如靠近半步、前移到门口、重心下沉等。",
    });
  }

  if (deltas.length <= 1) {
    issues.push({
      severity: "medium",
      message:
        mode === "action_progression"
          ? "四格 delta 变化过弱，没有形成 setup -> development -> escalation -> outcome 的节奏。"
          : "四格 delta 变化过弱，没有形成清晰的连续表达层次。",
      suggestion:
        mode === "action_progression"
          ? "为每一格写清楚只新增一个变化点，并让变化逐格升级。"
          : "即使不是动作推进，也要让每一格在情绪、关系、信息或氛围上有可见变化。",
    });
  }

  if (continuityGoals.length <= 1) {
    issues.push({
      severity: "medium",
      message: "四格 continuityGoal 过于重复，承接目标不清晰。",
      suggestion: "让每一格都说明它要为下一格保留什么连续性，而不是四格写成同一句话。",
    });
  }

  if (panelFunctions.length <= 2) {
    issues.push({
      severity: "medium",
      message: "四格 panelFunction 区分度不足，容易生成成同类海报或重复画面。",
      suggestion: "明确写清每格职责，例如建立关系、推进矛盾、揭示信息、给出结果，不要四格都写成类似表述。",
    });
  }

  const overlyGenericForbidden = payload.panels.filter(
    (panel) => uniqueNormalized(panel.forbiddenDrift).length <= 1
  );
  if (overlyGenericForbidden.length > 0) {
    issues.push({
      severity: "high",
      message: "部分格子的 forbiddenDrift 过弱，无法有效约束角色漂移、构图塌缩或海报化。",
      suggestion:
        "每格 forbiddenDrift 至少写 2 条具体禁止事项，例如不能丢角色、不能改角色组合、不能变成单人海报、不能复制前一格构图。",
    });
  }

  if (resultSignals.length <= 2) {
    issues.push({
      severity: "medium",
      message: "四格 resultSignal 区分度不足，容易让多格都停在同类中间态。",
      suggestion:
        "让四格 resultSignal 明确区分建立、推进、峰值、结果，而不是多格共用同一状态标签。",
    });
  }

  if (beats.length <= 2) {
    issues.push({
      severity: "medium",
      message: "四格 beat 区分度不足，分镜职责容易糊成同一种表达。",
      suggestion:
        "让四格职责更清楚，哪怕是情绪推进或对话推进，也要让每一格承担不同叙事功能。",
    });
  }

  if (mode !== "action_progression" && interactionStates.length <= 1 && gazeTargets.length <= 1) {
    issues.push({
      severity: "medium",
      message: "非动作型四宫格缺少关系或视线变化，推进方式不够成立。",
      suggestion:
        "如果不是动作推进，至少要在 interactionState、gazeTarget、构图重心或气氛压力上逐格变化。",
    });
  }

  const panel4 = payload.panels[3];
  const panel4ResultSignal = normalizeToken(panel4.resultSignal);
  if (
    ![
      "outcome_anchor",
      "suspense_hold",
      "relation_freeze",
      "reveal_complete",
    ].includes(panel4ResultSignal)
  ) {
    issues.push({
      severity: "high",
      message: "第4格 resultSignal 不是有效结果帧类型，尾锚点定义不成立。",
      suggestion:
        "第4格 resultSignal 必须明确写成 outcome_anchor、suspense_hold、relation_freeze 或 reveal_complete 之一。",
    });
  }

  const panel4Text = normalizeToken(
    `${panel4.beat} ${panel4.panelFunction} ${panel4.delta} ${panel4.continuityGoal} ${panel4.prompt}`
  );
  if (
    !panel4Text.includes("结果") &&
    !panel4Text.includes("停") &&
    !panel4Text.includes("收束") &&
    !panel4Text.includes("悬念") &&
    !panel4Text.includes("稳定") &&
    !panel4Text.includes("停顿")
  ) {
    issues.push({
      severity: "medium",
      message: "第4格缺少明显的稳定结果帧信号，视频尾锚点不够明确。",
      suggestion: "第4格要写成阶段结果、稳定停点或悬念收束帧，避免继续停在动作中间态。",
    });
  }

  const penalty = issues.reduce(
    (sum, issue) => sum + (issue.severity === "high" ? 18 : 10),
    0
  );
  const score = Math.max(0, 100 - penalty);
  return {
    pass: !issues.some((issue) => issue.severity === "high") && issues.length <= 2,
    score,
    issues,
  };
}

export function buildStoryboardAuditRevisionHints(
  audit: StoryboardPromptAuditResult
): string {
  if (audit.issues.length === 0) return "";
  const lines = [
    "上一版四宫格连续性审计未通过，请你基于原始剧情重新输出整套 4 格 JSON，并严格修复以下问题。",
    ...audit.issues.map(
      (issue, index) =>
        `${index + 1}. 问题：${issue.message} 修复：${issue.suggestion}`
    ),
    "修复要求：你必须同时重写结构化字段和 panel.prompt，不能只改个别措辞。",
    "修复要求：保持同一剧情事件、同一场景、同一角色与道具，不要扩写成新情节。",
    "修复要求：相邻格只能小步推进，禁止跳机位、跳朝向、跳空间、跳景别。",
    "修复要求：第 4 格必须提供有效的 resultSignal，并为每格写出足够具体的 forbiddenDrift。",
  ];
  return lines.join("\n");
}
