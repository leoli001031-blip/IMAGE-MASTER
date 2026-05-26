#!/usr/bin/env tsx

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildGenerationFramePlanSpecs } from "../lib/canvas/generation-frame";

const ROOT = process.cwd();
const BASE_URL = process.env.ACCESSORY_SET_BASE_URL || "http://127.0.0.1:3000";
const MODEL_REFERENCE_MODE = normalizeModelReferenceMode(process.env.ACCESSORY_SET_MODEL_REFERENCE_MODE);
const SEQUENTIAL_RUN = process.env.ACCESSORY_SET_SEQUENTIAL === "1";
const MAX_ITEMS = normalizeMaxItems(process.env.ACCESSORY_SET_MAX_ITEMS);
const START_INDEX = normalizeStartIndex(process.env.ACCESSORY_SET_START_INDEX);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(ROOT, "test_artifacts", "accessory-lifestyle-set", stamp);
const desktopDir = path.join(path.dirname(ROOT), "毛绒小包生活方式组图测试");
const reportPath = path.join(runDir, "report.json");

const productSourcePath = path.join(ROOT, "public", "test-assets", "frontend-plush-bag.png");
const modelGeneratedFile = "asset_pack_model_asset_4863c3f2-image-465111290988.png";
const modelSourcePath = path.join(ROOT, ".data", "generated", modelGeneratedFile);
const modelReferenceUrl = `/api/generated-images/${modelGeneratedFile}`;

const request =
  "用甜妹模特和毛绒小包做一组多场景生活方式包包图，6张，花店、咖啡店、精品街区氛围，要像真实拍摄的小型商业组图。";

await fs.mkdir(runDir, { recursive: true });

async function main() {
  await waitForServer(`${BASE_URL}/api/settings`);
  await assertFile(productSourcePath, "product source");
  await assertFile(modelSourcePath, "model source");

  const productReferenceUrl = await ensureGeneratedImageUrl(productSourcePath, "plush-bag-reference");
  const specs = buildGenerationFramePlanSpecs({
    request,
    outputType: "commercial_image_set",
    frameLabel: "毛绒小包生活方式组图",
    maxItems: 6,
  });
  const selectedSpecs = specs.slice(START_INDEX, START_INDEX + (MAX_ITEMS ?? specs.length));
  const items = selectedSpecs.map((spec, index) => {
    const productOnly = !spec.modelRequired;
    const modelProviderInput = MODEL_REFERENCE_MODE === "provider_input";
    return {
      itemId: spec.exportSpecId || spec.id,
      title: spec.title.replace(/^毛绒小包生活方式组图 · /, ""),
      type: spec.type,
      ratio: spec.ratio,
      size: spec.size,
      whiteBackground: spec.whiteBackground,
      textAllowed: spec.textAllowed,
      modelRequired: spec.modelRequired,
      referenceRoles: productOnly ? ["product"] : ["product", "model"],
      providerReferenceRoles: productOnly || !modelProviderInput ? ["product"] : ["product", "model"],
      modelReferenceMode: productOnly ? undefined : MODEL_REFERENCE_MODE,
      metadata: {
        source: "accessory-lifestyle-set-test",
        templateId: spec.exportSpecId,
        batchIndex: index,
        modelReferenceMode: productOnly ? undefined : MODEL_REFERENCE_MODE,
      },
      prompt: [
        "Create exactly one finished realistic commercial photo for this shot only.",
        "Use PRODUCT_REFERENCE only for the exact cream-pink plush mini handbag: keep rounded small silhouette, plush cream upper panel, soft pink lower panel, short handle, thin strap, light-gold hardware, soft cute proportion, and tactile texture. Do not redesign it.",
        productOnly
          ? "This shot is product-only: no model, no human body, no face, no extra bag variants."
          : MODEL_REFERENCE_MODE === "provider_input"
            ? "Use MODEL_REFERENCE for the same adult sweet East Asian female identity: preserve the broad face impression, face geometry, hair family, body proportions, gentle approachable temperament, and natural adult age impression. Do not copy its model-card layout, panels, beige background, frozen expression, catalogue pose, studio gaze, fixed eye contact, or expression grid. The expression, eye-line, and body action must follow this shot direction, not the reference-card mood."
            : "Use the model asset as prompt-only casting direction: adult sweet East Asian female, long dark softly layered hair with airy bangs, gentle approachable temperament, soft natural expression, and relaxed commercial fashion energy. Do not imitate the model-card pose, expression grid, or locked facial expression.",
        spec.instruction,
        "The final image must be one single photo, not a collage, not a contact sheet, not a poster board, and no burned-in marketing copy.",
      ].filter(Boolean).join("\n"),
    };
  });

  const payload = {
    workflowId: `accessory_lifestyle_${stamp}`,
    frameNodeId: `frame_accessory_lifestyle_${stamp}`,
    batchId: `batch_accessory_lifestyle_${stamp}`,
    batchTitle: "毛绒小包生活方式组图测试",
    platform: "accessory_lifestyle_real_test",
    outputType: "commercial_image_set",
    request,
    style: "soft realistic sweet commercial handbag lifestyle photography",
    requiredReferenceRoles: ["product", "model"],
    referenceContext: buildReferenceContext(productReferenceUrl),
    items,
    enqueue: !SEQUENTIAL_RUN,
    confirmedProviderCallLimit: items.length,
  };

  const dryRun = await postJson("/api/generation-plans/dry-run", {
    ...payload,
    enqueue: undefined,
    confirmedProviderCallLimit: undefined,
  });
  if (!dryRun.ok) {
    throw new Error(`Dry-run failed: ${JSON.stringify(dryRun).slice(0, 1200)}`);
  }

  console.log(JSON.stringify({
    mode: "accessory-lifestyle-set-test",
    stamp,
    request,
    modelReferenceMode: MODEL_REFERENCE_MODE,
    plannedProviderCalls: dryRun.estimate?.providerCallCount,
    maxItems: MAX_ITEMS,
    startIndex: START_INDEX,
    items: dryRun.plan?.items?.map((item: Record<string, unknown>) => ({
      title: item.title,
      ratio: item.ratio,
      size: item.size,
      referenceRoles: item.referenceRoles,
      providerReferenceRoles: item.providerReferenceRoles,
    })),
  }, null, 2));

  const committed = await postJson("/api/generation-plans/run", payload, 201, 120_000);
  if (!committed.ok || (!SEQUENTIAL_RUN && !committed.queued)) {
    throw new Error(`Run failed: ${JSON.stringify(committed).slice(0, 1200)}`);
  }

  const jobs = SEQUENTIAL_RUN
    ? await runJobsSequentially(committed.jobs ?? [])
    : await waitForJobsDone(payload.workflowId, items.length, 35 * 60_000);
  const outputs = [];
  const failures = [];

  for (const job of jobs) {
    const metadata = parseMetadata(job.metadata);
    if (job.status !== "done" || !job.resultUrl) {
      failures.push({
        id: job.id,
        status: job.status,
        error: job.error,
        title: metadata.planItemTitle,
      });
      continue;
    }
    const index = Number(metadata.batchIndex || outputs.length + 1);
    const file = await savePublicImage(job.resultUrl, `${String(index).padStart(2, "0")}-${metadata.planItemTitle || job.id}`);
    outputs.push({
      index,
      jobId: job.id,
      title: metadata.planItemTitle,
      type: metadata.planItemType,
      ratio: metadata.ratio,
      size: metadata.size,
      resultUrl: job.resultUrl,
      outputPath: file.outputPath,
      dimensions: file.dimensions,
      prompt: job.prompt,
    });
  }

  outputs.sort((a, b) => a.index - b.index);
  const contactSheetPath = outputs.length ? await maybeBuildContactSheet(outputs) : undefined;
  await copyForReview(outputs, contactSheetPath);

  const report = {
    ok: failures.length === 0 && outputs.length === items.length,
    stamp,
    request,
    productReferenceUrl,
    modelReferenceUrl,
      modelReferenceMode: MODEL_REFERENCE_MODE,
      sequentialRun: SEQUENTIAL_RUN,
    dryRunEstimate: dryRun.estimate,
    planItems: committed.plan?.items,
    outputs,
    failures,
    contactSheetPath,
    desktopDir,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: report.ok,
    success: outputs.length,
    failures: failures.length,
    contactSheetPath,
    desktopDir,
    reportPath,
  }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

function buildReferenceContext(productReferenceUrl: string) {
  return {
    version: 1,
    source: "canvas-workbench",
    targetNodeId: `accessory_lifestyle_frame_${stamp}`,
    targetNodeLabel: "毛绒小包生活方式组图",
    images: [
      {
        role: "product",
        title: "奶油粉毛绒小包商品参考",
        url: productReferenceUrl,
        providerUsable: true,
        providerMode: "provider_input",
        source: "accessory-lifestyle-test",
      },
      {
        role: "model",
        title: "甜妹系自然模特资产",
        url: modelReferenceUrl,
        providerUsable: true,
        providerMode: "provider_input",
        source: "accessory-lifestyle-test",
      },
    ],
    roles: {
      product: {
        role: "product",
        title: "奶油粉毛绒小包商品参考",
        sourceNodeIds: ["plush-bag-product"],
        componentIds: [],
        assetIds: [],
        promptFragments: [
          "Use this as the exact plush mini handbag identity reference.",
          "Preserve cream-white and light-pink plush panels, rounded small body, short handle, thin strap, light-gold hardware, and soft tactile texture.",
        ],
        constraints: [
          "The product is a plush mini handbag, not a toy, pillow, cosmetic pouch, backpack, or hard leather bag.",
          "Do not invent logos, extra variants, extra decorations, or unrelated products.",
        ],
        negativeRules: ["No wrong bag category, no fake logo, no extra product variants."],
        qualityRules: ["The bag silhouette, plush texture, handle, strap, hardware, and scale must stay recognizable."],
      },
      model: {
        role: "model",
        title: "甜妹系自然模特资产",
        sourceNodeIds: ["sweet-model"],
        componentIds: [],
        assetIds: [],
        promptFragments: [
          "Use this as the same adult sweet East Asian female model identity reference.",
          "Keep broad face impression, hair family, body proportion, and gentle approachable temperament.",
        ],
        constraints: [
          "Do not copy the model-card sheet layout or beige reference-card background.",
          "Do not copy the model-card frozen expression, catalogue pose, fixed gaze, fixed eye contact, studio portrait mood, or expression grid.",
          "For each final shot, the model's expression, eye-line, and action must follow the shot-specific direction while keeping the same identity.",
          "When the model appears, she must naturally hold, wear, adjust, open, or carry the handbag.",
        ],
        negativeRules: ["No duplicated limbs, no distorted hands, no childlike styling, no studio model-card layout."],
        qualityRules: ["Natural expression, adult age impression, believable hand-bag contact, coherent anatomy."],
      },
    },
    promptFragments: [request],
    constraints: ["Each output should be one real-feeling commercial photo with a distinct shot purpose."],
    negativeRules: ["No watermark, no collage, no fake brand logo, no burned-in text."],
    qualityRules: ["Varied actions, varied shot distance, consistent model/product identity, real-world contact and lighting."],
  };
}

async function ensureGeneratedImageUrl(sourcePath: string, prefix: string) {
  const bytes = await fs.readFile(sourcePath);
  const hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const ext = path.extname(sourcePath).toLowerCase() || ".png";
  const fileName = `${prefix}-${hash}${ext}`;
  const generatedDir = path.join(ROOT, ".data", "generated");
  const targetPath = path.join(generatedDir, fileName);
  await fs.mkdir(generatedDir, { recursive: true });
  try {
    await fs.access(targetPath);
  } catch {
    await fs.copyFile(sourcePath, targetPath);
  }
  return `/api/generated-images/${fileName}`;
}

async function waitForServer(url: string) {
  const started = Date.now();
  let lastError: unknown;
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
  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${url}`);
}

async function waitForJobsDone(workflowId: string, expectedCount: number, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const jobs = await getJson(`/api/jobs?workflowId=${encodeURIComponent(workflowId)}`);
    const relevant = Array.isArray(jobs) ? jobs : [];
    const terminal = relevant.filter((job) => ["done", "completed", "failed", "cancelled"].includes(job.status));
    const statusCounts = relevant.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    process.stdout.write(`\r${workflowId}: ${JSON.stringify(statusCounts)}   `);
    if (relevant.length >= expectedCount && terminal.length >= expectedCount) {
      process.stdout.write("\n");
      return terminal
        .sort((a, b) => Number(parseMetadata(a.metadata).batchIndex || 0) - Number(parseMetadata(b.metadata).batchIndex || 0))
        .slice(0, expectedCount);
    }
    await sleep(3000);
  }
  process.stdout.write("\n");
  throw new Error(`Timed out waiting for ${expectedCount} jobs in ${workflowId}`);
}

async function runJobsSequentially(jobs: Array<{ id: string; metadata?: Record<string, unknown> }>) {
  const results = [];
  for (const [index, job] of jobs.entries()) {
    const title = parseMetadata(job.metadata).planItemTitle || job.id;
    console.log(`Sequential run ${index + 1}/${jobs.length}: ${title}`);
    await postJson(`/api/jobs/${encodeURIComponent(job.id)}/run`, {}, 200, 60_000);
    results.push(await waitForJobDone(job.id, 12 * 60_000));
  }
  return results;
}

async function waitForJobDone(jobId: string, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await getJson(`/api/jobs/${encodeURIComponent(jobId)}`);
    process.stdout.write(`\r${jobId}: ${job.status}   `);
    if (["done", "completed", "failed", "cancelled"].includes(job.status)) {
      process.stdout.write("\n");
      return job;
    }
    await sleep(3000);
  }
  process.stdout.write("\n");
  throw new Error(`Timed out waiting for job ${jobId}`);
}

async function postJson(route: string, body: unknown, expectedStatus = 200, timeoutMs = 120_000) {
  const response = await fetch(`${BASE_URL}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (response.status !== expectedStatus) {
    throw new Error(`${route} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(payload).slice(0, 1200)}`);
  }
  return payload;
}

async function getJson(route: string) {
  const response = await fetch(`${BASE_URL}${route}`, { signal: AbortSignal.timeout(60_000) });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${route} failed ${response.status}: ${JSON.stringify(payload).slice(0, 1000)}`);
  return payload;
}

async function savePublicImage(url: string, slug: string) {
  const response = await fetch(url.startsWith("http") ? url : `${BASE_URL}${url}`, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Image fetch failed ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const outputPath = path.join(runDir, `${sanitizeFileName(slug)}.png`);
  await fs.writeFile(outputPath, bytes);
  return { outputPath, dimensions: readPngDimensions(bytes) };
}

async function maybeBuildContactSheet(outputs: Array<{ outputPath: string; title: string; dimensions?: { width: number; height: number } }>) {
  try {
    const sharp = await import("sharp");
    const thumbW = 360;
    const thumbH = 360;
    const labelH = 54;
    const cols = 3;
    const gap = 18;
    const rows = Math.ceil(outputs.length / cols);
    const width = cols * thumbW + (cols + 1) * gap;
    const height = rows * (thumbH + labelH) + (rows + 1) * gap;
    const composites = [];
    for (const [index, output] of outputs.entries()) {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = gap + col * (thumbW + gap);
      const y = gap + row * (thumbH + labelH + gap);
      const image = await sharp.default(output.outputPath)
        .resize({ width: thumbW, height: thumbH, fit: "contain", background: "#fbf4ee" })
        .png()
        .toBuffer();
      composites.push({ input: image, left: x, top: y });
      composites.push({
        input: Buffer.from(labelSvg(thumbW, labelH, `${index + 1}. ${output.title}`, `${output.dimensions?.width || "?"}x${output.dimensions?.height || "?"}`)),
        left: x,
        top: y + thumbH,
      });
    }
    const contactSheetPath = path.join(runDir, "contact-sheet.png");
    await sharp.default({
      create: { width, height, channels: 4, background: "#eaded6" },
    })
      .composite(composites)
      .png()
      .toFile(contactSheetPath);
    return contactSheetPath;
  } catch {
    return undefined;
  }
}

async function copyForReview(outputs: Array<{ outputPath: string; title: string; index: number }>, contactSheetPath?: string) {
  await fs.rm(desktopDir, { recursive: true, force: true });
  await fs.mkdir(desktopDir, { recursive: true });
  if (contactSheetPath) await fs.copyFile(contactSheetPath, path.join(desktopDir, "contact-sheet.png"));
  for (const output of outputs) {
    await fs.copyFile(output.outputPath, path.join(desktopDir, `${String(output.index).padStart(2, "0")}-${sanitizeFileName(output.title)}.png`));
  }
}

async function assertFile(filePath: string, label: string) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

function parseMetadata(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, any>;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function readPngDimensions(buffer: Buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return undefined;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function labelSvg(width: number, height: number, title: string, subtitle: string) {
  return `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#fffaf7"/>
  <text x="12" y="22" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#31221f">${escapeXml(truncate(title, 32))}</text>
  <text x="12" y="43" font-family="Arial, sans-serif" font-size="12" fill="#7d665f">${escapeXml(subtitle)}</text>
</svg>`;
}

function sanitizeFileName(value: unknown) {
  return String(value).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 100);
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(async (error) => {
  await fs.mkdir(runDir, { recursive: true }).catch(() => undefined);
  await fs.writeFile(reportPath, `${JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    reportPath,
  }, null, 2)}\n`).catch(() => undefined);
  console.error(error);
  process.exit(1);
});

function normalizeModelReferenceMode(value: string | undefined): "prompt_only" | "provider_input" {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "prompt_only" || normalized === "soft" || normalized === "natural_first") {
    return "prompt_only";
  }
  return "provider_input";
}

function normalizeMaxItems(value: string | undefined): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.max(1, Math.floor(parsed));
}

function normalizeStartIndex(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}
