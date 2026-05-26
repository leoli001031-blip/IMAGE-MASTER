#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const outDir = process.env.OUT_DIR || path.join(process.cwd(), "test_artifacts", "api-smoke");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const size = process.env.IMAGE_SIZE || "1024x1024";
const quality = process.env.IMAGE_QUALITY || "standard";

fs.mkdirSync(outDir, { recursive: true });

const config = readImageConfig();
const apiKey =
  process.env.LANYI_API_KEY ||
  process.env.IMAGE_API_KEY ||
  process.env.OPENAI_API_KEY ||
  config.imageApiKey;
const baseUrl = (
  process.env.LANYI_BASE_URL ||
  process.env.IMAGE_BASE_URL ||
  config.imageBaseUrl ||
  "https://lanyiapi.com/v1"
).replace(/\/$/, "");
const imageModel = process.env.IMAGE_MODEL || config.imageModel || "gpt-image-2";

if (!apiKey) throw new Error("Missing image API key in env or app config.");

const prompt = [
  "Create one single 2x2 contact sheet made of four casual smartphone photos of the exact same handbag.",
  "",
  "Product:",
  "- One taupe / warm grey leather shoulder bag or small tote bag.",
  "- Medium structured soft-rectangular silhouette, short top handle, detachable shoulder strap, visible zipper, subtle seams, small metal hardware, no readable brand logo.",
  "- Keep the same physical bag, same color, same material, same hardware, and same proportions in all four photos.",
  "",
  "Four quadrants:",
  "1. Front view on a messy home table, phone snapshot.",
  "2. Left side / three-quarter side view on a sofa or chair, phone snapshot.",
  "3. Back view on a floor or bed, phone snapshot.",
  "4. Close detail of zipper, strap connection, leather texture, or handle hardware, phone snapshot.",
  "",
  "Photo style:",
  "- Not a professional e-commerce photo. Make it look like a user quickly took photos with a phone.",
  "- Slight uneven indoor lighting, mild perspective distortion, imperfect crop, casual background, small shadow, realistic compression feel.",
  "- Product must still be visible and useful as a reference.",
  "",
  "Layout rules:",
  "- Four separate square-ish photos arranged in a clean 2x2 grid.",
  "- Leave a narrow margin between quadrants so they can be cropped apart.",
  "- No labels, no captions, no UI, no watermark, no arrows, no sale text, no people, no hands.",
].join("\n");

const prefix = `bag-phone-reference-crops-${stamp}`;
const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
const rawPath = path.join(outDir, `${prefix}.sse.txt`);
const jsonPath = path.join(outDir, `${prefix}.json`);
const sheetPath = path.join(outDir, `${prefix}-source-sheet.png`);
fs.writeFileSync(promptPath, prompt);

console.log(
  JSON.stringify(
    {
      mode: "bag-phone-reference-crops",
      model: imageModel,
      baseUrlHost: safeHost(baseUrl),
      size,
      quality,
      plannedProviderCalls: 1,
      promptPath,
    },
    null,
    2
  )
);

const started = Date.now();
const clientRequestId = `image2.bag_phone_refs.${crypto.randomUUID()}`;
const response = await fetch(`${baseUrl}/responses`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    Accept: "text/event-stream",
    "Content-Type": "application/json",
    "X-Client-Request-Id": clientRequestId,
  },
  body: JSON.stringify({
    model: imageModel,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ],
    tools: [{ type: "image_generation", size, quality }],
    stream: true,
  }),
});

const raw = await readResponseBody(response, started);
fs.writeFileSync(rawPath, raw.text);
const events = parseSse(raw.text);
const eventCounts = {};
let responseId = null;
let imageBase64 = null;
for (const item of events) {
  if (item.event) eventCounts[item.event] = (eventCounts[item.event] || 0) + 1;
  if (!responseId && item.json?.response?.id) responseId = item.json.response.id;
  if (!responseId && typeof item.json?.id === "string" && item.json.id.startsWith("resp_")) {
    responseId = item.json.id;
  }
  imageBase64 ||= findBase64(item.json);
}

if (!imageBase64) {
  throw new Error(`Image was not returned. See ${rawPath}`);
}

fs.writeFileSync(sheetPath, Buffer.from(imageBase64, "base64"));
const cropPaths = await cropPhoneReferences(sheetPath, prefix);
const cropListPath = path.join(outDir, `${prefix}.crops.json`);
fs.writeFileSync(cropListPath, JSON.stringify({ sheetPath, cropPaths }, null, 2));

const result = {
  ok: response.ok,
  status: response.status,
  clientRequestId,
  responseId,
  promptPath,
  firstChunkMs: raw.firstChunkMs,
  lastChunkMs: raw.lastChunkMs,
  totalMs: Date.now() - started,
  bytes: raw.bytes,
  eventCounts,
  sheetPath,
  cropPaths,
  cropListPath,
  rawPath,
};
fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

async function cropPhoneReferences(sourcePath, sourcePrefix) {
  const sharp = (await import("sharp")).default;
  const metadata = await sharp(sourcePath).metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;
  const cropWidth = Math.floor(width / 2);
  const cropHeight = Math.floor(height / 2);
  const crops = [
    { id: "front-phone", left: 0, top: 0 },
    { id: "side-phone", left: cropWidth, top: 0 },
    { id: "back-phone", left: 0, top: cropHeight },
    { id: "detail-phone", left: cropWidth, top: cropHeight },
  ];

  const paths = [];
  for (const crop of crops) {
    const targetPath = path.join(outDir, `${sourcePrefix}-${crop.id}.jpg`);
    await sharp(sourcePath)
      .extract({ left: crop.left, top: crop.top, width: cropWidth, height: cropHeight })
      .resize({ width: 768, height: 768, fit: "cover", position: "center" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(targetPath);
    paths.push(targetPath);
  }
  return paths;
}

async function readResponseBody(response, startedAt) {
  const reader = response.body?.getReader();
  let text = "";
  let firstChunkMs = null;
  let lastChunkMs = null;
  let bytes = 0;
  let firstLogged = false;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    const elapsed = Date.now() - startedAt;
    firstChunkMs ??= elapsed;
    lastChunkMs = elapsed;
    bytes += value.byteLength;
    text += Buffer.from(value).toString("utf8");
    if (!firstLogged) {
      firstLogged = true;
      console.log(`first chunk ${elapsed}ms`);
    }
  }
  return { text, firstChunkMs, lastChunkMs, bytes };
}

function readImageConfig() {
  const dbPath = path.join(process.cwd(), ".data", "image-master.db");
  if (!fs.existsSync(dbPath)) return {};
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare("SELECT key, value FROM config").all();
  return Object.fromEntries(rows.map(({ key, value }) => [key, value]));
}

function parseSse(rawText) {
  return rawText.split(/\n\n+/).flatMap((block) => {
    const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!event && !data) return [];
    let json = null;
    try {
      json = data && data !== "[DONE]" ? JSON.parse(data) : null;
    } catch {
      // Raw SSE is saved separately.
    }
    return [{ event, data, json }];
  });
}

function findBase64(value, depth = 0) {
  if (!value || depth > 12) return null;
  if (typeof value === "string") {
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) {
      return value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
    }
    if (/^[A-Za-z0-9+/=]{1000,}$/.test(value) && value.length > 1000) return value;
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findBase64(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const key of ["b64_json", "result", "partial_image_b64", "image_base64", "base64", "data"]) {
      const found = findBase64(value[key], depth + 1);
      if (found) return found;
    }
    for (const item of Object.values(value)) {
      const found = findBase64(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function safeHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}
