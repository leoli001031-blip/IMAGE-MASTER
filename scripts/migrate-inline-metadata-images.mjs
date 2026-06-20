#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const INLINE_IMAGE_RE = /^data:(image\/[a-z0-9.+-]+)?(?:;[^,]*)?;base64,([\s\S]+)$/i;
const MIME_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const TABLES = {
  assets: {
    table: "assets",
    idColumn: "id",
    updatedAtColumn: "updatedAt",
  },
  jobs: {
    table: "generation_jobs",
    idColumn: "id",
    updatedAtColumn: "updatedAt",
  },
  artifacts: {
    table: "generated_artifacts",
    idColumn: "id",
    updatedAtColumn: "updatedAt",
  },
};

const options = parseArgs(process.argv.slice(2));
const dataDir = resolveDataDir();
const dbPath = path.join(dataDir, "image-master.db");
const generatedDir = path.join(dataDir, "generated");

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);
const report = {
  mode: options.apply ? "apply" : "dry-run",
  dbPath,
  generatedDir,
  tables: {},
  totals: {
    scannedRows: 0,
    changedRows: 0,
    inlineImages: 0,
    uniqueImages: 0,
    originalMetadataBytes: 0,
    nextMetadataBytes: 0,
    writtenFiles: 0,
    failedImages: 0,
  },
  vacuum: {
    requested: options.vacuum,
    ran: false,
  },
  backup: {
    requested: options.backup,
    path: "",
    created: false,
  },
};

try {
  if (options.apply) {
    fs.mkdirSync(generatedDir, { recursive: true });
    if (options.backup) {
      report.backup.path = await createBackup();
      report.backup.created = true;
    }
  }

  for (const key of selectedTableKeys()) {
    report.tables[key] = await processTable(TABLES[key]);
  }

  if (options.apply && options.vacuum) {
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.exec("VACUUM");
    report.vacuum.ran = true;
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
} finally {
  db.close();
}

async function processTable(config) {
  const rows = db
    .prepare(
      `SELECT ${config.idColumn} as id, metadata, length(metadata) as metadataBytes
       FROM ${config.table}
       WHERE metadata LIKE '%data:image/%'
       ORDER BY createdAt DESC
       ${options.limit ? "LIMIT ?" : ""}`
    )
    .iterate(...(options.limit ? [options.limit] : []));

  const update = db.prepare(
    `UPDATE ${config.table}
     SET metadata = @metadata, ${config.updatedAtColumn} = @updatedAt
     WHERE ${config.idColumn} = @id`
  );

  const tableReport = {
    table: config.table,
    scannedRows: 0,
    changedRows: 0,
    inlineImages: 0,
    uniqueImages: 0,
    originalMetadataBytes: 0,
    nextMetadataBytes: 0,
    writtenFiles: 0,
    failedImages: 0,
    largestRows: [],
  };
  const cache = new Map();
  const updates = [];

  for (const row of rows) {
    tableReport.scannedRows += 1;
    trackLargestRow(tableReport, row);
    const originalMetadata = String(row.metadata || "{}");
    tableReport.originalMetadataBytes += Buffer.byteLength(originalMetadata);
    let metadata;
    try {
      metadata = JSON.parse(originalMetadata);
    } catch {
      tableReport.nextMetadataBytes += Buffer.byteLength(originalMetadata);
      continue;
    }

    const context = {
      cache,
      inlineImages: 0,
      failedImages: 0,
      writtenFiles: 0,
    };
    const nextMetadata = await replaceInlineImages(metadata, context);
    const nextMetadataString = JSON.stringify(nextMetadata);
    const changed = nextMetadataString !== originalMetadata;

    tableReport.inlineImages += context.inlineImages;
    tableReport.failedImages += context.failedImages;
    tableReport.writtenFiles += context.writtenFiles;
    tableReport.nextMetadataBytes += Buffer.byteLength(changed ? nextMetadataString : originalMetadata);

    if (changed) {
      tableReport.changedRows += 1;
      if (options.apply) {
        updates.push({
          id: row.id,
          metadata: nextMetadataString,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  tableReport.uniqueImages = cache.size;
  if (options.apply && updates.length > 0) {
    const runUpdates = db.transaction((items) => {
      for (const item of items) update.run(item);
    });
    runUpdates(updates);
  }

  addTotals(tableReport);
  return tableReport;
}

function trackLargestRow(tableReport, row) {
  tableReport.largestRows.push({ id: row.id, metadataBytes: row.metadataBytes });
  tableReport.largestRows.sort((a, b) => b.metadataBytes - a.metadataBytes);
  if (tableReport.largestRows.length > 8) tableReport.largestRows.length = 8;
}

async function replaceInlineImages(value, context) {
  if (typeof value === "string") {
    const materialized = await materializeDataUrl(value, context);
    return materialized ?? value;
  }

  if (Array.isArray(value)) {
    const next = [];
    for (const item of value) {
      next.push(await replaceInlineImages(item, context));
    }
    return next;
  }

  if (value && typeof value === "object") {
    const entries = [];
    for (const [key, item] of Object.entries(value)) {
      entries.push([key, await replaceInlineImages(item, context)]);
    }
    return Object.fromEntries(entries);
  }

  return value;
}

async function materializeDataUrl(value, context) {
  const match = value.match(INLINE_IMAGE_RE);
  if (!match) return undefined;

  context.inlineImages += 1;
  const mimeType = normalizeMimeType(match[1] || "image/png");
  const base64 = match[2].replace(/\s/g, "");
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    context.failedImages += 1;
    return undefined;
  }

  const hash = crypto.createHash("sha256").update(base64).digest("hex").slice(0, 16);
  const cached = context.cache.get(hash);
  if (cached) return cached;

  const ext = MIME_EXTENSIONS[mimeType] || "bin";
  const fileName = `metadata-ref-${hash}.${ext}`;
  const publicUrl = `/api/generated-images/${encodeURIComponent(fileName)}`;
  context.cache.set(hash, publicUrl);

  if (!options.apply) return publicUrl;

  const filePath = path.join(generatedDir, fileName);
  if (!fs.existsSync(filePath)) {
    await fsp.writeFile(filePath, Buffer.from(base64, "base64"));
    context.writtenFiles += 1;
  }
  return publicUrl;
}

function addTotals(tableReport) {
  report.totals.scannedRows += tableReport.scannedRows;
  report.totals.changedRows += tableReport.changedRows;
  report.totals.inlineImages += tableReport.inlineImages;
  report.totals.uniqueImages += tableReport.uniqueImages;
  report.totals.originalMetadataBytes += tableReport.originalMetadataBytes;
  report.totals.nextMetadataBytes += tableReport.nextMetadataBytes;
  report.totals.writtenFiles += tableReport.writtenFiles;
  report.totals.failedImages += tableReport.failedImages;
}

function selectedTableKeys() {
  if (options.table === "all") return Object.keys(TABLES);
  return [options.table];
}

function parseArgs(args) {
  const parsed = {
    apply: false,
    vacuum: false,
    json: false,
    table: "all",
    limit: 0,
    backup: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") parsed.apply = true;
    else if (arg === "--vacuum") parsed.vacuum = true;
    else if (arg === "--no-backup") parsed.backup = false;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--table") {
      const value = args[index + 1];
      index += 1;
      if (!["all", "assets", "jobs", "artifacts"].includes(value)) {
        throw new Error("--table must be one of all, assets, jobs, artifacts");
      }
      parsed.table = value;
    } else if (arg === "--limit") {
      const value = Number(args[index + 1]);
      index += 1;
      parsed.limit = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!parsed.apply && parsed.vacuum) {
    throw new Error("--vacuum requires --apply");
  }

  return parsed;
}

async function createBackup() {
  db.pragma("wal_checkpoint(TRUNCATE)");
  const backupDir = path.join(dataDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `image-master-before-inline-metadata-${stamp}.db`);
  await fsp.copyFile(dbPath, backupPath);
  return backupPath;
}

function resolveDataDir() {
  const configured = process.env.IMAGE_MASTER_DATA_DIR?.trim();
  return configured ? path.resolve(process.cwd(), configured) : path.join(process.cwd(), ".data");
}

function normalizeMimeType(value) {
  const lower = String(value).trim().toLowerCase();
  return MIME_EXTENSIONS[lower] ? lower : "image/png";
}

function printReport(value) {
  console.log(`Inline metadata image migration (${value.mode})`);
  console.log(`DB: ${value.dbPath}`);
  console.log(`Generated dir: ${value.generatedDir}`);
  for (const table of Object.values(value.tables)) {
    console.log(
      `- ${table.table}: ${table.changedRows}/${table.scannedRows} rows would change, ` +
        `${table.inlineImages} inline images, ${formatBytes(table.originalMetadataBytes)} -> ` +
        `${formatBytes(table.nextMetadataBytes)} metadata`
    );
  }
  console.log(
    `Total: ${value.totals.changedRows}/${value.totals.scannedRows} rows, ` +
      `${value.totals.inlineImages} inline images, ${value.totals.uniqueImages} unique, ` +
      `${formatBytes(value.totals.originalMetadataBytes)} -> ${formatBytes(value.totals.nextMetadataBytes)}`
  );
  if (value.mode === "dry-run") {
    console.log("Dry-run only. Re-run with --apply to write changes; add --vacuum to compact the database afterward.");
  } else {
    if (value.backup.created) console.log(`Backup: ${value.backup.path}`);
    console.log(`Wrote ${value.totals.writtenFiles} files. Vacuum ran: ${value.vacuum.ran ? "yes" : "no"}.`);
  }
}

function formatBytes(value) {
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)}GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${value}B`;
}
