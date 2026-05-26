import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import * as componentDB from "@/lib/store/component-db";
import {
  normalizeComponentMetadata,
  normalizeComponentRules,
  normalizeComponentType,
} from "@/lib/canvas/component-schema";
import type { UpdateComponentParams } from "@/lib/types";
import { safeLogError } from "@/lib/server/safe-log";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value === undefined || (!!value && typeof value === "object" && !Array.isArray(value));
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
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

function validateUpdate(body: Record<string, unknown>): UpdateComponentParams | string {
  const type = body.type !== undefined ? normalizeComponentType(body.type) : undefined;
  if (body.type !== undefined && !type) return "组件类型无效";
  if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim())) {
    return "组件标题不能为空";
  }
  if (body.description !== undefined && typeof body.description !== "string") return "组件描述无效";
  if (body.status !== undefined && typeof body.status !== "string") return "组件状态无效";
  if (body.version !== undefined && !isPositiveInteger(body.version)) return "组件版本无效";
  if (body.assetId !== undefined && typeof body.assetId !== "string") return "组件资产 ID 无效";
  if (!isPlainRecord(body.rules)) return "组件 rules 无效";
  if (!isPlainRecord(body.metadata)) return "组件 metadata 无效";

  return {
    type,
    title: body.title as string | undefined,
    description: body.description as string | undefined,
    status: body.status as string | undefined,
    version: body.version as number | undefined,
    assetId: body.assetId as string | undefined,
    rules:
      body.rules !== undefined
        ? normalizeComponentRules(body.rules as Record<string, unknown> | undefined)
        : undefined,
    metadata:
      body.metadata !== undefined && type
        ? normalizeComponentMetadata(type, body.metadata as Record<string, unknown> | undefined)
        : (body.metadata as Record<string, unknown> | undefined),
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少组件 ID" }, { status: 400 });
  }

  try {
    const component = await componentDB.get(id);
    if (!component) {
      return NextResponse.json({ error: "组件不存在" }, { status: 404 });
    }

    return NextResponse.json(component);
  } catch (e) {
    safeLogError("Component read failed", e);
    return NextResponse.json({ error: "组件读取失败" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少组件 ID" }, { status: 400 });
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

    const component = await componentDB.update(id, updates);
    if (!component) {
      return NextResponse.json({ error: "组件不存在" }, { status: 404 });
    }

    return NextResponse.json(component);
  } catch (e) {
    safeLogError("Component update failed", e);
    return NextResponse.json({ error: "组件更新失败，请稍后重试" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少组件 ID" }, { status: 400 });
  }

  try {
    const deleted = await componentDB.remove(id);
    if (!deleted) {
      return NextResponse.json({ error: "组件不存在" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    safeLogError("Component deletion failed", e);
    return NextResponse.json({ error: "组件删除失败，请稍后重试" }, { status: 500 });
  }
}
