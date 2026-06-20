import type { CanvasReferenceRole } from "@/lib/canvas/canvas-reference-slots";
import type { CopyRenderMode } from "@/lib/canvas/copy-render-policy";

export interface WorkflowSkillOutputSlot {
  id: string;
  label: string;
  purpose: string;
  ratio: string;
  samplePhase: boolean;
}

export interface WorkflowSkillPhase {
  id: string;
  label: string;
  description: string;
}

export interface WorkflowSkill {
  id: string;
  title: string;
  shortLabel: string;
  description: string;
  matchTerms: string[];
  platforms: string[];
  outputPacks: string[];
  requiredAssetRoles: CanvasReferenceRole[];
  optionalAssetRoles: CanvasReferenceRole[];
  sampleCount: number;
  fullCount: number;
  defaultCopyRenderMode: CopyRenderMode;
  allowBurnInCopy: boolean;
  phases: WorkflowSkillPhase[];
  outputSlots: WorkflowSkillOutputSlot[];
  qaRules: string[];
}

export interface SelectWorkflowSkillInput {
  brief: string;
  scenario?: string;
  platforms?: string[];
  outputPacks?: string[];
  copyRenderMode?: CopyRenderMode;
}

export const DEFAULT_WORKFLOW_SKILL_ID = "workflow.taobao_detail.v1";

const sharedCommercePhases: WorkflowSkillPhase[] = [
  {
    id: "asset-lock",
    label: "锁定资产",
    description: "提取商品、模特、场景、风格和文案的独立职责，避免多参考图互相污染。",
  },
  {
    id: "plan-pack",
    label: "规划图组",
    description: "先决定图组槽位、比例、平台规则和样张数量，再进入真实生成。",
  },
  {
    id: "sample-run",
    label: "样张验证",
    description: "先跑少量代表性图片验证方向、成本和 provider 状态。",
  },
  {
    id: "qa-rerun",
    label: "质检重做",
    description: "按商品一致性、空间光影、文案可读性和平台规则做单张重试。",
  },
];

const referenceAssetPhases: WorkflowSkillPhase[] = [
  {
    id: "understand-asset",
    label: "理解素材目标",
    description: "判断用户要生成的是模特、场景、风格、文案知识还是概念素材，不把它误判成最终商品成片。",
  },
  {
    id: "define-reference-role",
    label: "定义参考职责",
    description: "把素材写成可复用参考：模特只服务身份，场景服务空间光影，风格服务摄影语言，文案服务结构化信息。",
  },
  {
    id: "generate-preview",
    label: "生成预览",
    description: "先生成少量可挑选的参考素材，满意后再保存到素材库供项目复用。",
  },
  {
    id: "save-asset",
    label: "保存复用",
    description: "给素材命名、标注类型和可复用约束，让后续 Agent 能正确调用。",
  },
];

export const WORKFLOW_SKILL_REGISTRY: WorkflowSkill[] = [
  {
    id: "workflow.reference_asset.v1",
    title: "参考素材生成 Agent",
    shortLabel: "参考素材",
    description: "生成可复用的模特、场景、风格、文案/知识参考素材，不把素材生成误判成最终商业成片。",
    matchTerms: [
      "reference_asset",
      "scene_asset",
      "style_asset",
      "visual_style",
      "model_asset",
      "character_sheet",
      "identity_reference",
      "prompt_asset",
      "concept_product",
      "concept mockup",
      "素材资产",
      "参考资产",
      "参考素材",
      "场景资产",
      "风格资产",
      "模特资产",
      "文案资产",
      "知识资产",
      "模卡",
      "身份参考",
      "下游身份参考",
      "拍摄风格参考",
      "概念商品",
      "概念产品",
      "方向探索",
    ],
    platforms: ["asset_library"],
    outputPacks: ["commercial.output_pack.reference_assets"],
    requiredAssetRoles: [],
    optionalAssetRoles: ["model", "scene", "style", "copy"],
    sampleCount: 3,
    fullCount: 8,
    defaultCopyRenderMode: "metadata_only",
    allowBurnInCopy: false,
    phases: referenceAssetPhases,
    outputSlots: [
      { id: "scene-reference", label: "场景参考", purpose: "可复用空间、透视、光源方向、阴影和落位区", ratio: "3:2", samplePhase: true },
      { id: "style-reference", label: "风格参考", purpose: "可复用拍摄语言、色调、镜头感和商业完成度", ratio: "3:2", samplePhase: true },
      { id: "model-identity", label: "模特身份参考", purpose: "可复用人物身份、脸型、发型轮廓、身形和气质，避免锁死神态", ratio: "3:2", samplePhase: true },
      { id: "copy-knowledge", label: "文案知识", purpose: "可复用卖点、禁止声明、导出文案和画面文字候选", ratio: "auto", samplePhase: false },
    ],
    qaRules: [
      "参考素材不是最终商品成片；不要要求真实商品身份锁定。",
      "模特素材要避免棚拍神态锁死，优先自然漫反射光和可下游合成的身份参考。",
      "场景素材应交代空间、透视、光源方向、阴影和可放置商品的区域。",
      "风格素材只描述拍摄语言和完成度，不覆盖未来商品或人物身份。",
      "文案素材必须结构化保存，不默认烧进图片。",
    ],
  },
  {
    id: "workflow.product_scene.v1",
    title: "商品场景/静物图组 Agent",
    shortLabel: "商品场景",
    description: "生成无人物商品静物、场景图、材质细节和通用商品海报，不套用平台主图规则。",
    matchTerms: [
      "product_scene",
      "product_still",
      "still life",
      "lifestyle product",
      "商品静物",
      "产品静物",
      "商品场景",
      "产品场景",
      "无人物商品",
      "无模特商品",
      "静物图",
    ],
    platforms: ["storefront"],
    outputPacks: ["commercial.output_pack.product_scene"],
    requiredAssetRoles: ["product"],
    optionalAssetRoles: ["scene", "style", "copy"],
    sampleCount: 4,
    fullCount: 10,
    defaultCopyRenderMode: "layout_layer",
    allowBurnInCopy: true,
    phases: sharedCommercePhases,
    outputSlots: [
      { id: "still", label: "商品静物", purpose: "清楚展示商品主体、材质和真实接触阴影", ratio: "3:2", samplePhase: true },
      { id: "scene", label: "商品场景", purpose: "商品自然放入环境，空间和光影成立", ratio: "3:2", samplePhase: true },
      { id: "detail", label: "商品细节", purpose: "展示材质、五金、结构或功能证据", ratio: "4:5", samplePhase: true },
      { id: "poster", label: "商品海报", purpose: "保留画面安全区，可按需烧短文案", ratio: "4:5", samplePhase: true },
    ],
    qaRules: [
      "无人物/无模特请求不得调用模特资产或模特展示槽位。",
      "商品身份、结构、比例、颜色和材质必须来自真实商品参考。",
      "场景只负责空间、光影和接触阴影，不改商品。",
    ],
  },
  {
    id: "workflow.taobao_detail.v1",
    title: "淘宝详情页图组 Agent",
    shortLabel: "淘宝详情页",
    description: "把一个商品需求拆成主图、卖点、材质、场景、模特和收尾转化模块。",
    matchTerms: ["taobao", "tmall", "淘宝", "天猫", "详情页", "商品详情", "卖点图", "主图", "detail_page", "product_detail_page"],
    platforms: ["taobao"],
    outputPacks: ["commercial.output_pack.taobao_detail"],
    requiredAssetRoles: ["product"],
    optionalAssetRoles: ["model", "scene", "style", "copy"],
    sampleCount: 5,
    fullCount: 18,
    defaultCopyRenderMode: "layout_layer",
    allowBurnInCopy: true,
    phases: sharedCommercePhases,
    outputSlots: [
      { id: "main", label: "主图", purpose: "商品第一眼卖点和统一视觉基调", ratio: "1:1", samplePhase: true },
      { id: "feature", label: "卖点图", purpose: "把一个核心卖点转成可见证据", ratio: "3:4", samplePhase: true },
      { id: "material", label: "材质细节", purpose: "展示面料、纹理、结构和工艺", ratio: "4:5", samplePhase: true },
      { id: "model", label: "模特展示", purpose: "让商品在真实人体/姿态中成立", ratio: "4:5", samplePhase: true },
      { id: "scene", label: "场景图", purpose: "让商品在使用环境中自然出现", ratio: "4:5", samplePhase: true },
      { id: "closing", label: "收尾图", purpose: "保留文案区，承接转化信息", ratio: "3:4", samplePhase: false },
    ],
    qaRules: [
      "商品结构、颜色、材质和关键细节不能被改写。",
      "详情页文案默认作为 layout/copy layer；只有用户明确要求带字图才烧进图片。",
      "每张图只讲一个卖点，避免一张图里塞满信息。",
    ],
  },
  {
    id: "workflow.amazon_listing.v1",
    title: "Amazon Listing 图组 Agent",
    shortLabel: "Amazon 图组",
    description: "生成白底主图、信息图、尺寸图、生活方式图和包装图，优先遵守平台合规。",
    matchTerms: ["amazon", "亚马逊", "listing", "asin", "跨境", "主图", "白底", "amazon_listing", "white_background"],
    platforms: ["amazon"],
    outputPacks: ["commercial.output_pack.amazon_main"],
    requiredAssetRoles: ["product"],
    optionalAssetRoles: ["scene", "style", "copy"],
    sampleCount: 4,
    fullCount: 9,
    defaultCopyRenderMode: "layout_layer",
    allowBurnInCopy: true,
    phases: sharedCommercePhases,
    outputSlots: [
      { id: "white-main", label: "白底主图", purpose: "合规、完整、无多余元素的商品主图", ratio: "1:1", samplePhase: true },
      { id: "infographic", label: "信息图", purpose: "可选带短文案的卖点解释图", ratio: "1:1", samplePhase: true },
      { id: "dimensions", label: "尺寸图", purpose: "解释比例、结构和使用尺度", ratio: "1:1", samplePhase: true },
      { id: "lifestyle", label: "场景图", purpose: "展示真实使用场景", ratio: "1:1", samplePhase: true },
      { id: "package", label: "包装图", purpose: "展示开箱和组合内容", ratio: "1:1", samplePhase: false },
    ],
    qaRules: [
      "白底主图不得出现营销文字、徽章、道具或不售卖配件。",
      "信息图可以测试 Imagen 2 文本能力，但必须限制为短句并保留无字备选。",
      "商品 logo 和五金区域不得幻觉重画。",
    ],
  },
  {
    id: "workflow.xiaohongshu_cover.v1",
    title: "小红书种草图组 Agent",
    shortLabel: "小红书",
    description: "规划封面、生活方式、卖点拆解和收藏引导，优先缩略图吸引力和真实感。",
    matchTerms: ["小红书", "种草", "封面", "笔记", "社媒", "social", "xiaohongshu", "xiaohongshu_cover"],
    platforms: ["xiaohongshu"],
    outputPacks: ["commercial.output_pack.xiaohongshu_cover"],
    requiredAssetRoles: ["product"],
    optionalAssetRoles: ["model", "scene", "style", "copy"],
    sampleCount: 4,
    fullCount: 12,
    defaultCopyRenderMode: "layout_layer",
    allowBurnInCopy: true,
    phases: sharedCommercePhases,
    outputSlots: [
      { id: "cover", label: "封面", purpose: "一眼读懂主题，预留标题区", ratio: "3:4", samplePhase: true },
      { id: "use-case", label: "使用场景", purpose: "真实日常使用感", ratio: "4:5", samplePhase: true },
      { id: "detail", label: "细节卖点", purpose: "放大材料和功能证据", ratio: "1:1", samplePhase: true },
      { id: "save", label: "收藏引导", purpose: "统一收尾风格和可编辑文案区", ratio: "3:4", samplePhase: true },
    ],
    qaRules: [
      "封面文案默认不烧进图，除非用户明确要测试带字封面。",
      "人物动作要有生活动机，减少摆拍感。",
      "产品必须在缩略图尺寸下仍清楚。",
    ],
  },
  {
    id: "workflow.model_showcase.v1",
    title: "模特展示图组 Agent",
    shortLabel: "模特展示",
    description: "用商品和模特资产生成姿态、角度和场景变化，但保持身份和商品结构稳定。",
    matchTerms: ["模特", "model", "穿着", "上身", "拿着", "手持", "展示图", "lookbook", "model_showcase", "model_try_on", "handheld_product"],
    platforms: ["storefront"],
    outputPacks: ["commercial.output_pack.model_display"],
    requiredAssetRoles: ["product"],
    optionalAssetRoles: ["model", "scene", "style", "copy"],
    sampleCount: 4,
    fullCount: 12,
    defaultCopyRenderMode: "layout_layer",
    allowBurnInCopy: false,
    phases: sharedCommercePhases,
    outputSlots: [
      { id: "front", label: "正面展示", purpose: "商品和人体比例清楚", ratio: "4:5", samplePhase: true },
      { id: "side", label: "侧身展示", purpose: "侧面廓形和使用动作", ratio: "4:5", samplePhase: true },
      { id: "detail", label: "半身细节", purpose: "材质、手部、商品接触关系", ratio: "4:5", samplePhase: true },
      { id: "scene", label: "场景展示", purpose: "人物、商品和环境光影一致", ratio: "3:2", samplePhase: true },
    ],
    qaRules: [
      "模特资产只管身份和身体气质，不复制原始棚拍光。",
      "姿势要有行为动机，不要空站。",
      "商品与手、肩、身体的接触关系必须可信。",
    ],
  },
  {
    id: "workflow.poster_campaign.v1",
    title: "商业海报组图 Agent",
    shortLabel: "海报组图",
    description: "生成竖版、横版、方图和无字本地化版本，保证同一视觉语言。",
    matchTerms: ["海报", "poster", "banner", "活动", "campaign", "主视觉", "组图", "poster_set"],
    platforms: ["campaign"],
    outputPacks: ["commercial.output_pack.poster_campaign"],
    requiredAssetRoles: ["product"],
    optionalAssetRoles: ["style", "scene", "copy", "model"],
    sampleCount: 3,
    fullCount: 10,
    defaultCopyRenderMode: "layout_layer",
    allowBurnInCopy: true,
    phases: sharedCommercePhases,
    outputSlots: [
      { id: "vertical", label: "竖版海报", purpose: "主视觉和核心标题区", ratio: "9:16", samplePhase: true },
      { id: "banner", label: "横版 Banner", purpose: "店铺或广告位横幅", ratio: "16:9", samplePhase: true },
      { id: "square", label: "方图", purpose: "社媒和活动入口", ratio: "1:1", samplePhase: true },
      { id: "textless", label: "无字版", purpose: "便于本地化和后期排版", ratio: "auto", samplePhase: false },
    ],
    qaRules: [
      "默认输出无字或可编辑文案层版本，带字版作为显式实验分支。",
      "一组图必须共享色彩、材质、光影和构图节奏。",
      "主视觉不能牺牲商品可识别性。",
    ],
  },
];

export function selectWorkflowSkill(input: SelectWorkflowSkillInput): WorkflowSkill {
  const text = [
    input.brief,
    input.scenario,
    ...(input.platforms ?? []),
    ...(input.outputPacks ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (isReferenceAssetWorkflowIntent(text)) {
    const referenceSkill = WORKFLOW_SKILL_REGISTRY.find((skill) => skill.id === "workflow.reference_asset.v1");
    if (referenceSkill) return referenceSkill;
  }

  const scored = WORKFLOW_SKILL_REGISTRY.map((skill, index) => ({
    skill,
    score: scoreWorkflowSkill(skill, text, input) - index * 0.001,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].skill : getDefaultWorkflowSkill();
}

export function getDefaultWorkflowSkill(): WorkflowSkill {
  return WORKFLOW_SKILL_REGISTRY.find((skill) => skill.id === DEFAULT_WORKFLOW_SKILL_ID) ?? WORKFLOW_SKILL_REGISTRY[0];
}

function scoreWorkflowSkill(
  skill: WorkflowSkill,
  text: string,
  input: SelectWorkflowSkillInput
): number {
  let score = 0;
  const explicitNoModelIntent = hasExplicitNoModelIntent(text);
  if (skill.id === "workflow.model_showcase.v1" && explicitNoModelIntent) {
    return -20;
  }
  if (skill.id === "workflow.reference_asset.v1" && isReferenceAssetWorkflowIntent(text)) {
    score += 30;
  }
  for (const term of skill.matchTerms) {
    if (text.includes(term.toLowerCase())) score += term.length > 4 ? 4 : 3;
  }
  for (const platform of input.platforms ?? []) {
    if (skill.platforms.some((item) => item.toLowerCase() === platform.toLowerCase())) score += 8;
  }
  for (const pack of input.outputPacks ?? []) {
    if (skill.outputPacks.some((item) => item.toLowerCase() === pack.toLowerCase())) score += 8;
  }
  const productModelSceneIntent = detectProductModelSceneIntent(text);
  const multiChannelCommerceIntent = detectMultiChannelCommerceIntent(text);
  const explicitPlatformWorkflowIntent = detectExplicitPlatformWorkflowIntent(text);
  const mixedCommercePackIntent = detectMixedCommercePackIntent(text);
  const productOnlyCommerceIntent =
    explicitNoModelIntent &&
    productModelSceneIntent.hasProduct &&
    !explicitPlatformWorkflowIntent;
  if (
    explicitNoModelIntent &&
    productModelSceneIntent.hasProduct &&
    productModelSceneIntent.hasScene &&
    skill.id === "workflow.product_scene.v1"
  ) {
    score += 12;
  }
  if (productOnlyCommerceIntent) {
    if (skill.id === "workflow.product_scene.v1") score += 18;
    if (skill.id === "workflow.taobao_detail.v1") score -= 12;
    if (skill.id === "workflow.model_showcase.v1") score -= 20;
  }
  if (
    !explicitPlatformWorkflowIntent &&
    productModelSceneIntent.hasProduct &&
    productModelSceneIntent.hasScene &&
    !productModelSceneIntent.hasModel
  ) {
    if (skill.id === "workflow.product_scene.v1") score += 16;
    if (skill.id === "workflow.poster_campaign.v1" && !hasExplicitPosterCampaignIntent(text)) score -= 12;
    if (skill.id === "workflow.taobao_detail.v1") score -= 6;
  }
  if (productModelSceneIntent.hasProduct && productModelSceneIntent.hasModel) {
    if (skill.id === "workflow.model_showcase.v1") {
      score += explicitPlatformWorkflowIntent && !hasExplicitModelShowcaseIntent(text)
        ? 1
        : multiChannelCommerceIntent
          ? 2
          : productModelSceneIntent.hasScene
            ? 14
            : 10;
    }
    if (
      skill.id === "workflow.poster_campaign.v1" &&
      productModelSceneIntent.hasScene &&
      !hasExplicitPosterCampaignIntent(text)
    ) {
      score -= 8;
    }
  }
  if (mixedCommercePackIntent) {
    if (
      !explicitPlatformWorkflowIntent &&
      productModelSceneIntent.hasProduct &&
      productModelSceneIntent.hasScene &&
      !productModelSceneIntent.hasModel &&
      skill.id === "workflow.product_scene.v1"
    ) {
      score += 14;
    }
    if (skill.id === "workflow.taobao_detail.v1") score += explicitPlatformWorkflowIntent ? 14 : 10;
    if (skill.id === "workflow.poster_campaign.v1") score += 6;
    if (skill.id === "workflow.model_showcase.v1" && !isModelOnlyPackIntent(text)) score -= 16;
  }
  if (input.copyRenderMode === "burn_in" && skill.allowBurnInCopy) score += 1;
  if (multiChannelCommerceIntent && skill.id === "workflow.taobao_detail.v1") score += 6;
  return score;
}

function detectMultiChannelCommerceIntent(text: string): boolean {
  let channels = 0;
  if (/淘宝|天猫|taobao|tmall|详情页|商品详情|卖点图|主图/.test(text)) channels += 1;
  if (/amazon|亚马逊|listing|asin|跨境/.test(text)) channels += 1;
  if (/小红书|种草|笔记|xiaohongshu|rednote/.test(text)) channels += 1;
  if (hasExplicitPosterCampaignIntent(text)) channels += 1;

  return channels >= 2 || /跨平台|多平台|全渠道|多渠道/.test(text);
}

function detectExplicitPlatformWorkflowIntent(text: string): boolean {
  return /淘宝|天猫|taobao|tmall|详情页|商品详情|amazon|亚马逊|listing|asin|小红书|种草|笔记|xiaohongshu|rednote/.test(text) ||
    hasExplicitPosterCampaignIntent(text);
}

function detectMixedCommercePackIntent(text: string): boolean {
  if (!/(商品|产品|product)/.test(text)) return false;
  let deliverables = 0;
  if (/主图|商品主图|产品主图|main image|hero/.test(text)) deliverables += 1;
  if (/场景图|客厅|卧室|室内|户外|街拍|生活方式|lifestyle|scene/.test(text)) deliverables += 1;
  if (/模特|真人|人物|拿着|手持|佩戴|model|person/.test(text)) deliverables += 1;
  if (/海报|banner|宣传图|活动图|poster/.test(text)) deliverables += 1;
  if (/细节|特写|卖点|详情|detail|feature/.test(text)) deliverables += 1;
  return deliverables >= 3;
}

function hasExplicitModelShowcaseIntent(text: string): boolean {
  return /\b(model_showcase|model\s+display|lookbook|try[-\s]?on)\b/.test(text) ||
    /(模特展示|真人展示|上身图|试穿|穿搭图|lookbook)/.test(text);
}

function isModelOnlyPackIntent(text: string): boolean {
  return hasExplicitModelShowcaseIntent(text) &&
    !/(主图|商品主图|产品主图|海报|banner|宣传图|细节|特写|卖点|详情|detail|feature)/.test(text);
}

export function isReferenceAssetWorkflowIntent(text: string): boolean {
  const normalized = text.toLowerCase();
  if (/\b(reference_asset|scene_asset|style_asset|visual_style|model_asset|character_sheet|identity_reference|prompt_asset|concept_product|concept\s+mockup)\b/.test(normalized)) {
    return true;
  }

  const assetTarget = /(素材资产|参考资产|参考素材|场景资产|风格资产|模特资产|文案资产|知识资产|模卡|身份参考|下游身份参考|拍摄风格参考|概念商品|概念产品|方向探索)/;
  if (!assetTarget.test(normalized)) return false;

  const assetCreationIntent = new RegExp(
    "(生成|创建|新建|做|制作|产出|保存|整理|补一个|来一个).{0,16}" + assetTarget.source + "|" +
    assetTarget.source + ".{0,16}(生成|创建|新建|做|制作|产出|保存|整理)"
  );
  const finalDeliverableIntent = /(真实生成|成片|宣传图|主图|详情页|商品详情|商品图|产品图|海报|banner|场景图|模特展示|图组|投放|输出)/;

  return assetCreationIntent.test(normalized) && !finalDeliverableIntent.test(normalized);
}

function detectProductModelSceneIntent(text: string): {
  hasProduct: boolean;
  hasModel: boolean;
  hasScene: boolean;
} {
  const modelIntentText = stripNegativeModelIntent(text);
  return {
    hasProduct:
      /\b(product|bag|handbag|purse|plush|phone|camera|watch|shoes?|clothing|dress|coat|jacket|sneaker)\b/.test(text) ||
      /(商品|产品|包|女包|手袋|毛绒|手机|相机|手表|鞋|服装|衣服|外套|羽绒服)/.test(text),
    hasModel:
      /\b(model|wearing|wear|holding|carry|carrying|showcase|lookbook|portrait|person|woman|man)\b/.test(modelIntentText) ||
      /(模特|穿着|上身|背着|拿着|手拿|手持|真人|人物|女性|男性|真人展示|模特展示|人物展示|上身展示|背着展示|佩戴展示)/.test(modelIntentText),
    hasScene:
      /\b(scene|location|street|cafe|interior|outdoor|indoor|shop|mall|home|room|corner|seated)\b/.test(text) ||
      /(场景|实景|街拍|街头|室内|户外|咖啡|商场|花店|家居|房间|雪山|坐姿)/.test(text),
  };
}

function stripNegativeModelIntent(text: string): string {
  return text.replace(
    /no model|no person|without model|without person|product[-_ ]?only|纯商品图?|只要商品图?|商品静物|无模特|无人物|不要模特|不要人物|不需要模特|不需要人物|不用模特|不用人物|不带模特|不带人物|不要使用模特|不要使用人物|无需模特|无需人物|模特不要|人物不要/g,
    " "
  );
}

function hasExplicitNoModelIntent(text: string): boolean {
  return /no model|no person|without model|without person|product[-_ ]?only|纯商品图?|只要商品图?|商品静物|无模特|无人物|不要模特|不要人物|不需要模特|不需要人物|不用模特|不用人物|不带模特|不带人物|不要使用模特|不要使用人物|无需模特|无需人物|模特不要|人物不要/.test(text);
}

function hasExplicitPosterCampaignIntent(text: string): boolean {
  return /\b(poster\s+campaign|campaign\s+poster|poster\s+set|banner\s+set)\b/.test(text) ||
    /(海报组图|海报套图|活动海报|主视觉海报|全套海报)/.test(text);
}
