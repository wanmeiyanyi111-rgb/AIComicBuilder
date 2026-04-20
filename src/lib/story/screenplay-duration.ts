import {
  SHORT_DRAMA_MAX_DURATION_SEC,
  SHORT_DRAMA_MIN_DURATION_SEC,
  SHORT_DRAMA_TARGET_DURATION_SEC,
} from "./short-drama";

export type ScreenplayDurationStatus = "short" | "ok" | "long";

export type ScreenplayDurationReview = {
  estimatedDurationSec: number;
  targetDurationSec: number;
  status: ScreenplayDurationStatus;
  notes: string[];
  sceneCount: number;
  dialogueLineCount: number;
  actionParagraphCount: number;
  dialogueDurationSec: number;
  actionDurationSec: number;
  transitionDurationSec: number;
  pauseDurationSec: number;
};

type ScreenplayDurationOptions = {
  targetDurationSec?: number;
  durationMinSec?: number;
  durationMaxSec?: number;
};

const SCENE_HEADER_RE = /^[\s*#-]*(?:场景|scene)\s*\d+/i;
const SECTION_HEADER_RE = /^(?:={3,}|视觉风格|角色描述|场景|visual style|characters)(?:\b|$)/i;
const INLINE_DIALOGUE_RE = /^([^：:\n]{1,18})[：:]\s*(.+)$/u;
const QUOTED_DIALOGUE_RE = /^[“"「『].+[”"」』]$/u;
const SPEAKER_LINE_RE = /^[\p{L}\p{N}·・\-_ ]{1,18}$/u;
const ACTION_KEYWORD_RE =
  /走|跑|冲|扑|追|打|撞|摔|握|抬|转身|逼近|后退|推开|拉住|跪|站起|冲出|停住|凝视|fight|run|rush|grab|push|pull|turn|stare|fall/gi;

function cleanLine(line: string): string {
  return line.replace(/^[>\-*#\s]+/, "").trim();
}

function countSpeechUnits(text: string): number {
  const cjkCount =
    text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)?.length || 0;
  const latinWordCount =
    text
      .replace(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, " ")
      .match(/[A-Za-z0-9']+/g)?.length || 0;
  return cjkCount + latinWordCount * 2;
}

function countSentences(text: string): number {
  const matches = text.match(/[。！？.!?；;]+/g)?.length || 0;
  return Math.max(1, matches || (text.trim() ? 1 : 0));
}

function countPunctuationPauses(text: string): number {
  const punctuation = text.match(/[，,、；;：:“”"'？！!?]/g)?.length || 0;
  const ellipsis = text.match(/…{2,}|\.{3,}/g)?.length || 0;
  return punctuation + ellipsis * 2;
}

function extractDialogueText(
  line: string,
  nextLine: string
): { text: string; consumeNextLine: boolean } | null {
  const inlineMatch = line.match(INLINE_DIALOGUE_RE);
  if (
    inlineMatch &&
    !SCENE_HEADER_RE.test(line) &&
    !SECTION_HEADER_RE.test(line)
  ) {
    const text = inlineMatch[2]?.trim();
    if (text) {
      return { text, consumeNextLine: false };
    }
  }

  if (SPEAKER_LINE_RE.test(line) && QUOTED_DIALOGUE_RE.test(nextLine)) {
    return {
      text: nextLine.replace(/^[“"「『]|[”"」』]$/g, "").trim(),
      consumeNextLine: true,
    };
  }

  if (QUOTED_DIALOGUE_RE.test(line)) {
    return {
      text: line.replace(/^[“"「『]|[”"」』]$/g, "").trim(),
      consumeNextLine: false,
    };
  }

  return null;
}

export function estimateScreenplayDuration(
  script: string,
  options: ScreenplayDurationOptions = {}
): ScreenplayDurationReview {
  const targetDurationSec = Math.max(
    1,
    Math.round(options.targetDurationSec || SHORT_DRAMA_TARGET_DURATION_SEC)
  );
  const durationMinSec = Math.max(
    1,
    Math.round(options.durationMinSec || SHORT_DRAMA_MIN_DURATION_SEC)
  );
  const durationMaxSec = Math.max(
    durationMinSec,
    Math.round(options.durationMaxSec || SHORT_DRAMA_MAX_DURATION_SEC)
  );

  const lines = script
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  let sceneCount = 0;
  let dialogueLineCount = 0;
  let actionParagraphCount = 0;
  let dialogueDurationSec = 0;
  let actionDurationSec = 0;
  let pauseDurationSec = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const nextLine = lines[index + 1] || "";

    if (SCENE_HEADER_RE.test(line)) {
      sceneCount += 1;
      continue;
    }

    if (SECTION_HEADER_RE.test(line)) {
      continue;
    }

    const dialogue = extractDialogueText(line, nextLine);
    if (dialogue?.text) {
      dialogueLineCount += 1;
      const speechUnits = countSpeechUnits(dialogue.text);
      const punctuationPauseCount = countPunctuationPauses(dialogue.text);
      dialogueDurationSec += speechUnits / 4.6 + punctuationPauseCount * 0.18 + 0.8;
      pauseDurationSec += punctuationPauseCount * 0.08;
      if (dialogue.consumeNextLine) {
        index += 1;
      }
      continue;
    }

    actionParagraphCount += 1;
    const sentences = countSentences(line);
    const actionKeywordCount = line.match(ACTION_KEYWORD_RE)?.length || 0;
    const visualDensity = Math.min(8, Math.round(line.length / 28));
    actionDurationSec +=
      sentences * 2.4 + visualDensity * 0.55 + actionKeywordCount * 0.35;
    pauseDurationSec += Math.min(1.2, countPunctuationPauses(line) * 0.05);
  }

  if (sceneCount === 0) {
    sceneCount = Math.max(
      1,
      Math.round((actionParagraphCount + dialogueLineCount) / 6)
    );
  }

  const transitionDurationSec = Math.max(0, sceneCount - 1) * 1.4;
  const estimatedDurationSec = Math.max(
    60,
    Math.min(
      360,
      Math.round(
        dialogueDurationSec +
          actionDurationSec +
          transitionDurationSec +
          pauseDurationSec
      )
    )
  );

  let status: ScreenplayDurationStatus = "ok";
  if (estimatedDurationSec < durationMinSec) {
    status = "short";
  } else if (estimatedDurationSec > durationMaxSec) {
    status = "long";
  }

  const notes: string[] = [];
  if (status === "short") {
    notes.push(
      `剧本文本复核约 ${estimatedDurationSec}s，低于目标区间 ${durationMinSec}-${durationMaxSec}s，建议补强关键推进、反应镜头或对白支撑。`
    );
  } else if (status === "long") {
    notes.push(
      `剧本文本复核约 ${estimatedDurationSec}s，高于目标区间 ${durationMinSec}-${durationMaxSec}s，建议压缩慢段落，或在分镜阶段拆成更多连续小镜头。`
    );
  } else {
    notes.push(
      `剧本文本复核约 ${estimatedDurationSec}s，基本落在目标区间内，可据此分配镜头预算。`
    );
  }

  if (sceneCount <= 2) {
    notes.push("场景数量偏少，注意检查是否存在单场戏承载过多剧情的问题。");
  }

  if (dialogueLineCount > 0) {
    const averageDialogueSec = dialogueDurationSec / dialogueLineCount;
    if (averageDialogueSec > 4.8) {
      notes.push("对白平均时长偏长，视频阶段需要避免把过长台词塞进单一镜头。");
    }
  }

  if (actionParagraphCount <= 4) {
    notes.push("动作段落偏少，若需要更强短剧节奏，可在剧本中补足视觉反应与动作推进。");
  }

  return {
    estimatedDurationSec,
    targetDurationSec,
    status,
    notes: notes.slice(0, 4),
    sceneCount,
    dialogueLineCount,
    actionParagraphCount,
    dialogueDurationSec: Math.round(dialogueDurationSec),
    actionDurationSec: Math.round(actionDurationSec),
    transitionDurationSec: Math.round(transitionDurationSec),
    pauseDurationSec: Math.round(pauseDurationSec),
  };
}
