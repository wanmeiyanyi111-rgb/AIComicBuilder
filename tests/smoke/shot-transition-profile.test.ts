import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SHOT_TRANSITION_PROFILE,
  getShotTransitionPolicyText,
  normalizeShotTransitionProfileId,
} from "../../src/lib/shot-transition-profile";

test("normalizeShotTransitionProfileId returns default for unknown values", () => {
  assert.equal(normalizeShotTransitionProfileId(""), DEFAULT_SHOT_TRANSITION_PROFILE);
  assert.equal(
    normalizeShotTransitionProfileId("non-existent"),
    DEFAULT_SHOT_TRANSITION_PROFILE
  );
});

test("normalizeShotTransitionProfileId keeps known values", () => {
  assert.equal(normalizeShotTransitionProfileId("balanced"), "balanced");
  assert.equal(normalizeShotTransitionProfileId("cinematic"), "cinematic");
  assert.equal(normalizeShotTransitionProfileId("dynamic"), "dynamic");
  assert.equal(normalizeShotTransitionProfileId("smooth"), "smooth");
});

test("getShotTransitionPolicyText changes with profile", () => {
  const balanced = getShotTransitionPolicyText("balanced");
  const dynamic = getShotTransitionPolicyText("dynamic");

  assert.ok(balanced.includes("均衡默认"));
  assert.ok(dynamic.includes("高动势"));
});
