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

