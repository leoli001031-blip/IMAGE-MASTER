#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const BASE_URL = process.env.REAL_PLAN_BATCH_SMOKE_BASE_URL || "http://127.0.0.1:3461";
const OUT_DIR = path.join(ROOT, "test_artifacts", "api-smoke");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(OUT_DIR, `real-plan-batch-smoke-${timestamp}.json`);
const referencePath =
  process.env.REAL_IMAGE_EDIT_REFERENCE_PATH ||
  path.join(OUT_DIR, "product-reference-smoke.png");

const payload = {
  images: [
    {
      type: "hero",
      title: "商品组图 Hero",
      copyText: "高端商品主视觉",
      prompt:
        "Using the provided product reference, create a premium ecommerce hero image. Preserve the bottle silhouette, teal body, dark cap, cream label placement, and label proportions. Place the product on a warm-white studio surface with soft shadow, refined reflection, shallow depth of field, and no added text or extra logos.",
    },
    {
      type: "detail",
      title: "商品组图 Detail",
      copyText: "质感细节图",
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
  });

  if (!dryRun.ok || dryRun.estimate?.providerCallCount !== payload.images.length) {
    await writeReport({
      ok: false,
      stage: "dryRun",
      settings: publicSettings(settings),
      dryRun,
      referencePath,
      reportPath,
    });
    throw new Error("Dry-run did not confirm the expected provider-call count.");
  }
  if (!dryRun.estimate?.usesProductReference) {
    throw new Error("Dry-run did not confirm product-reference generation.");
  }
  if (dryRun.estimate?.concurrency !== 1 && dryRun.estimate?.concurrency !== 10) {
    throw new Error(
      `Product-reference batch returned unexpected concurrency=${dryRun.estimate?.concurrency ?? "unknown"}`
    );
  }

  const real = await postJson("/api/images/generate/batch", {
    ...payload,
    productImageBase64,
    dryRun: false,
    confirmedProviderCallLimit: dryRun.estimate.maxProviderCallCount ?? dryRun.estimate.providerCallCount,
  });

  const outputs = [];
  const failures = [];
  for (const [index, image] of (real.images || []).entries()) {
    if (!image?.url || image.error) {
      failures.push({
        index,
        title: image?.title ?? payload.images[index]?.title,
        type: image?.type ?? payload.images[index]?.type,
        error: image?.error || real.error || "unknown error",
        errorCode: image?.errorCode || null,
      });
      continue;
    }

    const bytes = await resolveImageBytes(image.url);
    const safeType = String(image.type || `image-${index + 1}`).replace(/[^a-z0-9_-]+/gi, "-");
    const outputPath = path.join(OUT_DIR, `real-plan-batch-smoke-${timestamp}-${index + 1}-${safeType}.png`);
    await fs.writeFile(outputPath, bytes);
    outputs.push({
      id: image.id,
      title: image.title,
      type: image.type,
      outputPath,
      outputBytes: bytes.length,
    });
  }

  if (failures.length > 0) {
      await writeReport({
        ok: false,
        stage: "provider",
        settings: publicSettings(settings),
        dryRun,
        realEstimate: real.estimate,
        guardrails: real.guardrails,
        failures,
        outputs,
        referencePath,
        reportPath,
      });
      throw new Error(`Provider batch image failed: ${failures[0].error}`);
  }

  await writeReport({
    ok: true,
    stage: "done",
    baseUrl: BASE_URL,
    settings: publicSettings(settings),
    dryRunEstimate: dryRun.estimate,
    realEstimate: real.estimate,
    guardrails: real.guardrails,
    providerCallCount: real.estimate?.providerCallCountUsed ?? dryRun.estimate.providerCallCount,
    retryCount: real.estimate?.retryCount ?? 0,
    referencePath,
    referenceBytes: referenceBytes.length,
    outputs,
    reportPath,
  });

  console.log(`Real 2-image plan batch smoke passed on ${BASE_URL}.`);
  console.log(`Reference: ${referencePath}`);
  for (const output of outputs) {
    console.log(`Output: ${output.outputPath}`);
  }
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
    signal: AbortSignal.timeout(240000),
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
