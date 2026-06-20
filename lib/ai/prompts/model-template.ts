import type {
  CreateModelParams,
  ModelAssetMetadata,
  ModelReferenceProfile,
} from "@/lib/types";

// ============================================================
// 内部类型
// ============================================================

export type ModelProfile = ModelReferenceProfile;

// ============================================================
// 用户输入 → 内部字段映射
// ============================================================

const IDENTITY_REGION_MAP: Record<string, string> = {
  asian: "East Asian",
  european: "European",
  african: "African",
};

const TEMPERAMENT_MAP: Record<string, string> = {
  intellectual: "bright, clean, approachable",
  energetic: "energetic, vibrant, confident",
  gentle: "gentle, warm, soft",
  business: "professional, composed, sharp",
  cool: "cool, contemporary, poised",
};

const BEAUTY_STYLE_MAP: Record<string, string> = {
  intellectual: "natural refined beauty",
  energetic: "fresh energetic beauty",
  gentle: "soft gentle beauty",
  business: "polished professional beauty",
  cool: "modern editorial beauty",
};

const HAIR_MAP: Record<string, string> = {
  long: "long straight dark hair",
  short: "short neat dark hair",
  mid: "medium-length dark hair",
  tied: "dark hair tied back in a clean low ponytail",
};

const MAKEUP_MAP: Record<string, string> = {
  natural: "natural no-makeup look, flawless clean skin",
  light: "light elegant makeup, subtle enhancement, clean skin",
};

// ============================================================
// 市场上下文默认
// ============================================================

const MARKET_CONTEXT_MAP: Record<string, string> = {
  asian: "Mainland China everyday e-commerce",
  european: "global e-commerce catalog",
  african: "global e-commerce catalog",
};

// ============================================================
// 体型预设
// ============================================================

const BODY_PROFILE_PRESETS: Record<string, string> = {
  slim: "168 cm, slim straight frame, modest bust silhouette, narrow waist, subtle hip curve",
  standard:
    "172 cm, slim-to-average frame, average natural bust silhouette, balanced waist-to-hip shape",
  athletic:
    "172 cm, athletic medium frame, average-to-fuller natural bust silhouette, toned shoulders, defined waist",
};

// ============================================================
// 默认服装（基准 outfit，logo-free）
// ============================================================

const DEFAULT_WARDROBE = [
  "Neutral studio fitting casual outfit:",
  "clean fitted plain off-white crew-neck T-shirt,",
  "medium muted-blue high-waisted slim straight-leg jeans,",
  "clean white low-profile sneakers,",
  "minimal small stud earrings.",
  "No logo, no print, no ripped denim, no oversized fit, no fashion styling.",
].join(" ");

// ============================================================
// 面部锚点生成（基于族裔 + 性别 + 气质）
// ============================================================

function buildFaceAnchors(ethnicity: string, gender: string, temperament: string): string {
  // 基础面型
  const faceShapes: Record<string, string> = {
    asian: "soft oval face",
    european: "defined oval face",
    african: "balanced oval face",
  };

  // 眼型
  const eyeShapes: Record<string, string> = {
    asian: "almond-shaped dark brown eyes with natural double eyelid",
    european: "almond-shaped eyes",
    african: "almond-shaped dark brown eyes",
  };

  // 眉型
  const browMap: Record<string, string> = {
    intellectual: "soft natural arched brows",
    energetic: "defined straight brows",
    gentle: "soft straight brows",
    business: "clean defined brows",
    cool: "straight natural brows",
  };

  // 鼻型
  const noseMap: Record<string, string> = {
    asian: "refined straight nose with natural bridge",
    european: "defined straight nose",
    african: "defined nose with natural bridge",
  };

  // 唇型
  const lipMap: Record<string, string> = {
    intellectual: "natural lips with subtle definition",
    energetic: "defined natural lips",
    gentle: "soft natural lips",
    business: "clean defined lips",
    cool: "natural lips",
  };

  // 面部气质
  const faceTemperamentMap: Record<string, string> = {
    intellectual: "calm intelligent expression",
    energetic: "bright engaged expression",
    gentle: "warm approachable expression",
    business: "composed professional expression",
    cool: "confident poised expression",
  };

  return [
    faceShapes[ethnicity] || "balanced oval face",
    (eyeShapes[ethnicity] || "almond-shaped eyes") + ",",
    (browMap[temperament] || "natural brows") + ",",
    (noseMap[ethnicity] || "refined nose") + ",",
    (lipMap[temperament] || "natural lips") + ",",
    "natural refined cheekbones and jawline,",
    "clear even skin tone,",
    faceTemperamentMap[temperament] || "natural expression",
  ].join(" ");
}

// ============================================================
// 主入口：简单参数 → 完整 ModelProfile（默认值自动补全）
// ============================================================

export function buildModelProfile(params: CreateModelParams): ModelProfile {
  const ethnicity = params.ethnicity || "asian";
  const temperament = params.temperament || "intellectual";

  return {
    identityRegion: IDENTITY_REGION_MAP[ethnicity] || ethnicity,
    age: params.age,
    gender: params.gender,
    temperament: TEMPERAMENT_MAP[temperament] || temperament,
    beautyStyle: BEAUTY_STYLE_MAP[temperament] || "natural refined beauty",
    hair: params.hairStyle ? HAIR_MAP[params.hairStyle] || params.hairStyle : "long straight dark hair",
    makeup: params.makeup ? MAKEUP_MAP[params.makeup] || params.makeup : "natural no-makeup look, flawless clean skin",
    faceAnchors: buildFaceAnchors(ethnicity, params.gender, temperament),
    marketContext: MARKET_CONTEXT_MAP[ethnicity] || "global e-commerce catalog",
    bodyProfile: BODY_PROFILE_PRESETS[params.bodyType] || BODY_PROFILE_PRESETS["standard"],
    wardrobe: DEFAULT_WARDROBE,
  };
}

export function buildModelAssetMetadata(
  params: CreateModelParams,
  options: { imageUrl?: string; promptSnapshot?: string } = {}
): ModelAssetMetadata {
  const p = buildModelProfile(params);
  const identityAnchors = [
    `${p.age}-year-old adult ${p.identityRegion} ${p.gender}`,
    p.faceAnchors,
    p.hair,
    p.makeup,
    p.bodyProfile,
    p.temperament,
  ];
  const consistencyRules = [
    "Use the same exact adult model identity across all generated images in the group.",
    "Keep facial features, hairstyle, age impression, body proportions, and temperament consistent.",
    "Do not mix this model identity with product, outfit, or scene references.",
    "For final campaign images, use the downstream identity reference zone rather than treating the full library display card as the scene/pose reference.",
  ];
  const poseRules = [
    "Use functional commercial model poses with full-body or half-body visibility as requested.",
    "Prefer neutral standing, light walking, or natural catalog gestures unless a scene template asks otherwise.",
    "Avoid seductive posing, exaggerated body curves, or identity-changing extreme angles.",
    "Do not copy the model card's fixed expression, gaze, standing pose, panel layout, or studio lighting into downstream campaign images.",
  ];
  const usageRules = [
    "Suitable for e-commerce model display, social commerce posts, poster visuals, and product detail scenes.",
    "Treat the model as a reusable person asset; product details should come from product references.",
    "Use wardrobe only as neutral baseline unless the image recipe explicitly replaces it.",
    "When a scene or product plan gives a pose, expression, or lighting direction, that plan overrides the model card pose and light.",
  ];
  const downstreamReferenceRules = [
    "Prefer the downstream identity reference zone for final image generation.",
    "Preserve identity anchors only: face geometry, facial proportions, hair silhouette, age impression, body proportions, and temperament.",
    "Do not preserve model-card pose, facial expression, gaze direction, panel layout, background, or lighting.",
    "Scene lighting and the current shot's pose instructions override the model asset sheet.",
  ];
  const safetyRules = [
    "Adult professional model only.",
    "Non-sexual commercial presentation.",
    "Opaque fabric, high coverage, no lingerie styling, no sheer fabric, no provocative expression.",
  ];
  const promptFragments = [
    "Consistent professional adult model identity for commercial imagery.",
    `Model identity: ${identityAnchors.slice(0, 4).join(", ")}.`,
    `Market context: ${p.marketContext}.`,
  ];
  const constraints = [
    ...consistencyRules,
    ...poseRules,
    "Keep the model identity independent from product texture, brand, logo, and packaging details.",
    ...downstreamReferenceRules,
  ];
  const negativeRules = [
    "Do not copy product material into the model face, hair, or skin.",
    "Do not change ethnicity, age impression, hairstyle, face anchors, or body profile between images.",
    "No duplicate limbs, distorted face, watermark, dense text, or measurement ruler.",
    ...safetyRules.slice(1),
  ];
  const qualityRules = [
    "Clean refined commercial rendering with large-area diffuse reflected light, matte ambient wrap, and very low contrast.",
    "Avoid baking in white-background studio lighting, strong frontal fill, beauty-dish catchlights, or glossy portrait retouching.",
    "Natural skin tone, stable facial identity, coherent anatomy, and clean subject-background separation.",
    "Model should support the product or scene without overpowering the commercial image objective.",
    "Downstream outputs should relight the person according to the scene, not according to the model card.",
  ];
  const referenceImages = options.imageUrl ? [options.imageUrl] : [];

  return {
    schemaVersion: 1,
    source: "model-template",
    sourceParams: params,
    profile: p,
    identityAnchors,
    consistencyRules,
    poseRules,
    usageRules,
    safetyRules,
    promptFragments,
    constraints,
    negativeRules,
    qualityRules,
    referenceImages,
    promptSnapshot: options.promptSnapshot,
    downstreamReferenceMode: "prefer_zone_b_neutral_identity_reference",
    downstreamReferenceRules,
  };
}

// ============================================================
// 模块化提示词合成
// ============================================================

export function buildModelPrompt(params: CreateModelParams): string {
  const p = buildModelProfile(params);

  const sections = [
    // ── 第1层：固定版式 ──
    [
      "Professional commercial model card / character reference sheet,",
      "1536x1024 target when supported, 3:2 landscape aspect ratio,",
      "warm light-gray or soft beige matte neutral background across the whole card,",
      "clean editorial grid layout,",
      "spacious and minimal high-end commercial presentation,",
      "compact downstream-compositing identity-card proportions: left large identity portrait, center four-view full-body turn-around area, right one large close-up portrait plus three small expression portraits only,",
      "subtle precise panel borders and consistent spacing,",
      "large-area diffuse reflected daylight and very low contrast across every panel.",
    ].join(" "),

    // ── 一致性约束 ──
    [
      "The same exact adult professional model appears in every panel of this sheet,",
      "with identical facial features, same hairstyle, same body proportions,",
      "same age, same wardrobe, and consistent temperament across all panels.",
    ].join(" "),

    // ── 布局 ──
    [
      "Layout:",
      "Main center-left section: full-body turn-around views, front, 3/4, side, back,",
      "neutral standing pose, full body visible, large-area diffuse reflected daylight, aligned to the same height, clean spacing.",
      "Left column: one large clean close-up portrait for identity plus tiny abstract identity/color placeholders only, no height ruler, no measurement scale, no dense text.",
      "Right column: one large clean close-up portrait plus exactly three small expression portraits: neutral, natural soft smile, focused or slightly serious.",
      "Do not create a multi-angle head grid, long expression row, dense contact sheet, many headshots, or busy palette board.",
    ].join(" "),

    // ── 第2层：身份层 ──
    [
      "Model identity:",
      `${p.age}-year-old adult ${p.identityRegion} ${p.gender} professional model,`,
      `${p.temperament},`,
      `${p.beautyStyle},`,
      `${p.hair},`,
      `${p.makeup}.`,
    ].join(" "),

    // ── 面部锚点层 ──
    [
      "Distinct facial identity:",
      p.faceAnchors + ".",
    ].join(" "),

    // ── 第3层：市场上下文层 ──
    [
      "Market context:",
      p.marketContext + ".",
    ].join(" "),

    // ── 第4层：体型层 ──
    [
      "Body profile:",
      p.bodyProfile + ",",
      "balanced natural proportions, not exaggerated, not glamour styling.",
    ].join(" "),

    // ── 第5层：服装层 ──
    [
      "Wardrobe:",
      p.wardrobe,
    ].join(" "),

    // ── 第6层：安全约束层 ──
    [
      "Safety and tone:",
      "Functional commercial model reference, non-sexual, neutral standing pose,",
      "professional presentation, opaque fabric, high coverage,",
      "no seductive pose, no lingerie styling, no sheer fabric,",
      "no cleavage emphasis, no provocative expression.",
    ].join(" "),

    // ── 参考图指令 ──
    [
      "Reference image instruction:",
      "If the reference image shows a real or generated person intended as the model source, use it as the identity anchor:",
      "preserve face geometry, age impression, ethnicity cues, hairstyle, body proportions, gaze character, and temperament.",
      "If the reference image is only a layout/template sheet, use it only for spacing, multi-angle card organization,",
      "editorial cleanliness, and commercial model-card presentation.",
      "If the reference image is an older dense model card, simplify it into the compact layout: four full-body views, one main face close-up, and only three small expressions.",
      "Do not copy white-background studio lighting, hard key light, beauty retouching, or portrait catchlights from the reference image.",
    ].join(" "),

    // ── 画质层 ──
    [
      "Quality:",
      "Clean refined commercial rendering, soft diffuse reflected light, matte ambient wrap, very low contrast,",
      "minimal visual noise. Natural skin texture, even but not plastic complexion,",
      "no glossy beauty retouching and no separate face exposure.",
    ].join(" "),

    // ── 负向约束 ──
    [
      "Negative constraints:",
      "No height ruler, no measurement scale, no dense text, no watermark,",
      "no long expression row, no many-head grid, no cluttered contact sheet,",
      "no duplicate limbs, no distorted faces, no artifacts, no harsh shadows,",
      "no pure white seamless backdrop, no beauty dish lighting, no strong frontal fill,",
      "no hard directional face key light, no over-sharpening, no exaggerated curves.",
    ].join(" "),
  ];

  return sections.join("\n\n");
}
