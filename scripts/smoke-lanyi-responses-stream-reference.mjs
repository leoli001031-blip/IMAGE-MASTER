#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const args = parseArgs(process.argv.slice(2));
const referencePath = args.reference || args.ref;
if (!referencePath) {
  throw new Error("Usage: node scripts/smoke-lanyi-responses-stream-reference.mjs --reference /abs/path.png [--prompt-file file]");
}

const config = readImageConfig();
const apiKey = process.env.LANYI_API_KEY || process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY || config.imageApiKey;
const baseUrl = (process.env.LANYI_BASE_URL || process.env.IMAGE_BASE_URL || config.imageBaseUrl || "https://lanyiapi.com/v1").replace(/\/$/, "");
const model = process.env.IMAGE_MODEL || config.imageModel || "gpt-image-2";
if (!apiKey) {
  throw new Error("Missing image API key in env or app config.");
}

const promptFile = args["prompt-file"];
const basePrompt = promptFile
  ? fs.readFileSync(promptFile, "utf8")
  : [
      "Create one clean commercial model identity reference sheet, 1024x1024.",
      "Use the attached reference image as the visual identity anchor for the adult professional model.",
      "Preserve the same face impression, hair identity, body proportion, temperament, clean studio lighting, and commercial presentation language.",
      "Generate a fresh reusable model asset sheet, not a final product poster.",
      "No product, logo, selling text, watermark, seductive styling, distorted anatomy, or duplicate limbs.",
    ].join(" ");

const prompt = [
  "Reference image mode:",
  "The attached image is the primary model identity reference. Keep the generated model visually consistent with this reference image across face impression, hairstyle family, body proportion, age impression, and clean commercial temperament.",
  "Do not treat the reference as a product image or background asset.",
  "",
  basePrompt.replace(
    /Reference image instruction:[\s\S]*?Do not copy the exact face, identity, ethnicity, hairstyle, body proportions, or wardrobe from the reference image\./,
    "Reference image instruction: Use the reference image as the model identity anchor and visual consistency target. Preserve the adult model identity language while creating a fresh clean asset sheet."
  ),
].join("\n");

const referenceBuffer = fs.readFileSync(referencePath);
const mime = inferMime(referencePath);
const referenceDataUrl = `data:${mime};base64,${referenceBuffer.toString("base64")}`;

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = args["out-dir"] || path.join(process.cwd(), "test_artifacts", "api-smoke");
fs.mkdirSync(outDir, { recursive: true });
const prefix = `lanyi-responses-stream-reference-${stamp}`;
const rawPath = path.join(outDir, `${prefix}.sse.txt`);
const jsonPath = path.join(outDir, `${prefix}.json`);
const imagePath = path.join(outDir, `${prefix}.png`);
const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
const clientRequestId = `image2.reference.${crypto.randomUUID()}`;
const started = Date.now();

fs.writeFileSync(promptPath, prompt);

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
    tools: [{ type: "image_generation", size: "1024x1024", quality: "standard" }],
    stream: true,
  }),
});

const contentType = response.headers.get("content-type") || "";
let raw = "";
let firstChunkMs = null;
let lastChunkMs = null;
let bytes = 0;
const reader = response.body?.getReader();

while (reader) {
  const { done, value } = await reader.read();
  if (done) break;
  const elapsed = Date.now() - started;
  firstChunkMs ??= elapsed;
  lastChunkMs = elapsed;
  bytes += value.byteLength;
  raw += Buffer.from(value).toString("utf8");
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
    // Keep parse failures in rawPath for diagnosis.
  }
}

if (imageBase64) {
  fs.writeFileSync(imagePath, Buffer.from(imageBase64, "base64"));
}

const summary = {
  ok: response.ok,
  status: response.status,
  contentType,
  clientRequestId,
  responseId,
  model,
  baseUrlHost: safeHost(baseUrl),
  promptChars: prompt.length,
  referencePath,
  referenceBytes: referenceBuffer.byteLength,
  firstChunkMs,
  lastChunkMs,
  bytes,
  eventCounts,
  imageReturned: Boolean(imageBase64),
  imagePath: imageBase64 ? imagePath : null,
  rawPath,
  promptPath,
  rawPreview: imageBase64 ? undefined : raw.slice(0, 1200),
};

fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

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
    if (/^[A-Za-z0-9+/=]{1000,}$/.test(value) && value.length > 1000) {
      return value;
    }
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
