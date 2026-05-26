export const DEFAULT_MAX_BATCH_IMAGES = 10;
export const MAX_PROMPT_CHARS = 4000;
export const MAX_REFERENCE_IMAGE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_TEXT_TO_IMAGE_CONCURRENCY = 10;
export const IMAGE_TO_IMAGE_CONCURRENCY = 10;
export const EMPTY_RESULT_RETRY_LIMIT = 1;
export const TRANSIENT_PROVIDER_RETRY_LIMIT = 1;

export interface ProviderCallGuardrails {
  maxImages: number;
  maxPromptChars: number;
  maxReferenceImageBytes: number;
  maxReferenceImageMB: number;
  maxConcurrency: number;
  imageToImageConcurrency: number;
  emptyResultRetryLimit: number;
  transientProviderRetryLimit: number;
}

export interface ProviderCallEstimate {
  imageCount: number;
  providerCallCount: number;
  maxProviderCallCount: number;
  maxImages: number;
  concurrency: number;
  usesProductReference: boolean;
  referenceImageBytes: number;
  retryPolicy: {
    emptyResultRetries: number;
    transientProviderRetries: number;
  };
}

export interface ProviderCallPolicy {
  mode: "dry_run" | "requires_confirmation" | "confirmed";
  guardrails: ProviderCallGuardrails;
  estimate: ProviderCallEstimate;
  confirmedProviderCallLimit?: number;
  requiredConfirmation?: {
    field: "confirmedProviderCallLimit";
    minimum: number;
  };
}

export type ProviderReferenceValidation =
  | { ok: true; bytes: number }
  | { ok: false; error: string; code: "INVALID_REFERENCE_IMAGE" | "REFERENCE_IMAGE_TOO_LARGE" };

export function getMaxBatchImages(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.IMAGE_MASTER_MAX_BATCH_IMAGES);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_BATCH_IMAGES;
}

export function buildProviderCallGuardrails(
  maxImages = getMaxBatchImages()
): ProviderCallGuardrails {
  return {
    maxImages,
    maxPromptChars: MAX_PROMPT_CHARS,
    maxReferenceImageBytes: MAX_REFERENCE_IMAGE_BYTES,
    maxReferenceImageMB: Math.round(MAX_REFERENCE_IMAGE_BYTES / 1024 / 1024),
    maxConcurrency: DEFAULT_TEXT_TO_IMAGE_CONCURRENCY,
    imageToImageConcurrency: IMAGE_TO_IMAGE_CONCURRENCY,
    emptyResultRetryLimit: EMPTY_RESULT_RETRY_LIMIT,
    transientProviderRetryLimit: TRANSIENT_PROVIDER_RETRY_LIMIT,
  };
}

export function validateProviderPrompts(
  prompts: string[],
  maxPromptChars = MAX_PROMPT_CHARS
): { ok: true } | { ok: false; error: string; invalidIndexes: number[] } {
  const invalidIndexes = prompts.flatMap((prompt, index) => {
    return typeof prompt !== "string" || !prompt.trim() || prompt.length > maxPromptChars
      ? [index]
      : [];
  });

  if (invalidIndexes.length === 0) return { ok: true };
  return {
    ok: false,
    error: `每张图片都需要 1-${maxPromptChars} 字符的 prompt`,
    invalidIndexes,
  };
}

export function validateProviderReferenceImage(
  value: string | undefined
): ProviderReferenceValidation {
  if (!value) return { ok: true, bytes: 0 };
  const match = value.match(/^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i);
  if (!match) {
    return {
      ok: false,
      error: "商品参考图必须是 data:image base64",
      code: "INVALID_REFERENCE_IMAGE",
    };
  }

  const compact = match[1].replace(/\s/g, "");
  if (!compact || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    return {
      ok: false,
      error: "商品参考图 base64 无效",
      code: "INVALID_REFERENCE_IMAGE",
    };
  }

  const bytes = Math.floor((compact.length * 3) / 4);
  if (bytes > MAX_REFERENCE_IMAGE_BYTES) {
    return {
      ok: false,
      error: "商品参考图不能超过 8MB",
      code: "REFERENCE_IMAGE_TOO_LARGE",
    };
  }

  return { ok: true, bytes };
}

export function buildProviderCallEstimate({
  imageCount,
  usesProductReference,
  referenceImageBytes = 0,
  maxImages = getMaxBatchImages(),
}: {
  imageCount: number;
  usesProductReference: boolean;
  referenceImageBytes?: number;
  maxImages?: number;
}): ProviderCallEstimate {
  return {
    imageCount,
    providerCallCount: imageCount,
    maxProviderCallCount:
      imageCount * (1 + EMPTY_RESULT_RETRY_LIMIT + TRANSIENT_PROVIDER_RETRY_LIMIT),
    maxImages,
    concurrency: usesProductReference
      ? IMAGE_TO_IMAGE_CONCURRENCY
      : Math.min(DEFAULT_TEXT_TO_IMAGE_CONCURRENCY, Math.max(1, imageCount)),
    usesProductReference,
    referenceImageBytes,
    retryPolicy: {
      emptyResultRetries: EMPTY_RESULT_RETRY_LIMIT,
      transientProviderRetries: TRANSIENT_PROVIDER_RETRY_LIMIT,
    },
  };
}

export function buildProviderCallPolicy({
  estimate,
  dryRun,
  confirmedProviderCallLimit,
  maxImages = estimate.maxImages,
}: {
  estimate: ProviderCallEstimate;
  dryRun: boolean;
  confirmedProviderCallLimit?: number;
  maxImages?: number;
}): ProviderCallPolicy {
  const confirmedLimit = normalizeConfirmedProviderCallLimit(confirmedProviderCallLimit);
  const confirmed = !dryRun && confirmedLimit >= estimate.providerCallCount;
  return {
    mode: dryRun ? "dry_run" : confirmed ? "confirmed" : "requires_confirmation",
    guardrails: buildProviderCallGuardrails(maxImages),
    estimate,
    confirmedProviderCallLimit: confirmedLimit > 0 ? confirmedLimit : undefined,
    requiredConfirmation: confirmed
      ? undefined
      : {
          field: "confirmedProviderCallLimit",
          minimum: estimate.providerCallCount,
        },
  };
}

export function normalizeConfirmedProviderCallLimit(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
}
