"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PersistedGeneratedArtifact,
  PersistedGenerationJob,
  PersistedJobQueueLease,
  PersistedJobQueueSnapshot,
} from "./types";

/* ------------------------------------------------------------------ */
/*  Hook: useWorkbenchJobs                                             */
/* ------------------------------------------------------------------ */

interface UseWorkbenchJobsOptions {
  workflowId: string | null;
  pollIntervalMs?: number;
}

interface UseWorkbenchJobsReturn {
  jobs: PersistedGenerationJob[];
  queueSnapshot: PersistedJobQueueSnapshot | null;
  artifacts: PersistedGeneratedArtifact[];
  hasActiveJob: boolean;
  refreshJobs: () => Promise<void>;
  refreshQueue: () => Promise<void>;
  refreshArtifacts: () => Promise<void>;
}

export function useWorkbenchJobs({
  workflowId,
  pollIntervalMs = 2500,
}: UseWorkbenchJobsOptions): UseWorkbenchJobsReturn {
  const [jobs, setJobs] = useState<PersistedGenerationJob[]>([]);
  const [queueSnapshot, setQueueSnapshot] =
    useState<PersistedJobQueueSnapshot | null>(null);
  const [artifacts, setArtifacts] = useState<PersistedGeneratedArtifact[]>([]);

  const jobsSigRef = useRef("");
  const artifactsSigRef = useRef("");

  const refreshJobs = useCallback(async () => {
    const list = await fetchJobs(workflowId);
    const sig = getJobListSignature(list);
    if (sig !== jobsSigRef.current) {
      jobsSigRef.current = sig;
      setJobs(list);
    }
  }, [workflowId]);

  const refreshQueue = useCallback(async () => {
    const snapshot = await fetchQueueSnapshot();
    if (snapshot) setQueueSnapshot(snapshot);
  }, []);

  const refreshArtifacts = useCallback(async () => {
    const list = await fetchArtifacts(workflowId);
    const sig = getArtifactListSignature(list);
    if (sig !== artifactsSigRef.current) {
      artifactsSigRef.current = sig;
      setArtifacts(list);
    }
  }, [workflowId]);

  const hasActiveJob = jobs.some(isActiveJob);

  useEffect(() => {
    if (!hasActiveJob || pollIntervalMs <= 0) return;
    const timer = setInterval(() => {
      void Promise.allSettled([refreshJobs(), refreshArtifacts()]).then(() => {
        void refreshQueue();
      });
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [hasActiveJob, pollIntervalMs, refreshJobs, refreshArtifacts, refreshQueue]);

  return {
    jobs,
    queueSnapshot,
    artifacts,
    hasActiveJob,
    refreshJobs,
    refreshQueue,
    refreshArtifacts,
  };
}

/* ------------------------------------------------------------------ */
/*  Fetch helpers                                                      */
/* ------------------------------------------------------------------ */

async function fetchJobs(
  workflowId: string | null
): Promise<PersistedGenerationJob[]> {
  const q = workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : "";
  const res = await window.fetch(`/api/jobs${q}`, { cache: "no-store" });
  if (!res.ok) return [];
  const payload = await res.json();
  const list = Array.isArray(payload) ? payload : payload.jobs;
  return Array.isArray(list)
    ? (list.map(mapJob).filter(Boolean) as PersistedGenerationJob[])
    : [];
}

async function fetchQueueSnapshot(): Promise<PersistedJobQueueSnapshot | null> {
  const res = await window.fetch("/api/jobs/queue", { cache: "no-store" });
  if (!res.ok) return null;
  const payload = await res.json();
  return mapJobQueueSnapshot(payload?.queue);
}

async function fetchArtifacts(
  workflowId: string | null
): Promise<PersistedGeneratedArtifact[]> {
  const q = workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : "";
  const res = await window.fetch(`/api/artifacts${q}`, { cache: "no-store" });
  if (!res.ok) return [];
  const payload = await res.json();
  const list = Array.isArray(payload) ? payload : payload.artifacts;
  return Array.isArray(list)
    ? (list.map(mapArtifact).filter(Boolean) as PersistedGeneratedArtifact[])
    : [];
}

/* ------------------------------------------------------------------ */
/*  Mappers                                                            */
/* ------------------------------------------------------------------ */

function mapJob(value: unknown): PersistedGenerationJob | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string") return null;
  return {
    id: v.id,
    workflowId: str(v.workflowId),
    nodeId: str(v.nodeId),
    assetId: str(v.assetId),
    status: typeof v.status === "string" ? v.status : "pending",
    prompt: typeof v.prompt === "string" ? v.prompt : "",
    resultUrl: typeof v.resultUrl === "string" ? v.resultUrl : "",
    error: typeof v.error === "string" ? v.error : "",
    metadata: isRecord(v.metadata) ? v.metadata : {},
    createdAt: typeof v.createdAt === "string" ? v.createdAt : new Date().toISOString(),
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : new Date().toISOString(),
  };
}

function mapArtifact(value: unknown): PersistedGeneratedArtifact | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || !v.id) return null;
  return {
    id: v.id,
    workflowId: str(v.workflowId),
    nodeId: str(v.nodeId),
    jobId: str(v.jobId),
    assetId: str(v.assetId),
    type: typeof v.type === "string" ? v.type : "",
    title: typeof v.title === "string" ? v.title : "",
    status: typeof v.status === "string" ? v.status : "",
    url: typeof v.url === "string" ? v.url : "",
    prompt: typeof v.prompt === "string" ? v.prompt : "",
    provider: typeof v.provider === "string" ? v.provider : "",
    model: typeof v.model === "string" ? v.model : "",
    metadata: isRecord(v.metadata) ? v.metadata : {},
    createdAt: typeof v.createdAt === "string" ? v.createdAt : new Date().toISOString(),
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : new Date().toISOString(),
  };
}

function mapJobQueueSnapshot(value: unknown): PersistedJobQueueSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const s = value as Record<string, unknown>;
  const runtime = isRecord(s.runtime) ? s.runtime : {};
  const db = isRecord(s.database) ? s.database : {};
  const stale = isRecord(s.stale) ? s.stale : {};
  const leases = Array.isArray(s.leases) ? s.leases : [];

  return {
    concurrency: num(s.concurrency, 0),
    owner: str(s.owner),
    leaseDurationMs: num(s.leaseDurationMs, 0),
    runtime: {
      queuedJobIds: strArr(runtime.queuedJobIds),
      runningJobIds: strArr(runtime.runningJobIds),
      queuedCount: num(runtime.queuedCount, 0),
      runningCount: num(runtime.runningCount, 0),
    },
    database: {
      total: num(db.total, 0),
      pending: num(db.pending, 0),
      queued: num(db.queued, 0),
      running: num(db.running, 0),
      done: num(db.done, 0),
      failed: num(db.failed, 0),
      cancelled: num(db.cancelled, 0),
    },
    stale: {
      queuedJobIds: strArr(stale.queuedJobIds),
      runningJobIds: strArr(stale.runningJobIds),
      expiredJobIds: strArr(stale.expiredJobIds),
      missingLeaseJobIds: strArr(stale.missingLeaseJobIds),
      count: numOrUndef(stale.count),
      expiredCount: numOrUndef(stale.expiredCount),
    },
    leases: leases
      .map(mapLease)
      .filter((l): l is PersistedJobQueueLease => l !== null),
  };
}

function mapLease(value: unknown): PersistedJobQueueLease | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const l = value as Record<string, unknown>;
  if (typeof l.jobId !== "string" || !l.jobId) return null;
  return {
    jobId: l.jobId,
    status: typeof l.status === "string" ? l.status : "",
    owner: str(l.owner),
    expired: l.expired === true,
    inRuntimeQueue: l.inRuntimeQueue === true,
    inRuntimeRunning: l.inRuntimeRunning === true,
  };
}

/* ------------------------------------------------------------------ */
/*  Signature helpers                                                  */
/* ------------------------------------------------------------------ */

function getJobListSignature(jobs: PersistedGenerationJob[]): string {
  return jobs.map((j) => [j.id, j.status, j.resultUrl, j.updatedAt].join(":")).join("|");
}

function getArtifactListSignature(artifacts: PersistedGeneratedArtifact[]): string {
  return artifacts.map((a) => [a.id, a.status, a.url, a.updatedAt].join(":")).join("|");
}

function isActiveJob(job: PersistedGenerationJob): boolean {
  return job.status === "queued" || job.status === "running";
}

/* ------------------------------------------------------------------ */
/*  Tiny utils                                                         */
/* ------------------------------------------------------------------ */

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numOrUndef(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function strArr(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
