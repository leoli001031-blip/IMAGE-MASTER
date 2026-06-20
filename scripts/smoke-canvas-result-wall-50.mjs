#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import Database from "better-sqlite3";

const args = new Set(process.argv.slice(2));
const keep = args.has("--keep");
const cleanupOnly = args.has("--cleanup");
const json = args.has("--json");
const count = getNumericArg("--count", 50);
const dataDir = path.resolve(process.env.IMAGE_MASTER_DATA_DIR || ".data");
const generatedDir = path.join(dataDir, "generated");
const dbPath = path.join(dataDir, "image-master.db");
const source = "canvas-result-wall-stress";
const stamp = Date.now();
const projectId = `project_canvas_result_wall_50_${stamp}`;
const workflowId = `workflow_canvas_result_wall_50_${stamp}`;
const batchId = `batch_canvas_result_wall_50_${stamp}`;

if (cleanupOnly) {
  const cleaned = cleanupStressRows();
  print({ ok: true, cleanup: cleaned });
  process.exit(0);
}

await fsp.mkdir(generatedDir, { recursive: true });

const db = new Database(dbPath);
try {
  ensureSchema(db);
  seedProject(db);
  seedWorkflow(db);
  const artifacts = seedArtifacts(db, count);
  const rows = db
    .prepare("SELECT * FROM generated_artifacts WHERE workflowId = ? ORDER BY createdAt DESC")
    .all(workflowId);

  assert.equal(rows.length, count, `Expected ${count} stress artifacts`);
  assert.equal(
    rows.filter((row) => {
      const metadata = parseJson(row.metadata);
      return metadata.thumbnailUrl && metadata.imageStorage?.thumbnailUrl && metadata.imageStorage?.publicUrl;
    }).length,
    count,
    "Every stress artifact should carry thumbnail and original storage metadata"
  );
  assert.equal(
    new Set(rows.map((row) => parseJson(row.metadata).ratio).filter(Boolean)).size >= 4,
    true,
    "Stress artifacts should cover multiple aspect ratios"
  );
  assertResultWallUsesThumbnails();

  const result = {
    ok: true,
    projectId,
    workflowId,
    batchId,
    count,
    dataDir,
    generatedDir,
    restoreUrl: `http://127.0.0.1:3000/canvas?projectId=${encodeURIComponent(projectId)}`,
    artifacts: artifacts.slice(0, 5).map((artifact) => ({
      id: artifact.id,
      ratio: artifact.ratio,
      url: artifact.url,
      thumbnailUrl: artifact.thumbnailUrl,
    })),
    kept: keep,
  };
  print(result);

  if (!keep) {
    cleanupStressRows();
  }
} finally {
  db.close();
}

function assertResultWallUsesThumbnails() {
  const resultNodeSource = fs.readFileSync(path.join(process.cwd(), "components/canvas/canvas-result-nodes.ts"), "utf8");
  const assetPreviewSource = fs.readFileSync(path.join(process.cwd(), "components/canvas/asset-preview.tsx"), "utf8");

  assert.match(
    resultNodeSource,
    /export function getArtifactPreviewUrl[\s\S]*getStoredImagePreviewUrl\(artifact\.metadata\) \|\| artifact\.url/,
    "Canvas result nodes should use thumbnail/preview URLs before falling back to originals"
  );
  assert.match(
    resultNodeSource,
    /previewUrl: getArtifactPreviewUrl\(artifact\)[\s\S]*referenceUrl: artifact\.url/,
    "Canvas result nodes should keep thumbnail preview separate from original detail URL"
  );
  assert.match(
    resultNodeSource,
    /originalUrl: artifact\.url[\s\S]*thumbnailUrl: getArtifactThumbnailUrl\(artifact\)/,
    "Canvas result node metadata should preserve both original and thumbnail URLs"
  );
  assert.match(
    assetPreviewSource,
    /IntersectionObserver[\s\S]*loading=\{eager \? "eager" : "lazy"\}[\s\S]*decoding="async"/,
    "Canvas image previews should lazy-load and async-decode thumbnails"
  );
  assert.match(
    resultNodeSource,
    /const nodeById = new Map\(nextNodes\.map/,
    "Canvas result reconciliation should index nodes instead of repeatedly scanning the node list"
  );
  assert.match(
    resultNodeSource,
    /nextEdges = nextEdges\.filter\(\(edge\) => \{[\s\S]*const sourceNode = nodeById\.get\(edge\.source\);[\s\S]*const targetNode = nodeById\.get\(edge\.target\);/,
    "Canvas result reconciliation should filter stale result edges through the node index"
  );
  assert.doesNotMatch(
    resultNodeSource,
    /for \(const artifact of artifacts\)[\s\S]*nextNodes\.find/,
    "Artifact reconciliation loop should not repeatedly call nextNodes.find"
  );
  assert.doesNotMatch(
    resultNodeSource,
    /for \(const artifact of artifacts\)[\s\S]*nextEdges\.some/,
    "Artifact reconciliation loop should not repeatedly call nextEdges.some"
  );
}

function seedWorkflow(database) {
  const now = new Date().toISOString();
  const nodes = [
    {
      id: "stress-anchor",
      position: { x: 32, y: 32 },
      data: {
        label: "50 张结果压力测试",
        caption: "临时压力测试锚点，可清理",
        kind: "asset",
        status: "ready",
        metrics: ["压力测试", "50 张", "缩略图"],
        iconName: "ai",
        source,
        category: "质检",
      },
    },
  ];
  database
    .prepare(
      `INSERT OR REPLACE INTO workflows (id, title, description, nodes, edges, metadata, createdAt, updatedAt)
       VALUES (@id, @title, @description, @nodes, @edges, @metadata, @createdAt, @updatedAt)`
    )
    .run({
      id: workflowId,
      title: "Canvas Result Wall 50 Stress",
      description: "Temporary 50-result canvas stress workflow",
      nodes: JSON.stringify(nodes),
      edges: "[]",
      metadata: JSON.stringify({ source, stressCount: count, batchId }),
      createdAt: now,
      updatedAt: now,
    });
}

function seedProject(database) {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT OR REPLACE INTO projects (id, title, description, status, metadata, createdAt, updatedAt)
       VALUES (@id, @title, @description, @status, @metadata, @createdAt, @updatedAt)`
    )
    .run({
      id: projectId,
      title: "50 张结果压力测试",
      description: "Temporary project for canvas result wall stress testing",
      status: "active",
      metadata: JSON.stringify({
        source,
        canvasWorkflowId: workflowId,
        canvasSavedAt: now,
        stressCount: count,
        batchId,
      }),
      createdAt: now,
      updatedAt: now,
    });
}

function seedArtifacts(database, total) {
  const ratios = [
    { ratio: "1:1", size: "1024x1024", type: "main", label: "主图" },
    { ratio: "3:2", size: "1536x1024", type: "hero", label: "主图" },
    { ratio: "4:5", size: "1024x1280", type: "poster", label: "海报" },
    { ratio: "9:16", size: "900x1600", type: "social", label: "海报" },
    { ratio: "16:9", size: "1600x900", type: "scene", label: "场景" },
    { ratio: "2:3", size: "1024x1536", type: "model", label: "模特" },
    { ratio: "1:1", size: "1024x1024", type: "detail", label: "详情" },
    { ratio: "3:2", size: "1536x1024", type: "macro", label: "细节" },
  ];
  const artifacts = [];
  const insert = database.prepare(
    `INSERT OR REPLACE INTO generated_artifacts (
       id, workflowId, nodeId, jobId, assetId, batchId, exportPackId, planId,
       type, title, status, url, prompt, provider, model, metadata, createdAt, updatedAt
     )
     VALUES (
       @id, @workflowId, @nodeId, @jobId, @assetId, @batchId, @exportPackId, @planId,
       @type, @title, @status, @url, @prompt, @provider, @model, @metadata, @createdAt, @updatedAt
     )`
  );

  for (let index = 0; index < total; index += 1) {
    const spec = ratios[index % ratios.length];
    const hex = (index + 1).toString(16).padStart(12, "0").slice(-12);
    const originalFileName = `stresswall-${String(index + 1).padStart(3, "0")}-original-${hex}.png`;
    const thumbFileName = `stresswall-${String(index + 1).padStart(3, "0")}-thumb-${hex}.png`;
    const originalPath = path.join(generatedDir, originalFileName);
    const thumbPath = path.join(generatedDir, thumbFileName);
    const color = colorForIndex(index);
    fs.writeFileSync(originalPath, createPng(80, 80, color));
    fs.writeFileSync(thumbPath, createPng(24, 24, color));
    const url = `/api/generated-images/${encodeURIComponent(originalFileName)}`;
    const thumbnailUrl = `/api/generated-images/${encodeURIComponent(thumbFileName)}`;
    const id = `artifact_canvas_wall_${stamp}_${String(index + 1).padStart(3, "0")}`;
    const now = new Date(Date.now() + index * 1000).toISOString();
    const title = `${spec.label} ${String(index + 1).padStart(2, "0")} · ${spec.ratio}`;
    const metadata = {
      source,
      batchId,
      projectId,
      batchIndex: index + 1,
      batchTotal: total,
      batchJobTitle: title,
      planItemTitle: title,
      exportItemTitle: title,
      exportSpecId: `${spec.type}-${index + 1}`,
      ratio: spec.ratio,
      size: spec.size,
      thumbnailUrl,
      imageStorage: {
        storage: "local-file",
        publicUrl: url,
        fileName: originalFileName,
        filePath: originalPath,
        thumbnailUrl,
        thumbnailFileName: thumbFileName,
        thumbnailPath: thumbPath,
        byteSize: fs.statSync(originalPath).size,
        thumbnailByteSize: fs.statSync(thumbPath).size,
      },
      prompt: `Stress prompt ${index + 1}: verify result wall thumbnail rendering and original detail URL.`,
      provider: "stress-local",
      model: "synthetic",
    };

    insert.run({
      id,
      workflowId,
      nodeId: "",
      jobId: "",
      assetId: "",
      batchId,
      exportPackId: batchId,
      planId: "",
      type: spec.type,
      title,
      status: "ready",
      url,
      prompt: metadata.prompt,
      provider: "stress-local",
      model: "synthetic",
      metadata: JSON.stringify(metadata),
      createdAt: now,
      updatedAt: now,
    });
    artifacts.push({ id, ratio: spec.ratio, url, thumbnailUrl });
  }
  return artifacts;
}

function cleanupStressRows() {
  if (!fs.existsSync(dbPath)) return { projects: 0, workflows: 0, artifacts: 0, files: 0 };
  const cleanupDb = new Database(dbPath);
  try {
    ensureSchema(cleanupDb);
    const rows = cleanupDb
      .prepare("SELECT metadata FROM generated_artifacts WHERE json_extract(metadata, '$.source') = ?")
      .all(source);
    const files = [];
    for (const row of rows) {
      const metadata = parseJson(row.metadata);
      for (const value of [
        metadata.imageStorage?.filePath,
        metadata.imageStorage?.thumbnailPath,
        metadata.resultStorage?.filePath,
        metadata.resultStorage?.thumbnailPath,
      ]) {
        if (typeof value === "string" && value.startsWith(generatedDir)) files.push(value);
      }
    }
    const artifactResult = cleanupDb
      .prepare("DELETE FROM generated_artifacts WHERE json_extract(metadata, '$.source') = ?")
      .run(source);
    const workflowResult = cleanupDb
      .prepare("DELETE FROM workflows WHERE json_extract(metadata, '$.source') = ?")
      .run(source);
    const projectResult = cleanupDb
      .prepare("DELETE FROM projects WHERE json_extract(metadata, '$.source') = ?")
      .run(source);
    let deletedFiles = 0;
    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      fs.unlinkSync(file);
      deletedFiles += 1;
    }
    return {
      projects: projectResult.changes,
      workflows: workflowResult.changes,
      artifacts: artifactResult.changes,
      files: deletedFiles,
    };
  } finally {
    cleanupDb.close();
  }
}

function ensureSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      nodes TEXT NOT NULL DEFAULT '[]',
      edges TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      metadata TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS generated_artifacts (
      id TEXT PRIMARY KEY,
      workflowId TEXT,
      nodeId TEXT,
      jobId TEXT,
      assetId TEXT,
      batchId TEXT NOT NULL DEFAULT '',
      exportPackId TEXT NOT NULL DEFAULT '',
      planId TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'image',
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready',
      url TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_generated_artifacts_workflowId ON generated_artifacts(workflowId);
    CREATE INDEX IF NOT EXISTS idx_generated_artifacts_batchId ON generated_artifacts(batchId);
  `);
}

function createPng(width, height, [r, g, b]) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.concat([
      uint32(width),
      uint32(height),
      Buffer.from([8, 6, 0, 0, 0]),
    ])),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  return Buffer.concat([
    uint32(data.length),
    typeBuffer,
    data,
    uint32(crc32(Buffer.concat([typeBuffer, data]))),
  ]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function colorForIndex(index) {
  const hash = crypto.createHash("sha1").update(String(index)).digest();
  return [80 + (hash[0] % 150), 80 + (hash[1] % 150), 80 + (hash[2] % 150)];
}

function parseJson(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getNumericArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.slice(name.length + 1));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function print(value) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (value.cleanup) {
    console.log(
      `Canvas result wall stress cleanup: ${value.cleanup.projects} projects, ${value.cleanup.workflows} workflows, ${value.cleanup.artifacts} artifacts, ${value.cleanup.files} files.`
    );
    return;
  }
  console.log(
    [
      `Canvas result wall stress seeded ${value.count} artifacts.`,
      `projectId=${value.projectId}`,
      `workflowId=${value.workflowId}`,
      `Open ${value.restoreUrl}`,
      value.kept ? "Kept stress data for browser verification." : "Stress data validated and cleaned up.",
    ].join("\n")
  );
}
