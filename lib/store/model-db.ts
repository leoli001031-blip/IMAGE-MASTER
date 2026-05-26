import type { AIModel } from "@/lib/types";
import "server-only";
import db from "./db";

// SQLite-backed model store. better-sqlite3 is synchronous — safe for
// concurrent access without mutex locks in a single-process Node.js server.

type ModelRow = Omit<AIModel, "metadata"> & {
  metadata?: string;
};

function parseMetadata(value: string | undefined): AIModel["metadata"] | undefined {
  if (!value?.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as AIModel["metadata"])
      : undefined;
  } catch {
    return undefined;
  }
}

function serializeMetadata(value: AIModel["metadata"] | undefined): string {
  return value ? JSON.stringify(value) : "{}";
}

function getSourceParamString(metadata: AIModel["metadata"] | undefined, key: "hairStyle" | "makeup"): string | undefined {
  const value = metadata?.sourceParams?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toModel(row: ModelRow): AIModel {
  const metadata = parseMetadata(row.metadata);
  return {
    ...row,
    metadata,
    hairStyle: getSourceParamString(metadata, "hairStyle"),
    makeup: getSourceParamString(metadata, "makeup"),
    updatedAt: row.updatedAt || row.createdAt,
  };
}

function toDbModel(model: AIModel): Record<string, unknown> {
  return {
    ...model,
    metadata: serializeMetadata(model.metadata),
    updatedAt: model.updatedAt || model.createdAt,
  };
}

export async function getAll(): Promise<AIModel[]> {
  const rows = db.prepare("SELECT * FROM models ORDER BY createdAt DESC").all() as ModelRow[];
  return rows.map(toModel);
}

export async function add(model: AIModel): Promise<void> {
  db.prepare(
    `INSERT INTO models (
       id, gender, ethnicity, age, temperament, bodyType, imageUrl, promptSnapshot, metadata, createdAt, updatedAt
     )
     VALUES (
       @id, @gender, @ethnicity, @age, @temperament, @bodyType, @imageUrl, @promptSnapshot,
       @metadata, @createdAt, @updatedAt
     )`
  ).run(toDbModel(model));
}

export async function remove(id: string): Promise<boolean> {
  const result = db.prepare("DELETE FROM models WHERE id = ?").run(id);
  return result.changes > 0;
}

export async function getById(id: string): Promise<AIModel | undefined> {
  const row = db.prepare("SELECT * FROM models WHERE id = ?").get(id) as ModelRow | undefined;
  return row ? toModel(row) : undefined;
}

export async function update(id: string, updates: Partial<AIModel>): Promise<AIModel | null> {
  const existing = await getById(id);
  if (!existing) return null;

  const merged: AIModel = {
    ...existing,
    ...updates,
    metadata: updates.metadata ?? existing.metadata,
    updatedAt: new Date().toISOString(),
  };
  db.prepare(
    `UPDATE models SET gender=@gender, ethnicity=@ethnicity, age=@age, temperament=@temperament,
     bodyType=@bodyType, imageUrl=@imageUrl, promptSnapshot=@promptSnapshot,
     metadata=@metadata, updatedAt=@updatedAt WHERE id=@id`
  ).run(toDbModel(merged));

  return merged;
}
