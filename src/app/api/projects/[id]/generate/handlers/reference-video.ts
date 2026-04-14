import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters, dialogues, shots } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import {
  hasImageModelConfig,
  hasVideoModelConfig,
} from "@/lib/ai/config-presence";
import {
  resolveAIProvider,
  resolveVideoProvider,
} from "@/lib/ai/provider-factory";
import { getModelMaxDuration } from "@/lib/ai/model-limits";
import { resolvePrompt, resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { buildReferenceVideoPrompt } from "@/lib/ai/prompts/video-generate";
import { buildRefVideoPromptRequest } from "@/lib/ai/prompts/ref-video-prompt-generate";
import {
  insertAssetVersion,
  loadShotLegacyView,
  loadShotLegacyViewsBatch,
} from "@/lib/shot-asset-utils";
import {
  extractErrorMessage,
  getEpisodeCharacters,
  getVersionedUploadDir,
  isCharacterOnScreen,
} from "../helpers";
import type { ModelConfig } from "../types";

export async function handleSingleReferenceVideo(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const shotId = payload?.shotId as string | undefined;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!hasVideoModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }
  if (!hasImageModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }
  const shotView = await loadShotLegacyView(shot.id);

  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);

  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, shot.projectId));

  const shotCharNameSet = new Set<string>();
  for (const r of shotView.referenceImages) {
    for (const n of r.characters ?? []) shotCharNameSet.add(n);
  }

  const charRefs = projectCharacters
    .filter((c) => !!c.referenceImage && shotCharNameSet.has(c.name))
    .map((c) => ({ name: c.name, imagePath: c.referenceImage as string }));

  const shotDialogues = await db
    .select({
      text: dialogues.text,
      characterId: dialogues.characterId,
      sequence: dialogues.sequence,
    })
    .from(dialogues)
    .where(eq(dialogues.shotId, shotId))
    .orderBy(asc(dialogues.sequence));
  const videoContextForDialogue = shot.motionScript || shot.videoScript || shot.prompt || "";

  const dialogueList = shotDialogues.map((d) => {
    const char = projectCharacters.find((c) => c.id === d.characterId);
    const characterName = char?.name ?? "Unknown";
    const onScreen = isCharacterOnScreen(
      characterName,
      videoContextForDialogue,
      shotView.startFrameDesc
    );
    const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
    return {
      characterName,
      text: d.text,
      offscreen: !onScreen,
      visualHint,
    };
  });

  const ratio = (payload?.ratio as string) || "16:9";
  const refVideoSlots = await resolveSlotContents("ref_video_generate", { userId, projectId });

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    const sceneFramePaths: string[] = shotView.referenceImages
      .filter((r) => r.fileUrl)
      .sort((a, b) => a.sequenceInType - b.sequenceInType)
      .map((r) => r.fileUrl as string);

    if (sceneFramePaths.length === 0) {
      return NextResponse.json(
        { error: "No scene reference images. Please generate scene reference images first." },
        { status: 400 }
      );
    }

    console.log(
      `[SingleReferenceVideo] Shot ${shot.sequence}: ${sceneFramePaths.length} scene frame(s), ${charRefs.length} character ref(s)`
    );

    const orderedRefImages: string[] = [
      ...charRefs.map((c) => c.imagePath),
      ...sceneFramePaths,
    ];

    const characterRefInfos = charRefs.map((c, i) => ({
      name: c.name,
      index: i + 1,
      visualHint: projectCharacters.find((pc) => pc.name === c.name)?.visualHint,
    }));
    const sceneAssetList = shotView.referenceImages
      .filter((r) => r.fileUrl)
      .sort((a, b) => a.sequenceInType - b.sequenceInType);
    const sceneFrameInfos = sceneFramePaths.map((_, i) => {
      const metaObj = sceneAssetList[i]?.meta as { sceneName?: string } | null;
      const name = metaObj?.sceneName || (sceneFramePaths.length > 1 ? `场景-${i + 1}` : "场景");
      return { label: name, index: charRefs.length + i + 1 };
    });
    const fullMapping = [
      ...characterRefInfos.map((c) => `@图片${c.index}是${c.name}`),
      ...sceneFrameInfos.map((s) => `@图片${s.index}是${s.label}`),
    ].join("，") + "。";

    const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);

    const videoModelId = modelConfig?.video?.modelId;
    const videoMaxDuration = getModelMaxDuration(videoModelId);
    const effectiveDuration = Math.min(shot.duration ?? 10, videoMaxDuration);

    let videoPrompt: string;
    if (shot.videoPrompt) {
      videoPrompt = shot.videoPrompt.includes("图像映射")
        ? shot.videoPrompt
        : `图像映射：${fullMapping}。\n\n${shot.videoPrompt}`;
    } else {
      const textProvider = resolveAIProvider(modelConfig);
      const refVideoSystem = await resolvePrompt("ref_video_prompt", { userId, projectId });
      try {
        const motionContext = shot.motionScript || shot.videoScript || shot.prompt || "";
        const promptRequest = buildRefVideoPromptRequest({
          motionScript: motionContext,
          cameraDirection: shot.cameraDirection || "static",
          duration: effectiveDuration,
          characters: characterRefInfos,
          sceneFrames: sceneFrameInfos,
          dialogues: dialogueList.length > 0 ? dialogueList : undefined,
        });
        console.log(`[SingleReferenceVideo] Shot ${shot.sequence} promptRequest:\n${promptRequest}`);
        const rawPrompt = await textProvider.generateText(promptRequest, {
          systemPrompt: refVideoSystem,
          images: sceneFramePaths,
          temperature: 0.7,
        });
        videoPrompt = `Duration: ${effectiveDuration}s.\n\n${rawPrompt.trim()}`;
      } catch (err) {
        console.warn("[SingleReferenceVideo] Vision prompt generation failed, falling back:", err);
        const fallback = buildReferenceVideoPrompt({
          videoScript: shot.videoScript || shot.motionScript || shot.prompt || "",
          cameraDirection: shot.cameraDirection || "static",
          duration: effectiveDuration,
          characters: projectCharacters,
          dialogues: dialogueList.length > 0 ? dialogueList : undefined,
          slotContents: refVideoSlots,
        });
        videoPrompt = `图像映射：${fullMapping}。\n\n${fallback}`;
      }
    }

    console.log(
      `[SingleReferenceVideo] Shot ${shot.sequence}: generating video with ${orderedRefImages.length} reference images`
    );

    const result = await videoProvider.generateVideo({
      initialImage: sceneFramePaths[0],
      prompt: videoPrompt,
      duration: effectiveDuration,
      ratio,
      referenceImages: orderedRefImages,
    });

    await insertAssetVersion({
      shotId,
      type: "reference_video",
      sequenceInType: 0,
      prompt: videoPrompt,
      fileUrl: result.filePath,
      status: "completed",
      meta: result.lastFrameUrl ? { lastFrameUrl: result.lastFrameUrl } : null,
    });
    await db.update(shots).set({ status: "completed" }).where(eq(shots.id, shotId));

    return NextResponse.json({ shotId, referenceVideoUrl: result.filePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleReferenceVideo] Error for shot ${shot.sequence}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json(
      { shotId, status: "error", error: extractErrorMessage(err) },
      { status: 500 }
    );
  }
}

export async function handleBatchReferenceVideo(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!hasVideoModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }
  if (!hasImageModelConfig(modelConfig)) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const batchVersionId = payload?.versionId as string | undefined;
  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const allShots = await db
    .select()
    .from(shots)
    .where(and(...shotWhereConditions))
    .orderBy(asc(shots.sequence));

  const versionedUploadDir = batchVersionId
    ? await getVersionedUploadDir(batchVersionId)
    : process.env.UPLOAD_DIR || "./uploads";

  const overwrite = payload?.overwrite === true;
  const allShotsLegacy = await loadShotLegacyViewsBatch(allShots.map((s) => s.id));
  const eligible = allShots.filter((s) => {
    const v = allShotsLegacy.get(s.id);
    return s.status !== "generating" && (overwrite || !v?.referenceVideoUrl);
  });
  if (eligible.length === 0) {
    return NextResponse.json({ results: [], message: "No eligible shots" });
  }

  const projectCharacters = await getEpisodeCharacters(projectId, episodeId);

  const charsWithRefsAll = projectCharacters.filter((c) => !!c.referenceImage);
  if (charsWithRefsAll.length === 0) {
    return NextResponse.json(
      { error: "No character reference images available." },
      { status: 400 }
    );
  }

  const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);
  const textProvider = resolveAIProvider(modelConfig);
  const refVideoSystem = await resolvePrompt("ref_video_prompt", { userId, projectId });
  const ratio = (payload?.ratio as string) || "16:9";
  const videoMaxDuration = getModelMaxDuration(modelConfig?.video?.modelId);
  const refVideoSlots = await resolveSlotContents("ref_video_generate", { userId, projectId });

  await Promise.all(
    eligible.map((shot) =>
      db.update(shots).set({ status: "generating" }).where(eq(shots.id, shot.id))
    )
  );

  const results = await Promise.all(
    eligible.map(
      async (
        shot
      ): Promise<{
        shotId: string;
        sequence: number;
        status: "ok" | "error";
        referenceVideoUrl?: string;
        error?: string;
      }> => {
        try {
          const shotLegacy = allShotsLegacy.get(shot.id)!;
          const effectiveDuration = Math.min(shot.duration ?? 10, videoMaxDuration);
          const shotDialogues = await db
            .select({
              text: dialogues.text,
              characterId: dialogues.characterId,
              sequence: dialogues.sequence,
            })
            .from(dialogues)
            .where(eq(dialogues.shotId, shot.id))
            .orderBy(asc(dialogues.sequence));
          const videoContextForDialogue = shot.motionScript || shot.videoScript || shot.prompt || "";

          const dialogueList = shotDialogues.map((d) => {
            const char = projectCharacters.find((c) => c.id === d.characterId);
            const characterName = char?.name ?? "Unknown";
            const onScreen = isCharacterOnScreen(
              characterName,
              videoContextForDialogue,
              shotLegacy.startFrameDesc
            );
            const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
            return {
              characterName,
              text: d.text,
              offscreen: !onScreen,
              visualHint,
            };
          });

          const sceneFramePaths: string[] = shotLegacy.referenceImages
            .filter((r) => r.fileUrl)
            .sort((a, b) => a.sequenceInType - b.sequenceInType)
            .map((r) => r.fileUrl as string);

          if (sceneFramePaths.length === 0) {
            throw new Error("No scene reference images. Generate scene reference images first.");
          }

          const shotCharNameSet = new Set<string>();
          for (const r of shotLegacy.referenceImages) {
            for (const n of r.characters ?? []) shotCharNameSet.add(n);
          }
          const charRefs = charsWithRefsAll
            .filter((c) => shotCharNameSet.size === 0 || shotCharNameSet.has(c.name))
            .map((c) => ({ name: c.name, imagePath: c.referenceImage as string }));

          const orderedRefImages: string[] = [
            ...charRefs.map((c) => c.imagePath),
            ...sceneFramePaths,
          ];
          const characterRefInfos = charRefs.map((c, i) => ({
            name: c.name,
            index: i + 1,
            visualHint: projectCharacters.find((pc) => pc.name === c.name)?.visualHint,
          }));
          const sceneAssetList = shotLegacy.referenceImages
            .filter((r) => r.fileUrl)
            .sort((a, b) => a.sequenceInType - b.sequenceInType);
          const sceneFrameInfos = sceneFramePaths.map((_, i) => {
            const metaObj = sceneAssetList[i]?.meta as { sceneName?: string } | null;
            const name =
              metaObj?.sceneName || (sceneFramePaths.length > 1 ? `场景-${i + 1}` : "场景");
            return { label: name, index: charRefs.length + i + 1 };
          });
          const fullMapping = [
            ...characterRefInfos.map((c) => `@图片${c.index}是${c.name}`),
            ...sceneFrameInfos.map((s) => `@图片${s.index}是${s.label}`),
          ].join("，") + "。";

          let videoPrompt: string;
          if (shot.videoPrompt) {
            videoPrompt = shot.videoPrompt.includes("图像映射")
              ? shot.videoPrompt
              : `图像映射：${fullMapping}。\n\n${shot.videoPrompt}`;
          } else {
            try {
              const motionContext = shot.motionScript || shot.videoScript || shot.prompt || "";
              const promptRequest = buildRefVideoPromptRequest({
                motionScript: motionContext,
                cameraDirection: shot.cameraDirection || "static",
                duration: effectiveDuration,
                characters: characterRefInfos,
                sceneFrames: sceneFrameInfos,
                dialogues: dialogueList.length > 0 ? dialogueList : undefined,
              });
              const rawPrompt = await textProvider.generateText(promptRequest, {
                systemPrompt: refVideoSystem,
                images: sceneFramePaths,
                temperature: 0.7,
              });
              videoPrompt = `Duration: ${effectiveDuration}s.\n\n${rawPrompt.trim()}`;
            } catch (err) {
              console.warn("[BatchReferenceVideo] Vision prompt generation failed, falling back:", err);
              const fallback = buildReferenceVideoPrompt({
                videoScript: shot.videoScript || shot.motionScript || shot.prompt || "",
                cameraDirection: shot.cameraDirection || "static",
                duration: effectiveDuration,
                characters: projectCharacters,
                dialogues: dialogueList.length > 0 ? dialogueList : undefined,
                slotContents: refVideoSlots,
              });
              videoPrompt = `图像映射：${fullMapping}。\n\n${fallback}`;
            }
          }

          console.log(
            `[BatchReferenceVideo] Shot ${shot.sequence}: ${sceneFramePaths.length} scenes + ${charRefs.length} chars → video`
          );

          const result = await videoProvider.generateVideo({
            initialImage: sceneFramePaths[0],
            prompt: videoPrompt,
            duration: effectiveDuration,
            ratio,
            referenceImages: orderedRefImages,
          });

          await insertAssetVersion({
            shotId: shot.id,
            type: "reference_video",
            sequenceInType: 0,
            prompt: videoPrompt,
            fileUrl: result.filePath,
            status: "completed",
            meta: result.lastFrameUrl ? { lastFrameUrl: result.lastFrameUrl } : null,
          });
          await db.update(shots).set({ status: "completed" }).where(eq(shots.id, shot.id));

          console.log(`[BatchReferenceVideo] Shot ${shot.sequence} completed`);
          return {
            shotId: shot.id,
            sequence: shot.sequence,
            status: "ok",
            referenceVideoUrl: result.filePath,
          };
        } catch (err) {
          console.error(`[BatchReferenceVideo] Error for shot ${shot.sequence}:`, err);
          await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shot.id));
          return {
            shotId: shot.id,
            sequence: shot.sequence,
            status: "error",
            error: extractErrorMessage(err),
          };
        }
      }
    )
  );

  return NextResponse.json({ results });
}
