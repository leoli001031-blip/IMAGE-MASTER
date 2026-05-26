#!/usr/bin/env node

import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import path from "node:path";

const port = Number(process.env.PROJECT_GENERATION_OWNERSHIP_SMOKE_PORT || 3492);
const externalBaseUrl = process.env.PROJECT_GENERATION_OWNERSHIP_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = Date.now();
const planWorkflowId = `workflow_project_generation_ownership_${stamp}`;
const planFrameNodeId = `frame_project_generation_ownership_${stamp}`;
const planBatchId = `batch_project_generation_plan_${stamp}`;
const directBatchId = `batch_project_generation_direct_${stamp}`;
const db = new Database(path.join(process.cwd(), ".data", "image-master.db"));
let server;
let serverOutput = "";
let createdProjectId = "";
let createdCampaignId = "";
const createdJobIds = new Set();

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
  await waitForServer(`${baseUrl}/api/projects`);

  const projectPayload = await requestJson(`${baseUrl}/api/projects`, {
    method: "POST",
    body: JSON.stringify({
      title: `Project Generation Ownership Smoke ${stamp}`,
      description: "Smoke project for project-scoped generation ownership.",
      metadata: {
        source: "project-generation-ownership-smoke",
      },
    }),
  }, 201);
  const project = projectPayload.project;
  if (!project?.id) throw new Error("Expected created project id");
  createdProjectId = project.id;

  const campaignPayload = await requestJson(`${baseUrl}/api/projects`, {
    method: "POST",
    body: JSON.stringify({
      entityType: "campaign",
      projectId: createdProjectId,
      title: `Ownership Campaign ${stamp}`,
      metadata: {
        source: "project-generation-ownership-smoke",
      },
    }),
  }, 201);
  const campaign = campaignPayload.campaign;
  if (!campaign?.id) throw new Error("Expected created campaign id");
  createdCampaignId = campaign.id;

  const planPayload = await requestJson(`${baseUrl}/api/generation-plans/run`, {
    method: "POST",
    body: JSON.stringify({
      workflowId: planWorkflowId,
      frameNodeId: planFrameNodeId,
      projectId: createdProjectId,
      campaignId: createdCampaignId,
      batchId: planBatchId,
      batchTitle: "项目归属图组 smoke",
      requiredReferenceRoles: [],
      style: "model_asset",
      enqueue: false,
      items: [
        {
          title: "Project-owned model asset",
          type: "model_asset_character_sheet",
          copyText: "项目内归属 smoke",
          prompt: "Create a text-only project-scoped model asset smoke image.",
          metadata: {
            source: "project-generation-ownership-smoke",
            slot: "plan",
          },
        },
      ],
    }),
  }, 201);
  if (!Array.isArray(planPayload.jobs) || planPayload.jobs.length !== 1) {
    throw new Error(`Expected one plan job, got ${JSON.stringify(planPayload)}`);
  }
  const planJob = planPayload.jobs[0];
  createdJobIds.add(planJob.id);
  assertJobOwnership(planJob, createdProjectId, createdCampaignId, planBatchId);

  const projectAfterPlan = await requestJson(
    `${baseUrl}/api/projects/${encodeURIComponent(createdProjectId)}`
  );
  assertProjectHasBatch(projectAfterPlan.project, planBatchId, createdProjectId, createdCampaignId);

  const directJob = await requestJson(`${baseUrl}/api/jobs`, {
    method: "POST",
    body: JSON.stringify({
      workflowId: planWorkflowId,
      nodeId: `direct_node_${stamp}`,
      status: "done",
      prompt: "Project scoped direct job smoke, no provider call.",
      metadata: {
        source: "project-generation-ownership-smoke",
        projectId: createdProjectId,
        campaignId: createdCampaignId,
        batchId: directBatchId,
        batchIndex: 1,
        batchTotal: 1,
        batchJobTitle: "Project Owned Direct Job",
        exportPackId: directBatchId,
        exportPackTitle: "Project Owned Direct Pack",
        platform: "multi_channel",
        ratio: "1:1",
        size: "1024x1024",
      },
    }),
  }, 201);
  createdJobIds.add(directJob.id);
  assertJobOwnership(directJob, createdProjectId, createdCampaignId, directBatchId);
  if (directJob.metadata?.batchState !== "generated") {
    throw new Error(`Expected generated direct batch state, got ${directJob.metadata?.batchState}`);
  }

  const projectAfterDirect = await requestJson(
    `${baseUrl}/api/projects/${encodeURIComponent(createdProjectId)}`
  );
  assertProjectHasBatch(projectAfterDirect.project, directBatchId, createdProjectId, createdCampaignId);

  console.log(
    `Project generation ownership smoke passed on ${baseUrl}: project ${createdProjectId} owns plan batch ${planBatchId} and direct batch ${directBatchId}.`
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
  if (server) server.kill("SIGTERM");
}

function assertJobOwnership(job, projectId, campaignId, batchId) {
  if (!job?.id) throw new Error("Expected job id");
  if (job.metadata?.projectId !== projectId) {
    throw new Error(`Expected job projectId ${projectId}, got ${job.metadata?.projectId}`);
  }
  if (job.metadata?.campaignId !== campaignId) {
    throw new Error(`Expected job campaignId ${campaignId}, got ${job.metadata?.campaignId}`);
  }
  if (job.metadata?.batchId !== batchId) {
    throw new Error(`Expected job batchId ${batchId}, got ${job.metadata?.batchId}`);
  }
}

function assertProjectHasBatch(project, batchId, projectId, campaignId) {
  const batch = project?.batches?.find((item) => item.id === batchId);
  if (!batch) throw new Error(`Expected project to include batch ${batchId}`);
  if (batch.projectId !== projectId) {
    throw new Error(`Expected batch projectId ${projectId}, got ${batch.projectId}`);
  }
  if (batch.campaignId !== campaignId) {
    throw new Error(`Expected batch campaignId ${campaignId}, got ${batch.campaignId}`);
  }
  if (batch.metadata?.projectId !== projectId || batch.metadata?.campaignId !== campaignId) {
    throw new Error(`Expected batch metadata ownership, got ${JSON.stringify(batch.metadata)}`);
  }
}

async function requestJson(url, init = {}, expectedStatus = 200) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 12000) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers || {}),
        },
        signal: AbortSignal.timeout(30000),
      });
      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        lastError = new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
        await sleep(500);
        continue;
      }
      if (response.status === expectedStatus) return payload;
      lastError = new Error(`Expected status ${expectedStatus}, got ${response.status}: ${JSON.stringify(payload)}`);
      if (![404, 500].includes(response.status)) break;
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw lastError || new Error(`Request failed: ${url}`);
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

function cleanup() {
  if (!createdProjectId && createdJobIds.size === 0) return;
  const jobIds = Array.from(createdJobIds);
  const tx = db.transaction(() => {
    for (const jobId of jobIds) {
      db.prepare("DELETE FROM job_leases WHERE job_id = ?").run(jobId);
      db.prepare("DELETE FROM generated_artifacts WHERE jobId = ?").run(jobId);
      db.prepare("DELETE FROM generation_jobs WHERE id = ?").run(jobId);
    }
    db.prepare("DELETE FROM generated_artifacts WHERE json_extract(metadata, '$.batchId') IN (?, ?)").run(
      planBatchId,
      directBatchId
    );
    db.prepare("DELETE FROM generation_jobs WHERE json_extract(metadata, '$.batchId') IN (?, ?)").run(
      planBatchId,
      directBatchId
    );
    db.prepare("DELETE FROM project_batches WHERE id IN (?, ?)").run(planBatchId, directBatchId);
    if (createdCampaignId) db.prepare("DELETE FROM campaigns WHERE id = ?").run(createdCampaignId);
    if (createdProjectId) db.prepare("DELETE FROM projects WHERE id = ?").run(createdProjectId);
  });
  tx();
  db.close();
}
