import { NextResponse } from "next/server";
import * as workflowDB from "@/lib/store/workflow-db";
import type { CreateWorkflowParams, WorkflowEdge, WorkflowNode } from "@/lib/types";
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

function validateCreate(body: Record<string, unknown>): CreateWorkflowParams | string {
  if (typeof body.title !== "string" || !body.title.trim()) return "工作流标题不能为空";
  if (body.description !== undefined && typeof body.description !== "string") return "工作流描述无效";
  if (body.nodes !== undefined && (!Array.isArray(body.nodes) || !body.nodes.every(isWorkflowNode))) {
    return "工作流节点无效";
  }
  if (body.edges !== undefined && (!Array.isArray(body.edges) || !body.edges.every(isWorkflowEdge))) {
    return "工作流连线无效";
  }
  if (!isMetadata(body.metadata)) return "工作流 metadata 无效";

  return {
    title: body.title,
    description: body.description as string | undefined,
    nodes: body.nodes as WorkflowNode[] | undefined,
    edges: body.edges as WorkflowEdge[] | undefined,
    metadata: body.metadata as Record<string, unknown> | undefined,
  };
}

export async function GET() {
  try {
    const workflows = await workflowDB.list();
    return NextResponse.json(workflows);
  } catch (e) {
    safeLogError("Workflow list failed", e);
    return NextResponse.json({ error: "工作流列表读取失败" }, { status: 500 });
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

    const workflow = await workflowDB.add(params);
    return NextResponse.json(workflow, { status: 201 });
  } catch (e) {
    safeLogError("Workflow creation failed", e);
    return NextResponse.json({ error: "工作流创建失败，请稍后重试" }, { status: 500 });
  }
}
