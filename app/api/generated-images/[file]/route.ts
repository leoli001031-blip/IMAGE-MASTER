import { NextResponse, type NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getGeneratedImagesDir } from "@/lib/store/data-paths";

export const dynamic = "force-dynamic";

const GENERATED_DIR = getGeneratedImagesDir();
const SAFE_FILE_NAME = /^[a-z0-9][a-z0-9_-]*-[a-z0-9_-]+-[a-f0-9]{12}\.(png|jpg|jpeg|webp|gif|bin)$/i;
const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bin": "application/octet-stream",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params;
  const decodedFile = safeDecodeURIComponent(file || "");

  if (!isSafeGeneratedFileName(decodedFile)) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  const filePath = path.resolve(GENERATED_DIR, decodedFile);
  const generatedRoot = path.resolve(GENERATED_DIR);
  if (!filePath.startsWith(`${generatedRoot}${path.sep}`)) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  try {
    const bytes = await fs.readFile(filePath);
    const ext = path.extname(decodedFile).toLowerCase();
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }
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
