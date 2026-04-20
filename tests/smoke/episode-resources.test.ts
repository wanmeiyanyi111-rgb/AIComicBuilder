import test from "node:test";
import assert from "node:assert/strict";
import {
  buildScopedVisualAssetKey,
  normalizeScopedResourceName,
  pickReusableVisualAssetSource,
} from "../../src/lib/episode-resources";

type TestAsset = Parameters<typeof pickReusableVisualAssetSource>[0][number];

function makeAsset(overrides: Partial<TestAsset>): TestAsset {
  return {
    id: "asset",
    projectId: "project-1",
    episodeId: null,
    type: "scene",
    name: "默认资产",
    prompt: "",
    imageUrl: null,
    status: "pending",
    errorMessage: "",
    modelProvider: null,
    modelId: null,
    createdAt: new Date("2026-04-01T00:00:00Z"),
    updatedAt: new Date("2026-04-01T00:00:00Z"),
    ...overrides,
  };
}

test("normalizeScopedResourceName collapses whitespace", () => {
  assert.equal(normalizeScopedResourceName("  旧   上海   里弄 "), "旧 上海 里弄");
});

test("buildScopedVisualAssetKey is case-insensitive by normalized name", () => {
  assert.equal(
    buildScopedVisualAssetKey("scene", "旧 上海 里弄"),
    buildScopedVisualAssetKey("scene", "旧   上海   里弄")
  );
});

test("pickReusableVisualAssetSource prefers current episode asset", () => {
  const rows: TestAsset[] = [
    makeAsset({
      id: "ep1",
      episodeId: "episode-1",
      type: "scene",
      name: "旧上海里弄",
      prompt: "A",
      imageUrl: "/a.png",
      status: "completed",
      updatedAt: new Date("2026-04-10T00:00:00Z"),
    }),
    makeAsset({
      id: "ep2",
      episodeId: "episode-2",
      type: "scene",
      name: "旧上海里弄",
      prompt: "B",
      imageUrl: "/b.png",
      status: "completed",
      updatedAt: new Date("2026-04-11T00:00:00Z"),
    }),
  ];

  const result = pickReusableVisualAssetSource(rows, {
    episodeId: "episode-2",
    type: "scene",
    name: "旧上海里弄",
  });

  assert.equal(result.currentEpisodeMatch?.id, "ep2");
  assert.equal(result.reusableSource, undefined);
});

test("pickReusableVisualAssetSource prefers completed reusable asset from other episode", () => {
  const rows: TestAsset[] = [
    makeAsset({
      id: "pending-source",
      episodeId: "episode-1",
      type: "prop",
      name: "玉佩",
      prompt: "old",
      imageUrl: null,
      status: "pending",
      updatedAt: new Date("2026-04-11T00:00:00Z"),
    }),
    makeAsset({
      id: "completed-source",
      episodeId: "episode-3",
      type: "prop",
      name: "玉佩",
      prompt: "best",
      imageUrl: "/best.png",
      status: "completed",
      updatedAt: new Date("2026-04-10T00:00:00Z"),
    }),
  ];

  const result = pickReusableVisualAssetSource(rows, {
    episodeId: "episode-2",
    type: "prop",
    name: "玉佩",
  });

  assert.equal(result.currentEpisodeMatch, undefined);
  assert.equal(result.reusableSource?.id, "completed-source");
});
