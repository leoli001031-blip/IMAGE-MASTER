#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const root = process.cwd();
const dbPath = path.join(root, ".data", "image-master.db");
const seedsPath = path.join(root, "lib", "canvas", "commercial-component-seeds.json");
const workbenchDataPath = path.join(root, "lib", "canvas", "workbench-data.ts");
const demoBatchId = "demo_batch_showcase";
const demoSource = "demo-export-pack-seed";
const requiredSeedKeys = [
  "commercial.platform.taobao_detail_page",
  "commercial.recipe.taobao_detail",
  "commercial.output_pack.taobao_detail",
  "commercial.quality.product_consistency",
];

const report = {
  database: dbPath,
  demoBatchId,
  checks: {},
};

const db = new Database(dbPath, { readonly: true });
try {
  report.checks.demoBatch = checkDemoBatch(db);
  report.checks.componentSeeds = checkComponentSeeds(db);
  report.checks.noSmokeDisplayResidue = checkNoSmokeDisplayResidue(db);
  report.checks.staticWorkbench = checkStaticWorkbench();
  console.log(JSON.stringify(report, null, 2));
  console.log("Demo state smoke passed: demo batch, component seeds, and smoke display boundaries are clean.");
} finally {
  db.close();
}

function checkDemoBatch(db) {
  const jobs = db
    .prepare("SELECT * FROM generation_jobs WHERE json_extract(metadata, '$.batchId') = ? ORDER BY id")
    .all(demoBatchId)
    .map(parseRowMetadata);
  const artifacts = db
    .prepare("SELECT * FROM generated_artifacts WHERE json_extract(metadata, '$.batchId') = ? ORDER BY id")
    .all(demoBatchId)
    .map(parseRowMetadata);

  assert(jobs.length === 2, `Expected 2 demo jobs, found ${jobs.length}`);
  assert(artifacts.length === 2, `Expected 2 demo artifacts, found ${artifacts.length}`);

  for (const job of jobs) {
    assert(job.status === "done", `Demo job ${job.id} is not done`);
    assert(job.metadata.source === demoSource, `Demo job ${job.id} has wrong source`);
    assert(job.metadata.batchId === demoBatchId, `Demo job ${job.id} has wrong batch`);
    assert(!isSmokeDisplayRow(job), `Demo job ${job.id} looks like smoke residue`);
  }

  for (const artifact of artifacts) {
    assert(artifact.status === "ready", `Demo artifact ${artifact.id} is not ready`);
    assert(artifact.provider === "local-demo", `Demo artifact ${artifact.id} is not local-demo`);
    assert(artifact.metadata.source === demoSource, `Demo artifact ${artifact.id} has wrong source`);
    assert(artifact.url.startsWith("/api/generated-images/"), `Demo artifact ${artifact.id} uses an unexpected URL`);
  }

  return {
    jobs: jobs.map((job) => job.id),
    artifacts: artifacts.map((artifact) => artifact.id),
    workflowIds: Array.from(new Set(jobs.map((job) => job.workflowId).filter(Boolean))),
  };
}

function checkComponentSeeds(db) {
  const staticSeeds = JSON.parse(fs.readFileSync(seedsPath, "utf8"));
  const staticSeedKeys = new Set(staticSeeds.map((seed) => seed?.metadata?.seedKey).filter(Boolean));
  const persistedRows = db.prepare("SELECT id, title, type, metadata FROM components").all().map(parseRowMetadata);
  const persistedSeedKeys = new Set(
    persistedRows.map((row) => row.metadata.seedKey).filter((seedKey) => typeof seedKey === "string")
  );

  for (const seedKey of requiredSeedKeys) {
    assert(staticSeedKeys.has(seedKey), `Missing static component seed ${seedKey}`);
    assert(persistedSeedKeys.has(seedKey), `Missing persisted component seed ${seedKey}`);
  }

  assert(staticSeedKeys.size >= 20, `Expected at least 20 static component seeds, found ${staticSeedKeys.size}`);
  assert(persistedSeedKeys.size >= requiredSeedKeys.length, "No persisted component seeds found");

  return {
    staticSeeds: staticSeedKeys.size,
    persistedSeeds: persistedSeedKeys.size,
    requiredSeedKeys,
  };
}

function checkNoSmokeDisplayResidue(db) {
  const generationJobs = db
    .prepare("SELECT id, workflowId, nodeId, assetId, status, prompt, metadata FROM generation_jobs")
    .all()
    .map(parseRowMetadata)
    .filter((row) => row.metadata.batchId !== demoBatchId && isSmokeDisplayRow(row));
  const generatedArtifacts = db
    .prepare("SELECT id, workflowId, nodeId, jobId, assetId, title, prompt, provider, metadata FROM generated_artifacts")
    .all()
    .map(parseRowMetadata)
    .filter((row) => row.metadata.batchId !== demoBatchId && isSmokeDisplayRow(row));
  const reviewSessions = db
    .prepare("SELECT id, title, metadata FROM review_sessions")
    .all()
    .map(parseRowMetadata)
    .filter(isSmokeDisplayRow);
  const projectBatches = db
    .prepare("SELECT id, title, metadata FROM project_batches")
    .all()
    .map(parseRowMetadata)
    .filter((row) => row.id !== demoBatchId && isSmokeDisplayRow(row));
  const canvasWorkflowResidue = db
    .prepare("SELECT id, title, nodes, metadata FROM workflows WHERE json_extract(metadata, '$.kind') = 'canvas-workbench'")
    .all()
    .flatMap((workflow) => getWorkflowSmokeResidue(workflow));

  const residue = {
    generationJobs: generationJobs.map((row) => row.id),
    generatedArtifacts: generatedArtifacts.map((row) => row.id),
    reviewSessions: reviewSessions.map((row) => row.id),
    projectBatches: projectBatches.map((row) => row.id),
    canvasWorkflowNodes: canvasWorkflowResidue,
  };

  assert(
    Object.values(residue).every((items) => items.length === 0),
    `Smoke display residue found: ${JSON.stringify(residue)}`
  );

  return residue;
}

function checkStaticWorkbench() {
  const source = fs.readFileSync(workbenchDataPath, "utf8");
  const forbidden = ["smoke_", "demo-ui-test", "real-provider-smoke", "Smoke Artifact"];
  const hits = forbidden.filter((token) => source.includes(token));
  assert(hits.length === 0, `Static workbench contains smoke/test tokens: ${hits.join(", ")}`);
  assert(source.includes("/canvas-assets/product-main.svg"), "Static workbench is missing product asset preview");
  assert(source.includes("/canvas-assets/output-platform.svg"), "Static workbench is missing platform output preview");
  return {
    file: workbenchDataPath,
    forbiddenTokens: forbidden,
  };
}

function getWorkflowSmokeResidue(workflow) {
  let nodes = [];
  try {
    nodes = JSON.parse(workflow.nodes);
  } catch {
    return [`${workflow.id}:nodes-json-invalid`];
  }
  return nodes
    .filter((node) => isSmokeDisplayText(JSON.stringify(node)))
    .map((node) => `${workflow.id}:${node.id}`);
}

function isSmokeDisplayRow(row) {
  const text = [
    row.id,
    row.workflowId,
    row.nodeId,
    row.jobId,
    row.assetId,
    row.title,
    row.prompt,
    row.provider,
    row.metadata?.source,
    row.metadata?.smoke === true ? "smoke:true" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return isSmokeDisplayText(text);
}

function isSmokeDisplayText(value) {
  return (
    /smoke[_-]/i.test(value) ||
    /real-provider-smoke/i.test(value) ||
    /demo-ui-test/i.test(value) ||
    /Smoke Artifact/i.test(value)
  );
}

function parseRowMetadata(row) {
  return {
    ...row,
    metadata: parseJsonObject(row.metadata),
  };
}

function parseJsonObject(value) {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
