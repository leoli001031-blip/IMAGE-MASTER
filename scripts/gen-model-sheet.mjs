import { writeFileSync } from "fs";
import { randomUUID } from "crypto";

const API_KEY = process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY;
const BASE_URL = process.env.IMAGE_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const MODEL = process.env.IMAGE_MODEL || "gpt-image-2";

if (!API_KEY) {
  console.error("Missing IMAGE_API_KEY or OPENAI_API_KEY. Refusing to run model-sheet generation without an explicit key.");
  process.exit(1);
}

const params = {
  gender: "female",
  ethnicity: "asian",
  age: 25,
  temperament: "intellectual",
  bodyType: "slim",
  hairStyle: "long",
  makeup: "natural",
};

// Build the same prompt as our updated function
const TEMPERAMENT_MAP = {
  intellectual: "intellectual elegant",
  energetic: "energetic vibrant",
  gentle: "gentle warm",
  business: "professional business",
  cool: "cool contemporary",
};
const ETHNICITY_MAP = { asian: "Asian", european: "European", african: "African" };
const BODY_TYPE_MAP = { slim: "slim", standard: "standard", athletic: "athletic" };
const HAIR_MAP = { long: "long hair", short: "short hair", mid: "medium-length hair", tied: "hair tied up" };
const MAKEUP_MAP = { natural: "natural no-makeup look, fresh clean skin", light: "light elegant makeup, subtle enhancement" };

const temperament = TEMPERAMENT_MAP[params.temperament] || params.temperament;
const ethnicity = ETHNICITY_MAP[params.ethnicity] || params.ethnicity;
const bodyType = BODY_TYPE_MAP[params.bodyType] || params.bodyType;
const hair = params.hairStyle ? HAIR_MAP[params.hairStyle] || params.hairStyle : "";
const makeup = params.makeup ? MAKEUP_MAP[params.makeup] || params.makeup : "clean natural makeup";

const characterDesc = [
  `${ethnicity} ${params.gender}`,
  `age ${params.age}`,
  `${temperament} look`,
  `${bodyType} build`,
  hair,
  makeup,
].filter(Boolean).join(", ");

const prompt = [
  `Professional character design reference sheet, 4:3 landscape aspect ratio,`,
  `warm light-gray or soft beige matte neutral background, organized grid layout with clear panels,`,
  `Main section: full-body turn-around views (front view, 3/4 view, side profile, rear view),`,
  `neutral standing pose, consistent large-area diffuse reflected daylight across all angles.`,
  `Left sidebar: model identity info panel with scale bar for height reference.`,
  `Top right corner: color palette swatches, 6-8 colors representing skin tone, hair, and wardrobe palette.`,
  `Emotion row: 8-frame emotion progression (neutral, happy, surprised, thoughtful, confident, gentle smile, serious, warm laugh).`,
  `Micro-expressions row: 5 frames showing subtle expression variations.`,
  `Head detail section: multi-angle head shots in a row (front, 3/4 left, 3/4 right, side left, side right).`,
  `Pose variations: 3-4 casual standing poses showing natural body language.`,
  `Close-up section: one detailed close-up portrait with natural expression.`,
  `Bottom row: clothing and accessory detail shots (hair texture close-up, fabric and collar detail, shoes, accessories, hand close-up showing gesture).`,
  `Hand gestures reference: multiple hand poses (open palm, pointing, relaxed, holding object).`,
  `Character silhouette guide: full-body silhouette outline at bottom corner.`,
  `Model: ${characterDesc}.`,
  `Same person, consistent facial identity and body proportions across ALL panels and angles.`,
  `Image quality: clean and crisp rendering, natural skin texture, smooth and uniform materials,`,
  `clear subject-background separation, matte ambient wrap, very low contrast diffuse lighting,`,
  `avoid over-sharpening, color noise, artifacts, grain, distortion, deformities.`,
].join(" ");

console.log("Generating character sheet...");
console.log("Prompt length:", prompt.length);

// Step 1: Generate base portrait
async function step1() {
  console.log("\nStep 1: Generate base portrait...");
  const res = await fetch(`${BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      prompt: `${characterDesc}. Clean commercial model-card portrait seed, front-facing half-body, warm light-gray matte neutral background, large-area diffuse reflected daylight, very low contrast, photorealistic, high quality.`,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Step 1 failed:", res.status, err.substring(0, 300));
    process.exit(1);
  }

  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    console.error("Step 1: no image returned");
    process.exit(1);
  }

  writeFileSync("/tmp/base_portrait_v2.png", Buffer.from(b64, "base64"));
  console.log("Base portrait saved to /tmp/base_portrait_v2.png");
  return b64;
}

// Step 2: Try direct generation first (no reference)
async function step2Direct() {
  console.log("\nStep 2: Generate character sheet via /images/generations...");

  const res = await fetch(`${BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      prompt: prompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    }),
    signal: AbortSignal.timeout(180000),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Step 2 direct failed:", res.status, err.substring(0, 500));
    return null;
  }

  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (b64) {
    writeFileSync("/tmp/model_sheet_v2.png", Buffer.from(b64, "base64"));
    console.log("Character sheet saved to /tmp/model_sheet_v2.png, size:", Buffer.from(b64, "base64").length, "bytes");
    return b64;
  }
  console.log("No b64 in response, checking url...");
  return null;
}

// Step 3: If direct fails, try edits with compressed reference
async function step3Edits(baseB64) {
  console.log("\nStep 3: Trying /images/edits with compressed reference...");

  // Decode and re-encode as JPEG at low quality to reduce size
  const base64Data = baseB64.replace(/^data:image\/\w+;base64,/, "");
  const imageBuffer = Buffer.from(base64Data, "base64");

  // Use sharp-like approach: just resize the buffer if possible, or use a smaller ref
  // For now, use the raw buffer but hope the server handles it
  const boundary = `----FormBoundary${randomUUID()}`;
  const parts = [];

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}\r\n`
  ));
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${MODEL}\r\n`
  ));
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="n"\r\n\r\n1\r\n`
  ));
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n1024x1024\r\n`
  ));
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="base.png"\r\nContent-Type: image/png\r\n\r\n`
  ));
  parts.push(imageBuffer);
  parts.push(Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);
  console.log("Multipart body size:", body.length, "bytes");

  const res = await fetch(`${BASE_URL}/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(180000),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Step 3 failed:", res.status, err.substring(0, 500));
    process.exit(1);
  }

  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (b64) {
    writeFileSync("/tmp/model_sheet_v2.png", Buffer.from(b64, "base64"));
    console.log("Character sheet saved to /tmp/model_sheet_v2.png, size:", Buffer.from(b64, "base64").length, "bytes");
  }
}

const baseB64 = await step1();
const directResult = await step2Direct();
if (!directResult) {
  await step3Edits(baseB64);
}
console.log("\nDone!");
