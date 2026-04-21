import test from "node:test";
import assert from "node:assert/strict";
import {
  matchDialogueCharacter,
  normalizeDialogueSpeaker,
} from "../../src/lib/dialogue-character-match";

const characters = [
  { id: "1", name: "苏晚" },
  { id: "2", name: "陆沉舟" },
];

test("normalizeDialogueSpeaker removes wrapper notes and punctuation", () => {
  assert.equal(normalizeDialogueSpeaker("苏晚（哽咽）"), "苏晚");
  assert.equal(normalizeDialogueSpeaker("角色: 陆沉舟"), "陆沉舟");
});

test("matchDialogueCharacter matches exact speaker name", () => {
  assert.equal(matchDialogueCharacter("苏晚", characters)?.id, "1");
});

test("matchDialogueCharacter matches speaker name with notes", () => {
  assert.equal(matchDialogueCharacter("陆沉舟（压低声音）", characters)?.id, "2");
});

test("matchDialogueCharacter matches longer speaker string containing name", () => {
  assert.equal(matchDialogueCharacter("陆沉舟总裁", characters)?.id, "2");
});
