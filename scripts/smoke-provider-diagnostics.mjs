#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import ts from "typescript";

const port = Number(process.env.PROVIDER_DIAGNOSTICS_SMOKE_PORT || 3480);
const externalBaseUrl = process.env.PROVIDER_DIAGNOSTICS_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const stamp = Date.now();
const batchId = `smoke_provider_diag_${stamp}`;
const dbPath = path.join(process.cwd(), ".data", "image-master.db");

let server;
let serverOutput = "";

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      IMAGE_MASTER_ENABLE_MOCK_BATCH: "1",
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
  await runProviderAdapterShapeSmoke();
  await waitForServer(`${baseUrl}/api/settings`);

  const diagnostic = buildMockDiagnostic({
    code: "EMPTY_RESULT",
    mode: "image_to_image",
    endpoint: "/images/edits",
    status: 200,
    ok: true,
  });
  const batchResponse = await requestJson(`${baseUrl}/api/images/generate/batch`, {
    method: "POST",
    body: JSON.stringify({
      images: [
        {
          title: "Diagnostics empty result",
          type: "detail",
          copyText: "diagnostics",
          prompt: "Mock prompt that must not be copied into diagnostics.",
        },
      ],
      style: "diagnostics smoke",
      modelIds: [],
      productImageBase64: tinyPngDataUrl(),
      persistProjectBatch: true,
      batchId,
      batchTitle: "Provider Diagnostics Smoke",
      platform: "smoke",
      confirmedProviderCallLimit: 2,
      mockResults: [
        {
          error: "mock empty result",
          errorCode: "EMPTY_RESULT",
          diagnostics: {
            ...diagnostic,
            rawPayload: "SECRET_RAW_PAYLOAD",
            requestHeaders: {
              Authorization: "Bearer SECRET_API_KEY",
            },
          },
        },
      ],
    }),
  });

  if (batchResponse.images?.[0]?.diagnostics?.code !== "EMPTY_RESULT") {
    throw new Error("Expected failed image diagnostics in API response");
  }

  const db = new Database(dbPath);
  try {
    const failedJob = db
      .prepare(
        "SELECT * FROM generation_jobs WHERE json_extract(metadata, '$.batchId') = ? AND status = 'failed' LIMIT 1"
      )
      .get(batchId);
    if (!failedJob) throw new Error("Expected persisted failed job");
    const jobMetadata = parseJson(failedJob.metadata);
    assertDiagnostic(jobMetadata.providerDiagnostics, "batch");

    const retryDiagnostic = buildMockDiagnostic({
      code: "EMPTY_RESULT",
      mode: "image_to_image",
      endpoint: "/images/edits",
      status: 200,
      ok: true,
      requestId: "req_retry_diag",
    });
    const retryFailure = await requestJson(
      `${baseUrl}/api/jobs/${failedJob.id}/retry-image`,
      {
        method: "POST",
        body: JSON.stringify({
          confirmedProviderCallLimit: 2,
          mockResults: [
            {
              error: "mock retry empty result",
              errorCode: "EMPTY_RESULT",
              diagnostics: retryDiagnostic,
            },
          ],
        }),
      },
      502
    );

    if (retryFailure.diagnostics?.requestId !== "req_retry_diag") {
      throw new Error("Expected retry diagnostics in 502 response");
    }

    const updatedJob = db.prepare("SELECT * FROM generation_jobs WHERE id = ?").get(failedJob.id);
    const updatedMetadata = parseJson(updatedJob.metadata);
    assertDiagnostic(updatedMetadata.providerDiagnostics, "retry");

    const batch = db.prepare("SELECT * FROM project_batches WHERE id = ?").get(batchId);
    const batchMetadata = batch ? parseJson(batch.metadata) : {};
    console.log(
      `Provider diagnostics smoke passed on ${baseUrl}: adapter shape extraction, batch diagnostics, and retry diagnostics persisted for ${batchId}.`
    );

    await cleanup(db, { batchId, batchMetadata });
  } finally {
    db.close();
  }
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

function buildMockDiagnostic(overrides) {
  return {
    kind: "image_provider_response",
    code: "EMPTY_RESULT",
    mode: "image_to_image",
    endpoint: "/images/edits",
    providerHost: "api.mock-provider.test",
    model: "mock-image-model",
    status: 200,
    ok: true,
    contentType: "application/json",
    requestId: "req_mock_diag",
    promptChars: 47,
    referenceImageBytes: 68,
    responseShape: {
      topLevelType: "object",
      topLevelKeys: ["created", "data"],
      dataType: "array",
      dataLength: 1,
      firstDataItemType: "object",
      firstDataKeys: ["revised_prompt"],
      firstDataHasB64Json: false,
      firstDataHasUrl: false,
      firstDataHasRevisedPrompt: true,
    },
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function runProviderAdapterShapeSmoke() {
  const {
    buildImageProviderDiagnostic,
    extractFirstProviderImage,
  } = await importCompiledProviderDiagnostics();

  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
  const cases = [
    {
      name: "openai data url",
      payload: { created: 1, data: [{ url: "https://cdn.example.test/image.png" }] },
      expected: { url: "https://cdn.example.test/image.png" },
    },
    {
      name: "nested data image b64",
      payload: { data: [{ revised_prompt: "redacted", image: { b64_json: b64 } }] },
      expected: { b64_json: b64 },
    },
    {
      name: "top-level images",
      payload: { images: [{ url: "https://cdn.example.test/from-images.png" }] },
      expected: { url: "https://cdn.example.test/from-images.png" },
    },
    {
      name: "nested response output",
      payload: { response: { output: [{ content: [{ image: { b64_json: b64 } }] }] } },
      expected: { b64_json: b64 },
    },
  ];

  for (const testCase of cases) {
    const image = extractFirstProviderImage(testCase.payload);
    if (image?.b64_json !== testCase.expected.b64_json || image?.url !== testCase.expected.url) {
      throw new Error(`Provider adapter failed ${testCase.name}`);
    }
  }

  const emptyPrompt = "Prompt that must not appear in provider diagnostics.";
  const emptyDiagnostic = buildImageProviderDiagnostic({
    code: "EMPTY_RESULT",
    mode: "image_to_image",
    endpoint: "/images/edits",
    baseURL: "https://api.mock-provider.test/v1?api_key=SECRET_API_KEY",
    model: "mock-image-model",
    status: 200,
    ok: true,
    headers: new Headers({
      "content-type": "application/json",
      "x-request-id": "req_shape_smoke",
    }),
    prompt: emptyPrompt,
    productImageBase64: tinyPngDataUrl(),
    payload: {
      created: 1,
      data: [{ revised_prompt: "A sanitized provider-only prompt rewrite" }],
      response: {
        output: [{ revised_prompt: "No image bytes here either" }],
      },
      api_key: "SECRET_API_KEY",
      raw: `data:image/png;base64,${b64}`,
    },
  });

  if (extractFirstProviderImage(emptyDiagnostic) !== undefined) {
    throw new Error("Provider adapter should not extract images from diagnostics");
  }
  if (emptyDiagnostic.responseShape?.firstDataHasRevisedPrompt !== true) {
    throw new Error("Expected revised_prompt-only response shape to be recorded");
  }
  if (emptyDiagnostic.responseShape?.responseOutputLength !== 1) {
    throw new Error("Expected nested response output shape to be recorded");
  }
  assertNoDiagnosticLeak(emptyDiagnostic, ["SECRET", "Prompt that must not", b64, "api_key"]);
}

function assertDiagnostic(diagnostic, label) {
  if (!diagnostic || diagnostic.kind !== "image_provider_response") {
    throw new Error(`Expected ${label} provider diagnostic`);
  }
  if (diagnostic.code !== "EMPTY_RESULT") throw new Error(`Unexpected ${label} diagnostic code`);
  if (diagnostic.responseShape?.dataLength !== 1) {
    throw new Error(`Expected ${label} diagnostic response shape`);
  }
  if (diagnostic.responseShape?.firstDataHasB64Json !== false) {
    throw new Error(`Expected ${label} diagnostic to show missing b64_json`);
  }
  if (diagnostic.responseShape?.firstDataHasUrl !== false) {
    throw new Error(`Expected ${label} diagnostic to show missing url`);
  }

  const serialized = JSON.stringify(diagnostic);
  assertNoDiagnosticLeak(diagnostic, ["SECRET", "Authorization", "rawPayload", "requestHeaders", "Mock prompt"]);
}

function assertNoDiagnosticLeak(diagnostic, forbiddenValues) {
  const serialized = JSON.stringify(diagnostic);
  for (const forbidden of forbiddenValues) {
    if (serialized.includes(forbidden)) {
      throw new Error(`Diagnostic leaked forbidden token ${forbidden}`);
    }
  }
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
  const payload = text ? JSON.parse(text) : {};
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
      if (response.ok) return;
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function cleanup(db, { batchId, batchMetadata }) {
  const referenceFilePath = batchMetadata?.referenceImageStorage?.filePath;
  db.prepare("DELETE FROM generated_artifacts WHERE json_extract(metadata, '$.batchId') = ?").run(batchId);
  db.prepare("DELETE FROM generation_jobs WHERE json_extract(metadata, '$.batchId') = ?").run(batchId);
  db.prepare("DELETE FROM project_batches WHERE id = ?").run(batchId);

  if (
    typeof referenceFilePath === "string" &&
    referenceFilePath.includes(`${path.sep}.data${path.sep}generated${path.sep}`) &&
    fs.existsSync(referenceFilePath)
  ) {
    await fsp.unlink(referenceFilePath);
  }
}

function tinyPngDataUrl() {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
}

async function importCompiledProviderDiagnostics() {
  const root = process.cwd();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "image-master-provider-diag-smoke-"));
  const sourcePath = path.join(root, "lib/ai/image-provider-diagnostics.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const compiledPath = path.join(outDir, "image-provider-diagnostics.mjs");
  fs.writeFileSync(compiledPath, output);
  return import(pathToFileURL(compiledPath).href);
}
