import { NextResponse } from "next/server";
import { createLanguageModel } from "@/lib/ai/ai-sdk";
import { hasTextModelConfig } from "@/lib/ai/config-presence";
import { db } from "@/lib/db";
import {
  characterRelations,
  dialogues,
  episodes,
  projects,
  shots,
  storyboardVersions,
} from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { id as genId } from "@/lib/id";
import { buildShotSplitPrompt } from "@/lib/ai/prompts/shot-split";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { getPromptDefinition } from "@/lib/ai/prompts/registry";
import { getEpisodeCharacters } from "../helpers";
import type { ModelConfig } from "../types";
import { expandShotsForVideoControl } from "@/lib/shot-segmentation";
import { planShotTransitions, summarizeTransitionUsage } from "@/lib/shot-transition-planner";
import { normalizeShotTransitionProfileId } from "@/lib/shot-transition-profile";
import {
  buildShortDramaPlanContext,
  buildShortDramaShotBudget,
} from "@/lib/story/short-drama";
import {
  type ParsedShot,
  countScriptSceneMarkers,
  countScriptShotCues,
  estimateMinimumDurationForChunk,
  estimateMinimumShotsForChunk,
  parseShotSplitPayload,
  splitScriptByScenes,
  validateShotCoverage,
} from "./shot-split-utils";
import { processShotSplitChunk } from "./shot-split-execution";

export async function handleShotSplitStream(
  projectId: string,
  userId: string,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  let script: string | null = null;
  let splitMetaContext = "";
  let shortDramaShotBudgetContext = "";
  let scriptDurationContext = "";
  let targetShotBudget:
    | { targetShotCount: number; minShotCount: number; maxShotCount: number }
    | null = null;
  let reviewedScriptDurationSec = 0;
  if (episodeId) {
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    if (!episode) {
      return NextResponse.json({ error: "Episode not found" }, { status: 404 });
    }
    script = episode.script ?? null;
    if (episode.splitMeta) {
      try {
        const splitMeta = JSON.parse(episode.splitMeta) as Record<string, unknown>;
        splitMetaContext = buildShortDramaPlanContext(splitMeta);
        const scriptEstimatedDurationSec =
          typeof splitMeta.scriptEstimatedDurationSec === "number" &&
          Number.isFinite(splitMeta.scriptEstimatedDurationSec) &&
          splitMeta.scriptEstimatedDurationSec > 0
            ? Math.round(splitMeta.scriptEstimatedDurationSec)
            : 0;
        const scriptDurationStatus =
          splitMeta.scriptDurationStatus === "short" ||
          splitMeta.scriptDurationStatus === "ok" ||
          splitMeta.scriptDurationStatus === "long"
            ? splitMeta.scriptDurationStatus
            : null;
        const scriptDurationNotes = Array.isArray(splitMeta.scriptDurationNotes)
          ? splitMeta.scriptDurationNotes
              .filter((item): item is string => typeof item === "string" && !!item.trim())
              .slice(0, 3)
          : [];
        if (scriptEstimatedDurationSec > 0) {
          reviewedScriptDurationSec = scriptEstimatedDurationSec;
          scriptDurationContext = [
            "【剧本时长复核】",
            `本集真实剧本文本复核约 ${scriptEstimatedDurationSec}s，状态：${scriptDurationStatus === "long" ? "偏长" : scriptDurationStatus === "short" ? "偏短" : "达标"}。`,
            "请优先依据这份剧本文本复核结果来拆镜头，而不是只依赖分集规划稿。",
            scriptDurationStatus === "long"
              ? "当前剧本偏长：请把信息密度高的动作链或情绪推进拆成更多连续小镜头，避免把多个主动作硬塞进单镜头。"
              : scriptDurationStatus === "short"
                ? "当前剧本偏短：请减少空转镜头，优先保留推进剧情和爆点的镜头。"
                : "当前剧本时长基本合适：请让镜头数量与 beat 节奏稳定对应。",
            ...scriptDurationNotes.map((note) => `- ${note}`),
          ].join("\n");
        }
        const shotBudget = buildShortDramaShotBudget(splitMeta);
        if (shotBudget) {
          targetShotBudget = {
            targetShotCount: shotBudget.targetShotCount,
            minShotCount: shotBudget.minShotCount,
            maxShotCount: shotBudget.maxShotCount,
          };
          shortDramaShotBudgetContext = [
            "【短剧分镜镜头预算】",
            `本集目标约 ${shotBudget.targetShotCount} 个镜头，允许范围 ${shotBudget.minShotCount}-${shotBudget.maxShotCount} 个镜头，平均约 ${shotBudget.averageShotDurationSec}s/镜头。`,
            "请尽量让每个 beat 的镜头数量接近以下预算：",
            ...shotBudget.beatBudgets.map(
              (item) =>
                `- ${item.beatName}：约 ${item.targetShots} 镜头，覆盖 ${item.durationSec}s，建议单镜头 ${item.suggestedShotDurationSec}s，内容：${item.summary || "按节奏完成"}`
            ),
            "开场 hook 必须尽快入镜，结尾 cliffhanger 必须保留独立镜头完成情绪扣子。",
          ].join("\n");
        }
      } catch {
        splitMetaContext = "";
        shortDramaShotBudgetContext = "";
        scriptDurationContext = "";
        targetShotBudget = null;
        reviewedScriptDurationSec = 0;
      }
    }
  } else {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    script = project.script ?? null;
  }

  if (!script?.trim()) {
    return NextResponse.json(
      { error: "No script found. Please generate or import script first." },
      { status: 400 }
    );
  }

  if (!hasTextModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No text model configured" }, { status: 400 });
  }

  const shotCharacters = await getEpisodeCharacters(projectId, episodeId);

  const characterDescriptions = shotCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const characterVisualHints = shotCharacters
    .filter((c) => c.visualHint)
    .map((c) => ({ name: c.name, visualHint: c.visualHint! }));

  const characterPerformanceStyles = shotCharacters
    .filter((c) => c.performanceStyle)
    .map((c) => ({ name: c.name, performanceStyle: c.performanceStyle! }));

  // Load character relationships — CRITICAL for shot planning. Without
  // this block the LLM treats enemies as bystanders (e.g. "如来佛祖" gets
  // rendered as a Buddha statue in the background instead of an active
  // combatant against 孙悟空).
  const shotRelations = await db
    .select()
    .from(characterRelations)
    .where(eq(characterRelations.projectId, projectId));
  let relationsText = "";
  if (shotRelations.length > 0) {
    relationsText = "\n\n## 角色关系（必须用于决定站位、眼神、肢体对抗、画面张力）\n";
    for (const rel of shotRelations) {
      const charA = shotCharacters.find((c) => c.id === rel.characterAId);
      const charB = shotCharacters.find((c) => c.id === rel.characterBId);
      if (charA && charB) {
        relationsText += `- ${charA.name} ↔ ${charB.name}：${rel.relationType}${rel.description ? `（${rel.description}）` : ""}\n`;
      }
    }
    relationsText += `
**关系驱动构图规则（最高优先级）**：
- **敌对 / 对立 / 仇人**：两人必须都是**活人角色同屏对峙**——直接对视、肢体对抗、武器对准彼此。禁止把任一方画成背景的雕像/神像/虚影/浮雕。
- **友好 / 盟友**：并肩、相互掩护、眼神交流。
- **爱慕 / 亲密**：靠近、牵手、拥抱、温柔对视。
- **父女 / 师徒**：长辈在前/侧，晚辈在后/侧随从。
- 任何被标记为角色关系的双方，在包含他们的镜头中都必须作为**真实的活人**出现，而不是背景装饰。
`;
  }

  // Fetch world setting and target duration from project
  const [projData] = await db
    .select({ worldSetting: projects.worldSetting, targetDuration: projects.targetDuration })
    .from(projects)
    .where(eq(projects.id, projectId));
  let targetDuration = projData?.targetDuration || 0;
  if (episodeId) {
    const [epDur] = await db
      .select({ targetDuration: episodes.targetDuration })
      .from(episodes)
      .where(eq(episodes.id, episodeId));
    if (epDur?.targetDuration && epDur.targetDuration > 0) targetDuration = epDur.targetDuration;
  }
  if (reviewedScriptDurationSec > 0) {
    targetDuration = reviewedScriptDurationSec;
  }

  const model = createLanguageModel(modelConfig?.text);
  const shotSplitSlots = await resolveSlotContents("shot_split", { userId, projectId });
  const shotSplitDef = getPromptDefinition("shot_split")!;
  const transitionProfileId = normalizeShotTransitionProfileId(
    shotSplitSlots.transition_profile_id
  );
  const systemPrompt = shotSplitDef.buildFullPrompt(shotSplitSlots, {
    storyboardMaxDuration: 14,
  });
  const jsonMode = { openai: { response_format: { type: "json_object" } } };

  // Split screenplay into smaller chunks to reduce truncated JSON risk.
  const scenesPerChunk = 4;
  const fullScript = script || "";
  const sceneChunks = splitScriptByScenes(fullScript, scenesPerChunk);
  const totalSceneCount = Math.max(1, countScriptSceneMarkers(fullScript));
  // Log scene detection details
  const sceneRe = /^[\s*#]*(?:SCENE|场景)\s*\d+/i;
  const sceneMatches = fullScript.split("\n").filter((l) => sceneRe.test(l.trim()));
  console.log(
    `[ShotSplit] Detected ${sceneMatches.length} scenes, split into ${sceneChunks.length} chunk(s) of ~${scenesPerChunk} scenes each`
  );
  sceneChunks.forEach((c, i) => {
    const sceneCount = c.split("\n").filter((l) => sceneRe.test(l.trim())).length;
    console.log(`[ShotSplit] Chunk ${i + 1}: ${sceneCount} scenes, ${c.length} chars`);
  });

  // Process chunks concurrently
  const chunkResults = await Promise.all(
    sceneChunks.map(async (chunk, idx) => {
      let prompt = buildShotSplitPrompt(
        chunk,
        characterDescriptions,
        characterVisualHints,
        undefined,
        characterPerformanceStyles.length > 0 ? characterPerformanceStyles : undefined
      );

      // Inject character relations (drives on-screen interaction framing)
      if (relationsText) prompt += relationsText;

      // Inject world setting
      if (projData?.worldSetting) {
        prompt =
          `【世界观设定】\n${projData.worldSetting}\n\n所有镜头必须与此世界观设定保持一致。\n\n` +
          prompt;
      }

      if (splitMetaContext) {
        prompt =
          `${splitMetaContext}\n\n请据此控制本集镜头节奏：开场钩子镜头要快，中段冲突逐步升级，结尾必须为悬念或爆点留出镜头。\n\n` +
          prompt;
      }

      if (scriptDurationContext) {
        prompt = `${scriptDurationContext}\n\n${prompt}`;
      }

      if (shortDramaShotBudgetContext) {
        prompt = `${shortDramaShotBudgetContext}\n\n${prompt}`;
      }

      const sceneCount = countScriptSceneMarkers(chunk);
      const shotCueCount = countScriptShotCues(chunk);
      const minimumShotsForChunk = estimateMinimumShotsForChunk(
        chunk,
        targetShotBudget,
        totalSceneCount
      );
      const minimumDurationForChunk = estimateMinimumDurationForChunk(chunk);
      if (sceneCount > 0 || shotCueCount > 0) {
        prompt += [
          "",
          "【强制覆盖约束】",
          sceneCount > 0
            ? `当前剧本块包含 ${sceneCount} 个场景标记，每个场景都必须至少产出 1 个镜头，绝不能只拆第一场。`
            : "",
          shotCueCount > 0
            ? `当前剧本块包含 ${shotCueCount} 个显式镜头提示（如“（特写，4s）”），你可以合并极少数相邻提示，但绝不能压缩成少量镜头草草交差。`
            : "",
          minimumShotsForChunk > 0
            ? `当前剧本块最少应产出 ${minimumShotsForChunk} 个镜头，少于这个数量将视为无效输出。`
            : "",
          minimumDurationForChunk > 0
            ? `当前剧本块镜头总时长至少应接近 ${minimumDurationForChunk}s，明显低于此时长将视为覆盖不足。`
            : "",
          "如果镜头数量明显偏少，将视为无效输出。",
        ]
          .filter(Boolean)
          .join("\n");
      }

      // Inject target duration
      if (targetDuration && targetDuration > 0) {
        prompt += `\n\n目标总时长：${targetDuration}秒（${Math.floor(targetDuration / 60)}分${targetDuration % 60}秒）。请确保所有镜头的时长之和接近此目标。\n`;
      }
      return processShotSplitChunk({
        chunk,
        chunkIndex: idx,
        sceneChunksLength: sceneChunks.length,
        model,
        prompt,
        providerOptions: jsonMode,
        systemPrompt,
        targetShotBudget,
        totalSceneCount,
      });
    })
  );

  const failedChunks = chunkResults.filter(
    (r): r is { ok: false; chunkIndex: number; error: string } => !r.ok
  );
  if (failedChunks.length > 0) {
    const summary = failedChunks
      .map((f) => `chunk ${f.chunkIndex}: ${f.error}`)
      .join("; ");
    return NextResponse.json(
      {
        error: `Shot split failed due to invalid model JSON output (${summary}). Please retry.`,
      },
      { status: 502 }
    );
  }

  const successfulChunks = chunkResults.filter(
    (r): r is { ok: true; shots: ParsedShot[] } => r.ok
  );

  // Merge and normalize sequence first
  const mergedShots = successfulChunks
    .flatMap((r) => r.shots)
    .filter((s): s is ParsedShot => !!s);
  mergedShots.forEach((s, i) => {
    s.sequence = i + 1;
  });

  if (mergedShots.length === 0) {
    return NextResponse.json({ error: "Failed to generate shots" }, { status: 500 });
  }

  // Normalize long shots into dynamic 10-14s storyboard segments based on shot/story characteristics.
  const allShots = planShotTransitions(expandShotsForVideoControl(mergedShots, () => genId()), {
    profileId: transitionProfileId,
  });
  console.log(
    `[ShotSplit] Transition profile=${transitionProfileId} usage ${JSON.stringify(summarizeTransitionUsage(allShots))}`
  );
  if (targetShotBudget) {
    console.log(
      `[ShotSplit] Short-drama shot budget target=${targetShotBudget.targetShotCount}, range=${targetShotBudget.minShotCount}-${targetShotBudget.maxShotCount}, actual=${allShots.length}`
    );
  }

  // Create version record
  const versionWhereClause = episodeId
    ? and(eq(storyboardVersions.projectId, projectId), eq(storyboardVersions.episodeId, episodeId))
    : eq(storyboardVersions.projectId, projectId);
  const [maxVersionRow] = await db
    .select({ maxNum: storyboardVersions.versionNum })
    .from(storyboardVersions)
    .where(versionWhereClause)
    .orderBy(desc(storyboardVersions.versionNum))
    .limit(1);
  const nextVersionNum = (maxVersionRow?.maxNum ?? 0) + 1;
  const today = new Date();
  const dateStr =
    today.getUTCFullYear().toString() +
    String(today.getUTCMonth() + 1).padStart(2, "0") +
    String(today.getUTCDate()).padStart(2, "0");
  const versionLabel = `${dateStr}-V${nextVersionNum}`;
  const versionId = genId();
  await db.insert(storyboardVersions).values({
    id: versionId,
    projectId,
    label: versionLabel,
    versionNum: nextVersionNum,
    createdAt: new Date(),
    episodeId: episodeId ?? null,
  });

  const lastInsertedByChainGroup = new Map<string, string>();
  for (const shot of allShots) {
    const shotId = genId();
    const prevShotId = shot.chainGroupId
      ? (lastInsertedByChainGroup.get(shot.chainGroupId) ?? null)
      : null;
    await db.insert(shots).values({
      id: shotId,
      projectId,
      versionId,
      sequence: shot.sequence,
      prompt: shot.sceneDescription,
      motionScript: shot.motionScript,
      videoScript: shot.videoScript ?? null,
      cameraDirection: shot.cameraDirection || "static",
      duration: shot.duration,
      transitionIn: shot.transitionIn || "cut",
      transitionOut: shot.transitionOut || "cut",
      compositionGuide: shot.compositionGuide || "",
      focalPoint: shot.focalPoint || "",
      depthOfField: shot.depthOfField || "medium",
      soundDesign: shot.soundDesign || "",
      musicCue: shot.musicCue || "",
      episodeId: episodeId ?? null,
      chainGroupId: shot.chainGroupId,
      chainIndex: shot.chainIndex,
      chainTotal: shot.chainTotal,
      prevShotId,
      inheritPrevLastFrame: shot.inheritPrevLastFrame,
      originalDuration: shot.originalDuration,
    });

    if (shot.chainGroupId) {
      lastInsertedByChainGroup.set(shot.chainGroupId, shotId);
    }

    for (let i = 0; i < (shot.dialogues || []).length; i++) {
      const dialogue = shot.dialogues[i];
      const matchedChar = shotCharacters.find((c) => c.name === dialogue.character);
      if (matchedChar) {
        await db.insert(dialogues).values({
          id: genId(),
          shotId,
          characterId: matchedChar.id,
          text: dialogue.text,
          sequence: i,
        });
      }
    }
  }

  console.log(`[ShotSplit] Created ${allShots.length} shots from ${sceneChunks.length} chunks`);
  return NextResponse.json({ shots: allShots.length });
}
