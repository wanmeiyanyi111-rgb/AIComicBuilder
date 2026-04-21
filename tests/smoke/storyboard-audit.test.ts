import test from "node:test";
import assert from "node:assert/strict";
import {
  auditStoryboardPromptPayload,
  buildStoryboardAuditRevisionHints,
} from "../../src/app/api/projects/[id]/generate/handlers/storyboard-audit";
import type { StoryboardPromptPayload } from "../../src/app/api/projects/[id]/generate/handlers/storyboard-utils";

function makePayload(overrides?: Partial<StoryboardPromptPayload>): StoryboardPromptPayload {
  return {
    shotSequence: 1,
    storyGoal: "男人冲向窗边试图拉住坠落的女人",
    primaryScene: "酒店顶层外墙窗边",
    progressionMode: "action_progression",
    modeRationale: "镜头核心是高空失足与伸手救援，动作推进最强。",
    sceneCount: 1,
    eventCount: 1,
    complexityLevel: "low",
    startingAction: "女人失足滑出窗框",
    endingAction: "男人探身伸手但仍差一步",
    continuityBeats: ["女人外滑", "男人靠近窗边", "双方接近失之交臂"],
    microDynamics: ["风压拉扯裙摆", "室内吊灯暖光映在玻璃边缘"],
    continuityRules: {
      locationLocked: true,
      timeContinuous: true,
      sameCharacterDesign: true,
      samePropSet: true,
      cameraAxisLocked: true,
    },
    characters: ["莉亚", "男人"],
    panels: [
      {
        index: 1,
        stage: "setup",
        beat: "建立局面",
        panelFunction: "建立危险关系与空间高度",
        activeCharacters: ["莉亚", "男人"],
        forbiddenDrift: ["不能丢失任一主角", "不能变成单人海报", "不能复制后续格构图"],
        resultSignal: "establishing_state",
        cameraPlan: "push_in",
        shotScale: "wide",
        subjectPosition: "女人悬在画面左侧窗外，男人在室内中后景",
        bodyFacing: "女人朝右侧外墙滑落，男人朝左前方窗边",
        gazeTarget: "彼此",
        interactionState: "尚未接触",
        worldLock: ["窗框在画面右侧", "城市夜景在背景下方", "室内吊灯暖光"],
        continuityGoal: "建立两人相对位置与危险距离",
        mustKeep: ["女人白裙", "酒店窗框", "城市夜景"],
        delta: "建立初始危险状态",
        prompt: "panel1",
      },
      {
        index: 2,
        stage: "development",
        beat: "动作推进",
        panelFunction: "让两人距离缩短但仍未接触",
        activeCharacters: ["莉亚", "男人"],
        forbiddenDrift: ["不能丢失任一主角", "不能改变窗内外空间关系", "不能与第1格构图完全相同"],
        resultSignal: "development_state",
        cameraPlan: "push_in",
        shotScale: "medium",
        subjectPosition: "女人继续沿外墙下滑半步，男人逼近窗边",
        bodyFacing: "女人仍朝右侧外墙，男人仍朝左前方伸身",
        gazeTarget: "彼此",
        interactionState: "正在靠近",
        worldLock: ["窗框在画面右侧", "城市夜景在背景下方", "室内吊灯暖光"],
        continuityGoal: "把距离缩短到可伸手的程度",
        mustKeep: ["女人白裙", "酒店窗框", "城市夜景"],
        delta: "男人向前探出上身",
        prompt: "panel2",
      },
      {
        index: 3,
        stage: "escalation",
        beat: "变化升级或冲突显现",
        panelFunction: "把接触推到几乎发生的峰值",
        activeCharacters: ["莉亚", "男人"],
        forbiddenDrift: ["不能新增第三人", "不能改成正反打室内双人照", "不能丢失窗外坠落关系"],
        resultSignal: "escalation_peak",
        cameraPlan: "push_in",
        shotScale: "close",
        subjectPosition: "两人的手几乎在画面中部接触",
        bodyFacing: "两人保持原有朝向仅轻微扭转",
        gazeTarget: "即将接触的手",
        interactionState: "几乎接触",
        worldLock: ["窗框在画面右侧", "城市夜景在背景下方", "室内吊灯暖光"],
        continuityGoal: "把冲突推到几乎触碰的峰值",
        mustKeep: ["女人白裙", "酒店窗框", "城市夜景"],
        delta: "距离被压到只差一步",
        prompt: "panel3",
      },
      {
        index: 4,
        stage: "outcome",
        beat: "阶段结果或悬念停点",
        panelFunction: "给出失之交臂后的悬念停顿",
        activeCharacters: ["莉亚", "男人"],
        forbiddenDrift: ["不能让两人已经接触成功", "不能改成新场景", "不能回退成中间动作态"],
        resultSignal: "suspense_hold",
        cameraPlan: "push_in",
        shotScale: "close",
        subjectPosition: "女人继续下坠一点，男人手臂停在画面右上前景",
        bodyFacing: "保持原有朝向",
        gazeTarget: "落空的手与对方",
        interactionState: "失之交臂后的悬念停顿",
        worldLock: ["窗框在画面右侧", "城市夜景在背景下方", "室内吊灯暖光"],
        continuityGoal: "形成稳定的悬念尾锚点",
        mustKeep: ["女人白裙", "酒店窗框", "城市夜景"],
        delta: "给出失之交臂的阶段结果并稳定停顿",
        prompt: "panel4",
      },
    ],
    ...overrides,
  };
}

test("auditStoryboardPromptPayload passes stable continuous storyboard payload", () => {
  const result = auditStoryboardPromptPayload(makePayload());
  assert.equal(result.pass, true);
  assert.equal(result.issues.length, 0);
  assert.equal(result.score, 100);
});

test("auditStoryboardPromptPayload catches camera/scale/world-lock breaks", () => {
  const payload = makePayload();
  payload.panels[1].cameraPlan = "orbit";
  payload.panels[2].shotScale = "extreme_close";
  payload.panels[3].worldLock = ["雨夜码头", "背后霓虹牌"];

  const result = auditStoryboardPromptPayload(payload);
  assert.equal(result.pass, false);
  assert.ok(result.issues.some((item) => item.message.includes("镜头主路径")));
  assert.ok(result.issues.some((item) => item.message.includes("景别跳变过大")));
  assert.ok(result.issues.some((item) => item.message.includes("worldLock")));
  assert.match(buildStoryboardAuditRevisionHints(result), /修复要求/);
});

test("auditStoryboardPromptPayload allows non-action progression when relation beats change", () => {
  const payload = makePayload({
    progressionMode: "dialogue_exchange",
    modeRationale: "这个镜头核心是对峙与信息交换，不是身体动作连续冲刺。",
  });
  payload.panels[0].subjectPosition = "两人隔着窗框对峙，位置基本固定";
  payload.panels[1].subjectPosition = "两人仍隔着窗框对峙，位置基本固定";
  payload.panels[2].subjectPosition = "男人探身，女人在外墙边缘停住，空间距离基本不变";
  payload.panels[3].subjectPosition = "两人手势逼近但仍未打破窗框分隔";
  payload.panels[0].interactionState = "互相试探";
  payload.panels[1].interactionState = "语言压迫加深";
  payload.panels[2].interactionState = "关系进入失衡边缘";
  payload.panels[3].interactionState = "对峙停在悬念结果";
  payload.panels[0].gazeTarget = "彼此";
  payload.panels[1].gazeTarget = "男人手中的证据";
  payload.panels[2].gazeTarget = "对方伸出的手";
  payload.panels[3].gazeTarget = "彼此与即将触碰的边界";

  const result = auditStoryboardPromptPayload(payload);
  assert.equal(result.pass, true);
});

test("auditStoryboardPromptPayload catches character drift across panels", () => {
  const payload = makePayload();
  payload.panels[2].activeCharacters = ["陌生女人"];

  const result = auditStoryboardPromptPayload(payload);
  assert.equal(result.pass, false);
  assert.ok(result.issues.some((item) => item.message.includes("未在全局角色表")));
});

test("auditStoryboardPromptPayload catches invalid panel4 result signal", () => {
  const payload = makePayload();
  payload.panels[3].resultSignal = "development_state";

  const result = auditStoryboardPromptPayload(payload);
  assert.equal(result.pass, false);
  assert.ok(result.issues.some((item) => item.message.includes("resultSignal")));
});

test("auditStoryboardPromptPayload catches weak forbidden drift", () => {
  const payload = makePayload();
  payload.panels[1].forbiddenDrift = ["不要漂移"];

  const result = auditStoryboardPromptPayload(payload);
  assert.equal(result.pass, false);
  assert.ok(result.issues.some((item) => item.message.includes("forbiddenDrift")));
});
