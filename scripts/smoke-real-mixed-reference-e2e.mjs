#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { stopSmokeServer } from "./smoke-runtime.mjs";

const ROOT = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const port = Number(process.env.REAL_MIXED_REF_E2E_PORT || 3494);
const externalBaseUrl = process.env.REAL_MIXED_REF_E2E_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const outDir = path.join(ROOT, "test_artifacts", "api-smoke");
const workflowId = `workflow_real_mixed_ref_${stamp}`;
const frameNodeId = `frame_real_mixed_ref_${stamp}`;
const batchId = `batch_real_mixed_ref_${stamp}`;
const reportPath = path.join(outDir, `real-mixed-reference-e2e-${stamp}.json`);
const promptPath = path.join(outDir, `real-mixed-reference-e2e-${stamp}.prompt.txt`);
const dbPath = path.join(ROOT, ".data", "image-master.db");
const modelProviderMode = normalizeModelProviderMode(process.env.REAL_MIXED_REF_MODEL_PROVIDER_MODE);
const itemMode = normalizeItemsMode(process.env.REAL_MIXED_REF_ITEMS);

const sourceRefs = {
  product: process.env.REAL_MIXED_REF_PRODUCT ||
    path.join(ROOT, "test_artifacts/sweet-plush-bag-scene-set/2026-05-22T18-17-46-929Z/asset-product-product_asset.png"),
  model: process.env.REAL_MIXED_REF_MODEL ||
    path.join(ROOT, "test_artifacts/sweet-plush-bag-scene-set/2026-05-22T18-17-46-929Z/asset-model-model_asset.png"),
  scene: process.env.REAL_MIXED_REF_SCENE ||
    path.join(ROOT, "test_artifacts/sweet-plush-bag-scene-set/2026-05-22T18-17-46-929Z/asset-indoor-scene_asset.png"),
  style: process.env.REAL_MIXED_REF_STYLE ||
    path.join(ROOT, "test_artifacts/sweet-plush-bag-scene-set/2026-05-22T18-17-46-929Z/asset-style-style_asset.png"),
};

let server;
let serverOutput = "";

await fsp.mkdir(outDir, { recursive: true });

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: ROOT,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      IMAGE_MASTER_DATA_DIR: path.join(ROOT, ".data"),
      IMAGE_MASTER_QUEUE_OWNER: `real-mixed-ref-${Date.now()}`,
      IMAGE_MASTER_JOB_CONCURRENCY: process.env.REAL_MIXED_REF_CONCURRENCY || "1",
      IMAGE_MASTER_JOB_LEASE_MS: "900000",
      NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || `.next-real-mixed-ref-${stamp}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
}

try {
  await assertConfigured();
  await waitForServer(`${baseUrl}/api/settings`);

  const refs = await prepareReferences();
  const body = buildPlanRequest(refs);
  await fsp.writeFile(promptPath, JSON.stringify(body.items.map((item) => ({
    title: item.title,
    prompt: item.prompt,
  })), null, 2));

  const committed = await requestJson(`${baseUrl}/api/generation-plans/run`, {
    method: "POST",
    body: JSON.stringify({
      ...body,
      enqueue: true,
      confirmedProviderCallLimit: body.items.length,
    }),
  }, 201, 60_000);

  if (committed.ok !== true || committed.queued !== true) {
    throw new Error(`Expected queued generation plan, got ${JSON.stringify(committed)}`);
  }

  const jobs = await waitForJobsDone(workflowId, body.items.length);
  const outputs = [];
  const failures = [];

  for (const [index, job] of jobs.entries()) {
    if (job.status !== "done") {
      failures.push(summarizeJob(job));
      continue;
    }
    const metadata = parseMetadata(job.metadata);
    const bytes = await getBytes(job.resultUrl);
    const safeId = String(metadata.planItemId || job.id)
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || `job-${index + 1}`;
    const outputPath = path.join(outDir, `real-mixed-reference-e2e-${stamp}-${index + 1}-${safeId}.png`);
    await fsp.writeFile(outputPath, bytes);
    outputs.push({
      jobId: job.id,
      title: metadata.planItemTitle,
      resultUrl: job.resultUrl,
      outputPath,
      outputBytes: bytes.length,
      providerReferenceCount: metadata.providerReferenceCount,
      providerReferenceRole: metadata.providerReferenceRole,
      providerReferenceStrategy: metadata.providerReferenceStrategy,
      promptOnlyReferenceCount: Array.isArray(metadata.promptOnlyReferenceImages)
        ? metadata.promptOnlyReferenceImages.length
        : 0,
      providerRequestId: readLastProviderRequestId(metadata),
    });
  }

  const report = {
    ok: failures.length === 0,
    stage: failures.length === 0 ? "done" : "partial",
    baseUrl,
    workflowId,
    frameNodeId,
    batchId,
    modelProviderMode,
    itemMode,
    referenceInputs: refs.map((ref) => ({
      role: ref.role,
      title: ref.title,
      sourcePath: ref.sourcePath,
      preparedPath: ref.preparedPath,
      preparedBytes: ref.bytes,
    })),
    requestReferenceInputs: body.referenceContext.images.map((image) => ({
      role: image.role,
      title: image.title,
      providerUsable: image.providerUsable,
      providerMode: image.providerMode,
    })),
    estimate: committed.estimate,
    providerPolicy: committed.providerPolicy,
    outputCount: outputs.length,
    outputs,
    failures,
    promptPath,
    reportPath,
  };
  await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  if (failures.length > 0) {
    throw new Error(`Mixed reference E2E finished with ${failures.length} failed job(s). See ${reportPath}`);
  }

  console.log(`Real mixed-reference E2E passed on ${baseUrl}.`);
  console.log(`Provider calls: ${body.items.length}`);
  for (const output of outputs) {
    console.log(`Output: ${output.outputPath}`);
  }
  console.log(`Report: ${reportPath}`);
} catch (error) {
  await writeFailureReport(error).catch(() => undefined);
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-6000));
  }
  process.exitCode = 1;
} finally {
  await stopSmokeServer(server);
}

async function assertConfigured() {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Missing app database at ${dbPath}`);
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare("SELECT key, value FROM config").all();
    const config = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    const hasKey = Boolean(config.imageApiKey || config.apiKey || process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY);
    if (!hasKey) {
      throw new Error("Image provider key is not configured.");
    }
    console.log(
      `Provider config: model=${config.imageModel || process.env.IMAGE_MODEL || "unknown"} host=${safeHost(config.imageBaseUrl || config.baseUrl || process.env.IMAGE_BASE_URL || process.env.OPENAI_BASE_URL || "")}`
    );
  } finally {
    db.close();
  }
}

async function prepareReferences() {
  const sharp = await import("sharp");
  const specs = [
    {
      role: "product",
      title: "Product multi-view white sheet",
      sourcePath: sourceRefs.product,
      maxEdge: 768,
      quality: 86,
    },
    {
      role: "model",
      title: "Eastern European fashion model asset",
      sourcePath: sourceRefs.model,
      maxEdge: 768,
      quality: 84,
    },
    {
      role: "scene",
      title: "Nordic home interior scene asset",
      sourcePath: sourceRefs.scene,
      maxEdge: 768,
      quality: 82,
    },
    {
      role: "style",
      title: "Warm premium editorial style board",
      sourcePath: sourceRefs.style,
      maxEdge: 640,
      quality: 82,
    },
  ];

  const refs = [];
  for (const spec of specs) {
    if (!fs.existsSync(spec.sourcePath)) {
      throw new Error(`Missing ${spec.role} reference: ${spec.sourcePath}`);
    }
    const preparedPath = path.join(outDir, `real-mixed-reference-e2e-${stamp}-${spec.role}.jpg`);
    await sharp.default(spec.sourcePath)
      .resize({
        width: spec.maxEdge,
        height: spec.maxEdge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: spec.quality, mozjpeg: true })
      .toFile(preparedPath);
    const buffer = await fsp.readFile(preparedPath);
    refs.push({
      ...spec,
      preparedPath,
      bytes: buffer.byteLength,
      dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`,
    });
  }
  return refs;
}

function buildPlanRequest(refs) {
  const images = refs.map((ref) => ({
    role: ref.role,
    title: ref.title,
    url: ref.dataUrl,
    providerUsable: ref.role === "model" ? modelProviderMode === "strong" : true,
    providerMode: ref.role === "model" && modelProviderMode !== "strong" ? "prompt_only" : "provider_input",
    source: "real-mixed-reference-e2e",
  }));
  const byRole = Object.fromEntries(refs.map((ref) => [ref.role, ref]));
  const referenceContext = {
    version: 1,
    source: "canvas-workbench",
    targetNodeId: frameNodeId,
    targetNodeLabel: "混合参考真实端到端测试",
    images,
    roles: {
      product: {
        role: "product",
        title: byRole.product.title,
        sourceNodeIds: ["product_ref"],
        componentIds: [],
        assetIds: [],
        promptFragments: [
          "Use the product reference as the identity source: preserve structure, scale, material, and recognizable details.",
          "The product is a bag/phone-style product reference sheet; infer one coherent commercial product from the multi-view sheet.",
        ],
        constraints: ["Do not invent a different product.", "Keep the product visually consistent across the set."],
        negativeRules: ["No extra logos, no fake text, no second product."],
        qualityRules: ["Product shape and material must remain recognizable."],
      },
      model: {
        role: "model",
        title: byRole.model.title,
        sourceNodeIds: ["model_ref"],
        componentIds: [],
        assetIds: [],
        promptFragments: [
          "Use the model reference only for broad adult model identity cues: age impression, body proportion, hair family, posture temperament, and refined commercial presence.",
          "Create a fresh legally distinct person; do not copy the exact identity.",
          "Do not preserve the model reference's studio lighting, face retouching, catchlights, white-background exposure, or beauty portrait fill.",
        ],
        constraints: [
          "Keep full-body anatomy natural.",
          "The model should interact believably with the product when requested.",
          "The model must be relit by the scene light map, not kept in separate studio portrait lighting.",
          "In this Nordic room, the main window/daylight is on image-left. The model's image-left side must be brighter, image-right side must fall into soft room shadow, and cast shadows must fall away from the window onto the rug/floor.",
        ],
        negativeRules: [
          "No seductive posing, no distorted hands, no duplicated limbs.",
          "No glamour key light, no face-only beauty fill, no studio catchlights pasted into a daylight room.",
        ],
        qualityRules: [
          "Commercial environmental portrait quality, clean styling, refined expression.",
          "Face exposure follows scene daylight; the shadow side of the face may remain naturally darker.",
        ],
      },
      scene: {
        role: "scene",
        title: byRole.scene.title,
        sourceNodeIds: ["scene_ref"],
        componentIds: [],
        assetIds: [],
        promptFragments: [
          "Use the scene reference for Nordic home interior space, furniture language, warm daylight, placement logic, and the actual lighting plate.",
          "Scene light is authoritative: visible window position, sun stripe direction, window-side brightness, shadow falloff, color temperature, exposure, and ambient bounce must drive the model and product lighting.",
          "For this scene, the visible window is on image-left. Keep image-left subject planes brighter, image-right planes darker, and cast shadows falling away from the window in the same direction as table/rug shadows.",
          "Maintain consistent spatial feel, not a collage.",
        ],
        constraints: [
          "The scene should look physically coherent.",
          "Use real perspective and natural shadows.",
          "Any model or product placed into the scene must cast believable contact shadows and share the same highlight direction.",
          "Do not flatten the model with front beauty fill; black clothing must still show room-light gradients and soft shadow transitions.",
        ],
        negativeRules: [
          "No impossible room geometry, no visible guide marks.",
          "No cutout edges, halo outlines, floating feet, floating product, front beauty fill, or studio-light subject pasted into room light.",
        ],
        qualityRules: [
          "Scene must be usable as a commercial lifestyle background.",
          "Lighting continuity should make the final image feel like one photograph.",
        ],
      },
      style: {
        role: "style",
        title: byRole.style.title,
        sourceNodeIds: ["style_ref"],
        componentIds: [],
        assetIds: [],
        promptFragments: [
          "Use the style board for warm premium editorial lighting, quiet luxury palette, and clean high-end commercial finish.",
          "Style is secondary to physical scene lighting: do not override the room's natural light direction or color temperature.",
        ],
        constraints: ["Keep a unified visual language between all outputs."],
        negativeRules: ["No loud neon palette, no cluttered poster text."],
        qualityRules: ["Images should feel like one campaign set."],
      },
    },
    promptFragments: [
      "Generate a coherent commercial mini set using product, model, scene, and style references together.",
      "For model-in-scene outputs, the scene reference is the lighting plate and the model/product must be integrated into that light.",
      "The visible window is on image-left in the current scene/style references; enforce image-left key light and cast shadows falling away from that window.",
    ],
    constraints: [
      "Prioritize product identity first, then model usability, then scene/style consistency.",
      "The output should be a finished commercial image, not a reference board.",
      "Match scene key light, color temperature, exposure, contrast, shadow softness, contact shadows, ambient occlusion, edge softness, perspective, and grain across the model, product, and room.",
      "Black clothing should not become flat catalogue black: it must show subtle window-side highlight gradients and room-shadow falloff.",
      "Feet and product bases must visibly touch the rug/table with darker contact shadows and matching cast-shadow direction.",
    ],
    negativeRules: [
      "No collage, no split-screen, no annotations, no watermarks.",
      "No pasted-on model, no studio portrait lighting inside a daylight room, no front beauty fill, no inconsistent highlight direction, no missing floor/contact shadows.",
    ],
    qualityRules: ["Commercially usable, coherent perspective, clean hand/product interaction."],
  };

  const items = [
    {
      itemId: "mixed-lifestyle-model",
      title: "混合参考-模特家居手持图",
      type: "model_lifestyle",
      ratio: "1:1",
      size: "1024x1024",
      modelRequired: true,
      textAllowed: false,
      copyText: "自然家居手持展示",
      prompt: [
        "Create one photorealistic premium lifestyle ecommerce image.",
        "An adult Eastern European commercial model subject sits or stands in a warm Nordic home interior, naturally holding or carrying the referenced product.",
        "Make it an available-light environmental portrait, not a beauty portrait: no added fill light, no studio softbox, no glamour catchlights, no face retouching, and no front-facing fill.",
        "The product must stay recognizable from the product reference: structure, material, scale, and key details are preserved.",
        "Use the scene reference as an exact lighting map. The visible window is on image-left: the model's image-left face, hair edge, shoulder, trousers, and bag side should be brighter; image-right planes should fall into soft warm room shadow.",
        "Face exposure must obey the same room light as clothing and hands; keep the shadow side of the face naturally dimmer instead of lifting it with beauty lighting.",
        "Cast shadows must fall away from the image-left window and align with the existing table/rug shadow direction. Feet must have dark contact shadows on the rug; the bag must cast small occlusion shadows on hand/body and show window-side highlights on metal hardware.",
        "Relight the model and product so skin, black knitwear, cream trousers, bag leather, metal hardware, hair edges, and hands all share the same room exposure and color temperature. Black clothing must retain subtle fabric detail and window-light gradients, not pure flat studio black.",
        "Use the style reference only for refined commercial finish, not for conflicting studio lighting.",
        "Composition: medium-wide commercial shot, model and product both clearly visible, natural hand interaction, believable perspective, no poster text, no watermark, no collage, no cutout edge, no front beauty fill.",
      ].join(" "),
      qualityRules: [
        "product identity",
        "natural hand interaction",
        "model anatomy",
        "scene-matched lighting",
        "contact shadows and ambient occlusion",
        "window-left light map obeyed",
      ],
    },
    {
      itemId: "mixed-product-scene-hero",
      title: "混合参考-产品场景主图",
      type: "product_scene_hero",
      ratio: "1:1",
      size: "1024x1024",
      modelRequired: false,
      textAllowed: false,
      copyText: "统一风格产品场景主图",
      prompt: [
        "Create one photorealistic premium product hero image in the same campaign language.",
        "Place the referenced product on a clean table or soft furnishing area inside the Nordic home scene.",
        "Preserve the product identity from the multi-view reference and keep it as the single visual subject.",
        "Use the scene reference as an exact lighting map. The visible window is on image-left: product image-left planes should be brighter, image-right planes should be in soft warm shadow, and the tabletop cast shadow must fall away from the window like existing scene shadows.",
        "The product base must visibly contact the table with realistic dark occlusion, and metal/leather highlights must follow the same window direction.",
        "Use the style reference for warm editorial finish only after the product is physically integrated into the room light.",
        "No model in this image, no text, no second product, no watermark, no collage.",
      ].join(" "),
      qualityRules: [
        "product identity",
        "scene placement",
        "style consistency",
        "single-subject clarity",
        "scene-matched shadows and reflections",
      ],
    },
  ];
  const selectedItems = items.filter((item) => {
    if (itemMode === "model") return item.itemId === "mixed-lifestyle-model";
    if (itemMode === "hero") return item.itemId === "mixed-product-scene-hero";
    return true;
  });

  return {
    workflowId,
    frameNodeId,
    batchId,
    batchTitle: "真实混合参考端到端测试",
    platform: "mixed_reference_e2e",
    style: "warm premium Nordic home campaign",
    modelIds: ["eastern-europe-fashion-model-reference"],
    requiredReferenceRoles: ["product", "model", "scene", "style"],
    referenceContext,
    items: selectedItems,
  };
}

async function waitForServer(url) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 90_000) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) return;
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function waitForJobsDone(targetWorkflowId, expectedCount) {
  const started = Date.now();
  while (Date.now() - started < 20 * 60_000) {
    const jobs = await requestJson(`${baseUrl}/api/jobs?workflowId=${encodeURIComponent(targetWorkflowId)}`, {}, 200, 30_000);
    const relevant = Array.isArray(jobs) ? jobs : [];
    if (relevant.length >= expectedCount) {
      const terminal = relevant.filter((job) => ["done", "completed", "failed", "cancelled"].includes(job.status));
      if (terminal.length >= expectedCount) return terminal.slice(0, expectedCount);
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for ${expectedCount} mixed-reference jobs`);
}

async function requestJson(url, init = {}, expectedStatus = 200, timeoutMs = 120_000) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (response.status !== expectedStatus) {
    throw new Error(`Expected status ${expectedStatus}, got ${response.status}: ${JSON.stringify(payload).slice(0, 1200)}`);
  }
  return payload;
}

async function getBytes(url) {
  const response = await fetch(url.startsWith("http") ? url : `${baseUrl}${url}`, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`Image fetch failed ${response.status}: ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function writeFailureReport(error) {
  const report = {
    ok: false,
    stage: "failed",
    error: error instanceof Error ? error.message : String(error),
    baseUrl,
    workflowId,
    batchId,
    reportPath,
  };
  await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function summarizeJob(job) {
  const metadata = parseMetadata(job.metadata);
  return {
    jobId: job.id,
    status: job.status,
    error: job.error,
    title: metadata.planItemTitle,
    providerDiagnostics: metadata.providerDiagnostics,
    providerReferenceCount: metadata.providerReferenceCount,
  };
}

function readLastProviderRequestId(metadata) {
  const ledger = Array.isArray(metadata.providerAttemptLedger) ? metadata.providerAttemptLedger : [];
  const latest = ledger.at(-1);
  return latest?.providerRequestId || latest?.requestId || undefined;
}

function safeHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return value || "unknown";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeModelProviderMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "prompt_only" || normalized === "prompt-only" || normalized === "soft"
    ? "prompt_only"
    : "strong";
}

function normalizeItemsMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "model" || normalized === "hero" ? normalized : "both";
}
