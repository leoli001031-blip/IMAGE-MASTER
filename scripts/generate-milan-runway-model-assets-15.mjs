#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const referencePath = process.env.REFERENCE_IMAGE_PATH ||
  "/Users/lichenhao/.codex/generated_images/019e2782-d290-7bf0-ae3b-37bc98446b59/ig_0210059a4e5f916c016a06155eda00819795bd501fc3196c10.png";
const outDir = process.env.OUT_DIR || path.join(process.cwd(), "test_artifacts", "api-smoke");
const size = process.env.IMAGE_SIZE || "1536x1024";
const quality = process.env.IMAGE_QUALITY || "standard";
const concurrency = Math.max(1, Math.min(20, Number(process.env.IMAGE_CONCURRENCY || 10) || 10));
const registerModels = process.env.REGISTER_MODELS !== "0";

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
    id: "italian-milan-tailoring",
    title: "Italian Milan Sculptural Tailoring Model",
    region: "Italy / Milan",
    gender: "female",
    ethnicity: "european",
    age: 27,
    temperament: "business",
    bodyType: "slim",
    hairStyle: "mid",
    text: "27-year-old adult Italian high-fashion runway model, sculptural cheekbones, deep brunette medium-length hair tucked behind ears, composed Milanese confidence, ivory architectural sleeveless top, charcoal tailored column skirt, black pointed flats. Use case: luxury fashion, premium handbags, jewelry, refined product editorials.",
  },
  {
    id: "eastern-europe-warsaw-couture",
    title: "Eastern Europe Warsaw Couture Model",
    region: "Eastern Europe / Warsaw",
    gender: "female",
    ethnicity: "european",
    age: 24,
    temperament: "cool",
    bodyType: "slim",
    hairStyle: "short",
    text: "24-year-old adult Eastern European high-fashion model, pale neutral complexion, angular oval face, ash-brown short blunt bob, quiet intense gaze, black fine wool turtleneck, bone-white structured trousers, minimal silver ear cuff. Use case: couture lookbook, sharp accessories, gallery-grade fashion imagery.",
  },
  {
    id: "ukrainian-kyiv-editorial",
    title: "Ukrainian Kyiv Editorial Runway Model",
    region: "Ukraine / Kyiv",
    gender: "female",
    ethnicity: "european",
    age: 25,
    temperament: "cool",
    bodyType: "standard",
    hairStyle: "long",
    text: "25-year-old adult Ukrainian editorial runway model, long dark-blonde hair in loose polished waves, clear grey-green gaze, restrained aristocratic expression, pearl-grey satin blouse, black high-waisted wide-leg trousers, slim leather belt. Use case: fashion week editorial, luxury skincare, elevated apparel display.",
  },
  {
    id: "baltic-vilnius-minimal",
    title: "Baltic Vilnius Minimal Runway Model",
    region: "Baltic / Vilnius",
    gender: "female",
    ethnicity: "european",
    age: 23,
    temperament: "intellectual",
    bodyType: "slim",
    hairStyle: "tied",
    text: "23-year-old adult Baltic high-fashion model, translucent fair skin tone, clean oval face, dark ash-blonde hair in a low sleek ponytail, thoughtful reserved expression, slate-blue oversized blazer, white ribbed tank, graphite cigarette trousers. Use case: minimalist fashion, premium eyewear, design objects.",
  },
  {
    id: "french-paris-andro-chic",
    title: "French Paris Andro-Chic Model",
    region: "France / Paris",
    gender: "female",
    ethnicity: "european",
    age: 29,
    temperament: "cool",
    bodyType: "standard",
    hairStyle: "short",
    text: "29-year-old adult French androgynous-chic runway model, short dark pixie crop, elegant narrow face, calm unsmiling gaze, crisp white oversized shirt, black tailored waistcoat, fluid black trousers, small black leather loafers. Use case: gender-fluid styling, luxury fragrance, editorial fashion product sets.",
  },
  {
    id: "dutch-copenhagen-minimal",
    title: "Dutch Copenhagen Minimal Model",
    region: "Netherlands / Copenhagen",
    gender: "female",
    ethnicity: "european",
    age: 26,
    temperament: "intellectual",
    bodyType: "slim",
    hairStyle: "long",
    text: "26-year-old adult Dutch-Nordic minimal runway model, tall spare silhouette, sandy-blonde long straight hair, cool blue-grey eyes, serene practical expression, stone-beige trench vest, white cotton tank, pale grey tailored trousers. Use case: Scandinavian minimal commerce, watches, clean lifestyle fashion.",
  },
  {
    id: "british-london-rebel-tailoring",
    title: "British London Rebel Tailoring Model",
    region: "United Kingdom / London",
    gender: "female",
    ethnicity: "european",
    age: 28,
    temperament: "energetic",
    bodyType: "standard",
    hairStyle: "short",
    text: "28-year-old adult British high-fashion model, copper-brown short textured shag hair, sharp witty expression, cream ribbed knit, black leather-free structured jacket, plaid tailored trousers, polished black ankle boots. Use case: fashion drops, statement accessories, street-luxury editorial.",
  },
  {
    id: "brazil-sao-paulo-runway",
    title: "Brazil Sao Paulo Runway Model",
    region: "Brazil / Sao Paulo",
    gender: "female",
    ethnicity: "european",
    age: 25,
    temperament: "energetic",
    bodyType: "athletic",
    hairStyle: "long",
    text: "25-year-old adult Brazilian high-fashion runway model, warm olive skin tone, long deep-brown hair with glossy movement, strong confident walk-ready expression, ivory silk tank, cocoa tailored trousers, slim gold hoops. Use case: resort fashion, sandals, premium swim-adjacent lifestyle without swimwear.",
  },
  {
    id: "afro-brazilian-luxury",
    title: "Afro-Brazilian Luxury Runway Model",
    region: "Afro-Brazilian / Sao Paulo",
    gender: "female",
    ethnicity: "african",
    age: 30,
    temperament: "business",
    bodyType: "standard",
    hairStyle: "tied",
    text: "30-year-old adult Afro-Brazilian luxury runway model, rich deep-brown skin tone, sculpted natural curls gathered into a refined low puff, elegant powerful gaze, ivory asymmetric blouse, black high-waisted tailored skirt, minimal gold cuff. Use case: luxury beauty, jewelry, high-trust premium campaigns.",
  },
  {
    id: "west-african-paris-milan",
    title: "West African Paris-Milan Editorial Model",
    region: "West Africa / Paris-Milan",
    gender: "female",
    ethnicity: "african",
    age: 26,
    temperament: "cool",
    bodyType: "slim",
    hairStyle: "short",
    text: "26-year-old adult West African high-fashion editorial model, luminous dark skin tone, close-cropped natural hair, long elegant neck, poised direct gaze, black sleeveless mock-neck top, white sculptural wrap skirt, matte silver earrings. Use case: couture editorial, premium cosmetics, sculptural accessory campaigns.",
  },
  {
    id: "east-african-addis-elegance",
    title: "East African Addis Elegance Model",
    region: "East Africa / Addis Ababa",
    gender: "female",
    ethnicity: "african",
    age: 24,
    temperament: "gentle",
    bodyType: "slim",
    hairStyle: "mid",
    text: "24-year-old adult East African high-fashion model, warm brown skin tone, graceful oval face, shoulder-length soft natural coils, calm luminous expression, sand-colored silk blouse, cream wide-leg trousers, small pearl studs. Use case: premium skincare, soft luxury apparel, graceful lifestyle editorials.",
  },
  {
    id: "chinese-shanghai-runway",
    title: "Chinese Shanghai Runway Editorial Model",
    region: "China / Shanghai",
    gender: "female",
    ethnicity: "asian",
    age: 27,
    temperament: "business",
    bodyType: "slim",
    hairStyle: "long",
    text: "27-year-old adult Chinese high-fashion runway model, sleek long black hair center-parted, refined bone structure, composed sharp gaze, ivory sleeveless blouse, black high-waisted floor-length trousers, delicate silver line earrings. Use case: premium Taobao, luxury beauty, modern Chinese commerce editorials.",
  },
  {
    id: "japanese-tokyo-couture-minimal",
    title: "Japanese Tokyo Couture Minimal Model",
    region: "Japan / Tokyo",
    gender: "female",
    ethnicity: "asian",
    age: 25,
    temperament: "intellectual",
    bodyType: "slim",
    hairStyle: "short",
    text: "25-year-old adult Japanese couture-minimal model, precise chin-length black bob with micro fringe, quiet architectural expression, white origami-fold blouse, charcoal straight skirt, small black geometric earrings. Use case: design-forward beauty, stationery, premium home objects, couture-inspired commerce.",
  },
  {
    id: "korean-seoul-runway-beauty",
    title: "Korean Seoul Runway Beauty Model",
    region: "Korea / Seoul",
    gender: "female",
    ethnicity: "asian",
    age: 26,
    temperament: "gentle",
    bodyType: "standard",
    hairStyle: "long",
    text: "26-year-old adult Korean runway beauty model, long espresso-brown soft straight hair, luminous clean complexion, confident gentle expression, pale blue silk shirt, ivory tailored trousers, tiny silver drop earrings. Use case: K-beauty, premium fashion basics, polished social commerce.",
  },
  {
    id: "moroccan-tunisian-mediterranean",
    title: "North African Mediterranean Editorial Model",
    region: "Morocco-Tunisia / Mediterranean",
    gender: "female",
    ethnicity: "african",
    age: 28,
    temperament: "cool",
    bodyType: "standard",
    hairStyle: "mid",
    text: "28-year-old adult North African Mediterranean editorial model, olive-golden skin tone, dark wavy shoulder-length hair, strong almond eyes, elegant composed gaze, sand silk wrap blouse, black tailored trousers, small hammered gold earrings. Use case: fragrance, jewelry, warm luxury resort and Milan editorial campaigns.",
  },
];

console.log(JSON.stringify({
  mode: "milan-runway-high-fashion-model-assets-15",
  model,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  concurrency,
  registerModels,
  referencePath,
  referenceBytes: referenceBuffer.byteLength,
  profiles: profiles.map(({ id, region, title }) => ({ id, region, title })),
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

const registeredModels = registerModels ? registerGeneratedModels(results) : [];
const contactSheetPath = await buildContactSheet(results, stamp);
const manifest = {
  ok: results.every((item) => item.ok && item.imageReturned),
  model,
  baseUrlHost: safeHost(baseUrl),
  size,
  quality,
  concurrency,
  registerModels,
  registeredModels,
  contactSheetPath,
  referencePath,
  referenceBytes: referenceBuffer.byteLength,
  totalMs: Date.now() - started,
  results,
};
const manifestPath = path.join(outDir, `milan-runway-model-assets-15-${stamp}.manifest.json`);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ manifestPath, ...manifest }, null, 2));

async function runProfile(profile) {
  const oneStarted = Date.now();
  const prefix = `milan-runway-model-asset-${profile.id}-${stamp}`;
  const rawPath = path.join(outDir, `${prefix}.sse.txt`);
  const jsonPath = path.join(outDir, `${prefix}.json`);
  const imagePath = path.join(outDir, `${prefix}.png`);
  const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
  const clientRequestId = `image2.milan_runway_model.${profile.id}.${crypto.randomUUID()}`;
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
    region: profile.region,
    title: profile.title,
    profile,
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
    "Professional high-fashion commercial model character reference sheet inspired by Milan Fashion Week casting language.",
    "Output format: 3:2 landscape model card reference sheet, clean editorial grid layout, warm light-gray or soft beige matte neutral background, large-area diffuse reflected daylight, matte ambient wrap, very low contrast, spacious premium runway-casting presentation.",
    "Reference image usage: use the attached reference image only as a visual-system anchor for layout, spacing, multi-angle structure, expression-row structure, and commercial polish. Replace any old white-background studio lighting with diffuse low-contrast model-card lighting. Do not copy the exact person, face, ethnicity, hairstyle, wardrobe, body proportions, or text from the reference image.",
    "Set diversity requirement: this 15-asset set should feel like an international Milan runway casting board. Make every model visibly distinct through origin cue, age impression, face language, hair silhouette, wardrobe baseline, temperament, and commercial use case. Keep cultural cues respectful, non-stereotyped, realistic, and commercially usable.",
    `Identity to create: ${profile.text}`,
    "High-fashion direction: refined bone structure, runway-ready posture, restrained facial expression, luxurious but simple styling, not glamour, not influencer, not celebrity likeness, not overly pretty commercial stock. The model should feel premium, editorial, and useful as a reusable asset for fashion/product image generation.",
    "Layout requirements: Main section with full-body turn-around views: front, 3/4, side, back, neutral standing pose, full body visible, aligned height. Left sidebar: simple model identity panel only, no height ruler, no measurement scale, no dense text. Top right: small color palette swatches matching the wardrobe. Right section: multi-angle head detail shots. Bottom row: neutral, slight smile, serious, thoughtful, confident, soft gaze, profile, warm laugh. Lower right: one large clean close-up portrait.",
    "Commercial constraints: Adult professional model only. Functional commercial model reference, non-sexual, neutral presentation, opaque fabric, high coverage. No product, no brand logo, no selling text, no watermark, no seductive pose, no lingerie styling, no sheer fabric, no cleavage emphasis, no provocative expression. No duplicate limbs, no distorted face, no dense text, no harsh shadows, no exaggerated curves.",
  ].join("\n\n");
}

function registerGeneratedModels(results) {
  const successful = results.filter((item) => item.ok && item.imageReturned && item.imagePath);
  if (successful.length === 0) return [];

  const dbPath = path.join(process.cwd(), ".data", "image-master.db");
  const generatedDir = path.join(process.cwd(), ".data", "generated");
  fs.mkdirSync(generatedDir, { recursive: true });
  const db = new Database(dbPath);
  const now = new Date().toISOString();
  const rows = [];

  const insert = db.prepare(`
    INSERT OR REPLACE INTO models (
      id, gender, ethnicity, age, temperament, bodyType, imageUrl, promptSnapshot, metadata, createdAt, updatedAt
    )
    VALUES (
      @id, @gender, @ethnicity, @age, @temperament, @bodyType, @imageUrl, @promptSnapshot,
      @metadata, @createdAt, @updatedAt
    )
  `);

  const transaction = db.transaction(() => {
    for (const item of successful) {
      const profile = item.profile;
      const id = `model_milan_runway_${profile.id}`;
      const fileName = `${id}-${slugify(profile.title)}.png`;
      const targetPath = path.join(generatedDir, fileName);
      fs.copyFileSync(item.imagePath, targetPath);
      const imageUrl = `/api/generated-images/${fileName}`;
      const metadata = buildModelMetadata(profile, imageUrl, item);
      const row = {
        id,
        gender: profile.gender,
        ethnicity: profile.ethnicity,
        age: profile.age,
        temperament: profile.temperament,
        bodyType: profile.bodyType,
        imageUrl,
        promptSnapshot: fs.readFileSync(item.promptPath, "utf8"),
        metadata: JSON.stringify(metadata),
        createdAt: now,
        updatedAt: now,
      };
      insert.run(row);
      rows.push({
        id,
        title: metadata.autoName.title,
        imageUrl,
        sourceImagePath: item.imagePath,
      });
    }
  });
  transaction();
  return rows;
}

function buildModelMetadata(profile, imageUrl, result) {
  const autoName = buildAutoModelName(profile);
  const bodyProfile = profile.bodyType === "slim"
    ? "tall slim runway frame, elongated clean proportions"
    : profile.bodyType === "athletic"
      ? "toned runway-commercial frame, balanced athletic posture"
      : "balanced runway-commercial frame, natural elegant proportions";
  const profileMetadata = {
    identityRegion: profile.region,
    age: profile.age,
    gender: profile.gender,
    temperament: profile.temperament,
    beautyStyle: "high-fashion runway editorial beauty",
    hair: profile.text.match(/model, ([^,]+ hair[^,]*)/i)?.[1] || profile.hairStyle || "",
    makeup: "clean runway skin, restrained editorial makeup",
    faceAnchors: profile.text,
    marketContext: "Milan Fashion Week inspired international luxury casting",
    bodyProfile,
    wardrobe: profile.text,
  };
  return {
    schemaVersion: 1,
    source: "model-template",
    sourceParams: {
      gender: profile.gender,
      ethnicity: profile.ethnicity,
      age: profile.age,
      temperament: profile.temperament,
      bodyType: profile.bodyType,
      hairStyle: profile.hairStyle,
      makeup: "light",
    },
    autoName,
    profile: profileMetadata,
    identityAnchors: [
      `${profile.age}-year-old adult ${profile.region} ${profile.gender}`,
      profile.text,
      bodyProfile,
    ],
    consistencyRules: [
      "Use the same exact adult model identity across all generated images in the group.",
      "Keep facial features, hairstyle, age impression, body proportions, and runway temperament consistent.",
      "Do not mix this model identity with product, outfit, or scene references.",
    ],
    poseRules: [
      "Use runway-ready but functional commercial model poses.",
      "Prefer neutral standing, light walking, or composed editorial gestures.",
      "Avoid seductive posing, exaggerated body curves, or identity-changing extreme angles.",
    ],
    usageRules: [
      "Suitable for high-fashion product imagery, premium commerce, lookbooks, and editorial social covers.",
      "Treat the model as a reusable person asset; product details should come from product references.",
    ],
    safetyRules: [
      "Adult professional model only.",
      "Non-sexual commercial presentation.",
      "Opaque fabric, high coverage, no lingerie styling, no sheer fabric, no provocative expression.",
    ],
    promptFragments: [
      "Consistent high-fashion adult model identity for commercial imagery.",
      `Model identity: ${profile.text}`,
      "Milan Fashion Week inspired international luxury casting.",
    ],
    constraints: [
      "Keep model identity stable across crops, angles, and later image recipes.",
      "Keep the model identity independent from product texture, brand, logo, and packaging details.",
    ],
    negativeRules: [
      "No celebrity likeness, no brand logos, no readable text, no children, no distorted face or limbs.",
      "Do not change age impression, face identity, hair identity, body profile, or origin cues across reuse.",
    ],
    qualityRules: [
      "Clean refined commercial rendering with soft even studio or scene-appropriate lighting.",
      "Natural skin tone, stable facial identity, coherent anatomy, and clean subject-background separation.",
      "High-fashion presence without overpowering the product objective.",
    ],
    referenceImages: [imageUrl],
    promptSnapshot: fs.readFileSync(result.promptPath, "utf8"),
    provider: {
      mode: "responses-stream-image2",
      responseId: result.responseId,
      clientRequestId: result.clientRequestId,
      generatedAt: new Date().toISOString(),
      sourceImagePath: result.imagePath,
    },
  };
}

function buildAutoModelName(profile) {
  const hairLabel = profile.hairStyle === "short"
    ? "短发"
    : profile.hairStyle === "long"
      ? "长发"
      : profile.hairStyle === "tied"
        ? "低马尾"
        : "中发";
  const temperamentLabel = {
    business: "商务",
    cool: "冷感",
    intellectual: "知性",
    energetic: "锐利",
    gentle: "温柔",
  }[profile.temperament] || "高级";
  const regionLabel = translateRegionLabel(profile.region.split("/")[0].trim());
  return {
    title: `${profile.age}岁${regionLabel}女模特 · ${hairLabel} · ${temperamentLabel}`,
    subtitle: profile.title,
    tags: ["模特", "米兰秀场感", regionLabel, `${profile.age}岁`, hairLabel, temperamentLabel],
    slug: slugify(profile.title),
    source: "auto",
  };
}

function translateRegionLabel(region) {
  const map = {
    Italy: "意大利",
    "Eastern Europe": "东欧",
    Ukraine: "乌克兰",
    Baltic: "波罗的海",
    France: "法国",
    Netherlands: "荷兰北欧",
    "United Kingdom": "英国",
    Brazil: "巴西",
    "Afro-Brazilian": "巴西非裔",
    "West Africa": "西非",
    "East Africa": "东非",
    China: "中国",
    Japan: "日本",
    Korea: "韩国",
    "Morocco-Tunisia": "北非地中海",
  };
  return map[region] || region;
}

async function buildContactSheet(results, stampValue) {
  const images = results.filter((item) => item.imageReturned && item.imagePath).map((item) => item.imagePath);
  if (images.length === 0) return null;
  const contactPath = path.join(outDir, `milan-runway-model-assets-15-${stampValue}-contact.png`);
  const { spawnSync } = await import("node:child_process");
  const montage = spawnSync("montage", [
    ...images,
    "-thumbnail",
    "360x240^",
    "-gravity",
    "center",
    "-extent",
    "360x240",
    "-tile",
    "5x3",
    "-geometry",
    "+8+8",
    contactPath,
  ], { encoding: "utf8" });
  if (montage.status === 0 && fs.existsSync(contactPath)) return contactPath;
  return null;
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

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "model";
}
