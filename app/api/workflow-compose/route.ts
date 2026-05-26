import { NextResponse } from "next/server";
import {
  composeWorkflowDraft,
  type WorkflowComposeInput,
} from "@/lib/canvas/workflow-composer";
import { normalizeCopyRenderMode } from "@/lib/canvas/copy-render-policy";
import { buildWorkflowPlanPreview } from "@/lib/canvas/workflow-plan-preview";
import * as componentDB from "@/lib/store/component-db";
import { safeLogError } from "@/lib/server/safe-log";
import * as workflowDB from "@/lib/store/workflow-db";
import * as workflowTemplateDB from "@/lib/store/workflow-template-db";

export const dynamic = "force-dynamic";

interface WorkflowComposeRequest extends WorkflowComposeInput {
  previewPlan?: boolean;
  saveWorkflow?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function readBody(req: Request): Promise<Record<string, unknown> | string> {
  try {
    const body = await req.json();
    if (!isPlainObject(body)) return "请求参数无效";
    return body;
  } catch {
    return "请求 JSON 无效";
  }
}

function validateCompose(body: Record<string, unknown>): WorkflowComposeRequest | string {
  if (typeof body.brief !== "string" || !body.brief.trim()) return "brief 不能为空";
  if (body.scenario !== undefined && typeof body.scenario !== "string") return "scenario 无效";
  if (body.productTitle !== undefined && typeof body.productTitle !== "string") return "productTitle 无效";
  if (
    body.productDescription !== undefined &&
    typeof body.productDescription !== "string"
  ) {
    return "productDescription 无效";
  }

  const componentIds = toStringArray(body.componentIds);
  const platforms = toStringArray(body.platforms);
  const outputPacks = toStringArray(body.outputPacks);

  if (componentIds && body.componentIds !== undefined && !Array.isArray(body.componentIds)) {
    return "componentIds 无效";
  }
  if (platforms && body.platforms !== undefined && !Array.isArray(body.platforms)) {
    return "platforms 无效";
  }
  if (outputPacks && body.outputPacks !== undefined && !Array.isArray(body.outputPacks)) {
    return "outputPacks 无效";
  }
  if (body.saveWorkflow !== undefined && typeof body.saveWorkflow !== "boolean") {
    return "saveWorkflow 无效";
  }
  if (body.previewPlan !== undefined && typeof body.previewPlan !== "boolean") {
    return "previewPlan 无效";
  }
  const copyRenderMode = body.copyRenderMode === undefined
    ? undefined
    : normalizeCopyRenderMode(body.copyRenderMode);
  if (body.copyRenderMode !== undefined && !copyRenderMode) {
    return "copyRenderMode 无效";
  }

  return {
    brief: body.brief,
    scenario: body.scenario as string | undefined,
    productTitle: body.productTitle as string | undefined,
    productDescription: body.productDescription as string | undefined,
    componentIds,
    platforms,
    outputPacks,
    copyRenderMode,
    previewPlan: body.previewPlan === true,
    saveWorkflow: body.saveWorkflow === true,
  };
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    if (typeof body === "string") {
      return NextResponse.json({ error: body }, { status: 400 });
    }

    const input = validateCompose(body);
    if (typeof input === "string") {
      return NextResponse.json({ error: input }, { status: 400 });
    }

    const [components, templates] = await Promise.all([
      componentDB.list(),
      workflowTemplateDB.list({ status: "published" }),
    ]);
    const workflowDraft = composeWorkflowDraft(input, { components, templates });
    const planPreview = input.previewPlan
      ? buildWorkflowPlanPreview(workflowDraft, input)
      : undefined;

    if (!input.saveWorkflow) {
      return NextResponse.json({
        workflowDraft,
        ...(planPreview ? { planPreview } : {}),
      });
    }

    const workflow = await workflowDB.add(workflowDraft);
    return NextResponse.json(
      {
        workflowDraft,
        workflow,
        ...(planPreview ? { planPreview } : {}),
      },
      { status: 201 }
    );
  } catch (error) {
    safeLogError("Workflow compose failed", error);
    return NextResponse.json({ error: "工作流草案生成失败，请稍后重试" }, { status: 500 });
  }
}
