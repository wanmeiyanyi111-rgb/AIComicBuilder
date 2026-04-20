import test from "node:test";
import assert from "node:assert/strict";
import { extractJSON } from "../../src/lib/ai/ai-sdk";

test("extracts fenced json payload", () => {
  const raw = '```json\n{"ok":true,"items":[1,2,3]}\n```';
  assert.equal(extractJSON(raw), '{"ok":true,"items":[1,2,3]}');
});

test("keeps plain json untouched", () => {
  const raw = '{"message":"hello"}';
  assert.equal(extractJSON(raw), raw);
});

test("removes disallowed control characters", () => {
  const raw = "{\u0001\"ok\":true}";
  assert.equal(extractJSON(raw), '{"ok":true}');
});

test("extracts json object from leading and trailing prose", () => {
  const raw = '下面是结果：\n{"ok":true,"items":[1,2,3]}\n以上为最终答案';
  assert.equal(extractJSON(raw), '{"ok":true,"items":[1,2,3]}');
});

test("extracts json array from wrapped prose", () => {
  const raw = 'result:\n[{"name":"A"},{"name":"B"}]\nend';
  assert.equal(extractJSON(raw), '[{"name":"A"},{"name":"B"}]');
});
