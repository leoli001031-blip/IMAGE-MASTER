import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const seedPath = path.join(projectRoot, "lib/canvas/commercial-component-seeds.json");
const defaultPort = Number(process.env.COMPONENT_SEED_PORT || 3463);
const explicitBaseUrl = process.env.COMPONENT_BASE_URL;
const baseUrl = explicitBaseUrl || `http://127.0.0.1:${defaultPort}`;
const isJson = process.argv.includes("--json");

export async function seedCommercialComponents(options = {}) {
  const targetBaseUrl = options.baseUrl || baseUrl;
  const seeds = await loadSeeds();
  const existing = await fetchJson(`${targetBaseUrl}/api/components`);
  const bySeedKey = new Map(
    existing
      .filter((component) => typeof component?.metadata?.seedKey === "string")
      .map((component) => [component.metadata.seedKey, component])
  );

  const summary = {
    totalSeeds: seeds.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    byType: {},
    seedKeys: [],
  };

  for (const seed of seeds) {
    const seedKey = seed.metadata.seedKey;
    summary.seedKeys.push(seedKey);
    summary.byType[seed.type] = (summary.byType[seed.type] || 0) + 1;

    const existingComponent = bySeedKey.get(seedKey);
    if (!existingComponent) {
      await requestJson(`${targetBaseUrl}/api/components`, {
        method: "POST",
        body: JSON.stringify(seed),
      });
      summary.created += 1;
      continue;
    }

    if (sameSeedPayload(existingComponent, seed)) {
      summary.unchanged += 1;
      continue;
    }

    await requestJson(`${targetBaseUrl}/api/components/${existingComponent.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...seed,
        version: existingComponent.version || 1,
      }),
    });
    summary.updated += 1;
  }

  return summary;
}

async function main() {
  let server;
  try {
    if (!explicitBaseUrl) {
      server = startServer(defaultPort);
      await waitForServer(`${baseUrl}/api/components`, server);
    }

    const summary = await seedCommercialComponents({ baseUrl });
    if (isJson) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(
        `Seeded commercial components on ${baseUrl}: ${summary.created} created, ${summary.updated} updated, ${summary.unchanged} unchanged.`
      );
      console.log(`Types: ${Object.entries(summary.byType).map(([type, count]) => `${type}=${count}`).join(", ")}`);
    }
  } finally {
    if (server) {
      server.kill("SIGTERM");
    }
  }
}

async function loadSeeds() {
  const raw = await readFile(seedPath, "utf8");
  return JSON.parse(raw);
}

function startServer(port) {
  const server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.output = "";
  server.stdout.on("data", (chunk) => {
    server.output += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    server.output += chunk.toString();
  });

  return server;
}

async function fetchJson(url) {
  const response = await fetch(url);
  assertResponse(response, `GET ${url}`);
  return response.json();
}

async function requestJson(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  assertResponse(response, `${init.method || "GET"} ${url}`);
  return response.json();
}

function sameSeedPayload(component, seed) {
  return (
    component.type === seed.type &&
    component.title === seed.title &&
    component.description === (seed.description || "") &&
    component.status === (seed.status || "draft") &&
    stableStringify(component.rules || {}) === stableStringify(normalizeSeedRules(seed.rules)) &&
    stableStringify(component.metadata?.parameters || {}) === stableStringify(seed.metadata?.parameters || {}) &&
    stableStringify(component.metadata?.promptFragments || []) === stableStringify(seed.metadata?.promptFragments || []) &&
    stableStringify(component.metadata?.negativeRules || []) === stableStringify(seed.metadata?.negativeRules || []) &&
    stableStringify(component.metadata?.qualityRules || []) === stableStringify(seed.metadata?.qualityRules || []) &&
    stableStringify(component.metadata?.compatibleWith || []) === stableStringify(seed.metadata?.compatibleWith || [])
  );
}

function normalizeSeedRules(rules) {
  if (!rules) {
    return {
      constraints: [],
      negativeRules: [],
      qualityRules: [],
    };
  }
  return {
    constraints: Array.isArray(rules.constraints) ? rules.constraints : [],
    negativeRules: Array.isArray(rules.negativeRules) ? rules.negativeRules : [],
    qualityRules: Array.isArray(rules.qualityRules) ? rules.qualityRules : [],
    ...rules,
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function waitForServer(url, server) {
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
  throw new Error(`Next dev server did not become ready.\n${server.output.slice(-2000)}`);
}

function assertResponse(response, action) {
  if (!response.ok) {
    throw new Error(`${action} failed with ${response.status}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
