import test from "node:test";
import assert from "node:assert/strict";
import {
  computeSegmentDurations,
  expandShotsForVideoControl,
} from "../../src/lib/shot-segmentation";

test("computeSegmentDurations keeps long shots in 3-5s range", () => {
  const durations = computeSegmentDurations(15);
  assert.deepEqual(durations, [4, 4, 4, 3]);
  assert.equal(durations.reduce((a, b) => a + b, 0), 15);
  assert.ok(durations.every((d) => d >= 3 && d <= 5));
});

test("computeSegmentDurations keeps non-long shots unchanged", () => {
  assert.deepEqual(computeSegmentDurations(5), [5]);
  assert.deepEqual(computeSegmentDurations(3), [3]);
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

  assert.equal(expanded.length, 3);
  assert.deepEqual(
    expanded.map((s) => s.duration),
    [4, 4, 4]
  );
  assert.deepEqual(
    expanded.map((s) => s.chainIndex),
    [1, 2, 3]
  );
  assert.deepEqual(
    expanded.map((s) => s.chainTotal),
    [3, 3, 3]
  );
  assert.deepEqual(
    expanded.map((s) => s.inheritPrevLastFrame),
    [0, 1, 1]
  );
  assert.ok(expanded.every((s) => s.chainGroupId === "group-abc"));
});
