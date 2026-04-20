import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import { hasTextModelConfig } from "@/lib/ai/config-presence";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { episodes } from "@/lib/db/schema";
import { eq, max } from "drizzle-orm";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { id as genId } from "@/lib/id";
import { buildScriptSplitPrompt } from "@/lib/ai/prompts/script-split";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { chunkTextByLimit } from "@/lib/import-utils";

export const maxDuration = 300;

// ---------------------------------------------------------------------------
// File parsing helpers
// ---------------------------------------------------------------------------

async function parseTxt(buffer: Buffer): Promise<string> {
  return buffer.toString("utf-8");
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function parsePdf(buffer: Buffer): Promise<string> {
  const { extractText } = await import("unpdf");
  const result = await extractText(new Uint8Array(buffer), { mergePages: true });
  return result.text;
}

async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "txt":
      return parseTxt(buffer);
    case "docx":
      return parseDocx(buffer);
    case "pdf":
      return parsePdf(buffer);
    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 10000; // ~10000 chars per chunk

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

interface EpisodeResult {
  title: string;
  description: string;
  keywords: string;
  idea: string;
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
  const userId = project.userId;

  // Parse form data
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const modelConfigRaw = formData.get("modelConfig") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  let modelConfig: { text: ProviderConfig | null } = { text: null };
  if (modelConfigRaw) {
    try {
      modelConfig = JSON.parse(modelConfigRaw) as { text: ProviderConfig | null };
    } catch {
      return NextResponse.json(
        { error: "Invalid model config format" },
        { status: 400 }
      );
    }
  }

  if (!hasTextModelConfig(modelConfig)) {
    return NextResponse.json(
      { error: "No text model configured" },
      { status: 400 }
    );
  }

  // Extract text from file
  const buffer = Buffer.from(await file.arrayBuffer());
  let fullText: string;
  try {
    fullText = await extractText(buffer, file.name);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to parse file";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!fullText.trim()) {
    return NextResponse.json(
      { error: "File contains no text" },
      { status: 400 }
    );
  }

  // Chunk the text
  const chunks = chunkTextByLimit(fullText, CHUNK_SIZE);
  const model = createLanguageModel(modelConfig.text);
  const scriptSplitSystem = await resolvePrompt("script_split", { userId, projectId });

  // Process all chunks concurrently
  const episodeOffset = 0;
  const styleContext = project.worldSetting
    ? `\n\n【项目风格】\n${project.worldSetting}\n\n请确保分集标题、分集简介与关键词都与该风格一致。`
    : "";
  const chunkPromises = chunks.map(async (chunk, idx) => {
    const prompt = buildScriptSplitPrompt(chunk + styleContext, {
      chunkIndex: idx,
      totalChunks: chunks.length,
      episodeOffset, // approximate — exact offset tricky with concurrency
    });

    const result = await generateText({
      model,
      system: scriptSplitSystem,
      prompt,
      temperature: 0.5,
    });

    const parsed = JSON.parse(extractJSON(result.text)) as EpisodeResult[];
    return parsed;
  });

  // Wait for all chunks, flatten results in order
  const chunkResults = await Promise.all(chunkPromises);
  const allEpisodes = chunkResults.flat();

  if (allEpisodes.length === 0) {
    return NextResponse.json(
      { error: "AI could not split the script into episodes" },
      { status: 422 }
    );
  }

  // Get current max sequence
  const [seqResult] = await db
    .select({ maxSeq: max(episodes.sequence) })
    .from(episodes)
    .where(eq(episodes.projectId, projectId));

  let seq = (seqResult?.maxSeq ?? 0) + 1;

  // Create all episodes in DB
  const created = [];
  for (const ep of allEpisodes) {
    const [row] = await db
      .insert(episodes)
      .values({
        id: genId(),
        projectId,
        title: ep.title,
        description: ep.description || "",
        keywords: ep.keywords || "",
        idea: ep.idea || "",
        colorPalette: project.colorPalette || "",
        sequence: seq++,
      })
      .returning();
    created.push(row);
  }

  console.log(
    `[UploadScript] Created ${created.length} episodes from ${chunks.length} chunks`
  );

  return NextResponse.json(
    { episodes: created, count: created.length },
    { status: 201 }
  );
}
