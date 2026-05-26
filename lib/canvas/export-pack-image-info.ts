import "server-only";

import fs from "fs/promises";
import path from "path";
import type { ExportPackManifest } from "@/lib/canvas/export-pack-manifest";
import type { ExportPackImageInfo } from "@/lib/canvas/export-pack-qa";
import { getGeneratedImagesDir } from "@/lib/store/data-paths";

const GENERATED_DIR = getGeneratedImagesDir();
const GENERATED_IMAGE_PREFIX = "/api/generated-images/";
const SAFE_FILE_NAME = /^[a-z0-9][a-z0-9_-]*-[a-z0-9_-]+-[a-f0-9]{12}\.(png|jpg|jpeg|webp|gif|bin)$/i;

export async function buildExportPackImageInfoMap(
  manifest: ExportPackManifest
): Promise<Record<string, ExportPackImageInfo>> {
  const urls = manifest.items.map((item) => item.artifact?.url).filter((url): url is string => !!url);
  const uniqueUrls = Array.from(new Set(urls));
  const entries = await Promise.all(
    uniqueUrls.map(async (url) => [url, await readImageInfo(url)] as const)
  );
  return Object.fromEntries(entries);
}

async function readImageInfo(url: string): Promise<ExportPackImageInfo> {
  const bufferResult = await readImageBuffer(url);
  if (bufferResult.ok === false) {
    return {
      exists: false,
      error: bufferResult.error,
    };
  }

  const dimensions = parseImageDimensions(bufferResult.buffer);
  return {
    exists: true,
    width: dimensions?.width,
    height: dimensions?.height,
    mimeType: dimensions?.mimeType ?? bufferResult.mimeType,
    byteSize: bufferResult.buffer.byteLength,
    error: dimensions ? undefined : "产物存在，但暂不支持解析该图片尺寸",
  };
}

async function readImageBuffer(
  url: string
): Promise<{ ok: true; buffer: Buffer; mimeType?: string } | { ok: false; error: string }> {
  if (url.startsWith(GENERATED_IMAGE_PREFIX)) {
    return readGeneratedImageBuffer(url);
  }

  const dataUrl = parseDataImageUrl(url);
  if (dataUrl) {
    return dataUrl;
  }

  return { ok: false, error: "仅支持本地 generated image 或 data:image 产物的尺寸解析" };
}

async function readGeneratedImageBuffer(
  url: string
): Promise<{ ok: true; buffer: Buffer; mimeType?: string } | { ok: false; error: string }> {
  const file = safeDecodeURIComponent(url.slice(GENERATED_IMAGE_PREFIX.length));
  if (!isSafeGeneratedFileName(file)) {
    return { ok: false, error: "产物文件名不在安全范围内" };
  }

  const filePath = path.resolve(GENERATED_DIR, file);
  const generatedRoot = path.resolve(GENERATED_DIR);
  if (!filePath.startsWith(`${generatedRoot}${path.sep}`)) {
    return { ok: false, error: "产物路径不在安全范围内" };
  }

  try {
    return { ok: true, buffer: await fs.readFile(filePath) };
  } catch {
    return { ok: false, error: "产物文件尚不存在或不可读取" };
  }
}

function parseDataImageUrl(
  url: string
): { ok: true; buffer: Buffer; mimeType?: string } | undefined {
  const match = url.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) return undefined;

  const compactBase64 = match[2].replace(/\s/g, "");
  if (!compactBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compactBase64)) return undefined;

  return {
    ok: true,
    buffer: Buffer.from(compactBase64, "base64"),
    mimeType: match[1].toLowerCase(),
  };
}

function parseImageDimensions(
  buffer: Buffer
): { width: number; height: number; mimeType: string } | undefined {
  return parsePngDimensions(buffer) ?? parseJpegDimensions(buffer) ?? parseWebpDimensions(buffer);
}

function parsePngDimensions(
  buffer: Buffer
): { width: number; height: number; mimeType: string } | undefined {
  if (buffer.length < 24) return undefined;
  if (
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47 ||
    buffer[4] !== 0x0d ||
    buffer[5] !== 0x0a ||
    buffer[6] !== 0x1a ||
    buffer[7] !== 0x0a
  ) {
    return undefined;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    mimeType: "image/png",
  };
}

function parseJpegDimensions(
  buffer: Buffer
): { width: number; height: number; mimeType: string } | undefined {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return undefined;

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    offset += 2;

    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > buffer.length) break;

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;

    if (isJpegStartOfFrame(marker) && segmentLength >= 7) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
        mimeType: "image/jpeg",
      };
    }

    offset += segmentLength;
  }

  return undefined;
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function parseWebpDimensions(
  buffer: Buffer
): { width: number; height: number; mimeType: string } | undefined {
  if (buffer.length < 30) return undefined;
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return undefined;
  }

  const chunkType = buffer.toString("ascii", 12, 16);
  if (chunkType === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
      mimeType: "image/webp",
    };
  }

  if (chunkType === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
      mimeType: "image/webp",
    };
  }

  if (chunkType === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      mimeType: "image/webp",
    };
  }

  return undefined;
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
