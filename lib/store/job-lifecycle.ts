import type { GenerationJob } from "@/lib/types";
import { releaseJobLease } from "@/lib/store/job-lease-db";

export const jobStatuses = [
  "pending",
  "queued",
  "running",
  "done",
  "completed",
  "failed",
  "cancelled",
] as const;

export type GenerationJobStatus = (typeof jobStatuses)[number];

export type JobLifecycleMetadata = Record<string, unknown>;
type JobLifecycleSubject = Pick<GenerationJob, "metadata"> & Partial<Pick<GenerationJob, "id">>;

export interface JobLeaseOptions {
  leaseId?: string;
  owner: string;
  durationMs: number;
  now?: string;
}

export interface JobLeaseInfo {
  leaseId: string;
  owner: string;
  expiresAt: string;
  heartbeatAt: string;
  acquiredAt: string;
  status: string;
  expired: boolean;
}

const activeStatuses = new Set<GenerationJobStatus>(["pending", "queued", "running"]);
const doneStatuses = new Set<GenerationJobStatus>(["done", "completed"]);
const terminalStatuses = new Set<GenerationJobStatus>([
  "done",
  "completed",
  "failed",
  "cancelled",
]);
const cancellableStatuses = new Set<GenerationJobStatus>(["pending", "queued", "running"]);
const retryableStatuses = new Set<GenerationJobStatus>(["failed", "cancelled"]);

export function isJobStatus(value: string): value is GenerationJobStatus {
  return jobStatuses.includes(value as GenerationJobStatus);
}

export function getJobStatus(job: Pick<GenerationJob, "status">): GenerationJobStatus | string {
  return isJobStatus(job.status) ? job.status : job.status;
}

export function isActiveJob(job: Pick<GenerationJob, "status">): boolean {
  return isJobStatus(job.status) && activeStatuses.has(job.status);
}

export function isDoneJob(job: Pick<GenerationJob, "status">): boolean {
  return isJobStatus(job.status) && doneStatuses.has(job.status);
}

export function isTerminalJob(job: Pick<GenerationJob, "status">): boolean {
  return isJobStatus(job.status) && terminalStatuses.has(job.status);
}

export function isCancellableJob(job: Pick<GenerationJob, "status">): boolean {
  return isJobStatus(job.status) && cancellableStatuses.has(job.status);
}

export function isRetryableJob(job: Pick<GenerationJob, "status">): boolean {
  return isJobStatus(job.status) && retryableStatuses.has(job.status);
}

export function mergeJobMetadata(
  base: JobLifecycleMetadata | undefined,
  updates: JobLifecycleMetadata
): JobLifecycleMetadata {
  return {
    ...(base ?? {}),
    ...updates,
  };
}

export function markJobQueuedMetadata(
  job: Pick<GenerationJob, "metadata">,
  runId: string,
  now = new Date().toISOString(),
  lease?: JobLeaseOptions
): JobLifecycleMetadata {
  const startCount = readNumber(job.metadata.startCount) + 1;
  const attempt = readNumber(job.metadata.attempt) + 1;

  const metadata = mergeJobMetadata(job.metadata, {
    queuedAt: now,
    startedAt: now,
    startCount,
    attempt,
    lastRunId: runId,
  });

  return lease ? applyJobLeaseMetadata({ metadata }, runId, { ...lease, now }) : metadata;
}

export function markJobStartedMetadata(
  job: Pick<GenerationJob, "metadata">,
  runId: string,
  now = new Date().toISOString(),
  lease?: JobLeaseOptions
): JobLifecycleMetadata {
  const metadata = mergeJobMetadata(job.metadata, {
    startedAt: now,
    lastRunId: runId,
  });

  return lease ? applyJobLeaseMetadata({ metadata }, runId, { ...lease, now }) : metadata;
}

export function markJobCompletedMetadata(
  job: JobLifecycleSubject,
  updates: JobLifecycleMetadata = {},
  now = new Date().toISOString()
): JobLifecycleMetadata {
  releaseLeaseForJob(job, "completed", now);
  return releaseJobLeaseMetadata(
    {
      metadata: mergeJobMetadata(job.metadata, {
        ...updates,
        completedAt: now,
      }),
    },
    now,
    "completed"
  );
}

export function markJobFailedMetadata(
  job: JobLifecycleSubject,
  now = new Date().toISOString()
): JobLifecycleMetadata {
  releaseLeaseForJob(job, "failed", now);
  return releaseJobLeaseMetadata(
    {
      metadata: mergeJobMetadata(job.metadata, {
        failedAt: now,
      }),
    },
    now,
    "failed"
  );
}

export function markJobCancelledMetadata(
  job: JobLifecycleSubject,
  reason: string,
  now = new Date().toISOString()
): JobLifecycleMetadata {
  releaseLeaseForJob(job, "cancelled", now);
  return releaseJobLeaseMetadata(
    {
      metadata: mergeJobMetadata(job.metadata, {
        cancelledAt: now,
        cancelReason: reason,
      }),
    },
    now,
    "cancelled"
  );
}

export function markJobRetriedMetadata(
  job: JobLifecycleSubject,
  now = new Date().toISOString()
): JobLifecycleMetadata {
  releaseLeaseForJob(job, "retried", now);
  return releaseJobLeaseMetadata(
    {
      metadata: mergeJobMetadata(job.metadata, {
        retryCount: readNumber(job.metadata.retryCount) + 1,
        retriedAt: now,
      }),
    },
    now,
    "retried"
  );
}

export function applyJobLeaseMetadata(
  job: Pick<GenerationJob, "metadata">,
  runId: string,
  options: JobLeaseOptions
): JobLifecycleMetadata {
  const now = options.now ?? new Date().toISOString();
  const expiresAt = new Date(new Date(now).getTime() + options.durationMs).toISOString();
  const previousLeaseId = readString(job.metadata.leaseId);
  const leaseId = options.leaseId || `lease_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

  return mergeJobMetadata(job.metadata, {
    leaseId,
    leaseOwner: options.owner,
    leaseStatus: "active",
    leaseAcquiredAt: now,
    leaseHeartbeatAt: now,
    leaseExpiresAt: expiresAt,
    leaseDurationMs: options.durationMs,
    lastRunId: runId,
    previousLeaseId: previousLeaseId && previousLeaseId !== leaseId ? previousLeaseId : undefined,
  });
}

export function heartbeatJobLeaseMetadata(
  job: Pick<GenerationJob, "metadata">,
  owner: string,
  now = new Date().toISOString()
): JobLifecycleMetadata {
  const durationMs = readNumber(job.metadata.leaseDurationMs);
  const expiresAt = new Date(new Date(now).getTime() + Math.max(durationMs, 1)).toISOString();

  return mergeJobMetadata(job.metadata, {
    leaseOwner: owner,
    leaseStatus: "active",
    leaseHeartbeatAt: now,
    leaseExpiresAt: expiresAt,
  });
}

export function releaseJobLeaseMetadata(
  job: Pick<GenerationJob, "metadata">,
  now = new Date().toISOString(),
  status = "released"
): JobLifecycleMetadata {
  return mergeJobMetadata(job.metadata, {
    leaseStatus: status,
    leaseReleasedAt: now,
  });
}

export function getJobLeaseInfo(
  job: Pick<GenerationJob, "metadata">,
  now = new Date().toISOString()
): JobLeaseInfo | undefined {
  const leaseId = readString(job.metadata.leaseId);
  const owner = readString(job.metadata.leaseOwner);
  const expiresAt = readString(job.metadata.leaseExpiresAt);
  const heartbeatAt = readString(job.metadata.leaseHeartbeatAt);
  const acquiredAt = readString(job.metadata.leaseAcquiredAt);
  const status = readString(job.metadata.leaseStatus) || "unknown";

  if (!leaseId && !owner && !expiresAt) return undefined;

  return {
    leaseId,
    owner,
    expiresAt,
    heartbeatAt,
    acquiredAt,
    status,
    expired: isJobLeaseExpired(job, now),
  };
}

export function isJobLeaseExpired(
  job: Pick<GenerationJob, "metadata">,
  now = new Date().toISOString()
): boolean {
  const leaseStatus = readString(job.metadata.leaseStatus);
  if (leaseStatus && leaseStatus !== "active") return false;

  const expiresAt = readString(job.metadata.leaseExpiresAt);
  if (!expiresAt) return true;

  const expiresAtMs = Date.parse(expiresAt);
  const nowMs = Date.parse(now);
  return !Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs) || expiresAtMs <= nowMs;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function releaseLeaseForJob(
  job: JobLifecycleSubject,
  status: "completed" | "failed" | "cancelled" | "retried",
  now: string
): void {
  if (!job.id) return;
  releaseJobLease(job.id, status, now);
}
