import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";

const port = Number(process.env.REVIEW_EXPORT_PACK_BRIDGE_SMOKE_PORT || 3469);
const externalBaseUrl = process.env.REVIEW_EXPORT_PACK_BRIDGE_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = Date.now();
const batchId = `smoke_review_bridge_${stamp}`;
const workflowId = `workflow_smoke_review_bridge_${stamp}`;
const nodeId = `node_smoke_review_bridge_${stamp}`;
const assetId = `asset_smoke_review_bridge_${stamp}`;
const reportPath = path.join(
  process.cwd(),
  "test_artifacts",
  "review-export-pack-bridge-smoke.json"
);
const approvedZipPath = path.join(
  process.cwd(),
  "test_artifacts",
  "review-export-pack-bridge-approved.zip"
);
const allZipPath = path.join(
  process.cwd(),
  "test_artifacts",
  "review-export-pack-bridge-all.zip"
);
let crc32Table;
const created = {
  jobIds: [],
  artifactIds: [],
  reviewSessionIds: [],
};

let server;
let serverOutput = "";

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
  await waitForServer(`${baseUrl}/api/settings`);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });

  const jobs = [];
  for (let index = 0; index < 2; index += 1) {
    const job = await requestJson(`${baseUrl}/api/jobs`, {
      method: "POST",
      body: JSON.stringify({
        workflowId,
        nodeId,
        assetId,
        status: "done",
        prompt: `Smoke review bridge image ${index + 1}`,
        resultUrl: "",
        metadata: buildExportPackMetadata(index),
      }),
    });
    created.jobIds.push(job.id);

    const artifact = await requestJson(`${baseUrl}/api/artifacts`, {
      method: "POST",
      body: JSON.stringify({
        workflowId,
        nodeId,
        jobId: job.id,
        assetId,
        type: "image",
        title: `Smoke bridge artifact ${index + 1}`,
        status: "ready",
        url: smokePngDataUrl(index),
        prompt: `Smoke review bridge image ${index + 1}`,
        provider: "local-smoke",
        model: "data-url-fixture",
        metadata: buildExportPackMetadata(index),
      }),
    });
    created.artifactIds.push(artifact.id);
    jobs.push({ job, artifact });
  }

  const initialQaPayload = await requestJson(`${baseUrl}/api/export-packs/${batchId}/qa`);
  assertQaItemStatus(initialQaPayload.qa, jobs[0].job.id, "manual");
  assertQaItemStatus(initialQaPayload.qa, jobs[1].job.id, "manual");

  const sessionPayload = await requestJson(`${baseUrl}/api/review-sessions`, {
    method: "POST",
    body: JSON.stringify(buildReviewSessionPayload(initialQaPayload.manifest, initialQaPayload.qa)),
  });
  const session = sessionPayload.session;
  if (!session?.id) throw new Error("Expected review session id");
  created.reviewSessionIds.push(session.id);

  const approvePayload = await requestJson(
    `${baseUrl}/api/review-sessions?id=${encodeURIComponent(session.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        action: "approve_item",
        itemId: jobs[0].job.id,
        note: "Approved by review/export-pack bridge smoke.",
        metadata: { reviewer: "smoke-review-export-pack-bridge" },
      }),
    }
  );
  if (approvePayload.exportPackSync?.status !== "synced") {
    throw new Error(`Expected exportPackSync synced, got ${approvePayload.exportPackSync?.status}`);
  }
  if (approvePayload.exportPackSync?.checkCount !== 4) {
    throw new Error("Expected four manual QA checks to sync");
  }

  const reviewedQaPayload = await requestJson(`${baseUrl}/api/export-packs/${batchId}/qa`);
  assertQaItemStatus(reviewedQaPayload.qa, jobs[0].job.id, "pass");
  assertQaItemStatus(reviewedQaPayload.qa, jobs[1].job.id, "manual");

  const approvedZip = await requestBinary(
    `${baseUrl}/api/export-packs/${batchId}/download?approvedOnly=1`
  );
  if (approvedZip.response.headers.get("x-export-pack-mode") !== "approved") {
    throw new Error("Expected approved download mode header");
  }
  if (approvedZip.response.headers.get("x-export-pack-images") !== "1") {
    throw new Error("Expected approved ZIP to contain one image");
  }
  if (approvedZip.response.headers.get("x-export-pack-skipped-artifacts") !== "1") {
    throw new Error("Expected approved ZIP to skip one unapproved image");
  }
  await fs.writeFile(approvedZipPath, approvedZip.buffer);

  const allZip = await requestBinary(`${baseUrl}/api/export-packs/${batchId}/download`);
  if (allZip.response.headers.get("x-export-pack-mode") !== "all") {
    throw new Error("Expected all download mode header");
  }
  if (allZip.response.headers.get("x-export-pack-images") !== "2") {
    throw new Error("Expected all ZIP to contain two images");
  }
  await fs.writeFile(allZipPath, allZip.buffer);

  const report = {
    ok: true,
    baseUrl,
    batchId,
    sessionId: session.id,
    approvedJobId: jobs[0].job.id,
    manualJobId: jobs[1].job.id,
    exportPackSync: approvePayload.exportPackSync,
    qaStatusAfterApprove: reviewedQaPayload.qa.status,
    approvedZip: {
      path: approvedZipPath,
      bytes: approvedZip.buffer.byteLength,
      images: Number(approvedZip.response.headers.get("x-export-pack-images")),
      skipped: Number(approvedZip.response.headers.get("x-export-pack-skipped-artifacts")),
    },
    allZip: {
      path: allZipPath,
      bytes: allZip.buffer.byteLength,
      images: Number(allZip.response.headers.get("x-export-pack-images")),
    },
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Review/export-pack bridge smoke passed on ${baseUrl}: approved ZIP 1 image, all ZIP 2 images.`
  );
} catch (error) {
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-4000));
  }
  process.exitCode = 1;
} finally {
  await cleanup();
  if (server) {
    server.kill("SIGTERM");
  }
}

function buildExportPackMetadata(index) {
  const item = index === 0
    ? { title: "Smoke Main", specId: "main", naming: "smoke_bridge_main" }
    : { title: "Smoke Detail", specId: "detail", naming: "smoke_bridge_detail" };
  return {
    source: "smoke-review-export-pack-bridge",
    batchId,
    batchIndex: index,
    batchTotal: 2,
    batchJobTitle: item.title,
    exportPackId: "smoke-review-export-pack",
    exportPackTitle: "Smoke Review Bridge Pack",
    exportItemId: item.specId,
    exportItemTitle: item.title,
    exportSpecId: item.specId,
    exportSpecTitle: item.title,
    platform: "smoke",
    size: "64x64",
    ratio: "1:1",
    imageWidth: 64,
    imageHeight: 64,
    naming: item.naming,
  };
}

function buildReviewSessionPayload(manifest, qa) {
  const qaByJobId = new Map(qa.items.map((item) => [item.jobId, item]));
  return {
    title: `${manifest.title} bridge smoke`,
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
    },
  };
}

function smokePngDataUrl(index) {
  const color = index === 0 ? [32, 126, 229, 255] : [236, 147, 65, 255];
  return `data:image/png;base64,${createPng(64, 64, color).toString("base64")}`;
}

function assertQaItemStatus(qa, jobId, expectedStatus) {
  const item = qa.items.find((candidate) => candidate.jobId === jobId);
  if (!item) throw new Error(`Missing QA item for ${jobId}`);
  if (item.status !== expectedStatus) {
    throw new Error(`Expected ${jobId} QA status ${expectedStatus}, got ${item.status}`);
  }
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, {
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
  while (Date.now() - started < 45000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function cleanup() {
  for (const id of created.reviewSessionIds) {
    await fetch(`${baseUrl}/api/review-sessions?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => {});
  }
  for (const id of created.artifactIds) {
    await fetch(`${baseUrl}/api/artifacts/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => {});
  }

  if (created.jobIds.length > 0) {
    const db = new Database(path.join(process.cwd(), ".data", "image-master.db"));
    try {
      const deleteJob = db.prepare("DELETE FROM generation_jobs WHERE id = ?");
      const tx = db.transaction((ids) => {
        for (const id of ids) deleteJob.run(id);
      });
      tx(created.jobIds);
    } finally {
      db.close();
    }
  }
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
