import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { hasImageModelConfig } from "@/lib/ai/config-presence";
import { db } from "@/lib/db";
import { visualAssets } from "@/lib/db/schema";
import type { ModelConfig } from "../../generate/types";
import {
  extractErrorMessage,
  generateVisualAsset,
  getProjectById,
  isVisualAssetType,
} from "../helpers";

const DEFAULT_BATCH_CONCURRENCY = 2;
const MAX_BATCH_CONCURRENCY = 4;
const GENERATING_STALE_SECONDS = 10 * 60;

function toUnixSeconds(value: unknown): number {
  if (typeof value === "number") return value;
  const parsed = new Date(String(value || "")).getTime();
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function isStaleGenerating(
  row: { status: string; updatedAt: unknown },
  nowSeconds: number
): boolean {
  if (row.status !== "generating") return false;
  const updatedAt = toUnixSeconds(row.updatedAt);
  if (!updatedAt) return true;
  return nowSeconds - updatedAt >= GENERATING_STALE_SECONDS;
}

function resolveConcurrency(): number {
  const raw = Number.parseInt(process.env.VISUAL_ASSET_BATCH_CONCURRENCY || "", 10);
  if (!Number.isFinite(raw)) return DEFAULT_BATCH_CONCURRENCY;
  return Math.max(1, Math.min(MAX_BATCH_CONCURRENCY, raw));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const ownedProject = await assertProjectOwnership(request, projectId);
  if (!ownedProject) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    episodeId?: string;
    type?: string;
    overwrite?: boolean;
    modelConfig?: ModelConfig;
  };
  if (!hasImageModelConfig(body.modelConfig)) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const project = await getProjectById(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const episodeId = body.episodeId?.trim();
  const conditions = [eq(visualAssets.projectId, projectId)];
  if (episodeId) {
    conditions.push(eq(visualAssets.episodeId, episodeId));
  }
  if (body.type && isVisualAssetType(body.type)) {
    conditions.push(eq(visualAssets.type, body.type));
  }

  const rows = await db
    .select()
    .from(visualAssets)
    .where(and(...conditions));

  const sorted = [...rows].sort((a, b) => {
    const ta = toUnixSeconds(a.updatedAt);
    const tb = toUnixSeconds(b.updatedAt);
    return tb - ta;
  });

  const candidateRows = sorted;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const targets = body.overwrite
    ? candidateRows
    : candidateRows.filter((row) => {
        if (row.status === "completed" && row.imageUrl) return false;
        if (row.status === "generating" && !isStaleGenerating(row, nowSeconds)) {
          return false;
        }
        return true;
      });

  const results: Array<{
    id: string;
    status: "ok" | "error";
    imageUrl?: string;
    error?: string;
  }> = [];

  const concurrency = Math.min(resolveConcurrency(), Math.max(1, targets.length));
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < targets.length) {
      const index = cursor;
      cursor += 1;
      const asset = targets[index];
      try {
        const result = await generateVisualAsset(
          asset,
          project,
          ownedProject.userId,
          body.modelConfig
        );
        results[index] = { id: asset.id, status: "ok", imageUrl: result.imageUrl };
      } catch (error) {
        results[index] = {
          id: asset.id,
          status: "error",
          error: extractErrorMessage(error),
        };
      }
    }
  });
  await Promise.all(workers);

  return NextResponse.json({
    total: candidateRows.length,
    generated: targets.length,
    usedGlobalFallback: false,
    results,
  });
}
