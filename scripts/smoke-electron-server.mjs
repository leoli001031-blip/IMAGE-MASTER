#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const appServerDir = path.join(root, "dist-electron", "app-server");
const serverPath = path.join(appServerDir, "server.js");
const stamp = Date.now();
const port = Number(process.env.ELECTRON_SERVER_SMOKE_PORT || 3600 + (stamp % 1000));
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = path.join(root, ".data-electron-smoke", `server-${stamp}`);

if (!fs.existsSync(serverPath)) {
  throw new Error("Missing dist-electron/app-server/server.js. Run npm run build:standalone && npm run electron:prepare-server first.");
}

let serverOutput = "";
const server = spawn(process.execPath, [serverPath], {
  cwd: appServerDir,
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    IMAGE_MASTER_DATA_DIR: dataDir,
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

try {
  await waitForHttp(`${baseUrl}/projects`, 30000);
  const projectsHtml = await fetchText(`${baseUrl}/projects`);
  if (!projectsHtml.includes("Image Master") && !projectsHtml.includes("项目")) {
    throw new Error("Electron server /projects did not render the expected app shell.");
  }

  const canvasHtml = await fetchText(`${baseUrl}/canvas`);
  const assetUrls = extractNextAssetUrls(canvasHtml);
  const cssUrls = assetUrls.filter((url) => url.endsWith(".css"));
  const jsUrls = assetUrls.filter((url) => url.endsWith(".js"));
  if (cssUrls.length === 0) {
    throw new Error("Electron server /canvas did not include any Next CSS assets.");
  }
  if (jsUrls.length === 0) {
    throw new Error("Electron server /canvas did not include any Next JS assets.");
  }
  await assertAssetResponses([...cssUrls.slice(0, 3), ...jsUrls.slice(0, 5)]);

  const settingsResponse = await fetch(`${baseUrl}/api/settings`);
  if (!settingsResponse.ok) {
    throw new Error(`Electron server /api/settings returned ${settingsResponse.status}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    appServerDir,
    dataDir,
    cssAssetsChecked: cssUrls.length,
    jsAssetsChecked: jsUrls.length,
  }, null, 2));
} catch (error) {
  console.error(error);
  if (serverOutput) {
    console.error("--- electron server output tail ---");
    console.error(serverOutput.slice(-4000));
  }
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  await waitForExit(server, 5000).catch(() => server.kill("SIGKILL"));
  await fsp.rm(dataDir, { recursive: true, force: true });
}

async function waitForHttp(url, timeoutMs) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

function extractNextAssetUrls(html) {
  const urls = new Set();
  const patterns = [
    /href="([^"]*\/_next\/static\/[^"]+)"/g,
    /src="([^"]*\/_next\/static\/[^"]+)"/g,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      urls.add(match[1].replace(/&amp;/g, "&"));
    }
  }
  return Array.from(urls);
}

async function assertAssetResponses(urls) {
  for (const url of urls) {
    const response = await fetch(url.startsWith("http") ? url : `${baseUrl}${url}`);
    if (!response.ok) {
      throw new Error(`Electron server asset ${url} returned ${response.status}.`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (url.endsWith(".css") && !contentType.includes("text/css")) {
      throw new Error(`Electron server asset ${url} returned unexpected content-type ${contentType}.`);
    }
    if (url.endsWith(".js") && !contentType.includes("javascript")) {
      throw new Error(`Electron server asset ${url} returned unexpected content-type ${contentType}.`);
    }
  }
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for server exit")), timeoutMs)),
  ]);
}
