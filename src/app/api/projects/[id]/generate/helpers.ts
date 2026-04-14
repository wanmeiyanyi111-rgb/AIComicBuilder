import path from "path";
import { db } from "@/lib/db";
import {
  characters,
  episodes,
  projects,
  storyboardVersions,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/** Map user-facing ratio string to ImageOptions fields */
export function ratioToImageOpts(
  ratio?: string
): { aspectRatio?: string; size?: string } {
  switch (ratio) {
    case "16:9":
      return { aspectRatio: "16:9", size: "2560x1440" };
    case "9:16":
      return { aspectRatio: "9:16", size: "1440x2560" };
    case "1:1":
      return { aspectRatio: "1:1", size: "2048x2048" };
    default:
      return { aspectRatio: "16:9", size: "2560x1440" };
  }
}

/**
 * Fetch project-level characters.
 *
 * Product rule: characters are shared across episodes within one project.
 * So even when epId is provided, we return the full project character set.
 */
export async function getEpisodeCharacters(projectId: string, epId?: string | null) {
  void epId;
  return db.select().from(characters).where(eq(characters.projectId, projectId));
}

/** Load script text from episode when epId exists, else from project. */
export async function getScriptForScope(projectId: string, epId?: string): Promise<string> {
  if (epId) {
    const source = await db
      .select({ script: episodes.script })
      .from(episodes)
      .where(eq(episodes.id, epId));
    return source[0]?.script || "";
  }
  const source = await db
    .select({ script: projects.script })
    .from(projects)
    .where(eq(projects.id, projectId));
  return source[0]?.script || "";
}

/** Parse VISUAL STYLE machine-readable block from script text. */
export function buildVisualStyleFromScript(script: string): string {
  const pickField = (label: string): string => {
    const re = new RegExp(`${label}[：:]\\s*(.+?)(?:\\n|$)`);
    const m = script.match(re);
    return m?.[1]?.trim() || "";
  };
  const metaVisualStyle = pickField("视觉风格") || pickField("Visual Style");
  const metaColorTone = pickField("色彩基调");
  const metaEra = pickField("时代美学");
  const metaMood = pickField("氛围情绪");
  const metaRatio = pickField("画幅比例");
  return [
    metaVisualStyle,
    metaColorTone && `色彩基调：${metaColorTone}`,
    metaEra && `时代美学：${metaEra}`,
    metaMood && `氛围情绪：${metaMood}`,
    metaRatio && `画幅比例：${metaRatio}`,
  ]
    .filter(Boolean)
    .join("；");
}

/**
 * Check if a character is visible on-screen by looking for their name
 * in the videoScript or startFrameDesc fields.
 */
export function isCharacterOnScreen(
  characterName: string,
  videoScript: string,
  startFrameDesc: string | null | undefined
): boolean {
  const text = `${videoScript} ${startFrameDesc ?? ""}`;
  return text.includes(characterName);
}

/**
 * Build character mapping prompt prefix for image generation.
 * Includes character name, height, body type, description, and strict
 * proportion enforcement when multiple characters are present.
 */
export function buildCharMappingPrefix(
  chars: Array<typeof characters.$inferSelect>
): string {
  if (chars.length === 0) return "";
  const charMapping = chars.map((c, i) => `图片${i + 1}=${c.name}`).join("，");
  const charDescriptions = chars
    .map((c) => {
      const heightInfo = c.heightCm ? `身高约${c.heightCm}cm` : "";
      const bodyInfo = c.bodyType ? `${c.bodyType}体型` : "";
      const physicalTags = [heightInfo, bodyInfo].filter(Boolean).join("，");
      return `${c.name}${physicalTags ? `（${physicalTags}）` : ""}: ${c.description || ""}`;
    })
    .join("\n");
  const heightHint =
    chars.length > 1
      ? "\n\n【角色比例严格要求】画面中角色的相对身高/体型必须严格遵循上述身高数据。儿童必须明显小于成人，体型矮小、头身比例符合实际年龄，绝不可画成与成人同等大小。"
      : "";
  return `角色映射：${charMapping}\n\n角色描述：\n${charDescriptions}${heightHint}\n\n严格按照参考图的角色外观（面部、服装、发型）和相对比例生成。\n\n场景描述：`;
}

export async function getVersionedUploadDir(
  versionId: string | null | undefined
): Promise<string> {
  if (!versionId) return process.env.UPLOAD_DIR || "./uploads";
  const [version] = await db
    .select({
      label: storyboardVersions.label,
      projectId: storyboardVersions.projectId,
    })
    .from(storyboardVersions)
    .where(eq(storyboardVersions.id, versionId));
  if (!version) return process.env.UPLOAD_DIR || "./uploads";
  return path.join(
    process.env.UPLOAD_DIR || "./uploads",
    "projects",
    version.projectId,
    version.label
  );
}

export function extractErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  try {
    const parsed = JSON.parse(err.message) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {}
  return err.message;
}
