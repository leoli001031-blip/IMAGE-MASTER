import assert from "node:assert/strict";
import {
  bindGenerationFrameSlot,
  bindAssetToGenerationFrameSlot,
  bindNodeToGenerationFrameSlot,
  buildGenerationFrameReferenceContext,
  buildGenerationFramePlanSpecs,
  createGenerationFrameState,
  getGenerationFrameBindingKey,
  markGenerationFramePrimaryAsset,
  mergeGenerationFrameOutputs,
  migrateLegacyGenerationFrameData,
  removeGenerationFrameAsset,
  updateGenerationFrameAssetRole,
} from "./generation-frame";
import type { CanvasAsset, CanvasNodeData, CanvasWorkbenchNode } from "./workbench-data";

const inlinePng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const legacyData: CanvasNodeData = {
  label: "模特穿着",
  caption: "从商品节点拉出的生成框",
  kind: "output",
  status: "queued",
  metrics: ["1 张", "4:5"],
  iconName: "model",
  componentType: "generation_frame",
  generationActionId: "model-wearing",
  generationOutputType: "model_try_on",
  generationUserRequest: "更自然的日常通勤感",
  sourceNodeId: "product-main",
  sourceNodeLabel: "主商品图",
  sourceNodeType: "product",
  referenceContext: {
    version: 1,
    source: "canvas-workbench",
    images: [{
      role: "style",
      title: "干净电商风",
      url: "/canvas-assets/style-clean.svg",
      providerUsable: false,
    }],
    roles: {
      style: {
        role: "style",
        title: "干净电商风",
        sourceNodeIds: ["style-clean"],
        componentIds: [],
        assetIds: [],
        promptFragments: ["soft commercial light"],
        constraints: [],
        negativeRules: [],
        qualityRules: [],
      },
    },
  },
};

const migrated = migrateLegacyGenerationFrameData(legacyData, "frame-1");
assert.equal(migrated.frameId, "frame-1");
assert.equal(migrated.actionId, "model-wearing");
assert.equal(migrated.outputType, "model_try_on");
assert.equal(migrated.prompt, "更自然的日常通勤感");
assert.equal(migrated.slots.product?.sourceNodeId, "product-main");
assert.equal(migrated.slots.style?.title, "干净电商风");

const modelNode: CanvasWorkbenchNode = {
  id: "model-node",
  position: { x: 0, y: 0 },
  data: {
    label: "日常通勤模特",
    caption: "半身、自然站姿",
    kind: "asset",
    status: "ready",
    metrics: ["模特"],
    iconName: "model",
    category: "模特",
    previewUrl: inlinePng,
    parameters: {
      identityAnchors: ["same face shape"],
    },
    qualityRules: ["Keep pose natural."],
  },
};

const withModel = bindNodeToGenerationFrameSlot(migrated, modelNode);
assert.equal(withModel.slots.model?.sourceNodeId, "model-node");
assert.equal(withModel.slots.model?.providerUsable, true);
assert.deepEqual(withModel.slots.model?.qualityRules, ["Keep pose natural."]);

const styleAsset: CanvasAsset = {
  id: "style-clean",
  category: "风格",
  title: "干净电商风",
  description: "柔光、低饱和",
  status: "ready",
  icon: (() => null) as unknown as CanvasAsset["icon"],
  promptFragments: ["low saturation"],
};

const withStyle = bindAssetToGenerationFrameSlot(withModel, styleAsset);
assert.equal(withStyle.slots.style?.sourceAssetId, "style-clean");
assert.deepEqual(withStyle.slots.style?.promptFragments, [
  "soft commercial light",
  "low saturation",
]);

const withOutputs = mergeGenerationFrameOutputs(createGenerationFrameState(withStyle), [
  { id: "out-1", artifactId: "artifact-1", status: "queued" },
  { id: "out-1b", artifactId: "artifact-1", status: "done", url: "/api/generated-images/1.png" },
]);
assert.equal(withOutputs.outputs.length, 1);
assert.equal(withOutputs.outputs[0]?.status, "done");
assert.equal(withOutputs.outputs[0]?.url, "/api/generated-images/1.png");

const context = buildGenerationFrameReferenceContext(withOutputs);
assert.equal(context?.roles.product?.sourceNodeIds[0], "product-main");
assert.equal(context?.roles.model?.sourceNodeIds[0], "model-node");
assert.equal(context?.roles.style?.assetIds[0], "style-clean");
assert.equal(context?.images.some((image) => image.role === "model" && image.providerUsable), true);

const promptOnlyModel = bindGenerationFrameSlot(migrated, {
  role: "model",
  source: "manual",
  title: "弱模特参考",
  referenceUrl: inlinePng,
  providerMode: "prompt_only",
});
const promptOnlyContext = buildGenerationFrameReferenceContext(promptOnlyModel);
const promptOnlyModelImage = promptOnlyContext?.images.find((image) => image.role === "model");
assert.equal(promptOnlyModel.slots.model?.providerUsable, false);
assert.equal(promptOnlyModelImage?.providerUsable, false);
assert.equal(promptOnlyModelImage?.providerMode, "prompt_only");

const secondProduct: CanvasAsset = {
  id: "product-side-angle",
  category: "商品",
  title: "商品侧面角度",
  description: "补充结构参考",
  status: "ready",
  icon: (() => null) as unknown as CanvasAsset["icon"],
  previewUrl: inlinePng,
  promptFragments: ["side angle reference"],
};

const withSecondProduct = bindAssetToGenerationFrameSlot(withOutputs, secondProduct);
assert.equal(
  withSecondProduct.assets.filter((binding) => binding.role === "product").length,
  2
);

const secondProductKey = getGenerationFrameBindingKey(
  withSecondProduct.assets.find((binding) => binding.sourceAssetId === "product-side-angle")!
);
const primaryProduct = markGenerationFramePrimaryAsset(withSecondProduct, secondProductKey);
const primaryContext = buildGenerationFrameReferenceContext(primaryProduct);
assert.equal(primaryContext?.images.find((image) => image.role === "product")?.assetId, "product-side-angle");

const styleKey = getGenerationFrameBindingKey(
  primaryProduct.assets.find((binding) => binding.sourceAssetId === "style-clean")!
);
const styleAsScene = updateGenerationFrameAssetRole(primaryProduct, styleKey, "scene");
assert.equal(styleAsScene.assets.some((binding) => binding.role === "scene" && binding.sourceAssetId === "style-clean"), true);

const withoutSecondProduct = removeGenerationFrameAsset(styleAsScene, secondProductKey);
assert.equal(
  withoutSecondProduct.assets.some((binding) => binding.sourceAssetId === "product-side-angle"),
  false
);

const scenePlans = buildGenerationFramePlanSpecs({
  request: "生成一套不穿帮的多角度场景图",
  outputType: "scene_display",
});
assert.equal(scenePlans.length, 5);
assert.deepEqual(
  scenePlans.map((plan) => plan.exportSpecId),
  [
    "scene-establishing-wide",
    "scene-product-hero",
    "scene-side-angle",
    "scene-surface-close",
    "scene-reverse-context",
  ]
);
assert.equal(scenePlans.every((plan) => plan.instruction.includes("same floor plan")), true);
assert.equal(scenePlans.every((plan) => plan.instruction.includes("light source direction")), true);

const sceneBoardPlan = buildGenerationFramePlanSpecs({
  request: "做一张合并大图，把场景多个角度放在一张图当中",
  outputType: "scene_display",
});
assert.equal(sceneBoardPlan.length, 1);
assert.equal(sceneBoardPlan[0]?.exportSpecId, "scene-continuity-board");
assert.equal(sceneBoardPlan[0]?.instruction.includes("top-down or high-angle overview"), true);
assert.equal(sceneBoardPlan[0]?.instruction.includes("front, back, left, and right"), true);
assert.equal(sceneBoardPlan[0]?.instruction.includes("same floor plan"), true);
assert.equal(sceneBoardPlan[0]?.instruction.includes("not 30-45 degree shots"), true);

const compoundRequestedPlans = buildGenerationFramePlanSpecs({
  request:
    "基于这只毛绒粉白小包，生成一套真实电商测试图：1张3:2生活方式主图、1张4:5淘宝海报带少量中文卖点、1张1:1商品细节特写、1张9:16小红书封面。",
  outputType: "custom_template",
});
assert.equal(compoundRequestedPlans.length, 4);
assert.deepEqual(
  compoundRequestedPlans.map((plan) => plan.ratio),
  ["3:2", "4:5", "1:1", "9:16"]
);
assert.equal(compoundRequestedPlans[0]?.title.includes("3:2生活方式主图"), true);
assert.equal(compoundRequestedPlans[3]?.title.includes("9:16小红书封面"), true);

const explicitTotalWithBreakdownPlans = buildGenerationFramePlanSpecs({
  request: "生成4张图：1张主图、1张详情、2张场景。",
  outputType: "custom_template",
});
assert.equal(explicitTotalWithBreakdownPlans.length, 4);
