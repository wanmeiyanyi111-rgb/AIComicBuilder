import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { episodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await assertProjectOwnership(request, id);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as { orderedIds: string[] };
  const { orderedIds } = body;

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return NextResponse.json(
      { error: "orderedIds must be a non-empty array" },
      { status: 400 }
    );
  }

  // Update sequence numbers based on array order
  await Promise.all(
    orderedIds.map((episodeId, index) =>
      db
        .update(episodes)
        .set({ sequence: index + 1, updatedAt: new Date() })
        .where(
          and(eq(episodes.id, episodeId), eq(episodes.projectId, id))
        )
    )
  );

  return NextResponse.json({ success: true });
}
