import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import type { CanvasReferenceRole } from "@/lib/canvas/canvas-reference-slots";
import { buildGenerationPlanDraft } from "@/lib/canvas/generation-plan-builder";
import type {
  GenerationPlan,
  GenerationPlanDraftRequest,
  GenerationPlanDraftResult,
  GenerationPlanItem,
  SopExecutionPlan,
} from "@/lib/canvas/generation-plan";
import {
  generationReferenceRoles,
  normalizeGenerationReferenceContext,
  type GenerationReferenceContext,
  type GenerationReferenceImage,
} from "@/lib/canvas/generation-reference-context";
import {
  DEFAULT_WORKFLOW_SKILL_ID,
  WORKFLOW_SKILL_REGISTRY,
  isReferenceAssetWorkflowIntent,
  type WorkflowSkill,
} from "@/lib/canvas/workflow-skill-registry";
import { getConfig } from "@/lib/store/config-store";

export type AgentPlanBuildMode = "auto" | "llm" | "deterministic";

export type AgentPlanCompositionMode =
  | "single_product"
  | "single_product_multi_scene"
  | "single_model_multi_product"
  | "multi_product_separate"
  | "multi_product_bundle"
  | "multi_scene_variation"
  | "multi_model_variation"
  | "custom_matrix"
  | "product_only"
  | "product_model"
  | "product_scene"
  | "product_model_scene"
  | "style_campaign"
  | "copy_layout"
  | "text_only"
  | "unknown";

export type AgentPlanSourceMode =
  | "llm_agent_plan_v1"
  | "deterministic_agent_plan_v1";

export type AgentPlanAssetUsage =
  | "provider_input"
  | "prompt_only"
  | "optional"
  | "missing";

export interface AgentPlanAssetGroup {
  id: string;
  role: CanvasReferenceRole;
  title: string;
  sourceKey: string;
  required: boolean;
  available: boolean;
  providerUsable: boolean;
  usage: AgentPlanAssetUsage;
  imageCount: number;
  imageUrls: string[];
  providerUsableImageUrls: string[];
  sourceNodeIds: string[];
  assetIds: string[];
  componentIds: string[];
  promptFragments: string[];
  constraints: string[];
  notes: string[];
}

export interface AgentPlanGenerationMatrixItem {
  id: string;
  itemId: string;
  title: string;
  type: string;
  ratio?: string;
  size?: string;
  skillId?: string;
  outputSlotId?: string;
  referenceRoles: CanvasReferenceRole[];
  providerReferenceRoles: CanvasReferenceRole[];
  assetGroupIds: string[];
  promptBlockIds: string[];
  qaRuleIds: string[];
  copyMode?: string;
  missingInputIds: string[];
  status: "ready" | "blocked";
  summary: string;
}

export interface AgentPlanMissingInput {
  id: string;
  label: string;
  role?: CanvasReferenceRole;
  required: boolean;
  reason: string;
  blocking: boolean;
}

export interface AgentPlanSummary {
  mode: AgentPlanSourceMode;
  fallbackUsed: boolean;
  fallbackReason?: string;
  selectedSkillTitles: string[];
  itemCount: number;
  readyItemCount: number;
  blockedItemCount: number;
  text: string;
}

export interface AgentPlan {
  version: 1;
  planId?: string;
  assetGroups: AgentPlanAssetGroup[];
  compositionMode: AgentPlanCompositionMode;
  generationMatrix: AgentPlanGenerationMatrixItem[];
  selectedSkillIds: string[];
  missingInputs: AgentPlanMissingInput[];
  summary: AgentPlanSummary;
}

export interface BuildAgentPlanInput {
  plan?: GenerationPlan;
  draftResult?: GenerationPlanDraftResult;
  request?: GenerationPlanDraftRequest;
  referenceContext?: GenerationReferenceContext | unknown;
  workflowSkills?: WorkflowSkill[];
  sopExecutionPlan?: SopExecutionPlan;
  mode?: AgentPlanBuildMode;
  mock?: boolean;
}

interface NormalizedAgentPlanContext {
  plan?: GenerationPlan;
  request?: GenerationPlanDraftRequest;
  referenceContext?: GenerationReferenceContext;
  skills: WorkflowSkill[];
  sopExecutionPlan?: SopExecutionPlan;
}

const roleLabels: Record<CanvasReferenceRole, string> = {
  product: "商品资产",
  model: "模特资产",
  style: "风格资产",
  scene: "场景资产",
  copy: "文案资产",
};

const llmMaxTokens = Math.max(
  4000,
  Number(process.env.IMAGE_MASTER_AGENT_PLAN_MAX_TOKENS || 6000) || 6000
);

export async function buildAgentPlan(input: BuildAgentPlanInput): Promise<AgentPlan> {
  const context = normalizeAgentPlanContext(input);
  const deterministicPlan = buildDeterministicAgentPlanFromContext(context);
  const llmGate = getLlmGate(input);

  if (!llmGate.enabled) {
    if (shouldAllowDeterministicAgentPlan(input)) {
      return withFallbackSummary(deterministicPlan, llmGate.reason);
    }
    throw new Error(llmGate.reason || "Plan-level agent LLM is not available");
  }

  const aiPlan = await runAgentPlanner(context, deterministicPlan);
  return normalizeLlmAgentPlan(aiPlan, deterministicPlan, context);
}

function shouldAllowDeterministicAgentPlan(input: BuildAgentPlanInput): boolean {
  if (input.mode === "deterministic") return true;
  if (input.mock === true) return true;
  if (
    process.env.IMAGE_MASTER_ENABLE_MOCK_BATCH === "1" ||
    process.env.IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER === "1"
  ) {
    return true;
  }
  if (process.env.IMAGE_MASTER_ALLOW_AGENT_PLAN_FALLBACK === "1") {
    return true;
  }
  return false;
}

export function buildDeterministicAgentPlan(
  input: BuildAgentPlanInput
): AgentPlan {
  return buildDeterministicAgentPlanFromContext(normalizeAgentPlanContext(input));
}

function normalizeAgentPlanContext(input: BuildAgentPlanInput): NormalizedAgentPlanContext {
  const plan =
    input.plan ??
    input.draftResult?.plan ??
    (input.request ? buildGenerationPlanDraft(input.request).plan : undefined);
  const referenceContext = normalizeGenerationReferenceContext(
    input.referenceContext ?? plan?.referenceContext ?? input.request?.referenceContext
  );

  return {
    plan,
    request: input.request,
    referenceContext,
    skills: input.workflowSkills?.length ? input.workflowSkills : WORKFLOW_SKILL_REGISTRY,
    sopExecutionPlan: input.sopExecutionPlan ?? plan?.sopExecutionPlan,
  };
}

function buildDeterministicAgentPlanFromContext(
  context: NormalizedAgentPlanContext
): AgentPlan {
  const selectedSkills = selectSkills(context);
  const selectedSkillIds = selectedSkills.map((skill) => skill.id);
  const assetGroups = buildAssetGroups(context, selectedSkills);
  const missingInputs = buildMissingInputs(assetGroups);
  const generationMatrix = buildGenerationMatrix({
    context,
    selectedSkills,
    assetGroups,
    missingInputs,
  });
  const compositionMode = inferCompositionMode(assetGroups, generationMatrix);
  const readyItemCount = generationMatrix.filter((item) => item.status === "ready").length;
  const blockedItemCount = generationMatrix.length - readyItemCount;

  return {
    version: 1,
    planId: context.plan?.planId,
    assetGroups,
    compositionMode,
    generationMatrix,
    selectedSkillIds,
    missingInputs,
    summary: {
      mode: "deterministic_agent_plan_v1",
      fallbackUsed: false,
      selectedSkillTitles: selectedSkills.map((skill) => skill.title),
      itemCount: generationMatrix.length,
      readyItemCount,
      blockedItemCount,
      text: buildSummaryText({
        selectedSkills,
        compositionMode,
        itemCount: generationMatrix.length,
        missingInputs,
      }),
    },
  };
}

function getLlmGate(input: BuildAgentPlanInput): { enabled: boolean; reason?: string } {
  if (input.mode === "deterministic") {
    return { enabled: false, reason: "Deterministic agent plan requested" };
  }
  if (input.mock === true) {
    return { enabled: false, reason: "Mock/smoke mode avoids text LLM calls" };
  }
  if (
    process.env.IMAGE_MASTER_ENABLE_MOCK_BATCH === "1" ||
    process.env.IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER === "1"
  ) {
    return { enabled: false, reason: "Mock/smoke mode avoids text LLM calls" };
  }
  if (process.env.IMAGE_MASTER_DISABLE_AGENT_PLAN_LLM === "1") {
    return { enabled: false, reason: "Plan-level agent LLM explicitly disabled" };
  }

  const config = getConfig();
  if (!(config.textApiKey || config.apiKey)) {
    return { enabled: false, reason: "Text API key not configured" };
  }
  return { enabled: true };
}

async function runAgentPlanner(
  context: NormalizedAgentPlanContext,
  deterministicPlan: AgentPlan
): Promise<unknown> {
  const config = getConfig();
  const apiKey = config.textApiKey || config.apiKey;
  const baseURL = config.textBaseUrl || config.baseUrl || "https://api.openai.com/v1";
  if (!apiKey) throw new Error("Text API key not configured");

  const provider = createOpenAI({ apiKey, baseURL });
  const payload = {
    request: buildRequestText(context.request, context.plan),
    plan: {
      planId: context.plan?.planId,
      workflowId: context.plan?.workflowId,
      campaignSkillId: context.plan?.campaignBible?.workflowSkillId,
      itemCount: context.plan?.items.length ?? 0,
      items: (context.plan?.items ?? []).slice(0, 16).map((item) => ({
        itemId: item.itemId,
        title: item.title,
        type: item.type,
        ratio: item.ratio,
        size: item.size,
        referenceRoles: item.referenceRoles ?? [],
        providerReferenceRoles: item.providerReferenceRoles ?? [],
        copyMode: item.copyRenderPolicy?.mode,
        productReferenceFocus: item.productReferenceFocus,
        prompt: shortText(item.prompt, 360),
      })),
    },
    references: deterministicPlan.assetGroups.map((group) => ({
      id: group.id,
      role: group.role,
      required: group.required,
      available: group.available,
      providerUsable: group.providerUsable,
      usage: group.usage,
      imageCount: group.imageCount,
      imageUrlCount: group.imageUrls.length,
      providerUsableImageUrlCount: group.providerUsableImageUrls.length,
      promptFragments: group.promptFragments.slice(0, 4),
      constraints: group.constraints.slice(0, 4),
    })),
    workflowSkills: context.skills.map((skill) => ({
      id: skill.id,
      title: skill.title,
      description: skill.description,
      platforms: skill.platforms,
      outputPacks: skill.outputPacks,
      requiredAssetRoles: skill.requiredAssetRoles,
      optionalAssetRoles: skill.optionalAssetRoles,
      sampleCount: skill.sampleCount,
      fullCount: skill.fullCount,
      outputSlots: skill.outputSlots.map((slot) => ({
        id: slot.id,
        label: slot.label,
        purpose: slot.purpose,
        ratio: slot.ratio,
        samplePhase: slot.samplePhase,
      })),
      qaRules: skill.qaRules,
    })),
    sop: {
      keys: context.sopExecutionPlan?.debugSource?.sopKeys ?? [],
      requiredInputs: context.sopExecutionPlan?.requiredInputs?.map((input) => ({
        id: input.id,
        label: input.label,
        role: input.role,
        required: input.required,
        status: input.status,
      })),
      promptBlocks: context.sopExecutionPlan?.promptBlocks?.slice(0, 12).map((block) => ({
        id: block.id,
        title: block.title,
        source: block.source,
        content: block.content.slice(0, 4).map((line) => shortText(line, 180)),
      })),
      qaRules: context.sopExecutionPlan?.qaRules?.slice(0, 12),
    },
    deterministicPlan: summarizeDeterministicPlanForAgent(deterministicPlan),
    outputSchema: {
      compositionMode:
        "single_product|single_product_multi_scene|single_model_multi_product|multi_product_separate|multi_product_bundle|multi_scene_variation|multi_model_variation|custom_matrix|product_only|product_model|product_scene|product_model_scene|style_campaign|copy_layout|text_only|unknown",
      selectedSkillIds: ["workflow skill ids from workflowSkills"],
      generationMatrix: [
        {
          itemId: "existing plan item id",
          assetGroupIds: ["asset group ids from deterministicPlan.assetGroups; pick one product per SKU and one scene per location when there are multiples"],
          skillId: "optional selected workflow skill id",
          outputSlotId: "optional workflow output slot id when matched",
        },
      ],
      missingInputs: [
        {
          id: "stable input id",
          label: "short label",
          role: "product|model|style|scene|copy",
          reason: "short Chinese reason",
          blocking: "boolean",
        },
      ],
      summary: "short Chinese summary",
    },
  };

  const result = await generateText({
    model: provider(config.textModel || "gpt-4o"),
    system: [
      "你是商业图像画布里的 Plan-level Agent。",
      "你不生成图片、不接 API route、不改前端，只把已存在的 draft plan、referenceContext、workflow skills 和 SOP 汇总成可执行 agentPlan。",
      "你的输出必须只包含这 5 个顶层字段：compositionMode、selectedSkillIds、generationMatrix、missingInputs、summary。",
      "generationMatrix 是最小 patch：每项只写 itemId、assetGroupIds，以及必要时的 skillId/outputSlotId。不要写 title、type、ratio、size、referenceRoles、providerReferenceRoles、summary、prompt。",
      "不要输出 assetGroups、deterministicPlan、references、workflowSkills、sop、imageUrls、base64、notes 或任何输入原文。",
      "必须复用输入里的 workflow skill id、plan item id、reference role。不要发明不存在的素材角色或技能。",
      "真实生成时优先让商品真实图进入 provider 输入；mock/smoke 和无 key 场景由系统兜底，不需要你处理。",
      "区分商品、模特、场景、风格、文案职责：商品锁身份，模特锁人设/身份，场景锁空间光影，风格锁完成度，文案默认是 layout/copy layer。",
      "输出严格 JSON object，不要 markdown，不要解释。"
    ].join("\n"),
    messages: [{ role: "user", content: JSON.stringify(payload) }],
    temperature: 0.2,
    maxTokens: llmMaxTokens,
  });

  const parsed = parseJsonObject(result.text || "");
  if (!parsed) {
    throw new Error(`Plan-level agent LLM returned invalid JSON: ${compactInvalidJsonPreview(result.text || "")}`);
  }
  return parsed;
}

function summarizeDeterministicPlanForAgent(plan: AgentPlan) {
  return {
    compositionMode: plan.compositionMode,
    selectedSkillIds: plan.selectedSkillIds,
    assetGroups: plan.assetGroups.map((group) => ({
      id: group.id,
      role: group.role,
      title: group.title,
      required: group.required,
      available: group.available,
      providerUsable: group.providerUsable,
      usage: group.usage,
      imageCount: group.imageCount,
    })),
    generationMatrix: plan.generationMatrix.map((item) => ({
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
      status: item.status,
    })),
    missingInputs: plan.missingInputs.map((input) => ({
      id: input.id,
      label: input.label,
      role: input.role,
      blocking: input.blocking,
    })),
  };
}

function compactInvalidJsonPreview(text: string): string {
  const normalized = text
    .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, "[image-data]")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, 420) : "[empty response]";
}

function normalizeLlmAgentPlan(
  value: unknown,
  deterministicPlan: AgentPlan,
  context: NormalizedAgentPlanContext
): AgentPlan {
  if (!isRecord(value)) throw new Error("Invalid agent plan payload");

  const knownSkillIds = new Set(context.skills.map((skill) => skill.id));
  const selectedSkillIds = getStringArray(value.selectedSkillIds)
    .filter((id) => knownSkillIds.has(id));
  const fallbackSkillIds = deterministicPlan.selectedSkillIds;
  const mergedSkillIds = selectedSkillIds.length ? selectedSkillIds : fallbackSkillIds;
  const compositionMode = normalizeCompositionMode(value.compositionMode)
    ?? deterministicPlan.compositionMode;
  const knownAssetGroupIds = new Set(deterministicPlan.assetGroups.map((group) => group.id));
  const llmMatrix = normalizeLlmMatrix(
    value.generationMatrix,
    deterministicPlan,
    mergedSkillIds,
    knownAssetGroupIds,
    context
  );
  const mergedMissingInputs = mergeMissingInputs(
    deterministicPlan.missingInputs,
    normalizeLlmMissingInputs(value.missingInputs)
  );
  const readyItemCount = llmMatrix.filter((item) => item.status === "ready").length;
  const blockedItemCount = llmMatrix.length - readyItemCount;

  return {
    ...deterministicPlan,
    compositionMode,
    selectedSkillIds: mergedSkillIds,
    generationMatrix: llmMatrix,
    missingInputs: mergedMissingInputs,
    summary: {
      mode: "llm_agent_plan_v1",
      fallbackUsed: false,
      selectedSkillTitles: context.skills
        .filter((skill) => mergedSkillIds.includes(skill.id))
        .map((skill) => skill.title),
      itemCount: llmMatrix.length,
      readyItemCount,
      blockedItemCount,
      text: getString(value.summary) || deterministicPlan.summary.text,
    },
  };
}

function selectSkills(context: NormalizedAgentPlanContext): WorkflowSkill[] {
  const byId = new Map(context.skills.map((skill) => [skill.id, skill]));
  const ids = new Set<string>();
  const campaignSkillId = context.plan?.campaignBible?.workflowSkillId;
  if (campaignSkillId && byId.has(campaignSkillId)) ids.add(campaignSkillId);

  const requestText = buildRequestText(context.request, context.plan).toLowerCase();
  const referenceAssetSkill = byId.get("workflow.reference_asset.v1");
  if (referenceAssetSkill && isReferenceAssetWorkflowIntent(requestText)) {
    return [referenceAssetSkill];
  }

  const requestPlatforms = new Set((context.request?.platforms ?? context.plan?.campaignBible?.platforms ?? [])
    .map((platform) => platform.toLowerCase()));
  const requestPacks = new Set((context.request?.outputPacks ?? context.plan?.campaignBible?.outputPacks ?? [])
    .map((pack) => pack.toLowerCase()));

  const scored = context.skills.map((skill, index) => {
    let score = 0;
    if (requestPlatforms.size > 0) {
      for (const platform of skill.platforms) {
        if (requestPlatforms.has(platform.toLowerCase())) score += 12;
      }
    }
    if (requestPacks.size > 0) {
      for (const pack of skill.outputPacks) {
        if (requestPacks.has(pack.toLowerCase())) score += 12;
      }
    }
    for (const term of skill.matchTerms) {
      if (requestText.includes(term.toLowerCase())) score += term.length > 4 ? 4 : 3;
    }
    for (const item of context.plan?.items ?? []) {
      const itemText = `${item.title} ${item.type} ${item.prompt}`.toLowerCase();
      for (const slot of skill.outputSlots) {
        if (itemText.includes(slot.id.toLowerCase()) || itemText.includes(slot.label.toLowerCase())) {
          score += 2;
        }
      }
    }
    return { skill, score: score - index * 0.001 };
  });

  scored.sort((a, b) => b.score - a.score);
  for (const entry of scored) {
    if (entry.score > 0) ids.add(entry.skill.id);
    if (ids.size >= 2) break;
  }
  if (ids.size === 0) {
    const defaultSkill = byId.get(DEFAULT_WORKFLOW_SKILL_ID) ?? scored[0]?.skill;
    if (defaultSkill) ids.add(defaultSkill.id);
  }

  return Array.from(ids).map((id) => byId.get(id)).filter(Boolean) as WorkflowSkill[];
}

function buildAssetGroups(
  context: NormalizedAgentPlanContext,
  selectedSkills: WorkflowSkill[]
): AgentPlanAssetGroup[] {
  const requiredRoles = new Set<CanvasReferenceRole>();
  const optionalRoles = new Set<CanvasReferenceRole>();

  for (const role of context.plan?.campaignBible?.assetPolicy.requiredRoles ?? []) requiredRoles.add(role);
  for (const role of context.plan?.campaignBible?.assetPolicy.optionalRoles ?? []) optionalRoles.add(role);
  for (const role of context.request?.requiredReferenceRoles ?? []) requiredRoles.add(role);
  for (const skill of selectedSkills) {
    for (const role of skill.requiredAssetRoles) requiredRoles.add(role);
    for (const role of skill.optionalAssetRoles) optionalRoles.add(role);
  }
  for (const item of context.plan?.items ?? []) {
    for (const role of item.referenceRoles ?? []) optionalRoles.add(role);
  }

  const roles = generationReferenceRoles.filter((role) => {
    return requiredRoles.has(role) || optionalRoles.has(role) || hasReferenceRole(context.referenceContext, role);
  });

  return roles.flatMap((role): AgentPlanAssetGroup[] => {
    const roleContext = context.referenceContext?.roles[role];
    const images = context.referenceContext?.images.filter((image) => image.role === role) ?? [];
    const required = requiredRoles.has(role);
    const groups: AgentPlanAssetGroup[] = [];

    if (images.length > 0) {
      const imageBuckets = bucketReferenceImagesBySource(images);
      imageBuckets.forEach((bucket, index) => {
        const providerUsable = bucket.some((image) => image.providerUsable);
        const title = bucket.length === 1
          ? bucket[0].title
          : `${bucket[0].title || roleLabels[role]} · ${bucket.length} 张`;
        const sourceKey = buildAssetSourceKey(bucket, role, index);
        groups.push({
          id: `asset.${role}.${slugSourceKey(sourceKey, index)}`,
          role,
          title: title || `${roleLabels[role]} ${index + 1}`,
          sourceKey,
          required,
          available: true,
          providerUsable,
          usage: providerUsable && role !== "copy" ? "provider_input" : "prompt_only",
          imageCount: bucket.length,
          imageUrls: uniqueStrings(bucket.map((image) => image.url)),
          providerUsableImageUrls: uniqueStrings(
            bucket.filter((image) => image.providerUsable).map((image) => image.url)
          ),
          sourceNodeIds: uniqueStrings([
            ...(roleContext?.sourceNodeIds ?? []),
            ...bucket.map((image) => image.nodeId),
          ]),
          assetIds: uniqueStrings([
            ...(roleContext?.assetIds ?? []),
            ...bucket.map((image) => image.assetId),
          ]),
          componentIds: uniqueStrings([
            ...(roleContext?.componentIds ?? []),
            ...bucket.map((image) => image.componentId),
          ]),
          promptFragments: uniqueStrings([
            ...(roleContext?.promptFragments ?? []),
            ...(role === "copy" ? context.referenceContext?.promptFragments ?? [] : []),
          ]).slice(0, 8),
          constraints: uniqueStrings(roleContext?.constraints ?? []).slice(0, 8),
          notes: buildAssetGroupNotes(role, required, true, providerUsable),
        });
      });
    }

    const hasTextOnlyContext = Boolean(roleContext) &&
      images.length === 0 &&
      ((roleContext?.promptFragments.length ?? 0) > 0 ||
        (roleContext?.constraints.length ?? 0) > 0 ||
        (roleContext?.qualityRules.length ?? 0) > 0 ||
        (roleContext?.negativeRules.length ?? 0) > 0 ||
        (role === "copy" && (context.referenceContext?.promptFragments.length ?? 0) > 0));
    if (hasTextOnlyContext) {
      groups.push({
        id: `asset.${role}.text`,
        role,
        title: roleContext?.title || roleLabels[role],
        sourceKey: `${role}:text`,
        required,
        available: true,
        providerUsable: false,
        usage: "prompt_only",
        imageCount: 0,
        imageUrls: [],
        providerUsableImageUrls: [],
        sourceNodeIds: uniqueStrings(roleContext?.sourceNodeIds ?? []),
        assetIds: uniqueStrings(roleContext?.assetIds ?? []),
        componentIds: uniqueStrings(roleContext?.componentIds ?? []),
        promptFragments: uniqueStrings([
          ...(roleContext?.promptFragments ?? []),
          ...(role === "copy" ? context.referenceContext?.promptFragments ?? [] : []),
        ]).slice(0, 8),
        constraints: uniqueStrings(roleContext?.constraints ?? []).slice(0, 8),
        notes: buildAssetGroupNotes(role, required, true, false),
      });
    }

    if (groups.length === 0) {
      groups.push({
        id: `asset.${role}.missing`,
        role,
        title: roleContext?.title || roleLabels[role],
        sourceKey: `${role}:missing`,
        required,
        available: false,
        providerUsable: false,
        usage: required ? "missing" : "optional",
        imageCount: 0,
        imageUrls: [],
        providerUsableImageUrls: [],
        sourceNodeIds: uniqueStrings(roleContext?.sourceNodeIds ?? []),
        assetIds: uniqueStrings(roleContext?.assetIds ?? []),
        componentIds: uniqueStrings(roleContext?.componentIds ?? []),
        promptFragments: uniqueStrings(roleContext?.promptFragments ?? []).slice(0, 8),
        constraints: uniqueStrings(roleContext?.constraints ?? []).slice(0, 8),
        notes: buildAssetGroupNotes(role, required, false, false),
      });
    }

    return groups;
  });
}

function buildGenerationMatrix({
  context,
  selectedSkills,
  assetGroups,
  missingInputs,
}: {
  context: NormalizedAgentPlanContext;
  selectedSkills: WorkflowSkill[];
  assetGroups: AgentPlanAssetGroup[];
  missingInputs: AgentPlanMissingInput[];
}): AgentPlanGenerationMatrixItem[] {
  const blockingMissingIds = new Set(missingInputs.filter((input) => input.blocking).map((input) => input.id));
  const firstSkill = selectedSkills[0];
  const promptBlockIds = context.sopExecutionPlan?.promptBlocks?.map((block) => block.id) ?? [];
  const qaRuleIds = context.sopExecutionPlan?.qaRules?.map((_, index) => `qa.${index + 1}`) ?? [];
  const availableAssetGroups = assetGroups.filter((group) => group.available);
  const productGroups = availableAssetGroups.filter((group) => group.role === "product");
  const sceneGroups = availableAssetGroups.filter((group) => group.role === "scene");

  return (context.plan?.items ?? []).map((item, index): AgentPlanGenerationMatrixItem => {
    const skill = selectedSkills.find((candidate) => {
      return candidate.outputSlots.some((slot) => matchesOutputSlot(item, slot.id, slot.label));
    }) ?? firstSkill;
    const outputSlot = skill?.outputSlots.find((slot) => matchesOutputSlot(item, slot.id, slot.label))
      ?? skill?.outputSlots[index % Math.max(1, skill.outputSlots.length)];
    const referenceRoles = normalizeRoles(item.referenceRoles?.length
      ? item.referenceRoles
      : outputSlot
        ? inferSlotReferenceRoles(item, skill)
        : assetGroups.filter((group) => group.required).map((group) => group.role));
    const selectedAssetGroups = selectMatrixAssetGroups({
      assetGroups: availableAssetGroups,
      referenceRoles,
      index,
      productGroupCount: productGroups.length,
      sceneGroupCount: sceneGroups.length,
    });
    const providerReferenceRoles = normalizeRoles(item.providerReferenceRoles?.length
      ? item.providerReferenceRoles
      : referenceRoles.filter((role) => {
          return selectedAssetGroups.some((group) => group.role === role && group.providerUsable) && role !== "copy";
        }));
    const itemMissing = missingInputs.filter((input) => {
      if (!input.role) return false;
      return referenceRoles.includes(input.role) && input.blocking;
    });
    const missingInputIds = itemMissing.map((input) => input.id);
    const status = missingInputIds.some((id) => blockingMissingIds.has(id)) ? "blocked" : "ready";

    return {
      id: `matrix.${item.itemId}`,
      itemId: item.itemId,
      title: item.title,
      type: item.type,
      ratio: item.ratio,
      size: item.size,
      skillId: skill?.id,
      outputSlotId: outputSlot?.id,
      referenceRoles,
      providerReferenceRoles,
      assetGroupIds: selectedAssetGroups.map((group) => group.id),
      promptBlockIds: uniqueStrings([
        `item.${item.itemId}`,
        ...promptBlockIds.filter((id) => id.startsWith("sop.") || id.startsWith("knowledge.") || id === "reference.context"),
      ]),
      qaRuleIds,
      copyMode: item.copyRenderPolicy?.mode,
      missingInputIds,
      status,
      summary: buildMatrixItemSummary(item, skill, outputSlot?.label, referenceRoles, providerReferenceRoles),
    };
  });
}

function buildMissingInputs(assetGroups: AgentPlanAssetGroup[]): AgentPlanMissingInput[] {
  return assetGroups
    .filter((group) => group.usage === "missing")
    .map((group) => ({
      id: `missing.${group.role}`,
      label: group.title,
      role: group.role,
      required: group.required,
      reason: `${roleLabels[group.role]}是当前 workflow/SOP 的必需输入，但 referenceContext 中还没有可用来源。`,
      blocking: group.required,
    }));
}

function inferCompositionMode(
  assetGroups: AgentPlanAssetGroup[],
  generationMatrix: AgentPlanGenerationMatrixItem[]
): AgentPlanCompositionMode {
  const usedRoles = new Set<CanvasReferenceRole>();
  for (const group of assetGroups) {
    if (group.available || group.required) usedRoles.add(group.role);
  }
  for (const item of generationMatrix) {
    for (const role of item.referenceRoles) usedRoles.add(role);
  }
  const availableProducts = assetGroups.filter((group) => group.role === "product" && group.available).length;
  const availableModels = assetGroups.filter((group) => group.role === "model" && group.available).length;
  const availableScenes = assetGroups.filter((group) => group.role === "scene" && group.available).length;

  if (availableProducts > 1 && availableScenes > 1) return "custom_matrix";
  if (availableProducts > 1 && availableModels === 1) return "single_model_multi_product";
  if (availableProducts > 1) return "multi_product_separate";
  if (availableProducts === 1 && availableScenes > 1) return "single_product_multi_scene";
  if (availableScenes > 1 && availableProducts === 0) return "multi_scene_variation";
  if (availableModels > 1 && availableProducts <= 1) return "multi_model_variation";
  if (availableProducts === 1 && !usedRoles.has("model") && !usedRoles.has("scene")) return "single_product";

  if (usedRoles.has("product") && usedRoles.has("model") && usedRoles.has("scene")) {
    return "product_model_scene";
  }
  if (usedRoles.has("product") && usedRoles.has("model")) return "product_model";
  if (usedRoles.has("product") && usedRoles.has("scene")) return "product_scene";
  if (usedRoles.has("product")) return "product_only";
  if (usedRoles.has("style")) return "style_campaign";
  if (usedRoles.has("copy")) return "copy_layout";
  if (generationMatrix.length > 0) return "text_only";
  return "unknown";
}

function normalizeLlmMatrix(
  value: unknown,
  deterministicPlan: AgentPlan,
  selectedSkillIds: string[],
  knownAssetGroupIds: Set<string>,
  context: NormalizedAgentPlanContext
): AgentPlanGenerationMatrixItem[] {
  if (!Array.isArray(value)) return deterministicPlan.generationMatrix;
  const byItemId = new Map(deterministicPlan.generationMatrix.map((item) => [item.itemId, item]));
  const itemTextById = new Map(
    (context.plan?.items ?? []).map((item) => [
      item.itemId,
      `${item.title} ${item.type} ${item.prompt} ${item.copyText ?? ""}`,
    ])
  );

  return deterministicPlan.generationMatrix.map((fallback) => {
    const record = value.find((entry) => isRecord(entry) && getString(entry.itemId) === fallback.itemId);
    if (!isRecord(record)) return fallback;
    const referenceRoles = normalizeRoles(getStringArray(record.referenceRoles));
    const providerReferenceRoles = normalizeRoles(getStringArray(record.providerReferenceRoles))
      .filter((role) => referenceRoles.includes(role));
    const skillId = getString(record.skillId);
    const outputSlotId = getOptionalString(record.outputSlotId) ?? fallback.outputSlotId;
    const assetGroupIds = getStringArray(record.assetGroupIds)
      .filter((id) => knownAssetGroupIds.has(id));
    const completeAssetGroupIds = completeAssetGroupIdsForRoles({
      selectedIds: assetGroupIds,
      fallbackIds: fallback.assetGroupIds,
      referenceRoles: referenceRoles.length ? referenceRoles : fallback.referenceRoles,
      assetGroups: deterministicPlan.assetGroups,
      itemText: itemTextById.get(fallback.itemId) ?? `${fallback.title} ${fallback.type}`,
    });
    const summary = getString(record.summary) || fallback.summary;
    const base = byItemId.get(fallback.itemId) ?? fallback;

    return {
      ...base,
      skillId: skillId && selectedSkillIds.includes(skillId) ? skillId : fallback.skillId,
      outputSlotId,
      referenceRoles: referenceRoles.length ? referenceRoles : fallback.referenceRoles,
      providerReferenceRoles: providerReferenceRoles.length
        ? providerReferenceRoles
        : fallback.providerReferenceRoles,
      assetGroupIds: completeAssetGroupIds.length ? completeAssetGroupIds : fallback.assetGroupIds,
      summary,
    };
  });
}

function completeAssetGroupIdsForRoles({
  selectedIds,
  fallbackIds,
  referenceRoles,
  assetGroups,
  itemText,
}: {
  selectedIds: string[];
  fallbackIds: string[];
  referenceRoles: CanvasReferenceRole[];
  assetGroups: AgentPlanAssetGroup[];
  itemText: string;
}): string[] {
  if (selectedIds.length === 0) return fallbackIds;
  const roleById = new Map(assetGroups.map((group) => [group.id, group.role]));
  const neededRoles = new Set(referenceRoles);
  const selected = [...selectedIds];
  const selectedRoles = new Set(
    selectedIds
      .map((id) => roleById.get(id))
      .filter((role): role is CanvasReferenceRole => !!role)
  );

  for (const fallbackId of fallbackIds) {
    const role = roleById.get(fallbackId);
    if (!role || !neededRoles.has(role) || selectedRoles.has(role)) continue;
    selected.push(fallbackId);
    selectedRoles.add(role);
  }

  for (const group of assetGroups) {
    if (!group.available || !group.providerUsable) continue;
    if (!neededRoles.has(group.role)) continue;
    if (selected.includes(group.id)) continue;
    if (!assetGroupLooksExplicitlyMentioned(group, itemText)) continue;
    selected.push(group.id);
  }

  return uniqueStrings(selected);
}

function assetGroupLooksExplicitlyMentioned(group: AgentPlanAssetGroup, itemText: string): boolean {
  const text = normalizeMatchText(itemText);
  const title = normalizeMatchText(group.title);
  const source = normalizeMatchText(group.sourceKey);
  const candidates = uniqueStrings([
    group.title,
    group.sourceKey,
    ...group.assetIds,
    ...group.sourceNodeIds,
    ...extractReferenceKeywords(group.title),
    ...extractReferenceKeywords(group.sourceKey),
  ])
    .map(normalizeMatchText)
    .filter((candidate) => candidate.length >= 2);
  return candidates.some((candidate) =>
    text.includes(candidate) ||
    (title.length >= 2 && text.includes(title)) ||
    (source.length >= 2 && text.includes(source))
  );
}

function extractReferenceKeywords(value: string): string[] {
  const normalized = normalizeMatchText(value);
  const keywords = [
    "手机",
    "毛绒包",
    "毛绒小包",
    "小包",
    "背包",
    "包",
    "羽绒服",
    "咖啡厅",
    "咖啡",
    "商场",
    "橱窗",
    "雪山",
    "街拍",
    "城市",
    "办公",
    "花店",
    "白棚",
    "商品台",
    "高级",
    "干净",
  ];
  return keywords.filter((keyword) => normalized.includes(keyword));
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function normalizeLlmMissingInputs(value: unknown): AgentPlanMissingInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): AgentPlanMissingInput[] => {
    if (!isRecord(entry)) return [];
    const id = getString(entry.id);
    const label = getString(entry.label);
    if (!id || !label) return [];
    const role = normalizeRole(getString(entry.role));
    return [{
      id,
      label,
      role,
      required: entry.required === true || entry.blocking === true,
      reason: getString(entry.reason) || "LLM planner marked this input as missing.",
      blocking: entry.blocking !== false,
    }];
  });
}

function mergeMissingInputs(
  deterministicInputs: AgentPlanMissingInput[],
  llmInputs: AgentPlanMissingInput[]
): AgentPlanMissingInput[] {
  const byId = new Map<string, AgentPlanMissingInput>();
  for (const input of llmInputs) byId.set(input.id, input);
  for (const input of deterministicInputs) {
    byId.set(input.id, input);
  }
  return Array.from(byId.values());
}

function withFallbackSummary(plan: AgentPlan, reason: string | undefined): AgentPlan {
  return {
    ...plan,
    summary: {
      ...plan.summary,
      fallbackUsed: Boolean(reason),
      fallbackReason: reason,
    },
  };
}

function buildRequestText(
  request: GenerationPlanDraftRequest | undefined,
  plan: GenerationPlan | undefined
): string {
  return [
    request?.request,
    request?.userRequest,
    request?.brief,
    request?.style,
    request?.outputType,
    ...(request?.platforms ?? []),
    ...(request?.outputPacks ?? []),
    plan?.campaignBible?.brief,
    plan?.campaignBible?.title,
    ...(plan?.items ?? []).flatMap((item) => [item.title, item.type, item.prompt, item.copyText]),
  ]
    .filter(Boolean)
    .map((item) => shortText(item, 240))
    .join(" ");
}

function buildSummaryText({
  selectedSkills,
  compositionMode,
  itemCount,
  missingInputs,
}: {
  selectedSkills: WorkflowSkill[];
  compositionMode: AgentPlanCompositionMode;
  itemCount: number;
  missingInputs: AgentPlanMissingInput[];
}): string {
  const skillText = selectedSkills.map((skill) => skill.shortLabel || skill.title).join(" + ") || "默认图组";
  const missingText = missingInputs.length
    ? `，缺少 ${missingInputs.map((input) => input.label).join("、")}`
    : "，输入齐全";
  return `${skillText} / ${compositionMode}：规划 ${itemCount} 个生成条目${missingText}。`;
}

function buildAssetGroupNotes(
  role: CanvasReferenceRole,
  required: boolean,
  available: boolean,
  providerUsable: boolean
): string[] {
  if (!available && required) return [`${roleLabels[role]}缺失，会阻塞依赖该角色的条目。`];
  if (!available) return [`${roleLabels[role]}未提供，当前作为可选输入。`];
  if (role === "copy") return ["文案默认进入 layout/copy layer，不直接烧进图片。"];
  if (providerUsable) return [`${roleLabels[role]}可作为 provider 图片输入。`];
  return [`${roleLabels[role]}仅作为 prompt/SOP 约束。`];
}

function bucketReferenceImagesBySource(
  images: GenerationReferenceImage[]
): GenerationReferenceImage[][] {
  const buckets = new Map<string, GenerationReferenceImage[]>();
  images.forEach((image, index) => {
    const key = image.assetId
      ? `asset:${image.assetId}`
      : image.componentId
        ? `component:${image.componentId}`
        : image.nodeId
          ? `node:${image.nodeId}`
          : `url:${image.url || index}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(image);
    buckets.set(key, bucket);
  });
  return Array.from(buckets.values());
}

function buildAssetSourceKey(
  images: GenerationReferenceImage[],
  role: CanvasReferenceRole,
  index: number
): string {
  const first = images[0];
  return first.assetId
    ? `${role}:asset:${first.assetId}`
    : first.componentId
      ? `${role}:component:${first.componentId}`
      : first.nodeId
        ? `${role}:node:${first.nodeId}`
        : `${role}:url:${shortHash(first.url || String(index))}`;
}

function slugSourceKey(sourceKey: string, index: number): string {
  const normalized = sourceKey
    .replace(/^[a-z]+:/i, "")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return normalized || `ref_${index + 1}`;
}

function selectMatrixAssetGroups({
  assetGroups,
  referenceRoles,
  index,
  productGroupCount,
  sceneGroupCount,
}: {
  assetGroups: AgentPlanAssetGroup[];
  referenceRoles: CanvasReferenceRole[];
  index: number;
  productGroupCount: number;
  sceneGroupCount: number;
}): AgentPlanAssetGroup[] {
  const selected: AgentPlanAssetGroup[] = [];
  for (const role of referenceRoles) {
    const groups = assetGroups.filter((group) => group.role === role && group.available);
    if (groups.length === 0) continue;
    if (role === "product" && groups.length > 1) {
      selected.push(groups[index % groups.length]);
      continue;
    }
    if (role === "scene" && groups.length > 1) {
      const divisor = Math.max(1, productGroupCount || 1);
      selected.push(groups[Math.floor(index / divisor) % groups.length]);
      continue;
    }
    if (role === "model" && groups.length > 1) {
      selected.push(groups[Math.floor(index / Math.max(1, productGroupCount * Math.max(1, sceneGroupCount))) % groups.length]);
      continue;
    }
    if (role === "style" || role === "copy") {
      selected.push(...groups.filter((group) => group.usage !== "missing"));
      continue;
    }
    selected.push(groups[0]);
  }
  return dedupeAssetGroups(selected);
}

function buildMatrixItemSummary(
  item: GenerationPlanItem,
  skill: WorkflowSkill | undefined,
  outputSlotLabel: string | undefined,
  referenceRoles: CanvasReferenceRole[],
  providerReferenceRoles: CanvasReferenceRole[]
): string {
  const slot = outputSlotLabel ? `${outputSlotLabel} · ` : "";
  const skillText = skill?.shortLabel ? `${skill.shortLabel} · ` : "";
  const roles = referenceRoles.length ? referenceRoles.map((role) => roleLabels[role]).join("、") : "无参考素材";
  const provider = providerReferenceRoles.length
    ? `；provider 输入 ${providerReferenceRoles.map((role) => roleLabels[role]).join("、")}`
    : "；仅 prompt/metadata 约束";
  return `${skillText}${slot}${item.title} 调用 ${roles}${provider}。`;
}

function inferSlotReferenceRoles(item: GenerationPlanItem, skill: WorkflowSkill | undefined): CanvasReferenceRole[] {
  const roles = new Set<CanvasReferenceRole>(skill?.requiredAssetRoles ?? []);
  const text = `${item.title} ${item.type} ${item.prompt}`.toLowerCase();
  if (skill?.optionalAssetRoles.includes("model") && /model|wear|look|person|模特|真人|人物|穿|上身|手持/.test(text)) {
    roles.add("model");
  }
  if (skill?.optionalAssetRoles.includes("scene") && /scene|street|cafe|room|lifestyle|场景|街拍|室内|室外|生活|空间/.test(text)) {
    roles.add("scene");
  }
  if (skill?.optionalAssetRoles.includes("style") && /style|visual|poster|campaign|风格|主视觉|海报|品牌/.test(text)) {
    roles.add("style");
  }
  if (skill?.optionalAssetRoles.includes("copy") && /copy|text|headline|feature|文案|标题|卖点|信息/.test(text)) {
    roles.add("copy");
  }
  return Array.from(roles);
}

function matchesOutputSlot(item: GenerationPlanItem, slotId: string, slotLabel: string): boolean {
  const text = `${item.itemId} ${item.title} ${item.type} ${item.metadata?.shotRole ?? ""}`.toLowerCase();
  return text.includes(slotId.toLowerCase()) || text.includes(slotLabel.toLowerCase());
}

function hasReferenceRole(
  context: GenerationReferenceContext | undefined,
  role: CanvasReferenceRole
): boolean {
  return Boolean(context?.roles[role]) || Boolean(context?.images.some((image) => image.role === role));
}

function normalizeCompositionMode(value: unknown): AgentPlanCompositionMode | undefined {
  const text = getString(value);
  const modes: AgentPlanCompositionMode[] = [
    "single_product",
    "single_product_multi_scene",
    "single_model_multi_product",
    "multi_product_separate",
    "multi_product_bundle",
    "multi_scene_variation",
    "multi_model_variation",
    "custom_matrix",
    "product_only",
    "product_model",
    "product_scene",
    "product_model_scene",
    "style_campaign",
    "copy_layout",
    "text_only",
    "unknown",
  ];
  return modes.includes(text as AgentPlanCompositionMode) ? text as AgentPlanCompositionMode : undefined;
}

function normalizeRoles(values: readonly unknown[] | undefined): CanvasReferenceRole[] {
  return uniqueStrings((values ?? []).map((value) => normalizeRole(getString(value))).filter(Boolean)) as CanvasReferenceRole[];
}

function normalizeRole(value: string): CanvasReferenceRole | undefined {
  return generationReferenceRoles.includes(value as CanvasReferenceRole)
    ? value as CanvasReferenceRole
    : undefined;
}

function parseJsonObject(text: string): object | undefined {
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    // Continue with fenced / balanced extraction.
  }

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      // Continue with balanced extraction.
    }
  }

  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1));
          return isRecord(parsed) ? parsed : undefined;
        } catch {
          start = -1;
        }
      }
    }
  }
  return undefined;
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getOptionalString(value: unknown): string | undefined {
  const text = getString(value);
  return text || undefined;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(getString).filter(Boolean);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = value?.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function dedupeAssetGroups(groups: AgentPlanAssetGroup[]): AgentPlanAssetGroup[] {
  const seen = new Set<string>();
  return groups.filter((group) => {
    if (seen.has(group.id)) return false;
    seen.add(group.id);
    return true;
  });
}

function shortHash(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function shortText(value: unknown, maxLength: number): string {
  const text = getString(value)
    .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, "[image-data]")
    .replace(/\s+/g, " ");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
