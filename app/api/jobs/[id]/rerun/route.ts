import { NextResponse, type NextRequest } from "next/server";
import * as jobDB from "@/lib/store/job-db";
import * as projectDB from "@/lib/store/project-db";
import { syncExportPackBatchState } from "@/lib/store/export-pack-batch-sync";
import {
  ProviderCallApprovalRequiredError,
  startGenerationJob,
} from "@/lib/store/job-runner";
import { safeLogError } from "@/lib/server/safe-log";
import type { GenerationJob } from "@/lib/types";

export const dynamic = "force-dynamic";

interface RerunBody {
  title?: unknown;
  note?: unknown;
  groupTitle?: unknown;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少任务 ID" }, { status: 400 });
  }

  try {
    const body = await readBody(req);
    const sourceJob = await jobDB.get(id);
    if (!sourceJob) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    if (!canCreateRerun(sourceJob)) {
      return NextResponse.json(
        { job: sourceJob, error: "当前任务还没有完成图，不能再做一版" },
        { status: 409 }
      );
    }

    const batchId = getString(sourceJob.metadata.batchId);
    const batch = batchId ? await projectDB.getBatch(batchId) : undefined;
    if (batch?.state === "locked" || batch?.state === "delivered") {
      return NextResponse.json(
        { job: sourceJob, error: "当前批次已锁定或交付，不能再做一版" },
        { status: 409 }
      );
    }

    const siblings = batchId ? await jobDB.list({ batchId }) : [];
    const now = new Date().toISOString();
    const nextIndex = getNextBatchIndex(siblings);
    const nextTotal = Math.max(siblings.length + 1, nextIndex);
    const originalTitle = getJobTitle(sourceJob);
    const title = getString(body.title) || `${originalTitle} 再做一版`;
    const metadata = buildRerunMetadata({
      sourceJob,
      title,
      nextIndex,
      nextTotal,
      now,
      note: getString(body.note),
      groupTitle: getString(body.groupTitle),
    });

    const rerunJob = await jobDB.add({
      workflowId: sourceJob.workflowId,
      nodeId: sourceJob.nodeId,
      assetId: sourceJob.assetId,
      status: "pending",
      prompt: sourceJob.prompt,
      resultUrl: "",
      error: "",
      metadata,
    });

    let batchState = await projectDB.ensureExportPackBatchForJob(
      rerunJob as GenerationJob & { metadata: Record<string, unknown> }
    );
    if (batchId) {
      batchState =
        (await projectDB.reopenExportPackBatchForRerun({
          batchId,
          jobId: rerunJob.id,
          now,
        })) ?? batchState;
    }
    const syncedBatch = await syncExportPackBatchState(getString(metadata.batchId), {
      reason: "result-rerun-created",
      now,
    });

    let queueResult;
    try {
      queueResult = await startGenerationJob(rerunJob.id);
    } catch (error) {
      if (error instanceof ProviderCallApprovalRequiredError) {
        return NextResponse.json(
          {
            job: rerunJob,
            rerunOfJobId: sourceJob.id,
            batchState,
            batch: syncedBatch,
            error: "再做一版前需要确认 provider 调用上限",
            code: error.code,
            details: error.details,
          },
          { status: error.status }
        );
      }
      throw error;
    }

    return NextResponse.json(
      {
        job: queueResult?.job ?? rerunJob,
        rerunOfJobId: sourceJob.id,
        batchState,
        batch: syncedBatch,
        queued: !!queueResult?.started,
        queueResult,
      },
      { status: 201 }
    );
  } catch (error) {
    safeLogError("Job rerun creation failed", error);
    return NextResponse.json({ error: "再做一版任务创建失败" }, { status: 500 });
  }
}

async function readBody(req: NextRequest): Promise<RerunBody> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as RerunBody) : {};
  } catch {
    return {};
  }
}

function canCreateRerun(job: GenerationJob): boolean {
  return (job.status === "done" || job.status === "completed") && !!job.prompt.trim() && !!job.resultUrl.trim();
}

function buildRerunMetadata({
  sourceJob,
  title,
  nextIndex,
  nextTotal,
  now,
  note,
  groupTitle,
}: {
  sourceJob: GenerationJob;
  title: string;
  nextIndex: number;
  nextTotal: number;
  now: string;
  note?: string;
  groupTitle?: string;
}): Record<string, unknown> {
  const base = stripGeneratedResultMetadata(sourceJob.metadata);
  const resultGroupTitle = groupTitle || getString(base.resultGroupTitle) || getString(base.rerunGroupTitle);
  return {
    ...base,
    batchIndex: nextIndex,
    batchTotal: nextTotal,
    batchJobTitle: title,
    exportSpecTitle: title,
    exportSpecId: `${getString(base.exportSpecId) || "rerun"}_rerun_${nextIndex}`,
    exportItemId: `${getString(base.exportItemId) || "item"}_rerun_${nextIndex}`,
    naming: buildRerunNaming(getString(base.naming), nextIndex),
    rerunOfJobId: sourceJob.id,
    rerunCreatedAt: now,
    rerunNote: note,
    ...(resultGroupTitle ? { resultGroupTitle, rerunGroupTitle: resultGroupTitle } : {}),
    rerunSourcePlanItemTitle: getString(base.planItemTitle),
    rerunSourceOutputSlotId: getString(base.outputSlotId),
    rerunSourceExportSpecTitle: getString(base.exportSpecTitle),
    rerunSourceStatus: sourceJob.status,
    rerunSourceResultUrl: sourceJob.resultUrl,
    source: getString(base.source) || "project-batch-result-rerun",
  };
}

function stripGeneratedResultMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const result = { ...metadata };
  for (const key of [
    "artifactId",
    "completedAt",
    "errorCode",
    "exportPackQaReview",
    "failedAt",
    "imageStorage",
    "lastRunId",
    "outputArtifactId",
    "outputAssetId",
    "lastProviderAttemptId",
    "lastProviderAttemptStatus",
    "lastProviderBudgetEventId",
    "lastProviderBudgetPhase",
    "providerAttemptLedger",
    "providerBudget",
    "providerBudgetLedger",
    "providerBudgetSummary",
    "providerCallBudgetId",
    "providerDiagnostics",
    "queuedAt",
    "reviewState",
    "resultStorage",
    "startedAt",
    "visualQa",
  ]) {
    delete result[key];
  }
  return result;
}

function getNextBatchIndex(jobs: GenerationJob[]): number {
  const indexes = jobs
    .map((job) => getNumber(job.metadata.batchIndex))
    .filter((value): value is number => typeof value === "number");
  return Math.max(0, ...indexes, jobs.length) + 1;
}

function buildRerunNaming(naming: string | undefined, index: number): string {
  const suffix = `rerun_${String(index).padStart(2, "0")}`;
  return naming ? `${naming}_${suffix}` : suffix;
}

function getJobTitle(job: GenerationJob): string {
  return (
    getString(job.metadata.batchJobTitle) ||
    getString(job.metadata.exportSpecTitle) ||
    getString(job.metadata.nodeLabel) ||
    "生成图"
  );
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
