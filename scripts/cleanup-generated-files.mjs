#!/usr/bin/env node

import Database from "better-sqlite3";
import fs from "fs/promises";
import path from "path";
import process from "process";

const PROJECT_ROOT = process.cwd();
const GENERATED_DIR = path.join(PROJECT_ROOT, ".data", "generated");
const DB_PATH = path.join(PROJECT_ROOT, ".data", "image-master.db");
const SAFE_FILE_NAME = /^[a-z0-9][a-z0-9_-]*-[a-z0-9_-]+-[a-f0-9]{12}\.(png|jpg|jpeg|webp|gif|bin)$/i;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

try {
  const summary = await cleanupGeneratedFiles(args);
  printSummary(summary, args.json);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ error: message }, null, 2));
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {
    dryRun: true,
    delete: false,
    json: false,
    maxAgeDays: 0,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--delete") {
      parsed.delete = true;
      parsed.dryRun = false;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--max-age-days") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error("--max-age-days requires a number");
      }
      parsed.maxAgeDays = parseMaxAgeDays(value);
      index += 1;
    } else if (arg.startsWith("--max-age-days=")) {
      parsed.maxAgeDays = parseMaxAgeDays(arg.slice("--max-age-days=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function parseMaxAgeDays(value) {
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) {
    throw new Error("--max-age-days must be a non-negative number");
  }
  return days;
}

async function cleanupGeneratedFiles(options) {
  const nowMs = Date.now();
  const generatedDirExists = await pathExists(GENERATED_DIR);
  const dbExists = await pathExists(DB_PATH);
  const files = generatedDirExists ? await listGeneratedFiles(nowMs) : [];
  const references = dbExists ? readReferencedGeneratedFiles(DB_PATH) : new Set();

  const referencedFiles = [];
  const orphanFiles = [];
  const deletableFiles = [];
  const skippedUnsafeFiles = [];
  const deletedFiles = [];
  let reclaimableBytes = 0;
  let reclaimedBytes = 0;

  for (const file of files) {
    const isReferenced = references.has(file.name);
    const isSafe = isSafeGeneratedFileName(file.name);

    if (isReferenced) {
      referencedFiles.push(file.name);
      continue;
    }

    if (!isSafe) {
      skippedUnsafeFiles.push(file.name);
      continue;
    }

    orphanFiles.push(file.name);

    if (file.ageDays >= options.maxAgeDays) {
      deletableFiles.push(file.name);
      reclaimableBytes += file.byteSize;

      if (options.delete) {
        await fs.unlink(file.path);
        deletedFiles.push(file.name);
        reclaimedBytes += file.byteSize;
      }
    }
  }

  return {
    generatedDir: GENERATED_DIR,
    databasePath: DB_PATH,
    generatedDirExists,
    databaseExists: dbExists,
    dryRun: options.dryRun,
    maxAgeDays: options.maxAgeDays,
    scannedFiles: files.length,
    referencedFiles: referencedFiles.length,
    orphanFiles: orphanFiles.length,
    deletableFiles: deletableFiles.length,
    deletedFiles: deletedFiles.length,
    skippedUnsafeFiles: skippedUnsafeFiles.length,
    reclaimableBytes,
    reclaimedBytes: options.delete ? reclaimedBytes : 0,
    details: {
      referencedFiles,
      orphanFiles,
      deletableFiles,
      deletedFiles,
      skippedUnsafeFiles,
    },
  };
}

async function listGeneratedFiles(nowMs) {
  const entries = await fs.readdir(GENERATED_DIR, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const filePath = path.join(GENERATED_DIR, entry.name);
    const stat = await fs.stat(filePath);
    files.push({
      name: entry.name,
      path: filePath,
      byteSize: stat.size,
      ageDays: Math.max(0, (nowMs - stat.mtimeMs) / 86_400_000),
    });
  }

  return files.sort((a, b) => a.name.localeCompare(b.name));
}

function readReferencedGeneratedFiles(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const referenceTexts = [
      ...readTableReferences(db, "assets", ["url", "metadata"]),
      ...readTableReferences(db, "generated_artifacts", ["url", "metadata"]),
      ...readTableReferences(db, "generation_jobs", ["resultUrl", "metadata"]),
    ];
    return extractReferencedFileNames(referenceTexts);
  } finally {
    db.close();
  }
}

function readTableReferences(db, tableName, columns) {
  if (!tableExists(db, tableName)) {
    return [];
  }

  const existingColumns = new Set(
    db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all().map((row) => row.name)
  );
  const selectedColumns = columns.filter((column) => existingColumns.has(column));
  if (selectedColumns.length === 0) {
    return [];
  }

  const sql = `SELECT ${selectedColumns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(tableName)}`;
  return db.prepare(sql).all().flatMap((row) => selectedColumns.map((column) => stringifyReference(row[column])));
}

function tableExists(db, tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function stringifyReference(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function extractReferencedFileNames(values) {
  const files = new Set();
  const generatedUrlPattern = /\/api\/generated-images\/([^"'`\s<>)\\]+)/g;

  for (const value of values) {
    if (!value) {
      continue;
    }

    for (const match of value.matchAll(generatedUrlPattern)) {
      const decoded = safeDecodeURIComponent(match[1]);
      if (decoded && isSafeGeneratedFileName(decoded)) {
        files.add(decoded);
      }
    }

    const text = value;
    for (const match of text.matchAll(/[a-z0-9][a-z0-9_-]*-[a-z0-9_-]+-[a-f0-9]{12}\.(?:png|jpg|jpeg|webp|gif|bin)/gi)) {
      const fileName = match[0];
      if (isSafeGeneratedFileName(fileName)) {
        files.add(fileName);
      }
    }
  }

  return files;
}

function isSafeGeneratedFileName(fileName) {
  return fileName === path.basename(fileName) && SAFE_FILE_NAME.test(fileName);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function printSummary(summary) {
  console.log(JSON.stringify(summary, null, 2));
}

function printHelp() {
  console.log(`Usage: node scripts/cleanup-generated-files.mjs [--json] [--delete] [--max-age-days N]

Defaults to dry-run mode and prints a stable JSON summary.

Options:
  --json              Print JSON output. JSON is the default output format.
  --delete            Delete orphan files that are safe and old enough.
  --max-age-days N    Only mark orphan files older than N days as deletable. Defaults to 0.
  -h, --help          Show this help.
`);
}
