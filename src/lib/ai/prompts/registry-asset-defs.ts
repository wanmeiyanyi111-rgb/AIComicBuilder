import { themeStyleMappingBlock } from "./blocks";
import type { PromptDefinition } from "./registry-core";
import { slot, resolve } from "./registry-core";

const SCENE_PROP_EXTRACT_ROLE_DEFINITION = `你是一位资深电影美术指导与场景设定师。你的任务是从剧本中提取可用于视觉生产的场景与道具候选清单，为后续生图流水线提供可直接执行的结构化输入。`;

const SCENE_PROP_EXTRACT_RULES = `规则：
1. 仅提取与视觉制作直接相关的内容，不要输出剧情解说。
2. 场景（scene）必须是“物理地点/空间环境”，例如“废弃地铁站月台”“古寺主殿内庭”。
3. 道具（prop）必须是“可单独成图的具体物件”，例如“裂纹青铜令牌”“折叠式侦察无人机”。
4. 场景描述里禁止人物描写；道具描述里禁止人物肢体与穿戴态。
5. 对每一项生成可直接用于生图的 prompt，必须包含材质、结构、光线、色彩或时代语境等关键信息。
6. 每条 prompt 必须显式体现项目风格信息（画风 + 光照 + 色彩），不能只写“物体名+地点名”。
7. 场景 prompt 必须包含镜头语言（至少写出景别/机位/镜头焦段其二），例如“广角全景、低机位、35mm”等；道具 prompt 至少给出拍摄构图与机位（如“居中平视特写、50mm产品质感”）。
8. 名称简洁（4-12字优先），prompt 具体可执行，避免空泛词语。
9. 若剧本未明确说明，可依据上下文做最小必要推断，但不得杜撰关键设定。
10. 道具只保留“反复出现、持续复用、推动剧情、作为证据/象征物/关键机关”的对象；一次性出现的普通小物件、临时餐具、普通桌面杂物、只路过一次的环境陈设不要输出。
11. 如果某个道具只在单一瞬间被提到一次，且后续不再使用、也不承担剧情功能，默认不要进入 props。`;

const SCENE_PROP_EXTRACT_OUTPUT_FORMAT = `仅输出 JSON 对象，不要 markdown，不要解释文字：
{
  "scenes": [
    {
      "name": "场景名",
      "prompt": "用于生图的场景提示词（纯环境，不含人物）"
    }
  ],
  "props": [
    {
      "name": "道具名",
      "prompt": "用于生图的道具提示词（单体道具，不含人物，白底可抠图）"
    }
  ]
}

输出硬约束：
- scenes / props 均可为空数组，但必须存在
- name 与 prompt 必须是字符串
- 不得输出多余字段`;

const SCENE_PROP_EXTRACT_LANGUAGE_RULES = `【关键语言规则】使用与输入剧本一致的语言输出字段内容。中文输入→中文输出，英文输入→英文输出。仅返回 JSON。`;

const scenePropExtractDef: PromptDefinition = {
  key: "scene_prop_extract",
  nameKey: "promptTemplates.prompts.scenePropExtract",
  descriptionKey: "promptTemplates.prompts.scenePropExtractDesc",
  category: "frame",
  slots: [
    slot("role_definition", SCENE_PROP_EXTRACT_ROLE_DEFINITION, true),
    slot("extraction_rules", SCENE_PROP_EXTRACT_RULES, true),
    slot("output_format", SCENE_PROP_EXTRACT_OUTPUT_FORMAT, false),
    slot("language_rules", SCENE_PROP_EXTRACT_LANGUAGE_RULES, false),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [r("role_definition"), "", r("extraction_rules"), "", r("output_format"), "", r("language_rules")].join("\n");
  },
};

// ─── 8. scene_image ─────────────────────────────────────

const SCENE_IMAGE_STYLE_MATCHING = `=== 场景画风匹配（最高优先级）===
你必须严格继承项目整体风格，并与同项目其他镜头保持统一世界观与美术语言。
若项目给定了时代、美术方向、色彩基调，必须全部执行。
- 若项目风格为 cinematic_realism 或描述中包含"电影级写实/实拍/photorealistic"，必须按写实电影摄影渲染，禁止 2.5D 与卡通化边缘。

${themeStyleMappingBlock()}`;

const SCENE_IMAGE_COMPOSITION_RULES = `=== 场景构图规则 ===
- 输出纯环境场景图，不得出现人物、角色、人体部位、背影、剪影、人形轮廓、服装被穿戴状态
- 重点刻画空间层次（前景/中景/远景）、建筑结构、材质细节、光线走向与氛围
- 允许出现静态环境道具（桌椅、门窗、旗帜、车辆等），但这些是空间元素，不是角色
- 画面需具备电影镜头感（景别、机位、透视关系明确）`;

const SCENE_IMAGE_RENDERING = `=== 渲染与光照 ===
- 画面质量高，材质真实可信（木、金属、石材、布料、玻璃等）
- 光源方向明确，避免“平光无层次”
- 色彩与项目风格一致，保证系列化统一
- 不出现文字、水印、LOGO`;

const SCENE_IMAGE_RULES = `=== 禁止项（硬约束）===
- 禁止任何人物或人形元素
- 禁止角色名称、对白字幕、UI 覆盖层
- 禁止把道具特写当作“场景全图”输出（需要完整空间语义）`;

const sceneImageDef: PromptDefinition = {
  key: "scene_image",
  nameKey: "promptTemplates.prompts.sceneImage",
  descriptionKey: "promptTemplates.prompts.sceneImageDesc",
  category: "frame",
  slots: [
    slot("style_matching", SCENE_IMAGE_STYLE_MATCHING, true),
    slot("composition_rules", SCENE_IMAGE_COMPOSITION_RULES, true),
    slot("lighting_rendering", SCENE_IMAGE_RENDERING, true),
    slot("rules", SCENE_IMAGE_RULES, true),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    const name = (params?.name as string) ?? "";
    const basePrompt = (params?.basePrompt as string) ?? "";
    const projectStyle = (params?.projectStyle as string) ?? "";

    return [
      "你正在生成一张专业场景设定图（scene concept frame）。",
      "",
      r("style_matching"),
      "",
      r("composition_rules"),
      "",
      r("lighting_rendering"),
      "",
      r("rules"),
      "",
      "=== 场景需求输入 ===",
      `场景名：${name || "未命名场景"}`,
      `场景描述：${basePrompt}`,
      projectStyle ? `项目风格补充：${projectStyle}` : "",
      "",
      "最终要求：仅输出环境场景，不出现任何人物、人体部位、角色剪影、文字或水印。",
    ]
      .filter(Boolean)
      .join("\n");
  },
};

// ─── 9. prop_image ──────────────────────────────────────

const PROP_IMAGE_STYLE_MATCHING = `=== 道具画风匹配（最高优先级）===
道具的材质语言、工艺细节和配色必须与项目整体美术风格一致。
同项目道具需要具有系列一致性（不是随机风格拼贴）。
- 若项目风格为 cinematic_realism 或提示词包含电影级写实语义，道具必须遵循写实摄影/写实CG电影材质，不可出现 2.5D 卡通化处理。

${themeStyleMappingBlock()}`;

const PROP_IMAGE_COMPOSITION_RULES = `=== 道具构图规则 ===
- 单一道具主体，主体完整可见，不被裁切
- 纯白背景（#FFFFFF），方便抠图复用
- 不出现人物、手持、穿戴态、人体部位、角色剪影
- 道具应居中或稳定构图，边缘清晰，轮廓完整`;

const PROP_IMAGE_RENDERING = `=== 渲染与材质 ===
- 明确材质类型（金属/木质/皮革/织物/塑料/能量体等）和做旧程度
- 细节可读：结构、接缝、磨损、刻纹、机关、按钮等
- 光照均匀且能体现体积，不可脏污发灰
- 不出现文字、水印、LOGO`;

const PROP_IMAGE_RULES = `=== 禁止项（硬约束）===
- 禁止多人或多主体拼盘
- 禁止复杂环境背景（必须白底）
- 禁止把道具画成“角色正在使用中的画面”
- 禁止字幕、品牌字样、参数面板`;

const propImageDef: PromptDefinition = {
  key: "prop_image",
  nameKey: "promptTemplates.prompts.propImage",
  descriptionKey: "promptTemplates.prompts.propImageDesc",
  category: "frame",
  slots: [
    slot("style_matching", PROP_IMAGE_STYLE_MATCHING, true),
    slot("composition_rules", PROP_IMAGE_COMPOSITION_RULES, true),
    slot("lighting_rendering", PROP_IMAGE_RENDERING, true),
    slot("rules", PROP_IMAGE_RULES, true),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    const name = (params?.name as string) ?? "";
    const basePrompt = (params?.basePrompt as string) ?? "";
    const projectStyle = (params?.projectStyle as string) ?? "";

    return [
      "你正在生成一张专业道具设定图（prop design sheet, single object）。",
      "",
      r("style_matching"),
      "",
      r("composition_rules"),
      "",
      r("lighting_rendering"),
      "",
      r("rules"),
      "",
      "=== 道具需求输入 ===",
      `道具名：${name || "未命名道具"}`,
      `道具描述：${basePrompt}`,
      projectStyle ? `项目风格补充：${projectStyle}` : "",
      "",
      "最终要求：单主体道具 + 纯白背景，不出现人物或人体部位。",
    ]
      .filter(Boolean)
      .join("\n");
  },
};

export {
  propImageDef,
  sceneImageDef,
  scenePropExtractDef,
};

// ─── 7. shot_split ──────────────────────────────────────
