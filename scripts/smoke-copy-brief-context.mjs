#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const {
  getCanvasNodeCopyBriefSummary,
  bindAssetToGenerationFrameSlot,
  bindNodeToGenerationFrameSlot,
  buildGenerationFrameReferenceContext,
  buildGenerationReferencePromptBlock,
  buildProviderReferenceAdapter,
  createGenerationFrameState,
} = await importCompiledCanvasModules();

const inlinePng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const copyText = [
  "标题：轻盈通勤，不止好看",
  "卖点：280g 轻量机身",
  "参数：支持全天候防泼水",
  "导出文案：适合小红书种草笔记首屏说明",
  "禁止：不要写医美级、100%防水、官方认证",
].join("\n");

const copyNode = {
  id: "copy-node-1",
  position: { x: 0, y: 0 },
  data: {
    label: "小红书首屏文案",
    caption: copyText,
    kind: "asset",
    status: "ready",
    metrics: [],
    iconName: "copy",
    category: "文案",
    componentType: "copy_asset",
    parameters: {
      text: copyText,
    },
  },
};

const summary = getCanvasNodeCopyBriefSummary(copyNode.data);
assert(summary.totalItemCount >= 4, "copy summary should split source text into sections");
assert(
  summary.sections.some((section) => section.id === "inImageText" && section.count > 0),
  "copy summary should expose visible text section"
);
assert(
  summary.sections.some((section) => section.id === "sellingPoints" && section.count > 0),
  "copy summary should expose selling point section"
);
assert(
  summary.sections.some((section) => section.id === "exportCopy" && section.count > 0),
  "copy summary should expose export copy section"
);
assert(
  summary.sections.some((section) => section.id === "forbiddenClaims" && section.count > 0),
  "copy summary should expose forbidden claim section"
);

const frameWithCopy = bindNodeToGenerationFrameSlot(
  createGenerationFrameState({ frameId: "frame-copy-smoke" }),
  copyNode
);
assert(frameWithCopy.slots.copy, "copy node should bind into generation frame copy slot");
assert(frameWithCopy.slots.copy.copyBrief, "copy slot should preserve structured copy brief");
assert(
  frameWithCopy.slots.copy.negativeRules.some((rule) => rule.includes("Forbidden copy claim")),
  "copy slot should carry forbidden claim negative rules"
);

const copyContext = buildGenerationFrameReferenceContext(frameWithCopy);
assert(copyContext?.roles.copy, "copy role should be present in reference context");
assert(
  copyContext.roles.copy.parameters?.copyBrief,
  "copy brief should be carried through reference context parameters"
);
assert(
  copyContext.promptFragments.some((fragment) => fragment.includes("Visible image copy candidates")),
  "copy prompt fragments should be available to generation context"
);

const productAsset = {
  id: "product-reference-1",
  category: "商品",
  title: "主商品图",
  description: "商品主参考图",
  status: "ready",
  icon: null,
  previewUrl: inlinePng,
};

const frameWithProductAndCopy = bindAssetToGenerationFrameSlot(frameWithCopy, productAsset);
const mixedContext = buildGenerationFrameReferenceContext(frameWithProductAndCopy);
const adapter = buildProviderReferenceAdapter(mixedContext);
const promptBlock = buildGenerationReferencePromptBlock(mixedContext);

assert(mixedContext?.roles.product, "product role should still be present with copy role");
assert(mixedContext?.roles.copy, "copy role should survive mixed reference context");
assert(adapter.primaryImage?.role === "product", "product image should remain the provider input");
assert(
  promptBlock.includes("Copy brief") && promptBlock.includes("Forbidden copy claim"),
  "reference prompt block should include copy brief guidance"
);

console.log(JSON.stringify({
  providerCalls: 0,
  sections: summary.sections.map((section) => ({
    id: section.id,
    count: section.count,
    preview: section.preview,
  })),
  referenceRoles: Object.keys(mixedContext?.roles ?? {}),
  providerMode: adapter.mode,
  providerStrategy: adapter.strategy,
  primaryImageRole: adapter.primaryImage?.role,
}, null, 2));
console.log("Copy brief context smoke passed without provider calls.");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function importCompiledCanvasModules() {
  const root = process.cwd();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "image-master-copy-brief-smoke-"));
  const files = [
    "copy-brief",
    "copy-brief-summary",
    "generation-reference-context",
    "generation-frame",
  ];

  for (const name of files) {
    const sourcePath = path.join(root, "lib/canvas", `${name}.ts`);
    const source = fs.readFileSync(sourcePath, "utf8")
      .replaceAll('from "./copy-brief"', 'from "./copy-brief.mjs"')
      .replaceAll('from "./copy-brief-summary"', 'from "./copy-brief-summary.mjs"')
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

  const [summaryModule, frameModule, referenceModule] = await Promise.all([
    import(pathToFileURL(path.join(outDir, "copy-brief-summary.mjs")).href),
    import(pathToFileURL(path.join(outDir, "generation-frame.mjs")).href),
    import(pathToFileURL(path.join(outDir, "generation-reference-context.mjs")).href),
  ]);

  return {
    ...summaryModule,
    ...frameModule,
    ...referenceModule,
  };
}
