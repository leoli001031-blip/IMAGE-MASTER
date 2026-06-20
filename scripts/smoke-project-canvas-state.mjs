#!/usr/bin/env node

import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import path from "node:path";
import {
  restoreSourceFiles,
  snapshotSourceFiles,
  stopSmokeServer,
} from "./smoke-runtime.mjs";

const port = Number(process.env.PROJECT_CANVAS_STATE_SMOKE_PORT || 3491);
const externalBaseUrl = process.env.PROJECT_CANVAS_STATE_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = Date.now();
const sourceFileSnapshots = shouldSpawnServer
  ? snapshotSourceFiles(["tsconfig.json", "next-env.d.ts"])
  : [];
let server;
let serverOutput = "";
let createdProjectId = "";
let createdWorkflowId = "";
const db = new Database(path.join(process.cwd(), ".data", "image-master.db"));

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
  await waitForServer(`${baseUrl}/api/projects`);

  const projectPayload = await requestJson(`${baseUrl}/api/projects`, {
    method: "POST",
    body: JSON.stringify({
      title: `Project Canvas Smoke ${stamp}`,
      description: "Smoke project for canvas workflow reference only.",
      metadata: {
        source: "project-canvas-state-smoke",
        assetIds: [`asset_project_canvas_${stamp}`],
        assets: [{ id: `asset_payload_should_be_reduced_${stamp}`, title: "Should not be copied" }],
      },
    }),
  }, 201);
  const project = projectPayload.project;
  if (!project?.id) throw new Error("Expected project id");
  createdProjectId = project.id;
  if (!project.metadata?.assetIds?.includes(`asset_project_canvas_${stamp}`)) {
    throw new Error("Expected explicit asset reference to stay in metadata");
  }
  if (project.metadata?.assets) throw new Error("Expected project metadata to avoid copied asset payloads");

  const workflowPayload = await requestJson(`${baseUrl}/api/workflows`, {
    method: "POST",
    body: JSON.stringify({
      title: `${project.title} 画布`,
      description: "Project-scoped canvas workflow smoke.",
      nodes: [
        {
          id: `node_project_canvas_${stamp}`,
          type: "canvasNode",
          position: { x: 120, y: 160 },
          data: {
            kind: "generationFrame",
            title: "项目生成框",
            iconName: "frame",
            status: "draft",
          },
        },
      ],
      edges: [],
      metadata: {
        kind: "canvas-workbench",
        projectId: project.id,
        visualNodeLayoutVersion: 1,
      },
    }),
  }, 201);
  if (!workflowPayload.id) throw new Error("Expected workflow id");
  createdWorkflowId = workflowPayload.id;

  const linkedPayload = await requestJson(`${baseUrl}/api/projects/${encodeURIComponent(project.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      entityType: "project",
      metadata: {
        ...(project.metadata ?? {}),
        canvasWorkflowId: workflowPayload.id,
        canvasSavedAt: new Date().toISOString(),
      },
    }),
  });
  if (linkedPayload.project?.metadata?.canvasWorkflowId !== workflowPayload.id) {
    throw new Error("Expected project metadata to reference canvas workflow");
  }

  const restoredProjectPayload = await requestJson(`${baseUrl}/api/projects/${encodeURIComponent(project.id)}`);
  const restoredWorkflowId = restoredProjectPayload.project?.metadata?.canvasWorkflowId;
  const restoredWorkflow = await requestJson(`${baseUrl}/api/workflows/${encodeURIComponent(restoredWorkflowId)}`);
  if (restoredWorkflow.metadata?.projectId !== project.id) {
    throw new Error("Expected workflow metadata project id");
  }
  if (!Array.isArray(restoredWorkflow.nodes) || restoredWorkflow.nodes.length !== 1) {
    throw new Error("Expected saved project canvas nodes");
  }

  console.log(
    `Project canvas state smoke passed on ${baseUrl}: project ${project.id} references workflow ${workflowPayload.id}.`
  );
} catch (error) {
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-3000));
  }
  process.exitCode = 1;
} finally {
  cleanup();
  if (server) await stopSmokeServer(server);
  restoreSourceFiles(sourceFileSnapshots);
}

function cleanup() {
  if (!createdProjectId && !createdWorkflowId) return;
  const tx = db.transaction(() => {
    if (createdWorkflowId) db.prepare("DELETE FROM workflows WHERE id = ?").run(createdWorkflowId);
    if (createdProjectId) db.prepare("DELETE FROM projects WHERE id = ?").run(createdProjectId);
  });
  tx();
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
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      if (response.status === expectedStatus) return payload;
      lastError = new Error(`Expected status ${expectedStatus}, got ${response.status}: ${JSON.stringify(payload)}`);
      if (![404, 500].includes(response.status)) break;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
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
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}
