import { NextResponse } from "next/server";
import { generateBatchImages } from "@/lib/ai/client";
import {
  normalizeImageProviderDiagnostic,
  type ImageProviderDiagnostic,
} from "@/lib/ai/image-provider-diagnostics";
import {
  EMPTY_RESULT_RETRY_LIMIT,
  TRANSIENT_PROVIDER_RETRY_LIMIT,
  buildProviderCallEstimate,
  buildProviderCallGuardrails,
  getMaxBatchImages,
  normalizeConfirmedProviderCallLimit,
  validateProviderPrompts,
  validateProviderReferenceImage,
  type ProviderCallEstimate,
} from "@/lib/ai/provider-call-policy";
import {
  persistBatchGenerationResults,
  type BatchGeneratedImageResult,
} from "@/lib/store/batch-generation-persistence";
import { getConfigPublic } from "@/lib/store/config-store";
import * as jobDB from "@/lib/store/job-db";
import * as projectDB from "@/lib/store/project-db";
import { startGenerationJob } from "@/lib/store/job-runner";
import { storeOutputImage } from "@/lib/store/output-file-store";
import { safeLogError } from "@/lib/server/safe-log";
import {
  appendProviderBudgetMetadata,
  reserveProviderCallBudget,
} from "@/lib/store/provider-budget-store";
import type { GenerationJob } from "@/lib/types";

interface ImageRequest {
  prompt: string;
  type: string;
  copyText: string;
  title: string;
  exportSpecId?: string;
  naming?: string;
  size?: string;
  ratio?: string;
  whiteBackground?: boolean;
  textAllowed?: boolean;
  modelRequired?: boolean;
  qualityRules?: string[];
}

export async function POST(req: Request) {
  try {
    const {
      images,
      style,
      modelIds,
      productImageBase64,
      dryRun,
      confirmedProviderCallLimit,
      persistProjectBatch,
      enqueue,
      batchId,
      workflowId,
      nodeId,
      assetId,
      batchTitle,
      platform,
      mockResults,
    }: {
      images: ImageRequest[];
      style: string;
      modelIds: string[];
      productImageBase64?: string;
      dryRun?: boolean;
      confirmedProviderCallLimit?: number;
      persistProjectBatch?: boolean;
      enqueue?: boolean;
      batchId?: string;
      workflowId?: string;
      nodeId?: string;
      assetId?: string;
      batchTitle?: string;
      platform?: string;
      mockResults?: unknown;
    } = await req.json();

    if (!images || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: "缺少图片生成请求" }, { status: 400 });
    }

    const maxImages = getMaxBatchImages();
    if (images.length > maxImages) {
      return NextResponse.json(
        {
          error: `单次最多生成 ${maxImages} 张图片`,
          guardrails: buildProviderCallGuardrails(maxImages),
        },
        { status: 400 }
      );
    }

    const promptValidation = validateProviderPrompts(images.map((img) => img.prompt));
    if (promptValidation.ok === false) {
      return NextResponse.json(
        {
          error: promptValidation.error,
          guardrails: buildProviderCallGuardrails(maxImages),
        },
        { status: 400 }
      );
    }

    const referenceValidation = validateProviderReferenceImage(productImageBase64);
    if (referenceValidation.ok === false) {
      return NextResponse.json(
        {
          error: referenceValidation.error,
          guardrails: buildProviderCallGuardrails(maxImages),
        },
        { status: 400 }
      );
    }

    const prompts = images.map((img) => img.prompt.trim());
    const estimate = buildProviderCallEstimate({
      imageCount: images.length,
      maxImages,
      usesProductReference: !!productImageBase64,
      referenceImageBytes: referenceValidation.bytes,
    });
    const generationConcurrency = estimate.concurrency;

    if (dryRun === true) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        estimate,
        guardrails: buildProviderCallGuardrails(maxImages),
      });
    }

    const providerCallLimit = normalizeConfirmedProviderCallLimit(confirmedProviderCallLimit);

    if (providerCallLimit < estimate.providerCallCount) {
      return NextResponse.json(
        {
          error: "真实生成前需要确认 provider 调用上限",
          code: "PROVIDER_CALL_LIMIT_NOT_CONFIRMED",
          estimate,
          guardrails: buildProviderCallGuardrails(maxImages),
          requiredConfirmation: {
            field: "confirmedProviderCallLimit",
            minimum: estimate.providerCallCount,
          },
        },
        { status: 402 }
      );
    }

    if (enqueue === true) {
      const queued = await enqueueBatchGenerationJobs({
        images,
        prompts,
        style,
        modelIds,
        productImageBase64,
        batchId,
        workflowId,
        nodeId,
        assetId,
        batchTitle,
        platform,
        estimate,
        approvedProviderCallLimit: providerCallLimit,
      });

      return NextResponse.json(
        {
          ok: true,
          queued: true,
          images: queued.images,
          jobs: queued.queueResults.map((result) => result.job),
          queueResults: queued.queueResults,
          estimate: {
            ...estimate,
            providerCallCountUsed: 0,
            queuedProviderCallCount: estimate.providerCallCount,
            retryCount: 0,
            retryCounts: Array.from({ length: prompts.length }, () => 0),
          },
          guardrails: buildProviderCallGuardrails(maxImages),
          persistence: queued.persistence,
        },
        { status: 202 }
      );
    }

    const mockBatchEnabled = process.env.IMAGE_MASTER_ENABLE_MOCK_BATCH === "1";
    const usingMockResults = mockBatchEnabled && Array.isArray(mockResults);
    const imageSizes = images.map((image) => getOptionalString(image.size));
    const results = usingMockResults
      ? mapMockBatchResults(mockResults, prompts.length)
      : await generateBatchImages(prompts, productImageBase64, generationConcurrency, { imageSizes });
    let providerCallCountUsed = prompts.length;
    const retryCounts = Array.from({ length: prompts.length }, () => 0);
    const transientRetryCounts = Array.from({ length: prompts.length }, () => 0);
    const retryReasons = Array.from({ length: prompts.length }, () => [] as string[]);

    for (let index = 0; !usingMockResults && index < results.length; index++) {
      while (results[index]?.error && providerCallCountUsed < providerCallLimit) {
        const errorCode = results[index].error?.code;
        if (errorCode === "EMPTY_RESULT") {
          if (retryCounts[index] >= EMPTY_RESULT_RETRY_LIMIT) break;
          retryCounts[index] += 1;
        } else if (isTransientProviderErrorCode(errorCode)) {
          if (transientRetryCounts[index] >= TRANSIENT_PROVIDER_RETRY_LIMIT) break;
          transientRetryCounts[index] += 1;
        } else {
          break;
        }

        providerCallCountUsed += 1;
        retryReasons[index].push(errorCode || "IMAGE_GENERATION_FAILED");
        await waitForProviderRetryDelay(errorCode, retryCounts[index] + transientRetryCounts[index]);
        const [retryResult] = await generateBatchImages([prompts[index]], productImageBase64, 1, {
          imageSizes: [imageSizes[index]],
        });
        results[index] = retryResult;
      }
    }
    const emptyResultRetryCount = retryCounts.reduce((sum, count) => sum + count, 0);
    const transientRetryCount = transientRetryCounts.reduce((sum, count) => sum + count, 0);

    const mapped: BatchGeneratedImageResult[] = results.map((result, index) => {
      const img = images[index];
      const imageMetadata = buildImageRequestMetadata(img, index);
      if (result.image?.base64 || result.image?.url) {
        return {
          id: crypto.randomUUID(),
          url: result.image.base64
            ? `data:image/png;base64,${result.image.base64}`
            : result.image.url || "",
          type: img.type,
          copyText: img.copyText,
          title: img.title,
          prompt: img.prompt,
          metadata: { style, modelIds, ...imageMetadata },
        };
      }
      return {
        id: crypto.randomUUID(),
        url: "",
        type: img.type,
        copyText: img.copyText,
        title: img.title,
        prompt: img.prompt,
        error: result.error?.message || "图片生成失败",
        errorCode: result.error?.code || "IMAGE_GENERATION_FAILED",
        diagnostics: result.error?.diagnostics,
        metadata: { style, modelIds, ...imageMetadata },
      };
    });

    const persistence =
      persistProjectBatch === true && typeof batchId === "string" && batchId.trim()
        ? await persistBatchGenerationResults({
            batchId: batchId.trim(),
            batchTitle:
              typeof batchTitle === "string" && batchTitle.trim()
                ? batchTitle.trim()
                : "真实图组生成批次",
            workflowId: typeof workflowId === "string" ? workflowId : undefined,
            nodeId: typeof nodeId === "string" ? nodeId : undefined,
            assetId: typeof assetId === "string" ? assetId : undefined,
            platform: typeof platform === "string" && platform.trim() ? platform.trim() : "multi_channel",
            productImageBase64,
            images: mapped,
            style,
            modelIds,
            estimate: {
              ...estimate,
              providerCallCountUsed,
              retryCount: emptyResultRetryCount + transientRetryCount,
              emptyResultRetryCount,
              transientRetryCount,
              retryCounts,
              transientRetryCounts,
              retryReasons,
            },
          })
        : undefined;

    return NextResponse.json({
      images: mapped,
      estimate: {
        ...estimate,
        providerCallCountUsed,
        retryCount: emptyResultRetryCount + transientRetryCount,
        emptyResultRetryCount,
        transientRetryCount,
        retryCounts,
        transientRetryCounts,
        retryReasons,
      },
      guardrails: buildProviderCallGuardrails(maxImages),
      persistence,
    });
  } catch (e) {
    safeLogError("Batch image generation failed", e);
    return NextResponse.json(
      {
        error: "批量生成失败，请稍后重试",
        guardrails: buildProviderCallGuardrails(getMaxBatchImages()),
      },
      { status: 500 }
    );
  }
}

function buildImageRequestMetadata(image: ImageRequest, index: number): Record<string, unknown> {
  return {
    exportSpecId: getOptionalString(image.exportSpecId) || `${getOptionalString(image.type) || "image"}-${index + 1}`,
    naming: getOptionalString(image.naming) || `${getOptionalString(image.type) || "image"}-${index + 1}`,
    size: getOptionalString(image.size),
    ratio: getOptionalString(image.ratio),
    whiteBackground: typeof image.whiteBackground === "boolean" ? image.whiteBackground : undefined,
    textAllowed: typeof image.textAllowed === "boolean" ? image.textAllowed : undefined,
    modelRequired: typeof image.modelRequired === "boolean" ? image.modelRequired : undefined,
    qualityRules: Array.isArray(image.qualityRules)
      ? image.qualityRules.filter((rule): rule is string => typeof rule === "string" && !!rule.trim())
      : undefined,
  };
}

function isTransientProviderErrorCode(code: string | undefined): boolean {
  if (!code) return false;
  if (code === "TIMEOUT" || code === "AI_ERROR" || code === "IMAGE_GEN_429") return true;
  const match = code.match(/^IMAGE_GEN_(\d{3})$/);
  if (!match) return false;
  const status = Number(match[1]);
  return status >= 500 && status <= 599;
}

async function waitForProviderRetryDelay(code: string | undefined, attempt: number): Promise<void> {
  const baseDelayMs = code === "IMAGE_GEN_429" ? 1200 : code === "EMPTY_RESULT" ? 300 : 700;
  const delayMs = Math.min(baseDelayMs * Math.max(1, attempt), 2500);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function enqueueBatchGenerationJobs({
  images,
  prompts,
  style,
  modelIds,
  productImageBase64,
  batchId,
  workflowId,
  nodeId,
  assetId,
  batchTitle,
  platform,
  estimate,
  approvedProviderCallLimit,
}: {
  images: ImageRequest[];
  prompts: string[];
  style: string;
  modelIds: string[];
  productImageBase64?: string;
  batchId?: string;
  workflowId?: string;
  nodeId?: string;
  assetId?: string;
  batchTitle?: string;
  platform?: string;
  estimate: ProviderCallEstimate;
  approvedProviderCallLimit: number;
}) {
  const normalizedBatchId =
    getOptionalString(batchId) || `batch_image_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const normalizedBatchTitle = getOptionalString(batchTitle) || "图组生成批次";
  const normalizedPlatform = getOptionalString(platform) || "multi_channel";
  const config = getConfigPublic();
  const provider = getProviderLabel(config.imageBaseUrl || config.baseUrl);
  const model = config.imageModel;
  const now = new Date().toISOString();
  const providerCallBudgetId = `provider_budget_${normalizedBatchId}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const reserveEvent = reserveProviderCallBudget({
    budgetId: providerCallBudgetId,
    scope: "batch-enqueue",
    amount: estimate.providerCallCount,
    metadata: {
      batchId: normalizedBatchId,
      provider,
      model,
      approvedProviderCallLimit,
      queuedImageCount: images.length,
    },
    now,
  });
  const referenceImage = productImageBase64
    ? await storeOutputImage({
        id: `${normalizedBatchId}_reference`,
        title: `${normalizedBatchTitle} reference`,
        url: productImageBase64,
        defaultMimeType: "image/png",
      })
    : null;
  const referenceContext = referenceImage
    ? buildQueuedBatchReferenceContext({
        nodeId,
        assetId,
        referenceImageUrl: referenceImage.publicUrl,
      })
    : undefined;
  const jobs: GenerationJob[] = [];

  for (const [index, image] of images.entries()) {
    const imageMetadata = buildImageRequestMetadata(image, index);
    let job = await jobDB.add({
      workflowId: getOptionalString(workflowId),
      nodeId: getOptionalString(nodeId),
      assetId: getOptionalString(assetId),
      status: "pending",
      prompt: prompts[index],
      metadata: appendProviderBudgetMetadata({
        ...imageMetadata,
        source: "batch-image-api",
        mode: "queued",
        batchId: normalizedBatchId,
        batchIndex: index + 1,
        batchTotal: images.length,
        exportPackId: normalizedBatchId,
        exportPackTitle: normalizedBatchTitle,
        exportItemId: imageMetadata.exportSpecId,
        exportItemTitle: image.title,
        exportSpecTitle: image.title,
        batchJobTitle: image.title,
        platform: normalizedPlatform,
        style,
        modelIds,
        provider,
        model,
        queuedAt: now,
        imageId: `queued_${crypto.randomUUID()}`,
        imageType: image.type,
        copyText: image.copyText,
        estimate,
        approvedProviderCallLimit,
        approvedAt: now,
        providerCallBudgetId,
        referenceImageUrl: referenceImage?.publicUrl,
        referenceImageStorage: referenceImage?.metadata,
        referenceImages: referenceContext?.images ?? [],
        referenceContext,
        usesProductReference: !!referenceImage,
      }, providerCallBudgetId, reserveEvent),
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
    jobs.push(job);
  }

  const batch = await projectDB.getBatch(normalizedBatchId);
  if (batch && batch.state !== "locked" && batch.state !== "delivered") {
    await projectDB.updateBatch(batch.projectId, batch.id, {
      title: batch.title || normalizedBatchTitle,
      metadata: {
        ...batch.metadata,
        source: "batch-image-api",
        mode: "queued",
        batchId: normalizedBatchId,
        platform: normalizedPlatform,
        itemCount: images.length,
        queuedCount: jobs.length,
        successCount: 0,
        failedCount: 0,
        partialResult: false,
        jobIds: mergeStringArrays(batch.metadata.jobIds, jobs.map((job) => job.id)),
        provider,
        model,
        referenceImageUrl: referenceImage?.publicUrl,
        referenceImageStorage: referenceImage?.metadata,
        estimate,
        approvedProviderCallLimit,
        approvedAt: now,
        providerCallBudgetId,
        lastQueuedAt: now,
      },
    });
  }

  const queueResults = [];
  for (const job of jobs) {
    queueResults.push(await startGenerationJob(job.id));
  }

  return {
    images: images.map((image, index) => ({
      id: jobs[index]?.id ?? crypto.randomUUID(),
      url: "",
      type: image.type,
      copyText: image.copyText,
      title: image.title,
      prompt: image.prompt,
      metadata: {
        style,
        modelIds,
        ...buildImageRequestMetadata(image, index),
        jobId: jobs[index]?.id,
        batchId: normalizedBatchId,
        queued: true,
      },
    })),
    queueResults,
    persistence: {
      batchId: normalizedBatchId,
      jobIds: jobs.map((job) => job.id),
      artifactIds: [],
      successCount: 0,
      failedCount: 0,
      queuedCount: jobs.length,
    },
  };
}

function buildQueuedBatchReferenceContext({
  nodeId,
  assetId,
  referenceImageUrl,
}: {
  nodeId?: string;
  assetId?: string;
  referenceImageUrl: string;
}) {
  return {
    version: 1,
    source: "canvas-workbench",
    targetNodeId: getOptionalString(nodeId),
    images: [
      {
        role: "product",
        title: "Product reference",
        url: referenceImageUrl,
        providerUsable: true,
        nodeId: getOptionalString(nodeId),
        assetId: getOptionalString(assetId),
      },
    ],
    roles: {
      product: {
        role: "product",
        title: "Product reference",
        sourceNodeIds: getOptionalString(nodeId) ? [getOptionalString(nodeId) as string] : [],
        componentIds: [],
        assetIds: getOptionalString(assetId) ? [getOptionalString(assetId) as string] : [],
        promptFragments: [],
        constraints: ["Keep the product identity, structure, material, and visible details consistent."],
        negativeRules: ["Do not alter the product shape, logo, material, or key color."],
        qualityRules: ["The product must remain recognizable and commercially usable."],
      },
    },
    promptFragments: [],
    constraints: ["Keep the product identity, structure, material, and visible details consistent."],
    negativeRules: ["Do not alter the product shape, logo, material, or key color."],
    qualityRules: ["The product must remain recognizable and commercially usable."],
  };
}

function getProviderLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname || "image-provider";
  } catch {
    return baseUrl || "image-provider";
  }
}

function mergeStringArrays(existing: unknown, next: string[]): string[] {
  const values = Array.isArray(existing)
    ? existing.filter((value): value is string => typeof value === "string" && !!value.trim())
    : [];
  return Array.from(new Set([...values, ...next.filter(Boolean)]));
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function mapMockBatchResults(
  values: unknown[],
  expectedLength: number
): Array<{
  image?: { base64?: string; url?: string };
  error?: { message: string; code: string; diagnostics?: ImageProviderDiagnostic };
}> {
  return Array.from({ length: expectedLength }, (_, index) => {
    const value = values[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        error: {
          message: "mock result missing",
          code: "MOCK_RESULT_MISSING",
        },
      };
    }

    const item = value as Record<string, unknown>;
    if (typeof item.error === "string" && item.error.trim()) {
      return {
        error: {
          message: item.error.trim(),
          code: typeof item.errorCode === "string" && item.errorCode.trim()
            ? item.errorCode.trim()
            : "MOCK_IMAGE_FAILED",
          diagnostics: normalizeImageProviderDiagnostic(item.diagnostics),
        },
      };
    }

    return {
      image: {
        base64: typeof item.base64 === "string" ? item.base64 : undefined,
        url: typeof item.url === "string" ? item.url : undefined,
      },
    };
  });
}
