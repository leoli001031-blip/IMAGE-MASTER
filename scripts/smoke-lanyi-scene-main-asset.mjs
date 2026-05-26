#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const args = parseArgs(process.argv.slice(2));
const outDir = process.env.OUT_DIR || path.join(process.cwd(), "test_artifacts", "api-smoke");
const size = process.env.IMAGE_SIZE || "1536x1024";
const quality = process.env.IMAGE_QUALITY || "standard";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const sceneId = args.scene || "nordic-home-interior";

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
const model = process.env.IMAGE_MODEL || config.imageModel || "gpt-image-2";
if (!apiKey) throw new Error("Missing image API key in env or app config.");

const sceneMetadata = {
  schema: "image-master.scene-main-asset.v1",
  sceneId,
  title: "北欧风家居室内场景",
  confidence: "single_scene_reference_with_lightweight_constraints",
  usage: ["product placement", "model lifestyle composite", "homeware campaign", "social commerce hero"],
  visualTags: [
    "Nordic home interior",
    "soft daylight",
    "warm oak floor",
    "linen sofa",
    "light neutral walls",
    "minimal decor",
    "commercial lifestyle photography",
  ],
  placementZones: {
    product: [
      "low coffee table center-left",
      "open floor area in front of sofa",
      "side console near window",
    ],
    model: [
      "standing area near window with full-body headroom",
      "sitting zone at sofa edge",
      "walking path between coffee table and sofa",
    ],
    keepClear: ["window light", "main sofa silhouette", "large negative wall area"],
  },
  negativeRules: [
    "no people",
    "no mannequins",
    "no readable text",
    "no brand logos",
    "no clutter",
    "no fake product hero",
    "no visible guide marks",
  ],
};

const prompt = [
  "Create one clean commercial scene asset image, not a collage and not a multi-panel reference board.",
  "Scene: a premium Nordic / Scandinavian home interior living room designed for later product and model composites.",
  "",
  "Composition:",
  "- Wide horizontal interior view, 3:2 ratio, natural eye-level commercial photography.",
  "- Soft daylight from a large window on one side, warm but restrained indoor ambience.",
  "- Light neutral walls, warm oak floor, linen sofa, low coffee table, one side chair or pouf, simple shelving or console, subtle plants, ceramic vase, woven texture, and a small rug.",
  "- Leave clear open placement zones: a coffee-table product area, an open floor product area, a sofa-edge model sitting zone, and a window-side standing zone with full-body headroom.",
  "- The scene should feel immediately understandable and usable, not like a floor plan or 3D diagram.",
  "",
  "Commercial constraints:",
  "- Empty reusable scene plate, no people, no mannequins, no product hero already inserted.",
  "- No readable text, no labels, no arrows, no dashed boxes, no outlined placement areas, no UI marks, no watermarks, no brand logos.",
  "- Keep perspective believable, verticals straight, furniture scale realistic, and shadows/contact points natural.",
  "- Calm premium Nordic color palette: off-white, warm oak, soft gray, oatmeal linen, muted green plant accents, matte ceramic details.",
  "",
  "Scene metadata to follow:",
  JSON.stringify(sceneMetadata, null, 2),
].join("\n");

const prefix = `scene-main-asset-${sceneId}-${stamp}`;
const rawPath = path.join(outDir, `${prefix}.sse.txt`);
const jsonPath = path.join(outDir, `${prefix}.json`);
const imagePath = path.join(outDir, `${prefix}.png`);
const metadataPath = path.join(outDir, `${prefix}.metadata.json`);
const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
const clientRequestId = `image2.scene_main_asset.${crypto.randomUUID()}`;
const started = Date.now();

fs.writeFileSync(promptPath, prompt);
fs.writeFileSync(metadataPath, JSON.stringify(sceneMetadata, null, 2));

console.log(
  JSON.stringify(
    {
      mode: "scene-main-asset-smoke",
      model,
      baseUrlHost: safeHost(baseUrl),
      size,
      quality,
      sceneId,
      promptChars: prompt.length,
    },
    null,
    2
  )
);

const response = await fetch(`${baseUrl}/responses`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    Accept: "text/event-stream",
    "Content-Type": "application/json",
    "X-Client-Request-Id": clientRequestId,
  },
  body: JSON.stringify({
    model,
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

const contentType = response.headers.get("content-type") || "";
let raw = "";
let firstChunkMs = null;
let lastChunkMs = null;
let bytes = 0;
const reader = response.body?.getReader();
let firstLogged = false;
while (reader) {
  const { done, value } = await reader.read();
  if (done) break;
  const elapsed = Date.now() - started;
  firstChunkMs ??= elapsed;
  lastChunkMs = elapsed;
  bytes += value.byteLength;
  raw += Buffer.from(value).toString("utf8");
  if (!firstLogged) {
    firstLogged = true;
    console.log(`[scene-main] first chunk ${elapsed}ms`);
  }
}

fs.writeFileSync(rawPath, raw);

const events = contentType.includes("text/event-stream") ? parseSse(raw) : [];
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

if (!imageBase64 && raw.trim().startsWith("{")) {
  try {
    imageBase64 = findBase64(JSON.parse(raw));
  } catch {
    // Keep raw response for diagnostics.
  }
}

if (imageBase64) {
  fs.writeFileSync(imagePath, Buffer.from(imageBase64, "base64"));
}

const summary = {
  ok: response.ok,
  status: response.status,
  contentType,
  clientRequestId,
  responseId,
  model,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  sceneId,
  promptChars: prompt.length,
  firstChunkMs,
  lastChunkMs,
  totalMs: Date.now() - started,
  bytes,
  eventCounts,
  imageReturned: Boolean(imageBase64),
  imagePath: imageBase64 ? imagePath : null,
  metadataPath,
  rawPath,
  promptPath,
  rawPreview: imageBase64 ? undefined : raw.slice(0, 1200),
};
fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

function readImageConfig() {
  const dbPath = path.join(process.cwd(), ".data", "image-master.db");
  if (!fs.existsSync(dbPath)) return {};
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare("SELECT key, value FROM config").all();
  return Object.fromEntries(rows.map(({ key, value }) => [key, value]));
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
      // Non-JSON data stays available in rawPath.
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
