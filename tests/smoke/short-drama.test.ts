import test from "node:test";
import assert from "node:assert/strict";
import {
  SHORT_DRAMA_MAX_DURATION_SEC,
  SHORT_DRAMA_MIN_DURATION_SEC,
  SHORT_DRAMA_TARGET_DURATION_SEC,
  buildShortDramaShotBudget,
  buildShortDramaPlanContext,
  estimateShortDramaDuration,
  validateShortDramaEpisode,
  type ShortDramaEpisodePlan,
} from "../../src/lib/story/short-drama";
import { estimateScreenplayDuration } from "../../src/lib/story/screenplay-duration";

function buildValidEpisode(): ShortDramaEpisodePlan {
  return {
    title: "第1集：血书来信",
    description: "订婚夜，一封血书撕开真相。",
    keywords: "悬疑,豪门,反转",
    idea: "女主在订婚夜收到匿名血书，必须在众目睽睽之下掩饰震惊，同时追查寄信人。她一边强撑着完成仪式，一边观察未婚夫与宾客的异常反应。未婚夫表现异常，弟弟突然现身，三人关系迅速紧张。女主借口离场，在走廊里逼问弟弟，弟弟却只承认自己知道血书内容，不肯说明来源。回到宴会厅后，女主发现父亲也在暗中关注她的一举一动，血书内容更指向被掩埋多年的家族秘密，逼得她必须在下一秒做出选择。",
    storyMode: "short_drama",
    targetDurationSec: SHORT_DRAMA_TARGET_DURATION_SEC,
    durationMinSec: SHORT_DRAMA_MIN_DURATION_SEC,
    durationMaxSec: SHORT_DRAMA_MAX_DURATION_SEC,
    estimatedDurationSec: 150,
    hook: "女主在订婚仪式上收到沾血信封。",
    coreConflict: "她必须稳住场面，同时查出是谁在揭她家族旧伤。",
    turningPoint: "未婚夫的弟弟承认自己知道血书内容。",
    cliffhanger: "弟弟却说，寄信的人不是他。",
    pacingNotes: "开场即爆点，中段持续对抗，结尾反转留钩子。",
    beats: [
      { name: "hook", durationSec: 15, summary: "订婚现场收到血书" },
      { name: "setup", durationSec: 35, summary: "掩饰慌乱，稳住宾客" },
      { name: "escalation", durationSec: 55, summary: "怀疑链条逐步收紧" },
      { name: "cliffhanger", durationSec: 45, summary: "弟弟抛出更大疑点" },
    ],
    characters: ["女主", "未婚夫", "弟弟"],
    scenes: ["宴会厅", "走廊"],
    props: ["血书", "手机"],
    validationIssues: [],
  };
}

test("validateShortDramaEpisode accepts a compliant short-drama episode", () => {
  const result = validateShortDramaEpisode(buildValidEpisode());
  assert.equal(result.pass, true);
  assert.ok(result.estimatedDurationSec >= 120);
  assert.ok(result.estimatedDurationSec <= 180);
  assert.equal(result.issues.length, 0);
});

test("validateShortDramaEpisode rejects missing cliffhanger and overlong duration", () => {
  const episode = buildValidEpisode();
  episode.cliffhanger = "";
  episode.estimatedDurationSec = 220;
  episode.beats = [
    { name: "hook", durationSec: 30, summary: "a" },
    { name: "setup", durationSec: 60, summary: "b" },
    { name: "escalation", durationSec: 70, summary: "c" },
    { name: "ending", durationSec: 60, summary: "d" },
  ];

  const result = validateShortDramaEpisode(episode);
  assert.equal(result.pass, false);
  assert.equal(result.recommendedAction, "repair");
  assert.match(
    result.issues.map((issue) => issue.message).join("；"),
    /缺少结尾悬念|不在 120-180s 内/
  );
});

test("buildShortDramaPlanContext renders key short-drama fields", () => {
  const context = buildShortDramaPlanContext(buildValidEpisode());
  assert.match(context, /短剧分集规划/);
  assert.match(context, /目标时长：150s/);
  assert.match(context, /开场钩子/);
  assert.match(context, /节奏分段/);
});

test("estimateShortDramaDuration uses content complexity, not only raw model duration", () => {
  const episode = buildValidEpisode();
  episode.estimatedDurationSec = 150;
  episode.idea = `${episode.idea} 她连续调动宴会、走廊、书房三个空间里的不同人物关系，还要应对匿名线索、家族旧案和未婚夫的试探，信息量明显偏高。`;

  const estimate = estimateShortDramaDuration(episode);
  assert.ok(estimate.estimatedDurationSec >= 140);
  assert.ok(estimate.complexityScore > 0);
});

test("buildShortDramaShotBudget creates beat-level shot targets", () => {
  const budget = buildShortDramaShotBudget(buildValidEpisode());
  assert.ok(budget);
  assert.ok((budget?.targetShotCount || 0) >= 24);
  assert.equal(budget?.beatBudgets.length, 4);
});

test("estimateScreenplayDuration reviews screenplay text with dialogue and action", () => {
  const script = `
场景 1 — 内景. 宴会厅 — 夜
林晚宁：今天所有人都看着我，我不能在这一步露出破绽。
沈曜：你到底收到了什么？
林晚宁：别碰那封信，我还没有想清楚。

场景 2 — 内景. 走廊 — 夜
林晚宁快步冲出宴会厅，攥紧沾血的信封，停在昏暗走廊尽头。她反复确认信上的每一个名字，脑海里闪回旧案细节。沈曜追上来，试图夺信，两人爆发激烈争执。林晚宁后退、转身、再逼近，情绪一层层顶上来，直到她终于说出自己怀疑父亲的理由。`;
  const review = estimateScreenplayDuration(script, {
    targetDurationSec: 150,
    durationMinSec: 120,
    durationMaxSec: 180,
  });

  assert.ok(review.estimatedDurationSec >= 60);
  assert.ok(review.sceneCount >= 2);
  assert.ok(review.dialogueLineCount >= 3);
  assert.ok(review.actionParagraphCount >= 1);
});

test("buildShortDramaShotBudget prefers reviewed screenplay duration when present", () => {
  const budget = buildShortDramaShotBudget({
    ...buildValidEpisode(),
    scriptEstimatedDurationSec: 178,
    scriptDurationStatus: "long",
    scriptDurationNotes: ["剧情推进偏满"],
  });

  assert.ok(budget);
  assert.ok((budget?.targetShotCount || 0) >= 40);
  assert.ok((budget?.averageShotDurationSec || 0) >= 4);
  assert.ok((budget?.averageShotDurationSec || 0) <= 7);
  assert.ok(
    (budget?.beatBudgets || []).every(
      (item) => item.suggestedShotDurationSec >= 4 && item.suggestedShotDurationSec <= 7
    )
  );
});
