import { NextResponse } from "next/server";
import { generateText, streamText } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import { hasTextModelConfig } from "@/lib/ai/config-presence";
import { db } from "@/lib/db";
import { episodes, projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { buildScriptParsePrompt } from "@/lib/ai/prompts/script-parse";
import { buildScriptGeneratePrompt } from "@/lib/ai/prompts/script-generate";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import type { ModelConfig } from "../types";
import {
  SHORT_DRAMA_MAX_DURATION_SEC,
  SHORT_DRAMA_MIN_DURATION_SEC,
  SHORT_DRAMA_TARGET_DURATION_SEC,
  buildShortDramaPlanContext,
  type ShortDramaSplitMeta,
} from "@/lib/story/short-drama";
import {
  estimateScreenplayDuration,
  type ScreenplayDurationReview,
} from "@/lib/story/screenplay-duration";

type ScriptContext = {
  outlineContext: string;
  durationContext: string;
  shortDramaContext: string;
  worldSettingContext: string;
};

type EpisodeScriptReviewPatch = {
  patch: {
    script: string;
    updatedAt: Date;
    splitMeta?: string;
  };
  durationReview: ScreenplayDurationReview | null;
};

function parseShortDramaSplitMeta(value: string | null): ShortDramaSplitMeta | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as ShortDramaSplitMeta;
  } catch {
    return null;
  }
}

export async function buildEpisodeScriptReviewPatch(
  episodeId: string,
  script: string
): Promise<EpisodeScriptReviewPatch> {
  const [episode] = await db
    .select({
      targetDuration: episodes.targetDuration,
      splitMeta: episodes.splitMeta,
    })
    .from(episodes)
    .where(eq(episodes.id, episodeId));

  const basePatch: EpisodeScriptReviewPatch["patch"] = {
    script,
    updatedAt: new Date(),
  };

  if (!episode) {
    return { patch: basePatch, durationReview: null };
  }

  const splitMeta = parseShortDramaSplitMeta(episode.splitMeta);
  if (!splitMeta || splitMeta.storyMode !== "short_drama") {
    return { patch: basePatch, durationReview: null };
  }

  const durationReview = estimateScreenplayDuration(script, {
    targetDurationSec:
      splitMeta.targetDurationSec ||
      episode.targetDuration ||
      SHORT_DRAMA_TARGET_DURATION_SEC,
    durationMinSec: splitMeta.durationMinSec || SHORT_DRAMA_MIN_DURATION_SEC,
    durationMaxSec: splitMeta.durationMaxSec || SHORT_DRAMA_MAX_DURATION_SEC,
  });

  return {
    patch: {
      ...basePatch,
      splitMeta: JSON.stringify({
        ...splitMeta,
        scriptEstimatedDurationSec: durationReview.estimatedDurationSec,
        scriptDurationStatus: durationReview.status,
        scriptDurationNotes: durationReview.notes,
      } satisfies ShortDramaSplitMeta),
    },
    durationReview,
  };
}

async function loadScriptGenerationContext(
  projectId: string,
  episodeId?: string,
  outlineOverride?: string
): Promise<ScriptContext> {
  let episodeMeta:
    | { outline: string | null; targetDuration: number | null; splitMeta: string | null }
    | null
    | undefined;
  if (episodeId) {
    [episodeMeta] = await db
      .select({
        outline: episodes.outline,
        targetDuration: episodes.targetDuration,
        splitMeta: episodes.splitMeta,
      })
      .from(episodes)
      .where(eq(episodes.id, episodeId));
  }

  let outline = outlineOverride || "";
  if (!outline) {
    if (episodeId) {
      outline = episodeMeta?.outline || "";
    } else {
      const [proj] = await db
        .select({ outline: projects.outline })
        .from(projects)
        .where(eq(projects.id, projectId));
      outline = proj?.outline || "";
    }
  }

  const episodeTargetDuration = episodeMeta?.targetDuration || 0;
  let splitMetaContext = "";
  if (episodeMeta?.splitMeta) {
    try {
      splitMetaContext = buildShortDramaPlanContext(
        JSON.parse(episodeMeta.splitMeta) as Record<string, unknown>
      );
    } catch {
      splitMetaContext = "";
    }
  }

  const outlineContext = outline
    ? `\n\n【故事大纲 - 请严格按照以下大纲结构展开剧本】\n${outline}\n\n`
    : "";
  const durationContext = episodeTargetDuration
    ? `\n\n【单集时长要求】\n本集目标时长 ${episodeTargetDuration} 秒，必须写成短剧节奏，整体控制在 120-180 秒内，避免冗长铺垫。\n\n`
    : "";
  const shortDramaContext = splitMetaContext
    ? `\n\n${splitMetaContext}\n\n请严格按照以上短剧分集规划生成本集剧本，不要偏离主冲突，不要削弱结尾悬念。\n\n`
    : "";

  let worldSettingContext = "";
  const [projForWorld] = await db
    .select({ worldSetting: projects.worldSetting })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (projForWorld?.worldSetting) {
    worldSettingContext = `\n\n【世界观设定】\n${projForWorld.worldSetting}\n\n剧本必须与此世界观设定保持一致。\n\n`;
  }

  return {
    outlineContext,
    durationContext,
    shortDramaContext,
    worldSettingContext,
  };
}

export async function generateScriptText(
  projectId: string,
  userId: string,
  idea: string,
  modelConfig?: ModelConfig,
  episodeId?: string,
  outlineOverride?: string
): Promise<string> {
  if (!idea.trim()) {
    throw new Error("No idea provided");
  }
  if (!hasTextModelConfig(modelConfig)) {
    throw new Error("No text model configured");
  }

  const context = await loadScriptGenerationContext(
    projectId,
    episodeId,
    outlineOverride
  );
  const model = createLanguageModel(modelConfig?.text);
  const scriptGenerateSystem = await resolvePrompt("script_generate", {
    userId,
    projectId,
  });

  const result = await generateText({
    model,
    system: scriptGenerateSystem,
    prompt:
      context.worldSettingContext +
      context.outlineContext +
      context.durationContext +
      context.shortDramaContext +
      buildScriptGeneratePrompt(idea),
    temperature: 0.8,
    maxOutputTokens: 12000,
  });

  return result.text;
}

export async function handleScriptOutlineAction(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  const idea = (payload?.idea as string) || "";
  if (!idea.trim()) {
    return NextResponse.json({ error: "No idea provided" }, { status: 400 });
  }

  if (!hasTextModelConfig(modelConfig)) {
    return NextResponse.json(
      { error: "No text model configured" },
      { status: 400 }
    );
  }

  const model = createLanguageModel(modelConfig?.text);
  const outlineSystem = await resolvePrompt("script_outline", { userId, projectId });

  const result = streamText({
    model,
    system: outlineSystem,
    prompt: `创意构想：${idea}`,
    temperature: 0.7,
    onFinish: async ({ text }) => {
      try {
        const outline = text.trim();
        if (episodeId) {
          await db
            .update(episodes)
            .set({ outline, updatedAt: new Date() })
            .where(eq(episodes.id, episodeId));
        } else {
          await db
            .update(projects)
            .set({ outline, updatedAt: new Date() })
            .where(eq(projects.id, projectId));
        }
        console.log(`[ScriptOutline] Saved outline for ${episodeId || projectId}`);
      } catch (err) {
        console.error("[ScriptOutline] onFinish error:", err);
      }
    },
  });

  return result.toTextStreamResponse();
}

export async function handleScriptGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  const idea = (payload?.idea as string) || "";
  if (!idea.trim()) {
    return NextResponse.json({ error: "No idea provided" }, { status: 400 });
  }

  if (!hasTextModelConfig(modelConfig)) {
    return NextResponse.json(
      { error: "No text model configured" },
      { status: 400 }
    );
  }

  if (episodeId) {
    await db
      .update(episodes)
      .set({ idea, updatedAt: new Date() })
      .where(eq(episodes.id, episodeId));
  } else {
    await db
      .update(projects)
      .set({ idea, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  }

  const context = await loadScriptGenerationContext(
    projectId,
    episodeId,
    (payload?.outline as string) || ""
  );

  const model = createLanguageModel(modelConfig?.text);
  const scriptGenerateSystem = await resolvePrompt("script_generate", {
    userId,
    projectId,
  });

  const result = streamText({
    model,
    system: scriptGenerateSystem,
    prompt:
      context.worldSettingContext +
      context.outlineContext +
      context.durationContext +
      context.shortDramaContext +
      buildScriptGeneratePrompt(idea),
    temperature: 0.8,
    onFinish: async ({ text }) => {
      try {
        if (episodeId) {
          const { patch, durationReview } = await buildEpisodeScriptReviewPatch(
            episodeId,
            text
          );
          await db
            .update(episodes)
            .set(patch)
            .where(eq(episodes.id, episodeId));
          if (durationReview) {
            console.log(
              `[ScriptGenerate] Saved generated script for ${episodeId} with duration review ${durationReview.estimatedDurationSec}s (${durationReview.status})`
            );
          } else {
            console.log(`[ScriptGenerate] Saved generated script for ${episodeId}`);
          }
        } else {
          await db
            .update(projects)
            .set({ script: text, updatedAt: new Date() })
            .where(eq(projects.id, projectId));
          console.log(`[ScriptGenerate] Saved generated script for ${projectId}`);
        }
      } catch (err) {
        console.error("[ScriptGenerate] onFinish error:", err);
      }
    },
  });

  return result.toTextStreamResponse();
}

export async function handleScriptParseStream(
  projectId: string,
  userId: string,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  let script: string | null = null;

  if (episodeId) {
    const [episode] = await db
      .select()
      .from(episodes)
      .where(eq(episodes.id, episodeId));
    script = episode?.script ?? null;
  } else {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    script = project?.script ?? null;
  }

  if (!script) {
    return NextResponse.json(
      { error: "Project or script not found" },
      { status: 404 }
    );
  }

  if (!hasTextModelConfig(modelConfig)) {
    return NextResponse.json(
      { error: "No text model configured" },
      { status: 400 }
    );
  }

  const model = createLanguageModel(modelConfig?.text);
  const scriptParseSystem = await resolvePrompt("script_parse", { userId, projectId });

  const result = streamText({
    model,
    system: scriptParseSystem,
    prompt: buildScriptParsePrompt(script),
    temperature: 0.7,
    onFinish: async ({ text }) => {
      try {
        const screenplay = extractJSON(text);
        JSON.parse(screenplay);
        if (episodeId) {
          await db
            .update(episodes)
            .set({ updatedAt: new Date() })
            .where(eq(episodes.id, episodeId));
        } else {
          await db
            .update(projects)
            .set({ updatedAt: new Date() })
            .where(eq(projects.id, projectId));
        }
        console.log(`[ScriptParse] Parsed screenplay for ${episodeId || projectId}`);
      } catch (err) {
        console.error("[ScriptParse] onFinish error:", err);
      }
    },
  });

  return result.toTextStreamResponse();
}
