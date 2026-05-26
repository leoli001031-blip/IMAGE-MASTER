import "server-only";
import type { GenerationJob } from "@/lib/types";
import db from "./db";

export type JobLeaseStatus = "active" | "released" | "completed" | "failed" | "cancelled" | "retried";

export interface JobLeaseRecord {
  jobId: string;
  leaseId: string;
  owner: string;
  status: string;
  claimedAt: string;
  heartbeatAt: string;
  expiresAt: string;
  releasedAt?: string;
  updatedAt: string;
}

export interface ClaimJobLeaseParams {
  jobId: string;
  leaseId: string;
  owner: string;
  durationMs: number;
  targetStatus: string;
  claimableStatuses: string[];
  metadata: Record<string, unknown>;
  now?: string;
  error?: string;
}

export interface ClaimJobLeaseResult {
  claimed: boolean;
  reason?: "job_not_found" | "job_status_blocked" | "lease_active";
  job?: GenerationJob;
  lease?: JobLeaseRecord;
}

type GenerationJobRow = Omit<GenerationJob, "workflowId" | "nodeId" | "assetId" | "metadata"> & {
  workflowId: string | null;
  nodeId: string | null;
  assetId: string | null;
  metadata: string;
};

type JobLeaseRow = {
  job_id: string;
  lease_id: string;
  owner: string;
  status: string;
  claimed_at: string;
  heartbeat_at: string;
  expires_at: string;
  released_at: string | null;
  updated_at: string;
};

const claimLeaseTransaction = db.transaction((params: Required<ClaimJobLeaseParams>) => {
  const job = getJobRow(params.jobId);
  if (!job) {
    return { claimed: false, reason: "job_not_found" as const };
  }

  if (!params.claimableStatuses.includes(job.status)) {
    return {
      claimed: false,
      reason: "job_status_blocked" as const,
      job: toJob(job),
      lease: getLease(params.jobId),
    };
  }

  const expiresAt = new Date(Date.parse(params.now) + params.durationMs).toISOString();
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO job_leases (
        job_id, lease_id, owner, status, claimed_at, heartbeat_at, expires_at, released_at, updated_at
      )
      VALUES (
        @jobId, @leaseId, @owner, 'active', @now, @now, @expiresAt, NULL, @now
      )`
    )
    .run({
      jobId: params.jobId,
      leaseId: params.leaseId,
      owner: params.owner,
      now: params.now,
      expiresAt,
    });

  let claimedLease = inserted.changes === 1;
  if (!claimedLease) {
    const updated = db
      .prepare(
        `UPDATE job_leases
         SET lease_id = @leaseId,
           owner = @owner,
           status = 'active',
           claimed_at = @now,
           heartbeat_at = @now,
           expires_at = @expiresAt,
           released_at = NULL,
           updated_at = @now
         WHERE job_id = @jobId
           AND (
             status != 'active'
             OR released_at IS NOT NULL
             OR expires_at <= @now
           )`
      )
      .run({
        jobId: params.jobId,
        leaseId: params.leaseId,
        owner: params.owner,
        now: params.now,
        expiresAt,
      });
    claimedLease = updated.changes === 1;
  }

  if (!claimedLease) {
    return {
      claimed: false,
      reason: "lease_active" as const,
      job: toJob(job),
      lease: getLease(params.jobId),
    };
  }

  db.prepare(
    `UPDATE generation_jobs
     SET status = @targetStatus,
       error = @error,
       metadata = @metadata,
       updatedAt = @now
     WHERE id = @jobId`
  ).run({
    jobId: params.jobId,
    targetStatus: params.targetStatus,
    error: params.error,
    metadata: JSON.stringify(params.metadata),
    now: params.now,
  });

  return {
    claimed: true,
    job: toJob(getJobRow(params.jobId) as GenerationJobRow),
    lease: getLease(params.jobId),
  };
});

export function claimJobLease(params: ClaimJobLeaseParams): ClaimJobLeaseResult {
  const now = params.now ?? new Date().toISOString();
  return claimLeaseTransaction({
    ...params,
    now,
    error: params.error ?? "",
  });
}

export function heartbeatJobLease(
  jobId: string,
  owner: string,
  durationMs: number,
  now = new Date().toISOString()
): JobLeaseRecord | undefined {
  const expiresAt = new Date(Date.parse(now) + durationMs).toISOString();
  const result = db
    .prepare(
      `UPDATE job_leases
       SET heartbeat_at = @now,
         expires_at = @expiresAt,
         updated_at = @now
       WHERE job_id = @jobId
         AND owner = @owner
         AND status = 'active'
         AND released_at IS NULL
         AND expires_at > @now`
    )
    .run({ jobId, owner, now, expiresAt });

  return result.changes === 1 ? getLease(jobId) : undefined;
}

export function releaseJobLease(
  jobId: string,
  status: JobLeaseStatus | string = "released",
  now = new Date().toISOString()
): JobLeaseRecord | undefined {
  db.prepare(
    `UPDATE job_leases
     SET status = @status,
       released_at = COALESCE(released_at, @now),
       updated_at = @now
     WHERE job_id = @jobId
       AND status = 'active'`
  ).run({ jobId, status, now });

  return getLease(jobId);
}

export function getLease(jobId: string): JobLeaseRecord | undefined {
  const row = db.prepare("SELECT * FROM job_leases WHERE job_id = ?").get(jobId) as
    | JobLeaseRow
    | undefined;
  return row ? toLease(row) : undefined;
}

export function listLeases(): JobLeaseRecord[] {
  const rows = db
    .prepare("SELECT * FROM job_leases ORDER BY updated_at DESC, claimed_at DESC")
    .all() as JobLeaseRow[];
  return rows.map(toLease);
}

export function isLeaseActive(lease: JobLeaseRecord | undefined, now = new Date().toISOString()): boolean {
  return Boolean(lease && lease.status === "active" && !lease.releasedAt && !isLeaseExpired(lease, now));
}

export function isLeaseExpired(lease: JobLeaseRecord | undefined, now = new Date().toISOString()): boolean {
  if (!lease || lease.status !== "active" || lease.releasedAt) return false;

  const expiresAtMs = Date.parse(lease.expiresAt);
  const nowMs = Date.parse(now);
  return !Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs) || expiresAtMs <= nowMs;
}

function getJobRow(jobId: string): GenerationJobRow | undefined {
  return db.prepare("SELECT * FROM generation_jobs WHERE id = ?").get(jobId) as
    | GenerationJobRow
    | undefined;
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

function toLease(row: JobLeaseRow): JobLeaseRecord {
  return {
    jobId: row.job_id,
    leaseId: row.lease_id,
    owner: row.owner,
    status: row.status,
    claimedAt: row.claimed_at,
    heartbeatAt: row.heartbeat_at,
    expiresAt: row.expires_at,
    releasedAt: row.released_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
