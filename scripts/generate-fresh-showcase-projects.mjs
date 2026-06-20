#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";

const root = process.cwd();
const dataDir = path.join(root, ".data");
const generatedDir = path.join(dataDir, "generated");
const dbPath = path.join(dataDir, "image-master.db");
const showcaseRoot = path.join(root, "demo-static-showcase");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const suiteDir = path.join(showcaseRoot, `fresh-showcase-suite-${stamp}`);
const port = Number(process.env.FRESH_SHOWCASE_PORT || 3591);
const baseUrl = process.env.FRESH_SHOWCASE_BASE_URL || `http://127.0.0.1:${port}`;
const publicCanvasBaseUrl = process.env.FRESH_SHOWCASE_PUBLIC_BASE_URL || "http://127.0.0.1:3000";
const shouldSpawnServer = !process.env.FRESH_SHOWCASE_BASE_URL;
const source = `fresh-showcase-${stamp.toLowerCase()}`;

const projects = [
  {
    slug: "desk-aroma",
    title: "智能桌面香薰机",
    description: "覆盖白底主图、生活方式场景、卖点海报和小红书封面。",
    productPhrase: "a compact matte white smart desktop aroma diffuser with a small warm mist outlet, subtle LED ring, rounded cylinder body, and minimalist controls",
    promptBase: "Photorealistic commercial product photography for a compact matte white smart desktop aroma diffuser. Keep the product design consistent across the set: rounded cylinder body, subtle LED ring, small mist outlet, minimalist controls, soft premium home-lifestyle feeling.",
    copyBrief: ["一缕香气", "桌面也有松弛感", "轻雾氛围"],
    items: [
      ["白底商品主图", "主图", "1:1", "product_main", "1024x1024", "Clean white background hero product image, front three-quarter view, soft natural shadow, no text.", "none"],
      ["卧室床头场景", "场景图", "3:2", "bedroom_scene", "1536x1024", "Warm bedroom bedside table scene, morning window light, diffuser releasing a very subtle visible mist, linen bedding and calm home atmosphere, no text.", "none"],
      ["卖点海报 · 轻雾氛围", "海报", "4:5", "feature_poster", "1024x1536", "Vertical feature poster with the diffuser on a wooden desk, soft mist, plants and books in background. Add short Chinese text in safe empty area: 轻雾氛围. Do not write text on the product body.", "burn_in"],
      ["小红书封面", "海报", "4:5", "rednote_cover", "1024x1536", "Lifestyle rednote cover, cozy desk corner with diffuser, warm lamp, ceramic cup, real social-media photography feeling. Add short Chinese text in safe area: 桌面松弛感.", "burn_in"],
    ],
  },
  {
    slug: "trail-bottle",
    title: "户外保温杯",
    description: "覆盖电商主图、露营场景、材质特写和社媒海报。",
    productPhrase: "a matte sage green insulated outdoor travel bottle with a black carry loop, stainless steel cap, slim cylindrical body, and subtle rubber base",
    promptBase: "Photorealistic commercial product photography for a matte sage green insulated outdoor travel bottle. Keep product identity consistent: slim cylindrical body, black carry loop, stainless steel cap, subtle rubber base, outdoor premium lifestyle.",
    copyBrief: ["一杯到山野", "保温随行", "露营通勤都能用"],
    items: [
      ["白底商品主图", "主图", "1:1", "product_main", "1024x1024", "Clean white background e-commerce product image, bottle standing upright, realistic shadow, exact product design, no text.", "none"],
      ["山野露营场景", "场景图", "3:2", "camp_scene", "1536x1024", "Outdoor camping table at golden hour, travel bottle beside a mug and folded map, pine trees in background, natural sunlight, no text.", "none"],
      ["材质细节特写", "细节图", "1:1", "material_macro", "1024x1024", "Macro detail of the stainless steel cap, black carry loop, matte powder coated green surface with tiny water droplets, no text.", "none"],
      ["淘宝卖点海报", "海报", "4:5", "taobao_feature", "1024x1536", "Vertical Taobao feature poster, bottle in outdoor doorway with soft mountain light. Add short Chinese text in safe empty area: 保温随行. Do not alter label or product body.", "burn_in"],
    ],
  },
  {
    slug: "skin-serum",
    title: "极简护肤精华",
    description: "覆盖美妆白底、质地特写、浴室场景和品牌海报。",
    productPhrase: "a frosted glass skincare serum bottle with a white dropper cap, pale amber liquid, minimal black label, and clean premium beauty packaging",
    promptBase: "Photorealistic commercial beauty photography for a frosted glass skincare serum bottle. Keep product identity consistent: white dropper cap, pale amber liquid, minimal black label, premium clean skincare packaging.",
    copyBrief: ["晨间一滴", "清透光泽", "温和修护"],
    items: [
      ["白底美妆主图", "主图", "1:1", "product_main", "1024x1024", "Clean white background beauty product hero, serum bottle standing upright, soft reflection, premium cosmetic lighting, no text.", "none"],
      ["质地滴管特写", "细节图", "1:1", "dropper_macro", "1024x1024", "Macro shot of glass dropper with pale amber serum droplet, frosted bottle blurred behind, premium skincare texture, no text.", "none"],
      ["浴室台面场景", "场景图", "3:2", "bathroom_scene", "1536x1024", "Bright minimal bathroom counter, serum bottle beside folded towel and ceramic tray, morning natural light, soft clean atmosphere, no text.", "none"],
      ["品牌海报 · 晨间一滴", "海报", "4:5", "brand_poster", "1024x1536", "Vertical premium skincare poster, serum bottle in warm morning light with subtle water highlights. Add short Chinese text in safe area: 晨间一滴. Do not write text on the bottle label.", "burn_in"],
    ],
  },
];

await fsp.mkdir(suiteDir, { recursive: true });
await fsp.mkdir(generatedDir, { recursive: true });

let server;
let serverOutput = "";
if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      IMAGE_MASTER_MAX_BATCH_IMAGES: process.env.IMAGE_MASTER_MAX_BATCH_IMAGES || "8",
      IMAGE_MASTER_IMAGE_TIMEOUT_MS: process.env.IMAGE_MASTER_IMAGE_TIMEOUT_MS || "900000",
      WATCHPACK_POLLING: process.env.WATCHPACK_POLLING || "true",
      NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || `.next-fresh-showcase-${stamp}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
}

const report = {
  createdAt: new Date().toISOString(),
  source,
  suiteDir,
  baseUrl,
  publicCanvasBaseUrl,
  projectCount: projects.length,
  projects: [],
};

try {
  await waitForServer(`${baseUrl}/api/settings`);
  for (const project of projects) {
    const result = await generateProject(project);
    report.projects.push(result);
  }
  await fsp.writeFile(path.join(suiteDir, "manifest.json"), `${JSON.stringify(report, null, 2)}\n`);
  await fsp.writeFile(path.join(suiteDir, "README.md"), buildSuiteReadme(report));
  console.log(JSON.stringify({
    ok: true,
    suiteDir,
    projects: report.projects.map((project) => ({
      title: project.title,
      packageDir: project.packageDir,
      outputs: project.outputs.length,
      canvasUrl: project.canvasUrl,
    })),
  }, null, 2));
} catch (error) {
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-8000));
  }
  process.exitCode = 1;
} finally {
  if (server) {
    server.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function generateProject(project) {
  const projectDir = path.join(suiteDir, project.slug);
  const outputsDir = path.join(projectDir, "assets", "generated-output-set");
  const screenshotsDir = path.join(projectDir, "screenshots");
  const copyDir = path.join(projectDir, "copy");
  await fsp.mkdir(outputsDir, { recursive: true });
  await fsp.mkdir(screenshotsDir, { recursive: true });
  await fsp.mkdir(copyDir, { recursive: true });

  const images = project.items.map(([title, group, ratio, type, size, prompt, copyMode], index) => ({
    title,
    type,
    copyText: copyMode === "burn_in" ? title.replace(/^.*·\s*/, "") : "",
    size,
    ratio,
    textAllowed: copyMode === "burn_in",
    prompt: [
      project.promptBase,
      `Output ${index + 1}: ${prompt}`,
      "Make it look like a real commercial photograph, not an AI collage.",
      "Use natural camera perspective, believable material texture, grounded shadows, and restrained retouching.",
    ].join("\n"),
  }));

  const dryRun = await requestJson(`${baseUrl}/api/images/generate/batch`, {
    method: "POST",
    body: JSON.stringify({ dryRun: true, style: "fresh-showcase", modelIds: [], images }),
  });
  const requiredCalls = Number(dryRun.estimate?.providerCallCount || images.length);
  const generated = await requestJson(`${baseUrl}/api/images/generate/batch`, {
    method: "POST",
    body: JSON.stringify({
      style: "fresh-showcase",
      modelIds: [],
      images,
      confirmedProviderCallLimit: requiredCalls,
    }),
  }, 200, 1_200_000);

  const importedItems = [];
  for (const [index, output] of generated.images.entries()) {
    if (!output?.url || output.error) {
      throw new Error(`${project.title} image ${index + 1} failed: ${output?.error || "empty output"}`);
    }
    const itemSpec = project.items[index];
    const [title, group, ratio, type, description, _prompt, copyMode] = itemSpec;
    const slug = String(index + 1).padStart(2, "0");
    const suffix = buildStableHexSuffix(project.slug, index);
    const safeName = `${project.slug}-${slug}-${type}-${suffix}.png`;
    const thumbName = `${project.slug}-${slug}-${type}-thumb-${suffix}.webp`;
    const imageBuffer = await readImageResult(output.url);
    const packagePath = path.join(outputsDir, safeName);
    const generatedPath = path.join(generatedDir, safeName);
    const thumbPath = path.join(generatedDir, thumbName);
    await fsp.writeFile(packagePath, imageBuffer);
    await fsp.writeFile(generatedPath, imageBuffer);
    const metadata = await sharp(imageBuffer).metadata();
    await sharp(imageBuffer)
      .resize({ width: 720, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(thumbPath);
    importedItems.push({
      index,
      title,
      group,
      ratio,
      type,
      description,
      copyMode,
      prompt: output.prompt || images[index].prompt,
      sourcePath: packagePath,
      packagePath,
      publicUrl: `/api/generated-images/${safeName}`,
      thumbnailUrl: `/api/generated-images/${thumbName}`,
      width: metadata.width || 1024,
      height: metadata.height || 1024,
    });
  }

  const contactSheetPath = path.join(screenshotsDir, "00-output-contact-sheet.png");
  await createContactSheet(contactSheetPath, importedItems, project);
  await fsp.copyFile(contactSheetPath, path.join(screenshotsDir, "07-output-contact-sheet.png"));

  const seeded = seedProject(project, importedItems, projectDir);
  const manifest = {
    createdAt: new Date().toISOString(),
    source,
    slug: project.slug,
    title: project.title,
    description: project.description,
    packageDir: projectDir,
    projectId: seeded.projectId,
    workflowId: seeded.workflowId,
    batchId: seeded.batchId,
    canvasUrl: `${publicCanvasBaseUrl}/canvas?projectId=${seeded.projectId}&restore=1`,
    contactSheetPath,
    outputs: importedItems.map((item) => ({
      title: item.title,
      group: item.group,
      ratio: item.ratio,
      copyMode: item.copyMode,
      path: item.packagePath,
      publicUrl: item.publicUrl,
    })),
    dryRunEstimate: dryRun.estimate,
    providerEstimate: generated.estimate,
  };
  await fsp.writeFile(path.join(projectDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await fsp.writeFile(path.join(projectDir, "README.md"), buildProjectReadme(manifest, project));
  await fsp.writeFile(path.join(copyDir, "showcase-web-copy.md"), buildProjectCopy(project, manifest));
  return manifest;
}

function seedProject(project, items, packageDir) {
  const now = new Date().toISOString();
  const projectToken = `${source}-${project.slug}`;
  const projectId = `project_${project.slug}_${Date.now()}`;
  const workflowId = `workflow_${project.slug}_${Date.now()}`;
  const batchId = `batch_${project.slug}_${Date.now()}`;
  const resultNodeId = `${project.slug}-output-pack`;
  const productRef = items[0];
  const sceneRef = items.find((item) => item.group === "场景图") || items[1] || productRef;
  const styleRef = items.find((item) => item.copyMode === "burn_in") || sceneRef;

  const db = new Database(dbPath);
  try {
    const insertAsset = db.prepare(
      `INSERT OR REPLACE INTO assets (id, type, title, description, status, url, metadata, createdAt, updatedAt)
       VALUES (@id, @type, @title, @description, 'ready', @url, @metadata, @createdAt, @updatedAt)`
    );
    const assets = [
      makeAsset(projectToken, "product", `${project.title} · 商品参考`, project.productPhrase, productRef),
      makeAsset(projectToken, "scene", `${project.title} · 场景参考`, "用于锁定场景、光线与生活方式氛围。", sceneRef),
      makeAsset(projectToken, "style", `${project.title} · 风格参考`, "用于统一摄影质感和商业修图风格。", styleRef),
      {
        id: `${projectToken}-copy`,
        type: "copy",
        title: `${project.title} · 文案 Brief`,
        description: "画面文字、卖点和禁止声明分层保存。",
        url: "",
        metadata: {
          source,
          projectSlug: project.slug,
          category: "文案",
          canvasCategory: "文案",
          copyBrief: {
            headlines: project.copyBrief,
            burnInPolicy: "海报和卖点图按需烧字；主图和干净场景图默认不烧字。",
            forbidden: ["不要把广告文案写到商品本体、标签或包装细节上"],
          },
        },
      },
    ];
    for (const asset of assets) {
      insertAsset.run({
        ...asset,
        metadata: JSON.stringify(asset.metadata),
        createdAt: now,
        updatedAt: now,
      });
    }

    const nodes = [
      makeVisualNode(`${project.slug}-product-node`, project.title, "商品", "真实商品身份参考", "product", productRef, { x: 40, y: 80 }, source),
      makeVisualNode(`${project.slug}-scene-node`, "场景资产", "场景", "空间、光线和使用氛围", "scene", sceneRef, { x: 360, y: 80 }, source),
      makeVisualNode(`${project.slug}-style-node`, "风格资产", "风格", "商业摄影质感", "style", styleRef, { x: 680, y: 80 }, source),
      {
        id: `${project.slug}-copy-node`,
        position: { x: 1000, y: 80 },
        data: {
          label: "文案 Brief",
          caption: "按图种判断是否烧字。",
          kind: "asset",
          status: "ready",
          metrics: ["安全区", "按需烧字", "不改商品"],
          iconName: "copy",
          source,
          category: "文案",
        },
      },
      {
        id: resultNodeId,
        position: { x: 40, y: 470 },
        data: {
          label: `${project.title} · 结果墙`,
          caption: project.description,
          kind: "output",
          status: "ready",
          metrics: [`${items.length} 张`, "多比例", "可追溯"],
          iconName: "output",
          source,
          category: "成片",
        },
      },
    ];
    const edges = [
      { id: `${project.slug}-product-output`, source: `${project.slug}-product-node`, target: resultNodeId, label: "锁商品", animated: true },
      { id: `${project.slug}-scene-output`, source: `${project.slug}-scene-node`, target: resultNodeId, label: "场景" },
      { id: `${project.slug}-style-output`, source: `${project.slug}-style-node`, target: resultNodeId, label: "风格" },
      { id: `${project.slug}-copy-output`, source: `${project.slug}-copy-node`, target: resultNodeId, label: "文案", animated: true },
    ];

    db.prepare(
      `INSERT OR REPLACE INTO workflows (id, title, description, nodes, edges, metadata, createdAt, updatedAt)
       VALUES (@id, @title, @description, @nodes, @edges, @metadata, @createdAt, @updatedAt)`
    ).run({
      id: workflowId,
      title: `${project.title} · 新展示项目`,
      description: project.description,
      nodes: JSON.stringify(nodes),
      edges: JSON.stringify(edges),
      metadata: JSON.stringify({ source, projectSlug: project.slug, batchId, canvasSavedAt: now }),
      createdAt: now,
      updatedAt: now,
    });

    db.prepare(
      `INSERT OR REPLACE INTO projects (id, title, description, status, metadata, createdAt, updatedAt)
       VALUES (@id, @title, @description, 'active', @metadata, @createdAt, @updatedAt)`
    ).run({
      id: projectId,
      title: `${project.title} · 新展示项目`,
      description: project.description,
      metadata: JSON.stringify({
        source,
        projectSlug: project.slug,
        canvasWorkflowId: workflowId,
        canvasSavedAt: now,
        demoSafe: true,
        showcasePackageDir: packageDir,
      }),
      createdAt: now,
      updatedAt: now,
    });

    const insertJob = db.prepare(
      `INSERT OR REPLACE INTO generation_jobs (
         id, workflowId, nodeId, assetId, batchId, exportPackId, planId,
         status, prompt, resultUrl, error, metadata, createdAt, updatedAt
       )
       VALUES (
         @id, @workflowId, @nodeId, @assetId, @batchId, '', @planId,
         'done', @prompt, @resultUrl, '', @metadata, @createdAt, @updatedAt
       )`
    );
    const insertArtifact = db.prepare(
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
      const jobId = `${projectToken}-job-${idSuffix}`;
      const artifactId = `${projectToken}-artifact-${idSuffix}`;
      const metadata = {
        source,
        projectSlug: project.slug,
        batchId,
        planId: `${project.slug}-fresh-plan`,
        planItemTitle: item.title,
        batchJobTitle: item.title,
        exportItemTitle: item.title,
        planItemType: item.type,
        imageType: item.group,
        useCase: item.group,
        ratio: item.ratio,
        size: `${item.width}x${item.height}`,
        prompt: item.prompt,
        provider: "fresh-provider-test",
        model: "configured-image-model",
        copyRenderPolicy: {
          mode: item.copyMode === "burn_in" ? "burn_in" : "layout_layer",
          burnIn: item.copyMode === "burn_in",
        },
        referenceImages: [
          { role: "product", title: "商品参考", url: productRef.publicUrl, providerUsable: true },
          { role: "scene", title: "场景参考", url: sceneRef.publicUrl, providerUsable: item.group === "场景图" },
          { role: "style", title: "风格参考", url: styleRef.publicUrl, providerUsable: true },
        ],
        providerReferenceAdapter: {
          providerRoles: item.group === "主图" || item.group === "细节图" ? ["product"] : ["product", "scene", "style"],
          promptOnlyRoles: item.copyMode === "burn_in" ? ["copy"] : [],
        },
        lockSummary: [
          { role: "product", label: "商品强锁", mode: "provider_reference" },
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
        assetId: `${projectToken}-product`,
        batchId,
        planId: `${project.slug}-fresh-plan`,
        prompt: item.prompt,
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
        assetId: `${projectToken}-product`,
        batchId,
        planId: `${project.slug}-fresh-plan`,
        type: item.type,
        title: item.title,
        url: item.publicUrl,
        prompt: item.prompt,
        provider: "fresh-provider-test",
        model: "configured-image-model",
        metadata: JSON.stringify(metadata),
        createdAt: now,
        updatedAt: now,
      });
    }
  } finally {
    db.close();
  }
  return { projectId, workflowId, batchId };
}

function makeAsset(projectToken, type, title, description, item) {
  const category = type === "product" ? "商品" : type === "scene" ? "场景" : "风格";
  return {
    id: `${projectToken}-${type}`,
    type,
    title,
    description,
    url: item.publicUrl,
    metadata: {
      source,
      category,
      canvasCategory: category,
      previewUrl: item.thumbnailUrl,
      referenceUrl: item.publicUrl,
      prompt: description,
      promptFragments: [description],
      imageStorage: {
        publicUrl: item.publicUrl,
        thumbnailUrl: item.thumbnailUrl,
        mimeType: "image/png",
      },
    },
  };
}

function makeVisualNode(id, title, category, caption, iconName, item, position, nodeSource) {
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
      source: nodeSource,
      category,
      parameters: {
        aspectRatio: item.width / item.height,
        ratio: item.ratio,
      },
    },
  };
}

async function readImageResult(url) {
  if (url.startsWith("data:image/")) {
    const base64 = url.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
    return Buffer.from(base64, "base64");
  }
  const resolved = url.startsWith("http") ? url : `${baseUrl}${url}`;
  const response = await fetch(resolved);
  if (!response.ok) throw new Error(`Failed to download generated image: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function createContactSheet(outputPath, items, project) {
  const cardWidth = 420;
  const cardHeight = 520;
  const gap = 28;
  const columns = Math.min(4, Math.max(2, items.length));
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
      .resize({ width: cardWidth, height: 390, fit: "contain", background: "#F7F1E8", withoutEnlargement: true })
      .png()
      .toBuffer();
    composites.push({ input: imageBuffer, left, top });
    composites.push({ input: Buffer.from(cardLabelSvg(cardWidth, 112, item)), left, top: top + 398 });
  }

  const baseSvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#F4EDE2"/>
      <text x="${gap}" y="58" fill="#2F2A24" font-size="34" font-weight="700" font-family="Arial, PingFang SC, sans-serif">${escapeXml(project.title)}</text>
      <text x="${gap}" y="96" fill="#776B5E" font-size="18" font-family="Arial, PingFang SC, sans-serif">Image Master 新项目测试 · ${escapeXml(project.description)}</text>
    </svg>
  `;
  await sharp(Buffer.from(baseSvg)).composite(composites).png().toFile(outputPath);
}

function cardLabelSvg(width, height, item) {
  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" rx="16" fill="#FFFDF9"/>
      <text x="18" y="32" fill="#2F2A24" font-size="18" font-weight="700" font-family="Arial, PingFang SC, sans-serif">${escapeXml(`${String(item.index + 1).padStart(2, "0")} ${item.title}`)}</text>
      <text x="18" y="60" fill="#8A755F" font-size="14" font-family="Arial, PingFang SC, sans-serif">${escapeXml(`${item.group} · ${item.ratio} · ${item.copyMode === "burn_in" ? "文案进图" : "无字/图层"}`)}</text>
      <text x="18" y="88" fill="#776B5E" font-size="13" font-family="Arial, PingFang SC, sans-serif">${escapeXml(item.description)}</text>
    </svg>
  `;
}

function buildStableHexSuffix(slug, index) {
  let hash = index + 1;
  for (const char of slug) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return (0x100000000000 + hash).toString(16).slice(-12);
}

function buildProjectReadme(manifest, project) {
  return `# ${project.title} · 新展示项目

${project.description}

## 本地预览

\`\`\`text
${manifest.canvasUrl}
\`\`\`

## 内容

- assets/generated-output-set/：真实 provider 新生成成片
- screenshots/00-output-contact-sheet.png：完整输出拼图
- copy/showcase-web-copy.md：展示网页文案
- manifest.json：项目、图片和 provider 估算记录
`;
}

function buildProjectCopy(project, manifest) {
  return `# ${project.title} 展示文案

标题：${project.title}

说明：${project.description}

可以强调：
- 这是一组新跑出来的 provider 测试项目，不是旧素材复用。
- 项目包含 ${manifest.outputs.length} 张成片，覆盖主图、场景、细节和海报。
- 文案只在需要的海报/卖点图进入图片，商品主体不承载广告字。

推荐截图：screenshots/07-output-contact-sheet.png
`;
}

function buildSuiteReadme(report) {
  return `# Fresh Showcase Suite

这是一组新生成的 Image Master 展示项目，用于补充项目展示网页的多品类案例。

## 项目

${report.projects.map((project) => `- ${project.title}: ${project.packageDir}`).join("\n")}
`;
}

async function requestJson(url, options = {}, expectedStatus = 200, timeoutMs = 120_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      signal: controller.signal,
    });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (response.status !== expectedStatus) {
      throw new Error(`Expected ${expectedStatus} from ${url}, got ${response.status}: ${JSON.stringify(json).slice(0, 1200)}`);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForServer(url, timeoutMs = 90_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
