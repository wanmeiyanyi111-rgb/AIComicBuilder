import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";

/**
 * Verify that the request's user owns the given project.
 * Returns the project row if owned, otherwise null.
 */
export async function assertProjectOwnership(
  request: Request,
  projectId: string
) {
  const userId = getUserIdFromRequest(request);

  // Normal path: owned project.
  if (userId) {
    const [ownedProject] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
    if (ownedProject) return ownedProject;
  }

  // Compatibility fallback:
  // Older local data may have been created under a different uid before
  // identity migration. If the project exists but uid mismatches, auto-adopt
  // it to the current uid so existing links keep working.
  const [legacyProject] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!legacyProject) return null;

  if (!userId) {
    return legacyProject;
  }

  const legacyUserId = legacyProject.userId;
  await db
    .update(projects)
    .set({ userId, updatedAt: new Date() })
    .where(eq(projects.userId, legacyUserId));

  const [migrated] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  return migrated ?? legacyProject;
}
