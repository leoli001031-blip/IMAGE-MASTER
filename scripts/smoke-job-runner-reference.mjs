#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { createSmokeRuntime, stopSmokeServer } from "./smoke-runtime.mjs";

const port = Number(process.env.JOB_RUNNER_REFERENCE_SMOKE_PORT || 3481);
const externalBaseUrl = process.env.JOB_RUNNER_REFERENCE_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = Date.now();
const runtime = createSmokeRuntime({
  name: "job-runner-reference",
  stamp,
  externalBaseUrl,
});
const workflowId = `workflow_smoke_reference_${stamp}`;
const nodeId = `node_smoke_reference_${stamp}`;
const referenceFileName = `smoke-job-runner-reference-${stamp}.png`;
const styleReferenceFileName = `smoke-job-runner-style-reference-${stamp}.png`;
const generatedDir = runtime.generatedDir;
const referenceFilePath = path.join(generatedDir, referenceFileName);
const styleReferenceFilePath = path.join(generatedDir, styleReferenceFileName);
const referencePublicUrl = `/api/generated-images/${encodeURIComponent(referenceFileName)}`;
const styleReferencePublicUrl = `/api/generated-images/${encodeURIComponent(styleReferenceFileName)}`;
const dbPath = runtime.dbPath;

let server;
let serverOutput = "";
let createdJobId = "";

await fsp.mkdir(generatedDir, { recursive: true });
await fsp.writeFile(referenceFilePath, Buffer.from(tinyPngBase64(), "base64"));
await fsp.writeFile(styleReferenceFilePath, Buffer.from(tinyPngBase64(), "base64"));

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: process.cwd(),
    env: runtime.serverEnv({
      NEXT_TELEMETRY_DISABLED: "1",
      IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER: "1",
      IMAGE_MASTER_MOCK_JOB_RUNNER_REQUIRE_REFERENCE: "1",
      IMAGE_MASTER_MOCK_JOB_RUNNER_EXPECT_REFERENCE_COUNT: "2",
      IMAGE_MASTER_QUEUE_OWNER: `smoke-reference-owner-${stamp}`,
      IMAGE_MASTER_JOB_LEASE_MS: "60000",
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

try {
  await waitForServer(`${baseUrl}/api/settings`);

  const job = await requestJson(
    `${baseUrl}/api/jobs`,
    {
      method: "POST",
      body: JSON.stringify({
        workflowId,
        nodeId,
        status: "pending",
        prompt: [
          "Commercial image generation task: reference smoke",
          "Keep product identity consistent.",
          "Reference context:",
          "- Product reference: Smoke product",
        ].join("\n"),
        metadata: buildJobMetadata(),
      }),
    },
    201
  );
  createdJobId = job.id;
  if (!createdJobId) throw new Error("Expected job id");

  const runResponse = await requestJson(`${baseUrl}/api/jobs/${createdJobId}/run`, {
    method: "POST",
  });
  if (runResponse.started !== true && runResponse.alreadyDone !== true) {
    throw new Error(`Expected job run to start: ${JSON.stringify(runResponse)}`);
  }

  const completed = await waitForJobDone(createdJobId);
  const jobMetadata = parseJson(completed.metadata);
  if (completed.status !== "done") throw new Error(`Expected done job, got ${completed.status}`);
  if (jobMetadata.usesProductReference !== true) {
    throw new Error(`Expected completed job to use product reference: ${completed.metadata}`);
  }
  if (jobMetadata.referenceImageUrl !== referencePublicUrl) {
    throw new Error(`Expected referenceImageUrl ${referencePublicUrl}, got ${jobMetadata.referenceImageUrl}`);
  }
  if (!Array.isArray(jobMetadata.providerReferenceImageUrls) || jobMetadata.providerReferenceImageUrls.length !== 2) {
    throw new Error(`Expected two providerReferenceImageUrls, got ${JSON.stringify(jobMetadata.providerReferenceImageUrls)}`);
  }
  if (jobMetadata.providerReferenceAdapter?.mode !== "multi_image_input") {
    throw new Error(`Expected multi_image_input adapter, got ${JSON.stringify(jobMetadata.providerReferenceAdapter)}`);
  }
  if (!jobMetadata.resultStorage?.filePath) {
    throw new Error("Expected generated output storage metadata");
  }
  if (!Array.isArray(jobMetadata.providerAttemptLedger) || jobMetadata.providerAttemptLedger.length < 1) {
    throw new Error("Expected completed job to keep provider attempt ledger");
  }
  const latestAttempt = jobMetadata.providerAttemptLedger.at(-1);
  if (latestAttempt.status !== "succeeded" || latestAttempt.scope !== "job-runner") {
    throw new Error(`Expected succeeded job-runner attempt, got ${JSON.stringify(latestAttempt)}`);
  }
  if (latestAttempt.providerReferenceRole !== "product") {
    throw new Error(`Expected product provider reference attempt, got ${JSON.stringify(latestAttempt)}`);
  }
  if (!Array.isArray(latestAttempt.referenceImageUrls) || latestAttempt.referenceImageUrls.length !== 2) {
    throw new Error(`Expected attempt to keep two reference image URLs, got ${JSON.stringify(latestAttempt)}`);
  }
  if (jobMetadata.providerBudgetSummary?.reserved < 1 || jobMetadata.providerBudgetSummary?.consumed < 1) {
    throw new Error(`Expected provider budget reserve/consume summary, got ${JSON.stringify(jobMetadata.providerBudgetSummary)}`);
  }

  const db = new Database(dbPath);
  try {
    const budgetEvents = db
      .prepare("SELECT * FROM provider_call_budget_events WHERE budgetId = ? ORDER BY createdAt ASC")
      .all(jobMetadata.providerCallBudgetId);
    if (budgetEvents.length < 2) {
      throw new Error(`Expected provider budget events, got ${budgetEvents.length}`);
    }
    if (!budgetEvents.some((event) => event.phase === "reserve") || !budgetEvents.some((event) => event.phase === "consume")) {
      throw new Error(`Expected reserve and consume provider budget events, got ${JSON.stringify(budgetEvents)}`);
    }

    const artifact = db
      .prepare("SELECT * FROM generated_artifacts WHERE jobId = ? ORDER BY createdAt DESC LIMIT 1")
      .get(createdJobId);
    if (!artifact) throw new Error("Expected generated artifact");
    const artifactMetadata = parseJson(artifact.metadata);
    if (artifactMetadata.usesProductReference !== true) {
      throw new Error(`Expected artifact to keep reference metadata: ${artifact.metadata}`);
    }
    if (!String(artifact.prompt || "").includes("Reference context:")) {
      throw new Error("Expected artifact prompt to preserve reference context");
    }
    if (!Array.isArray(artifactMetadata.providerAttemptLedger)) {
      throw new Error("Expected artifact to keep provider attempt ledger");
    }
    if (!Array.isArray(artifactMetadata.providerReferenceImageUrls) || artifactMetadata.providerReferenceImageUrls.length !== 2) {
      throw new Error("Expected artifact to keep two provider reference URLs");
    }
    if (!artifactMetadata.assetInvocationPlan?.decisions?.length) {
      throw new Error("Expected artifact to keep assetInvocationPlan decisions");
    }
    if (artifactMetadata.assetInvocationPlan.providerReferenceRoles?.join(",") !== "product,style") {
      throw new Error(`Expected artifact to keep provider reference roles, got ${JSON.stringify(artifactMetadata.assetInvocationPlan)}`);
    }
    if (artifactMetadata.copyRenderPolicy?.mode !== "layout_layer") {
      throw new Error(`Expected artifact to keep copy render policy, got ${JSON.stringify(artifactMetadata.copyRenderPolicy)}`);
    }

    const asset = db
      .prepare("SELECT * FROM assets WHERE json_extract(metadata, '$.jobId') = ? ORDER BY createdAt DESC LIMIT 1")
      .get(createdJobId);
    if (!asset) throw new Error("Expected generated output asset");
    const assetMetadata = parseJson(asset.metadata);
    if (assetMetadata.usesProductReference !== true) {
      throw new Error(`Expected asset to keep reference metadata: ${asset.metadata}`);
    }
    if (!Array.isArray(assetMetadata.providerAttemptLedger)) {
      throw new Error("Expected output asset to keep provider attempt ledger");
    }
    if (!Array.isArray(assetMetadata.providerReferenceImageUrls) || assetMetadata.providerReferenceImageUrls.length !== 2) {
      throw new Error("Expected output asset to keep two provider reference URLs");
    }
    if (!assetMetadata.assetInvocationPlan?.decisions?.length) {
      throw new Error("Expected output asset to keep assetInvocationPlan decisions");
    }
    if (assetMetadata.copyRenderPolicy?.mode !== "layout_layer") {
      throw new Error(`Expected output asset to keep copy render policy, got ${JSON.stringify(assetMetadata.copyRenderPolicy)}`);
    }

    console.log(
      `Job runner reference smoke passed on ${baseUrl}: ${createdJobId} used 2 provider references without provider call.`
    );

    await cleanup(db, {
      jobId: createdJobId,
      filePaths: [
        referenceFilePath,
        styleReferenceFilePath,
        jobMetadata.resultStorage?.filePath,
        artifactMetadata.imageStorage?.filePath,
        assetMetadata.imageStorage?.filePath,
      ],
    });
  } finally {
    db.close();
  }
} catch (error) {
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-4000));
  }
  process.exitCode = 1;
} finally {
  await stopSmokeServer(server);
  if (!createdJobId) {
    await fsp.rm(referenceFilePath, { force: true }).catch(() => {});
    await fsp.rm(styleReferenceFilePath, { force: true }).catch(() => {});
  }
  runtime.cleanup();
}

function buildJobMetadata() {
  const referenceImage = {
    role: "product",
    title: "Smoke product",
    url: referencePublicUrl,
    providerUsable: true,
    source: "smoke-job-runner-reference",
    nodeId,
  };
  const styleReferenceImage = {
    role: "style",
    title: "Smoke style board",
    url: styleReferencePublicUrl,
    providerUsable: true,
    source: "smoke-job-runner-reference",
    nodeId: `${nodeId}_style`,
  };

  return {
    source: "canvas-workbench",
    sourceNodeId: nodeId,
    sourceNodeLabel: "Smoke reference output",
    nodeLabel: "Smoke reference output",
    nodeKind: "output",
    nodeStatus: "queued",
    nodeMetrics: ["smoke", "reference"],
    referenceImages: [referenceImage, styleReferenceImage],
    referenceImageUrl: referencePublicUrl,
    usesProductReference: true,
    itemReferenceRoles: ["product", "style", "copy"],
    itemProviderReferenceRoles: ["product", "style"],
    copyRenderPolicy: {
      mode: "layout_layer",
      reason: "Smoke copy should stay as editable layout text.",
      inImageText: ["Smoke headline"],
      sellingPoints: ["Reference trace"],
      exportCopy: ["Generated for smoke validation"],
      forbiddenClaims: ["Do not claim medical benefits"],
    },
    assetInvocationPlan: {
      version: 1,
      mode: "llm_asset_invocation_v1",
      fallbackUsed: false,
      referenceRoles: ["product", "style", "copy"],
      providerReferenceRoles: ["product", "style"],
      decisions: [
        {
          role: "product",
          mode: "hard_reference",
          providerInput: true,
          reason: "商品图用于锁定真实形态。",
        },
        {
          role: "style",
          mode: "style_finish",
          providerInput: true,
          reason: "风格板用于验证多参考图追踪。",
        },
        {
          role: "copy",
          mode: "copy_layer",
          providerInput: false,
          reason: "文案保留为图层，不作为图片输入。",
        },
      ],
      unusedRoles: [],
      notes: ["Artifact metadata must preserve this trace."],
    },
    assetInvocationPlanner: {
      mode: "llm_asset_invocation_v1",
      fallbackUsed: false,
    },
    referenceContext: {
      version: 1,
      source: "canvas-workbench",
      targetNodeId: nodeId,
      targetNodeLabel: "Smoke reference output",
      images: [referenceImage, styleReferenceImage],
      roles: {
        product: {
          role: "product",
          title: "Smoke product",
          sourceNodeIds: [nodeId],
          componentIds: [],
          assetIds: [],
          parameters: {
            category: "smoke",
          },
          promptFragments: ["Use the local product reference for shape identity."],
          constraints: ["Keep the product silhouette unchanged."],
          negativeRules: ["Do not invent a second product."],
          qualityRules: ["Reference must be used for product identity."],
        },
        style: {
          role: "style",
          title: "Smoke style board",
          sourceNodeIds: [`${nodeId}_style`],
          componentIds: [],
          assetIds: [],
          parameters: {
            mood: "smoke",
          },
          promptFragments: ["Use the style reference for lighting and palette."],
          constraints: ["Keep the same clean reference lighting."],
          negativeRules: ["Do not turn the style board into a second product."],
          qualityRules: ["Style reference should guide mood only."],
        },
      },
      promptFragments: ["Use the local product reference for shape identity."],
      constraints: ["Keep the product silhouette unchanged."],
      negativeRules: ["Do not invent a second product."],
      qualityRules: ["Reference must be used for product identity."],
    },
  };
}

async function waitForJobDone(jobId) {
  const started = Date.now();
  const db = new Database(dbPath);
  try {
    while (Date.now() - started < 45000) {
      const row = db.prepare("SELECT * FROM generation_jobs WHERE id = ?").get(jobId);
      if (row?.status === "done") return row;
      if (row?.status === "failed" || row?.status === "cancelled") {
        throw new Error(`Job ended with ${row.status}: ${row.error || ""}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } finally {
    db.close();
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
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
  const payload = text ? JSON.parse(text) : {};
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
      if (response.ok) return;
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function cleanup(db, { jobId, filePaths }) {
  db.prepare("DELETE FROM generated_artifacts WHERE jobId = ?").run(jobId);
  db.prepare("DELETE FROM assets WHERE json_extract(metadata, '$.jobId') = ?").run(jobId);
  db.prepare("DELETE FROM generation_jobs WHERE id = ?").run(jobId);
  db.prepare("DELETE FROM job_leases WHERE job_id = ?").run(jobId);
  db.prepare("DELETE FROM provider_call_budget_events WHERE jobId = ?").run(jobId);

  const safeFiles = Array.from(new Set(filePaths.filter((value) => typeof value === "string" && value.trim())));
  for (const filePath of safeFiles) {
    if (filePath.includes(`${path.sep}.data${path.sep}generated${path.sep}`) && fs.existsSync(filePath)) {
      await fsp.unlink(filePath);
    }
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function tinyPngBase64() {
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
}
