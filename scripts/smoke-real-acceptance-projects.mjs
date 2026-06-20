#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { stopSmokeServer } from "./smoke-runtime.mjs";

const args = parseArgs(process.argv.slice(2));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const port = Number(args.port || process.env.REAL_ACCEPTANCE_PORT || 3577);
const externalBaseUrl = args.baseUrl || process.env.REAL_ACCEPTANCE_BASE_URL;
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const runRealProvider = args.real === true;
const expectedConfirmationError = args["expect-confirmation-error"] === true;
const confirmedRealProviderCalls = normalizeProviderCallConfirmation(
  args["confirm-provider-calls"] ?? process.env.REAL_ACCEPTANCE_CONFIRM_PROVIDER_CALLS
);
const agentPlanMode = String(args.mode || process.env.REAL_ACCEPTANCE_AGENT_MODE || "auto");
const outputRoot = path.join(process.cwd(), "test_artifacts", "api-smoke", `real-acceptance-projects-${stamp}`);
const reportPath = path.join(outputRoot, "report.json");

let server;
let serverOutput = "";

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      WATCHPACK_POLLING: process.env.WATCHPACK_POLLING || "true",
      IMAGE_MASTER_AGENT_PLAN_MAX_TOKENS: process.env.IMAGE_MASTER_AGENT_PLAN_MAX_TOKENS || "12000",
      IMAGE_MASTER_MAX_BATCH_IMAGES: process.env.IMAGE_MASTER_MAX_BATCH_IMAGES || "40",
      IMAGE_MASTER_JOB_CONCURRENCY: process.env.REAL_ACCEPTANCE_JOB_CONCURRENCY || "6",
      IMAGE_MASTER_JOB_LEASE_MS: process.env.IMAGE_MASTER_JOB_LEASE_MS || "900000",
      IMAGE_MASTER_QUEUE_OWNER: `real-acceptance-${Date.now()}`,
      NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || `.next-real-acceptance-${stamp}`,
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
  await fsp.mkdir(outputRoot, { recursive: true });
  await waitForServer(`${baseUrl}/api/settings`);
  const settings = await requestJson(`${baseUrl}/api/settings`);

  const projects = buildAcceptanceProjects();
  const reports = [];
  for (const project of projects) {
    reports.push(await runProjectPlan(project));
  }

  const plannedProviderCalls = reports.reduce(
    (total, entry) => total + getPlannedProviderCallCount(entry),
    0
  );
  const realProviderConfirmation = buildRealProviderConfirmation(plannedProviderCalls);
  const globalIssues = [];

  if (runRealProvider && !realProviderConfirmation.confirmed) {
    globalIssues.push(realProviderConfirmation.message);
  }

  if (runRealProvider && realProviderConfirmation.confirmed) {
    for (let index = 0; index < projects.length; index += 1) {
      await runProjectReal(projects[index], reports[index]);
    }
  }

  const report = {
    ok: globalIssues.length === 0 && reports.every((entry) => entry.ok),
    mode: runRealProvider ? "real_provider" : "plan_only",
    agentPlanMode,
    baseUrl,
    provider: summarizeProviderSettings(settings),
    projectCount: reports.length,
    expectedPerProject: 12,
    plannedProviderCalls,
    realProviderConfirmation,
    issues: globalIssues,
    reports,
  };
  await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const issues = [
    ...globalIssues,
    ...reports.flatMap((entry) => entry.issues.map((issue) => `${entry.id}: ${issue}`)),
  ];
  if (issues.length > 0) {
    if (
      expectedConfirmationError &&
      globalIssues.some((issue) => issue.includes("--confirm-provider-calls"))
    ) {
      console.log(`Provider confirmation guard passed. Report: ${reportPath}`);
      console.log(`Planned provider calls: ${plannedProviderCalls}; no image jobs were enqueued.`);
      process.exitCode = 0;
    } else {
      throw new Error(`Acceptance project smoke found ${issues.length} issue(s). Report: ${reportPath}`);
    }
  } else {
    console.log(`Real acceptance project smoke passed on ${baseUrl}.`);
    console.log(
      `Mode: ${report.mode}; Agent mode: ${agentPlanMode}; projects=${reports.length}; plannedProviderCalls=${plannedProviderCalls}; report=${reportPath}`
    );
  }
} catch (error) {
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-8000));
  }
  process.exitCode = 1;
} finally {
  await stopSmokeServer(server);
}

async function runProjectPlan(project) {
  const body = {
    ...project.body,
    agentPlanMode,
  };
  const startedAt = Date.now();
  const agentResponse = await requestJson(`${baseUrl}/api/agent-plan`, {
    method: "POST",
    body: JSON.stringify(body),
  }, 200, 120_000);

  const report = summarizeProjectPlan(project, body, agentResponse, Date.now() - startedAt);
  report.ok = report.issues.length === 0;
  return report;
}

async function runProjectReal(project, report) {
  const body = {
    ...project.body,
    agentPlanMode,
  };
  const runResponse = await requestJson(`${baseUrl}/api/generation-plans/run`, {
    method: "POST",
    body: JSON.stringify({
      ...body,
      enqueue: true,
      confirmedProviderCallLimit: body.items.length,
    }),
  }, 201, 120_000);
  report.run = summarizeRunResponse(runResponse);
  report.jobs = await waitForJobsDone(body.workflowId, body.items.length);
  report.issues.push(...validateRealRun(report.jobs, body.items.length));
  report.ok = report.issues.length === 0;
}

function summarizeProjectPlan(project, body, response, elapsedMs) {
  const matrix = response.agentPlan?.generationMatrix ?? [];
  const assetGroups = response.agentPlan?.assetGroups ?? [];
  const issues = [];

  if (response.ok !== true) issues.push(`draft validation failed: ${JSON.stringify(response.validation ?? response).slice(0, 500)}`);
  if (body.items.length !== 12) issues.push(`expected 12 requested items, got ${body.items.length}`);
  if (matrix.length !== body.items.length) issues.push(`expected ${body.items.length} matrix items, got ${matrix.length}`);
  if (response.estimate?.providerCallCount !== body.items.length) {
    issues.push(`expected providerCallCount=${body.items.length}, got ${response.estimate?.providerCallCount}`);
  }
  if (response.agentPlan?.missingInputs?.some((input) => input.blocking)) {
    issues.push(`blocking missing inputs: ${response.agentPlan.missingInputs.map((input) => input.label).join(", ")}`);
  }

  issues.push(...project.validate({ body, response, matrix, assetGroups }));

  return {
    id: project.id,
    title: project.title,
    ok: false,
    elapsedMs,
    requestedItems: body.items.length,
    matrixItems: matrix.length,
    estimate: response.estimate,
    selectedSkillIds: response.agentPlan?.selectedSkillIds ?? [],
    compositionMode: response.agentPlan?.compositionMode,
    summary: response.agentPlan?.summary,
    matrix: matrix.map((item) => ({
      itemId: item.itemId,
      title: item.title,
      type: item.type,
      ratio: item.ratio,
      size: item.size,
      referenceRoles: item.referenceRoles,
      providerReferenceRoles: item.providerReferenceRoles,
      copyMode: item.copyMode,
      status: item.status,
    })),
    issues,
  };
}

function validateRealRun(jobs, expectedCount) {
  const issues = [];
  if (jobs.length !== expectedCount) issues.push(`expected ${expectedCount} jobs, got ${jobs.length}`);
  const failed = jobs.filter((job) => job.status !== "done");
  if (failed.length > 0) issues.push(`${failed.length} job(s) did not finish done`);
  for (const job of jobs) {
    const metadata = job.metadata ?? {};
    if (!metadata.assetInvocationPlan) issues.push(`${job.id} missing assetInvocationPlan`);
    if (!metadata.copyRenderPolicy && !metadata.itemMetadata?.copyRenderPolicy) issues.push(`${job.id} missing copyRenderPolicy`);
    if (!Array.isArray(metadata.itemProviderReferenceRoles)) issues.push(`${job.id} missing itemProviderReferenceRoles`);
    if (!job.resultUrl && job.status === "done") issues.push(`${job.id} done without resultUrl`);
  }
  return issues;
}

function summarizeRunResponse(response) {
  return {
    ok: response.ok,
    queued: response.queued,
    planId: response.plan?.planId,
    jobCount: response.jobs?.length,
    estimate: response.estimate,
    providerPolicy: response.providerPolicy,
  };
}

function getPlannedProviderCallCount(report) {
  const estimated = Number(report.estimate?.providerCallCount);
  if (Number.isFinite(estimated) && estimated >= 0) return estimated;
  return Number(report.requestedItems) || 0;
}

function normalizeProviderCallConfirmation(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
}

function buildRealProviderConfirmation(plannedProviderCalls) {
  const required = Number(plannedProviderCalls) || 0;
  const confirmed =
    runRealProvider &&
    required > 0 &&
    confirmedRealProviderCalls === required;
  const hint = `Run with --confirm-provider-calls ${required} or REAL_ACCEPTANCE_CONFIRM_PROVIDER_CALLS=${required}.`;
  return {
    required,
    provided: confirmedRealProviderCalls,
    confirmed,
    requiredFlag: "--confirm-provider-calls",
    requiredEnv: "REAL_ACCEPTANCE_CONFIRM_PROVIDER_CALLS",
    hint,
    message: confirmed
      ? `Provider calls confirmed for ${required} image job(s).`
      : `Real provider mode requires exact confirmation for ${required} image job(s). ${hint}`,
  };
}

function summarizeProviderSettings(settings) {
  const imageBaseUrl = getString(settings.imageBaseUrl) || getString(settings.baseUrl);
  const textBaseUrl = getString(settings.textBaseUrl) || getString(settings.baseUrl);
  return {
    imageModel: getString(settings.imageModel),
    imageHost: getHost(imageBaseUrl),
    textModel: getString(settings.textModel),
    textHost: getHost(textBaseUrl),
  };
}

function getHost(value) {
  if (!value) return undefined;
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function getString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildAcceptanceProjects() {
  return [
    buildProductOnlyProject(),
    buildProductModelProject(),
    buildProductModelSceneCopyProject(),
  ];
}

function buildProductOnlyProject() {
  const body = buildBaseBody({
    id: "product_only",
    title: "真实验收 · 商品纯图组",
    request:
      "给真实便携浓缩咖啡机做一整套商品纯图组。只锁商品，不使用模特；需要主图、多角度、细节、卖点海报、详情页模块和横幅，部分短文案需要烧进安全区。",
    referenceContext: referenceContext("product_only", ["product", "style", "copy"]),
    items: [
      item("main_white", "白底主图", "marketplace_main", "1:1", "1024x1024", ["product"], ["product"], "纯白底完整展示商品。"),
      item("multi_view", "多角度白底图", "product_multiview", "3:2", "1536x1024", ["product"], ["product"], "正面、侧面、背面和顶部视角。"),
      item("detail_portafilter", "萃取口细节", "product_detail", "3:2", "1536x1024", ["product"], ["product"], "展示金属萃取口和按钮。"),
      item("detail_texture", "材质微距", "product_detail", "1:1", "1024x1024", ["product", "style"], ["product"], "哑光黑金属和玻璃水仓微距。"),
      item("feature_pressure", "卖点图 · 稳定压力", "product_feature", "4:5", "1024x1280", ["product", "copy"], ["product"], "安全区写入短文案：15bar 稳定萃取。", { copyText: "15bar 稳定萃取", copyMode: "burn_in" }),
      item("feature_portable", "卖点图 · 轻便随行", "product_feature", "4:5", "1024x1280", ["product", "copy"], ["product"], "安全区写入短文案：随行一杯浓缩。", { copyText: "随行一杯浓缩", copyMode: "burn_in" }),
      item("detail_page_parts", "详情页 · 结构拆解", "detail_page", "2:3", "1024x1536", ["product", "copy"], ["product"], "短标签标出水仓、粉碗、按钮。", { copyText: "水仓 / 粉碗 / 一键萃取", copyMode: "burn_in" }),
      item("scale_reference", "尺寸感说明", "product_scale", "3:2", "1536x1024", ["product"], ["product"], "和手掌、杯子形成尺寸感，但不改变商品。"),
      item("packaging", "包装陈列", "packaging", "1:1", "1024x1024", ["product", "style"], ["product"], "商品与包装盒干净陈列。"),
      item("banner_launch", "店铺横幅", "banner", "16:9", "1536x864", ["product", "style", "copy"], ["product"], "右侧留标题区，烧入新品上市。", { copyText: "新品上市", copyMode: "burn_in" }),
      item("poster_gift", "礼赠海报", "poster", "4:5", "1024x1280", ["product", "style", "copy"], ["product"], "礼赠场景海报，短标题烧入。", { copyText: "咖啡自由 随时开始", copyMode: "burn_in" }),
      item("clean_no_text", "平台无字图", "marketplace_clean", "1:1", "1024x1024", ["product"], ["product"], "无文案、无模特、无场景干扰。"),
    ],
  });

  return {
    id: "product_only",
    title: "商品纯图组",
    body,
    validate: ({ matrix }) => [
      ...expectAll(matrix, (entry) => entry.providerReferenceRoles.includes("product"), "all shots should provider-lock product"),
      ...expectNone(matrix, (entry) => entry.providerReferenceRoles.includes("model"), "product-only shots should not provider-lock model"),
      ...expectAtLeast(matrix, (entry) => entry.copyMode === "burn_in", 4, "product-only set should include burn-in copy posters/features"),
    ],
  };
}

function buildProductModelProject() {
  const body = buildBaseBody({
    id: "product_model",
    title: "真实验收 · 商品 + 模特",
    request:
      "给真实城市机能羽绒外套和同一个模特做模特展示套图。商品和模特都要锁定；不强制场景参考，重点是上身、姿态、正侧背、半身细节和平台图。",
    referenceContext: referenceContext("product_model", ["product", "model", "style", "copy"]),
    items: [
      item("front_full", "正面全身", "model_display", "2:3", "1024x1536", ["product", "model"], ["product", "model"], "同一模特穿同一件外套，正面全身。"),
      item("side_walk", "侧身走姿", "model_display", "2:3", "1024x1536", ["product", "model"], ["product", "model"], "侧身走姿，展示袖子和长度。"),
      item("back_hood", "背面帽领", "model_display", "2:3", "1024x1536", ["product", "model"], ["product", "model"], "背面轻回头，帽领和肩线清晰。"),
      item("half_zip", "半身拉链动作", "model_detail", "4:5", "1024x1280", ["product", "model"], ["product", "model"], "手部轻拉拉链，脸部自然。"),
      item("pocket_detail", "口袋动作", "model_detail", "4:5", "1024x1280", ["product", "model"], ["product", "model"], "手插口袋，展示侧边结构。"),
      item("sleeve_detail", "袖口细节", "model_detail", "1:1", "1024x1024", ["product", "model"], ["product", "model"], "袖口魔术贴和面料纹理。"),
      item("xhs_cover", "小红书封面", "social_cover", "4:5", "1024x1280", ["product", "model", "copy"], ["product", "model"], "标题安全区写入：冬天通勤不臃肿。", { copyText: "冬天通勤不臃肿", copyMode: "burn_in" }),
      item("taobao_fit", "淘宝上身效果", "taobao_main", "1:1", "1024x1024", ["product", "model"], ["product", "model"], "上身效果主图，商品轮廓清楚。"),
      item("gesture_open", "敞开领口", "model_display", "2:3", "1024x1536", ["product", "model"], ["product", "model"], "模特轻扶领口，姿态自然。"),
      item("sitting_pose", "坐姿展示", "model_display", "4:5", "1024x1280", ["product", "model"], ["product", "model"], "坐姿展示外套体积和长度。"),
      item("turning_pose", "转身动态", "model_display", "3:2", "1536x1024", ["product", "model"], ["product", "model"], "转身动态抓拍，保持同一模特。"),
      item("closing_poster", "收尾海报", "poster", "4:5", "1024x1280", ["product", "model", "style", "copy"], ["product", "model"], "短标题烧入：轻暖上身。", { copyText: "轻暖上身", copyMode: "burn_in" }),
    ],
  });

  return {
    id: "product_model",
    title: "商品 + 模特",
    body,
    validate: ({ matrix }) => [
      ...expectAll(matrix, (entry) => entry.providerReferenceRoles.includes("product"), "model set should provider-lock product"),
      ...expectAll(matrix, (entry) => entry.providerReferenceRoles.includes("model"), "model set should provider-lock the same model"),
      ...expectNone(matrix, (entry) => entry.providerReferenceRoles.includes("scene"), "product+model set should not invent a required scene provider role"),
      ...expectAtLeast(matrix, (entry) => entry.copyMode === "burn_in", 2, "model set should include a couple of burn-in channel images"),
    ],
  };
}

function buildProductModelSceneCopyProject() {
  const body = buildBaseBody({
    id: "full_mix",
    title: "真实验收 · 商品 + 模特 + 场景 + 文案",
    request:
      "给真实毛绒小包、同一个甜妹模特、花店/咖啡馆/商场场景做完整商业套图。需要室内、室外、商场三类场景，每类多张；商品、模特、场景都要按图调用，海报和封面短文案要烧进图。",
    referenceContext: referenceContext("full_mix", ["product", "model", "scene", "style", "copy"]),
    items: [
      item("florist_full", "花店全身街拍", "model_product_scene", "4:5", "1024x1280", ["product", "model", "scene", "style"], ["product", "model", "scene"], "花店门口全身街拍。"),
      item("florist_close", "花店包包近景", "model_product_scene", "3:2", "1536x1024", ["product", "model", "scene"], ["product", "model", "scene"], "模特手持包，五金和毛绒清楚。"),
      item("florist_cover", "花店小红书封面", "social_cover", "4:5", "1024x1280", ["product", "model", "scene", "copy"], ["product", "model", "scene"], "烧入标题：软糯小包 出门刚好。", { copyText: "软糯小包 出门刚好", copyMode: "burn_in" }),
      item("cafe_sitting", "咖啡馆坐姿", "model_product_scene", "4:5", "1024x1280", ["product", "model", "scene"], ["product", "model", "scene"], "咖啡馆窗边坐姿，包放膝上。"),
      item("cafe_table", "咖啡馆桌面", "product_scene", "3:2", "1536x1024", ["product", "scene", "style", "copy"], ["product", "scene"], "包放在木桌，生活方式静物，安全区烧入短标题。", { copyText: "午后小包灵感", copyMode: "burn_in" }),
      item("cafe_detail", "咖啡馆材质细节", "detail", "1:1", "1024x1024", ["product", "scene"], ["product", "scene"], "绒毛、手柄和金属扣微距。"),
      item("mall_window", "商场橱窗展示", "model_product_scene", "4:5", "1024x1280", ["product", "model", "scene"], ["product", "model", "scene"], "商场橱窗前模特背包。"),
      item("mall_poster", "商场促销海报", "poster", "9:16", "1024x1792", ["product", "model", "scene", "copy"], ["product", "model", "scene"], "烧入标题：冬日软萌上新。", { copyText: "冬日软萌上新", copyMode: "burn_in" }),
      item("mall_detail", "商场近景", "model_product_scene", "3:2", "1536x1024", ["product", "model", "scene"], ["product", "model", "scene"], "半身近景，包和表情自然。"),
      item("detail_page", "淘宝详情页卖点", "detail_page", "2:3", "1024x1536", ["product", "scene", "copy"], ["product", "scene"], "烧入短标签：柔软绒感 / 轻巧容量 / 金属扣。", { copyText: "柔软绒感 / 轻巧容量 / 金属扣", copyMode: "burn_in" }),
      item("banner", "横版活动 Banner", "banner", "16:9", "1536x864", ["product", "model", "scene", "copy"], ["product", "model", "scene"], "右侧安全区烧入：甜感刚好。", { copyText: "甜感刚好", copyMode: "burn_in" }),
      item("closing", "收藏收尾图", "poster", "3:4", "1080x1440", ["product", "scene", "style", "copy"], ["product", "scene"], "收尾收藏图，烧入：收藏这套灵感。", { copyText: "收藏这套灵感", copyMode: "burn_in" }),
    ],
  });

  return {
    id: "full_mix",
    title: "商品 + 模特 + 场景 + 文案",
    body,
    validate: ({ matrix }) => [
      ...expectAll(matrix, (entry) => entry.providerReferenceRoles.includes("product"), "full set should provider-lock product"),
      ...expectAtLeast(matrix, (entry) => entry.providerReferenceRoles.includes("model"), 7, "full set should use model provider refs for model shots"),
      ...expectAtLeast(matrix, (entry) => entry.providerReferenceRoles.includes("scene"), 10, "full set should use scene provider refs for scene shots"),
      ...expectNone(matrix.filter((entry) => entry.itemId === "detail_page"), (entry) => entry.providerReferenceRoles.includes("model"), "detail-page product explanation should not provider-lock model"),
      ...expectAtLeast(matrix, (entry) => entry.copyMode === "burn_in", 6, "full set should burn short copy into poster/cover/detail images"),
      ...expectNone(matrix, (entry) => entry.providerReferenceRoles.includes("copy"), "copy should never be sent as provider image role"),
    ],
  };
}

function buildBaseBody({ id, title, request, referenceContext, items }) {
  const workflowId = `workflow_accept_${id}_${stamp}`;
  return {
    workflowId,
    frameNodeId: `${workflowId}_frame`,
    batchId: `${workflowId}_batch`,
    batchTitle: title,
    request,
    userRequest: request,
    scenario: id,
    platform: "acceptance",
    outputPacks: ["taobao_detail", "poster_pack", "model_display"],
    copyRenderMode: items.some((entry) => entry.copyRenderMode === "burn_in") ? "burn_in" : "layout_layer",
    requiredReferenceRoles: ["product"],
    referenceContext: {
      ...referenceContext,
      targetNodeId: `${workflowId}_frame`,
    },
    enqueue: false,
    confirmedProviderCallLimit: items.length,
    items,
  };
}

function item(itemId, title, type, ratio, size, referenceRoles, providerReferenceRoles, prompt, extra = {}) {
  const copyMode = extra.copyMode || (extra.copyText ? "burn_in" : "metadata_only");
  return {
    itemId,
    title,
    type,
    ratio,
    size,
    referenceRoles,
    providerReferenceRoles,
    prompt,
    copyText: extra.copyText || "",
    copyRenderMode: copyMode,
    textAllowed: copyMode === "burn_in",
    metadata: {
      acceptanceScenario: true,
      copyRenderPolicy: {
        mode: copyMode,
        defaultMode: "layout_layer",
        requestedMode: copyMode,
        inImageText: extra.copyText ? [extra.copyText] : [],
        exportCopy: [],
        forbiddenClaims: ["不要改写商品包装标签", "不要虚构品牌认证"],
      },
    },
  };
}

function referenceContext(id, roles) {
  const images = [];
  const roleContexts = {};
  for (const role of roles) {
    if (role !== "copy") {
      images.push({
        role,
        title: roleTitle(id, role),
        url: referenceUrl(role),
        providerUsable: true,
        providerMode: role === "style" ? "prompt_only" : "provider_input",
        source: "user_upload",
        assetId: `asset_accept_${id}_${role}`,
        nodeId: `node_accept_${id}_${role}`,
      });
    }
    roleContexts[role] = {
      role,
      title: roleTitle(id, role),
      sourceNodeIds: [`node_accept_${id}_${role}`],
      componentIds: [],
      assetIds: [`asset_accept_${id}_${role}`],
      parameters: role === "product" ? { productReferenceKind: "real", sourceKind: "user_upload" } : {},
      promptFragments: role === "copy" ? ["画面文字必须短、可读、放在安全区；禁止改写商品包装标签。"] : [],
      constraints: roleConstraints(role),
      negativeRules: role === "copy" ? ["不要把导出文案全部塞进图里。"] : [],
      qualityRules: [],
    };
  }
  return {
    version: 1,
    source: "canvas-workbench",
    images,
    roles: roleContexts,
    promptFragments: roles.includes("copy") ? ["文案按画面文字、卖点参数、禁止声明、导出文案拆开处理。"] : [],
    constraints: [],
    negativeRules: [],
    qualityRules: [],
  };
}

function roleTitle(id, role) {
  const labels = {
    product: "真实商品参考图",
    model: "同一模特身份参考",
    scene: "场景光影与空间参考",
    style: "商业摄影风格参考",
    copy: "结构化文案资产",
  };
  return `${labels[role] || role} · ${id}`;
}

function roleConstraints(role) {
  if (role === "product") return ["商品形态、比例、材质、关键结构必须锁定。"];
  if (role === "model") return ["保留同一模特身份，不复制僵硬表情。"];
  if (role === "scene") return ["场景负责空间、光源、透视和接触阴影。"];
  if (role === "style") return ["风格只约束摄影语言、色调和质感，不改商品。"];
  return [];
}

function referenceUrl(role) {
  const colors = {
    product: "7a553c",
    model: "7562b8",
    scene: "2e6f95",
    style: "2f7d7e",
  };
  const color = colors[role] || "777777";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#${color}"/><circle cx="48" cy="48" r="24" fill="#fff" opacity=".8"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function expectAll(items, predicate, message) {
  const failed = items.filter((item) => !predicate(item));
  return failed.length ? [`${message}: ${failed.map((item) => item.itemId).join(", ")}`] : [];
}

function expectNone(items, predicate, message) {
  const failed = items.filter(predicate);
  return failed.length ? [`${message}: ${failed.map((item) => item.itemId).join(", ")}`] : [];
}

function expectAtLeast(items, predicate, count, message) {
  const actual = items.filter(predicate).length;
  return actual >= count ? [] : [`${message}: expected >=${count}, got ${actual}`];
}

async function waitForJobsDone(workflowId, expectedCount) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20 * 60_000) {
    const payload = await requestJson(`${baseUrl}/api/jobs?workflowId=${encodeURIComponent(workflowId)}`, {}, 200, 30_000);
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    if (jobs.length >= expectedCount && jobs.every((job) => ["done", "failed", "cancelled"].includes(job.status))) {
      return jobs.sort((left, right) => (left.metadata?.batchIndex ?? 0) - (right.metadata?.batchIndex ?? 0));
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new Error(`Timed out waiting for ${expectedCount} jobs in ${workflowId}`);
}

async function waitForServer(url) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < 60_000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function requestJson(url, options = {}, expectedStatus = 200, timeoutMs = 60_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (response.status !== expectedStatus) {
      throw new Error(`HTTP ${response.status} for ${url}: ${JSON.stringify(data).slice(0, 1000)}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--real") {
      parsed.real = true;
    } else if (value.startsWith("--") && value.includes("=")) {
      const [key, ...rest] = value.slice(2).split("=");
      parsed[key] = rest.join("=");
    } else if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = values[index + 1];
      if (next && !next.startsWith("--")) {
        parsed[key] = next;
        index += 1;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}
