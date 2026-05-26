import { NextResponse } from "next/server";
import {
  buildDemoReviewSession,
  buildReviewSessionSummary,
  updateReviewSessionSummary,
  type CreateReviewSessionInput,
  type ReviewSessionSummary,
  type UpdateReviewSessionInput,
} from "@/lib/canvas/reviewer-session";
import {
  applyExportPackReviewSyncToJob,
  getExportPackReviewSyncPlan,
  type ExportPackReviewSyncResult,
} from "@/lib/canvas/review-export-pack-sync";
import * as jobDB from "@/lib/store/job-db";
import * as reviewSessionDB from "@/lib/store/review-session-db";
import { safeLogError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";

interface ReviewSessionRequest {
  title?: unknown;
  images?: unknown;
  items?: unknown;
  qualityChecks?: unknown;
  notes?: unknown;
  metadata?: unknown;
  persist?: unknown;
}

interface ReviewSessionPatchRequest {
  action?: unknown;
  itemId?: unknown;
  note?: unknown;
  metadata?: unknown;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id")?.trim();
    const demo = searchParams.get("demo") === "true" || searchParams.get("demo") === "1";

    if (id) {
      const session = await reviewSessionDB.get(id);
      if (!session) return NextResponse.json({ error: "review session 不存在" }, { status: 404 });
      return NextResponse.json({ session });
    }

    const limit = Number(searchParams.get("limit") || 20);
    const sessions = await reviewSessionDB.list(Number.isFinite(limit) ? limit : 20);
    return NextResponse.json({
      sessions,
      demoSession: demo ? buildDemoReviewSession() : undefined,
    });
  } catch (error) {
    safeLogError("Review session read failed", error);
    return NextResponse.json({ error: "审核工作台 session 读取失败" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    if (typeof body === "string") {
      return NextResponse.json({ error: body }, { status: 400 });
    }

    const input = validateCreate(body);
    if (typeof input === "string") {
      return NextResponse.json({ error: input }, { status: 400 });
    }

    const session = buildReviewSessionSummary(input);
    if (body.persist === false) {
      return NextResponse.json({ session, persisted: false });
    }

    const savedSession = await reviewSessionDB.add(session);
    return NextResponse.json({ session: savedSession, persisted: true }, { status: 201 });
  } catch (error) {
    safeLogError("Review session creation failed", error);
    return NextResponse.json({ error: "审核工作台 session 生成失败" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id")?.trim();
    if (!id) return NextResponse.json({ error: "缺少 review session ID" }, { status: 400 });

    const body = await readBody(req);
    if (typeof body === "string") {
      return NextResponse.json({ error: body }, { status: 400 });
    }

    const input = validatePatch(body);
    if (typeof input === "string") {
      return NextResponse.json({ error: input }, { status: 400 });
    }

    const session = await reviewSessionDB.get(id);
    if (!session) return NextResponse.json({ error: "review session 不存在" }, { status: 404 });

    let nextSession;
    try {
      nextSession = updateReviewSessionSummary(session, input);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "review session 更新无效" },
        { status: 400 }
      );
    }

    const savedSession = await reviewSessionDB.update(nextSession);
    const exportPackSync = await syncExportPackQaReview(savedSession, input);
    return NextResponse.json({ session: savedSession, updated: true, exportPackSync });
  } catch (error) {
    safeLogError("Review session update failed", error);
    return NextResponse.json({ error: "审核工作台 session 更新失败" }, { status: 500 });
  }
}

async function syncExportPackQaReview(
  session: ReviewSessionSummary,
  input: UpdateReviewSessionInput
): Promise<ExportPackReviewSyncResult | undefined> {
  const plan = getExportPackReviewSyncPlan(session, input);
  if (!plan) return undefined;

  const job = await jobDB.get(plan.jobId);
  if (!job) {
    return {
      status: "skipped",
      batchId: plan.batchId,
      jobId: plan.jobId,
      reason: "job_not_found",
    };
  }

  const metadata = applyExportPackReviewSyncToJob(job, plan);
  if (!metadata) {
    return {
      status: "skipped",
      batchId: plan.batchId,
      jobId: plan.jobId,
      reason: "job_batch_mismatch",
    };
  }

  const updatedJob = await jobDB.update(job.id, { metadata });
  if (!updatedJob) {
    return {
      status: "failed",
      batchId: plan.batchId,
      jobId: plan.jobId,
      reason: "job_update_failed",
    };
  }

  return {
    status: "synced",
    batchId: plan.batchId,
    jobId: plan.jobId,
    checkCount: plan.checkIds.length,
  };
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id")?.trim();
    if (!id) return NextResponse.json({ error: "缺少 review session ID" }, { status: 400 });

    const deleted = await reviewSessionDB.remove(id);
    if (!deleted) return NextResponse.json({ error: "review session 不存在" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    safeLogError("Review session deletion failed", error);
    return NextResponse.json({ error: "审核工作台 session 删除失败" }, { status: 500 });
  }
}

async function readBody(req: Request): Promise<ReviewSessionRequest | string> {
  try {
    const body = await req.json();
    if (!isRecord(body)) return "请求参数无效";
    return body as ReviewSessionRequest;
  } catch {
    return "请求 JSON 无效";
  }
}

function validateCreate(body: ReviewSessionRequest): CreateReviewSessionInput | string {
  if (body.title !== undefined && typeof body.title !== "string") return "title 无效";
  if (body.images !== undefined && !Array.isArray(body.images)) return "images 必须是数组";
  if (body.items !== undefined && !Array.isArray(body.items)) return "items 必须是数组";
  if (body.qualityChecks !== undefined && !Array.isArray(body.qualityChecks)) {
    return "qualityChecks 必须是数组";
  }
  if (body.notes !== undefined && typeof body.notes !== "string" && !Array.isArray(body.notes)) {
    return "notes 无效";
  }
  if (body.metadata !== undefined && !isRecord(body.metadata)) return "metadata 无效";
  if (body.persist !== undefined && typeof body.persist !== "boolean") return "persist 无效";

  const hasItems =
    (Array.isArray(body.items) && body.items.length > 0) ||
    (Array.isArray(body.images) && body.images.length > 0);
  if (!hasItems) return "items 或 images 至少需要提供一个";

  return {
    title: body.title as string | undefined,
    images: body.images,
    items: body.items,
    qualityChecks: body.qualityChecks,
    notes: body.notes,
    metadata: body.metadata as Record<string, unknown> | undefined,
  };
}

function validatePatch(body: ReviewSessionPatchRequest): UpdateReviewSessionInput | string {
  if (
    body.action !== "approve_item" &&
    body.action !== "reject_item" &&
    body.action !== "request_revision" &&
    body.action !== "add_note"
  ) {
    return "action 无效";
  }
  if (body.itemId !== undefined && typeof body.itemId !== "string") return "itemId 无效";
  if (body.note !== undefined && typeof body.note !== "string") return "note 无效";
  if (body.metadata !== undefined && !isRecord(body.metadata)) return "metadata 无效";
  if (body.action === "add_note" && (!body.note || typeof body.note !== "string")) {
    return "note 不能为空";
  }
  if (
    (body.action === "approve_item" || body.action === "reject_item") &&
    (!body.itemId || typeof body.itemId !== "string")
  ) {
    return "itemId 不能为空";
  }

  return {
    action: body.action,
    itemId: body.itemId as string | undefined,
    note: body.note as string | undefined,
    metadata: body.metadata as Record<string, unknown> | undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
