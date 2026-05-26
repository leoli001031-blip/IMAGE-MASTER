#!/usr/bin/env node

import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import path from "node:path";

const port = Number(process.env.PROJECT_STATE_SMOKE_PORT || 3472);
const externalBaseUrl = process.env.PROJECT_STATE_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = Date.now();
const batchId = `smoke_project_state_${stamp}`;
const workflowId = `workflow_${batchId}`;
const nodeId = `node_${batchId}`;
const assetId = `asset_${batchId}`;
const db = new Database(path.join(process.cwd(), ".data", "image-master.db"));
let server;
let serverOutput = "";
let createdJobId = "";

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

  const job = await requestJson(`${baseUrl}/api/jobs`, {
    method: "POST",
    body: JSON.stringify({
      workflowId,
      nodeId,
      assetId,
      status: "done",
      prompt: "Project state smoke, no provider call.",
      metadata: {
        source: "project-state-smoke",
        batchId,
        batchIndex: 1,
        batchTotal: 1,
        batchJobTitle: "Project State Smoke Image",
        exportPackId: "smoke-project-state-pack",
        exportPackTitle: "Project State Smoke Pack",
        exportSpecId: "smoke-square",
        platform: "taobao",
        size: "1024x1024",
        ratio: "1:1",
        naming: "smoke_project_state_01",
      },
    }),
  });
  createdJobId = job.id;

  if (!job.metadata?.projectId || !job.metadata?.campaignId || job.metadata?.batchState !== "generated") {
    throw new Error("Expected /api/jobs to enrich projectId, campaignId, and batchState.");
  }

  const projectsPayload = await requestJson(`${baseUrl}/api/projects`);
  const defaultProject = projectsPayload.projects?.find((project) =>
    project.batches?.some((batch) => batch.id === batchId)
  );
  if (!defaultProject) throw new Error("Expected project list to include smoke batch.");

  const generatedBatch = defaultProject.batches.find((batch) => batch.id === batchId);
  if (generatedBatch?.batchState?.state !== "generated") {
    throw new Error(`Expected generated batch state, got ${generatedBatch?.batchState?.state}`);
  }

  const reviewed = await patchBatch(defaultProject.id, batchId, "in_review")
    .then(() => patchBatch(defaultProject.id, batchId, "reviewed"));
  if (reviewed.batch?.state !== "reviewed") throw new Error("Expected reviewed state.");

  const locked = await patchBatch(defaultProject.id, batchId, "locked");
  if (locked.batch?.state !== "locked") throw new Error("Expected locked state.");

  const lockedEdit = await rawPatch(`${baseUrl}/api/projects/${defaultProject.id}`, {
    entityType: "batch",
    batchId,
    title: "Should Not Edit",
  });
  if (lockedEdit.status !== 409) {
    throw new Error(`Expected locked edit 409, got ${lockedEdit.status}`);
  }

  const delivered = await patchBatch(defaultProject.id, batchId, "delivered");
  if (delivered.batch?.state !== "delivered") throw new Error("Expected delivered state.");

  console.log(
    `Project state smoke passed on ${baseUrl}: auto-linked job ${createdJobId}, locked edit 409, delivered.`
  );
} finally {
  cleanup();
  if (server) server.kill();
}

async function patchBatch(projectId, id, state) {
  return requestJson(`${baseUrl}/api/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify({
      entityType: "batch",
      batchId: id,
      state,
    }),
  });
}

async function rawPatch(url, body) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})),
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  return payload;
}

async function waitForServer(url) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 60000) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Server did not become ready at ${url}: ${lastError?.message || serverOutput.slice(-1000)}`);
}

function cleanup() {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM job_leases WHERE job_id = ?").run(createdJobId);
    db.prepare("DELETE FROM generated_artifacts WHERE jobId = ? OR json_extract(metadata, '$.batchId') = ?").run(
      createdJobId,
      batchId
    );
    db.prepare("DELETE FROM generation_jobs WHERE id = ? OR json_extract(metadata, '$.batchId') = ?").run(
      createdJobId,
      batchId
    );
    db.prepare("DELETE FROM project_batches WHERE id = ?").run(batchId);
  });
  tx();
}
