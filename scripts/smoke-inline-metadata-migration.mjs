#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const stamp = Date.now();
const dataDir = path.join(process.cwd(), ".data-smoke", `inline-metadata-migration-${stamp}`);
const dbPath = path.join(dataDir, "image-master.db");
const generatedDir = path.join(dataDir, "generated");
const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

try {
  fs.mkdirSync(dataDir, { recursive: true });
  seedDatabase();

  const dryRun = runMigration("--json");
  if (dryRun.mode !== "dry-run") throw new Error("Expected dry-run mode");
  if (dryRun.totals.changedRows !== 3) {
    throw new Error(`Expected 3 changed rows in dry-run, got ${dryRun.totals.changedRows}`);
  }
  if (fs.existsSync(generatedDir) && fs.readdirSync(generatedDir).length > 0) {
    throw new Error("Dry-run wrote generated files");
  }

  const applied = runMigration("--apply", "--json");
  if (applied.mode !== "apply") throw new Error("Expected apply mode");
  if (applied.totals.changedRows !== 3) {
    throw new Error(`Expected 3 changed rows in apply, got ${applied.totals.changedRows}`);
  }
  if (applied.totals.writtenFiles < 1) {
    throw new Error("Expected at least one materialized reference file");
  }

  assertMigratedRows();

  const secondDryRun = runMigration("--json");
  if (secondDryRun.totals.changedRows !== 0) {
    throw new Error(`Expected idempotent second dry-run, got ${secondDryRun.totals.changedRows}`);
  }

  console.log("Inline metadata migration smoke passed.");
} finally {
  if (process.env.IMAGE_MASTER_SMOKE_KEEP_DATA !== "1") {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function seedDatabase() {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE generation_jobs (
        id TEXT PRIMARY KEY,
        workflowId TEXT,
        nodeId TEXT,
        assetId TEXT,
        batchId TEXT NOT NULL DEFAULT '',
        exportPackId TEXT NOT NULL DEFAULT '',
        planId TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        prompt TEXT NOT NULL DEFAULT '',
        resultUrl TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE generated_artifacts (
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
      CREATE TABLE assets (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'ready',
        url TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const now = new Date().toISOString();
    const metadata = JSON.stringify({
      referenceImageUrl: tinyPng,
      referenceImages: [{ role: "product", url: tinyPng, providerUsable: true }],
      nested: { urls: [tinyPng] },
    });
    db.prepare(
      `INSERT INTO generation_jobs (
        id, workflowId, metadata, createdAt, updatedAt
      ) VALUES ('job_inline', 'workflow_inline', @metadata, @createdAt, @updatedAt)`
    ).run({ metadata, createdAt: now, updatedAt: now });
    db.prepare(
      `INSERT INTO generated_artifacts (
        id, workflowId, title, url, prompt, provider, model, metadata, createdAt, updatedAt
      ) VALUES (
        'artifact_inline', 'workflow_inline', 'artifact', '/api/generated-images/result.png',
        'prompt', 'smoke', 'mock', @metadata, @createdAt, @updatedAt
      )`
    ).run({ metadata, createdAt: now, updatedAt: now });
    db.prepare(
      `INSERT INTO assets (
        id, type, title, url, metadata, createdAt, updatedAt
      ) VALUES (
        'asset_inline', 'product', 'asset', '/api/generated-images/asset.png',
        @metadata, @createdAt, @updatedAt
      )`
    ).run({ metadata, createdAt: now, updatedAt: now });
  } finally {
    db.close();
  }
}

function runMigration(...args) {
  const result = spawnSync("node", ["scripts/migrate-inline-metadata-images.mjs", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      IMAGE_MASTER_DATA_DIR: dataDir,
    },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Migration failed:\n${result.stdout}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function assertMigratedRows() {
  const db = new Database(dbPath, { readonly: true });
  try {
    for (const table of ["assets", "generation_jobs", "generated_artifacts"]) {
      const row = db.prepare(`SELECT metadata FROM ${table} LIMIT 1`).get();
      const metadataText = String(row.metadata);
      if (metadataText.includes("data:image/")) {
        throw new Error(`${table} still contains inline image data`);
      }
      if (!metadataText.includes("/api/generated-images/metadata-ref-")) {
        throw new Error(`${table} does not contain materialized metadata reference URL`);
      }
    }
    const files = fs.existsSync(generatedDir) ? fs.readdirSync(generatedDir) : [];
    if (!files.some((file) => file.startsWith("metadata-ref-"))) {
      throw new Error("Materialized metadata reference file was not written");
    }
  } finally {
    db.close();
  }
}
