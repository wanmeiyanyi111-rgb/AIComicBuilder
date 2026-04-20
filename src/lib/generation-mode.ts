export type StoredGenerationMode = "storyboard_grid" | "keyframe" | "reference";
export type RuntimeGenerationMode = "storyboard_grid" | "reference";

export function normalizeRuntimeGenerationMode(
  mode: StoredGenerationMode | string | null | undefined
): RuntimeGenerationMode {
  return mode === "reference" ? "reference" : "storyboard_grid";
}
