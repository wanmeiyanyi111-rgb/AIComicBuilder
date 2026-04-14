import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { importLogs } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const project = await assertProjectOwnership(request, projectId);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const logs = await db
    .select()
    .from(importLogs)
    .where(eq(importLogs.projectId, projectId))
    .orderBy(asc(importLogs.createdAt));

  return NextResponse.json(logs);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const project = await assertProjectOwnership(request, projectId);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.delete(importLogs).where(eq(importLogs.projectId, projectId));
  return new NextResponse(null, { status: 204 });
}
