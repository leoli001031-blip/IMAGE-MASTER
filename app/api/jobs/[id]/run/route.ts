import { NextResponse, type NextRequest } from "next/server";
import * as assetDB from "@/lib/store/asset-db";
import * as jobDB from "@/lib/store/job-db";
import {
  isDoneJob,
  isRetryableJob,
  markJobFailedMetadata,
} from "@/lib/store/job-lifecycle";
import {
  getExistingJobArtifact,
  ProviderCallApprovalRequiredError,
  startGenerationJob,
} from "@/lib/store/job-runner";
import { safeLogError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let id = "";
  let job: Awaited<ReturnType<typeof jobDB.get>> = undefined;

  try {
    const resolved = await params;
    id = resolved.id;
    if (!id) {
      return NextResponse.json({ error: "缺少任务 ID" }, { status: 400 });
    }

    job = await jobDB.get(id);
    if (!job) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    if (!job.prompt.trim()) {
      const failed = await jobDB.update(id, {
        status: "failed",
        error: "任务缺少 prompt",
        metadata: markJobFailedMetadata(job),
      });
      return NextResponse.json({ job: failed, error: "任务缺少 prompt" }, { status: 400 });
    }

    if (isDoneJob(job)) {
      const artifact = await getExistingJobArtifact(id);
      const asset = artifact?.assetId ? await assetDB.get(artifact.assetId) : undefined;
      return NextResponse.json({
        job,
        asset,
        artifact,
        queued: false,
        alreadyDone: true,
      });
    }

    if (isRetryableJob(job)) {
      return NextResponse.json(
        { job, error: "任务需要先重试，重置为待运行后再启动" },
        { status: 409 }
      );
    }

    const result = await startGenerationJob(id);
    return NextResponse.json({
      job: result.job,
      queued: true,
      started: result.started,
      alreadyRunning: result.alreadyRunning,
      alreadyQueued: result.alreadyQueued,
      alreadyDone: result.alreadyDone,
    });
  } catch (error) {
    if (error instanceof ProviderCallApprovalRequiredError) {
      return NextResponse.json(
        {
          ...(job ? { job } : {}),
          ...error.details,
        },
        { status: error.status }
      );
    }

    if (error instanceof Error && error.message === "job_not_found") {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    safeLogError("Job start failed", error);

    if (id && job) {
      const failed = await jobDB.update(id, {
        status: "failed",
        error: "任务启动失败，请稍后重试",
        metadata: markJobFailedMetadata(job),
      });
      return NextResponse.json(
        { job: failed, error: "任务启动失败，请稍后重试" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "任务启动失败，请稍后重试" },
      { status: 500 }
    );
  }
}
