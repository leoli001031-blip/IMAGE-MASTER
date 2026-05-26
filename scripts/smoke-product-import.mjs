import { spawn } from "node:child_process";

const port = Number(process.env.PRODUCT_IMPORT_SMOKE_PORT || 3467);
const baseUrl = `http://127.0.0.1:${port}`;
const createdIds = [];

const server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

try {
  await waitForServer(`${baseUrl}/api/components`);

  const stamp = Date.now();
  const text = [
    "title,category,description,sellingPoints,materials,brand,price,sku,platformHints,imageUrl",
    [
      `Smoke Tote ${stamp}`,
      "bag",
      "Structured commuter tote with metal logo hardware.",
      "commuter ready; leather texture; roomy interior",
      "cowhide; alloy",
      "Smoke Brand",
      "399",
      `SMOKE-TOTE-${stamp}`,
      "taobao; xiaohongshu",
      "https://example.com/smoke-tote.png",
    ].join(","),
    [
      `Smoke Sneaker ${stamp}`,
      "shoes",
      "Lightweight everyday sneaker.",
      "breathable upper; soft outsole",
      "mesh; rubber",
      "Smoke Brand",
      "299",
      `SMOKE-SNEAKER-${stamp}`,
      "amazon",
      "https://example.com/smoke-sneaker.png",
    ].join(","),
  ].join("\n");

  const dryRunPayload = await requestJson(`${baseUrl}/api/product-import`, {
    method: "POST",
    body: JSON.stringify({
      text,
      dryRun: true,
    }),
  });

  assertPreview(dryRunPayload, 2);
  if (Array.isArray(dryRunPayload.savedComponents)) {
    throw new Error("Dry run should not save components");
  }

  const createPayload = await requestJson(`${baseUrl}/api/product-import`, {
    method: "POST",
    body: JSON.stringify({
      products: [
        {
          title: `Smoke Tote ${stamp}`,
          category: "bag",
          description: "Structured commuter tote with metal logo hardware.",
          sellingPoints: ["commuter ready", "leather texture", "roomy interior"],
          materials: ["cowhide", "alloy"],
          brand: "Smoke Brand",
          price: 399,
          sku: `SMOKE-TOTE-${stamp}`,
          platformHints: ["taobao", "xiaohongshu"],
          referenceImage: "https://example.com/smoke-tote.png",
        },
      ],
      createComponents: true,
    }),
  });

  assertPreview(createPayload, 1);
  const created = createPayload.savedComponents?.created;
  if (!Array.isArray(created) || created.length !== 1) {
    throw new Error("Expected one created product_asset component");
  }

  const component = created[0];
  createdIds.push(component.id);
  if (component.type !== "product_asset") throw new Error("Created component type mismatch");
  if (component.metadata?.componentType !== "product_asset") {
    throw new Error("Created component missing metadata.componentType");
  }
  if (component.metadata?.source?.kind !== "ai_import") {
    throw new Error("Created component missing ai_import source metadata");
  }
  if (!component.metadata?.importKey) {
    throw new Error("Created component missing metadata.importKey");
  }
  const sellingPoints = component.metadata?.parameters?.sellingPoints;
  if (!Array.isArray(sellingPoints) || !sellingPoints.includes("commuter ready")) {
    throw new Error("Created component missing parameters.sellingPoints");
  }

  const duplicatePayload = await requestJson(`${baseUrl}/api/product-import`, {
    method: "POST",
    body: JSON.stringify({
      products: [
        {
          title: `Smoke Tote ${stamp}`,
          sku: `SMOKE-TOTE-${stamp}`,
        },
      ],
      createComponents: true,
    }),
  });
  if (duplicatePayload.savedComponents?.created?.length !== 0) {
    throw new Error("Expected duplicate product import to be skipped");
  }

  console.log(
    `Product import smoke passed on ${baseUrl}: ` +
      `${dryRunPayload.parsedProducts.length} dry-run products, ${created.length} saved.`
  );
} finally {
  await cleanup();
  server.kill("SIGTERM");
}

function assertPreview(payload, expectedCount) {
  if (!Array.isArray(payload.parsedProducts) || payload.parsedProducts.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} parsed products`);
  }
  if (!Array.isArray(payload.componentsPreview) || payload.componentsPreview.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} component previews`);
  }
  for (const component of payload.componentsPreview) {
    if (component.type !== "product_asset") throw new Error("Preview type mismatch");
    if (component.metadata?.componentType !== "product_asset") {
      throw new Error("Preview missing metadata.componentType");
    }
    if (!Array.isArray(component.metadata?.parameters?.sellingPoints)) {
      throw new Error("Preview missing parameters.sellingPoints");
    }
  }
}

async function cleanup() {
  for (const id of createdIds.reverse()) {
    try {
      await fetch(`${baseUrl}/api/components/${id}`, { method: "DELETE" });
    } catch {
      // Best effort cleanup; failures should not hide the primary smoke result.
    }
  }
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) break;
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`Next dev server did not become ready.\n${serverOutput.slice(-2000)}`);
}

async function requestJson(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${url} failed with ${response.status}`);
  }
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
