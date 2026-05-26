import type { Asset, AssetType, CreateAssetParams, UpdateAssetParams } from "@/lib/types";
import "server-only";
import db from "./db";

const ASSET_TYPES = new Set<AssetType>([
  "product",
  "model",
  "style",
  "scene",
  "output",
  "platform",
  "quality",
]);

type AssetRow = Omit<Asset, "metadata"> & {
  metadata: string;
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

function toAsset(row: AssetRow): Asset {
  return {
    ...row,
    metadata: parseMetadata(row.metadata),
  };
}

export function isAssetType(value: unknown): value is AssetType {
  return typeof value === "string" && ASSET_TYPES.has(value as AssetType);
}

export async function list(type?: AssetType): Promise<Asset[]> {
  const rows = type
    ? db.prepare("SELECT * FROM assets WHERE type = ? ORDER BY createdAt DESC").all(type)
    : db.prepare("SELECT * FROM assets ORDER BY createdAt DESC").all();

  return (rows as AssetRow[]).map(toAsset);
}

export async function get(id: string): Promise<Asset | undefined> {
  const row = db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as AssetRow | undefined;
  return row ? toAsset(row) : undefined;
}

export async function add(params: CreateAssetParams): Promise<Asset> {
  const now = new Date().toISOString();
  const asset: Asset = {
    id: `asset_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    type: params.type,
    title: params.title.trim(),
    description: params.description?.trim() || "",
    status: params.status?.trim() || "ready",
    url: params.url?.trim() || "",
    metadata: params.metadata || {},
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

  const merged: Asset = {
    ...existing,
    type: updates.type ?? existing.type,
    title: updates.title !== undefined ? updates.title.trim() : existing.title,
    description: updates.description !== undefined ? updates.description.trim() : existing.description,
    status: updates.status !== undefined ? updates.status.trim() : existing.status,
    url: updates.url !== undefined ? updates.url.trim() : existing.url,
    metadata: updates.metadata ?? existing.metadata,
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
