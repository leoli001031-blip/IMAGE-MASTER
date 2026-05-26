export type ReviewSessionItemStatus = "pending" | "approved" | "rejected" | "needs_revision";
export type ReviewQualityCheckStatus = "pass" | "fail" | "warn" | "manual" | "pending";
export type ReviewSessionStatus = "pending" | "in_review" | "approved" | "rejected" | "needs_revision";

export interface ReviewSessionInputItem {
  id?: string;
  title?: string;
  imageUrl?: string;
  status?: unknown;
  sourceId?: string;
  metadata?: Record<string, unknown>;
}

export interface ReviewSessionInputCheck {
  id?: string;
  label?: string;
  status?: unknown;
  message?: string;
  itemId?: string;
  severity?: unknown;
  metadata?: Record<string, unknown>;
}

export interface ReviewSessionAction {
  id: string;
  type: "approve" | "reject" | "request_revision" | "note" | "export_hold";
  label: string;
  enabled: boolean;
  reason?: string;
}

export interface ReviewSessionHistoryEntry {
  id: string;
  type: "created" | "quality_check" | "note" | "action";
  label: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface ReviewSessionItem {
  id: string;
  title: string;
  imageUrl: string;
  status: ReviewSessionItemStatus;
  sourceId: string;
  checkIds: string[];
  metadata: Record<string, unknown>;
}

export interface ReviewQualityCheck {
  id: string;
  label: string;
  status: ReviewQualityCheckStatus;
  message: string;
  itemId: string;
  severity: "low" | "medium" | "high";
  metadata: Record<string, unknown>;
}

export interface ReviewStatusCounters {
  total: number;
  approved: number;
  rejected: number;
  needsRevision: number;
  pending: number;
}

export interface ReviewQualitySummary {
  total: number;
  passed: number;
  failed: number;
  warning: number;
  manual: number;
  pending: number;
  blockingIssues: number;
  checks: ReviewQualityCheck[];
}

export interface ReviewSessionSummary {
  id: string;
  title: string;
  status: ReviewSessionStatus;
  statusCounters: ReviewStatusCounters;
  itemList: ReviewSessionItem[];
  qualitySummary: ReviewQualitySummary;
  reviewActions: ReviewSessionAction[];
  history: ReviewSessionHistoryEntry[];
  notes: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReviewSessionInput {
  title?: string;
  images?: unknown;
  items?: unknown;
  qualityChecks?: unknown;
  notes?: unknown;
  metadata?: Record<string, unknown>;
  now?: string;
}

export interface UpdateReviewSessionInput {
  action: "approve_item" | "reject_item" | "request_revision" | "add_note";
  itemId?: string;
  note?: string;
  metadata?: Record<string, unknown>;
  now?: string;
}

export function buildReviewSessionSummary(input: CreateReviewSessionInput): ReviewSessionSummary {
  const now = input.now || new Date().toISOString();
  const items = normalizeItems(input);
  const checks = normalizeChecks(input.qualityChecks, items);
  const qualitySummary = summarizeQuality(checks);
  const statusCounters = summarizeItemStatuses(items);
  const status = getSessionStatus(statusCounters, qualitySummary);
  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title.trim()
      : createDefaultTitle(items, now);
  const notes = normalizeNotes(input.notes);
  const metadata = isRecord(input.metadata) ? input.metadata : {};

  return {
    id: `review_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    title,
    status,
    statusCounters,
    itemList: items.map((item) => ({
      ...item,
      checkIds: checks.filter((check) => check.itemId === item.id).map((check) => check.id),
    })),
    qualitySummary,
    reviewActions: buildReviewActions(status, qualitySummary),
    history: buildInitialHistory(checks, notes, now),
    notes,
    metadata,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateReviewSessionSummary(
  session: ReviewSessionSummary,
  input: UpdateReviewSessionInput
): ReviewSessionSummary {
  const now = input.now || new Date().toISOString();
  const note = typeof input.note === "string" ? input.note.trim() : "";
  const metadata = isRecord(input.metadata) ? input.metadata : {};
  const itemList = session.itemList.map((item) => ({ ...item }));
  let statusOverride: ReviewSessionStatus | undefined;
  let historyLabel = "";
  let historyMetadata: Record<string, unknown> = {
    action: input.action,
    ...metadata,
  };

  if (input.action === "add_note") {
    if (!note) throw new Error("note 不能为空");
    historyLabel = "Review note added";
  } else if (input.action === "request_revision" && !input.itemId) {
    statusOverride = "needs_revision";
    historyLabel = "Session revision requested";
  } else {
    const itemId = getString(input.itemId);
    if (!itemId) throw new Error("itemId 不能为空");
    const item = itemList.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error("review session item 不存在");

    const previousStatus = item.status;
    if (input.action === "approve_item") {
      item.status = "approved";
      historyLabel = `${item.title} approved`;
    } else if (input.action === "reject_item") {
      item.status = "rejected";
      historyLabel = `${item.title} rejected`;
    } else {
      item.status = "needs_revision";
      historyLabel = `${item.title} revision requested`;
    }

    historyMetadata = {
      ...historyMetadata,
      itemId: item.id,
      previousStatus,
      nextStatus: item.status,
    };
  }

  const notes = note ? [...session.notes, note] : [...session.notes];
  const statusCounters = summarizeItemStatuses(itemList);
  const qualitySummary = normalizeQualitySummary(session.qualitySummary);
  const status = statusOverride || getSessionStatus(statusCounters, qualitySummary);

  return {
    ...session,
    status,
    statusCounters,
    itemList,
    qualitySummary,
    reviewActions: buildReviewActions(status, qualitySummary),
    history: [
      ...session.history,
      {
        id: `history_${input.action}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
        type: input.action === "add_note" ? "note" : "action",
        label: historyLabel,
        createdAt: now,
        metadata: note ? { ...historyMetadata, note } : historyMetadata,
      },
    ],
    notes,
    updatedAt: now,
  };
}

export function buildDemoReviewSession(now = "2026-05-16T00:00:00.000Z"): ReviewSessionSummary {
  return buildReviewSessionSummary({
    title: "Demo commerce image review",
    now,
    items: [
      {
        id: "demo-main",
        title: "主图白底商品图",
        imageUrl: "https://example.com/demo-main.png",
        status: "pending",
        sourceId: "demo-job-main",
      },
      {
        id: "demo-detail",
        title: "详情页卖点图",
        imageUrl: "https://example.com/demo-detail.png",
        status: "needs_revision",
        sourceId: "demo-job-detail",
      },
    ],
    qualityChecks: [
      {
        id: "demo-main-size",
        itemId: "demo-main",
        label: "尺寸检查",
        status: "pass",
        message: "图片尺寸满足平台输出要求",
      },
      {
        id: "demo-detail-copy",
        itemId: "demo-detail",
        label: "文案安全",
        status: "warn",
        severity: "medium",
        message: "卖点文案需要人工复核",
      },
    ],
    notes: ["Demo session is generated in memory and is not persisted."],
    metadata: { source: "demo" },
  });
}

function normalizeItems(input: CreateReviewSessionInput): ReviewSessionItem[] {
  const rawItems = Array.isArray(input.items)
    ? input.items
    : Array.isArray(input.images)
      ? input.images
      : [];

  return rawItems
    .map((raw, index) => normalizeItem(raw, index))
    .filter((item): item is ReviewSessionItem => Boolean(item));
}

function normalizeItem(raw: unknown, index: number): ReviewSessionItem | undefined {
  if (typeof raw === "string") {
    const imageUrl = raw.trim();
    if (!imageUrl) return undefined;
    return {
      id: `item_${index + 1}`,
      title: `Image ${index + 1}`,
      imageUrl,
      status: "pending",
      sourceId: "",
      checkIds: [],
      metadata: {},
    };
  }

  if (!isRecord(raw)) return undefined;
  const imageUrl = getString(raw.imageUrl) || getString(raw.url);
  const id = getString(raw.id) || getString(raw.jobId) || `item_${index + 1}`;

  return {
    id,
    title: getString(raw.title) || getString(raw.name) || `Image ${index + 1}`,
    imageUrl,
    status: normalizeItemStatus(raw.status),
    sourceId: getString(raw.sourceId) || getString(raw.jobId) || getString(raw.artifactId),
    checkIds: [],
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
  };
}

function normalizeChecks(value: unknown, items: ReviewSessionItem[]): ReviewQualityCheck[] {
  if (!Array.isArray(value)) return [];
  const itemIds = new Set(items.map((item) => item.id));

  return value
    .map((raw, index) => {
      if (!isRecord(raw)) return undefined;
      const itemId = getString(raw.itemId);
      return {
        id: getString(raw.id) || `check_${index + 1}`,
        label: getString(raw.label) || getString(raw.name) || `Check ${index + 1}`,
        status: normalizeCheckStatus(raw.status),
        message: getString(raw.message) || "",
        itemId: itemIds.has(itemId) ? itemId : "",
        severity: normalizeSeverity(raw.severity),
        metadata: isRecord(raw.metadata) ? raw.metadata : {},
      } satisfies ReviewQualityCheck;
    })
    .filter((check): check is ReviewQualityCheck => Boolean(check));
}

function summarizeItemStatuses(items: ReviewSessionItem[]): ReviewStatusCounters {
  return items.reduce<ReviewStatusCounters>(
    (counts, item) => {
      counts.total += 1;
      if (item.status === "approved") counts.approved += 1;
      if (item.status === "rejected") counts.rejected += 1;
      if (item.status === "needs_revision") counts.needsRevision += 1;
      if (item.status === "pending") counts.pending += 1;
      return counts;
    },
    { total: 0, approved: 0, rejected: 0, needsRevision: 0, pending: 0 }
  );
}

function summarizeQuality(checks: ReviewQualityCheck[]): ReviewQualitySummary {
  return checks.reduce<ReviewQualitySummary>(
    (summary, check) => {
      summary.total += 1;
      if (check.status === "pass") summary.passed += 1;
      if (check.status === "fail") summary.failed += 1;
      if (check.status === "warn") summary.warning += 1;
      if (check.status === "manual") summary.manual += 1;
      if (check.status === "pending") summary.pending += 1;
      if (check.status === "fail" || (check.status === "warn" && check.severity === "high")) {
        summary.blockingIssues += 1;
      }
      summary.checks.push(check);
      return summary;
    },
    {
      total: 0,
      passed: 0,
      failed: 0,
      warning: 0,
      manual: 0,
      pending: 0,
      blockingIssues: 0,
      checks: [],
    }
  );
}

function normalizeQualitySummary(value: ReviewQualitySummary): ReviewQualitySummary {
  const checks = Array.isArray(value.checks) ? value.checks : [];
  return {
    total: numberValue(value.total),
    passed: numberValue(value.passed),
    failed: numberValue(value.failed),
    warning: numberValue(value.warning),
    manual: numberValue(value.manual),
    pending: numberValue(value.pending),
    blockingIssues: numberValue(value.blockingIssues),
    checks,
  };
}

function getSessionStatus(
  counters: ReviewStatusCounters,
  quality: ReviewQualitySummary
): ReviewSessionStatus {
  if (counters.rejected > 0 || quality.failed > 0) return "rejected";
  if (counters.needsRevision > 0 || quality.blockingIssues > 0) return "needs_revision";
  if (counters.total > 0 && counters.approved === counters.total && quality.pending === 0) {
    return "approved";
  }
  if (quality.total > 0 || counters.total > 0) return "in_review";
  return "pending";
}

function buildReviewActions(
  status: ReviewSessionStatus,
  quality: ReviewQualitySummary
): ReviewSessionAction[] {
  const hasBlockingIssues = quality.blockingIssues > 0 || quality.failed > 0;
  return [
    {
      id: "approve",
      type: "approve",
      label: "Approve session",
      enabled: !hasBlockingIssues && status !== "pending",
      reason: hasBlockingIssues ? "Resolve blocking quality issues before approval." : undefined,
    },
    {
      id: "request_revision",
      type: "request_revision",
      label: "Request revision",
      enabled: status !== "approved",
    },
    {
      id: "reject",
      type: "reject",
      label: "Reject session",
      enabled: quality.failed > 0,
    },
    {
      id: "export_hold",
      type: "export_hold",
      label: "Hold export package",
      enabled: hasBlockingIssues || quality.manual > 0 || quality.pending > 0,
    },
  ];
}

function buildInitialHistory(
  checks: ReviewQualityCheck[],
  notes: string[],
  createdAt: string
): ReviewSessionHistoryEntry[] {
  const entries: ReviewSessionHistoryEntry[] = [
    {
      id: "history_created",
      type: "created",
      label: "Review session created",
      createdAt,
      metadata: {},
    },
  ];

  if (checks.length > 0) {
    entries.push({
      id: "history_quality_summary",
      type: "quality_check",
      label: `${checks.length} quality checks attached`,
      createdAt,
      metadata: {
        failed: checks.filter((check) => check.status === "fail").length,
        warning: checks.filter((check) => check.status === "warn").length,
      },
    });
  }

  if (notes.length > 0) {
    entries.push({
      id: "history_notes",
      type: "note",
      label: `${notes.length} notes attached`,
      createdAt,
      metadata: {},
    });
  }

  return entries;
}

function normalizeItemStatus(value: unknown): ReviewSessionItemStatus {
  if (value === "approved" || value === "rejected" || value === "needs_revision") return value;
  return "pending";
}

function normalizeCheckStatus(value: unknown): ReviewQualityCheckStatus {
  if (
    value === "pass" ||
    value === "fail" ||
    value === "warn" ||
    value === "manual" ||
    value === "pending"
  ) {
    return value;
  }
  return "pending";
}

function normalizeSeverity(value: unknown): ReviewQualityCheck["severity"] {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "low";
}

function normalizeNotes(value: unknown): string[] {
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value
    .filter((note): note is string => typeof note === "string")
    .map((note) => note.trim())
    .filter(Boolean);
}

function createDefaultTitle(items: ReviewSessionItem[], now: string): string {
  const day = now.slice(0, 10) || "today";
  return `Review session ${day} (${items.length} items)`;
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
