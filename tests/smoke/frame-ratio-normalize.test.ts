import test from "node:test";
import assert from "node:assert/strict";
import {
  enforceFramePromptRatio,
  enforceVisualStyleRatio,
} from "../../src/app/api/projects/[id]/generate/helpers";

test("enforceFramePromptRatio replaces conflicting portrait instructions", () => {
  const result = enforceFramePromptRatio(
    "近景特写，85mm焦段，9:16竖屏画幅。冷调氛围。",
    "16:9"
  );
  assert.match(result, /16:9 横屏画幅/);
  assert.doesNotMatch(result, /9:16/);
  assert.doesNotMatch(result, /竖屏/);
});

test("enforceVisualStyleRatio overrides style block ratio", () => {
  const result = enforceVisualStyleRatio(
    "视觉风格：写实电影；画幅比例：9:16 竖屏；氛围情绪：压抑",
    "16:9"
  );
  assert.match(result, /画幅比例：16:9 横屏/);
  assert.doesNotMatch(result, /9:16/);
});
