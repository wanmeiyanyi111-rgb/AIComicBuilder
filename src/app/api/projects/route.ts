import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { id as genId } from "@/lib/id";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import {
  resolveProjectStyle,
  resolveProjectStyleFromSource,
} from "@/lib/project-style";

export async function GET(request: Request) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let allProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));

  // Compatibility fallback: if current uid has no projects but the local db
  // has projects under exactly one legacy uid, migrate them to current uid.
  if (allProjects.length === 0) {
    const legacyProjects = await db
      .select()
      .from(projects)
      .orderBy(desc(projects.createdAt));
    const legacyUserIds = Array.from(new Set(legacyProjects.map((p) => p.userId)));
    if (legacyProjects.length > 0 && legacyUserIds.length === 1) {
      const legacyUserId = legacyUserIds[0];
      if (legacyUserId && legacyUserId !== userId) {
        await db
          .update(projects)
          .set({ userId, updatedAt: new Date() })
          .where(eq(projects.userId, legacyUserId));
        allProjects = await db
          .select()
          .from(projects)
          .where(eq(projects.userId, userId))
          .orderBy(desc(projects.createdAt));
      }
    }
  }

  const normalized = allProjects.map((project) => {
    const resolved = resolveProjectStyleFromSource({
      styleId: project.styleId,
      worldSetting: project.worldSetting,
      colorPalette: project.colorPalette,
    });
    return {
      ...project,
      styleId: resolved.styleId,
    };
  });

  return NextResponse.json(normalized);
}

export async function POST(request: Request) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    title: string;
    script?: string;
    styleId?: string;
  };
  const id = genId();
  const { styleId, preset } = resolveProjectStyle(body.styleId);

  const [project] = await db
    .insert(projects)
    .values({
      id,
      userId,
      title: body.title,
      script: body.script || "",
      styleId,
      worldSetting: preset.worldSetting,
      colorPalette: preset.colorPalette,
    })
    .returning();

  return NextResponse.json(
    {
      ...project,
      styleId,
    },
    { status: 201 }
  );
}
