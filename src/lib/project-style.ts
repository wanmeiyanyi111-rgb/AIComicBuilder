export type ProjectStyleId =
  | "cinematic_realism"
  | "anime_dynamic"
  | "ink_wash"
  | "film_noir"
  | "cyberpunk_neon";

export const DEFAULT_PROJECT_STYLE: ProjectStyleId = "cinematic_realism";

export const PROJECT_STYLE_IDS: ProjectStyleId[] = [
  "cinematic_realism",
  "anime_dynamic",
  "ink_wash",
  "film_noir",
  "cyberpunk_neon",
];

export interface ProjectStylePreset {
  worldSetting: string;
  colorPalette: string;
}

const STYLE_PRESETS: Record<ProjectStyleId, ProjectStylePreset> = {
  cinematic_realism: {
    worldSetting:
      "整体采用电影级写实叙事风格：镜头语言克制、光影层次真实、材质与环境细节可信。人物表演自然，不夸张变形；画面强调叙事清晰、空间关系明确、情绪递进稳定。",
    colorPalette: "amber highlights, neutral midtones, soft teal shadows",
  },
  anime_dynamic: {
    worldSetting:
      "整体采用高动势动画风格：轮廓干净、节奏明快、动作设计强调速度线与姿态张力。允许适度夸张的表情与运动，但角色辨识度必须稳定一致。",
    colorPalette: "high saturation primaries, clean contrast, vivid accents",
  },
  ink_wash: {
    worldSetting:
      "整体采用东方水墨美术风格：留白、层次晕染与笔触肌理并重。镜头氛围偏诗性与意境表达，动作节奏柔中有力，强调远近虚实与气韵连贯。",
    colorPalette: "ink black, rice paper white, muted cyan, warm gray",
  },
  film_noir: {
    worldSetting:
      "整体采用黑色电影（Noir）风格：高反差明暗、强烈侧逆光、阴影切割构图。情绪偏悬疑与压迫，镜头语言偏静稳推进，突出人物心理冲突。",
    colorPalette: "deep black, silver gray, low-key contrast, sparse warm highlights",
  },
  cyberpunk_neon: {
    worldSetting:
      "整体采用赛博朋克霓虹风格：未来都市、潮湿街景、屏幕与霓虹反射密集。镜头强调纵深与空间信息密度，角色造型与科技元素需保持统一世界观。",
    colorPalette: "neon cyan, magenta, electric purple, deep blue shadows",
  },
};

export function isProjectStyleId(value: string): value is ProjectStyleId {
  return PROJECT_STYLE_IDS.includes(value as ProjectStyleId);
}

export function resolveProjectStyle(styleId?: string | null): {
  styleId: ProjectStyleId;
  preset: ProjectStylePreset;
} {
  const normalized = (styleId || "").trim();
  const finalId = isProjectStyleId(normalized)
    ? normalized
    : DEFAULT_PROJECT_STYLE;
  return {
    styleId: finalId,
    preset: STYLE_PRESETS[finalId],
  };
}

interface ProjectStyleSource {
  styleId?: string | null;
  worldSetting?: string | null;
  colorPalette?: string | null;
}

function normalize(value?: string | null): string {
  return (value || "").trim();
}

function inferProjectStyleIdFromContent(
  worldSetting?: string | null,
  colorPalette?: string | null
): ProjectStyleId | null {
  const world = normalize(worldSetting);
  const palette = normalize(colorPalette);
  const entries = Object.entries(STYLE_PRESETS) as [ProjectStyleId, ProjectStylePreset][];

  // Best signal: both fields match one preset exactly.
  if (world && palette) {
    const hit = entries.find(
      ([, preset]) =>
        normalize(preset.worldSetting) === world &&
        normalize(preset.colorPalette) === palette
    );
    if (hit) return hit[0];
  }

  // Fallback for legacy records where only one field was kept.
  if (world) {
    const hit = entries.find(([, preset]) => normalize(preset.worldSetting) === world);
    if (hit) return hit[0];
  }
  if (palette) {
    const hit = entries.find(([, preset]) => normalize(preset.colorPalette) === palette);
    if (hit) return hit[0];
  }

  return null;
}

export function resolveProjectStyleFromSource(source: ProjectStyleSource): {
  styleId: ProjectStyleId;
  preset: ProjectStylePreset;
} {
  const explicit = normalize(source.styleId);
  if (isProjectStyleId(explicit)) {
    return {
      styleId: explicit,
      preset: STYLE_PRESETS[explicit],
    };
  }

  const inferred = inferProjectStyleIdFromContent(
    source.worldSetting,
    source.colorPalette
  );
  if (inferred) {
    return {
      styleId: inferred,
      preset: STYLE_PRESETS[inferred],
    };
  }

  return {
    styleId: DEFAULT_PROJECT_STYLE,
    preset: STYLE_PRESETS[DEFAULT_PROJECT_STYLE],
  };
}
