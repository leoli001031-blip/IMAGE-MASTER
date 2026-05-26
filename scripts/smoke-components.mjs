import { spawn } from "node:child_process";

const port = Number(process.env.COMPONENT_SMOKE_PORT || 3462);
const baseUrl = `http://127.0.0.1:${port}`;

const componentTypes = [
  "product_asset",
  "model_asset",
  "visual_style",
  "scene",
  "platform_rule",
  "quality_rule",
  "output_pack",
  "brand_kit",
  "prompt_source",
  "image_recipe",
];

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

  for (const type of componentTypes) {
    const createResponse = await fetch(`${baseUrl}/api/components`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type,
        title: `Smoke ${type}`,
        description: "Component schema smoke test item",
        metadata: {
          parameters: {
            smoke: true,
          },
          promptFragments: [`Prompt fragment for ${type}`],
        },
      }),
    });

    assertResponse(createResponse, `create ${type}`);
    const created = await createResponse.json();
    createdIds.push(created.id);

    if (created.type !== type) {
      throw new Error(`Expected ${type}, got ${created.type}`);
    }
    if (created.metadata?.componentType !== type) {
      throw new Error(`Missing normalized componentType for ${type}`);
    }
    if (!Array.isArray(created.metadata?.inputs) || !Array.isArray(created.metadata?.outputs)) {
      throw new Error(`Missing normalized ports for ${type}`);
    }

    const readResponse = await fetch(`${baseUrl}/api/components/${created.id}`);
    assertResponse(readResponse, `read ${type}`);
    const read = await readResponse.json();
    if (read.id !== created.id || read.metadata?.componentType !== type) {
      throw new Error(`Readback mismatch for ${type}`);
    }
  }

  console.log(`Component smoke passed for ${componentTypes.length} types on ${baseUrl}`);
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
