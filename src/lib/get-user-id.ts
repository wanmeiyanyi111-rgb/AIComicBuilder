const COOKIE_NAME = "ai_comic_uid";

function readCookieValue(cookieHeader: string | null, name: string): string {
  if (!cookieHeader) return "";
  const encodedName = `${name}=`;
  const parts = cookieHeader.split(";").map((part) => part.trim());
  const hit = parts.find((part) => part.startsWith(encodedName));
  if (!hit) return "";
  return decodeURIComponent(hit.slice(encodedName.length));
}

/**
 * Resolve user id from request.
 * Identity resolution preference:
 * 1) signed/owned browser cookie (middleware-managed)
 * 2) legacy x-user-id header fallback (for backwards compatibility)
 * If both exist but mismatch, prefer legacy header to preserve old data access.
 */
export function getUserIdFromRequest(request: Request): string {
  const cookieUserId = readCookieValue(request.headers.get("cookie"), COOKIE_NAME);
  const headerUserId = (request.headers.get("x-user-id") ?? "").trim();

  if (cookieUserId && headerUserId && cookieUserId !== headerUserId) {
    // Legacy compatibility: older clients persisted uid in localStorage/header
    // before cookie identity was enforced. Prefer explicit header in mismatch
    // cases so historical projects remain reachable after upgrades.
    return headerUserId;
  }

  return cookieUserId || headerUserId;
}
