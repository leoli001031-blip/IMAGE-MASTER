#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const BASE_URL = process.env.FRESH_FULL_PACK_BASE_URL || "http://127.0.0.1:3000";
const OUT_DIR = path.join(ROOT, "test_artifacts", "fresh-full-pack");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(OUT_DIR, stamp);
const reportPath = path.join(runDir, "report.json");
const MIN_SUCCESSFUL_FINALS = Number(process.env.FRESH_FULL_PACK_MIN_SUCCESS || 15);
const ASSET_PROVIDER_CALL_LIMIT = Math.max(
  1,
  Number(process.env.FRESH_FULL_PACK_ASSET_CALL_LIMIT || 3)
);
const ASSET_URL_OVERRIDES = {
  product_asset: process.env.FRESH_FULL_PACK_PRODUCT_URL,
  model_asset: process.env.FRESH_FULL_PACK_MODEL_URL,
  scene_asset: process.env.FRESH_FULL_PACK_SCENE_URL,
  style_asset: process.env.FRESH_FULL_PACK_STYLE_URL,
};
const BATCH_FILTER = (process.env.FRESH_FULL_PACK_BATCH_FILTER || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const assetRequests = [
  {
    category: "product_asset",
    label: "商品资产",
    userRequest:
      "高端城市机能短款羽绒服商品资产。石墨黑与深灰拼接，哑光防泼水尼龙，立领，可拆卸帽，压胶拉链，袖口魔术贴，内侧保暖绗缝，适合淘宝冬季服装全套宣传图。生成白底多视角商品参考卡，展示正面、侧面、背面、面料纹理、拉链、袖口和帽领结构。",
  },
  {
    category: "model_asset",
    label: "模特资产",
    userRequest:
      "24岁东亚女性商业模特，年轻自然，低对比漫反射光，干净亲和，适合作为冬季服装和商品图合成的模特资产。使用轻量模卡模板，四视图加清晰身份特写。",
  },
  {
    category: "scene_asset",
    label: "场景资产",
    userRequest:
      "冬季高端度假酒店与雪山窗景的商业摄影场景资产。室内有浅木地板、米白墙面、落地窗、远处雪山、柔和冷暖混合自然光，留出模特站立和商品展示区域，适合淘宝服装详情页、海报和模特展示图。",
  },
  {
    category: "style_asset",
    label: "风格资产",
    userRequest:
      "高级冬季户外服装商业摄影风格资产。低饱和黑灰白，冷暖平衡，真实面料质感，轻微胶片颗粒，淘宝详情页和小红书封面都可用，画面干净但有高级感。",
  },
];

const finalItems = [
  {
    itemId: "taobao-main-white",
    title: "淘宝主图 · 白底完整款",
    type: "taobao_main",
    ratio: "1:1",
    size: "1024x1024",
    referenceRoles: ["product", "style"],
    providerReferenceRoles: ["product"],
    copyText: "冬季高保暖 通勤也轻盈",
    prompt:
      "Create a square Taobao main product image of the exact down jacket. White or very light gray background, full jacket visible, front 3/4 angle, crisp silhouette, matte black nylon texture, hood and taped zipper clearly visible. Include only one clean Chinese headline: 冬季高保暖. No model, no extra product variants, no fake logo.",
  },
  {
    itemId: "product-multiview",
    title: "商品图 · 多角度白底",
    type: "product_reference",
    ratio: "3:2",
    size: "1536x1024",
    referenceRoles: ["product"],
    providerReferenceRoles: ["product"],
    copyText: "正面 / 侧面 / 背面 / 细节",
    prompt:
      "Create a wide white-background product sheet for the exact down jacket. Show front, side, back, hood detail, zipper detail, cuff detail, and fabric texture close-up. Keep the same single jacket design, graphite black matte nylon, no model, no text labels, no extra color variants.",
  },
  {
    itemId: "material-closeup",
    title: "细节图 · 面料与拉链",
    type: "detail",
    ratio: "3:2",
    size: "1536x1024",
    referenceRoles: ["product", "style"],
    providerReferenceRoles: ["product", "style"],
    copyText: "防泼水面料 / 压胶拉链",
    prompt:
      "Create a premium horizontal macro detail image of the same down jacket. Focus on matte water-resistant nylon fabric, taped zipper, stitching, cuff closure, and subtle insulation quilting. Add small clean Chinese overlay text: 防泼水面料 and 压胶拉链. No fake brand logo, no model, no unrelated props.",
  },
  {
    itemId: "thermal-feature",
    title: "卖点海报 · 锁温结构",
    type: "feature_poster",
    ratio: "2:3",
    size: "1024x1536",
    referenceRoles: ["product", "style"],
    providerReferenceRoles: ["product", "style"],
    copyText: "锁住热量，轻盈不臃肿",
    prompt:
      "Create a vertical Taobao feature poster for the same down jacket. Show the jacket floating or on a minimal hanger-like invisible support with a subtle cutaway-inspired warmth visual, not technical clutter. Include readable Chinese headline: 锁住热量，轻盈不臃肿. Premium black-gray winter palette, no model.",
  },
  {
    itemId: "model-front",
    title: "模特展示 · 正面穿搭",
    type: "model_display",
    ratio: "2:3",
    size: "1024x1536",
    referenceRoles: ["product", "model", "scene", "style"],
    providerReferenceRoles: ["product", "model", "scene", "style"],
    copyText: "通勤保暖上身效果",
    prompt:
      "Create a vertical commercial fashion photo. The same young East Asian model wears the exact graphite black down jacket in the winter lodge scene. Front-facing relaxed standing pose, full body, realistic human scale, jacket shape and hood visible. Match the scene window light and floor contact shadows. No text.",
  },
  {
    itemId: "model-side",
    title: "模特展示 · 侧身轮廓",
    type: "model_display",
    ratio: "2:3",
    size: "1024x1536",
    referenceRoles: ["product", "model", "scene", "style"],
    providerReferenceRoles: ["product", "model", "scene", "style"],
    copyText: "不臃肿的侧身轮廓",
    prompt:
      "Create a vertical fashion catalog photo in the same winter lodge scene. The same model wears the exact down jacket, side 3/4 walking pose, showing sleeve, side seam, hood volume, and natural waist proportion. Keep face naturally lit by scene daylight, no studio face fill, no text.",
  },
  {
    itemId: "model-back-hood",
    title: "模特展示 · 背面帽领",
    type: "model_display",
    ratio: "2:3",
    size: "1024x1536",
    referenceRoles: ["product", "model", "scene", "style"],
    providerReferenceRoles: ["product", "model", "scene", "style"],
    copyText: "背面帽领与肩线",
    prompt:
      "Create a vertical back-view model display image. Same young East Asian model wearing the exact down jacket, turned slightly back toward camera so hood, collar, shoulder line, back quilting, and length are clear. Same winter lodge scene and natural light. No text.",
  },
  {
    itemId: "snow-window-lifestyle",
    title: "场景图 · 雪山窗边",
    type: "lifestyle",
    ratio: "3:2",
    size: "1536x1024",
    referenceRoles: ["product", "model", "scene", "style"],
    providerReferenceRoles: ["product", "model", "scene", "style"],
    copyText: "雪山旅途中也保持轻暖",
    prompt:
      "Create a wide lifestyle commercial photo. The model wearing the exact down jacket stands near the lodge window with distant snow mountains visible. Product is clearly readable but integrated naturally. Premium quiet winter mood, believable scale, environmental daylight, no text.",
  },
  {
    itemId: "xiaohongshu-cover",
    title: "小红书封面 · 冬季通勤",
    type: "rednote_cover",
    ratio: "2:3",
    size: "1024x1536",
    referenceRoles: ["product", "model", "scene", "style"],
    providerReferenceRoles: ["product", "model", "scene", "style"],
    copyText: "冬天通勤不臃肿",
    prompt:
      "Create a vertical Xiaohongshu cover. Same model wearing the exact down jacket, clean winter lodge/snow-window background, stylish but practical. Include large readable Chinese title: 冬天通勤不臃肿 and small subtitle: 轻暖机能羽绒服. Leave generous safe margins, no extra text.",
  },
  {
    itemId: "taobao-detail-structure",
    title: "详情页 · 结构拆解",
    type: "detail_page",
    ratio: "2:3",
    size: "1024x1536",
    referenceRoles: ["product", "style"],
    providerReferenceRoles: ["product", "style"],
    copyText: "帽领 / 拉链 / 袖口 / 内胆",
    prompt:
      "Create a vertical Taobao detail-page module for the exact down jacket. Use one hero jacket view plus four clean detail callouts for hood collar, taped zipper, adjustable cuff, and warm inner quilting. Chinese text labels should be short and readable: 可拆帽, 压胶拉链, 调节袖口, 保暖内胆. No model.",
  },
  {
    itemId: "banner-store",
    title: "店铺横幅 · 冬季上新",
    type: "banner",
    ratio: "3:2",
    size: "1536x1024",
    referenceRoles: ["product", "scene", "style"],
    providerReferenceRoles: ["product", "scene", "style"],
    copyText: "冬季轻暖上新",
    prompt:
      "Create a wide ecommerce store banner. The exact down jacket is the hero product in the winter lodge and snow mountain visual language. Premium black-gray palette, clean negative space on the right. Include Chinese headline: 冬季轻暖上新 and small copy: 城市通勤 / 雪山旅行. No model.",
  },
  {
    itemId: "amazon-clean",
    title: "平台主图 · 干净无字",
    type: "marketplace_main",
    ratio: "1:1",
    size: "1024x1024",
    referenceRoles: ["product"],
    providerReferenceRoles: ["product"],
    copyText: "",
    prompt:
      "Create a clean marketplace main image of the exact down jacket on pure white background. Square format, full product visible, no text, no props, no model, no shadows that violate marketplace rules, accurate graphite black material and hood structure.",
  },
  {
    itemId: "poster-coldproof",
    title: "海报 · 抗寒氛围",
    type: "poster",
    ratio: "2:3",
    size: "1024x1536",
    referenceRoles: ["product", "scene", "style"],
    providerReferenceRoles: ["product", "scene", "style"],
    copyText: "轻装上阵，应对寒风",
    prompt:
      "Create a vertical winter campaign poster for the exact down jacket. Snow mountain lodge mood, product hero floating naturally or displayed on minimal form, dramatic but premium cold air atmosphere. Include readable Chinese headline: 轻装上阵，应对寒风. No model.",
  },
  {
    itemId: "model-close-half",
    title: "半身图 · 手部拉链动作",
    type: "model_detail",
    ratio: "2:3",
    size: "1024x1536",
    referenceRoles: ["product", "model", "scene", "style"],
    providerReferenceRoles: ["product", "model", "scene", "style"],
    copyText: "细节经得起近看",
    prompt:
      "Create a vertical half-body commercial detail shot. Same model wearing the exact down jacket, one hand naturally adjusting the taped zipper near the collar. Show fabric, zipper, cuff, and face under the same scene light. Realistic fingers and garment contact. No text.",
  },
  {
    itemId: "outdoor-doorway",
    title: "场景图 · 门廊外出",
    type: "lifestyle",
    ratio: "3:2",
    size: "1536x1024",
    referenceRoles: ["product", "model", "scene", "style"],
    providerReferenceRoles: ["product", "model", "scene", "style"],
    copyText: "从室内到户外的轻暖过渡",
    prompt:
      "Create a wide commercial lifestyle photo. Same model wearing the exact down jacket, stepping from the warm lodge doorway toward a snowy outdoor path. Product silhouette clear, natural body scale, jacket material visible, consistent cold daylight and warm indoor bounce. No text.",
  },
  {
    itemId: "square-social-benefits",
    title: "社媒方图 · 三卖点",
    type: "social_square",
    ratio: "1:1",
    size: "1024x1024",
    referenceRoles: ["product", "style"],
    providerReferenceRoles: ["product", "style"],
    copyText: "轻暖 / 防泼 / 不臃肿",
    prompt:
      "Create a square social commerce product graphic for the exact down jacket. Clean premium product hero with three short Chinese benefit chips: 轻暖, 防泼, 不臃肿. Keep the jacket accurate and readable, no model, no fake brand text.",
  },
  {
    itemId: "detail-insulation",
    title: "详情页 · 内胆保暖",
    type: "detail_page",
    ratio: "2:3",
    size: "1024x1536",
    referenceRoles: ["product", "style"],
    providerReferenceRoles: ["product", "style"],
    copyText: "轻量填充，锁温不压身",
    prompt:
      "Create a vertical product detail module showing the inner quilting and insulation feeling of the exact down jacket. Use realistic close-up panels, subtle warm light, clean Chinese headline: 轻量填充，锁温不压身. No model, no unrelated product.",
  },
  {
    itemId: "model-seated",
    title: "模特图 · 休息区坐姿",
    type: "model_scene",
    ratio: "3:2",
    size: "1536x1024",
    referenceRoles: ["product", "model", "scene", "style"],
    providerReferenceRoles: ["product", "model", "scene", "style"],
    copyText: "日常休息也有型",
    prompt:
      "Create a wide commercial photo. Same model wearing the exact down jacket, seated naturally in the winter lodge lounge area, snow mountain light from the window. Jacket should not deform while seated; sleeves, collar, and front zipper visible. No text.",
  },
  {
    itemId: "comparison-lightweight",
    title: "卖点图 · 轻盈对比",
    type: "feature_poster",
    ratio: "2:3",
    size: "1024x1536",
    referenceRoles: ["product", "style"],
    providerReferenceRoles: ["product", "style"],
    copyText: "轻盈不压身",
    prompt:
      "Create a vertical feature poster for the exact down jacket emphasizing lightness. Product hero with airy fabric movement and clean graphic space, not a literal scale chart. Include Chinese headline: 轻盈不压身. No model, no fake claims, no numbers.",
  },
  {
    itemId: "textless-hero",
    title: "无字主视觉 · 高级氛围",
    type: "textless_hero",
    ratio: "3:2",
    size: "1536x1024",
    referenceRoles: ["product", "scene", "style"],
    providerReferenceRoles: ["product", "scene", "style"],
    copyText: "",
    prompt:
      "Create a wide premium textless hero image for the exact down jacket. Product displayed in the winter lodge/snow mountain atmosphere, strong commercial finish, clean negative space, no model, no text, no watermark.",
  },
];

async function main() {
  await fs.mkdir(runDir, { recursive: true });
  await waitForServer(`${BASE_URL}/api/settings`);
  const settings = await getJson("/api/settings");
  const assets = [];
  const issues = [];

  console.log(`Fresh full-pack test started: ${stamp}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Provider: ${settings.imageModel || "unknown"} @ ${safeHost(settings.imageBaseUrl || settings.baseUrl || "")}`);

  for (const spec of assetRequests) {
    const overrideUrl = ASSET_URL_OVERRIDES[spec.category];
    if (overrideUrl) {
      const file = await savePublicImage(overrideUrl, `asset-${spec.category}`);
      const asset = {
        category: spec.category,
        label: spec.label,
        title: spec.label,
        url: overrideUrl,
        outputPath: file.outputPath,
        bytes: file.bytes,
        dimensions: file.dimensions,
        outputSize: `${file.dimensions?.width || "?"}x${file.dimensions?.height || "?"}`,
        outputRatio: undefined,
        providerTrace: { source: "env-override" },
        estimate: { providerCallCountUsed: 0 },
      };
      assets.push(asset);
      console.log(`Asset reused: ${asset.category} ${asset.dimensions?.width || "?"}x${asset.dimensions?.height || "?"} ${asset.outputPath}`);
      continue;
    }

    const dryRun = await postJson("/api/asset-packs/generate", {
      category: spec.category,
      userRequest: spec.userRequest,
      dryRun: true,
    });
    if (!dryRun.ok) {
      issues.push({ stage: "asset-dry-run", category: spec.category, error: dryRun.error || "unknown" });
      throw new Error(`Asset dry-run failed for ${spec.category}: ${JSON.stringify(dryRun).slice(0, 500)}`);
    }
    const real = await postJson("/api/asset-packs/generate", {
      category: spec.category,
      userRequest: spec.userRequest,
      dryRun: false,
      confirmedProviderCallLimit: Math.max(
        ASSET_PROVIDER_CALL_LIMIT,
        dryRun.estimate?.providerCallCount ?? 1
      ),
    }, 200, 15 * 60_000);
    if (!real.ok || !real.referenceImage?.url) {
      issues.push({
        stage: "asset-real",
        category: spec.category,
        error: real.error || "unknown",
        code: real.code,
        diagnostics: real.providerDiagnostics,
      });
      throw new Error(`Asset generation failed for ${spec.category}: ${JSON.stringify(real).slice(0, 900)}`);
    }
    const file = await savePublicImage(real.referenceImage.url, `asset-${spec.category}`);
    const asset = {
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
    assets.push(asset);
    console.log(`Asset ready: ${asset.category} ${asset.dimensions?.width || "?"}x${asset.dimensions?.height || "?"} ${asset.outputPath}`);
  }

  const referenceContext = buildReferenceContext(assets);
  const batches = [
    { id: "batch-a", items: finalItems.slice(0, 10) },
    { id: "batch-b", items: finalItems.slice(10) },
  ].filter((batch) => BATCH_FILTER.length === 0 || BATCH_FILTER.includes(batch.id));
  const allJobs = [];

  for (const batch of batches) {
    const workflowId = `fresh_full_pack_${stamp}_${batch.id}`;
    const payload = {
      workflowId,
      frameNodeId: `frame_${workflowId}`,
      batchId: `batch_${workflowId}`,
      batchTitle: `Fresh full pack ${batch.id}`,
      platform: "fresh_full_pack_real_test",
      style: "premium winter apparel ecommerce campaign",
      modelIds: ["fresh-east-asian-model"],
      requiredReferenceRoles: ["product", "model", "scene", "style"],
      referenceContext,
      items: batch.items,
      enqueue: true,
      confirmedProviderCallLimit: batch.items.length,
    };
    const committed = await postJson("/api/generation-plans/run", payload, 201, 300_000);
    if (!committed.ok || !committed.queued) {
      issues.push({ stage: "batch-run", batch: batch.id, committed });
      throw new Error(`Batch run failed for ${batch.id}: ${JSON.stringify(committed).slice(0, 1000)}`);
    }
    console.log(`Queued ${batch.id}: ${batch.items.length} jobs`);
    const jobs = await waitForJobsDone(workflowId, batch.items.length, 35 * 60_000);
    allJobs.push(...jobs);
  }

  const outputs = [];
  const failures = [];
  for (const [index, job] of allJobs.entries()) {
    const metadata = parseMetadata(job.metadata);
    if (job.status !== "done" || !job.resultUrl) {
      failures.push(summarizeJob(job));
      continue;
    }
    const safeId = String(metadata.planItemId || job.id).replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80);
    const file = await savePublicImage(job.resultUrl, `${String(index + 1).padStart(2, "0")}-${safeId}`);
    const expectedSize = metadata.size;
    const sizeOk = expectedSize ? dimensionsMatch(file.dimensions, expectedSize) : true;
    if (!sizeOk) {
      issues.push({
        stage: "dimension-check",
        itemId: metadata.planItemId,
        title: metadata.planItemTitle,
        expectedSize,
        actual: file.dimensions,
      });
    }
    if (file.bytes < 80_000) {
      issues.push({
        stage: "image-byte-check",
        itemId: metadata.planItemId,
        title: metadata.planItemTitle,
        bytes: file.bytes,
      });
    }
    outputs.push({
      index: index + 1,
      jobId: job.id,
      itemId: metadata.planItemId,
      title: metadata.planItemTitle,
      type: metadata.planItemType,
      ratio: metadata.ratio,
      expectedSize,
      outputPath: file.outputPath,
      resultUrl: job.resultUrl,
      bytes: file.bytes,
      dimensions: file.dimensions,
      providerReferenceCount: metadata.providerReferenceCount,
      providerReferenceRole: metadata.providerReferenceRole,
      providerReferenceStrategy: metadata.providerReferenceStrategy,
      promptOnlyReferenceCount: Array.isArray(metadata.promptOnlyReferenceImages)
        ? metadata.promptOnlyReferenceImages.length
        : 0,
      providerImageRoles: Array.isArray(metadata.providerReferenceAdapter?.providerUsableImages)
        ? metadata.providerReferenceAdapter.providerUsableImages.map((image) => image.role)
        : [],
      copyText: metadata.copyText,
      sizeOk,
    });
  }

  let contactSheetPath;
  if (outputs.length > 0) {
    contactSheetPath = await buildContactSheet(outputs);
  }

  const report = {
    ok: outputs.length >= MIN_SUCCESSFUL_FINALS && failures.length === 0,
    minSuccessfulFinals: MIN_SUCCESSFUL_FINALS,
    successfulFinalCount: outputs.length,
    failedFinalCount: failures.length,
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
    reportPath,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Fresh full-pack test finished. Success=${outputs.length}, failures=${failures.length}`);
  if (contactSheetPath) console.log(`Contact sheet: ${contactSheetPath}`);
  console.log(`Report: ${reportPath}`);

  if (outputs.length < MIN_SUCCESSFUL_FINALS) {
    throw new Error(`Only ${outputs.length} successful finals; expected at least ${MIN_SUCCESSFUL_FINALS}.`);
  }
}

function buildReferenceContext(assets) {
  const byCategory = Object.fromEntries(assets.map((asset) => [asset.category, asset]));
  const product = byCategory.product_asset;
  const model = byCategory.model_asset;
  const scene = byCategory.scene_asset;
  const style = byCategory.style_asset;
  const images = [
    { role: "product", title: product.title, url: product.url, providerUsable: true, providerMode: "provider_input", source: "fresh-full-pack" },
    { role: "model", title: model.title, url: model.url, providerUsable: true, providerMode: "provider_input", source: "fresh-full-pack" },
    { role: "scene", title: scene.title, url: scene.url, providerUsable: true, providerMode: "provider_input", source: "fresh-full-pack" },
    { role: "style", title: style.title, url: style.url, providerUsable: true, providerMode: "provider_input", source: "fresh-full-pack" },
  ];
  return {
    version: 1,
    source: "canvas-workbench",
    targetNodeId: `fresh_full_pack_frame_${stamp}`,
    targetNodeLabel: "Fresh full pack real test",
    images,
    roles: {
      product: {
        role: "product",
        title: product.title,
        sourceNodeIds: ["fresh-product"],
        componentIds: [],
        assetIds: [],
        promptFragments: [
          "Use the product asset as the exact jacket identity source.",
          "Preserve the graphite black short down jacket, matte nylon, detachable hood, taped zipper, cuff closure, quilting, and silhouette.",
        ],
        constraints: [
          "Do not invent a different jacket, extra color variants, fake logos, or unrelated accessories.",
          "For product-only images, the product reference has priority over style and scene.",
        ],
        negativeRules: ["No wrong jacket length, no fake brand text, no extra products."],
        qualityRules: ["Jacket silhouette, hood, collar, zipper, fabric texture, and proportion must remain recognizable."],
      },
      model: {
        role: "model",
        title: model.title,
        sourceNodeIds: ["fresh-model"],
        componentIds: [],
        assetIds: [],
        promptFragments: [
          "Use the model asset for adult model identity, age impression, hair family, body proportion, and commercial temperament.",
          "Do not copy the model-card layout, panels, palette swatches, or reference-sheet composition.",
        ],
        constraints: [
          "When model appears, she must wear or interact with the jacket naturally.",
          "Relight the face, body, hair, hands, and jacket according to the scene reference rather than model-card lighting.",
        ],
        negativeRules: ["No duplicate limbs, no distorted hands, no face-only beauty fill, no pasted-on model."],
        qualityRules: ["Natural scale, coherent anatomy, believable garment contact, and clean commercial expression."],
      },
      scene: {
        role: "scene",
        title: scene.title,
        sourceNodeIds: ["fresh-scene"],
        componentIds: [],
        assetIds: [],
        promptFragments: [
          "Use the scene asset for winter lodge, snow mountain mood, floor plane, window direction, camera height, and environmental lighting.",
          "Scene lighting is the authority for final composites.",
        ],
        constraints: [
          "Keep model and product scale believable relative to windows, floor, walls, and furniture.",
          "Use realistic contact shadows and consistent light direction.",
        ],
        negativeRules: ["No impossible perspective, no floating feet, no mismatched shadows."],
        qualityRules: ["Commercial winter atmosphere, premium but not cluttered."],
      },
      style: {
        role: "style",
        title: style.title,
        sourceNodeIds: ["fresh-style"],
        componentIds: [],
        assetIds: [],
        promptFragments: [
          "Use the style asset only for premium winter apparel finish, low-saturation black-gray-white palette, material realism, restrained commercial polish, and subtle grain.",
        ],
        constraints: ["Style must not override product identity, model identity, or scene lighting."],
        negativeRules: ["No busy collage, no fake UI, no unreadable excess text."],
        qualityRules: ["Consistent premium campaign language across all ratios."],
      },
    },
    promptFragments: [
      "Fresh full-pack real test: regenerate assets and use them to create a complete winter apparel campaign.",
    ],
    constraints: [
      "Every output should be commercially usable, visually coherent, and based on the newly generated assets.",
      "Do not reuse old artifacts as visual source references.",
    ],
    negativeRules: ["No watermark, no fake brand logo, no extra unrelated product."],
    qualityRules: ["Readable subject hierarchy, correct image ratio, product consistency, and coherent lighting."],
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
  const safeSlug = slug.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
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
  const thumbW = 360;
  const thumbH = 260;
  const cols = 4;
  const labelH = 54;
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
      .resize({ width: thumbW, height: thumbH, fit: "contain", background: "#f6f2ea" })
      .png()
      .toBuffer();
    composites.push({ input: image, left: x, top: y });
    composites.push({
      input: Buffer.from(labelSvg(thumbW, labelH, `${index + 1}. ${output.title}`, `${output.type} · ${output.dimensions?.width || "?"}x${output.dimensions?.height || "?"}`)),
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
      background: "#eee6d9",
    },
  })
    .composite(composites)
    .png()
    .toFile(contactSheetPath);
  return contactSheetPath;
}

function labelSvg(width, height, title, subtitle) {
  return `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#fffaf2"/>
  <text x="12" y="22" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#2b241d">${escapeXml(truncate(title, 36))}</text>
  <text x="12" y="43" font-family="Arial, sans-serif" font-size="12" fill="#756a5e">${escapeXml(truncate(subtitle, 42))}</text>
</svg>`;
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

function escapeXml(value) {
  return value
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
