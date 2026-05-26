import "server-only";

import fs from "fs/promises";
import path from "path";
import type { ExportPackManifest, ExportPackManifestItem } from "@/lib/canvas/export-pack-manifest";
import type { ExportPackQaReport } from "@/lib/canvas/export-pack-qa";
import { getGeneratedImagesDir } from "@/lib/store/data-paths";

export interface ExportPackArchiveMissingArtifact {
  jobId: string;
  title: string;
  naming: string;
  reason: string;
}

export interface ExportPackArchiveSkippedArtifact {
  jobId: string;
  title: string;
  naming: string;
  url: string;
  reason: string;
}

export interface ExportPackArchiveSummary {
  batchId: string;
  title: string;
  platform: string;
  mode: ExportPackArchiveMode;
  totalItems: number;
  includedImages: number;
  missingArtifacts: ExportPackArchiveMissingArtifact[];
  skippedArtifacts: ExportPackArchiveSkippedArtifact[];
  files: string[];
}

export interface ExportPackArchiveResult {
  buffer: Buffer;
  fileName: string;
  summary: ExportPackArchiveSummary;
}

interface BuildExportPackArchiveParams {
  manifest: ExportPackManifest;
  qaReport: ExportPackQaReport;
  mode?: ExportPackArchiveMode;
}

interface ArchiveImageFile {
  path: string;
  data: Buffer;
}

type ArchiveImageReadResult =
  | { status: "ready"; path: string; data: Buffer }
  | { status: "missing"; reason: string }
  | { status: "skipped"; reason: string };

type GeneratedImageReadResult =
  | { status: "ready"; path: string; data: Buffer }
  | { status: "skipped"; reason: string };

interface ZipFileEntry {
  path: string;
  data: Buffer;
}

export type ExportPackArchiveMode = "all" | "approved";

const GENERATED_DIR = getGeneratedImagesDir();
const GENERATED_IMAGE_PREFIX = "/api/generated-images/";
const SAFE_FILE_NAME = /^[a-z0-9][a-z0-9_-]*-[a-z0-9_-]+-[a-f0-9]{12}\.(png|jpg|jpeg|webp|gif|bin)$/i;
const UTF8_FLAG = 0x0800;

export async function buildExportPackArchive({
  manifest,
  qaReport,
  mode = "all",
}: BuildExportPackArchiveParams): Promise<ExportPackArchiveResult> {
  const usedPaths = new Set<string>();
  const missingArtifacts: ExportPackArchiveMissingArtifact[] = [];
  const skippedArtifacts: ExportPackArchiveSkippedArtifact[] = [];
  const imageFiles: ArchiveImageFile[] = [];
  const qaByJobId = new Map(qaReport.items.map((item) => [item.jobId, item]));

  for (const item of manifest.items) {
    const qaItem = qaByJobId.get(item.jobId);
    if (mode === "approved" && qaItem?.status !== "pass") {
      skippedArtifacts.push({
        jobId: item.jobId,
        title: item.title,
        naming: item.naming,
        url: item.artifact?.url ?? "",
        reason: `QA 未通过：${qaItem?.status ?? "missing"}`,
      });
      continue;
    }

    const image = await readArchiveImage(item, usedPaths);
    if (image.status === "ready") {
      imageFiles.push({ path: image.path, data: image.data });
      continue;
    }
    if (image.status === "missing") {
      missingArtifacts.push({
        jobId: item.jobId,
        title: item.title,
        naming: item.naming,
        reason: image.reason,
      });
      continue;
    }
    skippedArtifacts.push({
      jobId: item.jobId,
      title: item.title,
      naming: item.naming,
      url: item.artifact?.url ?? "",
      reason: image.reason,
    });
  }

  const summary: ExportPackArchiveSummary = {
    batchId: manifest.batchId,
    title: manifest.title,
    platform: manifest.platform,
    mode,
    totalItems: manifest.items.length,
    includedImages: imageFiles.length,
    missingArtifacts,
    skippedArtifacts,
    files: ["manifest.json", "qa-report.json", "summary.txt", "archive-summary.json", ...imageFiles.map((file) => file.path)],
  };

  const entries: ZipFileEntry[] = [
    {
      path: "manifest.json",
      data: toJsonBuffer(manifest),
    },
    {
      path: "qa-report.json",
      data: toJsonBuffer(qaReport),
    },
    {
      path: "summary.txt",
      data: Buffer.from(formatSummaryText(summary, qaReport), "utf8"),
    },
    {
      path: "archive-summary.json",
      data: toJsonBuffer(summary),
    },
    ...imageFiles,
  ];

  return {
    buffer: createStoreZip(entries),
    fileName: `${slugifyFileSegment(manifest.batchId, "export-pack")}-${mode === "approved" ? "approved-" : ""}export-pack.zip`,
    summary,
  };
}

async function readArchiveImage(
  item: ExportPackManifestItem,
  usedPaths: Set<string>
): Promise<ArchiveImageReadResult> {
  const url = item.artifact?.url?.trim();
  if (!url) {
    return { status: "missing", reason: "尚无产物 URL" };
  }

  if (url.startsWith(GENERATED_IMAGE_PREFIX)) {
    return readGeneratedImage(item, url, usedPaths);
  }

  const dataUrl = parseDataImageUrl(url);
  if (dataUrl) {
    return {
      status: "ready",
      path: getUniqueZipPath(
        `images/${slugifyFileSegment(item.naming || item.specId || item.jobId, item.jobId)}${dataUrl.ext}`,
        usedPaths
      ),
      data: dataUrl.data,
    };
  }

  return { status: "skipped", reason: "仅打包本地 generated image 或 data:image 产物" };
}

async function readGeneratedImage(
  item: ExportPackManifestItem,
  url: string,
  usedPaths: Set<string>
): Promise<GeneratedImageReadResult> {
  const rawFile = url.slice(GENERATED_IMAGE_PREFIX.length).split(/[?#]/)[0] ?? "";
  const file = safeDecodeURIComponent(rawFile);
  if (!isSafeGeneratedFileName(file)) {
    return { status: "skipped", reason: "产物文件名不在安全范围内" };
  }

  const filePath = path.resolve(GENERATED_DIR, file);
  const generatedRoot = path.resolve(GENERATED_DIR);
  if (!filePath.startsWith(`${generatedRoot}${path.sep}`)) {
    return { status: "skipped", reason: "产物路径不在安全范围内" };
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(file).toLowerCase() || ".bin";
    const baseName = slugifyFileSegment(item.naming || item.specId || item.jobId, item.jobId);
    return {
      status: "ready",
      path: getUniqueZipPath(`images/${baseName}${ext}`, usedPaths),
      data,
    };
  } catch {
    return { status: "skipped", reason: "产物文件尚不存在或不可读取" };
  }
}

function parseDataImageUrl(url: string): { data: Buffer; ext: string } | undefined {
  const match = url.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) return undefined;

  const compactBase64 = match[2].replace(/\s/g, "");
  if (!compactBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compactBase64)) return undefined;

  return {
    data: Buffer.from(compactBase64, "base64"),
    ext: extensionForMime(match[1].toLowerCase()),
  };
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".bin";
}

function formatSummaryText(summary: ExportPackArchiveSummary, qaReport: ExportPackQaReport): string {
  const lines = [
    "Image Master Export Pack",
    "",
    `Batch: ${summary.batchId}`,
    `Title: ${summary.title}`,
    `Platform: ${summary.platform}`,
    `Mode: ${summary.mode}`,
    `Items: ${summary.totalItems}`,
    `Included images: ${summary.includedImages}`,
    `Missing artifacts: ${summary.missingArtifacts.length}`,
    `Skipped artifacts: ${summary.skippedArtifacts.length}`,
    `QA: ${qaReport.summaryLabel}`,
    "",
    "Files:",
    ...summary.files.map((file) => `- ${file}`),
  ];

  if (summary.missingArtifacts.length > 0) {
    lines.push("", "Missing artifacts:");
    for (const item of summary.missingArtifacts) {
      lines.push(`- ${item.naming || item.jobId}: ${item.reason}`);
    }
  }

  if (summary.skippedArtifacts.length > 0) {
    lines.push("", "Skipped artifacts:");
    for (const item of summary.skippedArtifacts) {
      lines.push(`- ${item.naming || item.jobId}: ${item.reason}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function createStoreZip(entries: ZipFileEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const { time, date } = getDosTimestamp(new Date());

  for (const entry of entries) {
    const fileName = normalizeZipPath(entry.path);
    const fileNameBytes = Buffer.from(fileName, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(UTF8_FLAG, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(fileNameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, fileNameBytes, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(fileNameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, fileNameBytes);

    offset += localHeader.length + fileNameBytes.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(offset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}

function getDosTimestamp(value: Date): { time: number; date: number } {
  const year = Math.min(Math.max(value.getFullYear(), 1980), 2107);
  return {
    time:
      (value.getHours() << 11) |
      (value.getMinutes() << 5) |
      Math.floor(value.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
  };
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function getUniqueZipPath(candidate: string, usedPaths: Set<string>): string {
  const normalized = normalizeZipPath(candidate);
  if (!usedPaths.has(normalized)) {
    usedPaths.add(normalized);
    return normalized;
  }

  const ext = path.posix.extname(normalized);
  const base = normalized.slice(0, normalized.length - ext.length);
  let index = 2;
  while (usedPaths.has(`${base}-${index}${ext}`)) {
    index += 1;
  }
  const unique = `${base}-${index}${ext}`;
  usedPaths.add(unique);
  return unique;
}

function normalizeZipPath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => slugifyFileSegment(segment, "file"))
    .join("/");
}

function slugifyFileSegment(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return cleaned || fallback;
}

function toJsonBuffer(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isSafeGeneratedFileName(file: string): boolean {
  return file === path.basename(file) && SAFE_FILE_NAME.test(file);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
