#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const ROOT = process.cwd();
const outDir = process.env.OUT_DIR || path.join(ROOT, "test_artifacts", "api-smoke");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const size = process.env.IMAGE_SIZE || "1536x1024";
const quality = process.env.IMAGE_QUALITY || "standard";
const concurrency = Math.max(1, Math.min(6, Number(process.env.IMAGE_CONCURRENCY || 6) || 6));
const shouldCompressReferences = process.env.LIGHT_SET_COMPRESS !== "0";

const refs = {
  product:
    process.env.LIGHT_SET_PRODUCT ||
    path.join(ROOT, "test_artifacts", "api-smoke", "product-multiview-white-sheet-2026-05-19T00-02-32-476Z.png"),
  model:
    process.env.LIGHT_SET_MODEL ||
    path.join(ROOT, "test_artifacts", "api-smoke", "simplified-fresh-asian-model-card-2026-05-19T18-52-38-134Z.png"),
  compactModel:
    process.env.LIGHT_SET_COMPACT_MODEL ||
    path.join(path.dirname(ROOT), "Image2网页端测试素材", "02_MODEL_compact_identity_reference.jpg"),
  scene:
    process.env.LIGHT_SET_SCENE ||
    path.join(ROOT, "test_artifacts", "api-smoke", "scene-main-asset-nordic-home-interior-2026-05-18T23-03-50-494Z.png"),
  style:
    process.env.LIGHT_SET_STYLE ||
    path.join(ROOT, "test_artifacts", "api-smoke", "style-reference-warm-lifestyle-photography-2026-05-19T14-46-21-493Z.png"),
};

const shots = [
  {
    id: "sofa-window-three-quarter",
    title: "沙发窗边三分之二身",
    direction:
      "A three-quarter body shot near the sofa and large window, the model standing slightly angled toward camera, one hand holding the handbag by the short handle, soft natural window light across the face and bag.",
  },
  {
    id: "coffee-table-seated",
    title: "茶几旁坐姿",
    direction:
      "The model sits naturally beside the low coffee table, handbag resting partly on her lap and partly held by one hand, relaxed premium home lifestyle pose, camera slightly above seated eye level.",
  },
  {
    id: "wide-wall-standing",
    title: "留白墙面宽景站姿",
    direction:
      "A wider full-body campaign shot with the calm neutral wall and wood floor visible, the model standing in realistic scale with furniture, handbag worn on shoulder, lots of uncluttered negative space.",
  },
  {
    id: "walking-past-console",
    title: "边柜旁轻走动",
    direction:
      "The model walks naturally past a wooden console or shelf area from the same imagined home, handbag on forearm, slight motion in posture but still sharp commercial photography.",
  },
  {
    id: "floor-rug-low-angle",
    title: "地毯低机位",
    direction:
      "A lower camera angle near the rug and coffee table, full body visible without distortion, handbag held down beside the leg, strong but natural floor contact and product shadow.",
  },
  {
    id: "portrait-product-medium",
    title: "中景产品封面感",
    direction:
      "A medium editorial cover shot in a nearby corner of the same home, model turned slightly sideways, handbag clearly presented at waist height, clean face, calm premium composition.",
  },
];

await fsp.mkdir(outDir, { recursive: true });

const config = readImageConfig();
const apiKey =
  process.env.LANYI_API_KEY ||
  process.env.IMAGE_API_KEY ||
  process.env.OPENAI_API_KEY ||
  config.imageApiKey ||
  config.apiKey;
const baseUrl = (
  process.env.LANYI_BASE_URL ||
  process.env.IMAGE_BASE_URL ||
  config.imageBaseUrl ||
  config.baseUrl ||
  "https://lanyiapi.com/v1"
).replace(/\/$/, "");
const model = process.env.IMAGE_MODEL || config.imageModel || "gpt-image-2";

if (!apiKey) throw new Error("Missing image API key in env or app config.");
for (const [role, filePath] of Object.entries(refs)) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing ${role} reference: ${filePath}`);
}

const providerRefs = shouldCompressReferences ? await prepareProviderReferences(refs) : refs;
const started = Date.now();

console.log(
  JSON.stringify(
    {
      mode: "light-constraint-same-location-set",
      model,
      baseUrlHost: safeHost(baseUrl),
      size,
      quality,
      concurrency,
      plannedProviderCalls: shots.length,
      compressedReferences: shouldCompressReferences,
      refs: providerRefs,
    },
    null,
    2
  )
);

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
  mode: "light-constraint-same-location-set",
  model,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  concurrency,
  plannedProviderCalls: shots.length,
  compressedReferences: shouldCompressReferences,
  totalMs: Date.now() - started,
  refs: providerRefs,
  contactSheetPath,
  results,
};
const manifestPath = path.join(outDir, `light-constraint-same-location-set-${stamp}.manifest.json`);
await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ manifestPath, ...manifest }, null, 2));

async function generateShot(shot) {
  const shotStarted = Date.now();
  const prefix = `light-constraint-same-location-${shot.id}-${stamp}`;
  const rawPath = path.join(outDir, `${prefix}.sse.txt`);
  const jsonPath = path.join(outDir, `${prefix}.json`);
  const imagePath = path.join(outDir, `${prefix}.png`);
  const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
  const prompt = buildPrompt(shot);
  const clientRequestId = `image2.light_same_location.${shot.id}.${crypto.randomUUID()}`;
  await fsp.writeFile(promptPath, prompt);
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
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            toInputImage(providerRefs.product),
            toInputImage(providerRefs.compactModel),
            toInputImage(providerRefs.scene),
            toInputImage(providerRefs.style),
          ],
        },
      ],
      tools: [{ type: "image_generation", size, quality }],
      stream: true,
    }),
  });

  const raw = await readResponseBody(response, shotStarted, shot.id);
  await fsp.writeFile(rawPath, raw.text);
  const events = parseSse(raw.text);
  const eventCounts = {};
  let responseId = null;
  let imageBase64 = null;
  let revisedPrompt = null;
  const imageGenerationCallIds = [];

  for (const item of events) {
    if (item.event) eventCounts[item.event] = (eventCounts[item.event] || 0) + 1;
    if (!responseId && item.json?.response?.id) responseId = item.json.response.id;
    if (!responseId && typeof item.json?.id === "string" && item.json.id.startsWith("resp_")) responseId = item.json.id;
    const imageGenerationCallId = findImageGenerationCallId(item.json);
    if (imageGenerationCallId && !imageGenerationCallIds.includes(imageGenerationCallId)) imageGenerationCallIds.push(imageGenerationCallId);
    revisedPrompt ||= findRevisedPrompt(item.json);
    imageBase64 ||= findBase64(item.json);
  }

  if (!imageBase64 && raw.text.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(raw.text);
      imageBase64 = findBase64(parsed);
      revisedPrompt ||= findRevisedPrompt(parsed);
    } catch {
      // Raw response is already stored for diagnostics.
    }
  }

  if (imageBase64) await fsp.writeFile(imagePath, Buffer.from(imageBase64, "base64"));

  const result = {
    ok: response.ok,
    status: response.status,
    shotId: shot.id,
    title: shot.title,
    clientRequestId,
    responseId,
    imageGenerationCallIds,
    promptChars: prompt.length,
    firstChunkMs: raw.firstChunkMs,
    lastChunkMs: raw.lastChunkMs,
    totalMs: Date.now() - shotStarted,
    bytes: raw.bytes,
    eventCounts,
    revisedPrompt,
    imageReturned: Boolean(imageBase64),
    imagePath: imageBase64 ? imagePath : null,
    rawPath,
    promptPath,
    rawPreview: imageBase64 ? undefined : raw.text.slice(0, 1200),
  };
  await fsp.writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`[${shot.id}] done image=${result.imageReturned} status=${result.status} total=${result.totalMs}ms`);
  return result;
}

function buildPrompt(shot) {
  return [
    "Create a premium 3:2 commercial lifestyle fashion photograph.",
    "",
    "Use the handbag reference exactly: same taupe leather, soft rectangular shape, handle, strap, stitching, metal hardware, and proportions.",
    "",
    "Use the compact model reference for the same young East Asian female model identity, hairstyle, body type, and clean commercial temperament.",
    "",
    "Use the scene reference as a same-location design reference, not an exact background copy. Keep the same Nordic home interior language: warm wood floor, soft neutral walls, natural window light, calm furniture scale, subtle plants, and quiet premium atmosphere. Generate a different camera angle or nearby area from the same imagined home. The background should feel consistent with the scene reference, but not identical.",
    "",
    "Use the warm lifestyle reference only for natural commercial photography finish.",
    "",
    `Shot direction: ${shot.direction}`,
    "",
    "The model should naturally hold or wear the handbag in a believable fashion pose. Face, body, clothing, hands, legs, and handbag should all share the same scene lighting and soft shadows.",
    "",
    "Make it feel like a real commercial editorial photo from the same campaign, natural and ready for product marketing.",
    "",
    "Avoid product redesign, wrong body scale, pasted-on model, mismatched face lighting, exact background duplication, model-card layout, and awkward hand contact.",
  ].join("\n");
}

async function prepareProviderReferences(inputRefs) {
  const sharp = (await import("sharp")).default;
  const prepared = {};
  for (const [role, filePath] of Object.entries(inputRefs)) {
    if (role === "model") continue;
    const outputPath = path.join(outDir, `light-constraint-ref-${role}-${stamp}.jpg`);
    const maxEdge = role === "style" ? 720 : 896;
    await sharp(filePath)
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: role === "product" ? 88 : 84, mozjpeg: true })
      .toFile(outputPath);
    prepared[role] = outputPath;
  }
  return prepared;
}

async function composeContactSheet(results, stampValue) {
  const sharp = (await import("sharp")).default;
  const ready = results.filter((item) => item.imageReturned && item.imagePath);
  if (ready.length === 0) return null;

  const tileWidth = 520;
  const tileHeight = 360;
  const cols = 2;
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

  const contactSheetPath = path.join(outDir, `light-constraint-same-location-set-${stampValue}-contact.png`);
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

function toInputImage(filePath) {
  const buffer = fs.readFileSync(filePath);
  return {
    type: "input_image",
    image_url: `data:${inferMime(filePath)};base64,${buffer.toString("base64")}`,
  };
}

function readImageConfig() {
  const dbPath = path.join(ROOT, ".data", "image-master.db");
  if (!fs.existsSync(dbPath)) return {};
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare("SELECT key, value FROM config").all();
    return Object.fromEntries(rows.map(({ key, value }) => [key, value]));
  } finally {
    db.close();
  }
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

function findRevisedPrompt(value, depth = 0) {
  if (!value || depth > 12) return null;
  if (typeof value === "object") {
    if (typeof value.revised_prompt === "string" && value.revised_prompt.trim()) return value.revised_prompt.trim();
    if (typeof value.revisedPrompt === "string" && value.revisedPrompt.trim()) return value.revisedPrompt.trim();
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findRevisedPrompt(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    for (const item of Object.values(value)) {
      const found = findRevisedPrompt(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function findImageGenerationCallId(value, depth = 0) {
  if (!value || depth > 8) return null;
  if (typeof value === "object") {
    if (typeof value.id === "string" && value.id.startsWith("ig_")) return value.id;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findImageGenerationCallId(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    for (const item of Object.values(value)) {
      const found = findImageGenerationCallId(item, depth + 1);
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

function createLabelSvg(width, label) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="48" viewBox="0 0 ${width} 48">
  <rect width="${width}" height="48" fill="rgba(24,22,20,0.62)"/>
  <text x="16" y="31" font-family="Inter, Arial, sans-serif" font-size="19" font-weight="700" fill="#fff">${escapeXml(label)}</text>
</svg>`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
