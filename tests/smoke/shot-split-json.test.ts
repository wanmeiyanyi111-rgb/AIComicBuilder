import test from "node:test";
import assert from "node:assert/strict";
import { parseShotSplitPayload } from "../../src/lib/shot-split-json";

test("parseShotSplitPayload parses flat wrapped shots", () => {
  const raw = JSON.stringify({
    shots: [
      {
        sequence: 1,
        sceneDescription: "宴会厅对峙",
        startFrame: "女主站在红毯尽头",
        endFrame: "男主抬手拦住她",
        motionScript: "慢推近到对峙特写",
        duration: 4,
        dialogues: [{ character: "苏晚晚", text: "你终于肯演不下去了？" }],
      },
    ],
  });

  const shots = parseShotSplitPayload(raw);
  assert.equal(shots.length, 1);
  assert.equal(shots[0]?.sceneDescription, "宴会厅对峙");
});

test("parseShotSplitPayload parses scene-grouped arrays", () => {
  const raw = JSON.stringify([
    {
      sceneTitle: "场景1",
      sceneDescription: "豪华酒店顶层宴会厅",
      shots: [
        {
          sequence: 1,
          startFrame: "订婚宴全景",
          endFrame: "女主抬眼看向镜头",
          motionScript: "广角缓慢推进",
          duration: 5,
          dialogues: [],
        },
      ],
    },
  ]);

  const shots = parseShotSplitPayload(raw);
  assert.equal(shots.length, 1);
  assert.equal(shots[0]?.sceneDescription, "豪华酒店顶层宴会厅");
});

test("parseShotSplitPayload extracts JSON from surrounding prose", () => {
  const raw = `下面是分镜结果，请直接采用：\n${JSON.stringify({
    result: {
      shots: [
        {
          sequence: 2,
          sceneDescription: "走廊追逐",
          startFrame: "男主冲出房门",
          endFrame: "女主回头望向他",
          motionScript: "跟拍快速前移",
          duration: 3,
          dialogues: [],
        },
      ],
    },
  })}\n谢谢。`;

  const shots = parseShotSplitPayload(raw);
  assert.equal(shots.length, 1);
  assert.equal(shots[0]?.sequence, 2);
  assert.equal(shots[0]?.sceneDescription, "走廊追逐");
});

test("parseShotSplitPayload tolerates trailing non-json content after a valid array", () => {
  const raw = `${JSON.stringify([
    {
      sequence: 1,
      sceneDescription: "高空坠落",
      startFrame: "女主刚从窗口坠落",
      endFrame: "婚纱被风完全灌满",
      motionScript: "慢镜头跟随下坠",
      duration: 4,
      dialogues: [],
    },
  ])}\n补充说明：以上为首版结果，请继续扩写。`;

  const shots = parseShotSplitPayload(raw);
  assert.equal(shots.length, 1);
  assert.equal(shots[0]?.sceneDescription, "高空坠落");
});

test("parseShotSplitPayload prefers the largest valid shot collection", () => {
  const singleShot = JSON.stringify({
    sequence: 1,
    sceneDescription: "单镜头片段",
    startFrame: "a",
    endFrame: "b",
    motionScript: "c",
    duration: 4,
    dialogues: [],
  });
  const fullArray = JSON.stringify([
    {
      sequence: 1,
      sceneDescription: "镜头一",
      startFrame: "a",
      endFrame: "b",
      motionScript: "c",
      duration: 4,
      dialogues: [],
    },
    {
      sequence: 2,
      sceneDescription: "镜头二",
      startFrame: "d",
      endFrame: "e",
      motionScript: "f",
      duration: 5,
      dialogues: [],
    },
  ]);

  const raw = `${singleShot}\n${fullArray}`;
  const shots = parseShotSplitPayload(raw);
  assert.equal(shots.length, 2);
  assert.equal(shots[1]?.sceneDescription, "镜头二");
});

test("parseShotSplitPayload recovers multiple shots from a truncated array", () => {
  const raw = `[
    {"sequence":1,"sceneDescription":"镜头一","startFrame":"a","endFrame":"b","motionScript":"c","duration":4,"dialogues":[]},
    {"sequence":2,"sceneDescription":"镜头二","startFrame":"d","endFrame":"e","motionScript":"f","duration":5,"dialogues":[]},
    {"sequence":3,"sceneDescription":"镜头三","startFrame":"g","endFrame":"h","motionScript":"i","duration":6,"dialogues":[]}
  后续内容损坏`;

  const shots = parseShotSplitPayload(raw);
  assert.equal(shots.length, 3);
  assert.equal(shots[2]?.sceneDescription, "镜头三");
});
