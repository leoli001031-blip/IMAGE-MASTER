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
  const baseURL = config.textBaseUrl || config.baseUrl || "https://slb.apikey.fun/v1";
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
        copyMode: resolveAgentMatrixCopyMode(item, item.referenceRoles ?? [], context.request?.copyRenderMode),
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
          providerReferenceRoles: ["optional strong provider image roles, subset of the item's reference roles; omit when deterministicPlan is already correct"],
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
      "generationMatrix 是最小 patch：每项只写 itemId、assetGroupIds、providerReferenceRoles，以及必要时的 skillId/outputSlotId。不要写 title、type、ratio、size、referenceRoles、summary、prompt。",
      "不要输出 assetGroups、deterministicPlan、references、workflowSkills、sop、imageUrls、base64、notes 或任何输入原文。",
      "必须复用输入里的 workflow skill id、plan item id、reference role。不要发明不存在的素材角色或技能。",
      "真实生成时优先让商品真实图进入 provider 输入；mock/smoke 和无 key 场景由系统兜底，不需要你处理。",
      "区分商品、模特、场景、风格、文案职责：商品锁身份，模特锁人设/身份，场景锁空间光影，风格锁完成度，文案默认是 layout/copy layer。",
      "missingInputs 只用于缺失且会阻塞生成的资产引用。不要把剩余张数、剩余模块、创作建议或可由文字生成的场景写进 missingInputs。",
      "除非用户明确要求使用已有/上传参考，model、scene、style 缺失默认是可生成或可选输入，不要设为 blocking；真实商品身份缺失才应阻塞。",
      "白底主图、Amazon 主图、尺寸图、参数图、商品多角度图这类干净商品图，providerReferenceRoles 优先只保留 product；scene/style/copy 不要进 provider。",
      "模特展示/街拍/场景搭配图才把 model 和 scene 放进 providerReferenceRoles；style 一般只做 prompt/知识约束，除非它本身就是风格资产生成任务。",
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
  const forcedSkillIds = getForcedAgentSkillIds(context, knownSkillIds);
  const selectedSkillIds = getStringArray(value.selectedSkillIds)
    .filter((id) => knownSkillIds.has(id));
  const fallbackSkillIds = deterministicPlan.selectedSkillIds;
  const explicitSkillIds = getExplicitRequestSkillIds(context);
  const mergedSkillIds = forcedSkillIds.length
    ? forcedSkillIds
    : uniqueStrings([
        ...explicitSkillIds,
        ...(selectedSkillIds.length ? selectedSkillIds : fallbackSkillIds),
      ]);
  const llmCompositionMode = normalizeCompositionMode(value.compositionMode);
  const compositionMode = forcedSkillIds.length && isConceptProductIntent(context) && !hasProviderProductReference(context)
    ? deterministicPlan.compositionMode
    : llmCompositionMode && llmCompositionMode !== "unknown"
      ? llmCompositionMode
      : deterministicPlan.compositionMode;
  const knownAssetGroupIds = new Set(deterministicPlan.assetGroups.map((group) => group.id));
  const llmMatrix = restoreDeterministicProviderRoleGuarantees(
    protectLlmMatrixReferenceRouting(
      normalizeLlmMatrix(
        value.generationMatrix,
        deterministicPlan,
        mergedSkillIds,
        knownAssetGroupIds,
        context
      ),
      deterministicPlan,
      context
    ),
    deterministicPlan,
    context
  );
  const mergedMissingInputs = mergeMissingInputs(
    deterministicPlan.missingInputs,
    normalizeLlmMissingInputs(value.missingInputs)
  )
    .map((input) => downgradeAvailableRoleMissingInput(input, deterministicPlan.assetGroups))
    .map((input) => downgradeOptionalRoleMissingInput(input, deterministicPlan.assetGroups))
    .map((input) => downgradeUnrequestedRoleMissingInput(input, deterministicPlan.assetGroups, llmMatrix));
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

function getForcedAgentSkillIds(
  context: NormalizedAgentPlanContext,
  knownSkillIds: Set<string>
): string[] {
  if (
    isConceptProductIntent(context) &&
    !hasProviderProductReference(context) &&
    knownSkillIds.has("workflow.reference_asset.v1")
  ) {
    return ["workflow.reference_asset.v1"];
  }
  return [];
}

function selectSkills(context: NormalizedAgentPlanContext): WorkflowSkill[] {
  const byId = new Map(context.skills.map((skill) => [skill.id, skill]));
  const ids = new Set<string>();
  const campaignSkillId = context.plan?.campaignBible?.workflowSkillId;

  const requestText = buildSkillSelectionText(context.request, context.plan).toLowerCase();
  const skillSelectionText = `${requestText} ${(context.plan?.items ?? [])
    .map((item) => `${item.itemId} ${item.title} ${item.type} ${item.prompt}`)
    .join(" ")
    .toLowerCase()}`;
  const suppressModelShowcase = shouldSuppressModelShowcaseSkill(skillSelectionText);
  const referenceAssetSkill = byId.get("workflow.reference_asset.v1");
  if (referenceAssetSkill && isConceptProductIntent(context) && !hasProviderProductReference(context)) {
    return [referenceAssetSkill];
  }
  if (referenceAssetSkill && isReferenceAssetWorkflowIntent(requestText)) {
    return [referenceAssetSkill];
  }

  for (const skillId of getStrongTextSkillIds(context, requestText)) {
    if (byId.has(skillId)) ids.add(skillId);
  }
  if (
    campaignSkillId &&
    byId.has(campaignSkillId) &&
    !(campaignSkillId === "workflow.model_showcase.v1" && suppressModelShowcase)
  ) {
    ids.add(campaignSkillId);
  }

  const requestPlatforms = new Set((context.request?.platforms ?? context.plan?.campaignBible?.platforms ?? [])
    .map((platform) => platform.toLowerCase()));
  const requestPacks = new Set((context.request?.outputPacks ?? context.plan?.campaignBible?.outputPacks ?? [])
    .map((pack) => pack.toLowerCase()));
  const scored = context.skills.map((skill, index) => {
    if (skill.id === "workflow.model_showcase.v1" && suppressModelShowcase) {
      return { skill, score: -999 - index * 0.001 };
    }
    let score = 0;
    if (requestPlatforms.size > 0) {
      for (const platform of skill.platforms) {
        if (requestPlatforms.has(platform.toLowerCase())) score += 12;
      }
    }
    if (requestPacks.size > 0) {
      for (const pack of skill.outputPacks) {
        if (matchesExplicitPack(requestPacks, pack)) score += 12;
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

  const selectedIds = Array.from(ids).filter((id) => {
    if (id !== "workflow.model_showcase.v1") return true;
    if (!hasExplicitNoModelIntent(requestText)) {
      return true;
    }
    const positiveText = stripExplicitNoModelPhrases(requestText);
    return /with model|model display|model_showcase|真人展示|模特展示|带模特|有人物|人物展示/.test(positiveText);
  });

  return selectedIds.map((id) => byId.get(id)).filter(Boolean) as WorkflowSkill[];
}

function getExplicitRequestSkillIds(context: NormalizedAgentPlanContext): string[] {
  const requestPlatforms = new Set((context.request?.platforms ?? [])
    .map((platform) => platform.toLowerCase()));
  const requestPacks = new Set((context.request?.outputPacks ?? [])
    .map((pack) => pack.toLowerCase()));
  const requestText = buildSkillSelectionText(context.request, context.plan).toLowerCase();
  const suppressModelShowcase = shouldSuppressModelShowcaseSkill(requestText);

  return uniqueStrings([
    ...context.skills
      .filter((skill) =>
        !(skill.id === "workflow.model_showcase.v1" && suppressModelShowcase) &&
        (skill.platforms.some((platform) => requestPlatforms.has(platform.toLowerCase())) ||
          skill.outputPacks.some((pack) => matchesExplicitPack(requestPacks, pack)))
      )
      .map((skill) => skill.id),
    ...getStrongTextSkillIds(context, requestText),
  ]);
}

function getStrongTextSkillIds(context: NormalizedAgentPlanContext, requestText: string): string[] {
  const itemText = (context.plan?.items ?? [])
    .map((item) => `${item.itemId} ${item.title} ${item.type} ${item.prompt}`)
    .join(" ")
    .toLowerCase();
  const text = `${requestText} ${itemText}`;

  return context.skills
    .filter((skill) => {
      if (skill.id === "workflow.model_showcase.v1" && shouldSuppressModelShowcaseSkill(text)) {
        return false;
      }
      return skill.platforms.some((platform) => text.includes(platform.toLowerCase())) ||
        skill.outputPacks.some((pack) => text.includes(getPackTail(pack))) ||
        skill.matchTerms.some((term) => isStrongSkillTerm(term) && text.includes(term.toLowerCase()));
    })
    .map((skill) => skill.id);
}

function matchesExplicitPack(requestPacks: Set<string>, skillPack: string): boolean {
  const normalizedSkillPack = skillPack.toLowerCase();
  for (const requestPack of requestPacks) {
    if (
      requestPack === normalizedSkillPack ||
      normalizedSkillPack.endsWith(`.${requestPack}`) ||
      normalizedSkillPack.includes(requestPack)
    ) {
      return true;
    }
  }
  return false;
}

function getPackTail(pack: string): string {
  return pack.toLowerCase().split(".").filter(Boolean).pop() ?? pack.toLowerCase();
}

function isStrongSkillTerm(term: string): boolean {
  const normalized = term.toLowerCase().trim();
  return normalized.length >= 6 || normalized === "amazon" || normalized === "taobao";
}

function buildAssetGroups(
  context: NormalizedAgentPlanContext,
  selectedSkills: WorkflowSkill[]
): AgentPlanAssetGroup[] {
  const requiredRoles = new Set<CanvasReferenceRole>();
  const optionalRoles = new Set<CanvasReferenceRole>();
  const conceptProductIntent = isConceptProductIntent(context) && !hasProviderProductReference(context);

  const addWorkflowRequiredRole = (role: CanvasReferenceRole) => {
    if (role === "product" && conceptProductIntent) {
      optionalRoles.add(role);
      return;
    }
    requiredRoles.add(role);
  };

  for (const role of context.plan?.campaignBible?.assetPolicy.requiredRoles ?? []) addWorkflowRequiredRole(role);
  for (const role of context.plan?.campaignBible?.assetPolicy.optionalRoles ?? []) optionalRoles.add(role);
  for (const role of context.request?.requiredReferenceRoles ?? []) requiredRoles.add(role);
  for (const skill of selectedSkills) {
    for (const role of skill.requiredAssetRoles) addWorkflowRequiredRole(role);
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
  const requestIntentText = buildRequestText(context.request, context.plan);

  return (context.plan?.items ?? []).map((item, index): AgentPlanGenerationMatrixItem => {
    const skill = selectedSkills.find((candidate) => itemStronglyMatchesSkill(item, candidate))
      ?? selectedSkills.find((candidate) => {
        return candidate.outputSlots.some((slot) => matchesOutputSlot(item, slot.id, slot.label));
      })
      ?? firstSkill;
    const outputSlot = skill?.outputSlots.find((slot) => matchesOutputSlot(item, slot.id, slot.label))
      ?? skill?.outputSlots[index % Math.max(1, skill.outputSlots.length)];
    const itemScopedText = `${item.title} ${item.type} ${item.copyText ?? ""}`;
    const itemText = `${requestIntentText} ${itemScopedText} ${item.prompt}`;
    const explicitRequestRouting = getExplicitRequestItemRouting(context.request, item, index);
    const requestIntentReferenceRoles = inferRequestReferenceRolesForMatrixItem(item, itemScopedText);
    const explicitItemReferenceRoles = uniqueRoles([
      ...normalizeRoles(item.referenceRoles),
      ...explicitRequestRouting.referenceRoles,
      ...requestIntentReferenceRoles,
    ]);
    const explicitRequestRoleBoundary = uniqueRoles([
      ...explicitRequestRouting.referenceRoles,
      ...explicitRequestRouting.providerReferenceRoles,
    ]);
    const inferredReferenceRoles = normalizeRoles(outputSlot
      ? inferSlotReferenceRoles(item, skill)
      : assetGroups.filter((group) => group.required).map((group) => group.role));
    const intentReferenceRoles = normalizeReferenceRolesForItemIntent(
      item,
      explicitRequestRoleBoundary.length
        ? explicitRequestRoleBoundary
        : explicitItemReferenceRoles.length
        ? uniqueRoles([...inferredReferenceRoles, ...explicitItemReferenceRoles])
        : inferredReferenceRoles,
      itemScopedText
    );
    const referenceRoles = explicitRequestRouting.referenceRoles.length
      ? uniqueRoles([...intentReferenceRoles, ...explicitRequestRouting.referenceRoles])
      : intentReferenceRoles;
    const selectedAssetGroups = selectMatrixAssetGroups({
      assetGroups: availableAssetGroups,
      referenceRoles,
      index,
      itemText,
      productGroupCount: productGroups.length,
      sceneGroupCount: sceneGroups.length,
    });
    const explicitProviderReferenceRoles = uniqueRoles([
      ...normalizeRoles(item.providerReferenceRoles),
      ...explicitRequestRouting.providerReferenceRoles,
    ])
      .filter((role) => referenceRoles.includes(role));
    const inferredProviderReferenceRoles = referenceRoles.filter((role) => {
      return selectedAssetGroups.some((group) => group.role === role && group.providerUsable) && role !== "copy";
    });
    const rawProviderReferenceRoles = explicitProviderReferenceRoles.length
      ? uniqueRoles([...inferredProviderReferenceRoles, ...explicitProviderReferenceRoles])
      : inferredProviderReferenceRoles;
    const itemMissing = missingInputs.filter((input) => {
      if (!input.role) return false;
      return referenceRoles.includes(input.role) && input.blocking;
    });
    const missingInputIds = itemMissing.map((input) => input.id);
    const status: AgentPlanGenerationMatrixItem["status"] =
      missingInputIds.some((id) => blockingMissingIds.has(id)) ? "blocked" : "ready";

    const copyMode = resolveAgentMatrixCopyMode(item, referenceRoles, context.request?.copyRenderMode);

    const matrixBase = {
      id: `matrix.${item.itemId}`,
      itemId: item.itemId,
      title: item.title,
      type: item.type,
      ratio: item.ratio,
      size: item.size,
      skillId: skill?.id,
      outputSlotId: outputSlot?.id,
      referenceRoles,
      providerReferenceRoles: rawProviderReferenceRoles,
      assetGroupIds: selectedAssetGroups.map((group) => group.id),
      promptBlockIds: uniqueStrings([
        `item.${item.itemId}`,
        ...promptBlockIds.filter((id) => id.startsWith("sop.") || id.startsWith("knowledge.") || id === "reference.context"),
      ]),
      qaRuleIds,
      copyMode,
      missingInputIds,
      status,
      summary: "",
    };
    const providerReferenceRoles = normalizeProviderReferenceRolesForItem({
      item: matrixBase,
      referenceRoles,
      providerReferenceRoles: rawProviderReferenceRoles,
      assetGroupIds: matrixBase.assetGroupIds,
      assetGroups,
    });

    return {
      ...matrixBase,
      providerReferenceRoles,
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

function getExplicitRequestItemRouting(
  request: GenerationPlanDraftRequest | undefined,
  item: GenerationPlanItem,
  index: number
): { referenceRoles: CanvasReferenceRole[]; providerReferenceRoles: CanvasReferenceRole[] } {
  const rawItems = Array.isArray(request?.items)
    ? request.items
    : Array.isArray(request?.images)
      ? request.images
      : [];
  const itemId = item.itemId;
  const raw = rawItems.find((entry) => {
    if (!isRecord(entry)) return false;
    const rawId = getString(entry.itemId) || getString(entry.id);
    return Boolean(rawId) && rawId === itemId;
  }) ?? rawItems[index];
  if (!isRecord(raw)) {
    return { referenceRoles: [], providerReferenceRoles: [] };
  }
  const metadata = isRecord(raw.metadata) ? raw.metadata : {};
  const referenceRoles = normalizeRoles([
    ...getStringArray(raw.referenceRoles),
    ...getStringArray(metadata.referenceRoles),
    ...getStringArray(raw.requiredReferenceRoles),
    ...getStringArray(metadata.requiredReferenceRoles),
  ]);
  const providerReferenceRoles = normalizeRoles([
    ...getStringArray(raw.providerReferenceRoles),
    ...getStringArray(metadata.providerReferenceRoles),
    ...getStringArray(raw.imageReferenceRoles),
    ...getStringArray(metadata.imageReferenceRoles),
  ]);
  return { referenceRoles, providerReferenceRoles };
}

function resolveAgentMatrixCopyMode(
  item: GenerationPlanItem,
  referenceRoles: CanvasReferenceRole[],
  requestedMode?: string
): string | undefined {
  const currentMode = item.copyRenderPolicy?.mode;
  const itemCopyText = `${item.title} ${item.type} ${item.prompt} ${item.copyText}`.toLowerCase();
  if (currentMode && currentMode !== "metadata_only") return currentMode;
  if (
    currentMode === "metadata_only" &&
    item.copyRenderPolicy?.requestedMode === "layout_layer" &&
    referenceRoles.includes("copy")
  ) {
    return "layout_layer";
  }
  if (currentMode) return currentMode;
  if (
    requestedMode !== "burn_in" &&
    /(?:文案|文字).{0,8}(?:不|别|不要|无需|不需要).{0,8}(?:进图|入图|烧字|烧进|写进|渲染|出字|放进图)|(?:不|别|不要|无需|不需要).{0,8}(?:文案|文字|烧字|烧进|直接出字|直接生成文字|把字放进图|把文案放进图|把文字放进图|出字|进图)/.test(itemCopyText)
  ) {
    return "layout_layer";
  }
  if (
    referenceRoles.includes("copy") &&
    item.copyText.trim() &&
    /烧进|烧字|带字|直接出字|图中文字|画面文字|封面标题|海报标题|短标题|in-image|burn[-_ ]?in|render text/.test(itemCopyText)
  ) {
    return "burn_in";
  }
  if (referenceRoles.includes("copy") && requestedMode === "layout_layer") {
    return "layout_layer";
  }
  if (
    referenceRoles.includes("copy") &&
    /后期(?:叠加|加|添加)|可编辑(?:图层|文案|文字)|文案(?:层|图层|后期)|文字后期|layout layer|copy layer/.test(itemCopyText)
  ) {
    return "layout_layer";
  }
  return currentMode;
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

  return deterministicPlan.generationMatrix.map((fallback, index) => {
    const record = value.find((entry) => isRecord(entry) && getString(entry.itemId) === fallback.itemId);
    const explicitRouting = getExplicitRequestRoutingForMatrixItem(context, fallback.itemId, index);
    const explicitRoleBoundary = uniqueRoles([
      ...fallback.referenceRoles,
      ...explicitRouting.referenceRoles,
      ...explicitRouting.providerReferenceRoles,
    ]);
    if (!isRecord(record)) {
      const referenceRoles = applyExplicitReferenceRoleBoundary(
        fallback.referenceRoles,
        explicitRoleBoundary
      );
      return {
        ...fallback,
        referenceRoles,
        providerReferenceRoles: normalizeProviderReferenceRolesForItem({
          item: fallback,
          referenceRoles,
          providerReferenceRoles: uniqueRoles([
            ...fallback.providerReferenceRoles,
            ...explicitRouting.providerReferenceRoles,
          ]),
          assetGroupIds: fallback.assetGroupIds,
          assetGroups: deterministicPlan.assetGroups,
        }),
      };
    }
    const referenceRoles = normalizeRoles(getStringArray(record.referenceRoles));
    const normalizedReferenceRoles = normalizeReferenceRolesForItemIntent(
      fallback,
      referenceRoles.length
        ? uniqueRoles([...fallback.referenceRoles, ...referenceRoles])
        : fallback.referenceRoles,
      itemTextById.get(fallback.itemId)
    );
    const effectiveReferenceRoles = preserveExplicitReferenceRoles(
      fallback,
      normalizedReferenceRoles,
      itemTextById.get(fallback.itemId)
    );
    const boundedReferenceRoles = applyExplicitReferenceRoleBoundary(
      effectiveReferenceRoles,
      explicitRoleBoundary
    );
    const providerReferenceRoles = normalizeRoles(getStringArray(record.providerReferenceRoles))
      .filter((role) => boundedReferenceRoles.includes(role));
    const skillId = getString(record.skillId);
    const outputSlotId = getOptionalString(record.outputSlotId) ?? fallback.outputSlotId;
    const assetGroupIds = getStringArray(record.assetGroupIds)
      .filter((id) => knownAssetGroupIds.has(id));
    const completeAssetGroupIds = completeAssetGroupIdsForRoles({
      selectedIds: assetGroupIds,
      fallbackIds: fallback.assetGroupIds,
      referenceRoles: boundedReferenceRoles,
      assetGroups: deterministicPlan.assetGroups,
      itemText: itemTextById.get(fallback.itemId) ?? `${fallback.title} ${fallback.type}`,
    });
    const summary = getString(record.summary) || fallback.summary;
    const base = byItemId.get(fallback.itemId) ?? fallback;
    const nextAssetGroupIds = completeAssetGroupIds;
    const nextProviderReferenceRoles = normalizeProviderReferenceRolesForItem({
      item: fallback,
      referenceRoles: boundedReferenceRoles,
      providerReferenceRoles: uniqueRoles([
        ...fallback.providerReferenceRoles,
        ...providerReferenceRoles,
        ...explicitRouting.providerReferenceRoles,
      ]),
      assetGroupIds: nextAssetGroupIds,
      assetGroups: deterministicPlan.assetGroups,
    });

    return {
      ...base,
      skillId: skillId && selectedSkillIds.includes(skillId) ? skillId : fallback.skillId,
      outputSlotId,
      referenceRoles: boundedReferenceRoles,
      providerReferenceRoles: nextProviderReferenceRoles,
      assetGroupIds: nextAssetGroupIds,
      copyMode: normalizeAgentMatrixCopyMode(getString(record.copyMode)) ?? fallback.copyMode,
      summary,
    };
  });
}

function normalizeAgentMatrixCopyMode(value: string): string | undefined {
  return value === "burn_in" || value === "layout_layer" || value === "metadata_only" ? value : undefined;
}

function protectLlmMatrixReferenceRouting(
  matrix: AgentPlanGenerationMatrixItem[],
  deterministicPlan: AgentPlan,
  context: NormalizedAgentPlanContext
): AgentPlanGenerationMatrixItem[] {
  const fallbackById = new Map(deterministicPlan.generationMatrix.map((item) => [item.itemId, item]));
  const sourceItemTextById = new Map(
    (context.plan?.items ?? []).map((item) => [
      item.itemId,
      `${item.title} ${item.type} ${item.prompt} ${item.copyText ?? ""}`,
    ])
  );
  return matrix.map((item, index) => {
    const fallback = fallbackById.get(item.itemId);
    if (!fallback) return item;
    const explicitRouting = getExplicitRequestRoutingForMatrixItem(context, item.itemId, index);
    const explicitRoleBoundary = uniqueRoles([
      ...fallback.referenceRoles,
      ...explicitRouting.referenceRoles,
      ...explicitRouting.providerReferenceRoles,
    ]);
    const itemText = [
      item.title,
      item.type,
      item.summary ?? "",
      fallback.summary ?? "",
      sourceItemTextById.get(item.itemId) ?? "",
    ].join(" ");
    const referenceRoles = applyExplicitReferenceRoleBoundary(
      preserveExplicitReferenceRoles(fallback, item.referenceRoles, itemText),
      explicitRoleBoundary
    );
    const assetGroupIds = completeAssetGroupIdsForRoles({
      selectedIds: item.assetGroupIds,
      fallbackIds: fallback.assetGroupIds,
      referenceRoles,
      assetGroups: deterministicPlan.assetGroups,
      itemText,
    });
    const providerReferenceRoles = normalizeProviderReferenceRolesForItem({
      item: {
        ...item,
        referenceRoles,
        assetGroupIds,
      },
      referenceRoles,
      providerReferenceRoles: uniqueRoles([
        ...fallback.providerReferenceRoles,
        ...item.providerReferenceRoles,
        ...explicitRouting.providerReferenceRoles,
      ]),
      assetGroupIds,
      assetGroups: deterministicPlan.assetGroups,
    });
    return {
      ...item,
      referenceRoles,
      providerReferenceRoles,
      assetGroupIds,
    };
  });
}

function restoreDeterministicProviderRoleGuarantees(
  matrix: AgentPlanGenerationMatrixItem[],
  deterministicPlan: AgentPlan,
  context: NormalizedAgentPlanContext
): AgentPlanGenerationMatrixItem[] {
  const fallbackById = new Map(deterministicPlan.generationMatrix.map((item) => [item.itemId, item]));
  const sourceItemTextById = new Map(
    (context.plan?.items ?? []).map((item) => [
      item.itemId,
      `${item.title} ${item.type} ${item.prompt} ${item.copyText ?? ""}`,
    ])
  );

  return matrix.map((item) => {
    const fallback = fallbackById.get(item.itemId);
    if (!fallback || fallback.providerReferenceRoles.length === 0) return item;
    const fallbackProviderRoles = fallback.providerReferenceRoles.filter((role) =>
      shouldRestoreDeterministicProviderRole(role, item, fallback)
    );
    if (fallbackProviderRoles.length === 0) return item;

    const referenceRoles = uniqueRoles([
      ...item.referenceRoles,
      ...fallbackProviderRoles,
    ]);
    const assetGroupIds = completeAssetGroupIdsForRoles({
      selectedIds: item.assetGroupIds,
      fallbackIds: fallback.assetGroupIds,
      referenceRoles,
      assetGroups: deterministicPlan.assetGroups,
      itemText: sourceItemTextById.get(item.itemId) ?? `${item.title} ${item.type}`,
    });
    const providerReferenceRoles = normalizeProviderReferenceRolesForItem({
      item: {
        ...item,
        referenceRoles,
        assetGroupIds,
      },
      referenceRoles,
      providerReferenceRoles: uniqueRoles([
        ...item.providerReferenceRoles,
        ...fallbackProviderRoles,
      ]),
      assetGroupIds,
      assetGroups: deterministicPlan.assetGroups,
    });

    return {
      ...item,
      referenceRoles,
      providerReferenceRoles,
      assetGroupIds,
    };
  });
}

function shouldRestoreDeterministicProviderRole(
  role: CanvasReferenceRole,
  item: AgentPlanGenerationMatrixItem,
  fallback: AgentPlanGenerationMatrixItem
): boolean {
  if (role === "model") {
    const referenceRoles = uniqueRoles([...item.referenceRoles, ...fallback.referenceRoles]);
    return shouldForceModelProviderReference(
      {
        ...item,
        referenceRoles,
        summary: `${item.summary ?? ""} ${fallback.summary ?? ""}`,
      },
      referenceRoles
    );
  }
  return true;
}

function getExplicitRequestRoutingForMatrixItem(
  context: NormalizedAgentPlanContext,
  itemId: string,
  index: number
): { referenceRoles: CanvasReferenceRole[]; providerReferenceRoles: CanvasReferenceRole[] } {
  const items = context.plan?.items ?? [];
  const sourceItem = items.find((item) => item.itemId === itemId) ?? items[index];
  if (!sourceItem) return { referenceRoles: [], providerReferenceRoles: [] };
  return getExplicitRequestItemRouting(context.request, sourceItem, index);
}

function applyExplicitReferenceRoleBoundary(
  roles: CanvasReferenceRole[],
  explicitRoleBoundary: CanvasReferenceRole[]
): CanvasReferenceRole[] {
  if (explicitRoleBoundary.length === 0) return roles;
  const filtered = roles.filter((role) => explicitRoleBoundary.includes(role));
  return filtered.length ? uniqueRoles(filtered) : roles;
}

function normalizeProviderReferenceRolesForItem({
  item,
  referenceRoles,
  providerReferenceRoles,
  assetGroupIds,
  assetGroups,
}: {
  item: AgentPlanGenerationMatrixItem;
  referenceRoles: CanvasReferenceRole[];
  providerReferenceRoles: CanvasReferenceRole[];
  assetGroupIds: string[];
  assetGroups: AgentPlanAssetGroup[];
}): CanvasReferenceRole[] {
  const selectedGroups = assetGroups.filter((group) => assetGroupIds.includes(group.id));
  const providerUsableRoles = new Set(
    selectedGroups
      .filter((group) => group.providerUsable)
      .map((group) => group.role)
  );
  const allowStyleProvider = shouldAllowStyleProviderReference(item, referenceRoles);
  const forceSceneProvider = shouldForceSceneProviderReference(item, referenceRoles) && providerUsableRoles.has("scene");
  const forceModelProvider = shouldForceModelProviderReference(item, referenceRoles) && providerUsableRoles.has("model");
  const cleanRoles = uniqueRoles(providerReferenceRoles)
    .filter((role) => role !== "copy")
    .filter((role) => role !== "style" || allowStyleProvider)
    .filter((role) => referenceRoles.includes(role))
    .filter((role) => providerUsableRoles.has(role));

  if (isCleanProductIdentityItem(item) && referenceRoles.includes("product") && providerUsableRoles.has("product")) {
    return ["product"];
  }

  if (cleanRoles.length > 0) {
    return uniqueRoles([
      ...cleanRoles,
      ...(forceModelProvider ? ["model" as const] : []),
      ...(forceSceneProvider ? ["scene" as const] : []),
    ]);
  }

  const fallbackRoles = uniqueRoles(referenceRoles)
    .filter((role) => role !== "copy")
    .filter((role) => role !== "style" || allowStyleProvider)
    .filter((role) => providerUsableRoles.has(role));
  return uniqueRoles([
    ...fallbackRoles,
    ...(forceModelProvider ? ["model" as const] : []),
    ...(forceSceneProvider ? ["scene" as const] : []),
  ]);
}

function uniqueRoles(roles: CanvasReferenceRole[]): CanvasReferenceRole[] {
  return generationReferenceRoles.filter((role) => roles.includes(role));
}

function normalizeReferenceRolesForItemIntent(
  item: { title: string; type: string; summary?: string },
  roles: CanvasReferenceRole[],
  itemText = ""
): CanvasReferenceRole[] {
  const normalized = uniqueRoles(roles);
  if (shouldUseProductOnlyReferences(item, itemText)) {
    return normalized.filter((role) => role === "product" || role === "copy");
  }
  if (shouldDropModelReferenceForProductDetail(item, itemText)) {
    return normalized.filter((role) => role !== "model");
  }
  if (shouldDropSceneReferenceForProductDetail(item, itemText)) {
    return normalized.filter((role) => role !== "scene");
  }
  return normalized;
}

function preserveExplicitReferenceRoles(
  item: AgentPlanGenerationMatrixItem,
  roles: CanvasReferenceRole[],
  itemText = ""
): CanvasReferenceRole[] {
  const text = `${item.title} ${item.type} ${item.summary ?? ""} ${itemText}`.toLowerCase();
  const protectedRoles = item.referenceRoles.filter((role) => {
    if (role !== "model") return true;
    return !hasExplicitNoModelIntent(text) && !(
      hasProductExplanationIntent(text) && !hasConcreteModelShotIntent(text)
    );
  });
  return uniqueRoles([...roles, ...protectedRoles]);
}

function inferRequestReferenceRolesForMatrixItem(
  item: { title: string; type: string; summary?: string },
  itemText: string
): CanvasReferenceRole[] {
  const text = itemText.toLowerCase();
  const labelText = `${item.title} ${item.type} ${item.summary ?? ""}`.toLowerCase();
  const roles: CanvasReferenceRole[] = [];

  const productOnlyLabel = /white[-_ ]?main|white[-_ ]?background|product[-_ ]?only|product[-_ ]?detail|product[-_ ]?macro|detail[-_ ]?page|benefit[-_ ]?poster|feature[-_ ]?poster|material|dimension|尺寸|参数|多角度|详情页|详情|卖点海报|卖点图|材质|细节|微距|白底|纯白/.test(labelText);
  const modelFriendlyLabel = /cover|poster|scene|lifestyle|use|model|look|hero|封面|海报|场景|生活|模特|展示|街拍/.test(labelText);
  if (!productOnlyLabel && modelFriendlyLabel && hasExplicitModelIdentityIntent(text)) {
    roles.push("model");
  }
  if (/scene|lifestyle|street|indoor|outdoor|room|cafe|shop|mall|florist|背景|场景|街拍|室内|室外|生活|空间|花店|商场|咖啡/.test(text)) {
    roles.push("scene");
  }
  if (/style|campaign|poster|hero|visual|brand|mood|风格|海报|主视觉|品牌|氛围|质感/.test(text)) {
    roles.push("style");
  }
  if (/copy|text|headline|feature|info|selling|claim|burn[-_ ]?in|文案|标题|卖点|信息|参数|烧字|烧进|带字/.test(text)) {
    roles.push("copy");
  }
  return uniqueRoles(roles);
}

function shouldDropSceneReferenceForProductDetail(
  item: { title: string; type: string; summary?: string },
  itemText = ""
): boolean {
  const text = `${item.title} ${item.type} ${item.summary ?? ""} ${itemText}`.toLowerCase();
  if (!/product_detail|product_macro|material|texture|macro|材质|细节|微距|纹理/.test(text)) {
    return false;
  }
  return !/product_scene|scene|lifestyle|环境|场景|台面|桌面|背景|生活方式|空间|花店|咖啡|商场|街拍/.test(text);
}

function shouldDropModelReferenceForProductDetail(
  item: { title: string; type: string; summary?: string },
  itemText = ""
): boolean {
  const text = `${item.title} ${item.type} ${item.summary ?? ""} ${itemText}`.toLowerCase();
  if (hasExplicitNoModelIntent(text)) return true;
  if (hasProductExplanationIntent(text) && !hasConcreteModelShotIntent(text)) {
    return true;
  }
  if (!/product_detail|product_macro|material|texture|macro|detail|材质|细节|微距|纹理|静物/.test(text)) {
    return false;
  }
  return !hasExplicitModelIdentityIntent(text);
}

function hasProductExplanationIntent(text: string): boolean {
  return /product_detail|product_feature|product_macro|detail[-_ ]?page|benefit[-_ ]?poster|feature[-_ ]?poster|selling[-_ ]?point|material|texture|macro|详情页|详情|卖点海报|卖点图|材质|细节|微距|纹理|参数|尺寸|静物/.test(text);
}

function hasConcreteModelShotIntent(text: string): boolean {
  return /model_showcase|model_product_scene|lookbook|portrait|street[-_ ]?style|wearing|holding|模特展示|模特图|街拍|真人|人物|人像|穿搭|上身|背着|手持|佩戴|站立|侧身|回头|边走|行走|坐在|坐姿|半蹲|低头|看镜头|看橱窗|拿花|整理|扶|托脸/.test(text);
}

function shouldUseProductOnlyReferences(
  item: { title: string; type: string; summary?: string },
  itemText = ""
): boolean {
  const labelText = `${item.title} ${item.type} ${item.summary ?? ""}`.toLowerCase();
  const fullText = `${labelText} ${itemText}`.toLowerCase();
  if (!hasExplicitNoModelIntent(fullText) && hasExplicitModelIdentityIntent(fullText)) {
    return false;
  }
  if (/amazon\s*main|marketplace[-_ ]?main|white[-_ ]?main|product[-_ ]?white|product[-_ ]?only|packshot|ecommerce[-_ ]?main|淘宝主图|商品主图|主图风格|白底|纯白|主图|商品正面主图/.test(labelText)) {
    return true;
  }
  return hasExplicitNoModelIntent(fullText) &&
    /white[-_ ]?background|pure white|白底|纯白|主图|packshot|product[-_ ]?only|无场景|no scene/.test(fullText);
}

function hasExplicitNoModelIntent(text: string): boolean {
  return /no model|no person|without model|without person|product[-_ ]?only|纯商品图?|只要商品图?|商品静物|无模特|无人物|不要模特|不要人物|不需要模特|不需要人物|不用模特|不用人物|不带模特|不带人物|不要使用模特|不要使用人物|无需模特|无需人物|模特不要|人物不要/.test(text);
}

function stripExplicitNoModelPhrases(text: string): string {
  return text.replace(
    /no model|no person|without model|without person|product[-_ ]?only|纯商品图?|只要商品图?|商品静物|无模特|无人物|不要模特|不要人物|不需要模特|不需要人物|不用模特|不用人物|不带模特|不带人物|不要使用模特|不要使用人物|无需模特|无需人物|模特不要|人物不要/g,
    " "
  );
}

function shouldSuppressModelShowcaseSkill(text: string): boolean {
  if (!hasExplicitNoModelIntent(text)) return false;
  const positiveText = stripExplicitNoModelPhrases(text);
  return !(
    hasConcreteModelShotIntent(positiveText) ||
    /model|person|human|wearing|lookbook|model_showcase|模特|人物|真人|女性|男性|同一个人|人像|穿搭|背着展示|佩戴展示|上身展示/.test(positiveText)
  );
}

function hasExplicitModelIdentityIntent(text: string): boolean {
  if (hasExplicitNoModelIntent(text)) return false;
  return /model|person|human|wearing|lookbook|model_showcase|模特|人物|真人|女性|男性|同一个人|人像|穿搭|背着展示|佩戴展示|上身展示/.test(text);
}

function isCleanProductIdentityItem(item: AgentPlanGenerationMatrixItem): boolean {
  const text = `${item.title} ${item.type} ${item.summary ?? ""}`.toLowerCase();
  return /amazon|white|白底|合规主图|尺寸|参数|dimension|dimensions|multi[-_ ]?view|多角度|product_dimensions|product_white|white_sheet|product_multiview/.test(text);
}

function shouldAllowStyleProviderReference(
  item: AgentPlanGenerationMatrixItem,
  referenceRoles: CanvasReferenceRole[]
): boolean {
  const typeText = `${item.title} ${item.type}`.toLowerCase();
  if (/style_asset|visual_style|style[-_ ]?plate|moodboard|风格资产|风格板/.test(typeText)) {
    return true;
  }
  if (/product_feature|product_detail|product_macro|feature|detail|material|macro|卖点|细节|材质|详情页卖点|微距/.test(typeText)) {
    return false;
  }
  if (referenceRoles.includes("scene")) return false;
  return true;
}

function shouldForceSceneProviderReference(
  item: AgentPlanGenerationMatrixItem,
  referenceRoles: CanvasReferenceRole[]
): boolean {
  if (!referenceRoles.includes("scene")) return false;
  if (isCleanProductIdentityItem(item)) return false;
  const text = `${item.title} ${item.type} ${item.summary ?? ""}`.toLowerCase();
  return /scene|lifestyle|street|cover|poster|hero|model_product_scene|product_scene|场景|街拍|生活|封面|海报|主视觉|花店|咖啡|卧室|露营|厨房|办公桌|客厅/.test(text);
}

function shouldForceModelProviderReference(
  item: AgentPlanGenerationMatrixItem,
  referenceRoles: CanvasReferenceRole[]
): boolean {
  if (!referenceRoles.includes("model")) return false;
  if (isCleanProductIdentityItem(item)) return false;
  const text = `${item.title} ${item.type} ${item.summary ?? ""}`.toLowerCase();
  if (hasProductExplanationIntent(text) && !hasConcreteModelShotIntent(text)) {
    return false;
  }
  if (/product_detail|product_macro|product_dimensions|material|macro|detail|尺寸|参数|多角度|材质|细节|微距|静物|白底/.test(text)) {
    return false;
  }
  return true;
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
  const roleById = new Map(assetGroups.map((group) => [group.id, group.role]));
  const neededRoles = new Set(referenceRoles);
  const filteredFallbackIds = fallbackIds.filter((id) => {
    const role = roleById.get(id);
    return role ? neededRoles.has(role) : false;
  });
  if (selectedIds.length === 0) return filteredFallbackIds;
  const selected = selectedIds.filter((id) => {
    const role = roleById.get(id);
    return role ? neededRoles.has(role) : false;
  });
  const selectedRoles = new Set(
    selected
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

  const repaired = repairExplicitAssetGroupSelections({
    selectedIds: uniqueStrings(selected),
    referenceRoles,
    assetGroups,
    itemText,
  });
  return repaired.length ? repaired : filteredFallbackIds;
}

function assetGroupLooksExplicitlyMentioned(group: AgentPlanAssetGroup, itemText: string): boolean {
  return scoreAssetGroupAgainstItem(group, itemText) > 0;
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
    if (!role) return [];
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

function downgradeAvailableRoleMissingInput(
  input: AgentPlanMissingInput,
  assetGroups: AgentPlanAssetGroup[]
): AgentPlanMissingInput {
  if (!input.blocking || !input.role) return input;
  const hasAvailableRole = assetGroups.some((group) => group.role === input.role && group.available);
  if (!hasAvailableRole) return input;
  return {
    ...input,
    required: false,
    blocking: false,
    reason: `${input.reason} 已有可用${roleLabels[input.role]}资产，因此该项仅作为补充建议，不阻断生成。`,
  };
}

function downgradeOptionalRoleMissingInput(
  input: AgentPlanMissingInput,
  assetGroups: AgentPlanAssetGroup[]
): AgentPlanMissingInput {
  if (!input.blocking || !input.role) return input;
  const roleIsRequiredByAssets = assetGroups.some((group) => group.role === input.role && group.required);
  if (roleIsRequiredByAssets) return input;
  return {
    ...input,
    required: false,
    blocking: false,
    reason: `${input.reason} ${roleLabels[input.role]}不是当前计划的硬性锁定输入，因此只作为补充建议，不阻断生成。`,
  };
}

function downgradeUnrequestedRoleMissingInput(
  input: AgentPlanMissingInput,
  assetGroups: AgentPlanAssetGroup[],
  generationMatrix: AgentPlanGenerationMatrixItem[]
): AgentPlanMissingInput {
  if (!input.blocking || !input.role) return input;
  const roleIsRequiredByAssets = assetGroups.some((group) => group.role === input.role && group.required);
  const roleIsUsedByPlan = generationMatrix.some((item) => item.referenceRoles.includes(input.role!));
  if (roleIsRequiredByAssets || roleIsUsedByPlan) return input;
  return {
    ...input,
    required: false,
    blocking: false,
    reason: `${input.reason} 当前计划没有把${roleLabels[input.role]}列为必要引用，因此只作为补充建议，不阻断生成。`,
  };
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
    request?.projectStarterPrompt,
    request?.projectIntent,
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

function buildSkillSelectionText(
  request: GenerationPlanDraftRequest | undefined,
  plan: GenerationPlan | undefined
): string {
  return [
    request?.projectStarterPrompt,
    request?.projectIntent,
    request?.request,
    request?.userRequest,
    request?.brief,
    request?.style,
    request?.outputType,
    ...(request?.platforms ?? []),
    ...(request?.outputPacks ?? []),
    ...(plan?.items ?? []).flatMap((item) => [item.title, item.type, item.prompt, item.copyText]),
  ]
    .filter(Boolean)
    .map((item) => shortText(item, 240))
    .join(" ");
}

function isConceptProductIntent(context: NormalizedAgentPlanContext): boolean {
  const text = buildRequestText(context.request, context.plan).toLowerCase();
  return /concept_product|concept product|concept mockup|概念商品|概念产品|方向探索|不是(?:真实|实物)?商品投放|非真实商品|无真实商品/.test(text);
}

function hasProviderProductReference(context: NormalizedAgentPlanContext): boolean {
  if (context.request?.productImageBase64) return true;
  return Boolean(
    context.referenceContext?.images.some((image) => image.role === "product" && image.providerUsable)
  );
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
  const hash = shortHash(sourceKey).slice(0, 8);
  const maxBaseLength = Math.max(1, 48 - hash.length - 1);
  const base = normalized.slice(0, maxBaseLength).replace(/_+$/g, "") || `ref_${index + 1}`;
  return `${base}_${hash}`;
}

function selectMatrixAssetGroups({
  assetGroups,
  referenceRoles,
  index,
  itemText,
  productGroupCount,
  sceneGroupCount,
}: {
  assetGroups: AgentPlanAssetGroup[];
  referenceRoles: CanvasReferenceRole[];
  index: number;
  itemText: string;
  productGroupCount: number;
  sceneGroupCount: number;
}): AgentPlanAssetGroup[] {
  const selected: AgentPlanAssetGroup[] = [];
  for (const role of referenceRoles) {
    const groups = assetGroups.filter((group) => group.role === role && group.available);
    if (groups.length === 0) continue;
    if ((role === "product" || role === "scene" || role === "model") && groups.length > 1) {
      const explicitGroup = findExplicitAssetGroupForItem(groups, itemText);
      if (explicitGroup) {
        selected.push(explicitGroup);
        continue;
      }
    }
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

function repairExplicitAssetGroupSelections({
  selectedIds,
  referenceRoles,
  assetGroups,
  itemText,
}: {
  selectedIds: string[];
  referenceRoles: CanvasReferenceRole[];
  assetGroups: AgentPlanAssetGroup[];
  itemText: string;
}): string[] {
  let next = [...selectedIds];
  for (const role of ["product", "model", "scene"] as const) {
    if (!referenceRoles.includes(role)) continue;
    const groups = assetGroups.filter((group) => group.role === role && group.available);
    if (groups.length < 2) continue;
    const explicitGroup = findExplicitAssetGroupForItem(groups, itemText);
    if (!explicitGroup) continue;
    const roleGroupIds = new Set(groups.map((group) => group.id));
    next = next.filter((id) => !roleGroupIds.has(id));
    next.push(explicitGroup.id);
  }
  return uniqueStrings(next);
}

function findExplicitAssetGroupForItem(
  groups: AgentPlanAssetGroup[],
  itemText: string
): AgentPlanAssetGroup | undefined {
  const scored = groups
    .map((group, index) => ({
      group,
      index,
      score: scoreAssetGroupAgainstItem(group, itemText),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (scored.length === 0) return undefined;
  if (scored.length > 1 && scored[0].score === scored[1].score) return undefined;
  return scored[0].group;
}

function scoreAssetGroupAgainstItem(group: AgentPlanAssetGroup, itemText: string): number {
  const text = normalizeMatchText(itemText);
  if (!text) return 0;
  let score = 0;
  const candidates = uniqueStrings([
    group.title,
    group.sourceKey,
    ...group.assetIds,
    ...group.componentIds,
    ...group.sourceNodeIds,
    ...extractReferenceKeywords(group.title),
    ...extractReferenceKeywords(group.sourceKey),
  ])
    .map(normalizeMatchText)
    .filter((candidate) => candidate.length >= 2);

  for (const candidate of candidates) {
    if (!text.includes(candidate)) continue;
    score += candidate.length >= 4 ? 12 + candidate.length : 4 + candidate.length;
    if (hasPrimarySubjectCue(text, candidate)) score += 40;
    if (hasSecondarySubjectCue(text, candidate)) score -= 18;
  }
  if (group.role === "product") {
    const groupText = normalizeMatchText(`${group.title} ${group.sourceKey}`);
    if (/(包|bag|tote|handbag)/.test(groupText) && /(背包|挎包|拿包|手提包|托特包|小包|拎包)/.test(text)) {
      score += 24;
    }
    if (/(手机|phone)/.test(groupText) && /(手机为主|以手机为主|手机.*主体|手机.*主视觉)/.test(text)) {
      score += 36;
    }
  }
  return score;
}

function hasPrimarySubjectCue(text: string, candidate: string): boolean {
  const escaped = escapeRegExp(candidate);
  return new RegExp(`(?:以)?${escaped}(?:为主|作为主体|是主体|主视觉|居中靠前|主体)`).test(text) ||
    new RegExp(`(?:主体|主商品|主视觉)(?:是|为)?${escaped}`).test(text);
}

function hasSecondarySubjectCue(text: string, candidate: string): boolean {
  const escaped = escapeRegExp(candidate);
  return new RegExp(`${escaped}(?:作为)?(?:活动)?(?:氛围)?点缀`).test(text) ||
    new RegExp(`(?:背景|手边|旁边|橱窗|点缀).{0,18}${escaped}`).test(text) ||
    new RegExp(`${escaped}.{0,18}(?:背景|点缀|橱窗)`).test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function itemStronglyMatchesSkill(item: GenerationPlanItem, skill: WorkflowSkill): boolean {
  const text = `${item.itemId} ${item.title} ${item.type} ${item.prompt} ${item.metadata?.shotRole ?? ""}`.toLowerCase();
  return skill.platforms.some((platform) => text.includes(platform.toLowerCase())) ||
    skill.matchTerms.some((term) => isStrongSkillTerm(term) && text.includes(term.toLowerCase()));
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
