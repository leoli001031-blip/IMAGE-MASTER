import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import { seedCommercialComponents } from "./seed-commercial-components.mjs";

const port = Number(process.env.PLAN_TO_APPROVED_EXPORT_PACK_SMOKE_PORT || 3471);
const externalBaseUrl = process.env.PLAN_TO_APPROVED_EXPORT_PACK_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = Date.now();
const batchId = `smoke_plan_export_${stamp}`;
const reportPath = path.join(
  process.cwd(),
  "test_artifacts",
  "plan-to-approved-export-pack-smoke.json"
);
const approvedZipPath = path.join(
  process.cwd(),
  "test_artifacts",
  "plan-to-approved-export-pack-approved.zip"
);
const allZipPath = path.join(
  process.cwd(),
  "test_artifacts",
  "plan-to-approved-export-pack-all.zip"
);

let crc32Table;
let server;
let serverOutput = "";

const created = {
  workflowIds: [],
  jobIds: [],
  artifactIds: [],
  reviewSessionIds: [],
};

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
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
  await waitForServer(`${baseUrl}/api/components`);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  const seedSummary = await seedCommercialComponents({ baseUrl });

  const composePayload = await requestJson(`${baseUrl}/api/workflow-compose`, {
    method: "POST",
    body: JSON.stringify({
      brief:
        "为一款轻便通勤双肩包生成电商投放素材，需要白底主图、生活方式场景、详情卖点图，并在上线前进行导出包 QA 审核。",
      scenario: "product_detail_page",
      productTitle: "Plan Preview Smoke Backpack",
      productDescription:
        "A lightweight commuter backpack with water-resistant nylon, clean hardware, and laptop sleeve.",
      platforms: ["taobao", "xiaohongshu"],
      outputPacks: ["taobao_detail"],
      previewPlan: true,
      saveWorkflow: true,
    }),
  });

  assertComposePayload(composePayload);
  created.workflowIds.push(composePayload.workflow.id);

  const planItems = composePayload.planPreview.items.slice(
    0,
    Math.max(2, Math.min(composePayload.planPreview.items.length, 4))
  );
  if (planItems.length < 2) throw new Error("Expected at least two plan preview items");

  const jobs = [];
  for (const [index, item] of planItems.entries()) {
    const metadata = buildExportPackMetadata({ item, index, total: planItems.length });
    const job = await requestJson(`${baseUrl}/api/jobs`, {
      method: "POST",
      body: JSON.stringify({
        workflowId: composePayload.workflow.id,
        nodeId: item.id,
        assetId: `asset_${batchId}_${index + 1}`,
        status: "done",
        prompt: `Local smoke fixture for ${item.title}`,
        resultUrl: "",
        metadata,
      }),
    });
    created.jobIds.push(job.id);

    const artifact = await requestJson(`${baseUrl}/api/artifacts`, {
      method: "POST",
      body: JSON.stringify({
        workflowId: composePayload.workflow.id,
        nodeId: item.id,
        jobId: job.id,
        assetId: `asset_${batchId}_${index + 1}`,
        type: "image",
        title: `Smoke artifact ${index + 1}: ${item.title}`,
        status: "ready",
        url: smokePngDataUrl(index),
        prompt: `Local smoke fixture for ${item.title}`,
        provider: "local-smoke",
        model: "data-url-fixture",
        metadata,
      }),
    });
    created.artifactIds.push(artifact.id);
    jobs.push({ job, artifact, item, metadata });
  }

  const initialQaPayload = await requestJson(`${baseUrl}/api/export-packs/${batchId}/qa`);
  assertQaStatuses(initialQaPayload.qa, jobs, "manual");

  const sessionPayload = await requestJson(`${baseUrl}/api/review-sessions`, {
    method: "POST",
    body: JSON.stringify(buildReviewSessionPayload(initialQaPayload.manifest, initialQaPayload.qa)),
  });
  const session = sessionPayload.session;
  if (!session?.id) throw new Error("Expected persisted review session id");
  created.reviewSessionIds.push(session.id);

  const approvedJob = jobs[0].job;
  const approvePayload = await requestJson(
    `${baseUrl}/api/review-sessions?id=${encodeURIComponent(session.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        action: "approve_item",
        itemId: approvedJob.id,
        note: "Approved by plan-to-approved-export-pack smoke.",
        metadata: { reviewer: "smoke-plan-to-approved-export-pack" },
      }),
    }
  );
  if (approvePayload.exportPackSync?.status !== "synced") {
    throw new Error(`Expected exportPackSync synced, got ${approvePayload.exportPackSync?.status}`);
  }
  if (approvePayload.exportPackSync?.checkCount !== 4) {
    throw new Error("Expected four manual QA checks to sync after approval");
  }

  const reviewedQaPayload = await requestJson(`${baseUrl}/api/export-packs/${batchId}/qa`);
  assertQaStatus(reviewedQaPayload.qa, approvedJob.id, "pass");
  for (const { job } of jobs.slice(1)) assertQaStatus(reviewedQaPayload.qa, job.id, "manual");

  const approvedZip = await requestBinary(
    `${baseUrl}/api/export-packs/${batchId}/download?approvedOnly=1`
  );
  assertZipHeaders(approvedZip.response, {
    mode: "approved",
    images: 1,
    skipped: jobs.length - 1,
  });
  await fs.writeFile(approvedZipPath, approvedZip.buffer);
  const approvedZipEntries = readStoredZip(approvedZip.buffer);
  assertZipImages(approvedZipEntries, 1, [jobs[0].metadata.naming]);

  const allZip = await requestBinary(`${baseUrl}/api/export-packs/${batchId}/download`);
  assertZipHeaders(allZip.response, {
    mode: "all",
    images: jobs.length,
    skipped: 0,
  });
  await fs.writeFile(allZipPath, allZip.buffer);
  const allZipEntries = readStoredZip(allZip.buffer);
  assertZipImages(allZipEntries, jobs.length, jobs.map(({ metadata }) => metadata.naming));

  const cleanupResult = await cleanup();
  const report = {
    ok: true,
    baseUrl,
    batchId,
    workflowId: composePayload.workflow.id,
    planPreview: {
      title: composePayload.planPreview.title,
      estimatedCount: composePayload.planPreview.estimatedCount,
      usedItems: planItems.map((item) => ({
        id: item.id,
        title: item.title,
        slot: item.slot,
        ratio: item.ratio,
      })),
    },
    seedSummary,
    jobs: jobs.map(({ job, artifact, metadata }) => ({
      jobId: job.id,
      artifactId: artifact.id,
      naming: metadata.naming,
    })),
    reviewSessionId: session.id,
    approvedJobId: approvedJob.id,
    exportPackSync: approvePayload.exportPackSync,
    approvedZip: {
      path: approvedZipPath,
      bytes: approvedZip.buffer.byteLength,
      entries: approvedZipEntries.map((entry) => entry.path),
    },
    allZip: {
      path: allZipPath,
      bytes: allZip.buffer.byteLength,
      entries: allZipEntries.map((entry) => entry.path),
    },
    cleanup: cleanupResult,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    [
      `Plan-to-approved-export-pack smoke passed on ${baseUrl}.`,
      `Plan items: ${planItems.length}; approved ZIP images: 1; all ZIP images: ${jobs.length}.`,
      `Report: ${reportPath}`,
      `Approved ZIP: ${approvedZipPath}`,
      `All ZIP: ${allZipPath}`,
      `Cleanup: ${cleanupResult.clean ? "clean" : "residual records found"}`,
    ].join("\n")
  );
} catch (error) {
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-4000));
  }
  process.exitCode = 1;
} finally {
  if (process.exitCode) {
    await cleanup().catch(() => {});
  }
  if (server) {
    server.kill("SIGTERM");
  }
}

function assertComposePayload(payload) {
  if (!payload.workflowDraft) throw new Error("Expected workflowDraft in compose response");
  if (!payload.workflow?.id) throw new Error("Expected saved workflow when saveWorkflow=true");
  if (!payload.planPreview) throw new Error("Expected planPreview when previewPlan=true");
  if (!Array.isArray(payload.planPreview.items) || payload.planPreview.items.length < 2) {
    throw new Error("Expected multiple planPreview items");
  }
  if (!Array.isArray(payload.workflowDraft.nodes) || payload.workflowDraft.nodes.length < 5) {
    throw new Error("Expected workflowDraft nodes");
  }
  if (!Array.isArray(payload.workflowDraft.edges) || payload.workflowDraft.edges.length < 4) {
    throw new Error("Expected workflowDraft edges");
  }
}

function buildExportPackMetadata({ item, index, total }) {
  const slot = cleanSegment(item.slot || item.id || `image_${index + 1}`);
  return {
    source: "smoke-plan-to-approved-export-pack",
    batchId,
    batchIndex: index,
    batchTotal: total,
    batchJobTitle: item.title || `Smoke Plan Item ${index + 1}`,
    exportPackId: "smoke-plan-preview-pack",
    exportPackTitle: "Smoke Plan Preview Export Pack",
    exportItemId: item.id || slot,
    exportItemTitle: item.title || slot,
    exportSpecId: item.id || slot,
    exportSpecTitle: item.title || slot,
    platform: item.platform || "smoke",
    size: "64x64",
    ratio: "1:1",
    imageWidth: 64,
    imageHeight: 64,
    naming: `smoke_${String(index + 1).padStart(2, "0")}_${slot}`,
    planPreviewItemId: item.id,
    planPreviewSlot: item.slot,
    planPreviewRatio: item.ratio,
    exportPack: {
      batchId,
      sourceWorkflow: "workflow-compose-preview",
      approvedOnlySmoke: true,
    },
  };
}

function buildReviewSessionPayload(manifest, qa) {
  const qaByJobId = new Map(qa.items.map((item) => [item.jobId, item]));
  return {
    title: `${manifest.title} plan smoke review`,
    items: manifest.items.map((item) => ({
      id: item.jobId,
      title: item.title,
      imageUrl: item.artifact?.url || "",
      status: "pending",
      sourceId: item.jobId,
      metadata: {
        batchId: manifest.batchId,
        artifactId: item.artifact?.artifactId,
        specId: item.specId,
        naming: item.naming,
      },
    })),
    qualityChecks: manifest.items.flatMap((item) => {
      const qaItem = qaByJobId.get(item.jobId);
      return (qaItem?.checks || []).map((check) => ({
        id: `${item.jobId}:${check.id}`,
        itemId: item.jobId,
        label: check.label,
        status: check.status === "manual" ? "manual" : check.status,
        message: check.message,
        metadata: { checkId: check.id },
      }));
    }),
    metadata: {
      source: "export_pack",
      batchId: manifest.batchId,
      smoke: "plan-to-approved-export-pack",
    },
  };
}

function assertQaStatuses(qa, jobs, expectedStatus) {
  for (const { job } of jobs) assertQaStatus(qa, job.id, expectedStatus);
}

function assertQaStatus(qa, jobId, expectedStatus) {
  const item = qa.items.find((candidate) => candidate.jobId === jobId);
  if (!item) throw new Error(`Missing QA item for ${jobId}`);
  if (item.status !== expectedStatus) {
    throw new Error(`Expected ${jobId} QA status ${expectedStatus}, got ${item.status}`);
  }
}

function assertZipHeaders(response, { mode, images, skipped }) {
  const actualMode = response.headers.get("x-export-pack-mode");
  const actualImages = Number(response.headers.get("x-export-pack-images"));
  const actualSkipped = Number(response.headers.get("x-export-pack-skipped-artifacts"));
  if (actualMode !== mode) throw new Error(`Expected ZIP mode ${mode}, got ${actualMode}`);
  if (actualImages !== images) throw new Error(`Expected ZIP images ${images}, got ${actualImages}`);
  if (actualSkipped !== skipped) {
    throw new Error(`Expected ZIP skipped ${skipped}, got ${actualSkipped}`);
  }
}

function assertZipImages(entries, expectedCount, expectedNaming) {
  const images = entries.filter((entry) => entry.path.startsWith("images/"));
  if (images.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} image entries, got ${images.length}`);
  }
  for (const image of images) {
    if (!isPng(image.data)) throw new Error(`ZIP image ${image.path} is not a readable PNG`);
  }
  for (const naming of expectedNaming) {
    const expected = `images/${cleanSegment(naming)}.png`;
    if (!images.some((entry) => entry.path === expected)) {
      throw new Error(`ZIP missing expected approved/readable image ${expected}`);
    }
  }
}

function readStoredZip(buffer) {
  const entries = [];
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const fileNameStart = offset + 30;
    const dataStart = fileNameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (method !== 0) throw new Error("Expected stored ZIP entries");
    if (dataEnd > buffer.length) throw new Error("ZIP entry extends beyond buffer");
    entries.push({
      path: buffer.toString("utf8", fileNameStart, fileNameStart + fileNameLength),
      data: buffer.subarray(dataStart, dataEnd),
    });
    offset = dataEnd;
  }
  if (!entries.some((entry) => entry.path === "manifest.json")) {
    throw new Error("ZIP missing manifest.json");
  }
  if (!entries.some((entry) => entry.path === "qa-report.json")) {
    throw new Error("ZIP missing qa-report.json");
  }
  return entries;
}

async function requestJson(url, init = {}) {
  const response = await fetchWithRetry(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`Request failed ${response.status} ${url}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function fetchWithRetry(url, init, attempts = 3) {
  let lastResponse;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, init);
    lastResponse = response;
    const contentType = response.headers.get("content-type") || "";
    if (response.ok || contentType.includes("application/json") || attempt === attempts) {
      return response;
    }
    await response.arrayBuffer().catch(() => {});
    await sleep(500 * attempt);
  }
  return lastResponse;
}

async function requestBinary(url) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  if (!response.ok) {
    throw new Error(`Binary request failed ${response.status} ${url}`);
  }
  return {
    response,
    buffer: Buffer.from(arrayBuffer),
  };
}

async function waitForServer(url) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 45_000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(750);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function cleanup() {
  const result = {
    workflowIds: [...created.workflowIds],
    jobIds: [...created.jobIds],
    artifactIds: [...created.artifactIds],
    reviewSessionIds: [...created.reviewSessionIds],
    deleted: {
      workflows: 0,
      jobs: 0,
      artifacts: 0,
      reviewSessions: 0,
    },
    residual: {
      workflows: [],
      jobs: [],
      artifacts: [],
      reviewSessions: [],
    },
    clean: false,
  };

  for (const id of created.reviewSessionIds) {
    const response = await fetch(`${baseUrl}/api/review-sessions?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => undefined);
    if (response?.ok) result.deleted.reviewSessions += 1;
  }

  for (const id of created.artifactIds) {
    const response = await fetch(`${baseUrl}/api/artifacts/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => undefined);
    if (response?.ok) result.deleted.artifacts += 1;
  }

  if (created.jobIds.length > 0) {
    const db = new Database(path.join(process.cwd(), ".data", "image-master.db"));
    try {
      const deleteJob = db.prepare("DELETE FROM generation_jobs WHERE id = ?");
      const tx = db.transaction((ids) => {
        let changes = 0;
        for (const id of ids) changes += deleteJob.run(id).changes;
        return changes;
      });
      result.deleted.jobs = tx(created.jobIds);
    } finally {
      db.close();
    }
  }

  for (const id of created.workflowIds) {
    const response = await fetch(`${baseUrl}/api/workflows/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => undefined);
    if (response?.ok) result.deleted.workflows += 1;
  }

  result.residual = await verifyCleanup();
  result.clean =
    result.residual.workflows.length === 0 &&
    result.residual.jobs.length === 0 &&
    result.residual.artifacts.length === 0 &&
    result.residual.reviewSessions.length === 0;
  return result;
}

async function verifyCleanup() {
  const residual = {
    workflows: [],
    jobs: [],
    artifacts: [],
    reviewSessions: [],
  };

  for (const id of created.workflowIds) {
    const response = await fetch(`${baseUrl}/api/workflows/${encodeURIComponent(id)}`).catch(
      () => undefined
    );
    if (response && response.status !== 404) residual.workflows.push(id);
  }
  for (const id of created.artifactIds) {
    const response = await fetch(`${baseUrl}/api/artifacts/${encodeURIComponent(id)}`).catch(
      () => undefined
    );
    if (response && response.status !== 404) residual.artifacts.push(id);
  }
  for (const id of created.reviewSessionIds) {
    const response = await fetch(`${baseUrl}/api/review-sessions?id=${encodeURIComponent(id)}`).catch(
      () => undefined
    );
    if (response && response.status !== 404) residual.reviewSessions.push(id);
  }

  if (created.jobIds.length > 0) {
    const db = new Database(path.join(process.cwd(), ".data", "image-master.db"));
    try {
      const getJob = db.prepare("SELECT id FROM generation_jobs WHERE id = ?");
      residual.jobs = created.jobIds.filter((id) => Boolean(getJob.get(id)));
    } finally {
      db.close();
    }
  }

  return residual;
}

function smokePngDataUrl(index) {
  const colors = [
    [42, 111, 219, 255],
    [236, 147, 65, 255],
    [45, 160, 115, 255],
    [174, 83, 188, 255],
  ];
  const color = colors[index % colors.length];
  return `data:image/png;base64,${createPng(64, 64, color).toString("base64")}`;
}

function createPng(width, height, color) {
  const bytesPerPixel = 4;
  const rowSize = 1 + width * bytesPerPixel;
  const raw = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowSize;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixelStart = rowStart + 1 + x * bytesPerPixel;
      raw[pixelStart] = color[0];
      raw[pixelStart + 1] = color[1];
      raw[pixelStart + 2] = color[2];
      raw[pixelStart + 3] = color[3];
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", createIhdr(width, height)),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function createIhdr(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return ihdr;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  const table = getCrc32Table();
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function getCrc32Table() {
  if (crc32Table) return crc32Table;
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  crc32Table = table;
  return table;
}

function isPng(buffer) {
  return (
    buffer.length > 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function cleanSegment(value) {
  return String(value || "image")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "image";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
