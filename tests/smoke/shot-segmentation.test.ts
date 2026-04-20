import test from "node:test";
import assert from "node:assert/strict";
import {
  computeSegmentDurations,
  expandShotsForVideoControl,
} from "../../src/lib/shot-segmentation";

test("computeSegmentDurations keeps storyboard shots near the 10-14s planning range", () => {
  const durations = computeSegmentDurations(24);
  assert.deepEqual(durations, [12, 12]);
  assert.equal(durations.reduce((a, b) => a + b, 0), 24);
  assert.ok(durations.every((d) => d >= 10 && d <= 14));
});

test("computeSegmentDurations keeps non-long shots unchanged", () => {
  assert.deepEqual(computeSegmentDurations(12), [12]);
  assert.deepEqual(computeSegmentDurations(14), [14]);
  assert.deepEqual(computeSegmentDurations(3), [3]);
});

test("computeSegmentDurations prefers compact action beats and longer atmosphere beats", () => {
  const actionDurations = computeSegmentDurations(14, {
    sequence: 1,
    duration: 14,
    prompt: "主角在走廊里奔跑追逐，猛地撞门后继续冲刺",
  });
  const atmosphereDurations = computeSegmentDurations(14, {
    sequence: 1,
    duration: 14,
    prompt: "建立镜头，展示雨夜城市全景与压抑氛围，缓慢揭示医院外景",
  });

  assert.deepEqual(actionDurations, [14]);
  assert.deepEqual(atmosphereDurations, [14]);
});

test("expandShotsForVideoControl creates chain metadata for long shots", () => {
  const expanded = expandShotsForVideoControl(
    [
      {
        sequence: 1,
        duration: 12,
        prompt: "Hero runs then attacks",
        motionScript: "run and attack quickly",
      },
    ],
    () => "group-abc"
  );

  assert.equal(expanded.length, 1);
  assert.deepEqual(
    expanded.map((s) => s.duration),
    [12]
  );
  assert.deepEqual(
    expanded.map((s) => s.chainIndex),
    [1]
  );
  assert.deepEqual(
    expanded.map((s) => s.chainTotal),
    [1]
  );
  assert.deepEqual(
    expanded.map((s) => s.inheritPrevLastFrame),
    [0]
  );
  assert.ok(expanded.every((s) => s.chainGroupId === null));
});
