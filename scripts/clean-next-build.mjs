#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const distDir = path.resolve(process.env.NEXT_DIST_DIR || ".next");

if (path.basename(distDir).startsWith(".next-dev-")) {
  throw new Error(`Refusing to clean isolated dev build directory: ${distDir}`);
}

fs.rmSync(distDir, { recursive: true, force: true });
