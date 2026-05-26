import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import type { GenerationPlanItem, SopExecutionPlan } from "@/lib/canvas/generation-plan";
import {
  type GenerationReferenceContext,
  type GenerationReferenceRole,
  buildProviderReferenceAdapter,
  generationReferenceRoles,
  normalizeGenerationReferenceContext,
} from "@/lib/canvas/generation-reference-context";
import { getConfig } from "@/lib/store/config-store";

export type AssetInvocationMode =
  | "hard_reference"
  | "identity_reference"
  | "lighting_space"
  | "style_finish"
  | "copy_layer"
  | "prompt_only"
  | "unused";

export interface AssetInvocationDecision {
  role: GenerationReferenceRole;
  mode: AssetInvocationMode;
  providerInput: boolean;
  reason: string;
}

export interface AssetInvocationPlan {
  version: 1;
  mode: "llm_asset_invocation_v1" | "fallback_existing_roles_v1";
  fallbackUsed: boolean;
  fallbackReason?: string;
  referenceRoles: GenerationReferenceRole[];
  providerReferenceRoles: GenerationReferenceRole[];
  decisions: AssetInvocationDecision[];
  unusedRoles: GenerationReferenceRole[];
  notes: string[];
}

interface AssetInvocationPlannerInput {
  item: GenerationPlanItem;
  referenceContext?: GenerationReferenceContext;
  userRequest?: string;
  sopExecutionPlan?: SopExecutionPlan;
}

const plannerMaxTokens = Math.max(
  1000,
  Math.min(
    4000,
    Math.floor(Number(process.env.IMAGE_MASTER_ASSET_INVOCATION_PLANNER_MAX_TOKENS || 2000) || 2000)
  )
);

const modeByRole: Record<GenerationReferenceRole, AssetInvocationMode> = {
  product: "hard_reference",
  model: "identity_reference",
  scene: "lighting_space",
  style: "style_finish",
  copy: "copy_layer",
};

export async function planAssetInvocation(
  input: AssetInvocationPlannerInput
): Promise<AssetInvocationPlan> {
  const normalizedContext = normalizeGenerationReferenceContext(input.referenceContext);
  const fallback = buildFallbackPlan(input.item, normalizedContext);

  if (!shouldUseAiPlanner()) {
    return {
      ...fallback,
      fallbackReason: getPlannerDisabledReason(),
    };
  }

  const availableRoles = getAvailableRoles(input.item, normalizedContext);
  if (availableRoles.length === 0) {
    return {
      ...fallback,
      fallbackReason: "No available reference roles to plan",
    };
  }

  try {
    const aiPlan = await runPlanner(input, normalizedContext, availableRoles);
    return normalizeAiPlan(aiPlan, fallback, normalizedContext, availableRoles, input.item);
  } catch (error) {
    if (!allowAssetInvocationFallback()) {
      throw error;
    }
    return {
      ...fallback,
      fallbackReason: error instanceof Error ? error.message : "Asset invocation planner failed",
    };
  }
}

function allowAssetInvocationFallback(): boolean {
  return process.env.IMAGE_MASTER_ALLOW_ASSET_INVOCATION_FALLBACK === "1";
}

function shouldUseAiPlanner(): boolean {
  if (process.env.IMAGE_MASTER_DISABLE_ASSET_INVOCATION_PLANNER === "1") return false;
  if (process.env.IMAGE_MASTER_DISABLE_AI_PROMPT_WRITER === "1") return false;
  if (
    process.env.IMAGE_MASTER_ENABLE_MOCK_BATCH === "1" ||
    process.env.IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER === "1"
  ) {
    return false;
  }
  return true;
}

function getPlannerDisabledReason(): string {
  if (process.env.IMAGE_MASTER_DISABLE_ASSET_INVOCATION_PLANNER === "1") {
    return "Asset invocation planner explicitly disabled";
  }
  if (process.env.IMAGE_MASTER_DISABLE_AI_PROMPT_WRITER === "1") {
    return "AI planner disabled with prompt writer opt-out";
  }
  if (
    process.env.IMAGE_MASTER_ENABLE_MOCK_BATCH === "1" ||
    process.env.IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER === "1"
  ) {
    return "Mock/smoke mode avoids text LLM calls";
  }
  return "Asset invocation planner unavailable";
}

function buildFallbackPlan(
  item: GenerationPlanItem,
  context: GenerationReferenceContext | undefined
): AssetInvocationPlan {
  const referenceRoles = normalizeRoles(
    item.referenceRoles?.length ? item.referenceRoles : getContextRoles(context)
  );
  const providerReferenceRoles = normalizeRoles(
    item.providerReferenceRoles?.length ? item.providerReferenceRoles : referenceRoles
  ).filter((role) => role !== "copy" && referenceRoles.includes(role));
  const roleSet = new Set(referenceRoles);
  const providerRoleSet = new Set(providerReferenceRoles);
  const allRoles = uniqueRoles([...referenceRoles, ...getContextRoles(context)]);

  return {
    version: 1,
    mode: "fallback_existing_roles_v1",
    fallbackUsed: true,
    referenceRoles,
    providerReferenceRoles,
    decisions: allRoles.map((role) => ({
      role,
      mode: roleSet.has(role) ? modeByRole[role] : "unused",
      providerInput: providerRoleSet.has(role),
      reason: roleSet.has(role)
        ? "沿用现有计划中的参考角色"
        : "当前镜头未调用该素材角色",
    })),
    unusedRoles: allRoles.filter((role) => !roleSet.has(role)),
    notes: ["规则计划仅作为 mock/smoke 或 LLM 失败兜底。"],
  };
}

async function runPlanner(
  input: AssetInvocationPlannerInput,
  context: GenerationReferenceContext | undefined,
  availableRoles: GenerationReferenceRole[]
): Promise<unknown> {
  const config = getConfig();
  const apiKey = config.textApiKey || config.apiKey;
  const baseURL = config.textBaseUrl || config.baseUrl || "https://api.openai.com/v1";
  if (!apiKey) throw new Error("Text API key not configured");

  const provider = createOpenAI({ apiKey, baseURL });
  const adapter = buildProviderReferenceAdapter(context);
  const payload = {
    userRequest: shortText(input.userRequest, 500),
    shot: {
      itemId: input.item.itemId,
      title: input.item.title,
      type: input.item.type,
      ratio: input.item.ratio,
      size: input.item.size,
      sourcePrompt: shortText(input.item.prompt, 900),
      copyText: shortText(input.item.copyText, 280),
      textAllowed: input.item.textAllowed === true,
      productReferenceFocus: input.item.productReferenceFocus,
      existingReferenceRoles: input.item.referenceRoles ?? [],
      existingProviderReferenceRoles: input.item.providerReferenceRoles ?? [],
    },
    availableAssets: availableRoles.map((role) => ({
      role,
      roleContextTitle: context?.roles[role]?.title,
      imageCount: context?.images.filter((image) => image.role === role).length ?? 0,
      providerUsableImageCount:
        adapter.providerUsableImages.filter((image) => image.role === role).length,
      promptOnlyImageCount:
        adapter.promptOnlyImages.filter((image) => image.role === role).length,
      promptFragments: context?.roles[role]?.promptFragments.slice(0, 4).map((line) => shortText(line, 160)) ?? [],
      constraints: context?.roles[role]?.constraints.slice(0, 4).map((line) => shortText(line, 160)) ?? [],
    })),
    sop: {
      keys: input.sopExecutionPlan?.debugSource?.sopKeys?.slice(0, 8) ?? [],
      promptBlocks: input.sopExecutionPlan?.promptBlocks?.slice(0, 5).map((block) => ({
        id: block.id,
        title: block.title,
        content: block.content.slice(0, 4).map((line) => shortText(line, 160)),
      })),
    },
    outputSchema: {
      decisions: [
        {
          role: "product|model|scene|style|copy",
          mode: "hard_reference|identity_reference|lighting_space|style_finish|copy_layer|prompt_only|unused",
          providerInput: "boolean",
          reason: "short Chinese reason",
        },
      ],
      notes: ["short Chinese note"],
    },
  };

  const result = await generateText({
    model: provider(config.textModel || "gpt-4o"),
    system: [
      "你是商业图像工作流里的素材调用规划 Agent。",
      "你只决定当前这一张图要调用哪些已上传素材，以及每个素材是进入 provider 图片输入，还是只作为文字/知识约束。",
      "不要写最终生图 prompt；不要生成新素材；不要新增用户没有提供的参考角色。",
      "商品真实图：如果当前镜头需要展示真实商品，并且 product 有 provider 可用图片，product 必须 providerInput=true，mode=hard_reference。",
      "模特图：只在当前镜头需要真人/穿搭/手持/佩戴时调用；mode=identity_reference。不要因为有模特素材就让所有商品静物图都锁模特。",
      "场景图：只在当前镜头需要同空间、同光影或场景延展时 providerInput=true；否则可以 prompt_only。",
      "风格图：通常只提供质感、色调和镜头语言，不要覆盖商品/模特/场景事实。",
      "文案图：copy 默认不能 providerInput，除非系统以后显式支持文字图层图片输入；现在作为 copy_layer 或 prompt_only。",
      "如果 existingProviderReferenceRoles 里已有 product/model/scene，且镜头要求同一身份、同一场景、保持或延续参考，则不要降级为 unused 或 prompt_only。",
      "如果是白底主图、多角度商品图、细节图、参数图，不要调用模特。",
      "如果是模特展示、街拍、场景搭配图，优先调用 product + model，并按需要调用 scene/style。",
      "输出严格 JSON，不要 markdown。"
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: JSON.stringify(payload),
      },
    ],
    temperature: 0.2,
    maxTokens: plannerMaxTokens,
  });

  const parsed = tryParsePlannerJson(result.text || "");
  if (parsed) return parsed;

  const repaired = await generateText({
    model: provider(config.textModel || "gpt-4o"),
    system: [
      "把用户提供的素材调用规划内容转换为严格 JSON。",
      "只输出一个 JSON object，不要 markdown，不要解释。",
      "JSON 顶层必须包含 decisions 和 notes。",
      "decisions 里的 role 只能是 product/model/scene/style/copy。",
      "mode 只能是 hard_reference/identity_reference/lighting_space/style_finish/copy_layer/prompt_only/unused。",
      "providerInput 必须是 boolean。"
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          originalPlannerOutput: result.text || "",
          availableRoles,
          schema: payload.outputSchema,
        }),
      },
    ],
    temperature: 0,
    maxTokens: plannerMaxTokens,
  });

  const repairedParsed = tryParsePlannerJson(repaired.text || "");
  if (!repairedParsed) throw new Error("Asset invocation planner returned non-JSON output");
  return repairedParsed;
}

function normalizeAiPlan(
  value: unknown,
  fallback: AssetInvocationPlan,
  context: GenerationReferenceContext | undefined,
  availableRoles: GenerationReferenceRole[],
  item: GenerationPlanItem
): AssetInvocationPlan {
  if (!isRecord(value)) throw new Error("Asset invocation planner returned invalid JSON");

  const availableSet = new Set(availableRoles);
  const decisions = Array.isArray(value.decisions)
    ? value.decisions.flatMap((entry): AssetInvocationDecision[] => {
        if (!isRecord(entry)) return [];
        const role = normalizeRole(entry.role);
        if (!role || !availableSet.has(role)) return [];
        const mode = normalizeMode(entry.mode) ?? modeByRole[role];
        const providerInput = role !== "copy" && isTruthyProviderInput(entry.providerInput) && hasProviderUsableRole(context, role);
        return [{
          role,
          mode: providerInput && mode === "unused" ? modeByRole[role] : mode,
          providerInput,
          reason: shortText(entry.reason, 160) || "Agent 选择该素材调用方式",
        }];
      })
    : [];

  if (decisions.length === 0) {
    throw new Error("Asset invocation planner returned no usable decisions");
  }

  const decisionsByRole = new Map<GenerationReferenceRole, AssetInvocationDecision>();
  for (const decision of decisions) decisionsByRole.set(decision.role, decision);
  for (const role of availableRoles) {
    if (!decisionsByRole.has(role)) {
      decisionsByRole.set(role, {
        role,
        mode: "unused",
        providerInput: false,
        reason: "当前镜头不需要调用该素材",
      });
    }
  }

  const enforcedProviderRoles = getCriticalProviderRoles(item, fallback, context, availableRoles);
  for (const role of enforcedProviderRoles) {
    const previous = decisionsByRole.get(role);
    decisionsByRole.set(role, {
      role,
      mode: modeByRole[role],
      providerInput: true,
      reason: previous?.providerInput
        ? previous.reason
        : "镜头明确要求保持该参考素材，保留为 provider 输入",
    });
  }

  const finalDecisions = Array.from(decisionsByRole.values());
  const referenceRoles = uniqueRoles(
    finalDecisions
      .filter((decision) => decision.mode !== "unused" || decision.providerInput)
      .map((decision) => decision.role)
  );
  const providerReferenceRoles = uniqueRoles(
    finalDecisions
      .filter((decision) => decision.providerInput && referenceRoles.includes(decision.role))
      .map((decision) => decision.role)
  );

  if (referenceRoles.length === 0) {
    return {
      ...fallback,
      fallbackReason: "Asset invocation planner selected no active roles",
    };
  }

  return {
    version: 1,
    mode: "llm_asset_invocation_v1",
    fallbackUsed: false,
    referenceRoles,
    providerReferenceRoles,
    decisions: finalDecisions,
    unusedRoles: finalDecisions
      .filter((decision) => decision.mode === "unused" && !decision.providerInput)
      .map((decision) => decision.role),
    notes: uniqueStrings([
      ...getStringArray(value.notes).map((note) => shortText(note, 180)),
      ...enforcedProviderRoles.map((role) => `${role} 是当前镜头的关键参考，已保留 provider 输入。`),
    ]).slice(0, 5),
  };
}

function getCriticalProviderRoles(
  item: GenerationPlanItem,
  fallback: AssetInvocationPlan,
  context: GenerationReferenceContext | undefined,
  availableRoles: GenerationReferenceRole[]
): GenerationReferenceRole[] {
  const availableSet = new Set(availableRoles);
  const fallbackProviderSet = new Set(fallback.providerReferenceRoles);
  const text = `${item.title} ${item.type} ${item.prompt} ${item.copyText ?? ""}`.toLowerCase();
  const critical: GenerationReferenceRole[] = [];

  for (const role of generationReferenceRoles) {
    if (
      role !== "copy" &&
      availableSet.has(role) &&
      hasProviderUsableRole(context, role) &&
      hasAgentSelectedImageRole(item, role)
    ) {
      critical.push(role);
    }
  }

  if (
    fallbackProviderSet.has("product") &&
    availableSet.has("product") &&
    hasProviderUsableRole(context, "product")
  ) {
    critical.push("product");
  }
  if (
    fallbackProviderSet.has("model") &&
    availableSet.has("model") &&
    hasProviderUsableRole(context, "model") &&
    /同一模特|同一位|同一个人|人物身份|身份|脸|五官|发型|身形|模特|真人|穿|上身|手持|拿着|背着|佩戴/.test(text)
  ) {
    critical.push("model");
  }
  if (
    fallbackProviderSet.has("scene") &&
    availableSet.has("scene") &&
    hasProviderUsableRole(context, "scene") &&
    /同一|保持|延续|参考场景|固定场景|场景参考|同空间|同光影|空间关系|窗光|光源|背景关系|台面材质|透视|阴影|场景|厨房|室内|室外|街拍/.test(text)
  ) {
    critical.push("scene");
  }

  return uniqueRoles(critical);
}

function hasAgentSelectedImageRole(item: GenerationPlanItem, role: GenerationReferenceRole): boolean {
  const ids = getStringArray((item.metadata as Record<string, unknown> | undefined)?.agentAssetGroupIds);
  return ids.some((id) => id.startsWith(`asset.${role}.`));
}

function getAvailableRoles(
  item: GenerationPlanItem,
  context: GenerationReferenceContext | undefined
): GenerationReferenceRole[] {
  return uniqueRoles([
    ...getContextRoles(context),
    ...(item.referenceRoles ?? []),
    ...(item.providerReferenceRoles ?? []),
  ]);
}

function getContextRoles(context: GenerationReferenceContext | undefined): GenerationReferenceRole[] {
  if (!context) return [];
  return uniqueRoles([
    ...generationReferenceRoles.filter((role) => Boolean(context.roles[role])),
    ...context.images.map((image) => image.role),
  ]);
}

function hasProviderUsableRole(
  context: GenerationReferenceContext | undefined,
  role: GenerationReferenceRole
): boolean {
  return buildProviderReferenceAdapter(context).providerUsableImages.some((image) => image.role === role);
}

function normalizeRoles(value: readonly unknown[] | undefined): GenerationReferenceRole[] {
  if (!Array.isArray(value)) return [];
  return uniqueRoles(value.flatMap((entry) => {
    const role = normalizeRole(entry);
    return role ? [role] : [];
  }));
}

function uniqueRoles(value: readonly GenerationReferenceRole[]): GenerationReferenceRole[] {
  const seen = new Set<GenerationReferenceRole>();
  const result: GenerationReferenceRole[] = [];
  for (const role of value) {
    if (seen.has(role)) continue;
    seen.add(role);
    result.push(role);
  }
  return result;
}

function uniqueStrings(value: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeRole(value: unknown): GenerationReferenceRole | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, GenerationReferenceRole> = {
    product: "product",
    商品: "product",
    产品: "product",
    商品资产: "product",
    产品资产: "product",
    model: "model",
    person: "model",
    人物: "model",
    模特: "model",
    模特资产: "model",
    scene: "scene",
    场景: "scene",
    背景: "scene",
    场景资产: "scene",
    style: "style",
    风格: "style",
    风格资产: "style",
    copy: "copy",
    text: "copy",
    文案: "copy",
    文字: "copy",
    文案资产: "copy",
  };
  return aliases[normalized] ?? generationReferenceRoles.find((role) => role === normalized);
}

function normalizeMode(value: unknown): AssetInvocationMode | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, AssetInvocationMode> = {
    hard_reference: "hard_reference",
    商品硬参考: "hard_reference",
    真实商品参考: "hard_reference",
    identity_reference: "identity_reference",
    身份参考: "identity_reference",
    人物身份参考: "identity_reference",
    lighting_space: "lighting_space",
    场景光影: "lighting_space",
    空间光影: "lighting_space",
    style_finish: "style_finish",
    风格完成度: "style_finish",
    风格参考: "style_finish",
    copy_layer: "copy_layer",
    文案图层: "copy_layer",
    prompt_only: "prompt_only",
    仅提示词: "prompt_only",
    文字约束: "prompt_only",
    unused: "unused",
    不使用: "unused",
  };
  return aliases[normalized] ?? undefined;
}

function isTruthyProviderInput(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return ["true", "yes", "是", "需要", "provider_input", "providerinput"].includes(
    value.trim().toLowerCase()
  );
}

function tryParsePlannerJson(text: string): unknown | undefined {
  const cleaned = text.trim();
  const candidates = [
    cleaned,
    cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim(),
    cleaned.match(/\{[\s\S]*\}/)?.[0],
  ].filter((item): item is string => !!item);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try next candidate.
    }
  }
  return undefined;
}

function shortText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 1)}…` : normalized;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
