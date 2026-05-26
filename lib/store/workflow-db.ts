import type {
  CreateWorkflowParams,
  UpdateWorkflowParams,
  Workflow,
  WorkflowEdge,
  WorkflowNode,
} from "@/lib/types";
import "server-only";
import db from "./db";

type WorkflowRow = Omit<Workflow, "nodes" | "edges" | "metadata"> & {
  nodes: string;
  edges: string;
  metadata: string;
};

function parseArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toWorkflow(row: WorkflowRow): Workflow {
  return {
    ...row,
    nodes: parseArray<WorkflowNode>(row.nodes),
    edges: parseArray<WorkflowEdge>(row.edges),
    metadata: parseMetadata(row.metadata),
  };
}

export async function list(): Promise<Workflow[]> {
  const rows = db.prepare("SELECT * FROM workflows ORDER BY updatedAt DESC").all();
  return (rows as WorkflowRow[]).map(toWorkflow);
}

export async function get(id: string): Promise<Workflow | undefined> {
  const row = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as WorkflowRow | undefined;
  return row ? toWorkflow(row) : undefined;
}

export async function add(params: CreateWorkflowParams): Promise<Workflow> {
  const now = new Date().toISOString();
  const workflow: Workflow = {
    id: `workflow_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    title: params.title.trim(),
    description: params.description?.trim() || "",
    nodes: params.nodes || [],
    edges: params.edges || [],
    metadata: params.metadata || {},
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(
    `INSERT INTO workflows (id, title, description, nodes, edges, metadata, createdAt, updatedAt)
     VALUES (@id, @title, @description, @nodes, @edges, @metadata, @createdAt, @updatedAt)`
  ).run({
    ...workflow,
    nodes: JSON.stringify(workflow.nodes),
    edges: JSON.stringify(workflow.edges),
    metadata: JSON.stringify(workflow.metadata),
  });

  return workflow;
}

export async function update(id: string, updates: UpdateWorkflowParams): Promise<Workflow | null> {
  const existing = await get(id);
  if (!existing) return null;

  const merged: Workflow = {
    ...existing,
    title: updates.title !== undefined ? updates.title.trim() : existing.title,
    description: updates.description !== undefined ? updates.description.trim() : existing.description,
    nodes: updates.nodes ?? existing.nodes,
    edges: updates.edges ?? existing.edges,
    metadata: updates.metadata ?? existing.metadata,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(
    `UPDATE workflows
     SET title=@title, description=@description, nodes=@nodes, edges=@edges,
       metadata=@metadata, updatedAt=@updatedAt
     WHERE id=@id`
  ).run({
    ...merged,
    nodes: JSON.stringify(merged.nodes),
    edges: JSON.stringify(merged.edges),
    metadata: JSON.stringify(merged.metadata),
  });

  return merged;
}

export async function remove(id: string): Promise<boolean> {
  const result = db.prepare("DELETE FROM workflows WHERE id = ?").run(id);
  return result.changes > 0;
}
