#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const outDir = path.join(ROOT, "test_artifacts", "api-smoke");
const args = parseArgs(process.argv.slice(2));
const sourcePath =
  args.source ||
  process.env.MODEL_IDENTITY_SHEET ||
  path.join(outDir, "milan-runway-model-asset-eastern-europe-warsaw-couture-2026-05-18T20-29-15-235Z.png");
const outputPath =
  args.out ||
  process.env.MODEL_NEUTRAL_REFERENCE ||
  path.join(outDir, "model-neutral-identity-reference.png");
const metadataPath = outputPath.replace(/\.(png|jpe?g|webp)$/i, ".metadata.json");

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Missing source model identity sheet: ${sourcePath}`);
}

await fsp.mkdir(path.dirname(outputPath), { recursive: true });
await buildNeutralReference({ sourcePath, outputPath, metadataPath });

console.log(JSON.stringify({
  ok: true,
  sourcePath,
  outputPath,
  metadataPath,
  purpose: "downstream_compositing_identity_reference",
}, null, 2));

async function buildNeutralReference({ sourcePath, outputPath, metadataPath }) {
  const sharp = await import("sharp");
  const meta = await sharp.default(sourcePath).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Could not read image metadata: ${sourcePath}`);
  }

  const fullBody = await sharp.default(sourcePath)
    .extract(clampExtract({ left: 250, top: 90, width: 600, height: 585 }, meta))
    .resize({ width: 790, height: 760, fit: "inside", withoutEnlargement: true })
    .modulate({ saturation: 0.92, brightness: 0.98 })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  const faceCue = await sharp.default(sourcePath)
    .extract(clampExtract({ left: 20, top: 40, width: 225, height: 370 }, meta))
    .resize({ width: 172, height: 282, fit: "inside", withoutEnlargement: true })
    .modulate({ saturation: 0.8, brightness: 0.97 })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  const labelSvg = Buffer.from(`
    <svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
      <style>
        .title { font: 26px -apple-system, BlinkMacSystemFont, "Inter", sans-serif; fill: #7a6a5f; font-weight: 600; }
        .body { font: 20px -apple-system, BlinkMacSystemFont, "Inter", sans-serif; fill: #9b8b7e; }
      </style>
      <text x="92" y="890" class="title">Downstream model identity reference</text>
      <text x="92" y="924" class="body">Use identity only. Scene image controls lighting.</text>
    </svg>
  `);

  await sharp.default({
    create: {
      width: 1024,
      height: 1024,
      channels: 3,
      background: "#f7f4ef",
    },
  })
    .composite([
      { input: fullBody, left: 102, top: 82 },
      { input: faceCue, left: 800, top: 124 },
      { input: labelSvg, left: 0, top: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  await fsp.writeFile(metadataPath, `${JSON.stringify({
    version: 1,
    sourcePath,
    outputPath,
    type: "model_neutral_identity_reference",
    role: "model",
    providerUsage: "image_input",
    promptBoundary: "identity_only_not_lighting",
    promptFragments: [
      "Use this reference for broad model identity: face geometry, facial proportions, hairstyle family, body type, posture language, and temperament.",
      "Do not copy the neutral board background, studio exposure, label text, or card composition.",
    ],
    constraints: [
      "The scene reference is the lighting authority.",
      "The final face and body must be relit by the target scene.",
    ],
    negativeRules: [
      "No white backdrop transfer.",
      "No beauty portrait lighting transfer.",
      "No frontal fill light transfer.",
      "No close-up portrait-card composition transfer.",
    ],
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

function clampExtract(box, meta) {
  return {
    left: Math.max(0, Math.min(box.left, meta.width - 1)),
    top: Math.max(0, Math.min(box.top, meta.height - 1)),
    width: Math.max(1, Math.min(box.width, meta.width - box.left)),
    height: Math.max(1, Math.min(box.height, meta.height - box.top)),
  };
}

function parseArgs(values) {
  const parsed = {};
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}
