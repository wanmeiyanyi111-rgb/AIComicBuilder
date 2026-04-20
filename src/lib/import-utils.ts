import { db } from "@/lib/db";
import { importLogs } from "@/lib/db/schema";
import { id as genId } from "@/lib/id";

export async function addImportLog(
  projectId: string,
  step: number,
  status: "running" | "done" | "error",
  message: string,
  metadata?: unknown
) {
  await db.insert(importLogs).values({
    id: genId(),
    projectId,
    step,
    status,
    message,
    metadata: metadata ?? {},
  });
}

export const CHUNK_SIZE = 10000;

function normalizeChunkSource(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029]/g, "\n")
    .trim();
}

function splitAndClean(text: string, pattern: RegExp): string[] {
  return text
    .split(pattern)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const chineseLike =
    normalized.match(/[^。！？!?；;\n]+[。！？!?；;]?/gu)?.map((item) => item.trim()) ||
    [];
  if (chineseLike.length > 1) {
    return chineseLike.filter(Boolean);
  }

  const englishLike = splitAndClean(normalized, /(?<=[.?!;])\s+/);
  if (englishLike.length > 1) {
    return englishLike;
  }

  return [];
}

function splitOversizedSegment(segment: string, maxSize: number): string[] {
  if (segment.length <= maxSize) return [segment];

  const lineParts = splitAndClean(segment, /\n+/);
  if (lineParts.length > 1) {
    return lineParts.flatMap((part) => splitOversizedSegment(part, maxSize));
  }

  const sentenceParts = splitIntoSentences(segment);
  if (sentenceParts.length > 1) {
    return sentenceParts.flatMap((part) => splitOversizedSegment(part, maxSize));
  }

  const clauseParts = splitAndClean(segment, /(?<=[，、,:：])/u);
  if (clauseParts.length > 1) {
    return clauseParts.flatMap((part) => splitOversizedSegment(part, maxSize));
  }

  const hardChunks: string[] = [];
  for (let start = 0; start < segment.length; start += maxSize) {
    const slice = segment.slice(start, start + maxSize).trim();
    if (slice) hardChunks.push(slice);
  }
  return hardChunks;
}

/** Split text robustly, keeping chunks ≤ maxSize chars even for TXT novels with weak paragraph breaks */
export function chunkTextByLimit(text: string, maxSize: number): string[] {
  const normalized = normalizeChunkSource(text);
  if (!normalized) return [];
  if (normalized.length <= maxSize) return [normalized];

  const paragraphs = splitAndClean(normalized, /\n{2,}/);
  const segments =
    paragraphs.length > 1
      ? paragraphs.flatMap((paragraph) => splitOversizedSegment(paragraph, maxSize))
      : splitOversizedSegment(normalized, maxSize);
  const chunks: string[] = [];
  let current = "";

  for (const segment of segments) {
    if (!segment) continue;
    if (segment.length > maxSize) {
      if (current.trim()) chunks.push(current.trim());
      chunks.push(segment.trim());
      current = "";
      continue;
    }

    const candidate = current ? `${current}\n\n${segment}` : segment;
    if (candidate.length > maxSize && current.length > 0) {
      chunks.push(current.trim());
      current = segment;
      continue;
    }
    current = candidate;
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

/** Split text at paragraph boundaries, each chunk ≤ CHUNK_SIZE chars */
export function chunkText(text: string): string[] {
  return chunkTextByLimit(text, CHUNK_SIZE);
}

export async function extractTextFromFile(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "txt":
      return buffer.toString("utf-8");
    case "docx": {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    case "pdf": {
      const { extractText } = await import("unpdf");
      const result = await extractText(new Uint8Array(buffer), {
        mergePages: true,
      });
      return result.text;
    }
    case "md":
    case "markdown":
      return buffer.toString("utf-8");
    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}
