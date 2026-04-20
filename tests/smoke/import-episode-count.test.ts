import test from "node:test";
import assert from "node:assert/strict";
import { estimateEpisodeCountGuidance } from "../../src/lib/story/import-episode-count";

test("estimateEpisodeCountGuidance requires many episodes for a long chinese novel chunk", () => {
  const text = "她盯着门外的大雪，想起那场被掩埋的婚礼。".repeat(900);
  const guidance = estimateEpisodeCountGuidance(text);

  assert.equal(guidance.unitType, "cjk_chars");
  assert.ok(guidance.sourceUnits > 10000);
  assert.ok(guidance.minEpisodes >= 8);
  assert.ok(guidance.targetEpisodes >= guidance.minEpisodes);
});

test("estimateEpisodeCountGuidance keeps short text to a small episode count", () => {
  const text = "订婚宴上，她收到一封血书，所有目光瞬间落在她身上。";
  const guidance = estimateEpisodeCountGuidance(text);

  assert.ok(guidance.minEpisodes >= 1);
  assert.ok(guidance.maxEpisodes >= guidance.targetEpisodes);
});
