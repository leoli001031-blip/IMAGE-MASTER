#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const args = parseArgs(process.argv.slice(2));
const outDir = process.env.OUT_DIR || path.join(process.cwd(), "test_artifacts", "api-smoke");
const mainSize = process.env.MAIN_IMAGE_SIZE || "1536x1024";
const angleSize = process.env.ANGLE_IMAGE_SIZE || "1024x1024";
const quality = process.env.IMAGE_QUALITY || "standard";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const sceneId = args.scene || "nordic-home-interior-angle-set";

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

const sceneBrief = {
  schema: "image-master.scene-angle-set.v1",
  sceneId,
  title: "北欧风家居室内多角度场景",
  purpose: "Provide a visually coherent set of candidate scene references for a planning agent to choose from.",
  visualLanguage: [
    "Nordic home interior",
    "soft daylight",
    "warm oak floor",
    "linen sofa",
    "light neutral walls",
    "minimal decor",
    "commercial lifestyle photography",
  ],
  plannerGuidance: [
    "Use the main image as the scene identity anchor.",
    "Choose a candidate angle based on product scale, model pose, channel ratio, and composition needs.",
    "Do not require strict 3D consistency; treat candidates as a coherent visual family.",
  ],
};

const mainPrompt = [
  "Create one large clean commercial scene asset image, not a collage and not a multi-panel reference board.",
  "Scene: a premium Nordic / Scandinavian home interior living room for later product or model image generation.",
  "",
  "Visual direction:",
  "- Wide horizontal 3:2 interior view, natural eye-level commercial photography.",
  "- Soft daylight from a large window, light neutral walls, warm oak floor, linen sofa, low coffee table, simple shelving or console, subtle plants, ceramic vase, woven texture, and a small rug.",
  "- The scene should be immediately understandable, calm, premium, and usable as a reference image.",
  "- Keep the room airy and uncluttered, with enough visual breathing room for future product or model composition.",
  "",
  "Avoid: people, mannequins, product hero already inserted, readable text, labels, arrows, dashed boxes, outlined placement areas, UI marks, watermarks, brand logos, heavy clutter, surreal geometry, broken perspective.",
].join("\n");

const angleRequests = [
  {
    id: "wide-alt",
    title: "宽景备选",
    plannerUse: "Good for hero images, poster background, and products needing negative space.",
    prompt:
      "Create an alternate wide commercial angle of the same Nordic living room visual family. Make it feel like another camera position in the same styled home: more of the sofa, window light, oak floor, and wall negative space. Do not copy the exact main image composition.",
  },
  {
    id: "table-surface",
    title: "桌面近景",
    plannerUse: "Good for small products, home goods, beauty products, cups, candles, books, and tabletop placement.",
    prompt:
      "Create a closer commercial angle around the coffee table and sofa area in the same Nordic living room visual family. Keep soft daylight, oak/linen/ceramic texture, and enough table or floor surface for later product composition. Do not insert any product.",
  },
  {
    id: "model-lifestyle",
    title: "生活方式角度",
    plannerUse: "Good for model lifestyle composites, sitting/standing poses, apparel-adjacent products, and human-scale context.",
    prompt:
      "Create a lifestyle-friendly angle of the same Nordic living room visual family, with sofa, window, wall, and open walking area visible. Leave believable room for a future model to sit or stand, but do not include a person.",
  },
  {
    id: "detail-corner",
    title: "材质细节角度",
    plannerUse: "Good for close mood references, material continuity, premium texture, and small scene inserts.",
    prompt:
      "Create a refined detail corner angle in the same Nordic living room visual family, showing warm oak, linen, ceramic, woven rug, plant, and soft window light. It should feel like a useful texture/mood angle, not a new room.",
  },
];

console.log(
  JSON.stringify(
    {
      mode: "scene-angle-set-smoke",
      model,
      baseUrlHost: safeHost(baseUrl),
      mainSize,
      angleSize,
      quality,
      sceneId,
      plannedProviderCalls: 1 + angleRequests.length,
    },
    null,
    2
  )
);

const main = await generateImage({
  id: "main",
  prompt: mainPrompt,
  references: [],
  size: mainSize,
});

if (!main.imagePath) {
  throw new Error(`Main scene image did not return. See ${main.rawPath}`);
}

const angles = [];
for (const angle of angleRequests) {
  const prompt = [
    "Create one scene candidate image based on the attached main scene reference.",
    "Use the attached image as the visual family anchor: same Nordic room language, palette, daylight, materials, calm premium styling, and commercial photography polish.",
    "This is a candidate angle for a planning agent to choose from. It does not need to be a strict 3D rotation; it should feel like the same styled scene family and be useful for image generation.",
    "",
    `Candidate goal: ${angle.title}.`,
    angle.prompt,
    "",
    "Avoid: people, mannequins, product hero already inserted, readable text, labels, arrows, dashed boxes, outlined placement areas, UI marks, watermarks, brand logos, heavy clutter, surreal geometry, broken perspective.",
  ].join("\n");

  angles.push(
    await generateImage({
      id: angle.id,
      prompt,
      references: [{ path: main.imagePath, mime: inferMime(main.imagePath) }],
      size: angleSize,
      extra: angle,
    })
  );
}

const plannerCandidates = {
  schema: "image-master.scene-angle-set-candidates.v1",
  sceneBrief,
  main: {
    id: "main",
    title: "主场景大图",
    imagePath: main.imagePath,
    role: "identity_anchor",
    plannerUse: "Use as the overall scene identity and safest default reference.",
  },
  candidates: angles.map((result) => ({
    id: result.id,
    title: result.extra?.title,
    imagePath: result.imagePath,
    role: "candidate_angle",
    plannerUse: result.extra?.plannerUse,
    status: result.imageReturned ? "ready" : "failed",
  })),
};

const candidatesPath = path.join(outDir, `scene-angle-set-${sceneId}-${stamp}.candidates.json`);
fs.writeFileSync(candidatesPath, JSON.stringify(plannerCandidates, null, 2));

const boardPath = path.join(outDir, `scene-angle-set-board-${sceneId}-${stamp}.png`);
await composeBoard({
  mainPath: main.imagePath,
  angles,
  boardPath,
});

const manifest = {
  mode: "scene-angle-set-smoke",
  sceneId,
  model,
  baseUrlHost: safeHost(baseUrl),
  mainSize,
  angleSize,
  quality,
  sceneBrief,
  main,
  angles,
  candidatesPath,
  boardPath,
};
const manifestPath = path.join(outDir, `scene-angle-set-${sceneId}-${stamp}.manifest.json`);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ manifestPath, ...manifest }, null, 2));

async function generateImage({ id, prompt, references, size, extra }) {
  const started = Date.now();
  const prefix = `scene-angle-set-${sceneId}-${id}-${stamp}`;
  const rawPath = path.join(outDir, `${prefix}.sse.txt`);
  const jsonPath = path.join(outDir, `${prefix}.json`);
  const imagePath = path.join(outDir, `${prefix}.png`);
  const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
  const clientRequestId = `image2.scene_angle_set.${id}.${crypto.randomUUID()}`;
  fs.writeFileSync(promptPath, prompt);
  console.log(`[${id}] started size=${size}`);

  const content = [{ type: "input_text", text: prompt }];
  const referenceSummaries = [];
  for (const reference of references) {
    const buffer = fs.readFileSync(reference.path);
    referenceSummaries.push({ path: reference.path, bytes: buffer.byteLength });
    content.push({
      type: "input_image",
      image_url: `data:${reference.mime};base64,${buffer.toString("base64")}`,
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
    const elapsed = Date.now() - started;
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
    size,
    promptChars: prompt.length,
    references: referenceSummaries,
    firstChunkMs,
    lastChunkMs,
    totalMs: Date.now() - started,
    bytes,
    eventCounts,
    imageReturned: Boolean(imageBase64),
    imagePath: imageBase64 ? imagePath : null,
    rawPath,
    promptPath,
    rawPreview: imageBase64 ? undefined : raw.slice(0, 1200),
    extra,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  console.log(`[${id}] done image=${result.imageReturned} status=${result.status} total=${result.totalMs}ms`);
  return result;
}

async function composeBoard({ mainPath, angles, boardPath }) {
  const sharp = (await import("sharp")).default;
  const width = 1800;
  const gutter = 16;
  const mainHeight = 760;
  const tileWidth = Math.floor((width - gutter * 5) / 4);
  const tileHeight = 360;
  const height = mainHeight + gutter + tileHeight;
  const background = { r: 248, g: 247, b: 244, alpha: 1 };
  const composites = [
    {
      input: await sharp(mainPath)
        .resize({ width, height: mainHeight, fit: "cover", position: "center" })
        .composite([{ input: Buffer.from(createTileLabelSvg(width, "MAIN SCENE")), left: 0, top: 0 }])
        .png()
        .toBuffer(),
      left: 0,
      top: 0,
    },
  ];

  for (let index = 0; index < Math.min(4, angles.length); index += 1) {
    const angle = angles[index];
    if (!angle.imagePath) continue;
    const tile = await sharp(angle.imagePath)
      .resize({ width: tileWidth, height: tileHeight, fit: "cover", position: "center" })
      .composite([
        {
          input: Buffer.from(createTileLabelSvg(tileWidth, angle.extra?.title || angle.id)),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    composites.push({
      input: tile,
      left: gutter + index * (tileWidth + gutter),
      top: mainHeight + gutter,
    });
  }

  await sharp({ create: { width, height, channels: 4, background } })
    .composite(composites)
    .png()
    .toFile(boardPath);
}

function createTileLabelSvg(width, label) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="54" viewBox="0 0 ${width} 54">
  <rect width="${width}" height="54" fill="rgba(20,18,16,0.58)"/>
  <text x="18" y="35" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="700" fill="#fff">${escapeXml(label)}</text>
</svg>`;
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
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
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

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
