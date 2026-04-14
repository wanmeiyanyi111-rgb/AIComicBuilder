import test from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_DOUBAO_SEED_2_PRO,
  CANONICAL_NANO_BANANA_2,
  CANONICAL_SEEDANCE_1_5_PRO,
  isNanoBananaModel,
  normalizeImageModelId,
  normalizeTextModelId,
  normalizeVideoModelId,
} from "../../src/lib/ai/model-aliases";

test("normalizes doubao text model aliases to canonical id", () => {
  assert.equal(normalizeTextModelId("Doubao-Seed-2.0-pro"), CANONICAL_DOUBAO_SEED_2_PRO);
  assert.equal(normalizeTextModelId("doubao-seed-2-0-pro"), CANONICAL_DOUBAO_SEED_2_PRO);
  assert.equal(normalizeTextModelId("doubao seed 2.0 pro"), CANONICAL_DOUBAO_SEED_2_PRO);
  assert.equal(normalizeTextModelId("custom-text-model"), "custom-text-model");
});

test("normalizes nanobanana image model aliases to canonical id", () => {
  assert.equal(normalizeImageModelId("NanoBanana2"), CANONICAL_NANO_BANANA_2);
  assert.equal(normalizeImageModelId("nano-banana-2"), CANONICAL_NANO_BANANA_2);
  assert.equal(normalizeImageModelId("nano banana 2"), CANONICAL_NANO_BANANA_2);
  assert.equal(normalizeImageModelId("custom-image-model"), "custom-image-model");
});

test("normalizes seedance video model aliases to canonical id", () => {
  assert.equal(normalizeVideoModelId("seedance1.5pro"), CANONICAL_SEEDANCE_1_5_PRO);
  assert.equal(normalizeVideoModelId("seedance-1.5-pro"), CANONICAL_SEEDANCE_1_5_PRO);
  assert.equal(normalizeVideoModelId("doubao-seedance-1-5-pro"), CANONICAL_SEEDANCE_1_5_PRO);
  assert.equal(normalizeVideoModelId("custom-video-model"), "custom-video-model");
});

test("detects nanobanana model after normalization", () => {
  assert.equal(isNanoBananaModel("NanoBanana2"), true);
  assert.equal(isNanoBananaModel(CANONICAL_NANO_BANANA_2), true);
  assert.equal(isNanoBananaModel("some-other-model"), false);
});
