import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import * as workflowDB from "@/lib/store/workflow-db";
import type { UpdateWorkflowParams, WorkflowEdge, WorkflowNode } from "@/lib/types";
import { safeLogError } from "@/lib/server/safe-log";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isMetadata(value: unknown): value is Record<string, unknown> {
  return value === undefined || isPlainObject(value);
}

function isWorkflowNode(value: unknown): value is WorkflowNode {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== "string" || !value.id.trim()) return false;
  if (value.type !== undefined && typeof value.type !== "string") return false;
  if (value.title !== undefined && typeof value.title !== "string") return false;
  if (value.caption !== undefined && typeof value.caption !== "string") return false;
  if (value.status !== undefined && typeof value.status !== "string") return false;
  if (!isPlainObject(value.position)) return false;
  if (typeof value.position.x !== "number" || typeof value.position.y !== "number") return false;
  if (!isPlainObject(value.data)) return false;
  if (value.assetId !== undefined && typeof value.assetId !== "string") return false;
  return true;
}

function isWorkflowEdge(value: unknown): value is WorkflowEdge {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== "string" || !value.id.trim()) return false;
  if (typeof value.source !== "string" || !value.source.trim()) return false;
  if (typeof value.target !== "string" || !value.target.trim()) return false;
  if (value.label !== undefined && typeof value.label !== "string") return false;
  if (value.animated !== undefined && typeof value.animated !== "boolean") return false;
  return true;
}

function validateUpdate(body: Record<string, unknown>): UpdateWorkflowParams | string {
  if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim())) {
    return "工作流标题不能为空";
  }
  if (body.description !== undefined && typeof body.description !== "string") return "工作流描述无效";
  if (body.nodes !== undefined && (!Array.isArray(body.nodes) || !body.nodes.every(isWorkflowNode))) {
    return "工作流节点无效";
  }
  if (body.edges !== undefined && (!Array.isArray(body.edges) || !body.edges.every(isWorkflowEdge))) {
    return "工作流连线无效";
  }
  if (!isMetadata(body.metadata)) return "工作流 metadata 无效";

  return {
    title: body.title as string | undefined,
    description: body.description as string | undefined,
    nodes: body.nodes as WorkflowNode[] | undefined,
    edges: body.edges as WorkflowEdge[] | undefined,
    metadata: body.metadata as Record<string, unknown> | undefined,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少工作流 ID" }, { status: 400 });
  }

  try {
    const workflow = await workflowDB.get(id);
    if (!workflow) {
      return NextResponse.json({ error: "工作流不存在" }, { status: 404 });
    }

    return NextResponse.json(workflow);
  } catch (e) {
    safeLogError("Workflow read failed", e);
    return NextResponse.json({ error: "工作流读取失败" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少工作流 ID" }, { status: 400 });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "请求参数无效" }, { status: 400 });
    }

    const updates = validateUpdate(body as Record<string, unknown>);
    if (typeof updates === "string") {
      return NextResponse.json({ error: updates }, { status: 400 });
    }

    const workflow = await workflowDB.update(id, updates);
    if (!workflow) {
      return NextResponse.json({ error: "工作流不存在" }, { status: 404 });
    }

    return NextResponse.json(workflow);
  } catch (e) {
    safeLogError("Workflow update failed", e);
    return NextResponse.json({ error: "工作流更新失败，请稍后重试" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少工作流 ID" }, { status: 400 });
  }

  try {
    const deleted = await workflowDB.remove(id);
    if (!deleted) {
      return NextResponse.json({ error: "工作流不存在" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    safeLogError("Workflow deletion failed", e);
    return NextResponse.json({ error: "工作流删除失败，请稍后重试" }, { status: 500 });
  }
}
