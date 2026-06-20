#!/usr/bin/env node

import { spawn } from "node:child_process";

const port = Number(process.env.ASSET_PACK_GENERATE_SMOKE_PORT || 3471);
const externalBaseUrl = process.env.ASSET_PACK_GENERATE_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
let server;
let serverOutput = "";

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      IMAGE_MASTER_ENABLE_MOCK_BATCH: "1",
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

  const sourceImage =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
  const requestBody = {
    category: "style_asset",
    userRequest: "低饱和高级电商风格，柔和日光，干净材质，适合一组商业产品图",
    sourceImages: [
      {
        role: "style",
        title: "Smoke style reference",
        url: sourceImage,
      },
    ],
  };

  const dryRun = await requestJson(`${baseUrl}/api/asset-packs/generate`, {
    method: "POST",
    body: JSON.stringify({
      ...requestBody,
      dryRun: true,
    }),
  });

  if (dryRun.dryRun !== true) throw new Error("Expected asset-pack dryRun response");
  if (dryRun.assetPack?.category !== "style_asset") throw new Error("Expected style asset pack");
  if (dryRun.estimate?.providerCallCount !== 1) throw new Error("Expected one provider call estimate");
  if (dryRun.estimate?.usesProductReference !== true) {
    throw new Error("Expected source reference to be provider usable");
  }
  if (!String(dryRun.generationPlan?.prompt || "").includes("visual style reference")) {
    throw new Error("Expected generated prompt to include asset role");
  }

  const secondSourceImage =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAQAAABeK7cBAAAADUlEQVR42mNk+M8AAwUBAcgn1WQAAAAASUVORK5CYII=";
  const productMultiDryRun = await requestJson(`${baseUrl}/api/asset-packs/generate`, {
    method: "POST",
    body: JSON.stringify({
      category: "product_asset",
      userRequest: "同一咖啡机多角度商品图，合成一张白底多视角商品资产卡",
      sourceImages: [
        { role: "product", title: "Front", url: sourceImage },
        { role: "product", title: "Side", url: secondSourceImage },
      ],
      dryRun: true,
    }),
  });

  if (productMultiDryRun.generationPlan?.metadata?.promptFamily !== "product.multiview-white-sheet.v1") {
    throw new Error("Expected product asset dry-run to expose the multi-view prompt family");
  }
  if (productMultiDryRun.generationPlan?.providerReferenceUrls?.length !== 2) {
    throw new Error("Expected product asset dry-run to preserve multiple provider references");
  }
  if (!String(productMultiDryRun.generationPlan?.prompt || "").includes("Treat every attached image as the same physical product")) {
    throw new Error("Expected product asset prompt to consolidate multiple product references");
  }
  if (productMultiDryRun.generationPlan?.outputSize !== "1536x1024") {
    throw new Error("Expected product asset dry-run to request a horizontal reference board");
  }
  if (!(productMultiDryRun.estimate?.referenceImageBytes > dryRun.estimate?.referenceImageBytes)) {
    throw new Error("Expected multi-reference product estimate to include combined reference bytes");
  }

  const productNoReference = await requestJson(
    `${baseUrl}/api/asset-packs/generate`,
    {
      method: "POST",
      body: JSON.stringify({
        category: "product_asset",
        userRequest: "纯文字描述的咖啡机多角度商品图",
        sourceImages: [],
        dryRun: true,
      }),
    },
    400
  );

  if (productNoReference.code !== "PRODUCT_REFERENCE_REQUIRED") {
    throw new Error("Expected product asset generation without source photos to be rejected");
  }

  const modelDryRun = await requestJson(`${baseUrl}/api/asset-packs/generate`, {
    method: "POST",
    body: JSON.stringify({
      category: "model_asset",
      userRequest: "乌克兰美女商业模特，短发，高级干净电商视觉",
      sourceImages: [],
      dryRun: true,
    }),
  });

  const modelPrompt = String(modelDryRun.generationPlan?.prompt || "");
  if (!modelPrompt.includes("Create one reusable commercial model asset sheet")) {
    throw new Error("Expected model asset dry-run to use the reusable model asset sheet prompt");
  }
  if (!modelPrompt.includes("Zone A is a small library display card")) {
    throw new Error("Expected model asset dry-run to separate library display and downstream identity zones");
  }
  if (!modelPrompt.includes("Zone B is the downstream identity reference zone")) {
    throw new Error("Expected model asset dry-run to expose the downstream identity reference zone");
  }
  const fullModelTemplatePrompt = String(modelDryRun.generationPlan?.metadata?.fullTemplatePromptSnapshot || "");
  if (!fullModelTemplatePrompt.includes("Create one reusable commercial model asset sheet")) {
    throw new Error("Expected model asset dry-run to preserve the full model asset sheet template");
  }
  if (!fullModelTemplatePrompt.includes("soft diffuse daylight")) {
    throw new Error("Expected full model template to use diffuse low-contrast model-card lighting");
  }
  if (!fullModelTemplatePrompt.includes("Zone B pose rules: the large 3/4 identity reference uses low relaxed shoulders")) {
    throw new Error("Expected full model template to use concrete downstream identity pose rules");
  }
  if (/feel like a photographer is gently guiding/i.test(fullModelTemplatePrompt)) {
    throw new Error("Model asset prompt should not use vague photographer-guidance wording");
  }
  if (!modelDryRun.generationPlan?.metadata?.downstreamReferenceRules?.some?.((rule) =>
    String(rule).includes("Final scene lighting and pose instructions override this asset sheet")
  )) {
    throw new Error("Expected model asset dry-run to expose downstream identity override rules");
  }
  if (modelDryRun.generationPlan?.metadata?.promptFamily !== "model-template.character-sheet.v1") {
    throw new Error("Expected model asset dry-run to expose the model template prompt family");
  }
  if (modelDryRun.generationPlan?.metadata?.providerPromptMode !== "single-reference-safe") {
    throw new Error("Expected model asset dry-run to expose provider-safe prompt mode");
  }
  if (modelDryRun.generationPlan?.metadata?.modelTemplateLayout !== "model-card-plus-downstream-reference.v3") {
    throw new Error("Expected model asset dry-run to expose the current model card plus downstream reference layout");
  }
  if (modelDryRun.generationPlan?.outputSize !== "1536x1024") {
    throw new Error("Expected model asset dry-run to request a 3:2 horizontal model card");
  }
  if (modelDryRun.generationPlan?.metadata?.modelAssetMetadata?.source !== "model-template") {
    throw new Error("Expected model asset dry-run to expose model-template metadata");
  }

  const unconfirmed = await requestJson(
    `${baseUrl}/api/asset-packs/generate`,
    {
      method: "POST",
      body: JSON.stringify({
        ...requestBody,
        dryRun: false,
      }),
    },
    402
  );

  if (unconfirmed.code !== "PROVIDER_CALL_LIMIT_NOT_CONFIRMED") {
    throw new Error("Expected provider-call confirmation guard");
  }

  const generated = await requestJson(`${baseUrl}/api/asset-packs/generate`, {
    method: "POST",
    body: JSON.stringify({
      ...requestBody,
      dryRun: false,
      confirmedProviderCallLimit: dryRun.estimate.maxProviderCallCount,
      mockResults: [{ base64: sourceImage.replace(/^data:image\/png;base64,/, "") }],
    }),
  });

  if (generated.dryRun !== false) throw new Error("Expected real generation response");
  if (!generated.referenceImage?.url?.startsWith("/api/generated-images/")) {
    throw new Error("Expected locally stored generated reference image");
  }
  if (generated.assetPack?.buildMode !== "generated") throw new Error("Expected generated build mode");
  if (generated.assetPack?.status !== "ready") throw new Error("Expected generated asset pack ready status");
  if (generated.assetPack?.providerUsablePrimaryReference !== generated.referenceImage.url) {
    throw new Error("Expected generated reference to become primary provider reference");
  }

  console.log(
    `Asset pack generate smoke passed on ${baseUrl}: dry-run, spend guard, mock real image, and local reference storage.`
  );
} catch (error) {
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-4000));
  }
  process.exitCode = 1;
} finally {
  if (server) server.kill("SIGTERM");
}

async function requestJson(url, init = {}, expectedStatus = 200) {
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
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status} from ${url}: ${JSON.stringify(payload)}`
    );
  }
  return payload;
}

async function waitForServer(url) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 45000) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}
