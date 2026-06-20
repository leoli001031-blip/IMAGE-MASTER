import type {
  CreateGenerationJobParams,
  GenerationJob,
  UpdateGenerationJobParams,
} from "@/lib/types";
import "server-only";
import db from "./db";
import { prepareMetadataForPersistence } from "./metadata-image-sanitizer";

type GenerationJobRow = Omit<GenerationJob, "workflowId" | "nodeId" | "assetId" | "metadata"> & {
  workflowId: string | null;
  nodeId: string | null;
  assetId: string | null;
  batchId: string;
  exportPackId: string;
  planId: string;
  metadata: string;
};

export interface JobListFilters {
  workflowId?: string;
  status?: string;
  batchId?: string;
  exportPackId?: string;
  planId?: string;
  limit?: number;
  updatedAfter?: string;
}

export interface JobQueueSnapshotRow {
  id: string;
  status: string;
}

export type JobStatusCounts = Record<string, number>;

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toJob(row: GenerationJobRow): GenerationJob {
  return {
    ...row,
    workflowId: row.workflowId ?? undefined,
    nodeId: row.nodeId ?? undefined,
    assetId: row.assetId ?? undefined,
    metadata: parseMetadata(row.metadata),
  };
}

export async function list(filters: JobListFilters = {}): Promise<GenerationJob[]> {
  const clauses: string[] = [];
  const values: Array<string | number> = [];

  if (filters.workflowId) {
    clauses.push("workflowId = ?");
    values.push(filters.workflowId);
  }

  if (filters.status) {
    clauses.push("status = ?");
    values.push(filters.status);
  }

  for (const key of ["batchId", "exportPackId", "planId"] as const) {
    if (filters[key]) {
      clauses.push(`${key} = ?`);
      values.push(filters[key]);
    }
  }

  if (filters.updatedAfter) {
    clauses.push("updatedAt > ?");
    values.push(filters.updatedAfter);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Number.isFinite(filters.limit) && filters.limit && filters.limit > 0
    ? Math.floor(filters.limit)
    : undefined;
  const limitSql = limit ? " LIMIT ?" : "";
  if (limit) values.push(limit);

  const orderSql = filters.updatedAfter ? "ORDER BY updatedAt DESC, createdAt DESC" : "ORDER BY createdAt DESC";
  const rows = db
    .prepare(`SELECT * FROM generation_jobs ${where} ${orderSql}${limitSql}`)
    .all(...values);

  return (rows as GenerationJobRow[]).map(toJob);
}

export async function listQueueSnapshotRows(options: { activeOnly?: boolean } = {}): Promise<JobQueueSnapshotRow[]> {
  const where = options.activeOnly ? "WHERE status IN ('queued', 'running')" : "";
  return db
    .prepare(`SELECT id, status FROM generation_jobs ${where} ORDER BY createdAt DESC`)
    .all() as JobQueueSnapshotRow[];
}

export async function countByStatus(): Promise<JobStatusCounts> {
  const rows = db
    .prepare("SELECT status, COUNT(*) as count FROM generation_jobs GROUP BY status")
    .all() as Array<{ status: string; count: number }>;
  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}

export async function get(id: string): Promise<GenerationJob | undefined> {
  const row = db.prepare("SELECT * FROM generation_jobs WHERE id = ?").get(id) as
    | GenerationJobRow
    | undefined;
  return row ? toJob(row) : undefined;
}

export async function add(params: CreateGenerationJobParams): Promise<GenerationJob> {
  const now = new Date().toISOString();
  const id = `job_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const metadata = await prepareMetadataForPersistence(params.metadata || {}, id);
  const job: GenerationJob = {
    id,
    workflowId: params.workflowId?.trim() || undefined,
    nodeId: params.nodeId?.trim() || undefined,
    assetId: params.assetId?.trim() || undefined,
    status: params.status?.trim() || "pending",
    prompt: params.prompt?.trim() || "",
    resultUrl: params.resultUrl?.trim() || "",
    error: params.error?.trim() || "",
    metadata,
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(
    `INSERT INTO generation_jobs (
       id, workflowId, nodeId, assetId, batchId, exportPackId, planId,
       status, prompt, resultUrl, error, metadata, createdAt, updatedAt
     )
     VALUES (
       @id, @workflowId, @nodeId, @assetId, @batchId, @exportPackId, @planId,
       @status, @prompt, @resultUrl, @error, @metadata, @createdAt, @updatedAt
     )`
  ).run({
    ...job,
    workflowId: job.workflowId ?? null,
    nodeId: job.nodeId ?? null,
    assetId: job.assetId ?? null,
    ...extractScopedMetadata(job.metadata),
    metadata: JSON.stringify(job.metadata),
  });

  return job;
}

export async function update(
  id: string,
  updates: UpdateGenerationJobParams
): Promise<GenerationJob | null> {
  const existing = await get(id);
  if (!existing) return null;

  const merged: GenerationJob = {
    ...existing,
    workflowId:
      updates.workflowId !== undefined ? updates.workflowId.trim() || undefined : existing.workflowId,
    nodeId: updates.nodeId !== undefined ? updates.nodeId.trim() || undefined : existing.nodeId,
    assetId: updates.assetId !== undefined ? updates.assetId.trim() || undefined : existing.assetId,
    status: updates.status !== undefined ? updates.status.trim() : existing.status,
    prompt: updates.prompt !== undefined ? updates.prompt.trim() : existing.prompt,
    resultUrl: updates.resultUrl !== undefined ? updates.resultUrl.trim() : existing.resultUrl,
    error: updates.error !== undefined ? updates.error.trim() : existing.error,
    metadata: updates.metadata !== undefined
      ? await prepareMetadataForPersistence(updates.metadata, id)
      : existing.metadata,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(
    `UPDATE generation_jobs
     SET workflowId=@workflowId, nodeId=@nodeId, assetId=@assetId,
       batchId=@batchId, exportPackId=@exportPackId, planId=@planId, status=@status,
       prompt=@prompt, resultUrl=@resultUrl, error=@error, metadata=@metadata, updatedAt=@updatedAt
     WHERE id=@id`
  ).run({
    ...merged,
    workflowId: merged.workflowId ?? null,
    nodeId: merged.nodeId ?? null,
    assetId: merged.assetId ?? null,
    ...extractScopedMetadata(merged.metadata),
    metadata: JSON.stringify(merged.metadata),
  });

  return merged;
}

function extractScopedMetadata(metadata: Record<string, unknown>): {
  batchId: string;
  exportPackId: string;
  planId: string;
} {
  return {
    batchId: readMetadataString(metadata, "batchId"),
    exportPackId: readMetadataString(metadata, "exportPackId"),
    planId: readMetadataString(metadata, "planId"),
  };
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
