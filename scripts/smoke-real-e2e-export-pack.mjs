#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const BASE_URL = process.env.REAL_E2E_EXPORT_PACK_BASE_URL || "http://127.0.0.1:3461";
const OUT_DIR = path.join(ROOT, "test_artifacts", "api-smoke");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const batchId = `real_e2e_export_${timestamp.replace(/[^0-9TZ-]/g, "-")}`;
const workflowId = `workflow_${batchId}`;
const nodeId = `node_${batchId}`;
const reportPath = path.join(OUT_DIR, `real-e2e-export-pack-${timestamp}.json`);
const approvedZipPath = path.join(OUT_DIR, `real-e2e-export-pack-${timestamp}-approved.zip`);
const referencePath =
  process.env.REAL_IMAGE_EDIT_REFERENCE_PATH ||
  path.join(OUT_DIR, "product-reference-smoke.png");
let reportWritten = false;

const payload = {
  images: [
    {
      type: "hero",
      title: "E2E Hero",
      copyText: "高端商品主视觉",
      exportSpecId: "e2e-hero-square",
      naming: "e2e-hero",
      size: "1024x1024",
      ratio: "1:1",
      whiteBackground: false,
      textAllowed: false,
      modelRequired: false,
      qualityRules: ["product-reference consistency", "commercial hero quality"],
      prompt:
        "Using the provided product reference, create a premium ecommerce hero image. Preserve the bottle silhouette, teal body, dark cap, cream label placement, and label proportions. Place the product on a warm-white studio surface with soft shadow, refined reflection, shallow depth of field, and no added text or extra logos.",
    },
    {
      type: "detail",
      title: "E2E Detail",
      copyText: "质感细节图",
      exportSpecId: "e2e-detail-square",
      naming: "e2e-detail",
      size: "1024x1024",
      ratio: "1:1",
      whiteBackground: false,
      textAllowed: false,
      modelRequired: false,
      qualityRules: ["product-reference consistency", "detail texture quality"],
      prompt:
        "Using the same product reference, create a close-up commercial detail image focused on the label, cap texture, and glossy bottle material. Preserve the product color palette and brand-label geometry. Use warm studio lighting, clean background, no extra text, and a visual language consistent with the hero image.",
    },
  ],
  style: "premium ecommerce studio set",
  modelIds: [],
};

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await ensureReferenceImage(referencePath);

  const referenceBytes = await fs.readFile(referencePath);
  const productImageBase64 = `data:image/png;base64,${referenceBytes.toString("base64")}`;
  const settings = await getJson("/api/settings");
  if (!settings.hasImageKey && !settings.hasKey) {
    throw new Error("Image provider key is not configured. Open /settings first.");
  }

  const dryRun = await postJson("/api/images/generate/batch", {
    ...payload,
    productImageBase64,
    dryRun: true,
    persistProjectBatch: true,
    batchId,
    workflowId,
    nodeId,
    batchTitle: "Real E2E Export Pack",
    platform: "mvp_e2e",
  });

  if (!dryRun.ok || dryRun.estimate?.providerCallCount !== payload.images.length) {
    await writeReport({ ok: false, stage: "dryRun", settings: publicSettings(settings), dryRun });
    throw new Error("Dry-run did not confirm the expected real E2E provider-call count.");
  }
  if (!dryRun.estimate?.usesProductReference) {
    throw new Error("Dry-run did not confirm product-reference mode.");
  }

  const real = await postJson("/api/images/generate/batch", {
    ...payload,
    productImageBase64,
    dryRun: false,
    confirmedProviderCallLimit: dryRun.estimate.maxProviderCallCount ?? dryRun.estimate.providerCallCount,
    persistProjectBatch: true,
    batchId,
    workflowId,
    nodeId,
    batchTitle: "Real E2E Export Pack",
    platform: "mvp_e2e",
  });

  const failures = (real.images || [])
    .map((image, index) => ({
      index,
      title: image?.title ?? payload.images[index]?.title,
      error: image?.error || null,
      errorCode: image?.errorCode || null,
      hasUrl: !!image?.url,
    }))
    .filter((item) => item.error || !item.hasUrl);

  if (failures.length > 0 || !real.persistence || real.persistence.successCount < payload.images.length) {
    const [jobs, artifacts] = await Promise.all([
      safeGetJson(`/api/jobs?batchId=${encodeURIComponent(batchId)}`),
      safeGetJson(`/api/artifacts?batchId=${encodeURIComponent(batchId)}`),
    ]);
    await writeReport({
      ok: false,
      stage: "provider",
      settings: publicSettings(settings),
      dryRun,
      realEstimate: real.estimate,
      guardrails: real.guardrails,
      failures,
      persistence: real.persistence,
      jobs: summarizeJobs(jobs),
      artifacts: summarizeArtifacts(artifacts),
    });
    throw new Error(`Real E2E provider batch failed: ${failures[0]?.error || "persistence incomplete"}`);
  }

  const artifacts = await getJson("/api/artifacts");
  const persistedArtifacts = artifacts.filter((artifact) =>
    real.persistence.artifactIds.includes(artifact.id)
  );
  if (persistedArtifacts.length !== payload.images.length) {
    throw new Error(`Expected ${payload.images.length} persisted artifacts, found ${persistedArtifacts.length}`);
  }

  const review = await postJson("/api/review-sessions", {
    title: "Real E2E Export Pack Review",
    items: persistedArtifacts.map((artifact) => ({
      id: `review_item_${artifact.jobId}`,
      title: artifact.title,
      imageUrl: artifact.url,
      sourceId: artifact.jobId,
      metadata: {
        source: "real-e2e-export-pack",
        batchId,
        jobId: artifact.jobId,
        artifactId: artifact.id,
      },
    })),
    qualityChecks: persistedArtifacts.map((artifact) => ({
      id: `manual_${artifact.jobId}`,
      itemId: `review_item_${artifact.jobId}`,
      label: "Manual commercial approval",
      status: "manual",
      severity: "medium",
      message: "Approve before exporting approved ZIP.",
      metadata: {
        source: "real-e2e-export-pack",
        batchId,
        jobId: artifact.jobId,
        artifactId: artifact.id,
      },
    })),
    metadata: {
      source: "real-e2e-export-pack",
      batchId,
      workflowId,
      nodeId,
    },
  });

  let reviewSession = review.session;
  for (const item of reviewSession.itemList) {
    const patched = await patchJson(`/api/review-sessions?id=${encodeURIComponent(reviewSession.id)}`, {
      action: "approve_item",
      itemId: item.id,
      metadata: {
        reviewer: "real-e2e-export-pack",
      },
    });
    if (patched.exportPackSync?.status !== "synced") {
      throw new Error(`Review approval did not sync to export pack QA for ${item.id}`);
    }
    reviewSession = patched.session;
  }

  const manifest = await getJson(`/api/export-packs/${encodeURIComponent(batchId)}/manifest`);
  const qa = await getJson(`/api/export-packs/${encodeURIComponent(batchId)}/qa`);
  const approvedZip = await getBytes(`/api/export-packs/${encodeURIComponent(batchId)}/download?approvedOnly=1`);
  await fs.writeFile(approvedZipPath, approvedZip);

  await writeReport({
    ok: true,
    stage: "done",
    baseUrl: BASE_URL,
    batchId,
    workflowId,
    nodeId,
    settings: publicSettings(settings),
    dryRunEstimate: dryRun.estimate,
    realEstimate: real.estimate,
    guardrails: real.guardrails,
    persistence: real.persistence,
    artifactIds: persistedArtifacts.map((artifact) => artifact.id),
    reviewSessionId: reviewSession.id,
    qaStatus: qa.qa?.status,
    manifestItemCount: manifest.manifest?.items?.length ?? 0,
    approvedZipPath,
    approvedZipBytes: approvedZip.length,
    referencePath,
    referenceBytes: referenceBytes.length,
  });

  console.log(`Real E2E export pack passed on ${BASE_URL}.`);
  console.log(`Batch: ${batchId}`);
  console.log(`Approved ZIP: ${approvedZipPath}`);
  console.log(`Report: ${reportPath}`);
}

async function ensureReferenceImage(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > 0) return;
  } catch {
    // create below
  }

  const sharp = await import("sharp");
  const svg = `
    <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1024" fill="#f8f5ef"/>
      <ellipse cx="512" cy="828" rx="260" ry="44" fill="#c9bda9" opacity="0.38"/>
      <rect x="389" y="190" width="246" height="622" rx="62" fill="#0e6f6b"/>
      <rect x="430" y="120" width="164" height="98" rx="26" fill="#173f4a"/>
      <rect x="418" y="366" width="188" height="214" rx="22" fill="#fff9ef"/>
      <text x="512" y="438" text-anchor="middle" font-family="Arial, sans-serif" font-size="44" font-weight="700" fill="#173f4a">AURA</text>
      <text x="512" y="493" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" fill="#a77937">BOTANIC</text>
      <path d="M468 542 C493 510 530 510 556 542" fill="none" stroke="#0e6f6b" stroke-width="13" stroke-linecap="round"/>
      <circle cx="512" cy="604" r="32" fill="#f1c46d"/>
      <rect x="421" y="636" width="182" height="30" rx="15" fill="#173f4a" opacity="0.86"/>
    </svg>
  `;
  const buffer = await sharp.default(Buffer.from(svg)).png().toBuffer();
  await fs.writeFile(filePath, buffer);
}

async function getJson(route) {
  const response = await fetch(`${BASE_URL}${route}`, {
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${route} failed with ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function safeGetJson(route) {
  try {
    return await getJson(route);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function postJson(route, body) {
  const response = await fetch(`${BASE_URL}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) return { ...json, httpStatus: response.status };
  return json;
}

async function patchJson(route, body) {
  const response = await fetch(`${BASE_URL}${route}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${route} failed with ${response.status}: ${text.slice(0, 500)}`);
  }
  return json;
}

async function getBytes(route) {
  const response = await fetch(`${BASE_URL}${route}`, {
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    throw new Error(`${route} failed with ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function publicSettings(settings) {
  return {
    imageModel: settings.imageModel,
    imageBaseUrl: settings.imageBaseUrl,
    baseUrl: settings.baseUrl,
    hasImageKey: settings.hasImageKey,
    hasKey: settings.hasKey,
  };
}

function summarizeJobs(value) {
  const jobs = Array.isArray(value) ? value : [];
  return jobs.map((job) => ({
    id: job.id,
    status: job.status,
    error: job.error || "",
    errorCode: job.metadata?.errorCode,
    batchIndex: job.metadata?.batchIndex,
    providerDiagnostics: summarizeDiagnostics(job.metadata?.providerDiagnostics),
  }));
}

function summarizeArtifacts(value) {
  const artifacts = Array.isArray(value) ? value : [];
  return artifacts.map((artifact) => ({
    id: artifact.id,
    jobId: artifact.jobId,
    status: artifact.status,
    hasUrl: !!artifact.url,
    title: artifact.title,
  }));
}

function summarizeDiagnostics(value) {
  if (!value || typeof value !== "object") return undefined;
  return {
    code: value.code,
    status: value.status,
    mode: value.mode,
    endpoint: value.endpoint,
    providerHost: value.providerHost,
    responseShape: value.responseShape,
  };
}

async function writeReport(report) {
  await fs.writeFile(reportPath, `${JSON.stringify({ reportPath, ...report }, null, 2)}\n`);
  reportWritten = true;
}

main().catch(async (error) => {
  console.error(error);
  try {
    if (!reportWritten) {
      await writeReport({
        ok: false,
        stage: "uncaught",
        batchId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } catch {
    // Ignore report write errors during failure handling.
  }
  process.exit(1);
});
