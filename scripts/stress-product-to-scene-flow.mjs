#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createSmokeRuntime, stopSmokeServer } from "./smoke-runtime.mjs";

const ROOT = process.cwd();
const args = parseArgs(process.argv.slice(2));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const port = Number(args.port || process.env.STRESS_PRODUCT_FLOW_PORT || 3521);
const externalBaseUrl = args.baseUrl || process.env.STRESS_PRODUCT_FLOW_BASE_URL;
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const productCount = clampInt(args.products || process.env.STRESS_PRODUCT_COUNT, 1, 50, 6);
const sceneImagesPerProduct = clampInt(args.sceneImages || process.env.STRESS_SCENE_IMAGES_PER_PRODUCT, 1, 10, 2);
const concurrency = clampInt(args.concurrency || process.env.STRESS_PRODUCT_FLOW_CONCURRENCY, 1, 12, 4);
const keepData = args.keepData === "true" || process.env.STRESS_PRODUCT_FLOW_KEEP_DATA === "1";
const outDir = path.join(ROOT, "test_artifacts", "stress");
const reportPath = path.join(outDir, `product-to-scene-flow-${stamp}.json`);
const runtime = createSmokeRuntime({
  name: "stress-product-to-scene-flow",
  stamp,
  externalBaseUrl,
  env: {
    ...process.env,
    ...(keepData ? { IMAGE_MASTER_SMOKE_KEEP_DATA: "1" } : {}),
  },
});

let server;
let serverOutput = "";

await fs.mkdir(outDir, { recursive: true });

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: ROOT,
    env: runtime.serverEnv({
      NEXT_TELEMETRY_DISABLED: "1",
      IMAGE_MASTER_ENABLE_MOCK_BATCH: "1",
      IMAGE_MASTER_JOB_CONCURRENCY: String(concurrency),
      IMAGE_MASTER_QUEUE_OWNER: `stress-product-flow-${Date.now()}`,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
}

const startedAt = Date.now();

try {
  await waitForServer(`${baseUrl}/api/settings`);
  const guardrailProbe = await probeGuardrail();
  const flowInputs = Array.from({ length: productCount }, (_, index) => ({
    id: `stress_product_${index + 1}`,
    title: `Stress product ${index + 1}`,
    productReference: makeReferenceDataUrl(index),
  }));

  const flowResults = await mapPool(flowInputs, concurrency, runProductFlow);
  const summary = summarize(flowResults);
  const report = {
    ok: summary.failedFlows === 0 && guardrailProbe.ok,
    mode: "mock-provider",
    note:
      "This stress test exercises local API orchestration, guardrails, persistence, and product-to-scene handoff without real provider spend.",
    baseUrl,
    dataDir: runtime.dataDir,
    generatedDir: runtime.generatedDir,
    parameters: {
      productCount,
      sceneImagesPerProduct,
      concurrency,
      totalExpectedGenerationRequests: productCount * 2,
      totalExpectedImages: productCount * (1 + sceneImagesPerProduct),
    },
    durationMs: Date.now() - startedAt,
    guardrailProbe,
    summary,
    flows: flowResults,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: report.ok,
    mode: report.mode,
    baseUrl,
    durationMs: report.durationMs,
    summary,
    reportPath,
    dataDir: keepData ? runtime.dataDir : undefined,
  }, null, 2));
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  const report = {
    ok: false,
    mode: "mock-provider",
    error: error instanceof Error ? error.message : String(error),
    baseUrl,
    durationMs: Date.now() - startedAt,
    reportPath,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-6000));
  }
  process.exitCode = 1;
} finally {
  await stopSmokeServer(server);
  runtime.cleanup();
}

async function runProductFlow(input, index) {
  const flowStartedAt = Date.now();
  const workflowId = `stress_workflow_${stamp}_${index + 1}`;
  const productBatchId = `stress_product_asset_${stamp}_${index + 1}`;
  const sceneBatchId = `stress_scene_output_${stamp}_${index + 1}`;
  const timings = [];

  const productPayload = buildProductAssetPayload({
    input,
    workflowId,
    batchId: productBatchId,
  });
  const productDryRun = await timed(timings, "product-dry-run", () =>
    requestJson(`${baseUrl}/api/images/generate/batch`, {
      method: "POST",
      body: JSON.stringify({ ...productPayload, dryRun: true }),
    })
  );
  assertEstimate(productDryRun, 1, true, "product-dry-run");

  const productResult = await timed(timings, "product-generate", () =>
    requestJson(`${baseUrl}/api/images/generate/batch`, {
      method: "POST",
      body: JSON.stringify({
        ...productPayload,
        dryRun: false,
        confirmedProviderCallLimit: 1,
        mockResults: [{ base64: makeMockPngBase64(index, 0) }],
      }),
    })
  );
  const productImage = firstImage(productResult, "product-generate");

  const scenePayload = buildScenePayload({
    input,
    workflowId,
    batchId: sceneBatchId,
    productAssetDataUrl: productImage.url,
  });
  const sceneDryRun = await timed(timings, "scene-dry-run", () =>
    requestJson(`${baseUrl}/api/images/generate/batch`, {
      method: "POST",
      body: JSON.stringify({ ...scenePayload, dryRun: true }),
    })
  );
  assertEstimate(sceneDryRun, sceneImagesPerProduct, true, "scene-dry-run");

  const sceneResult = await timed(timings, "scene-generate", () =>
    requestJson(`${baseUrl}/api/images/generate/batch`, {
      method: "POST",
      body: JSON.stringify({
        ...scenePayload,
        dryRun: false,
        confirmedProviderCallLimit: sceneImagesPerProduct,
        mockResults: Array.from({ length: sceneImagesPerProduct }, (_, sceneIndex) => ({
          base64: makeMockPngBase64(index, sceneIndex + 1),
        })),
      }),
    })
  );
  const sceneImages = assertImages(sceneResult, sceneImagesPerProduct, "scene-generate");

  return {
    ok: true,
    flowId: input.id,
    productBatchId,
    sceneBatchId,
    durationMs: Date.now() - flowStartedAt,
    productEstimate: productDryRun.estimate,
    sceneEstimate: sceneDryRun.estimate,
    productPersistence: productResult.persistence,
    scenePersistence: sceneResult.persistence,
    productImageCount: 1,
    sceneImageCount: sceneImages.length,
    timings,
  };
}

function buildProductAssetPayload({ input, workflowId, batchId }) {
  return {
    images: [
      {
        title: `${input.title} - product identity sheet`,
        type: "product_asset",
        copyText: "标准化商品多角度资产",
        prompt: [
          "Create one reusable white-background multi-view product identity sheet.",
          "Use the attached product reference as the same physical product.",
          "Preserve silhouette, color, material, hardware, seams, handles, closure, and proportions.",
          "No people, no hands, no lifestyle scene, no marketing text.",
        ].join(" "),
        exportSpecId: "product-multiview-white-sheet",
        naming: `${input.id}_product_multiview`,
        size: "1024x1024",
        ratio: "1:1",
        whiteBackground: true,
        textAllowed: false,
        modelRequired: false,
        qualityRules: ["product identity", "multi-angle completeness", "white background"],
      },
    ],
    style: "clean ecommerce product asset",
    modelIds: [],
    productImageBase64: input.productReference,
    persistProjectBatch: true,
    workflowId,
    batchId,
    nodeId: `${input.id}_product_frame`,
    batchTitle: `${input.title} product asset stress batch`,
    platform: "stress_product_asset",
  };
}

function buildScenePayload({ input, workflowId, batchId, productAssetDataUrl }) {
  return {
    images: Array.from({ length: sceneImagesPerProduct }, (_, index) => ({
      title: `${input.title} - scene application ${index + 1}`,
      type: "product_scene_hero",
      copyText: "北欧家居场景产品主图",
      prompt: [
        "Create one premium product scene application image in a warm Nordic home interior.",
        "Use the attached product asset as the product identity source.",
        "Place the product on a soft bed or clean table near a large window.",
        "Keep realistic daylight, soft shadows, correct contact shadow, and no extra products.",
      ].join(" "),
      exportSpecId: `scene-application-${index + 1}`,
      naming: `${input.id}_scene_${index + 1}`,
      size: "1024x1024",
      ratio: "1:1",
      whiteBackground: false,
      textAllowed: false,
      modelRequired: false,
      qualityRules: ["product identity", "scene lighting", "contact shadows"],
    })),
    style: "warm premium Nordic home campaign",
    modelIds: [],
    productImageBase64: productAssetDataUrl,
    persistProjectBatch: true,
    workflowId,
    batchId,
    nodeId: `${input.id}_scene_frame`,
    batchTitle: `${input.title} scene application stress batch`,
    platform: "stress_scene_application",
  };
}

async function probeGuardrail() {
  const overLimitPayload = {
    images: Array.from({ length: 21 }, (_, index) => ({
      title: `Over limit ${index + 1}`,
      type: "stress_guardrail",
      copyText: "",
      prompt: "Guardrail probe prompt.",
    })),
    style: "guardrail",
    modelIds: [],
    dryRun: true,
  };
  const response = await fetch(`${baseUrl}/api/images/generate/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(overLimitPayload),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.status === 400 && typeof payload.error === "string",
    status: response.status,
    error: payload.error,
    guardrails: payload.guardrails,
  };
}

async function timed(timings, label, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    timings.push({ label, ok: true, durationMs: Date.now() - started });
    return result;
  } catch (error) {
    timings.push({
      label,
      ok: false,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function requestJson(url, init = {}, expectedStatus = 200) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(90_000),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (response.status !== expectedStatus) {
    throw new Error(`Expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(payload).slice(0, 1000)}`);
  }
  return payload;
}

async function waitForServer(url) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 90_000) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) return;
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = {
          ok: false,
          flowId: items[index]?.id,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function assertEstimate(payload, expectedProviderCalls, usesProductReference, label) {
  if (payload?.dryRun !== true) {
    throw new Error(`${label}: expected dryRun response`);
  }
  if (payload.estimate?.providerCallCount !== expectedProviderCalls) {
    throw new Error(`${label}: expected providerCallCount=${expectedProviderCalls}, got ${payload.estimate?.providerCallCount}`);
  }
  if (payload.estimate?.usesProductReference !== usesProductReference) {
    throw new Error(`${label}: unexpected usesProductReference=${payload.estimate?.usesProductReference}`);
  }
}

function firstImage(payload, label) {
  const images = assertImages(payload, 1, label);
  return images[0];
}

function assertImages(payload, expectedCount, label) {
  const images = Array.isArray(payload?.images) ? payload.images : [];
  if (images.length !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} image(s), got ${images.length}`);
  }
  const failed = images.find((image) => !image.url || image.error);
  if (failed) {
    throw new Error(`${label}: generated image failed: ${failed.error || "missing url"}`);
  }
  if (!payload.persistence?.batchId) {
    throw new Error(`${label}: expected persistence batchId`);
  }
  return images;
}

function summarize(flows) {
  const durations = flows.flatMap((flow) => Array.isArray(flow.timings) ? flow.timings.map((item) => item.durationMs) : []);
  return {
    totalFlows: flows.length,
    succeededFlows: flows.filter((flow) => flow.ok).length,
    failedFlows: flows.filter((flow) => !flow.ok).length,
    productImages: flows.reduce((sum, flow) => sum + (flow.productImageCount || 0), 0),
    sceneImages: flows.reduce((sum, flow) => sum + (flow.sceneImageCount || 0), 0),
    requestLatencyMs: {
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      max: durations.length ? Math.max(...durations) : 0,
    },
    failedFlowIds: flows.filter((flow) => !flow.ok).map((flow) => flow.flowId),
  };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index];
}

function makeReferenceDataUrl(index) {
  return `data:image/png;base64,${makeMockPngBase64(index, 99)}`;
}

function makeMockPngBase64(productIndex, variantIndex) {
  // 1x1 PNG placeholder. The payload is intentionally tiny; the stress target is
  // API orchestration and persistence, not image rendering quality.
  void productIndex;
  void variantIndex;
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/ax2x0YAAAAASUVORK5CYII=";
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function parseArgs(values) {
  const parsed = {};
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
