import { NextResponse, type NextRequest } from "next/server";
import nodeCrypto from "crypto";
import { generateBatchImages } from "@/lib/ai/client";
import {
  normalizeImageProviderDiagnostic,
  type ImageProviderDiagnostic,
} from "@/lib/ai/image-provider-diagnostics";
import {
  EMPTY_RESULT_RETRY_LIMIT,
  TRANSIENT_PROVIDER_RETRY_LIMIT,
} from "@/lib/ai/provider-call-policy";
import type { GeneratedArtifact, GenerationJob } from "@/lib/types";
import * as artifactDB from "@/lib/store/artifact-db";
import { getConfigPublic } from "@/lib/store/config-store";
import * as jobDB from "@/lib/store/job-db";
import * as projectDB from "@/lib/store/project-db";
import { syncExportPackBatchState } from "@/lib/store/export-pack-batch-sync";
import {
  readOutputImageAsDataUrl,
  storeOutputImage,
} from "@/lib/store/output-file-store";
import {
  buildProviderReferenceAdapter,
  getPrimaryProviderReferenceUrl,
  isInlineImageUrl,
} from "@/lib/canvas/generation-reference-context";
import {
  appendProviderAttemptLedger,
  createProviderAttemptEntry,
  finishProviderAttemptEntry,
  type ProviderAttemptEntry,
} from "@/lib/store/provider-attempt-ledger";
import {
  appendProviderBudgetMetadata,
  consumeProviderCallBudget,
  getProviderCallBudgetId,
  reserveProviderCallBudget,
} from "@/lib/store/provider-budget-store";
import { safeLogError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";

const MAX_PROMPT_CHARS = 4000;

type BatchImageResult = {
  image?: {
    base64?: string;
    url?: string;
  };
  error?: {
    message: string;
    code: string;
    diagnostics?: ImageProviderDiagnostic;
  };
};

interface RetryImageRequest {
  dryRun?: boolean;
  confirmedProviderCallLimit?: number;
  mockResults?: unknown;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少任务 ID" }, { status: 400 });
  }

  try {
    const body = await readRetryBody(req);
    const job = await jobDB.get(id);
    if (!job) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    if (!canRetryBatchImageJob(job)) {
      return NextResponse.json(
        { job, error: "当前任务不是可单图重试的失败图组任务" },
        { status: 409 }
      );
    }

    const prompt = job.prompt.trim();
    if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
      const failed = await jobDB.update(id, {
        status: "failed",
        error: `单图重试需要 1-${MAX_PROMPT_CHARS} 字符的 prompt`,
        metadata: {
          ...job.metadata,
          retryImageErrorCode: "INVALID_PROMPT",
          retriedImageAt: new Date().toISOString(),
        },
      });
      return NextResponse.json(
        { job: failed, error: "单图重试 prompt 无效" },
        { status: 400 }
      );
    }

    const providerReferenceAdapter = buildProviderReferenceAdapter(job.metadata);
    const referenceImageUrl = getPrimaryProviderReferenceUrl(job.metadata) ?? getReferenceImageUrl(job.metadata);
    const referenceImageBase64 = referenceImageUrl
      ? await readReferenceImageAsDataUrl(referenceImageUrl).catch(() => undefined)
      : undefined;
    const estimate = buildRetryEstimate(!!referenceImageBase64);

    if (body.dryRun === true) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        estimate,
        guardrails: buildRetryGuardrails(),
      });
    }

    const providerCallLimit =
      typeof body.confirmedProviderCallLimit === "number" &&
      Number.isFinite(body.confirmedProviderCallLimit)
        ? Math.floor(body.confirmedProviderCallLimit)
        : 0;

    if (providerCallLimit < estimate.providerCallCount) {
      return NextResponse.json(
        {
          error: "真实单图重试前需要确认 provider 调用上限",
          code: "PROVIDER_CALL_LIMIT_NOT_CONFIRMED",
          estimate,
          guardrails: buildRetryGuardrails(),
          requiredConfirmation: {
            field: "confirmedProviderCallLimit",
            minimum: estimate.providerCallCount,
          },
        },
        { status: 402 }
      );
    }

    const config = getConfigPublic();
    const provider = getProviderLabel(config.imageBaseUrl || config.baseUrl);
    const model = config.imageModel;
    const mockBatchEnabled = process.env.IMAGE_MASTER_ENABLE_MOCK_BATCH === "1";
    const usingMockResults = mockBatchEnabled && Array.isArray(body.mockResults);
    const providerAttempts: ProviderAttemptEntry[] = [];
    const providerCallBudgetId = getProviderCallBudgetId(job.metadata, id);
    const reserveEvent = reserveProviderCallBudget({
      budgetId: providerCallBudgetId,
      jobId: id,
      scope: "retry-image",
      amount: providerCallLimit,
      metadata: {
        provider,
        model,
        estimate,
        referenceImageUrl,
      },
    });
    const initialAttempt = createProviderAttemptEntry({
      scope: "retry-image",
      jobId: id,
      prompt,
      referenceImageUrl,
      providerReferenceRole: providerReferenceAdapter.primaryImage?.role,
      providerReferenceStrategy: providerReferenceAdapter.strategy,
    });
    const results = usingMockResults
      ? mapMockBatchResults(body.mockResults as unknown[], 1)
      : await generateBatchImages([prompt], referenceImageBase64, 1);
    let lastBudgetEvent = consumeProviderCallBudget({
      budgetId: providerCallBudgetId,
      jobId: id,
      scope: "retry-image",
      amount: 1,
      status: results[0]?.image?.base64 || results[0]?.image?.url ? "succeeded" : "failed",
      attemptId: initialAttempt.attemptId,
      reason: results[0]?.error?.code,
      metadata: {
        provider,
        model,
        firstAttempt: true,
        usingMockResults,
      },
    });
    providerAttempts.push(finishAttemptFromBatchResult(initialAttempt, results[0]));
    let providerCallCountUsed = 1;
    let emptyResultRetryCount = 0;
    let transientRetryCount = 0;
    const retryReasons: string[] = [];

    while (!usingMockResults && results[0]?.error && providerCallCountUsed < providerCallLimit) {
      const errorCode = results[0].error?.code;
      if (errorCode === "EMPTY_RESULT") {
        if (emptyResultRetryCount >= EMPTY_RESULT_RETRY_LIMIT) break;
        emptyResultRetryCount += 1;
      } else if (isTransientProviderErrorCode(errorCode)) {
        if (transientRetryCount >= TRANSIENT_PROVIDER_RETRY_LIMIT) break;
        transientRetryCount += 1;
      } else {
        break;
      }

      providerCallCountUsed += 1;
      retryReasons.push(errorCode || "IMAGE_GENERATION_FAILED");
      await waitForProviderRetryDelay(errorCode, emptyResultRetryCount + transientRetryCount);
      const retryAttempt = createProviderAttemptEntry({
        scope: "retry-image-retry",
        jobId: id,
        prompt,
        referenceImageUrl,
        providerReferenceRole: providerReferenceAdapter.primaryImage?.role,
        providerReferenceStrategy: providerReferenceAdapter.strategy,
      });
      const [retryResult] = await generateBatchImages([prompt], referenceImageBase64, 1);
      results[0] = retryResult;
      lastBudgetEvent = consumeProviderCallBudget({
        budgetId: providerCallBudgetId,
        jobId: id,
        scope: "retry-image-retry",
        amount: 1,
        status: retryResult?.image?.base64 || retryResult?.image?.url ? "succeeded" : "failed",
        attemptId: retryAttempt.attemptId,
        reason: retryResult?.error?.code,
        metadata: {
          provider,
          model,
          retryReason: errorCode,
        },
      });
      providerAttempts.push(finishAttemptFromBatchResult(retryAttempt, retryResult));
    }

    const result = results[0];
    const now = new Date().toISOString();
    const metadataWithAttempts = appendProviderBudgetMetadata(
      appendProviderAttemptLedger(job.metadata, providerAttempts),
      providerCallBudgetId,
      lastBudgetEvent ?? reserveEvent
    );
    const retryMeta = {
      retryImage: true,
      retriedImageAt: now,
      retryImageEstimate: estimate,
      retryImageResult: {
        providerCallCountUsed,
        emptyResultRetryCount,
        transientRetryCount,
        retryReasons,
        providerCallBudgetId,
        referenceImageUrl,
        providerReferenceRole: providerReferenceAdapter.primaryImage?.role,
        providerReferenceStrategy: providerReferenceAdapter.strategy,
        promptOnlyReferenceImages: providerReferenceAdapter.promptOnlyImages,
        usesProviderReference: !!referenceImageBase64,
        usesProductReference:
          providerReferenceAdapter.primaryImage?.role === "product" && !!referenceImageBase64,
      },
    };

    if (result?.image?.base64 || result?.image?.url) {
      const title = getString(job.metadata.batchJobTitle) ?? getJobFallbackTitle(job);
      const storedImage = await storeOutputImage({
        id: `${job.id}_retry_image`,
        title,
        url: result.image.base64
          ? `data:image/png;base64,${result.image.base64}`
          : result.image.url || "",
        defaultMimeType: "image/png",
      });
      const baseMetadata = {
        ...metadataWithAttempts,
        source: "batch-image-api-retry",
        jobId: job.id,
        retryOfJobId: job.id,
        provider,
        model,
        generatedAt: now,
        resultStorage: storedImage.metadata,
        retryImageResultStorage: storedImage.metadata,
        referenceImageUrl,
        providerReferenceRole: providerReferenceAdapter.primaryImage?.role,
        providerReferenceStrategy: providerReferenceAdapter.strategy,
        promptOnlyReferenceImages: providerReferenceAdapter.promptOnlyImages,
        usesProviderReference: !!referenceImageBase64,
        usesProductReference:
          providerReferenceAdapter.primaryImage?.role === "product" && !!referenceImageBase64,
        providerDiagnostics: undefined,
        errorCode: undefined,
        retryImageErrorCode: undefined,
      };
      const artifact = await artifactDB.add({
        workflowId: job.workflowId,
        nodeId: job.nodeId,
        jobId: job.id,
        assetId: job.assetId,
        type: "image",
        title: `${title} 重试产物`,
        status: "ready",
        url: storedImage.publicUrl,
        prompt,
        provider,
        model,
        metadata: {
          ...baseMetadata,
          imageId: `retry_${crypto.randomUUID()}`,
          imageType: getString(job.metadata.imageType) ?? "retry",
          copyText: getString(job.metadata.copyText) ?? "",
          imageStorage: storedImage.metadata,
        },
      });
      let updatedJob = await jobDB.update(job.id, {
        status: "done",
        resultUrl: storedImage.publicUrl,
        error: "",
        metadata: {
          ...baseMetadata,
          ...retryMeta,
          outputArtifactId: artifact.id,
        },
      });

      if (updatedJob) {
        const batchState = await projectDB.ensureExportPackBatchForJob(updatedJob);
        if (batchState) {
          updatedJob = await jobDB.update(updatedJob.id, {
            metadata: {
              ...updatedJob.metadata,
              projectId: batchState.projectId,
              campaignId: batchState.campaignId,
              batchState: batchState.state,
            },
          });
        }
      }

      const batch = await syncExportPackBatchState(getString(job.metadata.batchId), {
        reason: "retry-image-done",
        now,
      });

      return NextResponse.json({
        job: updatedJob,
        artifact,
        batch,
        estimate: {
          ...estimate,
          providerCallCountUsed,
          retryCount: emptyResultRetryCount + transientRetryCount,
          emptyResultRetryCount,
          transientRetryCount,
          retryReasons,
        },
        retry: {
          providerCallCountUsed,
          retryCount: emptyResultRetryCount + transientRetryCount,
          emptyResultRetryCount,
          transientRetryCount,
          retryReasons,
          usesProviderReference: !!referenceImageBase64,
          usesProductReference:
            providerReferenceAdapter.primaryImage?.role === "product" && !!referenceImageBase64,
        },
      });
    }

    const failure = result?.error ?? {
      message: "图片生成失败",
      code: "IMAGE_GENERATION_FAILED",
    };
    const failed = await jobDB.update(job.id, {
      status: "failed",
      error: failure.message,
      metadata: {
        ...metadataWithAttempts,
        ...retryMeta,
        errorCode: failure.code,
        providerDiagnostics: failure.diagnostics,
        retryImageErrorCode: failure.code,
        retryImageErrorMessage: failure.message,
      },
    });
    const batch = await syncExportPackBatchState(getString(job.metadata.batchId), {
      reason: "retry-image-failed",
      now,
    });

    return NextResponse.json(
      {
        job: failed,
        batch,
        error: failure.message,
        code: failure.code,
        diagnostics: failure.diagnostics,
        estimate: {
          ...estimate,
          providerCallCountUsed,
          retryCount: emptyResultRetryCount + transientRetryCount,
          emptyResultRetryCount,
          transientRetryCount,
          retryReasons,
        },
        retry: {
          providerCallCountUsed,
          retryCount: emptyResultRetryCount + transientRetryCount,
          emptyResultRetryCount,
          transientRetryCount,
          retryReasons,
          usesProviderReference: !!referenceImageBase64,
          usesProductReference:
            providerReferenceAdapter.primaryImage?.role === "product" && !!referenceImageBase64,
        },
      },
      { status: 502 }
    );
  } catch (error) {
    safeLogError("Batch image job retry failed", error);
    return NextResponse.json({ error: "单图重试失败，请稍后再试" }, { status: 500 });
  }
}

async function readRetryBody(req: NextRequest): Promise<RetryImageRequest> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as RetryImageRequest)
      : {};
  } catch {
    return {};
  }
}

function canRetryBatchImageJob(job: GenerationJob): boolean {
  if (job.status !== "failed" && job.status !== "cancelled") return false;
  if (!job.prompt.trim()) return false;
  return getString(job.metadata.source) === "batch-image-api" ||
    getString(job.metadata.source) === "batch-image-api-retry";
}

function buildRetryEstimate(usesProductReference: boolean) {
  return {
    imageCount: 1,
    providerCallCount: 1,
    maxProviderCallCount: 1 + EMPTY_RESULT_RETRY_LIMIT + TRANSIENT_PROVIDER_RETRY_LIMIT,
    maxPromptChars: MAX_PROMPT_CHARS,
    concurrency: 1,
    usesProductReference,
    retryPolicy: {
      emptyResultRetries: EMPTY_RESULT_RETRY_LIMIT,
      transientProviderRetries: TRANSIENT_PROVIDER_RETRY_LIMIT,
    },
  };
}

function buildRetryGuardrails() {
  return {
    maxImages: 1,
    maxPromptChars: MAX_PROMPT_CHARS,
    maxConcurrency: 1,
    emptyResultRetryLimit: EMPTY_RESULT_RETRY_LIMIT,
    transientProviderRetryLimit: TRANSIENT_PROVIDER_RETRY_LIMIT,
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

function finishAttemptFromBatchResult(
  attempt: ProviderAttemptEntry,
  result: BatchImageResult | undefined
): ProviderAttemptEntry {
  if (result?.image?.base64 || result?.image?.url) {
    return finishProviderAttemptEntry(attempt, {
      status: "succeeded",
      outputUrl: result.image.url,
      outputSha256: result.image.base64 ? sha256(result.image.base64) : undefined,
    });
  }

  return finishProviderAttemptEntry(attempt, {
    status: "failed",
    errorCode: result?.error?.code ?? "IMAGE_GENERATION_FAILED",
    errorMessage: result?.error?.message ?? "图片生成失败",
    diagnostics: result?.error?.diagnostics,
  });
}

function getReferenceImageUrl(metadata: Record<string, unknown>): string | undefined {
  return (
    getString(metadata.referenceImageUrl) ??
    getString((metadata.referenceImageStorage as Record<string, unknown> | undefined)?.publicUrl)
  );
}

async function readReferenceImageAsDataUrl(referenceImageUrl: string): Promise<string | undefined> {
  if (isInlineImageUrl(referenceImageUrl)) return referenceImageUrl;
  if (referenceImageUrl.startsWith("/api/generated-images/")) {
    return readOutputImageAsDataUrl(referenceImageUrl);
  }
  return undefined;
}

function getJobFallbackTitle(job: GenerationJob): string {
  return job.nodeId ? `节点 ${job.nodeId}` : "单图重试";
}

function getProviderLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname || "image-provider";
  } catch {
    return baseUrl || "image-provider";
  }
}

function mapMockBatchResults(values: unknown[], expectedLength: number): BatchImageResult[] {
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
          code:
            typeof item.errorCode === "string" && item.errorCode.trim()
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

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sha256(value: string): string {
  return nodeCrypto.createHash("sha256").update(value).digest("hex");
}
