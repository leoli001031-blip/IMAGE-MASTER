#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const outDir = process.env.OUT_DIR || path.join(process.cwd(), "test_artifacts", "api-smoke");
const modelReferencePath =
  process.env.MODEL_REFERENCE_PATH ||
  path.join(
    process.cwd(),
    "test_artifacts",
    "api-smoke",
    "milan-runway-model-asset-ukrainian-kyiv-editorial-2026-05-18T20-29-15-235Z.png"
  );
const sceneReferencePath =
  process.env.SCENE_REFERENCE_PATH ||
  path.join(
    process.cwd(),
    "test_artifacts",
    "api-smoke",
    "scene-main-asset-nordic-home-interior-2026-05-18T23-03-50-494Z.png"
  );
const size = process.env.IMAGE_SIZE || "1024x1024";
const quality = process.env.IMAGE_QUALITY || "standard";
const concurrency = Math.max(1, Math.min(6, Number(process.env.IMAGE_CONCURRENCY || 3) || 3));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

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
if (!fs.existsSync(modelReferencePath)) throw new Error(`Missing model reference: ${modelReferencePath}`);
if (!fs.existsSync(sceneReferencePath)) throw new Error(`Missing scene reference: ${sceneReferencePath}`);

const modelReference = toInputImage(modelReferencePath);
const sceneReference = toInputImage(sceneReferencePath);

const shots = [
  {
    id: "window-sofa-soft-portrait",
    title: "窗边沙发半身",
    direction:
      "The model sits naturally at the edge of a linen sofa near a large window, relaxed upright posture, soft editorial half-body portrait, warm daylight on face, calm Nordic home mood.",
  },
  {
    id: "coffee-table-seated-lifestyle",
    title: "茶几边生活方式",
    direction:
      "The model sits beside a low coffee table, one hand near a ceramic mug or book, three-quarter body composition, believable everyday luxury home lifestyle, face still clear and identity stable.",
  },
  {
    id: "wide-standing-home-editorial",
    title: "家居宽景站姿",
    direction:
      "Wide full-body editorial shot. The model stands in the living room with sofa, oak floor, neutral wall, and negative space visible, elegant but functional pose, premium commercial home campaign feeling.",
  },
  {
    id: "reading-corner-calm",
    title: "阅读角安静感",
    direction:
      "The model is in a calm reading corner of the same Nordic home, lightly holding a book, seated or leaning beside a chair, gentle quiet expression, soft natural light, refined domestic atmosphere.",
  },
  {
    id: "soft-furnishing-interaction",
    title: "软装互动",
    direction:
      "The model interacts with a throw blanket, linen cushion, or ceramic vase in the living room, elegant hands visible, commercial homeware editorial feeling, natural pose and coherent anatomy.",
  },
  {
    id: "social-cover-home-fashion",
    title: "封面感家居时装",
    direction:
      "Premium social cover composition in the Nordic living room. Medium shot with stronger visual hierarchy, clean face, polished hair, refined home-fashion campaign mood, plenty of uncluttered background.",
  },
];

console.log(
  JSON.stringify(
    {
      mode: "model-home-editorial-set",
      model: imageModel,
      baseUrlHost: safeHost(baseUrl),
      size,
      quality,
      concurrency,
      plannedProviderCalls: shots.length,
      modelReferencePath,
      sceneReferencePath,
    },
    null,
    2
  )
);

const started = Date.now();
const results = [];
for (let index = 0; index < shots.length; index += concurrency) {
  const chunk = shots.slice(index, index + concurrency);
  const settled = await Promise.allSettled(chunk.map(generateShot));
  for (const item of settled) {
    results.push(item.status === "fulfilled" ? item.value : { ok: false, error: item.reason?.stack || String(item.reason) });
  }
}

const contactSheetPath = await composeContactSheet(results, stamp);
const manifest = {
  ok: results.every((item) => item.ok && item.imageReturned),
  mode: "model-home-editorial-set",
  model: imageModel,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  concurrency,
  modelReferencePath,
  sceneReferencePath,
  contactSheetPath,
  totalMs: Date.now() - started,
  results,
};
const manifestPath = path.join(outDir, `model-home-editorial-set-${stamp}.manifest.json`);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ manifestPath, ...manifest }, null, 2));

async function generateShot(shot) {
  const shotStarted = Date.now();
  const prefix = `model-home-editorial-set-${shot.id}-${stamp}`;
  const rawPath = path.join(outDir, `${prefix}.sse.txt`);
  const jsonPath = path.join(outDir, `${prefix}.json`);
  const imagePath = path.join(outDir, `${prefix}.png`);
  const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
  const clientRequestId = `image2.model_home.${shot.id}.${crypto.randomUUID()}`;
  const prompt = buildPrompt(shot);
  fs.writeFileSync(promptPath, prompt);
  console.log(`[${shot.id}] started`);

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
          content: [
            { type: "input_text", text: prompt },
            modelReference,
            sceneReference,
          ],
        },
      ],
      tools: [{ type: "image_generation", size, quality }],
      stream: true,
    }),
  });

  const raw = await readResponseBody(response, shotStarted, shot.id);
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

  if (!imageBase64 && raw.text.trim().startsWith("{")) {
    try {
      imageBase64 = findBase64(JSON.parse(raw.text));
    } catch {
      // Keep raw response for diagnostics.
    }
  }

  if (imageBase64) fs.writeFileSync(imagePath, Buffer.from(imageBase64, "base64"));

  const result = {
    ok: response.ok,
    status: response.status,
    shotId: shot.id,
    title: shot.title,
    clientRequestId,
    responseId,
    promptChars: prompt.length,
    references: [
      { path: modelReferencePath, role: "full_model_reference_sheet", bytes: fs.statSync(modelReferencePath).size },
      { path: sceneReferencePath, role: "home_scene_reference", bytes: fs.statSync(sceneReferencePath).size },
    ],
    firstChunkMs: raw.firstChunkMs,
    lastChunkMs: raw.lastChunkMs,
    totalMs: Date.now() - shotStarted,
    bytes: raw.bytes,
    eventCounts,
    imageReturned: Boolean(imageBase64),
    imagePath: imageBase64 ? imagePath : null,
    rawPath,
    promptPath,
    rawPreview: imageBase64 ? undefined : raw.text.slice(0, 1200),
  };
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  console.log(`[${shot.id}] done image=${result.imageReturned} status=${result.status} total=${result.totalMs}ms`);
  return result;
}

function buildPrompt(shot) {
  return [
    "Create one premium commercial home lifestyle image with a consistent adult Eastern European female model.",
    "",
    "Reference image usage:",
    "- The first attached image is a full model reference sheet. Use the entire sheet as the person identity reference: face impression, age impression, hair color and hair volume, body proportion, runway/editorial temperament, full-body posture language, side/back references, and expression range.",
    "- Do not crop, ignore, or reduce the model reference to only a headshot. The full sheet is important for model consistency.",
    "- Do not copy the reference sheet layout, white background, color swatches, printed labels, English text, grid, or multi-panel board into the final image.",
    "- The second attached image is the home scene reference. Use it for Nordic home interior language, soft daylight, neutral palette, warm oak floor, linen sofa, calm premium domestic mood, and spatial believability.",
    "",
    "Model consistency target:",
    "Adult Eastern European / Ukrainian editorial female model, about 25 years old, long dark-blonde polished waves, grey-green gaze, fair clear skin, slim/tall commercial runway frame, restrained aristocratic expression, natural clean makeup. Keep her identity stable, but render as a real single-scene photograph rather than a reference card.",
    "",
    "Wardrobe:",
    "Premium home-fashion styling: light pearl-grey or ivory silk shirt or fine knit top, black or charcoal tailored trousers, understated earrings, opaque high-coverage fabric, elegant and non-sexual.",
    "",
    `Shot: ${shot.title}.`,
    shot.direction,
    "",
    "Image requirements:",
    "- Single coherent photograph, not a collage, not a reference board, not a UI mockup.",
    "- Commercial lifestyle photography, premium but natural, realistic anatomy, clean hands, stable face, believable contact with furniture.",
    "- Keep the home environment calm and uncluttered; no product advertising, no readable text, no logos, no watermark.",
    "- Avoid seductive posing, lingerie, sheer clothing, exaggerated curves, celebrity likeness, deformed fingers, duplicated limbs, extra people, incorrect perspective, or harsh flash.",
  ].join("\n");
}

async function readResponseBody(response, startedAt, label) {
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
      console.log(`[${label}] first chunk ${elapsed}ms`);
    }
  }
  return { text, firstChunkMs, lastChunkMs, bytes };
}

async function composeContactSheet(results, stampValue) {
  const sharp = (await import("sharp")).default;
  const ready = results.filter((item) => item.imageReturned && item.imagePath);
  if (ready.length === 0) return null;

  const tileWidth = 480;
  const tileHeight = 560;
  const cols = 3;
  const rows = Math.ceil(ready.length / cols);
  const gutter = 18;
  const width = cols * tileWidth + (cols + 1) * gutter;
  const height = rows * tileHeight + (rows + 1) * gutter;
  const composites = [];

  for (let index = 0; index < ready.length; index += 1) {
    const item = ready[index];
    const tile = await sharp(item.imagePath)
      .resize({ width: tileWidth, height: tileHeight, fit: "cover", position: "center" })
      .composite([{ input: Buffer.from(createLabelSvg(tileWidth, item.title || item.shotId)), left: 0, top: 0 }])
      .png()
      .toBuffer();
    composites.push({
      input: tile,
      left: gutter + (index % cols) * (tileWidth + gutter),
      top: gutter + Math.floor(index / cols) * (tileHeight + gutter),
    });
  }

  const contactSheetPath = path.join(outDir, `model-home-editorial-set-${stampValue}-contact.png`);
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 248, g: 246, b: 241, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toFile(contactSheetPath);
  return contactSheetPath;
}

function createLabelSvg(width, label) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="52" viewBox="0 0 ${width} 52">
  <rect width="${width}" height="52" fill="rgba(24,22,20,0.62)"/>
  <text x="18" y="34" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="700" fill="#fff">${escapeXml(label)}</text>
</svg>`;
}

function toInputImage(filePath) {
  const buffer = fs.readFileSync(filePath);
  return {
    type: "input_image",
    image_url: `data:${inferMime(filePath)};base64,${buffer.toString("base64")}`,
  };
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

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
