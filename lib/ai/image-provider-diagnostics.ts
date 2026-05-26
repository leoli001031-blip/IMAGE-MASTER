export type ImageProviderMode = "text_to_image" | "image_to_image";

export interface ImageProviderResponseShape {
  topLevelType: string;
  topLevelKeys?: string[];
  dataType?: string;
  dataLength?: number;
  firstDataItemType?: string;
  firstDataKeys?: string[];
  firstDataHasB64Json?: boolean;
  firstDataHasUrl?: boolean;
  firstDataHasRevisedPrompt?: boolean;
  outputType?: string;
  outputLength?: number;
  firstOutputItemType?: string;
  firstOutputKeys?: string[];
  imagesType?: string;
  imagesLength?: number;
  firstImageItemType?: string;
  firstImageKeys?: string[];
  responseType?: string;
  responseKeys?: string[];
  responseDataType?: string;
  responseDataLength?: number;
  responseOutputType?: string;
  responseOutputLength?: number;
  responseImagesType?: string;
  responseImagesLength?: number;
  discoveredImageContainer?: string;
  discoveredImageKind?: "b64_json" | "url";
  errorType?: string;
  errorCode?: string;
  errorMessage?: string;
  providerIssue?: "provider_unavailable";
  errorKeys?: string[];
}

export interface ImageProviderDiagnostic {
  kind: "image_provider_response";
  code: string;
  mode: ImageProviderMode;
  endpoint: "/images/generations" | "/images/edits" | "/responses";
  providerHost: string;
  model: string;
  status: number;
  ok: boolean;
  contentType?: string;
  requestId?: string;
  clientRequestId?: string;
  promptChars: number;
  referenceImageBytes?: number;
  responseShape: ImageProviderResponseShape;
  capturedAt: string;
}

export interface ProviderImageData {
  b64_json?: string;
  url?: string;
}

export function buildImageProviderDiagnostic({
  code,
  mode,
  endpoint,
  baseURL,
  model,
  status,
  ok,
  headers,
  prompt,
  productImageBase64,
  payload,
  clientRequestId,
}: {
  code: string;
  mode: ImageProviderMode;
  endpoint: ImageProviderDiagnostic["endpoint"];
  baseURL: string;
  model: string;
  status: number;
  ok: boolean;
  headers?: Headers;
  prompt: string;
  productImageBase64?: string;
  payload: unknown;
  clientRequestId?: string;
}): ImageProviderDiagnostic {
  return {
    kind: "image_provider_response",
    code: safeString(code, "IMAGE_PROVIDER_DIAGNOSTIC"),
    mode,
    endpoint,
    providerHost: getProviderHost(baseURL),
    model: safeString(model, "unknown-model", 120),
    status,
    ok,
    contentType: safeOptionalString(headers?.get("content-type"), 120),
    requestId: getRequestId(headers),
    clientRequestId: safeOptionalString(clientRequestId, 160),
    promptChars: prompt.length,
    referenceImageBytes: productImageBase64 ? estimateDataUrlBytes(productImageBase64) : undefined,
    responseShape: buildResponseShape(payload),
    capturedAt: new Date().toISOString(),
  };
}

export function normalizeImageProviderDiagnostic(value: unknown): ImageProviderDiagnostic | undefined {
  if (!isRecord(value)) return undefined;

  const mode = value.mode === "image_to_image" ? "image_to_image" : "text_to_image";
  const endpoint =
    value.endpoint === "/images/edits"
      ? "/images/edits"
      : value.endpoint === "/responses"
        ? "/responses"
        : "/images/generations";
  return {
    kind: "image_provider_response",
    code: safeString(value.code, "IMAGE_PROVIDER_DIAGNOSTIC"),
    mode,
    endpoint,
    providerHost: safeString(value.providerHost, "unknown-provider", 160),
    model: safeString(value.model, "unknown-model", 120),
    status: safeNumber(value.status),
    ok: value.ok === true,
    contentType: safeOptionalString(value.contentType, 120),
    requestId: safeOptionalString(value.requestId, 120),
    clientRequestId: safeOptionalString(value.clientRequestId, 160),
    promptChars: safeNumber(value.promptChars),
    referenceImageBytes:
      typeof value.referenceImageBytes === "number" && Number.isFinite(value.referenceImageBytes)
        ? Math.max(0, Math.floor(value.referenceImageBytes))
        : undefined,
    responseShape: normalizeResponseShape(value.responseShape),
    capturedAt: safeIsoString(value.capturedAt) ?? new Date().toISOString(),
  };
}

function buildResponseShape(payload: unknown): ImageProviderResponseShape {
  const shape: ImageProviderResponseShape = {
    topLevelType: getValueType(payload),
  };

  if (!isRecord(payload)) return shape;

  shape.topLevelKeys = safeKeys(payload);
  applyArraySummary(shape, payload.data, "data");
  applyArraySummary(shape, payload.output, "output");
  applyArraySummary(shape, payload.images, "images");

  if (isRecord(payload.response)) {
    shape.responseType = "object";
    shape.responseKeys = safeKeys(payload.response);
    applyArraySummary(shape, payload.response.data, "responseData");
    applyArraySummary(shape, payload.response.output, "responseOutput");
    applyArraySummary(shape, payload.response.images, "responseImages");
  } else if (payload.response !== undefined) {
    shape.responseType = getValueType(payload.response);
  }

  const discoveredImage = findFirstProviderImage(payload, "$", 0);
  if (discoveredImage?.image) {
    shape.discoveredImageContainer = discoveredImage.path;
    shape.discoveredImageKind = discoveredImage.image.b64_json ? "b64_json" : "url";
  }

  if (isRecord(payload.error)) {
    shape.errorKeys = safeKeys(payload.error);
    shape.errorType = safeOptionalString(payload.error.type, 120);
    shape.errorCode = safeOptionalString(payload.error.code, 120);
    shape.errorMessage = safeOptionalString(payload.error.message, 220);
    shape.providerIssue = classifyProviderIssue(shape.errorMessage);
  }

  return shape;
}

function normalizeResponseShape(value: unknown): ImageProviderResponseShape {
  if (!isRecord(value)) return { topLevelType: "unknown" };

  return {
    topLevelType: safeString(value.topLevelType, "unknown", 40),
    topLevelKeys: safeStringArray(value.topLevelKeys),
    dataType: safeOptionalString(value.dataType, 40),
    dataLength: optionalSafeNumber(value.dataLength),
    firstDataItemType: safeOptionalString(value.firstDataItemType, 40),
    firstDataKeys: safeStringArray(value.firstDataKeys),
    firstDataHasB64Json: value.firstDataHasB64Json === true,
    firstDataHasUrl: value.firstDataHasUrl === true,
    firstDataHasRevisedPrompt: value.firstDataHasRevisedPrompt === true,
    outputType: safeOptionalString(value.outputType, 40),
    outputLength: optionalSafeNumber(value.outputLength),
    firstOutputItemType: safeOptionalString(value.firstOutputItemType, 40),
    firstOutputKeys: safeStringArray(value.firstOutputKeys),
    imagesType: safeOptionalString(value.imagesType, 40),
    imagesLength: optionalSafeNumber(value.imagesLength),
    firstImageItemType: safeOptionalString(value.firstImageItemType, 40),
    firstImageKeys: safeStringArray(value.firstImageKeys),
    responseType: safeOptionalString(value.responseType, 40),
    responseKeys: safeStringArray(value.responseKeys),
    responseDataType: safeOptionalString(value.responseDataType, 40),
    responseDataLength: optionalSafeNumber(value.responseDataLength),
    responseOutputType: safeOptionalString(value.responseOutputType, 40),
    responseOutputLength: optionalSafeNumber(value.responseOutputLength),
    responseImagesType: safeOptionalString(value.responseImagesType, 40),
    responseImagesLength: optionalSafeNumber(value.responseImagesLength),
    discoveredImageContainer: safeOptionalString(value.discoveredImageContainer, 120),
    discoveredImageKind:
      value.discoveredImageKind === "b64_json" || value.discoveredImageKind === "url"
        ? value.discoveredImageKind
        : undefined,
    errorType: safeOptionalString(value.errorType, 120),
    errorCode: safeOptionalString(value.errorCode, 120),
    errorMessage: safeOptionalString(value.errorMessage, 220),
    providerIssue:
      value.providerIssue === "provider_unavailable"
        ? "provider_unavailable"
        : classifyProviderIssue(safeOptionalString(value.errorMessage, 220)),
    errorKeys: safeStringArray(value.errorKeys),
  };
}

function classifyProviderIssue(message: string | undefined): ImageProviderResponseShape["providerIssue"] {
  if (!message) return undefined;
  if (/service temporarily unavailable|no available compatible accounts/i.test(message)) {
    return "provider_unavailable";
  }
  return undefined;
}

export function extractFirstProviderImage(payload: unknown): ProviderImageData | undefined {
  return findFirstProviderImage(payload, "$", 0)?.image;
}

type ArraySummaryTarget =
  | "data"
  | "output"
  | "images"
  | "responseData"
  | "responseOutput"
  | "responseImages";

function applyArraySummary(
  shape: ImageProviderResponseShape,
  value: unknown,
  target: ArraySummaryTarget
) {
  setShapeValue(shape, `${target}Type` as keyof ImageProviderResponseShape, getValueType(value));
  if (!Array.isArray(value)) return;

  setShapeValue(shape, `${target}Length` as keyof ImageProviderResponseShape, value.length);
  const first = value[0];
  const firstType = getValueType(first);

  if (target === "data") {
    shape.firstDataItemType = firstType;
    if (isRecord(first)) {
      shape.firstDataKeys = safeKeys(first);
      shape.firstDataHasB64Json = typeof first.b64_json === "string" && first.b64_json.length > 0;
      shape.firstDataHasUrl = typeof first.url === "string" && first.url.length > 0;
      shape.firstDataHasRevisedPrompt =
        typeof first.revised_prompt === "string" && first.revised_prompt.length > 0;
    }
    return;
  }

  if (target === "output") {
    shape.firstOutputItemType = firstType;
    if (isRecord(first)) shape.firstOutputKeys = safeKeys(first);
    return;
  }

  if (target === "images") {
    shape.firstImageItemType = firstType;
    if (isRecord(first)) shape.firstImageKeys = safeKeys(first);
  }
}

function setShapeValue(
  shape: ImageProviderResponseShape,
  key: keyof ImageProviderResponseShape,
  value: string | number
) {
  (shape as unknown as Record<string, string | number | undefined>)[key] = value;
}

function findFirstProviderImage(
  value: unknown,
  path: string,
  depth: number
): { image: ProviderImageData; path: string } | undefined {
  if (depth > 8) return undefined;

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const found = findFirstProviderImage(value[index], `${path}[]`, depth + 1);
      if (found) return found;
    }
    return undefined;
  }

  if (!isRecord(value)) return undefined;

  const direct = extractImageFromRecord(value);
  if (direct) return { image: direct, path };

  for (const key of IMAGE_CONTAINER_KEYS) {
    if (!(key in value)) continue;
    const found = findFirstProviderImage(value[key], `${path}.${key}`, depth + 1);
    if (found) return found;
  }

  return undefined;
}

const IMAGE_CONTAINER_KEYS = [
  "data",
  "output",
  "images",
  "image",
  "result",
  "results",
  "response",
  "responseStream",
  "content",
  "message",
  "artifact",
  "artifacts",
] as const;

function extractImageFromRecord(value: Record<string, unknown>): ProviderImageData | undefined {
  const b64_json = firstNonEmptyString(
    value.b64_json,
    value.b64Json,
    value.base64,
    value.image_base64,
    value.partial_image_b64,
    value.result
  );
  if (b64_json) return { b64_json };

  const url = firstNonEmptyString(value.url, value.image_url, value.imageUrl);
  if (url) return { url };

  return undefined;
}

function getProviderHost(baseURL: string): string {
  try {
    return new URL(baseURL).hostname || "unknown-provider";
  } catch {
    return "unknown-provider";
  }
}

function getRequestId(headers: Headers | undefined): string | undefined {
  if (!headers) return undefined;
  return (
    safeOptionalString(headers.get("x-request-id"), 120) ??
    safeOptionalString(headers.get("request-id"), 120) ??
    safeOptionalString(headers.get("openai-request-id"), 120)
  );
}

function estimateDataUrlBytes(value: string): number {
  const match = value.match(/^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i);
  const base64 = (match ? match[1] : value).replace(/\s/g, "");
  return Math.max(0, Math.floor((base64.length * 3) / 4));
}

function getValueType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function safeKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value)
    .filter((key) => !isSensitiveKeyName(key))
    .map((key) => safeString(key, "key", 80))
    .filter(Boolean)
    .sort()
    .slice(0, 20);
}

function isSensitiveKeyName(key: string): boolean {
  return /api[_-]?key|authorization|bearer|secret|token|raw[_-]?payload|request[_-]?headers/i.test(key);
}

function safeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => safeString(item, "value", 80))
    .slice(0, 20);
  return values.length ? values : undefined;
}

function safeIsoString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function safeOptionalString(value: unknown, maxLength = 160): string | undefined {
  return typeof value === "string" && value.trim()
    ? safeString(value, "value", maxLength)
    : undefined;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function safeString(value: unknown, fallback: string, maxLength = 160): string {
  if (typeof value !== "string") return fallback;
  const stripped = value.trim().replace(/[\r\n\t]+/g, " ");
  return stripped ? stripped.slice(0, maxLength) : fallback;
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function optionalSafeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
