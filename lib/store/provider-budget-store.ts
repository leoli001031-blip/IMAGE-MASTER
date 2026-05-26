import "server-only";
import db from "./db";

export type ProviderBudgetPhase = "reserve" | "consume" | "release";
export type ProviderBudgetStatus = "reserved" | "succeeded" | "failed" | "skipped";

export interface ProviderBudgetEvent {
  id: string;
  budgetId: string;
  jobId?: string;
  scope: string;
  phase: ProviderBudgetPhase;
  amount: number;
  status?: ProviderBudgetStatus;
  attemptId?: string;
  providerRequestId?: string;
  reason?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RecordProviderBudgetEventInput {
  budgetId?: string;
  jobId?: string;
  scope: string;
  phase: ProviderBudgetPhase;
  amount?: number;
  status?: ProviderBudgetStatus;
  attemptId?: string;
  providerRequestId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  now?: string;
}

type ProviderBudgetEventRow = Omit<ProviderBudgetEvent, "jobId" | "metadata"> & {
  jobId: string;
  metadata: string;
};

export function getProviderCallBudgetId(metadata: Record<string, unknown>, jobId?: string): string {
  const existing = typeof metadata.providerCallBudgetId === "string"
    ? metadata.providerCallBudgetId.trim()
    : "";
  if (existing) return existing;
  return jobId ? `provider_budget_job_${jobId}` : `provider_budget_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

export function reserveProviderCallBudget(
  input: Omit<RecordProviderBudgetEventInput, "phase" | "status">
): ProviderBudgetEvent {
  return recordProviderBudgetEvent({
    ...input,
    phase: "reserve",
    status: "reserved",
  });
}

export function consumeProviderCallBudget(
  input: Omit<RecordProviderBudgetEventInput, "phase">
): ProviderBudgetEvent {
  return recordProviderBudgetEvent({
    ...input,
    phase: "consume",
  });
}

export function recordProviderBudgetEvent(input: RecordProviderBudgetEventInput): ProviderBudgetEvent {
  const createdAt = input.now ?? new Date().toISOString();
  const event: ProviderBudgetEvent = {
    id: `provider_budget_event_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    budgetId: input.budgetId?.trim() || getProviderCallBudgetId({}, input.jobId),
    jobId: input.jobId?.trim() || undefined,
    scope: input.scope,
    phase: input.phase,
    amount: normalizeAmount(input.amount),
    status: input.status,
    attemptId: input.attemptId?.trim() || undefined,
    providerRequestId: input.providerRequestId?.trim() || undefined,
    reason: input.reason?.trim() || undefined,
    metadata: input.metadata ?? {},
    createdAt,
  };

  db.prepare(
    `INSERT INTO provider_call_budget_events (
       id, budgetId, jobId, scope, phase, amount, status,
       attemptId, providerRequestId, reason, metadata, createdAt
     )
     VALUES (
       @id, @budgetId, @jobId, @scope, @phase, @amount, @status,
       @attemptId, @providerRequestId, @reason, @metadata, @createdAt
     )`
  ).run({
    ...event,
    jobId: event.jobId ?? "",
    status: event.status ?? "",
    attemptId: event.attemptId ?? "",
    providerRequestId: event.providerRequestId ?? "",
    reason: event.reason ?? "",
    metadata: JSON.stringify(event.metadata),
  });

  return event;
}

export function listProviderBudgetEvents(budgetId: string): ProviderBudgetEvent[] {
  const rows = db
    .prepare("SELECT * FROM provider_call_budget_events WHERE budgetId = ? ORDER BY createdAt ASC")
    .all(budgetId) as ProviderBudgetEventRow[];
  return rows.map(toEvent);
}

export function summarizeProviderBudget(budgetId: string): {
  budgetId: string;
  reserved: number;
  consumed: number;
  succeeded: number;
  failed: number;
  eventCount: number;
} {
  const events = listProviderBudgetEvents(budgetId);
  return events.reduce(
    (summary, event) => {
      if (event.phase === "reserve") summary.reserved += event.amount;
      if (event.phase === "consume") {
        summary.consumed += event.amount;
        if (event.status === "succeeded") summary.succeeded += event.amount;
        if (event.status === "failed") summary.failed += event.amount;
      }
      summary.eventCount += 1;
      return summary;
    },
    { budgetId, reserved: 0, consumed: 0, succeeded: 0, failed: 0, eventCount: 0 }
  );
}

export function appendProviderBudgetMetadata(
  metadata: Record<string, unknown>,
  budgetId: string,
  event?: ProviderBudgetEvent
): Record<string, unknown> {
  return {
    ...metadata,
    providerCallBudgetId: budgetId,
    providerBudgetSummary: summarizeProviderBudget(budgetId),
    lastProviderBudgetEventId: event?.id ?? metadata.lastProviderBudgetEventId,
    lastProviderBudgetPhase: event?.phase ?? metadata.lastProviderBudgetPhase,
  };
}

function toEvent(row: ProviderBudgetEventRow): ProviderBudgetEvent {
  return {
    ...row,
    jobId: row.jobId || undefined,
    status: row.status || undefined,
    attemptId: row.attemptId || undefined,
    providerRequestId: row.providerRequestId || undefined,
    reason: row.reason || undefined,
    metadata: parseMetadata(row.metadata),
  };
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeAmount(value: number | undefined): number {
  if (!Number.isFinite(value) || !value) return 1;
  return Math.max(0, Math.floor(value));
}
