#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";

const port = Number(process.env.AGENT_COMPLEX_CAMPAIGN_SMOKE_PORT || 3546);
const externalBaseUrl = process.env.AGENT_COMPLEX_CAMPAIGN_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(process.cwd(), "test_artifacts", "api-smoke", `agent-complex-campaign-${stamp}`);
const reportPath = path.join(outDir, "report.json");
let server;
let serverOutput = "";

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER: "",
      IMAGE_MASTER_ENABLE_MOCK_BATCH: "",
      IMAGE_MASTER_DISABLE_AGENT_PLAN_LLM: "",
      IMAGE_MASTER_ALLOW_AGENT_PLAN_FALLBACK: "",
      IMAGE_MASTER_AGENT_PLAN_MAX_TOKENS: process.env.IMAGE_MASTER_AGENT_PLAN_MAX_TOKENS || "12000",
      IMAGE_MASTER_MAX_BATCH_IMAGES: process.env.IMAGE_MASTER_MAX_BATCH_IMAGES || "30",
      IMAGE_MASTER_DEEPSEEK_PROMPT_WRITER_MAX_TOKENS:
        process.env.IMAGE_MASTER_DEEPSEEK_PROMPT_WRITER_MAX_TOKENS || "8192",
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
  fs.mkdirSync(outDir, { recursive: true });
  await waitForServer(`${baseUrl}/api/settings`);

  const body = buildComplexCampaignBody();
  const started = Date.now();
  const response = await requestJson(`${baseUrl}/api/generation-plans/run`, {
    method: "POST",
    body: JSON.stringify(body),
  }, 201);
  const elapsedMs = Date.now() - started;
  const report = summarize(body, response, elapsedMs);
  validate(report);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (report.issues.length > 0) {
    throw new Error(`Complex campaign smoke found ${report.issues.length} issue(s). Report: ${reportPath}`);
  }
  console.log(`Complex campaign smoke passed on ${baseUrl}.`);
  console.log(`Jobs: ${report.jobCount}; elapsed=${Math.round(elapsedMs / 1000)}s; report=${reportPath}`);
} catch (error) {
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-6000));
  }
  process.exitCode = 1;
} finally {
  if (server) server.kill("SIGTERM");
}

function buildComplexCampaignBody() {
  const workflowId = `workflow_complex_campaign_${stamp}`;
  const frameNodeId = `${workflowId}_frame`;
  const batchId = `${workflowId}_batch`;
  const items = [
    productHero("phone_main", "小米 15 Pro · 淘宝首屏海报", "phone", "studio", "premium", "淘宝主视觉，手机背部镜头模组清楚，右侧留安全文案区。", "影像旗舰 一眼心动", "4:5", "1024x1280"),
    productDetail("phone_camera", "小米 15 Pro · 镜头细节", "phone", "studio", "premium", "微距展示镜头模组、金属环和玻璃背板。", "1:1", "1024x1024"),
    sceneShot("phone_office", "小米 15 Pro · 办公桌场景", "phone", "office", "street", "手机放在办公桌无线充旁，真实工作流场景。", "3:2", "1536x1024"),
    poster("phone_night_banner", "小米 15 Pro · 夜景横版 Banner", "phone", "street", "premium", "城市夜景，屏幕不显示具体 UI，左侧留海报标题区。", "夜拍更稳", "16:9", "1536x864"),
    productDetail("phone_specs", "小米 15 Pro · 卖点参数图", "phone", "studio", "clean", "展示机身厚度、镜头、边框比例，文案后期叠加。", "1:1", "1024x1024", "layout_layer"),

    modelScene("bag_xhs_cover", "毛绒小包 · 小红书封面", "bag", "sweet", "florist", "street", "甜妹街头花店门口自然背包，标题区在上方留白。", "软糯小包 出门刚好", "3:4", "1080x1440"),
    productDetail("bag_fur_detail", "毛绒小包 · 绒感五金细节", "bag", "florist", "clean", "微距展示绒毛纤维、粉色拼色、金属扣和手柄弧线。", "1:1", "1024x1024"),
    modelScene("bag_cafe_model", "毛绒小包 · 咖啡厅模特展示", "bag", "sweet", "cafe", "street", "模特坐在咖啡厅窗边，小包放在膝上，生活抓拍。", "", "4:5", "1024x1280"),
    modelScene("bag_shop_poster", "毛绒小包 · 商场促销海报", "bag", "sweet", "mall", "clean", "商场橱窗前的产品海报，甜妹模特和粉白毛绒小包都可见，文案放安全区。", "冬日软萌上新", "9:16", "1024x1792"),
    sceneShot("bag_flatlay", "毛绒小包 · 桌面搭配图", "bag", "cafe", "clean", "包放在木桌上，旁边有口红、围巾、钥匙和咖啡杯。", "3:2", "1536x1024"),

    modelScene("coat_snow_model", "银色羽绒服 · 雪山模特图", "coat", "premiumModel", "snow", "premium", "同一高级感模特穿银色羽绒服站在雪山碎石坡，冷光真实。", "", "3:2", "1536x1024"),
    modelScene("coat_cafe_model", "银色羽绒服 · 咖啡厅穿搭图", "coat", "premiumModel", "cafe", "street", "银色羽绒服在暖色咖啡厅里形成冷暖对比。", "", "4:5", "1024x1280"),
    productDetail("coat_material", "银色羽绒服 · 面料绗缝细节", "coat", "studio", "clean", "微距展示袖口、拉链、绗缝和银色面料反光。", "1:1", "1024x1024"),
    poster("coat_taobao_feature", "银色羽绒服 · 淘宝卖点图", "coat", "snow", "premium", "雪地环境中展示保暖和轻量感，文案在天空留白区。", "轻暖不臃肿", "4:5", "1024x1280"),
    sceneShot("coat_city_banner", "银色羽绒服 · 城市横幅", "coat", "street", "premium", "城市天桥半身横版广告，右侧留标题区，商品轮廓清楚。", "16:9", "1536x864"),

    productHero("bundle_main", "三品类 · 店铺活动主视觉", "phone", "mall", "premium", "商场店铺活动主视觉，手机为主，粉白毛绒小包和银色羽绒服作为活动氛围点缀，不混淆商品身份。", "冬季灵感套组", "16:9", "1536x864"),
    sceneShot("bundle_lifestyle", "三品类 · 生活方式组合图", "bag", "mall", "street", "商场生活方式画面，模特背包，手边出现手机，背景有银色羽绒服橱窗。", "4:5", "1024x1280"),
    poster("closing_save", "粉白毛绒小包 · 收藏收尾图", "bag", "cafe", "clean", "以粉白毛绒小包为主体，使用咖啡厅木桌场景，奶油色留白干净，适合加收藏引导。", "收藏这套灵感", "3:4", "1080x1440"),
  ];

  return {
    workflowId,
    frameNodeId,
    batchId,
    batchTitle: "复杂多品类商业 campaign smoke",
    request:
      "做一套复杂商业图组：小米手机、毛绒小包、银色羽绒服三个商品，覆盖淘宝详情、小红书封面、海报、模特展示、商品细节和组合活动图。需要按情况烧入短文案，但不要改商品本体包装/标签。",
    userRequest:
      "做一套复杂商业图组：小米手机、毛绒小包、银色羽绒服三个商品，覆盖淘宝详情、小红书封面、海报、模特展示、商品细节和组合活动图。需要按情况烧入短文案，但不要改商品本体包装/标签。",
    scenario: "complex_commercial_campaign",
    platforms: ["taobao", "xiaohongshu", "poster", "ecommerce"],
    outputPacks: ["taobao_detail", "xiaohongshu_cover", "poster_pack", "model_display"],
    copyRenderMode: "burn_in",
    requiredReferenceRoles: ["product"],
    referenceContext: buildReferenceContext(`${workflowId}_ref`),
    enqueue: false,
    confirmedProviderCallLimit: items.length,
    items,
  };
}

function productHero(itemId, title, productKey, sceneKey, styleKey, prompt, copyText, ratio, size) {
  return buildItem({ itemId, title, type: "product_hero", productKey, sceneKey, styleKey, prompt, copyText, ratio, size, copyMode: copyText ? "burn_in" : "metadata_only" });
}

function productDetail(itemId, title, productKey, sceneKey, styleKey, prompt, ratio, size, copyMode = "metadata_only") {
  return buildItem({ itemId, title, type: "product_detail", productKey, sceneKey, styleKey, prompt, ratio, size, copyMode });
}

function sceneShot(itemId, title, productKey, sceneKey, styleKey, prompt, ratio, size) {
  return buildItem({ itemId, title, type: "product_scene", productKey, sceneKey, styleKey, prompt, ratio, size, copyMode: "metadata_only" });
}

function poster(itemId, title, productKey, sceneKey, styleKey, prompt, copyText, ratio, size) {
  return buildItem({ itemId, title, type: "poster", productKey, sceneKey, styleKey, prompt, copyText, ratio, size, copyMode: "burn_in" });
}

function modelScene(itemId, title, productKey, modelKey, sceneKey, styleKey, prompt, copyText, ratio, size) {
  return buildItem({ itemId, title, type: "model_product_scene", productKey, modelKey, sceneKey, styleKey, prompt, copyText, ratio, size, copyMode: copyText ? "burn_in" : "metadata_only" });
}

function buildItem({ itemId, title, type, productKey, modelKey, sceneKey, styleKey, prompt, copyText = "", ratio, size, copyMode }) {
  const referenceRoles = ["product", "scene", "style"];
  if (modelKey) referenceRoles.splice(1, 0, "model");
  if (copyText) referenceRoles.push("copy");
  return {
    itemId,
    title,
    type,
    ratio,
    size,
    prompt,
    copyText,
    textAllowed: copyMode === "burn_in",
    copyRenderMode: copyMode,
    referenceRoles,
    providerReferenceRoles: referenceRoles.filter((role) => role !== "copy"),
    metadata: {
      smoke: "agent-complex-campaign",
      expectedProductKey: productKey,
      expectedModelKey: modelKey || "",
      expectedSceneKey: sceneKey,
      expectedStyleKey: styleKey,
      expectedCopyMode: copyMode,
    },
  };
}

function buildReferenceContext(targetNodeId) {
  const products = [
    image("product", "小米 15 Pro 手机", "product_phone", "phone-reference"),
    image("product", "粉白毛绒小包", "product_bag", "bag-reference"),
    image("product", "银色羽绒服", "product_coat", "coat-reference"),
  ];
  const models = [
    image("model", "甜妹自然模特", "model_sweet", "model-sweet"),
    image("model", "高级感东欧模特", "model_premiumModel", "model-premium"),
  ];
  const scenes = [
    image("scene", "白棚商品台", "scene_studio", "scene-studio"),
    image("scene", "咖啡厅窗边", "scene_cafe", "scene-cafe"),
    image("scene", "商场橱窗", "scene_mall", "scene-mall"),
    image("scene", "雪山外景", "scene_snow", "scene-snow"),
    image("scene", "城市街拍", "scene_street", "scene-street"),
    image("scene", "办公桌面", "scene_office", "scene-office"),
    image("scene", "花店街边", "scene_florist", "scene-florist"),
  ];
  const styles = [
    image("style", "真实街拍商业风格", "style_street", "style-street"),
    image("style", "高级商业大片风格", "style_premium", "style-premium"),
    image("style", "干净电商商品摄影", "style_clean", "style-clean"),
  ];
  return {
    version: 1,
    source: "agent-complex-campaign-smoke",
    targetNodeId,
    images: [...products, ...models, ...scenes, ...styles],
    roles: {
      product: roleContext("product", "商品资产", ["每张图只能锁定当前 item 对应的商品，不要把多个商品合成一个新商品。"]),
      model: roleContext("model", "模特资产", ["模特只负责身份和气质，不锁死动作、表情或原始光影。"]),
      scene: roleContext("scene", "场景资产", ["场景负责空间、光源、透视和接触关系。"]),
      style: roleContext("style", "风格资产", ["风格只负责摄影质感、色调和后期完成度。"]),
      copy: {
        role: "copy",
        title: "结构化文案",
        sourceNodeIds: [],
        componentIds: [],
        assetIds: [],
        promptFragments: ["影像旗舰 一眼心动", "软糯小包 出门刚好", "轻暖不臃肿", "冬季灵感套组", "收藏这套灵感"],
        constraints: ["短文案只放在安全留白区，不印在商品包装、瓶身、屏幕 UI、标签或道具上。"],
        negativeRules: ["不得生成夸大功效、医疗承诺或不可验证参数。"],
        qualityRules: ["烧字必须短、清晰、位置稳定，不遮挡商品。"],
      },
    },
    promptFragments: [],
    constraints: ["全套图组视觉语言统一，但每张图目的清楚。"],
    negativeRules: ["不要水印、边框、拼版、错误 logo、错误商品结构。"],
    qualityRules: ["商品身份、模特身份、场景光影和文案策略必须分工明确。"],
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

function summarize(body, response, elapsedMs) {
  const issues = [];
  const jobs = response.jobs || [];
  const expectedItemsById = new Map((body.items || []).map((item) => [item.itemId, item]));
  return {
    baseUrl,
    elapsedMs,
    imageGenerationStarted: jobs.some((job) => job.status !== "pending" || job.resultUrl),
    jobCount: jobs.length,
    expectedJobCount: body.items.length,
    agentPlan: response.plan?.agentPlan,
    providerPolicy: response.providerPolicy,
    estimate: response.estimate,
    jobs: jobs.map((job) => ({
      id: job.id,
      status: job.status,
      title: job.metadata?.planItemTitle,
      ratio: job.metadata?.ratio,
      size: job.metadata?.size,
      prompt: job.prompt,
      copyText: job.metadata?.copyText,
      itemMetadata: job.metadata?.itemMetadata,
      expectedItem: expectedItemsById.get(job.metadata?.planItemId),
      agentMatrixItem: job.metadata?.agentMatrixItem,
      agentAssetGroupIds: job.metadata?.agentAssetGroupIds || [],
      providerReferenceRoles: job.metadata?.itemProviderReferenceRoles || [],
      providerImages: job.metadata?.providerReferenceAdapter?.providerUsableImages || [],
      assetInvocationPlanner: job.metadata?.assetInvocationPlanner,
      providerPromptWriter: job.metadata?.providerPromptWriter,
      copyRenderPolicy: job.metadata?.itemMetadata?.copyRenderPolicy || job.metadata?.copyRenderPolicy,
    })),
    issues,
  };
}

function validate(report) {
  if (report.imageGenerationStarted) addIssue(report, "image_generation", "no-real-generation smoke started image generation");
  if (report.jobCount !== report.expectedJobCount) {
    addIssue(report, "job_count", `expected ${report.expectedJobCount} jobs, got ${report.jobCount}`);
  }
  if (report.agentPlan?.summary?.mode !== "llm_agent_plan_v1" || report.agentPlan?.summary?.fallbackUsed) {
    addIssue(report, "agent_plan", `expected llm_agent_plan_v1 without fallback, got ${JSON.stringify(report.agentPlan?.summary)}`);
  }
  for (const job of report.jobs) {
    if (job.status !== "pending") addIssue(report, "job_status", `${job.title} status=${job.status}`);
    if (job.providerPromptWriter?.mode !== "ai_prompt_writer_v1" || job.providerPromptWriter?.fallbackUsed) {
      addIssue(report, "prompt_writer", `${job.title} writer fallback=${JSON.stringify(job.providerPromptWriter)}`);
    }
    const expectedProduct = job.itemMetadata?.expectedProductKey;
    const expectedModel = job.itemMetadata?.expectedModelKey;
    const expectedScene = job.itemMetadata?.expectedSceneKey;
    const expectedStyle = job.itemMetadata?.expectedStyleKey;
    const providerImages = job.providerImages || [];
    const providerAssetIds = new Set(providerImages.map((image) => image.assetId).filter(Boolean));
    const productIds = providerImages.filter((image) => image.role === "product").map((image) => image.assetId).filter(Boolean);
    const modelIds = providerImages.filter((image) => image.role === "model").map((image) => image.assetId).filter(Boolean);
    const sceneIds = providerImages.filter((image) => image.role === "scene").map((image) => image.assetId).filter(Boolean);
    const isBundleShot = /三品类|全套图组|组合/.test(job.title || "");
    const expectedProductId = expectedProduct && `product_${expectedProduct}`;
    const expectedModelId = expectedModel && `model_${expectedModel}`;
    const expectedSceneId = expectedScene && `scene_${expectedScene}`;
    if (expectedProductId && !providerAssetIds.has(expectedProductId)) {
      addIssue(report, "reference_routing", `${job.title} missing expected product ${expectedProductId}; got ${JSON.stringify([...providerAssetIds])}`);
    }
    if (!isBundleShot && productIds.length > 1) {
      addIssue(report, "reference_routing", `${job.title} used extra product references ${JSON.stringify(productIds)}`);
    }
    if (expectedModelId && !providerAssetIds.has(expectedModelId)) {
      addIssue(report, "reference_routing", `${job.title} missing expected model ${expectedModelId}; got ${JSON.stringify([...providerAssetIds])}`);
    }
    if (!expectedModelId && !isBundleShot && modelIds.length > 0) {
      addIssue(report, "reference_routing", `${job.title} used unexpected model references ${JSON.stringify(modelIds)}`);
    }
    if (expectedModelId && !isBundleShot && modelIds.some((id) => id !== expectedModelId)) {
      addIssue(report, "reference_routing", `${job.title} used extra model references ${JSON.stringify(modelIds)}`);
    }
    if (
      expectedSceneId &&
      shouldExpectSceneProvider(job) &&
      !providerAssetIds.has(expectedSceneId)
    ) {
      addIssue(report, "reference_routing", `${job.title} missing expected scene ${expectedSceneId}; got ${JSON.stringify(sceneIds)}`);
    }
    const policy = job.copyRenderPolicy;
    const expectedItem = job.expectedItem || {};
    const expectedRatio = expectedItem.ratio;
    const expectedSize = expectedItem.size;
    const expectedCopyText = expectedItem.copyText || "";
    const inImageText = Array.isArray(policy?.inImageText) ? policy.inImageText.filter(Boolean) : [];
    const prompt = job.prompt || "";
    if (expectedRatio && job.ratio !== expectedRatio) {
      addIssue(report, "ratio", `${job.title} expected ratio=${expectedRatio}, got ${job.ratio || "missing"}`);
    }
    if (expectedSize && job.size !== expectedSize) {
      addIssue(report, "size", `${job.title} expected size=${expectedSize}, got ${job.size || "missing"}`);
    }
    if (policy?.mode === "burn_in" && expectedCopyText && !inImageText.includes(expectedCopyText)) {
      addIssue(report, "copy_policy", `${job.title} burn_in policy omitted inImageText ${expectedCopyText}`);
    }
    for (const phrase of inImageText) {
      if (policy?.mode === "burn_in" && !prompt.includes(phrase)) {
        addIssue(report, "copy_policy", `${job.title} burn_in prompt omitted ${phrase}`);
      }
      if (policy?.mode !== "burn_in" && prompt.includes(phrase)) {
        addIssue(report, "copy_policy", `${job.title} non-burn prompt contains copy text ${phrase}`);
      }
    }
  }
}

function shouldExpectSceneProvider(job) {
  const expectedItem = job.expectedItem || {};
  const text = `${job.title || ""} ${expectedItem.type || ""} ${expectedItem.prompt || ""}`.toLowerCase();
  if (/product_detail|product_macro|product_dimensions|product_steps|material|macro|detail|dimensions|steps|材质|细节|微距|参数|尺寸|步骤/.test(text)) {
    return false;
  }
  return /scene|poster|cover|banner|hero|model_product_scene|product_scene|场景|海报|封面|横幅|主视觉|模特/.test(text);
}

function addIssue(report, category, message) {
  report.issues.push({ category, message });
}

async function requestJson(url, init = {}, expectedStatus = 200) {
  const response = await requestText(url, init);
  const text = response.text;
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 500)}`);
  }
  if (response.statusCode !== expectedStatus) {
    throw new Error(`Expected ${expectedStatus}, got ${response.statusCode} from ${url}: ${JSON.stringify(payload).slice(0, 1500)}`);
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
    if (body) headers["Content-Length"] = Buffer.byteLength(body);
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(
      parsed,
      {
        method: init.method || "GET",
        headers,
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
    req.on("error", reject);
    req.setTimeout(Number(process.env.AGENT_COMPLEX_CAMPAIGN_HTTP_TIMEOUT_MS || 1800000), () => {
      req.destroy(new Error(`Request timed out after ${process.env.AGENT_COMPLEX_CAMPAIGN_HTTP_TIMEOUT_MS || 1800000}ms`));
    });
    if (body) req.write(body);
    req.end();
  });
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
