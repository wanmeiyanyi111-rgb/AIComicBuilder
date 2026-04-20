export type EpisodeCountGuidance = {
  sourceUnits: number;
  unitType: "cjk_chars" | "words";
  complexityFactor: number;
  minEpisodes: number;
  targetEpisodes: number;
  maxEpisodes: number;
};

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function estimateEpisodeCountGuidance(text: string): EpisodeCountGuidance {
  const normalized = text.replace(/\s+/g, " ").trim();
  const cjkChars = normalized.match(/[\u3400-\u9fff]/g)?.length || 0;
  const words = normalized.match(/[A-Za-z0-9']+/g)?.length || 0;
  const unitType = cjkChars >= words ? "cjk_chars" : "words";
  const sourceUnits = unitType === "cjk_chars" ? cjkChars : words;

  const sceneMarkers =
    normalized.match(/(?:^|\n)\s*(?:第[一二三四五六七八九十百千0-9]+[章节回幕]|chapter\s+\d+|scene\s+\d+|场景\s*\d+)/gim)
      ?.length || 0;
  const dialogueLines =
    normalized.match(/(?:^|\n)[^\n]{0,20}[：:][^\n]+/g)?.length || 0;
  const twistKeywords =
    normalized.match(
      /突然|忽然|却|竟然|原来|没想到|发现|危机|反转|对峙|追|逃|打|冲|闯|坠|suddenly|however|reveal|discover|crisis|twist|confront|chase|fight/gi
    )?.length || 0;

  const complexityFactor =
    1 +
    Math.min(
      0.3,
      sceneMarkers * 0.02 + dialogueLines * 0.002 + twistKeywords * 0.004
    );

  const episodeUnitBudget = unitType === "cjk_chars" ? 1300 : 850;
  const effectiveUnits = sourceUnits * complexityFactor;
  const minEpisodes = clampInt(
    Math.ceil(effectiveUnits / episodeUnitBudget),
    1,
    60
  );
  const targetEpisodes = clampInt(
    Math.ceil(effectiveUnits / (episodeUnitBudget * 0.9)),
    minEpisodes,
    72
  );
  const maxEpisodes = clampInt(
    Math.max(targetEpisodes, minEpisodes + 2),
    targetEpisodes,
    80
  );

  return {
    sourceUnits,
    unitType,
    complexityFactor,
    minEpisodes,
    targetEpisodes,
    maxEpisodes,
  };
}
