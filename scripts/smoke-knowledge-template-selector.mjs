#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const { selectKnowledgeTemplates } = await importCompiledSelector();

const inlinePng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const selection = selectKnowledgeTemplates({
  request: "Amazon 详情页 人物真实感 产品一致性",
  referenceContext: {
    version: 1,
    source: "canvas-workbench",
    images: [{
      role: "product",
      title: "Amazon smoke product",
      url: inlinePng,
      providerUsable: true,
      source: "smoke",
      nodeId: "product-smoke",
    }],
    roles: {
      product: {
        role: "product",
        title: "Amazon smoke product",
        sourceNodeIds: ["product-smoke"],
        componentIds: [],
        assetIds: ["asset-product-smoke"],
        promptFragments: ["Keep product construction and color locked."],
        constraints: ["Do not invent product features."],
        negativeRules: [],
        qualityRules: ["Product identity must stay consistent."],
      },
    },
    promptFragments: [],
    constraints: [],
    negativeRules: [],
    qualityRules: [],
  },
  templateCandidates: [
    {
      id: "template_product_detail_page",
      title: "Product Detail Page",
      description: "Build a product detail page sequence with close-ups, copy-safe areas, and QA.",
      category: "product_detail_page",
      status: "published",
      metadata: {
        scenario: "product_detail_page",
        tags: ["detail-page", "commerce", "copy"],
        sourceTutorialIds: ["super-i-detail-page-001"],
        qualityRules: ["Detail modules must preserve product material, color, and structure."],
      },
    },
    {
      id: "template_xiaohongshu_cover",
      title: "Xiaohongshu Cover",
      description: "Social cover template.",
      category: "poster_set",
      status: "published",
      metadata: {
        scenario: "xiaohongshu_cover",
        tags: ["cover", "social"],
      },
    },
  ],
  components: [
    {
      id: "commercial.platform.amazon_main_image",
      title: "Amazon Main Image Rules",
      description: "Amazon listing compliance and clean product focus.",
      type: "platform_rule",
      status: "published",
      metadata: {
        componentType: "platform_rule",
        tags: ["amazon", "listing", "product consistency"],
        sourceTutorialIds: ["super-i-amazon-main-001"],
        qualityRules: ["Amazon output must avoid fake badges, unsupported claims, and dense text overlays."],
      },
    },
    {
      id: "commercial.quality.product_consistency",
      title: "Product Consistency Guard",
      description: "Preserve product identity, material, and exact structure.",
      type: "quality_rule",
      status: "published",
      metadata: {
        componentType: "quality_rule",
        tags: ["product_consistency", "identity", "truthful"],
        sourceTutorialIds: ["super-i-product-consistency-001"],
        qualityRules: ["Every output must preserve the source product silhouette, color, material, and logo regions."],
      },
    },
    {
      id: "commercial.quality.human_realism",
      title: "Human Realism Guard",
      description: "人物真实感：hands, face, pose, body mechanics, and natural commercial presence.",
      type: "quality_rule",
      status: "published",
      metadata: {
        componentType: "quality_rule",
        tags: ["human", "model", "realism", "人物真实感"],
        sourceTutorialIds: ["super-i-human-realism-001"],
        qualityRules: ["Hands, face, posture, and model-product contact must look natural."],
      },
    },
    {
      id: "knowledge.copy.amazon_detail",
      title: "Amazon Detail Copy Knowledge",
      description: "Prompt-only copy card for detail-page selling points and claims.",
      type: "prompt_source",
      status: "published",
      metadata: {
        componentType: "prompt_source",
        referenceMode: "prompt_only",
        sourceTutorialIds: ["super-i-copy-rules-001"],
        qualityRules: ["Copy claims stay structured and must not be burned into the image by default."],
      },
    },
  ],
});

assert(selection.sopKeys[0] === "sop.product_asset.v1", "product SOP should be first");
assert(selection.sopKeys.includes("sop.model_asset.v1"), "model SOP should be selected for 人物真实感");
assert(selection.sopKeys.includes("sop.knowledge_prompt_only.v1"), "knowledge prompt-only SOP should be selected");
assert(selection.requiredReferenceRoles.includes("product"), "product reference should be required");
assert(
  selection.selectedTemplates.some((item) => item.id === "template_product_detail_page"),
  "detail-page template should be selected"
);
assert(
  selection.selectedTemplates.some((item) => item.id === "commercial.platform.amazon_main_image"),
  "Amazon platform component should be selected"
);
assert(
  selection.selectedTemplates.some((item) => item.id === "commercial.quality.product_consistency"),
  "product-consistency quality rule should be selected"
);
assert(
  selection.selectedTemplates.some((item) => item.id === "commercial.quality.human_realism"),
  "human-realism quality rule should be selected"
);
assert(
  selection.selectedTemplates.some((item) => item.id === "knowledge.copy.amazon_detail" && item.referenceMode === "prompt_only"),
  "copy knowledge card should remain prompt-only"
);
assert(
  selection.sourceTutorialIds.includes("super-i-amazon-main-001") &&
    selection.sourceTutorialIds.includes("super-i-human-realism-001"),
  "source tutorial ids should be preserved"
);
assert(
  selection.qualityRules.some((rule) => rule.includes("Product identity must come from product SOP")),
  "product/model boundary quality rule should be present"
);
assert(
  selection.qualityRules.some((rule) => rule.includes("Hands, face")),
  "human realism quality rule should be present"
);
assert(
  selection.warnings.some((warning) => warning.includes("prompt-only")),
  "prompt-only knowledge warning should be present"
);

console.log(JSON.stringify({
  providerCalls: 0,
  sopKeys: selection.sopKeys,
  requiredReferenceRoles: selection.requiredReferenceRoles,
  selectedTemplates: selection.selectedTemplates.map((item) => ({
    id: item.id,
    source: item.source,
    referenceMode: item.referenceMode,
    score: item.score,
  })),
  sourceTutorialIds: selection.sourceTutorialIds,
  warnings: selection.warnings,
}, null, 2));
console.log("Knowledge template selector smoke passed without provider calls.");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function importCompiledSelector() {
  const root = process.cwd();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "image-master-knowledge-selector-smoke-"));
  const files = [
    "asset-pack-types",
    "asset-sop-registry",
    "generation-reference-context",
    "knowledge-template-selector",
  ];

  for (const name of files) {
    const sourcePath = path.join(root, "lib/canvas", `${name}.ts`);
    const source = fs.readFileSync(sourcePath, "utf8")
      .replaceAll('from "./asset-pack-types"', 'from "./asset-pack-types.mjs"')
      .replaceAll('from "./asset-sop-registry"', 'from "./asset-sop-registry.mjs"')
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
    fs.writeFileSync(path.join(outDir, `${name}.mjs`), output);
  }

  return import(pathToFileURL(path.join(outDir, "knowledge-template-selector.mjs")).href);
}
