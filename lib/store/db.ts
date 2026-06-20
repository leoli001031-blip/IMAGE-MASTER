import "server-only";
import Database from "better-sqlite3";
import fs from "fs";
import { getImageMasterDataDir, getImageMasterDbPath } from "@/lib/store/data-paths";

const DB_DIR = getImageMasterDataDir();
const DB_PATH = getImageMasterDbPath();

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

// Create tables if not exist
db.exec(`
  CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    gender TEXT NOT NULL,
    ethnicity TEXT NOT NULL,
    age INTEGER NOT NULL,
    temperament TEXT NOT NULL,
    bodyType TEXT NOT NULL,
    imageUrl TEXT NOT NULL DEFAULT '',
    promptSnapshot TEXT NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ready',
    url TEXT NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);
  CREATE INDEX IF NOT EXISTS idx_assets_createdAt ON assets(createdAt);

  CREATE TABLE IF NOT EXISTS components (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    version INTEGER NOT NULL DEFAULT 1,
    assetId TEXT NOT NULL DEFAULT '',
    rules TEXT NOT NULL DEFAULT '{}',
    metadata TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_components_type ON components(type);
  CREATE INDEX IF NOT EXISTS idx_components_status ON components(status);
  CREATE INDEX IF NOT EXISTS idx_components_assetId ON components(assetId);
  CREATE INDEX IF NOT EXISTS idx_components_updatedAt ON components(updatedAt);

  CREATE TABLE IF NOT EXISTS component_versions (
    componentId TEXT NOT NULL,
    version INTEGER NOT NULL,
    snapshot TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (componentId, version)
  );

  CREATE INDEX IF NOT EXISTS idx_component_versions_componentId ON component_versions(componentId);
  CREATE INDEX IF NOT EXISTS idx_component_versions_createdAt ON component_versions(createdAt);

  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    nodes TEXT NOT NULL DEFAULT '[]',
    edges TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_workflows_createdAt ON workflows(createdAt);
  CREATE INDEX IF NOT EXISTS idx_workflows_updatedAt ON workflows(updatedAt);

  CREATE TABLE IF NOT EXISTS workflow_templates (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    version INTEGER NOT NULL DEFAULT 1,
    nodes TEXT NOT NULL DEFAULT '[]',
    edges TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_templates_category ON workflow_templates(category);
  CREATE INDEX IF NOT EXISTS idx_workflow_templates_status ON workflow_templates(status);
  CREATE INDEX IF NOT EXISTS idx_workflow_templates_updatedAt ON workflow_templates(updatedAt);

  CREATE TABLE IF NOT EXISTS generation_jobs (
    id TEXT PRIMARY KEY,
    workflowId TEXT,
    nodeId TEXT,
    assetId TEXT,
    batchId TEXT NOT NULL DEFAULT '',
    exportPackId TEXT NOT NULL DEFAULT '',
    planId TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    prompt TEXT NOT NULL DEFAULT '',
    resultUrl TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_generation_jobs_workflowId ON generation_jobs(workflowId);
  CREATE INDEX IF NOT EXISTS idx_generation_jobs_nodeId ON generation_jobs(nodeId);
  CREATE INDEX IF NOT EXISTS idx_generation_jobs_assetId ON generation_jobs(assetId);
  CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON generation_jobs(status);
  CREATE INDEX IF NOT EXISTS idx_generation_jobs_createdAt ON generation_jobs(createdAt);
  CREATE INDEX IF NOT EXISTS idx_generation_jobs_updatedAt ON generation_jobs(updatedAt);
  CREATE INDEX IF NOT EXISTS idx_generation_jobs_workflow_updatedAt ON generation_jobs(workflowId, updatedAt);

  CREATE TABLE IF NOT EXISTS job_leases (
    job_id TEXT PRIMARY KEY,
    lease_id TEXT NOT NULL,
    owner TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    claimed_at TEXT NOT NULL,
    heartbeat_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    released_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (job_id) REFERENCES generation_jobs(id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_job_leases_lease_id ON job_leases(lease_id);
  CREATE INDEX IF NOT EXISTS idx_job_leases_owner ON job_leases(owner);
  CREATE INDEX IF NOT EXISTS idx_job_leases_status ON job_leases(status);
  CREATE INDEX IF NOT EXISTS idx_job_leases_expires_at ON job_leases(expires_at);

  CREATE TABLE IF NOT EXISTS provider_call_budget_events (
    id TEXT PRIMARY KEY,
    budgetId TEXT NOT NULL,
    jobId TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL,
    phase TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT '',
    attemptId TEXT NOT NULL DEFAULT '',
    providerRequestId TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_provider_call_budget_events_budgetId ON provider_call_budget_events(budgetId);
  CREATE INDEX IF NOT EXISTS idx_provider_call_budget_events_jobId ON provider_call_budget_events(jobId);
  CREATE INDEX IF NOT EXISTS idx_provider_call_budget_events_createdAt ON provider_call_budget_events(createdAt);

  CREATE TABLE IF NOT EXISTS generated_artifacts (
    id TEXT PRIMARY KEY,
    workflowId TEXT,
    nodeId TEXT,
    jobId TEXT,
    assetId TEXT,
    batchId TEXT NOT NULL DEFAULT '',
    exportPackId TEXT NOT NULL DEFAULT '',
    planId TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'image',
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ready',
    url TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_generated_artifacts_workflowId ON generated_artifacts(workflowId);
  CREATE INDEX IF NOT EXISTS idx_generated_artifacts_nodeId ON generated_artifacts(nodeId);
  CREATE INDEX IF NOT EXISTS idx_generated_artifacts_jobId ON generated_artifacts(jobId);
  CREATE INDEX IF NOT EXISTS idx_generated_artifacts_assetId ON generated_artifacts(assetId);
  CREATE INDEX IF NOT EXISTS idx_generated_artifacts_status ON generated_artifacts(status);
  CREATE INDEX IF NOT EXISTS idx_generated_artifacts_createdAt ON generated_artifacts(createdAt);
  CREATE INDEX IF NOT EXISTS idx_generated_artifacts_updatedAt ON generated_artifacts(updatedAt);
  CREATE INDEX IF NOT EXISTS idx_generated_artifacts_workflow_updatedAt ON generated_artifacts(workflowId, updatedAt);

  CREATE TABLE IF NOT EXISTS review_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    summary TEXT NOT NULL DEFAULT '{}',
    items TEXT NOT NULL DEFAULT '[]',
    qualitySummary TEXT NOT NULL DEFAULT '{}',
    actions TEXT NOT NULL DEFAULT '[]',
    history TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_review_sessions_status ON review_sessions(status);
  CREATE INDEX IF NOT EXISTS idx_review_sessions_updatedAt ON review_sessions(updatedAt);

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    metadata TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
  CREATE INDEX IF NOT EXISTS idx_projects_updatedAt ON projects(updatedAt);

  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    metadata TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_campaigns_projectId ON campaigns(projectId);
  CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
  CREATE INDEX IF NOT EXISTS idx_campaigns_updatedAt ON campaigns(updatedAt);

  CREATE TABLE IF NOT EXISTS project_batches (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    campaignId TEXT,
    title TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'export_pack',
    state TEXT NOT NULL DEFAULT 'draft',
    metadata TEXT NOT NULL DEFAULT '{}',
    lockedAt TEXT,
    deliveredAt TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(campaignId) REFERENCES campaigns(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_project_batches_projectId ON project_batches(projectId);
  CREATE INDEX IF NOT EXISTS idx_project_batches_campaignId ON project_batches(campaignId);
  CREATE INDEX IF NOT EXISTS idx_project_batches_state ON project_batches(state);
  CREATE INDEX IF NOT EXISTS idx_project_batches_updatedAt ON project_batches(updatedAt);
`);

function ensureColumn(table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const hasColumn = rows.some((row) => row.name === column);
  if (!hasColumn) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("models", "metadata", "TEXT NOT NULL DEFAULT '{}'");
ensureColumn("models", "updatedAt", "TEXT NOT NULL DEFAULT ''");
db.prepare("UPDATE models SET updatedAt = createdAt WHERE updatedAt = ''").run();

ensureColumn("generation_jobs", "batchId", "TEXT NOT NULL DEFAULT ''");
ensureColumn("generation_jobs", "exportPackId", "TEXT NOT NULL DEFAULT ''");
ensureColumn("generation_jobs", "planId", "TEXT NOT NULL DEFAULT ''");
ensureColumn("generated_artifacts", "batchId", "TEXT NOT NULL DEFAULT ''");
ensureColumn("generated_artifacts", "exportPackId", "TEXT NOT NULL DEFAULT ''");
ensureColumn("generated_artifacts", "planId", "TEXT NOT NULL DEFAULT ''");

backfillScopedMetadataColumns("generation_jobs");
backfillScopedMetadataColumns("generated_artifacts");

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_generation_jobs_batchId ON generation_jobs(batchId);
  CREATE INDEX IF NOT EXISTS idx_generation_jobs_exportPackId ON generation_jobs(exportPackId);
  CREATE INDEX IF NOT EXISTS idx_generation_jobs_planId ON generation_jobs(planId);
  CREATE INDEX IF NOT EXISTS idx_generation_jobs_batch_status ON generation_jobs(batchId, status);
  CREATE INDEX IF NOT EXISTS idx_generation_jobs_updatedAt ON generation_jobs(updatedAt);
  CREATE INDEX IF NOT EXISTS idx_generation_jobs_workflow_updatedAt ON generation_jobs(workflowId, updatedAt);
  CREATE INDEX IF NOT EXISTS idx_generated_artifacts_batchId ON generated_artifacts(batchId);
  CREATE INDEX IF NOT EXISTS idx_generated_artifacts_exportPackId ON generated_artifacts(exportPackId);
  CREATE INDEX IF NOT EXISTS idx_generated_artifacts_planId ON generated_artifacts(planId);
  CREATE INDEX IF NOT EXISTS idx_generated_artifacts_batch_status ON generated_artifacts(batchId, status);
  CREATE INDEX IF NOT EXISTS idx_generated_artifacts_updatedAt ON generated_artifacts(updatedAt);
  CREATE INDEX IF NOT EXISTS idx_generated_artifacts_workflow_updatedAt ON generated_artifacts(workflowId, updatedAt);
`);

function backfillScopedMetadataColumns(table: "generation_jobs" | "generated_artifacts"): void {
  const rows = db
    .prepare(
      `SELECT id, metadata, batchId, exportPackId, planId
       FROM ${table}
       WHERE batchId = '' OR exportPackId = '' OR planId = ''`
    )
    .all() as Array<{
      id: string;
      metadata: string;
      batchId: string;
      exportPackId: string;
      planId: string;
    }>;

  if (rows.length === 0) return;

  const update = db.prepare(
    `UPDATE ${table}
     SET batchId = @batchId,
       exportPackId = @exportPackId,
       planId = @planId
     WHERE id = @id`
  );
  const run = db.transaction((records: typeof rows) => {
    for (const row of records) {
      const metadata = parseMetadata(row.metadata);
      update.run({
        id: row.id,
        batchId: row.batchId || readMetadataString(metadata, "batchId"),
        exportPackId: row.exportPackId || readMetadataString(metadata, "exportPackId"),
        planId: row.planId || readMetadataString(metadata, "planId"),
      });
    }
  });

  run(rows);
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export default db;
