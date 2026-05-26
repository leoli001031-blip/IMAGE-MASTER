#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const args = parseArgs(process.argv.slice(2));
const referencePath = args.reference || args.ref;
if (!referencePath) {
  throw new Error("Usage: node scripts/smoke-lanyi-model-asset-concurrency.mjs --reference /abs/path.png");
}

const config = readImageConfig();
const apiKey = process.env.LANYI_API_KEY || process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY || config.imageApiKey;
const baseUrl = (process.env.LANYI_BASE_URL || process.env.IMAGE_BASE_URL || config.imageBaseUrl || "https://lanyiapi.com/v1").replace(/\/$/, "");
const model = process.env.IMAGE_MODEL || config.imageModel || "gpt-image-2";
const size = args.size || "1536x1024";
const quality = args.quality || "standard";
const concurrency = Math.max(1, Math.min(8, Number(args.concurrency || 5) || 5));
if (!apiKey) throw new Error("Missing image API key in env or app config.");

const outDir = args["out-dir"] || path.join(process.cwd(), "test_artifacts", "api-smoke");
fs.mkdirSync(outDir, { recursive: true });

const referenceBuffer = fs.readFileSync(referencePath);
const referenceDataUrl = `data:${inferMime(referencePath)};base64,${referenceBuffer.toString("base64")}`;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const profiles = [
  {
    id: "european-global",
    title: "European Global Commercial Model",
    prompt: [
      "28-year-old adult European female professional model for global premium commerce.",
      "Ash-blonde polished bob hair with defined silhouette, blue-gray eyes, lightly angular cheekbones, composed editorial expression.",
      "Slim-to-average frame, balanced natural proportions, champagne silk-blend blouse, cool grey tailored wide-leg trousers, minimal pearl studs, clean low-profile shoes.",
      "Use a cooler premium palette and more composed catalog posture; do not default to white T-shirt plus jeans.",
    ].join(" "),
  },
  {
    id: "east-asian-neutral",
    title: "East Asian Neutral Commercial Model",
    prompt: [
      "30-year-old adult Pan-East-Asian female professional model for neutral cross-market catalog use.",
      "Shoulder-length soft dark-brown hair with natural movement, calm intelligent expression, refined practical temperament.",
      "Slim-to-average frame, balanced natural proportions, warm grey lightweight blazer over cream knit top, charcoal tapered trousers, minimal white sneakers.",
      "Use a mature work-focused catalog signal; avoid Japanese minimal bob, Korean glossy beauty styling, or Chinese social-commerce styling.",
    ].join(" "),
  },
  {
    id: "japanese-minimal",
    title: "Japanese Minimal Commercial Model",
    prompt: [
      "25-year-old adult Japanese female professional model for minimal lifestyle commerce.",
      "Dark brown chin-length soft bob hair with tidy airy fringe, gentle composed expression, understated Tokyo minimal temperament.",
      "Slim-to-average frame, balanced natural proportions, oatmeal fine-knit cardigan over ivory top, navy straight skirt or clean tapered trousers, minimal leather flats.",
      "Use quiet minimal styling and compact hair silhouette; avoid K-beauty gloss, influencer posing, and the generic white T-shirt denim baseline.",
    ].join(" "),
  },
  {
    id: "korean-seoul",
    title: "Korean Seoul Clean Commercial Model",
    prompt: [
      "24-year-old adult Korean female professional model for clean beauty and Seoul social commerce.",
      "Long chestnut-brown softly waved hair with polished airy volume, luminous clean skin, fresh but clearly adult expression.",
      "Slim frame, balanced natural proportions, crisp pale-blue shirt tucked into ivory straight trousers, delicate silver earrings, clean white shoes.",
      "Use brighter clean-beauty styling and longer soft waves; avoid Japanese minimal softness and Chinese product-demo wardrobe.",
    ].join(" "),
  },
  {
    id: "chinese-ecommerce",
    title: "Chinese E-commerce Professional Model",
    prompt: [
      "27-year-old adult Chinese female professional model for Taobao detail pages and Xiaohongshu seeding images.",
      "Long straight natural black hair with soft half-up styling option, warm confident expression, polished practical commerce temperament.",
      "Slim-to-average frame, balanced natural proportions, ivory blouse with clean neckline, warm beige tailored trousers, small gold studs, simple nude flats.",
      "Use warmer conversion-oriented styling and product-demo readiness; avoid the generic East Asian neutral outfit and K-beauty styling.",
    ].join(" "),
  },
];

const started = Date.now();
console.log(JSON.stringify({
  mode: "lanyi-model-asset-concurrency",
  model,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  concurrency,
  referencePath,
  referenceBytes: referenceBuffer.byteLength,
  profiles: profiles.map(({ id, title }) => ({ id, title })),
}, null, 2));

const results = [];
for (let i = 0; i < profiles.length; i += concurrency) {
  const batch = profiles.slice(i, i + concurrency);
  const settled = await Promise.allSettled(batch.map((profile) => runProfile(profile)));
  for (const item of settled) {
    if (item.status === "fulfilled") results.push(item.value);
    else results.push({ ok: false, error: item.reason?.stack || String(item.reason) });
  }
}

const manifest = {
  ok: results.every((item) => item.ok && item.imageReturned),
  model,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  concurrency,
  referencePath,
  referenceBytes: referenceBuffer.byteLength,
  totalMs: Date.now() - started,
  results,
};
const manifestPath = path.join(outDir, `lanyi-model-asset-concurrency-${stamp}.manifest.json`);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ manifestPath, ...manifest }, null, 2));

async function runProfile(profile) {
  const profileStarted = Date.now();
  const prefix = `lanyi-model-asset-${profile.id}-${stamp}`;
  const rawPath = path.join(outDir, `${prefix}.sse.txt`);
  const jsonPath = path.join(outDir, `${prefix}.json`);
  const imagePath = path.join(outDir, `${prefix}.png`);
  const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
  const clientRequestId = `image2.model_asset.${profile.id}.${crypto.randomUUID()}`;
  const prompt = buildPrompt(profile);

  fs.writeFileSync(promptPath, prompt);
  console.log(`[${profile.id}] started`);

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
            { type: "input_image", image_url: referenceDataUrl },
          ],
        },
      ],
      tools: [{ type: "image_generation", size, quality }],
      stream: true,
    }),
  });

  const contentType = response.headers.get("content-type") || "";
  const reader = response.body?.getReader();
  let raw = "";
  let firstChunkMs = null;
  let lastChunkMs = null;
  let bytes = 0;
  let firstChunkLogged = false;

  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    const elapsed = Date.now() - profileStarted;
    firstChunkMs ??= elapsed;
    lastChunkMs = elapsed;
    bytes += value.byteLength;
    raw += Buffer.from(value).toString("utf8");
    if (!firstChunkLogged) {
      firstChunkLogged = true;
      console.log(`[${profile.id}] first chunk ${elapsed}ms`);
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
    if (!responseId && typeof item.json?.id === "string" && item.json.id.startsWith("resp_")) responseId = item.json.id;
    imageBase64 ||= findBase64(item.json);
  }

  if (!imageBase64 && raw.trim().startsWith("{")) {
    try {
      imageBase64 = findBase64(JSON.parse(raw));
    } catch {
      // Raw body is persisted for diagnosis.
    }
  }

  if (imageBase64) fs.writeFileSync(imagePath, Buffer.from(imageBase64, "base64"));

  const result = {
    ok: response.ok,
    status: response.status,
    profileId: profile.id,
    title: profile.title,
    clientRequestId,
    responseId,
    contentType,
    promptChars: prompt.length,
    firstChunkMs,
    lastChunkMs,
    totalMs: Date.now() - profileStarted,
    bytes,
    eventCounts,
    imageReturned: Boolean(imageBase64),
    imagePath: imageBase64 ? imagePath : null,
    rawPath,
    promptPath,
    rawPreview: imageBase64 ? undefined : raw.slice(0, 1200),
  };
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  console.log(`[${profile.id}] done image=${result.imageReturned} status=${result.status} total=${result.totalMs}ms`);
  return result;
}

function buildPrompt(profile) {
  return [
    "Professional commercial model character reference sheet.",
    "Output format: 3:2 landscape model card reference sheet, clean editorial grid layout, warm light-gray or soft beige matte neutral background, large-area diffuse reflected daylight, matte ambient wrap, very low contrast, spacious high-end commercial presentation.",
    "",
    "Reference image usage:",
    "Use the attached reference image as the visual-system anchor only: preserve the clean model-card layout, spacing, multi-angle structure, expression row structure, and commercial polish. Replace any old white-background studio lighting with diffuse low-contrast model-card lighting.",
    "Do not copy the exact person, face, ethnicity, hairstyle, wardrobe, body proportions, or text from the reference image.",
    "The five default model assets must be visibly different from each other: vary age impression, hair silhouette, wardrobe baseline, temperament, market role, and commercial use case while keeping the same asset-sheet visual language.",
    "",
    "Identity to create:",
    profile.prompt,
    "",
    "Layout requirements:",
    "Main section: full-body turn-around views, front, 3/4, side, back, neutral standing pose, full body visible, aligned height.",
    "Left sidebar: simple model identity panel only, no height ruler, no measurement scale, no dense text.",
    "Top right: small color palette swatches matching the wardrobe.",
    "Right section: multi-angle head detail shots, front, 3/4 left, 3/4 right, side left, side right.",
    "Below the full-body views: expression row with neutral, happy, surprised, thoughtful, confident, gentle smile, serious, and warm laugh.",
    "Lower right: one large clean close-up portrait.",
    "",
    "Commercial constraints:",
    "Adult professional model only. Functional commercial model reference, non-sexual, neutral presentation, opaque fabric, high coverage.",
    "No product, no brand logo, no selling text, no watermark, no seductive pose, no lingerie styling, no sheer fabric, no cleavage emphasis, no provocative expression.",
    "No duplicate limbs, no distorted face, no dense text, no harsh shadows, no exaggerated curves.",
  ].join("\n");
}

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
    if (!next || next.startsWith("--")) parsed[key] = "true";
    else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function inferMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
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
      // Keep raw SSE for diagnosis.
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

function safeHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}
