#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import Database from "better-sqlite3";

const write = process.argv.includes("--write");
const reset = process.argv.includes("--reset");
const root = process.cwd();
const dataDir = path.join(root, ".data");
const generatedDir = path.join(dataDir, "generated");
const dbPath = path.join(dataDir, "image-master.db");
const batchId = getArgValue("--batch-id") || "demo_batch_showcase";
const fallbackWorkflowId = "workflow_demo_export_pack";
const nodeId = "demo-export-pack-node";
const assetId = "demo-product-asset";
const demoSource = "demo-export-pack-seed";
const preserveSmoke = process.argv.includes("--preserve-smoke");
let crc32Table;

const items = [
  {
    jobId: "job_demo_taobao_main_01",
    artifactId: "artifact_demo_taobao_main_01",
    title: "淘宝主图",
    specTitle: "主图方图",
    specId: "taobao-main",
    naming: "demo_taobao_main_01",
    size: "800x800",
    ratio: "1:1",
    fileName: "demo-taobao-main-aaaaaaaaaaaa.png",
    width: 800,
    height: 800,
    color: [238, 246, 255, 255],
  },
  {
    jobId: "job_demo_taobao_detail_01",
    artifactId: "artifact_demo_taobao_detail_01",
    title: "淘宝详情页",
    specTitle: "详情长图",
    specId: "taobao-detail",
    naming: "demo_taobao_detail_01",
    size: "750x1200",
    ratio: "5:8",
    fileName: "demo-taobao-detail-bbbbbbbbbbbb.png",
    width: 750,
    height: 1200,
    color: [245, 241, 232, 255],
  },
];

const demoCanvasNodes = [
  {
    id: "product",
    position: { x: 30, y: 180 },
    data: {
      label: "商品资产",
      caption: "上传图已转成商品组件",
      kind: "asset",
      status: "ready",
      metrics: ["材质: 棉质针织", "主色: 暖白", "卖点: 版型清爽"],
      iconName: "product",
      previewUrl: "/canvas-assets/product-main.svg",
      previewAlt: "白色针织上衣商品资产",
    },
  },
  {
    id: "brief",
    position: { x: 310, y: 70 },
    data: {
      label: "AI 商品 Brief",
      caption: "结构化卖点与不可变规则",
      kind: "factory",
      status: "ready",
      metrics: ["保留领口比例", "Logo 不得重绘", "袖长需一致"],
      iconName: "ai",
      previewUrl: "/canvas-assets/brief.svg",
      previewAlt: "商品 Brief 结构化分析",
    },
  },
  {
    id: "model",
    position: { x: 610, y: 20 },
    data: {
      label: "模特展示图",
      caption: "日常通勤半身展示",
      kind: "output",
      status: "ready",
      metrics: ["3 张", "4:5", "自然暖光"],
      iconName: "model",
      previewUrl: "/canvas-assets/output-model.svg",
      previewAlt: "模特展示图输出预览",
    },
  },
  {
    id: "detail",
    position: { x: 610, y: 205 },
    data: {
      label: "详情页模块",
      caption: "首屏、细节、卖点条",
      kind: "output",
      status: "ready",
      metrics: ["6 屏", "750px 宽", "中文文案"],
      iconName: "output",
      previewUrl: "/canvas-assets/output-detail.svg",
      previewAlt: "详情页模块输出预览",
    },
  },
  {
    id: "platform",
    position: { x: 900, y: 120 },
    data: {
      label: "平台输出包",
      caption: "淘宝 / 小红书 / 站内 Banner",
      kind: "output",
      status: "ready",
      metrics: ["12 张", "命名规范", "含封面"],
      iconName: "platform",
      previewUrl: "/canvas-assets/output-platform.svg",
      previewAlt: "平台输出包图集预览",
    },
  },
  {
    id: "review",
    position: { x: 900, y: 320 },
    data: {
      label: "AI 质检",
      caption: "一致性、遮挡、平台风险",
      kind: "review",
      status: "review",
      metrics: ["颜色偏差 < 8%", "Logo 检查", "手部遮挡"],
      iconName: "review",
      previewUrl: "/canvas-assets/quality-commerce.svg",
      previewAlt: "AI 质检结果预览",
    },
  },
];

const demoCanvasEdges = [
  { id: "product-brief", source: "product", target: "brief", animated: true, label: "分析" },
  { id: "product-model", source: "product", target: "model", label: "穿搭展示" },
  { id: "brief-detail", source: "brief", target: "detail", animated: true, label: "编排" },
  { id: "model-platform", source: "model", target: "platform", label: "图集" },
  { id: "detail-platform", source: "detail", target: "platform", label: "页面" },
  { id: "platform-review", source: "platform", target: "review", animated: true, label: "质检" },
];

const now = new Date().toISOString();

if (!write) {
  const dryRunWorkflowId =
    getArgValue("--workflow-id") || getLatestCanvasWorkflowIdFromFile() || fallbackWorkflowId;
  const cleanupPlan = getDemoStateCleanupPlan();
  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        batchId,
        reset,
        preserveSmoke,
        database: dbPath,
        generatedDir,
        workflowId: dryRunWorkflowId,
        jobs: items.map((item) => item.jobId),
        artifacts: items.map((item) => item.artifactId),
        cleanupPlan,
        note: "Run with --write to insert the demo batch, reset the canvas demo state, and remove smoke display residue.",
      },
      null,
      2
    )
  );
  process.exit(0);
}

await fs.mkdir(generatedDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
const workflowId = getArgValue("--workflow-id") || getLatestCanvasWorkflowId(db) || fallbackWorkflowId;

const transaction = db.transaction(() => {
  const cleanup = preserveSmoke ? emptyCleanupResult() : cleanSmokeDisplayResidue(db);
  const restoredWorkflowId = upsertDemoCanvasWorkflow(db, workflowId);

  if (reset) {
    for (const item of items) {
      db.prepare("DELETE FROM generated_artifacts WHERE id = ?").run(item.artifactId);
      db.prepare("DELETE FROM generation_jobs WHERE id = ?").run(item.jobId);
    }
  }

  for (const [index, item] of items.entries()) {
    const url = `/api/generated-images/${item.fileName}`;
    const metadata = buildMetadata(item, index);
    db.prepare(
      `INSERT OR REPLACE INTO generation_jobs (
         id, workflowId, nodeId, assetId, status, prompt, resultUrl, error, metadata, createdAt, updatedAt
       )
       VALUES (
         @id, @workflowId, @nodeId, @assetId, @status, @prompt, @resultUrl, @error, @metadata, @createdAt, @updatedAt
       )`
    ).run({
      id: item.jobId,
      workflowId: restoredWorkflowId,
      nodeId,
      assetId,
      status: "done",
      prompt: `Demo completed export-pack image for ${item.title}`,
      resultUrl: url,
      error: "",
      metadata: JSON.stringify(metadata),
      createdAt: now,
      updatedAt: now,
    });

    db.prepare(
      `INSERT OR REPLACE INTO generated_artifacts (
         id, workflowId, nodeId, jobId, assetId, type, title, status, url,
         prompt, provider, model, metadata, createdAt, updatedAt
       )
       VALUES (
         @id, @workflowId, @nodeId, @jobId, @assetId, @type, @title, @status, @url,
         @prompt, @provider, @model, @metadata, @createdAt, @updatedAt
       )`
    ).run({
      id: item.artifactId,
      workflowId: restoredWorkflowId,
      nodeId,
      jobId: item.jobId,
      assetId,
      type: "image",
      title: `${item.title} Demo`,
      status: "ready",
      url,
      prompt: `Demo completed export-pack image for ${item.title}`,
      provider: "local-demo",
      model: "seed-demo-export-pack",
      metadata: JSON.stringify(metadata),
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    cleanup,
    workflowId: restoredWorkflowId,
  };
});

const result = transaction();

for (const item of items) {
  const imagePath = path.join(generatedDir, item.fileName);
  await fs.writeFile(imagePath, createPng(item.width, item.height, item.color));
}

console.log(
  JSON.stringify(
    {
      mode: "write",
      batchId,
      workflowId: result.workflowId,
      reset,
      preserveSmoke,
      cleanup: result.cleanup,
      jobs: items.length,
      artifacts: items.length,
      files: items.map((item) => path.join(generatedDir, item.fileName)),
    },
    null,
    2
  )
);

function buildMetadata(item, index) {
  return {
    source: demoSource,
    batchId,
    batchIndex: index,
    batchTotal: items.length,
    batchJobTitle: item.title,
    batchCaption: `Demo export pack ${index + 1}/${items.length} · ${item.size}`,
    exportPackId: "demo-taobao-export-pack",
    exportPackTitle: "Demo 淘宝图组",
    exportItemId: item.specId,
    exportItemTitle: item.title,
    exportSpecId: item.specId,
    exportSpecTitle: item.specTitle,
    platform: "taobao",
    size: item.size,
    ratio: item.ratio,
    imageWidth: item.width,
    imageHeight: item.height,
    naming: item.naming,
    qualityRules: ["白底/场景要求", "文字合规", "商品主体清晰"],
    useCase: "public-demo",
    whiteBackground: item.specId === "taobao-main",
    textAllowed: item.specId !== "taobao-main",
    modelRequired: false,
  };
}

function upsertDemoCanvasWorkflow(db, preferredWorkflowId) {
  const existing = db
    .prepare(
      "SELECT id FROM workflows WHERE json_extract(metadata, '$.kind') = 'canvas-workbench' ORDER BY updatedAt DESC LIMIT 1"
    )
    .get();
  const id =
    typeof existing?.id === "string" && existing.id.trim()
      ? existing.id.trim()
      : preferredWorkflowId || fallbackWorkflowId;

  db.prepare(
    `INSERT INTO workflows (id, title, description, nodes, edges, metadata, createdAt, updatedAt)
     VALUES (@id, @title, @description, @nodes, @edges, @metadata, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title,
       description=excluded.description,
       nodes=excluded.nodes,
       edges=excluded.edges,
       metadata=excluded.metadata,
       updatedAt=excluded.updatedAt`
  ).run({
    id,
    title: "默认商业图片工作流",
    description: "干净的 Image Master canvas MVP 展示态",
    nodes: JSON.stringify(demoCanvasNodes),
    edges: JSON.stringify(demoCanvasEdges),
    metadata: JSON.stringify({
      kind: "canvas-workbench",
      base: "demo-canvas-mvp-v1",
      source: demoSource,
      demoBatchId: batchId,
      excludesSmokeArtifacts: true,
      updatedAt: now,
    }),
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

function cleanSmokeDisplayResidue(db) {
  const result = emptyCleanupResult();
  const smokeJobIds = db
    .prepare(
      `SELECT id FROM generation_jobs
       WHERE id LIKE 'smoke_%'
          OR workflowId LIKE 'smoke_%'
          OR workflowId LIKE 'wf_smoke_%'
          OR nodeId LIKE 'smoke_%'
          OR assetId LIKE 'smoke_%'
          OR prompt LIKE '%smoke%'
          OR metadata LIKE '%"source":"%smoke%'
          OR metadata LIKE '%"smoke":true%'`
    )
    .all()
    .map((row) => row.id);
  const smokeArtifactIds = db
    .prepare(
      `SELECT id FROM generated_artifacts
       WHERE id LIKE 'smoke_%'
          OR workflowId LIKE 'smoke_%'
          OR workflowId LIKE 'wf_smoke_%'
          OR nodeId LIKE 'smoke_%'
          OR assetId LIKE 'smoke_%'
          OR jobId LIKE 'smoke_%'
          OR title LIKE '%smoke%'
          OR prompt LIKE '%smoke%'
          OR provider LIKE '%smoke%'
          OR metadata LIKE '%"source":"%smoke%'
          OR metadata LIKE '%"source":"demo-ui-test"%'
          OR metadata LIKE '%"smoke":true%'`
    )
    .all()
    .map((row) => row.id);
  const smokeReviewSessionIds = db
    .prepare(
      `SELECT id FROM review_sessions
       WHERE id LIKE 'smoke_%'
          OR title LIKE '%smoke%'
          OR metadata LIKE '%"source":"%smoke%'
          OR metadata LIKE '%"smoke":true%'`
    )
    .all()
    .map((row) => row.id);
  const smokeProjectBatchIds = db
    .prepare(
      `SELECT id FROM project_batches
       WHERE id LIKE 'smoke_%'
          OR title LIKE '%Smoke%'
          OR title LIKE '%smoke%'
          OR metadata LIKE '%"source":"%smoke%'
          OR metadata LIKE '%"platform":"smoke"%'
          OR metadata LIKE '%"batchId":"smoke_%'
          OR metadata LIKE '%"smoke":true%'`
    )
    .all()
    .map((row) => row.id);

  if (smokeArtifactIds.length > 0) {
    result.generatedArtifacts = deleteByIds(db, "generated_artifacts", smokeArtifactIds);
  }
  if (smokeJobIds.length > 0) {
    result.generationJobs = deleteByIds(db, "generation_jobs", smokeJobIds);
  }
  if (smokeReviewSessionIds.length > 0) {
    result.reviewSessions = deleteByIds(db, "review_sessions", smokeReviewSessionIds);
  }
  if (smokeProjectBatchIds.length > 0) {
    result.projectBatches = deleteByIds(db, "project_batches", smokeProjectBatchIds);
  }

  return result;
}

function deleteByIds(db, table, ids) {
  const statement = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
  let count = 0;
  for (const id of Array.from(new Set(ids))) {
    count += statement.run(id).changes;
  }
  return count;
}

function emptyCleanupResult() {
  return {
    generationJobs: 0,
    generatedArtifacts: 0,
    reviewSessions: 0,
    projectBatches: 0,
  };
}

function createPng(width, height, color) {
  const bytesPerPixel = 4;
  const rowSize = 1 + width * bytesPerPixel;
  const raw = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowSize;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixelStart = rowStart + 1 + x * bytesPerPixel;
      raw[pixelStart] = color[0];
      raw[pixelStart + 1] = color[1];
      raw[pixelStart + 2] = color[2];
      raw[pixelStart + 3] = color[3];
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", createIhdr(width, height)),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function createIhdr(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return ihdr;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  const table = getCrc32Table();
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function getCrc32Table() {
  if (crc32Table) return crc32Table;
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  crc32Table = table;
  return table;
}

function getArgValue(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
}

function getLatestCanvasWorkflowId(db) {
  try {
    const row = db
      .prepare(
        "SELECT id FROM workflows WHERE json_extract(metadata, '$.kind') = 'canvas-workbench' ORDER BY updatedAt DESC LIMIT 1"
      )
      .get();
    return typeof row?.id === "string" && row.id.trim() ? row.id.trim() : undefined;
  } catch {
    return undefined;
  }
}

function getLatestCanvasWorkflowIdFromFile() {
  try {
    const db = new Database(dbPath, { readonly: true });
    const workflowId = getLatestCanvasWorkflowId(db);
    db.close();
    return workflowId;
  } catch {
    return undefined;
  }
}

function getDemoStateCleanupPlan() {
  try {
    const db = new Database(dbPath, { readonly: true });
    const plan = {
      generationJobs: countRows(
        db,
        `SELECT COUNT(*) AS count FROM generation_jobs
         WHERE id LIKE 'smoke_%'
            OR workflowId LIKE 'smoke_%'
            OR workflowId LIKE 'wf_smoke_%'
            OR nodeId LIKE 'smoke_%'
            OR assetId LIKE 'smoke_%'
            OR prompt LIKE '%smoke%'
            OR metadata LIKE '%"source":"%smoke%'
            OR metadata LIKE '%"smoke":true%'`
      ),
      generatedArtifacts: countRows(
        db,
        `SELECT COUNT(*) AS count FROM generated_artifacts
         WHERE id LIKE 'smoke_%'
            OR workflowId LIKE 'smoke_%'
            OR workflowId LIKE 'wf_smoke_%'
            OR nodeId LIKE 'smoke_%'
            OR assetId LIKE 'smoke_%'
            OR jobId LIKE 'smoke_%'
            OR title LIKE '%smoke%'
            OR prompt LIKE '%smoke%'
            OR provider LIKE '%smoke%'
            OR metadata LIKE '%"source":"%smoke%'
            OR metadata LIKE '%"source":"demo-ui-test"%'
            OR metadata LIKE '%"smoke":true%'`
      ),
      reviewSessions: countRows(
        db,
        `SELECT COUNT(*) AS count FROM review_sessions
         WHERE id LIKE 'smoke_%'
            OR title LIKE '%smoke%'
            OR metadata LIKE '%"source":"%smoke%'
            OR metadata LIKE '%"smoke":true%'`
      ),
      projectBatches: countRows(
        db,
        `SELECT COUNT(*) AS count FROM project_batches
         WHERE id LIKE 'smoke_%'
            OR title LIKE '%Smoke%'
            OR title LIKE '%smoke%'
            OR metadata LIKE '%"source":"%smoke%'
            OR metadata LIKE '%"platform":"smoke"%'
            OR metadata LIKE '%"batchId":"smoke_%'
            OR metadata LIKE '%"smoke":true%'`
      ),
    };
    db.close();
    return plan;
  } catch {
    return emptyCleanupResult();
  }
}

function countRows(db, sql) {
  const row = db.prepare(sql).get();
  return Number(row?.count ?? 0);
}
