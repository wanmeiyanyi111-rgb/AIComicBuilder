import { languageRuleBlock } from "./blocks";
import type { PromptDefinition } from "./registry-core";
import { slot, resolve } from "./registry-core";

const VIDEO_INTERPOLATION_HEADER = `用电影导演给视频模型写“成片镜头稿”的方式，描述从首帧到尾帧之间发生的动态过程。不要使用结构化标签（"Scene:"、"Action:"），不要权重语法（"（xx：1.5）"）。把镜头当一段真正会被拍出来的画面来写，语言要让模型"看见"并"听见"。

写作要点（首尾帧插值模式）：
- 主体动作：具体的肢体运动——握紧、倾身、回头、抬手、脚步变缓、呼吸停顿；写速度与力度。
- 环境反应：世界对主体的回应——衣摆翻飞、落叶扬起、光斑掠过墙面、水面扩散的涟漪。
- 镜头运动：使用具体词——"镜头缓慢推近"/"低角度广角缓缓上摇"/"环绕摇镜快切"/"固定机位"/"希区柯克变焦"；不要"优雅地""柔和地"这种空词。
- 物理与氛围：材质细节、光影色温、音效线索（脚步声、衣料摩擦、呼吸、环境声），让模型感到"在场"。
- 写法上优先形成“建立画面 -> 推进/变换 -> 情绪捕捉 -> 收束揭示”的镜头链，不要只罗列动作。
- 若对白存在，把对白自然嵌入镜头过程；若环境音很重要，可在结尾单独补一行 【音效设计】：... 。

时长策略：
- 4-8秒：聚焦一个核心动作，不用时间戳。
- 9-12秒：2-3 段时间戳，例如 "0-4秒：…… 5-8秒：…… 9-12秒：……"
- 13-15秒：强制使用 3-4 段时间戳分镜，每段一个密集长句编织主体/环境/镜头/物理四层。

结尾禁止项（直接写入提示词最后一行）：
禁止出现水印、字幕、文字 LOGO、标识、时间码、画面边框。`;

const VIDEO_DIALOGUE_FORMAT = `对白格式（每条独立一行，放在画面描述之后）：
- 画内对白：【对白口型】角色名（视觉标识，情绪）: "台词原文"
- 画外旁白：【画外音】角色名（情绪）: "台词原文"

情绪标注是关键——让模型把口型、呼吸节奏和台词对齐。示例：
- 【对白口型】苏晚（红裙黑发，冷漠反杀）: "顾总，当初是你说，我连给你提鞋都不配。"
- 【画外音】旁白（低沉沙哑）: "那一夜，城市比雨还冷。"

音效单独一行，以 "音效：" 开头，与画面描述分开。
示例：音效：契约撕碎的脆响、宾客窃窃私语、远处低沉的背景弦乐。`;

const VIDEO_FRAME_ANCHORS = `[帧锚点]
首帧：{{START_FRAME_DESC}}
尾帧：{{END_FRAME_DESC}}`;

const videoGenerateDef: PromptDefinition = {
  key: "video_generate",
  nameKey: "promptTemplates.prompts.videoGenerate",
  descriptionKey: "promptTemplates.prompts.videoGenerateDesc",
  category: "video",
  slots: [
    slot("interpolation_header", VIDEO_INTERPOLATION_HEADER, true),
    slot("dialogue_format", VIDEO_DIALOGUE_FORMAT, true),
    slot("frame_anchors", VIDEO_FRAME_ANCHORS, true),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [
      r("interpolation_header"),
      "",
      r("dialogue_format"),
      "",
      r("frame_anchors"),
    ].join("\n");
  },
};

// ─── 11. ref_video_generate ─────────────────────────────

// Reuse the same dialogue format as video_generate (avoid duplication)
const REF_VIDEO_DIALOGUE_FORMAT = VIDEO_DIALOGUE_FORMAT;

const REF_VIDEO_CONSISTENCY_RULES = `=== 参考图一致性约束（参考图模式的核心命脉）===
生成视频时，附带的参考图是**权威视觉参考**，不是可选建议。严格执行：
- **禁止改变角色外观**：服装颜色、款式、配饰、发型、发色、脸型、体型必须与参考图完全一致。禁止在视频中途"切换造型"。
- **禁止改变环境风格**：背景色调、材质、建筑风格、光影基调必须与参考图一致。
- **允许变化的只有动态**：角色姿态、表情、肢体动作、镜头运动、环境的动态反应（摇曳、飞散、扬起等）。
- **多角色场景**：每个角色严格对应各自的参考图，禁止错配身份。
- **画风锁定**：参考图的画风就是视频的画风，不要"升级"或"风格化"成别的东西。`;

const REF_VIDEO_DURATION_STRATEGY = `=== 时长策略（Seedance 2.0）===
按镜头时长选择描述颗粒度：
- 4-8秒：一个核心动作 + 一个镜头运动 + 一个氛围细节，30-60 字单段散文。
- 9-12秒：2-3 段时间戳分镜（"0-4秒：…… 5-8秒：……"），60-120 字。
- 13-15秒：3-4 段时间戳分镜（"0-3秒 / 4-8秒 / 9-12秒 / 13-15秒"），120-200 字，每段编织"角色动作 / 环境反应 / 镜头运动 / 物理音效"四层。

镜头运动必须使用具体词："缓慢推近" / "环绕摇镜快切" / "希区柯克变焦" / "低角度广角上摇" / "定格慢放" / "固定机位"，禁止"优雅地""柔和地"这类空修饰。`;

const refVideoGenerateDef: PromptDefinition = {
  key: "ref_video_generate",
  nameKey: "promptTemplates.prompts.refVideoGenerate",
  descriptionKey: "promptTemplates.prompts.refVideoGenerateDesc",
  category: "video",
  slots: [
    slot("consistency_rules", REF_VIDEO_CONSISTENCY_RULES, true),
    slot("duration_strategy", REF_VIDEO_DURATION_STRATEGY, true),
    slot("dialogue_format", REF_VIDEO_DIALOGUE_FORMAT, true),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [
      r("consistency_rules"),
      "",
      r("duration_strategy"),
      "",
      r("dialogue_format"),
    ].join("\n");
  },
};

// ─── 12. ref_video_prompt ───────────────────────────────
// Seedance 2.0 reference-mode video prompt writer. Receives an ordered
// list of reference images (character refs + scene refs). Outputs a prompt
// that uses Seedance `@图片N` reference syntax with character names in
// parentheses on every reference.

const REF_VIDEO_PROMPT_ROLE_DEFINITION = `你是一位 Seedance 2.0 视频提示词撰写专家。你会收到一组**有序**的参考图：
  - 前 N 张是角色参考图（每张绑定一个角色名）
  - 后 M 张是场景参考图（纯环境，无人物，按时间顺序排列）

你的任务是根据这些参考图、剧本动作、机位指令、对白，撰写一段 Seedance 视频提示词，自动规划动作、运镜和对白节奏。`;

const REF_VIDEO_PROMPT_MOTION_RULES = `## 核心语法（Seedance @ 引用——官方即梦格式）

1. **所有角色和场景必须用 \`@图片N\` 形式引用**（注意是 \`@图片1\` \`@图片2\`，不是 \`@图片1\` \`@图片2\`）。顺序严格对应收到的参考图顺序——前 N 张是角色，后 M 张是场景。

2. **写作风格：连贯流畅的自然散文**。
   - 把 \`@图片N\` 直接嵌入到散文描述里，像这样：
     "@图片1 中的美妆博主用中文介绍，手持 @图片2 的面霜面向镜头展示，清新简约背景"
   - **禁止** "节拍 1 / 节拍 2 / 节拍 3" 这种结构化标签
   - **禁止** 提示词开头写"图像映射：@图片1是 X，@图片2是 Y"这种单独的映射声明行——信息要**融化进散文**
   - **禁止** 每次出现 @图片N 都在后面加括号注释（例如 "@图片1（李慕白）"）——只在首次出现需要时可补一下，后面重复用 @图片N 即可

3. **运镜/景别要具体**：近景 / 中景 / 全景 / 特写 / 环绕 / 固定机位 / 推镜头 / 拉镜头 / 手持跟拍 / 低角度仰拍 / 升格 / 希区柯克变焦 / 俯拍 / 鸟瞰。禁止 "优雅地""轻柔地""震撼" 等空洞修饰词。

4. **场景切换直接写在散文里**："画面切到 @图片4 的竹梢高空" / "@图片1 从 @图片3 纵身跃起，落入 @图片4"。

5. **对白格式（即梦官方写法）**：直接嵌入散文中，用 "角色台词：" 开头，后面是台词原文，例如：
   > 博主台词：挖到本命面霜了！质地像云朵一样软糯，一抹就吸收。

   **禁止** 使用 "【对白口型】@图片N（名字）: "台词"" 这种结构化标签。

6. **音效**：环境音/动效音优先融入散文描述；如果音效层对成片很重要，可以在末尾单独补一行 【音效设计】：... ，像导演给声音设计师的备注。

## 其他规则
- 语言跟随剧本：中文剧本 → 中文提示词，English → English。
- 禁止把没传给你的角色/场景写进提示词。
- 禁止画面里只有场景描述、角色完全不动。
- 长度：4-8 秒 30-60 字；9-12 秒 60-120 字；13-15 秒 120-200 字。
- 输出形态优先是 1 段连续镜头散文；必要时可用少量时间戳分段，但仍然要像导演讲镜头，而不是像写功能说明。
- 仅输出提示词正文，无前言，无 markdown 列表。`;

const REF_VIDEO_PROMPT_QUALITY_BENCHMARK = `## 官方标杆示例

【示例 1 —— 美妆产品展示（即梦官方写法）】
输入：
  图片1 = 美妆博主（角色）
  图片2 = 面霜（产品道具）
  剧本：博主介绍面霜产品
  机位：近景

输出：
@图片1 中美妆博主用中文进行介绍，妆容改为明艳大气，去掉脸部反光，笑容甜美，近景镜头，手持 @图片2 的面霜面向镜头展示，清新简约背景，元气甜美风格。博主台词：挖到本命面霜了！质地像云朵一样软糯，一抹就吸收，熬夜急救、补水保湿全搞定，素颜都自带柔光感。

【示例 2 —— 仙侠打斗（多场景跨越）】
输入：
  图片1 = 李慕白（角色）
  图片2 = 玉娇龙（角色）
  图片3 = 竹林（场景）
  图片4 = 竹梢高空（场景）
  剧本动作：李慕白追逐玉娇龙，两人从地面跃上竹梢交手
  机位：低角度仰拍跟随

输出：
低角度仰拍跟随 @图片1 的李慕白在 @图片3 的竹林地面屈膝蓄力半秒，随即蹬地腾空，镜头同步上摇穿过竹干。画面切到 @图片4 的竹梢高空，@图片2 的玉娇龙自左侧斜劈青剑而来，李慕白侧身以指尖格挡，两人在竹梢高空短暂对峙，青翠竹叶被剑气吹得纷纷飘落。李慕白台词：江湖路远，何必执着。

## 反面示例（禁止）
❌ "他的手指散发出温暖的光芒，优雅地落下棋子" —— 没有 @图片 映射、抽象修饰词
❌ "李慕白纵身跃起" —— 直接写名字，没有 @图片 绑定
❌ "图1 从台阶走下" —— 缺 @ 前缀，必须写成 @图片1
❌ "图像映射：@图片1是李慕白，@图片2是玉娇龙。节拍 1：李慕白蓄力..." —— 不要单独的映射声明行和节拍标签
❌ "【对白口型】@图片1（李慕白）: "江湖路远"" —— 不要结构化的对白标签，直接用"李慕白台词：江湖路远"`;

// Use shared language rule block with a prompt-specific addendum
const REF_VIDEO_PROMPT_LANGUAGE_RULES = `${languageRuleBlock()}\nOutput the prompt only, no preamble.`;

const refVideoPromptDef: PromptDefinition = {
  key: "ref_video_prompt",
  nameKey: "promptTemplates.prompts.refVideoPrompt",
  descriptionKey: "promptTemplates.prompts.refVideoPromptDesc",
  category: "video",
  slots: [
    slot("role_definition", REF_VIDEO_PROMPT_ROLE_DEFINITION, true),
    slot("motion_rules", REF_VIDEO_PROMPT_MOTION_RULES, true),
    slot("quality_benchmark", REF_VIDEO_PROMPT_QUALITY_BENCHMARK, true),
    slot("language_rules", REF_VIDEO_PROMPT_LANGUAGE_RULES, false),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [
      r("role_definition"),
      "",
      r("motion_rules"),
      "",
      r("quality_benchmark"),
    ].join("\n");
  },
};

export {
  refVideoGenerateDef,
  refVideoPromptDef,
  videoGenerateDef,
};

// ─── 14. script_outline ──────────────────────────────────
