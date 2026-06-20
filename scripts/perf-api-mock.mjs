#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";

const args = parseArgs(process.argv.slice(2));
const products = args.products || "8";
const sceneImages = args.sceneImages || "2";
const concurrency = args.concurrency || "4";
const maxTotalMs = readNumber(args.maxTotalMs, 180_000);
const maxRequestP95Ms = readNumber(args.maxRequestP95Ms, 30_000);
const maxFailedFlows = readNumber(args.maxFailedFlows, 0);

const childArgs = [
  "scripts/stress-product-to-scene-flow.mjs",
  "--products",
  products,
  "--sceneImages",
  sceneImages,
  "--concurrency",
  concurrency,
];
if (args.port) childArgs.push("--port", args.port);
if (args.baseUrl) childArgs.push("--baseUrl", args.baseUrl);
if (args.keepData) childArgs.push("--keepData", args.keepData);

const result = await run("node", childArgs);
process.stdout.write(result.stdout);
if (result.stderr.trim()) process.stderr.write(result.stderr);
if (result.code !== 0) {
  process.exitCode = result.code || 1;
  process.exit();
}

const summary = parseLastJson(result.stdout);
const report = summary.reportPath ? JSON.parse(await fs.readFile(summary.reportPath, "utf8")) : summary;
const failures = [];

if (report.mode !== "mock-provider") failures.push(`expected mock-provider mode, got ${report.mode}`);
if (!report.guardrailProbe?.ok) failures.push("guardrail probe failed");
if ((report.summary?.failedFlows ?? 0) > maxFailedFlows) {
  failures.push(`failed flows ${report.summary.failedFlows} > ${maxFailedFlows}`);
}
if ((report.durationMs ?? 0) > maxTotalMs) {
  failures.push(`total duration ${report.durationMs}ms > ${maxTotalMs}ms`);
}
if ((report.summary?.requestLatencyMs?.p95 ?? 0) > maxRequestP95Ms) {
  failures.push(`request p95 ${report.summary.requestLatencyMs.p95}ms > ${maxRequestP95Ms}ms`);
}

const perfReport = {
  ok: failures.length === 0,
  reportPath: summary.reportPath,
  thresholds: {
    maxTotalMs,
    maxRequestP95Ms,
    maxFailedFlows,
  },
  observed: {
    durationMs: report.durationMs,
    failedFlows: report.summary?.failedFlows,
    requestLatencyMs: report.summary?.requestLatencyMs,
  },
  failures,
};

console.log(JSON.stringify({ perf: perfReport }, null, 2));
if (failures.length > 0) process.exitCode = 1;

function run(command, commandArgs) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
    });
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

function parseLastJson(text) {
  const trimmed = text.trim();
  const start = trimmed.lastIndexOf("\n{");
  const jsonText = start >= 0 ? trimmed.slice(start + 1) : trimmed;
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Could not parse stress output JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
