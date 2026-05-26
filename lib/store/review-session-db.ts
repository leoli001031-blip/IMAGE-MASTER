import type {
  ReviewQualitySummary,
  ReviewSessionAction,
  ReviewSessionHistoryEntry,
  ReviewSessionItem,
  ReviewSessionStatus,
  ReviewSessionSummary,
} from "@/lib/canvas/reviewer-session";
import "server-only";
import db from "./db";

type ReviewSessionRow = Omit<
  ReviewSessionSummary,
  "statusCounters" | "itemList" | "qualitySummary" | "reviewActions" | "history" | "notes" | "metadata"
> & {
  summary: string;
  items: string;
  qualitySummary: string;
  actions: string;
  history: string;
  notes: string;
  metadata: string;
};

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function toReviewSession(row: ReviewSessionRow): ReviewSessionSummary {
  const summary = parseRecord(row.summary);

  return {
    id: row.id,
    title: row.title,
    status: normalizeSessionStatus(row.status),
    statusCounters: {
      total: numberValue(summary.total),
      approved: numberValue(summary.approved),
      rejected: numberValue(summary.rejected),
      needsRevision: numberValue(summary.needsRevision),
      pending: numberValue(summary.pending),
    },
    itemList: parseArray<ReviewSessionItem>(row.items),
    qualitySummary: parseRecord(row.qualitySummary) as unknown as ReviewQualitySummary,
    reviewActions: parseArray<ReviewSessionAction>(row.actions),
    history: parseArray<ReviewSessionHistoryEntry>(row.history),
    notes: parseArray<string>(row.notes),
    metadata: parseRecord(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function list(limit = 20): Promise<ReviewSessionSummary[]> {
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
  const rows = db
    .prepare("SELECT * FROM review_sessions ORDER BY updatedAt DESC LIMIT ?")
    .all(boundedLimit);
  return (rows as ReviewSessionRow[]).map(toReviewSession);
}

export async function get(id: string): Promise<ReviewSessionSummary | undefined> {
  const row = db
    .prepare("SELECT * FROM review_sessions WHERE id = ?")
    .get(id) as ReviewSessionRow | undefined;
  return row ? toReviewSession(row) : undefined;
}

export async function add(summary: ReviewSessionSummary): Promise<ReviewSessionSummary> {
  db.prepare(
    `INSERT INTO review_sessions (
      id, title, status, summary, items, qualitySummary, actions, history, notes, metadata,
      createdAt, updatedAt
    )
     VALUES (
      @id, @title, @status, @summary, @items, @qualitySummary, @actions, @history, @notes,
      @metadata, @createdAt, @updatedAt
    )`
  ).run({
    id: summary.id,
    title: summary.title,
    status: summary.status,
    summary: JSON.stringify(summary.statusCounters),
    items: JSON.stringify(summary.itemList),
    qualitySummary: JSON.stringify(summary.qualitySummary),
    actions: JSON.stringify(summary.reviewActions),
    history: JSON.stringify(summary.history),
    notes: JSON.stringify(summary.notes),
    metadata: JSON.stringify(summary.metadata),
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  });

  return summary;
}

export async function update(summary: ReviewSessionSummary): Promise<ReviewSessionSummary> {
  const result = db.prepare(
    `UPDATE review_sessions
     SET title=@title,
         status=@status,
         summary=@summary,
         items=@items,
         qualitySummary=@qualitySummary,
         actions=@actions,
         history=@history,
         notes=@notes,
         metadata=@metadata,
         updatedAt=@updatedAt
     WHERE id=@id`
  ).run({
    id: summary.id,
    title: summary.title,
    status: summary.status,
    summary: JSON.stringify(summary.statusCounters),
    items: JSON.stringify(summary.itemList),
    qualitySummary: JSON.stringify(summary.qualitySummary),
    actions: JSON.stringify(summary.reviewActions),
    history: JSON.stringify(summary.history),
    notes: JSON.stringify(summary.notes),
    metadata: JSON.stringify(summary.metadata),
    updatedAt: summary.updatedAt,
  });

  if (result.changes === 0) throw new Error("review session 不存在");
  return summary;
}

export async function remove(id: string): Promise<boolean> {
  const result = db.prepare("DELETE FROM review_sessions WHERE id = ?").run(id);
  return result.changes > 0;
}

function normalizeSessionStatus(value: string): ReviewSessionStatus {
  if (
    value === "pending" ||
    value === "in_review" ||
    value === "approved" ||
    value === "rejected" ||
    value === "needs_revision"
  ) {
    return value;
  }
  return "pending";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
