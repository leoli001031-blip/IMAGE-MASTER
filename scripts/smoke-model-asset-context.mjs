#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const port = Number(process.env.MODEL_ASSET_CONTEXT_SMOKE_PORT || 3482);
const externalBaseUrl = process.env.MODEL_ASSET_CONTEXT_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const root = process.cwd();
const dbPath = path.join(root, ".data", "image-master.db");

let server;
let serverOutput = "";

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: root,
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
  await waitForServer(`${baseUrl}/api/models`);
  const models = await requestJson(`${baseUrl}/api/models`);
  assert(Array.isArray(models), "Expected /api/models to return an array");

  const db = new Database(dbPath, { readonly: true });
  try {
    const columns = db.prepare("PRAGMA table_info(models)").all().map((row) => row.name);
    assert(columns.includes("metadata"), "models table is missing metadata column");
    assert(columns.includes("updatedAt"), "models table is missing updatedAt column");
  } finally {
    db.close();
  }

  const modelTemplate = fs.readFileSync(path.join(root, "lib/ai/prompts/model-template.ts"), "utf8");
  assert(modelTemplate.includes("buildModelAssetMetadata"), "model metadata builder is missing");
  assert(modelTemplate.includes("identityAnchors"), "model identity anchors are missing");
  assert(modelTemplate.includes("Treat the model as a reusable person asset"), "person asset boundary is missing");
  assert(modelTemplate.includes("downstreamReferenceMode"), "model metadata should expose downstream reference mode");
  assert(modelTemplate.includes("downstreamReferenceRules"), "model metadata should expose downstream reference rules");
  assert(modelTemplate.includes("Scene lighting and the current shot's pose instructions override the model asset sheet"), "model metadata should separate identity from downstream pose and lighting");

  const modelAssetPlan = fs.readFileSync(path.join(root, "lib/canvas/model-asset-template-plan.ts"), "utf8");
  assert(modelAssetPlan.includes("Zone B is the downstream identity reference zone"), "model asset prompt should name the downstream identity zone");
  assert(modelAssetPlan.includes("Zone B pose rules: the large 3/4 identity reference uses low relaxed shoulders"), "model asset prompt should use concrete downstream identity pose rules");
  assert(!/feel like a photographer is gently guiding/i.test(modelAssetPlan), "model asset prompt should avoid vague photographer-guidance wording");

  const workbench = fs.readFileSync(path.join(root, "components/canvas/visual-workbench.tsx"), "utf8");
  assert(workbench.includes('componentType: "model_asset"'), "canvas model asset type mapping is missing");
  assert(workbench.includes("referenceImages"), "canvas model reference image wiring is missing");
  assert(workbench.includes("identityAnchors"), "canvas model identity context wiring is missing");
  assert(workbench.includes("downstreamReferenceRules"), "canvas model asset context should carry downstream identity rules");

  const script = fs.readFileSync(path.join(root, "scripts/gen-model-sheet.mjs"), "utf8");
  assert(!/sk-[A-Za-z0-9_-]{20,}/.test(script), "model sheet script still contains a hardcoded API key");
  assert(script.includes("IMAGE_API_KEY"), "model sheet script should require an explicit env key");

  console.log(JSON.stringify({
    baseUrl,
    modelsSeen: models.length,
    checks: [
      "models metadata migration",
      "model asset metadata builder",
      "canvas model reference context",
      "no hardcoded model-sheet key",
    ],
  }, null, 2));
  console.log("Model asset context smoke passed without provider calls.");
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

async function waitForServer(url) {
  const started = Date.now();
  while (Date.now() - started < 45000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Next dev is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function requestJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
