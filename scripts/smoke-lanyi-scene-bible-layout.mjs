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

const scene = {
  id: "lijiang-snow-mountain-scene-bible",
  title: "Lijiang Snow Mountain Scene Bible Layout",
  prompt: [
    "Create one single-image scene bible for later model and product composites.",
    "Layout requirement: the top 55-60% of the image must be one large wide overview image of the complete location. The bottom 40-45% must contain five smaller angle panels in a clean horizontal strip or compact grid. Use clean white gutters between panels, but do not add captions, numbers, UI labels, readable text, logos, or watermarks.",
    "",
    "Scene theme: a premium outdoor commercial scene below Jade Dragon Snow Mountain near Lijiang. The location has a distant snow mountain silhouette, crisp plateau daylight, a stone terrace and dark wood platform in the foreground, subtle Naxi-inspired wooden architecture at one side, sparse natural props such as woven textile, stone, pine branch, and ceramic tea cup.",
    "",
    "Top overview panel: show the entire spatial map clearly. It must reveal the floor plan, terrace edge, wood platform, stone surface, mountain background, architecture side, light direction, empty model standing/walking zones, and empty product placement zones.",
    "",
    "Bottom five angle panels, all from the same physical location:",
    "1. frontal hero product placement view on the stone or wood platform;",
    "2. left 30-45 degree angle;",
    "3. right 30-45 degree angle;",
    "4. reverse angle looking back across the terrace while remaining compatible with the same mountain-side location;",
    "5. close surface/detail view showing stone or wood texture, textile, cup, and contact-shadow area.",
    "",
    "Continuity constraints: every panel must share the same floor plan, horizon line, surface materials, prop family, light source direction, shadow logic, reflection behavior, scale cues, and product/model placement zones. Reserve natural empty physical areas where a model can later stand, sit, walk, hold a product, or interact with the scene while keeping believable headroom, body scale, and floor contact.",
    "",
    "Negative rules: no people, no readable text, no panel labels, no UI frame, no dashed boxes, no outlines, no arrows, no visible placement markers, no floor tape, no guide graphics, no duplicate unrelated rooms, no changing time of day, no conflicting light directions, no impossible architecture, no product already placed as the final subject. This is a reusable spatial reference board, not a final advertisement.",
  ].join("\n"),
};

const prefix = `scene-bible-layout-${scene.id}-${stamp}`;
const rawPath = path.join(outDir, `${prefix}.sse.txt`);
const jsonPath = path.join(outDir, `${prefix}.json`);
const imagePath = path.join(outDir, `${prefix}.png`);
const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
const clientRequestId = `image2.scene_bible.${scene.id}.${crypto.randomUUID()}`;
const started = Date.now();

fs.writeFileSync(promptPath, scene.prompt);

console.log(JSON.stringify({
  mode: "scene-bible-layout-smoke",
  model,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  scene: {
    id: scene.id,
    title: scene.title,
  },
  promptChars: scene.prompt.length,
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
        content: [{ type: "input_text", text: scene.prompt }],
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

if (imageBase64) {
  fs.writeFileSync(imagePath, Buffer.from(imageBase64, "base64"));
}

const summary = {
  ok: response.ok,
  status: response.status,
  sceneId: scene.id,
  title: scene.title,
  contentType,
  clientRequestId,
  responseId,
  model,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  promptChars: scene.prompt.length,
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
