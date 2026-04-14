import test from "node:test";
import assert from "node:assert/strict";
import {
  planShotTransitions,
  summarizeTransitionUsage,
} from "../../src/lib/shot-transition-planner";

test("planShotTransitions sets fade edges and dissolve on scene jump", () => {
  const planned = planShotTransitions([
    {
      sequence: 1,
      sceneDescription: "雨夜街道",
      motionScript: "主角慢慢回头",
    },
    {
      sequence: 2,
      sceneDescription: "医院走廊",
      motionScript: "主角推门进入",
    },
    {
      sequence: 3,
      sceneDescription: "医院走廊",
      motionScript: "主角停在病房门口",
    },
  ]);

  assert.equal(planned[0].transitionIn, "fade_in");
  assert.equal(planned[0].transitionOut, "dissolve");
  assert.equal(planned[1].transitionIn, "dissolve");
  assert.equal(planned[1].transitionOut, "cut");
  assert.equal(planned[2].transitionOut, "fade_out");
});

test("planShotTransitions forces cut for chained continuity shots", () => {
  const planned = planShotTransitions([
    {
      sequence: 1,
      sceneDescription: "天台",
      transitionOut: "wipeleft",
      chainGroupId: "chain-1",
      inheritPrevLastFrame: 0,
    },
    {
      sequence: 2,
      sceneDescription: "天台",
      transitionIn: "circleopen",
      chainGroupId: "chain-1",
      inheritPrevLastFrame: 1,
    },
  ]);

  assert.equal(planned[0].transitionOut, "cut");
  assert.equal(planned[1].transitionIn, "cut");
  assert.equal(planned[1].transitionOut, "fade_out");
});

test("planShotTransitions keeps non-cut usage under control", () => {
  const input = Array.from({ length: 10 }, (_, i) => ({
    sequence: i + 1,
    sceneDescription: `场景${i + 1}`,
    motionScript: "第二天清晨切到新的地点，蒙太奇组接",
  }));

  const planned = planShotTransitions(input);
  const summary = summarizeTransitionUsage(planned);
  const nonCutCount =
    summary.dissolve +
    summary.fade_in +
    summary.fade_out +
    summary.wipeleft +
    summary.slideright +
    summary.circleopen;
  const fancyCount = summary.wipeleft + summary.slideright + summary.circleopen;

  assert.ok(nonCutCount >= 2, "should include at least fade_in and fade_out");
  assert.ok(nonCutCount <= 5, "non-cut transitions should be limited");
  assert.ok(fancyCount <= 1, "fancy transitions should be rare");
});
