#!/usr/bin/env node

import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import path from "node:path";

const port = Number(process.env.PROJECT_REVIEW_SMOKE_PORT || 3473);
const externalBaseUrl = process.env.PROJECT_REVIEW_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = Date.now();
const projectTitle = `Smoke Review Project ${stamp}`;
const campaignTitle = `Smoke Review Campaign ${stamp}`;
const batchId = `smoke_project_review_${stamp}`;
const db = new Database(path.join(process.cwd(), ".data", "image-master.db"));
let server;
let serverOutput = "";
let projectId = "";
let campaignId = "";
let reviewSessionId = "";

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

  const projectPayload = await requestJson(`${baseUrl}/api/projects`, {
    method: "POST",
    body: JSON.stringify({
      entityType: "project",
      title: projectTitle,
      metadata: { source: "smoke-project-review-history" },
    }),
  });
  projectId = projectPayload.project?.id;
  if (!projectId) throw new Error("Project create did not return an id.");

  const campaignPayload = await requestJson(`${baseUrl}/api/projects`, {
    method: "POST",
    body: JSON.stringify({
      entityType: "campaign",
      projectId,
      title: campaignTitle,
      metadata: { source: "smoke-project-review-history" },
    }),
  });
  campaignId = campaignPayload.campaign?.id;
  if (!campaignId) throw new Error("Campaign create did not return an id.");

  await requestJson(`${baseUrl}/api/projects`, {
    method: "POST",
    body: JSON.stringify({
      entityType: "batch",
      id: batchId,
      projectId,
      campaignId,
      title: "Smoke Review Export Pack",
      state: "generated",
      metadata: {
        source: "smoke-project-review-history",
        batchId,
      },
    }),
  });

  const reviewPayload = await requestJson(`${baseUrl}/api/review-sessions`, {
    method: "POST",
    body: JSON.stringify({
      title: "Smoke Project Review Session",
      items: [
        {
          id: "smoke-review-item-1",
          title: "Smoke image",
          imageUrl: "/canvas-assets/product-main.svg",
          status: "pending",
          sourceId: "smoke-job-1",
          metadata: {
            projectId,
            campaignId,
            batchId,
          },
        },
      ],
      qualityChecks: [
        {
          id: "smoke-review-check-1",
          itemId: "smoke-review-item-1",
          label: "Smoke quality gate",
          status: "pass",
          message: "No provider call.",
        },
      ],
      metadata: {
        source: "smoke-project-review-history",
        projectId,
        campaignId,
        batchId,
      },
    }),
  });
  reviewSessionId = reviewPayload.session?.id;
  if (!reviewSessionId) throw new Error("Review session create did not return an id.");

  await requestJson(`${baseUrl}/api/review-sessions?id=${encodeURIComponent(reviewSessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      action: "approve_item",
      itemId: "smoke-review-item-1",
      metadata: { source: "smoke-project-review-history" },
    }),
  });

  await requestJson(`${baseUrl}/api/review-sessions?id=${encodeURIComponent(reviewSessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      action: "add_note",
      note: "Smoke review history note",
      metadata: { source: "smoke-project-review-history" },
    }),
  });

  const detailPayload = await requestJson(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}`);
  const project = detailPayload.project;
  const batch = project?.batches?.find((item) => item.id === batchId);

  if (!project?.reviewSummary || project.reviewSummary.sessionCount < 1) {
    throw new Error("Expected project review summary.");
  }
  if (!batch?.reviewSummary || batch.reviewSummary.sessionCount !== 1) {
    throw new Error("Expected batch review summary.");
  }
  if (batch.reviewSummary.approved !== 1) {
    throw new Error(`Expected one approved item, got ${batch.reviewSummary.approved}.`);
  }
  const labels = batch.reviewSummary.recentHistory?.map((entry) => entry.label).join("\n") || "";
  if (!labels.includes("Smoke image approved") || !labels.includes("Review note added")) {
    throw new Error(`Expected approved and note history labels, got: ${labels}`);
  }

  console.log(
    `Project review history smoke passed on ${baseUrl}: project ${projectId}, campaign ${campaignId}, batch ${batchId}, review ${reviewSessionId}.`
  );
} finally {
  cleanup();
  if (server) server.kill();
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

function cleanup() {
  const tx = db.transaction(() => {
    if (reviewSessionId) db.prepare("DELETE FROM review_sessions WHERE id = ?").run(reviewSessionId);
    db.prepare("DELETE FROM review_sessions WHERE json_extract(metadata, '$.source') = ?").run(
      "smoke-project-review-history"
    );
    if (batchId) db.prepare("DELETE FROM project_batches WHERE id = ?").run(batchId);
    if (campaignId) db.prepare("DELETE FROM campaigns WHERE id = ?").run(campaignId);
    if (projectId) db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  });
  tx();
}
