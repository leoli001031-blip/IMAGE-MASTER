#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import Database from "better-sqlite3";
import net from "node:net";
import path from "node:path";
import {
  restoreSourceFiles,
  snapshotSourceFiles,
  stopSmokeServer,
} from "./smoke-runtime.mjs";

const externalBaseUrl = process.env.SCOPED_API_QUERIES_SMOKE_BASE_URL?.trim();
const requestedPort = Number(process.env.SCOPED_API_QUERIES_SMOKE_PORT || 3495);
const port = externalBaseUrl ? undefined : await findAvailablePort(requestedPort);
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = Date.now();
const batchId = `smoke_scoped_batch_${stamp}`;
const exportPackId = `smoke_scoped_pack_${stamp}`;
const planId = `smoke_scoped_plan_${stamp}`;
const workflowId = `smoke_scoped_workflow_${stamp}`;
const controlBatchId = `smoke_scoped_control_batch_${stamp}`;
const dbPath = path.join(process.cwd(), ".data", "image-master.db");
const sourceFileSnapshots = shouldSpawnServer
  ? snapshotSourceFiles(["tsconfig.json", "next-env.d.ts"])
  : [];

let server;
let serverOutput = "";
const createdJobIds = [];
const createdArtifactIds = [];

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      WATCHPACK_POLLING: process.env.WATCHPACK_POLLING || "true",
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

  const targetJobs = [];
  for (let index = 0; index < 2; index += 1) {
    targetJobs.push(
      await createJob({
        nodeId: `node_target_${index}`,
        assetId: `asset_target_${index}`,
        status: index === 0 ? "done" : "pending",
        metadata: {
          batchId,
          exportPackId,
          planId,
          smoke: "target",
          index,
        },
      })
    );
  }

  const controlJob = await createJob({
    workflowId: `${workflowId}_control`,
    nodeId: "node_control",
    assetId: "asset_control",
    status: "done",
    metadata: {
      batchId: controlBatchId,
      exportPackId: `${exportPackId}_control`,
      planId: `${planId}_control`,
      smoke: "control",
    },
  });

  const targetArtifacts = [];
  for (let index = 0; index < 2; index += 1) {
    targetArtifacts.push(
      await createArtifact({
        jobId: targetJobs[index].id,
        nodeId: `node_target_${index}`,
        assetId: `asset_target_${index}`,
        title: `Scoped artifact ${index + 1}`,
        status: index === 0 ? "ready" : "draft",
        metadata: {
          batchId,
          exportPackId,
          planId,
          smoke: "target",
          index,
        },
      })
    );
  }

  const controlArtifact = await createArtifact({
    workflowId: `${workflowId}_control`,
    jobId: controlJob.id,
    nodeId: "node_control",
    assetId: "asset_control",
    title: "Scoped control artifact",
    status: "ready",
    metadata: {
      batchId: controlBatchId,
      exportPackId: `${exportPackId}_control`,
      planId: `${planId}_control`,
      smoke: "control",
    },
  });

  const oldUpdatedAt = new Date(Date.now() - 60_000).toISOString();
  const newUpdatedAt = new Date(Date.now() + 60_000).toISOString();
  const updatedAfterCutoff = new Date(Date.now()).toISOString();
  setRowUpdatedAt("generation_jobs", targetJobs[0].id, oldUpdatedAt);
  setRowUpdatedAt("generation_jobs", targetJobs[1].id, newUpdatedAt);
  setRowUpdatedAt("generated_artifacts", targetArtifacts[0].id, oldUpdatedAt);
  setRowUpdatedAt("generated_artifacts", targetArtifacts[1].id, newUpdatedAt);

  assertIds(await getArray(`/api/jobs?batchId=${encodeURIComponent(batchId)}`), targetJobs, "jobs batchId");
  assertIds(
    await getArray(`/api/jobs?exportPackId=${encodeURIComponent(exportPackId)}`),
    targetJobs,
    "jobs exportPackId"
  );
  assertIds(await getArray(`/api/jobs?planId=${encodeURIComponent(planId)}`), targetJobs, "jobs planId");
  assertIds(
    await getArray(
      `/api/jobs?workflowId=${encodeURIComponent(workflowId)}&status=${encodeURIComponent("done")}`
    ),
    [targetJobs[0]],
    "jobs workflowId/status"
  );

  assertIds(
    await getArray(`/api/artifacts?batchId=${encodeURIComponent(batchId)}`),
    targetArtifacts,
    "artifacts batchId"
  );
  assertIds(
    await getArray(`/api/artifacts?exportPackId=${encodeURIComponent(exportPackId)}`),
    targetArtifacts,
    "artifacts exportPackId"
  );
  assertIds(
    await getArray(`/api/artifacts?planId=${encodeURIComponent(planId)}`),
    targetArtifacts,
    "artifacts planId"
  );
  assertIds(
    await getArray(
      `/api/artifacts?workflowId=${encodeURIComponent(workflowId)}&status=${encodeURIComponent("ready")}`
    ),
    [targetArtifacts[0]],
    "artifacts workflowId/status"
  );

  assertNoIds(await getArray(`/api/jobs?batchId=${encodeURIComponent(batchId)}`), [controlJob], "jobs control");
  assertNoIds(
    await getArray(`/api/artifacts?batchId=${encodeURIComponent(batchId)}`),
    [controlArtifact],
    "artifacts control"
  );
  assertIds(
    await getArray(
      `/api/jobs?workflowId=${encodeURIComponent(workflowId)}&updatedAfter=${encodeURIComponent(updatedAfterCutoff)}&limit=1`
    ),
    [targetJobs[1]],
    "jobs workflowId/updatedAfter/limit"
  );
  assertIds(
    await getArray(
      `/api/artifacts?workflowId=${encodeURIComponent(workflowId)}&updatedAfter=${encodeURIComponent(updatedAfterCutoff)}&limit=1`
    ),
    [targetArtifacts[1]],
    "artifacts workflowId/updatedAfter/limit"
  );

  assertIndexedPlan("generation_jobs", "batchId");
  assertIndexedPlan("generated_artifacts", "batchId");
  assertUpdatedAtIndexedPlan("generation_jobs");
  assertUpdatedAtIndexedPlan("generated_artifacts");
  assertWorkbenchPollingUsesScopedQueries();
  assertArtifactRouteDefaultsToBoundedUnscopedList();

  console.log(
    `Scoped API query smoke passed on ${baseUrl}: ${targetJobs.length} jobs and ${targetArtifacts.length} artifacts narrowed by batchId/exportPackId/planId.`
  );
} catch (error) {
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-5000));
  }
  process.exitCode = 1;
} finally {
  cleanup();
  if (server) await stopSmokeServer(server);
  restoreSourceFiles(sourceFileSnapshots);
}

async function createJob(overrides) {
  const job = await requestJson(
    `${baseUrl}/api/jobs`,
    {
      method: "POST",
      body: JSON.stringify({
        workflowId,
        status: "pending",
        prompt: "Scoped API query smoke job",
        metadata: {
          batchId,
          exportPackId,
          planId,
        },
        ...overrides,
      }),
    },
    201
  );
  createdJobIds.push(job.id);
  return job;
}

async function createArtifact(overrides) {
  const artifact = await requestJson(
    `${baseUrl}/api/artifacts`,
    {
      method: "POST",
      body: JSON.stringify({
        workflowId,
        type: "image",
        title: "Scoped API query smoke artifact",
        status: "ready",
        url: "/generated/smoke.png",
        prompt: "Scoped API query smoke artifact",
        provider: "smoke",
        model: "smoke",
        metadata: {
          batchId,
          exportPackId,
          planId,
        },
        ...overrides,
      }),
    },
    201
  );
  createdArtifactIds.push(artifact.id);
  return artifact;
}

async function getArray(pathname) {
  const payload = await requestJson(`${baseUrl}${pathname}`);
  if (!Array.isArray(payload)) throw new Error(`Expected array payload from ${pathname}`);
  return payload;
}

function assertIds(actual, expected, label) {
  const actualIds = actual.map((item) => item.id).sort();
  const expectedIds = expected.map((item) => item.id).sort();
  if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
    throw new Error(`${label} returned ${JSON.stringify(actualIds)}, expected ${JSON.stringify(expectedIds)}`);
  }
}

function assertNoIds(actual, excluded, label) {
  const actualIds = new Set(actual.map((item) => item.id));
  const unexpected = excluded.map((item) => item.id).filter((id) => actualIds.has(id));
  if (unexpected.length > 0) {
    throw new Error(`${label} included non-target ids: ${JSON.stringify(unexpected)}`);
  }
}

function setRowUpdatedAt(table, id, updatedAt) {
  const db = new Database(dbPath);
  try {
    db.prepare(`UPDATE ${table} SET updatedAt = ? WHERE id = ?`).run(updatedAt, id);
  } finally {
    db.close();
  }
}

function assertWorkbenchPollingUsesScopedQueries() {
  const source = fs.readFileSync(path.join(process.cwd(), "components/canvas/hooks/useWorkbenchJobs.ts"), "utf8");
  if (!/new URLSearchParams\(\{ limit: "200" \}\)[\s\S]*params\.set\("workflowId", workflowId\)/.test(source)) {
    throw new Error("Expected useWorkbenchJobs to scope polling by workflowId with URLSearchParams");
  }
  if (!/window\.fetch\(`\/api\/jobs\?\$\{params\.toString\(\)\}`/.test(source)) {
    throw new Error("Expected job polling to call /api/jobs with the scoped query string");
  }
  if (!/window\.fetch\(`\/api\/artifacts\?\$\{params\.toString\(\)\}`/.test(source)) {
    throw new Error("Expected artifact polling to call /api/artifacts with the scoped query string");
  }
}

function assertArtifactRouteDefaultsToBoundedUnscopedList() {
  const source = fs.readFileSync(path.join(process.cwd(), "app/api/artifacts/route.ts"), "utf8");
  if (!/const hasScopedFilter = Boolean\([\s\S]*workflowId[\s\S]*nodeId[\s\S]*jobId[\s\S]*assetId[\s\S]*status[\s\S]*batchId[\s\S]*exportPackId[\s\S]*planId[\s\S]*\)/.test(source)) {
    throw new Error("Expected /api/artifacts to detect whether list requests are scoped");
  }
  if (!/const limit = parseLimit\(searchParams\.get\("limit"\)\) \?\? \(hasScopedFilter \? 200 : 80\)/.test(source)) {
    throw new Error("Expected unscoped /api/artifacts list requests to default to a bounded limit");
  }
}

function assertIndexedPlan(table, column) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN SELECT * FROM ${table} WHERE ${column} = ? ORDER BY createdAt DESC`)
      .all(batchId)
      .map((row) => String(row.detail || ""))
      .join("\n");
    if (!plan.includes("USING INDEX") || plan.includes(`SCAN ${table}`)) {
      throw new Error(`Expected ${table}.${column} query to use an index without a full table scan; plan was:\n${plan}`);
    }
  } finally {
    db.close();
  }
}

function assertUpdatedAtIndexedPlan(table) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM ${table}
         WHERE workflowId = ? AND updatedAt > ?
         ORDER BY updatedAt DESC, createdAt DESC
         LIMIT 1`
      )
      .all(workflowId, new Date(0).toISOString())
      .map((row) => String(row.detail || ""))
      .join("\n");
    if (!plan.includes("USING INDEX") || !plan.includes("updatedAt")) {
      throw new Error(`Expected ${table}.workflowId/updatedAt query to use an updatedAt index; plan was:\n${plan}`);
    }
  } finally {
    db.close();
  }
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
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    const preview = text.slice(0, 160).replace(/\s+/g, " ");
    throw new Error(`Expected JSON from ${url}, got non-JSON response: ${preview}`);
  }
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status} from ${url}: ${JSON.stringify(payload)}`
    );
  }
  return payload;
}

async function findAvailablePort(startPort) {
  for (let portCandidate = startPort; portCandidate < startPort + 50; portCandidate += 1) {
    if (await canListen(portCandidate)) return portCandidate;
  }
  throw new Error(`No available smoke port found starting at ${startPort}`);
}

function canListen(portCandidate) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });
    probe.listen(portCandidate, "127.0.0.1");
  });
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

function cleanup() {
  if (createdJobIds.length === 0 && createdArtifactIds.length === 0) return;

  const db = new Database(dbPath);
  try {
    const deleteArtifacts = db.prepare("DELETE FROM generated_artifacts WHERE id = ?");
    const deleteJobs = db.prepare("DELETE FROM generation_jobs WHERE id = ?");
    const run = db.transaction(() => {
      for (const id of createdArtifactIds) deleteArtifacts.run(id);
      for (const id of createdJobIds) deleteJobs.run(id);
    });
    run();
  } finally {
    db.close();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
