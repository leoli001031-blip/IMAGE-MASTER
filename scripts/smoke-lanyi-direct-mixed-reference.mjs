#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const ROOT = process.cwd();
const outDir = path.join(ROOT, "test_artifacts", "api-smoke");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const modelMode = normalizeModelMode(process.env.DIRECT_MIXED_REF_MODEL_MODE);
const size = process.env.IMAGE_SIZE || "1024x1024";
const quality = process.env.IMAGE_QUALITY || "standard";
const stableNeutralReferencePath = process.env.DIRECT_MIXED_REF_NEUTRAL_MODEL ||
  path.join(outDir, "model-neutral-identity-reference.png");
const shouldCompressReferences = process.env.DIRECT_MIXED_REF_COMPRESS !== "0";

const refs = {
  product: process.env.DIRECT_MIXED_REF_PRODUCT ||
    path.join(outDir, "product-multiview-white-sheet-2026-05-19T00-02-32-476Z.png"),
  model: process.env.DIRECT_MIXED_REF_MODEL ||
    path.join(outDir, "milan-runway-model-asset-eastern-europe-warsaw-couture-2026-05-18T20-29-15-235Z.png"),
  scene: process.env.DIRECT_MIXED_REF_SCENE ||
    path.join(outDir, "scene-main-asset-nordic-home-interior-2026-05-18T23-03-50-494Z.png"),
  style: process.env.DIRECT_MIXED_REF_STYLE ||
    path.join(outDir, "style-reference-warm-lifestyle-photography.png"),
};

await fsp.mkdir(outDir, { recursive: true });

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
for (const [role, filePath] of Object.entries(refs)) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing ${role} reference: ${filePath}`);
}

const preparedModelPath = modelMode === "neutral"
  ? await resolveNeutralModelReference(refs.model)
  : refs.model;
const providerRefs = shouldCompressReferences
  ? await prepareProviderReferences({
      product: refs.product,
      model: preparedModelPath,
      scene: refs.scene,
      style: refs.style,
    })
  : {
      product: refs.product,
      model: preparedModelPath,
      scene: refs.scene,
      style: refs.style,
    };
const prompt = buildPrompt(modelMode);
const prefix = `direct-mixed-reference-${modelMode}-${stamp}`;
const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
const rawPath = path.join(outDir, `${prefix}.sse.txt`);
const jsonPath = path.join(outDir, `${prefix}.json`);
const imagePath = path.join(outDir, `${prefix}.png`);
const clientRequestId = `image2.direct_mixed.${modelMode}.${crypto.randomUUID()}`;
const started = Date.now();

await fsp.writeFile(promptPath, prompt);

console.log(JSON.stringify({
  mode: "direct-mixed-reference",
  modelMode,
  model,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  plannedProviderCalls: 1,
  compressedReferences: shouldCompressReferences,
  refs: {
    product: providerRefs.product,
    model: providerRefs.model,
    scene: providerRefs.scene,
    style: providerRefs.style,
  },
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
        content: [
          { type: "input_text", text: prompt },
          toInputImage(providerRefs.product),
          toInputImage(providerRefs.model),
          toInputImage(providerRefs.scene),
          toInputImage(providerRefs.style),
        ],
      },
    ],
    tools: [{ type: "image_generation", size, quality }],
    stream: true,
  }),
});

const raw = await readResponseBody(response, started);
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
  if (!responseId && typeof item.json?.id === "string" && item.json.id.startsWith("resp_")) {
    responseId = item.json.id;
  }
  const imageGenerationCallId = findImageGenerationCallId(item.json);
  if (imageGenerationCallId && !imageGenerationCallIds.includes(imageGenerationCallId)) {
    imageGenerationCallIds.push(imageGenerationCallId);
  }
  revisedPrompt ||= findRevisedPrompt(item.json);
  imageBase64 ||= findBase64(item.json);
}

if (!imageBase64 && raw.text.trim().startsWith("{")) {
  try {
    imageBase64 = findBase64(JSON.parse(raw.text));
    revisedPrompt ||= findRevisedPrompt(JSON.parse(raw.text));
  } catch {
    // Keep raw response for diagnostics.
  }
}

if (imageBase64) {
  await fsp.writeFile(imagePath, Buffer.from(imageBase64, "base64"));
}

const summary = {
  ok: response.ok,
  status: response.status,
  model,
  modelMode,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  clientRequestId,
  responseId,
  imageGenerationCallIds,
  revisedPrompt,
  promptChars: prompt.length,
  firstChunkMs: raw.firstChunkMs,
  lastChunkMs: raw.lastChunkMs,
  totalMs: Date.now() - started,
  bytes: raw.bytes,
  eventCounts,
  imageReturned: Boolean(imageBase64),
  imagePath: imageBase64 ? imagePath : null,
  rawPath,
  promptPath,
  compressedReferences: shouldCompressReferences,
  refs: {
    product: providerRefs.product,
    model: providerRefs.model,
    scene: providerRefs.scene,
    style: providerRefs.style,
  },
  rawPreview: imageBase64 ? undefined : raw.text.slice(0, 1200),
};

await fsp.writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));

async function resolveNeutralModelReference(sourcePath) {
  if (fs.existsSync(stableNeutralReferencePath)) return stableNeutralReferencePath;
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "scripts", "prepare-model-neutral-reference.mjs"),
      "--source",
      sourcePath,
      "--out",
      stableNeutralReferencePath,
    ],
    { cwd: ROOT, stdio: "inherit" }
  );
  if (result.status !== 0) {
    throw new Error(`Failed to prepare neutral model reference at ${stableNeutralReferencePath}`);
  }
  return stableNeutralReferencePath;
}

async function prepareProviderReferences(inputRefs) {
  const sharp = await import("sharp");
  const prepared = {};
  for (const [role, filePath] of Object.entries(inputRefs)) {
    const outputPath = path.join(outDir, `direct-mixed-reference-${role}-${stamp}.jpg`);
    const maxEdge = role === "style" ? 640 : 768;
    await sharp.default(filePath)
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: role === "product" ? 86 : 82, mozjpeg: true })
      .toFile(outputPath);
    prepared[role] = outputPath;
  }
  return prepared;
}

function buildPrompt(currentModelMode) {
  const modelInstruction = currentModelMode === "neutral"
    ? [
        "The second attached image is a neutral downstream model identity reference, intentionally prepared from the original model sheet for scene compositing.",
        "Use it strongly for the same hair family, age impression, body proportion, posture temperament, wardrobe silhouette, and broad face impression.",
        "Do not inherit its board background, card exposure, label text, or reference-card composition; the home scene is the lighting authority.",
      ].join(" ")
    : [
        "The second attached image is the original full model identity sheet.",
        "Use it for identity consistency: face impression, hair family, body proportion, posture language, age impression, and commercial temperament.",
        "Do not copy the reference sheet layout, white background, labels, grid, multi-panel design, or studio portrait lighting.",
      ].join(" ");

  return [
    "Create one single photorealistic premium lifestyle ecommerce image.",
    "",
    "Attached image order:",
    "1. Product multi-view identity sheet.",
    "2. Model identity reference.",
    "3. Nordic home scene reference.",
    "4. Warm lifestyle photography style reference.",
    "",
    "Reference usage:",
    "- Preserve the product from image 1: structure, material, scale, hardware, silhouette, and recognizable details.",
    `- ${modelInstruction}`,
    "- Use image 3 as the physical lighting plate and room geometry source. It controls visible window position, sun stripe direction, brightest wall/floor areas, shadow direction, softness, color temperature, background exposure, floor contact, and perspective.",
    "- Use image 4 only for restrained warm commercial finish. It must not override the scene light map.",
    "",
    "Final image:",
    "An adult Eastern European commercial model subject naturally stands or sits in the Nordic home interior and carries or holds the referenced product.",
    "Available-light environmental portrait, not a beauty portrait: no added fill light, no studio softbox, no glamour catchlights, no face retouching, no front-facing fill.",
    "The visible window is on image-left. The model's image-left face, hair edge, shoulder, trousers, and product side should be brighter; image-right planes should fall into soft room shadow.",
    "Face exposure must obey the same room light as clothing, hands, product, and rug; the shadow side of the face may remain naturally darker.",
    "Feet and product must have believable contact shadows on the floor/body/hand. Product hardware and leather highlights must follow the window direction.",
    "Medium-wide commercial shot, model and product both clear, natural hand interaction, coherent perspective.",
    "No poster text, no watermark, no collage, no cutout edge, no floating feet, no duplicated limbs, no seductive posing.",
  ].join("\n");
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

function toInputImage(filePath) {
  const buffer = fs.readFileSync(filePath);
  return {
    type: "input_image",
    image_url: `data:${inferMime(filePath)};base64,${buffer.toString("base64")}`,
  };
}

function inferMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

async function readResponseBody(response, startedAt) {
  const reader = response.body?.getReader();
  let text = "";
  let firstChunkMs = null;
  let lastChunkMs = null;
  let bytes = 0;

  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    const elapsed = Date.now() - startedAt;
    firstChunkMs ??= elapsed;
    lastChunkMs = elapsed;
    bytes += value.byteLength;
    text += Buffer.from(value).toString("utf8");
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
      // Leave malformed payload in raw log.
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

function normalizeModelMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "soft" || normalized === "neutral" ? "neutral" : "full";
}

function findRevisedPrompt(value, depth = 0) {
  if (!value || depth > 12) return null;
  if (typeof value === "object") {
    if (typeof value.revised_prompt === "string" && value.revised_prompt.trim()) {
      return value.revised_prompt.trim();
    }
    if (typeof value.revisedPrompt === "string" && value.revisedPrompt.trim()) {
      return value.revisedPrompt.trim();
    }
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

function safeHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}
