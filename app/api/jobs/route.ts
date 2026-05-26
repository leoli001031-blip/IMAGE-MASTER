import { NextResponse } from "next/server";
import * as jobDB from "@/lib/store/job-db";
import * as projectDB from "@/lib/store/project-db";
import type { CreateGenerationJobParams, GenerationJob } from "@/lib/types";
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

function validateCreate(body: Record<string, unknown>): CreateGenerationJobParams | string {
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

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const workflowId = searchParams.get("workflowId") || undefined;
    const status = searchParams.get("status") || undefined;
    const batchId = searchParams.get("batchId") || undefined;
    const exportPackId = searchParams.get("exportPackId") || undefined;
    const planId = searchParams.get("planId") || undefined;
    const hasScopedFilter = Boolean(workflowId || status || batchId || exportPackId || planId);
    const limit = parseLimit(searchParams.get("limit")) ?? (hasScopedFilter ? undefined : 80);
    const summary = searchParams.get("summary") !== "0";
    const jobs = await jobDB.list({ workflowId, status, batchId, exportPackId, planId, limit });
    return NextResponse.json(summary ? jobs.map(toJobSummary) : jobs);
  } catch (e) {
    safeLogError("Job list failed", e);
    return NextResponse.json({ error: "任务列表读取失败" }, { status: 500 });
  }
}

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.min(Math.floor(numeric), 500);
}

function toJobSummary(job: GenerationJob): GenerationJob {
  return {
    ...job,
    metadata: pickSummaryMetadata(job.metadata),
  };
}

function pickSummaryMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    "source",
    "planId",
    "planItemId",
    "planItemTitle",
    "planItemType",
    "batchId",
    "projectId",
    "campaignId",
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
    "useCase",
    "imageType",
    "provider",
    "model",
    "providerReferenceRole",
    "providerReferenceStrategy",
    "usesProviderReference",
    "usesProductReference",
    "itemReferenceRoles",
    "itemProviderReferenceRoles",
    "productReferenceFocus",
    "referenceRouting",
    "copyRenderPolicy",
    "providerDiagnostics",
    "resultStorage",
    "imageStorage",
    "batchState",
  ];
  return Object.fromEntries(
    keys
      .filter((key) => metadata[key] !== undefined)
      .map((key) => [key, metadata[key]])
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "请求参数无效" }, { status: 400 });
    }

    const params = validateCreate(body as Record<string, unknown>);
    if (typeof params === "string") {
      return NextResponse.json({ error: params }, { status: 400 });
    }

    const job = await jobDB.add(params);
    const batchState = await projectDB.ensureExportPackBatchForJob(job);
    if (!batchState) return NextResponse.json(job, { status: 201 });

    const enriched = await jobDB.update(job.id, {
      metadata: {
        ...job.metadata,
        projectId: batchState.projectId,
        campaignId: batchState.campaignId,
        batchState: batchState.state,
      },
    });
    return NextResponse.json(enriched ?? job, { status: 201 });
  } catch (e) {
    safeLogError("Job creation failed", e);
    return NextResponse.json({ error: "任务创建失败，请稍后重试" }, { status: 500 });
  }
}
