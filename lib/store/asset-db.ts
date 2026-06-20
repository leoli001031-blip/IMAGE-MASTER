import type { Asset, AssetType, CreateAssetParams, UpdateAssetParams } from "@/lib/types";
import "server-only";
import db from "./db";
import { prepareMetadataForPersistence } from "./metadata-image-sanitizer";

const ASSET_TYPES = new Set<AssetType>([
  "product",
  "model",
  "style",
  "scene",
  "copy",
  "output",
  "platform",
  "quality",
]);

type AssetRow = Omit<Asset, "metadata"> & {
  metadata: string;
};

type AssetListFilters = {
  type?: AssetType;
  limit?: number;
  updatedAfter?: string;
};

type AssetSummaryRow = Omit<AssetRow, "metadata"> & {
  source: string | null;
  category: string | null;
  componentType: string | null;
  canvasCategory: string | null;
  favorite: number | boolean | null;
  prompt: string | null;
  finalPrompt: string | null;
  revisedPrompt: string | null;
  previewUrl: string | null;
  referenceUrl: string | null;
  thumbnailUrl: string | null;
  productReferenceFocus: string | null;
  batchId: string | null;
  batchIndex: number | null;
  batchTotal: number | null;
  provider: string | null;
  model: string | null;
  generatedAt: string | null;
  tags: string | null;
  promptFragments: string | null;
  constraints: string | null;
  negativeRules: string | null;
  qualityRules: string | null;
  imageStoragePublicUrl: string | null;
  imageStorageThumbnailUrl: string | null;
  imageStorageMimeType: string | null;
  imageStorageByteSize: number | null;
  imageStorageThumbnailByteSize: number | null;
  resultStoragePublicUrl: string | null;
  resultStorageThumbnailUrl: string | null;
  resultStorageMimeType: string | null;
  resultStorageByteSize: number | null;
  resultStorageThumbnailByteSize: number | null;
};

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function serializeMetadata(value: Record<string, unknown> | undefined): string {
  if (!value) return "{}";
  return JSON.stringify(value);
}

function normalizeListFilters(input?: AssetType | AssetListFilters): AssetListFilters {
  if (!input) return {};
  return typeof input === "string" ? { type: input } : input;
}

function buildListQuery(filters: AssetListFilters) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.type) {
    clauses.push("type = ?");
    params.push(filters.type);
  }
  if (filters.updatedAfter) {
    clauses.push("updatedAt > ?");
    params.push(filters.updatedAfter);
  }
  const limit =
    typeof filters.limit === "number" && Number.isFinite(filters.limit) && filters.limit > 0
      ? Math.floor(filters.limit)
      : undefined;
  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
    limitSql: limit ? ` LIMIT ${limit}` : "",
  };
}

function parseJsonArray(value: string | null): unknown[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function setDefined(metadata: Record<string, unknown>, key: string, value: unknown) {
  if (value !== null && value !== undefined && value !== "") {
    metadata[key] = value;
  }
}

function setStorage(
  metadata: Record<string, unknown>,
  key: "imageStorage" | "resultStorage",
  storage: {
    publicUrl: string | null;
    thumbnailUrl: string | null;
    mimeType: string | null;
    byteSize: number | null;
    thumbnailByteSize: number | null;
  }
) {
  const compact: Record<string, unknown> = {};
  setDefined(compact, "publicUrl", storage.publicUrl);
  setDefined(compact, "thumbnailUrl", storage.thumbnailUrl);
  setDefined(compact, "mimeType", storage.mimeType);
  setDefined(compact, "byteSize", storage.byteSize);
  setDefined(compact, "thumbnailByteSize", storage.thumbnailByteSize);
  if (Object.keys(compact).length > 0) metadata[key] = compact;
}

function toAsset(row: AssetRow): Asset {
  return {
    ...row,
    metadata: parseMetadata(row.metadata),
  };
}

function toAssetSummary(row: AssetSummaryRow): Asset {
  const metadata: Record<string, unknown> = {};
  setDefined(metadata, "source", row.source);
  setDefined(metadata, "category", row.category);
  setDefined(metadata, "componentType", row.componentType);
  setDefined(metadata, "canvasCategory", row.canvasCategory);
  setDefined(metadata, "favorite", row.favorite === null ? undefined : Boolean(row.favorite));
  setDefined(metadata, "prompt", row.prompt);
  setDefined(metadata, "finalPrompt", row.finalPrompt);
  setDefined(metadata, "revisedPrompt", row.revisedPrompt);
  setDefined(metadata, "previewUrl", row.previewUrl);
  setDefined(metadata, "referenceUrl", row.referenceUrl);
  setDefined(metadata, "thumbnailUrl", row.thumbnailUrl);
  setDefined(metadata, "productReferenceFocus", row.productReferenceFocus);
  setDefined(metadata, "batchId", row.batchId);
  setDefined(metadata, "batchIndex", row.batchIndex);
  setDefined(metadata, "batchTotal", row.batchTotal);
  setDefined(metadata, "provider", row.provider);
  setDefined(metadata, "model", row.model);
  setDefined(metadata, "generatedAt", row.generatedAt);
  setDefined(metadata, "tags", parseJsonArray(row.tags));
  setDefined(metadata, "promptFragments", parseJsonArray(row.promptFragments));
  setDefined(metadata, "constraints", parseJsonArray(row.constraints));
  setDefined(metadata, "negativeRules", parseJsonArray(row.negativeRules));
  setDefined(metadata, "qualityRules", parseJsonArray(row.qualityRules));
  setStorage(metadata, "imageStorage", {
    publicUrl: row.imageStoragePublicUrl,
    thumbnailUrl: row.imageStorageThumbnailUrl,
    mimeType: row.imageStorageMimeType,
    byteSize: row.imageStorageByteSize,
    thumbnailByteSize: row.imageStorageThumbnailByteSize,
  });
  setStorage(metadata, "resultStorage", {
    publicUrl: row.resultStoragePublicUrl,
    thumbnailUrl: row.resultStorageThumbnailUrl,
    mimeType: row.resultStorageMimeType,
    byteSize: row.resultStorageByteSize,
    thumbnailByteSize: row.resultStorageThumbnailByteSize,
  });

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    status: row.status,
    url: row.url,
    metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function isAssetType(value: unknown): value is AssetType {
  return typeof value === "string" && ASSET_TYPES.has(value as AssetType);
}

export async function list(input?: AssetType | AssetListFilters): Promise<Asset[]> {
  const query = buildListQuery(normalizeListFilters(input));
  const rows = db
    .prepare(`SELECT * FROM assets ${query.where} ORDER BY createdAt DESC${query.limitSql}`)
    .all(...query.params);

  return (rows as AssetRow[]).map(toAsset);
}

export async function listSummaries(input?: AssetType | AssetListFilters): Promise<Asset[]> {
  const query = buildListQuery(normalizeListFilters(input));
  const rows = db
    .prepare(
      `SELECT
        id,
        type,
        title,
        description,
        status,
        url,
        createdAt,
        updatedAt,
        json_extract(metadata, '$.source') AS source,
        json_extract(metadata, '$.category') AS category,
        json_extract(metadata, '$.componentType') AS componentType,
        json_extract(metadata, '$.canvasCategory') AS canvasCategory,
        json_extract(metadata, '$.favorite') AS favorite,
        json_extract(metadata, '$.prompt') AS prompt,
        json_extract(metadata, '$.finalPrompt') AS finalPrompt,
        json_extract(metadata, '$.revisedPrompt') AS revisedPrompt,
        json_extract(metadata, '$.previewUrl') AS previewUrl,
        json_extract(metadata, '$.referenceUrl') AS referenceUrl,
        json_extract(metadata, '$.thumbnailUrl') AS thumbnailUrl,
        json_extract(metadata, '$.productReferenceFocus') AS productReferenceFocus,
        json_extract(metadata, '$.batchId') AS batchId,
        json_extract(metadata, '$.batchIndex') AS batchIndex,
        json_extract(metadata, '$.batchTotal') AS batchTotal,
        json_extract(metadata, '$.provider') AS provider,
        json_extract(metadata, '$.model') AS model,
        json_extract(metadata, '$.generatedAt') AS generatedAt,
        json_extract(metadata, '$.tags') AS tags,
        json_extract(metadata, '$.promptFragments') AS promptFragments,
        json_extract(metadata, '$.constraints') AS constraints,
        json_extract(metadata, '$.negativeRules') AS negativeRules,
        json_extract(metadata, '$.qualityRules') AS qualityRules,
        json_extract(metadata, '$.imageStorage.publicUrl') AS imageStoragePublicUrl,
        json_extract(metadata, '$.imageStorage.thumbnailUrl') AS imageStorageThumbnailUrl,
        json_extract(metadata, '$.imageStorage.mimeType') AS imageStorageMimeType,
        json_extract(metadata, '$.imageStorage.byteSize') AS imageStorageByteSize,
        json_extract(metadata, '$.imageStorage.thumbnailByteSize') AS imageStorageThumbnailByteSize,
        json_extract(metadata, '$.resultStorage.publicUrl') AS resultStoragePublicUrl,
        json_extract(metadata, '$.resultStorage.thumbnailUrl') AS resultStorageThumbnailUrl,
        json_extract(metadata, '$.resultStorage.mimeType') AS resultStorageMimeType,
        json_extract(metadata, '$.resultStorage.byteSize') AS resultStorageByteSize,
        json_extract(metadata, '$.resultStorage.thumbnailByteSize') AS resultStorageThumbnailByteSize
       FROM assets ${query.where}
       ORDER BY createdAt DESC${query.limitSql}`
    )
    .all(...query.params);

  return (rows as AssetSummaryRow[]).map(toAssetSummary);
}

export async function get(id: string): Promise<Asset | undefined> {
  const row = db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as AssetRow | undefined;
  return row ? toAsset(row) : undefined;
}

export async function add(params: CreateAssetParams): Promise<Asset> {
  const now = new Date().toISOString();
  const id = `asset_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const metadata = await prepareMetadataForPersistence(params.metadata || {}, id);
  const asset: Asset = {
    id,
    type: params.type,
    title: params.title.trim(),
    description: params.description?.trim() || "",
    status: params.status?.trim() || "ready",
    url: params.url?.trim() || "",
    metadata,
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(
    `INSERT INTO assets (id, type, title, description, status, url, metadata, createdAt, updatedAt)
     VALUES (@id, @type, @title, @description, @status, @url, @metadata, @createdAt, @updatedAt)`
  ).run({
    ...asset,
    metadata: serializeMetadata(asset.metadata),
  });

  return asset;
}

export async function update(id: string, updates: UpdateAssetParams): Promise<Asset | null> {
  const existing = await get(id);
  if (!existing) return null;

  const metadata = updates.metadata
    ? await prepareMetadataForPersistence(updates.metadata, id)
    : existing.metadata;
  const merged: Asset = {
    ...existing,
    type: updates.type ?? existing.type,
    title: updates.title !== undefined ? updates.title.trim() : existing.title,
    description: updates.description !== undefined ? updates.description.trim() : existing.description,
    status: updates.status !== undefined ? updates.status.trim() : existing.status,
    url: updates.url !== undefined ? updates.url.trim() : existing.url,
    metadata,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(
    `UPDATE assets
     SET type=@type, title=@title, description=@description, status=@status,
       url=@url, metadata=@metadata, updatedAt=@updatedAt
     WHERE id=@id`
  ).run({
    ...merged,
    metadata: serializeMetadata(merged.metadata),
  });

  return merged;
}

export async function remove(id: string): Promise<boolean> {
  const result = db.prepare("DELETE FROM assets WHERE id = ?").run(id);
  return result.changes > 0;
}
