import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStoryboardResourceConfidence,
  computeStoryboardWorkflowState,
  parseStoryboardResolvedResourceSnapshot,
  parseStoryboardWorkflowState,
} from "../../src/lib/storyboard/shot-workflow";

test("computeStoryboardWorkflowState derives readiness from storyboard assets", () => {
  const state = computeStoryboardWorkflowState({
    shot: {
      workflowState: null,
      resolvedResourceSnapshot: null,
      status: "pending",
      prompt: "镜头描述",
      videoPrompt: "视频词",
      isStale: 0,
    },
    mode: "storyboard_grid",
    assets: [
      {
        type: "storyboard_panel",
        fileUrl: "/uploads/panel-1.png",
        status: "completed",
      },
      {
        type: "storyboard_panel",
        fileUrl: "/uploads/panel-2.png",
        status: "completed",
      },
      {
        type: "storyboard_panel",
        fileUrl: "/uploads/panel-3.png",
        status: "completed",
      },
      {
        type: "storyboard_panel",
        fileUrl: "/uploads/panel-4.png",
        status: "completed",
      },
      {
        type: "storyboard_video",
        fileUrl: "/uploads/storyboard-video.mp4",
        status: "completed",
      },
    ],
    current: {
      ...parseStoryboardWorkflowState(null),
      preflightStatus: "pass",
      lastPreflightScore: 88,
      lastPreflightSummary: "预检通过",
    },
  });

  assert.equal(state.promptReady, true);
  assert.equal(state.frameReady, true);
  assert.equal(state.videoPromptReady, true);
  assert.equal(state.videoReady, true);
  assert.equal(state.preflightStatus, "pass");
  assert.equal(state.lastPreflightScore, 88);
});

test("computeStoryboardWorkflowState resets stale preflight markers", () => {
  const state = computeStoryboardWorkflowState({
    shot: {
      workflowState: null,
      resolvedResourceSnapshot: null,
      status: "pending",
      prompt: "镜头描述",
      videoPrompt: "",
      isStale: 1,
    },
    mode: "reference",
    assets: [],
    current: {
      ...parseStoryboardWorkflowState(null),
      preflightStatus: "fail",
      lastPreflightScore: 42,
      lastPreflightSummary: "旧预检失败",
      lastPreflightIssues: ["旧问题"],
    },
  });

  assert.equal(state.stale, true);
  assert.equal(state.preflightStatus, "idle");
  assert.equal(state.lastPreflightScore, null);
  assert.deepEqual(state.lastPreflightIssues, []);
});

test("resource snapshot parser and confidence normalization stay stable", () => {
  const snapshot = parseStoryboardResolvedResourceSnapshot(
    JSON.stringify({
      matchedCharacterIds: ["char-1"],
      matchedCharacterNames: ["阿青"],
      matchedSceneAssetIds: ["scene-1"],
      matchedPropAssetIds: ["prop-1"],
      referenceImages: [
        { kind: "character", label: "阿青", imageUrl: "/uploads/aqing.png" },
      ],
      resourceSummary: "角色参考：阿青",
      resourceConfidence: "medium",
      updatedAt: "2026-04-19T00:00:00.000Z",
    })
  );

  assert.deepEqual(snapshot.matchedCharacterIds, ["char-1"]);
  assert.equal(snapshot.resourceConfidence, "medium");
  assert.equal(
    buildStoryboardResourceConfidence({
      matchedCharacterCount: 1,
      matchedSceneCount: 1,
      matchedPropCount: 0,
      referenceCount: 2,
    }),
    "high"
  );
});
