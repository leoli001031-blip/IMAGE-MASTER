#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import ts from "typescript";

const args = parseArgs(process.argv.slice(2));
const outDir = process.env.OUT_DIR || path.join(process.cwd(), "test_artifacts", "api-smoke");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const size = process.env.IMAGE_SIZE || "1024x1024";
const quality = process.env.IMAGE_QUALITY || "standard";
const dryRun = args["dry-run"] === "true" || process.env.DRY_RUN === "1";
const referencePaths = normalizeReferences(args.refs || process.env.PRODUCT_REFERENCE_PATHS);
const userRequest =
  args.request ||
  process.env.PRODUCT_REQUEST ||
  "把多张商品角度图合成为一张干净白底多视角商品参考图，方便后续生成主图、详情页、模特手持或场景图。";
const productCategoryHint = args.category || process.env.PRODUCT_CATEGORY_HINT || "";

fs.mkdirSync(outDir, { recursive: true });

const { buildProductMultiviewWhiteSheetPrompt } = await importPromptModule();
const prompt = buildProductMultiviewWhiteSheetPrompt({
  userRequest,
  productCategoryHint,
  referenceCount: referencePaths.length,
  viewCount: Number(args.views || process.env.PRODUCT_VIEW_COUNT || 6),
});

const promptPath = path.join(outDir, `product-multiview-white-sheet-${stamp}.prompt.txt`);
fs.writeFileSync(promptPath, prompt);

if (dryRun || referencePaths.length === 0) {
  console.log(
    JSON.stringify(
      {
        mode: "product-multiview-white-sheet",
        dryRun: true,
        promptPath,
        promptChars: prompt.length,
        referencePaths,
        note:
          referencePaths.length === 0
            ? "Set PRODUCT_REFERENCE_PATHS to comma-separated local product images to run the real provider call."
            : "Dry run only; no provider call was made.",
      },
      null,
      2
    )
  );
  process.exit(0);
}

if (referencePaths.length < 2) {
  throw new Error("PRODUCT_REFERENCE_PATHS should include at least 2 product angle images for this smoke.");
}
if (referencePaths.length > 6) {
  throw new Error("Keep PRODUCT_REFERENCE_PATHS to 2-6 images for one product sheet.");
}
for (const referencePath of referencePaths) {
  if (!fs.existsSync(referencePath)) throw new Error(`Missing product reference image: ${referencePath}`);
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
const imageModel = process.env.IMAGE_MODEL || config.imageModel || "gpt-image-2";
if (!apiKey) throw new Error("Missing image API key in env or app config.");

const rawPath = path.join(outDir, `product-multiview-white-sheet-${stamp}.sse.txt`);
const jsonPath = path.join(outDir, `product-multiview-white-sheet-${stamp}.json`);
const imagePath = path.join(outDir, `product-multiview-white-sheet-${stamp}.png`);
const clientRequestId = `image2.product_multiview.${crypto.randomUUID()}`;
const started = Date.now();

console.log(
  JSON.stringify(
    {
      mode: "product-multiview-white-sheet",
      dryRun: false,
      model: imageModel,
      baseUrlHost: safeHost(baseUrl),
      size,
      quality,
      plannedProviderCalls: 1,
      promptPath,
      promptChars: prompt.length,
      referencePaths,
    },
    null,
    2
  )
);

const content = [{ type: "input_text", text: prompt }];
const references = [];
for (const referencePath of referencePaths) {
  const buffer = fs.readFileSync(referencePath);
  references.push({ path: referencePath, bytes: buffer.byteLength });
  content.push({
    type: "input_image",
    image_url: `data:${inferMime(referencePath)};base64,${buffer.toString("base64")}`,
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
    model: imageModel,
    input: [{ role: "user", content }],
    tools: [{ type: "image_generation", size, quality }],
    stream: true,
  }),
});

const raw = await readResponseBody(response, started);
fs.writeFileSync(rawPath, raw.text);
const events = parseSse(raw.text);
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

if (!imageBase64 && raw.text.trim().startsWith("{")) {
  try {
    imageBase64 = findBase64(JSON.parse(raw.text));
  } catch {
    // Keep raw response for diagnostics.
  }
}

if (imageBase64) fs.writeFileSync(imagePath, Buffer.from(imageBase64, "base64"));

const result = {
  ok: response.ok,
  status: response.status,
  clientRequestId,
  responseId,
  promptPath,
  promptChars: prompt.length,
  references,
  firstChunkMs: raw.firstChunkMs,
  lastChunkMs: raw.lastChunkMs,
  totalMs: Date.now() - started,
  bytes: raw.bytes,
  eventCounts,
  imageReturned: Boolean(imageBase64),
  imagePath: imageBase64 ? imagePath : null,
  rawPath,
  rawPreview: imageBase64 ? undefined : raw.text.slice(0, 1200),
};
fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

async function importPromptModule() {
  const root = process.cwd();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "image-master-product-prompt-"));
  const sourcePath = path.join(root, "lib", "ai", "prompts", "product-multiview.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const compiledPath = path.join(outDir, "product-multiview.mjs");
  fs.writeFileSync(compiledPath, output);
  return import(pathToFileURL(compiledPath).href);
}

async function readResponseBody(response, startedAt) {
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
      console.log(`first chunk ${elapsed}ms`);
    }
  }
  return { text, firstChunkMs, lastChunkMs, bytes };
}

function normalizeReferences(value) {
  if (!value || typeof value !== "string") return [];
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(process.cwd(), item));
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
