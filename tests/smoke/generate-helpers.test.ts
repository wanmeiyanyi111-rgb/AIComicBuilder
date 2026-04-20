import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVisualStyleFromScript,
  buildSensitiveInputImageErrorMessage,
  extractErrorMessage,
  extractVideoErrorMessage,
  getDirectorControlFromPayload,
  isSensitiveInputImageError,
  ratioToImageOpts,
} from "../../src/app/api/projects/[id]/generate/helpers";

test("ratioToImageOpts returns expected presets", () => {
  assert.deepEqual(ratioToImageOpts("16:9"), { aspectRatio: "16:9", size: "2560x1440" });
  assert.deepEqual(ratioToImageOpts("9:16"), { aspectRatio: "9:16", size: "1440x2560" });
  assert.deepEqual(ratioToImageOpts("1:1"), { aspectRatio: "1:1", size: "2048x2048" });
});

test("ratioToImageOpts falls back to default for unknown ratio", () => {
  assert.deepEqual(ratioToImageOpts("4:3"), { aspectRatio: "16:9", size: "2560x1440" });
  assert.deepEqual(ratioToImageOpts(undefined), { aspectRatio: "16:9", size: "2560x1440" });
});

test("buildVisualStyleFromScript extracts machine-readable style block", () => {
  const script = [
    "视觉风格：国风奇幻写意",
    "色彩基调: 冷暖对比",
    "时代美学：唐风",
    "氛围情绪: 宿命感",
    "画幅比例：16:9",
  ].join("\n");

  assert.equal(
    buildVisualStyleFromScript(script),
    "国风奇幻写意；色彩基调：冷暖对比；时代美学：唐风；氛围情绪：宿命感；画幅比例：16:9"
  );
});

test("buildVisualStyleFromScript supports english visual style label", () => {
  const script = ["Visual Style: retro noir", "画幅比例：2.35:1"].join("\n");

  assert.equal(buildVisualStyleFromScript(script), "retro noir；画幅比例：2.35:1");
});

test("extractErrorMessage parses provider JSON embedded after prefix text", () => {
  const err = new Error(
    'Seedance submit failed: 400 {"error":{"code":"InvalidParameter","message":"duration not valid"}}'
  );
  assert.equal(extractErrorMessage(err), "duration not valid");
});

test("sensitive input image errors are detected from code and message", () => {
  const err = new Error(
    'Seedance submit failed: 400 {"error":{"code":"InputImageSensitiveContentDetected","message":"The request failed because the input image may contain sensitive information."}}'
  );
  assert.equal(isSensitiveInputImageError(err), true);
  assert.match(
    buildSensitiveInputImageErrorMessage(err),
    /输入参考图可能包含敏感内容/
  );
  assert.match(
    extractVideoErrorMessage(err),
    /输入参考图可能包含敏感内容/
  );
});

test("getDirectorControlFromPayload parses numbers and falls back safely", () => {
  assert.deepEqual(getDirectorControlFromPayload(undefined), {
    actionIntensity: 50,
    cameraMotion: 50,
    emotionIntensity: 50,
  });

  assert.deepEqual(
    getDirectorControlFromPayload({
      directorControl: {
        actionIntensity: "88",
        cameraMotion: 40,
        emotionIntensity: "not-a-number",
      },
    }),
    {
      actionIntensity: 88,
      cameraMotion: 40,
      emotionIntensity: 50,
    }
  );
});
