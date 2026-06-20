#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";

const root = process.cwd();
const dataDir = path.join(root, ".data");
const generatedDir = path.join(dataDir, "generated");
const dbPath = path.join(dataDir, "image-master.db");
const source = "static-showcase-package";
const sourceDir = path.join(
  root,
  "test_artifacts/goal5-large-real/2026-06-02T14-29-33-028Z/controlled-run-2026-06-02T14-42-05-603Z"
);
const showcaseRoot = path.join(root, "demo-static-showcase");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const packageDir = path.join(showcaseRoot, `image-master-static-showcase-${stamp}`);
const assetsDir = path.join(packageDir, "assets");
const outputsDir = path.join(assetsDir, "generated-output-set");
const screenshotsDir = path.join(packageDir, "screenshots");
const copyDir = path.join(packageDir, "copy");

const projectId = `project_static_showcase_${Date.now()}`;
const workflowId = `workflow_static_showcase_${Date.now()}`;
const batchId = `batch_static_showcase_${Date.now()}`;
const resultNodeId = "showcase-output-pack";

const sourceItems = [
  ["01-白底主图.png", "白底主图", "主图", "1:1", "product_main", "真实商品身份入口，适合电商首图。", "none"],
  ["02-多角度白底合集.png", "多角度白底合集", "主图", "3:2", "product_multiview", "一张图交代商品正侧背与结构。", "none"],
  ["03-镜头微距特写.png", "镜头微距特写", "细节图", "1:1", "product_macro", "用于展示镜头、材质和工艺。", "none"],
  ["04-侧面散热孔细节.png", "侧面散热孔细节", "细节图", "1:1", "product_detail", "强调散热孔和机身边缘细节。", "none"],
  ["05-淘宝首屏海报.png", "淘宝首屏海报", "海报", "4:5", "taobao_hero", "带短标题和首屏卖点。", "burn_in"],
  ["06-卖点图_·_轻便随行.png", "卖点图 · 轻便随行", "卖点图", "4:5", "feature_lightweight", "用图文解释轻便和移动使用。", "burn_in"],
  ["07-卖点图_·_夜晚观影.png", "卖点图 · 夜晚观影", "卖点图", "4:5", "feature_night_cinema", "展示夜晚观影核心场景。", "burn_in"],
  ["08-客厅生活方式图.png", "客厅生活方式图", "场景图", "3:2", "living_room_scene", "真实家居场景中的使用氛围。", "none"],
  ["09-居家办公场景.png", "居家办公场景", "场景图", "3:2", "home_office_scene", "覆盖办公、桌面和收纳场景。", "none"],
  ["10-模特调试投影仪.png", "模特调试投影仪", "模特图", "4:5", "model_setup", "人物与产品交互动作展示。", "none"],
  ["11-模特沙发观影.png", "模特沙发观影", "模特图", "4:5", "model_watch", "人物在生活场景中使用产品。", "none"],
  ["12-模特手持搬动.png", "模特手持搬动", "模特图", "4:5", "model_carry", "体现轻便搬动和产品尺度。", "none"],
  ["13-小红书封面.png", "小红书封面", "海报", "4:5", "rednote_cover", "适合种草封面和社媒入口。", "burn_in"],
  ["14-详情页三卖点.png", "详情页三卖点", "详情图", "4:5", "detail_three_points", "把卖点结构化烧进画面安全区。", "burn_in"],
  ["15-横版无字主视觉.png", "横版无字主视觉", "主图", "16:9", "hero_no_text", "适合网页横幅或二次排版。", "none"],
  ["16-收尾收藏海报.png", "收尾收藏海报", "海报", "4:5", "closing_poster", "用于详情页收尾和收藏引导。", "burn_in"],
];

await ensureInputFiles();
await fsp.mkdir(generatedDir, { recursive: true });
await fsp.mkdir(outputsDir, { recursive: true });
await fsp.mkdir(screenshotsDir, { recursive: true });
await fsp.mkdir(copyDir, { recursive: true });

const importedItems = [];
for (const [index, item] of sourceItems.entries()) {
  const [fileName, title, group, ratio, type, description, copyMode] = item;
  const slug = String(index + 1).padStart(2, "0");
  const suffix = buildStableHexSuffix(index);
  const safeName = `showcase-static-${slug}-${type}-${suffix}.png`;
  const safeThumbName = `showcase-static-${slug}-${type}-thumb-${suffix}.webp`;
  const sourcePath = path.join(sourceDir, fileName);
  const packagePath = path.join(outputsDir, safeName);
  const generatedPath = path.join(generatedDir, safeName);
  const generatedThumbPath = path.join(generatedDir, safeThumbName);
  await fsp.copyFile(sourcePath, packagePath);
  await fsp.copyFile(sourcePath, generatedPath);
  const metadata = await sharp(sourcePath).metadata();
  await sharp(sourcePath)
    .resize({ width: 720, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(generatedThumbPath);
  importedItems.push({
    index,
    title,
    group,
    ratio,
    type,
    description,
    copyMode,
    sourcePath,
    packagePath,
    generatedPath,
    publicUrl: `/api/generated-images/${safeName}`,
    thumbnailUrl: `/api/generated-images/${safeThumbName}`,
    width: metadata.width || 1024,
    height: metadata.height || 1024,
  });
}

function buildStableHexSuffix(index) {
  return (0x100000000000 + index + 1).toString(16).slice(-12);
}

const contactSheetPath = path.join(screenshotsDir, "00-output-contact-sheet.png");
await createContactSheet(contactSheetPath, importedItems);

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
try {
  cleanupPreviousShowcaseRows(db);
  seedDatabase(db, importedItems);
} finally {
  db.close();
}

const manifest = {
  createdAt: new Date().toISOString(),
  source,
  packageDir,
  projectId,
  workflowId,
  batchId,
  canvasUrl: `http://127.0.0.1:3000/canvas?projectId=${projectId}&restore=1`,
  screenshotsDir,
  assetsDir,
  contactSheetPath,
  plannedScreenshots: [
    {
      file: "01-workbench-overview.png",
      title: "完整项目工作台总览",
      message: "项目、素材资产、Agent 和结果墙在一个本地画布里闭环。",
    },
    {
      file: "02-asset-library-grid.png",
      title: "素材库与资产复用",
      message: "商品、模特、场景、风格和文案以资产方式保存，后续项目可复用。",
    },
    {
      file: "03-agent-plan-preview.png",
      title: "Agent 规划图组",
      message: "自然语言需求会被拆成图片用途、比例、参考图角色和文案策略。",
    },
    {
      file: "04-result-wall.png",
      title: "真实比例结果墙",
      message: "主图、海报、详情图、场景图和模特图按真实比例铺在无限画布上。",
    },
    {
      file: "05-image-detail-traceability.png",
      title: "单张图可追溯",
      message: "点击图片可查看大图、prompt、参考图、provider 和诊断信息。",
    },
    {
      file: "06-click-to-revise.png",
      title: "点击图片继续修改",
      message: "不满意时选中单张图，直接让 Agent 基于上一版继续改。",
    },
    {
      file: "07-output-contact-sheet.png",
      title: "完整输出图组",
      message: "16 张投影仪商业图覆盖电商、社媒、场景和模特展示。",
    },
  ],
  outputs: importedItems.map((item) => ({
    title: item.title,
    group: item.group,
    ratio: item.ratio,
    copyMode: item.copyMode,
    path: item.packagePath,
    publicUrl: item.publicUrl,
  })),
};

await fsp.writeFile(path.join(packageDir, "manifest.json"), JSON.stringify(manifest, null, 2));
await fsp.writeFile(path.join(packageDir, "README.md"), buildReadme(manifest));
await fsp.writeFile(path.join(copyDir, "showcase-web-copy.md"), buildWebCopy(manifest));

console.log(JSON.stringify({
  ok: true,
  packageDir,
  projectId,
  workflowId,
  canvasUrl: manifest.canvasUrl,
  contactSheetPath,
  outputs: importedItems.length,
}, null, 2));

async function ensureInputFiles() {
  const missing = [];
  for (const [fileName] of sourceItems) {
    const filePath = path.join(sourceDir, fileName);
    if (!fs.existsSync(filePath)) missing.push(filePath);
  }
  if (missing.length > 0) {
    throw new Error(`Missing showcase source files:\n${missing.join("\n")}`);
  }
}

function cleanupPreviousShowcaseRows(database) {
  database
    .prepare("DELETE FROM generated_artifacts WHERE json_extract(metadata, '$.source') = ?")
    .run(source);
  database
    .prepare("DELETE FROM generation_jobs WHERE json_extract(metadata, '$.source') = ?")
    .run(source);
  database
    .prepare("DELETE FROM assets WHERE json_extract(metadata, '$.source') = ?")
    .run(source);
  database
    .prepare("DELETE FROM workflows WHERE json_extract(metadata, '$.source') = ?")
    .run(source);
  database
    .prepare("DELETE FROM projects WHERE json_extract(metadata, '$.source') = ?")
    .run(source);
}

function seedDatabase(database, items) {
  const now = new Date().toISOString();
  const productRef = items[0];
  const modelRef = items[9];
  const sceneRef = items[7];
  const styleRef = items[14];

  const assets = [
    {
      id: `${source}-product`,
      type: "product",
      title: "便携智能投影仪 · 商品参考",
      description: "真实商品身份参考，用于锁定机身比例、镜头、散热孔和白色材质。",
      url: productRef.publicUrl,
      metadata: {
        source,
        category: "商品",
        canvasCategory: "商品",
        favorite: true,
        previewUrl: productRef.thumbnailUrl,
        referenceUrl: productRef.publicUrl,
        prompt: "锁定便携智能投影仪的外观、镜头、白色机身、侧面散热孔和整体比例。",
        promptFragments: ["商品身份必须来自真实参考图", "不要重设计镜头、散热孔或机身比例"],
        constraints: ["product identity locked", "do not alter hardware layout"],
        imageStorage: {
          publicUrl: productRef.publicUrl,
          thumbnailUrl: productRef.thumbnailUrl,
          mimeType: "image/png",
        },
      },
    },
    {
      id: `${source}-model`,
      type: "model",
      title: "生活方式模特 · 下游参考",
      description: "用于人物使用、手持、观影和家居互动场景。",
      url: modelRef.publicUrl,
      metadata: {
        source,
        category: "模特",
        canvasCategory: "模特",
        previewUrl: modelRef.thumbnailUrl,
        referenceUrl: modelRef.publicUrl,
        prompt: "保持自然生活方式人物气质，不复制棚拍姿态。",
        promptFragments: ["人物动作要像真实家居使用", "避免僵硬模卡感"],
        imageStorage: {
          publicUrl: modelRef.publicUrl,
          thumbnailUrl: modelRef.thumbnailUrl,
          mimeType: "image/png",
        },
      },
    },
    {
      id: `${source}-scene`,
      type: "scene",
      title: "北欧客厅 · 场景参考",
      description: "用于锁定家居空间、自然光和生活方式氛围。",
      url: sceneRef.publicUrl,
      metadata: {
        source,
        category: "场景",
        canvasCategory: "场景",
        previewUrl: sceneRef.thumbnailUrl,
        referenceUrl: sceneRef.publicUrl,
        prompt: "柔和家居自然光、沙发、投影观影和桌面使用场景。",
        promptFragments: ["场景负责空间和光线", "不要覆盖商品身份"],
        imageStorage: {
          publicUrl: sceneRef.publicUrl,
          thumbnailUrl: sceneRef.thumbnailUrl,
          mimeType: "image/png",
        },
      },
    },
    {
      id: `${source}-style`,
      type: "style",
      title: "干净科技生活方式 · 风格参考",
      description: "横版无字主视觉，用于网页 banner、发布页和品牌调性。",
      url: styleRef.publicUrl,
      metadata: {
        source,
        category: "风格",
        canvasCategory: "风格",
        previewUrl: styleRef.thumbnailUrl,
        referenceUrl: styleRef.publicUrl,
        prompt: "真实摄影、干净留白、轻科技生活方式质感。",
        promptFragments: ["风格只负责摄影质感", "不改商品结构"],
        imageStorage: {
          publicUrl: styleRef.publicUrl,
          thumbnailUrl: styleRef.thumbnailUrl,
          mimeType: "image/png",
        },
      },
    },
    {
      id: `${source}-copy`,
      type: "copy",
      title: "投影仪营销文案 Brief",
      description: "画面文字、卖点参数、禁止声明和导出文案分层保存。",
      url: "",
      metadata: {
        source,
        category: "文案",
        canvasCategory: "文案",
        copyBrief: {
          headlines: ["随身影院", "一拎就走", "夜晚观影更沉浸"],
          sellingPoints: ["便携机身", "家居/办公/露营多场景", "白底详情图与社媒图可复用"],
          burnInPolicy: "海报、卖点图、小红书封面烧字；主图、场景图、模特图默认不烧字。",
          forbidden: ["不要把广告文案写到商品镜头、机身标签或散热孔上"],
        },
        promptFragments: ["文案进入画面安全区", "商品本体不承载广告字"],
      },
    },
  ];

  const insertAsset = database.prepare(
    `INSERT OR REPLACE INTO assets (id, type, title, description, status, url, metadata, createdAt, updatedAt)
     VALUES (@id, @type, @title, @description, 'ready', @url, @metadata, @createdAt, @updatedAt)`
  );
  for (const asset of assets) {
    insertAsset.run({
      ...asset,
      metadata: JSON.stringify(asset.metadata),
      createdAt: now,
      updatedAt: now,
    });
  }

  const nodes = [
    makeVisualNode("showcase-product-node", "便携智能投影仪", "商品", "商品身份参考，锁定机身、镜头和散热孔", "product", productRef, { x: 40, y: 90 }),
    makeVisualNode("showcase-model-node", "生活方式模特参考", "模特", "用于家居观影、调试和手持搬动镜头", "model", modelRef, { x: 360, y: 40 }),
    makeVisualNode("showcase-scene-node", "北欧客厅场景", "场景", "负责空间、光线和生活方式氛围", "scene", sceneRef, { x: 680, y: 70 }),
    makeVisualNode("showcase-style-node", "干净科技风格", "风格", "负责网页横幅和品牌视觉质感", "style", styleRef, { x: 1000, y: 100 }),
    {
      id: "showcase-copy-node",
      position: { x: 1320, y: 96 },
      data: {
        label: "文案 Brief",
        caption: "画面文字、卖点、禁止声明分层；按需求判断是否烧进图。",
        kind: "asset",
        status: "ready",
        metrics: ["海报烧字", "主图无字", "安全区"],
        iconName: "copy",
        source,
        category: "文案",
      },
    },
    {
      id: resultNodeId,
      position: { x: 40, y: 520 },
      data: {
        label: "Agent 规划结果墙",
        caption: "16 张商业图覆盖主图、详情、海报、场景和模特展示。",
        kind: "output",
        status: "ready",
        metrics: ["16 张", "多比例", "可追溯"],
        iconName: "output",
        source,
        category: "成片",
      },
    },
  ];
  const edges = [
    { id: "showcase-product-output", source: "showcase-product-node", target: resultNodeId, label: "锁商品", animated: true },
    { id: "showcase-model-output", source: "showcase-model-node", target: resultNodeId, label: "人物展示" },
    { id: "showcase-scene-output", source: "showcase-scene-node", target: resultNodeId, label: "空间光影" },
    { id: "showcase-style-output", source: "showcase-style-node", target: resultNodeId, label: "风格" },
    { id: "showcase-copy-output", source: "showcase-copy-node", target: resultNodeId, label: "文案策略", animated: true },
  ];

  database
    .prepare(
      `INSERT OR REPLACE INTO workflows (id, title, description, nodes, edges, metadata, createdAt, updatedAt)
       VALUES (@id, @title, @description, @nodes, @edges, @metadata, @createdAt, @updatedAt)`
    )
    .run({
      id: workflowId,
      title: "Image Master 静态展示项目",
      description: "便携智能投影仪上市图组，用于项目展示网页截图。",
      nodes: JSON.stringify(nodes),
      edges: JSON.stringify(edges),
      metadata: JSON.stringify({ source, batchId, canvasSavedAt: now }),
      createdAt: now,
      updatedAt: now,
    });

  database
    .prepare(
      `INSERT OR REPLACE INTO projects (id, title, description, status, metadata, createdAt, updatedAt)
       VALUES (@id, @title, @description, 'active', @metadata, @createdAt, @updatedAt)`
    )
    .run({
      id: projectId,
      title: "便携智能投影仪 · 商业图组展示",
      description: "覆盖电商主图、淘宝详情页、小红书封面、生活方式场景和模特展示。",
      metadata: JSON.stringify({
        source,
        canvasWorkflowId: workflowId,
        canvasSavedAt: now,
        demoSafe: true,
        showcasePackageDir: packageDir,
      }),
      createdAt: now,
      updatedAt: now,
    });

  const insertJob = database.prepare(
    `INSERT OR REPLACE INTO generation_jobs (
       id, workflowId, nodeId, assetId, batchId, exportPackId, planId,
       status, prompt, resultUrl, error, metadata, createdAt, updatedAt
     )
     VALUES (
       @id, @workflowId, @nodeId, @assetId, @batchId, '', @planId,
       'done', @prompt, @resultUrl, '', @metadata, @createdAt, @updatedAt
     )`
  );
  const insertArtifact = database.prepare(
    `INSERT OR REPLACE INTO generated_artifacts (
       id, workflowId, nodeId, jobId, assetId, batchId, exportPackId, planId,
       type, title, status, url, prompt, provider, model, metadata, createdAt, updatedAt
     )
     VALUES (
       @id, @workflowId, @nodeId, @jobId, @assetId, @batchId, '', @planId,
       @type, @title, 'ready', @url, @prompt, @provider, @model, @metadata, @createdAt, @updatedAt
     )`
  );

  for (const item of items) {
    const idSuffix = String(item.index + 1).padStart(2, "0");
    const jobId = `${source}-job-${idSuffix}`;
    const artifactId = `${source}-artifact-${idSuffix}`;
    const metadata = {
      source,
      batchId,
      planId: "showcase-plan-projector-launch",
      planItemTitle: item.title,
      batchJobTitle: item.title,
      exportItemTitle: item.title,
      planItemType: item.type,
      imageType: item.group,
      useCase: item.group,
      ratio: item.ratio,
      size: `${item.width}x${item.height}`,
      naming: `projector_${item.type}_${idSuffix}`,
      prompt: buildPrompt(item),
      provider: "static-showcase",
      model: "fixed-real-sample",
      copyRenderPolicy: {
        mode: item.copyMode === "burn_in" ? "burn_in" : "layout_layer",
        burnIn: item.copyMode === "burn_in",
        note: item.copyMode === "burn_in" ? "短文案进入画面安全区" : "不把文案直接写进图",
      },
      referenceImages: [
        { role: "product", title: "商品参考", url: productRef.publicUrl, providerUsable: true },
        { role: "scene", title: "场景参考", url: sceneRef.publicUrl, providerUsable: item.group === "场景图" || item.group === "模特图" },
        { role: "style", title: "风格参考", url: styleRef.publicUrl, providerUsable: true },
      ],
      providerReferenceAdapter: {
        providerRoles: item.group === "主图" || item.group === "细节图"
          ? ["product"]
          : item.group === "模特图"
            ? ["product", "model", "scene"]
            : ["product", "scene", "style"],
        promptOnlyRoles: item.copyMode === "burn_in" ? ["copy"] : [],
      },
      lockSummary: [
        { role: "product", label: "商品强锁", mode: "provider_reference" },
        item.group === "模特图" ? { role: "model", label: "模特参考", mode: "provider_reference" } : undefined,
        item.copyMode === "burn_in" ? { role: "copy", label: "文案烧字", mode: "burn_in" } : undefined,
      ].filter(Boolean),
      imageStorage: {
        publicUrl: item.publicUrl,
        thumbnailUrl: item.thumbnailUrl,
        mimeType: "image/png",
      },
      resultStorage: {
        publicUrl: item.publicUrl,
        thumbnailUrl: item.thumbnailUrl,
        mimeType: "image/png",
      },
    };
    insertJob.run({
      id: jobId,
      workflowId,
      nodeId: resultNodeId,
      assetId: `${source}-product`,
      batchId,
      planId: "showcase-plan-projector-launch",
      prompt: metadata.prompt,
      resultUrl: item.publicUrl,
      metadata: JSON.stringify(metadata),
      createdAt: now,
      updatedAt: now,
    });
    insertArtifact.run({
      id: artifactId,
      workflowId,
      nodeId: resultNodeId,
      jobId,
      assetId: `${source}-product`,
      batchId,
      planId: "showcase-plan-projector-launch",
      type: item.type,
      title: item.title,
      url: item.publicUrl,
      prompt: metadata.prompt,
      provider: "static-showcase",
      model: "fixed-real-sample",
      metadata: JSON.stringify(metadata),
      createdAt: now,
      updatedAt: now,
    });
  }
}

function makeVisualNode(id, title, category, caption, iconName, item, position) {
  return {
    id,
    position,
    data: {
      label: title,
      caption,
      kind: "asset",
      status: "ready",
      metrics: [category, item.ratio, "可复用"],
      iconName,
      previewUrl: item.thumbnailUrl,
      referenceUrl: item.publicUrl,
      previewAlt: title,
      source,
      category,
      parameters: {
        aspectRatio: item.width / item.height,
        ratio: item.ratio,
      },
    },
  };
}

function buildPrompt(item) {
  const copyLine = item.copyMode === "burn_in"
    ? "文案需要进入画面安全区，不能写到商品机身、镜头或标签上。"
    : "不要把文案直接烧进图片，保留干净画面用于后期排版。";
  return [
    `为便携智能投影仪生成「${item.title}」。`,
    `图片用途：${item.description}`,
    "商品身份必须保持：白色小型投影仪、前置镜头、侧面散热孔、简洁科技外观和真实比例。",
    copyLine,
    "画面应符合真实商业摄影质感，避免廉价合成感。",
  ].join("\n");
}

async function createContactSheet(outputPath, items) {
  const cardWidth = 420;
  const cardHeight = 520;
  const gap = 28;
  const columns = 4;
  const headerHeight = 150;
  const rows = Math.ceil(items.length / columns);
  const width = columns * cardWidth + (columns + 1) * gap;
  const height = headerHeight + rows * cardHeight + (rows + 1) * gap;
  const composites = [];

  for (const item of items) {
    const row = Math.floor(item.index / columns);
    const column = item.index % columns;
    const left = gap + column * (cardWidth + gap);
    const top = headerHeight + gap + row * (cardHeight + gap);
    const imageBuffer = await sharp(item.sourcePath)
      .resize({
        width: cardWidth,
        height: 390,
        fit: "contain",
        background: "#F7F1E8",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    composites.push({ input: imageBuffer, left, top });
    composites.push({
      input: Buffer.from(cardLabelSvg(cardWidth, 112, item)),
      left,
      top: top + 398,
    });
  }

  const baseSvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#F4EDE2"/>
      <text x="${gap}" y="58" fill="#2F2A24" font-size="34" font-weight="700" font-family="Arial, PingFang SC, sans-serif">Image Master 静态展示图组</text>
      <text x="${gap}" y="96" fill="#776B5E" font-size="18" font-family="Arial, PingFang SC, sans-serif">便携智能投影仪 · 16 张商业图 · 电商 / 社媒 / 场景 / 模特 / 文案烧字</text>
    </svg>
  `;

  await sharp(Buffer.from(baseSvg))
    .composite(composites)
    .png()
    .toFile(outputPath);
}

function cardLabelSvg(width, height, item) {
  const safeTitle = escapeXml(`${String(item.index + 1).padStart(2, "0")} ${item.title}`);
  const safeMeta = escapeXml(`${item.group} · ${item.ratio} · ${item.copyMode === "burn_in" ? "文案进图" : "无字/图层"}`);
  const safeDescription = escapeXml(item.description);
  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" rx="16" fill="#FFFDF9"/>
      <text x="18" y="32" fill="#2F2A24" font-size="18" font-weight="700" font-family="Arial, PingFang SC, sans-serif">${safeTitle}</text>
      <text x="18" y="60" fill="#8A755F" font-size="14" font-family="Arial, PingFang SC, sans-serif">${safeMeta}</text>
      <text x="18" y="88" fill="#776B5E" font-size="13" font-family="Arial, PingFang SC, sans-serif">${safeDescription}</text>
    </svg>
  `;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildReadme(manifest) {
  return `# Image Master 静态展示素材包

这个素材包用于项目展示网页、README、作品集或路演页面。它不包含 API Key，不展示设置页，也不需要现场调用真实生图 provider。

## 展示主线

1. 打开项目工作台：项目、素材、Agent、结果墙在同一个本地画布里。
2. 展示素材库：商品、模特、场景、风格、文案都可以沉淀为资产。
3. 展示 Agent 计划：自然语言需求被拆成图组用途、比例、强参考和文案策略。
4. 展示结果墙：16 张图按真实比例分组铺开。
5. 展示图片详情：单张图可追溯到 prompt、参考图和 provider 信息。
6. 展示修改闭环：点击图片后右侧 Agent 进入“修改这张图”。

## 本地预览地址

\`\`\`text
${manifest.canvasUrl}
\`\`\`

## 目录

\`\`\`text
assets/generated-output-set/   固定演示输出图
screenshots/                   浏览器截图和 contact sheet
copy/showcase-web-copy.md      项目展示网页文案
manifest.json                  截图计划和素材清单
\`\`\`
`;
}

function buildWebCopy() {
  return `# 项目展示网页文案

## Hero

标题：Image Master

副标题：用一句话，把商品素材变成一整套商业图。

说明：Image Master 是一个本地优先的商业图片 Agent 工作台。它把商品、模特、场景、风格和文案沉淀为可复用资产，再由 Agent 规划图组、比例、参考图和文案策略，最终把结果铺成可追溯的无限画布图片墙。

按钮文案：
- 查看工作台截图
- 查看完整输出图组

## 模块 1：项目化工作台

标题：不是单张生图，而是一套项目工作流。

正文：每次商业图需求都以项目为单位组织。素材、Agent 计划、生成结果和后续修改都留在同一个画布里，不需要在多个工具之间来回搬运。

截图：01-workbench-overview.png

## 模块 2：素材资产复用

标题：商品、模特、场景、风格、文案都能变成资产。

正文：素材库用于沉淀可复用输入。商品图用于锁定真实商品身份；模特、场景和风格提供下游生成参考；文案以结构化方式保存，由 Agent 判断是否进入图片。

截图：02-asset-library-grid.png

## 模块 3：Agent 规划

标题：用户说目标，Agent 拆图组。

正文：Agent 会把一句自然语言需求拆成多张商业图：每张图的用途、比例、参考图角色、文案是否烧进图和预计调用方式都会在生成前展示。

截图：03-agent-plan-preview.png

## 模块 4：结果墙

标题：真实比例图片墙，一眼扫完整套图。

正文：生成结果按主图、海报、详情图、细节图、场景图和模特图分组展示。不同宽高比不会被强行压成方图，更接近真实交付视角。

截图：04-result-wall.png

## 模块 5：可追溯与可修改

标题：每张图都知道自己从哪来。

正文：点击任意图片，可以查看大图、prompt、参考图、provider 信息和诊断记录。如果需要调整，直接把这张图交给 Agent，用一句话继续修改。

截图：
- 05-image-detail-traceability.png
- 06-click-to-revise.png

## 模块 6：完整输出

标题：一套图覆盖多种商业场景。

正文：这组演示输出包含白底主图、多角度合集、商品细节、淘宝首屏、卖点图、客厅/办公场景、模特使用图、小红书封面和详情页三卖点。

截图：07-output-contact-sheet.png

## 可强调的亮点

- Agent 不是只写 prompt，而是调用一套 workflow skills：电商主图、详情页、模特展示、场景图、文案烧字和结果追溯。
- 商品真实身份需要真实参考图，系统不会把纯文字商品描述假装成真实商品锁定。
- 文案默认结构化保存，只有海报、卖点图、封面等明确场景才烧进图。
- 结果不是一次性输出，后续可以点图查看、重做、保存为资产或继续修改。

## 不建议这样说

- 不要说“已经生产可上线”。
- 不要承诺“商品细节像素级复刻”。
- 不要承诺“模特身份 100% 一致”。
- 不要展示设置页、API Key、.env 或私人素材。
`;
}
