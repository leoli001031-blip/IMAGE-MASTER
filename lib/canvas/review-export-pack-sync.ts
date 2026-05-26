import {
  MANUAL_QA_CHECK_IDS,
  mergeExportPackQaReviewMetadata,
  type ExportPackQaManualStatus,
} from "@/lib/canvas/export-pack-qa";
import type {
  ReviewSessionItem,
  ReviewSessionSummary,
  UpdateReviewSessionInput,
} from "@/lib/canvas/reviewer-session";
import type { GenerationJob } from "@/lib/types";

export type ExportPackReviewSyncStatus = "synced" | "skipped" | "failed";

export interface ExportPackReviewSyncResult {
  status: ExportPackReviewSyncStatus;
  batchId?: string;
  jobId?: string;
  checkCount?: number;
  reason?: string;
}

export function getExportPackReviewSyncPlan(
  session: ReviewSessionSummary,
  input: UpdateReviewSessionInput
):
  | {
      batchId: string;
      jobId: string;
      status: ExportPackQaManualStatus;
      note: string;
      reviewer: string;
      updatedAt: string;
      checkIds: string[];
    }
  | undefined {
  if (input.action === "add_note") return undefined;

  const itemId = getString(input.itemId);
  if (!itemId) return undefined;

  const item = session.itemList.find((candidate) => candidate.id === itemId);
  if (!item) return undefined;

  const batchId = getString(item.metadata.batchId) || getString(session.metadata.batchId);
  const jobId = getString(item.sourceId) || item.id;
  const artifactId = getString(item.metadata.artifactId);
  if (!batchId || !jobId || !artifactId) return undefined;

  return {
    batchId,
    jobId,
    status: mapReviewActionToQaStatus(input.action),
    note: getSyncNote(input, item),
    reviewer: getReviewer(input),
    updatedAt: input.now || session.updatedAt || new Date().toISOString(),
    checkIds: MANUAL_QA_CHECK_IDS,
  };
}

export function applyExportPackReviewSyncToJob(
  job: GenerationJob,
  plan: NonNullable<ReturnType<typeof getExportPackReviewSyncPlan>>
): GenerationJob["metadata"] | undefined {
  const jobBatchId = getString(job.metadata.batchId);
  if (jobBatchId && jobBatchId !== plan.batchId) return undefined;

  return plan.checkIds.reduce(
    (metadata, checkId) =>
      mergeExportPackQaReviewMetadata(metadata, {
        checkId,
        status: plan.status,
        note: plan.note,
        reviewer: plan.reviewer,
        updatedAt: plan.updatedAt,
      }),
    job.metadata
  );
}

function mapReviewActionToQaStatus(
  action: UpdateReviewSessionInput["action"]
): ExportPackQaManualStatus {
  if (action === "approve_item") return "pass";
  if (action === "reject_item") return "fail";
  return "manual";
}

function getSyncNote(input: UpdateReviewSessionInput, item: ReviewSessionItem): string {
  const note = getString(input.note);
  if (note) return note;
  if (input.action === "approve_item") return `${item.title} approved from review workspace`;
  if (input.action === "reject_item") return `${item.title} rejected from review workspace`;
  return `${item.title} revision requested from review workspace`;
}

function getReviewer(input: UpdateReviewSessionInput): string {
  const metadataReviewer = getString(input.metadata?.reviewer);
  return metadataReviewer || "review-session";
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
