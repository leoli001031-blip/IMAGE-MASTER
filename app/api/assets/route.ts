import { NextResponse } from "next/server";
import { buildAutoAssetName } from "@/lib/canvas/asset-auto-naming";
import * as assetDB from "@/lib/store/asset-db";
import type { Asset, AssetType, CreateAssetParams } from "@/lib/types";
import { safeLogError } from "@/lib/server/safe-log";

function isPlainMetadata(value: unknown): value is Record<string, unknown> {
  return value === undefined || (!!value && typeof value === "object" && !Array.isArray(value));
}

function validateCreate(body: Record<string, unknown>): CreateAssetParams | string {
  const normalizedType = body.type === "output_reference" ? "output" : body.type;
  if (!assetDB.isAssetType(normalizedType)) return "资产类型无效";
  if (body.description !== undefined && typeof body.description !== "string") return "资产描述无效";
  if (body.status !== undefined && typeof body.status !== "string") return "资产状态无效";
  if (body.url !== undefined && typeof body.url !== "string") return "资产 URL 无效";
  if (!isPlainMetadata(body.metadata)) return "资产 metadata 无效";

  const metadata = body.metadata as Record<string, unknown> | undefined;
  const description = body.description as string | undefined;
  const status = body.status as string | undefined;
  const url = body.url as string | undefined;
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : buildAutoAssetName({
          category: normalizedType,
          userRequest: description,
          fallbackTitle: typeof body.title === "string" ? body.title : undefined,
          metadata,
        }).title;

  return {
    type: normalizedType,
    title,
    description,
    status,
    url,
    metadata,
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
  if (!value || !isPlainMetadata(value)) return undefined;
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
  if (!value || !isPlainMetadata(value)) return undefined;
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

function summarizeAssetMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const summary = {
    source: getString(metadata.source),
    category: getString(metadata.category),
    componentType: getString(metadata.componentType),
    canvasCategory: getString(metadata.canvasCategory),
    favorite: getBoolean(metadata.favorite),
    prompt: getString(metadata.prompt),
    finalPrompt: getString(metadata.finalPrompt),
    revisedPrompt: getString(metadata.revisedPrompt),
    promptFragments: pickStringArray(metadata.promptFragments),
    constraints: pickStringArray(metadata.constraints),
    negativeRules: pickStringArray(metadata.negativeRules),
    qualityRules: pickStringArray(metadata.qualityRules),
    tags: pickStringArray(metadata.tags),
    previewUrl: getString(metadata.previewUrl),
    referenceUrl: getString(metadata.referenceUrl),
    thumbnailUrl: getString(metadata.thumbnailUrl),
    imageStorage: summarizeStorage(metadata.imageStorage),
    resultStorage: summarizeStorage(metadata.resultStorage),
    referenceImages: summarizeReferenceImages(metadata.referenceImages),
    promptOnlyReferenceImages: summarizeReferenceImages(metadata.promptOnlyReferenceImages),
    batchId: getString(metadata.batchId),
    batchIndex: getNumber(metadata.batchIndex),
    batchTotal: getNumber(metadata.batchTotal),
    provider: getString(metadata.provider),
    model: getString(metadata.model),
    generatedAt: getString(metadata.generatedAt),
  };
  return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined));
}

function summarizeAssetForList(asset: Asset): Asset {
  return {
    ...asset,
    url: getString(asset.url) ?? "",
    metadata: summarizeAssetMetadata(asset.metadata),
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");

    if (type && !assetDB.isAssetType(type)) {
      return NextResponse.json({ error: "资产类型无效" }, { status: 400 });
    }

    const assetType = type ? (type as AssetType) : undefined;
    const assets = await assetDB.list(assetType);
    if (searchParams.get("full") === "1") {
      return NextResponse.json(assets);
    }
    return NextResponse.json(assets.map(summarizeAssetForList));
  } catch (e) {
    safeLogError("Asset list failed", e);
    return NextResponse.json({ error: "资产列表读取失败" }, { status: 500 });
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

    const asset = await assetDB.add(params);
    return NextResponse.json(asset, { status: 201 });
  } catch (e) {
    safeLogError("Asset creation failed", e);
    return NextResponse.json({ error: "资产创建失败，请稍后重试" }, { status: 500 });
  }
}
