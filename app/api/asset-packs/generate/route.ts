import crypto from "crypto";
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
} from "@/lib/ai/provider-call-policy";
import { buildAssetPackDraft } from "@/lib/canvas/asset-pack-builder";
import {
  attachGeneratedAssetReference,
  buildAssetPackGenerationPlan,
} from "@/lib/canvas/asset-pack-generation";
import {
  buildGeneratedModelAssetTemplateMetadata,
  buildModelAssetTemplateGenerationPlan,
} from "@/lib/canvas/model-asset-template-plan";
import type { AssetPackSourceImage } from "@/lib/canvas/asset-pack-types";
import { readOutputImageAsDataUrl, storeOutputImage } from "@/lib/store/output-file-store";
import { buildAutoAssetName } from "@/lib/canvas/asset-auto-naming";
import { safeLogError } from "@/lib/server/safe-log";

const ASSET_REFERENCE_IMAGE_COUNT = 1;

export async function POST(req: Request) {
  try {
    const {
      category,
      userRequest,
      sourceImages,
      dryRun,
      confirmedProviderCallLimit,
      mockResults,
      allowConceptProduct,
    }: {
      category?: string;
      userRequest?: string;
      sourceImages?: AssetPackSourceImage[];
      dryRun?: boolean;
      confirmedProviderCallLimit?: number;
      mockResults?: unknown;
      allowConceptProduct?: boolean;
    } = await req.json();

    const draft = buildAssetPackDraft({
      category: category || "",
      userRequest: userRequest || "",
      sourceImages: Array.isArray(sourceImages) ? sourceImages : [],
      createdAt: new Date().toISOString(),
    });
    const generationPlan =
      draft.category === "model_asset"
        ? buildModelAssetTemplateGenerationPlan(draft)
        : buildAssetPackGenerationPlan(draft);
    const providerReferences = await resolveProviderReferenceDataUrls(
      generationPlan.providerReferenceUrls?.length
        ? generationPlan.providerReferenceUrls
        : generationPlan.providerReferenceUrl
          ? [generationPlan.providerReferenceUrl]
          : []
    );
    if (draft.category === "product_asset" && providerReferences.length === 0 && allowConceptProduct !== true) {
      return NextResponse.json(
        {
          error: "真实商品资产需要先上传或拖入商品参考图。只有文字需求会生成概念商品，不能作为原物品多角度锁定参考。",
          code: "PRODUCT_REFERENCE_REQUIRED",
          assetPack: draft,
          generationPlan,
          guardrails: buildProviderCallGuardrails(getMaxBatchImages()),
        },
        { status: 400 }
      );
    }
    const referenceValidation = validateProviderReferenceImages(providerReferences);
    if (referenceValidation.ok === false) {
      return NextResponse.json(
        {
          error: referenceValidation.error,
          code: referenceValidation.code,
          invalidReferenceIndex: referenceValidation.invalidIndex,
          assetPack: draft,
          guardrails: buildProviderCallGuardrails(getMaxBatchImages()),
        },
        { status: 400 }
      );
    }

    const promptValidation = validateProviderPrompts([generationPlan.prompt]);
    if (promptValidation.ok === false) {
      return NextResponse.json(
        {
          error: promptValidation.error,
          invalidIndexes: promptValidation.invalidIndexes,
          assetPack: draft,
          guardrails: buildProviderCallGuardrails(getMaxBatchImages()),
        },
        { status: 400 }
      );
    }

    const estimate = buildProviderCallEstimate({
      imageCount: ASSET_REFERENCE_IMAGE_COUNT,
      maxImages: getMaxBatchImages(),
      usesProductReference: providerReferences.length > 0,
      referenceImageBytes: referenceValidation.bytes,
    });

    if (dryRun === true) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        assetPack: draft,
        generationPlan,
        estimate,
        guardrails: buildProviderCallGuardrails(getMaxBatchImages()),
      });
    }

    const providerCallLimit = normalizeConfirmedProviderCallLimit(confirmedProviderCallLimit);
    if (providerCallLimit < estimate.providerCallCount) {
      return NextResponse.json(
        {
          error: "生成参考资产前需要确认本次图片调用",
          code: "PROVIDER_CALL_LIMIT_NOT_CONFIRMED",
          assetPack: draft,
          generationPlan,
          estimate,
          guardrails: buildProviderCallGuardrails(getMaxBatchImages()),
          requiredConfirmation: {
            field: "confirmedProviderCallLimit",
            minimum: estimate.providerCallCount,
          },
        },
        { status: 402 }
      );
    }

    const mockBatchEnabled = process.env.IMAGE_MASTER_ENABLE_MOCK_BATCH === "1";
    const usingMockResults = mockBatchEnabled && Array.isArray(mockResults);
    const providerRequestTraces = [{
      attempt: 1,
      clientRequestId: buildClientRequestId(draft.id, 1),
    }];
    const results = usingMockResults
      ? mapMockResults(mockResults as unknown[])
      : await generateBatchImages([generationPlan.prompt], providerReferences[0], estimate.concurrency, {
          clientRequestIds: [providerRequestTraces[0].clientRequestId],
          referenceImagesBase64: providerReferences,
          size: generationPlan.outputSize,
        });
    let providerCallCountUsed = ASSET_REFERENCE_IMAGE_COUNT;
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
      providerRequestTraces.push({
        attempt: providerCallCountUsed,
        clientRequestId: buildClientRequestId(draft.id, providerCallCountUsed),
      });
      retryReasons.push(errorCode || "IMAGE_GENERATION_FAILED");
      await waitForProviderRetryDelay(errorCode, emptyResultRetryCount + transientRetryCount);
      const [retryResult] = await generateBatchImages([generationPlan.prompt], providerReferences[0], 1, {
        clientRequestIds: [providerRequestTraces[providerRequestTraces.length - 1].clientRequestId],
        referenceImagesBase64: providerReferences,
        size: generationPlan.outputSize,
      });
      results[0] = retryResult;
    }

    const result = results[0];
    if (!result?.image?.base64 && !result?.image?.url) {
      return NextResponse.json(
        {
          error: result?.error?.message || "参考资产生成失败",
          code: result?.error?.code || "IMAGE_GENERATION_FAILED",
          assetPack: draft,
          generationPlan,
          providerDiagnostics: normalizeImageProviderDiagnostic(result?.error?.diagnostics),
          providerRequestTraces,
          estimate: {
            ...estimate,
            providerCallCountUsed,
            retryCount: emptyResultRetryCount + transientRetryCount,
            emptyResultRetryCount,
            transientRetryCount,
            retryReasons,
          },
          guardrails: buildProviderCallGuardrails(getMaxBatchImages()),
        },
        { status: 502 }
      );
    }

    const preliminaryAutoName = buildAutoAssetName({
      category: draft.category,
      userRequest: draft.userRequest,
      fallbackTitle: draft.title,
      metadata: generationPlan.metadata,
    });
    const stored = await storeOutputImage({
      id: `asset_pack_${draft.category}_${crypto.randomUUID().slice(0, 8)}`,
      title: preliminaryAutoName.title,
      base64: result.image.base64,
      url: result.image.url,
      defaultMimeType: "image/png",
    });
    const generatedAssetPack = attachGeneratedAssetReference({
      draft,
      imageUrl: stored.publicUrl,
      imageTitle: `${preliminaryAutoName.title}参考图`,
      metadata: {
        ...stored.metadata,
        autoName: preliminaryAutoName,
        generationPlanMetadata: generationPlan.metadata,
        providerReferenceCount: providerReferences.length,
        providerTrace: result.provider,
        providerRequestTraces,
      },
    });
    const generatedModelMetadata =
      draft.category === "model_asset"
        ? buildGeneratedModelAssetTemplateMetadata({
            generationPlan,
            imageUrl: stored.publicUrl,
          })
        : undefined;
    const finalAutoName = buildAutoAssetName({
      category: draft.category,
      userRequest: draft.userRequest,
      fallbackTitle: preliminaryAutoName.title,
      metadata: {
        ...generationPlan.metadata,
        modelAssetMetadata: generatedModelMetadata,
        ...(generatedModelMetadata ?? {}),
      },
    });
    const finalAssetPack = generatedModelMetadata
      ? {
          ...generatedAssetPack,
          title: finalAutoName.title,
          metadata: {
            ...generatedAssetPack.metadata,
            autoName: finalAutoName,
            promptFamily: generationPlan.metadata.promptFamily,
            modelTemplateParams: generationPlan.metadata.modelTemplateParams,
            modelAssetMetadata: generatedModelMetadata,
          },
        }
      : {
          ...generatedAssetPack,
          title: finalAutoName.title,
          metadata: {
            ...generatedAssetPack.metadata,
            autoName: finalAutoName,
          },
        };

    return NextResponse.json({
      ok: true,
      dryRun: false,
      assetPack: finalAssetPack,
      referenceImage: {
        url: stored.publicUrl,
        metadata: {
          ...stored.metadata,
          autoName: finalAutoName,
          modelAssetMetadata: generatedModelMetadata,
          providerTrace: result.provider,
          providerReferenceCount: providerReferences.length,
          providerRequestTraces,
        },
      },
      generationPlan,
      estimate: {
        ...estimate,
        providerCallCountUsed,
        retryCount: emptyResultRetryCount + transientRetryCount,
        emptyResultRetryCount,
        transientRetryCount,
        retryReasons,
      },
      guardrails: buildProviderCallGuardrails(getMaxBatchImages()),
    });
  } catch (error) {
    safeLogError("Asset pack generation failed", error);
    return NextResponse.json(
      {
        error: "参考资产生成失败",
        guardrails: buildProviderCallGuardrails(getMaxBatchImages()),
      },
      { status: 500 }
    );
  }
}

async function resolveProviderReferenceDataUrl(url: string | null): Promise<string | undefined> {
  if (!url) return undefined;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(url)) return url;
  if (url.startsWith("/api/generated-images/")) {
    return readOutputImageAsDataUrl(url);
  }
  return undefined;
}

async function resolveProviderReferenceDataUrls(urls: string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (const url of urls.slice(0, 6)) {
    const dataUrl = await resolveProviderReferenceDataUrl(url);
    if (dataUrl) resolved.push(dataUrl);
  }
  return resolved;
}

function validateProviderReferenceImages(
  values: string[]
):
  | { ok: true; bytes: number }
  | {
      ok: false;
      error: string;
      code: "INVALID_REFERENCE_IMAGE" | "REFERENCE_IMAGE_TOO_LARGE";
      invalidIndex: number;
    } {
  let bytes = 0;
  for (let index = 0; index < values.length; index += 1) {
    const validation = validateProviderReferenceImage(values[index]);
    if (validation.ok === false) {
      return {
        ok: false,
        error: validation.error,
        code: validation.code,
        invalidIndex: index,
      };
    }
    bytes += validation.bytes;
  }
  return { ok: true, bytes };
}

function isTransientProviderErrorCode(code: string | undefined): boolean {
  if (!code) return false;
  if (code === "TIMEOUT" || code === "AI_ERROR" || code === "IMAGE_GEN_429") return true;
  const match = code.match(/^IMAGE_GEN_(\d{3})$/);
  if (!match) return false;
  const status = Number(match[1]);
  return status >= 500 && status <= 599;
}

function buildClientRequestId(draftId: string, attempt: number): string {
  return [
    "image-master",
    "asset-pack",
    draftId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80),
    `attempt-${attempt}`,
    crypto.randomUUID(),
  ].join(".");
}

async function waitForProviderRetryDelay(code: string | undefined, attempt: number): Promise<void> {
  const baseDelayMs = code === "IMAGE_GEN_429" ? 1200 : code === "EMPTY_RESULT" ? 300 : 700;
  const delayMs = Math.min(baseDelayMs * Math.max(1, attempt), 2500);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function mapMockResults(
  values: unknown[]
): Array<{
  image?: { base64?: string; url?: string };
  provider?: {
    clientRequestId: string;
    providerRequestId?: string;
    providerHost: string;
    model: string;
    endpoint: "/images/generations" | "/images/edits" | "/responses";
  };
  error?: { message: string; code: string; diagnostics?: ImageProviderDiagnostic };
}> {
  const value = values[0];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [{ error: { message: "mock result missing", code: "MOCK_RESULT_MISSING" } }];
  }

  const item = value as Record<string, unknown>;
  if (typeof item.error === "string" && item.error.trim()) {
    return [{
      error: {
        message: item.error.trim(),
        code: typeof item.errorCode === "string" && item.errorCode.trim()
          ? item.errorCode.trim()
          : "MOCK_IMAGE_FAILED",
        diagnostics: normalizeImageProviderDiagnostic(item.diagnostics),
      },
    }];
  }

  return [{
    image: {
      base64: typeof item.base64 === "string" ? item.base64 : undefined,
      url: typeof item.url === "string" ? item.url : undefined,
    },
  }];
}
