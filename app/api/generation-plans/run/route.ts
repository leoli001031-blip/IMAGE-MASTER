import { NextResponse } from "next/server";
import {
  buildProviderCallPolicy,
  normalizeConfirmedProviderCallLimit,
} from "@/lib/ai/provider-call-policy";
import {
  buildProviderReferenceAdapter,
  filterGenerationReferenceContextByRoles,
  getPrimaryProviderReferenceUrl,
  type GenerationReferenceContext,
} from "@/lib/canvas/generation-reference-context";
import { buildAgentPlan, type AgentPlan, type AgentPlanGenerationMatrixItem } from "@/lib/canvas/agent-plan-builder";
import { planAssetInvocation } from "@/lib/canvas/asset-invocation-planner";
import { buildGenerationPlanDraft } from "@/lib/canvas/generation-plan-builder";
import type { GenerationPlan, GenerationPlanDraftRequest, GenerationPlanItem } from "@/lib/canvas/generation-plan";
import { writeProviderImagePrompt } from "@/lib/canvas/provider-prompt-writer";
import { classifyProductReference, type ProductReferenceGuardResult } from "@/lib/canvas/product-reference-guard";
import { safeLogError } from "@/lib/server/safe-log";
import * as jobDB from "@/lib/store/job-db";
import * as projectDB from "@/lib/store/project-db";
import { startGenerationJob } from "@/lib/store/job-runner";
import type { GenerationJob } from "@/lib/types";

export const dynamic = "force-dynamic";

type ExecutableGenerationPlan = GenerationPlan & {
  committedAt?: string;
  queuedAt?: string;
  agentPlan?: AgentPlan;
  productReferenceGuard?: ProductReferenceGuardResult;
};

class ProductReferenceRequiredError extends Error {
  constructor(
    message: string,
    public readonly productReferenceGuard: ProductReferenceGuardResult
  ) {
    super(message);
    this.name = "ProductReferenceRequiredError";
  }
}

export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (!body) {
      return NextResponse.json({ error: "生成计划请求体无效" }, { status: 400 });
    }

    const request = body as GenerationPlanDraftRequest;
    const draft = buildGenerationPlanDraft(request);
    if (!draft.ok) {
      return NextResponse.json(draft, { status: 400 });
    }

    const agentPlan = await buildAgentPlan({
      plan: draft.plan,
      request,
      referenceContext: draft.plan.referenceContext,
      sopExecutionPlan: draft.plan.sopExecutionPlan,
    });
    const productReferenceGuard = classifyProductReference(draft.plan.referenceContext);
    const productGuardIssues = buildProductGuardIssues(agentPlan, productReferenceGuard);
    if (productGuardIssues.length > 0) {
      return NextResponse.json(
        {
          error: "商品真实身份生成需要先上传可用的商品参考图",
          code: "PRODUCT_REFERENCE_REQUIRED",
          issues: productGuardIssues,
          agentPlan: summarizeAgentPlanForResponse(agentPlan),
          productReferenceGuard: summarizeProductReferenceGuard(productReferenceGuard),
        },
        { status: 400 }
      );
    }

    const enqueue = body.enqueue === true;
    const confirmedProviderCallLimit = normalizeConfirmedProviderCallLimit(
      body.confirmedProviderCallLimit
    );
    const providerPolicy = buildProviderCallPolicy({
      estimate: draft.estimate,
      dryRun: false,
      confirmedProviderCallLimit,
    });

    if (enqueue && providerPolicy.mode !== "confirmed") {
      return NextResponse.json(
        {
          error: "生成计划入队前需要确认 provider 调用上限",
          code: "PROVIDER_CALL_LIMIT_NOT_CONFIRMED",
          estimate: draft.estimate,
          providerPolicy,
          requiredConfirmation: providerPolicy.requiredConfirmation,
        },
        { status: 402 }
      );
    }

    const now = new Date().toISOString();
    const approvalMetadata =
      providerPolicy.mode === "confirmed"
        ? {
            approvedProviderCallLimit: providerPolicy.confirmedProviderCallLimit,
            approvedAt: now,
            providerCallBudgetId: createProviderCallBudgetId(draft.plan.planId),
          }
        : {};
    const plan: ExecutableGenerationPlan = {
      ...draft.plan,
      agentPlan,
      productReferenceGuard,
      providerPolicy,
      status: enqueue ? "approved" as const : "ready" as const,
      approval: {
        ...draft.plan.approval,
        status: enqueue ? "approved" as const : "pending" as const,
        requiredConfirmation: providerPolicy.requiredConfirmation,
        ...approvalMetadata,
      },
      committedAt: now,
      queuedAt: enqueue ? now : undefined,
      metadata: {
        ...draft.plan.metadata,
        agentPlan,
        productReferenceGuard,
      },
    };
    const jobs = await mapWithConcurrency(
      plan.items,
      getPlanJobPreparationConcurrency(plan.items.length),
      (item, index) =>
        createPlanJob({
          item,
          index,
          total: plan.items.length,
          plan,
          request: body,
          approvalMetadata,
        })
    );

    const queueResults = [];
    if (enqueue) {
      for (const job of jobs) {
        queueResults.push(await startGenerationJob(job.id));
      }
    }

    return NextResponse.json(
      {
        ok: true,
        dryRun: false,
        queued: enqueue,
        plan: summarizePlanForResponse(plan),
        jobs: enqueue
          ? queueResults.map((result) => summarizeJobForResponse(result.job))
          : jobs.map(summarizeJobForResponse),
        queueResults: queueResults.map((result) => ({
          ...result,
          job: summarizeJobForResponse(result.job),
        })),
        estimate: draft.estimate,
        providerPolicy,
        referenceSlots: summarizeReferenceSlotsForResponse(draft.referenceSlots),
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ProductReferenceRequiredError) {
      return NextResponse.json(
        {
          error: error.message,
          code: "PRODUCT_REFERENCE_REQUIRED",
          productReferenceGuard: summarizeProductReferenceGuard(error.productReferenceGuard),
        },
        { status: 400 }
      );
    }
    safeLogError("Generation plan run failed", error);
    return NextResponse.json({ error: "生成计划提交失败" }, { status: 500 });
  }
}

function getPlanJobPreparationConcurrency(itemCount: number): number {
  const raw = Number(process.env.IMAGE_MASTER_PLAN_JOB_PREP_CONCURRENCY ?? 4);
  const configured = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 4;
  if (itemCount <= 1) return 1;
  return Math.max(1, Math.min(configured, itemCount, 8));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    })
  );
  return results;
}

function summarizePlanForResponse(plan: ExecutableGenerationPlan) {
  return {
    planId: plan.planId,
    workflowId: plan.workflowId,
    frameNodeId: plan.frameNodeId,
    batchId: plan.batchId,
    status: plan.status,
    committedAt: plan.committedAt,
    queuedAt: plan.queuedAt,
    approval: plan.approval,
    providerPolicy: plan.providerPolicy,
    estimate: plan.estimate,
    agentPlan: plan.agentPlan ? summarizeAgentPlanForResponse(plan.agentPlan) : undefined,
    productReferenceGuard: plan.productReferenceGuard
      ? summarizeProductReferenceGuard(plan.productReferenceGuard)
      : undefined,
    items: plan.items.map((item) => ({
      itemId: item.itemId,
      title: item.title,
      type: item.type,
      ratio: item.ratio,
      size: item.size,
      referenceRoles: item.referenceRoles,
      providerReferenceRoles: item.providerReferenceRoles,
    })),
  };
}

function summarizeJobForResponse(job: GenerationJob | undefined): GenerationJob | undefined {
  if (!job) return undefined;
  return {
    id: job.id,
    workflowId: job.workflowId,
    nodeId: job.nodeId,
    assetId: job.assetId,
    status: job.status,
    prompt: job.prompt,
    resultUrl: job.resultUrl,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    metadata: summarizeJobMetadataForResponse(job.metadata),
  };
}

function summarizeJobMetadataForResponse(metadata: GenerationJob["metadata"]): GenerationJob["metadata"] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const allowedKeys = [
    "source",
    "planId",
    "planStatus",
    "planItemId",
    "planItemTitle",
    "planItemType",
    "batchId",
    "batchIndex",
    "batchTotal",
    "frameNodeId",
    "exportPackId",
    "exportPackTitle",
    "exportItemId",
    "exportItemTitle",
    "platform",
    "size",
    "ratio",
    "useCase",
    "imageType",
    "usesProviderReference",
    "usesProductReference",
    "providerReferenceRole",
    "providerReferenceStrategy",
    "providerReferenceAdapter",
    "itemReferenceRoles",
    "itemProviderReferenceRoles",
    "productReferenceFocus",
    "assetInvocationPlan",
    "assetInvocationPlanner",
    "agentMatrixItem",
    "agentPlanSummary",
    "agentAssetGroupIds",
    "providerPromptWriter",
    "approvedProviderCallLimit",
    "approvedAt",
    "providerCallBudgetId",
    "itemMetadata",
  ];
  const compact: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (key in metadata) compact[key] = metadata[key];
  }
  return compact;
}

function summarizeReferenceSlotsForResponse(referenceSlots: ReturnType<typeof buildGenerationPlanDraft>["referenceSlots"]) {
  return referenceSlots.map((slot) => ({
    role: slot.role,
    required: slot.required,
    title: slot.title,
    providerUsable: slot.providerUsable,
    validationStatus: slot.validationStatus,
    issues: slot.issues,
  }));
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
    status: item.status,
    summary: item.summary,
  };
}

function summarizeProductReferenceGuard(result: ProductReferenceGuardResult) {
  return {
    kind: result.kind,
    hasProviderUsableRealProductImage: result.hasProviderUsableRealProductImage,
    providerUsableProductImage: result.providerUsableProductImage
      ? {
          role: result.providerUsableProductImage.role,
          title: result.providerUsableProductImage.title,
          source: result.providerUsableProductImage.source,
          assetId: result.providerUsableProductImage.assetId,
          nodeId: result.providerUsableProductImage.nodeId,
          componentId: result.providerUsableProductImage.componentId,
        }
      : undefined,
    productImageCount: result.productImages.length,
    providerUsableProductImageCount: result.providerUsableProductImages.length,
    parameterKeys: result.parameterKeys,
    issues: result.issues,
  };
}

function buildProductGuardIssues(
  agentPlan: AgentPlan,
  productReferenceGuard: ProductReferenceGuardResult
): string[] {
  if (productReferenceGuard.hasProviderUsableRealProductImage) return [];
  const productProviderItems = agentPlan.generationMatrix.filter((item) =>
    item.providerReferenceRoles.includes("product")
  );
  if (productProviderItems.length === 0) return [];
  return productProviderItems.map((item) =>
    `${item.title} 需要锁定真实商品，但当前商品参考是 ${productReferenceGuard.kind}。`
  );
}

async function createPlanJob({
  item,
  index,
  total,
  plan,
  request,
  approvalMetadata,
}: {
  item: GenerationPlanItem;
  index: number;
  total: number;
  plan: ExecutableGenerationPlan;
  request: Record<string, unknown>;
  approvalMetadata: Record<string, unknown>;
}): Promise<GenerationJob> {
  const userRequest = getString(request.request) ?? getString(request.userRequest) ?? getString(request.brief);
  const agentMatrixItem = findAgentMatrixItem(plan.agentPlan, item, index);
  const agentRoutedItem = applyAgentMatrixToItem(item, agentMatrixItem, plan.agentPlan);
  const deferPromptPreparation = request.enqueue === true;
  let activeItem: GenerationPlanItem = agentRoutedItem;
  let assetInvocationPlan: Awaited<ReturnType<typeof planAssetInvocation>> | undefined;
  if (!deferPromptPreparation) {
    assetInvocationPlan = await planAssetInvocation({
      item: agentRoutedItem,
      referenceContext: plan.referenceContext,
      userRequest,
      sopExecutionPlan: plan.sopExecutionPlan,
    });
    activeItem = {
      ...agentRoutedItem,
      referenceRoles: assetInvocationPlan.referenceRoles,
      providerReferenceRoles: assetInvocationPlan.providerReferenceRoles,
      metadata: {
        ...agentRoutedItem.metadata,
        assetInvocationPlan,
        assetInvocationPlanner: {
          mode: assetInvocationPlan.mode,
          fallbackUsed: assetInvocationPlan.fallbackUsed,
          fallbackReason: assetInvocationPlan.fallbackReason,
        },
      },
    };
  }
  const roleFilteredReferenceContext = filterGenerationReferenceContextByRoles(
    plan.referenceContext,
    activeItem.referenceRoles,
    activeItem.providerReferenceRoles
  );
  const itemReferenceContext = applyAgentMatrixReferenceSelection(
    roleFilteredReferenceContext,
    plan.agentPlan,
    agentMatrixItem,
    activeItem
  );
  const itemProductReferenceGuard = classifyProductReference(itemReferenceContext);
  if (
    activeItem.providerReferenceRoles?.includes("product") &&
    !itemProductReferenceGuard.hasProviderUsableRealProductImage
  ) {
    throw new ProductReferenceRequiredError(
      `${activeItem.title} 需要锁定真实商品，但当前没有可用商品参考图。`,
      itemProductReferenceGuard
    );
  }
  const providerReferenceAdapter = buildProviderReferenceAdapter(itemReferenceContext);
  const referenceImageUrl = getPrimaryProviderReferenceUrl(itemReferenceContext);
  const providerPrompt = deferPromptPreparation
    ? {
        prompt: activeItem.prompt || activeItem.title,
        metadata: {
          version: 1,
          mode: "deferred_job_runner_v1",
          fallbackUsed: false,
          promptLanguage: "zh",
          sourcePromptChars: activeItem.prompt.length,
          promptChars: (activeItem.prompt || activeItem.title).length,
          promptMaxChars: 0,
          referenceRoles: activeItem.referenceRoles ?? [],
          providerReferenceRoles: activeItem.providerReferenceRoles ?? [],
          providerReferenceCount: providerReferenceAdapter.providerUsableImages.length,
          promptOnlyReferenceCount: providerReferenceAdapter.promptOnlyImages.length,
          sourcePromptPreview: (activeItem.prompt || activeItem.title).slice(0, 160),
        },
      }
    : await writeProviderImagePrompt({
        item: activeItem,
        itemReferenceContext,
        providerReferenceAdapter,
        userRequest,
        campaignBible: plan.campaignBible,
        sopExecutionPlan: plan.sopExecutionPlan,
        planId: plan.planId,
      });
  const metadata = {
    source: "generation-plan-run",
    planId: plan.planId,
    planStatus: plan.status,
    planCommittedAt: plan.committedAt,
    planQueuedAt: plan.queuedAt,
    planItemId: activeItem.itemId,
    planItemTitle: activeItem.title,
    planItemType: activeItem.type,
    batchId: plan.batchId,
    projectId: getString(request.projectId),
    campaignId: getString(request.campaignId),
    batchIndex: index + 1,
    batchTotal: total,
    batchJobTitle: activeItem.title,
    exportPackId: plan.batchId,
    exportPackTitle: getString(request.batchTitle) ?? getString(request.title) ?? "生成计划图组",
    exportItemId: activeItem.itemId,
    exportItemTitle: activeItem.title,
    exportSpecId: activeItem.exportSpecId ?? activeItem.type,
    exportSpecTitle: activeItem.title,
    platform: getString(request.platform) ?? "multi_channel",
    campaignBible: plan.campaignBible,
    campaignShot: activeItem.metadata.campaignShot,
    campaignShotId: activeItem.metadata.campaignShotId,
    shotRole: activeItem.metadata.shotRole,
    shotReferenceRoles: activeItem.metadata.shotReferenceRoles,
    size: activeItem.size,
    ratio: activeItem.ratio,
    naming: activeItem.naming,
    qualityRules: activeItem.qualityRules,
    useCase: activeItem.type,
    whiteBackground: activeItem.whiteBackground,
    textAllowed: activeItem.textAllowed,
    copyRenderPolicy: activeItem.copyRenderPolicy,
    modelRequired: activeItem.modelRequired,
    imageType: activeItem.type,
    copyText: activeItem.copyText,
    style: getString(request.style),
    modelIds: getStringArray(request.modelIds),
    referenceImages: itemReferenceContext?.images ?? [],
    referenceContext: itemReferenceContext,
    globalReferenceContext: plan.referenceContext,
    referenceSlots: plan.referenceSlots,
    itemReferenceRoles: activeItem.referenceRoles ?? [],
    itemProviderReferenceRoles: activeItem.providerReferenceRoles ?? [],
    productReferenceFocus: activeItem.productReferenceFocus,
    productReferenceFocusInstruction: activeItem.productReferenceFocusInstruction,
    referenceRouting: {
      ...(isRecord(activeItem.metadata.referenceRouting) ? activeItem.metadata.referenceRouting : {}),
      activeRoles: activeItem.referenceRoles ?? [],
      providerInputRoles: activeItem.providerReferenceRoles ?? [],
      plannerMode: assetInvocationPlan?.mode ?? "deferred_job_runner_v1",
      agentMatrixItemId: agentMatrixItem?.id,
      agentAssetGroupIds: agentMatrixItem?.assetGroupIds ?? [],
    },
    agentMatrixItem: agentMatrixItem ? summarizeAgentMatrixItem(agentMatrixItem) : undefined,
    agentPlanSummary: plan.agentPlan?.summary,
    agentAssetGroupIds: agentMatrixItem?.assetGroupIds ?? [],
    ...(assetInvocationPlan
      ? {
          assetInvocationPlan,
          assetInvocationPlanner: {
            mode: assetInvocationPlan.mode,
            fallbackUsed: assetInvocationPlan.fallbackUsed,
            fallbackReason: assetInvocationPlan.fallbackReason,
          },
        }
      : {
          deferPromptPreparation: true,
          deferredPlanItem: activeItem,
          deferredUserRequest: userRequest,
          deferredPromptPreparationMode: "job_runner",
        }),
    knowledgeSelection: plan.knowledgeSelection,
    knowledgeTrace: plan.knowledgeSelection?.knowledgeTrace,
    sopKeys: plan.knowledgeSelection?.sopKeys ?? [],
    sopExecutionPlan: plan.sopExecutionPlan,
    referenceImageUrl,
    providerReferenceRole: providerReferenceAdapter.primaryImage?.role,
    providerReferenceStrategy: providerReferenceAdapter.strategy,
    providerReferenceAdapter,
    providerPromptWriter: providerPrompt.metadata,
    promptOnlyReferenceImages: providerReferenceAdapter.promptOnlyImages,
    usesProviderReference: !!referenceImageUrl,
    usesProductReference: providerReferenceAdapter.primaryImage?.role === "product",
    estimate: plan.estimate,
    providerPolicy: plan.providerPolicy,
    ...approvalMetadata,
    itemMetadata: activeItem.metadata,
  };

  let job = await jobDB.add({
    workflowId: plan.workflowId,
    nodeId: plan.frameNodeId,
    status: "pending",
    prompt: providerPrompt.prompt,
    metadata,
  });
  const batchState = await projectDB.ensureExportPackBatchForJob(job);
  if (batchState) {
    job = await jobDB.update(job.id, {
      metadata: {
        ...job.metadata,
        projectId: batchState.projectId,
        campaignId: batchState.campaignId,
        batchState: batchState.state,
      },
    }) ?? job;
  }
  return job;
}

function findAgentMatrixItem(
  agentPlan: AgentPlan | undefined,
  item: GenerationPlanItem,
  index: number
): AgentPlanGenerationMatrixItem | undefined {
  if (!agentPlan) return undefined;
  return agentPlan.generationMatrix.find((entry) => entry.itemId === item.itemId)
    ?? agentPlan.generationMatrix[index];
}

function applyAgentMatrixToItem(
  item: GenerationPlanItem,
  matrixItem: AgentPlanGenerationMatrixItem | undefined,
  agentPlan: AgentPlan | undefined
): GenerationPlanItem {
  if (!matrixItem) return item;
  return {
    ...item,
    referenceRoles: matrixItem.referenceRoles.length ? matrixItem.referenceRoles : item.referenceRoles,
    providerReferenceRoles: matrixItem.providerReferenceRoles.length
      ? matrixItem.providerReferenceRoles
      : item.providerReferenceRoles,
    metadata: {
      ...item.metadata,
      agentMatrixItem: summarizeAgentMatrixItem(matrixItem),
      agentPlanSummary: agentPlan?.summary,
      agentAssetGroupIds: matrixItem.assetGroupIds,
    },
  };
}

function applyAgentMatrixReferenceSelection(
  context: GenerationReferenceContext | undefined,
  agentPlan: AgentPlan | undefined,
  matrixItem: AgentPlanGenerationMatrixItem | undefined,
  item?: GenerationPlanItem
): GenerationReferenceContext | undefined {
  if (!context || !agentPlan || !matrixItem?.assetGroupIds.length) return context;
  const selectedGroups = agentPlan.assetGroups.filter((group) =>
    matrixItem.assetGroupIds.includes(group.id)
  );
  if (selectedGroups.length === 0) return context;

  const selectedUrlsByRole = new Map<string, Set<string>>();
  const selectedImageRoles = new Set<string>();
  for (const group of selectedGroups) {
    if (group.imageUrls.length === 0) continue;
    selectedImageRoles.add(group.role);
    const urls = selectedUrlsByRole.get(group.role) ?? new Set<string>();
    for (const url of group.imageUrls) urls.add(url);
    selectedUrlsByRole.set(group.role, urls);
  }
  if (selectedUrlsByRole.size === 0) return context;

  const filteredImages = context.images.filter((image) => {
    const selectedUrls = selectedUrlsByRole.get(image.role);
    if (!selectedImageRoles.has(image.role)) return false;
    return Boolean(selectedUrls?.has(image.url));
  });

  return {
    ...context,
    images: narrowReferenceImagesForProvider(filteredImages, item),
  };
}

function narrowReferenceImagesForProvider(
  images: GenerationReferenceContext["images"],
  item: GenerationPlanItem | undefined
): GenerationReferenceContext["images"] {
  if (images.length <= 1) return images;
  const grouped = new Map<string, GenerationReferenceContext["images"]>();
  for (const image of images) {
    const list = grouped.get(image.role) ?? [];
    list.push(image);
    grouped.set(image.role, list);
  }
  const narrowed: GenerationReferenceContext["images"] = [];
  for (const image of images) {
    const sameRole = grouped.get(image.role) ?? [];
    if (sameRole.length <= 1) {
      narrowed.push(image);
      continue;
    }
    if (!shouldKeepSingleProviderImageForRole(image.role, item)) {
      narrowed.push(image);
      continue;
    }
    const best = selectBestReferenceImageForItem(sameRole, item);
    if (best === image && !narrowed.some((entry) => entry.role === image.role && entry.url === image.url)) {
      narrowed.push(image);
    }
  }
  return narrowed;
}

function shouldKeepSingleProviderImageForRole(role: string, item: GenerationPlanItem | undefined): boolean {
  if (role === "scene" || role === "model" || role === "style") return true;
  if (role !== "product") return false;
  const text = buildItemSelectionText(item);
  return !/三品类|多品类|组合|套组|bundle|collection|multi[-_\s]?product/i.test(text);
}

function selectBestReferenceImageForItem(
  images: GenerationReferenceContext["images"],
  item: GenerationPlanItem | undefined
): GenerationReferenceContext["images"][number] {
  let best = images[0];
  let bestScore = -Infinity;
  for (const [index, image] of images.entries()) {
    const score = scoreReferenceImageForItem(image, item) - index * 0.01;
    if (score > bestScore) {
      best = image;
      bestScore = score;
    }
  }
  return best;
}

function scoreReferenceImageForItem(
  image: GenerationReferenceContext["images"][number],
  item: GenerationPlanItem | undefined
): number {
  const itemText = buildItemSelectionText(item);
  const imageText = [
    image.title,
    image.assetId,
    image.nodeId,
    image.componentId,
    image.source,
  ].filter(Boolean).join(" ").toLowerCase();
  let score = 0;
  const pairs: Array<[RegExp, RegExp, number]> = [
    [/商场|橱窗|中庭|mall|shopping/i, /商场|橱窗|mall/i, 10],
    [/室内|咖啡|家居|窗边|indoor|cafe|home/i, /室内|咖啡|家居|indoor|cafe|home/i, 10],
    [/户外|花店|街边|街拍|outdoor|florist|street/i, /户外|花店|街拍|outdoor|florist|street/i, 10],
    [/雪山|雪地|snow|mountain/i, /雪山|雪地|snow|mountain/i, 10],
    [/办公|office|desk/i, /办公|office|desk/i, 10],
    [/白棚|影棚|studio|白底/i, /白棚|影棚|studio|白底/i, 10],
    [/甜妹|少女|sweet/i, /甜妹|少女|sweet/i, 8],
    [/高级|东欧|premium|editorial/i, /高级|东欧|premium|editorial/i, 8],
  ];
  for (const [itemPattern, imagePattern, weight] of pairs) {
    if (itemPattern.test(itemText) && imagePattern.test(imageText)) score += weight;
  }
  if (image.role === "product") score += 2;
  if (image.role === "model") score += 1;
  return score;
}

function buildItemSelectionText(item: GenerationPlanItem | undefined): string {
  if (!item) return "";
  return [
    item.itemId,
    item.title,
    item.type,
    item.prompt,
    item.copyText,
    item.productReferenceFocus,
  ].filter(Boolean).join(" ").toLowerCase();
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && !!item.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function createProviderCallBudgetId(planId: string): string {
  return `provider_budget_${planId}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}
