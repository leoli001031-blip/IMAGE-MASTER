import { NextResponse } from "next/server";
import * as componentDB from "@/lib/store/component-db";
import {
  normalizeComponentMetadata,
  normalizeComponentRules,
  normalizeComponentType,
} from "@/lib/canvas/component-schema";
import type { ComponentType, CreateComponentParams } from "@/lib/types";
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

function validateCreate(body: Record<string, unknown>): CreateComponentParams | string {
  const type = normalizeComponentType(body.type);
  if (!type) return "组件类型无效";
  if (typeof body.title !== "string" || !body.title.trim()) return "组件标题不能为空";
  if (body.description !== undefined && typeof body.description !== "string") return "组件描述无效";
  if (body.status !== undefined && typeof body.status !== "string") return "组件状态无效";
  if (body.version !== undefined && !isPositiveInteger(body.version)) return "组件版本无效";
  if (body.assetId !== undefined && typeof body.assetId !== "string") return "组件资产 ID 无效";
  if (!isPlainRecord(body.rules)) return "组件 rules 无效";
  if (!isPlainRecord(body.metadata)) return "组件 metadata 无效";

  return {
    type,
    title: body.title,
    description: body.description as string | undefined,
    status: body.status as string | undefined,
    version: body.version as number | undefined,
    assetId: body.assetId as string | undefined,
    rules: normalizeComponentRules(body.rules as Record<string, unknown> | undefined),
    metadata: normalizeComponentMetadata(type, body.metadata as Record<string, unknown> | undefined),
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");

    if (type && !componentDB.isComponentType(type)) {
      return NextResponse.json({ error: "组件类型无效" }, { status: 400 });
    }

    const componentType = type ? (type as ComponentType) : undefined;
    const components = await componentDB.list(componentType);
    return NextResponse.json(components);
  } catch (e) {
    safeLogError("Component list failed", e);
    return NextResponse.json({ error: "组件列表读取失败" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    if (typeof body === "string") {
      return NextResponse.json({ error: body }, { status: 400 });
    }

    const params = validateCreate(body);
    if (typeof params === "string") {
      return NextResponse.json({ error: params }, { status: 400 });
    }

    const component = await componentDB.add(params);
    return NextResponse.json(component, { status: 201 });
  } catch (e) {
    safeLogError("Component creation failed", e);
    return NextResponse.json({ error: "组件创建失败，请稍后重试" }, { status: 500 });
  }
}
