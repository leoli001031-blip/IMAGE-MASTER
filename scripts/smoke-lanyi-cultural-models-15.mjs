#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const referencePath = process.env.REFERENCE_IMAGE_PATH ||
  "/Users/lichenhao/.codex/generated_images/019e2782-d290-7bf0-ae3b-37bc98446b59/ig_0210059a4e5f916c016a06155eda00819795bd501fc3196c10.png";
const outDir = process.env.OUT_DIR || path.join(process.cwd(), "test_artifacts", "api-smoke");
const size = process.env.IMAGE_SIZE || "1536x1024";
const quality = process.env.IMAGE_QUALITY || "standard";
const concurrency = Math.max(1, Math.min(20, Number(process.env.IMAGE_CONCURRENCY || 15) || 15));

fs.mkdirSync(outDir, { recursive: true });

const config = readImageConfig();
const apiKey = process.env.LANYI_API_KEY || process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY || config.imageApiKey;
const baseUrl = (process.env.LANYI_BASE_URL || process.env.IMAGE_BASE_URL || config.imageBaseUrl || "https://lanyiapi.com/v1").replace(/\/$/, "");
const model = process.env.IMAGE_MODEL || config.imageModel || "gpt-image-2";
if (!apiKey) throw new Error("Missing image API key in env or app config.");

const referenceBuffer = fs.readFileSync(referencePath);
const referenceDataUrl = `data:${inferMime(referencePath)};base64,${referenceBuffer.toString("base64")}`;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const profiles = [
  {
    id: "cn-shanghai-executive",
    title: "China Shanghai Executive Commerce Model",
    country: "China",
    text: "32-year-old adult Chinese female executive commerce model, shoulder-length glossy black hair, calm confident expression, pearl-white silk blouse under charcoal cropped blazer, graphite tailored trousers, small gold earrings. Use case: premium electronics, business bags, executive skincare, high-trust product detail pages.",
  },
  {
    id: "cn-hangzhou-xhs",
    title: "China Hangzhou Xiaohongshu Lifestyle Model",
    country: "China",
    text: "26-year-old adult Chinese female Xiaohongshu lifestyle model, soft long dark-brown hair with airy layers, warm approachable smile, cream knit top, light apricot midi skirt, delicate hair clip. Use case: beauty, home fragrance, small appliances, warm lifestyle seeding imagery.",
  },
  {
    id: "cn-guangzhou-live",
    title: "China Guangzhou Live Commerce Model",
    country: "China",
    text: "29-year-old adult Chinese female live-commerce display model, neat low ponytail, energetic practical expression, ivory short-sleeve blouse, caramel straight trousers, minimal hoop earrings. Use case: apparel display, live-stream product demonstration, Taobao conversion images.",
  },
  {
    id: "cn-chengdu-home",
    title: "China Chengdu Warm Home Lifestyle Model",
    country: "China",
    text: "31-year-old adult Chinese female warm home-lifestyle model, soft natural black hair loosely tied, gentle relaxed expression, sage green cardigan over white cotton top, warm beige trousers. Use case: home goods, wellness products, cozy lifestyle campaigns.",
  },
  {
    id: "cn-shenzhen-tech",
    title: "China Shenzhen Smart Tech Model",
    country: "China",
    text: "27-year-old adult Chinese female smart-tech commerce model, sleek straight black hair tucked behind ears, clear focused expression, icy grey utility shirt, white structured trousers, minimal silver studs. Use case: smart devices, fitness tech, modern office products.",
  },
  {
    id: "jp-tokyo-minimal",
    title: "Japan Tokyo Minimal DTC Model",
    country: "Japan",
    text: "25-year-old adult Japanese female minimal DTC model, dark-brown chin-length bob with tidy airy fringe, quiet composed expression, oatmeal cardigan over ivory top, navy tapered trousers, soft leather flats. Use case: minimalist beauty, stationery, lifestyle goods.",
  },
  {
    id: "jp-kyoto-craft",
    title: "Japan Kyoto Refined Craft Model",
    country: "Japan",
    text: "34-year-old adult Japanese female refined craft-commerce model, low neat bun, serene mature expression, muted taupe linen jacket, ivory blouse, charcoal long skirt, small ceramic earrings. Use case: artisan products, tea ware, premium home objects, calm editorial catalog.",
  },
  {
    id: "jp-osaka-retail",
    title: "Japan Osaka Friendly Retail Model",
    country: "Japan",
    text: "28-year-old adult Japanese female friendly retail model, medium dark-brown hair with soft outward curl, cheerful approachable smile, pale yellow knit vest over white shirt, navy cropped trousers. Use case: everyday consumer goods, retail campaigns, approachable product display.",
  },
  {
    id: "jp-hokkaido-outdoor",
    title: "Japan Hokkaido Outdoor Natural Model",
    country: "Japan",
    text: "30-year-old adult Japanese female outdoor natural-commerce model, shoulder-length dark hair tied in a loose ponytail, clear fresh expression, light beige technical overshirt, soft moss green pants, clean outdoor sneakers. Use case: outdoor accessories, wellness, travel lifestyle.",
  },
  {
    id: "jp-tokyo-creative",
    title: "Japan Tokyo Creative Social Model",
    country: "Japan",
    text: "24-year-old adult Japanese female creative social-commerce model, short textured black bob, confident playful expression, structured white shirt, ink-blue pleated skirt, small geometric earrings. Use case: design goods, cosmetics, social covers, creative product drops.",
  },
  {
    id: "kr-seoul-clean-beauty",
    title: "Korea Seoul Clean Beauty Model",
    country: "Korea",
    text: "24-year-old adult Korean female clean-beauty model, long chestnut-brown soft waves with airy volume, luminous skin, fresh clearly adult expression, pale-blue shirt tucked into ivory straight trousers, delicate silver earrings. Use case: K-beauty, fashion basics, social commerce.",
  },
  {
    id: "kr-gangnam-premium",
    title: "Korea Gangnam Premium Fashion Model",
    country: "Korea",
    text: "29-year-old adult Korean female premium fashion-commerce model, sleek dark espresso long hair, poised refined expression, black fine-knit top, ivory high-waisted wide-leg trousers, minimal gold necklace. Use case: premium apparel, accessories, elevated beauty campaigns.",
  },
  {
    id: "kr-jeju-wellness",
    title: "Korea Jeju Wellness Resort Model",
    country: "Korea",
    text: "31-year-old adult Korean female wellness resort-commerce model, softly tied dark-brown hair, relaxed warm expression, ivory linen wrap top, soft seafoam trousers, small shell-toned earrings. Use case: wellness, resort lifestyle, skincare, calming seasonal campaigns.",
  },
  {
    id: "kr-busan-active",
    title: "Korea Busan Active Lifestyle Model",
    country: "Korea",
    text: "27-year-old adult Korean female active lifestyle model, dark hair in clean mid ponytail, bright energetic expression, white fitted performance top under light grey zip jacket, navy tapered joggers. Use case: sportswear, fitness accessories, outdoor consumer goods.",
  },
  {
    id: "kr-hongdae-creative",
    title: "Korea Hongdae Creative Social Model",
    country: "Korea",
    text: "25-year-old adult Korean female creative social-commerce model, shoulder-length dark hair with soft natural wave, confident expressive gaze, lavender cropped cardigan over white high-neck top, charcoal skirt or wide trousers. Use case: social content, cosmetics, fashion drops, creator campaigns.",
  },
];

console.log(JSON.stringify({
  mode: "china-japan-korea-cultural-models-15",
  model,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  concurrency,
  referencePath,
  referenceBytes: referenceBuffer.byteLength,
  profiles: profiles.map(({ id, country, title }) => ({ id, country, title })),
}, null, 2));

const started = Date.now();
const results = [];
for (let i = 0; i < profiles.length; i += concurrency) {
  const chunk = profiles.slice(i, i + concurrency);
  const settled = await Promise.allSettled(chunk.map(runProfile));
  for (const item of settled) {
    results.push(item.status === "fulfilled" ? item.value : { ok: false, error: item.reason?.stack || String(item.reason) });
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
const manifestPath = path.join(outDir, `cjk-model-assets-15-${stamp}.manifest.json`);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ manifestPath, ...manifest }, null, 2));

async function runProfile(profile) {
  const oneStarted = Date.now();
  const prefix = `cjk-model-asset-${profile.id}-${stamp}`;
  const rawPath = path.join(outDir, `${prefix}.sse.txt`);
  const jsonPath = path.join(outDir, `${prefix}.json`);
  const imagePath = path.join(outDir, `${prefix}.png`);
  const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
  const clientRequestId = `image2.cjk_model.${profile.id}.${crypto.randomUUID()}`;
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

  const reader = response.body?.getReader();
  let raw = "";
  let firstChunkMs = null;
  let lastChunkMs = null;
  let bytes = 0;
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
      console.log(`[${profile.id}] first chunk ${elapsed}ms`);
    }
  }

  fs.writeFileSync(rawPath, raw);
  const events = parseSse(raw);
  const eventCounts = {};
  let responseId = null;
  let imageBase64 = null;
  for (const item of events) {
    if (item.event) eventCounts[item.event] = (eventCounts[item.event] || 0) + 1;
    if (!responseId && item.json?.response?.id) responseId = item.json.response.id;
    if (!responseId && typeof item.json?.id === "string" && item.json.id.startsWith("resp_")) responseId = item.json.id;
    imageBase64 ||= findBase64(item.json);
  }

  if (imageBase64) fs.writeFileSync(imagePath, Buffer.from(imageBase64, "base64"));

  const result = {
    ok: response.ok,
    status: response.status,
    profileId: profile.id,
    country: profile.country,
    title: profile.title,
    clientRequestId,
    responseId,
    promptChars: prompt.length,
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
  console.log(`[${profile.id}] done image=${result.imageReturned} status=${result.status} total=${result.totalMs}ms`);
  return result;
}

function buildPrompt(profile) {
  return [
    "Professional commercial model character reference sheet.",
    "Output format: 3:2 landscape model card reference sheet, clean editorial grid layout, warm light-gray or soft beige matte neutral background, large-area diffuse reflected daylight, matte ambient wrap, very low contrast, spacious high-end commercial presentation.",
    "Reference image usage: use the attached reference image only as a visual-system anchor for layout, spacing, multi-angle structure, expression-row structure, and commercial polish. Replace any old white-background studio lighting with diffuse low-contrast model-card lighting. Do not copy the exact person, face, ethnicity, hairstyle, wardrobe, body proportions, or text from the reference image.",
    "Cultural diversity requirement: every model in this 15-asset set must be visibly distinct through city or scenario, age impression, face language, hair silhouette, wardrobe baseline, temperament, and commercial use case. Keep cultural cues respectful, non-stereotyped, realistic, and commercially usable.",
    `Identity to create: ${profile.text}`,
    "Layout requirements: Main section with full-body turn-around views: front, 3/4, side, back, neutral standing pose, full body visible, aligned height. Left sidebar: simple model identity panel only, no height ruler, no measurement scale, no dense text. Top right: small color palette swatches matching the wardrobe. Right section: multi-angle head detail shots. Bottom row: neutral, happy, surprised, thoughtful, confident, gentle smile, serious, warm laugh. Lower right: one large clean close-up portrait.",
    "Commercial constraints: Adult professional model only. Functional commercial model reference, non-sexual, neutral presentation, opaque fabric, high coverage. No product, no brand logo, no selling text, no watermark, no seductive pose, no lingerie styling, no sheer fabric, no cleavage emphasis, no provocative expression. No duplicate limbs, no distorted face, no dense text, no harsh shadows, no exaggerated curves.",
  ].join("\n\n");
}

function readImageConfig() {
  const dbPath = path.join(process.cwd(), ".data", "image-master.db");
  if (!fs.existsSync(dbPath)) return {};
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare("SELECT key, value FROM config").all();
  return Object.fromEntries(rows.map(({ key, value }) => [key, value]));
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
