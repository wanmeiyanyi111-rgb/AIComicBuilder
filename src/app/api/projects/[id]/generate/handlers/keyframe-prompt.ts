import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterRelations, shots } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { hasTextModelConfig } from "@/lib/ai/config-presence";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import { insertAssetVersion } from "@/lib/shot-asset-utils";
import { buildKeyframePromptsRequest } from "@/lib/ai/prompts/keyframe-prompts";
import {
  buildVisualStyleFromScript,
  enforceFramePromptRatio,
  enforceVisualStyleRatio,
  getEpisodeCharacters,
  getScriptForScope,
  ratioToDisplayLabel,
} from "../helpers";
import type { ModelConfig } from "../types";

export async function handleGenerateKeyframePrompts(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!hasTextModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No text model configured" }, { status: 400 });
  }

  const batchVersionId = payload?.versionId as string | undefined;
  const buildWhere = (includeVersion: boolean) => {
    const conds = [eq(shots.projectId, projectId)];
    if (includeVersion && batchVersionId) conds.push(eq(shots.versionId, batchVersionId));
    if (episodeId) conds.push(eq(shots.episodeId, episodeId));
    return and(...conds);
  };

  let allShots = await db
    .select()
    .from(shots)
    .where(buildWhere(true))
    .orderBy(asc(shots.sequence));

  if (allShots.length === 0 && batchVersionId) {
    console.warn(
      `[GenerateKeyframePrompts] strict filter empty (versionId=${batchVersionId}), falling back to no-version filter`
    );
    allShots = await db
      .select()
      .from(shots)
      .where(buildWhere(false))
      .orderBy(asc(shots.sequence));
  }

  if (allShots.length === 0) {
    return NextResponse.json({ error: "No shots found" }, { status: 400 });
  }

  const projectCharacters = await getEpisodeCharacters(projectId, episodeId);
  const ratio = (payload?.ratio as string) || "16:9";

  // Pull visual style meta from script (same parser as ref prompts handler)
  const script = await getScriptForScope(projectId, episodeId);
  const visualStyle = enforceVisualStyleRatio(
    buildVisualStyleFromScript(script),
    ratio
  );

  // Load character relationships — drives on-screen interaction framing.
  // Enemies must face each other as live combatants, not background icons.
  const kfRelations = await db
    .select()
    .from(characterRelations)
    .where(eq(characterRelations.projectId, projectId));
  let kfRelationsText = "";
  if (kfRelations.length > 0) {
    kfRelationsText = "\n\n## 角色关系（必须用于决定站位、眼神、肢体对抗、画面张力）\n";
    for (const rel of kfRelations) {
      const charA = projectCharacters.find((c) => c.id === rel.characterAId);
      const charB = projectCharacters.find((c) => c.id === rel.characterBId);
      if (charA && charB) {
        kfRelationsText += `- ${charA.name} ↔ ${charB.name}：${rel.relationType}${rel.description ? `（${rel.description}）` : ""}\n`;
      }
    }
    kfRelationsText += `
**关系驱动构图规则（最高优先级）**：
- **敌对 / 对立 / 仇人**：两人必须都是**活人角色同屏对峙**，直接对视、肢体对抗、武器对准彼此。严禁把任一方画成背景的雕像/神像/虚影/浮雕/壁画。
- **友好 / 盟友**：并肩站位、相互掩护、眼神交流。
- **爱慕 / 亲密**：靠近、牵手、拥抱、温柔对视。
- **父女 / 师徒**：长辈在前或侧，晚辈跟随。
- 凡是出现在 characters 列表里的角色，在首尾帧画面里都必须是真实的活人，不允许以雕像/虚影形式出场。
`;
  }

  const textProvider = resolveAIProvider(modelConfig);
  const keyframeSystemPrompt = await resolvePrompt("shot_split_keyframe_assets", {
    userId,
    projectId,
  });

  // Concurrent per-shot generation: each shot is one LLM call, all run in parallel.
  const total = allShots.length;
  let doneCount = 0;
  console.log(`[GenerateKeyframePrompts] Starting concurrent generation: 0/${total}`);
  const results = await Promise.allSettled(
    allShots.map(async (shot) => {
      try {
        const basePromptRequest = buildKeyframePromptsRequest(
          [
            {
              sequence: shot.sequence,
              prompt: shot.prompt || "",
              motionScript: shot.motionScript,
              cameraDirection: shot.cameraDirection,
            },
          ],
          projectCharacters.map((c) => ({
            name: c.name,
            description: c.description,
            visualHint: c.visualHint,
          })),
          visualStyle,
          ratioToDisplayLabel(ratio)
        );
        const promptRequest = kfRelationsText ? basePromptRequest + kfRelationsText : basePromptRequest;

        const result = await textProvider.generateText(promptRequest, {
          systemPrompt: keyframeSystemPrompt,
          temperature: 0.5,
        });

        const jsonMatch = result.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          throw new Error(`Shot ${shot.sequence}: invalid JSON response`);
        }
        const parsed = JSON.parse(jsonMatch[0]) as Array<{
          shotSequence: number;
          characters?: string[];
          prompts: string[];
        }>;
        const entry = parsed.find((e) => e.shotSequence === shot.sequence) || parsed[0];
        if (!entry || !Array.isArray(entry.prompts) || entry.prompts.length < 2) {
          throw new Error(`Shot ${shot.sequence}: expected 2 prompts (first/last frame)`);
        }
        const normalizedPrompts = [
          enforceFramePromptRatio(entry.prompts[0], ratio),
          enforceFramePromptRatio(entry.prompts[1], ratio),
        ];

        // Use LLM-provided per-shot character list (only visible chars in this shot).
        // Fall back to empty array if LLM omitted the field — never default to all chars.
        const charsForShot = Array.isArray(entry.characters) ? entry.characters : [];
        await insertAssetVersion({
          shotId: shot.id,
          type: "first_frame",
          sequenceInType: 0,
          prompt: normalizedPrompts[0],
          status: "pending",
          characters: charsForShot,
        });
        await insertAssetVersion({
          shotId: shot.id,
          type: "last_frame",
          sequenceInType: 0,
          prompt: normalizedPrompts[1],
          status: "pending",
          characters: charsForShot,
        });
        doneCount++;
        console.log(`[GenerateKeyframePrompts] ✓ shot ${shot.sequence} (${doneCount}/${total})`);
        return shot.sequence;
      } catch (err) {
        doneCount++;
        console.warn(`[GenerateKeyframePrompts] ✗ shot ${shot.sequence} (${doneCount}/${total}): ${String(err)}`);
        throw err;
      }
    })
  );

  const updatedCount = results.filter((r) => r.status === "fulfilled").length;
  const failed = results
    .map((r, i) =>
      r.status === "rejected" ? { seq: allShots[i].sequence, err: String(r.reason) } : null
    )
    .filter(Boolean);
  if (failed.length > 0) {
    console.warn(`[GenerateKeyframePrompts] ${failed.length} shots failed:`, failed);
  }
  console.log(`[GenerateKeyframePrompts] Updated ${updatedCount}/${allShots.length} shots (concurrent)`);
  return NextResponse.json({ updatedCount, totalShots: allShots.length });
}
