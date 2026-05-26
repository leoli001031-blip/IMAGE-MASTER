#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const {
  appendGenerationReferencePrompt,
  buildProviderReferenceAdapter,
  getPrimaryProviderReferenceUrl,
} = await importCompiledReferenceContext();

const context = {
  version: 1,
  source: "canvas-workbench",
  images: [
    {
      role: "style",
      title: "Style board",
      url: "data:image/png;base64,bbbb",
      providerUsable: true,
    },
    {
      role: "product",
      title: "Product photo",
      url: "/api/generated-images/product.png",
      providerUsable: true,
    },
    {
      role: "model",
      title: "Model identity",
      url: "/api/generated-images/model.png",
      providerUsable: true,
    },
    {
      role: "scene",
      title: "Scene notes",
      url: "https://example.com/scene.jpg",
      providerUsable: false,
    },
  ],
  roles: {
    product: {
      role: "product",
      title: "Product photo",
      sourceNodeIds: [],
      componentIds: [],
      assetIds: [],
      promptFragments: [],
      constraints: ["Keep product material and logo region stable."],
      negativeRules: ["Do not change product shape."],
      qualityRules: ["Product must remain recognizable."],
    },
    model: {
      role: "model",
      title: "Model identity",
      sourceNodeIds: [],
      componentIds: [],
      assetIds: [],
      promptFragments: ["Use adult professional model identity cues."],
      constraints: [],
      negativeRules: [],
      qualityRules: [],
    },
    style: {
      role: "style",
      title: "Style board",
      sourceNodeIds: [],
      componentIds: [],
      assetIds: [],
      promptFragments: ["Low saturation, soft daylight."],
      constraints: [],
      negativeRules: [],
      qualityRules: [],
    },
    scene: {
      role: "scene",
      title: "Kitchen counter",
      sourceNodeIds: [],
      componentIds: [],
      assetIds: [],
      promptFragments: ["Place the product on a clean kitchen counter."],
      constraints: ["Keep the scene bright and uncluttered."],
      negativeRules: [],
      qualityRules: [],
    },
  },
  promptFragments: [],
  constraints: [],
  negativeRules: [],
  qualityRules: [],
};

const adapter = buildProviderReferenceAdapter(context);
assert(adapter.mode === "multi_image_input", "Expected multi image provider mode");
assert(adapter.strategy === "multi_provider_usable_images", "Expected multi-reference provider strategy");
assert(adapter.primaryImage?.role === "product", "Expected product to win provider reference priority");
assert(adapter.providerUsableImages.length === 3, "Expected product/model/style to be provider image eligible");
assert(adapter.promptOnlyImages.length === 1, "Expected only unsafe remote scene reference to become prompt-only");
assert(
  adapter.providerUsableImages.map((image) => image.role).join(",") === "product,model,style",
  "Expected provider references to keep stable role priority"
);
assert(
  adapter.promptOnlyImages.map((image) => image.role).join(",") === "scene",
  "Expected prompt-only references to include only unsafe scene"
);
assert(
  getPrimaryProviderReferenceUrl(context) === "/api/generated-images/product.png",
  "Expected primary provider reference URL"
);

const prompt = appendGenerationReferencePrompt("Create a commercial image.", context);
assert(prompt.includes("已传入参考图"), "Expected provider adapter prompt line");
assert(prompt.includes("仅作文字约束"), "Expected prompt-only adapter prompt line");
assert(prompt.includes("商品参考：只锁商品身份"), "Expected compact product role rule");
assert(prompt.includes("模特参考：只锁同一人身份"), "Expected compact model role rule");
assert(prompt.includes("风格参考：只负责色调"), "Expected compact style role rule");
assert(prompt.includes("场景参考：负责环境"), "Expected compact scene role rule");
assert(
  prompt.includes("光影规则"),
  "Expected model-scene lighting integration rule"
);
assert(
  prompt.includes("神态规则"),
  "Expected model-scene expression rule"
);

const whiteBackgroundPrompt = appendGenerationReferencePrompt(
  "Create a pure white background marketplace main image, no model.",
  context
);
assert(
  !whiteBackgroundPrompt.includes("商品入景规则"),
  "Expected strict white-background/no-model prompt to skip scene insertion rules"
);

const modelOnly = {
  ...context,
  images: context.images.filter((image) => image.role !== "product"),
  roles: {
    model: context.roles.model,
    style: context.roles.style,
    scene: context.roles.scene,
  },
};
const modelAdapter = buildProviderReferenceAdapter(modelOnly);
assert(modelAdapter.mode === "multi_image_input", "Expected model/style provider mode when product is absent");
assert(modelAdapter.primaryImage?.role === "model", "Expected model to become primary when product is absent");
assert(modelAdapter.providerUsableImages.length === 2, "Expected model/style provider-eligible images without product");
assert(modelAdapter.strategy === "multi_provider_usable_images", "Expected multi-reference strategy without product");
assert(getPrimaryProviderReferenceUrl(modelOnly) === "/api/generated-images/model.png", "Expected model provider URL without product");
assert(
  modelAdapter.promptOnlyImages.map((image) => image.role).join(",") === "scene",
  "Expected only unsafe scene to remain prompt-only without product"
);
const modelOnlyUsesProductReference = modelAdapter.primaryImage?.role === "product";
assert(modelOnlyUsesProductReference === false, "Expected no usesProductReference signal without product");
const modelOnlyPrompt = appendGenerationReferencePrompt("Create a commercial image.", modelOnly);
assert(modelOnlyPrompt.includes("已传入参考图"), "Expected provider image line without product");
assert(modelOnlyPrompt.includes("光影规则"), "Expected lighting integration rule without product");
assert(
  modelOnlyPrompt.includes("模特参考：只锁同一人身份"),
  "Expected model-scene prompt to warn against preserving model-reference studio lighting"
);
assert(
  !modelOnlyPrompt.includes("商品入景规则"),
  "Expected model-only prompt not to use product-model capture rules"
);

const softModel = {
  ...context,
  images: context.images.map((image) =>
    image.role === "model"
      ? { ...image, providerMode: "prompt_only", providerUsable: true }
      : image
  ),
};
const softModelAdapter = buildProviderReferenceAdapter(softModel);
assert(softModelAdapter.mode === "multi_image_input", "Expected product/style provider mode with soft model");
assert(
  softModelAdapter.providerUsableImages.map((image) => image.role).join(",") === "product,style",
  "Expected prompt-only model to be excluded from provider image inputs"
);
assert(
  softModelAdapter.promptOnlyImages.map((image) => image.role).join(",") === "model,scene",
  "Expected soft model and unsafe scene to remain prompt-only"
);

const unsafeProduct = {
  ...context,
  images: [{
    role: "product",
    title: "Remote product",
    url: "https://example.com/product.jpg",
    providerUsable: true,
  }],
  roles: {
    product: context.roles.product,
  },
};
const unsafeProductAdapter = buildProviderReferenceAdapter(unsafeProduct);
assert(unsafeProductAdapter.mode === "prompt_only", "Expected unsafe product URL to stay prompt-only");
assert(
  getPrimaryProviderReferenceUrl(unsafeProduct) === undefined,
  "Expected unsafe product URL not to become provider URL"
);

console.log(JSON.stringify({
  primaryRole: adapter.primaryImage.role,
  promptOnlyRoles: adapter.promptOnlyImages.map((image) => image.role),
  providerEligibleRoles: adapter.providerUsableImages.map((image) => image.role),
  modelOnlyMode: modelAdapter.mode,
  modelOnlyPromptOnlyRoles: modelAdapter.promptOnlyImages.map((image) => image.role),
  modelOnlyUsesProductReference,
  softModelProviderEligibleRoles: softModelAdapter.providerUsableImages.map((image) => image.role),
  softModelPromptOnlyRoles: softModelAdapter.promptOnlyImages.map((image) => image.role),
  unsafeProductMode: unsafeProductAdapter.mode,
}, null, 2));
console.log("Reference adapter smoke passed without provider calls.");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function importCompiledReferenceContext() {
  const root = process.cwd();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "image-master-reference-adapter-smoke-"));
  const sourcePath = path.join(root, "lib/canvas/generation-reference-context.ts");
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const outputPath = path.join(outDir, "generation-reference-context.mjs");
  fs.writeFileSync(outputPath, output);
  return import(pathToFileURL(outputPath).href);
}
