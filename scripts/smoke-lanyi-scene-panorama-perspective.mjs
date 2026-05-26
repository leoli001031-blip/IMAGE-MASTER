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
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const sceneId = "lijiang-snow-mountain-panorama";
const sceneName = "Lijiang snow mountain 360 panorama";

fs.mkdirSync(outDir, { recursive: true });

if (args["compose-only"] || args.manifest) {
  const manifestPath = args["compose-only"] || args.manifest;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const outputPath =
    args.out ||
    path.join(
      path.dirname(manifestPath),
      `scene-panorama-spatial-board-${manifest.sceneId || sceneId}-${stamp}.png`
    );
  await composeSpatialBoard({
    panoramaPath: manifest.panorama?.imagePath,
    projectedViews: manifest.projectedViews || [],
    boardPath: outputPath,
  });
  console.log(JSON.stringify({ mode: "scene-panorama-spatial-board-compose", outputPath }, null, 2));
  process.exit(0);
}

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
  "- FRONT/NORTH direction: distant snow mountain and open valley view.",
  "- RIGHT/EAST direction: subtle Naxi-inspired wooden architecture with carved wood, dark roof edge, blue textile curtain.",
  "- BACK/SOUTH direction: stone floor foreground, low terrace wall, entrance/empty walking zone.",
  "- LEFT/WEST direction: pine branches, rough stone block, woven textile cushion.",
  "- CENTER: low dark wood rectangular platform on stone floor, enough empty floor and platform space for a full-body model and product later.",
  "- Props: ceramic tea cup and small tray on platform, one woven cushion near stone, restrained local textile detail. Props should stay consistent and secondary.",
  "- Light: crisp plateau daylight from upper left, stable contact shadows, no rain, no fog, no night scene.",
  "- Commercial use: empty reusable scene asset, no people, no product hero, no readable signage.",
].join("\n");

const panoramaPrompt = [
  "Create one clean 360-degree equirectangular panorama environment image, 2:1 aspect ratio if supported.",
  "This is a seamless panoramic source for later front/back/left/right perspective extraction, not a normal hero photo, not a collage, and not a multi-panel board.",
  "",
  sceneBible,
  "",
  "Panorama layout requirement:",
  "- The CENTER of the panorama should face FRONT/NORTH toward the snow mountain and platform.",
  "- The RIGHT quarter should rotate toward the EAST wooden architecture side.",
  "- The LEFT quarter should rotate toward the WEST pine/stone/textile side.",
  "- The far LEFT and far RIGHT edges should meet as the BACK/SOUTH direction and feel seamless.",
  "- Keep horizon height stable across the panorama and avoid discontinuous object jumps.",
  "",
  "Visual requirement: realistic commercial location scouting panorama, natural wide environment, continuous stone terrace floor, consistent platform position, consistent material family, consistent daylight and shadows, enough empty model/product placement zones.",
  "Negative rules: no people, no mannequins, no product advertising subject, no captions, no labels, no arrows, no dashed boxes, no outlined placement areas, no UI marks, no readable text, no logos, no watermark, no split panels, no collage, no fisheye circle, no impossible room changes.",
].join("\n");

const viewConfigs = [
  {
    id: "front",
    yaw: 0,
    description: "FRONT/NORTH view facing the snow mountain and platform",
  },
  {
    id: "right",
    yaw: 90,
    description: "RIGHT/EAST view facing the Naxi-inspired wooden architecture side",
  },
  {
    id: "back",
    yaw: 180,
    description: "BACK/SOUTH view facing the terrace wall, entrance, and walking zone",
  },
  {
    id: "left",
    yaw: -90,
    description: "LEFT/WEST view facing the pine, rough stone, and textile side",
  },
];

const started = Date.now();
console.log(
  JSON.stringify(
    {
      mode: "scene-panorama-perspective-smoke",
      model,
      baseUrlHost: safeHost(baseUrl),
      panoramaSize,
      perspectiveSize,
      quality,
      sceneId,
      plannedCalls: 1 + viewConfigs.length,
    },
    null,
    2
  )
);

const panorama = await generateImage({
  id: "panorama",
  prompt: panoramaPrompt,
  referencePath: null,
  size: panoramaSize,
});

if (!panorama.imagePath) {
  throw new Error(`Panorama image did not return. See ${panorama.rawPath}`);
}

const projectedViews = await projectPanoramaViews({
  panoramaPath: panorama.imagePath,
  outDir,
  prefix: `scene-panorama-perspective-${sceneId}-${stamp}`,
});

const correctedViews = [];
for (const view of viewConfigs) {
  const projectedPath = projectedViews.find((item) => item.id === view.id)?.imagePath;
  if (!projectedPath) continue;
  const prompt = [
    "Create one clean normal-perspective commercial scene image from the attached panorama projection reference.",
    `View to generate: ${view.description}.`,
    "The attached image is a perspective slice extracted from a 360 panorama. Use it as the environment anchor, but correct panorama/crop distortion into a natural straight-perspective commercial photo.",
    "",
    sceneBible,
    "",
    "Keep the same space identity, material family, daylight direction, floor continuity, platform/pros relationship, and empty model/product placement zones.",
    "Straighten verticals and horizon, remove stretched panorama artifacts, keep the view believable as a 28-35mm commercial location scouting photograph.",
    "Output only one clean photographic view. No people, no mannequins, no captions, no labels, no arrows, no dashed boxes, no outlined placement areas, no UI marks, no readable text, no logos, no watermark, no split panels, no collage.",
  ].join("\n");

  correctedViews.push(
    await generateImage({
      id: `corrected-${view.id}`,
      prompt,
      referencePath: projectedPath,
      size: perspectiveSize,
    })
  );
}

const boardPath = path.join(outDir, `scene-panorama-perspective-board-${sceneId}-${stamp}.png`);
const spatialBoardPath = path.join(outDir, `scene-panorama-spatial-board-${sceneId}-${stamp}.png`);
await composeBoard({
  panoramaPath: panorama.imagePath,
  projectedPaths: projectedViews.map((view) => view.imagePath),
  correctedPaths: correctedViews.map((view) => view.imagePath).filter(Boolean),
  boardPath,
});
await composeSpatialBoard({
  panoramaPath: panorama.imagePath,
  projectedViews,
  boardPath: spatialBoardPath,
});

const manifest = {
  mode: "scene-panorama-perspective-smoke",
  sceneId,
  sceneName,
  model,
  baseUrlHost: safeHost(baseUrl),
  panoramaSize,
  perspectiveSize,
  quality,
  totalMs: Date.now() - started,
  panorama,
  projectedViews,
  correctedViews,
  boardPath,
  spatialBoardPath,
};
const manifestPath = path.join(outDir, `scene-panorama-perspective-${sceneId}-${stamp}.manifest.json`);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ manifestPath, ...manifest }, null, 2));

async function generateImage({ id, prompt, referencePath, size }) {
  const oneStarted = Date.now();
  const prefix = `scene-panorama-perspective-${sceneId}-${id}-${stamp}`;
  const rawPath = path.join(outDir, `${prefix}.sse.txt`);
  const jsonPath = path.join(outDir, `${prefix}.json`);
  const imagePath = path.join(outDir, `${prefix}.png`);
  const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
  const clientRequestId = `image2.scene_panorama.${id}.${crypto.randomUUID()}`;
  fs.writeFileSync(promptPath, prompt);
  console.log(`[${id}] started size=${size}`);

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
    size,
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

async function projectPanoramaViews({ panoramaPath, outDir, prefix }) {
  const projected = [];
  for (const view of viewConfigs) {
    const imagePath = path.join(outDir, `${prefix}-projected-${view.id}.png`);
    await renderPerspectiveFromEquirectangular({
      inputPath: panoramaPath,
      outputPath: imagePath,
      yawDegrees: view.yaw,
      fovDegrees: 90,
      width: 1024,
      height: 768,
    });
    projected.push({
      id: view.id,
      yaw: view.yaw,
      description: view.description,
      imagePath,
    });
  }
  return projected;
}

async function renderPerspectiveFromEquirectangular({
  inputPath,
  outputPath,
  yawDegrees,
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
      const worldX = Math.cos(yaw) * camX + Math.sin(yaw) * camZ;
      const worldY = camY;
      const worldZ = -Math.sin(yaw) * camX + Math.cos(yaw) * camZ;
      const lon = Math.atan2(worldX, worldZ);
      const lat = Math.asin(clamp(worldY, -1, 1));
      const sx = (((lon / (2 * Math.PI)) + 0.5) * srcWidth) % srcWidth;
      const sy = clamp((0.5 - lat / Math.PI) * srcHeight, 0, srcHeight - 1);
      sampleBilinear(src, srcWidth, srcHeight, srcChannels, sx, sy, out, (y * width + x) * 4);
    }
  }

  await sharp(out, {
    raw: {
      width,
      height,
      channels: 4,
    },
  })
    .png()
    .toFile(outputPath);
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

async function composeBoard({ panoramaPath, projectedPaths, correctedPaths, boardPath }) {
  const sharp = (await import("sharp")).default;
  const width = 1600;
  const gutter = 12;
  const panoramaHeight = 800;
  const tileWidth = Math.floor((width - gutter * 5) / 4);
  const tileHeight = 292;
  const height = panoramaHeight + gutter + tileHeight + gutter + tileHeight;
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
  ];

  for (let index = 0; index < Math.min(4, projectedPaths.length); index += 1) {
    composites.push({
      input: await sharp(projectedPaths[index])
        .resize({ width: tileWidth, height: tileHeight, fit: "cover", position: "center" })
        .png()
        .toBuffer(),
      left: gutter + index * (tileWidth + gutter),
      top: panoramaHeight + gutter,
    });
  }

  for (let index = 0; index < Math.min(4, correctedPaths.length); index += 1) {
    composites.push({
      input: await sharp(correctedPaths[index])
        .resize({ width: tileWidth, height: tileHeight, fit: "cover", position: "center" })
        .png()
        .toBuffer(),
      left: gutter + index * (tileWidth + gutter),
      top: panoramaHeight + gutter + tileHeight + gutter,
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
}

async function composeSpatialBoard({ panoramaPath, projectedViews, boardPath }) {
  const sharp = (await import("sharp")).default;
  const width = 1600;
  const gutter = 16;
  const panoramaHeight = 760;
  const bottomHeight = 520;
  const mapWidth = 740;
  const tileWidth = Math.floor((width - mapWidth - gutter * 4) / 2);
  const tileHeight = Math.floor((bottomHeight - gutter * 3) / 2);
  const height = panoramaHeight + gutter + bottomHeight;
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
      input: Buffer.from(createSpatialMapSvg(mapWidth, bottomHeight)),
      left: gutter,
      top: panoramaHeight + gutter,
    },
  ];

  for (let index = 0; index < Math.min(4, projectedViews.length); index += 1) {
    const view = projectedViews[index];
    const col = index % 2;
    const row = Math.floor(index / 2);
    const left = mapWidth + gutter * 2 + col * (tileWidth + gutter);
    const top = panoramaHeight + gutter + row * (tileHeight + gutter);
    const tile = await sharp(view.imagePath)
      .resize({ width: tileWidth, height: tileHeight, fit: "cover", position: "center" })
      .composite([
        {
          input: Buffer.from(createTileLabelSvg(tileWidth, view.id.toUpperCase(), view.description)),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    composites.push({ input: tile, left, top });
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
}

function createSpatialMapSvg(width, height) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" rx="18" fill="#fffdf8"/>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="18" fill="none" stroke="#d8cbbb" stroke-width="2"/>
  <text x="28" y="44" font-family="Inter, Arial, sans-serif" font-size="26" font-weight="700" fill="#2c241c">空间关系约束</text>
  <text x="28" y="75" font-family="Inter, Arial, sans-serif" font-size="15" fill="#776856">全景图负责视觉，下面这张图负责位置关系；后续生成时两者一起作为场景资产。</text>

  <text x="${width / 2}" y="52" font-family="Inter, Arial, sans-serif" font-size="15" font-weight="700" text-anchor="middle" fill="#455b7a">FRONT / NORTH · 雪山与山谷</text>
  <text x="${width - 34}" y="${height / 2}" font-family="Inter, Arial, sans-serif" font-size="15" font-weight="700" text-anchor="end" fill="#7a563f">RIGHT / EAST · 木建筑</text>
  <text x="${width / 2}" y="${height - 26}" font-family="Inter, Arial, sans-serif" font-size="15" font-weight="700" text-anchor="middle" fill="#5f5a52">BACK / SOUTH · 入口与露台墙</text>
  <text x="34" y="${height / 2}" font-family="Inter, Arial, sans-serif" font-size="15" font-weight="700" fill="#49653f">LEFT / WEST · 松树与石块</text>

  <rect x="108" y="108" width="${width - 216}" height="${height - 188}" rx="28" fill="#ede7dc" stroke="#b9aa95" stroke-width="3"/>
  <path d="M132 150 C250 120 490 120 ${width - 132} 150" fill="none" stroke="#9b958d" stroke-width="10" stroke-linecap="round" opacity="0.65"/>
  <text x="${width / 2}" y="143" font-family="Inter, Arial, sans-serif" font-size="14" text-anchor="middle" fill="#6f6a62">低石墙 / terrace edge</text>

  <rect x="${width - 244}" y="150" width="118" height="${height - 280}" rx="16" fill="#8b5f3d" opacity="0.9"/>
  <rect x="${width - 230}" y="170" width="90" height="${height - 320}" rx="12" fill="#45658e" opacity="0.78"/>
  <text x="${width - 185}" y="${height / 2 - 8}" font-family="Inter, Arial, sans-serif" font-size="15" font-weight="700" text-anchor="middle" fill="#fff">建筑</text>
  <text x="${width - 185}" y="${height / 2 + 16}" font-family="Inter, Arial, sans-serif" font-size="12" text-anchor="middle" fill="#fff">blue textile</text>

  <circle cx="158" cy="210" r="46" fill="#5f7b48" opacity="0.78"/>
  <circle cx="116" cy="250" r="34" fill="#4c653b" opacity="0.76"/>
  <rect x="122" y="${height - 188}" width="80" height="52" rx="14" fill="#6e675f"/>
  <ellipse cx="208" cy="${height - 126}" rx="52" ry="18" fill="#b69d74"/>
  <text x="170" y="${height - 210}" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="700" text-anchor="middle" fill="#314323">松树/石块/垫子</text>

  <rect x="${width / 2 - 150}" y="${height / 2 - 62}" width="300" height="124" rx="20" fill="#3f342b"/>
  <rect x="${width / 2 - 130}" y="${height / 2 - 42}" width="260" height="84" rx="14" fill="#5a4636"/>
  <text x="${width / 2}" y="${height / 2 + 5}" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" text-anchor="middle" fill="#fff">中心木平台</text>

  <rect x="${width / 2 - 90}" y="${height / 2 + 84}" width="180" height="68" rx="20" fill="#d4c6ad" stroke="#9f8a6d" stroke-width="2" stroke-dasharray="8 8"/>
  <text x="${width / 2}" y="${height / 2 + 125}" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="700" text-anchor="middle" fill="#6e5738">产品/模特可放区</text>

  <rect x="${width / 2 - 170}" y="${height - 112}" width="340" height="44" rx="18" fill="#d9d1c4" stroke="#b4a795" stroke-width="2"/>
  <text x="${width / 2}" y="${height - 84}" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="700" text-anchor="middle" fill="#63584a">入口/行走动线</text>

  <line x1="${width / 2}" y1="92" x2="${width / 2}" y2="${height - 58}" stroke="#c7b9a6" stroke-width="2" stroke-dasharray="6 8"/>
  <line x1="92" y1="${height / 2}" x2="${width - 92}" y2="${height / 2}" stroke="#c7b9a6" stroke-width="2" stroke-dasharray="6 8"/>
</svg>`;
}

function createTileLabelSvg(width, label, description) {
  const safeLabel = escapeXml(label);
  const safeDescription = escapeXml(description.replace(/^[A-Z/]+ view /i, ""));
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="54" viewBox="0 0 ${width} 54">
  <rect width="${width}" height="54" fill="rgba(20,18,16,0.58)"/>
  <text x="16" y="23" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="#fff">${safeLabel}</text>
  <text x="16" y="43" font-family="Inter, Arial, sans-serif" font-size="12" fill="#efe7dc">${safeDescription}</text>
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
