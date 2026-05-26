#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const outDir = process.env.OUT_DIR || path.join(process.cwd(), "test_artifacts", "api-smoke");
const size = process.env.IMAGE_SIZE || "1536x1024";
const quality = process.env.IMAGE_QUALITY || "standard";
const concurrency = Math.max(1, Math.min(4, Number(process.env.IMAGE_CONCURRENCY || 2) || 2));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

fs.mkdirSync(outDir, { recursive: true });

const config = readImageConfig();
const apiKey = process.env.LANYI_API_KEY || process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY || config.imageApiKey;
const baseUrl = (process.env.LANYI_BASE_URL || process.env.IMAGE_BASE_URL || config.imageBaseUrl || "https://lanyiapi.com/v1").replace(/\/$/, "");
const model = process.env.IMAGE_MODEL || config.imageModel || "gpt-image-2";
if (!apiKey) throw new Error("Missing image API key in env or app config.");

const sceneContinuityInstruction =
  "Preserve one continuous physical environment across the board: same floor plan, horizon line, surface materials, prop family, light source direction, shadow logic, reflection behavior, scale cues, and natural product/model placement zones. Make each panel clearly compatible with the others. Reserve clean empty physical areas where a model can later stand, sit, walk, hold a product, or interact with the scene while keeping believable headroom, body scale, and floor contact. Do not draw dashed boxes, outlines, arrows, placement markers, floor tape, UI overlays, or visible guide graphics. Do not swap the room, change the time of day, create contradictory architecture, add readable brand text, add people, or create conflicting light directions.";

const scenes = [
  {
    id: "warm-cafe-counter",
    title: "Warm Cafe Counter Scene Board",
    userRequest: "咖啡厅商业场景，温暖自然光，适合后续放入咖啡杯、香薰、小家电、包装食品等商品。",
    prompt:
      `Create one large scene scouting board in a single image, arranged as a clean multi-panel commercial location bible without captions, numbers, UI, labels, or readable text. Theme: an elegant warm cafe interior with a stone or wood counter, soft window daylight from one side, shallow background depth, clean specialty coffee atmosphere, restrained props such as ceramic cups, linen napkin, small plant, menu board kept blurred/unreadable, and empty product/model placement zones around the counter and window area. Use 6-8 panels of the same cafe: 1) wide establishing view of the full cafe and counter, 2) frontal hero placement zone on the counter, 3) 30-45 degree left angle, 4) 30-45 degree right angle, 5) reverse angle looking back from behind or beside the counter, 6) full-body model standing or walking zone beside the counter/window with no person present, 7) close surface/detail view showing counter texture and contact-shadow area, 8) optional foreground-depth angle through cups/plants. ${sceneContinuityInstruction}`,
  },
  {
    id: "lijiang-snow-mountain",
    title: "Lijiang Snow Mountain Scene Board",
    userRequest: "丽江雪山下面的商业场景，有雪山、石板或木平台、自然户外光，适合后续放入旅行、户外、茶饮、文创商品。",
    prompt:
      `Create one large scene scouting board in a single image, arranged as a clean multi-panel commercial location bible without captions, numbers, UI, labels, or readable text. Theme: a premium outdoor commercial scene below Jade Dragon Snow Mountain near Lijiang, with distant snow mountain silhouette, crisp plateau daylight, a stone terrace or dark wood platform in the foreground, subtle Naxi-inspired architectural texture in the background without readable signage, sparse natural props such as woven textile, stone, pine branch, or ceramic tea cup, and empty product/model placement zones on the platform and terrace edge. Use 6-8 panels of the same location: 1) wide establishing view with mountain and terrace layout, 2) frontal hero product placement zone on the stone/wood platform, 3) 30-45 degree left angle, 4) 30-45 degree right angle, 5) reverse angle looking back across the terrace while still matching the same mountain-side location, 6) full-body model standing or walking zone on the terrace with believable headroom and floor contact but no person present, 7) close surface/detail view showing stone/wood texture and contact-shadow area, 8) optional foreground-depth angle through textile/pine/stone props. ${sceneContinuityInstruction}`,
  },
];

console.log(JSON.stringify({
  mode: "scene-continuity-board-smoke",
  model,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  concurrency,
  count: scenes.length,
  scenes: scenes.map(({ id, title, userRequest }) => ({ id, title, userRequest })),
}, null, 2));

const started = Date.now();
const results = [];
for (let i = 0; i < scenes.length; i += concurrency) {
  const chunk = scenes.slice(i, i + concurrency);
  const settled = await Promise.allSettled(chunk.map(runScene));
  for (const item of settled) {
    results.push(item.status === "fulfilled" ? item.value : { ok: false, error: item.reason?.stack || String(item.reason) });
  }
}

const manifest = {
  ok: results.every((item) => item.ok && item.imageReturned),
  model,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  concurrency,
  totalMs: Date.now() - started,
  results,
};
const manifestPath = path.join(outDir, `scene-continuity-boards-${stamp}.manifest.json`);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ manifestPath, ...manifest }, null, 2));

async function runScene(scene) {
  const oneStarted = Date.now();
  const prefix = `scene-continuity-board-${scene.id}-${stamp}`;
  const rawPath = path.join(outDir, `${prefix}.sse.txt`);
  const jsonPath = path.join(outDir, `${prefix}.json`);
  const imagePath = path.join(outDir, `${prefix}.png`);
  const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
  const clientRequestId = `image2.scene_board.${scene.id}.${crypto.randomUUID()}`;
  const prompt = [
    "Scene continuity board task:",
    "Generate a reusable environment reference board, not a finished advertisement.",
    "The image must be one integrated board showing 6-8 compatible views of the same physical scene.",
    "Include angles that can later support full-body model composites, product holding, walking, sitting, and close product placement.",
    "Avoid text, panel labels, watermarks, UI frames, logos, or any people in the image.",
    "",
    `User request: ${scene.userRequest}`,
    "",
    scene.prompt,
  ].join("\n");

  fs.writeFileSync(promptPath, prompt);

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
    const elapsed = Date.now() - oneStarted;
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
    userRequest: scene.userRequest,
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
    totalMs: Date.now() - oneStarted,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  return summary;
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
