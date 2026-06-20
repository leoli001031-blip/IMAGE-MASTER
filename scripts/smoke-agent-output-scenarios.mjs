#!/usr/bin/env node

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import { seedCommercialComponents } from "./seed-commercial-components.mjs";
import { stopSmokeServer } from "./smoke-runtime.mjs";

const port = Number(process.env.AGENT_OUTPUT_SCENARIOS_PORT || 3514);
const externalBaseUrl = process.env.AGENT_OUTPUT_SCENARIOS_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const workflowPrefix = `smoke_agent_output_${stamp}`;
const outDir = path.join(process.cwd(), "test_artifacts", "api-smoke", `agent-output-scenarios-${stamp}`);
const reportPath = path.join(outDir, "report.json");
const distDir = process.env.AGENT_OUTPUT_SCENARIOS_DIST_DIR ||
  path.join(".next-smoke", `agent-output-scenarios-${stamp}`);
const sourceFileSnapshots = shouldSpawnServer
  ? snapshotSourceFiles(["tsconfig.json", "next-env.d.ts"])
  : [];
const requestTimeoutMs = Number(process.env.AGENT_OUTPUT_SCENARIOS_TIMEOUT_MS || 600000);
const maxPreviewItems = Number(process.env.AGENT_OUTPUT_SCENARIOS_MAX_PREVIEW_ITEMS || 3);
const maxMatrixItems = Number(process.env.AGENT_OUTPUT_SCENARIOS_MAX_MATRIX_ITEMS || 4);
const scenarioIdsFilter = (process.env.AGENT_OUTPUT_SCENARIO_IDS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

let server;
let serverOutput = "";
const createdWorkflowIds = [];
const issues = [];

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      WATCHPACK_POLLING: process.env.WATCHPACK_POLLING || "true",
      NEXT_DIST_DIR: distDir,
      // Important: no mock env here. We want the real text Agent/prompt route
      // when a text key is configured, but every generation plan uses enqueue:false,
      // so image generation jobs are never started.
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
  await fs.mkdir(outDir, { recursive: true });
  await waitForServer(`${baseUrl}/api/settings`);
  const settings = await requestJson(`${baseUrl}/api/settings`);
  const seedSummary = await seedCommercialComponents({ baseUrl });

  const scenarioRunners = [
    scenarioRunner(buildTaobaoCopyScenario().id, () => runComposedCommerceScenario(buildTaobaoCopyScenario())),
    scenarioRunner(buildAmazonScenario().id, () => runComposedCommerceScenario(buildAmazonScenario())),
    scenarioRunner("multi_clothes_single_model_multi_scene", runMatrixScenario),
    scenarioRunner("text_only_scene_style_asset", runTextOnlyAssetScenario),
    scenarioRunner(buildModelReferenceAssetProject().id, () => runReferenceAssetProjectScenario(buildModelReferenceAssetProject())),
    scenarioRunner(buildStyleReferenceAssetProject().id, () => runReferenceAssetProjectScenario(buildStyleReferenceAssetProject())),
    scenarioRunner("missing_product_reference_guard", runMissingProductGuardScenario),
  ];
  const selectedRunners = scenarioIdsFilter.length > 0
    ? scenarioIdsFilter.map((id) => {
        const runner = scenarioRunners.find((item) => item.id === id);
        if (!runner) throw new Error(`Unknown scenario id: ${id}`);
        return runner;
      })
    : scenarioRunners;
  const reports = [];
  for (let index = 0; index < selectedRunners.length; index += 1) {
    const runner = selectedRunners[index];
    const started = Date.now();
    console.log(`Running scenario ${index + 1}/${selectedRunners.length}: ${runner.id}`);
    const report = await runner.run();
    reports.push(report);
    console.log(
      `Finished scenario ${index + 1}/${selectedRunners.length}: ${runner.id}; jobs=${report.jobCount ?? "n/a"}; elapsed=${Math.round((Date.now() - started) / 1000)}s`
    );
  }

  const report = {
    ok: issues.length === 0,
    baseUrl,
    generatedAt: new Date().toISOString(),
    imageGenerationStarted: false,
    note: "This suite intentionally uses generation-plans/run with enqueue:false; jobs are created as pending planning artifacts only, then cleaned up.",
    settings: {
      hasTextKey: settings.hasTextKey,
      textModel: settings.textModel,
      textBaseUrlHost: safeHost(settings.textBaseUrl || settings.baseUrl),
      hasImageKey: settings.hasImageKey,
      imageModel: settings.imageModel,
    },
    seedSummary,
    scenarios: reports,
    issues,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  if (issues.length > 0) {
    throw new Error(`Agent output scenario checks found ${issues.length} issue(s). Report: ${reportPath}`);
  }

  console.log(
    [
      `Agent output scenario smoke passed on ${baseUrl}.`,
      `Scenarios: ${reports.length}; image generation started: false.`,
      `Report: ${reportPath}`,
    ].join("\n")
  );
} catch (error) {
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-5000));
  }
  process.exitCode = 1;
} finally {
  await cleanupCreatedRows().catch(() => {});
  if (server) await stopSmokeServer(server);
  if (shouldSpawnServer && process.env.AGENT_OUTPUT_SCENARIOS_KEEP_DIST !== "1") {
    await fs.rm(distDir, { recursive: true, force: true }).catch(() => {});
  }
  restoreSourceFiles(sourceFileSnapshots);
}

function scenarioRunner(id, run) {
  return { id, run };
}

function snapshotSourceFiles(files) {
  return files.map((file) => ({
    file,
    exists: fsSync.existsSync(file),
    contents: fsSync.existsSync(file) ? fsSync.readFileSync(file, "utf8") : "",
  }));
}

function restoreSourceFiles(snapshots) {
  for (const snapshot of snapshots) {
    if (snapshot.exists) {
      fsSync.writeFileSync(snapshot.file, snapshot.contents);
    } else {
      fsSync.rmSync(snapshot.file, { force: true });
    }
  }
}

async function runComposedCommerceScenario(scenario) {
  const workflowId = `${workflowPrefix}_${scenario.id}`;
  createdWorkflowIds.push(workflowId);
  const compose = await requestJson(`${baseUrl}/api/workflow-compose`, {
    method: "POST",
    body: JSON.stringify({
      brief: scenario.brief,
      scenario: scenario.scenario,
      productTitle: scenario.productTitle,
      productDescription: scenario.productDescription,
      platforms: scenario.platforms,
      outputPacks: scenario.outputPacks,
      copyRenderMode: scenario.copyRenderMode,
      previewPlan: true,
      saveWorkflow: false,
    }),
  });
  const planPreview = compose.planPreview;
  if (!planPreview?.items?.length) {
    addIssue(scenario.id, "compose", "workflow-compose did not return planPreview items");
  }
  const items = planPreview.items.map((item, index) => buildRunItemFromPreview(item, scenario, index));
  const sampledItems = items.slice(0, maxPreviewItems);
  const run = await requestJson(`${baseUrl}/api/generation-plans/run`, {
    method: "POST",
    body: JSON.stringify({
      workflowId,
      frameNodeId: `${workflowId}_frame`,
      batchId: `${workflowId}_batch`,
      batchTitle: scenario.title,
      request: scenario.brief,
      userRequest: scenario.brief,
      productTitle: scenario.productTitle,
      platforms: scenario.platforms,
      outputPacks: scenario.outputPacks,
      copyRenderMode: scenario.copyRenderMode,
      requiredReferenceRoles: ["product"],
      referenceContext: buildReferenceContext(`${workflowId}_ref`, scenario.referenceRoles),
      enqueue: false,
      items: sampledItems,
    }),
  }, 201);

  const summary = summarizeRun(scenario, compose, run);
  validateCommonNoImageRun(scenario, run, sampledItems.length);
  validateSkill(scenario, summary);
  validateCopyPolicy(scenario, run);
  validateReferenceRouting(scenario, run);
  validatePromptShape(scenario, run);
  return summary;
}

async function runMatrixScenario() {
  const scenario = {
    id: "multi_clothes_single_model_multi_scene",
    title: "多衣服 + 单模特 + 多场景矩阵",
    expectedSkillIds: ["workflow.model_showcase.v1"],
    brief: "用同一个模特分别展示两件衣服，每件衣服在雪山、咖啡厅、商场三个场景各出一张；每张只用一件衣服和一个场景，不要混成一张商品资产。",
    platforms: ["storefront"],
    outputPacks: ["commercial.output_pack.model_display"],
    copyRenderMode: "layout_layer",
  };
  const workflowId = `${workflowPrefix}_${scenario.id}`;
  createdWorkflowIds.push(workflowId);
  const items = [
    matrixItem("silver_snow", "银色羽绒服 · 雪山", "银色羽绒服在雪山自然光下的同模特展示。"),
    matrixItem("black_snow", "黑色冲锋衣 · 雪山", "黑色冲锋衣在雪山自然光下的同模特展示。"),
    matrixItem("silver_cafe", "银色羽绒服 · 咖啡厅", "银色羽绒服在咖啡厅室内自然抓拍。"),
    matrixItem("black_cafe", "黑色冲锋衣 · 咖啡厅", "黑色冲锋衣在咖啡厅室内自然抓拍。"),
    matrixItem("silver_mall", "银色羽绒服 · 商场", "银色羽绒服在商场橱窗环境的自然展示。"),
    matrixItem("black_mall", "黑色冲锋衣 · 商场", "黑色冲锋衣在商场橱窗环境的自然展示。"),
  ].slice(0, maxMatrixItems);
  const run = await requestJson(`${baseUrl}/api/generation-plans/run`, {
    method: "POST",
    body: JSON.stringify({
      workflowId,
      frameNodeId: `${workflowId}_frame`,
      batchId: `${workflowId}_batch`,
      batchTitle: scenario.title,
      request: scenario.brief,
      userRequest: scenario.brief,
      outputType: "single_model_multi_product_multi_scene",
      platforms: scenario.platforms,
      outputPacks: scenario.outputPacks,
      copyRenderMode: scenario.copyRenderMode,
      requiredReferenceRoles: ["product"],
      referenceContext: buildMatrixReferenceContext(`${workflowId}_ref`),
      enqueue: false,
      items,
    }),
  }, 201);
  const summary = summarizeRun(scenario, undefined, run);
  validateCommonNoImageRun(scenario, run, items.length);
  validateMatrixSeparation(scenario, run);
  validatePromptShape(scenario, run);
  return summary;
}

async function runTextOnlyAssetScenario() {
  const scenario = {
    id: "text_only_scene_style_asset",
    title: "文字生成场景/风格资产",
    brief: "生成一个北欧家居自然光场景资产和柔和生活方式拍摄风格参考，不上传商品图；这是参考资产，不是真实商品成片。",
  };
  const workflowId = `${workflowPrefix}_${scenario.id}`;
  createdWorkflowIds.push(workflowId);
  const run = await requestJson(`${baseUrl}/api/generation-plans/run`, {
    method: "POST",
    body: JSON.stringify({
      workflowId,
      frameNodeId: `${workflowId}_frame`,
      batchId: `${workflowId}_batch`,
      batchTitle: scenario.title,
      request: scenario.brief,
      userRequest: scenario.brief,
      outputType: "scene_style_asset",
      requiredReferenceRoles: [],
      referenceContext: {
        version: 1,
        source: "canvas-workbench",
        targetNodeId: `${workflowId}_frame`,
        images: [],
        roles: {
          scene: roleContext("scene", "北欧家居场景需求", ["自然窗光、浅色木质、真实室内尺度"]),
          style: roleContext("style", "柔和生活方式风格", ["真实照片质感、低商业合成感"]),
        },
        promptFragments: ["参考资产生成，不是最终商品成片。"],
        constraints: [],
        negativeRules: [],
        qualityRules: ["资产应可复用于后续商品入景。"],
      },
      enqueue: false,
      items: [
        {
          itemId: "scene_asset_01",
          title: "北欧家居自然光场景资产",
          type: "scene_asset",
          ratio: "3:2",
          size: "1536x1024",
          prompt: "生成一张可复用的北欧家居自然光场景参考图。",
          copyText: "",
          referenceRoles: ["scene", "style"],
          providerReferenceRoles: [],
        },
      ],
    }),
  }, 201);
  const summary = summarizeRun(scenario, undefined, run);
  validateCommonNoImageRun(scenario, run, 1);
  validateReferenceAssetSkill(scenario, summary);
  if (run.plan?.productReferenceGuard?.hasProviderUsableRealProductImage) {
    addIssue(scenario.id, "product_guard", "text-only asset scenario should not behave like a real product-locked output");
  }
  const providerRoles = getJobProviderRoles(run.jobs?.[0] ?? {});
  if (providerRoles.includes("product")) {
    addIssue(scenario.id, "reference_routing", "text-only scene/style asset unexpectedly routed product as provider input");
  }
  return summary;
}

async function runReferenceAssetProjectScenario(scenario) {
  const workflowId = `${workflowPrefix}_${scenario.id}`;
  createdWorkflowIds.push(workflowId);
  const compose = await requestJson(`${baseUrl}/api/workflow-compose`, {
    method: "POST",
    body: JSON.stringify({
      brief: scenario.brief,
      scenario: scenario.scenario,
      platforms: ["asset_library"],
      outputPacks: ["commercial.output_pack.reference_assets"],
      copyRenderMode: "metadata_only",
      previewPlan: true,
      saveWorkflow: false,
    }),
  });
  const planPreview = compose.planPreview;
  if (planPreview?.agentPlan?.skillId !== "workflow.reference_asset.v1") {
    addIssue(scenario.id, "skill_selection", `workflow-compose expected reference asset skill, got ${planPreview?.agentPlan?.skillId}`);
  }
  const items = scenario.items.map((item, index) => ({
    itemId: `${scenario.id}_${index + 1}`,
    ...item,
  }));
  const run = await requestJson(`${baseUrl}/api/generation-plans/run`, {
    method: "POST",
    body: JSON.stringify({
      workflowId,
      frameNodeId: `${workflowId}_frame`,
      batchId: `${workflowId}_batch`,
      batchTitle: scenario.title,
      request: scenario.brief,
      userRequest: scenario.brief,
      outputType: scenario.outputType,
      platforms: ["asset_library"],
      outputPacks: ["commercial.output_pack.reference_assets"],
      copyRenderMode: "metadata_only",
      requiredReferenceRoles: [],
      referenceContext: scenario.referenceContext,
      enqueue: false,
      items,
    }),
  }, 201);
  const summary = summarizeRun(scenario, compose, run);
  validateCommonNoImageRun(scenario, run, items.length);
  validateReferenceAssetSkill(scenario, summary);
  validatePromptShape(scenario, run);
  for (const job of run.jobs ?? []) {
    const providerRoles = getJobProviderRoles(job);
    if (providerRoles.includes("product")) {
      addIssue(scenario.id, "reference_routing", `${job.metadata?.planItemTitle} unexpectedly routed product reference`);
    }
  }
  return summary;
}

async function runMissingProductGuardScenario() {
  const scenario = {
    id: "missing_product_reference_guard",
    title: "真实商品缺参考图拦截",
  };
  const workflowId = `${workflowPrefix}_${scenario.id}`;
  createdWorkflowIds.push(workflowId);
  const payload = await requestJson(`${baseUrl}/api/generation-plans/run`, {
    method: "POST",
    body: JSON.stringify({
      workflowId,
      frameNodeId: `${workflowId}_frame`,
      batchId: `${workflowId}_batch`,
      request: "给真实商品做淘宝主图，必须锁定商品外观，但当前只提供文字参数。",
      userRequest: "给真实商品做淘宝主图，必须锁定商品外观，但当前只提供文字参数。",
      requiredReferenceRoles: ["product"],
      referenceContext: {
        version: 1,
        source: "canvas-workbench",
        targetNodeId: `${workflowId}_frame`,
        images: [],
        roles: {
          product: {
            ...roleContext("product", "文字商品参数", ["真实商品身份必须锁定"]),
            parameters: { color: "black", material: "nylon" },
            promptFragments: ["一只黑色尼龙通勤包"],
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
          itemId: "real_product_main_without_image",
          title: "真实商品主图",
          type: "product_hero",
          ratio: "1:1",
          size: "1024x1024",
          prompt: "生成真实商品主图。",
          referenceRoles: ["product"],
          providerReferenceRoles: ["product"],
        },
      ],
    }),
  }, 400);
  if (payload.code !== "PRODUCT_REFERENCE_REQUIRED") {
    addIssue(scenario.id, "product_guard", `expected PRODUCT_REFERENCE_REQUIRED, got ${payload.code || payload.error}`);
  }
  return {
    id: scenario.id,
    title: scenario.title,
    expectedBlocked: true,
    blocked: payload.code === "PRODUCT_REFERENCE_REQUIRED",
    issues: payload.issues ?? [],
    productReferenceGuard: payload.productReferenceGuard,
  };
}

function buildModelReferenceAssetProject() {
  return {
    id: "model_reference_asset_project",
    title: "模特参考素材小项目",
    scenario: "model_asset",
    outputType: "model_asset",
    brief: "生成一个甜妹系亚裔模特参考素材，用于后续包包和服装展示；这是素材资产，不是最终成片。要求自然漫反射光、低对比、神态不要锁死。",
    referenceContext: {
      version: 1,
      source: "canvas-workbench",
      targetNodeId: "model_reference_asset_frame",
      images: [],
      roles: {
        model: roleContext("model", "甜妹系亚裔模特素材需求", [
          "自然漫反射光，低对比，年轻但不过度幼态。",
          "用于下游合成时只锁身份，不锁表情和姿势。",
        ]),
      },
      promptFragments: ["参考素材生成，不是最终商品成片。"],
      constraints: [],
      negativeRules: ["避免证件照、棚拍强眼神光、僵硬模卡表情。"],
      qualityRules: ["需要适合后续拖入生成框作为模特参考。"],
    },
    items: [
      {
        title: "甜妹系自然模特身份参考",
        type: "model_asset",
        ratio: "3:2",
        size: "1536x1024",
        prompt: "生成一张可复用的甜妹系亚裔女性模特身份参考，柔和漫反射光、低对比、自然神态。",
        copyText: "",
        referenceRoles: ["model"],
        providerReferenceRoles: [],
      },
    ],
  };
}

function buildStyleReferenceAssetProject() {
  return {
    id: "style_reference_asset_project",
    title: "拍摄风格参考小项目",
    scenario: "style_asset",
    outputType: "style_asset",
    brief: "生成一个真实街拍感的拍摄风格参考素材，用于后续产品和模特图；不要生成具体商品成片，不要烧文案。",
    referenceContext: {
      version: 1,
      source: "canvas-workbench",
      targetNodeId: "style_reference_asset_frame",
      images: [],
      roles: {
        style: roleContext("style", "真实街拍摄影风格", [
          "自然可用光，轻微环境杂讯，真实镜头压缩感。",
          "控制廉价电商合成感，保留生活抓拍质感。",
        ]),
      },
      promptFragments: ["风格资产只用于拍摄语言，不指定未来商品或人物身份。"],
      constraints: [],
      negativeRules: ["不要文字、水印、平台 UI、过度棚拍修图。"],
      qualityRules: ["后续可作为风格参考拖入不同项目。"],
    },
    items: [
      {
        title: "真实街拍商业风格参考",
        type: "style_asset",
        ratio: "3:2",
        size: "1536x1024",
        prompt: "生成一张真实街拍感拍摄风格参考图，强调自然可用光、生活化背景、轻微不完美细节和商业质感。",
        copyText: "",
        referenceRoles: ["style"],
        providerReferenceRoles: [],
      },
    ],
  };
}

function buildTaobaoCopyScenario() {
  return {
    id: "taobao_product_copy_pack",
    title: "淘宝详情 + 海报 + 文案",
    brief: "给一只粉白毛绒小包做淘宝详情页和活动海报样张，要有商品主图、材质细节、模特背包、室内外场景、卖点带字海报；文案短句可以直接进图，长文案保留为图层。",
    scenario: "product_detail_page",
    productTitle: "粉白毛绒小包",
    productDescription: "Soft pink and ivory plush handbag with rounded handle, brass hardware and compact daily-carry capacity.",
    platforms: ["taobao", "xiaohongshu"],
    outputPacks: ["commercial.output_pack.taobao_detail"],
    copyRenderMode: "burn_in",
    referenceRoles: ["product", "model", "scene", "style", "copy"],
    expectedSkillIds: ["workflow.taobao_detail.v1"],
    expectedProviderRoles: ["product"],
    expectCopyModes: ["burn_in"],
    expectMixedRatios: true,
    copyText: [
      "标题：软萌轻巧，出门刚好",
      "卖点：绒感触面，圆润手柄",
      "卖点：小身材，大容量",
      "导出文案：适合淘宝详情首屏和小红书封面说明",
      "禁止：不要写真皮、官方联名、100%防水",
    ].join("\n"),
  };
}

function buildAmazonScenario() {
  return {
    id: "amazon_listing_no_burn_in",
    title: "Amazon Listing 无字合规",
    brief: "给一款无线蓝牙鼠标做 Amazon listing 样张，包含白底主图、尺寸图、信息图、生活方式图；默认文案不要烧进图片。",
    scenario: "amazon_listing",
    productTitle: "ErgoLite 蓝牙鼠标",
    productDescription: "Matte black ergonomic wireless mouse with side buttons, USB-C charging, and soft rubber grip.",
    platforms: ["amazon"],
    outputPacks: ["commercial.output_pack.amazon_main"],
    copyRenderMode: "layout_layer",
    referenceRoles: ["product", "scene", "style", "copy"],
    expectedSkillIds: ["workflow.amazon_listing.v1"],
    expectedProviderRoles: ["product"],
    forbiddenProviderRoles: ["model", "copy"],
    expectCopyModes: ["layout_layer"],
    expectRatios: ["1:1"],
    copyText: [
      "标题：Ergonomic Wireless Mouse",
      "卖点：USB-C rechargeable",
      "卖点：Quiet click",
      "参数：2.4GHz + Bluetooth dual mode",
      "禁止：不要写 Best Seller、FDA、官方认证",
    ].join("\n"),
  };
}

function buildRunItemFromPreview(item, scenario, index) {
  const slot = item.slot || item.id || `slot_${index + 1}`;
  const textSlot = /feature|info|cover|poster|banner|closing|save|卖点|封面|海报|横幅|收尾/i.test(slot);
  return {
    itemId: `${scenario.id}_${slot}_${index + 1}`,
    title: item.title,
    type: slot,
    ratio: item.ratio,
    size: item.size,
    prompt: [item.purpose, scenario.brief].filter(Boolean).join("。"),
    copyText: textSlot ? scenario.copyText : "",
    textAllowed: textSlot,
    copyRenderMode: textSlot ? scenario.copyRenderMode : "layout_layer",
  };
}

function matrixItem(itemId, title, prompt) {
  return {
    itemId,
    title,
    type: "model_product_scene",
    ratio: "3:2",
    size: "1536x1024",
    prompt,
    copyText: "",
    referenceRoles: ["product", "model", "scene"],
    providerReferenceRoles: ["product", "model", "scene"],
  };
}

function buildReferenceContext(prefix, roles) {
  const images = [];
  const roleMap = {};
  for (const role of roles) {
    roleMap[role] = roleContext(role, roleTitle(role), roleConstraints(role));
    if (role !== "copy") {
      images.push(referenceImage(role, roleTitle(role), `${prefix}_${role}`, dataUrl(`${prefix}_${role}`)));
    }
  }
  if (roleMap.copy) {
    roleMap.copy.promptFragments = [
      "Visible image copy candidates: 软萌轻巧，出门刚好 | 小身材，大容量",
      "Export-only copy notes: 适合详情页分屏说明和社媒标题",
    ];
    roleMap.copy.negativeRules = [
      "Forbidden copy claim: 不要写真皮、官方联名、100%防水",
    ];
  }
  return {
    version: 1,
    source: "canvas-workbench",
    targetNodeId: `${prefix}_frame`,
    images,
    roles: roleMap,
    promptFragments: [],
    constraints: [],
    negativeRules: [],
    qualityRules: ["商品、模特、场景、风格、文案职责必须分离。"],
  };
}

function buildMatrixReferenceContext(prefix) {
  return {
    version: 1,
    source: "canvas-workbench",
    targetNodeId: `${prefix}_frame`,
    images: [
      referenceImage("product", "银色羽绒服", `${prefix}_product_silver`, dataUrl(`${prefix}_product_silver`)),
      referenceImage("product", "黑色冲锋衣", `${prefix}_product_black`, dataUrl(`${prefix}_product_black`)),
      referenceImage("model", "固定模特", `${prefix}_model`, dataUrl(`${prefix}_model`)),
      referenceImage("scene", "雪山外景", `${prefix}_scene_snow`, dataUrl(`${prefix}_scene_snow`)),
      referenceImage("scene", "咖啡厅室内", `${prefix}_scene_cafe`, dataUrl(`${prefix}_scene_cafe`)),
      referenceImage("scene", "商场橱窗", `${prefix}_scene_mall`, dataUrl(`${prefix}_scene_mall`)),
    ],
    roles: {
      product: roleContext("product", "两件独立服装商品", ["每张图只调用一件衣服，不能把两件衣服混成一个商品。"]),
      model: roleContext("model", "固定模特", ["同一个模特身份贯穿全组，动作可以变化。"]),
      scene: roleContext("scene", "三个独立场景", ["每张图只调用一个场景，不能混合雪山、咖啡厅、商场。"]),
    },
    promptFragments: [],
    constraints: [],
    negativeRules: [],
    qualityRules: ["矩阵必须是一件商品 x 一个场景 x 同一模特。"],
  };
}

function referenceImage(role, title, assetId, url) {
  return {
    role,
    title,
    url,
    providerUsable: true,
    providerMode: "provider_input",
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

function roleTitle(role) {
  return {
    product: "商品参考图",
    model: "模特参考图",
    scene: "场景参考图",
    style: "拍摄风格参考",
    copy: "结构化文案",
  }[role] || role;
}

function roleConstraints(role) {
  return {
    product: ["锁定商品形状、颜色、材质、结构、比例和关键细节。"],
    model: ["只锁同一模特身份，不复制固定神态和棚拍姿势。"],
    scene: ["负责空间、透视、光源方向、阴影和真实尺度。"],
    style: ["只负责镜头质感、色调和商业完成度。"],
    copy: ["默认作为图层和卖点结构；只有短句带字图才烧进图片。"],
  }[role] || [];
}

function summarizeRun(scenario, compose, run) {
  const selectedSkillIds = run.plan?.agentPlan?.selectedSkillIds?.length
    ? run.plan.agentPlan.selectedSkillIds
    : [compose?.planPreview?.agentPlan?.skillId].filter(Boolean);
  return {
    id: scenario.id,
    title: scenario.title,
    selectedSkillIds,
    agentSummary: run.plan?.agentPlan?.summary,
    composePreview: compose?.planPreview
      ? {
          title: compose.planPreview.title,
          estimatedCount: compose.planPreview.estimatedCount,
          skillId: compose.planPreview.agentPlan?.skillId,
          copyPolicy: compose.planPreview.agentPlan?.copyPolicy,
          items: compose.planPreview.items.map((item) => ({
            title: item.title,
            slot: item.slot,
            ratio: item.ratio,
            size: item.size,
            purpose: item.purpose,
          })),
        }
      : undefined,
    jobCount: run.jobs?.length ?? 0,
    providerCallEstimate: run.estimate?.providerCallCount,
    productReferenceGuard: run.plan?.productReferenceGuard,
    jobs: (run.jobs ?? []).map((job) => ({
      title: job.metadata?.planItemTitle,
      type: job.metadata?.planItemType,
      ratio: job.metadata?.ratio,
      size: job.metadata?.size,
      prompt: job.prompt || "",
      promptPreview: (job.prompt || "").slice(0, 260),
      providerPromptWriter: job.metadata?.providerPromptWriter,
      copyRenderPolicy: job.metadata?.itemMetadata?.copyRenderPolicy ?? job.metadata?.copyRenderPolicy,
      referenceRoles: job.metadata?.itemReferenceRoles,
      providerReferenceRoles: job.metadata?.itemProviderReferenceRoles,
      assetInvocationPlanner: job.metadata?.assetInvocationPlanner,
      providerUsableRoles: getJobProviderRoles(job),
      promptOnlyRoles: getJobPromptOnlyRoles(job),
      agentAssetGroupIds: job.metadata?.agentAssetGroupIds,
      agentMatrixItem: job.metadata?.agentMatrixItem,
    })),
  };
}

function validateCommonNoImageRun(scenario, run, expectedJobs) {
  if (run.queued !== false) addIssue(scenario.id, "queue", "run unexpectedly queued jobs");
  if ((run.jobs ?? []).length !== expectedJobs) {
    addIssue(scenario.id, "job_count", `expected ${expectedJobs} pending jobs, got ${(run.jobs ?? []).length}`);
  }
  for (const job of run.jobs ?? []) {
    if (job.status !== "pending") addIssue(scenario.id, "job_status", `${job.metadata?.planItemTitle} status is ${job.status}, expected pending`);
    if (job.resultUrl) addIssue(scenario.id, "image_generation", `${job.metadata?.planItemTitle} already has resultUrl`);
    validateJobAssetInvocationPlan(scenario, job);
  }
}

function validateJobAssetInvocationPlan(scenario, job) {
  const title = job.metadata?.planItemTitle || "Untitled job";
  const plan = job.metadata?.assetInvocationPlan;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    addIssue(scenario.id, "asset_invocation", `${title} missing assetInvocationPlan`);
    return;
  }
  if (!Array.isArray(plan.decisions) || plan.decisions.length === 0) {
    addIssue(scenario.id, "asset_invocation", `${title} assetInvocationPlan has no decisions`);
    return;
  }

  const itemProviderRoles = unique(getStringArray(job.metadata?.itemProviderReferenceRoles));
  const itemReferenceRoles = unique(getStringArray(job.metadata?.itemReferenceRoles));
  const planProviderRoles = unique(getStringArray(plan.providerReferenceRoles));
  if (!sameStringSet(itemProviderRoles, planProviderRoles)) {
    addIssue(
      scenario.id,
      "asset_invocation",
      `${title} provider roles mismatch: item=${itemProviderRoles.join(",") || "none"} plan=${planProviderRoles.join(",") || "none"}`
    );
  }
  const leakedAssetGroupRoles = unique(getStringArray(job.metadata?.agentAssetGroupIds)
    .map(getRoleFromAssetGroupId)
    .filter((role) => role && !itemReferenceRoles.includes(role)));
  if (leakedAssetGroupRoles.length > 0) {
    addIssue(
      scenario.id,
      "asset_invocation",
      `${title} selected unused asset group roles: ${leakedAssetGroupRoles.join(",")}`
    );
  }
  if (planProviderRoles.includes("copy")) {
    addIssue(scenario.id, "asset_invocation", `${title} assetInvocationPlan routed copy into provider input`);
  }

  const decisionsByRole = new Map();
  for (const decision of plan.decisions) {
    if (!decision || typeof decision !== "object" || Array.isArray(decision)) continue;
    const role = String(decision.role || "");
    if (!role) continue;
    decisionsByRole.set(role, decision);
    if (role === "copy" && decision.providerInput === true) {
      addIssue(scenario.id, "asset_invocation", `${title} copy decision providerInput=true`);
    }
  }
  for (const role of itemProviderRoles) {
    const decision = decisionsByRole.get(role);
    if (!decision?.providerInput) {
      addIssue(scenario.id, "asset_invocation", `${title} provider role ${role} has no providerInput decision`);
    }
  }
}

function validateSkill(scenario, summary) {
  if (!scenario.expectedSkillIds?.length) return;
  const selected = new Set(summary.selectedSkillIds);
  for (const skillId of scenario.expectedSkillIds) {
    if (!selected.has(skillId) && summary.composePreview?.skillId !== skillId) {
      addIssue(scenario.id, "skill_selection", `expected skill ${skillId}, got ${JSON.stringify([...selected])} / ${summary.composePreview?.skillId}`);
    }
  }
}

function validateReferenceAssetSkill(scenario, summary) {
  const selected = summary.selectedSkillIds ?? [];
  if (!selected.includes("workflow.reference_asset.v1")) {
    addIssue(scenario.id, "skill_selection", `expected workflow.reference_asset.v1, got ${JSON.stringify(selected)}`);
  }
  const leakedCommerceSkill = selected.find((id) =>
    id === "workflow.taobao_detail.v1" ||
    id === "workflow.amazon_listing.v1" ||
    id === "workflow.model_showcase.v1" ||
    id === "workflow.poster_campaign.v1" ||
    id === "workflow.xiaohongshu_cover.v1"
  );
  if (leakedCommerceSkill) {
    addIssue(scenario.id, "skill_selection", `reference asset project leaked commerce skill ${leakedCommerceSkill}`);
  }
}

function validateCopyPolicy(scenario, run) {
  const modes = new Set(
    (run.jobs ?? []).map((job) => job.metadata?.itemMetadata?.copyRenderPolicy?.mode ?? job.metadata?.copyRenderPolicy?.mode).filter(Boolean)
  );
  for (const mode of scenario.expectCopyModes ?? []) {
    if (!modes.has(mode)) addIssue(scenario.id, "copy_policy", `expected at least one ${mode} copy mode, got ${JSON.stringify([...modes])}`);
  }
  for (const job of run.jobs ?? []) {
    const providerRoles = getJobProviderRoles(job);
    if (providerRoles.includes("copy")) {
      addIssue(scenario.id, "copy_policy", `${job.metadata?.planItemTitle} routed copy as provider image input`);
    }
    const policy = getJobCopyPolicy(job);
    validatePromptCopyPolicy(scenario, job, policy);
  }
}

function validatePromptCopyPolicy(scenario, job, policy) {
  if (!policy?.mode) return;
  const title = job.metadata?.planItemTitle || "Untitled job";
  const prompt = job.prompt || "";
  const visibleTextPhrases = Array.isArray(policy.inImageText)
    ? policy.inImageText.map((text) => String(text).trim()).filter(Boolean)
    : [];
  if (policy.mode === "burn_in") {
    if (visibleTextPhrases.length > 0 && !visibleTextPhrases.some((text) => prompt.includes(text))) {
      addIssue(
        scenario.id,
        "copy_prompt",
        `${title} is burn_in but prompt omitted approved in-image text ${JSON.stringify(visibleTextPhrases)}`
      );
    }
    return;
  }

  if (hasRenderedCopyInstruction(prompt)) {
    addIssue(
      scenario.id,
      "copy_prompt",
      `${title} is ${policy.mode} but prompt appears to render readable copy into the image`
    );
  }
}

function hasRenderedCopyInstruction(prompt) {
  const text = String(prompt || "");
  const renderPatterns = [
    /(放置|加入|排入|渲染|显示|写入|烧入|烧进|呈现|生成).{0,16}(文案|文字|标题|卖点|参数|标签|slogan|copy)/i,
    /(文案|文字|标题|卖点|参数|标签|slogan|copy).{0,16}(放置|加入|排入|渲染|显示|写入|烧入|烧进|呈现|生成)/i,
    /标题[A-Za-z0-9一-龥]/,
    /下方一行/,
    /字体.{0,12}(白色|黑色|无衬线|衬线|字号)/,
    /字号/,
  ];
  const safePatterns = [
    /无任何.{0,12}(文案|文字|标题|卖点|参数|标签)/,
    /无.{0,8}(文案|文字|标题|卖点|参数|标签)/,
    /没有任何.{0,12}(文案|文字|标题|卖点|参数|标签)/,
    /禁止任何.{0,12}(文案|文字|标题|卖点|参数|标签)/,
    /禁止出现任何.{0,12}(文案|文字|标题|卖点|参数|标签)/,
    /禁止.{0,18}(渲染|显示|写入|烧入|烧进|生成).{0,18}(文案|文字|标题|卖点|参数|标签)/,
    /不出现任何.{0,12}(文案|文字|标题|卖点|参数|标签)/,
    /不要.{0,18}(渲染|显示|写入|烧入|烧进|生成).{0,18}(文案|文字|标题|卖点|参数|标签)/,
    /不.{0,8}(渲染|显示|写入|烧入|烧进|生成).{0,18}(文案|文字|标题|卖点|参数|标签)/,
    /不.{0,8}(出现|放置|加入).{0,18}(文案|文字|标题|卖点|参数|标签)/,
    /预留.{0,16}(留白|安全区|文案区|文字图层)/,
    /供后期.{0,12}(添加|叠加).{0,12}(文案|文字|标题|卖点|参数|标签)/,
    /适合.{0,12}(叠加|后期).{0,12}(文字|文案|图层)/,
  ];
  if (safePatterns.some((pattern) => pattern.test(text))) return false;
  return renderPatterns.some((pattern) => pattern.test(text));
}

function getJobCopyPolicy(job) {
  return job.metadata?.itemMetadata?.copyRenderPolicy ?? job.metadata?.copyRenderPolicy;
}

function validateReferenceRouting(scenario, run) {
  const ratios = new Set((run.jobs ?? []).map((job) => job.metadata?.ratio).filter(Boolean));
  if (scenario.expectMixedRatios && ratios.size < 2) {
    addIssue(scenario.id, "ratio", `expected mixed aspect ratios, got ${JSON.stringify([...ratios])}`);
  }
  for (const ratio of scenario.expectRatios ?? []) {
    if (![...ratios].every((item) => item === ratio)) {
      addIssue(scenario.id, "ratio", `expected all ratios ${ratio}, got ${JSON.stringify([...ratios])}`);
    }
  }
  for (const job of run.jobs ?? []) {
    const providerRoles = getJobProviderRoles(job);
    for (const role of scenario.expectedProviderRoles ?? []) {
      if (!providerRoles.includes(role)) {
        addIssue(scenario.id, "reference_routing", `${job.metadata?.planItemTitle} missing provider role ${role}; got ${providerRoles.join(",")}`);
      }
    }
    for (const role of scenario.forbiddenProviderRoles ?? []) {
      if (providerRoles.includes(role)) {
        addIssue(scenario.id, "reference_routing", `${job.metadata?.planItemTitle} should not provider-route ${role}; got ${providerRoles.join(",")}`);
      }
    }
  }
}

function validateMatrixSeparation(scenario, run) {
  const plan = run.plan?.agentPlan;
  const productGroups = (plan?.assetGroups ?? []).filter((group) => group.role === "product" && group.available);
  const sceneGroups = (plan?.assetGroups ?? []).filter((group) => group.role === "scene" && group.available);
  if (productGroups.length !== 2) addIssue(scenario.id, "matrix", `expected 2 product groups, got ${productGroups.length}`);
  if (sceneGroups.length !== 3) addIssue(scenario.id, "matrix", `expected 3 scene groups, got ${sceneGroups.length}`);
  const groupById = new Map((plan?.assetGroups ?? []).map((group) => [group.id, group]));
  for (const job of run.jobs ?? []) {
    const matrix = job.metadata?.agentMatrixItem;
    const assetGroupIds = Array.isArray(matrix?.assetGroupIds) ? matrix.assetGroupIds : [];
    const products = assetGroupIds.filter((id) => id.startsWith("asset.product."));
    const scenes = assetGroupIds.filter((id) => id.startsWith("asset.scene."));
    const providerRoles = getJobProviderRoles(job);
    if (products.length !== 1) addIssue(scenario.id, "matrix", `${job.metadata?.planItemTitle} selected ${products.length} product groups`);
    if (scenes.length !== 1) addIssue(scenario.id, "matrix", `${job.metadata?.planItemTitle} selected ${scenes.length} scene groups`);
    for (const role of ["product", "model", "scene"]) {
      if (!providerRoles.includes(role)) {
        addIssue(scenario.id, "matrix", `${job.metadata?.planItemTitle} missing provider role ${role}; got ${providerRoles.join(",")}`);
      }
    }
    validateSelectedGroupMatchesJobTitle(scenario, job, products, groupById, "product");
    validateSelectedGroupMatchesJobTitle(scenario, job, scenes, groupById, "scene");
  }
}

function validateSelectedGroupMatchesJobTitle(scenario, job, groupIds, groupById, role) {
  const title = String(job.metadata?.planItemTitle || "");
  const expected = getExpectedMatrixCue(title, role);
  if (!expected) return;
  const selectedText = groupIds
    .map((id) => groupById.get(id))
    .filter(Boolean)
    .map((group) => `${group.title || ""} ${group.sourceKey || ""}`)
    .join(" ");
  if (!normalizeMatrixCue(selectedText).includes(normalizeMatrixCue(expected))) {
    addIssue(
      scenario.id,
      "matrix_asset_match",
      `${title} expected ${role} group to include ${expected}; got ${selectedText || "none"}`
    );
  }
}

function getExpectedMatrixCue(title, role) {
  if (role === "product") {
    if (/银色羽绒服/.test(title)) return "银色羽绒服";
    if (/黑色冲锋衣/.test(title)) return "黑色冲锋衣";
  }
  if (role === "scene") {
    if (/雪山/.test(title)) return "雪山";
    if (/咖啡厅/.test(title)) return "咖啡厅";
    if (/商场/.test(title)) return "商场";
  }
  return "";
}

function normalizeMatrixCue(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function validatePromptShape(scenario, run) {
  for (const job of run.jobs ?? []) {
    const prompt = job.prompt || "";
    if (!prompt.trim()) addIssue(scenario.id, "prompt", `${job.metadata?.planItemTitle} has empty prompt`);
    if (prompt.length > 1400) addIssue(scenario.id, "prompt", `${job.metadata?.planItemTitle} prompt too long: ${prompt.length}`);
    const title = String(job.metadata?.planItemTitle || "");
    const looksLikeModelShot = /模特|展示|街拍|上身|穿|背|拿|场景/.test(`${title} ${job.metadata?.planItemType || ""}`);
    if (looksLikeModelShot && /(眼睛看前方路面、|镜头或|或者|任选|可以看)/.test(prompt)) {
      addIssue(scenario.id, "prompt_pose", `${title} prompt still contains multiple-choice gaze/action wording`);
    }
  }
}

function getJobProviderRoles(job) {
  return unique((job.metadata?.providerReferenceAdapter?.providerUsableImages ?? []).map((image) => image.role).filter(Boolean));
}

function getJobPromptOnlyRoles(job) {
  return unique((job.metadata?.providerReferenceAdapter?.promptOnlyImages ?? []).map((image) => image.role).filter(Boolean));
}

function getRoleFromAssetGroupId(id) {
  const match = String(id || "").match(/^asset\.([a-z]+)\./);
  return match?.[1] || "";
}

function unique(values) {
  return Array.from(new Set(values));
}

function getStringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim())
    : [];
}

function sameStringSet(left, right) {
  const a = [...left].sort();
  const b = [...right].sort();
  return JSON.stringify(a) === JSON.stringify(b);
}

function addIssue(scenarioId, category, message) {
  issues.push({ scenarioId, category, message });
}

async function requestJson(url, init = {}, expectedStatus = 200) {
  const response = await requestText(url, init);
  const text = response.text;
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 240)}`);
  }
  if (response.statusCode !== expectedStatus) {
    throw new Error(`Expected ${expectedStatus}, got ${response.statusCode} from ${url}: ${JSON.stringify(payload).slice(0, 1000)}`);
  }
  return payload;
}

function requestText(url, init = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = typeof init.body === "string" || Buffer.isBuffer(init.body)
      ? init.body
      : init.body
        ? JSON.stringify(init.body)
        : undefined;
    const headers = {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    };
    if (body !== undefined && !Object.keys(headers).some((key) => key.toLowerCase() === "content-length")) {
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(
      parsed,
      {
        method: init.method || "GET",
        headers,
        timeout: requestTimeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error(`Request timed out after ${requestTimeoutMs}ms: ${url}`));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function waitForServer(url) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 60000) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server did not start at ${url}: ${lastError?.message || lastError}`);
}

async function cleanupCreatedRows() {
  const dbPath = path.join(process.cwd(), process.env.IMAGE_MASTER_DATA_DIR || ".data", "image-master.db");
  let db;
  try {
    db = new Database(dbPath);
  } catch {
    return;
  }
  const deleteJobs = db.prepare("DELETE FROM generation_jobs WHERE workflowId = ?");
  const deleteArtifacts = db.prepare("DELETE FROM generated_artifacts WHERE workflowId = ?");
  const tx = db.transaction((workflowIds) => {
    for (const workflowId of workflowIds) {
      deleteArtifacts.run(workflowId);
      deleteJobs.run(workflowId);
    }
  });
  tx(createdWorkflowIds);
  db.close();
}

function dataUrl(seed) {
  const hex = Buffer.from(seed).toString("hex").slice(0, 6).padEnd(6, "0");
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `data:image/png;base64,${tinyPng(r, g, b).toString("base64")}`;
}

function tinyPng(r, g, b) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.from([0, r, g, b, 255]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

var crcTable;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, index) => {
      let c = index;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
  }
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function safeHost(value) {
  if (!value) return "";
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}
