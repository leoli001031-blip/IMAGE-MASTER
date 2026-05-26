#!/usr/bin/env node

import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import path from "node:path";

const port = Number(process.env.AGENT_PLAN_MATRIX_SMOKE_PORT || 3486);
const externalBaseUrl = process.env.AGENT_PLAN_MATRIX_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = Date.now();
const workflowId = `workflow_agent_plan_matrix_${stamp}`;
const frameNodeId = `frame_agent_plan_matrix_${stamp}`;
const batchId = `batch_agent_plan_matrix_${stamp}`;
let server;
let serverOutput = "";

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER: "1",
      IMAGE_MASTER_ENABLE_MOCK_BATCH: "1",
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

  const blocked = await requestJson(`${baseUrl}/api/generation-plans/run`, {
    method: "POST",
    body: JSON.stringify(buildParameterOnlyProductBody()),
  }, 400);
  if (blocked.code !== "PRODUCT_REFERENCE_REQUIRED") {
    throw new Error(`Expected product reference guard, got ${JSON.stringify(blocked)}`);
  }

  const response = await requestJson(`${baseUrl}/api/generation-plans/run`, {
    method: "POST",
    body: JSON.stringify(buildRequestBody()),
  }, 201);

  const agentPlan = response.plan?.agentPlan;
  if (!agentPlan) throw new Error("Expected run response to include agentPlan");
  const productGroups = agentPlan.assetGroups.filter((group) => group.role === "product" && group.available);
  const sceneGroups = agentPlan.assetGroups.filter((group) => group.role === "scene" && group.available);
  if (productGroups.length !== 2) {
    throw new Error(`Expected two product asset groups, got ${JSON.stringify(productGroups)}`);
  }
  if (sceneGroups.length !== 2) {
    throw new Error(`Expected two scene asset groups, got ${JSON.stringify(sceneGroups)}`);
  }
  if (!Array.isArray(agentPlan.generationMatrix) || agentPlan.generationMatrix.length !== 4) {
    throw new Error(`Expected four matrix items, got ${JSON.stringify(agentPlan.generationMatrix)}`);
  }

  for (const matrixItem of agentPlan.generationMatrix) {
    const productGroupIds = matrixItem.assetGroupIds.filter((id) => id.startsWith("asset.product."));
    const sceneGroupIds = matrixItem.assetGroupIds.filter((id) => id.startsWith("asset.scene."));
    if (productGroupIds.length !== 1) {
      throw new Error(`Expected matrix item to select exactly one product group: ${JSON.stringify(matrixItem)}`);
    }
    if (sceneGroupIds.length !== 1) {
      throw new Error(`Expected matrix item to select exactly one scene group: ${JSON.stringify(matrixItem)}`);
    }
  }

  if (!Array.isArray(response.jobs) || response.jobs.length !== 4) {
    throw new Error(`Expected four pending jobs, got ${JSON.stringify(response.jobs)}`);
  }
  for (const job of response.jobs) {
    const adapter = job.metadata?.providerReferenceAdapter;
    const providerImages = adapter?.providerUsableImages ?? [];
    const productImages = providerImages.filter((image) => image.role === "product");
    const sceneImages = providerImages.filter((image) => image.role === "scene");
    const modelImages = providerImages.filter((image) => image.role === "model");
    if (productImages.length !== 1 || sceneImages.length !== 1 || modelImages.length !== 1) {
      throw new Error(`Expected each job to carry one product, one scene, one model reference: ${JSON.stringify({
        title: job.metadata?.planItemTitle,
        providerImages,
        agentMatrixItem: job.metadata?.agentMatrixItem,
      })}`);
    }
  }

  console.log(
    `Agent plan matrix smoke passed on ${baseUrl}: ${productGroups.length} products x ${sceneGroups.length} scenes stayed separated across ${response.jobs.length} jobs.`
  );
} catch (error) {
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-5000));
  }
  process.exitCode = 1;
} finally {
  cleanupSmokeRows();
  if (server) server.kill("SIGTERM");
}

function buildParameterOnlyProductBody() {
  return {
    workflowId: `${workflowId}_blocked`,
    frameNodeId: `${frameNodeId}_blocked`,
    batchId: `${batchId}_blocked`,
    request: "根据商品参数生成一张真实商品图。",
    userRequest: "根据商品参数生成一张真实商品图。",
    referenceContext: {
      version: 1,
      source: "canvas-workbench",
      targetNodeId: `${frameNodeId}_blocked`,
      images: [],
      roles: {
        product: {
          role: "product",
          title: "文字商品参数",
          sourceNodeIds: [],
          componentIds: [],
          assetIds: [],
          parameters: {
            color: "black",
            material: "nylon",
          },
          promptFragments: ["一件黑色尼龙外套"],
          constraints: ["真实商品身份必须锁定"],
          negativeRules: [],
          qualityRules: [],
        },
      },
      promptFragments: [],
      constraints: [],
      negativeRules: [],
      qualityRules: [],
    },
    enqueue: false,
    items: [
      {
        itemId: "blocked_product_identity",
        title: "真实商品主图",
        type: "product_hero",
        prompt: "生成真实商品主图。",
        copyText: "",
        referenceRoles: ["product"],
        providerReferenceRoles: ["product"],
        metadata: {
          smoke: "agent-plan-matrix-product-guard",
        },
      },
    ],
  };
}

function buildRequestBody() {
  return {
    workflowId,
    frameNodeId,
    batchId,
    batchTitle: "Agent 多资产矩阵 smoke",
    request: "用同一个模特分别展示两件外套，每件外套在雪山和咖啡厅两个场景各做一张。",
    userRequest: "用同一个模特分别展示两件外套，每件外套在雪山和咖啡厅两个场景各做一张。",
    outputType: "multi_product_multi_scene_model_showcase",
    requiredReferenceRoles: ["product"],
    referenceContext: {
      version: 1,
      source: "canvas-workbench",
      targetNodeId: frameNodeId,
      images: [
        referenceImage("product", "银色羽绒服", "product_coat_silver", dataUrl("product-a")),
        referenceImage("product", "黑色冲锋衣", "product_jacket_black", dataUrl("product-b")),
        referenceImage("model", "固定模特", "model_fixed_01", dataUrl("model")),
        referenceImage("scene", "雪山外景", "scene_snow_01", dataUrl("scene-snow")),
        referenceImage("scene", "咖啡厅室内", "scene_cafe_01", dataUrl("scene-cafe")),
      ],
      roles: {
        product: roleContext("product", "商品资产", ["真实商品身份必须分别锁定，不要把两件衣服合成一件。"]),
        model: roleContext("model", "模特资产", ["同一个模特身份贯穿全组，但动作和神态可以变化。"]),
        scene: roleContext("scene", "场景资产", ["每张图只使用一个场景，场景之间不要混合。"]),
      },
      promptFragments: [],
      constraints: [],
      negativeRules: [],
      qualityRules: ["商品、模特、场景三类参考要分工明确。"],
    },
    enqueue: false,
    items: [
      matrixItem("look_01", "银色羽绒服 · 雪山", "雪山自然光下的模特展示图。"),
      matrixItem("look_02", "黑色冲锋衣 · 雪山", "雪山自然光下的模特展示图。"),
      matrixItem("look_03", "银色羽绒服 · 咖啡厅", "咖啡厅室内自然抓拍。"),
      matrixItem("look_04", "黑色冲锋衣 · 咖啡厅", "咖啡厅室内自然抓拍。"),
    ],
  };
}

function matrixItem(itemId, title, prompt) {
  return {
    itemId,
    title,
    type: "model_product_scene",
    ratio: "3:2",
    size: "1536x1024",
    copyText: "",
    prompt,
    referenceRoles: ["product", "model", "scene"],
    providerReferenceRoles: ["product", "model", "scene"],
    metadata: {
      smoke: "agent-plan-matrix",
    },
  };
}

function referenceImage(role, title, assetId, url) {
  return {
    role,
    title,
    url,
    providerUsable: true,
    assetId,
    nodeId: `${assetId}_node`,
  };
}

function roleContext(role, title, constraints = []) {
  return {
    role,
    title,
    sourceNodeIds: [],
    componentIds: [],
    assetIds: [],
    promptFragments: [],
    constraints,
    negativeRules: [],
    qualityRules: [],
  };
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
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status} from ${url}: ${JSON.stringify(payload)}`
    );
  }
  return payload;
}

async function waitForServer(url) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 45000) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
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

function dataUrl(label) {
  return `data:image/png;base64,${Buffer.from(`image-master-${label}`).toString("base64")}`;
}

function cleanupSmokeRows() {
  const db = new Database(path.join(process.cwd(), ".data", "image-master.db"));
  try {
    db.pragma("foreign_keys = ON");
    const cleanup = db.transaction(() => {
      db.prepare(
        "DELETE FROM generated_artifacts WHERE workflowId = ? OR batchId = ? OR json_extract(metadata, '$.batchId') = ?"
      ).run(workflowId, batchId, batchId);
      db.prepare(
        "DELETE FROM assets WHERE json_extract(metadata, '$.workflowId') = ? OR json_extract(metadata, '$.batchId') = ?"
      ).run(workflowId, batchId);
      db.prepare(
        "DELETE FROM generation_jobs WHERE workflowId = ? OR batchId = ? OR json_extract(metadata, '$.batchId') = ?"
      ).run(workflowId, batchId, batchId);
      db.prepare("DELETE FROM project_batches WHERE id = ?").run(batchId);
      db.prepare("DELETE FROM workflows WHERE id = ?").run(workflowId);
    });
    cleanup();
  } finally {
    db.close();
  }
}
