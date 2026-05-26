import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import * as jobDB from "@/lib/store/job-db";
import type { UpdateGenerationJobParams } from "@/lib/types";
import { safeLogError } from "@/lib/server/safe-log";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isMetadata(value: unknown): value is Record<string, unknown> {
  return value === undefined || isPlainObject(value);
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function validateUpdate(body: Record<string, unknown>): UpdateGenerationJobParams | string {
  if (!optionalString(body.workflowId)) return "工作流 ID 无效";
  if (!optionalString(body.nodeId)) return "节点 ID 无效";
  if (!optionalString(body.assetId)) return "资产 ID 无效";
  if (body.status !== undefined && (typeof body.status !== "string" || !body.status.trim())) {
    return "任务状态无效";
  }
  if (!optionalString(body.prompt)) return "任务 prompt 无效";
  if (!optionalString(body.resultUrl)) return "任务结果 URL 无效";
  if (!optionalString(body.error)) return "任务错误信息无效";
  if (!isMetadata(body.metadata)) return "任务 metadata 无效";

  return {
    workflowId: body.workflowId as string | undefined,
    nodeId: body.nodeId as string | undefined,
    assetId: body.assetId as string | undefined,
    status: body.status as string | undefined,
    prompt: body.prompt as string | undefined,
    resultUrl: body.resultUrl as string | undefined,
    error: body.error as string | undefined,
    metadata: body.metadata as Record<string, unknown> | undefined,
  };
}

export async function GET(
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

    return NextResponse.json(job);
  } catch (e) {
    safeLogError("Job read failed", e);
    return NextResponse.json({ error: "任务读取失败" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少任务 ID" }, { status: 400 });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "请求参数无效" }, { status: 400 });
    }

    const updates = validateUpdate(body as Record<string, unknown>);
    if (typeof updates === "string") {
      return NextResponse.json({ error: updates }, { status: 400 });
    }

    const job = await jobDB.update(id, updates);
    if (!job) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch (e) {
    safeLogError("Job update failed", e);
    return NextResponse.json({ error: "任务更新失败，请稍后重试" }, { status: 500 });
  }
}
