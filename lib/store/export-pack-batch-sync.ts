import "server-only";
import db from "./db";

export interface ExportPackBatchSyncResult {
  batchId: string;
  projectId: string;
  state: string;
  metadata: Record<string, unknown>;
  successCount: number;
  failedCount: number;
  counts: {
    total: number;
    success: number;
    failed: number;
    pending: number;
    queued: number;
    running: number;
    terminal: number;
    artifact: number;
  };
}

type ProjectBatchRow = {
  id: string;
  projectId: string;
  campaignId: string | null;
  title: string;
  kind: string;
  state: string;
  metadata: string;
  lockedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type GenerationJobRow = {
  id: string;
  status: string;
  resultUrl: string;
  metadata: string;
};

type GeneratedArtifactRow = {
  id: string;
  jobId: string | null;
  metadata: string;
};

export async function syncExportPackBatchState(
  batchId: string | undefined,
  options: { reason?: string; now?: string } = {}
): Promise<ExportPackBatchSyncResult | undefined> {
  if (!batchId?.trim()) return undefined;

  const batch = db.prepare("SELECT * FROM project_batches WHERE id = ?").get(batchId) as
    | ProjectBatchRow
    | undefined;
  if (!batch || batch.state === "locked" || batch.state === "delivered") return undefined;

  const now = options.now ?? new Date().toISOString();
  const metadata = parseRecord(batch.metadata);
  const knownJobIds = new Set(getStringArray(metadata.jobIds));
  const jobs = selectJobs(batchId, knownJobIds);
  const jobIds = new Set(jobs.map((job) => job.id));
  const artifacts = selectArtifacts(batchId, jobIds);
  const artifactJobIds = new Set(
    artifacts
      .map((artifact) => artifact.jobId)
      .filter((value): value is string => typeof value === "string" && !!value.trim())
  );
  const doneJobIds = new Set(
    jobs
      .filter((job) => (job.status === "done" || job.status === "completed") && !!job.resultUrl)
      .map((job) => job.id)
  );
  const successCount = new Set([...artifactJobIds, ...doneJobIds]).size;
  const failedCount = jobs.filter(
    (job) => job.status === "failed" || job.status === "cancelled"
  ).length;
  const pendingCount = jobs.filter((job) => job.status === "pending").length;
  const queuedCount = jobs.filter((job) => job.status === "queued").length;
  const runningCount = jobs.filter((job) => job.status === "running").length;
  const terminalCount = successCount + failedCount;
  const declaredTotal = Math.max(
    getNumber(metadata.itemCount) ?? 0,
    ...jobs.map((job) => getNumber(parseRecord(job.metadata).batchTotal) ?? 0)
  );
  const total = Math.max(jobs.length, declaredTotal);
  const activeCount = pendingCount + queuedCount + runningCount;
  const partialResult = failedCount > 0 || (activeCount === 0 && terminalCount > 0 && terminalCount < total);
  const nextState = batch.state === "draft" && successCount > 0 ? "generated" : batch.state;
  const artifactIds = artifacts.map((artifact) => artifact.id);
  const nextMetadata = {
    ...metadata,
    batchId,
    itemCount: total || metadata.itemCount,
    partialResult,
    successCount,
    failedCount,
    counts: {
      total,
      success: successCount,
      failed: failedCount,
      pending: pendingCount,
      queued: queuedCount,
      running: runningCount,
      terminal: terminalCount,
      artifact: artifacts.length,
    },
    jobIds: mergeStringArrays(metadata.jobIds, jobs.map((job) => job.id)),
    artifactIds: mergeStringArrays(metadata.artifactIds, artifactIds),
    lastPersistedAt: now,
    lastBatchStateSyncedAt: now,
    lastBatchStateSyncReason: options.reason ?? "job-terminal",
  };

  db.prepare(
    `UPDATE project_batches
     SET state = @state, metadata = @metadata, updatedAt = @updatedAt
     WHERE id = @id`
  ).run({
    id: batch.id,
    state: nextState,
    metadata: JSON.stringify(nextMetadata),
    updatedAt: now,
  });

  return {
    batchId: batch.id,
    projectId: batch.projectId,
    state: nextState,
    metadata: nextMetadata,
    successCount,
    failedCount,
    counts: nextMetadata.counts,
  };
}

function selectJobs(batchId: string, knownJobIds: Set<string>): GenerationJobRow[] {
  const rows = db
    .prepare(
      "SELECT id, status, resultUrl, metadata FROM generation_jobs WHERE batchId = ? OR json_extract(metadata, '$.batchId') = ?"
    )
    .all(batchId, batchId) as GenerationJobRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (knownJobIds.size > 0) {
    const placeholders = Array.from(knownJobIds).map(() => "?").join(",");
    const extraRows = db
      .prepare(`SELECT id, status, resultUrl, metadata FROM generation_jobs WHERE id IN (${placeholders})`)
      .all(...knownJobIds) as GenerationJobRow[];
    for (const row of extraRows) byId.set(row.id, row);
  }
  return Array.from(byId.values());
}

function selectArtifacts(batchId: string, jobIds: Set<string>): GeneratedArtifactRow[] {
  const rows = db
    .prepare(
      "SELECT id, jobId, metadata FROM generated_artifacts WHERE batchId = ? OR json_extract(metadata, '$.batchId') = ?"
    )
    .all(batchId, batchId) as GeneratedArtifactRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (jobIds.size > 0) {
    const placeholders = Array.from(jobIds).map(() => "?").join(",");
    const extraRows = db
      .prepare(`SELECT id, jobId, metadata FROM generated_artifacts WHERE jobId IN (${placeholders})`)
      .all(...jobIds) as GeneratedArtifactRow[];
    for (const row of extraRows) byId.set(row.id, row);
  }
  return Array.from(byId.values());
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && !!item.trim());
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function mergeStringArrays(existing: unknown, next: string[]): string[] {
  return Array.from(new Set([...getStringArray(existing), ...next.filter(Boolean)]));
}
