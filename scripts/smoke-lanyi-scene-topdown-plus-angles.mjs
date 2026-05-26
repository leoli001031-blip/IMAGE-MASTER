#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const outDir = process.env.OUT_DIR || path.join(process.cwd(), "test_artifacts", "api-smoke");
const size = process.env.IMAGE_SIZE || "1536x1024";
const quality = process.env.IMAGE_QUALITY || "standard";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

fs.mkdirSync(outDir, { recursive: true });

const config = readImageConfig();
const apiKey = process.env.LANYI_API_KEY || process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY || config.imageApiKey;
const baseUrl = (process.env.LANYI_BASE_URL || process.env.IMAGE_BASE_URL || config.imageBaseUrl || "https://lanyiapi.com/v1").replace(/\/$/, "");
const model = process.env.IMAGE_MODEL || config.imageModel || "gpt-image-2";
if (!apiKey) throw new Error("Missing image API key in env or app config.");

const prompt = [
  "Create one single-image orthographic scene spatial reference sheet for later model and product composites.",
  "",
  "Layout: one large top-down overview panel on the top half, plus four straight-on orthographic elevation-view panels on the bottom half in a clean 4-panel strip. Use clean white gutters only. Do not add captions, numbers, arrows, labels, floor-plan symbols, dashed boxes, UI marks, readable text, logos, or watermarks.",
  "",
  "Scene: a premium outdoor commercial location below Jade Dragon Snow Mountain near Lijiang. Distant snow mountain, crisp plateau daylight, stone terrace, dark wood platform, subtle Naxi-inspired wooden architecture on one side, pine branches, woven textile, ceramic tea cup, natural empty areas for later product and model placement.",
  "",
  "Top-down overview panel: a beautiful realistic high-angle / bird's-eye photographic overview, not a blueprint. It should clearly reveal the spatial layout: terrace edge, dark wood platform, stone floor, architecture side, mountain direction, pine/stone/textile prop positions, natural open standing zones, and product placement surfaces. It must still look like a real photograph from above, with natural shadows and materials.",
  "",
  "Bottom four straight cardinal elevation panels from the same exact mapped location:",
  "1. FRONT straight-on elevation view facing the platform and mountain direction;",
  "2. BACK straight-on elevation view from the opposite mountain side looking back toward the architecture and platform;",
  "3. LEFT straight-on side elevation view showing the left boundary, floor edge, platform side, and recurring props;",
  "4. RIGHT straight-on side elevation view showing the right boundary, architecture side, platform side, and recurring props.",
  "",
  "Continuity: all five panels must share the same floor plan, platform shape, architecture position, mountain direction, light source direction, material family, prop positions, scale cues, and natural empty placement zones. The bottom views must correspond to the four cardinal sides shown in the top overview. Leave enough headroom and floor contact areas for a full-body model to be inserted later, but do not include any people.",
  "",
  "Negative rules: no people, no mannequins, no readable text, no labels, no arrows, no dashed boxes, no outlined placement areas, no map icons, no blueprint style, no infographic style, no UI frame, no fake product hero subject, no contradictory room/location, no changing weather or time of day, no diagonal camera angles, no beauty-shot-only perspective.",
].join("\n");

const prefix = `scene-topdown-plus-angles-lijiang-${stamp}`;
const rawPath = path.join(outDir, `${prefix}.sse.txt`);
const jsonPath = path.join(outDir, `${prefix}.json`);
const imagePath = path.join(outDir, `${prefix}.png`);
const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
const clientRequestId = `image2.scene_topdown.${crypto.randomUUID()}`;
const started = Date.now();

fs.writeFileSync(promptPath, prompt);

console.log(JSON.stringify({
  mode: "scene-topdown-plus-angles-smoke",
  model,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  promptChars: prompt.length,
}, null, 2));

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

while (reader) {
  const { done, value } = await reader.read();
  if (done) break;
  const elapsed = Date.now() - started;
  firstChunkMs ??= elapsed;
  lastChunkMs = elapsed;
  bytes += value.byteLength;
  raw += Buffer.from(value).toString("utf8");
}

fs.writeFileSync(rawPath, raw);

const events = contentType.includes("text/event-stream") ? parseSse(raw) : [];
const eventCounts = {};
let responseId = null;
let imageBase64 = null;
for (const item of events) {
  if (item.event) eventCounts[item.event] = (eventCounts[item.event] || 0) + 1;
  if (!responseId && item.json?.response?.id) responseId = item.json.response.id;
  if (!responseId && typeof item.json?.id === "string" && item.json.id.startsWith("resp_")) responseId = item.json.id;
  imageBase64 ||= findBase64(item.json);
}

if (!imageBase64 && raw.trim().startsWith("{")) {
  try {
    imageBase64 = findBase64(JSON.parse(raw));
  } catch {
    // Keep raw response for diagnostics.
  }
}

if (imageBase64) fs.writeFileSync(imagePath, Buffer.from(imageBase64, "base64"));

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
  promptChars: prompt.length,
  firstChunkMs,
  lastChunkMs,
  bytes,
  eventCounts,
  imageReturned: Boolean(imageBase64),
  imagePath: imageBase64 ? imagePath : null,
  rawPath,
  promptPath,
  rawPreview: imageBase64 ? undefined : raw.slice(0, 1200),
  totalMs: Date.now() - started,
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
