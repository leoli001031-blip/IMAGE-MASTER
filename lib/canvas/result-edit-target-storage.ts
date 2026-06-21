export interface PendingResultEditTarget {
  url: string;
  title: string;
  outputId?: string;
  artifactId?: string;
  jobId?: string;
  nodeId?: string;
  status?: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
}

const PENDING_RESULT_EDIT_TARGET_STORAGE_KEY = "image-master:pending-result-edit-target";
const MAX_PENDING_METADATA_TEXT_LENGTH = 6000;

const PENDING_RESULT_EDIT_METADATA_KEYS = [
  "prompt",
  "finalPrompt",
  "revisedPrompt",
  "provider",
  "providerLabel",
  "model",
  "imageModel",
  "style",
  "ratio",
  "aspectRatioLabel",
  "outputRatio",
  "size",
  "outputSize",
  "status",
  "createdAt",
  "completedAt",
  "generatedAt",
  "planItemTitle",
  "batchJobTitle",
  "exportSpecTitle",
  "planItemType",
  "imageType",
  "useCase",
  "outputSlotId",
  "exportSpecId",
  "exportItemId",
  "batchId",
  "planId",
  "jobId",
  "artifactId",
  "referenceImages",
  "providerReferenceImages",
  "promptOnlyReferenceImages",
  "providerReferenceAdapter",
  "referenceContext",
  "assetInvocationPlan",
  "copyRenderPolicy",
  "visualQa",
  "providerTrace",
] as const;

export function writePendingResultEditTarget(target: PendingResultEditTarget): boolean {
  if (typeof window === "undefined") return false;
  const normalized = normalizePendingResultEditTarget(target);
  if (!normalized) return false;
  try {
    window.sessionStorage?.setItem?.(
      PENDING_RESULT_EDIT_TARGET_STORAGE_KEY,
      JSON.stringify(normalized)
    );
    return true;
  } catch {
    return false;
  }
}

export function takePendingResultEditTarget(): PendingResultEditTarget | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage?.getItem?.(PENDING_RESULT_EDIT_TARGET_STORAGE_KEY);
    window.sessionStorage?.removeItem?.(PENDING_RESULT_EDIT_TARGET_STORAGE_KEY);
    if (!raw) return null;
    return normalizePendingResultEditTarget(JSON.parse(raw));
  } catch {
    return null;
  }
}

function normalizePendingResultEditTarget(value: unknown): PendingResultEditTarget | null {
  if (!isRecord(value)) return null;
  const url = getString(value.url);
  if (!url) return null;
  return {
    url,
    title: getString(value.title) || "生成图片",
    outputId: getString(value.outputId),
    artifactId: getString(value.artifactId),
    jobId: getString(value.jobId),
    nodeId: getString(value.nodeId),
    status: getString(value.status),
    prompt: getString(value.prompt),
    metadata: compactPendingResultEditMetadata(value.metadata),
  };
}

function compactPendingResultEditMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const compact: Record<string, unknown> = {};
  for (const key of PENDING_RESULT_EDIT_METADATA_KEYS) {
    const next = compactPendingMetadataValue(value[key]);
    if (next !== undefined) compact[key] = next;
  }
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function compactPendingMetadataValue(value: unknown): unknown {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return undefined;
    if (text.startsWith("data:image/") && text.length > 4096) return undefined;
    return text.length > MAX_PENDING_METADATA_TEXT_LENGTH
      ? `${text.slice(0, MAX_PENDING_METADATA_TEXT_LENGTH)}...`
      : text;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const items = value
      .map(compactPendingMetadataValue)
      .filter((item) => item !== undefined)
      .slice(0, 24);
    return items.length > 0 ? items : undefined;
  }
  if (!isRecord(value)) return undefined;

  const compact: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const next = compactPendingMetadataValue(child);
    if (next === undefined) continue;
    compact[key] = next;
  }
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
