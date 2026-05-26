import "server-only";
import { AIError, generateSingleImage } from "@/lib/ai/client";
import {
  assertProviderCircuitAvailable,
  recordProviderCircuitFailure,
  recordProviderCircuitSuccess,
  type ProviderCircuitKey,
} from "@/lib/ai/provider-circuit-breaker";
import {
  appendGenerationReferencePrompt,
  buildProviderReferenceAdapter,
  filterGenerationReferenceContextByRoles,
  isInlineImageUrl,
  type GenerationReferenceContext,
  type ProviderReferenceAdapter,
} from "@/lib/canvas/generation-reference-context";
import type { CampaignBible } from "@/lib/canvas/campaign-planning";
import { planAssetInvocation } from "@/lib/canvas/asset-invocation-planner";
import type { GenerationPlanItem, SopExecutionPlan } from "@/lib/canvas/generation-plan";
import { writeProviderImagePrompt } from "@/lib/canvas/provider-prompt-writer";
import { getConfigPublic } from "@/lib/store/config-store";
import * as artifactDB from "@/lib/store/artifact-db";
import * as assetDB from "@/lib/store/asset-db";
import * as jobDB from "@/lib/store/job-db";
import * as jobLeaseDB from "@/lib/store/job-lease-db";
import { syncExportPackBatchState } from "@/lib/store/export-pack-batch-sync";
import {
  isDoneJob,
  mergeJobMetadata,
  markJobCompletedMetadata,
  markJobFailedMetadata,
  markJobQueuedMetadata,
  markJobStartedMetadata,
} from "@/lib/store/job-lifecycle";
import { readOutputImageAsDataUrl, storeOutputImage } from "@/lib/store/output-file-store";
import {
  appendProviderAttemptLedger,
  createProviderAttemptEntry,
  finishProviderAttemptEntry,
  type ProviderAttemptEntry,
} from "@/lib/store/provider-attempt-ledger";
import {
  appendProviderBudgetMetadata,
  consumeProviderCallBudget,
  getProviderCallBudgetId,
  reserveProviderCallBudget,
} from "@/lib/store/provider-budget-store";
import { safeLogError } from "@/lib/server/safe-log";
import type { GeneratedArtifact, GenerationJob } from "@/lib/types";

const runningJobs = new Set<string>();
const queuedJobIds: string[] = [];
const MAX_CONCURRENCY = readPositiveInteger(process.env.IMAGE_MASTER_JOB_CONCURRENCY, 10);
const LEASE_DURATION_MS = readPositiveInteger(process.env.IMAGE_MASTER_JOB_LEASE_MS, 5 * 60 * 1000);
const LEASE_HEARTBEAT_MS = Math.max(1000, Math.floor(LEASE_DURATION_MS / 3));
const WORKER_RECLAIM_INTERVAL_MS = readPositiveInteger(
  process.env.IMAGE_MASTER_JOB_RECLAIM_INTERVAL_MS,
  Math.max(15 * 1000, Math.floor(LEASE_DURATION_MS / 2))
);
const QUEUE_OWNER =
  process.env.IMAGE_MASTER_QUEUE_OWNER || `pid_${process.pid}_${crypto.randomUUID().slice(0, 8)}`;
let workerStarted = false;
let workerTimer: ReturnType<typeof setInterval> | undefined;
let reclaimInFlight: Promise<ReclaimStaleJobsResult> | undefined;

const exportPackBatchMetadataKeys = [
  "batchId",
  "batchIndex",
  "batchTotal",
  "exportPackId",
  "exportPackTitle",
  "exportItemId",
  "exportItemTitle",
  "exportSpecId",
  "exportSpecTitle",
  "platform",
  "size",
  "ratio",
  "naming",
  "qualityRules",
  "useCase",
  "whiteBackground",
  "textAllowed",
  "modelRequired",
] as const;

export interface StartGenerationJobResult {
  job: GenerationJob;
  started: boolean;
  alreadyRunning?: boolean;
  alreadyQueued?: boolean;
  alreadyDone?: boolean;
}

export interface JobQueueSnapshot {
  concurrency: number;
  owner: string;
  leaseDurationMs: number;
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
    expiredJobIds: string[];
    missingLeaseJobIds: string[];
    count: number;
    expiredCount: number;
    missingLeaseCount: number;
  };
  leaseTable: {
    total: number;
    active: number;
    released: number;
    expired: number;
    rows: jobLeaseDB.JobLeaseRecord[];
  };
  leases: Array<{
    jobId: string;
    status: string;
    leaseId: string;
    owner: string;
    expiresAt: string;
    heartbeatAt: string;
    claimedAt: string;
    releasedAt: string;
    leaseStatus: string;
    expired: boolean;
    missing: boolean;
    inRuntimeQueue: boolean;
    inRuntimeRunning: boolean;
  }>;
}

export interface ReclaimStaleJobsResult {
  owner: string;
  reclaimedJobIds: string[];
  enqueuedJobIds: string[];
  snapshot: JobQueueSnapshot;
}

export class ProviderCallApprovalRequiredError extends Error {
  code = "PROVIDER_CALL_LIMIT_NOT_CONFIRMED";
  status = 402;
  details: Record<string, unknown>;

  constructor(details: Record<string, unknown>) {
    super("provider_call_limit_not_confirmed");
    this.name = "ProviderCallApprovalRequiredError";
    this.details = details;
  }
}

export async function startGenerationJob(jobId: string): Promise<StartGenerationJobResult> {
  ensureJobQueueWorker();

  const job = await jobDB.get(jobId);
  if (!job) {
    throw new Error("job_not_found");
  }

  if (isDoneJob(job)) {
    return { job, started: false, alreadyDone: true };
  }

  assertProviderCallApproved(job);

  if (job.status === "queued") {
    const lease = jobLeaseDB.getLease(job.id);
    const leasedByAnotherOwner =
      jobLeaseDB.isLeaseActive(lease) && lease?.owner !== QUEUE_OWNER;
    if (leasedByAnotherOwner) {
      return { job, started: false, alreadyQueued: true };
    }

    const latestJob = shouldReclaimLease(job, lease)
      ? await leaseJob(job, "reclaimedQueuedAt")
      : job;
    const enqueued = enqueueJob(latestJob.id);
    processQueue();
    return { job: latestJob, started: enqueued, alreadyQueued: !enqueued };
  }

  if (job.status === "running") {
    const lease = jobLeaseDB.getLease(job.id);
    if (runningJobs.has(job.id) && jobLeaseDB.isLeaseActive(lease)) {
      return { job, started: false, alreadyRunning: true };
    }

    const requeued = await claimJob(job, {
      targetStatus: "queued",
      timestampKey: "requeuedFromStaleRunningAt",
      claimableStatuses: ["running"],
    });
    if (!requeued) {
      return { job, started: false, alreadyRunning: true };
    }

    const enqueued = enqueueJob(requeued.id);
    processQueue();
    return { job: requeued, started: enqueued, alreadyQueued: !enqueued };
  }

  if (runningJobs.has(jobId)) {
    return { job, started: false, alreadyRunning: true };
  }

  const runId = createRunId();
  const queuedAt = new Date().toISOString();
  const leaseOptions = createLeaseOptions(queuedAt);
  const queuedClaim = jobLeaseDB.claimJobLease({
    jobId,
    leaseId: leaseOptions.leaseId,
    owner: leaseOptions.owner,
    durationMs: leaseOptions.durationMs,
    targetStatus: "queued",
    claimableStatuses: ["pending", "queued"],
    metadata: markJobQueuedMetadata(job, runId, queuedAt, leaseOptions),
    now: queuedAt,
    error: "",
  });

  if (queuedClaim.reason === "job_not_found") {
    throw new Error("job_not_found");
  }

  if (!queuedClaim.claimed || !queuedClaim.job) {
    const latestJob = (await jobDB.get(jobId)) ?? job;
    return {
      job: latestJob,
      started: false,
      alreadyQueued: latestJob.status === "queued",
      alreadyRunning: latestJob.status === "running",
    };
  }

  const enqueued = enqueueJob(jobId);
  processQueue();

  return { job: queuedClaim.job, started: enqueued };
}

export function ensureJobQueueWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  void runWorkerReclaim().catch(() => undefined);
  workerTimer = setInterval(() => {
    void runWorkerReclaim().catch(() => undefined);
  }, WORKER_RECLAIM_INTERVAL_MS);
  workerTimer.unref?.();
}

export async function ensureJobQueueWorkerNow(): Promise<ReclaimStaleJobsResult | undefined> {
  ensureJobQueueWorker();
  return runWorkerReclaim();
}

export function removeJobFromRuntimeQueue(jobId: string): boolean {
  const index = queuedJobIds.indexOf(jobId);
  if (index < 0) return false;
  queuedJobIds.splice(index, 1);
  return true;
}

export async function getJobQueueSnapshot(): Promise<JobQueueSnapshot> {
  const jobs = await jobDB.list();
  const statusCounts = jobs.reduce<Record<string, number>>((counts, job) => {
    counts[job.status] = (counts[job.status] ?? 0) + 1;
    return counts;
  }, {});
  const runtimeQueued = new Set(queuedJobIds);
  const runtimeRunning = new Set(runningJobs);
  const now = new Date().toISOString();
  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const leaseRows = jobLeaseDB.listLeases();
  const leaseByJobId = new Map(leaseRows.map((lease) => [lease.jobId, lease]));
  const staleQueuedJobIds = activeJobs
    .filter((job) => job.status === "queued" && !runtimeQueued.has(job.id))
    .map((job) => job.id);
  const staleRunningJobIds = activeJobs
    .filter((job) => job.status === "running" && !runtimeRunning.has(job.id))
    .map((job) => job.id);
  const expiredJobIds = activeJobs
    .filter((job) => jobLeaseDB.isLeaseExpired(leaseByJobId.get(job.id), now))
    .map((job) => job.id);
  const missingLeaseJobIds = activeJobs
    .filter((job) => {
      const lease = leaseByJobId.get(job.id);
      return !lease || lease.status !== "active" || Boolean(lease.releasedAt);
    })
    .map((job) => job.id);
  const staleJobIds = new Set([
    ...staleQueuedJobIds,
    ...staleRunningJobIds,
    ...expiredJobIds,
    ...missingLeaseJobIds,
  ]);

  return {
    concurrency: MAX_CONCURRENCY,
    owner: QUEUE_OWNER,
    leaseDurationMs: LEASE_DURATION_MS,
    runtime: {
      queuedJobIds: [...queuedJobIds],
      runningJobIds: [...runningJobs],
      queuedCount: queuedJobIds.length,
      runningCount: runningJobs.size,
    },
    database: {
      total: jobs.length,
      pending: statusCounts.pending ?? 0,
      queued: statusCounts.queued ?? 0,
      running: statusCounts.running ?? 0,
      done: (statusCounts.done ?? 0) + (statusCounts.completed ?? 0),
      failed: statusCounts.failed ?? 0,
      cancelled: statusCounts.cancelled ?? 0,
    },
    stale: {
      queuedJobIds: staleQueuedJobIds,
      runningJobIds: staleRunningJobIds,
      expiredJobIds,
      missingLeaseJobIds,
      count: staleJobIds.size,
      expiredCount: expiredJobIds.length,
      missingLeaseCount: missingLeaseJobIds.length,
    },
    leaseTable: {
      total: leaseRows.length,
      active: leaseRows.filter((lease) => jobLeaseDB.isLeaseActive(lease, now)).length,
      released: leaseRows.filter((lease) => lease.status !== "active" || lease.releasedAt).length,
      expired: leaseRows.filter((lease) => jobLeaseDB.isLeaseExpired(lease, now)).length,
      rows: leaseRows,
    },
    leases: activeJobs.map((job) => {
      const lease = leaseByJobId.get(job.id);
      const expired = jobLeaseDB.isLeaseExpired(lease, now);
      const missing = !lease || lease.status !== "active" || Boolean(lease.releasedAt);
      return {
        jobId: job.id,
        status: job.status,
        leaseId: lease?.leaseId ?? "",
        owner: lease?.owner ?? "",
        expiresAt: lease?.expiresAt ?? "",
        heartbeatAt: lease?.heartbeatAt ?? "",
        claimedAt: lease?.claimedAt ?? "",
        releasedAt: lease?.releasedAt ?? "",
        leaseStatus: lease?.status ?? "",
        expired,
        missing,
        inRuntimeQueue: runtimeQueued.has(job.id),
        inRuntimeRunning: runtimeRunning.has(job.id),
      };
    }),
  };
}

export async function reclaimStaleJobs(options: { enqueue?: boolean } = {}): Promise<ReclaimStaleJobsResult> {
  const jobs = await jobDB.list();
  const now = new Date().toISOString();
  const reclaimedJobIds: string[] = [];
  const enqueuedJobIds: string[] = [];

  for (const job of jobs) {
    if (job.status !== "queued" && job.status !== "running") continue;

    const lease = jobLeaseDB.getLease(job.id);
    const expired = jobLeaseDB.isLeaseExpired(lease, now);
    const missingLease = !lease || lease.status !== "active" || Boolean(lease.releasedAt);
    if (!expired && !missingLease) continue;

    const reclaimed = await claimJob(job, {
      targetStatus: "queued",
      timestampKey: "reclaimedAt",
      now,
      claimableStatuses: ["queued", "running"],
      metadataUpdates: {
        reclaimedFromStatus: job.status,
      },
    });
    if (!reclaimed) continue;

    reclaimedJobIds.push(job.id);
    if (options.enqueue) {
      const enqueued = enqueueJob(job.id);
      if (enqueued) enqueuedJobIds.push(job.id);
    }
  }

  if (options.enqueue) processQueue();

  return {
    owner: QUEUE_OWNER,
    reclaimedJobIds,
    enqueuedJobIds,
    snapshot: await getJobQueueSnapshot(),
  };
}

function runWorkerReclaim(): Promise<ReclaimStaleJobsResult> {
  if (reclaimInFlight) return reclaimInFlight;
  reclaimInFlight = reclaimStaleJobs({ enqueue: true })
    .catch((error) => {
      safeLogError("Job queue worker reclaim failed", error);
      throw error;
    })
    .finally(() => {
      reclaimInFlight = undefined;
    });
  return reclaimInFlight;
}

function enqueueJob(jobId: string): boolean {
  if (runningJobs.has(jobId) || queuedJobIds.includes(jobId)) return false;
  queuedJobIds.push(jobId);
  return true;
}

function processQueue(): void {
  while (runningJobs.size < MAX_CONCURRENCY && queuedJobIds.length > 0) {
    const nextJobId = queuedJobIds.shift();
    if (!nextJobId || runningJobs.has(nextJobId)) continue;

    runningJobs.add(nextJobId);
    void jobDB
      .get(nextJobId)
      .then((job) => {
        if (!job || job.status === "cancelled") return;
        if (job.status !== "queued" && job.status !== "running") return;
        return runGenerationJob(job);
      })
      .finally(() => {
        runningJobs.delete(nextJobId);
        processQueue();
      });
  }
}

async function runGenerationJob(job: GenerationJob): Promise<void> {
  const runId = typeof job.metadata.lastRunId === "string" ? job.metadata.lastRunId : "";
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let activeProviderAttempt: ProviderAttemptEntry | undefined;
  let providerBudgetId: string | undefined;
  let providerCircuitKey: ProviderCircuitKey | undefined;

  try {
    const latestBeforeRun = await jobDB.get(job.id);
    if (!latestBeforeRun || latestBeforeRun.status === "cancelled") return;

    const renewedLease = jobLeaseDB.heartbeatJobLease(
      job.id,
      QUEUE_OWNER,
      LEASE_DURATION_MS,
      new Date().toISOString()
    );
    if (!renewedLease) return;

    const runningJob = await jobDB.update(job.id, {
      status: "running",
      error: "",
      metadata: markJobStartedMetadata(latestBeforeRun, runId, new Date().toISOString()),
    });
    if (!runningJob) return;

    heartbeatTimer = startLeaseHeartbeat(job.id);

    const imageConfig = getConfigPublic();
    const provider = getProviderLabel(imageConfig.imageBaseUrl || imageConfig.baseUrl);
    const model = imageConfig.imageModel;
    providerCircuitKey = { scope: "job-runner", provider, model };
    assertProviderCircuitAvailable(providerCircuitKey);
    const promptReadyJob = await prepareDeferredPromptIfNeeded(runningJob);
    const referenceContext = getGenerationReferenceContext(promptReadyJob.metadata);
    const providerReferenceAdapter = buildProviderReferenceAdapter(promptReadyJob.metadata);
    const referenceImageUrls = providerReferenceAdapter.providerUsableImages.map((image) => image.url);
    const referenceImageUrl = providerReferenceAdapter.primaryImage?.url;
    const providerReferenceDataUrls = await readProviderReferenceDataUrls(referenceImageUrls);
    const prompt = hasProviderPromptWriter(promptReadyJob.metadata)
      ? promptReadyJob.prompt
      : appendGenerationReferencePrompt(promptReadyJob.prompt, referenceContext);
    providerBudgetId = getProviderCallBudgetId(promptReadyJob.metadata, job.id);
    const reserveEvent = reserveProviderCallBudget({
      budgetId: providerBudgetId,
      jobId: job.id,
      scope: "job-runner",
      amount: 1,
      metadata: {
        runId,
        provider,
        model,
        referenceImageCount: providerReferenceDataUrls.length,
      },
    });
    activeProviderAttempt = createProviderAttemptEntry({
      scope: "job-runner",
      jobId: job.id,
      runId,
      prompt,
      referenceImageUrl,
      referenceImageUrls,
      providerReferenceCount: providerReferenceDataUrls.length,
      providerReferenceRole: providerReferenceAdapter.primaryImage?.role,
      providerReferenceStrategy: providerReferenceAdapter.strategy,
    });
    await jobDB.update(job.id, {
      metadata: appendProviderBudgetMetadata(
        appendProviderAttemptLedger(promptReadyJob.metadata, activeProviderAttempt),
        providerBudgetId,
        reserveEvent
      ),
    });
    const result = await generateJobRunnerImage(
      prompt,
      providerReferenceDataUrls,
      getStringValue(runningJob.metadata.size)
    );
    const successBudgetEvent = consumeProviderCallBudget({
      budgetId: providerBudgetId,
      jobId: job.id,
      scope: "job-runner",
      amount: 1,
      status: "succeeded",
      attemptId: activeProviderAttempt.attemptId,
      providerRequestId: result.provider?.providerRequestId,
      metadata: {
        runId,
        provider,
        model,
      },
    });
    recordProviderCircuitSuccess(providerCircuitKey);

    const latestAfterProvider = await jobDB.get(job.id);
    if (!latestAfterProvider || !isCurrentActiveRun(latestAfterProvider, runId)) return;

    const storedImage = await storeOutputImage({
      id: job.id,
      title: getNodeLabel(runningJob.metadata),
      url: result.image?.url,
      base64: result.image?.base64,
      defaultMimeType: "image/png",
    });

    const latestAfterStore = await jobDB.get(job.id);
    if (!latestAfterStore || !isCurrentActiveRun(latestAfterStore, runId)) return;

    const imageUrl = storedImage.publicUrl;
    const imageStorageMetadata = storedImage.metadata;
    const generatedAt = new Date().toISOString();
    const completedProviderAttempt = finishProviderAttemptEntry(activeProviderAttempt, {
      status: "succeeded",
      outputUrl: imageUrl,
      now: generatedAt,
    });
    const batchMetadata = extractExportPackBatchMetadata(runningJob.metadata);
    const metadataWithCompletedAttempt = appendProviderBudgetMetadata(
      appendProviderAttemptLedger(latestAfterStore.metadata, completedProviderAttempt),
      providerBudgetId,
      successBudgetEvent
    );
    const referenceMetadata = extractGenerationReferenceMetadata(
      metadataWithCompletedAttempt,
      referenceImageUrl,
      referenceImageUrls,
      providerReferenceAdapter,
      providerReferenceDataUrls.length > 0,
      providerBudgetId,
      successBudgetEvent
    );

    const asset = await assetDB.add({
      type: "output",
      title: `${getNodeLabel(runningJob.metadata)} 输出图`,
      description: "由画布任务生成的输出资产",
      status: "ready",
      url: imageUrl,
      metadata: {
        source: "job-runner",
        libraryScope: "generated-output",
        savedByUser: false,
        jobId: job.id,
        workflowId: runningJob.workflowId,
        nodeId: runningJob.nodeId,
        ...batchMetadata,
        ...referenceMetadata,
        prompt,
        provider,
        model,
        generatedAt,
        imageStorage: imageStorageMetadata,
      },
    });

    const latestAfterAsset = await jobDB.get(job.id);
    if (!latestAfterAsset || !isCurrentActiveRun(latestAfterAsset, runId)) return;

    const artifact = await artifactDB.add({
      workflowId: runningJob.workflowId,
      nodeId: runningJob.nodeId,
      jobId: job.id,
      assetId: asset.id,
      type: "image",
      title: `${getNodeLabel(runningJob.metadata)} 生成产物`,
      status: "ready",
      url: imageUrl,
      prompt,
      provider,
      model,
      metadata: {
        source: "job-runner",
        outputAssetId: asset.id,
        ...batchMetadata,
        ...referenceMetadata,
        provider,
        model,
        generatedAt,
        imageStorage: imageStorageMetadata,
      },
    });

    const latestJob = (await jobDB.get(job.id)) ?? job;
    if (!isCurrentActiveRun(latestJob, runId)) return;

    await jobDB.update(job.id, {
      status: "done",
      resultUrl: imageUrl,
      assetId: asset.id,
      error: "",
      metadata: markJobCompletedMetadata(latestJob, {
        ...extractExportPackBatchMetadata(latestJob.metadata),
        ...extractGenerationReferenceMetadata(
          appendProviderBudgetMetadata(
            appendProviderAttemptLedger(latestJob.metadata, completedProviderAttempt),
            providerBudgetId,
            successBudgetEvent
          ),
          referenceImageUrl,
          referenceImageUrls,
          providerReferenceAdapter,
          providerReferenceDataUrls.length > 0,
          providerBudgetId,
          successBudgetEvent
        ),
        outputAssetId: asset.id,
        artifactId: artifact.id,
        provider,
        model,
        resultStorage: imageStorageMetadata,
      }),
    });
    await syncExportPackBatchState(getStringValue(latestJob.metadata.batchId), {
      reason: "job-runner-done",
      now: generatedAt,
    });
  } catch (error) {
    safeLogError("Background job run failed", error);
    const latestJob = (await jobDB.get(job.id)) ?? job;
    if (latestJob.status === "cancelled" || !isSameRun(latestJob, runId)) return;
    const failureDetails = extractProviderFailureAttempt(error);
    const failureBudgetEvent =
      providerBudgetId && activeProviderAttempt
        ? consumeProviderCallBudget({
            budgetId: providerBudgetId,
            jobId: job.id,
            scope: "job-runner",
            amount: 1,
            status: "failed",
            attemptId: activeProviderAttempt.attemptId,
            reason: failureDetails.errorCode,
            metadata: {
              runId,
              errorCode: failureDetails.errorCode,
            },
          })
        : undefined;
    const circuitStatus = providerCircuitKey
      ? recordProviderCircuitFailure(providerCircuitKey, error)
      : undefined;
    const metadataWithBudget = providerBudgetId
      ? appendProviderBudgetMetadata(latestJob.metadata, providerBudgetId, failureBudgetEvent)
      : latestJob.metadata;

    await jobDB.update(job.id, {
      status: "failed",
      error: "图片生成失败，请稍后重试",
      metadata: mergeJobMetadata(
        markJobFailedMetadata(
          activeProviderAttempt
            ? {
                ...latestJob,
                metadata: appendProviderAttemptLedger(
                  metadataWithBudget,
                  finishProviderAttemptEntry(activeProviderAttempt, {
                    status: "failed",
                    ...failureDetails,
                  })
                ),
              }
            : {
                ...latestJob,
                metadata: metadataWithBudget,
              }
        ),
        {
          ...extractProviderFailureMetadata(error),
          providerCircuitStatus: circuitStatus,
        }
      ),
    });
    await syncExportPackBatchState(getStringValue(latestJob.metadata.batchId), {
      reason: "job-runner-failed",
    });
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

function assertProviderCallApproved(job: GenerationJob): void {
  const policy = readRecord(job.metadata.providerPolicy);
  if (!policy) return;
  if (policy.mode === "confirmed") return;

  const estimate = readRecord(policy.estimate) ?? readRecord(job.metadata.estimate);
  const requiredConfirmation = readRecord(policy.requiredConfirmation);
  const required =
    getNumber(requiredConfirmation?.minimum) ??
    getNumber(estimate?.providerCallCount) ??
    0;
  const approvedLimit =
    getNumber(job.metadata.approvedProviderCallLimit) ??
    getNumber(policy.confirmedProviderCallLimit) ??
    0;
  if (required > 0 && approvedLimit >= required) return;

  throw new ProviderCallApprovalRequiredError({
    error: "任务启动前需要确认 provider 调用上限",
    code: "PROVIDER_CALL_LIMIT_NOT_CONFIRMED",
    jobId: job.id,
    estimate,
    providerPolicy: policy,
    requiredConfirmation:
      requiredConfirmation ?? {
        field: "confirmedProviderCallLimit",
        minimum: required,
      },
  });
}

async function prepareDeferredPromptIfNeeded(job: GenerationJob): Promise<GenerationJob> {
  if (job.metadata.deferPromptPreparation !== true) return job;

  const planItem = readRecord(job.metadata.deferredPlanItem) as unknown as GenerationPlanItem | undefined;
  if (!planItem?.itemId) {
    throw new Error("Deferred prompt preparation is missing the plan item.");
  }

  const referenceContext = getGenerationReferenceContext(job.metadata);
  const userRequest =
    getStringValue(job.metadata.deferredUserRequest) ??
    getStringValue(job.metadata.userRequest) ??
    getStringValue(job.metadata.request);
  const sopExecutionPlan = readRecord(job.metadata.sopExecutionPlan) as unknown as SopExecutionPlan | undefined;
  const campaignBible = readRecord(job.metadata.campaignBible) as unknown as CampaignBible | undefined;
  const assetInvocationPlan = await planAssetInvocation({
    item: planItem,
    referenceContext,
    userRequest,
    sopExecutionPlan,
  });
  const activeItem: GenerationPlanItem = {
    ...planItem,
    referenceRoles: assetInvocationPlan.referenceRoles,
    providerReferenceRoles: assetInvocationPlan.providerReferenceRoles,
    metadata: {
      ...planItem.metadata,
      assetInvocationPlan,
      assetInvocationPlanner: {
        mode: assetInvocationPlan.mode,
        fallbackUsed: assetInvocationPlan.fallbackUsed,
        fallbackReason: assetInvocationPlan.fallbackReason,
      },
    },
  };
  const itemReferenceContext = filterGenerationReferenceContextByRoles(
    referenceContext,
    activeItem.referenceRoles,
    activeItem.providerReferenceRoles
  );
  const providerReferenceAdapter = buildProviderReferenceAdapter(itemReferenceContext);
  const providerPrompt = await writeProviderImagePrompt({
    item: activeItem,
    itemReferenceContext,
    providerReferenceAdapter,
    userRequest,
    campaignBible,
    sopExecutionPlan,
    planId: getStringValue(job.metadata.planId),
  });
  const updatedMetadata: Record<string, unknown> = {
    ...job.metadata,
    deferPromptPreparation: false,
    deferredPromptPreparedAt: new Date().toISOString(),
    referenceContext: itemReferenceContext ?? referenceContext,
    referenceImages: itemReferenceContext?.images ?? job.metadata.referenceImages,
    itemReferenceRoles: activeItem.referenceRoles ?? [],
    itemProviderReferenceRoles: activeItem.providerReferenceRoles ?? [],
    productReferenceFocus: activeItem.productReferenceFocus,
    productReferenceFocusInstruction: activeItem.productReferenceFocusInstruction,
    referenceRouting: {
      ...(readRecord(job.metadata.referenceRouting) ?? {}),
      activeRoles: activeItem.referenceRoles ?? [],
      providerInputRoles: activeItem.providerReferenceRoles ?? [],
      plannerMode: assetInvocationPlan.mode,
    },
    assetInvocationPlan,
    assetInvocationPlanner: {
      mode: assetInvocationPlan.mode,
      fallbackUsed: assetInvocationPlan.fallbackUsed,
      fallbackReason: assetInvocationPlan.fallbackReason,
    },
    providerReferenceRole: providerReferenceAdapter.primaryImage?.role,
    providerReferenceStrategy: providerReferenceAdapter.strategy,
    providerReferenceAdapter,
    providerPromptWriter: providerPrompt.metadata,
    promptOnlyReferenceImages: providerReferenceAdapter.promptOnlyImages,
    usesProviderReference: providerReferenceAdapter.providerUsableImages.length > 0,
    usesProductReference: providerReferenceAdapter.primaryImage?.role === "product",
    itemMetadata: activeItem.metadata,
  };

  const updated = await jobDB.update(job.id, {
    prompt: providerPrompt.prompt,
    metadata: updatedMetadata,
  });
  return updated ?? {
    ...job,
    prompt: providerPrompt.prompt,
    metadata: updatedMetadata,
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isCurrentActiveRun(job: GenerationJob, runId: string): boolean {
  if (job.status === "cancelled") return false;
  if (!isSameRun(job, runId)) return false;

  const lease = jobLeaseDB.getLease(job.id);
  if (!jobLeaseDB.isLeaseActive(lease)) return false;
  if (lease?.owner !== QUEUE_OWNER) return false;

  const metadataLeaseId =
    typeof job.metadata.leaseId === "string" ? job.metadata.leaseId : "";
  return !metadataLeaseId || lease.leaseId === metadataLeaseId;
}

function isSameRun(job: GenerationJob, runId: string): boolean {
  const latestRunId =
    typeof job.metadata.lastRunId === "string" ? job.metadata.lastRunId : "";
  return !runId || latestRunId === runId;
}

export async function getExistingJobArtifact(jobId: string): Promise<GeneratedArtifact | undefined> {
  const artifacts = await artifactDB.list({ jobId });
  return artifacts.find((artifact) => artifact.status !== "failed");
}

function extractExportPackBatchMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  if (!hasExportPackBatchMetadata(metadata)) return {};

  return exportPackBatchMetadataKeys.reduce<Record<string, unknown>>((batchMetadata, key) => {
    if (metadata[key] !== undefined) {
      batchMetadata[key] = metadata[key];
    }
    return batchMetadata;
  }, {});
}

function extractGenerationReferenceMetadata(
  metadata: Record<string, unknown>,
  referenceImageUrl: string | undefined,
  referenceImageUrls: string[],
  providerReferenceAdapter: ProviderReferenceAdapter,
  usesProviderReference: boolean,
  providerCallBudgetId?: string,
  providerBudgetEvent?: { id: string; phase: string }
): Record<string, unknown> {
  return {
    referenceImages: metadata.referenceImages,
    referenceContext: metadata.referenceContext,
    referenceImageUrl,
    referenceImageUrls,
    providerReferenceImageUrls: referenceImageUrls,
    providerReferenceCount: referenceImageUrls.length,
    providerReferenceRole: providerReferenceAdapter.primaryImage?.role,
    providerReferenceStrategy: providerReferenceAdapter.strategy,
    providerReferenceAdapter,
    promptOnlyReferenceImages: providerReferenceAdapter.promptOnlyImages,
    providerAttemptLedger: metadata.providerAttemptLedger,
    lastProviderAttemptId: metadata.lastProviderAttemptId,
    lastProviderAttemptStatus: metadata.lastProviderAttemptStatus,
    providerCallBudgetId,
    providerBudgetSummary: providerCallBudgetId
      ? (metadata.providerBudgetSummary ?? undefined)
      : undefined,
    lastProviderBudgetEventId: providerBudgetEvent?.id ?? metadata.lastProviderBudgetEventId,
    lastProviderBudgetPhase: providerBudgetEvent?.phase ?? metadata.lastProviderBudgetPhase,
    usesProviderReference,
    usesProductReference: providerReferenceAdapter.primaryImage?.role === "product" && usesProviderReference,
  };
}

function getGenerationReferenceContext(
  metadata: Record<string, unknown>
): GenerationReferenceContext | undefined {
  const context = metadata.referenceContext;
  return context && typeof context === "object" && !Array.isArray(context)
    ? context as GenerationReferenceContext
    : undefined;
}

function hasProviderPromptWriter(metadata: Record<string, unknown>): boolean {
  const value = metadata.providerPromptWriter;
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function readProviderReferenceDataUrl(referenceImageUrl: string | undefined): Promise<string | undefined> {
  if (!referenceImageUrl) return undefined;
  if (isInlineImageUrl(referenceImageUrl)) return referenceImageUrl;
  if (referenceImageUrl.startsWith("/api/generated-images/")) {
    return readOutputImageAsDataUrl(referenceImageUrl);
  }
  return undefined;
}

async function readProviderReferenceDataUrls(referenceImageUrls: string[]): Promise<string[]> {
  const dataUrls = await Promise.all(
    referenceImageUrls.map((url) => readProviderReferenceDataUrl(url).catch(() => undefined))
  );
  return dataUrls.filter((url): url is string => !!url);
}

async function generateJobRunnerImage(
  prompt: string,
  providerReferenceDataUrls: string[],
  size?: string
): Promise<{
  image?: { base64?: string; url?: string };
  provider?: { providerRequestId?: string };
}> {
  if (process.env.IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER === "1") {
    if (process.env.IMAGE_MASTER_MOCK_JOB_RUNNER_REQUIRE_REFERENCE === "1" && providerReferenceDataUrls.length < 1) {
      throw new AIError("Mock job runner expected a product reference", "MOCK_REFERENCE_MISSING");
    }
    const expectedReferenceCount = Number(process.env.IMAGE_MASTER_MOCK_JOB_RUNNER_EXPECT_REFERENCE_COUNT);
    if (
      Number.isInteger(expectedReferenceCount) &&
      expectedReferenceCount >= 0 &&
      providerReferenceDataUrls.length !== expectedReferenceCount
    ) {
      throw new AIError(
        `Mock job runner expected ${expectedReferenceCount} references, got ${providerReferenceDataUrls.length}`,
        "MOCK_REFERENCE_COUNT_MISMATCH"
      );
    }
    return {
      image: {
        base64: tinyPngBase64(),
      },
    };
  }

  return generateSingleImage(prompt, providerReferenceDataUrls[0], undefined, {
    referenceImagesBase64: providerReferenceDataUrls,
    size,
  });
}

function tinyPngBase64(): string {
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
}

function extractProviderFailureMetadata(error: unknown): Record<string, unknown> {
  if (error instanceof AIError && error.diagnostics) {
    return {
      providerDiagnostics: error.diagnostics,
    };
  }
  return {};
}

function extractProviderFailureAttempt(error: unknown): {
  errorCode?: string;
  errorMessage?: string;
  diagnostics?: unknown;
} {
  if (error instanceof AIError) {
    return {
      errorCode: error.code,
      errorMessage: error.message,
      diagnostics: error.diagnostics,
    };
  }

  return {
    errorCode: "AI_ERROR",
    errorMessage: "图片生成失败，请稍后重试",
  };
}

function hasExportPackBatchMetadata(metadata: Record<string, unknown>): boolean {
  return (
    metadata.batchId !== undefined ||
    metadata.exportPackId !== undefined ||
    metadata.exportSpecId !== undefined
  );
}

function getNodeLabel(metadata: Record<string, unknown>): string {
  const label = metadata.nodeLabel;
  if (typeof label === "string" && label.trim()) return label.trim();
  return "画布任务";
}

function getProviderLabel(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname.replace(/^api\./, "");
    return host || "configured-image-provider";
  } catch {
    return "configured-image-provider";
  }
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createRunId(): string {
  return `run_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

function createLeaseOptions(now?: string) {
  return {
    leaseId: createLeaseId(),
    owner: QUEUE_OWNER,
    durationMs: LEASE_DURATION_MS,
    now,
  };
}

function createLeaseId(): string {
  return `lease_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

async function leaseJob(job: GenerationJob, timestampKey: string): Promise<GenerationJob> {
  const leased = await claimJob(job, {
    targetStatus: "queued",
    timestampKey,
    claimableStatuses: ["queued"],
  });
  if (!leased) throw new Error("job_not_found");
  return leased;
}

async function claimJob(
  job: GenerationJob,
  options: {
    targetStatus: string;
    timestampKey: string;
    claimableStatuses: string[];
    now?: string;
    metadataUpdates?: Record<string, unknown>;
  }
): Promise<GenerationJob | undefined> {
  const now = new Date().toISOString();
  const claimNow = options.now ?? now;
  const runId = createRunId();
  const leaseOptions = createLeaseOptions(claimNow);
  const claim = jobLeaseDB.claimJobLease({
    jobId: job.id,
    leaseId: leaseOptions.leaseId,
    owner: leaseOptions.owner,
    durationMs: leaseOptions.durationMs,
    targetStatus: options.targetStatus,
    claimableStatuses: options.claimableStatuses,
    metadata: {
      ...markJobQueuedMetadata(job, runId, claimNow, leaseOptions),
      [options.timestampKey]: claimNow,
      ...(options.metadataUpdates ?? {}),
    },
    now: claimNow,
    error: "",
  });

  if (claim.reason === "job_not_found") throw new Error("job_not_found");
  return claim.claimed ? claim.job : undefined;
}

function shouldReclaimLease(job: GenerationJob, lease = jobLeaseDB.getLease(job.id)): boolean {
  if (jobLeaseDB.isLeaseExpired(lease)) return true;
  if (!lease || lease.status !== "active" || lease.releasedAt) return true;
  return false;
}

function startLeaseHeartbeat(jobId: string): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    void jobDB.get(jobId).then((job) => {
      if (!job || job.status !== "running") return;
      jobLeaseDB.heartbeatJobLease(jobId, QUEUE_OWNER, LEASE_DURATION_MS);
    });
  }, LEASE_HEARTBEAT_MS);
  timer.unref?.();
  return timer;
}
