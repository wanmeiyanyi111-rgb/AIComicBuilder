"use client";

import { useCallback } from "react";
import { useModelStore } from "@/stores/model-store";
import type { Capability } from "@/stores/model-store";

/**
 * Returns a guard() function for the given model capability.
 * Call guard() at the top of any AI generation handler.
 * Returns false (and shows a toast) if the model is not configured.
 * Returns true if the model is configured and the action can proceed.
 */
export function useModelGuard(capability: Capability): () => boolean {
  // Use selector pattern (consistent with codebase; avoids re-renders on unrelated store changes)
  const getModelConfig = useModelStore((s) => s.getModelConfig);

  return useCallback((): boolean => {
    // If the store hasn't hydrated from localStorage yet, allow through.
    // The API will handle missing config server-side.
    if (!useModelStore.persist.hasHydrated()) {
      return true;
    }

    const config = getModelConfig();

    // Support server-side env fallback (OPENAI_COMPAT_*, IMAGE_MODEL_*, VOLCENGINE_VIDEO_*):
    // when local default model is not selected in browser storage, do not hard-block here.
    // Let API routes resolve provider from env and return the authoritative result.
    if (config[capability] === null) {
      return true;
    }

    return true;
  }, [capability, getModelConfig]);
}
