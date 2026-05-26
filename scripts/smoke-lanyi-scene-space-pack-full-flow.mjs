#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const args = parseArgs(process.argv.slice(2));
const outDir = process.env.OUT_DIR || path.join(process.cwd(), "test_artifacts", "api-smoke");
const panoramaSize = process.env.PANORAMA_SIZE || "1536x768";
const perspectiveSize = process.env.PERSPECTIVE_SIZE || "1024x1024";
const quality = process.env.IMAGE_QUALITY || "standard";
const selectedFace = args.face || "front";
const sceneTheme = args.theme || "lijiang-tea-terrace";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const sceneId = `${sceneTheme}-fresh-space-pack`;

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

const sceneJson = buildSceneJson();
const panoramaPrompt = buildPanoramaPrompt(sceneJson);
const sceneJsonPath = path.join(outDir, `scene-space-full-${sceneId}-${stamp}.json`);
fs.writeFileSync(sceneJsonPath, JSON.stringify(sceneJson, null, 2));

console.log(
  JSON.stringify(
    {
      mode: "scene-space-pack-full-flow",
      model,
      baseUrlHost: safeHost(baseUrl),
      panoramaSize,
      perspectiveSize,
      quality,
      selectedFace,
      sceneId,
      plannedProviderCalls: 2,
    },
    null,
    2
  )
);

const panorama = await generateImage({
  id: "panorama",
  prompt: panoramaPrompt,
  references: [],
  size: panoramaSize,
});

if (!panorama.imagePath) {
  throw new Error(`Panorama image did not return. See ${panorama.rawPath}`);
}

const spatialMapPath = path.join(outDir, `scene-space-full-${sceneId}-${stamp}-spatial-map.png`);
await renderSpatialMap(spatialMapPath, sceneJson);

const cubemapFaces = await projectCubemapFaces({
  panoramaPath: panorama.imagePath,
  outDir,
  prefix: `scene-space-full-${sceneId}-${stamp}`,
});

const face = cubemapFaces.find((item) => item.id === selectedFace) || cubemapFaces[0];
const finalPrompt = buildFinalPrompt({ sceneJson, face });
const finalGeneration = await generateImage({
  id: `final-${face.id}`,
  prompt: finalPrompt,
  references: [
    { path: face.imagePath, mime: inferMime(face.imagePath) },
    { path: spatialMapPath, mime: "image/png" },
  ],
  size: perspectiveSize,
});

const boardPath = path.join(outDir, `scene-space-full-board-${sceneId}-${stamp}.png`);
await composeFullFlowBoard({
  panoramaPath: panorama.imagePath,
  spatialMapPath,
  cubemapFaces,
  finalPath: finalGeneration.imagePath,
  boardPath,
});

const manifest = {
  mode: "scene-space-pack-full-flow",
  sceneId,
  model,
  baseUrlHost: safeHost(baseUrl),
  panoramaSize,
  perspectiveSize,
  quality,
  selectedFace: face.id,
  sceneJsonPath,
  panorama,
  spatialMapPath,
  cubemapFaces,
  finalGeneration,
  boardPath,
};
const manifestPath = path.join(outDir, `scene-space-full-${sceneId}-${stamp}.manifest.json`);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ manifestPath, ...manifest }, null, 2));

async function generateImage({ id, prompt, references, size }) {
  const started = Date.now();
  const prefix = `scene-space-full-${sceneId}-${id}-${stamp}`;
  const rawPath = path.join(outDir, `${prefix}.sse.txt`);
  const jsonPath = path.join(outDir, `${prefix}.json`);
  const imagePath = path.join(outDir, `${prefix}.png`);
  const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
  const clientRequestId = `image2.scene_space_full.${id}.${crypto.randomUUID()}`;
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
  };
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  console.log(`[${id}] done image=${result.imageReturned} status=${result.status} total=${result.totalMs}ms`);
  return result;
}

function buildPanoramaPrompt(scene) {
  return [
    "Create one clean 360-degree equirectangular panorama environment image, 2:1 aspect ratio.",
    "This is a panoramic source for a reusable scene space pack, not a normal hero photo, not a collage, and not a multi-panel board.",
    "",
    "Scene JSON spatial truth:",
    JSON.stringify(scene, null, 2),
    "",
    "Panorama layout requirement:",
    "- The center of the panorama faces FRONT/NORTH toward the distant snow mountain and central platform.",
    "- The right quarter rotates toward RIGHT/EAST wooden architecture.",
    "- The left quarter rotates toward LEFT/WEST pine, stone, and textile props.",
    "- The far left and far right edges should meet as BACK/SOUTH terrace entrance/walking zone.",
    "- Keep horizon height stable and keep the terrace floor continuous across the panorama.",
    "",
    "Visual requirement: realistic commercial location scouting panorama, crisp plateau daylight, continuous stone terrace floor, central dark wooden platform, stable materials, stable anchors, enough empty model/product placement zones.",
    "Negative rules: no people, no mannequins, no product advertising subject, no captions, no labels, no arrows, no dashed boxes, no outlined placement areas, no UI marks, no readable text, no logos, no watermark, no split panels, no collage, no fisheye circle, no impossible room changes.",
  ].join("\n");
}

function buildFinalPrompt({ sceneJson, face }) {
  return [
    "Create one normal-perspective commercial scene plate from this fresh scene space pack.",
    `Selected cubemap face: ${face.id.toUpperCase()} - ${face.description}.`,
    "Input image 1 is the selected cubemap face extracted from the generated panorama.",
    "Input image 2 is a deterministic spatial map that defines object positions and placement zones.",
    "Use the JSON scene specification below as the source of spatial truth. The images provide visual material, lighting, and surface cues.",
    "",
    JSON.stringify(sceneJson, null, 2),
    "",
    "Output requirements:",
    "- One natural commercial scouting photograph, not a collage and not a diagram.",
    "- Keep the selected camera direction and the spatial-map relationships compatible.",
    "- Preserve the terrace material, wooden platform, mountain/architecture/pine anchors, daylight, and empty product/model placement zones.",
    "- Correct panorama distortion into a believable 28-35mm perspective image.",
    "- Leave a clean open zone where a model or product can later be inserted.",
    "- No people, mannequins, text, labels, arrows, guide boxes, watermarks, UI marks, or fake product hero.",
  ].join("\n");
}

function buildSceneJson() {
  return {
    schema: "image-master.scene-space-pack.v1",
    sceneId,
    confidence: "ai_generated_panorama_with_structured_spatial_constraints",
    coordinateSystem: {
      front: "north",
      right: "east",
      back: "south",
      left: "west",
      origin: "center of dark wooden platform",
    },
    mood: "premium outdoor commercial terrace below Jade Dragon Snow Mountain near Lijiang",
    anchors: {
      north_front: ["distant snow mountain", "open valley", "low stone wall"],
      east_right: ["Naxi-inspired wooden architecture", "blue textile curtain", "stone walkway"],
      south_back: ["terrace entrance", "open stone walking zone", "low terrace wall"],
      west_left: ["pine branches", "rough stone block", "woven textile cushion"],
      center: ["dark low wooden platform", "small tea tray", "ceramic cup"],
    },
    placementZones: {
      product: ["center platform", "front stone floor near platform", "small tray area"],
      fullBodyModel: ["open stone floor in front of platform", "right-side walkway near architecture"],
      keepClear: ["snow mountain horizon", "main architecture edge", "pine silhouette"],
    },
    generationRules: [
      "Use scene JSON and spatial map for positions.",
      "Use panorama/cubemap faces for material, light, and visual language.",
      "Do not invent unrelated architecture, weather, room changes, or people.",
      "Correct panorama distortion when creating final normal-perspective outputs.",
    ],
  };
}

async function projectCubemapFaces({ panoramaPath, outDir, prefix }) {
  const faces = [
    { id: "front", yaw: 0, pitch: 0, description: "snow mountain and central platform" },
    { id: "right", yaw: 90, pitch: 0, description: "Naxi-inspired wooden architecture side" },
    { id: "back", yaw: 180, pitch: 0, description: "terrace entrance and walking zone" },
    { id: "left", yaw: -90, pitch: 0, description: "pine, rough stone, and textile side" },
    { id: "up", yaw: 0, pitch: -90, description: "sky, roof edge, and light direction" },
    { id: "down", yaw: 0, pitch: 90, description: "stone floor, platform top, and placement zones" },
  ];
  const outputs = [];
  for (const face of faces) {
    const imagePath = path.join(outDir, `${prefix}-cubemap-${face.id}.png`);
    await renderPerspectiveFromEquirectangular({
      inputPath: panoramaPath,
      outputPath: imagePath,
      yawDegrees: face.yaw,
      pitchDegrees: face.pitch,
      fovDegrees: 90,
      width: 768,
      height: 768,
    });
    outputs.push({ ...face, imagePath });
  }
  return outputs;
}

async function renderPerspectiveFromEquirectangular({
  inputPath,
  outputPath,
  yawDegrees,
  pitchDegrees,
  fovDegrees,
  width,
  height,
}) {
  const sharp = (await import("sharp")).default;
  const source = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const src = source.data;
  const srcWidth = source.info.width;
  const srcHeight = source.info.height;
  const srcChannels = source.info.channels;
  const out = Buffer.alloc(width * height * 4);
  const yaw = (yawDegrees * Math.PI) / 180;
  const pitch = (pitchDegrees * Math.PI) / 180;
  const hFov = (fovDegrees * Math.PI) / 180;
  const vFov = 2 * Math.atan(Math.tan(hFov / 2) * (height / width));

  for (let y = 0; y < height; y += 1) {
    const ny = 1 - (2 * (y + 0.5)) / height;
    const py = Math.tan(vFov / 2) * ny;
    for (let x = 0; x < width; x += 1) {
      const nx = (2 * (x + 0.5)) / width - 1;
      const px = Math.tan(hFov / 2) * nx;
      const len = Math.hypot(px, py, 1);
      const camX = px / len;
      const camY = py / len;
      const camZ = 1 / len;
      const pitchY = Math.cos(pitch) * camY - Math.sin(pitch) * camZ;
      const pitchZ = Math.sin(pitch) * camY + Math.cos(pitch) * camZ;
      const worldX = Math.cos(yaw) * camX + Math.sin(yaw) * pitchZ;
      const worldY = pitchY;
      const worldZ = -Math.sin(yaw) * camX + Math.cos(yaw) * pitchZ;
      const lon = Math.atan2(worldX, worldZ);
      const lat = Math.asin(clamp(worldY, -1, 1));
      const sx = (((lon / (2 * Math.PI)) + 0.5) * srcWidth) % srcWidth;
      const sy = clamp((0.5 - lat / Math.PI) * srcHeight, 0, srcHeight - 1);
      sampleBilinear(src, srcWidth, srcHeight, srcChannels, sx, sy, out, (y * width + x) * 4);
    }
  }

  await sharp(out, { raw: { width, height, channels: 4 } }).png().toFile(outputPath);
}

function sampleBilinear(src, width, height, channels, x, y, out, outIndex) {
  const x0 = Math.floor(x);
  const x1 = (x0 + 1) % width;
  const y0 = Math.floor(y);
  const y1 = Math.min(y0 + 1, height - 1);
  const tx = x - x0;
  const ty = y - y0;
  for (let c = 0; c < 4; c += 1) {
    const v00 = src[(y0 * width + x0) * channels + c] ?? 255;
    const v10 = src[(y0 * width + x1) * channels + c] ?? 255;
    const v01 = src[(y1 * width + x0) * channels + c] ?? 255;
    const v11 = src[(y1 * width + x1) * channels + c] ?? 255;
    const v0 = v00 * (1 - tx) + v10 * tx;
    const v1 = v01 * (1 - tx) + v11 * tx;
    out[outIndex + c] = Math.round(v0 * (1 - ty) + v1 * ty);
  }
}

async function renderSpatialMap(outputPath, scene) {
  const sharp = (await import("sharp")).default;
  await sharp(Buffer.from(createSpatialMapSvg(900, 700, scene))).png().toFile(outputPath);
}

async function composeFullFlowBoard({ panoramaPath, spatialMapPath, cubemapFaces, finalPath, boardPath }) {
  const sharp = (await import("sharp")).default;
  const width = 1800;
  const gutter = 16;
  const panoramaHeight = 650;
  const middleHeight = 610;
  const finalSize = 520;
  const faceSize = Math.floor((width - 900 - finalSize - gutter * 5) / 2);
  const height = panoramaHeight + gutter + middleHeight;
  const background = { r: 248, g: 247, b: 244, alpha: 1 };
  const composites = [
    {
      input: await sharp(panoramaPath)
        .resize({ width, height: panoramaHeight, fit: "cover", position: "center" })
        .png()
        .toBuffer(),
      left: 0,
      top: 0,
    },
    {
      input: await sharp(spatialMapPath)
        .resize({ width: 900, height: middleHeight, fit: "contain", background })
        .png()
        .toBuffer(),
      left: gutter,
      top: panoramaHeight + gutter,
    },
  ];

  for (let index = 0; index < Math.min(4, cubemapFaces.length); index += 1) {
    const face = cubemapFaces[index];
    const col = index % 2;
    const row = Math.floor(index / 2);
    const left = 900 + gutter * 2 + col * (faceSize + gutter);
    const top = panoramaHeight + gutter + row * (faceSize + gutter);
    const tile = await sharp(face.imagePath)
      .resize({ width: faceSize, height: faceSize, fit: "cover", position: "center" })
      .composite([{ input: Buffer.from(createTileLabelSvg(faceSize, face.id.toUpperCase())), left: 0, top: 0 }])
      .png()
      .toBuffer();
    composites.push({ input: tile, left, top });
  }

  if (finalPath) {
    composites.push({
      input: await sharp(finalPath)
        .resize({ width: finalSize, height: finalSize, fit: "cover", position: "center" })
        .composite([{ input: Buffer.from(createTileLabelSvg(finalSize, "FINAL")), left: 0, top: 0 }])
        .png()
        .toBuffer(),
      left: width - finalSize - gutter,
      top: panoramaHeight + gutter,
    });
  }

  await sharp({ create: { width, height, channels: 4, background } })
    .composite(composites)
    .png()
    .toFile(boardPath);
}

function createSpatialMapSvg(width, height) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" rx="22" fill="#fffdf8"/>
  <rect x="2" y="2" width="${width - 4}" height="${height - 4}" rx="22" fill="none" stroke="#d8cbbb" stroke-width="3"/>
  <text x="36" y="54" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="700" fill="#2c241c">Scene Space Map</text>
  <text x="36" y="88" font-family="Inter, Arial, sans-serif" font-size="16" fill="#776856">Fresh full-flow spatial constraint for panorama, cubemap, and final generation.</text>
  <text x="${width / 2}" y="56" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" text-anchor="middle" fill="#455b7a">FRONT / NORTH - snow mountain</text>
  <text x="${width - 42}" y="${height / 2}" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" text-anchor="end" fill="#7a563f">RIGHT / EAST - architecture</text>
  <text x="${width / 2}" y="${height - 30}" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" text-anchor="middle" fill="#5f5a52">BACK / SOUTH - entrance</text>
  <text x="42" y="${height / 2}" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" fill="#49653f">LEFT / WEST - pine</text>
  <rect x="140" y="132" width="${width - 280}" height="${height - 220}" rx="34" fill="#ede7dc" stroke="#b9aa95" stroke-width="4"/>
  <path d="M175 186 C310 146 590 146 ${width - 175} 186" fill="none" stroke="#9b958d" stroke-width="12" stroke-linecap="round" opacity="0.65"/>
  <rect x="${width - 310}" y="202" width="146" height="${height - 385}" rx="20" fill="#8b5f3d"/>
  <rect x="${width - 288}" y="226" width="102" height="${height - 435}" rx="14" fill="#4d6787"/>
  <text x="${width - 237}" y="${height / 2}" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" text-anchor="middle" fill="#fff">architecture</text>
  <circle cx="210" cy="266" r="58" fill="#5f7b48" opacity="0.82"/>
  <circle cx="155" cy="318" r="42" fill="#4c653b" opacity="0.78"/>
  <rect x="170" y="${height - 270}" width="94" height="62" rx="15" fill="#6e675f"/>
  <ellipse cx="268" cy="${height - 194}" rx="64" ry="22" fill="#b69d74"/>
  <rect x="${width / 2 - 188}" y="${height / 2 - 80}" width="376" height="160" rx="25" fill="#3f342b"/>
  <rect x="${width / 2 - 160}" y="${height / 2 - 52}" width="320" height="104" rx="18" fill="#5a4636"/>
  <text x="${width / 2}" y="${height / 2 + 8}" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="700" text-anchor="middle" fill="#fff">central platform</text>
  <rect x="${width / 2 - 116}" y="${height / 2 + 106}" width="232" height="82" rx="22" fill="#d4c6ad" stroke="#9f8a6d" stroke-width="3" stroke-dasharray="10 9"/>
  <text x="${width / 2}" y="${height / 2 + 154}" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" text-anchor="middle" fill="#6e5738">product / model zone</text>
  <rect x="${width / 2 - 210}" y="${height - 145}" width="420" height="54" rx="22" fill="#d9d1c4" stroke="#b4a795" stroke-width="3"/>
  <text x="${width / 2}" y="${height - 111}" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" text-anchor="middle" fill="#63584a">entrance / walking path</text>
  <line x1="${width / 2}" y1="108" x2="${width / 2}" y2="${height - 70}" stroke="#c7b9a6" stroke-width="2" stroke-dasharray="7 9"/>
  <line x1="108" y1="${height / 2}" x2="${width - 108}" y2="${height / 2}" stroke="#c7b9a6" stroke-width="2" stroke-dasharray="7 9"/>
</svg>`;
}

function createTileLabelSvg(width, label) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="48" viewBox="0 0 ${width} 48">
  <rect width="${width}" height="48" fill="rgba(20,18,16,0.58)"/>
  <text x="16" y="31" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="700" fill="#fff">${escapeXml(label)}</text>
</svg>`;
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
