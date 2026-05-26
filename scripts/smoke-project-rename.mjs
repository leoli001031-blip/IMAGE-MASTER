#!/usr/bin/env node

import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import path from "node:path";

const port = Number(process.env.PROJECT_RENAME_SMOKE_PORT || 3476);
const externalBaseUrl = process.env.PROJECT_RENAME_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = Date.now();
const originalProjectTitle = `Smoke Rename Project ${stamp}`;
const renamedProjectTitle = `Smoke Renamed Project ${stamp}`;
const originalCampaignTitle = `Smoke Rename Campaign ${stamp}`;
const renamedCampaignTitle = `Smoke Renamed Campaign ${stamp}`;
const db = new Database(path.join(process.cwd(), ".data", "image-master.db"));
let server;
let serverOutput = "";
let projectId = "";
let campaignId = "";

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
      title: originalProjectTitle,
      metadata: { source: "smoke-project-rename" },
    }),
  });
  projectId = projectPayload.project?.id;
  if (!projectId) throw new Error("Project create did not return an id.");

  const campaignPayload = await requestJson(`${baseUrl}/api/projects`, {
    method: "POST",
    body: JSON.stringify({
      entityType: "campaign",
      projectId,
      title: originalCampaignTitle,
      metadata: { source: "smoke-project-rename" },
    }),
  });
  campaignId = campaignPayload.campaign?.id;
  if (!campaignId) throw new Error("Campaign create did not return an id.");

  const emptyRename = await rawPatch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}`, {
    entityType: "project",
    title: "   ",
  });
  if (emptyRename.status !== 400) {
    throw new Error(`Expected empty project rename to fail with 400, got ${emptyRename.status}.`);
  }

  const renamedProject = await requestJson(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      entityType: "project",
      title: renamedProjectTitle,
      metadata: {
        source: "smoke-project-rename",
        renamed: true,
      },
    }),
  });
  if (renamedProject.project?.title !== renamedProjectTitle) {
    throw new Error(`Expected renamed project title, got ${renamedProject.project?.title}.`);
  }

  const renamedCampaign = await requestJson(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      entityType: "campaign",
      campaignId,
      title: renamedCampaignTitle,
      metadata: {
        source: "smoke-project-rename",
        renamed: true,
      },
    }),
  });
  if (renamedCampaign.campaign?.title !== renamedCampaignTitle) {
    throw new Error(`Expected renamed campaign title, got ${renamedCampaign.campaign?.title}.`);
  }

  const detailPayload = await requestJson(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}`);
  const project = detailPayload.project;
  const campaign = project?.campaigns?.find((item) => item.id === campaignId);
  if (project?.title !== renamedProjectTitle) {
    throw new Error(`Expected detail project title ${renamedProjectTitle}, got ${project?.title}.`);
  }
  if (campaign?.title !== renamedCampaignTitle) {
    throw new Error(`Expected detail campaign title ${renamedCampaignTitle}, got ${campaign?.title}.`);
  }

  const listPayload = await requestJson(`${baseUrl}/api/projects`);
  const listedProject = listPayload.projects?.find((item) => item.id === projectId);
  if (listedProject?.title !== renamedProjectTitle) {
    throw new Error("Expected renamed project title in project list.");
  }

  console.log(
    `Project rename smoke passed on ${baseUrl}: project ${projectId}, campaign ${campaignId}.`
  );
} finally {
  cleanup();
  if (server) server.kill();
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
    if (campaignId) db.prepare("DELETE FROM campaigns WHERE id = ?").run(campaignId);
    if (projectId) db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  });
  tx();
}
