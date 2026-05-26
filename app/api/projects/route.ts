import { NextResponse } from "next/server";
import * as projectDB from "@/lib/store/project-db";
import { isExportPackBatchState } from "@/lib/canvas/export-pack-state";
import { safeLogError } from "@/lib/server/safe-log";

type EntityType = "project" | "campaign" | "batch";

export async function GET() {
  try {
    const projects = await projectDB.listProjects();
    return NextResponse.json({ projects });
  } catch (e) {
    safeLogError("Project list failed", e);
    return NextResponse.json({ error: "项目列表读取失败" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!isRecord(body)) return NextResponse.json({ error: "请求参数无效" }, { status: 400 });

    const entityType = normalizeEntityType(body.entityType) ?? "project";
    if (entityType === "project") {
      const params = validateProjectCreate(body);
      if (typeof params === "string") return NextResponse.json({ error: params }, { status: 400 });
      const project = await projectDB.createProject(params);
      return NextResponse.json({ project }, { status: 201 });
    }

    if (entityType === "campaign") {
      const params = validateCampaignCreate(body);
      if (typeof params === "string") return NextResponse.json({ error: params }, { status: 400 });
      const campaign = await projectDB.createCampaign(params);
      return NextResponse.json({ campaign }, { status: 201 });
    }

    const params = validateBatchCreate(body);
    if (typeof params === "string") return NextResponse.json({ error: params }, { status: 400 });
    const batch = await projectDB.createBatch(params);
    return NextResponse.json({ batch }, { status: 201 });
  } catch (e) {
    if (isKnownProjectError(e)) {
      return NextResponse.json({ error: mapProjectError(e) }, { status: 404 });
    }
    safeLogError("Project create failed", e);
    return NextResponse.json({ error: "项目资源创建失败" }, { status: 500 });
  }
}

function validateProjectCreate(
  body: Record<string, unknown>
): projectDB.CreateProjectParams | string {
  const title = getRequiredString(body.title);
  if (!title) return "项目标题不能为空";
  if (!isOptionalString(body.id)) return "项目 ID 无效";
  if (!isOptionalString(body.description)) return "项目描述无效";
  if (!isOptionalString(body.status)) return "项目状态无效";
  if (!isOptionalRecord(body.metadata)) return "项目 metadata 无效";

  return {
    id: getOptionalString(body.id),
    title,
    description: getOptionalString(body.description),
    status: getOptionalString(body.status),
    metadata: normalizeProjectMetadata(getOptionalRecord(body.metadata)),
  };
}

function validateCampaignCreate(
  body: Record<string, unknown>
): projectDB.CreateCampaignParams | string {
  const projectId = getRequiredString(body.projectId);
  const title = getRequiredString(body.title);
  if (!projectId) return "项目 ID 不能为空";
  if (!title) return "活动标题不能为空";
  if (!isOptionalString(body.id)) return "活动 ID 无效";
  if (!isOptionalString(body.description)) return "活动描述无效";
  if (!isOptionalString(body.status)) return "活动状态无效";
  if (!isOptionalRecord(body.metadata)) return "活动 metadata 无效";

  return {
    id: getOptionalString(body.id),
    projectId,
    title,
    description: getOptionalString(body.description),
    status: getOptionalString(body.status),
    metadata: getOptionalRecord(body.metadata),
  };
}

function validateBatchCreate(
  body: Record<string, unknown>
): projectDB.CreateProjectBatchParams | string {
  const projectId = getRequiredString(body.projectId);
  const title = getRequiredString(body.title);
  if (!projectId) return "项目 ID 不能为空";
  if (!title) return "批次标题不能为空";
  if (!isOptionalString(body.id)) return "批次 ID 无效";
  if (!isOptionalString(body.campaignId)) return "活动 ID 无效";
  if (!isOptionalString(body.kind)) return "批次类型无效";
  if (body.state !== undefined && !isExportPackBatchState(body.state)) return "批次状态无效";
  if (!isOptionalRecord(body.metadata)) return "批次 metadata 无效";

  return {
    id: getOptionalString(body.id),
    projectId,
    campaignId: getOptionalString(body.campaignId),
    title,
    kind: getOptionalString(body.kind),
    state: body.state as projectDB.CreateProjectBatchParams["state"],
    metadata: getOptionalRecord(body.metadata),
  };
}

function normalizeEntityType(value: unknown): EntityType | undefined {
  if (value === "project" || value === "campaign" || value === "batch") return value;
  return undefined;
}

function isKnownProjectError(error: unknown): boolean {
  return error instanceof Error && ["project_not_found", "campaign_not_found"].includes(error.message);
}

function mapProjectError(error: unknown): string {
  if (!(error instanceof Error)) return "项目资源不存在";
  if (error.message === "project_not_found") return "项目不存在";
  if (error.message === "campaign_not_found") return "活动不存在";
  return "项目资源不存在";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
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
