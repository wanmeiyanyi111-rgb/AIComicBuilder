import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
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
import { getModelMaxDuration } from "@/lib/ai/model-limits";
import { getEpisodeCharacters } from "../helpers";
import type { ModelConfig } from "../types";
import { expandShotsForVideoControl } from "@/lib/shot-segmentation";
import { planShotTransitions, summarizeTransitionUsage } from "@/lib/shot-transition-planner";
import { normalizeShotTransitionProfileId } from "@/lib/shot-transition-profile";

type ParsedShot = {
  sequence: number;
  sceneDescription: string;
  startFrame: string;
  endFrame: string;
  motionScript: string;
  videoScript?: string;
  duration: number;
  dialogues: Array<{ character: string; text: string }>;
  cameraDirection?: string;
  transitionIn?: string;
  transitionOut?: string;
  compositionGuide?: string;
  focalPoint?: string;
  depthOfField?: string;
  soundDesign?: string;
  musicCue?: string;
  characters?: string[];
  referenceImagePrompts?: string[];
};

function parseShotSplitPayload(rawText: string): ParsedShot[] {
  const parsed = JSON.parse(extractJSON(rawText));
  // Handle multiple formats:
  // 1. Scene-grouped: [{ sceneTitle, shots: [...] }]
  // 2. Flat with wrapper: { shots: [...] }
  // 3. Flat array: [{ sequence, ... }]
  if (Array.isArray(parsed) && parsed.length > 0 && (parsed[0] as { shots?: unknown[] }).shots) {
    return parsed.flatMap((scene: { sceneDescription?: string; shots?: ParsedShot[] }) =>
      (scene.shots || []).map((s) => ({
        ...s,
        sceneDescription: s.sceneDescription || scene.sceneDescription || "",
      }))
    );
  }
  if (Array.isArray(parsed)) return parsed as ParsedShot[];
  return ((parsed as { shots?: ParsedShot[] }).shots || []) as ParsedShot[];
}

export async function handleShotSplitStream(
  projectId: string,
  userId: string,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  let script: string | null = null;
  if (episodeId) {
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    if (!episode) {
      return NextResponse.json({ error: "Episode not found" }, { status: 404 });
    }
    script = episode.script ?? null;
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

  const model = createLanguageModel(modelConfig?.text);
  const videoMaxDuration = getModelMaxDuration(modelConfig?.video?.modelId);
  const shotSplitSlots = await resolveSlotContents("shot_split", { userId, projectId });
  const shotSplitDef = getPromptDefinition("shot_split")!;
  const transitionProfileId = normalizeShotTransitionProfileId(
    shotSplitSlots.transition_profile_id
  );
  const systemPrompt = shotSplitDef.buildFullPrompt(shotSplitSlots, {
    maxDuration: videoMaxDuration,
  });
  const jsonMode = { openai: { response_format: { type: "json_object" } } };

  // Split screenplay into smaller chunks to reduce truncated JSON risk.
  const scenesPerChunk = 4;
  const fullScript = script || "";
  const sceneChunks = splitScriptByScenes(fullScript, scenesPerChunk);
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

  const maxAttempts = 2;
  const retryInstruction =
    "\n\nIMPORTANT: Return COMPLETE, VALID JSON only. Do not use markdown fences. Ensure all strings are closed and escaped.";

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

      // Inject target duration
      if (targetDuration && targetDuration > 0) {
        prompt += `\n\n目标总时长：${targetDuration}秒（${Math.floor(targetDuration / 60)}分${targetDuration % 60}秒）。请确保所有镜头的时长之和接近此目标。\n`;
      }

      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const result = await generateText({
            model,
            system: systemPrompt,
            prompt: attempt === 1 ? prompt : `${prompt}${retryInstruction}`,
            providerOptions: jsonMode,
            temperature: attempt === 1 ? 0.7 : 0.4,
            maxOutputTokens: 8192,
          });

          const shotList = parseShotSplitPayload(result.text);
          if (shotList.length === 0) {
            throw new Error("empty shot list");
          }

          console.log(
            `[ShotSplit] Chunk ${idx + 1}/${sceneChunks.length} attempt ${attempt}: ${shotList.length} shots, keys: ${shotList[0] ? Object.keys(shotList[0]).join(",") : "empty"}`
          );
          return { ok: true as const, shots: shotList };
        } catch (err) {
          lastErr = err;
          console.warn(
            `[ShotSplit] Chunk ${idx + 1}/${sceneChunks.length} attempt ${attempt} failed:`,
            err
          );
        }
      }

      return {
        ok: false as const,
        chunkIndex: idx + 1,
        error: lastErr instanceof Error ? lastErr.message : String(lastErr),
      };
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

  // Normalize long shots to 3-5s segments for better generation control.
  const allShots = planShotTransitions(expandShotsForVideoControl(mergedShots, () => genId()), {
    profileId: transitionProfileId,
  });
  console.log(
    `[ShotSplit] Transition profile=${transitionProfileId} usage ${JSON.stringify(summarizeTransitionUsage(allShots))}`
  );

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

/** Split screenplay text into chunks by SCENE markers, ~maxScenes per chunk.
 *  Preserves the header (VISUAL STYLE + CHARACTERS) and prepends it to every chunk. */
function splitScriptByScenes(script: string, maxScenes: number): string[] {
  // Match SCENE markers with optional markdown bold (**), whitespace, or other decorators
  const scenePattern = /^[\s*#]*(?:SCENE|场景)\s*\d+/i;
  const lines = script.split("\n");

  // Find scene boundary line indices
  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (scenePattern.test(lines[i].trim())) {
      boundaries.push(i);
    }
  }

  // If no scene markers found or few scenes, return as single chunk
  if (boundaries.length <= maxScenes) {
    return [script];
  }

  // Everything before the first SCENE marker is the header (VISUAL STYLE + CHARACTERS)
  const header = lines.slice(0, boundaries[0]).join("\n").trim();

  // Group scenes into chunks, prepend header to each
  const chunks: string[] = [];
  for (let i = 0; i < boundaries.length; i += maxScenes) {
    const start = boundaries[i];
    const end = i + maxScenes < boundaries.length ? boundaries[i + maxScenes] : lines.length;
    const scenesText = lines.slice(start, end).join("\n");
    chunks.push(header ? `${header}\n\n${scenesText}` : scenesText);
  }

  return chunks;
}
