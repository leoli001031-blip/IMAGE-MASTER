#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const ROOT = process.cwd();
const outDir = process.env.OUT_DIR || path.join(ROOT, "test_artifacts", "api-smoke");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const size = process.env.IMAGE_SIZE || "1024x1536";
const quality = process.env.IMAGE_QUALITY || "standard";
const concurrency = Math.max(1, Math.min(3, Number(process.env.IMAGE_CONCURRENCY || 3) || 3));

const refs = {
  model:
    process.env.SIMPLE_POSE_MODEL ||
    path.join(path.dirname(ROOT), "Image2网页端测试素材", "02_MODEL_compact_identity_reference.jpg"),
  product:
    process.env.SIMPLE_POSE_PRODUCT ||
    path.join(ROOT, "test_artifacts", "api-smoke", "product-multiview-white-sheet-2026-05-19T00-02-32-476Z.png"),
};

const shots = [
  {
    id: "shoulder-front",
    title: "正面肩背",
    prompt:
      "图一的女性在白棚中背着图二的包。正面全身站姿，包背在右肩，一只手自然扶着肩带。纯白背景，柔和白棚打光，低对比，干净电商模特图。",
  },
  {
    id: "handheld-three-quarter",
    title: "三分之二手提",
    prompt:
      "图一的女性在白棚中拿着图二的包。三分之二全身站姿，身体微微转向镜头，包用短手柄自然手提在身侧。纯白背景，柔和白棚打光，低对比，干净商业棚拍。",
  },
  {
    id: "crossbody-walk",
    title: "斜挎轻走",
    prompt:
      "图一的女性在白棚中斜挎图二的包。全身轻走动姿势，一只脚向前，头部自然摆正，表情放松。纯白背景，柔和均匀的白棚打光，低对比，像真实电商棚拍。",
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

const providerRefs = await prepareProviderReferences(refs);

console.log(
  JSON.stringify(
    {
      mode: "white-studio-simple-pose-test",
      model,
      baseUrlHost: safeHost(baseUrl),
      size,
      quality,
      concurrency,
      plannedProviderCalls: shots.length,
      refs: providerRefs,
    },
    null,
    2
  )
);

const started = Date.now();
const settled = await Promise.allSettled(shots.map(generateShot));
const results = settled.map((item) =>
  item.status === "fulfilled" ? item.value : { ok: false, error: item.reason?.stack || String(item.reason) }
);
const contactSheetPath = await composeContactSheet(results, stamp);
const manifest = {
  ok: results.every((item) => item.ok && item.imageReturned),
  mode: "white-studio-simple-pose-test",
  model,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  concurrency,
  totalMs: Date.now() - started,
  refs: providerRefs,
  contactSheetPath,
  results,
};
const manifestPath = path.join(outDir, `white-studio-simple-pose-test-${stamp}.manifest.json`);
await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ manifestPath, ...manifest }, null, 2));

async function generateShot(shot) {
  const shotStarted = Date.now();
  const prefix = `white-studio-simple-pose-${shot.id}-${stamp}`;
  const rawPath = path.join(outDir, `${prefix}.sse.txt`);
  const jsonPath = path.join(outDir, `${prefix}.json`);
  const imagePath = path.join(outDir, `${prefix}.png`);
  const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
  const clientRequestId = `image2.white_studio_simple.${shot.id}.${crypto.randomUUID()}`;
  await fsp.writeFile(promptPath, shot.prompt);
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
            { type: "input_text", text: shot.prompt },
            toInputImage(providerRefs.model),
            toInputImage(providerRefs.product),
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
      // Keep raw response.
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
    promptChars: shot.prompt.length,
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

async function prepareProviderReferences(inputRefs) {
  const sharp = (await import("sharp")).default;
  const prepared = {};
  for (const [role, filePath] of Object.entries(inputRefs)) {
    const outputPath = path.join(outDir, `white-studio-simple-ref-${role}-${stamp}.jpg`);
    const maxEdge = role === "product" ? 896 : 768;
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
  const tileWidth = 340;
  const tileHeight = 500;
  const gutter = 18;
  const width = ready.length * tileWidth + (ready.length + 1) * gutter;
  const height = tileHeight + gutter * 2;
  const composites = [];
  for (let index = 0; index < ready.length; index += 1) {
    const item = ready[index];
    const tile = await sharp(item.imagePath)
      .resize({ width: tileWidth, height: tileHeight, fit: "cover", position: "center" })
      .composite([{ input: Buffer.from(createLabelSvg(tileWidth, item.title || item.shotId)), left: 0, top: 0 }])
      .png()
      .toBuffer();
    composites.push({ input: tile, left: gutter + index * (tileWidth + gutter), top: gutter });
  }
  const contactSheetPath = path.join(outDir, `white-studio-simple-pose-test-${stampValue}-contact.png`);
  await sharp({
    create: { width, height, channels: 4, background: { r: 248, g: 246, b: 241, alpha: 1 } },
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

function createLabelSvg(width, label) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="48" viewBox="0 0 ${width} 48">
  <rect width="${width}" height="48" fill="rgba(24,22,20,0.62)"/>
  <text x="16" y="31" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="#fff">${escapeXml(label)}</text>
</svg>`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
