import { spawn } from "node:child_process";

const port = Number(process.env.CANVAS_COMPONENT_FACTORY_SMOKE_PORT || 3465);
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
  const response = await fetch(`${baseUrl}/api/canvas-components`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      factoryItem: {
        id: "factory-detail",
        title: `详情页模块 Smoke ${stamp}`,
        description: "生成卖点、细节、对比图组合",
      },
      productAsset: {
        title: `Smoke Product ${stamp}`,
        description: "Lightweight smoke product asset",
      },
      existingNodes: [
        { id: "product", label: "商品资产", kind: "asset" },
        { id: "brief", label: "Brief", kind: "factory" },
      ],
      persistComponents: true,
      useLocalFallback: true,
    }),
  });

  assertResponse(response, "factory persist");
  const payload = await response.json();

  if (!Array.isArray(payload.components) || payload.components.length === 0) {
    throw new Error("Expected canvas component suggestions");
  }
  if (!Array.isArray(payload.savedComponents) || payload.savedComponents.length === 0) {
    throw new Error("Expected saved schema-normalized reusable components");
  }

  for (const component of payload.savedComponents) {
    createdIds.push(component.id);
    const componentType = component.metadata?.componentType;
    if (!componentType) {
      throw new Error(`Saved component ${component.title} missing metadata.componentType`);
    }
    if (!Array.isArray(component.metadata?.inputs) || !Array.isArray(component.metadata?.outputs)) {
      throw new Error(`Saved component ${component.title} missing normalized ports`);
    }
    if (!component.metadata?.factoryKey) {
      throw new Error(`Saved component ${component.title} missing metadata.factoryKey`);
    }
    if (component.metadata?.source?.kind !== "generated") {
      throw new Error(`Saved component ${component.title} missing generated source metadata`);
    }
  }

  console.log(
    `Canvas component factory smoke passed on ${baseUrl}: ` +
      `${payload.components.length} suggestions, ${payload.savedComponents.length} saved.`
  );
} finally {
  await cleanup();
  server.kill("SIGTERM");
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

function assertResponse(response, action) {
  if (!response.ok) {
    throw new Error(`${action} failed with ${response.status}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
