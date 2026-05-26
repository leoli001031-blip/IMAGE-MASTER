#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { createSmokeRuntime, stopSmokeServer } from "./smoke-runtime.mjs";

const port = Number(process.env.BATCH_ITEM_RETRY_SMOKE_PORT || 3479);
const externalBaseUrl = process.env.BATCH_ITEM_RETRY_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = Date.now();
const runtime = createSmokeRuntime({
  name: "batch-item-retry",
  stamp,
  externalBaseUrl,
});
const batchId = `smoke_batch_retry_${stamp}`;
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
      IMAGE_MASTER_ENABLE_MOCK_BATCH: "1",
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

  const batchResponse = await requestJson(`${baseUrl}/api/images/generate/batch`, {
    method: "POST",
    body: JSON.stringify(
      buildBatchPayload({
        confirmedProviderCallLimit: 4,
        mockResults: [
          {
            url: tinyPngDataUrl(),
          },
          {
            error: "mock failed before retry",
            errorCode: "EMPTY_RESULT",
          },
        ],
      })
    ),
  });

  if (batchResponse.persistence?.successCount !== 1 || batchResponse.persistence?.failedCount !== 1) {
    throw new Error(`Unexpected initial persistence summary: ${JSON.stringify(batchResponse.persistence)}`);
  }

  const db = new Database(dbPath);
  try {
    const failedJob = db
      .prepare(
        "SELECT * FROM generation_jobs WHERE json_extract(metadata, '$.batchId') = ? AND status = 'failed' LIMIT 1"
      )
      .get(batchId);
    if (!failedJob) throw new Error("Expected one failed batch job");

    const failedJobId = failedJob.id;
    const dryRun = await requestJson(`${baseUrl}/api/jobs/${failedJobId}/retry-image`, {
      method: "POST",
      body: JSON.stringify({ dryRun: true }),
    });
    if (dryRun.estimate?.providerCallCount !== 1 || dryRun.estimate?.maxProviderCallCount !== 3) {
      throw new Error(`Unexpected retry dry-run estimate: ${JSON.stringify(dryRun.estimate)}`);
    }
    if (dryRun.estimate?.usesProductReference !== true) {
      throw new Error("Expected retry dry-run to recover the persisted product reference");
    }

    const retryResponse = await requestJson(`${baseUrl}/api/jobs/${failedJobId}/retry-image`, {
      method: "POST",
      body: JSON.stringify({
        confirmedProviderCallLimit: dryRun.estimate.maxProviderCallCount,
        mockResults: [
          {
            url: tinyPngDataUrl(),
          },
        ],
      }),
    });

    if (retryResponse.job?.status !== "done") {
      throw new Error(`Expected retried job to be done: ${JSON.stringify(retryResponse.job)}`);
    }
    if (!retryResponse.artifact?.id) throw new Error("Expected retry artifact");
    if (retryResponse.retry?.usesProductReference !== true) {
      throw new Error("Expected retry response to use product reference");
    }
    if (!Array.isArray(retryResponse.job?.metadata?.providerAttemptLedger)) {
      throw new Error("Expected retried job to keep provider attempt ledger");
    }
    const latestAttempt = retryResponse.job.metadata.providerAttemptLedger.at(-1);
    if (latestAttempt?.status !== "succeeded" || latestAttempt?.scope !== "retry-image") {
      throw new Error(`Expected succeeded retry-image attempt, got ${JSON.stringify(latestAttempt)}`);
    }

    const jobs = db
      .prepare("SELECT * FROM generation_jobs WHERE json_extract(metadata, '$.batchId') = ? ORDER BY createdAt")
      .all(batchId)
      .map(parseRow);
    const artifacts = db
      .prepare("SELECT * FROM generated_artifacts WHERE json_extract(metadata, '$.batchId') = ? ORDER BY createdAt")
      .all(batchId)
      .map(parseRow);
    const batch = db.prepare("SELECT * FROM project_batches WHERE id = ?").get(batchId);
    const batchMetadata = batch ? parseJson(batch.metadata) : {};

    if (jobs.length !== 2) throw new Error(`Expected 2 jobs, got ${jobs.length}`);
    if (!jobs.every((job) => job.status === "done")) {
      throw new Error(`Expected all jobs done: ${JSON.stringify(jobs.map((job) => job.status))}`);
    }
    if (artifacts.length !== 2) throw new Error(`Expected 2 artifacts, got ${artifacts.length}`);
    if (!batch) throw new Error("Expected project batch");
    if (batchMetadata.partialResult !== false) throw new Error("Expected partialResult=false after retry");
    if (batchMetadata.successCount !== 2 || batchMetadata.failedCount !== 0) {
      throw new Error(`Unexpected batch counts after retry: ${JSON.stringify(batchMetadata)}`);
    }

    console.log(
      `Batch item retry smoke passed on ${baseUrl}: ${jobs.length} done jobs, ${artifacts.length} artifacts, batch ${batchId}.`
    );

    await cleanup(db, { batchId, artifacts, batchMetadata });
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
  runtime.cleanup();
}

function buildBatchPayload(extra) {
  return {
    images: [
      {
        title: "Retry smoke hero",
        type: "hero",
        copyText: "retry smoke hero",
        prompt: "Mock product hero prompt",
      },
      {
        title: "Retry smoke detail",
        type: "detail",
        copyText: "retry smoke detail",
        prompt: "Mock product detail prompt",
      },
    ],
    style: "smoke retry",
    modelIds: [],
    persistProjectBatch: true,
    batchId,
    batchTitle: "Smoke Retry Batch",
    workflowId,
    nodeId,
    platform: "smoke",
    productImageBase64: tinyPngDataUrl(),
    ...extra,
  };
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

async function cleanup(db, { batchId, artifacts, batchMetadata }) {
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

  db.prepare("DELETE FROM generated_artifacts WHERE json_extract(metadata, '$.batchId') = ?").run(batchId);
  db.prepare("DELETE FROM generation_jobs WHERE json_extract(metadata, '$.batchId') = ?").run(batchId);
  db.prepare("DELETE FROM project_batches WHERE id = ?").run(batchId);

  for (const filePath of filePaths) {
    if (fs.existsSync(filePath)) await fsp.unlink(filePath);
  }
}

function tinyPngDataUrl() {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
}
