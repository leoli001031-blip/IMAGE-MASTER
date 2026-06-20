import {
  buildModelAssetMetadata,
  buildModelProfile,
} from "@/lib/ai/prompts/model-template";
import type { CreateModelParams, ModelAssetMetadata } from "@/lib/types";
import { buildAssetPackGenerationPlan, type AssetPackGenerationPlan } from "./asset-pack-generation";
import type { AssetPackDraft } from "./asset-pack-types";

const MODEL_TEMPLATE_PROMPT_FAMILY = "model-template.character-sheet.v1";
const MODEL_TEMPLATE_LAYOUT = "model-card-plus-downstream-reference.v3";

export interface ModelAssetTemplatePlanMetadata extends Record<string, unknown> {
  promptFamily: typeof MODEL_TEMPLATE_PROMPT_FAMILY;
  providerPromptMode: "single-reference-safe";
  modelTemplateLayout: typeof MODEL_TEMPLATE_LAYOUT;
  fullTemplatePromptSnapshot: string;
  providerPromptSnapshot: string;
  modelTemplateParams: CreateModelParams;
  modelDiversityBrief: ModelAssetDiversityBrief;
  modelAssetMetadata: ModelAssetMetadata;
  downstreamReferenceMode: "prefer_zone_b_neutral_identity_reference";
  downstreamReferenceRules: string[];
  userRequestAdaptation: string[];
}

export interface ModelAssetDiversityBrief extends Record<string, unknown> {
  marketSlot: string;
  ageSignal: string;
  hairSignal: string;
  wardrobeBaseline: string;
  temperamentSignal: string;
  commercialUseCase: string;
  differentiationRules: string[];
}

export function buildModelAssetTemplateGenerationPlan(draft: AssetPackDraft): AssetPackGenerationPlan {
  const basePlan = buildAssetPackGenerationPlan(draft);
  const modelTemplateParams = inferModelTemplateParams(draft.userRequest);
  const diversityBrief = buildModelAssetDiversityBrief(draft.userRequest, modelTemplateParams);
  const userRequestAdaptation = buildUserRequestAdaptation(draft, modelTemplateParams, diversityBrief);
  const prompt = buildProviderSafeModelPrompt(
    draft,
    modelTemplateParams,
    basePlan.outputSize
  );
  const fullTemplatePrompt = prompt;
  const modelAssetMetadata = buildModelAssetMetadata(modelTemplateParams, {
    promptSnapshot: fullTemplatePrompt,
  });

  return {
    ...basePlan,
    prompt,
    metadata: {
      ...basePlan.metadata,
      promptFamily: MODEL_TEMPLATE_PROMPT_FAMILY,
      providerPromptMode: "single-reference-safe",
      modelTemplateLayout: MODEL_TEMPLATE_LAYOUT,
      fullTemplatePromptSnapshot: fullTemplatePrompt,
      providerPromptSnapshot: prompt,
      fullTemplatePromptChars: fullTemplatePrompt.length,
      providerPromptChars: prompt.length,
      modelTemplateParams,
      modelDiversityBrief: diversityBrief,
      modelAssetMetadata,
      downstreamReferenceMode: "prefer_zone_b_neutral_identity_reference",
      downstreamReferenceRules: [
        "Use the downstream identity reference zone for final image generation, not the library display card.",
        "Preserve identity anchors only; do not preserve model-card pose, facial expression, background, or lighting.",
        "Final scene lighting and pose instructions override this asset sheet.",
      ],
      userRequestAdaptation,
    } satisfies ModelAssetTemplatePlanMetadata,
  };
}

export function buildGeneratedModelAssetTemplateMetadata({
  generationPlan,
  imageUrl,
}: {
  generationPlan: AssetPackGenerationPlan;
  imageUrl: string;
}): ModelAssetMetadata | undefined {
  const params = getModelTemplateParams(generationPlan.metadata);
  if (!params) return undefined;
  const fullTemplatePrompt = getFullTemplatePromptSnapshot(generationPlan.metadata);
  const downstreamReferenceMode = getDownstreamReferenceMode(generationPlan.metadata);
  const downstreamReferenceRules = getDownstreamReferenceRules(generationPlan.metadata);
  return {
    ...buildModelAssetMetadata(params, {
      imageUrl,
      promptSnapshot: fullTemplatePrompt ?? generationPlan.prompt,
    }),
    providerPromptMode: generationPlan.metadata.providerPromptMode,
    modelDiversityBrief: generationPlan.metadata.modelDiversityBrief,
    ...(downstreamReferenceMode ? { downstreamReferenceMode } : {}),
    ...(downstreamReferenceRules.length > 0 ? { downstreamReferenceRules } : {}),
    generatedProviderPromptSnapshot: generationPlan.prompt,
  };
}

function inferModelTemplateParams(userRequest: string): CreateModelParams {
  const text = userRequest.toLowerCase();
  const age = inferAge(userRequest);

  return {
    gender: inferGender(text),
    ethnicity: inferEthnicity(text),
    age,
    temperament: inferTemperament(text),
    bodyType: inferBodyType(text),
    hairStyle: inferHairStyle(text),
    makeup: inferMakeup(text),
  };
}

function inferAge(userRequest: string): number {
  const match = userRequest.match(/(\d{2})\s*(?:岁|year|years|yo)/i);
  if (!match && /(甜妹|少女感|年轻|fresh|youthful|sweet)/i.test(userRequest)) return 24;
  const parsed = match ? Number(match[1]) : 28;
  if (!Number.isFinite(parsed)) return 28;
  return Math.min(60, Math.max(22, Math.floor(parsed)));
}

function inferGender(text: string): CreateModelParams["gender"] {
  if (/(男|male|man|gentleman)/i.test(text)) return "male";
  return "female";
}

function inferEthnicity(text: string): CreateModelParams["ethnicity"] {
  if (/(非洲|黑人|african|black)/i.test(text)) return "african";
  if (/(亚洲|中国|日本|韩国|东亚|asian|chinese|japanese|korean|甜妹|小红书|淘宝|taobao|rednote|xiaohongshu)/i.test(text)) return "asian";
  return "european";
}

function inferTemperament(text: string): CreateModelParams["temperament"] {
  if (/(活力|阳光|运动|energetic|sport)/i.test(text)) return "energetic";
  if (/(温柔|亲和|柔和|甜妹|清甜|松弛|自然|可爱|gentle|soft|sweet|relaxed|natural)/i.test(text)) return "gentle";
  if (/(商务|职业|高级|business|executive|premium)/i.test(text)) return "business";
  if (/(酷|冷感|高冷|cool|edgy)/i.test(text)) return "cool";
  return "intellectual";
}

function inferBodyType(text: string): CreateModelParams["bodyType"] {
  if (/(运动|健美|athletic|fit)/i.test(text)) return "athletic";
  if (/(苗条|纤细|瘦|slim)/i.test(text)) return "slim";
  return "standard";
}

function inferHairStyle(text: string): string {
  const color = /(东欧|乌克兰|ukrain|eastern european|slavic|斯拉夫|浅金|金发|blonde)/i.test(text)
    ? "light ash-blonde"
    : /(棕发|brown)/i.test(text)
      ? "soft brown"
      : /(黑发|black hair)/i.test(text)
        ? "natural dark"
        : "";

  if (/(短发|short|bob)/i.test(text)) {
    return `${color ? `${color} ` : ""}short polished bob hair`.trim();
  }
  if (/(中长|mid|medium)/i.test(text)) {
    return `${color ? `${color} ` : ""}medium-length softly styled hair`.trim();
  }
  if (/(束发|马尾|tied|ponytail)/i.test(text)) {
    return `${color ? `${color} ` : ""}neatly tied-back commercial hairstyle`.trim();
  }
  if (/(甜妹|清甜|少女感|sweet|fresh|youthful)/i.test(text)) {
    return `${color ? `${color} ` : "natural dark "}long softly layered hair with airy bangs and relaxed movement`.trim();
  }
  if (color) return `${color} long softly styled hair`;
  return "long";
}

function inferMakeup(text: string): string {
  if (/(淡妆|light makeup)/i.test(text)) return "light";
  return "natural";
}

function buildUserRequestAdaptation(
  draft: AssetPackDraft,
  params: CreateModelParams,
  diversityBrief: ModelAssetDiversityBrief
): string[] {
  const lines = [
    `Low-prompt user request: ${draft.userRequest}.`,
    `Interpret the request as an adult commercial model identity asset with ${params.ethnicity} market cues.`,
    `Diversity slot: ${diversityBrief.marketSlot}; ${diversityBrief.commercialUseCase}.`,
    "Keep the output as a compact downstream-compositing model identity card, not a final product poster.",
    "No product, logo, selling text, or wearing relationship should be introduced at this asset stage.",
    "Do not collapse this model into a generic default white T-shirt and jeans identity when the diversity slot provides stronger styling cues.",
  ];

  if (/(乌克兰|ukrain|slavic|斯拉夫)/i.test(draft.userRequest)) {
    lines.push(
      "For the Ukrainian cue, use subtle Eastern European commercial model styling while keeping identity natural, realistic, and non-stereotyped."
    );
  }

  return lines;
}

function formatUserRequestAdaptation(lines: string[]): string {
  if (lines.length === 0) return "";
  return ["User request adaptation:", ...lines.map((line) => `- ${line}`)].join("\n");
}

function buildProviderSafeModelPrompt(
  draft: AssetPackDraft,
  params: CreateModelParams,
  outputSize: AssetPackGenerationPlan["outputSize"]
): string {
  const profile = buildModelProfile(params);
  const regionalCue = buildRegionalCue(draft.userRequest, profile.identityRegion);
  const hasIdentityReference = draft.referenceImages.some((image) => image.providerUsable);
  const identityRule = hasIdentityReference
    ? "Use the attached model image as the identity anchor. Preserve the same adult person only through face geometry, facial proportions, hair silhouette, age impression, body proportions, and natural temperament. Do not preserve the original expression, pose, lighting, clothing, product, bag, logo, or location background."
    : `Create an adult ${regionalCue} ${profile.gender} model matching this request: ${draft.userRequest}.`;

  return [
    `Create one reusable commercial model asset sheet, ${outputSize}, 3:2 landscape.`,
    identityRule,
    `Keep this feel: ${draft.userRequest}`,
    hasIdentityReference
      ? "Keep the candid real-photo feeling from the reference: natural skin texture, soft low-contrast diffuse daylight, gentle expression, and relaxed approachable energy, but refresh the pose and gaze naturally."
      : `${profile.age}-year-old adult ${regionalCue} ${profile.gender} model, ${profile.temperament}, ${profile.hair}, ${profile.makeup}.`,
    "The sheet must contain two clearly readable zones: Zone A is a small library display card for humans; Zone B is the downstream identity reference zone that future generations should use.",
    "Zone A: one clean face close-up and one simple full-body view, for browsing the asset in the library.",
    "Zone B: one large neutral 3/4 half-body identity reference, plus three small relaxed pose references: front standing, slight side turn, and seated or walking micro-pose. These are for downstream compositing.",
    "Zone B pose rules: the large 3/4 identity reference uses low relaxed shoulders, chin turned 8 degrees toward camera-left, eyes looking just beside the lens, and hands relaxed below the frame. The small front reference puts weight on the left foot with arms loose. The small side-turn reference turns the torso 30 degrees toward camera-right with eyes looking to the frame edge. The small seated or walking micro-pose keeps one knee slightly forward and both hands resting naturally. Each pose has one fixed gaze target, not multiple options.",
    "Use a warm light-gray matte background, simple logo-free neutral clothes, natural proportions, and consistent identity across every panel.",
    "Lighting: soft diffuse daylight, matte ambient wrap, very low contrast, no hard studio key light, no glossy beauty retouching, no separate face spotlight.",
    "Keep it simple and clean: no product, no bag, no selling text, no brand logo, no measurement ruler, no dense contact-sheet grid, no hard studio lighting, no over-designed styling, no distorted anatomy.",
  ].join(" ");
}

function buildRegionalCue(userRequest: string, identityRegion: string): string {
  if (/(东欧|乌克兰|ukrain|slavic|斯拉夫|eastern european)/i.test(userRequest)) {
    return "Eastern European";
  }
  if (/(日本|japan|japanese|tokyo)/i.test(userRequest)) return "Japanese";
  if (/(韩国|korea|korean|seoul)/i.test(userRequest)) return "Korean";
  if (/(中国|chinese|china|taobao|淘宝|小红书|xiaohongshu|rednote)/i.test(userRequest)) return "Chinese";
  return identityRegion;
}

function buildModelAssetDiversityBrief(
  userRequest: string,
  params: CreateModelParams
): ModelAssetDiversityBrief {
  const text = userRequest.toLowerCase();

  if (/(东欧|乌克兰|ukrain|slavic|斯拉夫|eastern european|欧美|european)/i.test(text)) {
    return {
      marketSlot: "European global premium commerce model",
      ageSignal: `${params.age}-year-old mature clean commercial impression`,
      hairSignal: /短发|short|bob/i.test(text)
        ? "ash-blonde polished bob with defined silhouette"
        : "soft ash-blonde or light brown hair with refined movement",
      wardrobeBaseline: "champagne silk-blend blouse, cool grey tailored wide-leg trousers, minimal pearl studs, clean low-profile shoes",
      temperamentSignal: "composed, premium, editorial, trustworthy",
      commercialUseCase: "premium skincare, fashion basics, lifestyle electronics, and global catalog hero imagery",
      differentiationRules: [
        "Keep a cooler European premium palette; avoid the same black-hair East Asian face template.",
        "Use more angular cheekbone and brow language than the East Asian slots.",
        "Avoid default white T-shirt plus blue jeans unless explicitly requested.",
      ],
    };
  }

  if (/(日本|japan|japanese|tokyo)/i.test(text)) {
    return {
      marketSlot: "Japanese minimal lifestyle commerce model",
      ageSignal: "25-year-old understated adult professional impression",
      hairSignal: "dark brown chin-length bob or neat soft bob, airy fringe optional",
      wardrobeBaseline: "oatmeal fine-knit cardigan over ivory top, navy straight skirt or clean tapered trousers, minimal leather flats",
      temperamentSignal: "quiet, precise, gentle, refined, minimal",
      commercialUseCase: "minimal lifestyle goods, home accessories, beauty, and clean DTC product visuals",
      differentiationRules: [
        "Keep styling quieter and more minimal than Korean or Chinese slots.",
        "Use compact bob hair and softer posture to avoid looking like the generic East Asian slot.",
        "Avoid glossy K-beauty styling, dramatic waves, and influencer pose language.",
      ],
    };
  }

  if (/(韩国|korea|korean|seoul)/i.test(text)) {
    return {
      marketSlot: "Korean Seoul clean beauty commerce model",
      ageSignal: "24-year-old fresh adult commercial impression",
      hairSignal: "long chestnut-brown softly waved hair with polished airy volume",
      wardrobeBaseline: "crisp pale-blue shirt tucked into ivory straight trousers, delicate silver earrings, clean white shoes",
      temperamentSignal: "fresh, luminous, approachable, trend-aware",
      commercialUseCase: "K-beauty, fashion basics, social commerce covers, and polished lifestyle product shots",
      differentiationRules: [
        "Use brighter clean-beauty styling and longer soft waves than Japanese or Chinese slots.",
        "Keep the face youthful but clearly adult, polished, and non-glamour.",
        "Avoid turning the wardrobe into the same white T-shirt and jeans baseline.",
      ],
    };
  }

  if (/(中国|chinese|china|taobao|淘宝|小红书|xiaohongshu|rednote)/i.test(text)) {
    return {
      marketSlot: "Chinese e-commerce professional model",
      ageSignal: "27-year-old confident adult commerce impression",
      hairSignal: "long straight natural black hair, optional soft half-up styling for a tidy product-demo look",
      wardrobeBaseline: "ivory blouse with clean neckline, warm beige tailored trousers, small gold studs, simple nude flats",
      temperamentSignal: "warm, capable, polished, conversion-oriented",
      commercialUseCase: "Taobao detail pages, Xiaohongshu seeding images, apparel display, and practical product demonstrations",
      differentiationRules: [
        "Use warmer approachable commerce styling than Japanese minimal or Korean beauty slots.",
        "Keep product-demo readiness and confident posture as the commercial signal.",
        "Avoid copying the generic East Asian neutral face, hair length, and wardrobe exactly.",
      ],
    };
  }

  if (params.ethnicity === "asian") {
    return {
      marketSlot: "Pan-East-Asian neutral catalog model",
      ageSignal: `${params.age}-year-old fresh adult neutral catalog impression`,
      hairSignal: "shoulder-length soft dark-brown hair with natural movement",
      wardrobeBaseline: "simple off-white fine knit top or soft cotton shirt, light taupe straight trousers, minimal small earrings, clean low-profile shoes",
      temperamentSignal: "fresh, clean, approachable, practical, neutral",
      commercialUseCase: "cross-market catalog, office lifestyle products, practical product detail pages, and neutral comparison images",
      differentiationRules: [
        "Use a clean neutral catalog signal without pushing the model into mature executive styling.",
        "Keep wardrobe light, logo-free, and reusable instead of corporate officewear or casual white T-shirt styling.",
        "Avoid over-indexing on any one national beauty trend.",
      ],
    };
  }

  return {
    marketSlot: "Global neutral commercial model",
    ageSignal: `${params.age}-year-old adult professional impression`,
    hairSignal: "clean natural commercial hairstyle selected from the user request",
    wardrobeBaseline: "structured neutral commerce outfit with no logos, no prints, and clear product-safe silhouette",
    temperamentSignal: "professional, clear, approachable, reusable",
    commercialUseCase: "general e-commerce model reference and reusable commercial production",
    differentiationRules: [
      "Create a distinct reusable person identity rather than a generic default model.",
      "Vary age impression, hair silhouette, wardrobe baseline, and temperament when producing a set of model assets.",
      "Keep identity differences explicit enough that several model assets remain recognizable side by side.",
    ],
  };
}

function getFullTemplatePromptSnapshot(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const snapshot = (value as Record<string, unknown>).fullTemplatePromptSnapshot;
  return typeof snapshot === "string" && snapshot.trim() ? snapshot : undefined;
}

function getDownstreamReferenceMode(value: unknown): ModelAssetMetadata["downstreamReferenceMode"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const mode = (value as Record<string, unknown>).downstreamReferenceMode;
  return mode === "prefer_zone_b_neutral_identity_reference" ? mode : undefined;
}

function getDownstreamReferenceRules(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const rules = (value as Record<string, unknown>).downstreamReferenceRules;
  if (!Array.isArray(rules)) return [];
  return rules.flatMap((rule) => (typeof rule === "string" && rule.trim() ? [rule.trim()] : []));
}

function getModelTemplateParams(value: unknown): CreateModelParams | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const metadata = value as Record<string, unknown>;
  const params = metadata.modelTemplateParams;
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const record = params as Partial<CreateModelParams>;
  if (
    (record.gender === "male" || record.gender === "female") &&
    (record.ethnicity === "asian" || record.ethnicity === "european" || record.ethnicity === "african") &&
    typeof record.age === "number" &&
    typeof record.temperament === "string" &&
    typeof record.bodyType === "string"
  ) {
    return {
      gender: record.gender,
      ethnicity: record.ethnicity,
      age: record.age,
      temperament: record.temperament,
      bodyType: record.bodyType,
      hairStyle: typeof record.hairStyle === "string" ? record.hairStyle : undefined,
      makeup: typeof record.makeup === "string" ? record.makeup : undefined,
    };
  }
  return undefined;
}
