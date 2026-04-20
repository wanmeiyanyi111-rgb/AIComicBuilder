import test from "node:test";
import assert from "node:assert/strict";
import {
  pruneSingleUseProps,
} from "../../src/app/api/projects/[id]/import/split/route";

test("pruneSingleUseProps removes props that appear in only one episode", () => {
  const episodes = [
    {
      title: "第1集",
      description: "",
      keywords: "",
      idea: "",
      storyMode: "short_drama" as const,
      targetDurationSec: 150,
      durationMinSec: 120,
      durationMaxSec: 180,
      estimatedDurationSec: 150,
      hook: "",
      coreConflict: "",
      turningPoint: "",
      cliffhanger: "",
      beats: [],
      validationIssues: [],
      characters: [],
      scenes: [],
      props: ["玉佩", "一次性酒杯"],
    },
    {
      title: "第2集",
      description: "",
      keywords: "",
      idea: "",
      storyMode: "short_drama" as const,
      targetDurationSec: 150,
      durationMinSec: 120,
      durationMaxSec: 180,
      estimatedDurationSec: 150,
      hook: "",
      coreConflict: "",
      turningPoint: "",
      cliffhanger: "",
      beats: [],
      validationIssues: [],
      characters: [],
      scenes: [],
      props: ["玉佩", "一次性纸巾"],
    },
  ];

  const pruned = pruneSingleUseProps(episodes);
  assert.deepEqual(pruned[0]?.props, ["玉佩"]);
  assert.deepEqual(pruned[1]?.props, ["玉佩"]);
});
