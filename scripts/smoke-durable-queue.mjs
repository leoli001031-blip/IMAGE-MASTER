import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createSmokeRuntime, stopSmokeServer } from "./smoke-runtime.mjs";

const stamp = Date.now();
const createdIds = [];
const explicitBaseUrl = process.env.DURABLE_QUEUE_SMOKE_BASE_URL;
const runtime = createSmokeRuntime({
  name: "durable-queue",
  stamp,
  externalBaseUrl: explicitBaseUrl,
});
const dbDir = runtime.dataDir;
const dbPath = runtime.dbPath;
const port = explicitBaseUrl
  ? undefined
  : await findAvailablePort(Number(process.env.DURABLE_QUEUE_SMOKE_PORT || 3471));
const baseUrl = normalizeBaseUrl(explicitBaseUrl || `http://127.0.0.1:${port}`);
const shouldStartServer = !explicitBaseUrl;
const distDir = process.env.DURABLE_QUEUE_SMOKE_DIST_DIR ||
  runtime.distDir ||
  path.join(".next-smoke", `durable-queue-${stamp}`);

fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
ensureGenerationJobsTable();
ensureJobLeasesTable();

const ids = seedJobs();
createdIds.push(...Object.values(ids));

const server = shouldStartServer
  ? spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: process.cwd(),
      env: runtime.serverEnv({
        NEXT_TELEMETRY_DISABLED: "1",
        NEXT_DIST_DIR: distDir,
        IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER: "1",
        IMAGE_MASTER_JOB_LEASE_MS: "60000",
        IMAGE_MASTER_QUEUE_OWNER: `smoke-owner-${stamp}`,
      }),
      stdio: ["ignore", "pipe", "pipe"],
    })
  : undefined;

let serverOutput = "";
server?.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server?.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

try {
  await waitForServer(`${baseUrl}/api/settings`);

  const initial = await requestJson(`${baseUrl}/api/jobs/queue`);
  assertQueueShape(initial.queue);
  const autoReclaimed = readLease(ids.atomicExpired);
  if (
    autoReclaimed.owner !== `smoke-owner-${stamp}` ||
    !["active", "completed"].includes(autoReclaimed.status)
  ) {
    throw new Error("Expected queue GET to auto reclaim expired lease for this worker");
  }
  const autoReclaimedJob = readJob(ids.atomicExpired);
  if (
    !["queued", "running", "done"].includes(autoReclaimedJob.status) ||
    autoReclaimedJob.metadata.reclaimedFromStatus !== "queued"
  ) {
    throw new Error("Expected queue GET to recover auto-reclaimed job with reclaim metadata");
  }

  expireLease(ids.queuedExpired);
  const [atomicA, atomicB] = await Promise.all([
    requestJson(`${baseUrl}/api/jobs/queue`, {
      method: "POST",
      body: JSON.stringify({ action: "reclaim", enqueue: false }),
    }),
    requestJson(`${baseUrl}/api/jobs/queue`, {
      method: "POST",
      body: JSON.stringify({ action: "reclaim", enqueue: false }),
    }),
  ]);
  assertQueueShape(atomicA.queue);
  assertQueueShape(atomicB.queue);
  const atomicClaims = [atomicA, atomicB].filter((result) =>
    result.reclaim.reclaimedJobIds.includes(ids.queuedExpired)
  );
  if (atomicClaims.length !== 1) {
    throw new Error(`Expected exactly one atomic reclaim winner, got ${atomicClaims.length}`);
  }
  const atomicLease = readLease(ids.queuedExpired);
  if (atomicLease.owner !== atomicClaims[0].reclaim.owner || atomicLease.status !== "active") {
    throw new Error("Expected atomic reclaim to leave one active lease owned by the winner");
  }

  expireLease(ids.runningExpired);

  const reclaim = await requestJson(`${baseUrl}/api/jobs/queue`, {
    method: "POST",
    body: JSON.stringify({ action: "reclaim", enqueue: false }),
  });
  assertQueueShape(reclaim.queue);
  assertIncludes(reclaim.reclaim.reclaimedJobIds, ids.runningExpired, "running expired reclaim");

  const reclaimedRunning = readJob(ids.runningExpired);
  if (reclaimedRunning.status !== "queued") {
    throw new Error(`Expected reclaimed running job to be queued, got ${reclaimedRunning.status}`);
  }
  const reclaimedRunningLease = readLease(ids.runningExpired);
  if (reclaimedRunningLease.owner !== reclaim.reclaim.owner) {
    throw new Error("Expected reclaimed job lease owner to match smoke worker");
  }
  if (reclaimedRunningLease.owner === "old-running-owner") {
    throw new Error("Expected reclaimed job lease owner to change from old owner");
  }
  if (reclaimedRunning.metadata.reclaimedFromStatus !== "running") {
    throw new Error("Expected reclaimed running job to keep reclaimedFromStatus metadata");
  }

  const cancel = await requestJson(`${baseUrl}/api/jobs/${ids.queuedExpired}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: "durable queue smoke cancel" }),
  });
  if (!cancel.cancelled || cancel.job?.status !== "cancelled") {
    throw new Error("Expected cancel API to cancel reclaimed queued job");
  }
  const cancelledLease = readLease(ids.queuedExpired);
  if (cancelledLease.status !== "cancelled" || !cancelledLease.released_at) {
    throw new Error("Expected cancelled job to release lease table row");
  }

  const retry = await requestJson(`${baseUrl}/api/jobs/${ids.failedRetryable}/retry`, {
    method: "POST",
  });
  if (!retry.retried || retry.job?.status !== "pending") {
    throw new Error("Expected retry API to reset failed job to pending");
  }
  const retriedLease = readLease(ids.failedRetryable);
  if (retriedLease.status !== "retried" || !retriedLease.released_at) {
    throw new Error("Expected retried job to release lease table row");
  }

  const finalSnapshot = await requestJson(`${baseUrl}/api/jobs/queue`);
  assertQueueShape(finalSnapshot.queue);

  console.log(
    `Durable queue smoke passed on ${baseUrl}: ` +
      `atomic claim verified, ${reclaim.reclaim.reclaimedJobIds.length} reclaimed, ` +
      `auto worker recover verified, cancel/retry release verified` +
      `${shouldStartServer ? `, isolated distDir=${distDir}.` : "."}`
  );
} finally {
  await cleanup();
  db.close();
  await stopSmokeServer(server);
  if (shouldStartServer && !process.env.DURABLE_QUEUE_SMOKE_KEEP_DIST) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  runtime.cleanup();
}

function ensureGenerationJobsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY,
      workflowId TEXT,
      nodeId TEXT,
      assetId TEXT,
      batchId TEXT NOT NULL DEFAULT '',
      exportPackId TEXT NOT NULL DEFAULT '',
      planId TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      prompt TEXT NOT NULL DEFAULT '',
      resultUrl TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function ensureJobLeasesTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_leases (
      job_id TEXT PRIMARY KEY,
      lease_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      claimed_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      released_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_job_leases_lease_id ON job_leases(lease_id);
    CREATE INDEX IF NOT EXISTS idx_job_leases_owner ON job_leases(owner);
    CREATE INDEX IF NOT EXISTS idx_job_leases_status ON job_leases(status);
    CREATE INDEX IF NOT EXISTS idx_job_leases_expires_at ON job_leases(expires_at);
  `);
}

function seedJobs() {
  const now = new Date();
  const past = new Date(now.getTime() - 120000).toISOString();
  const future = new Date(now.getTime() + 120000).toISOString();
  const createdAt = now.toISOString();
  const fixtures = {
    pending: {
      id: `smoke_durable_pending_${stamp}`,
      status: "pending",
      metadata: { source: "smoke-durable-queue", stamp },
    },
    atomicExpired: {
      id: `smoke_durable_atomic_expired_${stamp}`,
      status: "queued",
      metadata: leaseMetadata("old-atomic-owner", past, past),
      lease: leaseRow("old-atomic-owner", past, past),
    },
    queuedExpired: {
      id: `smoke_durable_queued_expired_${stamp}`,
      status: "queued",
      metadata: leaseMetadata("old-queued-owner", createdAt, future),
      lease: leaseRow("old-queued-owner", createdAt, future),
    },
    runningExpired: {
      id: `smoke_durable_running_expired_${stamp}`,
      status: "running",
      metadata: leaseMetadata("old-running-owner", createdAt, future),
      lease: leaseRow("old-running-owner", createdAt, future),
    },
    failedRetryable: {
      id: `smoke_durable_failed_${stamp}`,
      status: "failed",
      error: "fixture failure",
      metadata: leaseMetadata("old-failed-owner", createdAt, future),
      lease: leaseRow("old-failed-owner", createdAt, future),
    },
  };

  const insert = db.prepare(`
    INSERT INTO generation_jobs (
      id, workflowId, nodeId, assetId, status, prompt, resultUrl, error, metadata, createdAt, updatedAt
    ) VALUES (
      @id, @workflowId, @nodeId, @assetId, @status, @prompt, @resultUrl, @error, @metadata, @createdAt, @updatedAt
    )
  `);

  for (const fixture of Object.values(fixtures)) {
    insert.run({
      id: fixture.id,
      workflowId: `wf_smoke_${stamp}`,
      nodeId: `node_${fixture.status}`,
      assetId: null,
      status: fixture.status,
      prompt: "local smoke fixture; must not call provider",
      resultUrl: "",
      error: fixture.error || "",
      metadata: JSON.stringify(fixture.metadata),
      createdAt,
      updatedAt: createdAt,
    });
  }

  const insertLease = db.prepare(`
    INSERT INTO job_leases (
      job_id, lease_id, owner, status, claimed_at, heartbeat_at, expires_at, released_at, updated_at
    ) VALUES (
      @jobId, @leaseId, @owner, @status, @claimedAt, @heartbeatAt, @expiresAt, @releasedAt, @updatedAt
    )
  `);

  for (const fixture of Object.values(fixtures)) {
    if (!fixture.lease) continue;
    insertLease.run({
      jobId: fixture.id,
      ...fixture.lease,
    });
  }

  return Object.fromEntries(Object.entries(fixtures).map(([key, value]) => [key, value.id]));

  function leaseMetadata(owner, heartbeatAt, expiresAt) {
    return {
      source: "smoke-durable-queue",
      stamp,
      leaseId: `lease_fixture_${owner}_${stamp}`,
      leaseOwner: owner,
      leaseStatus: "active",
      leaseAcquiredAt: heartbeatAt,
      leaseHeartbeatAt: heartbeatAt,
      leaseExpiresAt: expiresAt,
      leaseDurationMs: 60000,
      lastRunId: `run_fixture_${stamp}`,
    };
  }

  function leaseRow(owner, heartbeatAt, expiresAt) {
    return {
      leaseId: `lease_fixture_${owner}_${stamp}`,
      owner,
      status: "active",
      claimedAt: heartbeatAt,
      heartbeatAt,
      expiresAt,
      releasedAt: null,
      updatedAt: heartbeatAt,
    };
  }
}

function readJob(id) {
  const row = db.prepare("SELECT * FROM generation_jobs WHERE id = ?").get(id);
  if (!row) throw new Error(`Missing job ${id}`);
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

function readLease(id) {
  const row = db.prepare("SELECT * FROM job_leases WHERE job_id = ?").get(id);
  if (!row) throw new Error(`Missing lease ${id}`);
  return row;
}

function expireLease(id) {
  const past = new Date(Date.now() - 120000).toISOString();
  db.prepare(
    `UPDATE job_leases
     SET heartbeat_at = @past, expires_at = @past, updated_at = @past
     WHERE job_id = @id`
  ).run({ id, past });
}

function assertQueueShape(queue) {
  if (!queue || typeof queue !== "object") throw new Error("Queue payload missing");
  if (typeof queue.owner !== "string" || !queue.owner) throw new Error("Queue owner missing");
  if (!queue.runtime || typeof queue.runtime.runningCount !== "number") {
    throw new Error("Queue runtime counters missing");
  }
  if (!queue.database || typeof queue.database.total !== "number") {
    throw new Error("Queue database counters missing");
  }
  if (!queue.stale || typeof queue.stale.expiredCount !== "number") {
    throw new Error("Queue stale counters missing");
  }
  if (!Array.isArray(queue.leases)) throw new Error("Queue lease list missing");
  if (!queue.leaseTable || !Array.isArray(queue.leaseTable.rows)) {
    throw new Error("Queue lease table rows missing");
  }
}

function assertIncludes(list, value, label) {
  if (!Array.isArray(list) || !list.includes(value)) {
    throw new Error(`Expected ${label} to include ${value}`);
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${url} failed ${response.status}: ${text}`);
  }
  return payload;
}

async function waitForServer(url) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      await requestJson(url);
      return;
    } catch {
      await delay(500);
    }
  }
  throw new Error(`Server did not become ready at ${url}. Output:\n${serverOutput}`);
}

async function cleanup() {
  if (createdIds.length === 0) return;
  db.prepare(
    `DELETE FROM job_leases WHERE job_id IN (${createdIds.map(() => "?").join(",")})`
  ).run(...createdIds);
  db.prepare(
    `DELETE FROM generation_jobs WHERE id IN (${createdIds.map(() => "?").join(",")})`
  ).run(...createdIds);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

async function findAvailablePort(startPort) {
  for (let portToTry = startPort; portToTry < startPort + 50; portToTry += 1) {
    if (await isPortAvailable(portToTry)) return portToTry;
  }
  throw new Error(`No available durable queue smoke port near ${startPort}`);
}

function isPortAvailable(portToTry) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });
    probe.listen(portToTry, "127.0.0.1");
  });
}
