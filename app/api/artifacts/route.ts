import { NextResponse } from "next/server";
import * as artifactDB from "@/lib/store/artifact-db";
import type { CreateGeneratedArtifactParams, GeneratedArtifact } from "@/lib/types";
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

function validateCreate(body: Record<string, unknown>): CreateGeneratedArtifactParams | string {
  if (!optionalString(body.workflowId)) return "工作流 ID 无效";
  if (!optionalString(body.nodeId)) return "节点 ID 无效";
  if (!optionalString(body.jobId)) return "任务 ID 无效";
  if (!optionalString(body.assetId)) return "资产 ID 无效";
  if (!optionalString(body.type)) return "产物类型无效";
  if (typeof body.title !== "string" || !body.title.trim()) return "产物标题不能为空";
  if (!optionalString(body.status)) return "产物状态无效";
  if (!optionalString(body.url)) return "产物 URL 无效";
  if (!optionalString(body.prompt)) return "产物 prompt 无效";
  if (!optionalString(body.provider)) return "产物 provider 无效";
  if (!optionalString(body.model)) return "产物模型无效";
  if (!isMetadata(body.metadata)) return "产物 metadata 无效";

  return {
    workflowId: body.workflowId,
    nodeId: body.nodeId,
    jobId: body.jobId,
    assetId: body.assetId,
    type: body.type,
    title: body.title,
    status: body.status,
    url: body.url,
    prompt: body.prompt,
    provider: body.provider,
    model: body.model,
    metadata: body.metadata,
  };
}

function getString(value: unknown, maxLength = 4096): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("data:")) return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pickStringArray(value: unknown, limit = 12): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => getString(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, limit);
  return items.length > 0 ? items : undefined;
}

function summarizeStorage(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  const storage = {
    storage: getString(value.storage),
    publicUrl: getString(value.publicUrl),
    thumbnailUrl: getString(value.thumbnailUrl),
    mimeType: getString(value.mimeType),
    byteSize: getNumber(value.byteSize),
    thumbnailByteSize: getNumber(value.thumbnailByteSize),
  };
  return Object.fromEntries(Object.entries(storage).filter(([, item]) => item !== undefined));
}

function summarizeReferenceImage(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  const image = {
    role: getString(value.role),
    url: getString(value.url),
    title: getString(value.title),
    source: getString(value.source),
    nodeId: getString(value.nodeId),
    assetId: getString(value.assetId),
    providerMode: getString(value.providerMode),
    providerUsable: getBoolean(value.providerUsable),
  };
  const compact = Object.fromEntries(Object.entries(image).filter(([, item]) => item !== undefined));
  return compact.url ? compact : undefined;
}

function summarizeReferenceImages(value: unknown, limit = 12): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const images = value.map(summarizeReferenceImage).filter(Boolean) as Record<string, unknown>[];
  return images.length > 0 ? images.slice(0, limit) : undefined;
}

function summarizeReferenceRoles(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  const roleEntries: Array<[string, unknown]> = [];
  for (const [key, roleValue] of Object.entries(value)) {
    if (!roleValue) continue;
    if (!isPlainObject(roleValue)) {
      roleEntries.push([key, true]);
      continue;
    }
    roleEntries.push([
      key,
      Object.fromEntries(
        Object.entries({
          role: getString(roleValue.role),
          title: getString(roleValue.title),
          sourceNodeIds: pickStringArray(roleValue.sourceNodeIds),
          componentIds: pickStringArray(roleValue.componentIds),
          assetIds: pickStringArray(roleValue.assetIds),
        }).filter(([, item]) => item !== undefined)
      ),
    ]);
  }
  const roles = Object.fromEntries(roleEntries);
  return Object.keys(roles).length > 0 ? roles : undefined;
}

function summarizeReferenceContext(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  const context = {
    version: getString(value.version),
    source: getString(value.source),
    targetNodeId: getString(value.targetNodeId),
    targetNodeLabel: getString(value.targetNodeLabel),
    images: summarizeReferenceImages(value.images),
    roles: summarizeReferenceRoles(value.roles),
    promptFragments: pickStringArray(value.promptFragments),
    constraints: pickStringArray(value.constraints),
    negativeRules: pickStringArray(value.negativeRules),
    qualityRules: pickStringArray(value.qualityRules),
  };
  const compact = Object.fromEntries(Object.entries(context).filter(([, item]) => item !== undefined));
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function summarizeProviderAdapter(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  const adapter = {
    mode: getString(value.mode),
    strategy: getString(value.strategy),
    primaryImage: summarizeReferenceImage(value.primaryImage),
    providerUsableImages: summarizeReferenceImages(value.providerUsableImages),
    promptOnlyImages: summarizeReferenceImages(value.promptOnlyImages),
    warnings: pickStringArray(value.warnings, 8),
  };
  const compact = Object.fromEntries(Object.entries(adapter).filter(([, item]) => item !== undefined));
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function summarizeArtifactMetadataForList(metadata: Record<string, unknown>): Record<string, unknown> {
  const summary = {
    source: getString(metadata.source),
    batchId: getString(metadata.batchId),
    batchIndex: getNumber(metadata.batchIndex),
    batchTotal: getNumber(metadata.batchTotal),
    exportPackId: getString(metadata.exportPackId),
    exportPackTitle: getString(metadata.exportPackTitle),
    exportItemId: getString(metadata.exportItemId),
    exportItemTitle: getString(metadata.exportItemTitle),
    exportSpecId: getString(metadata.exportSpecId),
    exportSpecTitle: getString(metadata.exportSpecTitle),
    platform: getString(metadata.platform),
    size: getString(metadata.size),
    ratio: getString(metadata.ratio),
    naming: getString(metadata.naming),
    useCase: getString(metadata.useCase),
    whiteBackground: getBoolean(metadata.whiteBackground),
    textAllowed: getBoolean(metadata.textAllowed),
    modelRequired: getBoolean(metadata.modelRequired),
    thumbnailUrl: getString(metadata.thumbnailUrl),
    previewUrl: getString(metadata.previewUrl),
    referenceImageUrl: getString(metadata.referenceImageUrl),
    referenceImageUrls: pickStringArray(metadata.referenceImageUrls),
    providerReferenceImageUrls: pickStringArray(metadata.providerReferenceImageUrls),
    providerReferenceCount: getNumber(metadata.providerReferenceCount),
    providerReferenceRole: getString(metadata.providerReferenceRole),
    providerReferenceStrategy: getString(metadata.providerReferenceStrategy),
    usesProviderReference: getBoolean(metadata.usesProviderReference),
    usesProductReference: getBoolean(metadata.usesProductReference),
    provider: getString(metadata.provider),
    model: getString(metadata.model),
    generatedAt: getString(metadata.generatedAt),
    prompt: getString(metadata.prompt),
    finalPrompt: getString(metadata.finalPrompt),
    revisedPrompt: getString(metadata.revisedPrompt),
    qualityRules: pickStringArray(metadata.qualityRules),
    referenceImages: summarizeReferenceImages(metadata.referenceImages),
    referenceContext: summarizeReferenceContext(metadata.referenceContext),
    providerReferenceAdapter: summarizeProviderAdapter(metadata.providerReferenceAdapter),
    promptOnlyReferenceImages: summarizeReferenceImages(metadata.promptOnlyReferenceImages),
    imageStorage: summarizeStorage(metadata.imageStorage),
    resultStorage: summarizeStorage(metadata.resultStorage),
  };
  return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined));
}

function summarizeArtifactForList(artifact: GeneratedArtifact): GeneratedArtifact {
  return {
    ...artifact,
    metadata: summarizeArtifactMetadataForList(artifact.metadata),
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const artifacts = await artifactDB.list({
      workflowId: searchParams.get("workflowId") || undefined,
      nodeId: searchParams.get("nodeId") || undefined,
      jobId: searchParams.get("jobId") || undefined,
      assetId: searchParams.get("assetId") || undefined,
      status: searchParams.get("status") || undefined,
      batchId: searchParams.get("batchId") || undefined,
      exportPackId: searchParams.get("exportPackId") || undefined,
      planId: searchParams.get("planId") || undefined,
    });

    if (searchParams.get("full") === "1") {
      return NextResponse.json(artifacts);
    }

    return NextResponse.json(artifacts.map(summarizeArtifactForList));
  } catch (e) {
    safeLogError("Artifact list failed", e);
    return NextResponse.json({ error: "产物列表读取失败" }, { status: 500 });
  }
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

    const artifact = await artifactDB.add(params);
    return NextResponse.json(artifact, { status: 201 });
  } catch (e) {
    safeLogError("Artifact creation failed", e);
    return NextResponse.json({ error: "产物创建失败，请稍后重试" }, { status: 500 });
  }
}
