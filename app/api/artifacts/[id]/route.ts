import { NextResponse, type NextRequest } from "next/server";
import * as artifactDB from "@/lib/store/artifact-db";
import type { UpdateGeneratedArtifactParams } from "@/lib/types";
import { safeLogError } from "@/lib/server/safe-log";
import { sanitizePayloadForJson } from "@/lib/store/metadata-image-sanitizer";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isMetadata(value: unknown): value is Record<string, unknown> {
  return value === undefined || isPlainObject(value);
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

const artifactReviewStatusLabels: Record<string, string> = {
  approved: "可用",
  pending: "待检查",
  needs_redo: "建议重做",
  rejected: "已淘汰",
  failed: "生成失败",
};

function normalizeReviewStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const status = value.trim();
  return artifactReviewStatusLabels[status] ? status : null;
}

function normalizeReviewStatePatch(value: unknown): Record<string, unknown> | string | null {
  if (value === undefined) return null;
  if (!isPlainObject(value)) return "审核状态无效";
  const status = normalizeReviewStatus(value.status);
  if (!status) return "审核状态无效";
  return {
    status,
    label: artifactReviewStatusLabels[status],
    note: typeof value.note === "string" ? value.note.trim().slice(0, 500) : "",
    source: typeof value.source === "string" ? value.source.trim().slice(0, 80) : "canvas-review",
    updatedAt: new Date().toISOString(),
  };
}

function validateUpdate(body: Record<string, unknown>): UpdateGeneratedArtifactParams | string {
  if (!optionalString(body.workflowId)) return "工作流 ID 无效";
  if (!optionalString(body.nodeId)) return "节点 ID 无效";
  if (!optionalString(body.jobId)) return "任务 ID 无效";
  if (!optionalString(body.assetId)) return "资产 ID 无效";
  if (!optionalString(body.type)) return "产物类型无效";
  if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim())) {
    return "产物标题不能为空";
  }
  if (!optionalString(body.status)) return "产物状态无效";
  if (!optionalString(body.url)) return "产物 URL 无效";
  if (!optionalString(body.prompt)) return "产物 prompt 无效";
  if (!optionalString(body.provider)) return "产物 provider 无效";
  if (!optionalString(body.model)) return "产物模型无效";
  if (!isMetadata(body.metadata)) return "产物 metadata 无效";

  return {
    workflowId: body.workflowId as string | undefined,
    nodeId: body.nodeId as string | undefined,
    jobId: body.jobId as string | undefined,
    assetId: body.assetId as string | undefined,
    type: body.type as string | undefined,
    title: body.title as string | undefined,
    status: body.status as string | undefined,
    url: body.url as string | undefined,
    prompt: body.prompt as string | undefined,
    provider: body.provider as string | undefined,
    model: body.model as string | undefined,
    metadata: body.metadata as Record<string, unknown> | undefined,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少产物 ID" }, { status: 400 });
  }

  try {
    const artifact = await artifactDB.get(id);
    if (!artifact) {
      return NextResponse.json({ error: "产物不存在" }, { status: 404 });
    }

    return NextResponse.json(sanitizePayloadForJson(artifact));
  } catch (e) {
    safeLogError("Artifact read failed", e);
    return NextResponse.json({ error: "产物读取失败" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少产物 ID" }, { status: 400 });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "请求参数无效" }, { status: 400 });
    }

    const reviewStatePatch = normalizeReviewStatePatch((body as Record<string, unknown>).reviewState);
    if (typeof reviewStatePatch === "string") {
      return NextResponse.json({ error: reviewStatePatch }, { status: 400 });
    }
    if (reviewStatePatch) {
      const existing = await artifactDB.get(id);
      if (!existing) {
        return NextResponse.json({ error: "产物不存在" }, { status: 404 });
      }
      const previousReviewState = isPlainObject(existing.metadata.reviewState)
        ? existing.metadata.reviewState
        : {};
      const artifact = await artifactDB.update(id, {
        metadata: {
          ...existing.metadata,
          reviewState: {
            ...previousReviewState,
            ...reviewStatePatch,
          },
        },
      });
      return NextResponse.json(artifact);
    }

    const updates = validateUpdate(body as Record<string, unknown>);
    if (typeof updates === "string") {
      return NextResponse.json({ error: updates }, { status: 400 });
    }

    const artifact = await artifactDB.update(id, updates);
    if (!artifact) {
      return NextResponse.json({ error: "产物不存在" }, { status: 404 });
    }

    return NextResponse.json(artifact);
  } catch (e) {
    safeLogError("Artifact update failed", e);
    return NextResponse.json({ error: "产物更新失败，请稍后重试" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少产物 ID" }, { status: 400 });
  }

  try {
    const deleted = await artifactDB.remove(id);
    if (!deleted) {
      return NextResponse.json({ error: "产物不存在" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    safeLogError("Artifact deletion failed", e);
    return NextResponse.json({ error: "产物删除失败，请稍后重试" }, { status: 500 });
  }
}
