import {
  buildProviderCallEstimate,
  buildProviderCallPolicy,
  getMaxBatchImages,
  validateProviderPrompts,
  validateProviderReferenceImage,
} from "@/lib/ai/provider-call-policy";
import {
  buildCanvasReferenceSlots,
  type CanvasReferenceRole,
} from "@/lib/canvas/canvas-reference-slots";
import {
  buildProviderReferenceAdapter,
  type GenerationReferenceContext,
  normalizeGenerationReferenceContext,
} from "@/lib/canvas/generation-reference-context";
import { selectKnowledgeTemplates } from "@/lib/canvas/knowledge-template-selector";
import {
  buildSopExecutionPlan,
  publicKnowledgeSelection,
} from "@/lib/canvas/sop-execution-plan";
import { buildCopyRenderPolicy } from "@/lib/canvas/copy-render-policy";
import {
  buildCampaignBible,
  buildCampaignShotList,
  findCampaignShotForItem,
  imageSizeForRatio,
  normalizeCampaignBible,
  normalizeCampaignShotList,
  type CampaignBible,
  type CampaignShot,
} from "@/lib/canvas/campaign-planning";
import { selectWorkflowSkill } from "@/lib/canvas/workflow-skill-registry";
import type {
  GenerationPlan,
  GenerationPlanDraftRequest,
  GenerationPlanDraftResult,
  GenerationPlanItem,
} from "@/lib/canvas/generation-plan";

export function buildGenerationPlanDraft(
  request: GenerationPlanDraftRequest
): GenerationPlanDraftResult {
  const now = new Date().toISOString();
  const campaignPlanning = buildRequestCampaignPlanning(request);
  const baseItems = normalizePlanItems(request.items ?? request.images, request, campaignPlanning.shotList);
  const referenceContext = buildReferenceContext(request);
  const knowledgeSelection = selectKnowledgeTemplates({
    request: buildKnowledgeUserRequest(request, baseItems),
    referenceContext,
    roles: request.requiredReferenceRoles,
    requiredReferenceRoles: request.requiredReferenceRoles,
    templateCandidates: request.templateCandidates,
    components: request.components,
  });
  const publicSelection = publicKnowledgeSelection(knowledgeSelection);
  const requiredReferenceRoles = mergeReferenceRoles(
    request.requiredReferenceRoles,
    knowledgeSelection.requiredReferenceRoles
  );
  const itemsWithKnowledge = applyKnowledgeSelectionToItems(baseItems, publicSelection);
  const referenceSlots = buildCanvasReferenceSlots({
    referenceContext,
    requiredRoles: requiredReferenceRoles,
  });
  const sopExecutionPlan = buildSopExecutionPlan({
    items: itemsWithKnowledge,
    knowledgeSelection,
    referenceContext,
    referenceSlots,
    createdAt: now,
  });
  const items = applySopExecutionPlanToItems(itemsWithKnowledge, sopExecutionPlan);
  const maxImages = getMaxBatchImages();
  const issues: string[] = [];

  if (items.length === 0) issues.push("缺少生成条目");
  if (items.length > maxImages) issues.push(`单次最多生成 ${maxImages} 张图片`);

  const promptValidation = validateProviderPrompts(items.map((item) => item.prompt));
  if (promptValidation.ok === false) issues.push(promptValidation.error);

  const productReferenceValidation = validateProviderReferenceImage(request.productImageBase64);
  if (productReferenceValidation.ok === false) issues.push(productReferenceValidation.error);

  for (const slot of referenceSlots) {
    issues.push(...slot.issues);
  }

  const providerReferenceAdapter = buildProviderReferenceAdapter(referenceContext);
  const usesProviderReference = !!(request.productImageBase64 || providerReferenceAdapter.primaryImage);
  const referenceImageBytes = productReferenceValidation.ok ? productReferenceValidation.bytes : 0;
  const estimate = buildProviderCallEstimate({
    imageCount: items.length,
    usesProductReference: usesProviderReference,
    referenceImageBytes,
    maxImages,
  });
  const providerPolicy = buildProviderCallPolicy({
    estimate,
    dryRun: true,
    confirmedProviderCallLimit: request.confirmedProviderCallLimit,
    maxImages,
  });
  const validationOk = issues.length === 0;
  const approval = {
    required: estimate.providerCallCount > 0,
    status: validationOk ? ("pending" as const) : ("blocked" as const),
    issues,
    requiredConfirmation: providerPolicy.requiredConfirmation,
  };
  const plan: GenerationPlan = {
    planId: `plan_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    workflowId: getOptionalString(request.workflowId),
    frameNodeId: getOptionalString(request.frameNodeId) ?? getOptionalString(request.nodeId),
    batchId: getOptionalString(request.batchId),
    campaignBible: campaignPlanning.campaignBible,
    shotList: campaignPlanning.shotList.length > 0 ? campaignPlanning.shotList : undefined,
    items,
    referenceContext,
    referenceSlots,
    knowledgeSelection: publicSelection,
    sopExecutionPlan,
    estimate,
    providerPolicy,
    approval,
    metadata: {
      campaignBible: campaignPlanning.campaignBible,
      shotList: campaignPlanning.shotList,
      knowledgeSelection: publicSelection,
      sopExecutionPlan,
    },
    status: validationOk ? "draft" : "blocked",
    createdAt: now,
  };

  return {
    ok: validationOk,
    dryRun: true,
    plan,
    estimate,
    providerPolicy,
    referenceSlots,
    knowledgeSelection: publicSelection,
    sopExecutionPlan,
    validation: {
      ok: validationOk,
      issues,
    },
  };
}

function applyKnowledgeSelectionToItems(
  items: GenerationPlanItem[],
  knowledgeSelection: ReturnType<typeof selectKnowledgeTemplates>
): GenerationPlanItem[] {
  if (items.length === 0) return items;
  const qualityRules = mergeStringArrays(
    items.flatMap((item) => item.qualityRules ?? []),
    knowledgeSelection.qualityRules
  );
  return items.map((item) => ({
    ...item,
    qualityRules: mergeStringArrays(item.qualityRules ?? [], knowledgeSelection.qualityRules),
    metadata: {
      ...item.metadata,
      knowledgeSelection: {
        sopKeys: knowledgeSelection.sopKeys,
        selectedTemplates: knowledgeSelection.selectedTemplates,
        qualityRules: knowledgeSelection.qualityRules,
        warnings: knowledgeSelection.warnings,
      },
      knowledgeTrace: knowledgeSelection.knowledgeTrace,
      sopKeys: knowledgeSelection.sopKeys,
      mergedQualityRules: qualityRules,
    },
  }));
}

function applySopExecutionPlanToItems(
  items: GenerationPlanItem[],
  sopExecutionPlan: GenerationPlan["sopExecutionPlan"]
): GenerationPlanItem[] {
  return items.map((item) => ({
    ...item,
    metadata: {
      ...item.metadata,
      sopExecutionPlan,
    },
  }));
}

function buildKnowledgeUserRequest(
  request: GenerationPlanDraftRequest,
  items: GenerationPlanItem[]
): string {
  return [
    request.request,
    request.userRequest,
    request.brief,
    request.style,
    request.outputType,
    ...items.flatMap((item) => [item.title, item.type, item.copyText, item.prompt]),
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizePlanItems(
  value: unknown,
  request: GenerationPlanDraftRequest,
  shotList: CampaignShot[]
): GenerationPlanItem[] {
  if (!Array.isArray(value)) return [];
  const requestText = [
    request.request,
    request.userRequest,
    request.brief,
    request.outputType,
  ].filter(Boolean).join(" ");

  return value.flatMap((item, index): GenerationPlanItem[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const type = getOptionalString(record.type) ?? "image";
    const title = getOptionalString(record.title) ?? `${type}-${index + 1}`;
    const itemId = getOptionalString(record.itemId) ?? getOptionalString(record.id) ?? `${type}-${index + 1}`;
    const campaignShot = findCampaignShotForItem({
      itemId,
      title,
      type,
      index,
      shotList,
    });
	    const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
	    const copyText = getOptionalString(record.copyText) ?? "";
    const textAllowed = typeof record.textAllowed === "boolean"
      ? record.textAllowed
      : campaignShot?.textAllowed;
    const metadata = normalizeMetadata(record.metadata);
    const ratio = getOptionalString(record.ratio) ?? campaignShot?.ratio;
    const size = getOptionalString(record.size) ?? campaignShot?.size ?? imageSizeForRatio(ratio);
    const copyMode = record.copyRenderMode ?? metadata.copyRenderMode ?? campaignShot?.copyMode ?? request.copyRenderMode;
    const referenceRoles = resolveItemReferenceRoles({
      record,
      metadata,
      campaignShot,
      request,
      title,
      type,
      prompt,
    });
	    const providerReferenceRoles = resolveItemProviderReferenceRoles({
	      record,
	      metadata,
	      referenceRoles,
	      title,
	      type,
	      prompt,
	    });
	    const productReferenceFocus = referenceRoles.includes("product")
	      ? resolveProductReferenceFocus({
	          record,
	          metadata,
	          campaignShot,
	          title,
	          type,
	          prompt,
	        })
	      : undefined;
	    const productReferenceFocusInstruction = productReferenceFocus
	      ? buildProductReferenceFocusInstruction(productReferenceFocus)
	      : undefined;
	    const routedPrompt = appendProductReferenceFocusPrompt(prompt, productReferenceFocusInstruction);
	    const copyRenderPolicy = buildCopyRenderPolicy({
	      sourceText: copyText,
      copyBrief: metadata.copyBrief,
      textAllowed,
      request: requestText,
      explicitMode: copyMode,
      outputType: request.outputType ?? campaignShot?.slot ?? type,
    });
    return [{
	      itemId,
	      title,
	      prompt: routedPrompt,
	      type,
      copyText,
      exportSpecId: getOptionalString(record.exportSpecId),
      naming: getOptionalString(record.naming) ?? campaignShot?.naming,
      size,
      ratio,
      whiteBackground: typeof record.whiteBackground === "boolean" ? record.whiteBackground : undefined,
      textAllowed,
      modelRequired: typeof record.modelRequired === "boolean" ? record.modelRequired : undefined,
	      referenceRoles,
	      providerReferenceRoles,
	      productReferenceFocus,
	      productReferenceFocusInstruction,
	      copyRenderPolicy,
      qualityRules: mergeStringArrays(getStringArray(record.qualityRules), campaignShot?.qaRules),
      metadata: {
        ...metadata,
        campaignShot,
        campaignShotId: campaignShot?.id,
        shotRole: campaignShot?.slot,
        shotReferenceRoles: campaignShot?.referenceRoles,
	        itemReferenceRoles: referenceRoles,
	        itemProviderReferenceRoles: providerReferenceRoles,
	        productReferenceFocus,
	        productReferenceFocusInstruction,
	        referenceRouting: buildReferenceRoutingSummary(
	          referenceRoles,
	          providerReferenceRoles,
	          productReferenceFocus
	        ),
        ratioReason: ratio && !record.ratio ? "campaign_shot" : undefined,
        sizeReason: size && !record.size ? "campaign_shot_ratio" : undefined,
        copyModeReason: campaignShot?.copyMode && !record.copyRenderMode && !metadata.copyRenderMode
          ? "campaign_shot"
          : undefined,
        copyRenderPolicy,
      },
    }];
  });
}

function buildRequestCampaignPlanning(request: GenerationPlanDraftRequest): {
  campaignBible?: CampaignBible;
  shotList: CampaignShot[];
} {
  const explicitBible = normalizeCampaignBible(request.campaignBible);
  const explicitShotList = normalizeCampaignShotList(request.shotList);
  if (explicitBible || explicitShotList.length > 0) {
    return {
      campaignBible: explicitBible,
      shotList: explicitShotList,
    };
  }

  if (!hasCommercePlanningSignal(request)) {
    return { shotList: [] };
  }

  const planningInput = {
    brief: [
      request.request,
      request.userRequest,
      request.brief,
      request.outputType,
      request.style,
    ].filter(Boolean).join(" "),
    platforms: request.platforms,
    outputPacks: request.outputPacks,
    copyRenderMode: request.copyRenderMode,
  };
  const skill = selectWorkflowSkill(planningInput);
  return {
    campaignBible: buildCampaignBible(planningInput, skill),
    shotList: buildCampaignShotList(planningInput, skill),
  };
}

function hasCommercePlanningSignal(request: GenerationPlanDraftRequest): boolean {
  const text = [
    request.request,
    request.userRequest,
    request.brief,
    request.outputType,
    request.style,
    ...(request.platforms ?? []),
    ...(request.outputPacks ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
  if (isReferenceAssetPlanningRequest(text, request)) return false;
  if (request.requiredReferenceRoles?.includes("product")) return true;
  if (request.productImageBase64) return true;
  if (/商品|产品|电商|淘宝|天猫|amazon|亚马逊|listing|详情页|主图|海报|小红书|模特展示|白底/.test(text)) {
    return true;
  }
  const refs = normalizeGenerationReferenceContext(request.referenceContext);
  return Boolean(refs?.images?.some((image) => image.role === "product"));
}

function isReferenceAssetPlanningRequest(
  text: string,
  request: GenerationPlanDraftRequest
): boolean {
  if (request.requiredReferenceRoles?.includes("product") || request.productImageBase64) {
    return false;
  }
  return /model_asset|character_sheet|scene_asset|style_asset|visual_style|reference_asset|scene_style_asset|模卡|模特资产|场景资产|风格资产|参考资产|素材资产/.test(text);
}

function resolveItemReferenceRoles({
  record,
  metadata,
  campaignShot,
  request,
  title,
  type,
  prompt,
}: {
  record: Record<string, unknown>;
  metadata: Record<string, unknown>;
  campaignShot?: CampaignShot;
  request: GenerationPlanDraftRequest;
  title: string;
  type: string;
  prompt: string;
}): CanvasReferenceRole[] {
  const explicitRoles = firstReferenceRoleArray(
    record.referenceRoles,
    metadata.referenceRoles,
    record.requiredReferenceRoles,
    metadata.requiredReferenceRoles
  );
  if (explicitRoles) return explicitRoles;

  const inferred = new Set<CanvasReferenceRole>();
  for (const role of campaignShot?.referenceRoles ?? []) inferred.add(role);
  for (const role of request.requiredReferenceRoles ?? []) inferred.add(role);

  const context = normalizeGenerationReferenceContext(request.referenceContext);
  if (request.productImageBase64 || context?.images.some((image) => image.role === "product")) {
    inferred.add("product");
  }

  const text = `${title} ${type} ${prompt}`.toLowerCase();
  if (/model|look|wear|front|side|portrait|person|human|模特|人物|穿|上身|展示|街拍|手持/.test(text)) {
    inferred.add("model");
  }
  if (/scene|lifestyle|street|indoor|outdoor|room|cafe|背景|场景|街拍|室内|室外|生活|空间/.test(text)) {
    inferred.add("scene");
  }
  if (/style|campaign|poster|hero|visual|brand|mood|风格|海报|主视觉|品牌|氛围/.test(text)) {
    inferred.add("style");
  }
  if (/copy|text|headline|feature|info|detail|selling|claim|文案|标题|卖点|详情|信息|参数/.test(text)) {
    inferred.add("copy");
  }

  return Array.from(inferred);
}

function resolveItemProviderReferenceRoles({
  record,
  metadata,
  referenceRoles,
  title,
  type,
  prompt,
}: {
  record: Record<string, unknown>;
  metadata: Record<string, unknown>;
  referenceRoles: CanvasReferenceRole[];
  title: string;
  type: string;
  prompt: string;
}): CanvasReferenceRole[] {
  const modelReferenceMode = normalizeModelReferenceMode(
    getOptionalString(record.modelReferenceMode) ?? getOptionalString(metadata.modelReferenceMode)
  );
  const explicitRoles = firstReferenceRoleArrayAllowEmpty(
    record.providerReferenceRoles,
    metadata.providerReferenceRoles,
    record.imageReferenceRoles,
    metadata.imageReferenceRoles
  );
  const text = `${title} ${type} ${prompt}`.toLowerCase();
  if (explicitRoles !== undefined) {
    return filterModelProviderReferenceRoles(
      explicitRoles.filter((role) => referenceRoles.includes(role)),
      modelReferenceMode
    );
  }

  const roleSet = new Set(referenceRoles);
  const providerRoles = new Set<CanvasReferenceRole>();
  const isPureStyleAsset = /style_asset|visual_style|风格资产/.test(text);
  const isSceneDominant = /scene|lifestyle|street|indoor|outdoor|room|cafe|背景|场景|街拍|室内|室外|生活|空间/.test(text);
  const isModelDominant = /model|look|wear|front|side|portrait|person|human|模特|人物|穿|上身|展示|手持/.test(text);

  if (roleSet.has("product")) providerRoles.add("product");
  if (
    roleSet.has("model") &&
    isModelDominant &&
    shouldUseModelProviderReference(modelReferenceMode)
  ) {
    providerRoles.add("model");
  }
  if (roleSet.has("scene") && isSceneDominant) providerRoles.add("scene");
  if (roleSet.has("style") && isPureStyleAsset && providerRoles.size === 0) providerRoles.add("style");

  return Array.from(providerRoles);
}

type ModelReferenceMode = "auto" | "prompt_only" | "provider_input";

function normalizeModelReferenceMode(value: string | undefined): ModelReferenceMode {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "prompt_only" || normalized === "soft" || normalized === "natural_first") {
    return "prompt_only";
  }
  if (normalized === "provider_input" || normalized === "image_input" || normalized === "identity_first") {
    return "provider_input";
  }
  return "auto";
}

function filterModelProviderReferenceRoles(
  roles: CanvasReferenceRole[],
  mode: ModelReferenceMode
): CanvasReferenceRole[] {
  if (mode === "provider_input") return roles;
  if (mode === "prompt_only") return roles.filter((role) => role !== "model");
  return shouldUseModelProviderReference(mode) ? roles : roles.filter((role) => role !== "model");
}

function shouldUseModelProviderReference(mode: ModelReferenceMode): boolean {
  if (mode === "provider_input") return true;
  if (mode === "prompt_only") return false;
  return true;
}

function resolveProductReferenceFocus({
  record,
  metadata,
  campaignShot,
  title,
  type,
  prompt,
}: {
  record: Record<string, unknown>;
  metadata: Record<string, unknown>;
  campaignShot?: CampaignShot;
  title: string;
  type: string;
  prompt: string;
}): string | undefined {
  const explicit = getOptionalString(record.productReferenceFocus) ?? getOptionalString(metadata.productReferenceFocus);
  if (explicit) return explicit;

  const itemText = [
    title,
    type,
  ].filter(Boolean).join(" ").toLowerCase();
  const campaignText = [
    campaignShot?.slot,
    campaignShot?.label,
    campaignShot?.purpose,
  ].filter(Boolean).join(" ").toLowerCase();
  const promptText = prompt.toLowerCase();
  const text = `${itemText} ${campaignText} ${promptText}`;

  const itemFocus = resolvePrimaryProductReferenceFocus(itemText);
  if (itemFocus) return itemFocus;

  const campaignFocus = resolvePrimaryProductReferenceFocus(campaignText);
  if (campaignFocus) return campaignFocus;

  if (/silhouette|structure|profile|side|back|outline|construction|廓形|结构|侧面|背面|轮廓|版型/.test(promptText)) {
    return "silhouette_structure";
  }
  if (/model|wear|look|try.?on|person|human|模特|人物|穿|上身|展示|试穿/.test(promptText)) {
    return "model_wear";
  }
  if (/scene|lifestyle|street|indoor|outdoor|room|cafe|场景|街拍|室内|室外|生活|空间/.test(promptText)) {
    return "scene_lifestyle";
  }
  if (/hero|poster|banner|cover|campaign|visual|main|white|listing|amazon|主视觉|海报|封面|横幅|首图|主图|白底|亚马逊/.test(promptText)) {
    return "front_main";
  }
  if (/macro|close.?up|material|texture|fabric|craft|detail|材质|纹理|面料|工艺|细节|局部|特写/.test(text)) {
    return "material_detail";
  }
  if (/dimension|size|scale|spec|参数|尺寸|规格|比例/.test(text)) {
    return "scale_spec";
  }
  if (/feature|selling|info|卖点|信息|详情页/.test(text)) {
    return "feature_proof";
  }
  return "product_identity";
}

function resolvePrimaryProductReferenceFocus(text: string): string | undefined {
  if (!text) return undefined;
  if (/silhouette|structure|profile|side|back|outline|construction|廓形|结构|侧面|背面|轮廓|版型/.test(text)) {
    return "silhouette_structure";
  }
  if (/model|wear|look|try.?on|person|human|模特|人物|穿|上身|展示|试穿/.test(text)) {
    return "model_wear";
  }
  if (/scene|lifestyle|street|indoor|outdoor|room|cafe|场景|街拍|室内|室外|生活|空间/.test(text)) {
    return "scene_lifestyle";
  }
  if (/hero|poster|banner|cover|campaign|visual|main|white|listing|amazon|主视觉|海报|封面|横幅|首图|主图|白底|亚马逊/.test(text)) {
    return "front_main";
  }
  if (/macro|close.?up|material|texture|fabric|craft|detail|材质|纹理|面料|工艺|细节|局部|特写/.test(text)) {
    return "material_detail";
  }
  if (/dimension|size|scale|spec|参数|尺寸|规格|比例/.test(text)) {
    return "scale_spec";
  }
  if (/feature|selling|info|卖点|信息|详情页/.test(text)) {
    return "feature_proof";
  }
  return undefined;
}

function buildProductReferenceFocusInstruction(focus: string): string {
  const common =
    "如商品参考是拼版/多视图，只取商品证据，不复制拼版、边框、标签、白底或排版。";
  const focusInstructions: Record<string, string> = {
    front_main:
      "以最清楚的正面/三分角为准，保留完整轮廓、颜色、材质、关键结构和比例。",
    material_detail:
      "聚焦材质、纹理、缝线、扣具、五金、手柄、肩带、连接件或表面细节。",
    silhouette_structure:
      "用正面、侧面、背面或三分角判断结构比例，避免发明不存在的结构。",
    scale_spec:
      "重点保持尺寸感、厚度、比例和实际使用尺度，别用装饰遮住结构。",
    model_wear:
      "重点保持商品被拿、背、佩戴或接触身体时的形状、材质、颜色、比例和结构。",
    scene_lifestyle:
      "商品身份和比例不变，但光影、透视和接触关系要融入场景。",
    feature_proof:
      "只选一个可见卖点做证明，不要把所有信息塞进一张图。",
    product_identity:
      "以商品形状、材质、颜色、关键结构和比例为准，输出只服务一个明确目的。",
  };
  return `商品参考重点：${common}${focusInstructions[focus] ?? focusInstructions.product_identity}`;
}

function appendProductReferenceFocusPrompt(prompt: string, instruction: string | undefined): string {
  if (!instruction) return prompt;
  if (prompt.includes("Product reference focus:")) return prompt;
  return `${prompt.trim()}\n\n${instruction}`;
}

function buildReferenceRoutingSummary(
  referenceRoles: CanvasReferenceRole[],
  providerReferenceRoles: CanvasReferenceRole[],
  productReferenceFocus?: string
): Record<string, unknown> {
  const promptOnlyRoles = referenceRoles.filter((role) => !providerReferenceRoles.includes(role));
  return {
    activeRoles: referenceRoles,
    providerInputRoles: providerReferenceRoles,
    promptOnlyRoles,
    productReferenceFocus,
    rule:
      "Only providerInputRoles are sent as image references for this shot; promptOnlyRoles remain text/constraint guidance.",
  };
}

function buildReferenceContext(
  request: GenerationPlanDraftRequest
): GenerationReferenceContext | undefined {
  const explicitContext = normalizeGenerationReferenceContext(request.referenceContext);
  const imageContext = normalizeGenerationReferenceContext({
    version: 1,
    source: "canvas-workbench",
    images: request.referenceImages,
    roles: {},
  });
  const productImage = request.productImageBase64
    ? {
        role: "product" as const,
        title: "Product reference",
        url: request.productImageBase64,
        providerUsable: true,
        source: "dry-run-request",
      }
    : undefined;

  if (!explicitContext && !imageContext?.images.length && !productImage) return undefined;

  const base: GenerationReferenceContext = explicitContext ?? {
    version: 1,
    source: "canvas-workbench",
    images: [],
    roles: {},
    promptFragments: [],
    constraints: [],
    negativeRules: [],
    qualityRules: [],
  };

  const images = [
    ...(base.images ?? []),
    ...(imageContext?.images ?? []),
    ...(productImage ? [productImage] : []),
  ];

  return {
    ...base,
    images: dedupeReferenceImages(images),
  };
}

function dedupeReferenceImages(
  images: NonNullable<GenerationReferenceContext["images"]>
): NonNullable<GenerationReferenceContext["images"]> {
  const seen = new Set<string>();
  return images.filter((image) => {
    const key = `${image.role}:${image.url}:${image.nodeId ?? ""}:${image.assetId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((item): item is string => typeof item === "string" && !!item.trim());
  return values.length > 0 ? values : undefined;
}

function getReferenceRoleArray(value: unknown): CanvasReferenceRole[] | undefined {
  const values = getStringArray(value)?.filter((role): role is CanvasReferenceRole =>
    role === "product" || role === "model" || role === "style" || role === "scene" || role === "copy"
  );
  return values && values.length > 0 ? values : undefined;
}

function firstReferenceRoleArray(...values: unknown[]): CanvasReferenceRole[] | undefined {
  for (const value of values) {
    const roles = getReferenceRoleArray(value);
    if (roles) return roles;
  }
  return undefined;
}

function firstReferenceRoleArrayAllowEmpty(...values: unknown[]): CanvasReferenceRole[] | undefined {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const roles = value.filter((role): role is CanvasReferenceRole =>
      role === "product" || role === "model" || role === "style" || role === "scene" || role === "copy"
    );
    return roles;
  }
  return undefined;
}

function mergeStringArrays(...arrays: Array<string[] | undefined>): string[] {
  return [
    ...new Set(
      arrays
        .flatMap((array) => array ?? [])
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

function mergeReferenceRoles(
  ...arrays: Array<CanvasReferenceRole[] | undefined>
): CanvasReferenceRole[] {
  return [
    ...new Set(
      arrays
        .flatMap((array) => array ?? [])
        .filter((role): role is CanvasReferenceRole =>
          role === "product" || role === "model" || role === "style" || role === "scene" || role === "copy"
        )
    ),
  ];
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
