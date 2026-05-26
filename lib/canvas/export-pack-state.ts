export const EXPORT_PACK_BATCH_STATES = [
  "draft",
  "generated",
  "in_review",
  "reviewed",
  "locked",
  "delivered",
] as const;

export type ExportPackBatchState = (typeof EXPORT_PACK_BATCH_STATES)[number];

export interface ExportPackBatchStateSnapshot {
  batchId: string;
  projectId: string;
  campaignId?: string;
  state: ExportPackBatchState;
  label: string;
  locked: boolean;
  delivered: boolean;
  canTransitionTo: ExportPackBatchState[];
  lockedAt?: string;
  deliveredAt?: string;
  updatedAt: string;
}

const STATE_INDEX = new Map(
  EXPORT_PACK_BATCH_STATES.map((state, index) => [state, index])
);

const STATE_LABELS: Record<ExportPackBatchState, string> = {
  draft: "草稿",
  generated: "已生成",
  in_review: "复核中",
  reviewed: "已复核",
  locked: "已锁定",
  delivered: "已交付",
};

export function isExportPackBatchState(value: unknown): value is ExportPackBatchState {
  return (
    typeof value === "string" &&
    EXPORT_PACK_BATCH_STATES.includes(value as ExportPackBatchState)
  );
}

export function normalizeExportPackBatchState(value: unknown): ExportPackBatchState {
  return isExportPackBatchState(value) ? value : "draft";
}

export function getExportPackBatchStateLabel(state: ExportPackBatchState): string {
  return STATE_LABELS[state];
}

export function getAllowedExportPackBatchTransitions(
  state: ExportPackBatchState
): ExportPackBatchState[] {
  const index = STATE_INDEX.get(state) ?? 0;
  const next = EXPORT_PACK_BATCH_STATES[index + 1];
  return next ? [next] : [];
}

export function validateExportPackBatchTransition(
  current: ExportPackBatchState,
  next: ExportPackBatchState
): string | undefined {
  if (current === next) return undefined;
  const allowed = getAllowedExportPackBatchTransitions(current);
  if (allowed.includes(next)) return undefined;
  if (current === "locked") return "导出包已锁定，只能进入 delivered";
  if (current === "delivered") return "导出包已交付，不能继续修改状态";
  return `导出包状态不能从 ${current} 切换到 ${next}`;
}

export function canEditExportPackBatch(
  state: ExportPackBatchState,
  updatesOnlyState = false
): boolean {
  if (state === "delivered") return false;
  if (state === "locked") return updatesOnlyState;
  return true;
}

export function buildExportPackBatchStateSnapshot(batch: {
  id: string;
  projectId: string;
  campaignId?: string;
  state: ExportPackBatchState | string;
  lockedAt?: string;
  deliveredAt?: string;
  updatedAt: string;
}): ExportPackBatchStateSnapshot {
  const state = normalizeExportPackBatchState(batch.state);
  return {
    batchId: batch.id,
    projectId: batch.projectId,
    campaignId: batch.campaignId,
    state,
    label: getExportPackBatchStateLabel(state),
    locked: state === "locked" || state === "delivered",
    delivered: state === "delivered",
    canTransitionTo: getAllowedExportPackBatchTransitions(state),
    lockedAt: batch.lockedAt,
    deliveredAt: batch.deliveredAt,
    updatedAt: batch.updatedAt,
  };
}
