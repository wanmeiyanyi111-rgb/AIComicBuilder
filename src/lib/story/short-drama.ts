export const SHORT_DRAMA_MIN_DURATION_SEC = 120;
export const SHORT_DRAMA_MAX_DURATION_SEC = 180;
export const SHORT_DRAMA_TARGET_DURATION_SEC = 150;
export const SHORT_DRAMA_MAX_CHARACTERS = 5;
export const SHORT_DRAMA_MAX_SCENES = 4;

export type ShortDramaScriptDurationStatus = "short" | "ok" | "long";

export type ShortDramaBeat = {
  name: string;
  durationSec: number;
  summary: string;
};

export type ShortDramaIssueSeverity = "error" | "warning";

export type ShortDramaValidationIssue = {
  code: string;
  severity: ShortDramaIssueSeverity;
  message: string;
};

export type ShortDramaValidationResult = {
  pass: boolean;
  estimatedDurationSec: number;
  beatsDurationSec: number;
  issues: ShortDramaValidationIssue[];
  recommendedAction: "none" | "repair" | "resplit";
};

export type ShortDramaDurationEstimate = {
  estimatedDurationSec: number;
  beatsDurationSec: number;
  heuristicDurationSec: number;
  complexityScore: number;
};

export type ShortDramaBeatShotBudget = {
  beatName: string;
  durationSec: number;
  targetShots: number;
  suggestedShotDurationSec: number;
  summary: string;
};

export type ShortDramaShotBudget = {
  targetShotCount: number;
  minShotCount: number;
  maxShotCount: number;
  averageShotDurationSec: number;
  beatBudgets: ShortDramaBeatShotBudget[];
};

export type ShortDramaSplitMeta = {
  storyMode: "short_drama";
  targetDurationSec: number;
  durationMinSec: number;
  durationMaxSec: number;
  estimatedDurationSec: number;
  hook: string;
  coreConflict: string;
  turningPoint: string;
  cliffhanger: string;
  beats: ShortDramaBeat[];
  pacingNotes?: string;
  validationIssues?: string[];
  scriptEstimatedDurationSec?: number;
  scriptDurationStatus?: ShortDramaScriptDurationStatus;
  scriptDurationNotes?: string[];
};

export type ShortDramaEpisodePlan = {
  title: string;
  description: string;
  keywords: string;
  idea: string;
  characters?: string[];
  scenes?: string[];
  props?: string[];
} & ShortDramaSplitMeta;

function clampPositiveInt(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function formatScriptDurationStatus(
  status: ShortDramaScriptDurationStatus | undefined
): string {
  if (status === "short") return "偏短";
  if (status === "long") return "偏长";
  return "达标";
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed);
    }
  }
  return null;
}

export function normalizeShortDramaBeats(value: unknown): ShortDramaBeat[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const raw = item as Record<string, unknown>;
      const name =
        (typeof raw.name === "string" && raw.name.trim()) ||
        (typeof raw.type === "string" && raw.type.trim()) ||
        "";
      const summary =
        (typeof raw.summary === "string" && raw.summary.trim()) ||
        (typeof raw.description === "string" && raw.description.trim()) ||
        "";
      const durationSec =
        toPositiveInt(raw.durationSec ?? raw.duration ?? raw.seconds) ?? 0;

      if (!name && !summary) return null;
      return {
        name: name || "beat",
        durationSec,
        summary,
      };
    })
    .filter((item): item is ShortDramaBeat => !!item)
    .slice(0, 8);
}

export function deriveEstimatedDurationSec(
  value: Pick<
    ShortDramaSplitMeta,
    "estimatedDurationSec" | "beats" | "targetDurationSec"
  >
): number {
  const beatsDurationSec = value.beats.reduce(
    (sum, beat) => sum + clampPositiveInt(beat.durationSec, 0),
    0
  );
  if (value.estimatedDurationSec > 0) {
    return clampPositiveInt(value.estimatedDurationSec, SHORT_DRAMA_TARGET_DURATION_SEC);
  }
  if (beatsDurationSec > 0) return beatsDurationSec;
  return clampPositiveInt(
    value.targetDurationSec,
    SHORT_DRAMA_TARGET_DURATION_SEC
  );
}

export function estimateShortDramaDuration(
  episode: Pick<
    ShortDramaEpisodePlan,
    | "idea"
    | "beats"
    | "characters"
    | "scenes"
    | "props"
    | "targetDurationSec"
    | "estimatedDurationSec"
  >
): ShortDramaDurationEstimate {
  const beatsDurationSec = episode.beats.reduce(
    (sum, beat) => sum + clampPositiveInt(beat.durationSec, 0),
    0
  );

  const ideaText = (episode.idea || "").replace(/\s+/g, " ").trim();
  const ideaLength = ideaText.length;
  const sentenceCount = ideaText
    ? ideaText.split(/[。！？.!?；;\n]/).map((part) => part.trim()).filter(Boolean).length
    : 0;
  const beatSummaryLength = episode.beats.reduce(
    (sum, beat) => sum + (beat.summary || "").trim().length,
    0
  );
  const actionKeywordCount = (
    ideaText.match(/追|打|冲|逃|撞|摔|揭|反转|爆炸|冲突|危机|battle|fight|rush|chase|reveal|twist/gi) || []
  ).length;

  const complexityScore =
    Math.min(28, Math.round(ideaLength / 55)) +
    Math.min(18, sentenceCount * 2) +
    Math.min(14, Math.round(beatSummaryLength / 30)) +
    Math.min(12, (episode.scenes || []).length * 3) +
    Math.min(10, (episode.characters || []).length * 2) +
    Math.min(8, (episode.props || []).length) +
    Math.min(12, actionKeywordCount * 2);

  const heuristicDurationSec = clampPositiveInt(
    100 + complexityScore,
    SHORT_DRAMA_TARGET_DURATION_SEC
  );

  const modelDurationSec =
    episode.estimatedDurationSec && episode.estimatedDurationSec > 0
      ? clampPositiveInt(episode.estimatedDurationSec, SHORT_DRAMA_TARGET_DURATION_SEC)
      : 0;

  let estimatedDurationSec = SHORT_DRAMA_TARGET_DURATION_SEC;
  if (beatsDurationSec > 0 && modelDurationSec > 0) {
    estimatedDurationSec = Math.round(
      beatsDurationSec * 0.45 + modelDurationSec * 0.3 + heuristicDurationSec * 0.25
    );
  } else if (beatsDurationSec > 0) {
    estimatedDurationSec = Math.round(
      beatsDurationSec * 0.7 + heuristicDurationSec * 0.3
    );
  } else if (modelDurationSec > 0) {
    estimatedDurationSec = Math.round(
      modelDurationSec * 0.65 + heuristicDurationSec * 0.35
    );
  } else {
    estimatedDurationSec = heuristicDurationSec;
  }

  estimatedDurationSec = Math.max(
    SHORT_DRAMA_MIN_DURATION_SEC,
    Math.min(SHORT_DRAMA_MAX_DURATION_SEC, estimatedDurationSec)
  );

  return {
    estimatedDurationSec,
    beatsDurationSec,
    heuristicDurationSec,
    complexityScore,
  };
}

export function buildShortDramaShotBudget(
  meta: Partial<ShortDramaSplitMeta> | null | undefined
): ShortDramaShotBudget | null {
  if (!meta) return null;
  const beats = Array.isArray(meta.beats) ? meta.beats : [];
  const estimate = estimateShortDramaDuration({
    idea: "",
    beats,
    characters: [],
    scenes: [],
    props: [],
    targetDurationSec: meta.targetDurationSec || SHORT_DRAMA_TARGET_DURATION_SEC,
    estimatedDurationSec:
      meta.estimatedDurationSec || meta.targetDurationSec || SHORT_DRAMA_TARGET_DURATION_SEC,
  });
  const scriptEstimatedDurationSec =
    typeof meta.scriptEstimatedDurationSec === "number" &&
    Number.isFinite(meta.scriptEstimatedDurationSec) &&
    meta.scriptEstimatedDurationSec > 0
      ? Math.round(meta.scriptEstimatedDurationSec)
      : 0;
  const totalDuration = scriptEstimatedDurationSec || estimate.estimatedDurationSec;
  const scriptDurationStatus = meta.scriptDurationStatus || "ok";
  const averageShotDurationSec =
    scriptDurationStatus === "long" ? 10.5 : scriptDurationStatus === "short" ? 12.5 : 11.5;
  let targetShotCount = Math.max(
    10,
    Math.round(totalDuration / averageShotDurationSec)
  );
  if (scriptDurationStatus === "long") {
    targetShotCount += 1;
  } else if (scriptDurationStatus === "short") {
    targetShotCount = Math.max(8, targetShotCount - 1);
  }
  const minShotCount = Math.max(
    8,
    targetShotCount - (scriptDurationStatus === "ok" ? 2 : 1)
  );
  const maxShotCount = targetShotCount + (scriptDurationStatus === "long" ? 3 : 2);

  const beatBudgets = beats.length
    ? beats.map((beat) => {
        const durationSec = clampPositiveInt(
          beat.durationSec,
          Math.max(12, Math.round(totalDuration / Math.max(1, beats.length)))
        );
        const targetShots = Math.max(1, Math.round(durationSec / averageShotDurationSec));
        return {
          beatName: beat.name,
          durationSec,
          targetShots,
          suggestedShotDurationSec: Math.max(
            10,
            Math.min(14, Math.round(durationSec / Math.max(1, targetShots)))
          ),
          summary: beat.summary,
        };
      })
    : [
        {
          beatName: "full_episode",
          durationSec: totalDuration,
          targetShots: targetShotCount,
          suggestedShotDurationSec: averageShotDurationSec,
          summary: "",
        },
      ];

  return {
    targetShotCount,
    minShotCount,
    maxShotCount,
    averageShotDurationSec,
    beatBudgets,
  };
}

export function validateShortDramaEpisode(
  episode: ShortDramaEpisodePlan
): ShortDramaValidationResult {
  const issues: ShortDramaValidationIssue[] = [];
  const durationEstimate = estimateShortDramaDuration(episode);
  const beatsDurationSec = durationEstimate.beatsDurationSec;
  const estimatedDurationSec = durationEstimate.estimatedDurationSec;

  if (!episode.hook.trim()) {
    issues.push({
      code: "missing_hook",
      severity: "error",
      message: "缺少强钩子开场",
    });
  }

  if (!episode.coreConflict.trim()) {
    issues.push({
      code: "missing_core_conflict",
      severity: "error",
      message: "缺少单集核心冲突",
    });
  }

  if (!episode.turningPoint.trim()) {
    issues.push({
      code: "missing_turning_point",
      severity: "error",
      message: "缺少中段反转或关键转折",
    });
  }

  if (!episode.cliffhanger.trim()) {
    issues.push({
      code: "missing_cliffhanger",
      severity: "error",
      message: "缺少结尾悬念或爆点",
    });
  }

  if (episode.beats.length < 4) {
    issues.push({
      code: "insufficient_beats",
      severity: "error",
      message: "短剧节奏段落不足，至少需要 4 个 beat",
    });
  }

  if (
    estimatedDurationSec < episode.durationMinSec ||
    estimatedDurationSec > episode.durationMaxSec
  ) {
    issues.push({
      code: "estimated_duration_out_of_range",
      severity: "error",
      message: `预计时长 ${estimatedDurationSec}s 不在 ${episode.durationMinSec}-${episode.durationMaxSec}s 内`,
    });
  }

  if (
    beatsDurationSec > 0 &&
    (beatsDurationSec < episode.durationMinSec || beatsDurationSec > episode.durationMaxSec)
  ) {
    issues.push({
      code: "beats_duration_out_of_range",
      severity: "error",
      message: `节奏段落累计时长 ${beatsDurationSec}s 不在 ${episode.durationMinSec}-${episode.durationMaxSec}s 内`,
    });
  }

  if ((episode.characters || []).length > SHORT_DRAMA_MAX_CHARACTERS) {
    issues.push({
      code: "too_many_characters",
      severity: "warning",
      message: `本集角色过多（${episode.characters?.length}），短剧建议不超过 ${SHORT_DRAMA_MAX_CHARACTERS} 人`,
    });
  }

  if ((episode.scenes || []).length > SHORT_DRAMA_MAX_SCENES) {
    issues.push({
      code: "too_many_scenes",
      severity: "warning",
      message: `本集场景过多（${episode.scenes?.length}），短剧建议不超过 ${SHORT_DRAMA_MAX_SCENES} 个核心场景`,
    });
  }

  if (episode.idea.trim().length < 160) {
    issues.push({
      code: "thin_episode_idea",
      severity: "warning",
      message: "单集策划信息偏少，后续剧本生成可能不够稳定",
    });
  }

  const hasHardFailure = issues.some((issue) => issue.severity === "error");
  const farOffDuration =
    estimatedDurationSec < episode.durationMinSec - 30 ||
    estimatedDurationSec > episode.durationMaxSec + 60 ||
    (beatsDurationSec > 0 &&
      (beatsDurationSec < episode.durationMinSec - 30 ||
        beatsDurationSec > episode.durationMaxSec + 60));

  return {
    pass: !hasHardFailure,
    estimatedDurationSec,
    beatsDurationSec,
    issues,
    recommendedAction: hasHardFailure
      ? farOffDuration || episode.beats.length <= 1
        ? "resplit"
        : "repair"
      : "none",
  };
}

export function summarizeShortDramaIssues(
  issues: ShortDramaValidationIssue[]
): string {
  return issues.map((issue) => issue.message).join("；");
}

export function buildShortDramaPlanContext(
  meta: Partial<ShortDramaSplitMeta> | null | undefined
): string {
  if (!meta) return "";
  const beats = Array.isArray(meta.beats) ? meta.beats : [];
  const scriptDurationNotes = Array.isArray(meta.scriptDurationNotes)
    ? meta.scriptDurationNotes.filter(
        (note): note is string => typeof note === "string" && !!note.trim()
      )
    : [];
  const budget = buildShortDramaShotBudget(meta);
  const beatText = beats
    .map((beat) => `- ${beat.name}（${beat.durationSec || 0}s）：${beat.summary || ""}`)
    .join("\n");
  const beatBudgetText = budget
    ? budget.beatBudgets
        .map(
          (item) =>
            `- ${item.beatName}：约 ${item.targetShots} 镜头，平均 ${item.suggestedShotDurationSec}s/镜头，覆盖 ${item.durationSec}s`
        )
        .join("\n")
    : "";
  const lines = [
    "【短剧分集规划】",
    `故事模式：${meta.storyMode || "short_drama"}`,
    `目标时长：${meta.targetDurationSec || SHORT_DRAMA_TARGET_DURATION_SEC}s`,
    `允许范围：${meta.durationMinSec || SHORT_DRAMA_MIN_DURATION_SEC}-${meta.durationMaxSec || SHORT_DRAMA_MAX_DURATION_SEC}s`,
    meta.estimatedDurationSec
      ? `当前规划预计时长：${meta.estimatedDurationSec}s`
      : "",
    meta.scriptEstimatedDurationSec
      ? `剧本复核时长：${meta.scriptEstimatedDurationSec}s（${formatScriptDurationStatus(meta.scriptDurationStatus)}）`
      : "",
    meta.hook ? `开场钩子：${meta.hook}` : "",
    meta.coreConflict ? `核心冲突：${meta.coreConflict}` : "",
    meta.turningPoint ? `关键转折：${meta.turningPoint}` : "",
    meta.cliffhanger ? `结尾悬念：${meta.cliffhanger}` : "",
    meta.pacingNotes ? `节奏说明：${meta.pacingNotes}` : "",
    beatText ? `节奏分段：\n${beatText}` : "",
    budget
      ? `镜头预算：目标约 ${budget.targetShotCount} 镜头（允许 ${budget.minShotCount}-${budget.maxShotCount} 镜头），平均 ${budget.averageShotDurationSec}s/镜头`
      : "",
    beatBudgetText ? `分段镜头预算：\n${beatBudgetText}` : "",
    scriptDurationNotes.length
      ? `剧本复核提示：${scriptDurationNotes.join("；")}`
      : "",
  ].filter(Boolean);

  return lines.join("\n");
}
