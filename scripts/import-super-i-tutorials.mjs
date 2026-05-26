import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const importerPath = path.join(projectRoot, "lib/canvas/super-i-template-importer.ts");
const defaultPort = Number(process.env.SUPER_I_IMPORT_PORT || 3471);
const explicitBaseUrl = process.env.SUPER_I_IMPORT_BASE_URL || process.env.COMPONENT_BASE_URL;
const baseUrl = explicitBaseUrl || `http://127.0.0.1:${defaultPort}`;

export async function loadSuperIImporterModule() {
  const source = await readFile(importerPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: importerPath,
    reportDiagnostics: true,
  });

  const diagnostics = transpiled.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) || [];
  if (diagnostics.length > 0) {
    const message = diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n");
    throw new Error(`Failed to load Super-i importer module:\n${message}`);
  }

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
  return import(moduleUrl);
}

export async function runSuperIImportCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const importer = await loadSuperIImporterModule();
  const plan = await importer.loadSuperITemplateImportPlan({
    sourceRoot: args.sourceRoot,
    limit: args.limit,
  });
  let writeSummary;

  if (args.write) {
    writeSummary = await writeComponents(plan.candidates.map((candidate) => candidate.componentParams));
  }

  const summary = importer.toSuperIImportSummary(plan, {
    dryRun: !args.write,
    write: writeSummary,
  });

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printHumanSummary(summary);
  }

  return summary;
}

export async function writeComponents(componentParams) {
  let server;
  try {
    if (!explicitBaseUrl) {
      server = startServer(defaultPort);
      await waitForServer(`${baseUrl}/api/components`, server);
    }

    const existing = await fetchJson(`${baseUrl}/api/components`);
    const existingByImportKey = new Map(
      existing
        .filter((component) => typeof component?.metadata?.importKey === "string")
        .map((component) => [component.metadata.importKey, component])
    );
    const seenImportKeys = new Set();
    const summary = {
      attempted: componentParams.length,
      created: 0,
      updated: 0,
      unchanged: 0,
      skippedDuplicates: 0,
      ids: [],
    };

    for (const params of componentParams) {
      const importKey = params?.metadata?.importKey;
      if (typeof importKey !== "string" || !importKey) {
        summary.skippedDuplicates += 1;
        continue;
      }
      if (seenImportKeys.has(importKey)) {
        summary.skippedDuplicates += 1;
        continue;
      }
      seenImportKeys.add(importKey);

      const existingComponent = existingByImportKey.get(importKey);
      if (!existingComponent) {
        const created = await requestJson(`${baseUrl}/api/components`, {
          method: "POST",
          body: JSON.stringify(params),
        });
        summary.created += 1;
        summary.ids.push(created.id);
        continue;
      }

      if (sameCandidatePayload(existingComponent, params)) {
        summary.unchanged += 1;
        summary.ids.push(existingComponent.id);
        continue;
      }

      const updated = await requestJson(`${baseUrl}/api/components/${existingComponent.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...params,
          version: existingComponent.version || 1,
        }),
      });
      summary.updated += 1;
      summary.ids.push(updated.id);
    }

    return summary;
  } finally {
    if (server) {
      server.kill("SIGTERM");
    }
  }
}

function parseArgs(argv) {
  const args = {
    sourceRoot: undefined,
    json: false,
    limit: undefined,
    write: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--write") {
      args.write = true;
      continue;
    }
    if (arg === "--dry-run") {
      args.write = false;
      continue;
    }
    if (arg === "--source-root") {
      args.sourceRoot = requiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--source-root=")) {
      args.sourceRoot = arg.slice("--source-root=".length);
      continue;
    }
    if (arg === "--limit") {
      args.limit = parseLimit(requiredValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      args.limit = parseLimit(arg.slice("--limit=".length));
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return args;
}

function requiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parseLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--limit must be a positive integer, got ${value}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/import-super-i-tutorials.mjs [options]

Options:
  --source-root <path>  Path to super-i_export or super-i_export/ai.
  --limit <n>          Process only the first n tutorials.
  --json               Print machine-readable JSON.
  --write              Persist candidates through /api/components. Default is dry-run.
  --dry-run            Explicit no-write mode.
`);
}

function printHumanSummary(summary) {
  const counts = summary.counts;
  const typeCounts = Object.entries(counts.candidatesByType)
    .map(([type, count]) => `${type}=${count}`)
    .join(", ");
  const sourcePreview = summary.source.ids.slice(0, 12).join(", ");
  const extraSourceCount = Math.max(0, summary.source.ids.length - 12);

  console.log(`Super-i tutorial import ${summary.dryRun ? "dry-run" : "write"} complete`);
  console.log(`Source root: ${summary.sourceRoot}`);
  console.log(
    `Counts: jsonl=${counts.jsonlRows}, index=${counts.indexRows}, processed=${counts.processedTutorials}, ` +
      `candidates=${counts.candidates}, promptBlocks=${counts.totalPromptBlocks}, media=${counts.totalMedia}`
  );
  console.log(`Candidate types: ${typeCounts}`);
  console.log(`Source ids: ${sourcePreview}${extraSourceCount ? ` (+${extraSourceCount} more)` : ""}`);
  console.log(`Source ids hash: ${summary.source.idsHash}`);
  console.log(`all_tutorials hash: ${summary.source.files.allTutorials.hash}`);
  console.log(`tutorial_index hash: ${summary.source.files.tutorialIndex.hash}`);
  console.log("Top template candidates:");

  for (const candidate of summary.topTemplateCandidates) {
    console.log(
      `  ${candidate.rank}. [${candidate.type}] score=${candidate.score} ` +
        `source=${candidate.sourceIds.join(",")} hash=${candidate.sourceHash.slice(0, 16)} ${candidate.title}`
    );
    console.log(`     ${candidate.sopSummary.intent}`);
  }

  if (summary.write) {
    console.log(
      `Write: attempted=${summary.write.attempted}, created=${summary.write.created}, ` +
        `updated=${summary.write.updated}, unchanged=${summary.write.unchanged}, ` +
        `skippedDuplicates=${summary.write.skippedDuplicates}`
    );
  } else {
    console.log("DB writes: none (default dry-run). Use --write to persist candidates.");
  }
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

function sameCandidatePayload(component, params) {
  return (
    component.type === params.type &&
    component.title === params.title &&
    component.description === (params.description || "") &&
    component.status === (params.status || "draft") &&
    stableStringify(component.rules || {}) === stableStringify(normalizeRules(params.rules)) &&
    stableStringify(component.metadata?.superISource || {}) === stableStringify(params.metadata?.superISource || {}) &&
    stableStringify(component.metadata?.parameters || {}) === stableStringify(params.metadata?.parameters || {}) &&
    stableStringify(component.metadata?.sopSummary || {}) === stableStringify(params.metadata?.sopSummary || {}) &&
    stableStringify(component.metadata?.promptFragments || []) === stableStringify(params.metadata?.promptFragments || []) &&
    stableStringify(component.metadata?.negativeRules || []) === stableStringify(params.metadata?.negativeRules || []) &&
    stableStringify(component.metadata?.qualityRules || []) === stableStringify(params.metadata?.qualityRules || []) &&
    stableStringify(component.metadata?.compatibleWith || []) === stableStringify(params.metadata?.compatibleWith || [])
  );
}

function normalizeRules(rules) {
  return {
    constraints: Array.isArray(rules?.constraints) ? rules.constraints : [],
    negativeRules: Array.isArray(rules?.negativeRules) ? rules.negativeRules : [],
    qualityRules: Array.isArray(rules?.qualityRules) ? rules.qualityRules : [],
    ...(rules || {}),
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

function assertResponse(response, action) {
  if (!response.ok) {
    throw new Error(`${action} failed with ${response.status}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  runSuperIImportCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
