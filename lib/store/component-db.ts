import type {
  Component,
  ComponentType,
  CreateComponentParams,
  UpdateComponentParams,
} from "@/lib/types";
import {
  componentTypeQueryValues,
  isComponentType as isKnownComponentType,
  normalizeComponentMetadata,
  normalizeComponentRules,
  normalizeComponentType,
} from "@/lib/canvas/component-schema";
import "server-only";
import db from "./db";

type ComponentRow = Omit<Component, "rules" | "metadata"> & {
  rules: string;
  metadata: string;
};

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function serializeRecord(value: Record<string, unknown> | undefined): string {
  if (!value) return "{}";
  return JSON.stringify(value);
}

function toComponent(row: ComponentRow): Component {
  const metadata = parseRecord(row.metadata);

  return {
    ...row,
    rules: parseRecord(row.rules),
    metadata: normalizeComponentMetadata(row.type, metadata),
  };
}

function writeVersionSnapshot(component: Component): void {
  db.prepare(
    `INSERT OR REPLACE INTO component_versions (componentId, version, snapshot, createdAt)
     VALUES (@componentId, @version, @snapshot, @createdAt)`
  ).run({
    componentId: component.id,
    version: component.version,
    snapshot: JSON.stringify(component),
    createdAt: component.updatedAt,
  });
}

export function isComponentType(value: unknown): value is ComponentType {
  return isKnownComponentType(value);
}

export async function list(type?: ComponentType): Promise<Component[]> {
  const rows = type
    ? listByComponentType(type)
    : db.prepare("SELECT * FROM components ORDER BY updatedAt DESC").all();

  return (rows as ComponentRow[]).map(toComponent);
}

function listByComponentType(type: ComponentType): unknown[] {
  const queryValues = componentTypeQueryValues(type);
  const placeholders = queryValues.map(() => "?").join(", ");
  return db
    .prepare(`SELECT * FROM components WHERE type IN (${placeholders}) ORDER BY updatedAt DESC`)
    .all(...queryValues);
}

export async function get(id: string): Promise<Component | undefined> {
  const row = db.prepare("SELECT * FROM components WHERE id = ?").get(id) as ComponentRow | undefined;
  return row ? toComponent(row) : undefined;
}

export async function add(params: CreateComponentParams): Promise<Component> {
  const now = new Date().toISOString();
  const type = normalizeComponentType(params.type) ?? params.type;
  const component: Component = {
    id: `component_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    type,
    title: params.title.trim(),
    description: params.description?.trim() || "",
    status: params.status?.trim() || "draft",
    version: params.version ?? 1,
    assetId: params.assetId?.trim() || "",
    rules: normalizeComponentRules(params.rules),
    metadata: normalizeComponentMetadata(type, params.metadata),
    createdAt: now,
    updatedAt: now,
  };

  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO components (
        id, type, title, description, status, version, assetId, rules, metadata, createdAt, updatedAt
      )
       VALUES (
        @id, @type, @title, @description, @status, @version, @assetId, @rules, @metadata,
        @createdAt, @updatedAt
      )`
    ).run({
      ...component,
      rules: serializeRecord(component.rules),
      metadata: serializeRecord(component.metadata),
    });

    writeVersionSnapshot(component);
  });

  insert();
  return component;
}

export async function update(id: string, updates: UpdateComponentParams): Promise<Component | null> {
  const existing = await get(id);
  if (!existing) return null;
  const type = updates.type !== undefined ? normalizeComponentType(updates.type) ?? updates.type : existing.type;

  const merged: Component = {
    ...existing,
    type,
    title: updates.title !== undefined ? updates.title.trim() : existing.title,
    description: updates.description !== undefined ? updates.description.trim() : existing.description,
    status: updates.status !== undefined ? updates.status.trim() : existing.status,
    version: updates.version ?? existing.version + 1,
    assetId: updates.assetId !== undefined ? updates.assetId.trim() : existing.assetId,
    rules: normalizeComponentRules(updates.rules ?? existing.rules),
    metadata: normalizeComponentMetadata(type, updates.metadata ?? existing.metadata),
    updatedAt: new Date().toISOString(),
  };

  const updateComponent = db.transaction(() => {
    db.prepare(
      `UPDATE components
       SET type=@type, title=@title, description=@description, status=@status, version=@version,
         assetId=@assetId, rules=@rules, metadata=@metadata, updatedAt=@updatedAt
       WHERE id=@id`
    ).run({
      ...merged,
      rules: serializeRecord(merged.rules),
      metadata: serializeRecord(merged.metadata),
    });

    writeVersionSnapshot(merged);
  });

  updateComponent();
  return merged;
}

export async function remove(id: string): Promise<boolean> {
  const deleted = db.transaction(() => {
    db.prepare("DELETE FROM component_versions WHERE componentId = ?").run(id);
    const result = db.prepare("DELETE FROM components WHERE id = ?").run(id);
    return result.changes > 0;
  });

  return deleted();
}
