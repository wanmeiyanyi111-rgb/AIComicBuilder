import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { hasImageModelConfig } from "@/lib/ai/config-presence";
import { db } from "@/lib/db";
import { visualAssets } from "@/lib/db/schema";
import type { ModelConfig } from "../../../generate/types";
import {
  extractErrorMessage,
  generateVisualAsset,
  getProjectById,
} from "../../helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  const { id: projectId, assetId } = await params;
  const ownedProject = await assertProjectOwnership(request, projectId);
  if (!ownedProject) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    modelConfig?: ModelConfig;
  };
  if (!hasImageModelConfig(body.modelConfig)) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [asset] = await db
    .select()
    .from(visualAssets)
    .where(and(eq(visualAssets.id, assetId), eq(visualAssets.projectId, projectId)));
  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const project = await getProjectById(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const result = await generateVisualAsset(
      asset,
      project,
      ownedProject.userId,
      body.modelConfig
    );
    return NextResponse.json({
      id: asset.id,
      imageUrl: result.imageUrl,
      status: "completed",
      prompt: result.prompt,
    });
  } catch (error) {
    const message = extractErrorMessage(error);
    const status =
      message === "Prompt is empty" || message === "No image model configured"
        ? 400
        : 500;
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
