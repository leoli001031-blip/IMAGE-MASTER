#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const BASE_URL = process.env.SWEET_BAG_BASE_URL || "http://127.0.0.1:3000";
const OUT_DIR = path.join(ROOT, "test_artifacts", "sweet-plush-bag-scene-set");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(OUT_DIR, stamp);
const reportPath = path.join(runDir, "report.json");

const sharedAssetRequests = [
  {
    key: "product",
    category: "product_asset",
    label: "毛绒小包商品资产",
    userRequest:
      "女生背的甜美毛绒小包商品资产。奶油白与浅粉色拼接，柔软短绒毛材质，小号半月形或云朵形包身，圆润短手柄，可拆细肩带，浅金色小五金，适合甜妹穿搭、电商详情页、商场街拍和室内生活方式图。生成白底多视角商品参考卡，展示正面、侧面、背面、手柄、肩带、五金、毛绒质感和容量比例。不要品牌 logo，不要复杂装饰。",
  },
  {
    key: "model",
    category: "model_asset",
    label: "甜妹系模特资产",
    userRequest:
      "23岁东亚女性甜妹系商业模特，成人，清甜自然但不幼态，柔和亲和，轻盈元气，长发微卷或自然披肩，干净淡妆，低对比漫反射光，适合女包、甜美穿搭和生活方式电商图。使用轻量模卡模板，四视图加一张清晰身份特写，背景不要纯白棚拍感，光线要柔和、低对比、可用于后续场景合成。",
  },
  {
    key: "style",
    category: "style_asset",
    label: "甜感女包商业摄影风格资产",
    userRequest:
      "甜感但高级的女包商业摄影风格资产。奶油白、浅粉、浅杏、柔和木色，低对比自然光，轻微胶片颗粒，真实毛绒材质，干净构图，适合淘宝、社媒、小红书和商场生活方式图。风格只提供色彩、镜头、材质和商业质感，不固定具体场景或人物。",
  },
];

const sceneAssetRequests = [
  {
    key: "indoor",
    title: "室内奶油风卧室/客厅",
    userRequest:
      "室内甜感生活方式场景资产。奶油风卧室或客厅，浅木地板，米白墙面，柔软床品或小沙发，浅粉抱枕，小圆桌，上午自然窗光，干净温柔，留出成人模特站立、坐姿和包包展示空间。不要人物，不要商品 hero，不要品牌文字。",
  },
  {
    key: "outdoor",
    title: "户外春日街角/花店",
    userRequest:
      "户外甜美女包生活方式场景资产。春日下午的安静街角或花店外，浅色街面、花束、玻璃橱窗、柔和逆光和自然阴影，画面清新但不杂乱，留出成人模特站立、行走和展示包包的空间。不要人物，不要商品 hero，不要品牌文字。",
  },
  {
    key: "mall",
    title: "商场中庭/精品店外",
    userRequest:
      "商场甜美女包商业摄影场景资产。明亮精品商场中庭或女装店外，浅色石材地面，奶油色橱窗，柔和顶光和橱窗反射，干净高级，留出成人模特全身展示和包包近景空间。不要人物，不要商品 hero，不要品牌文字。",
  },
];

const sceneShotGroups = [
  {
    sceneKey: "indoor",
    sceneTitle: "室内",
    shots: [
      {
        itemId: "indoor-standing-hero",
        title: "室内 · 站姿主视觉",
        type: "model_scene",
        ratio: "2:3",
        size: "1024x1536",
        copyText: "软糯小包，甜感日常",
        prompt:
          "Create a vertical premium e-commerce lifestyle photo. The same sweet East Asian adult female model is in the cream-toned indoor home scene, naturally wearing or holding the exact plush mini handbag. Full-body standing pose near soft window light, gentle smile, realistic scale, bag clearly visible at waist or shoulder height. Keep the bag's cream-white and light-pink plush texture, rounded small silhouette, short handle, detachable thin strap, and light-gold hardware recognizable. No text in the bitmap.",
      },
      {
        itemId: "indoor-seated-detail",
        title: "室内 · 坐姿细节",
        type: "model_detail",
        ratio: "3:2",
        size: "1536x1024",
        copyText: "毛绒触感 / 小巧容量",
        prompt:
          "Create a horizontal indoor lifestyle detail photo. The same model sits on a small cream sofa or bed edge in the indoor scene, holding the exact plush mini handbag on her lap with natural hands. Focus on tactile plush material, handle, strap, and small hardware while keeping her identity visible. Soft diffuse daylight, warm gentle mood, realistic hand-bag contact. No text in the bitmap.",
      },
      {
        itemId: "indoor-product-still",
        title: "室内 · 包包静物",
        type: "product_lifestyle",
        ratio: "3:2",
        size: "1536x1024",
        copyText: "甜而不腻的日常小包",
        prompt:
          "Create a horizontal product lifestyle still life in the same cream indoor scene. The exact plush mini handbag is placed on a small round table or soft chair, with gentle window light and subtle fabric props. Product is the hero, no model, no extra bag variants, no fake logo, no text. Preserve plush texture, rounded shape, handle, thin strap, and light-gold hardware.",
      },
    ],
  },
  {
    sceneKey: "outdoor",
    sceneTitle: "户外",
    shots: [
      {
        itemId: "outdoor-walk",
        title: "户外 · 春日轻走",
        type: "model_scene",
        ratio: "2:3",
        size: "1024x1536",
        copyText: "春日出门轻甜搭配",
        prompt:
          "Create a vertical outdoor lifestyle fashion photo. The same sweet East Asian adult female model walks naturally near the flower shop or soft street corner scene, carrying the exact plush mini handbag by its short handle. Full body, fresh spring daylight, believable street scale, bag clearly readable, natural face lighting from the scene. No text in the bitmap.",
      },
      {
        itemId: "outdoor-shoulder",
        title: "户外 · 肩背展示",
        type: "model_display",
        ratio: "2:3",
        size: "1024x1536",
        copyText: "小包也有造型感",
        prompt:
          "Create a vertical commercial fashion image outdoors. The same model stands slightly angled toward camera near a pastel storefront or flower display, wearing the exact plush mini handbag on one shoulder using the thin strap. Show upper body to full body, relaxed expression, bag scale and strap length believable. Keep product identity exact. No text in the bitmap.",
      },
      {
        itemId: "outdoor-closeup",
        title: "户外 · 手提近景",
        type: "product_detail",
        ratio: "3:2",
        size: "1536x1024",
        copyText: "短绒毛感 / 浅金五金",
        prompt:
          "Create a horizontal outdoor close-up commercial photo. The model's hand naturally holds the exact plush mini handbag near a flower shop window or soft street background. Crop from shoulder or waist down is okay, but hand contact must be realistic. Emphasize plush material, light-pink cream palette, handle, strap, and light-gold hardware. No text in the bitmap.",
      },
    ],
  },
  {
    sceneKey: "mall",
    sceneTitle: "商场",
    shots: [
      {
        itemId: "mall-entrance-hero",
        title: "商场 · 精品店外主图",
        type: "model_scene",
        ratio: "2:3",
        size: "1024x1536",
        copyText: "逛街约会都合适",
        prompt:
          "Create a vertical mall lifestyle commercial photo. The same sweet East Asian adult female model stands near a bright boutique storefront or mall atrium, holding or wearing the exact plush mini handbag. Full body, clean luxury mall light, polished but natural, product clearly readable, realistic reflections and floor contact. No text in the bitmap.",
      },
      {
        itemId: "mall-escalator-mid",
        title: "商场 · 中景穿搭",
        type: "model_display",
        ratio: "3:2",
        size: "1536x1024",
        copyText: "轻松提升穿搭甜度",
        prompt:
          "Create a horizontal mid-shot commercial lifestyle photo in the mall scene. The same model walks near a boutique corridor or escalator area, wearing the exact plush mini handbag crossbody or shoulder style. Keep face, hair, body proportion, and bag identity consistent. Bright soft mall light, no harsh studio face fill, no text in the bitmap.",
      },
      {
        itemId: "mall-counter-product",
        title: "商场 · 橱窗商品特写",
        type: "product_lifestyle",
        ratio: "1:1",
        size: "1024x1024",
        copyText: "毛绒小包，软萌有质感",
        prompt:
          "Create a square product close-up in a bright boutique mall setting. The exact plush mini handbag is placed on a clean counter or display shelf with soft reflections, no model. Keep the product's small rounded plush body, cream-white and light-pink color, short handle, thin strap, and light-gold hardware. No fake brand text, no extra variants, no text in the bitmap.",
      },
    ],
  },
];

async function main() {
  await fs.mkdir(runDir, { recursive: true });
  await waitForServer(`${BASE_URL}/api/settings`);
  const settings = await getJson("/api/settings");
  const assets = [];
  const outputs = [];
  const failures = [];
  const issues = [];

  console.log(`Sweet plush bag scene-set test started: ${stamp}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Provider: ${settings.imageModel || "unknown"} @ ${safeHost(settings.imageBaseUrl || settings.baseUrl || "")}`);

  for (const spec of [...sharedAssetRequests, ...sceneAssetRequests.map((scene) => ({ ...scene, category: "scene_asset", label: scene.title }))]) {
    const asset = await generateAsset(spec, issues);
    assets.push(asset);
  }

  const commonAssets = {
    product: assets.find((asset) => asset.key === "product"),
    model: assets.find((asset) => asset.key === "model"),
    style: assets.find((asset) => asset.key === "style"),
  };

  for (const group of sceneShotGroups) {
    const scene = assets.find((asset) => asset.key === group.sceneKey);
    const referenceContext = buildReferenceContext({ ...commonAssets, scene }, group);
    const workflowId = `sweet_plush_bag_${stamp}_${group.sceneKey}`;
    const payload = {
      workflowId,
      frameNodeId: `frame_${workflowId}`,
      batchId: `batch_${workflowId}`,
      batchTitle: `Sweet plush bag ${group.sceneTitle}`,
      platform: "sweet_plush_bag_real_test",
      style: "sweet premium plush handbag commercial campaign",
      modelIds: ["sweet-east-asian-model"],
      requiredReferenceRoles: ["product", "model", "scene", "style"],
      referenceContext,
      items: group.shots.map((shot, index) => ({
        ...shot,
        referenceRoles: ["product", "model", "scene", "style"],
        providerReferenceRoles: shot.type.startsWith("product") ? ["product", "scene", "style"] : ["product", "model", "scene", "style"],
        metadata: {
          sceneKey: group.sceneKey,
          sceneTitle: group.sceneTitle,
          batchIndex: index,
        },
      })),
      enqueue: true,
      confirmedProviderCallLimit: group.shots.length,
    };
    const committed = await postJson("/api/generation-plans/run", payload, 201, 90_000);
    if (!committed.ok || !committed.queued) {
      issues.push({ stage: "batch-run", group: group.sceneKey, committed });
      throw new Error(`Batch run failed for ${group.sceneKey}: ${JSON.stringify(committed).slice(0, 1000)}`);
    }
    console.log(`Queued ${group.sceneTitle}: ${group.shots.length} jobs`);
    const jobs = await waitForJobsDone(workflowId, group.shots.length, 35 * 60_000);
    for (const job of jobs) {
      const metadata = parseMetadata(job.metadata);
      if (job.status !== "done" || !job.resultUrl) {
        failures.push(summarizeJob(job));
        continue;
      }
      const index = outputs.length + 1;
      const slug = `${String(index).padStart(2, "0")}-${group.sceneKey}-${metadata.planItemId || job.id}`;
      const file = await savePublicImage(job.resultUrl, slug);
      outputs.push({
        index,
        sceneKey: group.sceneKey,
        sceneTitle: group.sceneTitle,
        jobId: job.id,
        itemId: metadata.planItemId,
        title: metadata.planItemTitle,
        type: metadata.planItemType,
        ratio: metadata.ratio,
        expectedSize: metadata.size,
        outputPath: file.outputPath,
        resultUrl: job.resultUrl,
        bytes: file.bytes,
        dimensions: file.dimensions,
        copyText: metadata.copyText,
        providerImageRoles: Array.isArray(metadata.providerReferenceAdapter?.providerUsableImages)
          ? metadata.providerReferenceAdapter.providerUsableImages.map((image) => image.role)
          : [],
        promptOnlyReferenceCount: Array.isArray(metadata.promptOnlyReferenceImages)
          ? metadata.promptOnlyReferenceImages.length
          : 0,
        sizeOk: metadata.size ? dimensionsMatch(file.dimensions, metadata.size) : true,
      });
    }
  }

  const contactSheetPath = outputs.length > 0 ? await buildContactSheet(outputs) : null;
  const desktopDir = await copyForReview(outputs, contactSheetPath);
  const report = {
    ok: failures.length === 0 && outputs.length === 9,
    stamp,
    baseUrl: BASE_URL,
    provider: {
      imageModel: settings.imageModel,
      imageBaseUrl: safeHost(settings.imageBaseUrl || settings.baseUrl || ""),
    },
    assets,
    outputs,
    failures,
    issues,
    contactSheetPath,
    desktopDir,
    reportPath,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Sweet plush bag scene-set finished. Success=${outputs.length}, failures=${failures.length}`);
  if (contactSheetPath) console.log(`Contact sheet: ${contactSheetPath}`);
  if (desktopDir) console.log(`Desktop review folder: ${desktopDir}`);
  console.log(`Report: ${reportPath}`);
  if (report.ok) return;
  throw new Error(`Expected 9 successful outputs; got ${outputs.length} success and ${failures.length} failures.`);
}

async function generateAsset(spec, issues) {
  console.log(`Asset dry-run: ${spec.label}`);
  const dryRun = await postJson("/api/asset-packs/generate", {
    category: spec.category,
    userRequest: spec.userRequest,
    dryRun: true,
  });
  if (!dryRun.ok) {
    issues.push({ stage: "asset-dry-run", key: spec.key, category: spec.category, error: dryRun.error || "unknown" });
    throw new Error(`Asset dry-run failed for ${spec.key}: ${JSON.stringify(dryRun).slice(0, 800)}`);
  }
  console.log(`Asset generate: ${spec.label}`);
  const real = await postJson("/api/asset-packs/generate", {
    category: spec.category,
    userRequest: spec.userRequest,
    dryRun: false,
    confirmedProviderCallLimit: Math.max(1, dryRun.estimate?.providerCallCount ?? 1),
  }, 200, 15 * 60_000);
  if (!real.ok || !real.referenceImage?.url) {
    issues.push({
      stage: "asset-real",
      key: spec.key,
      category: spec.category,
      error: real.error || "unknown",
      code: real.code,
      diagnostics: real.providerDiagnostics,
    });
    throw new Error(`Asset generation failed for ${spec.key}: ${JSON.stringify(real).slice(0, 1200)}`);
  }
  const file = await savePublicImage(real.referenceImage.url, `asset-${spec.key}-${spec.category}`);
  const asset = {
    key: spec.key,
    category: spec.category,
    label: spec.label,
    title: real.assetPack?.title || spec.label,
    url: real.referenceImage.url,
    outputPath: file.outputPath,
    bytes: file.bytes,
    dimensions: file.dimensions,
    outputSize: real.generationPlan?.outputSize,
    outputRatio: real.generationPlan?.outputRatio,
    providerTrace: real.referenceImage?.metadata?.providerTrace,
    estimate: real.estimate,
  };
  console.log(`Asset ready: ${asset.label} ${asset.dimensions?.width || "?"}x${asset.dimensions?.height || "?"} ${asset.outputPath}`);
  return asset;
}

function buildReferenceContext(assets, group) {
  const images = [
    { role: "product", title: assets.product.title, url: assets.product.url, providerUsable: true, providerMode: "provider_input", source: "sweet-plush-bag-test" },
    { role: "model", title: assets.model.title, url: assets.model.url, providerUsable: true, providerMode: "provider_input", source: "sweet-plush-bag-test" },
    { role: "scene", title: assets.scene.title, url: assets.scene.url, providerUsable: true, providerMode: "provider_input", source: "sweet-plush-bag-test" },
    { role: "style", title: assets.style.title, url: assets.style.url, providerUsable: true, providerMode: "provider_input", source: "sweet-plush-bag-test" },
  ];
  return {
    version: 1,
    source: "canvas-workbench",
    targetNodeId: `sweet_plush_bag_frame_${stamp}_${group.sceneKey}`,
    targetNodeLabel: `Sweet plush bag ${group.sceneTitle}`,
    images,
    roles: {
      product: {
        role: "product",
        title: assets.product.title,
        sourceNodeIds: ["sweet-product"],
        componentIds: [],
        assetIds: [],
        promptFragments: [
          "Use the product asset as the exact plush mini handbag identity source.",
          "Preserve the cream-white and light-pink plush material, rounded small bag body, short handle, thin detachable strap, light-gold hardware, and compact scale.",
        ],
        constraints: [
          "The product is a plush mini handbag, not a clothing item, backpack, tote, pillow, pet, toy, or cosmetic pouch.",
          "Do not invent brand logos, extra variants, extra straps, or unrelated decorations.",
        ],
        negativeRules: ["No fake brand text, no wrong bag category, no hard leather replacement, no extra products."],
        qualityRules: ["Bag silhouette, plush texture, handle, strap, hardware, and scale must remain recognizable."],
      },
      model: {
        role: "model",
        title: assets.model.title,
        sourceNodeIds: ["sweet-model"],
        componentIds: [],
        assetIds: [],
        promptFragments: [
          "Use the model asset for the same adult sweet East Asian female model identity, hair family, body proportion, and approachable commercial temperament.",
          "Do not copy the model-card layout, panels, or reference-sheet composition.",
        ],
        constraints: [
          "Keep her adult age impression and natural sweet style; do not make her childlike.",
          "When she appears, she should naturally hold, shoulder-wear, or crossbody-wear the handbag.",
          "Relight face, hair, hands, body, and bag using the active scene lighting.",
        ],
        negativeRules: ["No duplicate limbs, no distorted hands, no face-only studio fill, no pasted-on model, no childish styling."],
        qualityRules: ["Natural scale, believable hand-bag contact, clean expression, and coherent anatomy."],
      },
      scene: {
        role: "scene",
        title: assets.scene.title,
        sourceNodeIds: [`sweet-scene-${group.sceneKey}`],
        componentIds: [],
        assetIds: [],
        promptFragments: [
          `Use the scene asset as the ${group.sceneTitle} environment, lighting, material, camera-height, and placement authority.`,
          "The scene should guide environment and light; it should not override model identity or bag identity.",
        ],
        constraints: [
          "Keep model and bag scale believable relative to floor, walls, furniture, storefronts, or mall architecture.",
          "Use realistic contact shadows and consistent light direction.",
        ],
        negativeRules: ["No impossible perspective, no floating feet, no mismatched shadows, no unrelated busy crowd."],
        qualityRules: ["Commercial sweet handbag campaign atmosphere, clean but not empty."],
      },
      style: {
        role: "style",
        title: assets.style.title,
        sourceNodeIds: ["sweet-style"],
        componentIds: [],
        assetIds: [],
        promptFragments: [
          "Use the style asset only for soft premium sweet commercial finish, cream/pink/apricot palette, low-contrast daylight, tactile plush realism, gentle grain, and clean composition.",
        ],
        constraints: ["Style must not override bag identity, model identity, or active scene lighting."],
        negativeRules: ["No busy collage, no fake UI, no unreadable excess text."],
        qualityRules: ["Consistent sweet premium campaign language across indoor, outdoor, and mall scenes."],
      },
    },
    promptFragments: [
      `Sweet plush bag real test: create three finished campaign images for the ${group.sceneTitle} scene.`,
    ],
    constraints: [
      "Outputs should be commercially usable, visually coherent, and based on newly generated assets.",
      "Do not reuse old artifacts as visual source references.",
      "Default copy should remain metadata/layout copy; do not burn text unless the item prompt explicitly asks for bitmap text.",
    ],
    negativeRules: ["No watermark, no fake brand logo, no extra unrelated product, no childlike model."],
    qualityRules: ["Readable product hierarchy, correct image ratio, model/bag consistency, coherent lighting, and clean commercial composition."],
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

async function waitForJobsDone(workflowId, expectedCount, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const jobs = await getJson(`/api/jobs?workflowId=${encodeURIComponent(workflowId)}`);
    const relevant = Array.isArray(jobs) ? jobs : [];
    const terminal = relevant.filter((job) => ["done", "completed", "failed", "cancelled"].includes(job.status));
    const statusCounts = relevant.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    }, {});
    process.stdout.write(`\r${workflowId}: ${JSON.stringify(statusCounts)}   `);
    if (relevant.length >= expectedCount && terminal.length >= expectedCount) {
      process.stdout.write("\n");
      return terminal
        .sort((a, b) => Number(parseMetadata(a.metadata).batchIndex || 0) - Number(parseMetadata(b.metadata).batchIndex || 0))
        .slice(0, expectedCount);
    }
    await sleep(3000);
  }
  process.stdout.write("\n");
  throw new Error(`Timed out waiting for ${expectedCount} jobs in ${workflowId}`);
}

async function getJson(route) {
  const response = await fetch(route.startsWith("http") ? route : `${BASE_URL}${route}`, {
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${route} failed ${response.status}: ${JSON.stringify(payload).slice(0, 1000)}`);
  return payload;
}

async function postJson(route, body, expectedStatus = 200, timeoutMs = 120_000) {
  const response = await fetch(route.startsWith("http") ? route : `${BASE_URL}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (response.status !== expectedStatus) {
    throw new Error(`${route} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(payload).slice(0, 1200)}`);
  }
  return payload;
}

async function savePublicImage(url, slug) {
  const response = await fetch(url.startsWith("http") ? url : `${BASE_URL}${url}`, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Image fetch failed ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const safeSlug = slug.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  const outputPath = path.join(runDir, `${safeSlug}.png`);
  await fs.writeFile(outputPath, bytes);
  return {
    outputPath,
    bytes: bytes.length,
    dimensions: readPngDimensions(bytes),
  };
}

async function buildContactSheet(outputs) {
  const sharp = await import("sharp");
  const thumbW = 380;
  const thumbH = 360;
  const labelH = 62;
  const cols = 3;
  const gap = 18;
  const rows = Math.ceil(outputs.length / cols);
  const width = cols * thumbW + (cols + 1) * gap;
  const height = rows * (thumbH + labelH) + (rows + 1) * gap;
  const composites = [];

  for (const [index, output] of outputs.entries()) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = gap + col * (thumbW + gap);
    const y = gap + row * (thumbH + labelH + gap);
    const image = await sharp.default(output.outputPath)
      .resize({ width: thumbW, height: thumbH, fit: "contain", background: "#f8f1ed" })
      .png()
      .toBuffer();
    composites.push({ input: image, left: x, top: y });
    composites.push({
      input: Buffer.from(labelSvg(thumbW, labelH, `${index + 1}. ${output.title}`, `${output.sceneTitle} · ${output.type} · ${output.dimensions?.width || "?"}x${output.dimensions?.height || "?"}`)),
      left: x,
      top: y + thumbH,
    });
  }

  const contactSheetPath = path.join(runDir, "contact-sheet.png");
  await sharp.default({
    create: {
      width,
      height,
      channels: 4,
      background: "#eaded6",
    },
  })
    .composite(composites)
    .png()
    .toFile(contactSheetPath);
  return contactSheetPath;
}

async function copyForReview(outputs, contactSheetPath) {
  const desktopDir = path.join(path.dirname(ROOT), "甜妹毛绒小包三场景测试");
  await fs.rm(desktopDir, { recursive: true, force: true });
  await fs.mkdir(desktopDir, { recursive: true });
  if (contactSheetPath) await fs.copyFile(contactSheetPath, path.join(desktopDir, "contact-sheet.png"));
  for (const output of outputs) {
    const fileName = `${String(output.index).padStart(2, "0")}-${output.sceneKey}-${sanitizeFileName(output.title)}.png`;
    await fs.copyFile(output.outputPath, path.join(desktopDir, fileName));
  }
  return desktopDir;
}

function readPngDimensions(buffer) {
  if (buffer.length < 24) return undefined;
  if (buffer.toString("ascii", 1, 4) !== "PNG") return undefined;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function dimensionsMatch(dimensions, expectedSize) {
  if (!dimensions || !expectedSize) return false;
  const [width, height] = String(expectedSize).split("x").map((value) => Number(value));
  return dimensions.width === width && dimensions.height === height;
}

function summarizeJob(job) {
  const metadata = parseMetadata(job.metadata);
  return {
    jobId: job.id,
    status: job.status,
    error: job.error,
    itemId: metadata.planItemId,
    title: metadata.planItemTitle,
    providerDiagnostics: metadata.providerDiagnostics,
    providerReferenceCount: metadata.providerReferenceCount,
    providerReferenceRole: metadata.providerReferenceRole,
  };
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

function labelSvg(width, height, title, subtitle) {
  return `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#fffaf7"/>
  <text x="12" y="24" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#31221f">${escapeXml(truncate(title, 34))}</text>
  <text x="12" y="47" font-family="Arial, sans-serif" font-size="12" fill="#7d665f">${escapeXml(truncate(subtitle, 48))}</text>
</svg>`;
}

function safeHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return "unknown";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function sanitizeFileName(value) {
  return String(value).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 80);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

main().catch(async (error) => {
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    reportPath,
  }, null, 2)}\n`).catch(() => undefined);
  console.error(error);
  process.exit(1);
});
