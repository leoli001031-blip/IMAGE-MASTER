#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

const ROOT = process.cwd();
const outDir = process.env.OUT_DIR || path.join(ROOT, "test_artifacts", "api-smoke");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const size = process.env.IMAGE_SIZE || "1024x1536";
const quality = process.env.IMAGE_QUALITY || "standard";
const concurrency = Math.max(1, Math.min(6, Number(process.env.IMAGE_CONCURRENCY || 6) || 6));
const shouldCompressReferences = process.env.WHITE_STUDIO_COMPRESS !== "0";
const shouldCreateCutouts = process.env.WHITE_STUDIO_CUTOUT === "1";

const refs = {
  product:
    process.env.WHITE_STUDIO_PRODUCT ||
    path.join(ROOT, "test_artifacts", "api-smoke", "product-multiview-white-sheet-2026-05-19T00-02-32-476Z.png"),
  compactModel:
    process.env.WHITE_STUDIO_MODEL ||
    path.join(path.dirname(ROOT), "Image2网页端测试素材", "02_MODEL_compact_identity_reference.jpg"),
};

const shots = [
  {
    id: "front-handle-standing",
    title: "正面手提",
    direction:
      "Full-body front standing pose, shoulders relaxed, model holds the handbag by the short handle at thigh height, product clearly visible, clean catalog posture.",
  },
  {
    id: "three-quarter-shoulder",
    title: "三分之二肩背",
    direction:
      "Full-body three-quarter pose, handbag worn on one shoulder, one hand lightly touches the strap, face turned gently toward camera, elegant commercial posture.",
  },
  {
    id: "side-profile-crossbody",
    title: "侧身斜挎",
    direction:
      "Full-body side-profile or slight side pose, handbag worn crossbody or on forearm, clear side view of body and bag, natural walking-ready stance.",
  },
  {
    id: "walking-step",
    title: "轻走动",
    direction:
      "Full-body subtle walking step, one foot forward, handbag on forearm, body posture natural but still sharp and centered for product cutout use.",
  },
  {
    id: "seated-stool",
    title: "高凳坐姿",
    direction:
      "Model seated on a very simple minimal white studio stool, handbag on lap and held by one hand, clean seated commercial product pose, stool may remain minimal.",
  },
  {
    id: "waist-product-focus",
    title: "中近景展示",
    direction:
      "Knee-up or three-quarter crop, handbag presented at waist height with both product and face clear, calm premium ecommerce cover pose.",
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
      mode: "white-studio-cutout-set",
      model,
      baseUrlHost: safeHost(baseUrl),
      size,
      quality,
      concurrency,
      plannedProviderCalls: shots.length,
      compressedReferences: shouldCompressReferences,
      createCutouts: shouldCreateCutouts,
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

const contactSheetPath = await composeContactSheet(results, stamp, "original");
const cutoutContactSheetPath = shouldCreateCutouts ? await composeContactSheet(results, stamp, "cutout") : null;
const manifest = {
  ok: results.every((item) => item.ok && item.imageReturned && item.cutoutPath),
  mode: "white-studio-cutout-set",
  model,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  concurrency,
  plannedProviderCalls: shots.length,
  compressedReferences: shouldCompressReferences,
  createCutouts: shouldCreateCutouts,
  totalMs: Date.now() - started,
  refs: providerRefs,
  contactSheetPath,
  cutoutContactSheetPath,
  results,
};
const manifestPath = path.join(outDir, `white-studio-cutout-set-${stamp}.manifest.json`);
await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ manifestPath, ...manifest }, null, 2));

async function generateShot(shot) {
  const shotStarted = Date.now();
  const prefix = `white-studio-cutout-${shot.id}-${stamp}`;
  const rawPath = path.join(outDir, `${prefix}.sse.txt`);
  const jsonPath = path.join(outDir, `${prefix}.json`);
  const imagePath = path.join(outDir, `${prefix}.png`);
  const cutoutPath = shouldCreateCutouts ? path.join(outDir, `${prefix}-cutout.png`) : null;
  const cutoutPreviewPath = shouldCreateCutouts ? path.join(outDir, `${prefix}-cutout-preview.png`) : null;
  const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
  const prompt = buildPrompt(shot);
  const clientRequestId = `image2.white_studio_cutout.${shot.id}.${crypto.randomUUID()}`;
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

  if (imageBase64) {
    await fsp.writeFile(imagePath, Buffer.from(imageBase64, "base64"));
    if (shouldCreateCutouts) await removeWhiteBackground(imagePath, cutoutPath, cutoutPreviewPath);
  }

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
    cutoutPath: imageBase64 && cutoutPath && fs.existsSync(cutoutPath) ? cutoutPath : null,
    cutoutPreviewPath: imageBase64 && cutoutPreviewPath && fs.existsSync(cutoutPreviewPath) ? cutoutPreviewPath : null,
    rawPath,
    promptPath,
    rawPreview: imageBase64 ? undefined : raw.text.slice(0, 1200),
  };
  await fsp.writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`[${shot.id}] done image=${result.imageReturned} cutout=${Boolean(result.cutoutPath)} status=${result.status} total=${result.totalMs}ms`);
  return result;
}

function buildPrompt(shot) {
  return [
    "Create a clean white-studio ecommerce fashion photograph.",
    "",
    "Use Image 1 as the handbag reference. Keep the handbag recognizable: taupe leather, soft rectangular body, top handle, shoulder strap, zipper, stitching, metal hardware, and similar scale.",
    "",
    "Use Image 2 as the reference for this specific woman. Keep her recognizable facial identity, hairstyle, body proportion, age impression, and natural commercial look. Do not copy the exact head tilt, expression, pose, or reference-card framing from Image 2; the pose should follow the shot direction below.",
    "",
    "Plain white studio background. No room, no lifestyle scene, no props, no furniture, no visible set wall, no floor texture, no background gradient.",
    "",
    "Wardrobe: simple neutral studio styling that separates from the white background, such as a grey knit top, taupe or charcoal tailored trousers, and minimal neutral shoes.",
    "",
    `Shot direction: ${shot.direction}`,
    "",
    "Let the model use a natural head position and relaxed expression appropriate to the pose. Keep the body balanced and believable. Lighting should be soft white studio light with low contrast and natural skin texture.",
    "",
    "Avoid: repeated head tilt, copied reference-card pose, changed handbag, extra bags, awkward hands, distorted arms, model-card layout, text, watermark, background objects, colored background, heavy shadow, cropped-off feet unless the shot direction says knee-up.",
  ].join("\n");
}

async function prepareProviderReferences(inputRefs) {
  const sharp = (await import("sharp")).default;
  const prepared = {};
  for (const [role, filePath] of Object.entries(inputRefs)) {
    const outputPath = path.join(outDir, `white-studio-ref-${role}-${stamp}.jpg`);
    const maxEdge = role === "product" ? 896 : 768;
    await sharp(filePath)
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: role === "product" ? 88 : 84, mozjpeg: true })
      .toFile(outputPath);
    prepared[role] = outputPath;
  }
  return prepared;
}

async function removeWhiteBackground(inputPath, outputPath, previewPath) {
  const script = `
import sys
from collections import deque
from PIL import Image, ImageFilter

inp, outp, prev = sys.argv[1:4]
img = Image.open(inp).convert("RGBA")
w, h = img.size
pix = img.load()

def is_bg(px):
    r, g, b, a = px
    if a == 0:
        return True
    # Connected near-white/off-white background only. Flood-fill prevents
    # internal highlights from being erased.
    return r >= 232 and g >= 232 and b >= 228 and (max(r, g, b) - min(r, g, b)) <= 34

visited = bytearray(w * h)
q = deque()

def push(x, y):
    if 0 <= x < w and 0 <= y < h:
        idx = y * w + x
        if not visited[idx] and is_bg(pix[x, y]):
            visited[idx] = 1
            q.append((x, y))

for x in range(w):
    push(x, 0)
    push(x, h - 1)
for y in range(h):
    push(0, y)
    push(w - 1, y)

while q:
    x, y = q.popleft()
    push(x + 1, y)
    push(x - 1, y)
    push(x, y + 1)
    push(x, y - 1)

mask = Image.new("L", (w, h), 255)
mp = mask.load()
for y in range(h):
    row = y * w
    for x in range(w):
        if visited[row + x]:
            mp[x, y] = 0

# Slightly contract the foreground edge into the subject, then feather a little.
mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.45))
img.putalpha(mask)
img.save(outp)

checker = Image.new("RGBA", (w, h), (245, 245, 245, 255))
tile = 32
cp = checker.load()
for yy in range(h):
    for xx in range(w):
        if ((xx // tile) + (yy // tile)) % 2:
            cp[xx, yy] = (222, 222, 222, 255)
checker.alpha_composite(img)
checker.save(prev)
`;
  const result = spawnSync("python3", ["-", inputPath, outputPath, previewPath], {
    input: script,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`Background removal failed for ${inputPath}: ${result.stderr || result.stdout}`);
  }
}

async function composeContactSheet(results, stampValue, kind) {
  const sharp = (await import("sharp")).default;
  const key = kind === "cutout" ? "cutoutPreviewPath" : "imagePath";
  const ready = results.filter((item) => item.imageReturned && item[key]);
  if (ready.length === 0) return null;

  const tileWidth = 320;
  const tileHeight = 480;
  const cols = 3;
  const rows = Math.ceil(ready.length / cols);
  const gutter = 18;
  const width = cols * tileWidth + (cols + 1) * gutter;
  const height = rows * tileHeight + (rows + 1) * gutter;
  const composites = [];

  for (let index = 0; index < ready.length; index += 1) {
    const item = ready[index];
    const tile = await sharp(item[key])
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

  const contactSheetPath = path.join(outDir, `white-studio-cutout-set-${stampValue}-${kind}-contact.png`);
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
