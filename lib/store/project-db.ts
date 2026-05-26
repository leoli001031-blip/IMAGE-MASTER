import {
  buildExportPackBatchStateSnapshot,
  canEditExportPackBatch,
  normalizeExportPackBatchState,
  validateExportPackBatchTransition,
  type ExportPackBatchState,
  type ExportPackBatchStateSnapshot,
} from "@/lib/canvas/export-pack-state";
import type { ExportPackManifest } from "@/lib/canvas/export-pack-manifest";
import type {
  ReviewSessionHistoryEntry,
  ReviewSessionItem,
  ReviewSessionStatus,
} from "@/lib/canvas/reviewer-session";
import type { GeneratedArtifact, GenerationJob } from "@/lib/types";
import "server-only";
import db from "./db";
import * as jobDB from "./job-db";
import { isCancellableJob, markJobCancelledMetadata } from "./job-lifecycle";
import { removeJobFromRuntimeQueue } from "./job-runner";

const DEFAULT_PROJECT_ID = "project_default_canvas";
const DEFAULT_CAMPAIGN_ID = "campaign_default_canvas";

export interface ProjectRecord {
  id: string;
  title: string;
  description: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignRecord {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectBatchRecord {
  id: string;
  projectId: string;
  campaignId?: string;
  title: string;
  kind: string;
  state: ExportPackBatchState;
  metadata: Record<string, unknown>;
  lockedAt?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectReviewHistoryEntry {
  id: string;
  type: ReviewSessionHistoryEntry["type"] | "session";
  label: string;
  createdAt: string;
  sessionId: string;
  sessionTitle: string;
  batchId?: string;
}

export interface ProjectReviewSummary {
  sessionCount: number;
  itemCount: number;
  approved: number;
  rejected: number;
  needsRevision: number;
  pending: number;
  latestAt?: string;
  latestSessionTitle?: string;
  recentHistory: ProjectReviewHistoryEntry[];
}

export interface ProjectDetails extends ProjectRecord {
  campaigns: CampaignRecord[];
  batches: Array<
    ProjectBatchRecord & {
      batchState: ExportPackBatchStateSnapshot;
      reviewSummary: ProjectReviewSummary;
    }
  >;
  reviewSummary: ProjectReviewSummary;
}

export interface CreateProjectParams {
  id?: string;
  title: string;
  description?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateCampaignParams {
  id?: string;
  projectId: string;
  title: string;
  description?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateProjectBatchParams {
  id?: string;
  projectId: string;
  campaignId?: string;
  title: string;
  kind?: string;
  state?: ExportPackBatchState;
  metadata?: Record<string, unknown>;
}

export type UpdateProjectParams = Partial<Omit<CreateProjectParams, "id">>;
export type UpdateCampaignParams = Partial<Omit<CreateCampaignParams, "id" | "projectId">>;
export type UpdateProjectBatchParams = Partial<Omit<CreateProjectBatchParams, "id" | "projectId">>;

export interface ArchiveProjectBatchJobsParams {
  reason?: string;
  archivedBy?: string;
}

export interface ArchiveProjectBatchJobsResult {
  batch: ProjectBatchRecord;
  batchState: ExportPackBatchStateSnapshot;
  matchedJobIds: string[];
  cancelledJobIds: string[];
  skippedJobIds: string[];
  removedFromRuntimeQueueJobIds: string[];
}

type ProjectRow = Omit<ProjectRecord, "metadata"> & { metadata: string };
type CampaignRow = Omit<CampaignRecord, "metadata"> & { metadata: string };
type ProjectBatchRow = Omit<
  ProjectBatchRecord,
  "campaignId" | "state" | "metadata" | "lockedAt" | "deliveredAt"
> & {
  campaignId: string | null;
  state: string;
  metadata: string;
  lockedAt: string | null;
  deliveredAt: string | null;
};
type ReviewSessionRow = {
  id: string;
  title: string;
  status: string;
  summary: string;
  items: string;
  history: string;
  metadata: string;
  createdAt: string;
  updatedAt: string;
};

interface ReviewSessionLite {
  id: string;
  title: string;
  status: ReviewSessionStatus;
  summary: Record<string, unknown>;
  items: ReviewSessionItem[];
  history: ReviewSessionHistoryEntry[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  batchId?: string;
}

export async function listProjects(): Promise<ProjectDetails[]> {
  const projects = (db
    .prepare("SELECT * FROM projects ORDER BY updatedAt DESC")
    .all() as ProjectRow[]).map(toProject);
  return projects.map((project) => withChildren(project));
}

export async function getProject(id: string): Promise<ProjectDetails | undefined> {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  return row ? withChildren(toProject(row)) : undefined;
}

export async function createProject(params: CreateProjectParams): Promise<ProjectDetails> {
  const now = new Date().toISOString();
  const project: ProjectRecord = {
    id: params.id?.trim() || createId("project"),
    title: params.title.trim(),
    description: params.description?.trim() || "",
    status: params.status?.trim() || "active",
    metadata: params.metadata || {},
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(
    `INSERT INTO projects (id, title, description, status, metadata, createdAt, updatedAt)
     VALUES (@id, @title, @description, @status, @metadata, @createdAt, @updatedAt)`
  ).run({ ...project, metadata: stringifyRecord(project.metadata) });

  return withChildren(project);
}

export async function updateProject(
  id: string,
  updates: UpdateProjectParams
): Promise<ProjectDetails | null> {
  const existing = await getProject(id);
  if (!existing) return null;

  const merged: ProjectRecord = {
    ...existing,
    title: updates.title !== undefined ? updates.title.trim() : existing.title,
    description:
      updates.description !== undefined ? updates.description.trim() : existing.description,
    status: updates.status !== undefined ? updates.status.trim() : existing.status,
    metadata: updates.metadata ?? existing.metadata,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(
    `UPDATE projects
     SET title=@title, description=@description, status=@status, metadata=@metadata,
       updatedAt=@updatedAt
     WHERE id=@id`
  ).run({ ...merged, metadata: stringifyRecord(merged.metadata) });

  return (await getProject(id)) ?? null;
}

export async function createCampaign(params: CreateCampaignParams): Promise<CampaignRecord> {
  const project = await getProject(params.projectId);
  if (!project) throw new Error("project_not_found");

  const now = new Date().toISOString();
  const campaign: CampaignRecord = {
    id: params.id?.trim() || createId("campaign"),
    projectId: params.projectId,
    title: params.title.trim(),
    description: params.description?.trim() || "",
    status: params.status?.trim() || "active",
    metadata: params.metadata || {},
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(
    `INSERT INTO campaigns (id, projectId, title, description, status, metadata, createdAt, updatedAt)
     VALUES (@id, @projectId, @title, @description, @status, @metadata, @createdAt, @updatedAt)`
  ).run({ ...campaign, metadata: stringifyRecord(campaign.metadata) });
  touchProject(params.projectId);
  return campaign;
}

export async function updateCampaign(
  projectId: string,
  campaignId: string,
  updates: UpdateCampaignParams
): Promise<CampaignRecord | null> {
  const existing = getCampaign(campaignId);
  if (!existing || existing.projectId !== projectId) return null;

  const merged: CampaignRecord = {
    ...existing,
    title: updates.title !== undefined ? updates.title.trim() : existing.title,
    description:
      updates.description !== undefined ? updates.description.trim() : existing.description,
    status: updates.status !== undefined ? updates.status.trim() : existing.status,
    metadata: updates.metadata ?? existing.metadata,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(
    `UPDATE campaigns
     SET title=@title, description=@description, status=@status, metadata=@metadata,
       updatedAt=@updatedAt
     WHERE id=@id`
  ).run({ ...merged, metadata: stringifyRecord(merged.metadata) });
  touchProject(projectId);
  return merged;
}

export async function createBatch(params: CreateProjectBatchParams): Promise<ProjectBatchRecord> {
  const project = await getProject(params.projectId);
  if (!project) throw new Error("project_not_found");
  if (params.campaignId) {
    const campaign = getCampaign(params.campaignId);
    if (!campaign || campaign.projectId !== params.projectId) throw new Error("campaign_not_found");
  }

  const now = new Date().toISOString();
  const state = normalizeExportPackBatchState(params.state);
  const batch: ProjectBatchRecord = {
    id: params.id?.trim() || createId("batch"),
    projectId: params.projectId,
    campaignId: params.campaignId?.trim() || undefined,
    title: params.title.trim(),
    kind: params.kind?.trim() || "export_pack",
    state,
    metadata: params.metadata || {},
    lockedAt: state === "locked" ? now : undefined,
    deliveredAt: state === "delivered" ? now : undefined,
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(
    `INSERT INTO project_batches (
       id, projectId, campaignId, title, kind, state, metadata, lockedAt, deliveredAt,
       createdAt, updatedAt
     )
     VALUES (
       @id, @projectId, @campaignId, @title, @kind, @state, @metadata, @lockedAt,
       @deliveredAt, @createdAt, @updatedAt
     )`
  ).run(toBatchParams(batch));
  touchProject(params.projectId);
  return batch;
}

export async function updateBatch(
  projectId: string,
  batchId: string,
  updates: UpdateProjectBatchParams
): Promise<ProjectBatchRecord | null> {
  const existing = await getBatch(batchId);
  if (!existing || existing.projectId !== projectId) return null;

  const meaningfulUpdateKeys = Object.entries(updates)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  const updatesOnlyState = meaningfulUpdateKeys.every((key) => key === "state");
  if (!canEditExportPackBatch(existing.state, updatesOnlyState)) {
    throw new Error("batch_locked");
  }

  const nextState =
    updates.state !== undefined ? normalizeExportPackBatchState(updates.state) : existing.state;
  const transitionError = validateExportPackBatchTransition(existing.state, nextState);
  if (transitionError) throw new Error(transitionError);

  if (updates.campaignId) {
    const campaign = getCampaign(updates.campaignId);
    if (!campaign || campaign.projectId !== projectId) throw new Error("campaign_not_found");
  }

  const now = new Date().toISOString();
  const merged: ProjectBatchRecord = {
    ...existing,
    campaignId:
      updates.campaignId !== undefined ? updates.campaignId.trim() || undefined : existing.campaignId,
    title: updates.title !== undefined ? updates.title.trim() : existing.title,
    kind: updates.kind !== undefined ? updates.kind.trim() || existing.kind : existing.kind,
    state: nextState,
    metadata: updates.metadata ?? existing.metadata,
    lockedAt: nextState === "locked" ? existing.lockedAt || now : existing.lockedAt,
    deliveredAt: nextState === "delivered" ? existing.deliveredAt || now : existing.deliveredAt,
    updatedAt: now,
  };

  db.prepare(
    `UPDATE project_batches
     SET campaignId=@campaignId, title=@title, kind=@kind, state=@state, metadata=@metadata,
       lockedAt=@lockedAt, deliveredAt=@deliveredAt, updatedAt=@updatedAt
     WHERE id=@id`
  ).run(toBatchParams(merged));
  touchProject(projectId);
  return merged;
}

export async function getBatch(batchId: string): Promise<ProjectBatchRecord | undefined> {
  const row = db
    .prepare("SELECT * FROM project_batches WHERE id = ?")
    .get(batchId) as ProjectBatchRow | undefined;
  return row ? toBatch(row) : undefined;
}

export async function getExportPackBatchState(
  batchId: string
): Promise<ExportPackBatchStateSnapshot | undefined> {
  const batch = await getBatch(batchId);
  return batch ? buildExportPackBatchStateSnapshot(batch) : undefined;
}

export async function archiveProjectBatchJobs(
  projectId: string,
  batchId: string,
  params: ArchiveProjectBatchJobsParams = {}
): Promise<ArchiveProjectBatchJobsResult | null> {
  const existing = await getBatch(batchId);
  if (!existing || existing.projectId !== projectId) return null;
  if (!canEditExportPackBatch(existing.state, false)) {
    throw new Error("batch_locked");
  }

  const now = new Date().toISOString();
  const reason = params.reason?.trim() || "批次归档清理";
  const archivedBy = params.archivedBy?.trim() || "canvas";
  const batchJobIds = new Set(getStringArray(existing.metadata.jobIds));
  const jobs = await jobDB.list();
  const matchedJobs = jobs.filter(
    (job) => getString(job.metadata.batchId) === batchId || batchJobIds.has(job.id)
  );
  const cancelledJobIds: string[] = [];
  const skippedJobIds: string[] = [];
  const removedFromRuntimeQueueJobIds: string[] = [];

  for (const job of matchedJobs) {
    if (!isCancellableJob(job)) {
      skippedJobIds.push(job.id);
      continue;
    }

    const removedFromRuntimeQueue = removeJobFromRuntimeQueue(job.id);
    const cancelled = await jobDB.update(job.id, {
      status: "cancelled",
      error: reason,
      metadata: {
        ...markJobCancelledMetadata(job, reason, now),
        batchArchivedAt: now,
        batchArchiveReason: reason,
      },
    });

    if (cancelled) cancelledJobIds.push(job.id);
    if (removedFromRuntimeQueue) removedFromRuntimeQueueJobIds.push(job.id);
  }

  const updated = updateUnlockedBatch(existing, {
    title: existing.title,
    state: existing.state,
    metadata: {
      ...existing.metadata,
      archivedAt: now,
      archivedBy,
      archiveReason: reason,
      archiveCleanup: {
        matchedCount: matchedJobs.length,
        cancelledCount: cancelledJobIds.length,
        skippedCount: skippedJobIds.length,
        removedFromRuntimeQueueCount: removedFromRuntimeQueueJobIds.length,
        matchedJobIds: matchedJobs.map((job) => job.id),
        cancelledJobIds,
        skippedJobIds,
        removedFromRuntimeQueueJobIds,
        updatedAt: now,
      },
    },
  });
  touchProject(projectId);

  return {
    batch: updated,
    batchState: buildExportPackBatchStateSnapshot(updated),
    matchedJobIds: matchedJobs.map((job) => job.id),
    cancelledJobIds,
    skippedJobIds,
    removedFromRuntimeQueueJobIds,
  };
}

export async function ensureExportPackBatchForJob(
  job: GenerationJob & { metadata: Record<string, unknown> }
): Promise<ExportPackBatchStateSnapshot | undefined> {
  const batchId = getString(job.metadata.batchId);
  if (!batchId) return undefined;

  const existing = await getBatch(batchId);
  const title =
    getString(job.metadata.exportPackTitle) ??
    getString(job.metadata.batchJobTitle) ??
    "导出包批次";
  const state = isGeneratedJob(job) ? "generated" : "draft";
  const ownership = resolveOwnershipFromMetadata(job.metadata);
  const ownershipMetadata = buildOwnershipMetadataFromJob(job);

  if (existing) {
    if (existing.state === "locked" || existing.state === "delivered") {
      return buildExportPackBatchStateSnapshot(existing);
    }

    const nextState = existing.state === "draft" && state === "generated" ? "generated" : existing.state;
    const updated = await updateUnlockedBatch(existing, {
      title: existing.title || title,
      state: nextState,
      metadata: mergeOwnershipMetadata(existing.metadata, ownershipMetadata),
    });
    return buildExportPackBatchStateSnapshot(updated);
  }

  try {
    const batch = await createBatch({
      id: batchId,
      projectId: ownership.projectId,
      campaignId: ownership.campaignId,
      title,
      kind: "export_pack",
      state,
      metadata: ownershipMetadata,
    });
    return buildExportPackBatchStateSnapshot(batch);
  } catch (error) {
    if (!isProjectBatchUniqueConstraintError(error)) throw error;

    const racedExisting = await getBatch(batchId);
    if (!racedExisting) throw error;
    if (racedExisting.state === "locked" || racedExisting.state === "delivered") {
      return buildExportPackBatchStateSnapshot(racedExisting);
    }

    const nextState =
      racedExisting.state === "draft" && state === "generated"
        ? "generated"
        : racedExisting.state;
    const updated = await updateUnlockedBatch(racedExisting, {
      title: racedExisting.title || title,
      state: nextState,
      metadata: mergeOwnershipMetadata(racedExisting.metadata, ownershipMetadata),
    });
    return buildExportPackBatchStateSnapshot(updated);
  }
}

export async function ensureExportPackBatchForManifest({
  manifest,
  jobs,
  artifacts,
}: {
  manifest: ExportPackManifest;
  jobs: Array<GenerationJob & { metadata: Record<string, unknown> }>;
  artifacts: Array<GeneratedArtifact & { metadata: Record<string, unknown> }>;
}): Promise<ExportPackBatchStateSnapshot> {
  const existing = await getBatch(manifest.batchId);
  const ownershipMetadata = buildOwnershipMetadata({ manifest, jobs, artifacts });
  if (existing) {
    const nextMetadata =
      existing.state === "locked" || existing.state === "delivered"
        ? existing.metadata
        : mergeOwnershipMetadata(existing.metadata, ownershipMetadata);
    const nextState = existing.state === "draft" ? "generated" : existing.state;
    const updated =
      existing.state !== nextState || nextMetadata !== existing.metadata
        ? await updateUnlockedBatch(existing, {
            title: manifest.title,
            state: nextState,
            metadata: nextMetadata,
          })
        : existing;
    return buildExportPackBatchStateSnapshot(updated);
  }

  const ownership = resolveOwnershipFromMetadata(ownershipMetadata);
  const batch = await createBatch({
    id: manifest.batchId,
    projectId: ownership.projectId,
    campaignId: ownership.campaignId,
    title: manifest.title,
    kind: "export_pack",
    state: "generated",
    metadata: ownershipMetadata,
  });
  return buildExportPackBatchStateSnapshot(batch);
}

export async function moveExportPackBatchToReview(
  batchId: string
): Promise<ExportPackBatchStateSnapshot | undefined> {
  const batch = await getBatch(batchId);
  if (!batch) return undefined;
  if (batch.state !== "generated") return buildExportPackBatchStateSnapshot(batch);
  const updated = await updateBatch(batch.projectId, batch.id, { state: "in_review" });
  return updated ? buildExportPackBatchStateSnapshot(updated) : undefined;
}

export async function markExportPackBatchReviewedIfComplete({
  batchId,
  complete,
}: {
  batchId: string;
  complete: boolean;
}): Promise<ExportPackBatchStateSnapshot | undefined> {
  const batch = await getBatch(batchId);
  if (!batch) return undefined;
  if (!complete || batch.state !== "in_review") return buildExportPackBatchStateSnapshot(batch);
  const updated = await updateBatch(batch.projectId, batch.id, { state: "reviewed" });
  return updated ? buildExportPackBatchStateSnapshot(updated) : undefined;
}

export async function reopenExportPackBatchForRerun({
  batchId,
  jobId,
  now = new Date().toISOString(),
}: {
  batchId: string;
  jobId: string;
  now?: string;
}): Promise<ExportPackBatchStateSnapshot | undefined> {
  const batch = await getBatch(batchId);
  if (!batch) return undefined;
  if (batch.state === "locked" || batch.state === "delivered") {
    return buildExportPackBatchStateSnapshot(batch);
  }

  const nextState =
    batch.state === "reviewed" ? "in_review" : batch.state === "draft" ? "generated" : batch.state;
  const updated = updateUnlockedBatch(batch, {
    title: batch.title,
    state: nextState,
    metadata: {
      ...batch.metadata,
      jobIds: mergeStringArrays(batch.metadata.jobIds, [jobId]),
      reopenedAt: now,
      reopenedReason: "result-rerun",
      latestRerunJobId: jobId,
    },
  });
  touchProject(updated.projectId);
  return buildExportPackBatchStateSnapshot(updated);
}

function withChildren(project: ProjectRecord): ProjectDetails {
  const campaigns = (db
    .prepare("SELECT * FROM campaigns WHERE projectId = ? ORDER BY updatedAt DESC")
    .all(project.id) as CampaignRow[]).map(toCampaign);
  const batches = (db
    .prepare("SELECT * FROM project_batches WHERE projectId = ? ORDER BY updatedAt DESC")
    .all(project.id) as ProjectBatchRow[]).map(toBatch);
  const reviewSessions = getReviewSessionsForProject(project.id, batches);
  const reviewSessionsByBatchId = groupReviewSessionsByBatchId(reviewSessions);

  return {
    ...project,
    campaigns,
    reviewSummary: summarizeReviewSessions(reviewSessions),
    batches: batches.map((batch) => ({
      ...batch,
      batchState: buildExportPackBatchStateSnapshot(batch),
      reviewSummary: summarizeReviewSessions(reviewSessionsByBatchId.get(batch.id) ?? []),
    })),
  };
}

function ensureDefaultHierarchy(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO projects (id, title, description, status, metadata, createdAt, updatedAt)
     VALUES (@id, @title, @description, @status, @metadata, @createdAt, @updatedAt)`
  ).run({
    id: DEFAULT_PROJECT_ID,
    title: "Default Canvas Project",
    description: "Auto-created project for existing canvas batches.",
    status: "active",
    metadata: stringifyRecord({
      source: "default-canvas-project",
      compatibility: ["demo_batch_showcase", "job.metadata.batchId"],
    }),
    createdAt: now,
    updatedAt: now,
  });
  db.prepare(
    `INSERT OR IGNORE INTO campaigns (
       id, projectId, title, description, status, metadata, createdAt, updatedAt
     )
     VALUES (@id, @projectId, @title, @description, @status, @metadata, @createdAt, @updatedAt)`
  ).run({
    id: DEFAULT_CAMPAIGN_ID,
    projectId: DEFAULT_PROJECT_ID,
    title: "Default Campaign",
    description: "Auto-created campaign for existing export pack metadata.",
    status: "active",
    metadata: stringifyRecord({ source: "default-canvas-campaign" }),
    createdAt: now,
    updatedAt: now,
  });
}

function getCampaign(id: string): CampaignRecord | undefined {
  const row = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as
    | CampaignRow
    | undefined;
  return row ? toCampaign(row) : undefined;
}

function projectExists(id: string): boolean {
  return !!db.prepare("SELECT id FROM projects WHERE id = ?").get(id);
}

function resolveOwnershipFromMetadata(
  metadata: Record<string, unknown>
): { projectId: string; campaignId?: string } {
  const projectId = getString(metadata.projectId);
  if (projectId && projectExists(projectId)) {
    const campaignId = getString(metadata.campaignId);
    const campaign = campaignId ? getCampaign(campaignId) : undefined;
    return {
      projectId,
      campaignId: campaign?.projectId === projectId ? campaign.id : undefined,
    };
  }

  ensureDefaultHierarchy();
  return {
    projectId: DEFAULT_PROJECT_ID,
    campaignId: DEFAULT_CAMPAIGN_ID,
  };
}

function resolveOwnershipFromMetadataList(
  metadataList: Array<Record<string, unknown>>
): { projectId: string; campaignId?: string } {
  for (const metadata of metadataList) {
    const projectId = getString(metadata.projectId);
    if (projectId && projectExists(projectId)) {
      const campaignId = getString(metadata.campaignId);
      const campaign = campaignId ? getCampaign(campaignId) : undefined;
      return {
        projectId,
        campaignId: campaign?.projectId === projectId ? campaign.id : undefined,
      };
    }
  }

  ensureDefaultHierarchy();
  return {
    projectId: DEFAULT_PROJECT_ID,
    campaignId: DEFAULT_CAMPAIGN_ID,
  };
}

function updateUnlockedBatch(
  existing: ProjectBatchRecord,
  updates: {
    title: string;
    state: ExportPackBatchState;
    metadata: Record<string, unknown>;
  }
): ProjectBatchRecord {
  const now = new Date().toISOString();
  const merged: ProjectBatchRecord = {
    ...existing,
    title: updates.title,
    state: updates.state,
    metadata: updates.metadata,
    updatedAt: now,
  };
  db.prepare(
    `UPDATE project_batches
     SET title=@title, state=@state, metadata=@metadata, updatedAt=@updatedAt
     WHERE id=@id`
  ).run({
    id: merged.id,
    title: merged.title,
    state: merged.state,
    metadata: stringifyRecord(merged.metadata),
    updatedAt: merged.updatedAt,
  });
  return merged;
}

function buildOwnershipMetadata({
  manifest,
  jobs,
  artifacts,
}: {
  manifest: ExportPackManifest;
  jobs: Array<GenerationJob & { metadata: Record<string, unknown> }>;
  artifacts: Array<GeneratedArtifact & { metadata: Record<string, unknown> }>;
}): Record<string, unknown> {
  const batchJobs = jobs.filter((job) => getString(job.metadata.batchId) === manifest.batchId);
  const batchJobIds = new Set(batchJobs.map((job) => job.id));
  const batchArtifacts = artifacts.filter(
    (artifact) =>
      (artifact.jobId && batchJobIds.has(artifact.jobId)) ||
      getString(artifact.metadata.batchId) === manifest.batchId
  );
  const metadataList = [...batchJobs.map((job) => job.metadata), ...batchArtifacts.map((item) => item.metadata)];
  const ownership = resolveOwnershipFromMetadataList(metadataList);

  return {
    source: "export-pack-manifest",
    projectId: ownership.projectId,
    campaignId: ownership.campaignId,
    batchId: manifest.batchId,
    exportPackIds: uniqueStrings(metadataList, "exportPackId"),
    workflowIds: uniqueDefined(batchJobs.map((job) => job.workflowId)),
    productIds: uniqueDefined([
      ...batchJobs.map((job) => job.assetId),
      ...batchArtifacts.map((artifact) => artifact.assetId),
      ...metadataList.map((metadata) => getString(metadata.sourceAssetId)),
      ...metadataList.map((metadata) => getString(metadata.productId)),
    ]),
    jobIds: Array.from(batchJobIds),
    artifactIds: batchArtifacts.map((artifact) => artifact.id),
    reviewSessionIds: uniqueStrings(metadataList, "reviewSessionId"),
    platform: manifest.platform,
    itemCount: manifest.items.length,
    counts: manifest.counts,
    refreshedAt: new Date().toISOString(),
  };
}

function buildOwnershipMetadataFromJob(
  job: GenerationJob & { metadata: Record<string, unknown> }
): Record<string, unknown> {
  const batchId = getString(job.metadata.batchId) ?? "";
  const ownership = resolveOwnershipFromMetadata(job.metadata);
  return {
    source: "job-create",
    projectId: ownership.projectId,
    campaignId: ownership.campaignId,
    batchId,
    exportPackIds: uniqueDefined([getString(job.metadata.exportPackId)]),
    workflowIds: uniqueDefined([job.workflowId]),
    productIds: uniqueDefined([
      job.assetId,
      getString(job.metadata.sourceAssetId),
      getString(job.metadata.productAssetId),
      getString(job.metadata.productId),
    ]),
    jobIds: [job.id],
    artifactIds: [],
    reviewSessionIds: [],
    platform: getString(job.metadata.platform) ?? "multi_channel",
    itemCount: getNumber(job.metadata.batchTotal) ?? 1,
    refreshedAt: new Date().toISOString(),
  };
}

function isGeneratedJob(job: Pick<GenerationJob, "status">): boolean {
  return job.status === "done" || job.status === "completed";
}

function isProjectBatchUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = getString((error as { code?: unknown }).code);
  return (
    code?.startsWith("SQLITE_CONSTRAINT") === true ||
    error.message.includes("UNIQUE constraint failed: project_batches.id")
  );
}

function mergeOwnershipMetadata(
  existing: Record<string, unknown>,
  next: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...existing,
    ...next,
    exportPackIds: mergeStringArrays(existing.exportPackIds, next.exportPackIds),
    workflowIds: mergeStringArrays(existing.workflowIds, next.workflowIds),
    productIds: mergeStringArrays(existing.productIds, next.productIds),
    jobIds: mergeStringArrays(existing.jobIds, next.jobIds),
    artifactIds: mergeStringArrays(existing.artifactIds, next.artifactIds),
    reviewSessionIds: mergeStringArrays(existing.reviewSessionIds, next.reviewSessionIds),
  };
}

function toProject(row: ProjectRow): ProjectRecord {
  return { ...row, metadata: parseRecord(row.metadata) };
}

function toCampaign(row: CampaignRow): CampaignRecord {
  return { ...row, metadata: parseRecord(row.metadata) };
}

function toBatch(row: ProjectBatchRow): ProjectBatchRecord {
  return {
    ...row,
    campaignId: row.campaignId ?? undefined,
    state: normalizeExportPackBatchState(row.state),
    metadata: parseRecord(row.metadata),
    lockedAt: row.lockedAt ?? undefined,
    deliveredAt: row.deliveredAt ?? undefined,
  };
}

function toBatchParams(batch: ProjectBatchRecord): Record<string, unknown> {
  return {
    ...batch,
    campaignId: batch.campaignId ?? null,
    metadata: stringifyRecord(batch.metadata),
    lockedAt: batch.lockedAt ?? null,
    deliveredAt: batch.deliveredAt ?? null,
  };
}

function getReviewSessionsForProject(
  projectId: string,
  batches: ProjectBatchRecord[]
): ReviewSessionLite[] {
  const batchIds = new Set(batches.map((batch) => batch.id));
  const rows = db
    .prepare("SELECT id, title, status, summary, items, history, metadata, createdAt, updatedAt FROM review_sessions ORDER BY updatedAt DESC")
    .all() as ReviewSessionRow[];

  return rows
    .map(toReviewSessionLite)
    .filter(
      (session) =>
        getString(session.metadata.projectId) === projectId ||
        (!!session.batchId && batchIds.has(session.batchId))
    );
}

function groupReviewSessionsByBatchId(
  sessions: ReviewSessionLite[]
): Map<string, ReviewSessionLite[]> {
  const groups = new Map<string, ReviewSessionLite[]>();
  for (const session of sessions) {
    if (!session.batchId) continue;
    groups.set(session.batchId, [...(groups.get(session.batchId) ?? []), session]);
  }
  return groups;
}

function summarizeReviewSessions(sessions: ReviewSessionLite[]): ProjectReviewSummary {
  const recentHistory = sessions
    .flatMap((session) => getReviewHistoryEntries(session))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);
  const latestSession = sessions
    .slice()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

  return {
    sessionCount: sessions.length,
    itemCount: sessions.reduce((total, session) => total + getReviewItemCount(session), 0),
    approved: sessions.reduce((total, session) => total + getReviewCounter(session, "approved"), 0),
    rejected: sessions.reduce((total, session) => total + getReviewCounter(session, "rejected"), 0),
    needsRevision: sessions.reduce((total, session) => total + getReviewCounter(session, "needsRevision"), 0),
    pending: sessions.reduce((total, session) => total + getReviewCounter(session, "pending"), 0),
    latestAt: latestSession?.updatedAt,
    latestSessionTitle: latestSession?.title,
    recentHistory,
  };
}

function toReviewSessionLite(row: ReviewSessionRow): ReviewSessionLite {
  const metadata = parseRecord(row.metadata);
  const items = parseArray<ReviewSessionItem>(row.items);
  const session: ReviewSessionLite = {
    id: row.id,
    title: row.title,
    status: normalizeReviewSessionStatus(row.status),
    summary: parseRecord(row.summary),
    items,
    history: parseArray<ReviewSessionHistoryEntry>(row.history),
    metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    batchId: getReviewSessionBatchId(metadata, items),
  };
  return session;
}

function getReviewSessionBatchId(
  metadata: Record<string, unknown>,
  items: ReviewSessionItem[]
): string | undefined {
  const metadataBatchId = getString(metadata.batchId);
  if (metadataBatchId) return metadataBatchId;

  const metadataBatchIds = Array.isArray(metadata.batchIds)
    ? metadata.batchIds.filter((item): item is string => typeof item === "string" && !!item.trim())
    : [];
  if (metadataBatchIds.length > 0) return metadataBatchIds[0].trim();

  for (const item of items) {
    const itemBatchId = getString(item.metadata?.batchId);
    if (itemBatchId) return itemBatchId;
  }

  return undefined;
}

function getReviewHistoryEntries(session: ReviewSessionLite): ProjectReviewHistoryEntry[] {
  if (session.history.length === 0) {
    return [
      {
        id: `${session.id}:session`,
        type: "session",
        label: `Review session ${session.status}`,
        createdAt: session.updatedAt || session.createdAt,
        sessionId: session.id,
        sessionTitle: session.title,
        batchId: session.batchId,
      },
    ];
  }

  return session.history.map((entry) => ({
    id: `${session.id}:${entry.id}`,
    type: entry.type,
    label: entry.label,
    createdAt: entry.createdAt || session.updatedAt || session.createdAt,
    sessionId: session.id,
    sessionTitle: session.title,
    batchId: session.batchId,
  }));
}

function getReviewItemCount(session: ReviewSessionLite): number {
  return getNumber(session.summary.total) ?? session.items.length;
}

function getReviewCounter(session: ReviewSessionLite, key: string): number {
  return getNumber(session.summary[key]) ?? 0;
}

function normalizeReviewSessionStatus(value: string): ReviewSessionStatus {
  if (
    value === "pending" ||
    value === "in_review" ||
    value === "approved" ||
    value === "rejected" ||
    value === "needs_revision"
  ) {
    return value;
  }
  return "pending";
}

function touchProject(projectId: string): void {
  db.prepare("UPDATE projects SET updatedAt = ? WHERE id = ?").run(new Date().toISOString(), projectId);
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function stringifyRecord(value: Record<string, unknown>): string {
  return JSON.stringify(value || {});
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && !!item.trim())
    : [];
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function uniqueStrings(metadataList: Array<Record<string, unknown>>, key: string): string[] {
  return uniqueDefined(metadataList.map((metadata) => getString(metadata[key])));
}

function uniqueDefined(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value)));
}

function mergeStringArrays(existing: unknown, next: unknown): string[] {
  const existingValues = Array.isArray(existing)
    ? existing.filter((value): value is string => typeof value === "string" && !!value.trim())
    : [];
  const nextValues = Array.isArray(next)
    ? next.filter((value): value is string => typeof value === "string" && !!value.trim())
    : [];
  return Array.from(new Set([...existingValues, ...nextValues]));
}
