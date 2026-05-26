import fs from "node:fs";
import path from "node:path";

export function createSmokeRuntime({
  name,
  stamp,
  externalBaseUrl,
  env = process.env,
}) {
  const shouldIsolate = !externalBaseUrl && env.IMAGE_MASTER_SMOKE_SHARED_DATA_DIR !== "1";
  const dataDir = shouldIsolate
    ? path.join(process.cwd(), ".data-smoke", `${name}-${stamp}`)
    : resolveDataDir(env.IMAGE_MASTER_DATA_DIR);
  const distDir = shouldIsolate
    ? path.join(".next-smoke", `${name}-${stamp}`)
    : env.NEXT_DIST_DIR;

  fs.mkdirSync(dataDir, { recursive: true });

  return {
    dataDir,
    dbPath: path.join(dataDir, "image-master.db"),
    generatedDir: path.join(dataDir, "generated"),
    distDir,
    shouldIsolate,
    serverEnv(extra = {}) {
      return {
        ...env,
        IMAGE_MASTER_DATA_DIR: dataDir,
        ...(distDir ? { NEXT_DIST_DIR: distDir } : {}),
        ...extra,
      };
    },
    cleanup() {
      if (!shouldIsolate || env.IMAGE_MASTER_SMOKE_KEEP_DATA === "1") return;
      fs.rmSync(dataDir, { recursive: true, force: true });
      if (distDir && env.IMAGE_MASTER_SMOKE_KEEP_DIST !== "1") {
        fs.rmSync(distDir, { recursive: true, force: true });
      }
      normalizeRootTsconfig();
    },
  };
}

export function stopSmokeServer(serverProcess) {
  if (!serverProcess || serverProcess.exitCode !== null || serverProcess.signalCode) {
    normalizeRootTsconfig();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      serverProcess.kill("SIGKILL");
      normalizeRootTsconfig();
      resolve();
    }, 5000);
    serverProcess.once("exit", () => {
      clearTimeout(timeout);
      normalizeRootTsconfig();
      resolve();
    });
    serverProcess.kill("SIGTERM");
  });
}

function resolveDataDir(configured) {
  return configured?.trim()
    ? path.resolve(process.cwd(), configured.trim())
    : path.join(process.cwd(), ".data");
}

function normalizeRootTsconfig() {
  const tsconfigPath = path.join(process.cwd(), "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) return;

  try {
    const parsed = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
    parsed.include = [
      "next-env.d.ts",
      ".next/types/**/*.ts",
      "**/*.ts",
      "**/*.tsx",
    ];
    fs.writeFileSync(tsconfigPath, `${JSON.stringify(parsed, null, 2)}\n`);
  } catch {
    // Smoke cleanup should not hide the original smoke result.
  }
}
