#!/usr/bin/env node

import { spawn } from "node:child_process";

const port = Number(process.env.GENERATION_PLAN_DRY_RUN_SMOKE_PORT || 3482);
const externalBaseUrl = process.env.GENERATION_PLAN_DRY_RUN_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
let server;
let serverOutput = "";

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
}

try {
  await waitForServer(`${baseUrl}/api/settings`);

  const productImageBase64 = tinyPngDataUrl();
  const happy = await requestJson(`${baseUrl}/api/generation-plans/dry-run`, {
    method: "POST",
    body: JSON.stringify({
      workflowId: "workflow_generation_plan_smoke",
      frameNodeId: "frame_generation_plan_smoke",
      batchId: "batch_generation_plan_smoke",
      requiredReferenceRoles: ["product"],
      productImageBase64,
      referenceContext: {
        version: 1,
        source: "canvas-workbench",
        targetNodeId: "frame_generation_plan_smoke",
	        images: [
	          {
	            role: "product",
            title: "Smoke product",
            url: productImageBase64,
            providerUsable: true,
            nodeId: "product_generation_plan_smoke",
	            assetId: "asset_generation_plan_smoke",
	          },
	          {
	            role: "model",
	            title: "Smoke model",
	            url: productImageBase64,
	            providerUsable: true,
	            assetId: "asset_generation_plan_model_smoke",
	          },
	          {
	            role: "scene",
	            title: "Smoke scene",
	            url: productImageBase64,
	            providerUsable: true,
	            assetId: "asset_generation_plan_scene_smoke",
	          },
	          {
	            role: "style",
	            title: "Smoke style",
	            url: productImageBase64,
	            providerUsable: true,
	            assetId: "asset_generation_plan_style_smoke",
	          },
	        ],
        roles: {
          product: {
            role: "product",
            title: "Smoke product",
            sourceNodeIds: ["product_generation_plan_smoke"],
            componentIds: [],
            assetIds: ["asset_generation_plan_smoke"],
            promptFragments: ["Keep the exact product silhouette."],
            constraints: ["Do not alter product structure."],
            negativeRules: [],
            qualityRules: ["Product identity must be preserved."],
          },
        },
        promptFragments: ["Keep the exact product silhouette."],
        constraints: ["Do not alter product structure."],
        negativeRules: [],
        qualityRules: ["Product identity must be preserved."],
      },
      items: [
        {
          title: "Hero",
          type: "hero",
          copyText: "",
          prompt: "Create a clean commerce hero image from the product reference.",
        },
	        {
	          title: "Model scene",
	          type: "model_scene",
	          copyText: "",
	          prompt: "Create a model wearing scene image from the product reference and available model/scene references.",
	        },
	      ],
      components: [
        {
          id: "commercial.quality.product_consistency",
          title: "Product Consistency Guard",
          type: "quality_rule",
          status: "published",
          metadata: {
            componentType: "quality_rule",
            tags: ["product_consistency", "identity", "truthful"],
            sourceTutorialIds: ["super-i-product-consistency-smoke"],
            qualityRules: ["Every output must preserve product material and exact structure."],
          },
        },
        {
          id: "knowledge.copy.amazon_detail",
          title: "Amazon Detail Copy Knowledge",
          type: "prompt_source",
          status: "published",
          metadata: {
            componentType: "prompt_source",
            referenceMode: "prompt_only",
            sourceTutorialIds: ["super-i-copy-rules-smoke"],
            qualityRules: ["Copy stays structured and is not burned into the image by default."],
          },
        },
      ],
    }),
  });

  if (happy.dryRun !== true || happy.ok !== true) throw new Error("Expected ok dry-run plan");
  if (!happy.plan?.planId) throw new Error("Expected planId");
  if (happy.plan?.workflowId !== "workflow_generation_plan_smoke") throw new Error("Expected workflowId");
  if (happy.estimate?.providerCallCount !== 2) throw new Error("Expected providerCallCount=2");
  if (happy.estimate?.maxProviderCallCount < happy.estimate?.providerCallCount) {
    throw new Error("Expected maxProviderCallCount to cover base provider calls");
  }
  if (happy.estimate?.usesProductReference !== true) throw new Error("Expected product reference estimate");
  if (happy.estimate?.concurrency !== 1 && happy.estimate?.concurrency !== 10) {
    throw new Error(`Expected image-to-image safe concurrency; got ${happy.estimate?.concurrency}`);
  }
  if (!happy.plan?.campaignBible || happy.plan.campaignBible.source !== "agent_campaign_bible") {
    throw new Error("Expected product dry-run plan to include campaignBible");
  }
  if (!Array.isArray(happy.plan?.shotList) || happy.plan.shotList.length < 5) {
    throw new Error("Expected product dry-run plan to include campaign shotList");
  }
	  if (!happy.plan.items?.every((item) => item.metadata?.campaignShot && item.ratio && item.size)) {
	    throw new Error("Expected campaign shot metadata to enrich every product plan item");
	  }
	  const heroItem = happy.plan.items[0];
	  const modelSceneItem = happy.plan.items[1];
	  assertReferenceRouting(heroItem, {
	    providerIncludes: ["product"],
	    providerExcludes: ["style", "copy"],
	    productFocus: "front_main",
	  });
	  assertReferenceRouting(modelSceneItem, {
	    providerIncludes: ["product", "model", "scene"],
	    providerExcludes: ["style", "copy"],
	    productFocus: "model_wear",
	  });
	  const productSlot = happy.referenceSlots?.find((slot) => slot.role === "product");
  if (productSlot?.validationStatus !== "provider_usable") {
    throw new Error(`Expected provider-usable product slot: ${JSON.stringify(productSlot)}`);
  }
  assertSopExecutionPlan(happy.plan);

  const missingRequired = await requestJson(
    `${baseUrl}/api/generation-plans/dry-run`,
    {
      method: "POST",
      body: JSON.stringify({
        workflowId: "workflow_generation_plan_smoke",
        frameNodeId: "frame_missing_product",
        requiredReferenceRoles: ["product"],
        items: [
          {
            title: "Missing product",
            type: "hero",
            copyText: "",
            prompt: "Create a dry-run hero image.",
          },
        ],
      }),
    },
    400
  );

  if (missingRequired.ok !== false) throw new Error("Expected missing required slot to fail");
  const missingProductSlot = missingRequired.referenceSlots?.find((slot) => slot.role === "product");
  if (missingProductSlot?.validationStatus !== "missing_required") {
    throw new Error(`Expected missing_required product slot: ${JSON.stringify(missingProductSlot)}`);
  }

  const modelTextOnly = await requestJson(`${baseUrl}/api/generation-plans/dry-run`, {
    method: "POST",
    body: JSON.stringify({
      workflowId: "workflow_generation_plan_model_text_only_smoke",
      frameNodeId: "frame_model_asset_text_only",
      batchId: "batch_model_asset_text_only",
      requiredReferenceRoles: [],
      style: "model_asset",
      items: [
        {
          title: "Model identity sheet",
          type: "model_asset_character_sheet",
          copyText: "需求：短发欧洲商业模特",
          prompt: "Create a reusable adult commercial model identity sheet from this text-only request.",
        },
      ],
    }),
  });

  if (modelTextOnly.ok !== true) throw new Error("Expected model_asset text-only dry-run to pass");
  if (modelTextOnly.estimate?.usesProductReference !== false) {
    throw new Error("Expected text-only model frame to avoid product reference estimate");
  }
  if (modelTextOnly.plan?.campaignBible || modelTextOnly.plan?.shotList?.length) {
    throw new Error("Expected text-only model asset dry-run to skip commerce campaign planning");
  }
  const modelProductSlot = modelTextOnly.referenceSlots?.find((slot) => slot.role === "product");
  if (modelProductSlot?.required !== false || modelProductSlot?.validationStatus === "missing_required") {
    throw new Error(`Expected product slot to be optional for model_asset: ${JSON.stringify(modelProductSlot)}`);
  }

  const tooMany = await requestJson(
    `${baseUrl}/api/generation-plans/dry-run`,
    {
      method: "POST",
      body: JSON.stringify({
        workflowId: "workflow_generation_plan_smoke",
        frameNodeId: "frame_too_many",
        items: Array.from({ length: 11 }, (_, index) => ({
          title: `Too many ${index + 1}`,
          type: "hero",
          copyText: "",
          prompt: "This request should be rejected by plan policy.",
        })),
      }),
    },
    400
  );

  if (!tooMany.validation?.issues?.some((issue) => issue.includes("单次最多生成"))) {
    throw new Error("Expected max image validation issue");
  }

console.log(
    `Generation plan dry-run smoke passed on ${baseUrl}: plan draft, SOP execution metadata, estimates, slots, and guardrails.`
  );
} catch (error) {
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-4000));
  }
  process.exitCode = 1;
} finally {
  if (server) server.kill("SIGTERM");
}

async function requestJson(url, init = {}, expectedStatus = 200) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status} from ${url}: ${JSON.stringify(payload)}`
    );
  }
  return payload;
}

async function waitForServer(url) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 45000) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function tinyPngDataUrl() {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
}

function assertReferenceRouting(item, { providerIncludes = [], providerExcludes = [], productFocus } = {}) {
  const providerRoles = item?.providerReferenceRoles || item?.metadata?.itemProviderReferenceRoles || [];
  const activeRoles = item?.referenceRoles || item?.metadata?.itemReferenceRoles || [];
  const actualProductFocus = item?.productReferenceFocus || item?.metadata?.productReferenceFocus;
  for (const role of providerIncludes) {
    if (!providerRoles.includes(role)) {
      throw new Error(`Expected ${item?.title} provider reference roles to include ${role}: ${JSON.stringify({ activeRoles, providerRoles })}`);
    }
  }
  for (const role of providerExcludes) {
    if (providerRoles.includes(role)) {
      throw new Error(`Expected ${item?.title} provider reference roles to exclude ${role}: ${JSON.stringify({ activeRoles, providerRoles })}`);
    }
  }
  if (productFocus && actualProductFocus !== productFocus) {
    throw new Error(`Expected ${item?.title} product reference focus ${productFocus}, got ${actualProductFocus}`);
  }
  const prompt = String(item?.prompt || "");
  if (productFocus && !prompt.includes("Product reference focus:") && !prompt.includes("商品参考重点：")) {
    throw new Error(`Expected ${item?.title} prompt to include product reference focus instruction.`);
  }
}

function assertSopExecutionPlan(plan) {
  const sop = plan?.sopExecutionPlan;
  if (!sop) throw new Error("Expected plan.sopExecutionPlan");
  for (const field of ["steps", "requiredInputs", "promptBlocks", "qaRules", "retryPolicy", "debugSource"]) {
    if (!sop[field]) throw new Error(`Expected sopExecutionPlan.${field}`);
  }
  if (sop.mode !== "dry_run_metadata_only") {
    throw new Error(`Expected dry-run SOP mode, got ${sop.mode}`);
  }
  if (!sop.steps.some((step) => step.providerAction === "deferred_until_user_approval")) {
    throw new Error("Expected provider action to be deferred");
  }
  if (!sop.requiredInputs.some((input) => input.id === "reference.product" && input.status === "ready")) {
    throw new Error(`Expected ready product required input: ${JSON.stringify(sop.requiredInputs)}`);
  }
  if (!sop.promptBlocks.some((block) => block.id === "sop.product")) {
    throw new Error(`Expected product SOP prompt block: ${JSON.stringify(sop.promptBlocks)}`);
  }
  if (!sop.debugSource?.sourceTutorialIds?.includes("super-i-product-consistency-smoke")) {
    throw new Error(`Expected source tutorial ids in debugSource only: ${JSON.stringify(sop.debugSource)}`);
  }
  if (plan.knowledgeSelection?.sourceTutorialIds?.length) {
    throw new Error("Expected public plan.knowledgeSelection.sourceTutorialIds to be hidden");
  }
  if (plan.items?.some((item) => item.metadata?.sourceTutorialIds?.length)) {
    throw new Error("Expected item metadata to hide sourceTutorialIds");
  }
  if (plan.items?.some((item) => item.metadata?.knowledgeSelection?.sourceTutorialIds?.length)) {
    throw new Error("Expected item knowledgeSelection metadata to hide sourceTutorialIds");
  }
  if (!plan.items?.every((item) => item.metadata?.sopExecutionPlan?.debugSource?.sourceTutorialIds?.length)) {
    throw new Error("Expected each item metadata to carry sopExecutionPlan debugSource");
  }
}
