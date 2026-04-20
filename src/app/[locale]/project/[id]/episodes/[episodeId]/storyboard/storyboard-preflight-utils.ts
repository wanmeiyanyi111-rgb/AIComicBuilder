export type DirectorControl = {
  actionIntensity: number;
  cameraMotion: number;
  emotionIntensity: number;
};

export type VideoPreflightShotResult = {
  shotId: string;
  sequence: number;
  pass: boolean;
  score: number;
  ruleScore: number;
  summary: string;
  issues: string[];
  suggestions: string[];
  auditStatus?: "ok" | "failed" | "skipped";
  auditMessage?: string;
  llmAudit?: {
    pass: boolean;
    overallScore: number;
    dimensionScores: {
      story: number;
      director: number;
      continuity: number;
      camera: number;
      executability: number;
      style: number;
    };
    issues: Array<{
      severity: "low" | "medium" | "high";
      field: string;
      evidence: string;
      reason: string;
    }>;
    suggestions: string[];
    fixTarget: string;
    summary: string;
  };
};

export type PrecheckStage = "full" | "image_prompt" | "video_prompt";

export type VideoPreflightResponse = {
  status: "ok";
  mode: "storyboard_grid" | "reference";
  stage?: PrecheckStage;
  directorControl: DirectorControl;
  summary: {
    total: number;
    pass: number;
    fail: number;
    passRate: number;
    averageScore: number;
    audit?: {
      ok: number;
      failed: number;
      skipped: number;
      pass: number;
      fail: number;
      averageScore: number;
    };
  };
  results: VideoPreflightShotResult[];
};

export type PreflightRunState = "pending" | "running" | "done" | "error";

export type PreflightFixSnapshot = {
  prompt: string;
  firstPanelPrompt: string;
  fourthPanelPrompt: string;
  motionScript: string;
  videoPrompt: string;
  cameraDirection: string;
};

export type PreflightFixDiffRecord = {
  before: PreflightFixSnapshot;
  after: PreflightFixSnapshot;
  changedFields: Array<keyof PreflightFixSnapshot>;
};

export const DEFAULT_DIRECTOR_CONTROL: DirectorControl = {
  actionIntensity: 50,
  cameraMotion: 50,
  emotionIntensity: 50,
};

export function clampPercent(value: number, fallback = 50): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function parseDirectorControl(raw: string | null): DirectorControl {
  if (!raw) return DEFAULT_DIRECTOR_CONTROL;
  try {
    const parsed = JSON.parse(raw) as Partial<DirectorControl>;
    return {
      actionIntensity: clampPercent(
        Number(parsed.actionIntensity),
        DEFAULT_DIRECTOR_CONTROL.actionIntensity
      ),
      cameraMotion: clampPercent(
        Number(parsed.cameraMotion),
        DEFAULT_DIRECTOR_CONTROL.cameraMotion
      ),
      emotionIntensity: clampPercent(
        Number(parsed.emotionIntensity),
        DEFAULT_DIRECTOR_CONTROL.emotionIntensity
      ),
    };
  } catch {
    return DEFAULT_DIRECTOR_CONTROL;
  }
}

export function normalizeDiffText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

export function isAuditTimeout(message?: string): boolean {
  return /timeout|timed out|超时/i.test(message || "");
}

export function createEmptyPreflightResponse(
  mode: "storyboard_grid" | "reference",
  directorControl: DirectorControl,
  total: number
): VideoPreflightResponse {
  return {
    status: "ok",
    mode,
    directorControl,
    summary: {
      total,
      pass: 0,
      fail: 0,
      passRate: 0,
      averageScore: 0,
      audit: {
        ok: 0,
        failed: 0,
        skipped: 0,
        pass: 0,
        fail: 0,
        averageScore: 0,
      },
    },
    results: [],
  };
}

export function getPrecheckStageLabel(stage?: PrecheckStage): string {
  if (stage === "image_prompt") return "生图前提示词预审";
  if (stage === "video_prompt") return "生视频前提示词预审";
  return "连续性预检";
}

export function mergePreflightResponses(
  current: VideoPreflightResponse,
  next: VideoPreflightResponse
): VideoPreflightResponse {
  const nextById = new Map(next.results.map((item) => [item.shotId, item]));
  const mergedResults = current.results.map((item) =>
    nextById.get(item.shotId) ?? item
  );
  for (const item of next.results) {
    if (!mergedResults.some((existing) => existing.shotId === item.shotId)) {
      mergedResults.push(item);
    }
  }
  mergedResults.sort((a, b) => a.sequence - b.sequence);
  const total = current.summary.total || mergedResults.length;
  const pass = mergedResults.filter((item) => item.pass).length;
  const fail = mergedResults.filter((item) => !item.pass).length;
  const averageScore = Math.round(
    mergedResults.reduce((sum, item) => sum + item.score, 0) /
      Math.max(1, mergedResults.length)
  );
  const auditOk = mergedResults.filter((item) => item.auditStatus === "ok");
  const auditPass = auditOk.filter((item) => item.llmAudit?.pass).length;
  const auditFail = auditOk.length - auditPass;
  const auditAverageScore = Math.round(
    auditOk.reduce((sum, item) => sum + (item.llmAudit?.overallScore ?? 0), 0) /
      Math.max(1, auditOk.length)
  );

  return {
    ...current,
    mode: next.mode,
    directorControl: next.directorControl,
    summary: {
      total,
      pass,
      fail,
      passRate: Math.round((pass / Math.max(1, mergedResults.length)) * 100),
      averageScore,
      audit: {
        ok: auditOk.length,
        failed: mergedResults.filter((item) => item.auditStatus === "failed").length,
        skipped: mergedResults.filter((item) => item.auditStatus === "skipped").length,
        pass: auditPass,
        fail: auditFail,
        averageScore: auditAverageScore,
      },
    },
    results: mergedResults,
  };
}
