import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptTemplates } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";

// GET: list all project-level overrides for user and project
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await assertProjectOwnership(request, id);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const userId = project.userId;

  const templates = await db
    .select()
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.userId, userId),
        eq(promptTemplates.scope, "project"),
        eq(promptTemplates.projectId, id)
      )
    );

  return NextResponse.json(templates);
}
