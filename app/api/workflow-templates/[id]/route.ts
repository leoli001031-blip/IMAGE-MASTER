import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import * as workflowTemplateDB from "@/lib/store/workflow-template-db";
import { safeLogError } from "@/lib/server/safe-log";
import type {
  UpdateWorkflowTemplateParams,
  WorkflowEdge,
  WorkflowNode,
  WorkflowTemplateCategory,
  WorkflowTemplateStatus,
} from "@/lib/types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isOptionalRecord(value: unknown): value is Record<string, unknown> | undefined {
  return value === undefined || isPlainObject(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
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

async function readBody(req: Request): Promise<Record<string, unknown> | string> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return "请求参数无效";
    return body as Record<string, unknown>;
  } catch {
    return "请求 JSON 无效";
  }
}

function validateUpdate(body: Record<string, unknown>): UpdateWorkflowTemplateParams | string {
  if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim())) {
    return "模板标题不能为空";
  }
  if (
    body.category !== undefined &&
    !workflowTemplateDB.isWorkflowTemplateCategory(body.category)
  ) {
    return "模板分类无效";
  }
  if (
    body.status !== undefined &&
    !workflowTemplateDB.isWorkflowTemplateStatus(body.status)
  ) {
    return "模板状态无效";
  }
  if (body.description !== undefined && typeof body.description !== "string") return "模板描述无效";
  if (body.version !== undefined && !isPositiveInteger(body.version)) return "模板版本无效";
  if (body.nodes !== undefined && (!Array.isArray(body.nodes) || !body.nodes.every(isWorkflowNode))) {
    return "模板节点无效";
  }
  if (body.edges !== undefined && (!Array.isArray(body.edges) || !body.edges.every(isWorkflowEdge))) {
    return "模板连线无效";
  }
  if (!isOptionalRecord(body.metadata)) return "模板 metadata 无效";

  return {
    title: body.title as string | undefined,
    category: body.category as WorkflowTemplateCategory | undefined,
    description: body.description as string | undefined,
    status: body.status as WorkflowTemplateStatus | undefined,
    version: body.version as number | undefined,
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
    return NextResponse.json({ error: "缺少工作流模板 ID" }, { status: 400 });
  }

  try {
    const template = await workflowTemplateDB.get(id);
    if (!template) {
      return NextResponse.json({ error: "工作流模板不存在" }, { status: 404 });
    }

    return NextResponse.json(template);
  } catch (e) {
    safeLogError("Workflow template read failed", e);
    return NextResponse.json({ error: "工作流模板读取失败" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少工作流模板 ID" }, { status: 400 });
  }

  try {
    const body = await readBody(req);
    if (typeof body === "string") {
      return NextResponse.json({ error: body }, { status: 400 });
    }

    const updates = validateUpdate(body);
    if (typeof updates === "string") {
      return NextResponse.json({ error: updates }, { status: 400 });
    }

    const template = await workflowTemplateDB.update(id, updates);
    if (!template) {
      return NextResponse.json({ error: "工作流模板不存在" }, { status: 404 });
    }

    return NextResponse.json(template);
  } catch (e) {
    safeLogError("Workflow template update failed", e);
    return NextResponse.json({ error: "工作流模板更新失败，请稍后重试" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少工作流模板 ID" }, { status: 400 });
  }

  try {
    const deleted = await workflowTemplateDB.remove(id);
    if (!deleted) {
      return NextResponse.json({ error: "工作流模板不存在" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    safeLogError("Workflow template deletion failed", e);
    return NextResponse.json({ error: "工作流模板删除失败，请稍后重试" }, { status: 500 });
  }
}
