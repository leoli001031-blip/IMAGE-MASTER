import { NextRequest, NextResponse } from "next/server";
import { isExportPackBatchState } from "@/lib/canvas/export-pack-state";
import * as projectDB from "@/lib/store/project-db";
import { safeLogError } from "@/lib/server/safe-log";

type EntityType = "project" | "campaign" | "batch";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "缺少项目 ID" }, { status: 400 });

  try {
    const project = await projectDB.getProject(id);
    if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    return NextResponse.json({ project });
  } catch (e) {
    safeLogError("Project read failed", e);
    return NextResponse.json({ error: "项目读取失败" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "缺少项目 ID" }, { status: 400 });

  try {
    const body = await req.json();
    if (!isRecord(body)) return NextResponse.json({ error: "请求参数无效" }, { status: 400 });

    const entityType = normalizeEntityType(body.entityType) ?? "project";
    if (entityType === "project") {
      const updates = validateProjectUpdate(body);
      if (typeof updates === "string") return NextResponse.json({ error: updates }, { status: 400 });
      const project = await projectDB.updateProject(id, updates);
      if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
      return NextResponse.json({ project });
    }

    if (entityType === "campaign") {
      const campaignId = getRequiredString(body.campaignId);
      if (!campaignId) return NextResponse.json({ error: "活动 ID 不能为空" }, { status: 400 });
      const updates = validateCampaignUpdate(body);
      if (typeof updates === "string") return NextResponse.json({ error: updates }, { status: 400 });
      const campaign = await projectDB.updateCampaign(id, campaignId, updates);
      if (!campaign) return NextResponse.json({ error: "活动不存在" }, { status: 404 });
      return NextResponse.json({ campaign });
    }

    const batchId = getRequiredString(body.batchId);
    if (!batchId) return NextResponse.json({ error: "批次 ID 不能为空" }, { status: 400 });
    const action = getOptionalString(body.action);
    if (action === "archive_cleanup") {
      const result = await projectDB.archiveProjectBatchJobs(id, batchId, {
        reason: getOptionalString(body.reason),
        archivedBy: getOptionalString(body.archivedBy),
      });
      if (!result) return NextResponse.json({ error: "批次不存在" }, { status: 404 });
      return NextResponse.json({
        batch: result.batch,
        batchState: result.batchState,
        archiveCleanup: {
          matchedJobIds: result.matchedJobIds,
          cancelledJobIds: result.cancelledJobIds,
          skippedJobIds: result.skippedJobIds,
          removedFromRuntimeQueueJobIds: result.removedFromRuntimeQueueJobIds,
        },
      });
    }

    const updates = validateBatchUpdate(body);
    if (typeof updates === "string") return NextResponse.json({ error: updates }, { status: 400 });
    const batch = await projectDB.updateBatch(id, batchId, updates);
    if (!batch) return NextResponse.json({ error: "批次不存在" }, { status: 404 });
    return NextResponse.json({
      batch,
      batchState: await projectDB.getExportPackBatchState(batch.id),
    });
  } catch (e) {
    if (e instanceof Error && e.message === "campaign_not_found") {
      return NextResponse.json({ error: "活动不存在" }, { status: 404 });
    }
    if (e instanceof Error && e.message === "batch_locked") {
      return NextResponse.json({ error: "批次已锁定，不能修改内容" }, { status: 409 });
    }
    if (e instanceof Error && e.message.includes("导出包状态不能")) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof Error && e.message.includes("已锁定")) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof Error && e.message.includes("已交付")) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    safeLogError("Project update failed", e);
    return NextResponse.json({ error: "项目资源更新失败" }, { status: 500 });
  }
}

function validateProjectUpdate(
  body: Record<string, unknown>
): projectDB.UpdateProjectParams | string {
  if (!isOptionalNonEmptyString(body.title)) return "项目标题不能为空";
  if (!isOptionalString(body.description)) return "项目描述无效";
  if (!isOptionalString(body.status)) return "项目状态无效";
  if (!isOptionalRecord(body.metadata)) return "项目 metadata 无效";
  return {
    title: getOptionalString(body.title),
    description: getOptionalString(body.description),
    status: getOptionalString(body.status),
    metadata: normalizeProjectMetadata(getOptionalRecord(body.metadata)),
  };
}

function validateCampaignUpdate(
  body: Record<string, unknown>
): projectDB.UpdateCampaignParams | string {
  if (!isOptionalNonEmptyString(body.title)) return "活动标题不能为空";
  if (!isOptionalString(body.description)) return "活动描述无效";
  if (!isOptionalString(body.status)) return "活动状态无效";
  if (!isOptionalRecord(body.metadata)) return "活动 metadata 无效";
  return {
    title: getOptionalString(body.title),
    description: getOptionalString(body.description),
    status: getOptionalString(body.status),
    metadata: getOptionalRecord(body.metadata),
  };
}

function validateBatchUpdate(
  body: Record<string, unknown>
): projectDB.UpdateProjectBatchParams | string {
  if (!isOptionalString(body.campaignId)) return "活动 ID 无效";
  if (!isOptionalNonEmptyString(body.title)) return "批次标题不能为空";
  if (!isOptionalString(body.kind)) return "批次类型无效";
  if (body.state !== undefined && !isExportPackBatchState(body.state)) return "批次状态无效";
  if (!isOptionalRecord(body.metadata)) return "批次 metadata 无效";
  const updates: projectDB.UpdateProjectBatchParams = {};
  if (body.campaignId !== undefined) updates.campaignId = getOptionalString(body.campaignId);
  if (body.title !== undefined) updates.title = getOptionalString(body.title);
  if (body.kind !== undefined) updates.kind = getOptionalString(body.kind);
  if (body.state !== undefined && isExportPackBatchState(body.state)) updates.state = body.state;
  if (body.metadata !== undefined) updates.metadata = getOptionalRecord(body.metadata);
  return updates;
}

function normalizeEntityType(value: unknown): EntityType | undefined {
  if (value === "project" || value === "campaign" || value === "batch") return value;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && !!value.trim());
}

function isOptionalRecord(value: unknown): boolean {
  return value === undefined || isRecord(value);
}

function getRequiredString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getOptionalString(value: unknown): string | undefined {
  const text = getRequiredString(value);
  return text || undefined;
}

function getOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function normalizeProjectMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;

  const next = { ...metadata };
  const assetIds = new Set(getStringArray(next.assetIds));
  collectAssetIds(next.assets, assetIds);
  collectAssetIds(next.assetRefs, assetIds);
  collectAssetIds(next.assetSnapshots, assetIds);
  collectAssetIds(next.assetPayloads, assetIds);

  delete next.assets;
  delete next.assetSnapshots;
  delete next.assetPayloads;

  if (assetIds.size > 0) next.assetIds = Array.from(assetIds);
  return next;
}

function collectAssetIds(value: unknown, target: Set<string>): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      target.add(item.trim());
      continue;
    }
    if (!isRecord(item)) continue;
    const id = getOptionalString(item.id) ?? getOptionalString(item.assetId);
    if (id) target.add(id);
  }
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && !!item.trim())
    : [];
}
