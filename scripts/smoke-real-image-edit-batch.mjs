#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const BASE_URL = process.env.REAL_IMAGE_EDIT_SMOKE_BASE_URL || "http://127.0.0.1:3461";
const OUT_DIR = path.join(ROOT, "test_artifacts", "api-smoke");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(OUT_DIR, `real-image-edit-batch-smoke-${timestamp}.json`);
const referencePath =
  process.env.REAL_IMAGE_EDIT_REFERENCE_PATH ||
  path.join(OUT_DIR, "product-reference-smoke.png");
const outputPath = path.join(OUT_DIR, `real-image-edit-batch-smoke-${timestamp}.png`);

const payload = {
  images: [
    {
      type: "main",
      title: "商品参考图一致性 smoke",
      copyText: "参考图一致性",
      prompt:
        "Create a premium ecommerce hero image using the provided product reference as the visual source. Preserve the product silhouette, label placement, main colors, and material cues. Place it on a clean warm-white studio surface with soft shadows, subtle reflection, commercial lighting, and no extra text or logos. Output should look like a finished product listing image.",
    },
  ],
  style: "premium ecommerce studio",
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
  });

  if (!dryRun.ok || !dryRun.estimate?.usesProductReference) {
    await writeReport({
      ok: false,
      stage: "dryRun",
      settings: publicSettings(settings),
      dryRun,
      referencePath,
      reportPath,
    });
    throw new Error("Dry-run did not confirm product-reference generation.");
  }

  const real = await postJson("/api/images/generate/batch", {
    ...payload,
    productImageBase64,
    dryRun: false,
    confirmedProviderCallLimit: dryRun.estimate.maxProviderCallCount ?? dryRun.estimate.providerCallCount,
  });
  const image = real.images?.[0];

  if (!image?.url || image.error) {
    await writeReport({
      ok: false,
      stage: "provider",
      settings: publicSettings(settings),
      dryRun,
      response: real,
      firstError: image?.error || real.error || null,
      firstErrorCode: image?.errorCode || null,
      referencePath,
      reportPath,
    });
    throw new Error(`Provider image edit failed: ${image?.error || real.error || "unknown error"}`);
  }

  const imageBytes = await resolveImageBytes(image.url);
  await fs.writeFile(outputPath, imageBytes);

  await writeReport({
    ok: true,
    stage: "done",
    baseUrl: BASE_URL,
    settings: publicSettings(settings),
    dryRunEstimate: dryRun.estimate,
    guardrails: real.guardrails,
    providerCallCount: real.estimate?.providerCallCountUsed ?? 1,
    retryCount: real.estimate?.retryCount ?? 0,
    referencePath,
    referenceBytes: referenceBytes.length,
    outputPath,
    outputBytes: imageBytes.length,
    imageId: image.id,
    imageType: image.type,
    reportPath,
  });

  console.log(`Real image-to-image smoke passed on ${BASE_URL}.`);
  console.log(`Reference: ${referencePath}`);
  console.log(`Output: ${outputPath}`);
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
  const res = await fetch(`${BASE_URL}${route}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`${route} failed with ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function postJson(route, body) {
  const res = await fetch(`${BASE_URL}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const json = await res.json().catch(async () => ({ raw: await res.text() }));
  if (!res.ok) {
    return { ...json, httpStatus: res.status };
  }
  return json;
}

async function resolveImageBytes(url) {
  const dataUrlMatch = url.match(/^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i);
  if (dataUrlMatch) return Buffer.from(dataUrlMatch[1], "base64");

  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Image URL fetch failed with ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
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

async function writeReport(report) {
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
