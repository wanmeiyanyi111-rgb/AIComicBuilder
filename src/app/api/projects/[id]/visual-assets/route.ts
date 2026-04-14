import { and, eq, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { db } from "@/lib/db";
import { episodes, visualAssets } from "@/lib/db/schema";
import { id as genId } from "@/lib/id";
import { isVisualAssetType } from "./helpers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const episodeId = searchParams.get("episodeId")?.trim() || "";
  const type = searchParams.get("type");

  const conditions = [eq(visualAssets.projectId, projectId)];
  if (episodeId) {
    // Episode page should also see project-level (global) scene/prop assets.
    conditions.push(
      or(eq(visualAssets.episodeId, episodeId), isNull(visualAssets.episodeId))!
    );
  }
  if (type && isVisualAssetType(type)) conditions.push(eq(visualAssets.type, type));

  const rows = await db
    .select()
    .from(visualAssets)
    .where(and(...conditions));

  const sorted = [...rows].sort((a, b) => {
    const timeA = new Date(a.updatedAt).getTime();
    const timeB = new Date(b.updatedAt).getTime();
    return timeB - timeA;
  });

  if (!episodeId) {
    return NextResponse.json(sorted);
  }

  const episodeRows = sorted.filter((row) => row.episodeId === episodeId);
  const episodeKeys = new Set(
    episodeRows.map(
      (row) => `${row.type}:${(row.name || "").trim().toLowerCase()}`
    )
  );
  const globalRows = sorted.filter(
    (row) =>
      row.episodeId === null &&
      !episodeKeys.has(`${row.type}:${(row.name || "").trim().toLowerCase()}`)
  );

  return NextResponse.json([...episodeRows, ...globalRows]);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as Partial<{
    episodeId: string | null;
    type: string;
    name: string;
    prompt: string;
  }>;

  if (!isVisualAssetType(body.type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const episodeId = body.episodeId || null;
  if (episodeId) {
    const [episode] = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)));
    if (!episode) {
      return NextResponse.json({ error: "Episode not found" }, { status: 404 });
    }
  }

  const name = (body.name || "").trim() || (body.type === "scene" ? "新场景" : "新道具");
  const prompt = (body.prompt || "").trim();

  const insertRow: typeof visualAssets.$inferInsert = {
    id: genId(),
    projectId,
    episodeId,
    type: body.type,
    name,
    prompt,
    status: "pending",
    errorMessage: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const [created] = await db.insert(visualAssets).values(insertRow).returning();
  return NextResponse.json(created, { status: 201 });
}
