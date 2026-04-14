export const SHOT_TRANSITION_PROFILE_IDS = [
  "balanced",
  "cinematic",
  "dynamic",
  "smooth",
] as const;

export type ShotTransitionProfileId = (typeof SHOT_TRANSITION_PROFILE_IDS)[number];

export const DEFAULT_SHOT_TRANSITION_PROFILE: ShotTransitionProfileId = "balanced";

type ProfileConfig = {
  maxNonCutRatio: number;
  maxFancyRatio: number;
  preserveExistingNonCut: boolean;
};

const PROFILE_CONFIG: Record<ShotTransitionProfileId, ProfileConfig> = {
  balanced: {
    maxNonCutRatio: 0.35,
    maxFancyRatio: 0.15,
    preserveExistingNonCut: true,
  },
  cinematic: {
    maxNonCutRatio: 0.5,
    maxFancyRatio: 0.1,
    preserveExistingNonCut: true,
  },
  dynamic: {
    maxNonCutRatio: 0.55,
    maxFancyRatio: 0.25,
    preserveExistingNonCut: true,
  },
  smooth: {
    maxNonCutRatio: 0.25,
    maxFancyRatio: 0.05,
    preserveExistingNonCut: false,
  },
};

export function normalizeShotTransitionProfileId(
  value: string | null | undefined
): ShotTransitionProfileId {
  const normalized = (value || "").trim().toLowerCase();
  if ((SHOT_TRANSITION_PROFILE_IDS as readonly string[]).includes(normalized)) {
    return normalized as ShotTransitionProfileId;
  }
  return DEFAULT_SHOT_TRANSITION_PROFILE;
}

export function getShotTransitionProfileConfig(
  profileId: string | null | undefined
): ProfileConfig {
  return PROFILE_CONFIG[normalizeShotTransitionProfileId(profileId)];
}

export function getShotTransitionPolicyText(
  profileId: string | null | undefined
): string {
  const id = normalizeShotTransitionProfileId(profileId);
  switch (id) {
    case "cinematic":
      return `=== 转场策略（电影叙事）===
- 首镜头 transitionIn = "fade_in"，末镜头 transitionOut = "fade_out"
- 场景切换或明确时间跳跃优先 "dissolve"
- 同场景连续动作优先 "cut"
- 蒙太奇可少量使用 "wipeleft" / "circleopen"，但必须克制
- 非 cut 转场建议占比约 30%-50%，花哨转场（wipe/circle/slide）不超过 10%`;
    case "dynamic":
      return `=== 转场策略（高动势）===
- 首镜头 transitionIn = "fade_in"，末镜头 transitionOut = "fade_out"
- 连续打斗或追逐允许更积极的转场变化
- 场景切换优先 "dissolve"，节奏爆点可用 "wipeleft" / "circleopen" / "slideright"
- 同一动作链内部（前后镜头强连续）优先 "cut"
- 非 cut 转场建议占比约 35%-55%，花哨转场不超过 25%`;
    case "smooth":
      return `=== 转场策略（平滑连贯）===
- 首镜头 transitionIn = "fade_in"，末镜头 transitionOut = "fade_out"
- 绝大多数镜头使用 "cut"
- 仅在场景/时间明确跳转时使用 "dissolve"
- 尽量避免 "wipeleft" / "circleopen" / "slideright"
- 非 cut 转场建议占比不超过 25%，花哨转场不超过 5%`;
    case "balanced":
    default:
      return `=== 转场策略（均衡默认）===
- 首镜头 transitionIn = "fade_in"，末镜头 transitionOut = "fade_out"
- 场景切换或时间跳跃使用 "dissolve"
- 同一场景连续动作默认 "cut"
- 蒙太奇或强节奏段落可偶尔使用 "wipeleft" / "circleopen"
- 非 cut 转场建议占比约 20%-35%，花哨转场不超过 15%`;
  }
}
