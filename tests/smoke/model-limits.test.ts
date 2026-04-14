import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAX_DURATION,
  getModelMaxDuration,
} from "../../src/lib/ai/model-limits";

test("returns exact duration for known model id", () => {
  assert.equal(getModelMaxDuration("veo-3.1-generate-001"), 8);
  assert.equal(getModelMaxDuration("doubao-seedance-1-5-pro-250528"), 12);
});

test("supports family-level fallback matching", () => {
  assert.equal(getModelMaxDuration("veo-custom-preview"), 8);
  assert.equal(getModelMaxDuration("kling-v3-pro"), 15);
});

test("returns default duration for unknown model ids", () => {
  assert.equal(getModelMaxDuration("some-unknown-model"), DEFAULT_MAX_DURATION);
  assert.equal(getModelMaxDuration(undefined), DEFAULT_MAX_DURATION);
});

