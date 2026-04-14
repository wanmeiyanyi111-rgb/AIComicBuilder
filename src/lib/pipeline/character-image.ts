import { db } from "@/lib/db";
import { characters, projects } from "@/lib/db/schema";
import { resolveImageProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import { buildCharacterTurnaroundPrompt } from "@/lib/ai/prompts/character-image";
import { eq } from "drizzle-orm";
import type { Task } from "@/lib/task-queue";

export async function handleCharacterImage(task: Task) {
  const payload = task.payload as { characterId: string; modelConfig?: ModelConfigPayload };

  const [character] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, payload.characterId));

  if (!character) {
    throw new Error("Character not found");
  }

  const [project] = await db
    .select({
      styleId: projects.styleId,
      worldSetting: projects.worldSetting,
      colorPalette: projects.colorPalette,
    })
    .from(projects)
    .where(eq(projects.id, character.projectId));

  const projectStyleHint = [
    project?.worldSetting?.trim() ? `世界观：${project.worldSetting.trim()}` : "",
    project?.colorPalette?.trim() ? `色彩基调：${project.colorPalette.trim()}` : "",
  ]
    .filter(Boolean)
    .join("；");

  const ai = resolveImageProvider(payload.modelConfig);
  const prompt = buildCharacterTurnaroundPrompt(
    character.description || character.name,
    character.name,
    {
      projectStyleId: project?.styleId ?? "",
      projectStyleHint,
    }
  );

  const imagePath = await ai.generateImage(prompt, {
    size: "2560x1440",
    aspectRatio: "16:9",
    quality: "hd",
  });

  await db
    .update(characters)
    .set({ referenceImage: imagePath })
    .where(eq(characters.id, payload.characterId));

  return { imagePath };
}
