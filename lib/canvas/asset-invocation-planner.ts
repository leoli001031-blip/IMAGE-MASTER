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
  mode: "llm_asset_invocation_v1" | "agent_routed_roles_v1" | "fallback_existing_roles_v1";
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
  const itemWithRequest = mergeUserRequestIntoItemIntent(input.item, input.userRequest);
  const fallback = buildFallbackPlan(itemWithRequest, normalizedContext);

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
    return normalizeAiPlan(aiPlan, fallback, normalizedContext, availableRoles, itemWithRequest);
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

function mergeUserRequestIntoItemIntent(
  item: GenerationPlanItem,
  userRequest: string | undefined
): GenerationPlanItem {
  const request = shortText(userRequest, 1200);
  if (!request) return item;
  return {
    ...item,
    prompt: [item.prompt, `User request: ${request}`].filter(Boolean).join("\n"),
  };
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
  const baseURL = config.textBaseUrl || config.baseUrl || "https://slb.apikey.fun/v1";
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
      "白底主图、Amazon 合规主图、尺寸图、参数图、商品多角度图：provider 图片输入优先只保留 product；scene/style/copy 应降级为 prompt_only 或 unused，避免污染干净商品图。",
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
  const decisions = getDecisionEntries(value)
    .flatMap((entry): AssetInvocationDecision[] => {
        if (typeof entry === "string") {
          const role = normalizeRole(entry);
          if (!role || !availableSet.has(role)) return [];
          const providerInput = role !== "copy" && hasProviderUsableRole(context, role);
          return [{
            role,
            mode: modeByRole[role],
            providerInput,
            reason: "Agent 以角色列表形式选择该素材",
          }];
        }
        if (!isRecord(entry)) return [];
        const role = normalizeRole(
          entry.role ??
          entry.assetRole ??
          entry.referenceRole ??
          entry.roleName ??
          entry.asset ??
          entry.key ??
          entry.type
        );
        if (!role || !availableSet.has(role)) return [];
        const rawMode = entry.mode ?? entry.invocationMode ?? entry.referenceMode ?? entry.useMode ?? entry.action;
        const providerInput = role !== "copy" && isTruthyProviderInput(
          entry.providerInput ??
          entry.provider_input ??
          entry.provider ??
          entry.useProviderInput ??
          entry.use_provider_input ??
          entry.sendToProvider ??
          entry.send_to_provider ??
          entry.asProviderInput ??
          entry.as_provider_input ??
          entry.imageInput ??
          entry.image_input ??
          entry.includeInProvider ??
          entry.providerReference ??
          entry.useImage
        ) && hasProviderUsableRole(context, role);
        let mode = normalizeMode(rawMode) ?? modeByRole[role];
        if (providerInput && (mode === "unused" || mode === "prompt_only" || isGenericProviderInputMode(rawMode))) {
          mode = modeByRole[role];
        }
        return [{
          role,
          mode: providerInput && mode === "unused" ? modeByRole[role] : mode,
          providerInput,
          reason: shortText(entry.reason ?? entry.rationale ?? entry.note ?? entry.notes, 160) || "Agent 选择该素材调用方式",
        }];
      });

  if (decisions.length === 0) {
    throw new Error(`Asset invocation planner returned no usable decisions: ${compactPlannerJsonPreview(value)}`);
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
  const guardedDecisions = applyItemIntentDecisionGuards(
    applyItemRoleBoundary(Array.from(decisionsByRole.values()), item),
    item
  );
  const guardedDecisionsByRole = new Map<GenerationReferenceRole, AssetInvocationDecision>();
  for (const decision of guardedDecisions) guardedDecisionsByRole.set(decision.role, decision);
  for (const role of enforcedProviderRoles) {
    const previous = guardedDecisionsByRole.get(role) ?? decisionsByRole.get(role);
    guardedDecisionsByRole.set(role, {
      role,
      mode: modeByRole[role],
      providerInput: true,
      reason: previous?.providerInput
        ? previous.reason
        : "镜头明确要求保持该参考素材，保留为 provider 输入",
    });
  }

  const finalDecisions = Array.from(guardedDecisionsByRole.values());
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

function getDecisionEntries(value: Record<string, unknown>): unknown[] {
  const direct = value.decisions;
  if (Array.isArray(direct)) return direct;
  if (isRecord(direct)) return objectDecisionEntries(direct);

  const plan = value.plan;
  if (isRecord(plan)) {
    if (Array.isArray(plan.decisions)) return plan.decisions;
    if (isRecord(plan.decisions)) return objectDecisionEntries(plan.decisions);
  }

  const assetInvocationPlan = value.assetInvocationPlan;
  if (isRecord(assetInvocationPlan)) {
    if (Array.isArray(assetInvocationPlan.decisions)) return assetInvocationPlan.decisions;
    if (isRecord(assetInvocationPlan.decisions)) return objectDecisionEntries(assetInvocationPlan.decisions);
  }

  const roleArrayEntries = roleArrayDecisionEntries(value);
  if (roleArrayEntries.length > 0) return roleArrayEntries;

  const nestedCandidates = [
    value.assetInvocations,
    value.assetInvocation,
    value.referencePlan,
    value.references,
    value.roles,
  ];
  for (const candidate of nestedCandidates) {
    if (Array.isArray(candidate)) return candidate;
    if (isRecord(candidate)) {
      const entries = objectDecisionEntries(candidate);
      if (entries.length > 0) return entries;
    }
  }

  const roleKeyEntries = objectDecisionEntries(value);
  if (roleKeyEntries.length > 0) return roleKeyEntries;

  return [];
}

function objectDecisionEntries(value: Record<string, unknown>): unknown[] {
  return Object.entries(value).flatMap(([roleKey, decision]) => {
    const role = normalizeRole(roleKey);
    if (isRecord(decision)) {
      if ("role" in decision || "assetRole" in decision || "referenceRole" in decision) {
        return [role && !("role" in decision) ? { ...decision, role } : decision];
      }
      return role ? [{ ...decision, role }] : [];
    }
    if (!role) return [];
    if (typeof decision === "string") {
      return isTruthyProviderInput(decision)
        ? [{ role, providerInput: true }]
        : [{ role, mode: decision }];
    }
    if (typeof decision === "boolean") {
      return [{ role, providerInput: decision }];
    }
    return [];
  });
}

function roleArrayDecisionEntries(value: Record<string, unknown>): unknown[] {
  const referenceRoles = normalizeRoles([
    ...getStringArray(value.referenceRoles),
    ...getStringArray(value.activeRoles),
    ...getStringArray(value.usedRoles),
    ...getStringArray(value.roles),
  ]);
  const providerRoles = normalizeRoles([
    ...getStringArray(value.providerReferenceRoles),
    ...getStringArray(value.providerInputRoles),
    ...getStringArray(value.providerRoles),
    ...getStringArray(value.imageReferenceRoles),
    ...getStringArray(value.strongReferenceRoles),
  ]);
  const providerSet = new Set(providerRoles);
  return uniqueRoles([...referenceRoles, ...providerRoles]).map((role) => ({
    role,
    providerInput: providerSet.has(role),
  }));
}

function getCriticalProviderRoles(
  item: GenerationPlanItem,
  fallback: AssetInvocationPlan,
  context: GenerationReferenceContext | undefined,
  availableRoles: GenerationReferenceRole[]
): GenerationReferenceRole[] {
  const availableSet = new Set(availableRoles);
  const fallbackProviderSet = new Set(fallback.providerReferenceRoles);
  const itemRoleSet = new Set<GenerationReferenceRole>([
    ...(item.referenceRoles ?? []),
    ...(item.providerReferenceRoles ?? []),
  ]);
  const text = getItemIntentText(item);
  const critical: GenerationReferenceRole[] = [];
  const noModelIntent = hasExplicitNoModelIntent(text);

  for (const role of generationReferenceRoles) {
    if (
      role === "product" &&
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
    !noModelIntent &&
    (fallbackProviderSet.has("model") || hasModelProviderIntent(text)) &&
    itemRoleSet.has("model") &&
    availableSet.has("model") &&
    hasProviderUsableRole(context, "model") &&
    (fallbackProviderSet.has("model") || hasModelProviderIntent(text))
  ) {
    critical.push("model");
  }
  if (
    (fallbackProviderSet.has("scene") || hasSceneProviderIntent(text)) &&
    itemRoleSet.has("scene") &&
    availableSet.has("scene") &&
    hasProviderUsableRole(context, "scene") &&
    (fallbackProviderSet.has("scene") || hasSceneProviderIntent(text))
  ) {
    critical.push("scene");
  }

  return uniqueRoles(critical);
}

function applyItemRoleBoundary(
  decisions: AssetInvocationDecision[],
  item: GenerationPlanItem
): AssetInvocationDecision[] {
  const allowedRoles = new Set<GenerationReferenceRole>([
    ...(item.referenceRoles ?? []),
    ...(item.providerReferenceRoles ?? []),
  ]);
  if (allowedRoles.size === 0) return decisions;
  return decisions.map((decision) => {
    if (allowedRoles.has(decision.role)) return decision;
    return {
      ...decision,
      mode: "unused",
      providerInput: false,
      reason: "Plan-level Agent 未选择该素材角色，本张图不额外引入该参考。",
    };
  });
}

function hasModelProviderIntent(text: string): boolean {
  if (hasExplicitNoModelIntent(text)) return false;
  return /同一模特|同一位|同一个人|人物身份|身份|脸|五官|发型|身形|模特|真人|穿|上身|手持|拿着|背着|佩戴|坐在|站在|人物|model|person|lookbook|wearing/.test(text);
}

function hasSceneProviderIntent(text: string): boolean {
  return /同一|保持|延续|参考场景|固定场景|场景参考|同空间|同光影|空间关系|窗光|光源|背景关系|台面材质|透视|阴影|场景|厨房|室内|室外|街拍|花店|商场|咖啡|卧室|客厅|户外|室内|雪山|街边|店外|背景|scene|lifestyle|street|indoor|outdoor/.test(text);
}

function applyItemIntentDecisionGuards(
  decisions: AssetInvocationDecision[],
  item: GenerationPlanItem
): AssetInvocationDecision[] {
  if (hasExplicitNoModelIntent(getItemIntentText(item))) {
    decisions = decisions.map((decision) => {
      if (decision.role !== "model") return decision;
      return {
        ...decision,
        mode: "unused",
        providerInput: false,
        reason: "本张图明确要求无模特/无人物，模特参考不进入 provider 输入。",
      };
    });
  }

  if (shouldUseProductOnlyReferences(item)) {
    return decisions.map((decision) => {
      if (decision.role === "product" || decision.role === "copy") return decision;
      return {
        ...decision,
        mode: "unused",
        providerInput: false,
        reason: "当前镜头是商品主图/白底/商品独立展示，非商品素材不进入本张图调用",
      };
    });
  }

  if (shouldDropModelReferenceForProductDetail(item)) {
    return decisions.map((decision) => {
      if (decision.role !== "model") return decision;
      return {
        ...decision,
        mode: "unused",
        providerInput: false,
        reason: "当前镜头是商品材质/细节特写，手部或局部动作不需要锁定模特身份",
      };
    });
  }

  if (shouldDropSceneReferenceForProductDetail(item)) {
    return decisions.map((decision) => {
      if (decision.role !== "scene") return decision;
      return {
        ...decision,
        mode: "unused",
        providerInput: false,
        reason: "当前镜头是商品材质/细节特写，未明确要求场景承接，场景参考不进入本张图调用",
      };
    });
  }

  return decisions;
}

function shouldDropSceneReferenceForProductDetail(item: GenerationPlanItem): boolean {
  const text = getItemIntentText(item);
  if (!/product_detail|product_macro|material|texture|macro|材质|细节|微距|纹理/.test(text)) {
    return false;
  }
  return !/product_scene|scene|lifestyle|环境|场景|台面|桌面|背景|生活方式|空间|花店|咖啡|商场|街拍/.test(text);
}

function shouldDropModelReferenceForProductDetail(item: GenerationPlanItem): boolean {
  const text = getItemIntentText(item);
  if (hasExplicitNoModelIntent(text)) return true;
  if (!/product_detail|product_macro|material|texture|macro|detail|材质|细节|微距|纹理|静物/.test(text)) {
    return false;
  }
  return !hasExplicitModelIdentityIntent(text);
}

function shouldUseProductOnlyReferences(item: GenerationPlanItem): boolean {
  const labelText = `${item.title} ${item.type}`.toLowerCase();
  const fullText = getItemIntentText(item);
  if (!hasExplicitNoModelIntent(fullText) && hasExplicitModelIdentityIntent(fullText)) return false;
  if (/amazon\s*main|marketplace[-_ ]?main|white[-_ ]?main|product[-_ ]?white|product[-_ ]?only|packshot|ecommerce[-_ ]?main|淘宝主图|商品主图|主图风格|白底|纯白|主图|商品正面主图/.test(labelText)) {
    return true;
  }
  return hasExplicitNoModelIntent(fullText) &&
    /white[-_ ]?background|pure white|白底|纯白|主图|packshot|product[-_ ]?only|无场景|no scene/.test(fullText);
}

function hasExplicitNoModelIntent(text: string): boolean {
  return /no model|no person|without model|without person|product[-_ ]?only|无模特|无人物|不要模特|不要人物|不需要模特|不需要人物|不用模特|不用人物|不带模特|不带人物|不要使用模特|不要使用人物|无需模特|无需人物|模特不要|人物不要/.test(text);
}

function hasExplicitModelIdentityIntent(text: string): boolean {
  if (hasExplicitNoModelIntent(text)) return false;
  return /model|person|human|wearing|lookbook|model_showcase|模特|人物|真人|女性|男性|同一个人|人像|穿搭|背着展示|佩戴展示|上身展示/.test(text);
}

function getItemIntentText(item: GenerationPlanItem): string {
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const shotIntentText = shortText(metadata.shotIntentText, 2000);
  if (shotIntentText) return `${shotIntentText} ${item.prompt} ${item.copyText ?? ""}`.toLowerCase();
  return `${item.title} ${item.type} ${item.prompt} ${item.copyText ?? ""}`.toLowerCase();
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
  const compact = normalized.replace(/[\s_-]+/g, "");
  const aliases: Record<string, GenerationReferenceRole> = {
    product: "product",
    productreference: "product",
    productasset: "product",
    productimage: "product",
    productref: "product",
    商品: "product",
    产品: "product",
    商品图: "product",
    产品图: "product",
    商品图片: "product",
    产品图片: "product",
    商品参考: "product",
    商品参考图: "product",
    商品资产: "product",
    产品资产: "product",
    model: "model",
    person: "model",
    modelreference: "model",
    modelasset: "model",
    personreference: "model",
    人物: "model",
    模特: "model",
    人物图: "model",
    模特图: "model",
    模特参考: "model",
    模特参考图: "model",
    模特资产: "model",
    scene: "scene",
    scenereference: "scene",
    sceneasset: "scene",
    scenecontext: "scene",
    场景: "scene",
    背景: "scene",
    场景图: "scene",
    背景图: "scene",
    场景参考: "scene",
    场景参考图: "scene",
    场景资产: "scene",
    style: "style",
    stylereference: "style",
    styleasset: "style",
    visualstyle: "style",
    风格: "style",
    风格图: "style",
    风格参考: "style",
    风格参考图: "style",
    风格资产: "style",
    copy: "copy",
    text: "copy",
    copybrief: "copy",
    copyasset: "copy",
    textasset: "copy",
    文案: "copy",
    文字: "copy",
    文案图: "copy",
    文字图: "copy",
    文案参考: "copy",
    文案参考图: "copy",
    文案资产: "copy",
  };
  return aliases[normalized] ?? aliases[compact] ?? generationReferenceRoles.find((role) => role === normalized);
}

function normalizeMode(value: unknown): AssetInvocationMode | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  const compact = normalized.replace(/[\s-]+/g, "_");
  const aliases: Record<string, AssetInvocationMode> = {
    hard_reference: "hard_reference",
    hardreference: "hard_reference",
    provider_input: "hard_reference",
    providerinput: "hard_reference",
    商品硬参考: "hard_reference",
    真实商品参考: "hard_reference",
    identity_reference: "identity_reference",
    identityreference: "identity_reference",
    身份参考: "identity_reference",
    人物身份参考: "identity_reference",
    lighting_space: "lighting_space",
    lightingspace: "lighting_space",
    scene_lighting: "lighting_space",
    场景光影: "lighting_space",
    空间光影: "lighting_space",
    style_finish: "style_finish",
    stylefinish: "style_finish",
    风格完成度: "style_finish",
    风格参考: "style_finish",
    copy_layer: "copy_layer",
    copylayer: "copy_layer",
    文案图层: "copy_layer",
    prompt_only: "prompt_only",
    promptonly: "prompt_only",
    仅提示词: "prompt_only",
    文字约束: "prompt_only",
    unused: "unused",
    不使用: "unused",
  };
  return aliases[normalized] ?? aliases[compact] ?? undefined;
}

function isGenericProviderInputMode(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const compact = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  return compact === "providerinput" || compact === "imageinput";
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

function compactPlannerJsonPreview(value: unknown): string {
  try {
    return shortText(JSON.stringify(value), 520);
  } catch {
    return "[unserializable planner payload]";
  }
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
