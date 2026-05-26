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

const sharedScene =
  "A premium outdoor commercial location below Jade Dragon Snow Mountain near Lijiang: distant snow mountain, crisp plateau daylight, stone terrace, dark wood platform, Naxi-inspired wooden architecture at one side, pine branches, woven textile, ceramic tea cup, natural empty areas for later product and model placement.";

const hardNegatives =
  "No people, no mannequins, no readable text, no captions, no numbers, no arrows, no dashed boxes, no outlines, no visible placement markers, no UI, no floor tape, no infographic styling, no map, no blueprint, no fake product, no logos, no poster typography.";

const variants = [
  {
    id: "single-empty-master-plate",
    title: "方案 A：单张完整空场景母图",
    intent: "不拼图，只生成一张完整可复用空场景，靠 metadata 记录后续角度。",
    prompt: [
      "Create one single photorealistic empty commercial location plate, not a collage and not a reference board.",
      `Scene: ${sharedScene}`,
      "Composition: wide 24-28mm lens, eye-level to slightly low camera, full-body model-compatible headroom, clear floor contact areas, a broad empty platform in the foreground, mountain and architecture as stable background anchors.",
      "The image should work as a master establishing reference for later product placement and full-body model composites. Keep natural clean empty physical areas only, without any visual guide marks.",
      hardNegatives,
    ].join("\n"),
  },
  {
    id: "overview-with-natural-filmstrip",
    title: "方案 B：上总览 + 下方自然机位条",
    intent: "保留你的总览+角度思路，但强调像摄影 contact sheet，不出现标注感。",
    prompt: [
      "Create one photorealistic location scouting contact sheet in a single image.",
      "Layout: the top 60 percent is one large wide overview photograph of the complete location. The bottom 40 percent is a strip of five smaller natural camera-angle photographs from the same location. Use clean thin white gutters only; no labels or graphic marks.",
      `Scene: ${sharedScene}`,
      "Bottom strip angles: front hero angle, left 45 degree angle, right 45 degree angle, reverse angle, close surface detail. All panels must feel like actual unmarked photos from the same shoot day.",
      "Each panel must preserve the same mountain, terrace, platform, architecture, light direction, material, prop family, and scale cues. Leave natural empty standing and product placement areas, but never draw them.",
      hardNegatives,
    ].join("\n"),
  },
  {
    id: "cinematic-shot-bible",
    title: "方案 C：电影分镜式空镜组",
    intent: "像导演拍空镜，更多镜头语言，减少 UI/设计板味道。",
    prompt: [
      "Create one cinematic location shot bible in a single image, made of six unlabelled photorealistic stills from the same outdoor location.",
      "Layout: a clean 3x2 contact sheet of six natural cinematic stills, no captions, no labels, no guide marks.",
      `Scene: ${sharedScene}`,
      "The six stills: wide establishing shot, medium frontal platform shot, left oblique shot, right oblique shot, reverse shot toward architecture/terrace, close texture shot with stone/wood/textile/cup.",
      "The goal is camera grammar and spatial continuity for later model insertion. Keep body-scale standing/walking spaces visible in at least three frames, but only as natural empty floor/platform space.",
      hardNegatives,
    ].join("\n"),
  },
  {
    id: "environment-crop-atlas",
    title: "方案 D：空间母图 + 自然裁切图集",
    intent: "让小图像是总览图自然裁切出来的局部，帮助模型理解同一空间。",
    prompt: [
      "Create one photographic environment crop atlas in a single image.",
      "Layout: one large master overview photograph on the left two-thirds of the canvas, and four smaller unlabelled detail crops stacked on the right one-third. The small images must look like natural crops or nearby camera positions derived from the same master scene, not different scenes.",
      `Scene: ${sharedScene}`,
      "Right-side crops: product platform close-up, model standing area near terrace edge, side angle with architecture, foreground prop texture. Keep all crops compatible with the master overview.",
      "Avoid any marks showing crop boxes; the layout itself is enough. The result should look like a photographer's visual reference sheet, not an annotated design board.",
      hardNegatives,
    ].join("\n"),
  },
];

console.log(JSON.stringify({
  mode: "scene-layout-variants-smoke",
  model,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  concurrency,
  variants: variants.map(({ id, title, intent }) => ({ id, title, intent })),
}, null, 2));

const started = Date.now();
const results = [];
for (let i = 0; i < variants.length; i += concurrency) {
  const chunk = variants.slice(i, i + concurrency);
  const settled = await Promise.allSettled(chunk.map(runVariant));
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
const manifestPath = path.join(outDir, `scene-layout-variants-${stamp}.manifest.json`);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ manifestPath, ...manifest }, null, 2));

async function runVariant(variant) {
  const oneStarted = Date.now();
  const prefix = `scene-layout-variant-${variant.id}-${stamp}`;
  const rawPath = path.join(outDir, `${prefix}.sse.txt`);
  const jsonPath = path.join(outDir, `${prefix}.json`);
  const imagePath = path.join(outDir, `${prefix}.png`);
  const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
  const clientRequestId = `image2.scene_variant.${variant.id}.${crypto.randomUUID()}`;
  const prompt = [
    "Scene asset layout variant test:",
    "Generate a reusable environment reference for later model and product composites.",
    "This should help a later image model understand the space without contaminating the image with graphic annotations.",
    "",
    `Variant: ${variant.title}`,
    `Intent: ${variant.intent}`,
    "",
    variant.prompt,
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

  if (imageBase64) fs.writeFileSync(imagePath, Buffer.from(imageBase64, "base64"));

  const summary = {
    ok: response.ok,
    status: response.status,
    variantId: variant.id,
    title: variant.title,
    intent: variant.intent,
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
