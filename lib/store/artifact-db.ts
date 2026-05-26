import type {
  CreateGeneratedArtifactParams,
  GeneratedArtifact,
  UpdateGeneratedArtifactParams,
} from "@/lib/types";
import "server-only";
import db from "./db";

type GeneratedArtifactRow = Omit<
  GeneratedArtifact,
  "workflowId" | "nodeId" | "jobId" | "assetId" | "metadata"
> & {
  workflowId: string | null;
  nodeId: string | null;
  jobId: string | null;
  assetId: string | null;
  batchId: string;
  exportPackId: string;
  planId: string;
  metadata: string;
};

export interface ArtifactListFilters {
  workflowId?: string;
  nodeId?: string;
  jobId?: string;
  assetId?: string;
  status?: string;
  batchId?: string;
  exportPackId?: string;
  planId?: string;
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toArtifact(row: GeneratedArtifactRow): GeneratedArtifact {
  return {
    ...row,
    workflowId: row.workflowId ?? undefined,
    nodeId: row.nodeId ?? undefined,
    jobId: row.jobId ?? undefined,
    assetId: row.assetId ?? undefined,
    metadata: parseMetadata(row.metadata),
  };
}

export async function list(filters: ArtifactListFilters = {}): Promise<GeneratedArtifact[]> {
  const clauses: string[] = [];
  const values: string[] = [];

  for (const key of [
    "workflowId",
    "nodeId",
    "jobId",
    "assetId",
    "status",
    "batchId",
    "exportPackId",
    "planId",
  ] as const) {
    if (filters[key]) {
      clauses.push(`${key} = ?`);
      values.push(filters[key]);
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM generated_artifacts ${where} ORDER BY createdAt DESC`)
    .all(...values);

  return (rows as GeneratedArtifactRow[]).map(toArtifact);
}

export async function get(id: string): Promise<GeneratedArtifact | undefined> {
  const row = db.prepare("SELECT * FROM generated_artifacts WHERE id = ?").get(id) as
    | GeneratedArtifactRow
    | undefined;
  return row ? toArtifact(row) : undefined;
}

export async function add(params: CreateGeneratedArtifactParams): Promise<GeneratedArtifact> {
  const now = new Date().toISOString();
  const artifact: GeneratedArtifact = {
    id: `artifact_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    workflowId: params.workflowId?.trim() || undefined,
    nodeId: params.nodeId?.trim() || undefined,
    jobId: params.jobId?.trim() || undefined,
    assetId: params.assetId?.trim() || undefined,
    type: params.type?.trim() || "image",
    title: params.title.trim(),
    status: params.status?.trim() || "ready",
    url: params.url?.trim() || "",
    prompt: params.prompt?.trim() || "",
    provider: params.provider?.trim() || "",
    model: params.model?.trim() || "",
    metadata: params.metadata || {},
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(
    `INSERT INTO generated_artifacts (
       id, workflowId, nodeId, jobId, assetId, batchId, exportPackId, planId,
       type, title, status, url,
       prompt, provider, model, metadata, createdAt, updatedAt
     )
     VALUES (
       @id, @workflowId, @nodeId, @jobId, @assetId, @batchId, @exportPackId, @planId,
       @type, @title, @status, @url,
       @prompt, @provider, @model, @metadata, @createdAt, @updatedAt
     )`
  ).run({
    ...artifact,
    workflowId: artifact.workflowId ?? null,
    nodeId: artifact.nodeId ?? null,
    jobId: artifact.jobId ?? null,
    assetId: artifact.assetId ?? null,
    ...extractScopedMetadata(artifact.metadata),
    metadata: JSON.stringify(artifact.metadata),
  });

  return artifact;
}

export async function update(
  id: string,
  updates: UpdateGeneratedArtifactParams
): Promise<GeneratedArtifact | null> {
  const existing = await get(id);
  if (!existing) return null;

  const merged: GeneratedArtifact = {
    ...existing,
    workflowId:
      updates.workflowId !== undefined ? updates.workflowId.trim() || undefined : existing.workflowId,
    nodeId: updates.nodeId !== undefined ? updates.nodeId.trim() || undefined : existing.nodeId,
    jobId: updates.jobId !== undefined ? updates.jobId.trim() || undefined : existing.jobId,
    assetId: updates.assetId !== undefined ? updates.assetId.trim() || undefined : existing.assetId,
    type: updates.type !== undefined ? updates.type.trim() || existing.type : existing.type,
    title: updates.title !== undefined ? updates.title.trim() : existing.title,
    status: updates.status !== undefined ? updates.status.trim() : existing.status,
    url: updates.url !== undefined ? updates.url.trim() : existing.url,
    prompt: updates.prompt !== undefined ? updates.prompt.trim() : existing.prompt,
    provider: updates.provider !== undefined ? updates.provider.trim() : existing.provider,
    model: updates.model !== undefined ? updates.model.trim() : existing.model,
    metadata: updates.metadata ?? existing.metadata,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(
    `UPDATE generated_artifacts
     SET workflowId=@workflowId, nodeId=@nodeId, jobId=@jobId, assetId=@assetId,
       batchId=@batchId, exportPackId=@exportPackId, planId=@planId,
       type=@type, title=@title, status=@status, url=@url, prompt=@prompt,
       provider=@provider, model=@model, metadata=@metadata, updatedAt=@updatedAt
     WHERE id=@id`
  ).run({
    ...merged,
    workflowId: merged.workflowId ?? null,
    nodeId: merged.nodeId ?? null,
    jobId: merged.jobId ?? null,
    assetId: merged.assetId ?? null,
    ...extractScopedMetadata(merged.metadata),
    metadata: JSON.stringify(merged.metadata),
  });

  return merged;
}

export async function remove(id: string): Promise<boolean> {
  const result = db.prepare("DELETE FROM generated_artifacts WHERE id = ?").run(id);
  return result.changes > 0;
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
