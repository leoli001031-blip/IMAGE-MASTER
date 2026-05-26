import type { AssetPackCategory, AssetSopDefinition } from "./asset-pack-types";
import { normalizeAssetPackCategory } from "./asset-pack-types";

export const ASSET_SOP_REGISTRY: Record<AssetPackCategory, AssetSopDefinition> = {
  product_asset: {
    category: "product_asset",
    label: "Product Asset",
    role: "product",
    sopKey: "sop.product_asset.v1",
    description: "Reusable product identity pack for downstream commercial image generation.",
    invariants: [
      "Preserve product silhouette, construction, material, color family, logo regions, and functional details.",
      "Treat source product images as identity references, not as loose inspiration.",
      "Keep product category and visible proportions consistent across generated outputs.",
      "When several product angles are available, combine them into a white-background multi-view identity sheet before creative scene generation.",
    ],
    allowedVariations: [
      "Camera angle, crop, lighting, background, surface, and scene can vary when the product identity remains intact.",
      "Minor styling accessories may change if they do not alter the product itself.",
      "Composition can adapt to platform ratio and campaign purpose.",
    ],
    negativeRules: [
      "Do not invent logos, prints, closures, pockets, straps, labels, materials, or garment layers absent from the source.",
      "Do not merge the product into a model/person asset; model identity and pose must come from model assets.",
      "Do not replace the product with a similar item from another category.",
    ],
    qualityRules: [
      "Product edges and material texture must remain legible at commerce thumbnail size.",
      "Logo or brand regions must not be warped, mirrored, or hallucinated.",
      "Multi-view product sheets should make front, side, back, top/bottom, and key-detail views easy to inspect when references support them.",
      "The product must remain the visual subject unless a downstream plan explicitly makes it secondary.",
    ],
    reviewChecks: [
      "source reference accepted",
      "product identity preserved",
      "provider-usable primary reference selected only when safe",
    ],
    promptBoundaries: [
      "Product asset prompts describe product identity only.",
      "Clothing/product-layer instructions must stay separate from person/model identity prompts.",
    ],
  },
  model_asset: {
    category: "model_asset",
    label: "Model Asset",
    role: "model",
    sopKey: "sop.model_asset.v1",
    description: "Reusable person identity pack for model consistency without baking in product styling.",
    invariants: [
      "Preserve person identity anchors: face shape, hair, age impression, body proportion, and overall temperament.",
      "Treat the model as a reusable person asset independent from any specific product.",
      "Keep anatomy, gaze, and body mechanics plausible across poses.",
    ],
    allowedVariations: [
      "Pose, expression, camera angle, crop, lighting, and neutral wardrobe can vary.",
      "Wardrobe may adapt only as generic styling unless a separate product asset provides the product details.",
      "Scene context may vary when it does not rewrite identity anchors.",
    ],
    negativeRules: [
      "Do not hard-code a specific product, garment, logo, or wearing relationship into the model asset.",
      "Do not use product/clothing details as model identity anchors.",
      "Do not change age impression, facial identity, hair identity, body profile, or ethnicity cues across uses.",
    ],
    qualityRules: [
      "Face, hands, limbs, and posture must be natural and commercially usable.",
      "Identity consistency must survive crop and pose changes.",
      "Any product worn or held must come from a linked product asset, not from the model SOP.",
    ],
    reviewChecks: [
      "person identity anchors present",
      "product details excluded",
      "provider-usable primary reference selected only when safe",
    ],
    promptBoundaries: [
      "Model asset prompts describe the person only.",
      "Product styling relationships must be supplied by linked product assets, not baked into the model pack.",
    ],
  },
  scene_asset: {
    category: "scene_asset",
    label: "Scene Asset",
    role: "scene",
    sopKey: "sop.scene_asset.v1",
    description: "Reusable environment and placement pack for scene consistency.",
    invariants: [
      "Preserve environment type, spatial logic, lighting mood, prop family, and camera grammar.",
      "Keep product and model identity outside the scene asset unless supplied by linked assets.",
      "Maintain plausible scale, contact shadows, and depth relationships.",
      "Keep floor plan, horizon line, light direction, surface materials, and subject placement zones stable across scene views.",
      "Reserve model-compatible standing, walking, sitting, and product-holding zones when the scene may be used for model images.",
      "When a model or product is later inserted, the scene asset acts as the lighting plate: visible window or lamp position, sun stripe direction, brightest wall/floor areas, shadow direction, shadow softness, color temperature, background exposure, contact shadows, reflections, and ambient bounce must drive the final subject lighting.",
    ],
    allowedVariations: [
      "Props, crop, lens feel, depth of field, time of day, and surface details can vary within the same scene language.",
      "Subject placement can adapt to composition and platform ratio.",
      "Lighting can be tuned for clarity while preserving the intended mood.",
    ],
    negativeRules: [
      "Do not invent product features or model identity inside scene rules.",
      "Do not create impossible scale, floating objects, or conflicting light directions.",
      "Do not let background props compete with the primary subject.",
      "Do not treat each angle as a different room, different table, different season, or different time of day.",
      "Do not allow pasted-on subjects, cutout edges, halo outlines, conflicting highlight directions, missing floor/table contact shadows, front beauty fill, or separate studio portrait lighting inside a room scene.",
    ],
    qualityRules: [
      "Scene must support the subject clearly without clutter.",
      "Perspective, shadows, and reflections must be internally consistent.",
      "Environment should be commercially usable and not look like a random stock backdrop.",
      "Multiple angles must share recurring visual anchors so the scene reads as one continuous space.",
      "Scene boards should first cover one top-down or high-angle overview plus straight front, back, left, and right views before being used for model composites.",
      "Final model-scene outputs should look like one photograph with shared exposure, color temperature, cast-shadow direction, contact shadows, lens perspective, and grain.",
    ],
    reviewChecks: [
      "scene language clear",
      "subject-independent rules preserved",
      "provider-usable primary reference selected only when safe",
    ],
    promptBoundaries: [
      "Scene asset prompts describe environment, placement, and mood.",
      "Product and model identities must be imported from their own assets.",
    ],
  },
  style_asset: {
    category: "style_asset",
    label: "Style Asset",
    role: "style",
    sopKey: "sop.style_asset.v1",
    description: "Reusable visual language pack for art direction consistency.",
    invariants: [
      "Preserve color palette, lighting character, material language, composition rhythm, and finish level.",
      "Keep style rules reusable across products, models, and scenes.",
      "Separate visual language from subject identity and product construction.",
    ],
    allowedVariations: [
      "Palette emphasis, contrast, texture intensity, crop, and typography allowance can vary by channel.",
      "Style can adapt to product category when the underlying visual language remains recognizable.",
      "Background treatment can vary when it follows the same finish and lighting rules.",
    ],
    negativeRules: [
      "Do not encode product-specific features as style rules.",
      "Do not encode model identity, age, ethnicity, or body details as style rules.",
      "Do not use vague aesthetic labels without concrete visual constraints.",
    ],
    qualityRules: [
      "Style guidance must be specific enough to drive repeatable outputs.",
      "Outputs should share a recognizable visual system across ratios.",
      "Text, texture, and effects must not reduce product readability.",
    ],
    reviewChecks: [
      "style language concrete",
      "subject identity excluded",
      "provider-usable primary reference selected only when safe",
    ],
    promptBoundaries: [
      "Style asset prompts describe art direction only.",
      "Subject, product, model, and scene facts must come from linked assets.",
    ],
  },
};

export function getAssetSopDefinition(category: AssetPackCategory | string): AssetSopDefinition | undefined {
  const normalized = normalizeAssetPackCategory(category);
  return normalized ? ASSET_SOP_REGISTRY[normalized] : undefined;
}
