import { spawn } from "child_process";
import fs from "fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import path from "path";
import { getGeneratedImagesDir } from "@/lib/store/data-paths";

export const dynamic = "force-dynamic";

const GENERATED_DIR = getGeneratedImagesDir();
const SAFE_FILE_NAME = /^[a-z0-9][a-z0-9_-]*-[a-z0-9_-]+-[a-f0-9]{12}\.(png|jpg|jpeg|webp|gif|bin)$/i;

export async function POST(req: NextRequest) {
  let payload: { url?: unknown; urls?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  await fs.mkdir(GENERATED_DIR, { recursive: true });

  const candidateUrls = [
    ...(Array.isArray(payload.urls) ? payload.urls : []),
    payload.url,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  const filePath = await findExistingGeneratedFile(candidateUrls);
  const targetPath = filePath ?? path.resolve(GENERATED_DIR);
  const opened = openInFinder(targetPath, Boolean(filePath));

  return NextResponse.json({
    ok: true,
    opened,
    folderPath: path.resolve(GENERATED_DIR),
    filePath,
  });
}

async function findExistingGeneratedFile(urls: string[]): Promise<string | undefined> {
  for (const url of urls) {
    const fileName = getGeneratedFileName(url);
    if (!fileName || !isSafeGeneratedFileName(fileName)) continue;

    const filePath = path.resolve(GENERATED_DIR, fileName);
    const generatedRoot = path.resolve(GENERATED_DIR);
    if (!filePath.startsWith(`${generatedRoot}${path.sep}`)) continue;

    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      continue;
    }
  }

  return undefined;
}

function getGeneratedFileName(value: string): string | undefined {
  const match = value.match(/^\/api\/generated-images\/([^/?#]+)$/);
  if (!match) return undefined;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

function isSafeGeneratedFileName(file: string): boolean {
  return file === path.basename(file) && SAFE_FILE_NAME.test(file);
}

function openInFinder(targetPath: string, revealFile: boolean): boolean {
  if (process.platform !== "darwin") return false;

  const args = revealFile ? ["-R", targetPath] : [targetPath];
  const child = spawn("open", args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return true;
}
