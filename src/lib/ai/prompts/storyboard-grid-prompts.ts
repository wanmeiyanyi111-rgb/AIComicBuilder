export function buildStoryboardGridPromptRequest(params: {
  shot: {
    sequence: number;
    prompt: string;
    motionScript?: string | null;
    videoScript?: string | null;
    cameraDirection?: string | null;
    duration?: number | null;
  };
  visualStyle?: string;
  ratio?: string;
  resourceSummary?: string;
}): string {
  const shot = params.shot;
  const targetDuration = shot.duration ? `约 ${shot.duration} 秒` : "约 12 秒";
  const sections = [
    [
      "任务类型：生成一张 2x2 四宫格连续剧情分镜图。",
      "输出目标：这是一组用于后续图生视频的连续画面锚点，不是 4 张互相独立的概念插画。",
      params.ratio ? `画幅比例：${params.ratio}` : "",
      `总时长：${targetDuration}`,
    ]
      .filter(Boolean)
      .join("\n"),
    [
      "全局锁定要求：",
      params.visualStyle ? `- 项目风格：${params.visualStyle}` : "",
      shot.cameraDirection ? `- 镜头机位与运动倾向：${shot.cameraDirection}` : "",
      "- 四格必须属于同一场戏、同一时间段、同一空间逻辑。",
      "- 角色形象、服装、场景空间、关键道具、光线方向、色彩气质必须前后一致。",
      "- 如果输入剧情过于复杂，必须主动压缩为同一场景中的一个核心事件，不得把多件大事塞进一个四宫格。",
      params.resourceSummary ? `- 严格参考资源：\n${params.resourceSummary}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    [
      "剧情输入：",
      `- 镜头 ${shot.sequence}：${shot.prompt || ""}`,
      shot.motionScript ? `- 动作脚本：${shot.motionScript}` : "",
      shot.videoScript ? `- 视频脚本：${shot.videoScript}` : "",
      "- 你必须先提炼出唯一剧情目标、唯一主场景、唯一主动作线、唯一主情绪线，再据此拆成 4 格。",
    ]
      .filter(Boolean)
      .join("\n"),
    [
      "四宫格导演节拍：",
      "- Panel 1 = setup：建立局面，只负责明确人物状态、空间关系、起始动作前状态。",
      "- Panel 2 = development：推进动作，只允许一个主要变化。",
      "- Panel 3 = escalation：升级变化或冲突显现，只出现一个升级点。",
      "- Panel 4 = outcome：给出阶段结果或悬念停点，形成可承接的视频尾部状态。",
      "- 四格必须是连续时间切片：Panel 2 承接 Panel 1，Panel 3 升级 Panel 2，Panel 4 收束或停顿于悬念。",
      "- 每格都要写清楚继承什么不变（mustKeep）以及相对上一格只变化什么（delta）。",
    ].join("\n"),
    [
      "每个 panel 的 prompt 必须是一段可直接用于生图的大图提示词，必须自然包含以下信息：",
      "- 角色、服装、外貌特征、情绪状态",
      "- 场景、时间天气、空间结构、关键道具",
      "- 镜头机位、景别、焦段、摄影风格、光影风格、色彩风格",
      "- 当前格对应的动作阶段、构图重点、表情细节、微动态线索",
      "- 若项目要求写实，必须使用电影级写实摄影语言，禁止 2.5D、动漫感、插画感",
      "- 每格画面应稳定、明确、可控，禁止运动模糊瞬间、残影态、中间态、夸张特效",
      "- 每格 prompt 都必须明确这是“四宫格中的单独一格单帧画面”，禁止在单格图里再出现拼贴、分屏、四联画、漫画页、故事板、接触表、文字标签、编号、字幕、排版边框",
      "- 每格 prompt 都必须强调：当前这一格只是整段剧情演绎中的一个连续时间切片，要服务整体剧情推进，而不是生成一张独立海报",
    ].join("\n"),
    [
      "输出 JSON 对象，格式必须严格如下：",
      "{",
      '  "shotSequence": 1,',
      '  "storyGoal": "这12秒内唯一要完成的剧情事件",',
      '  "primaryScene": "本分镜唯一主场景",',
      '  "sceneCount": 1,',
      '  "eventCount": 1,',
      '  "complexityLevel": "low 或 medium",',
      '  "startingAction": "镜头起始时角色处于什么动作起点",',
      '  "endingAction": "镜头结束时停在什么动作结果或悬念姿态",',
      '  "continuityBeats": ["中段连续变化1", "中段连续变化2"],',
      '  "microDynamics": ["眼神细微变化", "手部细节变化", "衣摆或发丝轻微变化"],',
      '  "continuityRules": {',
      '    "locationLocked": true,',
      '    "timeContinuous": true,',
      '    "sameCharacterDesign": true,',
      '    "samePropSet": true,',
      '    "cameraAxisLocked": true',
      "  },",
      '  "characters": ["角色名"],',
      '  "panels": [',
      '    { "index": 1, "stage": "setup", "beat": "建立局面", "mustKeep": ["角色造型", "服装", "主场景", "核心道具", "光线方向"], "delta": "建立起始状态，不引入新事件", "prompt": "第一格完整生图提示词" },',
      '    { "index": 2, "stage": "development", "beat": "动作推进", "mustKeep": ["延续上一格角色造型", "服装", "空间关系", "道具"], "delta": "相对上一格只推进一个动作", "prompt": "第二格完整生图提示词" },',
      '    { "index": 3, "stage": "escalation", "beat": "变化升级或冲突显现", "mustKeep": ["同一空间轴线", "同一角色状态延续", "同一场景逻辑"], "delta": "相对上一格只出现一个升级点", "prompt": "第三格完整生图提示词" },',
      '    { "index": 4, "stage": "outcome", "beat": "阶段结果或悬念停点", "mustKeep": ["角色", "服装", "场景", "光线", "道具连续"], "delta": "给出当前事件的阶段结果或悬念停点", "prompt": "第四格完整生图提示词" }',
      "  ]",
      "}",
      "只输出有效 JSON，不要代码块，不要解释，不要多余文本。",
    ].join("\n"),
  ].filter(Boolean);

  return sections.join("\n\n");
}

export const STORYBOARD_GRID_SYSTEM_PROMPT = `
你是一位电影分镜导演，专门为弱控制力视频模型设计“四宫格分镜 + 视频提示词”工作流。

你的职责不是写散漫的文学描写，而是把一个镜头拆成 4 个清晰、连续、可执行的画面锚点。

硬性规则：
1. 一共必须输出 4 个 panel，顺序固定为 1,2,3,4。
2. 四格必须在同一剧情段内连续推进，整体约 12 秒，不能跨越多个无关场景。
3. 一个四宫格分镜只允许 1 个主场景、1 个主剧情目标、1 条主动作线、1 条主情绪线。
4. 如果输入内容本身涉及多个复杂事件、多个地点或多个高潮，你必须主动压缩成当前最核心的一件事，不得把所有内容塞进同一个四宫格。
5. 四格不是四张独立插画，而是同一镜头段落的连续时间切片：Panel2 必须承接 Panel1，Panel3 必须升级 Panel2，Panel4 必须收束或停在悬念点。
6. 每格提示词都必须是稳定画面，禁止“运动模糊瞬间”“残影态”“中间态”。
7. 每格提示词必须明确：角色状态、关键动作阶段、景别/机位/构图、环境光线、必出道具。
8. 每格必须写出相对上一格“继承什么”和“变化什么”，不允许每格重新定义一个完整新世界。
9. 如果提供了角色/场景/道具参考，必须严格遵守，不能擅自换造型、换地点、漏道具。
10. 如果是写实/电影级写实风格，必须使用写实电影摄影语言，禁止 2.5D、动漫线稿、Q版、插画感。
11. 四格之间要体现镜头推进：建立 -> 推进 -> 变化/冲突 -> 阶段结果。
12. 你必须同时输出整个四宫格共享的动作骨架：startingAction、endingAction、continuityBeats、microDynamics。
13. "sceneCount" 必须为 1，"eventCount" 必须为 1，"complexityLevel" 只能是 low 或 medium。
14. continuityBeats 至少 2 条，microDynamics 至少 2 条，且都必须服务于同一事件连续推进。
15. 每个 panel 的 prompt 必须像导演给美术和摄影的联合指令，而不是简单关键词堆砌。
17. 每个 panel 的 prompt 都必须面向“单格单图”生图模型来写，明确禁止模型在一张图里自行再做四宫格、拼贴、分屏、文字分镜说明或漫画页排版。
18. 每个 panel 的 prompt 都必须提醒模型：这是同一段剧情演绎中的连续时间切片，画面职责是服务剧情推进，而不是单独追求海报感。
16. 输出必须是有效 JSON。
`.trim();
