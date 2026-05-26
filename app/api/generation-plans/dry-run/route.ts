import { NextResponse } from "next/server";
import { buildGenerationPlanDraft } from "@/lib/canvas/generation-plan-builder";
import type { GenerationPlanDraftRequest } from "@/lib/canvas/generation-plan";
import { safeLogError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "dry-run 请求体无效" }, { status: 400 });
    }

    const result = buildGenerationPlanDraft(body as GenerationPlanDraftRequest);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    safeLogError("Generation plan dry-run failed", error);
    return NextResponse.json({ error: "生成计划 dry-run 失败" }, { status: 500 });
  }
}
