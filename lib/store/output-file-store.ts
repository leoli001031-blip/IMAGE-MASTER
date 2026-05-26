import "server-only";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { getGeneratedImagesDir } from "@/lib/store/data-paths";
import { safeLogError } from "@/lib/server/safe-log";

const GENERATED_DIR = getGeneratedImagesDir();
const DEFAULT_MAX_OUTPUT_FILE_MB = 64;
const MIN_FREE_SPACE_BUFFER_BYTES = 50 * 1024 * 1024;
const MAX_OUTPUT_FILE_BYTES = getMaxOutputFileBytes();
const OPTIMIZE_PROVIDER_REFERENCES = process.env.IMAGE_MASTER_OPTIMIZE_PROVIDER_REFERENCES === "1";
const PROVIDER_REFERENCE_OPTIMIZE_MIN_BYTES = 900 * 1024;
const PROVIDER_REFERENCE_MAX_EDGE = 1280;

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export interface StoreOutputImageParams {
  id: string;
  title: string;
  url?: string;
  base64?: string;
  defaultMimeType?: string;
}

export interface StoredOutputImage {
  publicUrl: string;
  metadata: {
    storage: "remote-url" | "local-file";
    publicUrl: string;
    mimeType?: string;
    byteSize?: number;
    fileName?: string;
    filePath?: string;
    thumbnailUrl?: string;
    thumbnailFileName?: string;
    thumbnailPath?: string;
    thumbnailByteSize?: number;
  };
}

export async function storeOutputImage(params: StoreOutputImageParams): Promise<StoredOutputImage> {
  const directUrl = params.url?.trim();
  if (directUrl && !isInlineImageValue(directUrl)) {
    return {
      publicUrl: directUrl,
      metadata: {
        storage: "remote-url",
        publicUrl: directUrl,
      },
    };
  }

  const inlineValue = directUrl || params.base64?.trim();
  if (!inlineValue) {
    throw new Error("empty image result");
  }

  const parsed = parseInlineImage(inlineValue, params.defaultMimeType || "image/png");
  const byteHash = crypto.createHash("sha256").update(parsed.bytes).digest("hex").slice(0, 12);
  const ext = MIME_EXTENSIONS[parsed.mimeType] || "bin";
  const fileName = `${safeFileSegment(params.id)}-${safeFileSegment(params.title)}-${byteHash}.${ext}`;
  const filePath = path.join(GENERATED_DIR, fileName);

  await fs.mkdir(GENERATED_DIR, { recursive: true });
  await ensureImageBytesCanBeStored(filePath, parsed.bytes.byteLength);
  await fs.writeFile(filePath, parsed.bytes);

  const publicUrl = `/api/generated-images/${encodeURIComponent(fileName)}`;
  const thumbnail = await createOutputThumbnail({
    id: params.id,
    title: params.title,
    hash: byteHash,
    bytes: parsed.bytes,
  });

  return {
    publicUrl,
    metadata: {
      storage: "local-file",
      filePath,
      fileName,
      publicUrl,
      mimeType: parsed.mimeType,
      byteSize: parsed.bytes.byteLength,
      thumbnailUrl: thumbnail?.publicUrl,
      thumbnailFileName: thumbnail?.fileName,
      thumbnailPath: thumbnail?.filePath,
      thumbnailByteSize: thumbnail?.byteSize,
    },
  };
}

async function createOutputThumbnail({
  id,
  title,
  hash,
  bytes,
}: {
  id: string;
  title: string;
  hash: string;
  bytes: Buffer;
}): Promise<
  | {
      publicUrl: string;
      fileName: string;
      filePath: string;
      byteSize: number;
    }
  | undefined
> {
  try {
    const sharp = await import("sharp");
    const fileName = `${safeFileSegment(id)}-${safeFileSegment(title)}-thumb-${hash}.webp`;
    const filePath = path.join(GENERATED_DIR, fileName);
    const thumbnailBytes = await sharp
      .default(bytes, { failOn: "none" })
      .rotate()
      .resize({
        width: 640,
        height: 640,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 78 })
      .toBuffer();

    await ensureImageBytesCanBeStored(filePath, thumbnailBytes.byteLength);
    await fs.writeFile(filePath, thumbnailBytes);
    return {
      publicUrl: `/api/generated-images/${encodeURIComponent(fileName)}`,
      fileName,
      filePath,
      byteSize: thumbnailBytes.byteLength,
    };
  } catch (error) {
    safeLogError("Output thumbnail generation failed", error);
    return undefined;
  }
}

async function ensureImageBytesCanBeStored(filePath: string, byteSize: number): Promise<void> {
  if (byteSize > MAX_OUTPUT_FILE_BYTES) {
    throw new Error(
      `generated image is too large (${formatBytes(byteSize)} > ${formatBytes(MAX_OUTPUT_FILE_BYTES)})`
    );
  }

  const targetDir = path.dirname(filePath);
  try {
    const stats = await fs.statfs(targetDir);
    const availableBytes = stats.bavail * stats.bsize;
    const requiredBytes = byteSize + MIN_FREE_SPACE_BUFFER_BYTES;
    if (availableBytes < requiredBytes) {
      throw new Error(
        `not enough free disk space for generated image (${formatBytes(availableBytes)} available, ${formatBytes(requiredBytes)} required)`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("not enough free disk space")) {
      throw error;
    }
    safeLogError("Output storage statfs failed", error);
  }
}

function getMaxOutputFileBytes(): number {
  const raw = process.env.IMAGE_MASTER_MAX_OUTPUT_FILE_MB;
  const parsed = raw ? Number(raw) : DEFAULT_MAX_OUTPUT_FILE_MB;
  const value = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_OUTPUT_FILE_MB;
  return Math.floor(value * 1024 * 1024);
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)}GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${value}B`;
}

export async function readOutputImageAsDataUrl(
  publicUrl: string,
  fallbackMimeType = "image/png"
): Promise<string | undefined> {
  const fileName = getGeneratedFileName(publicUrl);
  if (!fileName) return undefined;

  const filePath = path.resolve(GENERATED_DIR, fileName);
  const generatedRoot = path.resolve(GENERATED_DIR);
  if (!filePath.startsWith(`${generatedRoot}${path.sep}`)) return undefined;

  const bytes = await fs.readFile(filePath);
  const ext = path.extname(fileName).toLowerCase();
  const mimeType =
    Object.entries(MIME_EXTENSIONS).find(([, candidateExt]) => `.${candidateExt}` === ext)?.[0] ||
    fallbackMimeType;
  const optimized = await optimizeProviderReferenceImage(bytes, mimeType);
  return `data:${optimized.mimeType};base64,${optimized.bytes.toString("base64")}`;
}

async function optimizeProviderReferenceImage(
  bytes: Buffer,
  mimeType: string
): Promise<{ bytes: Buffer; mimeType: string }> {
  if (!OPTIMIZE_PROVIDER_REFERENCES) {
    return { bytes, mimeType };
  }

  try {
    const sharp = await import("sharp");
    const image = sharp.default(bytes, { failOn: "none" }).rotate();
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const shouldOptimize =
      bytes.byteLength > PROVIDER_REFERENCE_OPTIMIZE_MIN_BYTES ||
      width > PROVIDER_REFERENCE_MAX_EDGE ||
      height > PROVIDER_REFERENCE_MAX_EDGE;

    if (!shouldOptimize || mimeType === "image/gif") {
      return { bytes, mimeType };
    }

    const optimizedBytes = await sharp
      .default(bytes, { failOn: "none" })
      .rotate()
      .resize({
        width: PROVIDER_REFERENCE_MAX_EDGE,
        height: PROVIDER_REFERENCE_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();

    return optimizedBytes.byteLength < bytes.byteLength
      ? { bytes: optimizedBytes, mimeType: "image/jpeg" }
      : { bytes, mimeType };
  } catch (error) {
    safeLogError("Provider reference image optimization failed", error);
    return { bytes, mimeType };
  }
}

function isInlineImageValue(value: string): boolean {
  return value.startsWith("data:") || /^[A-Za-z0-9+/=\r\n]+$/.test(value);
}

function parseInlineImage(value: string, defaultMimeType: string): { bytes: Buffer; mimeType: string } {
  const dataUrlMatch = value.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,([\s\S]*)$/);
  const mimeType = normalizeMimeType(dataUrlMatch?.[1] || defaultMimeType);
  const base64 = dataUrlMatch ? dataUrlMatch[2] : value;
  const compactBase64 = base64.replace(/\s/g, "");

  if (!compactBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compactBase64)) {
    throw new Error("invalid image base64");
  }

  return {
    bytes: Buffer.from(compactBase64, "base64"),
    mimeType,
  };
}

function normalizeMimeType(value: string): string {
  const lower = value.trim().toLowerCase();
  return MIME_EXTENSIONS[lower] ? lower : "image/png";
}

function safeFileSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return normalized || "image";
}

function getGeneratedFileName(publicUrl: string): string | undefined {
  const match = publicUrl.match(/^\/api\/generated-images\/([^/?#]+)$/);
  if (!match) return undefined;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}
