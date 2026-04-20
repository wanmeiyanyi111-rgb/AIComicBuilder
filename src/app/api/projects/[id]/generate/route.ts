import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { enqueueTask } from "@/lib/task-queue";
import type { TaskType } from "@/lib/task-queue";
import type { ModelConfig } from "./types";
import {
  handleAiOptimizeText,
  handleBatchCharacterImage,
  handleBatchFrameGenerate,
  handleBatchStoryboardGenerate,
  handleBatchRefImageGenerate,
  handleBatchReferenceVideo,
  handleBatchSceneFrame,
  handleBatchVideoGenerate,
  handleBatchVideoPrompt,
  handleCharacterExtract,
  handleGenerateKeyframePrompts,
  handleGenerateStoryboardPrompts,
  handleGenerateRefPrompts,
  handleScriptGenerate,
  handleScriptOutlineAction,
  handleScriptParseStream,
  handleShotSplitStream,
  handleSingleCharacterImage,
  handleSingleFrameGenerate,
  handleSingleRefImageGenerate,
  handleSingleReferenceVideo,
  handleSingleSceneFrame,
  handleSingleStoryboardGenerate,
  handleSingleShotRefImageGenerateAll,
  handleSingleShotRewrite,
  handleSingleVideoGenerate,
  handleSingleVideoPrompt,
  handleVideoPreflight,
  handleVideoAssembleSync,
} from "./handlers";

export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const project = await assertProjectOwnership(request, projectId);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const userId = project.userId;

  const body = (await request.json()) as {
    action: string;
    payload?: Record<string, unknown>;
    modelConfig?: ModelConfig;
    episodeId?: string;
  };

  const { action, payload, modelConfig, episodeId } = body;

  const directHandlers: Record<string, () => Promise<Response>> = {
    script_outline: () =>
      handleScriptOutlineAction(projectId, userId, payload, modelConfig, episodeId),
    script_generate: () =>
      handleScriptGenerate(projectId, userId, payload, modelConfig, episodeId),
    script_parse: () =>
      handleScriptParseStream(projectId, userId, modelConfig, episodeId),
    character_extract: () =>
      handleCharacterExtract(projectId, userId, modelConfig, episodeId),
    single_character_image: () => handleSingleCharacterImage(payload, modelConfig),
    batch_character_image: () =>
      handleBatchCharacterImage(projectId, modelConfig, episodeId),
    shot_split: () => handleShotSplitStream(projectId, userId, modelConfig, episodeId),
    generate_storyboard_prompts: () =>
      handleGenerateStoryboardPrompts(projectId, userId, payload, modelConfig, episodeId),
    batch_storyboard_generate: () =>
      handleBatchStoryboardGenerate(projectId, userId, payload, modelConfig, episodeId),
    single_storyboard_generate: () =>
      handleSingleStoryboardGenerate(projectId, userId, payload, modelConfig, episodeId),
    generate_keyframe_prompts: () =>
      handleGenerateKeyframePrompts(projectId, userId, payload, modelConfig, episodeId),
    single_shot_rewrite: () =>
      handleSingleShotRewrite(projectId, payload, modelConfig, episodeId),
    batch_frame_generate: () =>
      handleBatchFrameGenerate(projectId, userId, payload, modelConfig, episodeId),
    single_frame_generate: () =>
      handleSingleFrameGenerate(projectId, userId, payload, modelConfig, episodeId),
    single_video_generate: () =>
      handleSingleVideoGenerate(projectId, userId, payload, modelConfig),
    batch_video_generate: () =>
      handleBatchVideoGenerate(projectId, userId, payload, modelConfig, episodeId),
    single_scene_frame: () =>
      handleSingleSceneFrame(projectId, userId, payload, modelConfig),
    batch_scene_frame: () =>
      handleBatchSceneFrame(projectId, userId, payload, modelConfig, episodeId),
    single_reference_video: () =>
      handleSingleReferenceVideo(projectId, userId, payload, modelConfig),
    batch_reference_video: () =>
      handleBatchReferenceVideo(projectId, userId, payload, modelConfig, episodeId),
    single_video_prompt: () =>
      handleSingleVideoPrompt(projectId, userId, payload, modelConfig),
    batch_video_prompt: () =>
      handleBatchVideoPrompt(projectId, userId, payload, modelConfig, episodeId),
    video_preflight: () =>
      handleVideoPreflight(projectId, userId, payload, modelConfig, episodeId),
    ai_optimize_text: () => handleAiOptimizeText(payload, modelConfig),
    video_assemble: () => handleVideoAssembleSync(projectId, payload, episodeId),
    batch_ref_image_generate: () =>
      handleBatchRefImageGenerate(projectId, userId, payload, modelConfig, episodeId),
    single_ref_image_generate: () =>
      handleSingleRefImageGenerate(projectId, userId, payload, modelConfig),
    generate_ref_prompts: () =>
      handleGenerateRefPrompts(projectId, userId, payload, modelConfig, episodeId),
    single_ref_image_generate_all: () =>
      handleSingleShotRefImageGenerateAll(projectId, userId, payload, modelConfig),
  };

  const directHandler = directHandlers[action];
  if (directHandler) {
    return directHandler();
  }

  // Image/video generation - keep in task queue
  const task = await enqueueTask({
    type: action as NonNullable<TaskType>,
    projectId,
    payload: { projectId, ...payload, modelConfig, episodeId, userId },
    ...(episodeId ? { episodeId } : {}),
  });

  return NextResponse.json(task, { status: 201 });
}
