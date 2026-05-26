import { NextResponse, type NextRequest } from "next/server";
import * as jobDB from "@/lib/store/job-db";
import {
  isCancellableJob,
  markJobCancelledMetadata,
} from "@/lib/store/job-lifecycle";
import { removeJobFromRuntimeQueue } from "@/lib/store/job-runner";
import { safeLogError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少任务 ID" }, { status: 400 });
  }

  try {
    const job = await jobDB.get(id);
    if (!job) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    if (!isCancellableJob(job)) {
      return NextResponse.json(
        { job, error: "当前任务状态不可取消" },
        { status: 409 }
      );
    }

    const reason = await readCancelReason(req);
    const cancelled = await jobDB.update(id, {
      status: "cancelled",
      error: reason,
      metadata: markJobCancelledMetadata(job, reason),
    });
    const removedFromRuntimeQueue = removeJobFromRuntimeQueue(id);

    return NextResponse.json({
      job: cancelled,
      cancelled: true,
      removedFromRuntimeQueue,
    });
  } catch (error) {
    safeLogError("Job cancel failed", error);
    return NextResponse.json({ error: "任务取消失败，请稍后重试" }, { status: 500 });
  }
}

async function readCancelReason(req: NextRequest): Promise<string> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return "用户取消";
    const reason = (body as Record<string, unknown>).reason;
    return typeof reason === "string" && reason.trim() ? reason.trim() : "用户取消";
  } catch {
    return "用户取消";
  }
}
