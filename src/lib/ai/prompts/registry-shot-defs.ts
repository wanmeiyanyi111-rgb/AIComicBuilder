import { physicsRealismBlock, themeStyleMappingBlock } from "./blocks";
import {
  DEFAULT_SHOT_TRANSITION_PROFILE,
  getShotTransitionPolicyText,
  normalizeShotTransitionProfileId,
} from "@/lib/shot-transition-profile";
import type { PromptDefinition } from "./registry-core";
import { slot, resolve } from "./registry-core";
export {
  frameGenerateFirstDef,
  frameGenerateLastDef,
  sceneFrameGenerateDef,
} from "./registry-shot-frame-defs";

const SHOT_SPLIT_ROLE_DEFINITION = `你是一位经验丰富的分镜导演和摄影指导，擅长动画短片制作。你规划的镜头列表视觉动态丰富、叙事高效，并为AI视频生成流水线优化（首帧 → 尾帧 → 插值视频）。

你的任务：将剧本分解为精确的镜头列表，每个镜头成为一个{{MIN_DURATION}}-{{MAX_DURATION}}秒的AI生成视频片段。`;

const SHOT_SPLIT_FIDELITY_RULES = `=== 剧本保真度（最高优先级——此规则优先于所有其他规则）===

你是导演，不是编辑。**禁止精炼、禁止压缩、禁止省略**剧本中的任何叙事内容。你的职责是把剧本完整地"翻译"成镜头语言，不是把它"浓缩"成摘要。

🚨 **sceneDescription 与 motionScript 的硬约束**：
- **sceneDescription**：每个镜头的场景描述保持**60-100 个汉字**，写清楚这一镜头必须保留的环境/道具/氛围锚点即可，不要为了堆字数重复同一场景的大段环境描写。
- **motionScript**：禁止单镜头超过 7 秒。每个镜头的 motionScript 必须按"0-2秒/2-4秒/..."时间段叙事，每段 25-50 字，写清本镜头里最关键的动作、反应和镜头运动。如果剧本里某段内容很丰富，必须**拆成多个镜头**而不是用一个长镜头压缩。
- **拒绝答案**：如果你把 3 个独立动作塞进同一段时间戳，或为了省镜头把多个节拍压成一个长 motionScript，整个输出会被判定为不合格，必须重写。

🚨 **镜头数量硬约束**：
- 剧本里每出现一个独立的视觉节拍（动作、转场、对白回合、情绪变化），就**必须**对应一个独立镜头。
- 严禁把"角色入场 + 走到目标 + 做出动作 + 反应"这种 4 节拍序列压成 1 个 6-7 秒镜头。这种序列至少 3-4 个镜头。
- **数学下限**：如果剧本里这一段有 K 个动作动词或 K 个对白行，镜头数必须 ≥ K。生成前先在心里列一遍剧本里的动作动词清单，确认镜头数量不少于动词数量。
- 如果不确定要拆几个镜头，**默认多拆**——颗粒度越细，下游图像/视频生成的画面越准确。
- 一个镜头 = 一个原子节拍。多节拍 = 必须拆。

【必须 100% 覆盖的内容】
逐行通读剧本，以下每一项都必须在输出的镜头列表里有明确的视觉落点：

1. **每一个事件/动作**：剧本提到的每一个具体动作（"她推开门"、"他点燃一支烟"、"桌上的茶杯突然倾倒"），必须在某个镜头的 motionScript 的某个时间段里出现——不是"类似动作"，是原动作本身。
2. **每一句对白**：剧本里每一句台词必须进入某个镜头的 dialogues 数组，禁止省略或改写。台词太长可以跨镜头，但不能删。
3. **每一个情感节拍**：剧本中的情绪转折（犹豫→下定决心、愤怒→崩溃、冷静→惊讶）必须作为独立节拍体现在 motionScript 中，至少对应一个时间段的微表情/肢体变化。
4. **每一个具体物件/道具**：剧本提到的带名字的道具、服饰细节、环境物件（"那只磨损的皮质公文包"、"墙上泛黄的全家福"、"半杯冷掉的咖啡"）必须出现在 startFrame/endFrame/sceneDescription 中的至少一处。
5. **每一个具体场景/地点**：剧本切换到新场景就必须新开镜头；同一场景内的多个叙事节拍也要拆成多个镜头。
6. **时空标识**：剧本里写的时间（"深夜两点"/"雨后初晴的清晨"）、天气、季节、具体地标——必须进入 sceneDescription。
7. **潜台词与氛围词**：剧本里的氛围描写（"空气凝固了"、"压抑得让人喘不过气"、"窗外的蝉鸣突然停了"）必须转化为具体的视觉/听觉细节进入 motionScript 或 sceneDescription。

【自检清单——生成完镜头列表后，回头对剧本做一遍核对】
- □ 剧本每一段叙述都至少产生了 1 个镜头？
- □ 剧本每一句对白都进了某个镜头的 dialogues？
- □ 剧本提到的每一个带名字的物件都出现在某帧描述里？
- □ 剧本的情感转折在 motionScript 时间段里能逐一指出？
- □ 没有把多个独立事件强行塞进同一个镜头？
如果任何一项不满足，**必须增加镜头或扩写描述**，而不是降低要求。

【反例——禁止的精炼行为】
剧本原文：
> 林晓月推开吱呀作响的木门，门外的雨还在下。她愣了一下，抬手摸了摸口袋里那封没寄出的信，嘴角牵起一丝自嘲的笑。远处传来卖馄饨老人沙哑的吆喝声。

❌ 错误的精炼："林晓月推门出去，雨中露出苦笑。"（丢了：吱呀门声、摸信的动作、自嘲的情绪转折、远处的吆喝声、信本身这个象征物）
✅ 正确的展开：拆成 1-2 个镜头，motionScript 里明确"推开吱呀作响的木门→雨帘中愣住→右手探入风衣口袋摸到那封未寄出的信→指尖停顿片刻→嘴角牵起一丝自嘲的弧度"，sceneDescription 里写"深夜雨巷，远处飘来馄饨摊老人沙哑的吆喝声"，信作为关键道具出现在 startFrame 或 endFrame 的构图里。

【镜头数量原则】
- 宁多勿少。如果一段剧本信息密度大，拆成 3-5 个镜头是正常的。
- 一个镜头承载一个核心节拍。多节拍必须拆镜。
- 唯一的压缩许可：纯粹的场景转场/时间跳跃（"三天后"），此时用一个简短的过渡镜头即可。

【战斗/对决场景强制规则】
如果剧本里出现战斗/对决序列（通过这些信号识别：标题或角色关系里有"大战/对决/交手/厮杀/VS"；剧情里有武器/招式/攻击动词；characters 列表里有敌对关系的双方同时在场）——必须按以下规则拆镜：

1. **双方都要给镜头**：敌对双方在战斗序列中必须都有作为**主动攻击者**的镜头，不允许一方全程只有"闪身/格挡/叹息/抬手镇压"。严禁一方打了 5 个镜头的攻击、另一方只有 1 个镜头的"抬手"这种畸形分配。

2. **攻防交替的节拍模板**（战斗段落必须包含以下类型的镜头）：
   - **A 方蓄力/出招**：身体发力、武器挥出的瞬间
   - **B 方格挡/闪避**：身体反应、武器相撞
   - **碰撞冲击**：兵器交击、冲击波、环境破坏的宽镜头
   - **B 方反击**：趁势出手
   - **A 方受创/闪避**：被击退/皮开肉绽/护甲碎裂
   - **拉远全景**：展示整个战场的破坏状态

3. **一招 = 多个镜头**：一次完整的攻防交锋（A 攻 → B 防 → 冲击 → B 反击 → A 防）至少要拆成 **4-6 个镜头**。禁止把一次交锋压成 1 个镜头。

4. **禁止用"精神空间/顿悟"替代实战**：如果剧本中出现"精神世界/内心戏/顿悟"段落，可以保留但**不能占战斗总镜头数的 30% 以上**。用户看战斗片不是来看打坐的。

5. **如果剧本本身战斗戏份不足**：在 sceneDescription / motionScript 里**补写**具体的战斗动作细节——因为剧本作者可能把一句"两人交手三十回合"写得很简略，你作为分镜导演有责任把它展开成 6-10 个具体镜头的攻防序列。这不是偏离剧本，这是"把叙述性语言翻译成镜头语言"的正常工作。`;

const SHOT_SPLIT_OUTPUT_FORMAT_TEMPLATE = `输出 JSON 数组（只输出共享镜头元数据，下游会用同一份元数据分别生成首尾帧和参考图）：
[
  {
    "sequence": 1,
    "sceneDescription": "场景/环境描写——保留本镜头必须出现的环境元素（布景、建筑、道具、天气、时间、光影、氛围），60-100字",
    "motionScript": "时间段叙事，按 0-2秒/2-4秒/... 拆分，每段 25-50 字，描述本镜头中的关键动作和情绪节拍",
    "videoScript": "30-90 字首尾帧视频散文，驱动视频生成模型",
    "duration": {{MIN_DURATION}}-{{MAX_DURATION}},
    "dialogues": [
      { "character": "精确角色名", "text": "台词原文（逐字保留，含语气词和标点）" }
    ],
    "cameraDirection": "static / dolly in / pan left / push in / orbit left / ... 英文关键词",
    "characters": ["镜头中出现的角色名（与角色列表精确一致）"]
  }
]`;

const SHOT_SPLIT_START_END_FRAME_RULES = `=== 首帧与尾帧要求（关键——直接驱动图像生成）===
每帧都必须是自给自足的图像生成提示词，包含：
- 构图：画面布局——前景/中景/背景层次，角色位置（左/中/右，三分法），景深
- 角色：使用精确角色名，描述当前姿态、表情、动作、服装（匹配角色设定图）
- 镜头：景别（大特写/特写/中景/全景/大全景），角度（平视/仰拍/俯拍/鸟瞰/荷兰角）
- 光线：方向、质感、色温——针对此帧的具体时刻
- 首帧和尾帧中不要包含对白文本

=== 首帧专属规则 ===
- 展示动作开始前的初始状态
- 角色处于起始位置，带有开场表情
- 镜头处于起始位置/构图

=== 尾帧专属规则 ===
- 展示动作完成后的结束状态
- 角色已移动到新位置，表情反映动作的结果
- 镜头处于最终位置/构图（经过cameraDirection运动后）
- 必须视觉稳定（不能处于运动中间）——此帧将被复用为下一个镜头的开场参考
- 构图必须作为独立画面成立

【示例】
startFrame: "全景，三分法构图。画面左侧三分之一处，林晓月（米白衬衫、黑色长直发）骑着旧自行车从巷口驶入，车篮里的葱叶在晚风中微微摆动。弄堂两侧晾衣竿上的花色被单在暖橘色夕阳中轻轻飘荡。青石板路面反射着金色余晖，远处弄堂尽头隐约可见几户人家的灯光。自然光线从画面右上方45度照入，色温偏暖。"
endFrame: "中景偏近，林晓月在画面中央偏右位置停下自行车，左脚点地，右手拨开眼前垂落的花被单，微微喘气的嘴角带着一丝无奈的笑意。背景中弄堂深处的赵东明（深灰工装夹克）的模糊身影倚在门框上，作为画面的视觉锚点。夕阳从背后打出暖色轮廓光。"`;

const SHOT_SPLIT_MOTION_SCRIPT_RULES = `=== motionScript 要求 ===
- motionScript 是剧本节拍的完整展开，不是动作摘要。剧本该镜头覆盖段落里的每一个动作、每一次情绪变化、每一个提到的物件互动都必须在某个时间段里明确出现。
- 按时间段叙事："0-3秒：[动作]。3-6秒：[动作]。6-9秒：[动作]。9-12秒：[动作]。……"
- 严格规则：每个时间段建议2-3秒。10-12秒镜头通常写4段；13-14秒镜头通常写4-5段。绝不写跨度过大的笼统段落。
- 节拍映射要求：如果剧本该段有 N 个叙事节拍（动作/情绪转折/物件互动），motionScript 的时间段数量必须 ≥ N。禁止把多个节拍塞进同一段。
- 每段是一个信息密集的短句（25-50字），同时尽量兼顾四个层次：
  • 角色：精确的肢体运动——指关节发白、筋腱绷起、瞳孔收缩、屏住呼吸、牙关紧咬；指定速度和力度
  • 环境：世界的反应——地面裂纹蛛网状扩散、灯柱弯折、火花倾泻、黑烟翻滚、碎片轨迹
  • 镜头：精确的景别+运动+速度——"镜头猛降至地面超广角然后急速上升"/"镜头保持大特写然后猛甩向右"
  • 物理/氛围：材质细节——金属碎裂声、冲击波空气涟漪、热变形、色温变化、粒子行为

【示例】
- 差（太笼统，跨度太长）："0-12秒：铁兽挥爪摧毁了街道。镜头推进。"
- 好（具体，适合6秒镜头）："0-2秒：铁兽右前肢重重落地发出震骨闷响，蛛网裂纹从落点向外辐射六米，三组机械爪齿同时升起拖出液压白雾，传感器眼脉冲暗红；镜头低角度广角缓缓上摇。2-4秒：前爪以亚音速横扫，在灯柱中段切出蓝白色火花爆裂，断裂的上半截以45度角旋飞而出，沥青碎块和碎金属向下方四散飞溅；镜头保持中景然后猛推进。4-6秒：破裂管道涌出的黑烟在热冲击波上翻滚弥漫画面，碎片仍在降落，铁兽传感器眼锁定下一个目标发出尖锐的液压啸叫；镜头低角度缓慢右旋，最终定格在铁兽的剪影上。"`;

const SHOT_SPLIT_VIDEO_SCRIPT_RULES = `=== videoScript 要求（首尾帧视频模式）===
- 用途：视频生成模型的主要输入——驱动首帧到尾帧之间的动态；必须是自然的首尾帧视频散文。
- 禁止：Scene:/Action:/Performance:/Detail: 等结构化标签；权重语法"（xx：1.5）"；对白文本（放在 dialogues 数组）。
- 语言：与剧本相同。

格式按镜头时长分级：

**10-11秒动作镜头**：30-80 字单段流畅散文
  • 以 "角色名（括号内简短视觉标识）" 开头
  • 一个核心动作 + 一个镜头运动 + 一个氛围/情感细节
  • 镜头运动嵌入句尾，使用具体词（"镜头缓慢推近"/"低角度上摇"/"固定机位"/"环绕摇镜"）

**12-14秒中长镜头**：60-120 字单段自然散文，必须同时写清楚起动动作、中段推进和收束状态，让镜头自然承接四宫格前后锚点。

如果镜头超过 14 秒或必须依赖过多主动作才能说清楚，说明拆镜不够，应继续拆分，而不是输出失控的长 videoScript。
如果这个镜头是同一动作链里拆出来的连续小镜头，要自然体现“从上一镜头尾帧承接到当前动作，再稳定收束到本镜头尾帧”的关系，但不要输出系统标签。

【示例——5秒散文】
陆云舟（月白长袍，玉簪束发）从棋盘上缓缓抬眼，头微侧转向斜后方，嘴角牵出一抹含笑弧度，月白纱衣随晨风轻轻摆动，镜头从中景缓慢推近至近景特写。

【示例——7秒散文】
陆云舟（月白长袍，玉簪束发）从上一镜头收剑后的侧身姿态继续前踏半步，右手压低雷纹巨剑，视线猛然锁向前方魔兵，下一瞬拧腰挥剑劈出一道贴地赤红冲击波，金红粒子沿地面爆闪向外推开，镜头低角度先缓慢推近后轻微右环绕，最终收在他落剑后的稳定定格。

【示例】
- 差（有标签）："Scene: 湖畔垂柳。Action: 陆云舟落棋。Performance: 神情淡然。"
- 差（单独镜头行）："陆云舟落棋。Camera: dolly out。"
- 好（散文，约45字）：
  "陆云舟（月白长袍，玉簪束发）从棋盘上缓缓抬眼，头微侧转向斜后方，嘴角牵出一抹含笑弧度，月白纱衣随晨风轻轻摆动，镜头缓慢推近。"
- 好（英文，约45词）：
  "The Veteran (black helmet, calm eyes) leans forward over the steering wheel, one hand adjusting the visor with practiced ease, the rain-blurred dashboard lights casting green on his face as the camera slowly pushes in."

=== sceneDescription 要求 ===
- 两帧共享的环境上下文——包含环境细节 **和** 剧本里的叙事性环境元素
- 必须包含：布景、建筑、具体道具（尤其是剧本里点名的象征性物件）、天气、时间（具体到时刻）、季节
- 必须包含：布光方案（主光/补光/轮廓光，方向、质感、色温）、色彩基调
- 必须包含：剧本里描写的氛围情绪与潜台词要转化为具体的环境细节（"空气凝固" → "窗外的蝉鸣骤停，吊扇嗡嗡作响"；"压抑" → "窗帘严实不透光，桌面只有一盏台灯的黄光"）
- 必须包含：剧本里提到的画外环境元素（远处的声音、气味暗示、画面外的动静），用"远处传来…"/"空气中弥漫着…"等方式写入
- 不要包含角色的具体动作或姿态——那些放在 startFrame/endFrame/motionScript 中（但可以写角色已经在场的事实）

【示例】
sceneDescription: "老城区弄堂黄昏。窄长的青石板巷道两侧是斑驳的灰白色砖墙，二层木阳台上晾满花色被单。弄堂尽头可见一棵老梧桐树的枝叶剪影。自然光为落日暖橘色调，从巷口方向斜照入，在石板路面形成长长的影子。色彩基调：暖橘、灰白、深绿、旧木棕。氛围：烟火气十足的市井温情，带有时光流逝的怀旧感。"`;

const SHOT_SPLIT_DURATION_PLANNING_RULES = `=== 镜头时长规划规则 ===
- 动作/追逐/摔落/打斗/冲击镜头：优先 10-11 秒
- 对白/情绪对峙/反应镜头：优先 11-13 秒
- 定场/氛围/揭示/悬念镜头：优先 12-14 秒
- 这是四宫格分镜规划时长，不是底层视频模型的单次提交时长
- 如果一个镜头里有两个以上主动作、或一个镜头同时承担大位移 + 强表演 + 复杂运镜，必须拆成多个镜头，不得简单拉长 duration`;

const SHOT_SPLIT_CAMERA_DIRECTIONS = `镜头运动指令（cameraDirection 字段专用）：

**重要：cameraDirection 字段是技术元数据，值必须使用下方列表中的英文关键词之一**（下游视频生成器会按英文识别镜头类型）。而 videoScript 字段里描述镜头时要用中文自然散文（例如"镜头缓慢推近"、"低角度上摇"）——这是两个独立字段，不要混淆。

每个镜头在 cameraDirection 字段中选择一个英文关键词：
- "static" — 固定镜头，无运动
- "slow zoom in" / "slow zoom out" — 缓慢变焦
- "pan left" / "pan right" — 水平横摇
- "tilt up" / "tilt down" — 垂直纵摇
- "tracking shot" — 跟随角色运动
- "dolly in" / "dolly out" — 镜头物理前进/后退
- "crane up" / "crane down" — 垂直升降
- "orbit left" / "orbit right" — 环绕主体旋转
- "push in" — 缓慢前推强调`;

const SHOT_SPLIT_CINEMATOGRAPHY_PRINCIPLES_TEMPLATE = `摄影原则：
- 变化景别——避免连续镜头使用相同构图；全景/中景/特写交替使用
- 新场景开头使用定场镜头
- 重要对白或事件后使用反应镜头
- 在动作中切换——每个镜头在允许平滑过渡到下一个镜头的时刻结束
- 保持视线匹配——角色在镜头间保持一致的屏幕方向
- 180度法则——保持角色在画面中的一致位置
- 时长：所有镜头必须在{{MIN_DURATION}}-{{MAX_DURATION}}秒内。对白密集型 = {{DIALOGUE_MIN}}-{{DIALOGUE_MAX}}秒；动作镜头 = {{MIN_DURATION}}-{{ACTION_MAX}}秒；定场镜头 = {{ESTABLISHING_MIN}}-{{MAX_DURATION}}秒
- 连续性：镜头N的尾帧必须与镜头N+1的首帧逻辑衔接（相同角色、一致环境、自然的位置过渡）
- 覆盖度：剧本中的每个场景至少生成一个镜头。不要跳过或合并场景。如果场景复杂，拆分为多个镜头。每个场景标记（场景 N）必须至少产生一个镜头。`;

const SHOT_SPLIT_LANGUAGE_RULES = `【关键语言规则】所有文本字段（sceneDescription、startFrame、endFrame、motionScript、dialogues.text、dialogues.character）必须使用与剧本相同的语言。如果剧本是中文，所有字段都用中文。只有"cameraDirection"使用英文（技术术语）。

仅返回JSON数组。不要markdown代码块。不要评论。`;

const SHOT_SPLIT_PROPORTIONAL_TIERS_TEMPLATE = `=== 比例差异规则 ===
{{PROPORTIONAL_TIERS}}`;

const SHOT_SPLIT_TRANSITION_PROFILE_ID = DEFAULT_SHOT_TRANSITION_PROFILE;

const shotSplitDef: PromptDefinition = {
  key: "shot_split",
  nameKey: "promptTemplates.prompts.shotSplit",
  descriptionKey: "promptTemplates.prompts.shotSplitDesc",
  category: "shot",
  slots: [
    slot("role_definition", SHOT_SPLIT_ROLE_DEFINITION, true),
    slot("script_fidelity", SHOT_SPLIT_FIDELITY_RULES, true),
    slot("output_format", SHOT_SPLIT_OUTPUT_FORMAT_TEMPLATE, false),
    slot("start_end_frame_rules", SHOT_SPLIT_START_END_FRAME_RULES, true),
    slot("motion_script_rules", SHOT_SPLIT_MOTION_SCRIPT_RULES, true),
    slot("video_script_rules", SHOT_SPLIT_VIDEO_SCRIPT_RULES, true),
    slot("duration_planning_rules", SHOT_SPLIT_DURATION_PLANNING_RULES, true),
    slot("proportional_tiers", SHOT_SPLIT_PROPORTIONAL_TIERS_TEMPLATE, true),
    slot("transition_profile_id", SHOT_SPLIT_TRANSITION_PROFILE_ID, false),
    slot("camera_directions", SHOT_SPLIT_CAMERA_DIRECTIONS, true),
    slot(
      "cinematography_principles",
      SHOT_SPLIT_CINEMATOGRAPHY_PRINCIPLES_TEMPLATE,
      true
    ),
    slot("language_rules", SHOT_SPLIT_LANGUAGE_RULES, false),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);

    const storyboardMaxDuration = (params?.storyboardMaxDuration as number) ?? 14;
    const maxDuration = Math.max(12, Math.min(14, storyboardMaxDuration));
    const minDuration = Math.min(10, maxDuration);
    const dialogueMin = Math.min(11, maxDuration);
    const dialogueMax = Math.min(13, maxDuration);
    const actionMax = Math.min(11, maxDuration);
    const establishingMin = Math.min(12, maxDuration);
    const proportionalTiers =
      `- ${minDuration}-${actionMax}秒镜头：动作驱动型，聚焦单一主动作、明确位移、快速反应\n` +
      `- ${dialogueMin}-${dialogueMax}秒镜头：对白/情绪型，允许停顿、反应、压迫感和表演层次\n` +
      `- ${establishingMin}-${maxDuration}秒镜头：定场/氛围/揭示型，强调空间信息、氛围铺垫和镜头收束`;

    const durationRange = minDuration === maxDuration
      ? String(maxDuration)
      : `${minDuration}-${maxDuration}`;
    const transitionProfileId = normalizeShotTransitionProfileId(
      r("transition_profile_id")
    );
    const transitionPolicy = getShotTransitionPolicyText(transitionProfileId);

    const replaceDuration = (text: string) => text
      .replace(/\{\{MIN_DURATION\}\}-\{\{MAX_DURATION\}\}/g, durationRange)
      .replace(/\{\{MIN_DURATION\}\}/g, String(minDuration))
      .replace(/\{\{MAX_DURATION\}\}/g, String(maxDuration));

    const roleDefinition = replaceDuration(r("role_definition"));

    // Unified metadata-only output format. Image prompts (first/last frame, ref images)
    // are produced by independent downstream prompts and stored in shot_assets table
    // discriminated by type, so both modes can coexist on the same shots.
    const outputFormat = replaceDuration(r("output_format"));

    // Replace dynamic placeholders in cinematography_principles
    let cinematography = r("cinematography_principles");
    cinematography = cinematography
      .replace(/\{\{MIN_DURATION\}\}/g, String(minDuration))
      .replace(/\{\{MAX_DURATION\}\}/g, String(maxDuration))
      .replace(/\{\{DIALOGUE_MIN\}\}/g, String(dialogueMin))
      .replace(/\{\{DIALOGUE_MAX\}\}/g, String(dialogueMax))
      .replace(/\{\{ACTION_MAX\}\}/g, String(actionMax))
      .replace(/\{\{ESTABLISHING_MIN\}\}/g, String(establishingMin));

    // Replace proportional tiers placeholder
    let proportionalSection = r("proportional_tiers");
    proportionalSection = proportionalSection.replace(
      /\{\{PROPORTIONAL_TIERS\}\}/g,
      proportionalTiers
    );

    return [
      roleDefinition,
      "",
      r("script_fidelity"),
      "",
      outputFormat,
      "",
      r("motion_script_rules"),
      "",
      r("video_script_rules"),
      "",
      r("duration_planning_rules"),
      "",
      proportionalSection,
      "",
      r("camera_directions"),
      "",
      cinematography,
      "",
      transitionPolicy,
      "",
      r("language_rules"),
    ].join("\n");
  },
};

// ─── 7.5. shot_split_keyframe_assets ──
// Two independent prompts that take the SAME shot metadata input
// (sceneDescription / motionScript / videoScript / dialogues) and produce
// different image asset prompts. Both write to the unified shot_assets table
// (different `type` values: first_frame/last_frame vs reference). The two
// modes coexist on the same shot — a user can run either or both.

const SHOT_KEYFRAME_ASSETS_ROLE = `你是一位资深的电影摄影师和分镜师。给定一组已经拆好的镜头元数据（每个镜头包含 sceneDescription / motionScript / videoScript / dialogues / characters / cameraDirection），你的任务是为每个镜头生成**首帧（startFrame）**和**尾帧（endFrame）**的图像生成提示词。

首尾帧用途：视频生成器将以首帧作为起始画面，尾帧作为结束画面，自动插值中间动作。所以两帧必须：
1. 描述该镜头的两个稳定时刻——首帧 = 动作开始前的瞬间，尾帧 = 动作完成后的瞬间
2. 共享同一个场景环境（光线、色温、地点必须完全一致）
3. 中间通过 motionScript 描述的动作过渡
4. 严禁运动模糊态——尾帧必须能作为下一个镜头的起始参考`;

const SHOT_KEYFRAME_ASSETS_RULES = `${physicsRealismBlock()}

${themeStyleMappingBlock()}

【角色一致性锚定】
- 每次提到角色，必须用 "角色名（视觉标识）" 格式，视觉标识从下方提供的角色列表中**逐字复用**，禁止改写
- 多角色同框时，每个角色都带自己的视觉标识括号

【提示词写作格式——Seedance / 即梦风格】
使用自然中文散文。禁止权重语法 "（xx：1.99）"，禁止结构化标签。
每个 startFrame / endFrame 是 2-4 句流畅散文，按以下顺序组织：
1. 主体身份与姿态：角色名（视觉标识）+ 明确的身体姿态（站/坐/跪/蹲/趴）+ 双脚位置 + 身体朝向
2. 动作与表情：具体肢体动作、手部位置、视线方向、面部表情
3. 构图与镜头：景别（全景/中景/近景/特写）+ 角度（平视/仰拍/俯拍）+ 焦段
4. 环境光影：光源方向与质感、色温、色彩基调、关键环境细节、氛围

【首帧与尾帧的关系】
- **共享环境**：背景、光线、色温、地点完全一致——只有角色姿态/位置/表情变化
- **首帧**：motionScript 第一段开始前的瞬间——角色处于起始位置，开场表情
- **尾帧**：motionScript 最后一段结束后的瞬间——角色完成动作，停在稳定姿态（不能是模糊运动中态）
- **不要包含对白文字**`;

const SHOT_KEYFRAME_ASSETS_OUTPUT_FORMAT = `输出 JSON 数组，每个镜头一个对象。**prompts 数组必须恰好有 2 个元素：第 0 个是首帧、第 1 个是尾帧**。**characters 数组必须只包含此镜头画面中实际出现的角色**（不是项目里所有角色），名字必须与角色列表中完全一致：
[
  {
    "shotSequence": 1,
    "characters": ["此镜头中实际出现的角色名1", "角色名2"],
    "prompts": [
      "首帧的完整图像生成提示词（中文散文）",
      "尾帧的完整图像生成提示词（中文散文）"
    ]
  }
]
仅输出有效 JSON，不要 markdown 代码块，不要前言。

**characters 字段判定规则**：
- 仅列出在该镜头的 motionScript / videoScript / sceneDescription 中**视觉上出现**的角色
- 仅旁白/画外音对白的角色，如果画面中没出现，不要列入
- 空数组 [] 是合法的（纯环境镜头/空镜头）`;

const shotKeyframeAssetsDef: PromptDefinition = {
  key: "shot_split_keyframe_assets",
  nameKey: "promptTemplates.prompts.shotSplitKeyframeAssets",
  descriptionKey: "promptTemplates.prompts.shotSplitKeyframeAssetsDesc",
  category: "shot",
  slots: [
    slot("role_definition", SHOT_KEYFRAME_ASSETS_ROLE, true),
    slot("rules", SHOT_KEYFRAME_ASSETS_RULES, true),
    slot("output_format", SHOT_KEYFRAME_ASSETS_OUTPUT_FORMAT, false),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [r("role_definition"), "", r("rules"), "", r("output_format")].join(
      "\n"
    );
  },
};

export {
  shotKeyframeAssetsDef,
  shotSplitDef,
};
