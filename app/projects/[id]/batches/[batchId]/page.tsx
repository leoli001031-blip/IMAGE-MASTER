import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  ImageIcon,
  PackageCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import {
  buildExportPackManifests,
  type ExportPackManifest,
  type ExportPackManifestItem,
} from "@/lib/canvas/export-pack-manifest";
import {
  buildExportPackQaReviewByJobId,
  MANUAL_QA_CHECK_IDS,
  type ExportPackQaManualReview,
} from "@/lib/canvas/export-pack-qa";
import * as artifactDB from "@/lib/store/artifact-db";
import * as jobDB from "@/lib/store/job-db";
import * as projectDB from "@/lib/store/project-db";
import type { GeneratedArtifact, GenerationJob } from "@/lib/types";
import { BatchResultActions, ResultImagePreview, ResultItemActions } from "./batch-result-actions";

type BatchState = "draft" | "generated" | "in_review" | "reviewed" | "locked" | "delivered";

const batchStateLabel: Record<BatchState, string> = {
  draft: "草稿",
  generated: "已生成",
  in_review: "审核中",
  reviewed: "已审核",
  locked: "已锁定",
  delivered: "已交付",
};

const batchStateClass: Record<BatchState, string> = {
  draft: "bg-warm-line/25 text-warm-muted",
  generated: "bg-warm-primary-soft text-warm-primary",
  in_review: "bg-warm-clay/15 text-warm-clay",
  reviewed: "bg-warm-primary-soft text-warm-primary",
  locked: "bg-warm-ink/10 text-warm-ink",
  delivered: "bg-warm-ink text-warm-paper",
};

export default async function ProjectBatchPage({
  params,
}: {
  params: Promise<{ id: string; batchId: string }>;
}) {
  const { id, batchId } = await params;
  const project = await projectDB.getProject(id);
  if (!project) notFound();

  const batch = project.batches.find((item) => item.id === batchId);
  if (!batch) notFound();

  const jobs = await jobDB.list({ batchId });
  const artifacts = await artifactDB.list({ batchId });
  const reviewByJobId = buildExportPackQaReviewByJobId(
    jobs as Array<{ id: string; metadata: Record<string, unknown> }>
  );
  const manifest = buildExportPackManifests({
    jobs: jobs as Array<GenerationJob & { metadata: Record<string, unknown> }>,
    artifacts: artifacts as Array<GeneratedArtifact & { metadata: Record<string, unknown> }>,
  }).find((item) => item.batchId === batchId);
  const items = buildResultItems({ jobs, artifacts, manifest, reviewByJobId });
  const imageUrls = items.map((item) => item.url).filter((url): url is string => !!url);
  const state = normalizeBatchState(batch.batchState?.state ?? batch.state);
  const counts = manifest?.counts ?? {
    planned: items.filter((item) => item.status === "pending" || item.status === "queued").length,
    completed: items.filter((item) => !!item.url).length,
    failed: items.filter((item) => item.status === "failed").length,
    missingArtifact: items.filter((item) => item.missingArtifact).length,
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-2 py-4 sm:px-4 lg:py-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-3">
          <Link
            href={`/projects/${encodeURIComponent(project.id)}`}
            className="inline-flex items-center gap-2 text-xs font-medium text-warm-muted transition hover:text-warm-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {project.title}
          </Link>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-warm-ink sm:text-3xl">{batch.title}</h1>
              <StatusPill label={batch.batchState?.label || batchStateLabel[state]} state={state} />
            </div>
            <p className="max-w-2xl text-sm leading-6 text-warm-muted">
              查看这一组图的生成结果、失败项和本地文件位置。
            </p>
          </div>
        </div>
        <Link
          href={`/canvas?projectId=${encodeURIComponent(project.id)}`}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-warm-ink px-4 py-2 text-sm font-medium text-warm-paper transition hover:bg-warm-ink/90"
        >
          回到画布
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <section className="grid gap-2 border-y border-warm-line/60 py-3 sm:grid-cols-5">
        <BatchMetric icon={ImageIcon} label="图片" value={items.length} />
        <BatchMetric icon={CheckCircle2} label="完成" value={counts.completed} />
        <BatchMetric icon={Clock3} label="等待" value={counts.planned} />
        <BatchMetric icon={XCircle} label="失败" value={counts.failed} />
        <BatchMetric icon={PackageCheck} label="缺产物" value={counts.missingArtifact} />
      </section>

      <BatchResultActions
        urls={imageUrls}
        fallbackTitle={imageUrls.length > 0 ? `${imageUrls.length} 张图片可打开` : "当前批次还没有本地图片"}
      />

      {items.length > 0 ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item, index) => (
            <article
              key={`${item.jobId}:${index}`}
              className="overflow-hidden rounded-lg border border-warm-line/70 bg-warm-paper"
            >
              <div className="aspect-[4/3] bg-warm-soft">
                {item.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt={item.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-warm-muted">
                    {item.status === "failed" ? <XCircle className="h-6 w-6 text-warm-clay" /> : <Sparkles className="h-6 w-6" />}
                    <span className="text-sm">{getEmptyResultLabel(item)}</span>
                  </div>
                )}
              </div>
              <div className="space-y-3 p-3">
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="line-clamp-2 text-sm font-semibold text-warm-ink">{item.title}</h2>
                    <StatusPill label={getJobStatusLabel(item.status)} state={getVisualState(item)} />
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-warm-muted">
                    {item.ratio && <span>{item.ratio}</span>}
                    {item.size && <span>{item.size}</span>}
                    {item.naming && <span>{item.naming}</span>}
                  </div>
                </div>
                {item.error && (
                  <p className="rounded-md bg-warm-clay/10 px-2 py-1.5 text-xs leading-5 text-warm-clay">
                    {item.error}
                  </p>
                )}
                {item.url && <ResultImagePreview title={item.title} url={item.url} />}
                <div className="flex items-center justify-between gap-2 rounded-md bg-warm-soft/70 px-2 py-1.5 text-xs text-warm-muted">
                  <span>审核</span>
                  <span className={getReviewStatusClass(item.reviewStatus)}>
                    {item.reviewLabel}
                  </span>
                </div>
                {item.reviewNote && (
                  <p className="text-xs leading-5 text-warm-muted">{item.reviewNote}</p>
                )}
                <ResultItemActions
                  batchId={batchId}
                  jobId={item.jobId}
                  title={item.title}
                  url={item.url}
                  retryable={item.status === "failed"}
                  rerunnable={item.rerunnable}
                  reviewable={item.reviewable}
                  reviewStatus={item.reviewStatus}
                  metadata={{
                    projectId: project.id,
                    batchId,
                    jobId: item.jobId,
                    sourceProjectTitle: project.title,
                    sourceBatchTitle: batch.title,
                    naming: item.naming,
                    ratio: item.ratio,
                    size: item.size,
                  }}
                />
              </div>
            </article>
          ))}
        </section>
      ) : (
        <div className="rounded-lg border border-dashed border-warm-line bg-warm-paper px-6 py-12 text-center">
          <h2 className="text-base font-medium text-warm-ink">这个批次还没有任务</h2>
          <p className="mt-2 text-sm text-warm-muted">回到画布后重新创建生成框或图组任务。</p>
        </div>
      )}
    </div>
  );
}

interface BatchResultItem {
  jobId: string;
  title: string;
  status: string;
  url?: string;
  artifactStatus?: string;
  missingArtifact: boolean;
  error?: string;
  naming?: string;
  ratio?: string;
  size?: string;
  reviewable: boolean;
  rerunnable: boolean;
  reviewStatus: "none" | "manual" | "pass" | "fail";
  reviewLabel: string;
  reviewNote?: string;
}

function buildResultItems({
  jobs,
  artifacts,
  manifest,
  reviewByJobId,
}: {
  jobs: GenerationJob[];
  artifacts: GeneratedArtifact[];
  manifest?: ExportPackManifest;
  reviewByJobId: ReturnType<typeof buildExportPackQaReviewByJobId>;
}): BatchResultItem[] {
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const artifactByJobId = new Map(artifacts.filter((artifact) => artifact.jobId).map((artifact) => [artifact.jobId as string, artifact]));

  if (manifest) {
    return manifest.items.map((item) => {
      const job = jobById.get(item.jobId);
      const artifact = item.artifact ?? getManifestArtifact(item, artifactByJobId);
      const review = summarizeReview(reviewByJobId[item.jobId]);
      return {
        jobId: item.jobId,
        title: item.title,
        status: item.status,
        url: artifact?.url || job?.resultUrl || undefined,
        artifactStatus: artifact?.status,
        missingArtifact: isCompletedStatus(item.status) && !artifact?.url && !job?.resultUrl,
        error: job?.error || getString(job?.metadata?.errorMessage),
        naming: item.naming,
        ratio: item.ratio,
        size: item.size,
        reviewable: !!(artifact?.url || job?.resultUrl) && !isFailedStatus(item.status),
        rerunnable: !!(artifact?.url || job?.resultUrl) && isCompletedStatus(item.status),
        ...review,
      };
    });
  }

  return jobs.map((job) => {
    const artifact = artifactByJobId.get(job.id);
    const review = summarizeReview(reviewByJobId[job.id]);
    return {
      jobId: job.id,
      title: getString(job.metadata.batchJobTitle) ?? getString(job.metadata.exportSpecTitle) ?? getString(job.metadata.nodeLabel) ?? "生成任务",
      status: job.status,
      url: artifact?.url || job.resultUrl || undefined,
      artifactStatus: artifact?.status,
      missingArtifact: isCompletedStatus(job.status) && !artifact?.url && !job.resultUrl,
      error: job.error || getString(job.metadata.errorMessage),
      naming: getString(job.metadata.naming),
      ratio: getString(job.metadata.ratio),
      size: getString(job.metadata.size),
      reviewable: !!(artifact?.url || job.resultUrl) && !isFailedStatus(job.status),
      rerunnable: !!(artifact?.url || job.resultUrl) && isCompletedStatus(job.status),
      ...review,
    };
  });
}

function getManifestArtifact(
  item: ExportPackManifestItem,
  artifactByJobId: Map<string, GeneratedArtifact>
): { url: string; status: string } | undefined {
  if (item.artifact) return item.artifact;
  const artifact = artifactByJobId.get(item.jobId);
  return artifact ? { url: artifact.url, status: artifact.status } : undefined;
}

function BatchMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ImageIcon;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 px-1 py-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-warm-primary-soft text-warm-primary">
        <Icon className="h-4 w-4" />
      </span>
      <span>
        <span className="block text-lg font-semibold leading-tight text-warm-ink">{value}</span>
        <span className="text-xs text-warm-muted">{label}</span>
      </span>
    </div>
  );
}

function StatusPill({ label, state }: { label: string; state?: BatchState }) {
  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded px-2 py-0.5 text-xs ${state ? batchStateClass[state] : "bg-warm-soft text-warm-muted"}`}>
      {state === "delivered" || state === "reviewed" ? <CheckCircle2 className="h-3 w-3" /> : null}
      {label}
    </span>
  );
}

function getVisualState(item: BatchResultItem): BatchState {
  if (item.status === "failed") return "in_review";
  if (item.reviewStatus === "pass") return "reviewed";
  if (item.reviewStatus === "fail") return "in_review";
  if (item.url) return "generated";
  return "draft";
}

function getJobStatusLabel(status: string): string {
  if (status === "done" || status === "completed") return "完成";
  if (status === "failed") return "失败";
  if (status === "running" || status === "processing") return "生成中";
  if (status === "queued") return "排队";
  return "待处理";
}

function getEmptyResultLabel(item: BatchResultItem): string {
  if (item.status === "failed") return "生成失败";
  if (item.missingArtifact) return "缺少产物";
  return "等待生成";
}

function normalizeBatchState(value: unknown): BatchState {
  if (
    value === "generated" ||
    value === "in_review" ||
    value === "reviewed" ||
    value === "locked" ||
    value === "delivered"
  ) {
    return value;
  }
  return "draft";
}

function isCompletedStatus(status?: string): boolean {
  return status === "done" || status === "completed";
}

function isFailedStatus(status?: string): boolean {
  return status === "failed";
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function summarizeReview(
  review?: Record<string, ExportPackQaManualReview | undefined>
): Pick<BatchResultItem, "reviewStatus" | "reviewLabel" | "reviewNote"> {
  const checks = MANUAL_QA_CHECK_IDS.map((checkId) => review?.[checkId]).filter(
    (item): item is ExportPackQaManualReview => !!item
  );
  const latestNote = [...checks]
    .reverse()
    .map((item) => item.note?.trim())
    .find((note): note is string => !!note);

  if (checks.some((item) => item.status === "fail")) {
    return { reviewStatus: "fail", reviewLabel: "已驳回", reviewNote: latestNote };
  }
  if (checks.length === MANUAL_QA_CHECK_IDS.length && checks.every((item) => item.status === "pass")) {
    return { reviewStatus: "pass", reviewLabel: "已通过", reviewNote: latestNote };
  }
  if (checks.length > 0) {
    return { reviewStatus: "manual", reviewLabel: "复核中", reviewNote: latestNote };
  }
  return { reviewStatus: "none", reviewLabel: "未审核" };
}

function getReviewStatusClass(status: BatchResultItem["reviewStatus"]): string {
  if (status === "pass") return "font-medium text-warm-primary";
  if (status === "fail") return "font-medium text-warm-clay";
  if (status === "manual") return "font-medium text-warm-ink";
  return "text-warm-muted";
}
