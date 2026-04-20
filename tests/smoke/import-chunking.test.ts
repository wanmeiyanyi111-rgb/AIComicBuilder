import test from "node:test";
import assert from "node:assert/strict";
import { chunkTextByLimit } from "../../src/lib/import-utils";

test("chunkTextByLimit splits long txt-style text with only single newlines", () => {
  const text = Array.from({ length: 220 }, (_, index) =>
    `第${index + 1}段 她站在走廊尽头，看着那扇门缓缓打开，所有秘密都像潮水一样涌了出来。`
  ).join("\n");

  const chunks = chunkTextByLimit(text, 500);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 500));
});

test("chunkTextByLimit splits a giant paragraph by sentence before hard slicing", () => {
  const text =
    "订婚宴开始前，她收到匿名短信。".repeat(120) +
    "她转身看向门口，却看见本该死去的人出现了。".repeat(120);

  const chunks = chunkTextByLimit(text, 420);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 420));
});
