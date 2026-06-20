#!/usr/bin/env node

import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import { createSmokeRuntime, stopSmokeServer } from "./smoke-runtime.mjs";

const stamp = Date.now();
const port = Number(process.env.LARGE_METADATA_SAFE_LIST_SMOKE_PORT || 3566);
const externalBaseUrl = process.env.LARGE_METADATA_SAFE_LIST_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const runtime = createSmokeRuntime({
  name: "large-metadata-safe-list",
  stamp,
  externalBaseUrl,
});
const workflowId = `large_metadata_workflow_${stamp}`;
const batchId = `large_metadata_batch_${stamp}`;
const dataUrl = makeLargeDataUrl(96 * 1024);

let server;
let serverOutput = "";

if (!externalBaseUrl) {
  server = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(),
    env: runtime.serverEnv({
      NEXT_TELEMETRY_DISABLED: "1",
      IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER: "1",
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

  const job = await postJson("/api/jobs", {
    workflowId,
    status: "done",
    prompt: "Large metadata smoke job",
    metadata: makeReferenceMetadata(),
  }, 201);
  assertNoInlineImage(job, "created job");
  assertLocalReference(job.metadata?.referenceImageUrl, "created job referenceImageUrl");

  const artifact = await postJson("/api/artifacts", {
    workflowId,
    jobId: job.id,
    type: "image",
    title: "Large metadata smoke artifact",
    status: "ready",
    url: "/api/generated-images/smoke.png",
    prompt: "Large metadata smoke artifact",
    provider: "smoke",
    model: "mock",
    metadata: makeReferenceMetadata(),
  }, 201);
  assertNoInlineImage(artifact, "created artifact");
  assertLocalReference(artifact.metadata?.referenceImageUrl, "created artifact referenceImageUrl");

  seedLegacyRows();

  const fullArtifacts = await getJson("/api/artifacts?full=1&limit=200");
  const fullJobs = await getJson("/api/jobs?summary=0&limit=200");
  const fullAssets = await getJson("/api/assets?full=1");
  assertNoInlineImage(fullArtifacts, "full artifact list");
  assertNoInlineImage(fullJobs, "full job list");
  assertNoInlineImage(fullAssets, "full asset list");

  console.log(
    `Large metadata safe-list smoke passed on ${baseUrl}: created references were materialized and full lists returned safely.`
  );
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

function makeReferenceMetadata() {
  return {
    batchId,
    referenceImageUrl: dataUrl,
    referenceImageUrls: [dataUrl],
    providerReferenceImageUrls: [dataUrl],
    referenceImages: [
      {
        role: "product",
        title: "Large inline product reference",
        url: dataUrl,
        providerUsable: true,
      },
    ],
    referenceContext: {
      images: [
        {
          role: "product",
          title: "Large inline product reference",
          url: dataUrl,
          providerUsable: true,
        },
      ],
    },
    providerReferenceAdapter: {
      mode: "multi_image_input",
      strategy: "provider_reference",
      primaryImage: {
        role: "product",
        title: "Large inline product reference",
        url: dataUrl,
        providerUsable: true,
      },
      providerUsableImages: [
        {
          role: "product",
          title: "Large inline product reference",
          url: dataUrl,
          providerUsable: true,
        },
      ],
    },
  };
}

function seedLegacyRows() {
  if (!runtime.dbPath) return;
  const db = new Database(runtime.dbPath);
  try {
    const now = new Date().toISOString();
    const legacyMetadata = JSON.stringify({
      batchId,
      source: "legacy-inline-smoke",
      referenceImageUrl: dataUrl,
      referenceImages: [{ role: "product", url: dataUrl, providerUsable: true }],
      referenceContext: { images: [{ role: "product", url: dataUrl, providerUsable: true }] },
      providerReferenceAdapter: {
        primaryImage: { role: "product", url: dataUrl, providerUsable: true },
        providerUsableImages: [{ role: "product", url: dataUrl, providerUsable: true }],
      },
    });

    const insertJob = db.prepare(
      `INSERT INTO generation_jobs (
         id, workflowId, nodeId, assetId, batchId, exportPackId, planId,
         status, prompt, resultUrl, error, metadata, createdAt, updatedAt
       ) VALUES (
         @id, @workflowId, '', '', @batchId, '', '', 'done', 'legacy job', '', '', @metadata, @createdAt, @updatedAt
       )`
    );
    const insertArtifact = db.prepare(
      `INSERT INTO generated_artifacts (
         id, workflowId, nodeId, jobId, assetId, batchId, exportPackId, planId,
         type, title, status, url, prompt, provider, model, metadata, createdAt, updatedAt
       ) VALUES (
         @id, @workflowId, '', '', '', @batchId, '', '',
         'image', 'legacy artifact', 'ready', '/api/generated-images/legacy.png',
         'legacy artifact', 'smoke', 'mock', @metadata, @createdAt, @updatedAt
       )`
    );
    const insertAsset = db.prepare(
      `INSERT INTO assets (
         id, type, title, description, status, url, metadata, createdAt, updatedAt
       ) VALUES (
         @id, 'product', 'legacy asset', 'legacy inline asset', 'ready',
         @url, @metadata, @createdAt, @updatedAt
       )`
    );

    for (let index = 0; index < 12; index += 1) {
      insertJob.run({
        id: `legacy_job_${stamp}_${index}`,
        workflowId,
        batchId,
        metadata: legacyMetadata,
        createdAt: now,
        updatedAt: now,
      });
      insertArtifact.run({
        id: `legacy_artifact_${stamp}_${index}`,
        workflowId,
        batchId,
        metadata: legacyMetadata,
        createdAt: now,
        updatedAt: now,
      });
      insertAsset.run({
        id: `legacy_asset_${stamp}_${index}`,
        url: dataUrl,
        metadata: legacyMetadata,
        createdAt: now,
        updatedAt: now,
      });
    }
  } finally {
    db.close();
  }
}

function makeLargeDataUrl(base64Length) {
  const body = "A".repeat(base64Length);
  return `data:image/png;base64,${body}`;
}

async function postJson(pathname, body, expectedStatus = 200) {
  return requestJson(`${baseUrl}${pathname}`, {
    method: "POST",
    body: JSON.stringify(body),
  }, expectedStatus);
}

async function getJson(pathname) {
  return requestJson(`${baseUrl}${pathname}`);
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
    throw new Error(`Expected ${expectedStatus}, got ${response.status} from ${url}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function assertLocalReference(value, label) {
  if (typeof value !== "string" || !value.startsWith("/api/generated-images/")) {
    throw new Error(`${label} was not materialized to a local generated image URL: ${String(value).slice(0, 80)}`);
  }
}

function assertNoInlineImage(value, label) {
  const json = JSON.stringify(value);
  if (json.includes("data:image/")) {
    throw new Error(`${label} still contains inline data:image payload`);
  }
}

async function waitForServer(url) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 60_000) {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
