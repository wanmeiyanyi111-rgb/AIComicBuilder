import { NextResponse } from "next/server";
import { createLanguageModel } from "@/lib/ai/ai-sdk";
import { hasTextModelConfig } from "@/lib/ai/config-presence";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { addImportLog, chunkTextByLimit } from "@/lib/import-utils";
import {
  buildScriptSplitPrompt,
  SCRIPT_SPLIT_ASSET_RULES,
} from "@/lib/ai/prompts/script-split";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { estimateEpisodeCountGuidance } from "@/lib/story/import-episode-count";
import {
  SHORT_DRAMA_MAX_DURATION_SEC,
  SHORT_DRAMA_MIN_DURATION_SEC,
  SHORT_DRAMA_TARGET_DURATION_SEC,
  summarizeShortDramaIssues,
} from "@/lib/story/short-drama";
import {
  type CharacterSummary,
  type NamedCandidate,
  type SplitEpisode,
  applyCandidateLists,
  buildEmergencySplitPrompt,
  buildEpisodeCountGuidanceText,
  collectHardValidationFailures,
  pruneSingleUseProps,
  repairChunkEpisodes,
  requestEpisodesFromPrompt,
} from "./utils";

export { pruneSingleUseProps } from "./utils";

export const maxDuration = 300;

function toStringSafe(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const project = await assertProjectOwnership(request, projectId);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const ownedProject = project;
  const userId = ownedProject.userId;

  const body = (await request.json()) as {
    text: string;
    allCharacters: CharacterSummary[];
    sceneCandidates?: NamedCandidate[];
    propCandidates?: NamedCandidate[];
    modelConfig: { text: ProviderConfig | null };
  };

  if (!hasTextModelConfig(body.modelConfig)) {
    return NextResponse.json({ error: "No text model" }, { status: 400 });
  }

  const totalCountGuidance = estimateEpisodeCountGuidance(body.text);
  const splitChunkSize =
    totalCountGuidance.unitType === "cjk_chars" ? 3600 : 5200;
  const chunks = chunkTextByLimit(body.text, splitChunkSize);
  const model = createLanguageModel(body.modelConfig?.text);
  const scriptSplitSystem = await resolvePrompt("script_split", { userId, projectId });
  const jsonMode = {
    openai: { response_format: { type: "json_object" } },
  };

  await addImportLog(
    projectId,
    4,
    "running",
    `开始自动分集，共 ${chunks.length} 块，整篇文本至少应拆为 ${totalCountGuidance.minEpisodes} 集，理想 ${totalCountGuidance.targetEpisodes}-${totalCountGuidance.maxEpisodes} 集`
  );

  const allNames = body.allCharacters.map((c) => c.name);
  const allSceneNames = (body.sceneCandidates || [])
    .map((s) => toStringSafe(s?.name))
    .filter(Boolean);
  const allPropNames = (body.propCandidates || [])
    .map((p) => toStringSafe(p?.name))
    .filter(Boolean);
  const charContext = allNames.length > 0
    ? `\n\nAll extracted characters (assign each to ONLY the episodes where they actually appear): ${allNames.join(", ")}`
    : "";
  const sceneContext = allSceneNames.length > 0
    ? `\n\nScene candidates (assign each to ONLY episodes where they truly appear): ${allSceneNames.join(", ")}`
    : "";
  const propContext = allPropNames.length > 0
    ? `\n\nProp candidates (assign each to ONLY episodes where they are truly used/present): ${allPropNames.join(", ")}`
    : "";
  const styleContext = ownedProject.worldSetting?.trim()
    ? `\n\n【项目风格】\n${ownedProject.worldSetting.trim()}\n\n请保证分集设计与该风格一致。`
    : "";
  const shortDramaContext = [
    "\n\n【短剧分集强约束】",
    `- 每集必须控制在 ${SHORT_DRAMA_MIN_DURATION_SEC}-${SHORT_DRAMA_MAX_DURATION_SEC} 秒`,
    `- 默认目标时长 ${SHORT_DRAMA_TARGET_DURATION_SEC} 秒`,
    "- 每集必须采用短剧节奏：开场钩子 -> 快速建冲突 -> 中段升级/反转 -> 结尾悬念",
    "- 输出时必须包含 hook、coreConflict、turningPoint、cliffhanger、beats",
    "- beats 至少 4 段，且各段时长总和必须接近单集预计时长",
    "- 单集尽量只保留 1 条主冲突，避免拖沓铺垫",
    "- 单集角色尽量不超过 5 人，核心场景尽量不超过 4 个",
  ].join("\n");

  let allEpisodes: SplitEpisode[];
  try {
    const collectedEpisodes: SplitEpisode[] = [];
    for (const [idx, chunk] of chunks.entries()) {
      const chunkCountGuidance = estimateEpisodeCountGuidance(chunk);
      const countGuidanceText = buildEpisodeCountGuidanceText(
        chunkCountGuidance,
        `第 ${idx + 1} 块`
      );
      await addImportLog(
        projectId,
        4,
        "running",
        `正在处理第 ${idx + 1}/${chunks.length} 块（至少 ${chunkCountGuidance.minEpisodes} 集，理想 ${chunkCountGuidance.targetEpisodes}-${chunkCountGuidance.maxEpisodes} 集）...`,
        {
          chunkLength: chunk.length,
          episodeOffset: collectedEpisodes.length,
        }
      );

      const basePrompt = buildScriptSplitPrompt(
        chunk +
          charContext +
          sceneContext +
          propContext +
          styleContext +
          shortDramaContext +
          `\n\n${countGuidanceText}` +
          `\n\n${SCRIPT_SPLIT_ASSET_RULES}`,
        {
          chunkIndex: idx,
          totalChunks: chunks.length,
          episodeOffset: collectedEpisodes.length,
        }
      );

      let normalizedEpisodes = (await requestEpisodesFromPrompt(
        {
          addImportLog,
          chunkLabel: `第 ${idx + 1} 块`,
          model,
          projectId,
          prompt: basePrompt,
          providerOptions: jsonMode,
          system: scriptSplitSystem,
        }
      )).map((episode) =>
        applyCandidateLists(episode, allNames, allSceneNames, allPropNames)
      );

      let hardFailures = collectHardValidationFailures(normalizedEpisodes);
      const insufficientEpisodeCount =
        normalizedEpisodes.length < chunkCountGuidance.minEpisodes;
      if (hardFailures.length === 0 && !insufficientEpisodeCount) {
        collectedEpisodes.push(...normalizedEpisodes);
        continue;
      }

      const failureSummary = [
        insufficientEpisodeCount
          ? `当前只拆出 ${normalizedEpisodes.length} 集，但这一块至少需要 ${chunkCountGuidance.minEpisodes} 集，理想 ${chunkCountGuidance.targetEpisodes}-${chunkCountGuidance.maxEpisodes} 集`
          : "",
        ...hardFailures
          .map(
            (item) =>
              `第${item.index + 1}集《${item.title}》：${summarizeShortDramaIssues(
                item.validation.issues
              )}`
          ),
      ]
        .filter(Boolean)
        .join("；");

      normalizedEpisodes = (await repairChunkEpisodes(
        {
          addImportLog,
          allNames,
          allPropNames,
          allSceneNames,
          chunk,
          chunkIndex: idx,
          episodes: normalizedEpisodes,
          issueSummary: failureSummary,
          ownedProjectWorldSetting: ownedProject.worldSetting?.trim() || "",
          projectId,
          requestEpisodesFromPrompt: (prompt, chunkLabel) =>
            requestEpisodesFromPrompt({
              addImportLog,
              chunkLabel,
              model,
              projectId,
              prompt,
              providerOptions: jsonMode,
              system: scriptSplitSystem,
            }),
          styleContext,
        }
      )).map((episode) =>
        applyCandidateLists(episode, allNames, allSceneNames, allPropNames)
      );

      hardFailures = collectHardValidationFailures(normalizedEpisodes);
      if (
        hardFailures.length === 0 &&
        normalizedEpisodes.length >= chunkCountGuidance.minEpisodes
      ) {
        collectedEpisodes.push(...normalizedEpisodes);
        continue;
      }

      await addImportLog(
        projectId,
        4,
        "running",
        `第 ${idx + 1} 块修复后仍未通过，进入短剧应急重切分...`
      );

      normalizedEpisodes = (await requestEpisodesFromPrompt(
        {
          addImportLog,
          chunkLabel: `第 ${idx + 1} 块应急结果`,
          model,
          projectId,
          prompt: buildEmergencySplitPrompt(
            chunk,
            allNames,
            allSceneNames,
            allPropNames,
            ownedProject.worldSetting?.trim() || "",
            countGuidanceText
          ),
          providerOptions: jsonMode,
          system: scriptSplitSystem,
        }
      )).map((episode) =>
        applyCandidateLists(episode, allNames, allSceneNames, allPropNames)
      );

      hardFailures = collectHardValidationFailures(normalizedEpisodes);
      if (
        hardFailures.length > 0 ||
        normalizedEpisodes.length < chunkCountGuidance.minEpisodes
      ) {
        const summary = [
          normalizedEpisodes.length < chunkCountGuidance.minEpisodes
            ? `只拆出 ${normalizedEpisodes.length} 集，低于该块最低要求 ${chunkCountGuidance.minEpisodes} 集`
            : "",
          ...hardFailures
            .map(
              (item) =>
                `第${item.index + 1}集《${item.title}》：${summarizeShortDramaIssues(
                  item.validation.issues
                )}`
            ),
        ]
          .filter(Boolean)
          .join("；");
        throw new Error(`第 ${idx + 1} 块短剧校验仍失败：${summary}`);
      }

      collectedEpisodes.push(...normalizedEpisodes);
    }

    allEpisodes = pruneSingleUseProps(collectedEpisodes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await addImportLog(projectId, 4, "error", `分集失败: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  await addImportLog(projectId, 4, "done", `分集完成，共 ${allEpisodes.length} 集`, {
    episodes: allEpisodes,
  });

  return NextResponse.json({ episodes: allEpisodes });
}
