import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import * as assetDB from "@/lib/store/asset-db";
import type { UpdateAssetParams } from "@/lib/types";
import { safeLogError } from "@/lib/server/safe-log";

function isPlainMetadata(value: unknown): value is Record<string, unknown> {
  return value === undefined || (!!value && typeof value === "object" && !Array.isArray(value));
}

function validateUpdate(body: Record<string, unknown>): UpdateAssetParams | string {
  if (body.type !== undefined && !assetDB.isAssetType(body.type)) return "资产类型无效";
  if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim())) {
    return "资产标题不能为空";
  }
  if (body.description !== undefined && typeof body.description !== "string") return "资产描述无效";
  if (body.status !== undefined && typeof body.status !== "string") return "资产状态无效";
  if (body.url !== undefined && typeof body.url !== "string") return "资产 URL 无效";
  if (!isPlainMetadata(body.metadata)) return "资产 metadata 无效";

  return {
    type: body.type as UpdateAssetParams["type"],
    title: body.title as string | undefined,
    description: body.description as string | undefined,
    status: body.status as string | undefined,
    url: body.url as string | undefined,
    metadata: body.metadata as Record<string, unknown> | undefined,
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少资产 ID" }, { status: 400 });
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

    const asset = await assetDB.update(id, updates);
    if (!asset) {
      return NextResponse.json({ error: "资产不存在" }, { status: 404 });
    }

    return NextResponse.json(asset);
  } catch (e) {
    safeLogError("Asset update failed", e);
    return NextResponse.json({ error: "资产更新失败，请稍后重试" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少资产 ID" }, { status: 400 });
  }

  try {
    const deleted = await assetDB.remove(id);
    if (!deleted) {
      return NextResponse.json({ error: "资产不存在" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    safeLogError("Asset deletion failed", e);
    return NextResponse.json({ error: "资产删除失败，请稍后重试" }, { status: 500 });
  }
}
