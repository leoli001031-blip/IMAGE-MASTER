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

export interface PendingResultGroupEditTarget {
  group: string;
  count: number;
  ratios?: string[];
  artifactIds?: string[];
  jobIds?: string[];
  artifactTitles?: string[];
  providerRoles?: string[];
  promptOnlyRoles?: string[];
  copyModes?: string[];
  summary?: string;
}

const PENDING_RESULT_EDIT_TARGET_STORAGE_KEY = "image-master:pending-result-edit-target";
const PENDING_RESULT_GROUP_EDIT_TARGET_STORAGE_KEY = "image-master:pending-result-group-edit-target";
const MAX_PENDING_METADATA_TEXT_LENGTH = 6000;
const MAX_PENDING_INLINE_IMAGE_URL_LENGTH = 4096;

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

export function writePendingResultGroupEditTarget(target: PendingResultGroupEditTarget): boolean {
  if (typeof window === "undefined") return false;
  const normalized = normalizePendingResultGroupEditTarget(target);
  if (!normalized) return false;
  try {
    window.sessionStorage?.setItem?.(
      PENDING_RESULT_GROUP_EDIT_TARGET_STORAGE_KEY,
      JSON.stringify(normalized)
    );
    return true;
  } catch {
    return false;
  }
}

export function takePendingResultGroupEditTarget(): PendingResultGroupEditTarget | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage?.getItem?.(PENDING_RESULT_GROUP_EDIT_TARGET_STORAGE_KEY);
    window.sessionStorage?.removeItem?.(PENDING_RESULT_GROUP_EDIT_TARGET_STORAGE_KEY);
    if (!raw) return null;
    return normalizePendingResultGroupEditTarget(JSON.parse(raw));
  } catch {
    return null;
  }
}

function normalizePendingResultEditTarget(value: unknown): PendingResultEditTarget | null {
  if (!isRecord(value)) return null;
  const url = getStorageSafeImageUrl(value.url);
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

function normalizePendingResultGroupEditTarget(value: unknown): PendingResultGroupEditTarget | null {
  if (!isRecord(value)) return null;
  const group = getString(value.group);
  if (!group) return null;
  const count = getPositiveCount(value.count) || compactStringArray(value.artifactIds).length || 1;
  return {
    group,
    count,
    ratios: compactStringArray(value.ratios),
    artifactIds: compactStringArray(value.artifactIds),
    jobIds: compactStringArray(value.jobIds),
    artifactTitles: compactStringArray(value.artifactTitles),
    providerRoles: compactStringArray(value.providerRoles),
    promptOnlyRoles: compactStringArray(value.promptOnlyRoles),
    copyModes: compactStringArray(value.copyModes),
    summary: getString(value.summary),
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
    if (text.startsWith("data:image/") && text.length > MAX_PENDING_INLINE_IMAGE_URL_LENGTH) return undefined;
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

function getStorageSafeImageUrl(value: unknown): string | undefined {
  const url = getString(value);
  if (!url) return undefined;
  if (url.startsWith("data:image/") && url.length > MAX_PENDING_INLINE_IMAGE_URL_LENGTH) return undefined;
  return url;
}

function compactStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of value) {
    const text = getString(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    items.push(text.slice(0, 160));
    if (items.length >= 24) break;
  }
  return items;
}

function getPositiveCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
