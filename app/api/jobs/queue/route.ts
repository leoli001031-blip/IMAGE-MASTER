import { NextResponse } from "next/server";
import {
  ensureJobQueueWorkerNow,
  getJobQueueSnapshot,
  reclaimStaleJobs,
} from "@/lib/store/job-runner";
import { safeLogError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureJobQueueWorkerNow();
    const queue = await getJobQueueSnapshot();
    return NextResponse.json({ queue });
  } catch (error) {
    safeLogError("Job queue snapshot failed", error);
    return NextResponse.json({ error: "队列状态读取失败" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const action = typeof body.action === "string" ? body.action : "snapshot";

    if (action === "reclaim") {
      const enqueue = body.enqueue === true;
      const result = await reclaimStaleJobs({ enqueue });
      return NextResponse.json({ queue: result.snapshot, reclaim: result });
    }

    if (action === "snapshot") {
      await ensureJobQueueWorkerNow();
      const queue = await getJobQueueSnapshot();
      return NextResponse.json({ queue });
    }

    return NextResponse.json({ error: "队列操作无效" }, { status: 400 });
  } catch (error) {
    safeLogError("Job queue operation failed", error);
    return NextResponse.json({ error: "队列操作失败" }, { status: 500 });
  }
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
