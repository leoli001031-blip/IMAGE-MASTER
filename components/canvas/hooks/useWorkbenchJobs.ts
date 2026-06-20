"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
  setJobs: Dispatch<SetStateAction<PersistedGenerationJob[]>>;
  setQueueSnapshot: Dispatch<SetStateAction<PersistedJobQueueSnapshot | null>>;
  setArtifacts: Dispatch<SetStateAction<PersistedGeneratedArtifact[]>>;
  refreshJobs: () => Promise<PersistedGenerationJob[]>;
  refreshQueue: () => Promise<PersistedJobQueueSnapshot | null>;
  refreshArtifacts: () => Promise<PersistedGeneratedArtifact[]>;
}

export function useWorkbenchJobs({
  workflowId,
  pollIntervalMs = 2500,
}: UseWorkbenchJobsOptions): UseWorkbenchJobsReturn {
  const [jobs, setJobsState] = useState<PersistedGenerationJob[]>([]);
  const [queueSnapshot, setQueueSnapshot] =
    useState<PersistedJobQueueSnapshot | null>(null);
  const [artifacts, setArtifactsState] = useState<PersistedGeneratedArtifact[]>([]);

  const jobsSigRef = useRef("");
  const artifactsSigRef = useRef("");
  const queueSigRef = useRef("");
  const jobsRef = useRef<PersistedGenerationJob[]>([]);
  const artifactsRef = useRef<PersistedGeneratedArtifact[]>([]);
  const jobsUpdatedAfterRef = useRef("");
  const artifactsUpdatedAfterRef = useRef("");
  const workflowIdRef = useRef<string | null>(workflowId);

  const setJobs = useCallback<Dispatch<SetStateAction<PersistedGenerationJob[]>>>((value) => {
    setJobsState((current) => {
      const next = resolveStateAction(value, current);
      jobsRef.current = next;
      jobsSigRef.current = getJobListSignature(next);
      jobsUpdatedAfterRef.current = getMaxUpdatedAt(next);
      return next;
    });
  }, []);

  const setArtifacts = useCallback<Dispatch<SetStateAction<PersistedGeneratedArtifact[]>>>((value) => {
    setArtifactsState((current) => {
      const next = resolveStateAction(value, current);
      artifactsRef.current = next;
      artifactsSigRef.current = getArtifactListSignature(next);
      artifactsUpdatedAfterRef.current = getMaxUpdatedAt(next);
      return next;
    });
  }, []);

  const setQueueSnapshotSynced = useCallback<Dispatch<SetStateAction<PersistedJobQueueSnapshot | null>>>((value) => {
    setQueueSnapshot((current) => {
      const next = resolveStateAction(value, current);
      queueSigRef.current = getQueueSignature(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (workflowIdRef.current === workflowId) return;
    workflowIdRef.current = workflowId;
    jobsSigRef.current = "";
    artifactsSigRef.current = "";
    jobsUpdatedAfterRef.current = "";
    artifactsUpdatedAfterRef.current = "";
    jobsRef.current = [];
    artifactsRef.current = [];
    setJobs([]);
    setArtifacts([]);
  }, [workflowId]);

  const refreshJobs = useCallback(async () => {
    if (!workflowId) {
      jobsSigRef.current = "";
      jobsUpdatedAfterRef.current = "";
      jobsRef.current = [];
      setJobs((current) => (current.length === 0 ? current : []));
      return [];
    }
    const updatedAfter = getDeltaCursor(jobsUpdatedAfterRef.current);
    const list = await fetchJobs(workflowId, updatedAfter);
    const nextList = updatedAfter
      ? mergeById(jobsRef.current, list, getPersistedJobSortKey)
      : list;
    const nextSig = getJobListSignature(nextList);
    if (nextSig !== jobsSigRef.current) {
      setJobs(nextList);
    }
    return nextList;
  }, [workflowId]);

  const refreshQueue = useCallback(async () => {
    const snapshot = await fetchQueueSnapshot();
    const sig = getQueueSignature(snapshot);
    if (sig !== queueSigRef.current) {
      setQueueSnapshotSynced(snapshot);
    }
    return snapshot;
  }, [setQueueSnapshotSynced]);

  const refreshArtifacts = useCallback(async () => {
    if (!workflowId) {
      artifactsSigRef.current = "";
      artifactsUpdatedAfterRef.current = "";
      artifactsRef.current = [];
      setArtifacts((current) => (current.length === 0 ? current : []));
      return [];
    }
    const updatedAfter = getDeltaCursor(artifactsUpdatedAfterRef.current);
    const list = await fetchArtifacts(workflowId, updatedAfter);
    const nextList = updatedAfter
      ? mergeById(artifactsRef.current, list, getPersistedArtifactSortKey)
      : list;
    const nextSig = getArtifactListSignature(nextList);
    if (nextSig !== artifactsSigRef.current) {
      setArtifacts(nextList);
    }
    return nextList;
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

  useEffect(() => {
    void Promise.allSettled([refreshJobs(), refreshArtifacts(), refreshQueue()]);
  }, [refreshJobs, refreshArtifacts, refreshQueue]);

  return {
    jobs,
    queueSnapshot,
    artifacts,
    hasActiveJob,
    setJobs,
    setQueueSnapshot: setQueueSnapshotSynced,
    setArtifacts,
    refreshJobs,
    refreshQueue,
    refreshArtifacts,
  };
}

/* ------------------------------------------------------------------ */
/*  Fetch helpers                                                      */
/* ------------------------------------------------------------------ */

async function fetchJobs(
  workflowId: string | null,
  updatedAfter?: string
): Promise<PersistedGenerationJob[]> {
  const params = new URLSearchParams({ limit: "200" });
  if (workflowId) params.set("workflowId", workflowId);
  if (updatedAfter) params.set("updatedAfter", updatedAfter);
  const res = await window.fetch(`/api/jobs?${params.toString()}`, { cache: "no-store" });
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
  workflowId: string | null,
  updatedAfter?: string
): Promise<PersistedGeneratedArtifact[]> {
  const params = new URLSearchParams({ limit: "200" });
  if (workflowId) params.set("workflowId", workflowId);
  if (updatedAfter) params.set("updatedAfter", updatedAfter);
  const res = await window.fetch(`/api/artifacts?${params.toString()}`, { cache: "no-store" });
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

function getQueueSignature(snapshot: PersistedJobQueueSnapshot | null): string {
  if (!snapshot) return "";
  return JSON.stringify({
    runtime: snapshot.runtime,
    database: snapshot.database,
    stale: snapshot.stale,
    leases: snapshot.leases.map((lease) => [
      lease.jobId,
      lease.status,
      lease.owner,
      lease.expired,
      lease.inRuntimeQueue,
      lease.inRuntimeRunning,
    ]),
  });
}

function mergeById<T extends { id: string }>(
  current: T[],
  updates: T[],
  getSortKey: (item: T) => string
): T[] {
  if (updates.length === 0) return current;
  const items = new Map(current.map((item) => [item.id, item]));
  for (const update of updates) items.set(update.id, update);
  return [...items.values()]
    .sort((a, b) => getSortKey(b).localeCompare(getSortKey(a)))
    .slice(0, 200);
}

function getPersistedJobSortKey(item: PersistedGenerationJob): string {
  return item.createdAt || item.updatedAt || item.id;
}

function getPersistedArtifactSortKey(item: PersistedGeneratedArtifact): string {
  return item.createdAt || item.updatedAt || item.id;
}

function getMaxUpdatedAt(items: Array<{ updatedAt?: string }>): string {
  return items.reduce((max, item) => {
    const value = typeof item.updatedAt === "string" ? item.updatedAt : "";
    return value > max ? value : max;
  }, "");
}

function getDeltaCursor(value: string): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Date(Math.max(0, time - 1000)).toISOString();
}

function resolveStateAction<T>(value: SetStateAction<T>, current: T): T {
  return typeof value === "function" ? (value as (previous: T) => T)(current) : value;
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
