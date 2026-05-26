#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const {
  buildGenerationFramePlanSpecs,
  createGenerationFrameState,
} = await importCompiledCanvasModules();
const {
  resolveGenerationFrameRunRule,
} = await importCompiledCanvasModules();

const productPlans = buildGenerationFramePlanSpecs({
  request: "",
  outputType: "product_asset",
  frameLabel: "商品资产框",
});
assert(productPlans.length === 1, "product_asset should default to one reusable asset sheet");
assert(productPlans[0].exportSpecId === "product-multiview-sheet", "product_asset should use multi-view sheet SOP");
assert(productPlans[0].instruction.includes("single reusable white-background multi-view product identity sheet"), "product_asset prompt should be white-sheet specific");
assert(productPlans[0].whiteBackground === true, "product_asset should default to white background");

const modelPlans = buildGenerationFramePlanSpecs({
  request: "东欧高级商业模特",
  outputType: "model_asset",
  frameLabel: "模特生成框",
});
assert(modelPlans.length === 1, "model_asset should default to one model identity asset");
assert(modelPlans[0].exportSpecId === "model-identity-reference", "model_asset should use model identity SOP");
assert(modelPlans[0].instruction.includes("person asset only"), "model_asset prompt must keep person layer separate");

const scenePlans = buildGenerationFramePlanSpecs({
  request: "北欧风家居客厅",
  outputType: "scene_asset",
  frameLabel: "场景生成框",
});
assert(scenePlans.length >= 4, "scene_asset should provide a multi-view scene plan");
assert(scenePlans.some((plan) => plan.exportSpecId === "scene-establishing-wide"), "scene_asset should include an establishing view");

const stylePlans = buildGenerationFramePlanSpecs({
  request: "干净高级自然光",
  outputType: "style_asset",
  frameLabel: "风格生成框",
});
assert(stylePlans.length === 1, "style_asset should default to one style reference plate");
assert(stylePlans[0].exportSpecId === "style-reference-plate", "style_asset should use style plate SOP");

const emptyProductDecision = resolveGenerationFrameRunRule({
  outputType: "product_asset",
  frame: createGenerationFrameState({ frameId: "product-empty", outputType: "product_asset" }),
});
assert(emptyProductDecision.canRun === false, "product_asset must still require product reference");

const modelTextDecision = resolveGenerationFrameRunRule({
  outputType: "model_asset",
  frame: createGenerationFrameState({
    frameId: "model-text",
    outputType: "model_asset",
    prompt: "东欧高级商业模特",
  }),
});
assert(modelTextDecision.canRun === true, "model_asset text-only should be runnable");
assert(modelTextDecision.requiredReferenceRoles.length === 0, "model_asset should not require product role");

const sceneTextDecision = resolveGenerationFrameRunRule({
  outputType: "scene_asset",
  frame: createGenerationFrameState({
    frameId: "scene-text",
    outputType: "scene_asset",
    prompt: "北欧风家居客厅，自然窗光",
  }),
});
assert(sceneTextDecision.canRun === true, "scene_asset text-only should be runnable");

const styleTextDecision = resolveGenerationFrameRunRule({
  outputType: "style_asset",
  frame: createGenerationFrameState({
    frameId: "style-text",
    outputType: "style_asset",
    prompt: "干净高级自然光",
  }),
});
assert(styleTextDecision.canRun === true, "style_asset text-only should be runnable");

const knowledgeDecision = resolveGenerationFrameRunRule({
  outputType: "knowledge_asset",
  frame: createGenerationFrameState({ frameId: "knowledge", outputType: "knowledge_asset" }),
});
assert(knowledgeDecision.canRun === true, "knowledge cards should not require images");

console.log(JSON.stringify({
  providerCalls: 0,
  productPlanIds: productPlans.map((plan) => plan.id),
  modelPlanIds: modelPlans.map((plan) => plan.id),
  scenePlanIds: scenePlans.map((plan) => plan.id),
  stylePlanIds: stylePlans.map((plan) => plan.id),
  decisions: {
    productEmpty: emptyProductDecision.canRun,
    modelTextOnly: modelTextDecision.canRun,
    sceneTextOnly: sceneTextDecision.canRun,
    styleTextOnly: styleTextDecision.canRun,
    knowledge: knowledgeDecision.canRun,
  },
}, null, 2));
console.log("Generation frame SOP smoke passed without provider calls.");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function importCompiledCanvasModules() {
  const root = process.cwd();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "image-master-frame-sop-smoke-"));
  const files = [
    "copy-brief",
    "generation-reference-context",
    "generation-frame",
    "generation-frame-action-registry",
  ];

  for (const name of files) {
    const sourcePath = path.join(root, "lib/canvas", `${name}.ts`);
    const source = fs.readFileSync(sourcePath, "utf8")
      .replaceAll('from "./copy-brief"', 'from "./copy-brief.mjs"')
      .replaceAll(
        'from "./generation-reference-context"',
        'from "./generation-reference-context.mjs"'
      )
      .replaceAll(
        'from "@/lib/canvas/generation-frame"',
        'from "./generation-frame.mjs"'
      )
      .replaceAll(
        'from "@/lib/canvas/generation-reference-context"',
        'from "./generation-reference-context.mjs"'
      );
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    fs.writeFileSync(path.join(outDir, `${name}.mjs`), output);
  }

  const [frameModule, actionModule] = await Promise.all([
    import(pathToFileURL(path.join(outDir, "generation-frame.mjs")).href),
    import(pathToFileURL(path.join(outDir, "generation-frame-action-registry.mjs")).href),
  ]);

  return {
    ...frameModule,
    ...actionModule,
  };
}
