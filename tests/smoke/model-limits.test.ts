import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAX_DURATION,
  getModelMaxDuration,
  normalizeVideoDurationForModel,
} from "../../src/lib/ai/model-limits";

test("returns exact duration for known model id", () => {
  assert.equal(getModelMaxDuration("veo-3.1-generate-001"), 8);
  assert.equal(getModelMaxDuration("doubao-seedance-1-5-pro-250528"), 10);
});

test("supports family-level fallback matching", () => {
  assert.equal(getModelMaxDuration("veo-custom-preview"), 8);
  assert.equal(getModelMaxDuration("kling-v3-pro"), 15);
});

test("returns default duration for unknown model ids", () => {
  assert.equal(getModelMaxDuration("some-unknown-model"), DEFAULT_MAX_DURATION);
  assert.equal(getModelMaxDuration(undefined), DEFAULT_MAX_DURATION);
});

test("normalizes duration for seedance 1.5 into 4-5s window", () => {
  assert.equal(
    normalizeVideoDurationForModel("doubao-seedance-1-5-pro-251215", 3),
    4
  );
  assert.equal(
    normalizeVideoDurationForModel("doubao-seedance-1-5-pro-251215", 5),
    5
  );
  assert.equal(
    normalizeVideoDurationForModel("doubao-seedance-1-5-pro-251215", 6),
    5
  );
});

test("normalizes duration for seedance 2.x into 4-5s window", () => {
  assert.equal(normalizeVideoDurationForModel("doubao-seedance-2-0-260128", 1), 4);
  assert.equal(normalizeVideoDurationForModel("doubao-seedance-2-0-260128", 4), 4);
  assert.equal(normalizeVideoDurationForModel("doubao-seedance-2-0-260128", 8), 5);
});
