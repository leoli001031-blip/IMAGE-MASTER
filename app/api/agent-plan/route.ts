import { NextResponse } from "next/server";
import { buildAgentPlan, type AgentPlan, type AgentPlanBuildMode, type AgentPlanGenerationMatrixItem } from "@/lib/canvas/agent-plan-builder";
import { buildGenerationPlanDraft } from "@/lib/canvas/generation-plan-builder";
import type { GenerationPlanDraftRequest } from "@/lib/canvas/generation-plan";
import { safeLogError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (!body) {
      return NextResponse.json({ error: "Agent plan 请求体无效" }, { status: 400 });
    }

    const request = body as GenerationPlanDraftRequest & { agentPlanMode?: unknown };
    const draft = buildGenerationPlanDraft(request);

    const agentPlan = await buildAgentPlan({
      plan: draft.plan,
      request,
      referenceContext: draft.plan.referenceContext,
      sopExecutionPlan: draft.plan.sopExecutionPlan,
      mode: normalizeAgentPlanMode(request.agentPlanMode),
    });

    return NextResponse.json({
      ok: draft.ok,
      agentPlan: summarizeAgentPlanForResponse(agentPlan),
      estimate: draft.estimate,
      validation: draft.validation,
      referenceSlots: draft.referenceSlots.map((slot) => ({
        role: slot.role,
        required: slot.required,
        title: slot.title,
        providerUsable: slot.providerUsable,
        validationStatus: slot.validationStatus,
        issues: slot.issues,
      })),
    });
  } catch (error) {
    safeLogError("Agent plan build failed", error);
    return NextResponse.json({ error: "Agent plan 构建失败" }, { status: 500 });
  }
}

async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

function normalizeAgentPlanMode(value: unknown): AgentPlanBuildMode | undefined {
  return value === "auto" || value === "llm" || value === "deterministic" ? value : undefined;
}

function summarizeAgentPlanForResponse(agentPlan: AgentPlan) {
  return {
    version: agentPlan.version,
    planId: agentPlan.planId,
    compositionMode: agentPlan.compositionMode,
    selectedSkillIds: agentPlan.selectedSkillIds,
    summary: agentPlan.summary,
    assetGroups: agentPlan.assetGroups.map((group) => ({
      id: group.id,
      role: group.role,
      title: group.title,
      required: group.required,
      available: group.available,
      providerUsable: group.providerUsable,
      usage: group.usage,
      imageCount: group.imageCount,
      assetIds: group.assetIds,
      sourceNodeIds: group.sourceNodeIds,
      componentIds: group.componentIds,
      notes: group.notes,
    })),
    generationMatrix: agentPlan.generationMatrix.map(summarizeAgentMatrixItem),
    missingInputs: agentPlan.missingInputs,
  };
}

function summarizeAgentMatrixItem(item: AgentPlanGenerationMatrixItem) {
  return {
    id: item.id,
    itemId: item.itemId,
    title: item.title,
    type: item.type,
    ratio: item.ratio,
    size: item.size,
    skillId: item.skillId,
    outputSlotId: item.outputSlotId,
    referenceRoles: item.referenceRoles,
    providerReferenceRoles: item.providerReferenceRoles,
    assetGroupIds: item.assetGroupIds,
    copyMode: item.copyMode,
    missingInputIds: item.missingInputIds,
    status: item.status,
    summary: item.summary,
  };
}
