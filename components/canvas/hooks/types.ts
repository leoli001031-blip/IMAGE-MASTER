import type { GenerationJob } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Shared types extracted from visual-workbench.tsx                   */
/* ------------------------------------------------------------------ */

export interface PersistedAsset {
  id: string;
  type: string;
  title: string;
  description?: string;
  status?: string;
  url?: string;
  metadata?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

export interface PersistedGeneratedArtifact {
  id: string;
  workflowId?: string;
  nodeId?: string;
  jobId?: string;
  assetId?: string;
  type: string;
  title: string;
  status: string;
  url: string;
  prompt: string;
  provider: string;
  model: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedGenerationJob extends GenerationJob {
  metadata: Record<string, unknown>;
}

export interface PersistedJobQueueSnapshot {
  concurrency: number;
  owner?: string;
  leaseDurationMs?: number;
  runtime: {
    queuedJobIds: string[];
    runningJobIds: string[];
    queuedCount: number;
    runningCount: number;
  };
  database: {
    total: number;
    pending: number;
    queued: number;
    running: number;
    done: number;
    failed: number;
    cancelled: number;
  };
  stale: {
    queuedJobIds: string[];
    runningJobIds: string[];
    expiredJobIds?: string[];
    missingLeaseJobIds?: string[];
    count?: number;
    expiredCount?: number;
  };
  leases?: PersistedJobQueueLease[];
}

export interface PersistedJobQueueLease {
  jobId: string;
  status: string;
  owner?: string;
  expired?: boolean;
  inRuntimeQueue?: boolean;
  inRuntimeRunning?: boolean;
}

export interface PersistedProjectDetails {
  id: string;
  title: string;
  description?: string;
  status?: string;
  metadata?: Record<string, unknown>;
  campaigns: PersistedCampaign[];
  batches: PersistedProjectBatch[];
  reviewSummary?: PersistedProjectReviewSummary;
  updatedAt?: string;
}

export interface PersistedCampaign {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface PersistedProjectBatch {
  id: string;
  projectId: string;
  campaignId?: string;
  title: string;
  kind: string;
  state: string;
  metadata: Record<string, unknown>;
  batchState?: PersistedExportPackBatchState;
  reviewSummary?: PersistedProjectReviewSummary;
  updatedAt?: string;
}

export interface PersistedExportPackBatchState {
  batchId: string;
  projectId: string;
  campaignId?: string;
  state: string;
  label: string;
  locked: boolean;
  delivered: boolean;
  canTransitionTo: string[];
  lockedAt?: string;
  deliveredAt?: string;
  updatedAt: string;
}

export interface PersistedProjectReviewSummary {
  sessionCount: number;
  itemCount: number;
  approved: number;
  rejected: number;
  needsRevision: number;
  pending: number;
  latestAt?: string;
  latestSessionTitle?: string;
  recentHistory: PersistedProjectReviewHistoryEntry[];
}

export interface PersistedProjectReviewHistoryEntry {
  id: string;
  type: string;
  label: string;
  createdAt: string;
  sessionId: string;
  sessionTitle: string;
  batchId?: string;
}

export interface PersistedComponent {
  id: string;
  type: string;
  title: string;
  description: string;
  status: string;
  version: number;
  assetId?: string;
  rules?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}
