import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const nextDistDir = process.env.NEXT_DIST_DIR || ".next";
const chunksDir = join(process.cwd(), nextDistDir, "static", "chunks");

function ensureStableChunk(prefix, targetName) {
  const targetPath = join(chunksDir, targetName);

  const source = readdirSync(chunksDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".js"))
    .sort()[0];

  if (!source) return;

  if (source === targetName && existsSync(targetPath)) return;

  copyFileSync(join(chunksDir, source), targetPath);
  console.log(`fixed ${targetName} -> ${source}`);
}

ensureStableChunk("webpack-", "webpack.js");
ensureStableChunk("main-app-", "main-app.js");
ensureStableChunk("polyfills-", "polyfills.js");
