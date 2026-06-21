import { NextResponse } from "next/server";
import * as jobDB from "@/lib/store/job-db";
import * as projectDB from "@/lib/store/project-db";
import type { CreateGenerationJobParams, GenerationJob } from "@/lib/types";
import { safeLogError } from "@/lib/server/safe-log";
import { sanitizePayloadForJson } from "@/lib/store/metadata-image-sanitizer";

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
    const limit = parseLimit(searchParams.get("limit")) ?? (hasScopedFilter ? 200 : 80);
    const updatedAfter = searchParams.get("updatedAfter") || undefined;
    const summary = searchParams.get("summary") !== "0";
    const jobs = await jobDB.list({ workflowId, status, batchId, exportPackId, planId, limit, updatedAfter });
    return NextResponse.json(summary ? jobs.map(toJobSummary) : sanitizePayloadForJson(jobs));
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

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function pickStringArray(value: unknown, limit = 12): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.length > 500 ? `${item.slice(0, 500)}...` : item)
    .slice(0, limit);
  return items.length > 0 ? items : undefined;
}

function summarizeReferenceUrl(value: unknown): string | undefined {
  const url = getString(value);
  if (!url) return undefined;
  if (url.startsWith("data:image/")) return undefined;
  return url.length > 2048 ? undefined : url;
}

function summarizeReferenceImage(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  const summary = {
    id: getString(value.id),
    role: getString(value.role),
    label: getString(value.label) ?? getString(value.title) ?? getString(value.name),
    url: summarizeReferenceUrl(value.url),
    sourceAssetId: getString(value.sourceAssetId),
    sourceNodeId: getString(value.sourceNodeId),
    providerUsable: getBoolean(value.providerUsable),
  };
  const compact = Object.fromEntries(Object.entries(summary).filter(([, item]) => item !== undefined));
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function summarizeReferenceImages(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const images = value
    .map(summarizeReferenceImage)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .slice(0, 12);
  return images.length > 0 ? images : undefined;
}

function summarizeReferenceContext(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  const summary = {
    version: getString(value.version),
    source: getString(value.source),
    targetNodeId: getString(value.targetNodeId),
    targetNodeLabel: getString(value.targetNodeLabel),
    images: summarizeReferenceImages(value.images),
    promptFragments: pickStringArray(value.promptFragments, 8),
    constraints: pickStringArray(value.constraints, 8),
    negativeRules: pickStringArray(value.negativeRules, 8),
    qualityRules: pickStringArray(value.qualityRules, 8),
  };
  const compact = Object.fromEntries(Object.entries(summary).filter(([, item]) => item !== undefined));
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function summarizeProviderAdapter(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  const summary = {
    mode: getString(value.mode),
    strategy: getString(value.strategy),
    primaryImage: summarizeReferenceImage(value.primaryImage),
    providerUsableImages: summarizeReferenceImages(value.providerUsableImages),
    promptOnlyImages: summarizeReferenceImages(value.promptOnlyImages),
    warnings: pickStringArray(value.warnings, 8),
  };
  const compact = Object.fromEntries(Object.entries(summary).filter(([, item]) => item !== undefined));
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function toJobSummary(job: GenerationJob): GenerationJob {
  return {
    ...job,
    metadata: pickSummaryMetadata(job.metadata),
  };
}

function pickSummaryMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const summary = {
    source: getString(metadata.source),
    planId: getString(metadata.planId),
    planItemId: getString(metadata.planItemId),
    planItemTitle: getString(metadata.planItemTitle),
    planItemType: getString(metadata.planItemType),
    batchId: getString(metadata.batchId),
    projectId: getString(metadata.projectId),
    campaignId: getString(metadata.campaignId),
    batchIndex: getNumber(metadata.batchIndex),
    batchTotal: getNumber(metadata.batchTotal),
    exportPackId: getString(metadata.exportPackId),
    exportPackTitle: getString(metadata.exportPackTitle),
    exportItemId: getString(metadata.exportItemId),
    exportItemTitle: getString(metadata.exportItemTitle),
    exportSpecId: getString(metadata.exportSpecId),
    exportSpecTitle: getString(metadata.exportSpecTitle),
    resultGroupTitle: getString(metadata.resultGroupTitle),
    rerunGroupTitle: getString(metadata.rerunGroupTitle),
    rerunSourcePlanItemTitle: getString(metadata.rerunSourcePlanItemTitle),
    rerunSourceOutputSlotId: getString(metadata.rerunSourceOutputSlotId),
    rerunSourceExportSpecTitle: getString(metadata.rerunSourceExportSpecTitle),
    platform: getString(metadata.platform),
    size: getString(metadata.size),
    ratio: getString(metadata.ratio),
    useCase: getString(metadata.useCase),
    imageType: getString(metadata.imageType),
    provider: getString(metadata.provider),
    model: getString(metadata.model),
    providerReferenceRole: getString(metadata.providerReferenceRole),
    providerReferenceStrategy: getString(metadata.providerReferenceStrategy),
    referenceImageUrl: summarizeReferenceUrl(metadata.referenceImageUrl),
    referenceImages: summarizeReferenceImages(metadata.referenceImages),
    referenceContext: summarizeReferenceContext(metadata.referenceContext),
    providerReferenceAdapter: summarizeProviderAdapter(metadata.providerReferenceAdapter),
    promptOnlyReferenceImages: summarizeReferenceImages(metadata.promptOnlyReferenceImages),
    providerReferenceImageUrls: pickStringArray(metadata.providerReferenceImageUrls),
    providerReferenceCount: getNumber(metadata.providerReferenceCount),
    usesProviderReference: getBoolean(metadata.usesProviderReference),
    usesProductReference: getBoolean(metadata.usesProductReference),
    itemReferenceRoles: pickStringArray(metadata.itemReferenceRoles),
    itemProviderReferenceRoles: pickStringArray(metadata.itemProviderReferenceRoles),
    productReferenceFocus: getString(metadata.productReferenceFocus),
    referenceRouting: isPlainObject(metadata.referenceRouting) ? metadata.referenceRouting : undefined,
    copyRenderPolicy: isPlainObject(metadata.copyRenderPolicy) ? metadata.copyRenderPolicy : undefined,
    providerDiagnostics: isPlainObject(metadata.providerDiagnostics) ? metadata.providerDiagnostics : undefined,
    generationTelemetry: isPlainObject(metadata.generationTelemetry) ? metadata.generationTelemetry : undefined,
    resultStorage: isPlainObject(metadata.resultStorage) ? metadata.resultStorage : undefined,
    imageStorage: isPlainObject(metadata.imageStorage) ? metadata.imageStorage : undefined,
    batchState: getString(metadata.batchState),
  };
  return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined));
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
