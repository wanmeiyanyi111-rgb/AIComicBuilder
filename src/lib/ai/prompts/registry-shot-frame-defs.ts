import { artStyleBlock, physicsRealismBlock, themeStyleMappingBlock } from "./blocks";
import type { PromptDefinition } from "./registry-core";
import { resolve, slot } from "./registry-core";

const FIRST_FRAME_STYLE_MATCHING = `=== 首帧标准模板总则（最高优先级）===
你要生成的是“动作开始前的稳定首帧”，它将作为视频的视觉起点。
- 只写自然中文散文，2-4句，禁止结构化标签（如 Scene:/Action:）、禁止权重语法（如“（xx：1.5）”）
- 必须先判定并锁定画风，再写内容；不得擅自改风格
- 如果有参考图，参考图风格是最高标准，必须严格继承
- 不得出现字幕、文字、水印、LOGO、边框
- 首帧必须是稳定时刻，不要运动中间态或模糊态
- 若项目风格或描述包含“电影级写实/写实电影摄影/实拍/photorealistic/cinematic realism”，必须锁定写实电影摄影语言，禁止 2.5D、卡通化边缘、动漫线稿质感

${themeStyleMappingBlock()}

${artStyleBlock()}

${physicsRealismBlock()}`;

const FIRST_FRAME_REFERENCE_RULES = `=== 首帧标准提示词格式（按顺序组织）===
请按以下“四段式信息顺序”组织首帧内容（可写成2-4句自然散文，不要列表输出）：
1) 主体身份与姿态：角色名（视觉标识）+ 身体朝向 + 站/坐/跪/蹲等稳定姿态
2) 动作与表情：手部位置、视线方向、面部表情（开场状态）
3) 构图与镜头：景别（全景/中景/近景/特写）+ 角度（平视/仰拍/俯拍）+ 焦段/透视感
4) 环境与光影：地点、关键道具、主光方向、色温、氛围细节

参考图一致性硬约束：
- 每张角色设定图的角色名必须和画面中的角色一一对应
- 服装、发型、发色、脸型、体型、肤色、配饰必须与参考图逐项一致
- 画风与材质语言必须与参考图一致，不得“同角色换风格”`;

const FIRST_FRAME_RENDERING_QUALITY = `=== 首帧渲染质量标准 ===
- 材质：细节可读，质感与画风一致（布料/金属/皮肤/木石等）
- 光线：电影级、可解释光源；主次分明，避免平光
- 背景：完整环境语义，避免抽象空背景
- 角色：严格匹配参考外观；姿态稳定且可作为视频起点
- 构图：主体清晰、层次明确、具备景深与视觉焦点`;

const FIRST_FRAME_CONTINUITY_RULES = `=== 连续性要求（仅在存在上一镜头尾帧时生效）===
此镜头紧接上一个镜头，附带参考中包含上一镜头尾帧。必须做到：
- 人物延续：服装/比例/体态连续，不跳变
- 风格延续：画风、材质、线条语言完全一致
- 光线延续：色温、主光方向、环境亮度平滑衔接
- 空间延续：角色与道具位置关系可解释地延续到当前首帧`;

const frameGenerateFirstDef: PromptDefinition = {
  key: "frame_generate_first",
  nameKey: "promptTemplates.prompts.frameGenerateFirst",
  descriptionKey: "promptTemplates.prompts.frameGenerateFirstDesc",
  category: "frame",
  slots: [
    slot("style_matching", FIRST_FRAME_STYLE_MATCHING, true),
    slot("reference_rules", FIRST_FRAME_REFERENCE_RULES, true),
    slot("rendering_quality", FIRST_FRAME_RENDERING_QUALITY, true),
    slot("continuity_rules", FIRST_FRAME_CONTINUITY_RULES, true),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    const sceneDescription = (params?.sceneDescription as string) ?? "";
    const startFrameDesc = (params?.startFrameDesc as string) ?? "";
    const characterDescriptions = (params?.characterDescriptions as string) ?? "";
    const previousLastFrame = (params?.previousLastFrame as string) ?? "";

    const lines: string[] = [];
    lines.push(`生成此镜头的首帧，作为一张高质量图像。`);
    lines.push("");
    lines.push(r("style_matching"));
    lines.push("");
    lines.push(`=== 场景环境 ===`);
    lines.push(sceneDescription);
    lines.push("");
    lines.push(`=== 首帧目标描述 ===`);
    lines.push(startFrameDesc);
    lines.push("");
    lines.push(`=== 角色描述 ===`);
    lines.push(characterDescriptions);
    lines.push("");
    lines.push(r("reference_rules"));
    lines.push("");

    if (previousLastFrame) {
      lines.push(r("continuity_rules"));
      lines.push("");
    }

    lines.push(r("rendering_quality"));
    return lines.join("\n");
  },
};

const LAST_FRAME_STYLE_MATCHING = `=== 尾帧标准模板总则（最高优先级）===
你要生成的是“动作完成后的稳定尾帧”，它将作为视频终点并可能复用为下一镜头起点。
- 只写自然中文散文，2-4句，禁止结构化标签与权重语法
- 画风必须与首帧和参考图完全一致，不允许任何风格漂移
- 尾帧必须是稳定停驻时刻，禁止运动中间态、动态模糊
- 不得出现字幕、文字、水印、LOGO、边框
- 若首帧为电影级写实，尾帧同样必须保持电影级写实，禁止 2.5D/卡通化`;

const LAST_FRAME_RELATIONSHIP_TO_FIRST = `=== 尾帧标准提示词格式（按顺序组织）===
请按以下“四段式信息顺序”组织尾帧内容（可写成2-4句自然散文，不要列表输出）：
1) 主体身份与终态姿态：角色名（视觉标识）+ 动作结束后的身体姿态与朝向
2) 终态表情与细节：手部/视线/面部情绪（结果态）
3) 构图与镜头终态：景别、角度、透视与主体位置（镜头已完成运动）
4) 环境与光影终态：与首帧同场景同光线体系，仅在动作结果上产生合理变化

与首帧关系硬约束：
- 环境、布光、色彩基调一致
- 画风一致，不得混风
- 服装/发型/配饰/体型一致，仅姿态与表情变化
- 角色位置变化必须符合本镜头动作逻辑`;

const LAST_FRAME_NEXT_SHOT_READINESS = `=== 下一镜头可复用性（硬约束）===
此尾帧可能直接复用为下一镜头首帧，必须满足：
- 稳定：人物姿态、道具状态、构图都处于“可停驻”状态
- 完整：画面独立成立，不依赖上下文补全
- 可衔接：为后续镜头切换保留自然过渡空间（机位/视线/运动方向可承接）`;

const LAST_FRAME_RENDERING_QUALITY = `=== 尾帧渲染质量标准 ===
- 材质：延续首帧质感等级与风格
- 光线：与首帧同一布光体系，仅做动作驱动的最小变化
- 背景：保持同场景语义与空间一致性
- 角色：严格匹配参考外观，体现动作完成后的情绪结果
- 构图：画面收束自然，适合直接剪辑`;

const frameGenerateLastDef: PromptDefinition = {
  key: "frame_generate_last",
  nameKey: "promptTemplates.prompts.frameGenerateLast",
  descriptionKey: "promptTemplates.prompts.frameGenerateLastDesc",
  category: "frame",
  slots: [
    slot("style_matching", LAST_FRAME_STYLE_MATCHING, true),
    slot("relationship_to_first", LAST_FRAME_RELATIONSHIP_TO_FIRST, true),
    slot("next_shot_readiness", LAST_FRAME_NEXT_SHOT_READINESS, true),
    slot("rendering_quality", LAST_FRAME_RENDERING_QUALITY, true),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    const sceneDescription = (params?.sceneDescription as string) ?? "";
    const endFrameDesc = (params?.endFrameDesc as string) ?? "";
    const characterDescriptions = (params?.characterDescriptions as string) ?? "";

    const lines: string[] = [];
    lines.push(`生成此镜头的尾帧，作为一张高质量图像。`);
    lines.push("");
    lines.push(r("style_matching"));
    lines.push("");
    lines.push(`=== 场景环境 ===`);
    lines.push(sceneDescription);
    lines.push("");
    lines.push(`=== 尾帧目标描述 ===`);
    lines.push(endFrameDesc);
    lines.push("");
    lines.push(`=== 角色描述 ===`);
    lines.push(characterDescriptions);
    lines.push("");
    lines.push(`=== 参考图 ===`);
    lines.push(`第一张附带图像是此镜头的首帧——以它为视觉锚点。`);
    lines.push(`其余附带图像是角色设定图（每张4个视角，名字印在底部）。`);
    lines.push(`将每张设定图的角色名与场景中的角色对应。`);
    lines.push("");
    lines.push(r("relationship_to_first"));
    lines.push("");
    lines.push(r("next_shot_readiness"));
    lines.push("");
    lines.push(r("rendering_quality"));
    return lines.join("\n");
  },
};

const SCENE_FRAME_REFERENCE_RULES = `=== 无人物强制约束（最高优先级）===
这是纯场景参考图。画面中**绝对不允许出现任何人物、角色、背影、剪影、人形、手脚或身体部位**。
- 禁止：人、角色、背影、剪影、人形轮廓、露出的手/脚/肩膀
- 允许：空的环境、建筑、道具、自然景观、天气、光线、大气粒子
- 角色一致性由后续视频生成阶段的多图参考机制保证，与本步骤完全解耦

${themeStyleMappingBlock()}

${physicsRealismBlock()}`;

const SCENE_FRAME_COMPOSITION_RULES = `=== 构图规则 ===
- 根据场景描述渲染具体的空间构图——不要默认通用镜头
- 完整渲染的背景与环境——不要空白或抽象背景
- 电影级取景，清晰的构图和景深
- 构图必须留出角色后续入画的空间，但此刻画面中不出现任何人`;

const SCENE_FRAME_RENDERING = `=== 渲染质量 ===
- 材质：符合画风的丰富细节
- 光线：电影级布光，光源有明确动机
- 画风：遵循场景描述中的风格指示
- 再次强调：画面中不出现任何人物`;

const sceneFrameGenerateDef: PromptDefinition = {
  key: "scene_frame_generate",
  nameKey: "promptTemplates.prompts.sceneFrameGenerate",
  descriptionKey: "promptTemplates.prompts.sceneFrameGenerateDesc",
  category: "frame",
  slots: [
    slot("reference_rules", SCENE_FRAME_REFERENCE_RULES, true),
    slot("composition_rules", SCENE_FRAME_COMPOSITION_RULES, true),
    slot("rendering", SCENE_FRAME_RENDERING, true),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    const sceneDescription = (params?.sceneDescription as string) ?? "";
    const cameraDirection = (params?.cameraDirection as string) ?? "";
    const startFrameDesc = (params?.startFrameDesc as string) ?? "";

    const lines: string[] = [];
    lines.push(`生成一张电影级静帧图像，作为纯场景参考帧。画面中不得出现任何人物。`);
    lines.push("");
    lines.push(`=== 场景描述 ===`);
    lines.push(sceneDescription);

    if (startFrameDesc) {
      lines.push("");
      lines.push(`=== 空间与时刻 ===`);
      lines.push(`画面必须描绘这一空间与时刻（仅取其中的环境/光线/道具信息，不要描绘人物）：${startFrameDesc}`);
    }

    if (cameraDirection && cameraDirection !== "static") {
      lines.push("");
      lines.push(`=== 镜头构图 ===`);
      lines.push(`镜头角度/距离：${cameraDirection}`);
      lines.push(`将此镜头角度应用到构图中。`);
    }

    lines.push("");
    lines.push(r("reference_rules"));
    lines.push("");
    lines.push(r("composition_rules"));
    lines.push("");
    lines.push(r("rendering"));

    return lines.join("\n");
  },
};

export {
  frameGenerateFirstDef,
  frameGenerateLastDef,
  sceneFrameGenerateDef,
};
