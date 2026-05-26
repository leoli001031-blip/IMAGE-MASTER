import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const allowedTypes = new Set(["prompt_source", "image_recipe", "quality_rule", "platform_rule"]);
const exportRoot = "/Users/lichenhao/Desktop/刺猬星球/super-i_export";

const primary = await runImport(["--limit", "12", "--json"]);
assert(primary.dryRun === true, "default run must be dry-run");
assert(!primary.write, "dry-run output must not include write summary");
assert(primary.counts.jsonlRows >= 200, "expected full JSONL row count");
assert(primary.counts.indexRows >= 200, "expected full CSV index row count");
assert(primary.counts.processedTutorials === 12, "expected --limit to constrain processed tutorials");
assert(primary.counts.candidates === 12, "expected one candidate per processed tutorial");
assert(primary.counts.withPromptBlocks > 0, "expected prompt-block tutorials");
assert(primary.source.ids.length === 12, "expected source ids for processed tutorials");
assert(isSha256(primary.source.idsHash), "expected source ids hash");
assert(isSha256(primary.source.files.allTutorials.hash), "expected all_tutorials file hash");
assert(isSha256(primary.source.files.tutorialIndex.hash), "expected tutorial_index file hash");
assert(Array.isArray(primary.topTemplateCandidates) && primary.topTemplateCandidates.length > 0, "expected top candidates");

for (const candidate of primary.topTemplateCandidates) {
  assert(allowedTypes.has(candidate.type), `unexpected candidate type ${candidate.type}`);
  assert(candidate.sourceIds.length > 0, "candidate missing source ids");
  assert(isSha256(candidate.sourceHash), "candidate missing source hash");
  assert(candidate.sopSummary?.workflowSteps?.length > 0, "candidate missing SOP workflow steps");
  assert(candidate.sopSummary?.guardrails?.length > 0, "candidate missing SOP guardrails");
}

const serialized = JSON.stringify(primary);
for (const forbidden of ["content_markdown", "content_text", "prompt_blocks", "local_src", "download_status"]) {
  assert(!serialized.includes(forbidden), `summary leaked source field ${forbidden}`);
}

const nestedRoot = await runImport(["--source-root", exportRoot, "--limit", "2", "--json"]);
assert(nestedRoot.sourceRoot.endsWith("/ai"), "--source-root should accept the export root and resolve ai/");
assert(nestedRoot.counts.processedTutorials === 2, "nested source-root limit mismatch");

console.log(
  `Super-i template importer smoke passed: ${primary.counts.processedTutorials} dry-run tutorials, ` +
    `${primary.topTemplateCandidates.length} top candidates, idsHash=${primary.source.idsHash.slice(0, 16)}`
);

async function runImport(args) {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/import-super-i-tutorials.mjs", ...args], {
    cwd: process.cwd(),
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
