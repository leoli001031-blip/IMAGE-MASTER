#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const {
  buildAssetPackDraft,
  isProviderUsableAssetPackReference,
  buildAssetPackGenerationPlan,
} = await importCompiledAssetPackModules();

const categories = ["product_asset", "model_asset", "scene_asset", "style_asset"];
const sourceImages = [
  "/api/generated-images/smoke-primary.png",
  "https://example.com/not-provider-usable.jpg",
  {
    url: "data:image/png;base64,iVBORw0KGgo=",
    title: "Inline safe reference",
  },
];

const packs = categories.map((category) =>
  buildAssetPackDraft({
    category,
    userRequest: requestFor(category),
    sourceImages,
  })
);

for (const pack of packs) {
  const generationPlan = buildAssetPackGenerationPlan(pack);
  assert(pack.schemaVersion === 1, `${pack.category} schemaVersion mismatch`);
  assert(pack.status === "draft", `${pack.category} should be a draft`);
  assert(pack.review.state === "unreviewed", `${pack.category} review state mismatch`);
  assert(pack.providerUsablePrimaryReference === "/api/generated-images/smoke-primary.png",
    `${pack.category} provider usable primary reference mismatch`);
  assert(pack.referenceImages.length === 3, `${pack.category} reference image count mismatch`);
  assert(pack.referenceImages.filter((image) => image.providerUsable).length === 2,
    `${pack.category} provider usable count mismatch`);
  assert(pack.invariants.length > 0, `${pack.category} invariants missing`);
  assert(pack.allowedVariations.length > 0, `${pack.category} allowed variations missing`);
  assert(pack.negativeRules.length > 0, `${pack.category} negative rules missing`);
  assert(pack.qualityRules.length > 0, `${pack.category} quality rules missing`);
  assert(pack.promptBoundaries.length > 0, `${pack.category} prompt boundaries missing`);
  assert(generationPlan.referenceMode === "image_to_image", `${pack.category} generation reference mode mismatch`);
  assert(generationPlan.providerReferenceUrl === "/api/generated-images/smoke-primary.png",
    `${pack.category} generation provider reference mismatch`);
  assert(Array.isArray(generationPlan.providerReferenceUrls), `${pack.category} provider reference list missing`);
  assert(generationPlan.providerReferenceUrls[0] === "/api/generated-images/smoke-primary.png",
    `${pack.category} provider reference list primary mismatch`);
  if (pack.category === "product_asset") {
    assert(generationPlan.providerReferenceUrls.length === 2,
      "product asset should keep multiple provider-usable product references");
  } else {
    assert(generationPlan.providerReferenceUrls.length === 1,
      `${pack.category} should stay single-reference safe`);
  }
  if (pack.category === "product_asset") {
    assert(generationPlan.prompt.includes("Purpose:"), "product asset prompt purpose missing");
    assert(generationPlan.prompt.includes("Reference usage:"), "product asset reference usage missing");
    assert(generationPlan.prompt.includes("Quality target:"), "product asset quality target missing");
    assert(generationPlan.prompt.includes("Negative rules:"), "product asset negative rules missing");
  } else {
    assert(generationPlan.prompt.includes("Asset usage:"), `${pack.category} asset usage prompt missing`);
    assert(generationPlan.prompt.includes("Reference image requirements:"), `${pack.category} reference requirements missing`);
    assert(generationPlan.prompt.includes("Quality requirements:"), `${pack.category} quality requirements missing`);
    assert(
      generationPlan.prompt.includes("Negative rules:") || generationPlan.metadata.negativeRules.length > 0,
      `${pack.category} negative rules missing from prompt/metadata`
    );
    assert(
      generationPlan.prompt.includes("Reusable metadata fields to preserve:") ||
        generationPlan.metadata.reusableMetadataFields.length > 0,
      `${pack.category} reusable metadata fields missing from prompt/metadata`
    );
  }
  assert(generationPlan.metadata.category === pack.category, `${pack.category} metadata category mismatch`);
  assert(generationPlan.metadata.assetUsage, `${pack.category} metadata asset usage missing`);
  assert(generationPlan.metadata.referenceImageRequirements.length > 0,
    `${pack.category} metadata reference requirements missing`);
  assert(generationPlan.metadata.qualityStandards.length > 0,
    `${pack.category} metadata quality standards missing`);
  assert(generationPlan.metadata.negativeRules.length > 0, `${pack.category} metadata negative rules missing`);
  assert(generationPlan.metadata.reusableMetadataFields.length >= 6,
    `${pack.category} reusable metadata field list too thin`);
}

const modelPack = packs.find((pack) => pack.category === "model_asset");
assert(modelPack, "model pack missing");
const modelPlan = buildAssetPackGenerationPlan(modelPack);
const modelText = [
  ...modelPack.invariants,
  ...modelPack.allowedVariations,
  ...modelPack.negativeRules,
  ...modelPack.promptBoundaries,
  modelPlan.prompt,
  ...(modelPlan.metadata.separationRules ?? []),
].join("\n").toLowerCase();
assert(modelText.includes("person asset"), "model pack must preserve person asset boundary");
assert(!modelText.includes("wearing the product."), "model pack should not hard-code product wearing");
assert(modelText.includes("person-identity layer"), "model generation SOP must separate person and product layers");
assert(modelText.includes("linked product asset"), "model generation SOP must defer product styling to linked product assets");

const productPlan = buildAssetPackGenerationPlan(packs.find((pack) => pack.category === "product_asset"));
assert(productPlan.metadata.reusableMetadataFields.includes("construction_details"),
  "product generation metadata must preserve product construction fields");
assert(productPlan.metadata.promptFamily === "product.multiview-white-sheet.v1",
  "product generation metadata must expose the multi-view white-sheet prompt family");
assert(productPlan.prompt.includes("white-background multi-view product reference sheet"),
  "product generation prompt must create a white-background multi-view sheet");
assert(productPlan.prompt.includes("Treat every attached image as the same physical product"),
  "product generation prompt must consolidate multiple product views");
assert(productPlan.prompt.includes("Do not add people"),
  "product generation prompt must keep product assets separate from model layers");

const scenePlan = buildAssetPackGenerationPlan(packs.find((pack) => pack.category === "scene_asset"));
assert(scenePlan.prompt.includes("Scene description structure - overview:"),
  "scene generation prompt must include overview structure");
assert(scenePlan.prompt.includes("Scene description structure - multi-view constraints:"),
  "scene generation prompt must include multi-view constraints");
assert(scenePlan.metadata.sceneDescriptionStructure?.overview,
  "scene generation metadata must include overview structure");
assert(scenePlan.metadata.sceneDescriptionStructure?.multiViewConstraints?.length >= 4,
  "scene generation metadata must include multiple view constraints");

const stylePlan = buildAssetPackGenerationPlan(packs.find((pack) => pack.category === "style_asset"));
assert(stylePlan.metadata.reusableMetadataFields.includes("post_process_finish"),
  "style generation metadata must preserve style finish fields");

assert(!isProviderUsableAssetPackReference("https://example.com/a.png"), "remote URLs must not be provider usable");
assert(isProviderUsableAssetPackReference("/api/generated-images/a.png"), "generated image URLs should be provider usable");
assert(isProviderUsableAssetPackReference("data:image/jpeg;base64,abc"), "data image URLs should be provider usable");

console.log(JSON.stringify({
  categories: packs.map((pack) => pack.category),
  providerCalls: 0,
  primaryReferences: packs.map((pack) => pack.providerUsablePrimaryReference),
  generationReferenceModes: packs.map((pack) => buildAssetPackGenerationPlan(pack).referenceMode),
  generationMetadataFields: packs.map((pack) => ({
    category: pack.category,
    fields: buildAssetPackGenerationPlan(pack).metadata.reusableMetadataFields,
  })),
  ids: packs.map((pack) => pack.id),
}, null, 2));
console.log("Asset pack dry-run smoke passed without provider calls.");

function requestFor(category) {
  switch (category) {
    case "product_asset":
      return "通勤女包资产包，保留皮革纹理和金属 logo，允许换背景和光线";
    case "model_asset":
      return "复用模特资产，只锁定人物身份、发型、气质和身形，不绑定任何商品";
    case "scene_asset":
      return "咖啡店窗边生活方式场景，柔和日光，保留空间透视和道具氛围";
    case "style_asset":
      return "干净高级的电商视觉风格，低饱和配色，清晰材质和轻微胶片质感";
    default:
      return "资产包 dry-run";
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function importCompiledAssetPackModules() {
  const root = process.cwd();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "image-master-asset-pack-smoke-"));
  const files = [
    ["lib/ai/prompts", "product-multiview"],
    ["lib/ai", "provider-call-policy"],
    "asset-pack-types",
    "asset-auto-naming",
    "asset-sop-registry",
    "asset-pack-builder",
    "asset-pack-generation",
  ];

  for (const item of files) {
    const [folder, name] = Array.isArray(item) ? item : ["lib/canvas", item];
    const sourcePath = path.join(root, folder, `${name}.ts`);
    const source = fs.readFileSync(sourcePath, "utf8")
      .replaceAll('from "./asset-pack-types"', 'from "./asset-pack-types.mjs"')
      .replaceAll('from "./asset-auto-naming"', 'from "./asset-auto-naming.mjs"')
      .replaceAll('from "./asset-sop-registry"', 'from "./asset-sop-registry.mjs"')
      .replaceAll('from "../ai/prompts/product-multiview"', 'from "./product-multiview.mjs"')
      .replaceAll('from "../ai/provider-call-policy"', 'from "./provider-call-policy.mjs"');
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    fs.writeFileSync(path.join(outDir, `${name}.mjs`), output);
  }

  const [builderModule, generationModule] = await Promise.all([
    import(pathToFileURL(path.join(outDir, "asset-pack-builder.mjs")).href),
    import(pathToFileURL(path.join(outDir, "asset-pack-generation.mjs")).href),
  ]);
  return {
    ...builderModule,
    ...generationModule,
  };
}
