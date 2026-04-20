import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import { hasTextModelConfig } from "@/lib/ai/config-presence";
import { db } from "@/lib/db";
import { episodes, projects, shots } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getActiveAsset,
  getActiveAssets,
  insertAssetVersion,
  loadShotLegacyView,
  patchAsset,
} from "@/lib/shot-asset-utils";
import { extractErrorMessage, getEpisodeCharacters } from "../helpers";
import type { ModelConfig } from "../types";
import { normalizeRuntimeGenerationMode } from "@/lib/generation-mode";

function normalizeText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildAuditRewriteHints(payload?: Record<string, unknown>): string {
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
  if (summary) lines.push(`- AI审查摘要：${summary}`);
  if (fixTarget) lines.push(`- 优先修复字段：${fixTarget}`);
  if (issues.length > 0) lines.push(`- 关键问题：${issues.join("；")}`);
  if (suggestions.length > 0) lines.push(`- 修复建议：${suggestions.join("；")}`);
  return lines.join("\n");
}

function normalizePanelPrompts(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const prompt = (item as Record<string, unknown>).prompt;
      return normalizeText(prompt);
    })
    .filter(Boolean)
    .slice(0, 4);
}

export async function handleSingleShotRewrite(
  projectId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  const shotId = payload?.shotId as string;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!hasTextModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No text model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }
  const shotView = await loadShotLegacyView(shot.id);
  const storyboardPanels = [...shotView.storyboardPanels].sort(
    (a, b) => a.sequenceInType - b.sequenceInType
  );

  const shotEpisodeId = episodeId || shot.episodeId;
  const auditHints = buildAuditRewriteHints(payload);
  const projectCharacters = await getEpisodeCharacters(projectId, shotEpisodeId);
  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");
  const characterVisualHints = projectCharacters
    .filter((c) => c.visualHint)
    .map((c) => `${c.name}：${c.visualHint}`)
    .join("\n");

  const model = createLanguageModel(modelConfig?.text);
  let generationMode: "storyboard_grid" | "keyframe" | "reference" = "storyboard_grid";
  if (shotEpisodeId) {
    const [episode] = await db
      .select({ generationMode: episodes.generationMode })
      .from(episodes)
      .where(eq(episodes.id, shotEpisodeId));
    generationMode =
      normalizeRuntimeGenerationMode(episode?.generationMode);
  } else {
    const [project] = await db
      .select({ generationMode: projects.generationMode })
      .from(projects)
      .where(eq(projects.id, projectId));
    generationMode =
      normalizeRuntimeGenerationMode(project?.generationMode);
  }

  const prompt =
    generationMode === "storyboard_grid"
      ? `You are a storyboard director. Rewrite the text fields for a single shot in a four-panel storyboard workflow so the descriptions are vivid, safe for AI image generation, and better aligned with the story beat and directing intent.

Current shot (sequence ${shot.sequence}):
- Scene description: ${shot.prompt || ""}
- Panel 1: ${storyboardPanels[0]?.prompt || ""}
- Panel 2: ${storyboardPanels[1]?.prompt || ""}
- Panel 3: ${storyboardPanels[2]?.prompt || ""}
- Panel 4: ${storyboardPanels[3]?.prompt || ""}
- Motion script: ${shot.motionScript || ""}
- Video script: ${shot.videoScript || ""}
- Camera direction: ${shot.cameraDirection || "static"}
- Duration: ${shot.duration}s

Character references:
${characterDescriptions || "none"}
${characterVisualHints ? `\nCHARACTER VISUAL IDs (MANDATORY — whenever a character appears in any field, write their name followed by exactly this identifier in parentheses, e.g. 天枢真君（银发金瞳）. Never invent alternatives):\n${characterVisualHints}` : ""}

Return ONLY a JSON object (no markdown fences) with these fields:
{
  "prompt": "rewritten scene description",
  "storyboardPanels": [
    { "index": 1, "prompt": "rewritten panel 1 prompt" },
    { "index": 2, "prompt": "rewritten panel 2 prompt" },
    { "index": 3, "prompt": "rewritten panel 3 prompt" },
    { "index": 4, "prompt": "rewritten panel 4 prompt" }
  ],
  "motionScript": "rewritten motion script in time-segmented format (0-Xs: ... Xs-Ys: ...)",
  "videoScript": "rewritten concise video model prompt: 1-2 sentences, no timestamps, just core motion and camera arc",
  "cameraDirection": "camera direction (keep original or adjust)"
}

IMPORTANT:
- Keep the same scene, characters, props, and narrative intent.
- The four panels must remain one continuous shot, with panel 1 as setup and panel 4 as phase result.
- When the audit points to continuity, panel flow, camera, motion, or directing issues, you must perform a real structural rewrite of the affected text fields instead of a light paraphrase.
- If panel flow is weak, rewrite all 4 panels as one continuous mini-scene with a clear setup -> development -> escalation -> outcome rhythm.
- If motion/camera is weak, simplify to one main action line and one clear camera path that weak models can execute.
- Only keep the old wording when it is already strong; otherwise prefer a stronger rewrite over cosmetic wording changes.
- Match the language of the original text.
${auditHints ? `\n\nAI preflight fix instructions:\n${auditHints}\n- Rewrite must prioritize fixing these continuity/directing issues while preserving the same story beat.` : ""}`
      : `You are a storyboard director. Rewrite the text fields for a single shot so the descriptions are vivid, safe for AI image generation, and free of any potentially sensitive content.

Current shot (sequence ${shot.sequence}):
- Scene description: ${shot.prompt || ""}
- Start frame: ${shotView.startFrameDesc || ""}
- End frame: ${shotView.endFrameDesc || ""}
- Motion script: ${shot.motionScript || ""}
- Video script: ${shot.videoScript || ""}
- Camera direction: ${shot.cameraDirection || "static"}
- Duration: ${shot.duration}s

Character references:
${characterDescriptions || "none"}
${characterVisualHints ? `\nCHARACTER VISUAL IDs (MANDATORY — whenever a character appears in any field, write their name followed by exactly this identifier in parentheses, e.g. 天枢真君（银发金瞳）. Never invent alternatives):\n${characterVisualHints}` : ""}

Return ONLY a JSON object (no markdown fences) with these fields:
{
  "prompt": "rewritten scene description",
  "startFrameDesc": "rewritten start frame description",
  "endFrameDesc": "rewritten end frame description",
  "motionScript": "rewritten motion script in time-segmented format (0-Xs: ... Xs-Ys: ...)",
  "videoScript": "rewritten concise video model prompt: 1-2 sentences, no timestamps, just core motion and camera arc",
  "cameraDirection": "camera direction (keep original or adjust)"
}

IMPORTANT: Keep the same scene, characters, and narrative intent. Only rephrase to avoid safety filter triggers. Match the language of the original text.
${auditHints ? `\n\nAI preflight fix instructions:\n${auditHints}\n- Rewrite must prioritize fixing these continuity/directing issues while preserving the same story beat.` : ""}`;

  console.log(`[SingleShotRewrite] Shot ${shot.sequence} prompt:\n${prompt}`);

  try {
    const { text } = await generateText({ model, prompt, temperature: 0.7 });
    const rawParsed = JSON.parse(extractJSON(text)) as Record<string, unknown>;
    if (generationMode === "storyboard_grid") {
      const parsed = {
        prompt: normalizeText(rawParsed.prompt),
        storyboardPanels: normalizePanelPrompts(rawParsed.storyboardPanels),
        motionScript: normalizeText(rawParsed.motionScript),
        videoScript: normalizeText(rawParsed.videoScript),
        cameraDirection: normalizeText(rawParsed.cameraDirection || shot.cameraDirection || "static"),
      };
      if (parsed.storyboardPanels.length !== 4) {
        throw new Error("rewrite did not return 4 storyboard panels");
      }

      await db
        .update(shots)
        .set({
          prompt: parsed.prompt,
          motionScript: parsed.motionScript,
          videoScript: parsed.videoScript ?? null,
          cameraDirection: parsed.cameraDirection,
        })
        .where(eq(shots.id, shotId));

      const currentPanels = await getActiveAssets(shotId, "storyboard_panel");
      for (let index = 0; index < 4; index += 1) {
        const existing = currentPanels.find((panel) => panel.sequenceInType === index);
        const nextPrompt = parsed.storyboardPanels[index];
        if (existing) {
          await patchAsset(existing.id, { prompt: nextPrompt });
        } else {
          await insertAssetVersion({
            shotId,
            type: "storyboard_panel",
            sequenceInType: index,
            prompt: nextPrompt,
            status: "pending",
            meta: {
              panelIndex: index + 1,
              workflow: "storyboard_grid",
            },
          });
        }
      }
      return NextResponse.json({
        shotId,
        status: "ok",
        prompt: parsed.prompt,
        storyboardPanels: parsed.storyboardPanels,
        motionScript: parsed.motionScript,
        videoScript: parsed.videoScript ?? null,
        cameraDirection: parsed.cameraDirection,
      });
    }

    const parsed = {
      prompt: normalizeText(rawParsed.prompt),
      startFrameDesc: normalizeText(rawParsed.startFrameDesc),
      endFrameDesc: normalizeText(rawParsed.endFrameDesc),
      motionScript: normalizeText(rawParsed.motionScript),
      videoScript: normalizeText(rawParsed.videoScript),
      cameraDirection: normalizeText(rawParsed.cameraDirection || shot.cameraDirection || "static"),
    };

    await db
      .update(shots)
      .set({
        prompt: parsed.prompt,
        motionScript: parsed.motionScript,
        videoScript: parsed.videoScript ?? null,
        cameraDirection: parsed.cameraDirection,
      })
      .where(eq(shots.id, shotId));

    const ff = await getActiveAsset(shotId, "first_frame", 0);
    if (ff) {
      await patchAsset(ff.id, { prompt: parsed.startFrameDesc });
    } else {
      await insertAssetVersion({
        shotId,
        type: "first_frame",
        sequenceInType: 0,
        prompt: parsed.startFrameDesc,
        status: "pending",
      });
    }
    const lf = await getActiveAsset(shotId, "last_frame", 0);
    if (lf) {
      await patchAsset(lf.id, { prompt: parsed.endFrameDesc });
    } else {
      await insertAssetVersion({
        shotId,
        type: "last_frame",
        sequenceInType: 0,
        prompt: parsed.endFrameDesc,
        status: "pending",
      });
    }

    return NextResponse.json({ shotId, status: "ok", ...parsed });
  } catch (err) {
    console.error(`[SingleShotRewrite] Error for shot ${shotId}:`, err);
    return NextResponse.json(
      { shotId, status: "error", error: extractErrorMessage(err) },
      { status: 500 }
    );
  }
}
