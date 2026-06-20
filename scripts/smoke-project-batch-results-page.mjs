#!/usr/bin/env node

import { spawn } from "node:child_process";
import { deflateSync } from "node:zlib";
import Database from "better-sqlite3";
import { createSmokeRuntime, stopSmokeServer } from "./smoke-runtime.mjs";

const port = Number(process.env.PROJECT_BATCH_RESULTS_SMOKE_PORT || 3493);
const externalBaseUrl = process.env.PROJECT_BATCH_RESULTS_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = Date.now();
const runtime = createSmokeRuntime({
  name: "project-batch-results-page",
  stamp,
  externalBaseUrl,
});
const batchId = `project_batch_results_${stamp}`;
const workflowId = `workflow_${batchId}`;
const nodeId = `node_${batchId}`;
const db = new Database(runtime.dbPath);
let server;
let serverOutput = "";
let createdProjectId = "";
let createdCampaignId = "";
let createdAssetId = "";
let createdJobId = "";
let createdArtifactId = "";
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: process.cwd(),
    env: runtime.serverEnv({
      NEXT_TELEMETRY_DISABLED: "1",
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
  await waitForServer(`${baseUrl}/api/projects`);

  const asset = await requestJson(`${baseUrl}/api/assets`, {
    method: "POST",
    body: JSON.stringify({
      type: "product",
      title: `Batch Result Asset ${stamp}`,
      description: "Project batch result page smoke asset.",
      status: "ready",
      url: tinyPngDataUrl(),
      metadata: { source: "project-batch-results-page-smoke" },
    }),
  }, 201);
  createdAssetId = asset.id;

  const projectPayload = await requestJson(`${baseUrl}/api/projects`, {
    method: "POST",
    body: JSON.stringify({
      title: `Project Batch Results Smoke ${stamp}`,
      description: "Smoke project for batch result page.",
      metadata: {
        source: "project-batch-results-page-smoke",
        assetIds: [createdAssetId],
      },
    }),
  }, 201);
  const project = projectPayload.project;
  if (!project?.id) throw new Error("Expected project id");
  createdProjectId = project.id;

  const campaignPayload = await requestJson(`${baseUrl}/api/projects`, {
    method: "POST",
    body: JSON.stringify({
      entityType: "campaign",
      projectId: createdProjectId,
      title: `Batch Results Campaign ${stamp}`,
    }),
  }, 201);
  const campaign = campaignPayload.campaign;
  if (!campaign?.id) throw new Error("Expected campaign id");
  createdCampaignId = campaign.id;

  const job = await requestJson(`${baseUrl}/api/jobs`, {
    method: "POST",
    body: JSON.stringify({
      workflowId,
      nodeId,
      assetId: createdAssetId,
      status: "done",
      prompt: "Project batch results page smoke, no provider call.",
      resultUrl: tinyPngDataUrl(),
      metadata: {
        source: "project-batch-results-page-smoke",
        projectId: createdProjectId,
        campaignId: createdCampaignId,
        batchId,
        batchIndex: 1,
        batchTotal: 1,
        batchJobTitle: "项目批次结果页测试图",
        exportPackId: batchId,
        exportPackTitle: "项目批次结果页测试图组",
        exportSpecId: "smoke-result",
        productIds: [createdAssetId],
        itemCount: 1,
        platform: "multi_channel",
        ratio: "1:1",
        size: "10x10",
        naming: "project_batch_result_01",
      },
    }),
  }, 201);
  createdJobId = job.id;

  const artifact = await requestJson(`${baseUrl}/api/artifacts`, {
    method: "POST",
    body: JSON.stringify({
      workflowId,
      nodeId,
      jobId: createdJobId,
      assetId: createdAssetId,
      type: "image",
      title: "项目批次结果页测试图",
      status: "ready",
      url: tinyPngDataUrl(),
      prompt: "Project batch result smoke artifact.",
      provider: "smoke",
      model: "mock",
      metadata: {
        source: "project-batch-results-page-smoke",
        projectId: createdProjectId,
        campaignId: createdCampaignId,
        batchId,
        exportPackId: batchId,
        exportSpecId: "smoke-result",
        naming: "project_batch_result_01",
      },
    }),
  }, 201);
  createdArtifactId = artifact.id;

  const html = await requestText(
    `${baseUrl}/projects/${encodeURIComponent(createdProjectId)}/batches/${encodeURIComponent(batchId)}`
  );
  for (const expected of [
    "项目批次结果页测试图组",
    "项目批次结果页测试图",
    "保存为资产",
    "预览大图",
    "再做一张",
    "打开本地文件夹",
    "通过",
    "驳回",
  ]) {
    if (!html.includes(expected)) {
      throw new Error(`Expected batch result page HTML to include ${expected}`);
    }
  }

  let reviewPayload;
  for (const checkId of [
    "white-background",
    "text-policy",
    "model-quality",
    "commercial-quality",
  ]) {
    reviewPayload = await requestJson(`${baseUrl}/api/export-packs/${encodeURIComponent(batchId)}/qa/review`, {
      method: "PATCH",
      body: JSON.stringify({
        jobId: createdJobId,
        checkId,
        status: "pass",
        note: "Project batch result page smoke approved",
        reviewer: "smoke-project-batch-results-page",
      }),
    });
  }

  if (reviewPayload?.batchState?.state !== "reviewed") {
    throw new Error(`Expected reviewed batch state, got ${reviewPayload?.batchState?.state}`);
  }
  if (reviewPayload?.qa?.counts?.passed !== 1) {
    throw new Error(`Expected QA to pass one item, got ${JSON.stringify(reviewPayload?.qa?.counts)}`);
  }

  const rerunPayload = await requestJson(`${baseUrl}/api/jobs/${encodeURIComponent(createdJobId)}/rerun`, {
    method: "POST",
    body: JSON.stringify({
      title: "项目批次结果页测试图 再做一版",
      note: "Smoke duplicate completed result without provider call.",
    }),
  }, 201);
  if (!["pending", "queued"].includes(rerunPayload?.job?.status)) {
    throw new Error(`Expected rerun job to be pending or queued, got ${rerunPayload?.job?.status}`);
  }
  if (rerunPayload?.rerunOfJobId !== createdJobId) {
    throw new Error(`Expected rerunOfJobId ${createdJobId}, got ${rerunPayload?.rerunOfJobId}`);
  }
  if (rerunPayload?.batchState?.state !== "in_review") {
    throw new Error(`Expected rerun to reopen batch to in_review, got ${rerunPayload?.batchState?.state}`);
  }

  const rerunHtml = await requestText(
    `${baseUrl}/projects/${encodeURIComponent(createdProjectId)}/batches/${encodeURIComponent(batchId)}`
  );
  for (const expected of ["项目批次结果页测试图 再做一版"]) {
    if (!rerunHtml.includes(expected)) {
      throw new Error(`Expected rerun batch page HTML to include ${expected}`);
    }
  }

  console.log(
    `Project batch results page smoke passed on ${baseUrl}: project ${createdProjectId}, batch ${batchId}.`
  );
} catch (error) {
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-4000));
  }
  process.exitCode = 1;
} finally {
  cleanup();
  await stopSmokeServer(server);
  runtime.cleanup();
}

async function requestJson(url, init = {}, expectedStatus = 200) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (response.status !== expectedStatus) {
    throw new Error(`Expected status ${expectedStatus}, got ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function requestText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Expected page 200, got ${response.status}: ${text.slice(0, 200)}`);
  }
  return text;
}

async function waitForServer(url) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 60000) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
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
  return `data:image/png;base64,${createPngBuffer(10, 10).toString("base64")}`;
}

function createPngBuffer(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowLength = 1 + width * 4;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowLength;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = rowStart + 1 + x * 4;
      raw[pixel] = 242;
      raw[pixel + 1] = 238;
      raw[pixel + 2] = 229;
      raw[pixel + 3] = 255;
    }
  }

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}


function cleanup() {
  const tx = db.transaction(() => {
    if (createdJobId) db.prepare("DELETE FROM job_leases WHERE job_id = ?").run(createdJobId);
    if (createdArtifactId) db.prepare("DELETE FROM generated_artifacts WHERE id = ?").run(createdArtifactId);
    db.prepare("DELETE FROM generated_artifacts WHERE json_extract(metadata, '$.batchId') = ?").run(batchId);
    if (createdJobId) db.prepare("DELETE FROM generation_jobs WHERE id = ?").run(createdJobId);
    db.prepare("DELETE FROM generation_jobs WHERE json_extract(metadata, '$.batchId') = ?").run(batchId);
    db.prepare("DELETE FROM project_batches WHERE id = ?").run(batchId);
    if (createdCampaignId) db.prepare("DELETE FROM campaigns WHERE id = ?").run(createdCampaignId);
    if (createdAssetId) db.prepare("DELETE FROM assets WHERE id = ?").run(createdAssetId);
    if (createdProjectId) db.prepare("DELETE FROM projects WHERE id = ?").run(createdProjectId);
  });
  tx();
  db.close();
}
