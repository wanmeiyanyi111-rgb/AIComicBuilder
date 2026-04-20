export const SEGMENT_DURATION_TARGET = 12;
export const SEGMENT_DURATION_MIN = 10;
export const SEGMENT_DURATION_MAX = 14;

type ChainFields = {
  chainGroupId: string | null;
  chainIndex: number;
  chainTotal: number;
  inheritPrevLastFrame: number;
  originalDuration: number;
};

type SegmentableShot = {
  sequence: number;
  duration: number;
  prompt?: string | null;
  motionScript?: string | null;
  videoScript?: string | null;
};

type SegmentProfile = {
  label: "action" | "emotion" | "atmosphere" | "default";
  min: number;
  target: number;
  max: number;
};

const ACTION_PATTERNS = [
  /追逐|追赶|奔跑|冲刺|扑向|突进|打斗|搏斗|厮打|挥拳|挥刀|爆炸|撞击|坠落|逃跑|fight|battle|chase|run|sprint|dash|attack|strike|crash|explode|fall/i,
  /翻滚|闪避|跳起|腾空|追杀|围攻|拉扯|撕扯|砸向|冲上去|破门|kick|punch|slam|dodge|leap|tackle|smash|rush/i,
];

const EMOTION_PATTERNS = [
  /对话|对白|交谈|质问|低语|沉默|凝视|对视|停顿|哽咽|落泪|拥抱|迟疑|反应|说出|dialogue|talk|whisper|gaze|pause|reaction|tear|cry|hug|hesitate/i,
  /表情|情绪|对峙|试探|坦白|告白|安慰|威胁|审问|逼问|回答|look at each other|confess|comfort|confront/i,
];

const ATMOSPHERE_PATTERNS = [
  /建立镜头|全景|远景|空镜|环境|街景|城市场景|夜景|晨雾|雨夜|悬念|揭示|显露|氛围|俯瞰|panorama|establishing|wide shot|landscape|atmosphere|reveal|suspense|cityscape/i,
  /缓慢展示|空间关系|环境压迫感|静止空间|空旷|压抑氛围|神秘气氛|show the setting|slow reveal|hold on/i,
];

function normalizeText(input: string | null | undefined, maxLen = 240): string {
  const text = (input || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function chooseCoreAction(input: string | null | undefined): string {
  const normalized = normalizeText(input, 480);
  if (!normalized) return "";
  const parts = normalized
    .split(/[。！？.!?；;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts[0] || normalized;
}

function countPatternMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function chooseSegmentProfile(shot?: SegmentableShot | null): SegmentProfile {
  const context = normalizeText(
    [shot?.prompt, shot?.motionScript, shot?.videoScript].filter(Boolean).join(" "),
    800
  ).toLowerCase();

  if (!context) {
    return {
      label: "default",
      min: SEGMENT_DURATION_MIN,
      target: SEGMENT_DURATION_TARGET,
      max: SEGMENT_DURATION_MAX,
    };
  }

  const actionScore = countPatternMatches(context, ACTION_PATTERNS);
  const emotionScore = countPatternMatches(context, EMOTION_PATTERNS);
  const atmosphereScore = countPatternMatches(context, ATMOSPHERE_PATTERNS);

  if (atmosphereScore > actionScore && atmosphereScore >= emotionScore) {
    return { label: "atmosphere", min: 12, target: 13, max: 14 };
  }
  if (emotionScore > actionScore && emotionScore >= atmosphereScore) {
    return { label: "emotion", min: 11, target: 12, max: 13 };
  }
  if (actionScore > 0) {
    return { label: "action", min: 10, target: 11, max: 12 };
  }
  return {
    label: "default",
    min: SEGMENT_DURATION_MIN,
    target: SEGMENT_DURATION_TARGET,
    max: SEGMENT_DURATION_MAX,
  };
}

function phaseText(index: number, total: number): string {
  if (total <= 1) return "single beat";
  if (index === 1) return "action setup";
  if (index === total) return "action resolve";
  if (index <= Math.ceil(total / 2)) return "action continuation";
  return "action peak";
}

function segmentPrompt(basePrompt: string, index: number, total: number): string {
  const core = chooseCoreAction(basePrompt) || "Keep the current scene and character continuity.";
  return [
    `Segment ${index}/${total} (${phaseText(index, total)}).`,
        "Keep one clear visual action beat only, planned as a storyboard-sized beat rather than a micro-clip.",
    core,
  ].join(" ");
}

function segmentMotion(
  source: string,
  index: number,
  total: number
): string {
  const core = chooseCoreAction(source) || "Character performs one clear action.";
  const continuity =
    index > 1
      ? "Start exactly from the provided first frame state and continue naturally."
      : "Establish stable start pose and begin motion clearly.";
  return [
    `Segment ${index}/${total} (${phaseText(index, total)}).`,
    continuity,
    "Single major movement line only. Avoid combining multiple unrelated action objectives.",
    core,
  ].join(" ");
}

function buildBalancedDurations(total: number, segmentCount: number): number[] {
  const base = Math.floor(total / segmentCount);
  const remainder = total % segmentCount;
  return Array.from({ length: segmentCount }, (_, index) =>
    base + (index < remainder ? 1 : 0)
  );
}

export function computeSegmentDurations(
  totalDuration: number,
  shot?: SegmentableShot | null
): number[] {
  const total = Math.max(1, Math.round(totalDuration));
  const profile = chooseSegmentProfile(shot);
  // A storyboard shot that already fits the global 10-14s planning window
  // should remain a single shot. Provider-level 4-5s renders happen later
  // inside video generation and must not leak back into shot planning.
  if (total <= SEGMENT_DURATION_MAX) return [total];

  const minSegments = Math.ceil(total / profile.max);
  const maxSegments = Math.max(
    minSegments,
    Math.floor(total / SEGMENT_DURATION_MIN)
  );

  let bestSegments = minSegments;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let n = minSegments; n <= maxSegments; n++) {
    const avg = total / n;
    const distance = Math.abs(avg - profile.target);
    const shouldPreferMoreSegments =
      Math.abs(distance - bestDistance) < 0.001 && avg <= profile.target;
    if (distance < bestDistance || shouldPreferMoreSegments) {
      bestDistance = distance;
      bestSegments = n;
    }
  }

  return buildBalancedDurations(total, bestSegments);
}

export function expandShotsForVideoControl<
  T extends SegmentableShot
>(
  shots: T[],
  newGroupId: () => string
): Array<T & ChainFields> {
  const expanded: Array<T & ChainFields> = [];

  for (const shot of shots) {
    const originalDuration = Math.max(1, Math.round(shot.duration || 0));
    const durations = computeSegmentDurations(originalDuration, shot);
    if (durations.length <= 1) {
      expanded.push({
        ...shot,
        duration: originalDuration,
        chainGroupId: null,
        chainIndex: 1,
        chainTotal: 1,
        inheritPrevLastFrame: 0,
        originalDuration,
      });
      continue;
    }

    const groupId = newGroupId();
    const basePrompt = normalizeText(shot.prompt);
    const sourceMotion = normalizeText(
      shot.videoScript || shot.motionScript || shot.prompt
    );

    for (let i = 0; i < durations.length; i++) {
      const idx = i + 1;
      expanded.push({
        ...shot,
        duration: durations[i],
        prompt: segmentPrompt(basePrompt, idx, durations.length),
        motionScript: segmentMotion(sourceMotion, idx, durations.length),
        videoScript: segmentMotion(sourceMotion, idx, durations.length),
        chainGroupId: groupId,
        chainIndex: idx,
        chainTotal: durations.length,
        inheritPrevLastFrame: idx > 1 ? 1 : 0,
        originalDuration,
      });
    }
  }

  return expanded.map((shot, i) => ({
    ...shot,
    sequence: i + 1,
  }));
}
