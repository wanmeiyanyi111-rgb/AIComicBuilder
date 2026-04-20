import type { PromptDefinition } from "./registry-core";
export type { PromptCategory, PromptDefinition, PromptSlot } from "./registry-core";

import {
  scriptGenerateDef,
  scriptParseDef,
  scriptSplitDef,
} from "./registry-script-defs";
import {
  characterExtractDef,
  characterImageDef,
  importCharacterExtractDef,
} from "./registry-character-defs";
import {
  sceneImageDef,
  scenePropExtractDef,
  propImageDef,
} from "./registry-asset-defs";
import {
  frameGenerateFirstDef,
  frameGenerateLastDef,
  sceneFrameGenerateDef,
  shotKeyframeAssetsDef,
  shotSplitDef,
} from "./registry-shot-defs";
import {
  refVideoGenerateDef,
  refVideoPromptDef,
  videoGenerateDef,
} from "./registry-video-defs";
import {
  refImagePromptsDef,
  scriptOutlineDef,
} from "./registry-misc-defs";

export const PROMPT_REGISTRY: PromptDefinition[] = [
  scriptOutlineDef,
  scriptGenerateDef,
  scriptParseDef,
  scriptSplitDef,
  characterExtractDef,
  importCharacterExtractDef,
  characterImageDef,
  scenePropExtractDef,
  sceneImageDef,
  propImageDef,
  shotSplitDef,
  shotKeyframeAssetsDef,
  frameGenerateFirstDef,
  frameGenerateLastDef,
  sceneFrameGenerateDef,
  refImagePromptsDef,
  videoGenerateDef,
  refVideoGenerateDef,
  refVideoPromptDef,
];

export const PROMPT_REGISTRY_MAP: Record<string, PromptDefinition> =
  Object.fromEntries(PROMPT_REGISTRY.map((d) => [d.key, d]));

export function getPromptDefinition(
  key: string
): PromptDefinition | undefined {
  return PROMPT_REGISTRY_MAP[key];
}

export function getDefaultSlotContents(
  key: string
): Record<string, string> | undefined {
  const def = PROMPT_REGISTRY_MAP[key];
  if (!def) return undefined;
  const result: Record<string, string> = {};
  for (const s of def.slots) {
    result[s.key] = s.defaultContent;
  }
  return result;
}
