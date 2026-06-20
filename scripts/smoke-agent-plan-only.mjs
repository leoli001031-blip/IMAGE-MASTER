#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const port = Number(process.env.AGENT_PLAN_ONLY_SMOKE_PORT || 3526);
const externalBaseUrl = process.env.AGENT_PLAN_ONLY_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(process.cwd(), "test_artifacts", "api-smoke", `agent-plan-only-${stamp}`);
const reportPath = path.join(outDir, "report.json");
const distDir = process.env.AGENT_PLAN_ONLY_SMOKE_DIST_DIR ||
  path.join(".next-smoke", `agent-plan-only-${stamp}`);
const sourceFileSnapshots = shouldSpawnServer
  ? snapshotSourceFiles(["tsconfig.json", "next-env.d.ts"])
  : [];
let server;
let serverOutput = "";

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_DIST_DIR: distDir,
      WATCHPACK_POLLING: process.env.WATCHPACK_POLLING || "true",
      IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER: "",
      IMAGE_MASTER_ENABLE_MOCK_BATCH: "",
      IMAGE_MASTER_DISABLE_AGENT_PLAN_LLM: "",
      IMAGE_MASTER_ALLOW_AGENT_PLAN_FALLBACK: "",
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

const scenarios = [
  buildTaobaoBurnInScenario(),
  buildAmazonNoBurnScenario(),
  buildMultiProductMultiSceneScenario(),
  buildReferenceAssetScenario(),
];
const reports = [];
const issues = [];

try {
  fs.mkdirSync(outDir, { recursive: true });
  await waitForServer(`${baseUrl}/api/settings`);

  for (const [index, scenario] of scenarios.entries()) {
    console.log(`Running plan scenario ${index + 1}/${scenarios.length}: ${scenario.id}`);
    const started = Date.now();
    try {
      const response = await requestJson(`${baseUrl}/api/agent-plan`, {
        method: "POST",
        body: JSON.stringify({
          ...scenario.body,
          agentPlanMode: "llm",
        }),
      });
      const report = summarizeScenario(scenario, response, Date.now() - started);
      validateScenario(report);
      reports.push(report);
      console.log(
        `Finished ${scenario.id}: mode=${report.mode}; items=${report.itemCount}; elapsed=${Math.round(report.elapsedMs / 1000)}s`
      );
    } catch (error) {
      issues.push({
        scenarioId: scenario.id,
        category: "request",
        message: error instanceof Error ? error.message : String(error),
      });
      console.error(`Scenario failed: ${scenario.id}`);
      throw error;
    }
  }

  const report = {
    baseUrl,
    scenarios: reports,
    issues,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  if (issues.length > 0) {
    throw new Error(`Agent plan-only smoke found ${issues.length} issue(s). Report: ${reportPath}`);
  }
  console.log(`Agent plan-only smoke passed on ${baseUrl}.`);
  console.log(`Scenarios: ${reports.length}; report: ${reportPath}`);
} catch (error) {
  if (!fs.existsSync(reportPath)) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify({ baseUrl, scenarios: reports, issues }, null, 2)}\n`);
  }
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-5000));
  }
  process.exitCode = 1;
} finally {
  if (server) server.kill("SIGTERM");
  if (shouldSpawnServer && process.env.AGENT_PLAN_ONLY_SMOKE_KEEP_DIST !== "1") {
    fs.rmSync(distDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  restoreSourceFiles(sourceFileSnapshots);
}

function snapshotSourceFiles(files) {
  return files.map((file) => ({
    file,
    exists: fs.existsSync(file),
    contents: fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "",
  }));
}

function restoreSourceFiles(snapshots) {
  for (const snapshot of snapshots) {
    if (snapshot.exists) {
      fs.writeFileSync(snapshot.file, snapshot.contents);
    } else {
      fs.rmSync(snapshot.file, { force: true });
    }
  }
}

function summarizeScenario(scenario, response, elapsedMs) {
  const plan = response.agentPlan;
  return {
    id: scenario.id,
    title: scenario.title,
    elapsedMs,
    mode: plan?.summary?.mode,
    fallbackUsed: plan?.summary?.fallbackUsed,
    fallbackReason: plan?.summary?.fallbackReason,
    compositionMode: plan?.compositionMode,
    selectedSkillIds: plan?.selectedSkillIds ?? [],
    itemCount: plan?.generationMatrix?.length ?? 0,
    expectedItemCount: scenario.expectedItemCount,
    assetGroups: plan?.assetGroups ?? [],
    generationMatrix: plan?.generationMatrix ?? [],
    missingInputs: plan?.missingInputs ?? [],
  };
}

function validateScenario(report) {
  if (report.mode !== "llm_agent_plan_v1") {
    addIssue(report.id, "agent_mode", `expected llm_agent_plan_v1, got ${report.mode}`);
  }
  if (report.fallbackUsed) {
    addIssue(report.id, "agent_fallback", `fallback should be removed; reason=${report.fallbackReason || ""}`);
  }
  if (report.itemCount !== report.expectedItemCount) {
    addIssue(report.id, "item_count", `expected ${report.expectedItemCount} matrix items, got ${report.itemCount}`);
  }
  if (!Array.isArray(report.selectedSkillIds) || report.selectedSkillIds.length === 0) {
    addIssue(report.id, "skill_selection", "expected at least one selected workflow skill");
  }
  for (const item of report.generationMatrix) {
    if (!item.itemId || !Array.isArray(item.referenceRoles) || !Array.isArray(item.providerReferenceRoles)) {
      addIssue(report.id, "matrix_shape", `invalid matrix item shape: ${JSON.stringify(item)}`);
    }
    for (const role of item.providerReferenceRoles) {
      if (!item.referenceRoles.includes(role)) {
        addIssue(report.id, "reference_roles", `${item.title} provider role ${role} not included in referenceRoles`);
      }
    }
  }
  if (report.id === "multi_product_multi_scene") {
    for (const item of report.generationMatrix) {
      const productGroups = item.assetGroupIds.filter((id) => id.startsWith("asset.product."));
      const sceneGroups = item.assetGroupIds.filter((id) => id.startsWith("asset.scene."));
      if (productGroups.length !== 1) {
        addIssue(report.id, "matrix_product", `${item.title} selected ${productGroups.length} product groups`);
      }
      if (sceneGroups.length !== 1) {
        addIssue(report.id, "matrix_scene", `${item.title} selected ${sceneGroups.length} scene groups`);
      }
    }
  }
  if (report.id === "amazon_no_burn") {
    const infographic = report.generationMatrix.find((item) => item.itemId === "infographic");
    if (infographic?.copyMode !== "layout_layer") {
      addIssue(report.id, "copy_mode", `infographic copy should stay layout_layer, got ${infographic?.copyMode || "missing"}`);
    }
    if (infographic?.providerReferenceRoles?.includes("copy")) {
      addIssue(report.id, "copy_reference", "copy should not be sent as a provider reference image");
    }
  }
}

function buildTaobaoBurnInScenario() {
  const workflowId = `agent_plan_only_taobao_${stamp}`;
  return {
    id: "taobao_burn_in_copy",
    title: "淘宝详情页烧字计划",
    expectedItemCount: 3,
    body: {
      workflowId,
      frameNodeId: `${workflowId}_frame`,
      batchId: `${workflowId}_batch`,
      request: "给毛绒小包做淘宝详情页，包含主视觉、卖点图和材质细节，其中卖点图需要把短文案烧进图。",
      userRequest: "给毛绒小包做淘宝详情页，包含主视觉、卖点图和材质细节，其中卖点图需要把短文案烧进图。",
      scenario: "product_detail_page",
      platforms: ["taobao"],
      outputPacks: ["taobao_detail"],
      copyRenderMode: "burn_in",
      referenceContext: referenceContext(`${workflowId}_ref`, [
        image("product", "粉白毛绒小包", "product_plush_bag", "product-plush"),
        image("model", "甜妹模特", "model_sweet", "model-sweet"),
        image("scene", "花店街边", "scene_florist", "scene-florist"),
        image("style", "真实街拍风格", "style_street", "style-street"),
      ], {
        copy: {
          role: "copy",
          title: "详情页短文案",
          sourceNodeIds: [],
          componentIds: [],
          assetIds: [],
          promptFragments: ["软萌轻巧，出门刚好", "绒感蓬松", "小巧能装"],
          constraints: ["短文案只放安全区，不改商品本体标签。"],
          negativeRules: [],
          qualityRules: [],
        },
      }),
      items: [
        item("main", "Main", "product_model_scene", "主视觉，统一整套视觉基调。", ["product", "model", "scene", "style"], "metadata_only"),
        item("feature", "Feature", "product_feature", "卖点图，画面安全区写入短文案。", ["product", "model", "scene", "style", "copy"], "burn_in", "软萌轻巧，出门刚好"),
        item("material", "Material", "product_detail", "材质细节，展示毛绒、五金和手柄。", ["product", "scene", "style"], "metadata_only"),
      ],
    },
  };
}

function buildAmazonNoBurnScenario() {
  const workflowId = `agent_plan_only_amazon_${stamp}`;
  return {
    id: "amazon_no_burn",
    title: "Amazon 合规无字计划",
    expectedItemCount: 3,
    body: {
      workflowId,
      frameNodeId: `${workflowId}_frame`,
      batchId: `${workflowId}_batch`,
      request: "给无线鼠标做 Amazon listing 主图、信息图和尺寸图，默认不要把文字烧进图片。",
      userRequest: "给无线鼠标做 Amazon listing 主图、信息图和尺寸图，默认不要把文字烧进图片。",
      scenario: "amazon_listing",
      platforms: ["amazon"],
      outputPacks: ["amazon_main"],
      copyRenderMode: "layout_layer",
      referenceContext: referenceContext(`${workflowId}_ref`, [
        image("product", "人体工学无线鼠标", "product_mouse", "product-mouse"),
        image("scene", "办公桌面", "scene_desk", "scene-desk"),
        image("style", "干净商品摄影", "style_clean", "style-clean"),
      ], {
        copy: {
          role: "copy",
          title: "Listing 文案层",
          sourceNodeIds: [],
          componentIds: [],
          assetIds: [],
          promptFragments: ["Ergonomic Wireless Mouse", "Silent Click", "Long Battery"],
          constraints: ["作为 layout copy layer，不进入图像生成 prompt。"],
          negativeRules: [],
          qualityRules: [],
        },
      }),
      items: [
        item("white_main", "White Main", "product_hero", "白底合规主图。", ["product"], "metadata_only"),
        item("infographic", "Infographic", "product_feature", "卖点解释图，文案后期叠加。", ["product", "scene", "copy"], "layout_layer"),
        item("dimensions", "Dimensions", "product_dimensions", "尺寸和比例说明图。", ["product", "scene", "style"], "metadata_only"),
      ],
    },
  };
}

function buildMultiProductMultiSceneScenario() {
  const workflowId = `agent_plan_only_matrix_${stamp}`;
  return {
    id: "multi_product_multi_scene",
    title: "多衣服单模特多场景计划",
    expectedItemCount: 4,
    body: {
      workflowId,
      frameNodeId: `${workflowId}_frame`,
      batchId: `${workflowId}_batch`,
      request: "用同一个模特分别展示银色羽绒服和黑色冲锋衣，每件衣服在雪山和咖啡厅两个场景各做一张。",
      userRequest: "用同一个模特分别展示银色羽绒服和黑色冲锋衣，每件衣服在雪山和咖啡厅两个场景各做一张。",
      outputType: "multi_product_multi_scene_model_showcase",
      requiredReferenceRoles: ["product"],
      referenceContext: referenceContext(`${workflowId}_ref`, [
        image("product", "银色羽绒服", "product_silver_down", "product-silver"),
        image("product", "黑色冲锋衣", "product_black_shell", "product-black"),
        image("model", "固定模特", "model_fixed", "model-fixed"),
        image("scene", "雪山外景", "scene_snow", "scene-snow"),
        image("scene", "咖啡厅室内", "scene_cafe", "scene-cafe"),
      ]),
      items: [
        item("silver_snow", "银色羽绒服 · 雪山", "model_product_scene", "银色羽绒服在雪山自然光下的同模特展示。", ["product", "model", "scene"], "metadata_only"),
        item("black_snow", "黑色冲锋衣 · 雪山", "model_product_scene", "黑色冲锋衣在雪山自然光下的同模特展示。", ["product", "model", "scene"], "metadata_only"),
        item("silver_cafe", "银色羽绒服 · 咖啡厅", "model_product_scene", "银色羽绒服在咖啡厅内的同模特展示。", ["product", "model", "scene"], "metadata_only"),
        item("black_cafe", "黑色冲锋衣 · 咖啡厅", "model_product_scene", "黑色冲锋衣在咖啡厅内的同模特展示。", ["product", "model", "scene"], "metadata_only"),
      ],
    },
  };
}

function buildReferenceAssetScenario() {
  const workflowId = `agent_plan_only_reference_${stamp}`;
  return {
    id: "reference_asset_text_only",
    title: "文字生成参考资产计划",
    expectedItemCount: 1,
    body: {
      workflowId,
      frameNodeId: `${workflowId}_frame`,
      batchId: `${workflowId}_batch`,
      request: "生成一个可复用的真实街拍商业风格参考资产，不是最终成片。",
      userRequest: "生成一个可复用的真实街拍商业风格参考资产，不是最终成片。",
      scenario: "style_asset",
      outputType: "reference_asset",
      referenceContext: referenceContext(`${workflowId}_ref`, []),
      items: [
        item("style_asset", "真实街拍商业风格参考", "style_reference_asset", "自然光、街拍、真实摄影、低商业棚拍感。", ["style"], "metadata_only"),
      ],
    },
  };
}

function item(itemId, title, type, prompt, referenceRoles, copyRenderMode, copyText = "") {
  return {
    itemId,
    title,
    type,
    ratio: type.includes("hero") ? "1:1" : "3:2",
    size: type.includes("hero") ? "1024x1024" : "1536x1024",
    prompt,
    copyText,
    copyRenderMode,
    referenceRoles,
    providerReferenceRoles: referenceRoles.filter((role) => role !== "copy"),
    metadata: { smoke: "agent-plan-only" },
  };
}

function referenceContext(targetNodeId, images, roleOverrides = {}) {
  const roles = {};
  for (const role of ["product", "model", "scene", "style"]) {
    const hasRole = images.some((image) => image.role === role);
    if (!hasRole) continue;
    roles[role] = {
      role,
      title: role,
      sourceNodeIds: [],
      componentIds: [],
      assetIds: [],
      promptFragments: [],
      constraints: role === "product" ? ["商品真实身份必须锁定。"] : [],
      negativeRules: [],
      qualityRules: [],
    };
  }
  return {
    version: 1,
    source: "agent-plan-only-smoke",
    targetNodeId,
    images,
    roles: {
      ...roles,
      ...roleOverrides,
    },
    promptFragments: [],
    constraints: [],
    negativeRules: [],
    qualityRules: [],
  };
}

function image(role, title, assetId, label) {
  return {
    role,
    title,
    assetId,
    nodeId: `${assetId}_node`,
    providerUsable: true,
    url: dataUrl(label),
  };
}

function dataUrl(label) {
  return `data:image/png;base64,${Buffer.from(`image-master-${label}`).toString("base64")}`;
}

function addIssue(scenarioId, category, message) {
  issues.push({ scenarioId, category, message });
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
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 300)}`);
  }
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status} from ${url}: ${JSON.stringify(payload).slice(0, 1000)}`
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
      if (response.status === 200) return;
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
