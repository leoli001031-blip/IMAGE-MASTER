#!/usr/bin/env node

import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import path from "node:path";

const port = Number(process.env.BATCH_ARCHIVE_SMOKE_PORT || 3475);
const externalBaseUrl = process.env.BATCH_ARCHIVE_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = Date.now();
const batchId = `smoke_batch_archive_${stamp}`;
const workflowId = `workflow_${batchId}`;
const db = new Database(path.join(process.cwd(), ".data", "image-master.db"));
const createdJobIds = [];
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

  const jobs = {};
  for (const status of ["pending", "queued", "running", "done"]) {
    const job = await createJob(status);
    jobs[status] = job;
    createdJobIds.push(job.id);
  }

  seedActiveLease(jobs.queued.id, "queued-owner");
  seedActiveLease(jobs.running.id, "running-owner");

  const projectsPayload = await requestJson(`${baseUrl}/api/projects`);
  const project = projectsPayload.projects?.find((item) =>
    item.batches?.some((batch) => batch.id === batchId)
  );
  if (!project) throw new Error("Expected smoke batch to be linked to a project.");

  const cleanup = await requestJson(`${baseUrl}/api/projects/${project.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      entityType: "batch",
      batchId,
      action: "archive_cleanup",
      reason: "batch archive smoke cleanup",
      archivedBy: "smoke",
    }),
  });

  assertIncludes(cleanup.archiveCleanup?.cancelledJobIds, jobs.pending.id, "pending cancelled");
  assertIncludes(cleanup.archiveCleanup?.cancelledJobIds, jobs.queued.id, "queued cancelled");
  assertIncludes(cleanup.archiveCleanup?.cancelledJobIds, jobs.running.id, "running cancelled");
  assertIncludes(cleanup.archiveCleanup?.skippedJobIds, jobs.done.id, "done skipped");

  assertJobStatus(jobs.pending.id, "cancelled");
  assertJobStatus(jobs.queued.id, "cancelled");
  assertJobStatus(jobs.running.id, "cancelled");
  assertJobStatus(jobs.done.id, "done");
  assertReleasedLease(jobs.queued.id);
  assertReleasedLease(jobs.running.id);

  const projectsAfter = await requestJson(`${baseUrl}/api/projects`);
  const projectAfter = projectsAfter.projects?.find((item) =>
    item.batches?.some((batch) => batch.id === batchId)
  );
  const batchAfter = projectAfter?.batches?.find((batch) => batch.id === batchId);
  if (batchAfter?.metadata?.archiveCleanup?.cancelledCount !== 3) {
    throw new Error("Expected archive cleanup metadata to record 3 cancelled jobs.");
  }
  if (batchAfter?.metadata?.archiveCleanup?.skippedCount !== 1) {
    throw new Error("Expected archive cleanup metadata to record 1 skipped job.");
  }

  console.log(
    `Batch archive cleanup smoke passed on ${baseUrl}: cancelled 3 active jobs, skipped 1 completed job.`
  );
} finally {
  cleanupRows();
  if (server) server.kill();
}

async function createJob(status) {
  return requestJson(`${baseUrl}/api/jobs`, {
    method: "POST",
    body: JSON.stringify({
      workflowId,
      nodeId: `node_${status}_${batchId}`,
      assetId: `asset_${batchId}`,
      status,
      prompt: "Batch archive cleanup smoke, no provider call.",
      resultUrl: status === "done" ? `/generated/${batchId}_${status}.png` : "",
      metadata: {
        source: "batch-archive-cleanup-smoke",
        batchId,
        batchIndex: createdJobIds.length + 1,
        batchTotal: 4,
        batchJobTitle: `Batch Archive Smoke ${status}`,
        exportPackId: "smoke-batch-archive-pack",
        exportPackTitle: "Batch Archive Smoke Pack",
        exportSpecId: `smoke-${status}`,
        platform: "multi_channel",
        size: "1024x1024",
        ratio: "1:1",
        naming: `smoke_batch_archive_${status}`,
      },
    }),
  });
}

function seedActiveLease(jobId, owner) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO job_leases (
       job_id, lease_id, owner, status, claimed_at, heartbeat_at, expires_at, released_at, updated_at
     )
     VALUES (?, ?, ?, 'active', ?, ?, ?, NULL, ?)`
  ).run(jobId, `lease_${jobId}`, owner, now, now, expiresAt, now);
}

function assertJobStatus(jobId, expectedStatus) {
  const row = db.prepare("SELECT status, metadata FROM generation_jobs WHERE id = ?").get(jobId);
  if (row?.status !== expectedStatus) {
    throw new Error(`Expected ${jobId} status ${expectedStatus}, got ${row?.status}`);
  }
  if (expectedStatus === "cancelled") {
    const metadata = parseJson(row.metadata);
    if (!metadata.cancelledAt || !metadata.batchArchivedAt) {
      throw new Error(`Expected ${jobId} to keep cancellation and archive metadata.`);
    }
  }
}

function assertReleasedLease(jobId) {
  const lease = db.prepare("SELECT status, released_at FROM job_leases WHERE job_id = ?").get(jobId);
  if (lease?.status !== "cancelled" || !lease.released_at) {
    throw new Error(`Expected ${jobId} lease to be released as cancelled.`);
  }
}

function assertIncludes(list, value, label) {
  if (!Array.isArray(list) || !list.includes(value)) {
    throw new Error(`Expected ${label}: ${value}`);
  }
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
  const payload = await response.json().catch(async () => ({ raw: await response.text() }));
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

function cleanupRows() {
  if (createdJobIds.length === 0) return;
  const placeholders = createdJobIds.map(() => "?").join(",");
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM job_leases WHERE job_id IN (${placeholders})`).run(...createdJobIds);
    db.prepare(`DELETE FROM generation_jobs WHERE id IN (${placeholders})`).run(...createdJobIds);
    db.prepare("DELETE FROM generated_artifacts WHERE json_extract(metadata, '$.batchId') = ?").run(batchId);
    db.prepare("DELETE FROM project_batches WHERE id = ?").run(batchId);
  });
  tx();
}

function parseJson(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
