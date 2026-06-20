#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { createSmokeRuntime, stopSmokeServer } from "./smoke-runtime.mjs";

const port = Number(process.env.BATCH_ENQUEUE_SMOKE_PORT || 3484);
const externalBaseUrl = process.env.BATCH_ENQUEUE_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = Date.now();
const runtime = createSmokeRuntime({
  name: "batch-enqueue",
  stamp,
  externalBaseUrl,
});
const batchId = `smoke_batch_enqueue_${stamp}`;
const workflowId = `workflow_${batchId}`;
const nodeId = `node_${batchId}`;
const dbPath = runtime.dbPath;

let server;
let serverOutput = "";

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: process.cwd(),
    env: runtime.serverEnv({
      NEXT_TELEMETRY_DISABLED: "1",
      IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER: "1",
      IMAGE_MASTER_MOCK_JOB_RUNNER_REQUIRE_REFERENCE: "1",
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

  const dryRun = await requestJson(`${baseUrl}/api/images/generate/batch`, {
    method: "POST",
    body: JSON.stringify(buildPayload({ dryRun: true })),
  });
  if (dryRun.estimate?.providerCallCount !== 2) {
    throw new Error(`Expected dry-run providerCallCount=2, got ${dryRun.estimate?.providerCallCount}`);
  }

  const blocked = await requestJson(
    `${baseUrl}/api/images/generate/batch`,
    {
      method: "POST",
      body: JSON.stringify(buildPayload({ enqueue: true })),
    },
    402
  );
  if (blocked.code !== "PROVIDER_CALL_LIMIT_NOT_CONFIRMED") {
    throw new Error("Expected provider confirmation guard before batch enqueue");
  }

  const queued = await requestJson(
    `${baseUrl}/api/images/generate/batch`,
    {
      method: "POST",
      body: JSON.stringify(
        buildPayload({
          confirmedProviderCallLimit: dryRun.estimate.maxProviderCallCount,
        })
      ),
    },
    202
  );
  if (queued.queued !== true || queued.persistence?.queuedCount !== 2) {
    throw new Error(`Unexpected queued response: ${JSON.stringify(queued)}`);
  }

  const doneJobs = await waitForJobsDone(workflowId, 2);
  if (!doneJobs.every((job) => job.status === "done")) {
    throw new Error(`Expected all queued batch jobs done: ${JSON.stringify(doneJobs.map((job) => job.status))}`);
  }
  if (!doneJobs.every((job) => job.metadata?.source === "batch-image-api")) {
    throw new Error("Expected queued batch jobs to keep batch-image-api source");
  }
  if (!doneJobs.every((job) => job.metadata?.usesProductReference === true)) {
    throw new Error("Expected queued batch jobs to use product reference");
  }

  const db = new Database(dbPath);
  try {
    const artifacts = db
      .prepare("SELECT * FROM generated_artifacts WHERE batchId = ? ORDER BY createdAt")
      .all(batchId)
      .map(parseRow);
    const batch = db.prepare("SELECT * FROM project_batches WHERE id = ?").get(batchId);
    const batchMetadata = batch ? parseJson(batch.metadata) : {};

    if (artifacts.length !== 2) throw new Error(`Expected 2 artifacts, got ${artifacts.length}`);
    if (!batch) throw new Error("Expected project batch");
    if (batchMetadata.mode !== "queued") throw new Error("Expected batch mode=queued");
    if (!batchMetadata.referenceImageUrl) throw new Error("Expected queued reference image metadata");
    if (batchMetadata.successCount !== 2 || batchMetadata.failedCount !== 0) {
      throw new Error(`Expected synced queued batch counts, got ${JSON.stringify(batchMetadata)}`);
    }
    if (batchMetadata.partialResult !== false) {
      throw new Error("Expected queued batch partialResult=false after completion");
    }
    if (
      batchMetadata.counts?.success !== 2 ||
      batchMetadata.counts?.failed !== 0 ||
      batchMetadata.counts?.total !== 2
    ) {
      throw new Error(`Expected queued batch counts object to sync, got ${JSON.stringify(batchMetadata.counts)}`);
    }
    if (!batchMetadata.lastBatchStateSyncedAt) {
      throw new Error("Expected queued batch sync timestamp");
    }

    console.log(
      `Batch enqueue smoke passed on ${baseUrl}: ${doneJobs.length} queued jobs, ${artifacts.length} artifacts, batch ${batchId}.`
    );

    await cleanup(db, { batchId, workflowId, artifacts, batchMetadata });
  } finally {
    db.close();
  }
} catch (error) {
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-5000));
  }
  process.exitCode = 1;
} finally {
  await stopSmokeServer(server);
  runtime.cleanup();
}

function buildPayload(extra) {
  return {
    images: [
      {
        title: "Queued hero",
        type: "hero",
        copyText: "queued hero",
        prompt: "Mock queued product hero prompt",
      },
      {
        title: "Queued detail",
        type: "detail",
        copyText: "queued detail",
        prompt: "Mock queued product detail prompt",
      },
    ],
    style: "smoke queued",
    modelIds: [],
    persistProjectBatch: true,
    batchId,
    batchTitle: "Smoke Queued Batch",
    workflowId,
    nodeId,
    platform: "smoke",
    productImageBase64: tinyPngDataUrl(),
    ...extra,
  };
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
  throw new Error(`Timed out waiting for ${expectedCount} queued batch jobs`);
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
    await sleep(750);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function cleanup(db, { batchId, workflowId, artifacts, batchMetadata }) {
  const filePaths = artifacts
    .map((artifact) => artifact.metadata?.imageStorage?.filePath)
    .filter((value) => typeof value === "string" && value.includes(`${path.sep}.data${path.sep}generated${path.sep}`));
  const referenceFilePath = batchMetadata?.referenceImageStorage?.filePath;
  if (
    typeof referenceFilePath === "string" &&
    referenceFilePath.includes(`${path.sep}.data${path.sep}generated${path.sep}`)
  ) {
    filePaths.push(referenceFilePath);
  }

  db.prepare("DELETE FROM generated_artifacts WHERE batchId = ? OR json_extract(metadata, '$.batchId') = ?").run(batchId, batchId);
  db.prepare("DELETE FROM assets WHERE json_extract(metadata, '$.workflowId') = ? OR json_extract(metadata, '$.batchId') = ?").run(workflowId, batchId);
  db.prepare("DELETE FROM generation_jobs WHERE batchId = ? OR json_extract(metadata, '$.batchId') = ?").run(batchId, batchId);
  db.prepare("DELETE FROM project_batches WHERE id = ?").run(batchId);
  db.prepare("DELETE FROM workflows WHERE id = ?").run(workflowId);

  for (const filePath of filePaths) {
    if (fs.existsSync(filePath)) await fsp.unlink(filePath);
  }
}

function parseRow(row) {
  return {
    ...row,
    metadata: parseJson(row.metadata),
  };
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tinyPngDataUrl() {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
}
