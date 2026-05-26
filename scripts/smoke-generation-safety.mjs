import { spawn } from "node:child_process";

const port = Number(process.env.GENERATION_SAFETY_SMOKE_PORT || 3470);
const externalBaseUrl = process.env.GENERATION_SAFETY_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
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

  const dryRun = await requestJson(`${baseUrl}/api/images/generate/batch`, {
    method: "POST",
    body: JSON.stringify({
      dryRun: true,
      style: "smoke",
      modelIds: [],
      images: [
        {
          title: "Safety smoke",
          type: "main",
          copyText: "",
          prompt: "A simple local dry-run prompt. Do not call a real provider.",
        },
      ],
    }),
  });

  if (dryRun.dryRun !== true) throw new Error("Expected dryRun response");
  if (dryRun.estimate?.providerCallCount !== 1) {
    throw new Error("Expected dry-run providerCallCount estimate");
  }
  if (dryRun.estimate?.maxProviderCallCount !== 3) {
    throw new Error("Expected dry-run maxProviderCallCount estimate");
  }
  if (dryRun.estimate?.retryPolicy?.transientProviderRetries !== 1) {
    throw new Error("Expected transient provider retry estimate");
  }
  if (dryRun.estimate?.usesProductReference !== false) {
    throw new Error("Expected no product reference in dry-run estimate");
  }

  const referenceDryRun = await requestJson(`${baseUrl}/api/images/generate/batch`, {
    method: "POST",
    body: JSON.stringify({
      dryRun: true,
      style: "smoke",
      modelIds: [],
      productImageBase64:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      images: [
        {
          title: "Reference safety smoke",
          type: "main",
          copyText: "",
          prompt: "A dry-run prompt with a product reference image.",
        },
      ],
    }),
  });

  if (referenceDryRun.estimate?.usesProductReference !== true) {
    throw new Error("Expected product reference dry-run estimate");
  }
  if (!(referenceDryRun.estimate?.referenceImageBytes > 0)) {
    throw new Error("Expected reference byte estimate");
  }
  if (referenceDryRun.estimate?.concurrency !== 1 && referenceDryRun.estimate?.concurrency !== 10) {
    throw new Error("Expected product-reference generation to use the configured safe concurrency");
  }
  if (referenceDryRun.guardrails?.emptyResultRetryLimit !== 1) {
    throw new Error("Expected empty-result retry guardrail");
  }
  if (referenceDryRun.guardrails?.transientProviderRetryLimit !== 1) {
    throw new Error("Expected transient provider retry guardrail");
  }

  const unconfirmedRealRun = await requestJson(
    `${baseUrl}/api/images/generate/batch`,
    {
      method: "POST",
      body: JSON.stringify({
        dryRun: false,
        style: "smoke",
        modelIds: [],
        images: [
          {
            title: "Unconfirmed real run",
            type: "main",
            copyText: "",
            prompt: "This request must be rejected before provider calls because spend was not confirmed.",
          },
        ],
      }),
    },
    402
  );

  if (unconfirmedRealRun.code !== "PROVIDER_CALL_LIMIT_NOT_CONFIRMED") {
    throw new Error("Expected provider-call confirmation guard");
  }
  if (unconfirmedRealRun.requiredConfirmation?.minimum !== 1) {
    throw new Error("Expected provider-call confirmation minimum");
  }

  const tooMany = await requestJson(
    `${baseUrl}/api/images/generate/batch`,
    {
      method: "POST",
      body: JSON.stringify({
        dryRun: true,
        style: "smoke",
        modelIds: [],
        images: Array.from({ length: 7 }, (_, index) => ({
          title: `Too many ${index + 1}`,
          type: "main",
          copyText: "",
          prompt: "This request should be rejected before provider calls.",
        })),
      }),
    },
    400
  );

  if (!String(tooMany.error || "").includes("单次最多生成")) {
    throw new Error("Expected max image guardrail error");
  }

  const badReference = await requestJson(
    `${baseUrl}/api/images/generate/batch`,
    {
      method: "POST",
      body: JSON.stringify({
        dryRun: true,
        style: "smoke",
        modelIds: [],
        productImageBase64: "not-an-image",
        images: [
          {
            title: "Bad reference",
            type: "main",
            copyText: "",
            prompt: "This request should be rejected before provider calls.",
          },
        ],
      }),
    },
    400
  );

  if (!String(badReference.error || "").includes("data:image")) {
    throw new Error("Expected reference image guardrail error");
  }

  console.log(
    `Generation safety smoke passed on ${baseUrl}: dryRun, reference estimate, spend confirmation, count guard, and reference guard.`
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
