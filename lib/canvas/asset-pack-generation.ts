import type { AssetPackDraft, AssetPackReferenceImage } from "./asset-pack-types";
import { MAX_PROMPT_CHARS } from "../ai/provider-call-policy";
import {
  PRODUCT_MULTIVIEW_WHITE_SHEET_PROMPT_FAMILY,
  buildProductMultiviewWhiteSheetPrompt,
} from "../ai/prompts/product-multiview";

interface AssetGenerationSop {
  purpose: string;
  referenceImageRequirements: string[];
  qualityStandards: string[];
  negativeRules: string[];
  reusableMetadataFields: string[];
  promptFocus: string[];
  sceneDescriptionStructure?: {
    overview: string;
    multiViewConstraints: string[];
  };
  separationRules?: string[];
}

interface AssetPackOutputSpec {
  outputSize: "1024x1024" | "1024x1536" | "1536x1024";
  outputRatio: "1:1" | "2:3" | "3:2";
}

export interface AssetPackGenerationMetadata extends Record<string, unknown> {
  sopKey: string;
  category: AssetPackDraft["category"];
  assetUsage: string;
  outputSize: AssetPackOutputSpec["outputSize"];
  outputRatio: AssetPackOutputSpec["outputRatio"];
  referenceImageRequirements: string[];
  qualityStandards: string[];
  negativeRules: string[];
  reusableMetadataFields: string[];
  sceneDescriptionStructure?: {
    overview: string;
    multiViewConstraints: string[];
  };
  separationRules?: string[];
}

const CATEGORY_SOP: Record<AssetPackDraft["category"], AssetGenerationSop> = {
  product_asset: {
    purpose:
      "Reusable product identity asset for downstream commerce images, edits, and product-layer composition.",
    referenceImageRequirements: [
      "Prefer a provider-usable source that clearly shows the product silhouette, proportions, key materials, color family, logo or label zones, and functional details.",
      "When multiple product views are available, consolidate them into one white-background multi-view product identity sheet before using the product in campaign images.",
      "Reference images should be treated as identity locks, not as mood-board inspiration.",
      "If no usable image is attached, generate a neutral product identity plate with minimal staging and no model/person dependency.",
    ],
    qualityStandards: [
      "Product edges, surface texture, construction details, and scale cues must stay readable at thumbnail size.",
      "The output must be easy to cut, reuse, and compare against later generated results.",
      "A product identity sheet should expose front, side, back, top/bottom or key-detail views when references support them.",
      "Logo or brand regions may be reserved or preserved, but unreadable invented brand text is not allowed.",
    ],
    negativeRules: [
      "Do not invent extra variants, closures, straps, pockets, labels, prints, garment layers, packaging, or fake logos.",
      "Do not merge product identity with model identity, pose, body shape, or wearing relationship.",
      "Do not replace the product with a similar item from another category.",
    ],
    reusableMetadataFields: [
      "product_category",
      "silhouette",
      "materials",
      "color_family",
      "logo_regions",
      "construction_details",
      "allowed_angles",
      "multi_view_reference_policy",
      "identity_locks",
    ],
    promptFocus: [
      "Describe the object itself before background, styling, or campaign mood.",
      "Keep clothing/product-layer logic separate from person/model logic.",
    ],
  },
  model_asset: {
    purpose:
      "Reusable adult person identity asset for model consistency, independent from any product, garment, or commercial wearing instruction.",
    referenceImageRequirements: [
      "Prefer a provider-usable source with clear face shape, hair identity, age impression, body proportion, posture, and expression range.",
      "References may include neutral wardrobe only as context; wardrobe must not become a product identity lock.",
      "If no usable image is attached, generate a clean neutral model card / identity reference sheet without product use, logos, or selling pose dependency.",
    ],
    qualityStandards: [
      "Face, hair, hands, limbs, gaze, and posture must be natural and reusable across crops and poses.",
      "Identity anchors must remain stable without relying on a specific outfit, prop, scene, or product.",
      "The generated person should be commercially usable as a model reference, not a final campaign composite.",
      "Model cards should use large-area diffuse reflected light, matte ambient wrap, very low contrast, and no baked-in white-background studio face lighting.",
    ],
    negativeRules: [
      "Do not include children, celebrity likeness, product usage, brand logos, hard-coded garments, or a wearing relationship.",
      "Do not treat product or clothing details as model identity anchors.",
      "Do not change age impression, face identity, hair identity, body profile, or ethnicity cues across reuse.",
      "Do not use pure white seamless backdrop, hard key light, beauty-dish catchlights, strong frontal fill, or glossy portrait retouching as the model identity look.",
    ],
    reusableMetadataFields: [
      "model_identity_anchor",
      "age_impression",
      "face_shape",
      "hair_identity",
      "body_proportion",
      "expression_range",
      "pose_range",
      "neutral_wardrobe_policy",
    ],
    promptFocus: [
      "Describe the person asset only: identity, temperament, anatomy, and neutral pose flexibility.",
      "Product styling relationships must be supplied later by linked product assets.",
    ],
    separationRules: [
      "Model SOP is a person-identity layer, not a clothing/product layer.",
      "Any instruction such as model wearing, holding, draping, or demonstrating a product belongs to a later composition plan with a linked product asset.",
    ],
  },
  scene_asset: {
    purpose:
      "Reusable environment asset for location consistency, spatial layout, lighting, placement zones, and camera grammar.",
    referenceImageRequirements: [
      "Prefer a provider-usable source that shows the environment type, layout, light direction, surface materials, prop family, and subject placement zones.",
      "References should define the space, not the product or model identity.",
      "If no usable image is attached, generate a clear environment reference that leaves obvious zones for later product/model placement.",
    ],
    qualityStandards: [
      "Perspective, shadows, reflections, scale, and contact points must be internally consistent.",
      "The scene must support later subjects clearly without clutter, visual competition, or stock-backdrop flatness.",
      "The output should provide enough spatial information for close-up, mid-shot, wide, and alternate-angle reuse.",
      "Every reusable scene should expose stable anchors: floor plan, horizon line, light direction, surface materials, prop family, and empty subject placement zones.",
      "If the scene may later include a model, provide full-body standing/walking zones, believable headroom, floor contact areas, and reverse angles that support body placement.",
    ],
    negativeRules: [
      "Do not invent product features, model identity, dominant people, readable brand text, or a final product hero composition.",
      "Do not create impossible scale, floating objects, conflicting light directions, or broken perspective.",
      "Do not let background props compete with future subject placement zones.",
      "Do not make multi-view references look like unrelated rooms, unrelated tables, or unrelated times of day.",
    ],
    reusableMetadataFields: [
      "scene_type",
      "overview_layout",
      "placement_zones",
      "camera_grammar",
      "lighting_direction",
      "prop_family",
      "surface_materials",
      "multi_view_constraints",
    ],
    promptFocus: [
      "Describe the environment as a reusable stage before any subject appears.",
      "Reserve product and model identity for linked assets.",
    ],
    sceneDescriptionStructure: {
      overview:
        "Start with a total-view overview that names the environment, spatial layout, primary surfaces, light source, prop families, and empty subject placement zones.",
      multiViewConstraints: [
        "Wide view must preserve the full spatial map and light direction.",
        "Mid view must preserve placement zones, scale cues, and prop relationships.",
        "Close view must preserve surface texture, shadows, and material continuity.",
        "Alternate angle must remain compatible with the same floor plan and horizon line.",
        "Each view should include at least two recurring anchors so later generations can read it as the same scene.",
        "Model-compatible scene boards should use one top-down or high-angle overview plus four straight cardinal elevation views: front, back, left, and right.",
        "The overview should map placement zones and anchors; the four elevation views should prove spatial relationships instead of acting as diagonal beauty shots.",
      ],
    },
  },
  style_asset: {
    purpose:
      "Reusable art-direction asset for visual language consistency across product, model, scene, and final campaign outputs.",
    referenceImageRequirements: [
      "Prefer a provider-usable source that clearly expresses palette, contrast, lighting character, material finish, lens feel, composition rhythm, and post-processing level.",
      "References should behave like a style board, not a product, model, or scene identity source.",
      "If no usable image is attached, generate a clean premium style plate with concrete visual constraints rather than vague aesthetic labels.",
    ],
    qualityStandards: [
      "Style guidance must be concrete enough to drive repeatable outputs across ratios and subjects.",
      "Color, lighting, texture, contrast, and finish should feel intentional without reducing product readability.",
      "The output should be usable as a reusable style anchor, not a busy collage.",
    ],
    negativeRules: [
      "Do not encode product construction, model identity, age, ethnicity, body details, or a fixed scene as style rules.",
      "Do not include readable text, UI mockups, brand logos, or dense collage fragments.",
      "Do not rely on vague labels without visible palette, lighting, lens, and material constraints.",
    ],
    reusableMetadataFields: [
      "palette",
      "contrast_level",
      "lighting_character",
      "material_language",
      "lens_feel",
      "composition_rhythm",
      "texture_intensity",
      "post_process_finish",
    ],
    promptFocus: [
      "Describe art direction only, independent from subject identity.",
      "Make every visual rule reusable across different product/model/scene combinations.",
    ],
  },
};

const CATEGORY_NEGATIVE_RULES: Record<AssetPackDraft["category"], string> = {
  product_asset:
    "Do not add fake logos, extra product variants, unreadable text, distorted product geometry, or decorative text overlays.",
  model_asset:
    "Do not include children, celebrity likeness, product usage, logos, strong makeup distortion, or multiple unrelated people.",
  scene_asset:
    "Do not include a dominant product hero, readable brand text, people as the main subject, cluttered backgrounds, or impossible perspective.",
  style_asset:
    "Do not include a specific product, brand logo, readable text, UI mockups, or a busy collage that cannot guide later image generation.",
};

export interface AssetPackGenerationPlan {
  prompt: string;
  referenceMode: "image_to_image" | "text_to_image";
  providerReferenceUrl: string | null;
  providerReferenceUrls: string[];
  outputSize: AssetPackOutputSpec["outputSize"];
  outputRatio: AssetPackOutputSpec["outputRatio"];
  metadata: AssetPackGenerationMetadata;
}

export function buildAssetPackGenerationPlan(draft: AssetPackDraft): AssetPackGenerationPlan {
  const providerReferences = draft.referenceImages.filter((image) => image.providerUsable);
  const providerReferenceUrls =
    draft.category === "product_asset"
      ? providerReferences.map((image) => image.url).slice(0, 6)
      : providerReferences.slice(0, 1).map((image) => image.url);
  const providerReference = providerReferences[0];
  const referenceMode = providerReferenceUrls.length > 0 ? "image_to_image" : "text_to_image";
  const roleLabel = getRoleLabel(draft);
  const generationSop = CATEGORY_SOP[draft.category];
  const outputSpec = getAssetPackOutputSpec(draft.category);
  const metadata = buildGenerationMetadata(draft, generationSop, outputSpec);
  const providerReferenceCount = providerReferenceUrls.length;
  const productMultiviewPrompt =
    draft.category === "product_asset"
      ? buildProductMultiviewWhiteSheetPrompt({
          userRequest: draft.userRequest,
          referenceCount: providerReferenceCount || draft.referenceImages.length,
          outputSize: outputSpec.outputSize,
        })
      : "";
  const requiredEnding = [
    "Output only the reference image. No captions, no watermark, no UI, no visible prompt text.",
    `Commercial photography quality, clear subject hierarchy, realistic lighting, sharp details, ${outputSpec.outputSize}.`,
  ].join("\n");
  const prompt = fitPromptToProviderLimit(productMultiviewPrompt || [
    `Create one low-prompt ${roleLabel}.`,
    `Asset usage: ${generationSop.purpose}`,
    `User intent: ${draft.userRequest}.`,
    `Asset role: ${roleLabel}.`,
    providerReference
      ? `Use the attached reference image as the primary visual anchor. Preserve the relevant identity cues for this asset role.`
      : "No usable source image is attached. Create a neutral but production-ready reference asset from the user intent.",
    formatRules("Reference image requirements", generationSop.referenceImageRequirements),
    formatRules("SOP prompt focus", generationSop.promptFocus),
    formatSceneDescriptionStructure(generationSop),
    formatRules("Layer separation rules", generationSop.separationRules ?? []),
    formatRules("Identity and consistency locks", draft.invariants),
    formatRules("Allowed variations", draft.allowedVariations),
    formatRules("Quality requirements", [...generationSop.qualityStandards, ...draft.qualityRules]),
    formatRules("Prompt boundaries", draft.promptBoundaries),
    `Negative rules: ${[
      CATEGORY_NEGATIVE_RULES[draft.category],
      ...generationSop.negativeRules,
      ...draft.negativeRules,
    ].join(" ")}`,
    formatRules("Reusable metadata fields to preserve", generationSop.reusableMetadataFields),
    requiredEnding,
  ]
    .filter(Boolean)
    .join("\n"), requiredEnding);
  const finalMetadata =
    draft.category === "product_asset"
      ? {
          ...metadata,
          promptFamily: PRODUCT_MULTIVIEW_WHITE_SHEET_PROMPT_FAMILY,
          providerPromptMode: "multi-view-white-sheet",
          referenceImageCount: draft.referenceImages.length,
          providerUsableReferenceCount: providerReferenceCount,
          outputLayout: "single white-background multi-view product sheet",
        }
      : metadata;

  return {
    prompt,
    referenceMode,
    providerReferenceUrl: providerReference?.url ?? null,
    providerReferenceUrls,
    outputSize: outputSpec.outputSize,
    outputRatio: outputSpec.outputRatio,
    metadata: finalMetadata,
  };
}

export function attachGeneratedAssetReference({
  draft,
  imageUrl,
  imageTitle,
  source = "asset-pack-real-generate",
  metadata,
}: {
  draft: AssetPackDraft;
  imageUrl: string;
  imageTitle?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}): AssetPackDraft {
  const generatedReference: AssetPackReferenceImage = {
    url: imageUrl,
    title: imageTitle || `${draft.label} reference`,
    role: getReferenceRole(draft),
    providerUsable: true,
    source,
  };
  const existingReferences = draft.referenceImages.filter((image) => image.url !== imageUrl);

  return {
    ...draft,
    status: "ready",
    buildMode: "generated",
    referenceImages: [generatedReference, ...existingReferences],
    providerUsablePrimaryReference: imageUrl,
    review: {
      ...draft.review,
      state: "needs_review",
      blockingIssues: [],
      notes: [
        "Generated one provider-usable reference asset.",
        "Review before using it as a locked commercial production reference.",
      ],
    },
    metadata: {
      ...draft.metadata,
      mock: false,
      generatedReferenceUrl: imageUrl,
      generatedReferenceStorage: metadata,
      generatedAt: new Date().toISOString(),
    },
  };
}

function getReferenceRole(draft: AssetPackDraft): AssetPackReferenceImage["role"] {
  if (draft.category === "product_asset") return "product";
  if (draft.category === "model_asset") return "model";
  if (draft.category === "scene_asset") return "scene";
  return "style";
}

function getRoleLabel(draft: AssetPackDraft): string {
  if (draft.category === "product_asset") return "product identity reference";
  if (draft.category === "model_asset") return "model identity reference";
  if (draft.category === "scene_asset") return "scene and environment reference";
  return "visual style reference";
}

function getAssetPackOutputSpec(category: AssetPackDraft["category"]): AssetPackOutputSpec {
  if (category === "product_asset") return { outputSize: "1536x1024", outputRatio: "3:2" };
  if (category === "model_asset") return { outputSize: "1536x1024", outputRatio: "3:2" };
  if (category === "scene_asset") return { outputSize: "1536x1024", outputRatio: "3:2" };
  return { outputSize: "1536x1024", outputRatio: "3:2" };
}

function buildGenerationMetadata(
  draft: AssetPackDraft,
  generationSop: AssetGenerationSop,
  outputSpec: AssetPackOutputSpec
): AssetPackGenerationMetadata {
  return {
    sopKey: draft.sopKey,
    category: draft.category,
    assetUsage: generationSop.purpose,
    outputSize: outputSpec.outputSize,
    outputRatio: outputSpec.outputRatio,
    referenceImageRequirements: generationSop.referenceImageRequirements,
    qualityStandards: generationSop.qualityStandards,
    negativeRules: [...generationSop.negativeRules, ...draft.negativeRules],
    reusableMetadataFields: generationSop.reusableMetadataFields,
    sceneDescriptionStructure: generationSop.sceneDescriptionStructure,
    separationRules: generationSop.separationRules,
  };
}

function formatSceneDescriptionStructure(generationSop: AssetGenerationSop): string {
  if (!generationSop.sceneDescriptionStructure) return "";
  return [
    `Scene description structure - overview: ${generationSop.sceneDescriptionStructure.overview}`,
    `Scene description structure - multi-view constraints: ${generationSop.sceneDescriptionStructure.multiViewConstraints.join(" | ")}`,
  ].join("\n");
}

function formatRules(title: string, rules: string[]): string {
  const normalized = rules.map((rule) => rule.trim()).filter(Boolean).slice(0, 8);
  if (normalized.length === 0) return "";
  return `${title}: ${normalized.join(" | ")}`;
}

function fitPromptToProviderLimit(prompt: string, requiredEnding: string): string {
  const normalized = prompt.trim();
  if (normalized.length <= MAX_PROMPT_CHARS) return normalized;
  const suffix = `\n${requiredEnding}`;
  const room = Math.max(0, MAX_PROMPT_CHARS - suffix.length);
  return `${normalized.slice(0, room).trimEnd()}${suffix}`;
}
