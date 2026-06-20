#!/usr/bin/env node

import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import path from "node:path";

const port = Number(process.env.GENERATION_PLAN_RUN_SMOKE_PORT || 3483);
const externalBaseUrl = process.env.GENERATION_PLAN_RUN_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = Date.now();
const workflowId = `workflow_generation_plan_run_smoke_${stamp}`;
const frameNodeId = `frame_generation_plan_run_smoke_${stamp}`;
const batchId = `batch_generation_plan_run_smoke_${stamp}`;
const pendingWorkflowId = `workflow_generation_plan_pending_guard_${stamp}`;
const pendingFrameNodeId = `frame_generation_plan_pending_guard_${stamp}`;
const pendingBatchId = `batch_generation_plan_pending_guard_${stamp}`;
const modelWorkflowId = `workflow_generation_plan_model_text_only_${stamp}`;
const modelFrameNodeId = `frame_generation_plan_model_text_only_${stamp}`;
const modelBatchId = `batch_generation_plan_model_text_only_${stamp}`;
const knowledgeTemplateId = "super-i-commerce-plan-smoke";
let server;
let serverOutput = "";

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER: "1",
      IMAGE_MASTER_MOCK_JOB_RUNNER_REQUIRE_REFERENCE: "1",
      IMAGE_MASTER_DISABLE_AI_PROMPT_WRITER: "1",
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

  const body = buildRequestBody();
  const blocked = await requestJson(
    `${baseUrl}/api/generation-plans/run`,
    {
      method: "POST",
      body: JSON.stringify({
        ...body,
        enqueue: true,
      }),
    },
    402
  );

  if (blocked.code !== "PROVIDER_CALL_LIMIT_NOT_CONFIRMED") {
    throw new Error("Expected provider confirmation guard before enqueue");
  }

  const pending = await requestJson(`${baseUrl}/api/generation-plans/run`, {
    method: "POST",
    body: JSON.stringify({
      ...buildRequestBody({
        workflowId: pendingWorkflowId,
        frameNodeId: pendingFrameNodeId,
        batchId: pendingBatchId,
      }),
      enqueue: false,
    }),
  }, 201);
  if (pending.queued !== false || !Array.isArray(pending.jobs) || pending.jobs.length !== 2) {
    throw new Error(`Expected unqueued pending jobs, got ${JSON.stringify(pending)}`);
  }
  if (pending.providerPolicy?.mode !== "requires_confirmation") {
    throw new Error("Expected pending plan to require provider confirmation");
  }
	if (!pending.jobs.every((job) => job.metadata?.itemMetadata?.knowledgeTemplateId === knowledgeTemplateId)) {
	  throw new Error("Expected pending plan jobs to preserve itemMetadata");
	}
  if (!pending.jobs.every((job) => isFiniteNumber(job.metadata?.generationTelemetry?.planJobPrepareMs))) {
    throw new Error("Expected pending jobs to carry plan preparation telemetry");
  }
	assertJobReferenceRouting(pending.jobs[0], {
	  providerIncludes: ["product"],
	  providerExcludes: ["copy"],
	  productFocus: "front_main",
	});
  assertJobReferenceRouting(pending.jobs[1], {
	  providerIncludes: ["product", "model", "scene"],
	  providerExcludes: ["copy"],
	  productFocus: "model_wear",
	});

  const modelTextOnly = await requestJson(`${baseUrl}/api/generation-plans/run`, {
    method: "POST",
    body: JSON.stringify({
      workflowId: modelWorkflowId,
      frameNodeId: modelFrameNodeId,
      batchId: modelBatchId,
      batchTitle: "模特资产 text-only smoke",
      requiredReferenceRoles: [],
      style: "model_asset",
      enqueue: false,
      items: [
        {
          title: "Model identity sheet",
          type: "model_asset_character_sheet",
          copyText: "需求：短发欧洲商业模特",
          prompt: "Create a reusable adult commercial model identity sheet from this text-only request.",
        },
      ],
    }),
  }, 201);
  if (modelTextOnly.ok !== true || modelTextOnly.queued !== false) {
    throw new Error(`Expected text-only model plan run payload, got ${JSON.stringify(modelTextOnly)}`);
  }
  if (!Array.isArray(modelTextOnly.jobs) || modelTextOnly.jobs.length !== 1) {
    throw new Error("Expected one pending model_asset job");
  }
  const modelJob = modelTextOnly.jobs[0];
  if (modelJob.metadata?.usesProductReference !== false || modelJob.metadata?.usesProviderReference !== false) {
    throw new Error(`Expected model_asset text-only job to avoid product reference metadata: ${JSON.stringify(modelJob.metadata)}`);
  }
  const modelProductSlot = modelTextOnly.referenceSlots?.find((slot) => slot.role === "product");
  if (modelProductSlot?.required !== false || modelProductSlot?.validationStatus === "missing_required") {
    throw new Error(`Expected model_asset product slot to remain optional: ${JSON.stringify(modelProductSlot)}`);
  }

  const blockedRun = await requestJson(
    `${baseUrl}/api/jobs/${pending.jobs[0].id}/run`,
    { method: "POST" },
    402
  );
  if (blockedRun.code !== "PROVIDER_CALL_LIMIT_NOT_CONFIRMED") {
    throw new Error(`Expected /run provider guard, got ${JSON.stringify(blockedRun)}`);
  }

  const guardedJob = await requestJson(`${baseUrl}/api/jobs/${pending.jobs[0].id}`);
  if (guardedJob.status !== "pending") {
    throw new Error(`Expected guarded job to remain pending, got ${guardedJob.status}`);
  }
  assertNoProviderSideEffects(pending.jobs[0].id);

  const committed = await requestJson(`${baseUrl}/api/generation-plans/run`, {
    method: "POST",
    body: JSON.stringify({
      ...body,
      enqueue: true,
      confirmedProviderCallLimit: 4,
    }),
  }, 201);

  if (committed.ok !== true || committed.queued !== true) {
    throw new Error("Expected queued generation plan run");
  }
  if (!Array.isArray(committed.jobs) || committed.jobs.length !== 2) {
    throw new Error("Expected two generation jobs from plan run");
  }
  if (committed.providerPolicy?.mode !== "confirmed") {
    throw new Error("Expected confirmed provider policy");
  }
  if (!committed.jobs.every((job) => job.metadata?.usesProductReference === true)) {
    throw new Error("Expected every job to carry product reference metadata");
  }
  if (!committed.jobs.every((job) => job.metadata?.approvedProviderCallLimit >= 2 && job.metadata?.approvedAt && job.metadata?.providerCallBudgetId)) {
    throw new Error("Expected queued plan jobs to carry provider approval metadata");
  }
  if (!committed.jobs.every((job) => job.metadata?.itemMetadata?.knowledgeTemplateId === knowledgeTemplateId)) {
    throw new Error("Expected queued plan jobs to carry itemMetadata");
  }

  const doneJobs = await waitForJobsDone(workflowId, committed.jobs.length);
  for (const job of doneJobs) {
    if (job.status !== "done") {
      throw new Error(`Expected done job, got ${job.status}: ${job.error || ""}`);
    }
    if (!String(job.resultUrl || "").startsWith("/api/generated-images/")) {
      throw new Error(`Expected stored generated image URL, got ${job.resultUrl}`);
    }
    if (job.metadata?.batchId !== batchId) {
      throw new Error("Expected batch metadata to round-trip through job runner");
    }
    assertGenerationTelemetry(job);
  }
  const manifestPayload = await requestJson(
    `${baseUrl}/api/export-packs/${encodeURIComponent(batchId)}/manifest`
  );
  assertManifestCarriesItemMetadata(manifestPayload.manifest, doneJobs);

  console.log(
    `Generation plan run smoke passed on ${baseUrl}: ${doneJobs.length} queued product jobs completed; itemMetadata reached export manifest; model_asset text-only plan/run payload stayed product-free.`
  );
} catch (error) {
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-5000));
  }
  process.exitCode = 1;
} finally {
  cleanupSmokeRows();
  if (server) server.kill("SIGTERM");
}

function buildRequestBody(overrides = {}) {
  const productImageBase64 = tinyPngDataUrl();
  return {
    workflowId: overrides.workflowId || workflowId,
    frameNodeId: overrides.frameNodeId || frameNodeId,
    batchId: overrides.batchId || batchId,
    batchTitle: "生成计划运行 smoke",
    requiredReferenceRoles: ["product"],
    productImageBase64,
    referenceContext: {
      version: 1,
      source: "canvas-workbench",
      targetNodeId: overrides.frameNodeId || frameNodeId,
	      images: [
	        {
	          role: "product",
          title: "Smoke product",
          url: productImageBase64,
          providerUsable: true,
          nodeId: "product_generation_plan_run_smoke",
	          assetId: "asset_generation_plan_run_smoke",
	        },
	        {
	          role: "model",
	          title: "Smoke model",
	          url: productImageBase64,
	          providerUsable: true,
	          assetId: "asset_generation_plan_run_model_smoke",
	        },
	        {
	          role: "scene",
	          title: "Smoke scene",
	          url: productImageBase64,
	          providerUsable: true,
	          assetId: "asset_generation_plan_run_scene_smoke",
	        },
	        {
	          role: "style",
	          title: "Smoke style",
	          url: productImageBase64,
	          providerUsable: true,
	          assetId: "asset_generation_plan_run_style_smoke",
	        },
	      ],
      roles: {
        product: {
          role: "product",
          title: "Smoke product",
          sourceNodeIds: ["product_generation_plan_run_smoke"],
          componentIds: [],
          assetIds: ["asset_generation_plan_run_smoke"],
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
        title: "Plan hero",
        type: "hero",
        copyText: "",
        prompt: "Create a polished ecommerce hero image from the product reference.",
        metadata: buildKnowledgeMetadata("hero"),
      },
	      {
	        title: "Plan model scene",
	        type: "model_scene",
	        copyText: "",
	        prompt: "Create a model wearing scene image from the same product reference and available model/scene references.",
	        metadata: buildKnowledgeMetadata("detail"),
	      },
    ],
  };
}

function buildKnowledgeMetadata(slot) {
  return {
    source: "knowledge-template-selector-smoke",
    knowledgeTemplateId,
    slot,
    sourceTutorialIds: ["super-i-amazon-main-001", "super-i-product-consistency-001"],
  };
}

function assertManifestCarriesItemMetadata(manifest, jobs) {
  if (!manifest || !Array.isArray(manifest.items)) {
    throw new Error(`Expected export manifest items, got ${JSON.stringify(manifest)}`);
  }
  const manifestItemByJobId = new Map(manifest.items.map((item) => [item.jobId, item]));
  for (const job of jobs) {
    const item = manifestItemByJobId.get(job.id);
    if (!item) throw new Error(`Expected manifest item for job ${job.id}`);
    if (item.metadata?.planId !== job.metadata?.planId) {
      throw new Error("Expected manifest item to carry planId metadata");
    }
    if (item.metadata?.itemMetadata?.knowledgeTemplateId !== knowledgeTemplateId) {
      throw new Error(`Expected manifest itemMetadata to round-trip: ${JSON.stringify(item.metadata)}`);
    }
  }
}

function assertJobReferenceRouting(job, { providerIncludes = [], providerExcludes = [], productFocus } = {}) {
  const providerRoles = job?.metadata?.itemProviderReferenceRoles || [];
  const providerImages = job?.metadata?.providerReferenceAdapter?.providerUsableImages || [];
  const providerImageRoles = providerImages.map((image) => image.role);
  const actualProductFocus = job?.metadata?.productReferenceFocus;
  for (const role of providerIncludes) {
    if (!providerRoles.includes(role) || !providerImageRoles.includes(role)) {
      throw new Error(`Expected ${job?.metadata?.planItemTitle} provider references to include ${role}: ${JSON.stringify({ providerRoles, providerImageRoles })}`);
    }
  }
  for (const role of providerExcludes) {
    if (providerRoles.includes(role) || providerImageRoles.includes(role)) {
      throw new Error(`Expected ${job?.metadata?.planItemTitle} provider references to exclude ${role}: ${JSON.stringify({ providerRoles, providerImageRoles })}`);
    }
  }
  if (productFocus && actualProductFocus !== productFocus) {
    throw new Error(`Expected ${job?.metadata?.planItemTitle} product focus ${productFocus}, got ${actualProductFocus}`);
  }
  const prompt = String(job?.prompt || "");
  const writer = job?.metadata?.providerPromptWriter;
  if (
    productFocus &&
    !prompt.includes("Product reference focus:") &&
    !prompt.includes("商品重点：") &&
    !prompt.includes("商品参考重点：") &&
    !writer
  ) {
    throw new Error(`Expected ${job?.metadata?.planItemTitle} prompt to include product reference focus instruction or provider prompt writer metadata.`);
  }
}

function assertGenerationTelemetry(job) {
  const telemetry = job?.metadata?.generationTelemetry;
  if (!telemetry || typeof telemetry !== "object") {
    throw new Error(`Expected generation telemetry for job ${job?.id}`);
  }
  for (const key of ["planJobPrepareMs", "promptPrepareMs", "referenceReadMs", "providerMs", "storeMs", "totalJobRunMs"]) {
    if (!isFiniteNumber(telemetry[key])) {
      throw new Error(`Expected telemetry.${key} number for ${job?.id}: ${JSON.stringify(telemetry)}`);
    }
  }
  if (telemetry.providerRetryCount !== 0) {
    throw new Error(`Expected mock runner to avoid provider retries: ${JSON.stringify(telemetry)}`);
  }
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

async function waitForJobsDone(targetWorkflowId, expectedCount) {
  const started = Date.now();
  while (Date.now() - started < 45000) {
    const jobs = await requestJson(`${baseUrl}/api/jobs?workflowId=${encodeURIComponent(targetWorkflowId)}`);
    const relevant = Array.isArray(jobs) ? jobs : [];
    if (relevant.length >= expectedCount) {
      const terminal = relevant.filter((job) => ["done", "completed", "failed"].includes(job.status));
      if (terminal.length >= expectedCount) return terminal.slice(0, expectedCount);
    }
    await sleep(750);
  }
  throw new Error(`Timed out waiting for ${expectedCount} generation plan jobs`);
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
    await sleep(750);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tinyPngDataUrl() {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
}

function cleanupSmokeRows() {
  const db = new Database(path.join(process.cwd(), ".data", "image-master.db"));
  try {
    db.pragma("foreign_keys = ON");
    const cleanup = db.transaction(() => {
      db.prepare(
        "DELETE FROM generated_artifacts WHERE workflowId IN (?, ?, ?) OR batchId IN (?, ?, ?) OR json_extract(metadata, '$.batchId') IN (?, ?, ?)"
      ).run(workflowId, pendingWorkflowId, modelWorkflowId, batchId, pendingBatchId, modelBatchId, batchId, pendingBatchId, modelBatchId);
      db.prepare(
        "DELETE FROM assets WHERE json_extract(metadata, '$.workflowId') IN (?, ?, ?) OR json_extract(metadata, '$.batchId') IN (?, ?, ?)"
      ).run(workflowId, pendingWorkflowId, modelWorkflowId, batchId, pendingBatchId, modelBatchId);
      db.prepare(
        "DELETE FROM generation_jobs WHERE workflowId IN (?, ?, ?) OR batchId IN (?, ?, ?) OR json_extract(metadata, '$.batchId') IN (?, ?, ?)"
      ).run(workflowId, pendingWorkflowId, modelWorkflowId, batchId, pendingBatchId, modelBatchId, batchId, pendingBatchId, modelBatchId);
      db.prepare("DELETE FROM project_batches WHERE id IN (?, ?, ?)").run(batchId, pendingBatchId, modelBatchId);
      db.prepare("DELETE FROM workflows WHERE id IN (?, ?, ?)").run(workflowId, pendingWorkflowId, modelWorkflowId);
    });
    cleanup();
  } finally {
    db.close();
  }
}

function assertNoProviderSideEffects(jobId) {
  const db = new Database(path.join(process.cwd(), ".data", "image-master.db"));
  try {
    const lease = db.prepare("SELECT * FROM job_leases WHERE job_id = ?").get(jobId);
    const artifact = db.prepare("SELECT * FROM generated_artifacts WHERE jobId = ?").get(jobId);
    if (lease) throw new Error("Expected blocked pending job to avoid lease creation");
    if (artifact) throw new Error("Expected blocked pending job to avoid artifact creation");
  } finally {
    db.close();
  }
}
