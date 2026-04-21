type CharacterLike = {
  id: string;
  name: string;
};

function stripWrapperNotes(value: string): string {
  return value
    .replace(/[（(][^()（）]{0,24}[）)]/g, "")
    .replace(/[【\[][^【\]]{0,24}[】\]]/g, "");
}

function stripSpeakerPrefixes(value: string): string {
  return value
    .replace(/^(?:角色|人物|说话人|发言者|speaker|character)\s*[:：-]\s*/i, "")
    .replace(/\s+/g, "")
    .trim();
}

export function normalizeDialogueSpeaker(value: string): string {
  return stripSpeakerPrefixes(stripWrapperNotes(String(value || "")))
    .toLowerCase()
    .replace(/[""'`“”‘’]+/g, "")
    .replace(/[：:，,。.!！？?、；;·•\-_\\/|]/g, "")
    .trim();
}

export function matchDialogueCharacter<T extends CharacterLike>(
  speaker: string,
  characters: T[]
): T | null {
  const normalizedSpeaker = normalizeDialogueSpeaker(speaker);
  if (!normalizedSpeaker) return null;

  const exact = characters.find(
    (character) => normalizeDialogueSpeaker(character.name) === normalizedSpeaker
  );
  if (exact) return exact;

  const partialMatches = characters.filter((character) => {
    const normalizedName = normalizeDialogueSpeaker(character.name);
    return (
      normalizedName.length > 0 &&
      (normalizedSpeaker.includes(normalizedName) || normalizedName.includes(normalizedSpeaker))
    );
  });

  if (partialMatches.length === 1) return partialMatches[0];

  if (partialMatches.length > 1) {
    return partialMatches.sort(
      (left, right) =>
        normalizeDialogueSpeaker(right.name).length -
        normalizeDialogueSpeaker(left.name).length
    )[0];
  }

  return null;
}
