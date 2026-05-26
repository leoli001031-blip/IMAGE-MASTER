#!/usr/bin/env node

import { spawn } from "node:child_process";

const sourceRoot = process.env.SUPER_I_SOURCE_ROOT || "/Users/lichenhao/Desktop/刺猬星球/super-i_export";

const child = spawn("node", [
  "scripts/import-super-i-tutorials.mjs",
  "--source-root",
  sourceRoot,
  "--json",
], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

const exitCode = await new Promise((resolve) => child.on("close", resolve));
if (exitCode !== 0) {
  throw new Error(`import-super-i-tutorials failed with ${exitCode}\n${stderr}`);
}

const payload = JSON.parse(stdout);
const counts = payload.counts || {};
const topCandidates = payload.topTemplateCandidates || [];
assert(counts.processedTutorials >= 200, "Expected at least 200 tutorials");
assert(counts.withPromptBlocks >= 150, "Expected prompt-rich tutorials");
assert(counts.totalPromptBlocks >= 1000, "Expected prompt block count");
assert(counts.totalMedia >= 3000, "Expected offline media manifest scale");
assert(counts.candidates >= 10, "Expected template candidates");
assert(counts.candidatesByType?.image_recipe >= 3, "Expected image recipe candidates");
assert(counts.candidatesByType?.prompt_source >= 2, "Expected prompt source candidates");
assert(
  topCandidates.some((candidate) => candidate.sourceIds.includes("2801")),
  "Expected Amazon listing tutorial candidate"
);
assert(
  payload.source?.ids?.includes("2834"),
  "Expected factory storyboard tutorial in source set"
);
assert(
  topCandidates.every((candidate) => !String(candidate.title).includes("你是一名")),
  "Dry-run output should not expose raw prompt blocks as titles"
);

console.log(JSON.stringify({
  providerCalls: 0,
  tutorialCount: counts.processedTutorials,
  promptArticleCount: counts.withPromptBlocks,
  promptBlockCount: counts.totalPromptBlocks,
  mediaCount: counts.totalMedia,
  candidateCount: counts.candidates,
  byType: counts.candidatesByType,
  topCandidateIds: topCandidates.slice(0, 8).map((candidate) => candidate.id),
}, null, 2));
console.log("Super-i import smoke passed without provider calls.");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
