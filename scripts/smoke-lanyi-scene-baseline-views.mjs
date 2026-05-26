#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const outDir = process.env.OUT_DIR || path.join(process.cwd(), "test_artifacts", "api-smoke");
const size = process.env.IMAGE_SIZE || "1024x1024";
const quality = process.env.IMAGE_QUALITY || "standard";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const sceneId = "lijiang-snow-mountain-spatial-pack";
const sceneName = "Lijiang snow mountain terrace";

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

const sceneBible = [
  "Scene spatial bible:",
  "- Location: premium outdoor commercial terrace below Jade Dragon Snow Mountain near Lijiang.",
  "- North/back direction: distant snow mountain and open valley view.",
  "- East/right direction: subtle Naxi-inspired wooden architecture with carved wood, dark roof edge, blue textile curtain.",
  "- South/front direction: stone floor foreground and low stone terrace edge.",
  "- West/left direction: pine branches, one rough stone block, a woven textile cushion.",
  "- Center: low dark wood rectangular platform on stone floor, with enough empty floor and platform space for a full-body model and product later.",
  "- Props: ceramic tea cup and small tray on platform, one woven cushion near stone, restrained local textile detail. Props should stay consistent and secondary.",
  "- Light: crisp plateau daylight from upper left, stable contact shadows, no rain, no fog, no night scene.",
  "- Commercial use: empty reusable scene asset, no people, no product hero, no readable signage.",
].join("\n");

const baselinePrompt = [
  "Create one clean baseline scene reference image, not a collage and not a multi-panel board.",
  "This is the master empty spatial location plate that later views will use as reference.",
  "",
  sceneBible,
  "",
  "Camera: high oblique planning view from about 55-70 degrees above the terrace, wider than a normal hero photo but still photographic and realistic, not a blueprint.",
  "The baseline must clearly map the whole terrace, platform, architecture side, mountain direction, stone floor, pine/stone/textile props, and clean empty placement zones. Prioritize spatial readability over beauty-shot composition.",
  "The image must be practical: it should explain the environment clearly and leave open space for later model/product composites.",
  "No people, no mannequins, no product advertising subject, no captions, no labels, no arrows, no dashed boxes, no outlined placement areas, no UI marks, no text, no logos, no watermark.",
].join("\n");

const viewPrompts = [
  {
    id: "front",
    instruction:
      "Create a FRONT straight-on elevation view of the same scene, facing north toward the platform and distant snow mountain. Keep the platform centered, stone floor foreground visible, mountain behind, left pine/stone cues and right architecture cues still consistent. This is not a diagonal beauty angle.",
  },
  {
    id: "back",
    instruction:
      "Create a BACK straight-on elevation view of the same scene from the mountain/valley side looking south back toward the platform, stone floor, and Naxi-inspired wooden architecture. Keep the same platform shape, props, light direction, and material language. This is not a new scene.",
  },
  {
    id: "left",
    instruction:
      "Create a LEFT straight-on side elevation view of the same scene from the west side. Show the platform side, stone floor edge, pine/stone/textile side anchors, and the architecture remaining on the far/right side of the space. Avoid diagonal 30-45 degree composition.",
  },
  {
    id: "right",
    instruction:
      "Create a RIGHT straight-on side elevation view of the same scene from the east/architecture side. Show the wooden building side, platform side, stone floor, and mountain/terrace relationship. Keep all anchors compatible with the baseline image. Avoid diagonal 30-45 degree composition.",
  },
];

const started = Date.now();
console.log(
  JSON.stringify(
    {
      mode: "scene-baseline-views-smoke",
      model,
      baseUrlHost: safeHost(baseUrl),
      size,
      quality,
      sceneId,
      plannedCalls: 1 + viewPrompts.length,
    },
    null,
    2
  )
);

const baseline = await generateImage({
  id: "baseline",
  prompt: baselinePrompt,
  referencePath: null,
});

if (!baseline.imagePath) {
  throw new Error(`Baseline image did not return. See ${baseline.rawPath}`);
}

const viewResults = [];
for (const view of viewPrompts) {
  const prompt = [
    "Create one single scene view image from the attached baseline reference.",
    "Use the attached image as the primary environment identity anchor: same location, same material family, same platform, same prop set, same light direction, same empty placement zones.",
    "The task is to infer a consistent cardinal view from the scene spatial bible. Do not copy the reference image camera angle or composition.",
    "Preserve the environment identity while rotating the virtual camera to the requested front/back/left/right side.",
    "",
    sceneBible,
    "",
    view.instruction,
    "",
    "Output only one clean photographic view. No people, no mannequins, no captions, no labels, no arrows, no dashed boxes, no outlined placement areas, no UI marks, no readable text, no logos, no watermark, no split panels, no collage.",
  ].join("\n");

  viewResults.push(
    await generateImage({
      id: view.id,
      prompt,
      referencePath: baseline.imagePath,
    })
  );
}

const boardPath = path.join(outDir, `scene-baseline-views-board-${sceneId}-${stamp}.png`);
const boardHtmlPath = path.join(outDir, `scene-baseline-views-board-${sceneId}-${stamp}.html`);
await composeBoard({
  baselinePath: baseline.imagePath,
  viewPaths: viewResults.map((result) => result.imagePath).filter(Boolean),
  boardPath,
  boardHtmlPath,
});

const manifest = {
  mode: "scene-baseline-views-smoke",
  sceneId,
  sceneName,
  model,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  totalMs: Date.now() - started,
  baseline,
  views: viewResults,
  boardPath,
  boardHtmlPath,
};
const manifestPath = path.join(outDir, `scene-baseline-views-${sceneId}-${stamp}.manifest.json`);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ manifestPath, ...manifest }, null, 2));

async function generateImage({ id, prompt, referencePath }) {
  const oneStarted = Date.now();
  const prefix = `scene-baseline-views-${sceneId}-${id}-${stamp}`;
  const rawPath = path.join(outDir, `${prefix}.sse.txt`);
  const jsonPath = path.join(outDir, `${prefix}.json`);
  const imagePath = path.join(outDir, `${prefix}.png`);
  const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
  const clientRequestId = `image2.scene_baseline_views.${id}.${crypto.randomUUID()}`;
  fs.writeFileSync(promptPath, prompt);
  console.log(`[${id}] started`);

  const content = [{ type: "input_text", text: prompt }];
  let referenceBytes = 0;
  if (referencePath) {
    const referenceBuffer = fs.readFileSync(referencePath);
    referenceBytes = referenceBuffer.byteLength;
    content.push({
      type: "input_image",
      image_url: `data:${inferMime(referencePath)};base64,${referenceBuffer.toString("base64")}`,
    });
  }

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
          content,
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
    const elapsed = Date.now() - oneStarted;
    firstChunkMs ??= elapsed;
    lastChunkMs = elapsed;
    bytes += value.byteLength;
    raw += Buffer.from(value).toString("utf8");
    if (!firstLogged) {
      firstLogged = true;
      console.log(`[${id}] first chunk ${elapsed}ms`);
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

  const result = {
    ok: response.ok,
    status: response.status,
    id,
    clientRequestId,
    responseId,
    promptChars: prompt.length,
    referencePath,
    referenceBytes,
    firstChunkMs,
    lastChunkMs,
    totalMs: Date.now() - oneStarted,
    bytes,
    eventCounts,
    imageReturned: Boolean(imageBase64),
    imagePath: imageBase64 ? imagePath : null,
    rawPath,
    promptPath,
    rawPreview: imageBase64 ? undefined : raw.slice(0, 1200),
  };
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  console.log(`[${id}] done image=${result.imageReturned} status=${result.status} total=${result.totalMs}ms`);
  return result;
}

async function composeBoard({ baselinePath, viewPaths, boardPath, boardHtmlPath }) {
  const sharp = (await import("sharp")).default;
  const width = 1600;
  const gutter = 14;
  const topHeight = 900;
  const tileSize = Math.floor((width - gutter * 5) / 4);
  const height = topHeight + gutter + tileSize;
  const background = { r: 248, g: 247, b: 244, alpha: 1 };

  const baselineBuffer = await sharp(baselinePath)
    .resize({ width, height: topHeight, fit: "cover", position: "center" })
    .png()
    .toBuffer();
  const composites = [{ input: baselineBuffer, left: 0, top: 0 }];

  for (let index = 0; index < Math.min(4, viewPaths.length); index += 1) {
    const tileBuffer = await sharp(viewPaths[index])
      .resize({ width: tileSize, height: tileSize, fit: "cover", position: "center" })
      .png()
      .toBuffer();
    composites.push({
      input: tileBuffer,
      left: gutter + index * (tileSize + gutter),
      top: topHeight + gutter,
    });
  }

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background,
    },
  })
    .composite(composites)
    .png()
    .toFile(boardPath);

  const html = [
    "<!doctype html>",
    "<html><head><meta charset=\"utf-8\"><title>Scene Baseline Views</title>",
    "<style>body{margin:0;background:#f8f7f4;font-family:system-ui,sans-serif}.board{width:1600px}.top img{width:1600px;height:900px;object-fit:cover;display:block}.strip{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:14px}.strip img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block}</style>",
    "</head><body><div class=\"board\"><div class=\"top\">",
    `<img src="${path.basename(baselinePath)}">`,
    "</div><div class=\"strip\">",
    ...viewPaths.slice(0, 4).map((filePath) => `<img src="${path.basename(filePath)}">`),
    "</div></div></body></html>",
  ].join("");
  fs.writeFileSync(boardHtmlPath, html);
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

function inferMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function safeHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}
