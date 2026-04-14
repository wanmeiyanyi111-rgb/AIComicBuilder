import { eq } from "drizzle-orm";
import { hasImageModelConfig } from "@/lib/ai/config-presence";
import { resolveImageProvider } from "@/lib/ai/provider-factory";
import {
  getPromptDefinition,
  getDefaultSlotContents,
} from "@/lib/ai/prompts/registry";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { db } from "@/lib/db";
import { projects, visualAssets } from "@/lib/db/schema";
import type { ModelConfig } from "../generate/types";

export type VisualAssetType = "scene" | "prop";

export type VisualAssetRow = typeof visualAssets.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
type ProjectStyleSource = Pick<ProjectRow, "styleId" | "worldSetting" | "colorPalette">;

export function isVisualAssetType(value: unknown): value is VisualAssetType {
  return value === "scene" || value === "prop";
}

function pickImageModelMeta(modelConfig?: ModelConfig) {
  return {
    modelProvider:
      modelConfig?.image?.protocol ||
      process.env.IMAGE_MODEL_PROVIDER ||
      process.env.OPENAI_IMAGE_PROVIDER ||
      "",
    modelId:
      modelConfig?.image?.modelId ||
      process.env.IMAGE_MODEL_NAME ||
      process.env.OPENAI_IMAGE_MODEL ||
      "",
  };
}

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function buildProjectStyleHint(project: ProjectStyleSource): string {
  const styleParts = [
    project.styleId?.trim() ? `风格ID：${project.styleId.trim()}` : "",
    project.worldSetting?.trim() ? `世界观：${project.worldSetting.trim()}` : "",
    project.colorPalette?.trim() ? `色彩基调：${project.colorPalette.trim()}` : "",
  ].filter(Boolean);

  if (styleParts.length === 0) {
    return "";
  }

  return `${styleParts.join("；")}。请严格保持一致的美术风格与材质表达。`;
}

export function ensurePromptHasProjectStyle(
  basePrompt: string,
  project: ProjectStyleSource
): string {
  const prompt = (basePrompt || "").trim();
  const styleHint = buildProjectStyleHint(project);
  if (!styleHint) return prompt;
  if (!prompt) return `风格要求：${styleHint}`;

  const world = project.worldSetting?.trim() || "";
  const palette = project.colorPalette?.trim() || "";
  const styleId = project.styleId?.trim() || "";
  const alreadyHasStyle =
    prompt.includes("风格要求：") ||
    prompt.includes("项目风格补充：") ||
    (styleId && prompt.includes(styleId)) ||
    (world && prompt.includes(world.slice(0, 10))) ||
    (palette && prompt.includes(palette.slice(0, 10)));
  if (alreadyHasStyle) return prompt;

  return `${prompt}\n\n风格要求：${styleHint}`;
}

async function buildGenerationPrompt(
  asset: VisualAssetRow,
  project: ProjectRow,
  userId: string
): Promise<string> {
  const basePrompt = (asset.prompt || asset.name || "").trim();
  if (!basePrompt) throw new Error("Prompt is empty");

  const promptKey = asset.type === "scene" ? "scene_image" : "prop_image";
  const definition = getPromptDefinition(promptKey);
  if (!definition) {
    throw new Error(`Unknown prompt key: ${promptKey}`);
  }

  const defaultSlots = getDefaultSlotContents(promptKey) ?? {};
  let slotContents = defaultSlots;
  try {
    slotContents = await resolveSlotContents(promptKey, {
      userId,
      projectId: project.id,
    });
  } catch {
    slotContents = defaultSlots;
  }

  return definition.buildFullPrompt(slotContents, {
    name: asset.name,
    basePrompt,
    projectStyle: buildProjectStyleHint(project),
  });
}

export async function getProjectById(projectId: string): Promise<ProjectRow | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  return project ?? null;
}

export async function generateVisualAsset(
  asset: VisualAssetRow,
  project: ProjectRow,
  userId: string,
  modelConfig?: ModelConfig
): Promise<{ imageUrl: string; prompt: string }> {
  if (!hasImageModelConfig(modelConfig)) {
    throw new Error("No image model configured");
  }

  const prompt = await buildGenerationPrompt(asset, project, userId);
  const provider = resolveImageProvider(modelConfig);
  const { modelProvider, modelId } = pickImageModelMeta(modelConfig);

  await db
    .update(visualAssets)
    .set({ status: "generating", errorMessage: "", updatedAt: new Date() })
    .where(eq(visualAssets.id, asset.id));

  try {
    const imageUrl = await provider.generateImage(prompt, {
      quality: "hd",
      aspectRatio: asset.type === "scene" ? "16:9" : "1:1",
      size: asset.type === "scene" ? "2560x1440" : "2048x2048",
    });

    await db
      .update(visualAssets)
      .set({
        imageUrl,
        status: "completed",
        errorMessage: "",
        modelProvider: modelProvider || null,
        modelId: modelId || null,
        updatedAt: new Date(),
      })
      .where(eq(visualAssets.id, asset.id));

    return { imageUrl, prompt };
  } catch (error) {
    await db
      .update(visualAssets)
      .set({
        status: "failed",
        errorMessage: extractErrorMessage(error),
        updatedAt: new Date(),
      })
      .where(eq(visualAssets.id, asset.id));
    throw error;
  }
}
