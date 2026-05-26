import { NextResponse, type NextRequest } from "next/server";
import * as jobDB from "@/lib/store/job-db";
import {
  isRetryableJob,
  markJobRetriedMetadata,
} from "@/lib/store/job-lifecycle";
import { safeLogError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
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

    if (!isRetryableJob(job)) {
      return NextResponse.json(
        { job, error: "当前任务状态不可重试" },
        { status: 409 }
      );
    }

    const retried = await jobDB.update(id, {
      status: "pending",
      resultUrl: "",
      error: "",
      metadata: markJobRetriedMetadata(job),
    });

    return NextResponse.json({
      job: retried,
      retried: true,
    });
  } catch (error) {
    safeLogError("Job retry failed", error);
    return NextResponse.json({ error: "任务重试失败，请稍后重试" }, { status: 500 });
  }
}
