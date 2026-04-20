import test from "node:test";
import assert from "node:assert/strict";
import {
  appendIntentToVideoPrompt,
  buildIntentDrivenMotionContext,
  buildShotIntentCard,
  evaluateVideoContinuityPreflight,
  normalizeDirectorControl,
} from "../../src/lib/video/shot-intent";

test("buildShotIntentCard creates stable anchors and motion budget", () => {
  const card = buildShotIntentCard({
    shotId: "shot-1",
    sequence: 3,
    duration: 5,
    mode: "keyframe",
    prompt: "雨夜街巷，霓虹反射在积水地面。",
    motionScript: "主角回头，抬手挡雨，继续向前。",
    cameraDirection: "slow zoom in",
    startFrameDesc: "中景，主角站在路灯下，抬头看向巷口。",
    endFrameDesc: "中近景，主角收伞迈步离开，背光轮廓清晰。",
    characterNames: ["林晓月"],
    characterHints: [{ name: "林晓月", visualHint: "黑发白衬衫" }],
  });

  assert.equal(card.motionBudget.maxPrimaryActions, 1);
  assert.match(card.immutableAnchors.join(" "), /林晓月/);
  assert.match(card.openingState, /路灯下/);
  assert.match(card.closingState, /收伞/);
});

test("evaluateVideoContinuityPreflight fails when keyframe states are weak", () => {
  const card = buildShotIntentCard({
    shotId: "shot-2",
    sequence: 5,
    duration: 4,
    mode: "keyframe",
    prompt: "夜色天台",
    motionScript: "转身跳跃，翻滚落地，起身冲刺",
    cameraDirection: "orbit left",
    startFrameDesc: "站着",
    endFrameDesc: "走开",
  });

  const result = evaluateVideoContinuityPreflight(card);
  assert.equal(result.pass, false);
  assert.ok(result.score < 70);
  assert.ok(result.issues.length > 0);
});

test("appendIntentToVideoPrompt injects intent block once", () => {
  const card = buildShotIntentCard({
    shotId: "shot-3",
    sequence: 1,
    duration: 5,
    mode: "reference",
    prompt: "空旷大厅，晨光斜照。",
    motionScript: "镜头缓慢推进到门口。",
    cameraDirection: "push in",
  });

  const motion = buildIntentDrivenMotionContext(card);
  assert.match(motion, /IntentCard Shot 1/);

  const withIntent = appendIntentToVideoPrompt("原始视频提示词", card);
  assert.match(withIntent, /\[CONTINUITY_INTENT\]/);
  const secondAppend = appendIntentToVideoPrompt(withIntent, card);
  assert.equal(secondAppend, withIntent);
});

test("director control is normalized and injected into intent block", () => {
  const normalized = normalizeDirectorControl({
    actionIntensity: 130,
    cameraMotion: -20,
    emotionIntensity: 66.6,
  });
  assert.deepEqual(normalized, {
    actionIntensity: 100,
    cameraMotion: 0,
    emotionIntensity: 67,
  });

  const card = buildShotIntentCard({
    shotId: "shot-4",
    sequence: 2,
    duration: 5,
    mode: "keyframe",
    prompt: "室内对峙",
    motionScript: "两人对视，慢慢靠近。",
    startFrameDesc: "中景，双方相对而立。",
    endFrameDesc: "近景，眼神紧绷，准备开口。",
    directorControl: {
      actionIntensity: 20,
      cameraMotion: 15,
      emotionIntensity: 90,
    },
  });

  const withIntent = appendIntentToVideoPrompt("base", card);
  assert.match(withIntent, /Director=Action:20,Camera:15,Emotion:90/);
  assert.equal(card.motionBudget.maxPrimaryActions, 1);
});
