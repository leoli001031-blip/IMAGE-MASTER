#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const ROOT = process.cwd();
const outDir = process.env.OUT_DIR || path.join(ROOT, "test_artifacts", "photoreal-prompt-variants");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const size = process.env.IMAGE_SIZE || "1024x1536";
const quality = process.env.IMAGE_QUALITY || "high";
const latestSweetRun = await findLatestSweetBagRun();
const report = JSON.parse(await fsp.readFile(path.join(latestSweetRun, "report.json"), "utf8"));

const refs = {
  product: report.assets.find((asset) => asset.key === "product")?.outputPath,
  model: report.assets.find((asset) => asset.key === "model")?.outputPath,
  scene: report.assets.find((asset) => asset.key === "outdoor")?.outputPath,
};

const variants = [
  {
    id: "candid-street-35mm",
    title: "真实街拍 35mm",
    prompt: [
      "Create a photorealistic candid street-style photograph, as if captured by a real fashion photographer on a quiet spring afternoon.",
      "Use image 1 only as the exact plush handbag identity: cream-white and light-pink short plush, small rounded body, short handle, thin shoulder strap, subtle light-gold hardware.",
      "Use image 2 only as the same adult model identity, hair family, body proportion, and gentle sweet temperament. Do not copy model-card lighting or sheet layout.",
      "Use image 3 as the real street environment direction, but make it feel like a naturally captured nearby spot, not an exact background copy.",
      "The model is walking slowly on a real sidewalk near a flower shop, casually holding the bag by the short handle. Full body, eye-level camera, 35mm lens, natural ambient daylight, mild background clutter, real pavement, imperfect shadows, slight fabric wrinkles, natural skin texture, tiny flyaway hairs, believable hand-bag contact.",
      "It should look like an actual editorial street photo, not an e-commerce composite, not a catalog render, not a staged studio product image. No text, no watermark, no fake brand logo.",
    ].join("\n"),
  },
  {
    id: "phone-snapshot-natural",
    title: "自然手机抓拍",
    prompt: [
      "Make a realistic phone-camera fashion snapshot, casual and alive, not polished advertising.",
      "Image 1 is the exact plush mini handbag reference. Keep the same material, small size, rounded silhouette, cream and pink color, handle, strap, and hardware.",
      "Image 2 is the adult model identity reference only. Keep the same person, but relight her naturally in the street scene.",
      "Image 3 is the outdoor spring street / flower shop reference for location, daylight, and atmosphere.",
      "The model stands near the storefront after shopping, one shoulder slightly relaxed, the plush bag hanging naturally from her forearm. Slightly imperfect framing, natural phone-like perspective, soft daylight mixed with shop-window bounce, real skin texture, normal clothing wrinkles, realistic feet on pavement, not too symmetrical, not over-retouched.",
      "Avoid: studio lighting, beauty dish catchlights, product pasted onto hand, porcelain skin, CGI smoothness, catalog pose, showroom clean background, AI fashion poster look, extra bags, fake logos, readable text.",
    ].join("\n"),
  },
  {
    id: "documentary-fashion",
    title: "纪实感时装片",
    prompt: [
      "Create a documentary-style fashion photograph for a small handbag brand campaign, grounded and realistic.",
      "The final image should feel photographed in a real place with an actual person and actual bag, not generated as a clean product mockup.",
      "Image 1 locks the plush handbag identity. Image 2 locks the adult model identity. Image 3 provides the street location and real daylight behavior.",
      "Scene: the model pauses beside a flower shop entrance, carrying the exact plush bag at hip height. Camera at human eye level, 50mm lens feeling, shallow but not extreme depth of field, natural color balance, soft spring sunlight, mixed shade, real shadows on the ground, slight background distractions, subtle film grain.",
      "Preserve small real-world imperfections: natural hand pressure on the handle, uneven hair strands, cloth folds, varied skin texture, slight asymmetry in posture, realistic scale between model, bag, storefront, and pavement.",
      "Do not make it a Taobao composite, studio catalog image, glossy AI render, luxury mall ad, or over-clean commercial packshot. No text, no watermark, no fake logo.",
    ].join("\n"),
  },
];
const variantFilter = process.env.PHOTOREAL_VARIANT;
const selectedVariants = variantFilter
  ? variants.filter((variant) => variant.id === variantFilter)
  : variants;
if (variantFilter && selectedVariants.length === 0) {
  throw new Error(`Unknown PHOTOREAL_VARIANT=${variantFilter}`);
}

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
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`Missing ${role} reference: ${filePath}`);
}

const providerRefs = await prepareProviderReferences(refs);
console.log(
  JSON.stringify(
    {
      mode: "photoreal-prompt-variants",
      model,
      baseUrlHost: safeHost(baseUrl),
      size,
      quality,
      latestSweetRun,
      plannedProviderCalls: selectedVariants.length,
      refs: providerRefs,
    },
    null,
    2
  )
);

const started = Date.now();
const settled = await Promise.allSettled(selectedVariants.map(generateVariant));
const results = settled.map((item) =>
  item.status === "fulfilled" ? item.value : { ok: false, error: item.reason?.stack || String(item.reason) }
);
const contactSheetPath = await composeContactSheet(results, stamp);
const manifest = {
  ok: results.every((item) => item.ok && item.imageReturned),
  mode: "photoreal-prompt-variants",
  model,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  latestSweetRun,
  totalMs: Date.now() - started,
  refs: providerRefs,
  contactSheetPath,
  results,
};
const manifestPath = path.join(outDir, `photoreal-prompt-variants-${stamp}.manifest.json`);
await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ manifestPath, ...manifest }, null, 2));
if (!manifest.ok) process.exitCode = 1;

async function generateVariant(variant) {
  const shotStarted = Date.now();
  const prefix = `photoreal-${variant.id}-${stamp}`;
  const rawPath = path.join(outDir, `${prefix}.sse.txt`);
  const jsonPath = path.join(outDir, `${prefix}.json`);
  const imagePath = path.join(outDir, `${prefix}.png`);
  const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
  const clientRequestId = `image2.photoreal_variant.${variant.id}.${crypto.randomUUID()}`;
  await fsp.writeFile(promptPath, variant.prompt);
  console.log(`[${variant.id}] started`);

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
            { type: "input_text", text: variant.prompt },
            toInputImage(providerRefs.product),
            toInputImage(providerRefs.model),
            toInputImage(providerRefs.scene),
          ],
        },
      ],
      tools: [{ type: "image_generation", size, quality }],
      stream: true,
    }),
  });

  const raw = await readResponseBody(response, shotStarted, variant.id);
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
      // Raw response saved.
    }
  }

  if (imageBase64) await fsp.writeFile(imagePath, Buffer.from(imageBase64, "base64"));
  const result = {
    ok: response.ok,
    status: response.status,
    variantId: variant.id,
    title: variant.title,
    clientRequestId,
    responseId,
    imageGenerationCallIds,
    promptChars: variant.prompt.length,
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
  console.log(`[${variant.id}] done image=${result.imageReturned} status=${result.status} total=${result.totalMs}ms`);
  return result;
}

async function findLatestSweetBagRun() {
  const root = path.join(ROOT, "test_artifacts", "sweet-plush-bag-scene-set");
  const entries = await fsp.readdir(root, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort()
    .reverse();
  for (const dir of dirs) {
    if (fs.existsSync(path.join(dir, "report.json"))) return dir;
  }
  throw new Error(`No sweet plush bag report found under ${root}`);
}

async function prepareProviderReferences(inputRefs) {
  const sharp = (await import("sharp")).default;
  const prepared = {};
  for (const [role, filePath] of Object.entries(inputRefs)) {
    const outputPath = path.join(outDir, `photoreal-ref-${role}-${stamp}.jpg`);
    const maxEdge = role === "model" ? 768 : 896;
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
  if (!ready.length) return null;
  const tileWidth = 360;
  const tileHeight = 540;
  const labelHeight = 56;
  const gutter = 18;
  const width = ready.length * tileWidth + (ready.length + 1) * gutter;
  const height = tileHeight + labelHeight + gutter * 2;
  const composites = [];
  for (let index = 0; index < ready.length; index += 1) {
    const item = ready[index];
    const tile = await sharp(item.imagePath)
      .resize({ width: tileWidth, height: tileHeight, fit: "cover", position: "center" })
      .png()
      .toBuffer();
    const x = gutter + index * (tileWidth + gutter);
    composites.push({ input: tile, left: x, top: gutter });
    composites.push({
      input: Buffer.from(createLabelSvg(tileWidth, labelHeight, `${index + 1}. ${item.title}`)),
      left: x,
      top: gutter + tileHeight,
    });
  }
  const contactSheetPath = path.join(outDir, `photoreal-prompt-variants-${stampValue}-contact.png`);
  await sharp({
    create: { width, height, channels: 4, background: { r: 240, g: 232, b: 224, alpha: 1 } },
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
      // Raw SSE saved separately.
    }
    return [{ event, data, json }];
  });
}

function findBase64(value, depth = 0) {
  if (!value || depth > 12) return null;
  if (typeof value === "string") {
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
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

function createLabelSvg(width, height, label) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#fffaf7"/>
  <text x="14" y="34" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="#31221f">${escapeXml(label)}</text>
</svg>`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
