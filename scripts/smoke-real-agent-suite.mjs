#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { stopSmokeServer } from "./smoke-runtime.mjs";

const ROOT = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const port = Number(process.env.REAL_AGENT_SUITE_PORT || 3498);
const externalBaseUrl = process.env.REAL_AGENT_SUITE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const outRoot = path.join(ROOT, "test_artifacts", "api-smoke");
const suiteDir = path.join(outRoot, `real-agent-suite-${stamp}`);
const generatedDir = path.join(ROOT, ".data", "generated");
const workflowId = `workflow_real_agent_suite_${stamp}`;
const frameNodeId = `frame_real_agent_suite_${stamp}`;
const batchId = `batch_real_agent_suite_${stamp}`;
const reportPath = path.join(suiteDir, "report.json");
const promptPath = path.join(suiteDir, "prompts.json");
const dbPath = path.join(ROOT, ".data", "image-master.db");
const referenceMode = normalizeReferenceMode(process.env.REAL_AGENT_SUITE_REFERENCE_MODE);
const itemMode = normalizeItemMode(process.env.REAL_AGENT_SUITE_ITEM_MODE);
const failedJobRetryAttempts = readNonNegativeInteger(process.env.REAL_AGENT_SUITE_RETRY_FAILED_ATTEMPTS, 1);

const seedSetDir = path.join(ROOT, "test_artifacts/sweet-plush-bag-scene-set/2026-05-22T18-17-46-929Z");
const sourceRefs = {
  product: process.env.REAL_AGENT_SUITE_PRODUCT || path.join(seedSetDir, "asset-product-product_asset.png"),
  model: process.env.REAL_AGENT_SUITE_MODEL || path.join(seedSetDir, "asset-model-model_asset.png"),
  indoor: process.env.REAL_AGENT_SUITE_SCENE_INDOOR || path.join(seedSetDir, "asset-indoor-scene_asset.png"),
  outdoor: process.env.REAL_AGENT_SUITE_SCENE_OUTDOOR || path.join(seedSetDir, "asset-outdoor-scene_asset.png"),
  mall: process.env.REAL_AGENT_SUITE_SCENE_MALL || path.join(seedSetDir, "asset-mall-scene_asset.png"),
  style: process.env.REAL_AGENT_SUITE_STYLE || path.join(seedSetDir, "asset-style-style_asset.png"),
};

let server;
let serverOutput = "";
let fullReportWritten = false;

await fsp.mkdir(suiteDir, { recursive: true });
await fsp.mkdir(generatedDir, { recursive: true });

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: ROOT,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      IMAGE_MASTER_DATA_DIR: path.join(ROOT, ".data"),
      IMAGE_MASTER_QUEUE_OWNER: `real-agent-suite-${Date.now()}`,
      IMAGE_MASTER_JOB_CONCURRENCY: process.env.REAL_AGENT_SUITE_CONCURRENCY || "3",
      IMAGE_MASTER_JOB_LEASE_MS: "900000",
      NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || `.next-real-agent-suite-${stamp}`,
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
  await assertConfigured();
  await waitForServer(`${baseUrl}/api/settings`);

  const refs = await prepareReferences();
  const body = buildPlanRequest(refs);
  await fsp.writeFile(promptPath, `${JSON.stringify({
    request: body.request,
    items: body.items.map((item) => ({
      itemId: item.itemId,
      title: item.title,
      size: item.size,
      ratio: item.ratio,
      referenceRoles: item.referenceRoles,
      providerReferenceRoles: item.providerReferenceRoles,
      copyRenderMode: item.copyRenderMode,
      copyText: item.copyText,
      prompt: item.prompt,
    })),
  }, null, 2)}\n`);

  const committed = await requestJson(`${baseUrl}/api/generation-plans/run`, {
    method: "POST",
    body: JSON.stringify({
      ...body,
      enqueue: true,
      confirmedProviderCallLimit: body.items.length,
    }),
  }, 201, 90_000);

  if (committed.ok !== true || committed.queued !== true) {
    throw new Error(`Expected queued generation plan, got ${JSON.stringify(committed).slice(0, 1600)}`);
  }

  let jobs = sortJobsByBatchIndex(await waitForJobsDone(workflowId, body.items.length));
  jobs = await retryFailedJobsIfNeeded(jobs, body.items.length);
  const outputs = [];
  const failures = [];

  for (const [index, job] of jobs.entries()) {
    if (job.status !== "done") {
      failures.push(summarizeJob(job));
      continue;
    }
    const metadata = parseMetadata(job.metadata);
    const bytes = await getBytes(job.resultUrl);
    const safeId = safeSlug(String(metadata.planItemId || job.id), `job-${index + 1}`);
    const outputPath = path.join(suiteDir, `${String(index + 1).padStart(2, "0")}-${safeId}.png`);
    await fsp.writeFile(outputPath, bytes);
    outputs.push({
      index: index + 1,
      jobId: job.id,
      itemId: metadata.planItemId,
      title: metadata.planItemTitle,
      type: metadata.planItemType,
      size: metadata.size,
      ratio: metadata.ratio,
      resultUrl: job.resultUrl,
      outputPath,
      outputBytes: bytes.length,
      providerReferenceCount: metadata.providerReferenceCount,
      providerReferenceRole: metadata.providerReferenceRole,
      providerReferenceStrategy: metadata.providerReferenceStrategy,
      providerRoles: metadata.itemProviderReferenceRoles,
      referenceRoles: metadata.itemReferenceRoles,
      agentAssetGroupIds: metadata.agentAssetGroupIds,
      promptWriterMode: metadata.providerPromptWriter?.mode,
      assetInvocationMode: metadata.assetInvocationPlanner?.mode,
      providerRequestId: readLastProviderRequestId(metadata),
      promptPreview: String(job.prompt || "").slice(0, 360),
    });
  }

  const contactSheetPath = outputs.length
    ? await createContactSheet(outputs)
    : undefined;
  const report = {
    ok: failures.length === 0,
    stage: failures.length === 0 ? "done" : "partial",
    baseUrl,
    workflowId,
    frameNodeId,
    batchId,
    referenceInputs: refs.map((ref) => ({
      role: ref.role,
      title: ref.title,
      sourcePath: ref.sourcePath,
      preparedPath: ref.preparedPath,
      publicUrl: ref.publicUrl,
      preparedBytes: ref.bytes,
      assetId: ref.assetId,
    })),
    agentPlan: committed.plan?.agentPlan ?? committed.summary?.agentPlan,
    estimate: committed.estimate,
    providerPolicy: committed.providerPolicy,
    retry: {
      failedJobRetryAttempts,
      finalFailedCount: failures.length,
    },
    outputCount: outputs.length,
    outputs,
    failures,
    promptPath,
    contactSheetPath,
    reportPath,
  };
  await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fullReportWritten = true;

  if (failures.length > 0) {
    throw new Error(`Real agent suite finished with ${failures.length} failed job(s). See ${reportPath}`);
  }

  console.log(`Real agent suite passed on ${baseUrl}.`);
  console.log(`Provider calls: ${body.items.length}`);
  console.log(`Outputs: ${suiteDir}`);
  if (contactSheetPath) console.log(`Contact sheet: ${contactSheetPath}`);
  console.log(`Report: ${reportPath}`);
} catch (error) {
  await writeFailureReport(error).catch(() => undefined);
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-8000));
  }
  process.exitCode = 1;
} finally {
  await stopSmokeServer(server);
}

async function assertConfigured() {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Missing app database at ${dbPath}`);
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare("SELECT key, value FROM config").all();
    const config = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    const hasKey = Boolean(config.imageApiKey || config.apiKey || process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY);
    if (!hasKey) {
      throw new Error("Image provider key is not configured.");
    }
    console.log(
      `Provider config: model=${config.imageModel || process.env.IMAGE_MODEL || "unknown"} host=${safeHost(config.imageBaseUrl || config.baseUrl || process.env.IMAGE_BASE_URL || process.env.OPENAI_BASE_URL || "")}`
    );
  } finally {
    db.close();
  }
}

async function prepareReferences() {
  const sharp = await import("sharp");
  const specs = [
    {
      key: "product",
      role: "product",
      title: "粉白毛绒小包真实商品多角度参考",
      sourcePath: sourceRefs.product,
      maxEdge: 768,
      quality: 86,
      nodeId: "product_ref_plush_bag",
      assetId: "asset_real_suite_product_plush_bag",
    },
    {
      key: "model",
      role: "model",
      title: "甜妹系年轻女性模特身份参考",
      sourcePath: sourceRefs.model,
      maxEdge: 768,
      quality: 84,
      nodeId: "model_ref_sweet_girl",
      assetId: "asset_real_suite_model_sweet_girl",
    },
    {
      key: "indoor",
      role: "scene",
      title: "室内温暖咖啡/家居场景",
      sourcePath: sourceRefs.indoor,
      maxEdge: 768,
      quality: 82,
      nodeId: "scene_ref_indoor",
      assetId: "asset_real_suite_scene_indoor",
    },
    {
      key: "outdoor",
      role: "scene",
      title: "户外花店街拍场景",
      sourcePath: sourceRefs.outdoor,
      maxEdge: 768,
      quality: 82,
      nodeId: "scene_ref_outdoor",
      assetId: "asset_real_suite_scene_outdoor",
    },
    {
      key: "mall",
      role: "scene",
      title: "商场橱窗/中庭场景",
      sourcePath: sourceRefs.mall,
      maxEdge: 768,
      quality: 82,
      nodeId: "scene_ref_mall",
      assetId: "asset_real_suite_scene_mall",
    },
    {
      key: "style",
      role: "style",
      title: "自然街拍质感与柔和商业完成度",
      sourcePath: sourceRefs.style,
      maxEdge: 640,
      quality: 82,
      nodeId: "style_ref_soft_editorial",
      assetId: "asset_real_suite_style_soft_editorial",
    },
  ];

  const refs = [];
  for (const spec of specs) {
    if (!fs.existsSync(spec.sourcePath)) {
      throw new Error(`Missing ${spec.role}/${spec.key} reference: ${spec.sourcePath}`);
    }
    const useOriginal = referenceMode === "original";
    const ext = useOriginal ? path.extname(spec.sourcePath).toLowerCase() || ".png" : ".jpg";
    const preparedPath = path.join(suiteDir, `ref-${spec.key}${useOriginal ? "-original" : ""}${ext}`);
    const generatedFileName = safeSlug(`real-agent-suite-${stamp}-ref-${spec.key}`, `ref-${spec.key}`) + ext;
    const generatedPath = path.join(generatedDir, generatedFileName);
    if (useOriginal) {
      await fsp.copyFile(spec.sourcePath, preparedPath);
    } else {
      await sharp.default(spec.sourcePath)
        .resize({
          width: spec.maxEdge,
          height: spec.maxEdge,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: spec.quality, mozjpeg: true })
        .toFile(preparedPath);
    }
    await fsp.copyFile(preparedPath, generatedPath);
    const buffer = await fsp.readFile(preparedPath);
    const mime = useOriginal && ext === ".png" ? "image/png" : "image/jpeg";
    refs.push({
      ...spec,
      preparedPath,
      generatedPath,
      publicUrl: `/api/generated-images/${encodeURIComponent(generatedFileName)}`,
      bytes: buffer.byteLength,
      dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
    });
  }
  return refs;
}

function buildPlanRequest(refs) {
  const byKey = Object.fromEntries(refs.map((ref) => [ref.key, ref]));
  const images = refs.map((ref) => ({
    role: ref.role,
    title: ref.title,
    url: ref.publicUrl,
    providerUsable: true,
    providerMode: "provider_input",
    source: "real-agent-suite",
    nodeId: ref.nodeId,
    assetId: ref.assetId,
  }));
  const referenceContext = {
    version: 1,
    source: "canvas-workbench",
    targetNodeId: frameNodeId,
    targetNodeLabel: "真实 Agent 全套宣传图测试",
    images,
    roles: {
      product: {
        role: "product",
        title: byKey.product.title,
        sourceNodeIds: [byKey.product.nodeId],
        componentIds: [],
        assetIds: [byKey.product.assetId],
        promptFragments: [
          "商品参考是身份锁定源：保留粉白毛绒小包的轮廓、比例、材质、手柄结构、五金、粉白拼色和柔软触感。",
          "不要把商品改成其他包型，不要新增品牌 logo，不要改变毛绒材质和粉白色块关系。",
        ],
        constraints: ["所有成片里商品必须是同一只包。", "商品尺寸要符合人体和桌面尺度。"],
        negativeRules: ["不要生成第二只主商品。", "不要虚构夸张 logo 或乱码文字。"],
        qualityRules: ["商品身份一致", "材质和结构可识别"],
      },
      model: {
        role: "model",
        title: byKey.model.title,
        sourceNodeIds: [byKey.model.nodeId],
        componentIds: [],
        assetIds: [byKey.model.assetId],
        promptFragments: [
          "模特参考只用于同一人的脸型、五官比例、发型轮廓、年龄感、身形和甜美气质。",
          "不要复制模卡里的固定神态、固定站姿、棚拍光、证件照眼神或模卡排版。",
          "每张图要像摄影师现场引导：给出一个确定动作、一个确定视线方向、一个确定重心和手部动作。",
        ],
        constraints: [
          "保持成年女性模特的自然、松弛、亲和气质。",
          "人物要被当前场景光线重新照亮，不要单独给脸补棚拍光。",
          "手和包的接触要自然，肩带或手柄要有受力关系。",
        ],
        negativeRules: ["不要僵硬模卡站姿。", "不要死盯镜头。", "不要廉价棚拍脸光。"],
        qualityRules: ["神态自然", "身体比例自然", "人物与场景光影一致"],
      },
      scene: {
        role: "scene",
        title: "三种可复用场景：室内、户外、商场",
        sourceNodeIds: [byKey.indoor.nodeId, byKey.outdoor.nodeId, byKey.mall.nodeId],
        componentIds: [],
        assetIds: [byKey.indoor.assetId, byKey.outdoor.assetId, byKey.mall.assetId],
        promptFragments: [
          "场景参考负责空间、光线、透视、背景密度、物体尺度和真实拍摄氛围。",
          "同一个商品在不同场景里要自然出现，不能像抠图贴上去。",
          "人物和商品都必须服从所选场景的环境光、阴影、色温和接触阴影。",
        ],
        constraints: ["场景应像真实地点拍摄。", "不要过度干净的电商合成背景。"],
        negativeRules: ["不要悬浮脚、悬浮包、边缘光晕或拼贴感。"],
        qualityRules: ["空间尺度可信", "接触阴影可信", "背景真实但不抢主体"],
      },
      style: {
        role: "style",
        title: byKey.style.title,
        sourceNodeIds: [byKey.style.nodeId],
        componentIds: [],
        assetIds: [byKey.style.assetId],
        promptFragments: [
          "风格只负责自然街拍质感、柔和商业完成度、颜色统一和真实摄影感。",
          "不要让风格覆盖商品身份、人物身份或场景光线。",
        ],
        constraints: ["整套图要像同一品牌 campaign。"],
        negativeRules: ["不要廉价模板感、强磨皮、塑料质感、过度锐化。"],
        qualityRules: ["自然摄影感", "统一但不重复"],
      },
      copy: {
        role: "copy",
        title: "结构化文案",
        sourceNodeIds: ["copy_brief_real_agent_suite"],
        componentIds: [],
        assetIds: [],
        promptFragments: [
          "画面文字候选：软萌轻巧；随身治愈；冬日绒感小包。",
          "卖点参数：粉白拼色、毛绒触感、轻量随身、小容量日常收纳、约会/通勤/逛街。",
          "禁止声明：不要夸大容量；不要写奢侈品牌；不要写医美、功效或虚假促销。",
          "默认文案是 layout/copy layer；只有带字海报和封面条目允许把短文案烧进图片。",
        ],
        constraints: ["可见文字必须短、清楚、少于两行。"],
        negativeRules: ["不要长段落。", "不要乱码。", "不要遮挡商品关键结构。"],
        qualityRules: ["文案可读", "版式留白合理"],
      },
    },
    promptFragments: [
      "做一整套粉白毛绒小包的多平台宣传图，不是单张 demo。",
      "Agent 应该根据每张图目的自动选择商品、模特、场景、风格和文案角色。",
      "商品身份优先；模特身份其次；场景光影和真实摄影感必须成立。",
    ],
    constraints: [
      "整套图视觉语言统一，但背景、动作、构图不要完全重复。",
      "图片比例要根据用途变化：方图、竖图、横图都要覆盖。",
      "产品主图和细节图不要出现模特；模特展示图必须有人和包。",
      "带字海报只允许短中文标题，不要密集小字。",
    ],
    negativeRules: [
      "不要拼贴图、教程标注、水印、乱码、假 logo。",
      "不要廉价电商合成感。",
      "不要让模特脸部像单独棚拍补光。",
    ],
    qualityRules: ["商品一致", "模特自然", "场景真实", "商业可用", "多比例输出"],
  };

  const allItems = [
    {
      itemId: "product-main-square",
      title: "商品主图-方图",
      type: "product_main",
      ratio: "1:1",
      size: "1024x1024",
      textAllowed: false,
      referenceRoles: ["product", "style"],
      providerReferenceRoles: ["product", "style"],
      prompt: [
        "生成一张电商商品主图。只有粉白毛绒小包，不要模特。",
        "浅米白或柔和白棚背景，真实摄影棚柔光，包完整清楚，毛绒材质、手柄、粉白拼色和五金都清楚。",
        "构图干净，不要文字，不要品牌 logo，不要第二个商品。",
      ].join(" "),
      qualityRules: ["商品形状一致", "白底/浅底主图可用", "材质清晰"],
    },
    {
      itemId: "product-detail-macro",
      title: "商品细节-材质特写",
      type: "product_detail",
      ratio: "1:1",
      size: "1024x1024",
      textAllowed: false,
      referenceRoles: ["product", "style"],
      providerReferenceRoles: ["product", "style"],
      prompt: [
        "生成一张商品材质和五金细节特写。不要模特。",
        "近距离拍摄粉白毛绒拼色边缘、手柄、拉链或金属扣件，能看到柔软绒毛纹理和精致做工。",
        "真实微距摄影、浅景深、柔和自然光，不要文字，不要改变商品结构。",
      ].join(" "),
      qualityRules: ["材质证据清楚", "五金/缝线自然", "商品身份一致"],
    },
    {
      itemId: "mall-model-showcase",
      title: "模特展示-商场橱窗",
      type: "model_showcase",
      ratio: "4:5",
      size: "1024x1536",
      modelRequired: true,
      textAllowed: false,
      referenceRoles: ["product", "model", "scene", "style"],
      providerReferenceRoles: ["product", "model", "scene", "style"],
      prompt: [
        "生成一张商场橱窗环境里的真实街拍感模特展示图。",
        "图中同一位年轻女性斜挎或手提粉白毛绒小包，身体微微侧向画面左侧，重心落在后脚，前脚自然迈出半步。",
        "她的头轻轻偏向画面右侧，眼睛看向镜头旁边的橱窗反光，不要死盯镜头；嘴角自然放松。",
        "商场光线要自然融入人物和包，包的粉白材质和手柄结构必须清楚。",
      ].join(" "),
      qualityRules: ["同一模特", "商品清楚", "商场真实光影", "自然姿态"],
    },
    {
      itemId: "indoor-seated-lifestyle",
      title: "场景图-室内坐姿",
      type: "lifestyle_scene",
      ratio: "4:5",
      size: "1024x1536",
      modelRequired: true,
      textAllowed: false,
      referenceRoles: ["product", "model", "scene", "style"],
      providerReferenceRoles: ["product", "model", "scene", "style"],
      prompt: [
        "生成一张室内咖啡/家居感生活方式图。",
        "同一位模特坐在桌边或窗边，粉白毛绒小包放在膝上或桌边，一只手轻扶包柄，另一只手自然整理袖口。",
        "头部微微低下，眼睛看向包的金属扣件，表情安静、松弛、有生活感。",
        "室内窗光负责脸、手、包和桌面的光影，接触阴影必须真实。",
      ].join(" "),
      qualityRules: ["室内光影一致", "手包接触自然", "表情不僵硬"],
    },
    {
      itemId: "outdoor-street-look",
      title: "场景图-户外花店街拍",
      type: "street_lifestyle",
      ratio: "4:5",
      size: "1024x1536",
      modelRequired: true,
      textAllowed: false,
      referenceRoles: ["product", "model", "scene", "style"],
      providerReferenceRoles: ["product", "model", "scene", "style"],
      prompt: [
        "生成一张户外花店门口的真实街拍感照片。",
        "同一位模特边走边回头，肩背粉白毛绒小包，身体有轻微动态，头发和裙摆有自然小幅度运动。",
        "她的眼睛看向镜头左侧路面上方，像听到朋友叫她后自然回头；笑意很轻，不要摆拍式大笑。",
        "户外自然光要统一照亮人物、包和背景，包不能变形。",
      ].join(" "),
      qualityRules: ["街拍真实", "动态自然", "商品不变形"],
    },
    {
      itemId: "taobao-feature-poster",
      title: "淘宝卖点海报-带字",
      type: "taobao_feature_poster",
      ratio: "4:5",
      size: "1024x1536",
      modelRequired: true,
      textAllowed: true,
      copyRenderMode: "burn_in",
      copyText: "画面文字：软萌轻巧｜随身治愈\n卖点参数：粉白拼色；毛绒触感；轻量随身；约会/通勤/逛街\n禁止声明：不要夸大容量；不要写奢侈品牌",
      referenceRoles: ["product", "model", "scene", "style", "copy"],
      providerReferenceRoles: ["product", "model", "scene", "style"],
      prompt: [
        "生成一张淘宝商品卖点海报，可以有短中文标题。",
        "画面主体是同一位模特在商场或温暖室内自然展示粉白毛绒小包，商品占画面重要位置。",
        "只放 1-2 行大字：软萌轻巧 / 随身治愈。文字必须清晰、少、不要乱码，不遮挡包。",
        "整体像精致淘宝详情页首屏海报，不要廉价促销模板，不要红黄爆炸贴纸。",
      ].join(" "),
      qualityRules: ["短文案可读", "商品主视觉清楚", "商业海报感"],
    },
    {
      itemId: "rednote-cover-vertical",
      title: "小红书封面-带标题",
      type: "rednote_cover",
      ratio: "4:5",
      size: "1024x1536",
      modelRequired: true,
      textAllowed: true,
      copyRenderMode: "burn_in",
      copyText: "画面文字：冬日绒感小包\n卖点参数：软糯毛绒；粉白配色；约会出街\n禁止声明：不要写虚假折扣",
      referenceRoles: ["product", "model", "scene", "style", "copy"],
      providerReferenceRoles: ["product", "model", "scene", "style"],
      prompt: [
        "生成一张小红书封面感竖图。",
        "同一位模特在室内或花店街景中展示粉白毛绒小包，构图亲近、柔软、真实，有生活方式笔记感。",
        "标题只写：冬日绒感小包。字体要简洁可读，留在画面上方或侧边留白处。",
        "不要过度电商合成，不要塑料皮肤，不要乱码。",
      ].join(" "),
      qualityRules: ["封面吸引力", "标题可读", "生活感"],
    },
    {
      itemId: "horizontal-campaign-banner",
      title: "横版活动 Banner",
      type: "campaign_banner",
      ratio: "3:2",
      size: "1536x1024",
      textAllowed: false,
      referenceRoles: ["product", "scene", "style"],
      providerReferenceRoles: ["product", "scene", "style"],
      prompt: [
        "生成一张横版品牌活动 Banner，无人物。",
        "粉白毛绒小包放在真实场景中的桌面或橱窗展示区，左侧或右侧留出干净文案空间，但不要实际写文字。",
        "横向构图，背景有真实空间层次和柔和光线，商品清楚、自然、有商业质感。",
      ].join(" "),
      qualityRules: ["横版构图", "留白可排版", "商品一致"],
    },
    {
      itemId: "taobao-detail-selling-copy",
      title: "淘宝详情卖点图-带字",
      type: "taobao_detail_selling",
      ratio: "4:5",
      size: "1024x1536",
      textAllowed: true,
      copyRenderMode: "burn_in",
      copyText: "画面文字：小身材 大容量\n卖点参数：毛绒触感；轻量斜挎；手机/口红/钥匙日常收纳；粉白拼色\n禁止声明：不要夸大容量；不要写防水、防盗等未证明能力",
      referenceRoles: ["product", "scene", "style", "copy"],
      providerReferenceRoles: ["product", "scene", "style"],
      prompt: [
        "生成一张淘宝详情页卖点图，重点解释粉白毛绒小包的日常收纳和柔软材质。",
        "画面主体是包放在室内桌面或浅色布面上，旁边可以有手机、钥匙、口红作为尺度参照，但不要变成杂乱平铺。",
        "只放 1-2 行中文大字：小身材 大容量。字要清楚、简洁、留白充足，不要密集参数表。",
        "商品结构、粉白拼色、毛绒材质和五金必须和参考图一致，不要虚构品牌 logo。",
      ].join(" "),
      qualityRules: ["卖点文案可读", "商品身份一致", "尺度参照可信", "详情页可用"],
    },
    {
      itemId: "outfit-match-copy-poster",
      title: "穿搭搭配图-带字",
      type: "outfit_match_poster",
      ratio: "4:5",
      size: "1024x1536",
      modelRequired: true,
      textAllowed: true,
      copyRenderMode: "burn_in",
      copyText: "画面文字：约会出街都好搭\n卖点参数：粉白配色；毛绒触感；轻量随身；甜美穿搭\n禁止声明：不要写奢侈品牌或虚假促销",
      referenceRoles: ["product", "model", "scene", "style", "copy"],
      providerReferenceRoles: ["product", "model", "scene", "style"],
      prompt: [
        "生成一张穿搭搭配感海报，像真实街拍后做了少量版式设计。",
        "同一位模特在户外花店或街边慢慢走，粉白毛绒小包斜挎在身侧，包和上半身都要清楚。",
        "动作要确定：身体微侧，右手轻扶肩带，左手自然下摆，眼睛看向街边花束上方，不要死盯镜头。",
        "画面文字只写：约会出街都好搭。放在留白处，字体简洁可读，不遮挡脸和包。",
        "整体真实、柔和、有生活感，不要廉价电商模板。",
      ].join(" "),
      qualityRules: ["穿搭关系明确", "短标题可读", "模特自然", "商品不变形"],
    },
  ];

  const items = filterItemsByMode(allItems, itemMode);

  return {
    workflowId,
    frameNodeId,
    batchId,
    batchTitle: "真实 Agent 全套宣传图测试",
    request: "为粉白毛绒小包生成一整套多平台宣传图：商品主图、材质细节、模特展示、室内/户外/商场场景、淘宝带字海报、淘宝详情卖点图、小红书封面、穿搭搭配图和横版 Banner。需要 Agent 自己选择每张图该用哪些素材角色，商品和模特保持一致，场景可变化，比例按用途变化，带字图要有清晰短文案。",
    platform: "multi_channel_agent_suite",
    style: "真实街拍 + 柔和商业完成度，不要廉价电商合成感",
    outputPacks: ["product_main", "detail", "model_showcase", "lifestyle", "taobao_poster", "taobao_detail", "rednote_cover", "outfit_match", "banner"],
    requiredReferenceRoles: ["product"],
    referenceContext,
    items,
  };
}

async function waitForServer(url) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 90_000) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) return;
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function waitForJobsDone(targetWorkflowId, expectedCount) {
  const started = Date.now();
  while (Date.now() - started < 30 * 60_000) {
    const jobs = await requestJson(`${baseUrl}/api/jobs?workflowId=${encodeURIComponent(targetWorkflowId)}&summary=1`, {}, 200, 30_000);
    const relevant = Array.isArray(jobs) ? jobs : [];
    if (relevant.length >= expectedCount) {
      const terminal = relevant.filter((job) => ["done", "completed", "failed", "cancelled"].includes(job.status));
      if (terminal.length >= expectedCount) return terminal.slice(0, expectedCount);
    }
    await sleep(3000);
  }
  throw new Error(`Timed out waiting for ${expectedCount} real agent suite jobs`);
}

async function retryFailedJobsIfNeeded(initialJobs, expectedCount) {
  let jobs = initialJobs;
  for (let attempt = 1; attempt <= failedJobRetryAttempts; attempt += 1) {
    const failedJobs = jobs.filter((job) => job.status === "failed");
    if (failedJobs.length === 0) break;
    console.log(`Retrying ${failedJobs.length} failed job(s), attempt ${attempt}/${failedJobRetryAttempts}.`);
    for (const job of failedJobs) {
      await requestJson(`${baseUrl}/api/jobs/${encodeURIComponent(job.id)}/retry`, {
        method: "POST",
      }, 200, 90_000);
      await requestJson(`${baseUrl}/api/jobs/${encodeURIComponent(job.id)}/run`, {
        method: "POST",
      }, 200, 90_000);
    }
    jobs = sortJobsByBatchIndex(await waitForJobsDone(workflowId, expectedCount));
  }
  return jobs;
}

async function requestJson(url, init = {}, expectedStatus = 200, timeoutMs = 120_000) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (response.status !== expectedStatus) {
    throw new Error(`Expected status ${expectedStatus}, got ${response.status}: ${JSON.stringify(payload).slice(0, 1600)}`);
  }
  return payload;
}

async function getBytes(url) {
  const response = await fetch(url.startsWith("http") ? url : `${baseUrl}${url}`, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`Image fetch failed ${response.status}: ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function createContactSheet(outputs) {
  const sharp = await import("sharp");
  const thumbWidth = 360;
  const labelHeight = 54;
  const gap = 18;
  const cols = 4;
  const rows = Math.ceil(outputs.length / cols);
  const cellWidth = thumbWidth;
  const cellHeight = thumbWidth + labelHeight;
  const width = cols * cellWidth + (cols + 1) * gap;
  const height = rows * cellHeight + (rows + 1) * gap;
  const composites = [];

  for (const [index, output] of outputs.entries()) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const left = gap + col * (cellWidth + gap);
    const top = gap + row * (cellHeight + gap);
    const thumb = await sharp.default(output.outputPath)
      .resize({ width: thumbWidth, height: thumbWidth, fit: "inside", background: "#f8f3ea" })
      .extend({
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        background: "#f8f3ea",
      })
      .png()
      .toBuffer();
    const labelSvg = Buffer.from(`
      <svg width="${thumbWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f8f3ea"/>
        <text x="10" y="22" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#30261e">${escapeXml(`${output.index}. ${output.title || output.itemId}`)}</text>
        <text x="10" y="43" font-family="Arial, sans-serif" font-size="13" fill="#7a6a5d">${escapeXml(`${output.size || ""} · refs ${output.providerReferenceCount ?? 0}`)}</text>
      </svg>
    `);
    composites.push({ input: thumb, left, top });
    composites.push({ input: labelSvg, left, top: top + thumbWidth });
  }

  const contactSheetPath = path.join(suiteDir, "contact-sheet.png");
  await sharp.default({
    create: {
      width,
      height,
      channels: 4,
      background: "#efe7da",
    },
  })
    .composite(composites)
    .png()
    .toFile(contactSheetPath);
  return contactSheetPath;
}

async function writeFailureReport(error) {
  if (fullReportWritten || fs.existsSync(reportPath)) return;
  const report = {
    ok: false,
    stage: "failed",
    error: error instanceof Error ? error.message : String(error),
    baseUrl,
    workflowId,
    batchId,
    reportPath,
  };
  await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function sortJobsByBatchIndex(jobs) {
  return [...jobs].sort((a, b) => {
    const ma = parseMetadata(a.metadata);
    const mb = parseMetadata(b.metadata);
    const ia = Number(ma.batchIndex);
    const ib = Number(mb.batchIndex);
    if (Number.isFinite(ia) && Number.isFinite(ib) && ia !== ib) return ia - ib;
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function summarizeJob(job) {
  const metadata = parseMetadata(job.metadata);
  return {
    jobId: job.id,
    status: job.status,
    error: job.error,
    title: metadata.planItemTitle,
    providerDiagnostics: metadata.providerDiagnostics,
    providerReferenceCount: metadata.providerReferenceCount,
    providerRoles: metadata.itemProviderReferenceRoles,
    agentAssetGroupIds: metadata.agentAssetGroupIds,
  };
}

function readLastProviderRequestId(metadata) {
  const ledger = Array.isArray(metadata.providerAttemptLedger) ? metadata.providerAttemptLedger : [];
  const latest = ledger.at(-1);
  return latest?.providerRequestId || latest?.requestId || undefined;
}

function safeHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return value || "unknown";
  }
}

function safeSlug(value, fallback) {
  return value
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || fallback;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeReferenceMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "compressed" || normalized === "optimized" || normalized === "small"
    ? "compressed"
    : "original";
}

function normalizeItemMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["mall-model", "mall_model", "model", "single"].includes(normalized)) return "mall-model";
  return "all";
}

function filterItemsByMode(items, mode) {
  if (mode === "mall-model") {
    return items.filter((item) => item.itemId === "mall-model-showcase");
  }
  return items;
}

function readNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
