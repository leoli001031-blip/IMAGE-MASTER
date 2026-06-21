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

const chineseSingleShotPlans = buildGenerationFramePlanSpecs({
  request: "生成一张横版咖啡桌商品图，画面安全区烧字「soft day out」，不要人物",
  outputType: "custom_template",
  frameLabel: "图组生成框",
});
assert(chineseSingleShotPlans.length === 1, "single explicit request should create one plan");
assert(chineseSingleShotPlans[0].ratio === "3:2", "Chinese horizontal request should set 3:2 ratio");
assert(chineseSingleShotPlans[0].size === "1536x1024", "Chinese horizontal request should set landscape size");
assert(chineseSingleShotPlans[0].copyRenderMode === "burn_in", "Chinese burn-in request should render text");
assert(chineseSingleShotPlans[0].copyText === "画面文字：soft day out", "Chinese quoted burn-in text should be extracted");

const mixedTextPlans = buildGenerationFramePlanSpecs({
  request: "生成4张成片：1 白底主图 1:1 无字；2 横版海报 3:2 画面安全区烧字「fresh」；3 材质特写 1:1 无字；4 小红书封面 4:5 画面安全区烧字「ritual」。",
  outputType: "custom_template",
  frameLabel: "图组生成框",
});
assert(mixedTextPlans.length === 4, "mixed text request should create four plans");
assert(!mixedTextPlans[0].copyText, "explicit no-text first shot should not inherit global copy");
assert(mixedTextPlans[0].copyRenderMode === "metadata_only", "explicit no-text first shot should stay metadata-only");
assert(mixedTextPlans[0].textAllowed === false, "explicit no-text first shot should forbid text");
assert(mixedTextPlans[1].copyText === "画面文字：fresh", "second shot should keep its own burn-in copy");
assert(mixedTextPlans[1].copyRenderMode === "burn_in", "second shot should burn its own copy");
assert(!mixedTextPlans[2].copyText, "explicit no-text detail shot should not inherit prior copy");
assert(mixedTextPlans[2].copyRenderMode === "metadata_only", "explicit no-text detail shot should stay metadata-only");
assert(mixedTextPlans[3].copyText === "画面文字：ritual", "fourth shot should keep its own burn-in copy");

const projectorCampaignPlans = buildGenerationFramePlanSpecs({
  request: "给这个便携智能投影仪做一套 6 张宣传图：商品主图、细节特写、客厅场景图、户外露营场景图、淘宝详情卖点海报需要烧字、横版活动 banner 不要烧字。比例按用途自适应，商品外观必须跟参考图一致。",
  outputType: "custom_template",
  frameLabel: "样张图组",
});
assert(projectorCampaignPlans.length === 6, "explicit projector campaign list should create six plans");
assert(projectorCampaignPlans[0].title.includes("商品主图"), "first projector shot should stay product main");
assert(projectorCampaignPlans[1].title.includes("细节特写"), "second projector shot should stay detail macro");
assert(projectorCampaignPlans[2].title.includes("客厅场景图"), "third projector shot should stay living room scene");
assert(projectorCampaignPlans[3].title.includes("户外露营场景图"), "fourth projector shot should stay outdoor camping scene");
assert(projectorCampaignPlans[4].title.includes("淘宝详情卖点海报"), "fifth projector shot should stay Taobao selling poster");
assert(projectorCampaignPlans[4].copyRenderMode === "burn_in", "Taobao selling poster should burn requested copy");
assert(projectorCampaignPlans[5].title.includes("横版活动 banner"), "sixth projector shot should stay horizontal banner");
assert(projectorCampaignPlans[5].ratio === "3:2", "horizontal banner should use landscape ratio");
assert(projectorCampaignPlans[5].copyRenderMode === "metadata_only", "explicit no-text banner should stay metadata-only");
assert(projectorCampaignPlans.every((plan) => !plan.title.includes("模特图")), "product-only projector request should not inject model shots");

const countedCampaignPlans = buildGenerationFramePlanSpecs({
  request: "做一组完整的小红书+淘宝宣传图组，共 10 张。需要：1 张小红书封面海报 2:3 带字；3 张模特展示图 2:3，必须是同一个模特，但每张姿势完全不同：分别安排站立侧身回头、边走边看向橱窗、坐在花店外椅子上低头整理包；2 张商品静物场景图 3:2；2 张材质/五金细节图 4:5；2 张详情页卖点海报 4:5 带短文案。",
  outputType: "custom_template",
  frameLabel: "图组生成框",
  maxItems: 10,
});
assert(countedCampaignPlans.length === 10, "counted campaign request should expand to ten plans");
assert(countedCampaignPlans.filter((plan) => plan.title.includes("模特展示图")).length === 3, "three model shots should be separate plans");
assert(countedCampaignPlans.some((plan) => plan.title.includes("边走边看向橱窗")), "model shot variants should preserve distinct pose directions");
assert(countedCampaignPlans.filter((plan) => plan.title.includes("商品静物场景图")).length === 2, "two still-life shots should be separate plans");
assert(countedCampaignPlans.filter((plan) => plan.title.includes("材质/五金细节图")).length === 2, "two detail shots should be separate plans");
assert(countedCampaignPlans.filter((plan) => plan.copyRenderMode === "burn_in").length === 3, "cover plus two short-copy detail posters should burn text");

const multilineCampaignPlans = buildGenerationFramePlanSpecs({
  request: `基于当前商品和模特做一套宣传图，共 14 张。
需要：
1 张小红书封面海报 2:3 带字；
4 张模特展示图 2:3，必须是同一个模特但姿势不同：分别安排站立侧身回头、边走边看向橱窗、坐在椅子上整理包扣、半蹲在花桶旁挑花；
2 张街拍生活场景图 3:2，有模特但姿势不同；
2 张商品静物场景图 3:2，无人物、无模特；
2 张材质/五金细节图 4:5，无人物、无模特；
3 张详情页卖点海报 4:5 带短文案。`,
  outputType: "custom_template",
  frameLabel: "图组生成框",
  maxItems: 20,
});
assert(multilineCampaignPlans.length === 14, "multiline campaign should expand past ten plans");
assert(multilineCampaignPlans.filter((plan) => plan.title.includes("模特展示图")).length === 4, "four model shots should be separate plans");
assert(multilineCampaignPlans.some((plan) => plan.title.includes("半蹲在花桶旁挑花")), "fourth model pose should survive parsing");
assert(multilineCampaignPlans.filter((plan) => plan.title.includes("商品静物场景图")).every((plan) => plan.modelRequired === false), "still-life shots must not require model");
assert(multilineCampaignPlans.filter((plan) => plan.title.includes("材质/五金细节图")).every((plan) => plan.modelRequired === false), "detail shots must not require model");
assert(multilineCampaignPlans.filter((plan) => plan.copyRenderMode === "burn_in").length === 4, "cover plus three detail posters should burn text");

console.log(JSON.stringify({
  providerCalls: 0,
  productPlanIds: productPlans.map((plan) => plan.id),
  modelPlanIds: modelPlans.map((plan) => plan.id),
  scenePlanIds: scenePlans.map((plan) => plan.id),
  stylePlanIds: stylePlans.map((plan) => plan.id),
  chineseSingleShot: {
    ratio: chineseSingleShotPlans[0].ratio,
    size: chineseSingleShotPlans[0].size,
    copyRenderMode: chineseSingleShotPlans[0].copyRenderMode,
    copyText: chineseSingleShotPlans[0].copyText,
  },
  mixedTextPlans: mixedTextPlans.map((plan) => ({
    title: plan.title,
    copyRenderMode: plan.copyRenderMode,
    copyText: plan.copyText,
    textAllowed: plan.textAllowed,
  })),
  countedCampaignPlans: countedCampaignPlans.map((plan) => ({
    title: plan.title,
    ratio: plan.ratio,
    copyRenderMode: plan.copyRenderMode,
    modelRequired: plan.modelRequired,
  })),
  multilineCampaignCount: multilineCampaignPlans.length,
  multilineCampaignBurnInCount: multilineCampaignPlans.filter((plan) => plan.copyRenderMode === "burn_in").length,
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
