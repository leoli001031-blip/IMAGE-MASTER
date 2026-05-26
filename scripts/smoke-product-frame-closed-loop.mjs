#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const {
  bindAssetToGenerationFrameSlot,
  buildGenerationFramePlanSpecs,
  buildGenerationFrameReferenceContext,
  buildProductMultiviewWhiteSheetPrompt,
  createGenerationFrameState,
  getGenerationFrameBindingKey,
  markGenerationFramePrimaryAsset,
  moveGenerationFrameAsset,
  resolveGenerationOutputAssetTarget,
} = await importCompiledModules();

const uploads = Array.from({ length: 5 }, (_, index) => ({
  id: `product-upload-${index + 1}`,
  category: "商品",
  title: `商品角度 ${index + 1}`,
  description: "用户拖进商品框的商品参考图",
  status: "ready",
  previewUrl: `data:image/png;base64,product-angle-${index + 1}`,
  referenceUrl: `data:image/png;base64,product-angle-${index + 1}`,
  parameters: {
    source: "product-frame-upload",
  },
}));

const frame = uploads.reduce(
  (current, asset) => bindAssetToGenerationFrameSlot(current, asset, { role: "product" }),
  createGenerationFrameState({
    frameId: "product-frame-smoke",
    outputType: "product_asset",
    prompt: "把这些商品图整理成一张白底多视角商品资产",
  })
);

assert(frame.assets.length === uploads.length, "product frame should retain every uploaded product reference");
assert(frame.assets.every((asset) => asset.role === "product"), "all product-frame uploads should be product refs");

const thirdBindingKey = getGenerationFrameBindingKey(frame.assets[2]);
const reorderedFrame = moveGenerationFrameAsset(frame, thirdBindingKey, "previous");
const reorderedProductIds = reorderedFrame.assets.map((asset) => asset.sourceAssetId);
assert(reorderedProductIds[1] === "product-upload-3", "product frame should allow product references to be reordered");

const secondBindingKey = getGenerationFrameBindingKey(frame.assets[1]);
const primaryFrame = markGenerationFramePrimaryAsset(reorderedFrame, secondBindingKey);
assert(primaryFrame.assets.find((asset) => getGenerationFrameBindingKey(asset) === secondBindingKey)?.primary === true,
  "product frame should allow a product image to become the primary reference");

const context = buildGenerationFrameReferenceContext(primaryFrame);
assert(context?.images.length === uploads.length, "product references should be available to the generation context");
assert(context.images.every((image) => image.role === "product"), "generation context should keep product roles");

const plans = buildGenerationFramePlanSpecs({
  request: frame.prompt,
  outputType: frame.outputType,
  frameLabel: "商品框",
});
assert(plans.length === 1, "product frame should generate one reusable asset output");
assert(plans[0].exportSpecId === "product-multiview-sheet", "product frame should use the multi-view sheet SOP");
assert(plans[0].whiteBackground === true, "product frame output should be a white-background asset");

const prompt = buildProductMultiviewWhiteSheetPrompt({
  userRequest: frame.prompt,
  referenceCount: uploads.length,
  productCategoryHint: "bag",
});
assert(prompt.includes("same physical product"), "product prompt should merge multi-angle refs as one product");
assert(prompt.includes("Do not add people"), "product prompt should forbid people and lifestyle scenes");
assert(prompt.includes("pure or near-pure white background"), "product prompt should enforce white background");

const saveTarget = resolveGenerationOutputAssetTarget({
  outputType: "product_asset",
  artifactType: "output",
});
assert(saveTarget.assetType === "product", "product-frame output should save as a product asset");
assert(saveTarget.canvasCategory === "商品", "product-frame output should return to the product tray");
assert(saveTarget.componentType === "product_asset", "product-frame output should keep component type metadata");
assert(saveTarget.message === "已保存为商品素材", "product-frame save message should not imply auto-collect");

const genericTarget = resolveGenerationOutputAssetTarget({
  outputType: "commercial_image_set",
  artifactType: "output",
});
assert(genericTarget.assetType === "output", "generic generation output should remain an output reference");
assert(genericTarget.savedAssetType === "output_reference", "generic generation output should not become a product");

console.log(JSON.stringify({
  providerCalls: 0,
  uploadedProductRefs: primaryFrame.assets.length,
  contextImages: context.images.length,
  orderedProductRefs: reorderedProductIds,
  planIds: plans.map((plan) => plan.exportSpecId),
  saveTarget: {
    assetType: saveTarget.assetType,
    canvasCategory: saveTarget.canvasCategory,
    componentType: saveTarget.componentType,
  },
}, null, 2));
console.log("Product frame closed-loop smoke passed without provider calls.");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function importCompiledModules() {
  const root = process.cwd();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "image-master-product-frame-smoke-"));
  const files = [
    ["lib/canvas/copy-brief.ts", "copy-brief.mjs"],
    ["lib/canvas/generation-reference-context.ts", "generation-reference-context.mjs"],
    ["lib/canvas/generation-frame.ts", "generation-frame.mjs"],
    ["lib/canvas/generation-output-asset-target.ts", "generation-output-asset-target.mjs"],
    ["lib/ai/prompts/product-multiview.ts", "product-multiview.mjs"],
  ];

  for (const [sourceRelativePath, outputName] of files) {
    const sourcePath = path.join(root, sourceRelativePath);
    const source = fs.readFileSync(sourcePath, "utf8")
      .replaceAll('from "./copy-brief"', 'from "./copy-brief.mjs"')
      .replaceAll(
        'from "./generation-reference-context"',
        'from "./generation-reference-context.mjs"'
      );
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    fs.writeFileSync(path.join(outDir, outputName), output);
  }

  const [frameModule, saveTargetModule, productPromptModule] = await Promise.all([
    import(pathToFileURL(path.join(outDir, "generation-frame.mjs")).href),
    import(pathToFileURL(path.join(outDir, "generation-output-asset-target.mjs")).href),
    import(pathToFileURL(path.join(outDir, "product-multiview.mjs")).href),
  ]);

  return {
    ...frameModule,
    ...saveTargetModule,
    ...productPromptModule,
  };
}
