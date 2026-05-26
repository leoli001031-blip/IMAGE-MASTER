import { NextResponse } from "next/server";
import { buildExportPackImageInfoMap } from "@/lib/canvas/export-pack-image-info";
import { buildExportPackManifests } from "@/lib/canvas/export-pack-manifest";
import {
  buildExportPackQaReviewByJobId,
  buildExportPackQaReport,
  MANUAL_QA_CHECK_IDS,
  mergeExportPackQaReviewMetadata,
  type ExportPackQaManualStatus,
} from "@/lib/canvas/export-pack-qa";
import * as artifactDB from "@/lib/store/artifact-db";
import * as jobDB from "@/lib/store/job-db";
import * as projectDB from "@/lib/store/project-db";
import { safeLogError } from "@/lib/server/safe-log";

interface RouteContext {
  params: Promise<{
    batchId: string;
  }>;
}

interface ReviewBody {
  jobId?: unknown;
  checkId?: unknown;
  status?: unknown;
  note?: unknown;
  reviewer?: unknown;
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { batchId } = await context.params;
    const body = (await req.json()) as ReviewBody;
    const validation = validateReviewBody(body);
    if (typeof validation === "string") {
      return NextResponse.json({ error: validation }, { status: 400 });
    }

    const jobs = await jobDB.list();
    const artifacts = await artifactDB.list();
    const manifest = buildExportPackManifests({ jobs, artifacts }).find(
      (item) => item.batchId === batchId
    );
    if (!manifest) {
      return NextResponse.json({ error: "导出包 QA 批次不存在" }, { status: 404 });
    }

    let batchState = await projectDB.ensureExportPackBatchForManifest({
      manifest,
      jobs,
      artifacts,
    });
    if (batchState.locked || batchState.delivered) {
      return NextResponse.json({ error: "导出包批次已锁定，不能写入人工复核" }, { status: 409 });
    }
    batchState = (await projectDB.moveExportPackBatchToReview(batchId)) ?? batchState;

    const targetItem = manifest.items.find((item) => item.jobId === validation.jobId);
    if (!targetItem) {
      return NextResponse.json({ error: "任务不属于当前导出包批次" }, { status: 404 });
    }
    if (!isReadyArtifact(targetItem.artifact)) {
      return NextResponse.json({ error: "任务产物尚未完成，不能写入人工复核" }, { status: 409 });
    }

    const targetJob = jobs.find((job) => job.id === validation.jobId);
    if (!targetJob) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    const updatedJob = await jobDB.update(targetJob.id, {
      metadata: mergeExportPackQaReviewMetadata(targetJob.metadata, {
        checkId: validation.checkId,
        status: validation.status,
        note: validation.note,
        reviewer: validation.reviewer,
      }),
    });
    if (!updatedJob) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    const updatedJobs = jobs.map((job) => (job.id === updatedJob.id ? updatedJob : job));
    const imageInfoByUrl = await buildExportPackImageInfoMap(manifest);
    const qa = buildExportPackQaReport({
      manifest,
      imageInfoByUrl,
      reviewByJobId: buildExportPackQaReviewByJobId(updatedJobs),
    });
    batchState =
      (await projectDB.markExportPackBatchReviewedIfComplete({
        batchId,
        complete: isQaReviewComplete(qa),
      })) ?? batchState;

    return NextResponse.json({ job: updatedJob, qa, batchState });
  } catch (e) {
    safeLogError("Export pack QA review failed", e);
    return NextResponse.json({ error: "导出包 QA 复核写入失败" }, { status: 500 });
  }
}

function validateReviewBody(
  body: ReviewBody
):
  | {
      jobId: string;
      checkId: string;
      status: ExportPackQaManualStatus;
      note?: string;
      reviewer?: string;
    }
  | string {
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  if (!jobId) return "任务 ID 无效";

  const checkId = typeof body.checkId === "string" ? body.checkId.trim() : "";
  if (!MANUAL_QA_CHECK_IDS.includes(checkId)) return "QA 检查项无效";

  const status = normalizeManualStatus(body.status);
  if (!status) return "QA 复核状态无效";

  return {
    jobId,
    checkId,
    status,
    note: typeof body.note === "string" ? body.note.trim() || undefined : undefined,
    reviewer:
      typeof body.reviewer === "string" ? body.reviewer.trim() || undefined : undefined,
  };
}

function normalizeManualStatus(value: unknown): ExportPackQaManualStatus | undefined {
  return value === "pass" || value === "fail" || value === "manual" ? value : undefined;
}

function isReadyArtifact(artifact?: { url?: string; status?: string }): boolean {
  return (
    !!artifact?.url &&
    !!artifact.status &&
    ["ready", "done", "completed", "success"].includes(artifact.status)
  );
}

function isQaReviewComplete(qa: {
  counts: {
    manual: number;
    pending: number;
    pendingArtifact: number;
    missingArtifact: number;
  };
}): boolean {
  return (
    qa.counts.manual === 0 &&
    qa.counts.pending === 0 &&
    qa.counts.pendingArtifact === 0 &&
    qa.counts.missingArtifact === 0
  );
}
