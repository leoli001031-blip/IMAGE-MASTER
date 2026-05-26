import type { ExportPackManifest, ExportPackManifestItem } from "@/lib/canvas/export-pack-manifest";

export interface ExportPackImageInfo {
  exists: boolean;
  width?: number;
  height?: number;
  mimeType?: string;
  byteSize?: number;
  error?: string;
}

export type ExportPackQaCheckStatus = "pass" | "fail" | "pending" | "manual";
export type ExportPackQaManualStatus = "pass" | "fail" | "manual";

export interface ExportPackQaCheck {
  id: string;
  label: string;
  status: ExportPackQaCheckStatus;
  message: string;
  expected?: string;
  actual?: string;
}

export interface ExportPackQaItemReport {
  jobId: string;
  title: string;
  status: ExportPackQaCheckStatus;
  artifactStatus: "ready" | "missing" | "failed" | "pending";
  checks: ExportPackQaCheck[];
}

export interface ExportPackQaCounts {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  pendingArtifact: number;
  manual: number;
  missingArtifact: number;
}

export interface ExportPackQaReport {
  batchId: string;
  title: string;
  platform: string;
  status: ExportPackQaCheckStatus;
  summaryLabel: string;
  counts: ExportPackQaCounts;
  items: ExportPackQaItemReport[];
}

export interface ExportPackQaManualReview {
  status: ExportPackQaManualStatus;
  note?: string;
  reviewer?: string;
  updatedAt?: string;
}

export type ExportPackQaReviewByJobId = Record<
  string,
  Record<string, ExportPackQaManualReview | undefined> | undefined
>;

export interface ExportPackQaReviewUpdate {
  checkId: string;
  status: ExportPackQaManualStatus;
  note?: string;
  reviewer?: string;
  updatedAt?: string;
}

interface BuildExportPackQaReportParams {
  manifest: ExportPackManifest;
  imageInfoByUrl?: Record<string, ExportPackImageInfo | undefined>;
  reviewByJobId?: ExportPackQaReviewByJobId;
}

const MANUAL_CHECKS: Array<Pick<ExportPackQaCheck, "id" | "label" | "message">> = [
  { id: "white-background", label: "白底/场景要求", message: "需要人工确认背景是否符合投放要求" },
  { id: "text-policy", label: "文字和水印", message: "需要人工确认画面文字、水印、Logo 是否合规" },
  { id: "model-quality", label: "模特和商品", message: "需要人工确认模特姿态、商品结构和穿着关系" },
  { id: "commercial-quality", label: "商业质量", message: "需要人工确认清晰度、质感和可投放质量" },
];

export const MANUAL_QA_CHECK_IDS = MANUAL_CHECKS.map((check) => check.id);

export function buildExportPackQaReport({
  manifest,
  imageInfoByUrl = {},
  reviewByJobId = {},
}: BuildExportPackQaReportParams): ExportPackQaReport {
  const items = manifest.items.map((item) => buildItemReport(item, imageInfoByUrl, reviewByJobId));
  const counts = countQaItems(items);
  const status = getBatchQaStatus(counts);

  return {
    batchId: manifest.batchId,
    title: manifest.title,
    platform: manifest.platform,
    status,
    summaryLabel: getQaSummaryLabel(counts),
    counts,
    items,
  };
}

function buildItemReport(
  item: ExportPackManifestItem,
  imageInfoByUrl: Record<string, ExportPackImageInfo | undefined>,
  reviewByJobId: ExportPackQaReviewByJobId
): ExportPackQaItemReport {
  const artifactStatus = getArtifactStatus(item);
  const info = item.artifact?.url ? imageInfoByUrl[item.artifact.url] : undefined;
  const itemReview = reviewByJobId[item.jobId] ?? {};
  const checks: ExportPackQaCheck[] = [
    buildArtifactCheck(item, artifactStatus, info),
    buildUrlSafetyCheck(item),
    buildSizeCheck(item, info),
    buildRatioCheck(item, info),
    ...MANUAL_CHECKS.map((check) => buildManualCheck(check, itemReview[check.id])),
  ];

  return {
    jobId: item.jobId,
    title: item.title,
    status: getItemQaStatus(checks),
    artifactStatus,
    checks,
  };
}

export function buildExportPackQaReviewByJobId(
  jobs: Array<{ id: string; metadata: Record<string, unknown> }>
): ExportPackQaReviewByJobId {
  return Object.fromEntries(
    jobs.map((job) => [job.id, getExportPackQaReviewFromMetadata(job.metadata)])
  );
}

export function getExportPackQaReviewFromMetadata(
  metadata: Record<string, unknown>
): Record<string, ExportPackQaManualReview> {
  const review = metadata.exportPackQaReview;
  if (!isRecord(review)) return {};

  const checks = review.checks;
  if (!isRecord(checks)) return {};

  const parsed: Record<string, ExportPackQaManualReview> = {};
  for (const [checkId, value] of Object.entries(checks)) {
    if (!MANUAL_QA_CHECK_IDS.includes(checkId) || !isRecord(value)) continue;
    const status = normalizeManualStatus(value.status);
    if (!status) continue;
    parsed[checkId] = {
      status,
      note: getOptionalString(value.note),
      reviewer: getOptionalString(value.reviewer),
      updatedAt: getOptionalString(value.updatedAt),
    };
  }
  return parsed;
}

export function mergeExportPackQaReviewMetadata(
  metadata: Record<string, unknown>,
  update: ExportPackQaReviewUpdate
): Record<string, unknown> {
  const existingChecks = getExportPackQaReviewFromMetadata(metadata);
  const updatedAt = update.updatedAt ?? new Date().toISOString();

  return {
    ...metadata,
    exportPackQaReview: {
      checks: {
        ...existingChecks,
        [update.checkId]: {
          status: update.status,
          note: update.note?.trim() || undefined,
          reviewer: update.reviewer?.trim() || undefined,
          updatedAt,
        },
      },
      updatedAt,
    },
  };
}

function buildManualCheck(
  check: Pick<ExportPackQaCheck, "id" | "label" | "message">,
  review?: ExportPackQaManualReview
): ExportPackQaCheck {
  if (!review) {
    return { ...check, status: "manual" };
  }

  const note = review.note?.trim();
  const reviewer = review.reviewer?.trim();
  return {
    ...check,
    status: review.status,
    message:
      note ||
      (review.status === "pass"
        ? "人工复核已通过"
        : review.status === "fail"
          ? "人工复核未通过"
          : check.message),
    actual: reviewer ? `reviewer: ${reviewer}` : review.updatedAt,
  };
}

function buildArtifactCheck(
  item: ExportPackManifestItem,
  artifactStatus: ExportPackQaItemReport["artifactStatus"],
  info?: ExportPackImageInfo
): ExportPackQaCheck {
  if (artifactStatus === "failed") {
    return {
      id: "artifact",
      label: "产物状态",
      status: "fail",
      message: "任务或产物状态为失败",
      actual: item.artifact?.status || item.status,
    };
  }

  if (artifactStatus === "missing") {
    return {
      id: "artifact",
      label: "产物状态",
      status: "pending",
      message: "任务已完成但没有找到产物，等待补齐或重新生成",
    };
  }

  if (artifactStatus === "pending") {
    return {
      id: "artifact",
      label: "产物状态",
      status: "pending",
      message: "任务仍在排队或生成中",
      actual: item.status,
    };
  }

  if (info && !info.exists) {
    return {
      id: "artifact",
      label: "产物状态",
      status: "pending",
      message: info.error || "产物记录存在，但文件暂时不可读取",
    };
  }

  return {
    id: "artifact",
    label: "产物状态",
    status: "pass",
    message: "产物记录可用于 QA",
    actual: item.artifact?.status,
  };
}

function buildUrlSafetyCheck(item: ExportPackManifestItem): ExportPackQaCheck {
  const url = item.artifact?.url?.trim();
  if (!url) {
    return {
      id: "url-safety",
      label: "URL 安全",
      status: "pending",
      message: "尚无产物 URL",
    };
  }

  if (isSafeArtifactUrl(url)) {
    return {
      id: "url-safety",
      label: "URL 安全",
      status: "pass",
      message: "产物 URL 在允许范围内",
      actual: summarizeUrl(url),
    };
  }

  return {
    id: "url-safety",
    label: "URL 安全",
    status: "fail",
    message: "产物 URL 不在导出包 QA 的安全范围内",
    actual: summarizeUrl(url),
  };
}

function buildSizeCheck(item: ExportPackManifestItem, info?: ExportPackImageInfo): ExportPackQaCheck {
  const expected = parseSize(item.size);
  if (!expected) {
    return {
      id: "size",
      label: "尺寸",
      status: "pending",
      message: "未声明目标尺寸",
      expected: item.size || undefined,
    };
  }

  if (!info || !info.exists || !hasDimensions(info)) {
    return {
      id: "size",
      label: "尺寸",
      status: "pending",
      message: "等待读取产物尺寸",
      expected: formatDimensions(expected.width, expected.height),
    };
  }

  const matches = info.width === expected.width && info.height === expected.height;
  return {
    id: "size",
    label: "尺寸",
    status: matches ? "pass" : "fail",
    message: matches ? "产物尺寸匹配" : "产物尺寸与规格不一致",
    expected: formatDimensions(expected.width, expected.height),
    actual: formatDimensions(info.width, info.height),
  };
}

function buildRatioCheck(item: ExportPackManifestItem, info?: ExportPackImageInfo): ExportPackQaCheck {
  const expected = parseRatio(item.ratio);
  if (!expected) {
    return {
      id: "ratio",
      label: "宽高比",
      status: "pending",
      message: "未声明目标比例",
      expected: item.ratio || undefined,
    };
  }

  if (!info || !info.exists || !hasDimensions(info)) {
    return {
      id: "ratio",
      label: "宽高比",
      status: "pending",
      message: "等待读取产物比例",
      expected: item.ratio,
    };
  }

  const actual = info.width / info.height;
  const matches = Math.abs(actual - expected.value) <= 0.01;
  return {
    id: "ratio",
    label: "宽高比",
    status: matches ? "pass" : "fail",
    message: matches ? "产物比例匹配" : "产物比例与规格不一致",
    expected: item.ratio,
    actual: `${info.width}:${info.height}`,
  };
}

function getArtifactStatus(item: ExportPackManifestItem): ExportPackQaItemReport["artifactStatus"] {
  if (isFailedStatus(item.status) || isFailedStatus(item.artifact?.status)) return "failed";
  if (isReadyArtifactStatus(item.artifact?.status) && item.artifact?.url) return "ready";
  if (isCompletedJobStatus(item.status)) return "missing";
  return "pending";
}

function getItemQaStatus(checks: ExportPackQaCheck[]): ExportPackQaCheckStatus {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "pending")) return "pending";
  if (checks.some((check) => check.status === "manual")) return "manual";
  return "pass";
}

function countQaItems(items: ExportPackQaItemReport[]): ExportPackQaCounts {
  return items.reduce<ExportPackQaCounts>(
    (counts, item) => {
      counts.total += 1;
      if (item.status === "pass") counts.passed += 1;
      if (item.status === "fail") counts.failed += 1;
      if (item.status === "pending") counts.pending += 1;
      if (item.status === "manual") counts.manual += 1;
      if (item.artifactStatus === "pending") counts.pendingArtifact += 1;
      if (item.artifactStatus === "missing") counts.missingArtifact += 1;
      return counts;
    },
    {
      total: 0,
      passed: 0,
      failed: 0,
      pending: 0,
      pendingArtifact: 0,
      manual: 0,
      missingArtifact: 0,
    }
  );
}

function getBatchQaStatus(counts: ExportPackQaCounts): ExportPackQaCheckStatus {
  if (counts.failed > 0) return "fail";
  if (counts.pending > 0 || counts.missingArtifact > 0) return "pending";
  if (counts.manual > 0) return "manual";
  return "pass";
}

export function getQaSummaryLabel(counts: ExportPackQaCounts): string {
  if (counts.failed > 0) return `QA 有失败 ${counts.failed}`;
  if (counts.missingArtifact > 0) return `QA 待产物 ${counts.missingArtifact}`;
  if (counts.pendingArtifact > 0) return `QA 待生成 ${counts.pendingArtifact}`;
  if (counts.pending > 0) return `QA 待检查 ${counts.pending}`;
  if (counts.manual > 0) return `QA 需复核 ${counts.manual}`;
  return `QA 通过 ${counts.passed}`;
}

function isSafeArtifactUrl(url: string): boolean {
  return url.startsWith("/api/generated-images/") || isDataImageUrl(url);
}

function isDataImageUrl(url: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(url);
}

function summarizeUrl(url: string): string {
  if (url.length <= 96) return url;
  return `${url.slice(0, 72)}...${url.slice(-16)}`;
}

function parseSize(size: string): { width: number; height: number } | undefined {
  const match = size.trim().match(/^(\d{2,5})\s*[xX×]\s*(\d{2,5})$/);
  if (!match) return undefined;
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function parseRatio(ratio: string): { width: number; height: number; value: number } | undefined {
  const match = ratio.trim().match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { width, height, value: width / height };
}

function hasDimensions(info: ExportPackImageInfo): info is ExportPackImageInfo & {
  width: number;
  height: number;
} {
  return (
    typeof info.width === "number" &&
    Number.isFinite(info.width) &&
    typeof info.height === "number" &&
    Number.isFinite(info.height)
  );
}

function formatDimensions(width: number, height: number): string {
  return `${width}x${height}`;
}

function isReadyArtifactStatus(status?: string): boolean {
  return !!status && ["ready", "done", "completed", "success"].includes(status);
}

function isCompletedJobStatus(status?: string): boolean {
  return status === "done" || status === "completed";
}

function isFailedStatus(status?: string): boolean {
  return status === "failed";
}

function normalizeManualStatus(value: unknown): ExportPackQaManualStatus | undefined {
  return value === "pass" || value === "fail" || value === "manual" ? value : undefined;
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
