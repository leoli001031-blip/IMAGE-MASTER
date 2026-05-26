#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const port = Number(process.env.BATCH_PERSISTENCE_SMOKE_PORT || 3478);
const externalBaseUrl = process.env.BATCH_PERSISTENCE_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = Date.now();
const batchId = `smoke_batch_persist_${stamp}`;
const workflowId = `workflow_${batchId}`;
const nodeId = `node_${batchId}`;
const dbPath = path.join(process.cwd(), ".data", "image-master.db");

let server;
let serverOutput = "";

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      IMAGE_MASTER_ENABLE_MOCK_BATCH: "1",
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

  const dryRun = await requestJson(`${baseUrl}/api/images/generate/batch`, {
    method: "POST",
    body: JSON.stringify(buildPayload({ dryRun: true })),
  });
  if (dryRun.estimate?.providerCallCount !== 2) {
    throw new Error("Expected dry-run providerCallCount=2");
  }
  if (dryRun.estimate?.usesProductReference !== true || !(dryRun.estimate?.referenceImageBytes > 0)) {
    throw new Error("Expected dry-run to account for a product reference image");
  }

  const payload = buildPayload({
    dryRun: false,
    confirmedProviderCallLimit: dryRun.estimate.maxProviderCallCount,
    mockResults: [
      {
        url: tinyPngDataUrl(),
      },
      {
        error: "mock empty result",
        errorCode: "EMPTY_RESULT",
      },
    ],
  });

  const response = await requestJson(`${baseUrl}/api/images/generate/batch`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (response.persistence?.successCount !== 1 || response.persistence?.failedCount !== 1) {
    throw new Error(`Unexpected persistence summary: ${JSON.stringify(response.persistence)}`);
  }

  const db = new Database(dbPath);
  try {
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
    if (!jobs.some((job) => job.status === "done")) throw new Error("Expected one done job");
    if (!jobs.some((job) => job.status === "failed")) throw new Error("Expected one failed job");
    if (artifacts.length !== 1) throw new Error(`Expected 1 artifact, got ${artifacts.length}`);
    if (!batch) throw new Error("Expected project batch");
    if (batchMetadata.partialResult !== true) throw new Error("Expected partialResult=true");
    if (batchMetadata.successCount !== 1 || batchMetadata.failedCount !== 1) {
      throw new Error(`Unexpected batch counts: ${JSON.stringify(batchMetadata)}`);
    }
    if (!batchMetadata.referenceImageUrl || !batchMetadata.referenceImageStorage?.filePath) {
      throw new Error("Expected persisted batch reference image metadata");
    }
    if (!jobs.every((job) => job.metadata.referenceImageUrl === batchMetadata.referenceImageUrl)) {
      throw new Error("Expected all batch jobs to keep referenceImageUrl");
    }

    console.log(
      `Batch persistence smoke passed on ${baseUrl}: ${jobs.length} jobs, ${artifacts.length} artifact, partial batch ${batchId}.`
    );

    await cleanup(db, { batchId, jobs, artifacts, batchMetadata });
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
  if (server) server.kill("SIGTERM");
}

function buildPayload(extra) {
  return {
    images: [
      {
        title: "Partial hero",
        type: "hero",
        copyText: "partial hero",
        prompt: "Mock product hero prompt",
      },
      {
        title: "Partial detail",
        type: "detail",
        copyText: "partial detail",
        prompt: "Mock product detail prompt",
      },
    ],
    style: "smoke partial",
    modelIds: [],
    persistProjectBatch: true,
    batchId,
    batchTitle: "Smoke Partial Batch",
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

async function cleanup(db, { batchId, jobs, artifacts, batchMetadata }) {
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
