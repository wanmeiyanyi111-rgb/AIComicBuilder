export const CANONICAL_DOUBAO_SEED_2_PRO = "doubao-seed-2-0-pro-260215";
export const CANONICAL_NANO_BANANA_2 = "nano_banana_2";
export const CANONICAL_SEEDANCE_1_5_PRO = "doubao-seedance-1-5-pro-251215";

function normalizeInput(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

export function normalizeTextModelId(modelId?: string | null): string {
  const normalized = normalizeInput(modelId);
  if (!normalized) return "";

  if (
    normalized === "doubao-seed-2.0-pro" ||
    normalized === "doubao-seed-2-0-pro" ||
    normalized === "doubao seed 2.0 pro" ||
    normalized === "doubaoseed2.0pro" ||
    normalized === "doubaoseed2pro"
  ) {
    return CANONICAL_DOUBAO_SEED_2_PRO;
  }

  return modelId!.trim();
}

export function normalizeImageModelId(modelId?: string | null): string {
  const normalized = normalizeInput(modelId);
  if (!normalized) return "";

  if (
    normalized === "nanobanana2" ||
    normalized === "nano-banana-2" ||
    normalized === "nano banana 2" ||
    normalized === "nano_banana_2"
  ) {
    return CANONICAL_NANO_BANANA_2;
  }

  return modelId!.trim();
}

export function normalizeVideoModelId(modelId?: string | null): string {
  const normalized = normalizeInput(modelId);
  if (!normalized) return "";

  if (
    normalized === "seedance1.5pro" ||
    normalized === "seedance 1.5 pro" ||
    normalized === "seedance-1.5-pro" ||
    normalized === "seedance_1_5_pro" ||
    normalized === "doubao-seedance-1-5-pro"
  ) {
    return CANONICAL_SEEDANCE_1_5_PRO;
  }

  return modelId!.trim();
}

export function isNanoBananaModel(modelId?: string | null): boolean {
  const normalized = normalizeImageModelId(modelId);
  return normalized.toLowerCase() === CANONICAL_NANO_BANANA_2;
}
