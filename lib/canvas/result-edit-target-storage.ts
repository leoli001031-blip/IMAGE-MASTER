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
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
  };
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
