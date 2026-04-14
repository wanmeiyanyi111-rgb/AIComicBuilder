import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { db } from "@/lib/db";
import { visualAssets } from "@/lib/db/schema";
import { isVisualAssetType } from "../helpers";

async function findAsset(projectId: string, assetId: string) {
  const [asset] = await db
    .select()
    .from(visualAssets)
    .where(and(eq(visualAssets.id, assetId), eq(visualAssets.projectId, projectId)));
  return asset ?? null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  const { id: projectId, assetId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const existing = await findAsset(projectId, assetId);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as Partial<{
    name: string;
    prompt: string;
    type: string;
  }>;

  const updateData: Partial<typeof visualAssets.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (body.name !== undefined) {
    updateData.name = body.name.trim();
  }
  if (body.type !== undefined && isVisualAssetType(body.type)) {
    updateData.type = body.type;
  }
  if (body.prompt !== undefined) {
    const prompt = body.prompt.trim();
    updateData.prompt = prompt;

    if (prompt !== (existing.prompt || "")) {
      updateData.imageUrl = null;
      updateData.status = "pending";
      updateData.errorMessage = "";
    }
  }

  const [updated] = await db
    .update(visualAssets)
    .set(updateData)
    .where(and(eq(visualAssets.id, assetId), eq(visualAssets.projectId, projectId)))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  const { id: projectId, assetId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .delete(visualAssets)
    .where(and(eq(visualAssets.id, assetId), eq(visualAssets.projectId, projectId)));

  return new NextResponse(null, { status: 204 });
}
