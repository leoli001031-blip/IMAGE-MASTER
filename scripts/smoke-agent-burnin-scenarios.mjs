#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import { seedCommercialComponents } from "./seed-commercial-components.mjs";

const port = Number(process.env.AGENT_BURNIN_SCENARIOS_PORT || 3524);
const externalBaseUrl = process.env.AGENT_BURNIN_SCENARIOS_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const requestTimeoutMs = Number(process.env.AGENT_BURNIN_SCENARIOS_TIMEOUT_MS || 900000);
const scenarioLimit = Number(process.env.AGENT_BURNIN_SCENARIOS_LIMIT || 8);
const itemsPerScenario = Number(process.env.AGENT_BURNIN_ITEMS_PER_SCENARIO || 4);
const requireTextKey = process.env.AGENT_BURNIN_REQUIRE_TEXT_KEY === "1";
const expectedTextModel = process.env.AGENT_BURNIN_EXPECT_TEXT_MODEL?.trim();
const scenarioIdsFilter = (process.env.AGENT_BURNIN_SCENARIO_IDS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const workflowPrefix = `smoke_agent_burnin_${stamp}`;
const outDir = path.join(process.cwd(), "test_artifacts", "api-smoke", `agent-burnin-scenarios-${stamp}`);
const reportPath = path.join(outDir, "report.json");

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
  await seedCommercialComponents({ baseUrl });

  validateSettings(settings);

  const allScenarios = buildScenarios();
  const scenarios = scenarioIdsFilter.length > 0
    ? scenarioIdsFilter.map((id) => {
        const scenario = allScenarios.find((item) => item.id === id);
        if (!scenario) throw new Error(`Unknown scenario id: ${id}`);
        return scenario;
      })
    : allScenarios.slice(0, Math.max(1, scenarioLimit));
  const reports = [];
  for (let index = 0; index < scenarios.length; index += 1) {
    const scenario = scenarios[index];
    const started = Date.now();
    console.log(`Running scenario ${index + 1}/${scenarios.length}: ${scenario.id}`);
    const scenarioReport = await runBurnInScenario(scenario);
    reports.push(scenarioReport);
    console.log(
      `Finished scenario ${index + 1}/${scenarios.length}: ${scenario.id}; jobs=${scenarioReport.jobCount}; elapsed=${Math.round((Date.now() - started) / 1000)}s`
    );
  }

  const report = {
    ok: issues.length === 0,
    baseUrl,
    generatedAt: new Date().toISOString(),
    imageGenerationStarted: false,
    note: "This suite validates burn-in copy prompts with enqueue:false. It uses the text Agent/prompt writer but never starts image generation jobs.",
    limits: { scenarioLimit, itemsPerScenario, requestTimeoutMs },
    settings: {
      hasTextKey: settings.hasTextKey,
      textModel: settings.textModel,
      textBaseUrlHost: safeHost(settings.textBaseUrl || settings.baseUrl),
      hasImageKey: settings.hasImageKey,
      imageModel: settings.imageModel,
    },
    scenarios: reports,
    issues,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  if (issues.length > 0) {
    throw new Error(`Burn-in scenario checks found ${issues.length} issue(s). Report: ${reportPath}`);
  }

  console.log(
    [
      `Agent burn-in scenario smoke passed on ${baseUrl}.`,
      `Scenarios: ${reports.length}; jobs: ${reports.reduce((sum, item) => sum + item.jobCount, 0)}; image generation started: false.`,
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
  if (server) server.kill("SIGTERM");
}

async function runBurnInScenario(scenario) {
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
      copyRenderMode: "burn_in",
      previewPlan: true,
      saveWorkflow: false,
    }),
  });
  const selectedSkillId = compose.planPreview?.agentPlan?.skillId;
  if (scenario.expectedSkillId && selectedSkillId !== scenario.expectedSkillId) {
    addIssue(scenario.id, "skill_selection", `expected ${scenario.expectedSkillId}, got ${selectedSkillId}`);
  }

  const items = scenario.items.slice(0, Math.max(1, itemsPerScenario)).map((item, index) => ({
    itemId: `${scenario.id}_${index + 1}`,
    textAllowed: true,
    copyRenderMode: "burn_in",
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
      productTitle: scenario.productTitle,
      platforms: scenario.platforms,
      outputPacks: scenario.outputPacks,
      copyRenderMode: "burn_in",
      requiredReferenceRoles: ["product"],
      referenceContext: buildReferenceContext(`${workflowId}_ref`, scenario.referenceRoles),
      enqueue: false,
      items,
    }),
  }, 201);

  validateRun(scenario, run, items);
  const summary = {
    id: scenario.id,
    title: scenario.title,
    selectedSkillId,
    agentSelectedSkillIds: run.plan?.agentPlan?.selectedSkillIds ?? [],
    agentSummary: run.plan?.agentPlan?.summary?.text,
    jobCount: run.jobs?.length ?? 0,
    providerCallEstimate: run.estimate?.providerCallCount,
    jobs: (run.jobs ?? []).map((job) => summarizeJob(job)),
  };
  return summary;
}

function validateSettings(settings) {
  if (requireTextKey && !settings.hasTextKey) addIssue("settings", "api", "textApiKey is not configured");
  if (expectedTextModel && settings.textModel !== expectedTextModel) {
    addIssue("settings", "api", `expected textModel ${expectedTextModel}, got ${settings.textModel}`);
  }
}

function validateRun(scenario, run, items) {
  const expectedJobCount = items.length;
  const itemById = new Map(items.map((item) => [item.itemId, item]));
  if (run.queued !== false) addIssue(scenario.id, "queue", "run unexpectedly queued image jobs");
  if ((run.jobs ?? []).length !== expectedJobCount) {
    addIssue(scenario.id, "job_count", `expected ${expectedJobCount} jobs, got ${(run.jobs ?? []).length}`);
  }
  for (const job of run.jobs ?? []) {
    const title = job.metadata?.planItemTitle || job.id;
    if (job.status !== "pending") addIssue(scenario.id, "job_status", `${title} status is ${job.status}, expected pending`);
    if (job.resultUrl) addIssue(scenario.id, "image_generation", `${title} already has resultUrl`);

    const writer = job.metadata?.providerPromptWriter;
    if (writer?.mode !== "ai_prompt_writer_v1" || writer?.fallbackUsed) {
      addIssue(
        scenario.id,
        "prompt_writer",
        `${title} did not use the DeepSeek AI writer cleanly: ${JSON.stringify(writer)}`
      );
    }

    const policy = getCopyPolicy(job);
    if (policy?.mode !== "burn_in") {
      addIssue(scenario.id, "copy_policy", `${title} expected burn_in, got ${policy?.mode || "missing"}`);
    }
    const visibleText = Array.isArray(policy?.inImageText)
      ? policy.inImageText.map((item) => String(item).trim()).filter(Boolean)
      : [];
    if (visibleText.length === 0) {
      addIssue(scenario.id, "copy_policy", `${title} has no approved in-image text`);
    } else if (!visibleText.some((line) => (job.prompt || "").includes(line))) {
      addIssue(
        scenario.id,
        "copy_prompt",
        `${title} prompt omitted approved burn-in text ${JSON.stringify(visibleText)}`
      );
    }

    const providerRoles = getProviderRoles(job);
    const promptOnlyRoles = getPromptOnlyRoles(job);
    const item = itemById.get(job.metadata?.planItemId);
    const expectedProviderRoles = unique([
      ...(scenario.expectedProviderRoles ?? []),
      ...(item?.expectedProviderRoles ?? []),
    ]);
    if (!providerRoles.includes("product")) {
      addIssue(scenario.id, "reference_routing", `${title} missing product provider reference`);
    }
    for (const role of expectedProviderRoles) {
      if (!providerRoles.includes(role)) {
        addIssue(scenario.id, "reference_routing", `${title} missing expected ${role} provider reference`);
      }
    }
    if (providerRoles.includes("copy")) {
      addIssue(scenario.id, "reference_routing", `${title} routed copy as provider image input`);
    }
    const unsafeText = visibleText.find((line) => isUnsafeBurnInPlacement(job.prompt || "", line));
    if (unsafeText) {
      addIssue(scenario.id, "copy_placement", `${title} placed burn-in text on product/object body: ${unsafeText}`);
    }
    if (
      (providerRoles.includes("model") || promptOnlyRoles.includes("model")) &&
      /(或者|任选|镜头或|橱窗或|路面或|看(?:向|着).{0,12}或)/.test(job.prompt || "")
    ) {
      addIssue(scenario.id, "prompt_pose", `${title} still contains multiple-choice action wording`);
    }
  }
}

function summarizeJob(job) {
  const policy = getCopyPolicy(job);
  return {
    title: job.metadata?.planItemTitle,
    type: job.metadata?.planItemType,
    ratio: job.metadata?.ratio,
    size: job.metadata?.size,
    status: job.status,
    providerPromptWriter: job.metadata?.providerPromptWriter,
    copyRenderPolicy: policy,
    providerUsableRoles: getProviderRoles(job),
    promptOnlyRoles: getPromptOnlyRoles(job),
    prompt: job.prompt || "",
    promptPreview: (job.prompt || "").slice(0, 320),
  };
}

function buildScenarios() {
  return [
    {
      id: "model_reference_routing_burnin",
      title: "模特参考独立路由测试",
      scenario: "poster_campaign",
      expectedProviderRoles: ["model"],
      productTitle: "银色短款羽绒服",
      productDescription: "Metallic silver short down jacket with stand collar and clean commercial fashion styling.",
      platforms: ["campaign"],
      outputPacks: ["commercial.output_pack.poster_campaign"],
      referenceRoles: ["product", "model", "style", "copy"],
      brief: "用户上传了商品图和固定模特资产，要生成同一模特穿银色羽绒服的宣传图。必须保持同一模特身份，不能只凭文字描述生成新人。",
      items: [
        burnItemWithReferences(
          "model-street",
          "同一模特街拍主视觉",
          "4:5",
          "同一模特穿银色短款羽绒服走在城市街头，动作松弛，商品完整出镜。",
          "标题：轻暖出街\n卖点：短款不压身\n禁止：不要写明星同款",
          ["product", "model", "style"],
          ["product", "model"]
        ),
        burnItemWithReferences(
          "model-close",
          "同一模特半身卖点图",
          "3:4",
          "同一模特半身展示羽绒服领口、拉链和袖口，表情自然，眼神有明确落点。",
          "标题：细节也轻盈\n卖点：银面高光\n禁止：不要写绝对保暖",
          ["product", "model", "style"],
          ["product", "model"]
        ),
      ],
    },
    {
      id: "scene_reference_routing_burnin",
      title: "场景参考独立路由测试",
      scenario: "product_detail_page",
      expectedProviderRoles: ["scene"],
      productTitle: "家用半自动咖啡机",
      productDescription: "Brushed stainless steel espresso machine for a warm kitchen countertop campaign.",
      platforms: ["taobao"],
      outputPacks: ["commercial.output_pack.taobao_detail"],
      referenceRoles: ["product", "scene", "style", "copy"],
      brief: "用户上传了咖啡机商品图和固定厨房场景资产，要生成咖啡机在同一厨房空间里的详情图。必须保持同一空间、窗光方向、台面材质和背景关系。",
      items: [
        burnItemWithReferences(
          "scene-countertop",
          "同一厨房台面主图",
          "3:2",
          "咖啡机放在参考厨房台面，保持场景空间、窗光方向、台面材质和背景关系。",
          "标题：早晨从香气开始\n卖点：稳定萃取\n禁止：不要写商用认证",
          ["product", "scene", "style"],
          ["product", "scene"]
        ),
        burnItemWithReferences(
          "scene-detail",
          "同一厨房压力表特写",
          "4:5",
          "在同一厨房场景里特写咖啡机压力表和蒸汽阀，光源和背景必须延续参考场景。",
          "标题：压力看得见\n卖点：萃取更安心\n禁止：不要写100%成功",
          ["product", "scene", "style"],
          ["product", "scene"]
        ),
      ],
    },
    {
      id: "taobao_skincare_burnin",
      title: "淘宝护肤品详情带字图",
      scenario: "product_detail_page",
      expectedSkillId: "workflow.taobao_detail.v1",
      productTitle: "AURA 玻尿酸精华液",
      productDescription: "Frosted glass bottle serum with silver cap, transparent gel texture, premium skincare positioning.",
      platforms: ["taobao"],
      outputPacks: ["commercial.output_pack.taobao_detail"],
      referenceRoles: ["product", "scene", "style", "copy"],
      brief: "给一瓶玻尿酸精华液做淘宝详情页带字图测试，主图、卖点图、质地图、场景图都要有短文案直接进图，长文案不要进图。",
      items: [
        burnItem("hero", "首屏带字主视觉", "9:16", "高端护肤品首屏海报，瓶身居中偏下，水润透明质感。", "标题：一滴透亮水光\n卖点：玻尿酸精华\n禁止：不要写医学功效、治疗、祛斑"),
        burnItem("feature", "核心卖点图", "3:4", "展示精华液滴落在玻璃滴管上的水润质感。", "标题：深润补水\n卖点：清爽不黏腻\n禁止：不要写100%有效"),
        burnItem("texture", "质地特写图", "4:5", "微距展示透明凝露质地和瓶身磨砂玻璃反光。", "标题：轻盈凝露质地\n卖点：吸收快\n禁止：不要虚构成分认证"),
        burnItem("scene", "浴室台面场景图", "3:2", "产品放在清晨浴室台面，窗光、水汽和白色毛巾营造真实使用场景。", "标题：晨间护肤第一步\n卖点：清透水润\n禁止：不要写医美级"),
      ],
    },
    {
      id: "xiaohongshu_plush_bag_burnin",
      title: "小红书毛绒包带字封面",
      scenario: "xiaohongshu_cover",
      expectedSkillId: "workflow.xiaohongshu_cover.v1",
      productTitle: "粉白毛绒小包",
      productDescription: "Soft pink ivory plush mini handbag with rounded handle and cute daily style.",
      platforms: ["xiaohongshu"],
      outputPacks: ["commercial.output_pack.xiaohongshu_cover"],
      referenceRoles: ["product", "model", "scene", "style", "copy"],
      brief: "给粉白毛绒小包做小红书种草带字图，封面、细节、背包场景、收藏图都要测试短标题进图。",
      items: [
        burnItem("cover", "小红书封面", "3:4", "甜妹街拍封面，模特自然背着毛绒小包走过花店门口。", "标题：软萌小包太会了\n卖点：冬日氛围感\n禁止：不要写爆款第一"),
        burnItem("detail", "绒感细节图", "1:1", "微距拍摄毛绒纤维、手柄弧线和金属扣。", "标题：绒绒手感\n卖点：细节也可爱\n禁止：不要写真皮"),
        burnItem("use-case", "咖啡店背包图", "4:5", "模特坐在咖啡店窗边，包放在膝上，真实生活抓拍。", "标题：约会也能背\n卖点：轻巧不压身\n禁止：不要写明星同款"),
        burnItem("save", "收藏引导图", "3:4", "包放在奶油色桌面，周围有口红、围巾、钥匙，适合收藏收尾。", "标题：通勤约会都能搭\n卖点：小包大容量\n禁止：不要写官方联名"),
      ],
    },
    {
      id: "phone_launch_poster_burnin",
      title: "手机发布海报带字套图",
      scenario: "poster_campaign",
      expectedSkillId: "workflow.poster_campaign.v1",
      productTitle: "MIX 15 Pro 手机",
      productDescription: "Titanium grey flagship smartphone, large camera module, glass back, slim premium industrial design.",
      platforms: ["campaign"],
      outputPacks: ["commercial.output_pack.poster_campaign"],
      referenceRoles: ["product", "scene", "style", "copy"],
      brief: "给旗舰手机做一套发布海报带字测试，竖版、横版、方图、卖点图都要短标题进图。",
      items: [
        burnItem("vertical", "竖版发布海报", "9:16", "手机悬浮在暗色金属台面上，背部镜头模组高光清晰。", "标题：越级影像旗舰\n卖点：Pro级夜景\n禁止：不要写真实品牌授权"),
        burnItem("banner", "横版广告横幅", "16:9", "手机横放在冷灰科技背景，左侧留文案区。", "标题：轻薄，也强悍\n卖点：钛灰机身\n禁止：不要写行业第一"),
        burnItem("square", "社媒方图", "1:1", "手机正反双机位组合，玻璃后盖和屏幕边框质感突出。", "标题：一眼高级\n卖点：旗舰质感\n禁止：不要写官方价格"),
        burnItem("camera", "镜头卖点图", "4:5", "微距展示手机镜头模组与金属环纹理。", "标题：光影细节全收下\n卖点：大底主摄\n禁止：不要写专业认证"),
      ],
    },
    {
      id: "coffee_machine_store_burnin",
      title: "咖啡机店铺带字图",
      scenario: "product_detail_page",
      expectedSkillId: "workflow.taobao_detail.v1",
      productTitle: "家用半自动咖啡机",
      productDescription: "Brushed stainless steel espresso machine with portafilter, pressure gauge, steam wand.",
      platforms: ["taobao"],
      outputPacks: ["commercial.output_pack.taobao_detail"],
      referenceRoles: ["product", "scene", "style", "copy"],
      brief: "给家用半自动咖啡机做店铺详情带字图，质感要真实，短卖点要直接进入图中。",
      items: [
        burnItem("main", "咖啡机主视觉", "1:1", "不锈钢咖啡机摆在深色木质厨房台面，黄铜杯和咖啡豆辅助。", "标题：在家做一杯精品咖啡\n卖点：稳定萃取\n禁止：不要写商用认证"),
        burnItem("pressure", "压力表卖点图", "4:5", "特写压力表、金属旋钮和蒸汽阀，显示机械质感。", "标题：压力看得见\n卖点：萃取更安心\n禁止：不要写100%成功"),
        burnItem("milk", "奶泡场景图", "3:4", "蒸汽棒正在打奶泡，牛奶杯表面形成细密泡沫。", "标题：绵密奶泡\n卖点：拉花更顺手\n禁止：不要写大师同款"),
        burnItem("kitchen", "厨房生活图", "3:2", "清晨厨房窗光，咖啡机旁边有杯子和毛巾，真实生活质感。", "标题：早晨从香气开始\n卖点：小厨房也能放\n禁止：不要夸大容量"),
      ],
    },
    {
      id: "fashion_down_jacket_burnin",
      title: "羽绒服活动带字图",
      scenario: "poster_campaign",
      expectedSkillId: "workflow.poster_campaign.v1",
      productTitle: "银色短款羽绒服",
      productDescription: "Metallic silver short down jacket with stand collar, quilted panels, elastic cuffs.",
      platforms: ["campaign"],
      outputPacks: ["commercial.output_pack.poster_campaign"],
      referenceRoles: ["product", "model", "scene", "style", "copy"],
      brief: "给银色短款羽绒服做活动海报带字图，模特、雪山、城市夜景多个场景都要带短标题。",
      items: [
        burnItem("snow-poster", "雪山竖版海报", "9:16", "同一模特穿银色羽绒服站在雪山碎石坡，冷光真实。", "标题：轻暖上山\n卖点：蓬松锁温\n禁止：不要写极地认证"),
        burnItem("city-night", "城市夜景海报", "4:5", "模特穿银色羽绒服走在夜晚街头，霓虹和冷光反射在面料上。", "标题：夜色也发光\n卖点：银面高光\n禁止：不要写明星同款"),
        burnItem("detail", "袖口细节图", "1:1", "微距展示袖口、拉链、绗缝和银色面料反光。", "标题：细节也保暖\n卖点：防风袖口\n禁止：不要写绝对防寒"),
        burnItem("banner", "横版活动 Banner", "16:9", "模特半身站在城市天桥，右侧留标题区，画面有速度感。", "标题：冬天也要轻盈\n卖点：短款不压身\n禁止：不要写限时最低价"),
      ],
    },
    {
      id: "gaming_mouse_burnin",
      title: "游戏鼠标卖点带字图",
      scenario: "product_detail_page",
      expectedSkillId: "workflow.taobao_detail.v1",
      productTitle: "幻影游戏鼠标",
      productDescription: "Black gaming mouse with RGB light strip, honeycomb shell, side buttons and braided cable.",
      platforms: ["taobao"],
      outputPacks: ["commercial.output_pack.taobao_detail"],
      referenceRoles: ["product", "scene", "style", "copy"],
      brief: "给一款黑色RGB游戏鼠标做电竞风带字详情图，主视觉、按键、灯带、桌搭场景都要烧短文案。",
      items: [
        burnItem("rgb-hero", "电竞主视觉", "1:1", "黑色游戏鼠标放在暗色电竞桌面，RGB灯带发光，背景有蓝紫色光。", "标题：快到先手一步\n卖点：RGB电竞光效\n禁止：不要写职业战队认证"),
        burnItem("button", "侧键卖点图", "4:5", "微距展示鼠标侧键、蜂窝壳和防滑纹理。", "标题：指尖一键触发\n卖点：侧键自定义\n禁止：不要写外挂"),
        burnItem("cable", "线材细节图", "1:1", "编织线缆和鼠标前端接口特写，强调耐用和轻拖拽。", "标题：轻拖不绊手\n卖点：柔韧编织线\n禁止：不要写永不断裂"),
        burnItem("desk", "桌搭场景图", "16:9", "鼠标在键盘、耳机和显示器光影中的桌搭场景，真实电竞房。", "标题：桌面战力拉满\n卖点：低延迟响应\n禁止：不要写官方赛事指定"),
      ],
    },
  ];
}

function burnItem(type, title, ratio, prompt, copyText) {
  return {
    title,
    type,
    ratio,
    size: imageSizeForRatio(ratio),
    prompt,
    copyText,
    referenceRoles: ["product", "style", "copy"],
    providerReferenceRoles: ["product", "style"],
    textAllowed: true,
    copyRenderMode: "burn_in",
  };
}

function burnItemWithReferences(type, title, ratio, prompt, copyText, providerReferenceRoles, expectedProviderRoles) {
  return {
    ...burnItem(type, title, ratio, prompt, copyText),
    referenceRoles: unique([...providerReferenceRoles, "copy"]),
    providerReferenceRoles,
    expectedProviderRoles,
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
      "Copy brief contains short image text, selling points, export copy, and forbidden claims.",
      "Only inImageText candidates may be rendered into the image.",
    ];
    roleMap.copy.negativeRules = [
      "Do not invent certifications, rankings, discounts, medical effects, celebrity endorsements, or official partnerships.",
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
    qualityRules: ["Burn-in text must be short, readable, and not cover product-critical details."],
  };
}

function roleContext(role, title, constraints = []) {
  return {
    role,
    title,
    description: title,
    providerMode: role === "copy" ? "prompt_only" : "provider_input",
    imageIds: [],
    assetIds: [],
    promptFragments: [],
    constraints,
    negativeRules: [],
    qualityRules: [],
  };
}

function referenceImage(role, title, id, url) {
  return {
    id,
    role,
    title,
    url,
    providerMode: "provider_input",
    sourceNodeId: `${id}_node`,
    sourceAssetId: `${id}_asset`,
    providerUsable: true,
    promptFragments: [],
    constraints: roleConstraints(role),
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
    copy: ["本场景明确测试短句烧字；只允许批准短句进图。"],
  }[role] || [];
}

function getCopyPolicy(job) {
  return job.metadata?.itemMetadata?.copyRenderPolicy ?? job.metadata?.copyRenderPolicy;
}

function getProviderRoles(job) {
  return unique((job.metadata?.providerReferenceAdapter?.providerUsableImages ?? []).map((image) => image.role).filter(Boolean));
}

function getPromptOnlyRoles(job) {
  return unique((job.metadata?.providerReferenceAdapter?.promptOnlyImages ?? []).map((image) => image.role).filter(Boolean));
}

function unique(values) {
  return Array.from(new Set(values));
}

function isUnsafeBurnInPlacement(prompt, text) {
  const value = String(text || "").trim();
  if (!value) return false;
  const source = String(prompt || "");
  const quoted = escapeRegExp(value);
  const safeZone = "(?:留白|安全区|文字区|版式层|海报文字区|干净区域|空白区域)";
  const object = "(?:瓶身|瓶体|商品本体|商品|包装|外包装|标签|logo|Logo|LOGO|机身|屏幕|显示器|壁纸|黑板|招牌|贴纸|卡片|便签|菜单|纸张|道具|鼠标|键盘|衣服|面料|袖口|包身|手柄)";
  const verb = "(?:印有|印着|写有|写着|显示|呈现|渲染|放置|烧入|刻在|贴在|压入)";
  const safeNegation = "(?:不|不要|不得|不能|避免).{0,10}(?:遮挡|遮盖|覆盖|盖在|压在|压覆|压|接触|印在|写在|贴在|落在|改写)";
  if (new RegExp(`${safeZone}.{0,36}${verb}.{0,36}${quoted}`).test(source)) return false;

  const occurrences = findTextOccurrences(source, value);
  if (occurrences.length > 0) {
    return occurrences.some((index) => {
      const window = source.slice(Math.max(0, index - 90), Math.min(source.length, index + value.length + 110));
      if (new RegExp(`${safeZone}|${safeNegation}`).test(window)) return false;
      return new RegExp(`${object}.{0,36}${verb}.{0,36}${quoted}`).test(window) ||
        new RegExp(`${quoted}.{0,36}(?:${verb}.{0,16})?${object}`).test(window);
    });
  }

  return new RegExp(`${object}.{0,24}${verb}.{0,24}${quoted}`).test(source) ||
    new RegExp(`${quoted}.{0,24}(?:${verb}.{0,12})?${object}`).test(source);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTextOccurrences(source, value) {
  const result = [];
  let from = 0;
  while (from < source.length) {
    const index = source.indexOf(value, from);
    if (index < 0) break;
    result.push(index);
    from = index + value.length;
  }
  return result;
}

function addIssue(scenarioId, category, message) {
  issues.push({ scenarioId, category, message });
}

async function requestJson(url, init = {}, expectedStatus = 200) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const response = await fetch(url, {
    ...init,
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  }).finally(() => clearTimeout(timeout));
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 240)}`);
  }
  if (response.status !== expectedStatus) {
    throw new Error(`Expected ${expectedStatus}, got ${response.status} from ${url}: ${JSON.stringify(payload).slice(0, 1000)}`);
  }
  return payload;
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

function imageSizeForRatio(ratio) {
  if (["16:9", "3:2"].includes(ratio)) return "1536x1024";
  if (["9:16", "4:5", "3:4"].includes(ratio)) return "1024x1536";
  return "1024x1024";
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
  ihdr[8] = 8;
  ihdr[9] = 6;
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
