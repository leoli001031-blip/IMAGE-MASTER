import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Copy,
  Download,
  FolderOpen,
  RefreshCw,
  Save,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type {
  GenerationReferenceImage,
  GenerationReferenceRole,
} from "@/lib/canvas/generation-reference-context";

export interface OutputPreviewModalItem {
  url: string;
  title: string;
  outputId?: string;
  artifactId?: string;
  jobId?: string;
  nodeId?: string;
  status?: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
  provider?: string;
  model?: string;
  error?: string;
}

export type OutputPreviewReviewStatus = "approved" | "pending" | "needs_redo" | "rejected" | "failed";
export type OutputPreviewVisualQaStatus = "pass" | "warn" | "fail" | "pending";

export interface OutputPreviewVisualQaIssue {
  dimension: string;
  status: OutputPreviewVisualQaStatus;
  label: string;
  summary: string;
}

export interface OutputPreviewVisualQaSummary {
  status: OutputPreviewVisualQaStatus;
  label: string;
  issues: OutputPreviewVisualQaIssue[];
}

export interface OutputPreviewAssetInvocationDecision {
  role: GenerationReferenceRole;
  mode: string;
  providerInput: boolean;
  reason?: string;
}

export interface OutputPreviewCopyRenderPolicy {
  mode?: string;
  allowBurnIn?: boolean;
  reason?: string;
  inImageText: string[];
  sellingPoints: string[];
  exportCopy: string[];
  forbiddenClaims: string[];
}

export interface OutputPreviewLockSummaryItem {
  key: string;
  label: string;
  tone: "strong" | "soft" | "copy" | "muted";
}

interface OutputPreviewModalProps {
  item: OutputPreviewModalItem;
  index: number;
  total: number;
  canPrevious: boolean;
  canNext: boolean;
  prompt?: string;
  error?: string;
  referenceRoleLabels: string[];
  providerRoleLabels: string[];
  productFocusLabel?: string;
  lockSummary: OutputPreviewLockSummaryItem[];
  copyPolicy?: OutputPreviewCopyRenderPolicy;
  assetInvocationDecisions: OutputPreviewAssetInvocationDecision[];
  providerReferenceImages: GenerationReferenceImage[];
  promptOnlyReferenceImages: GenerationReferenceImage[];
  reviewStatus: OutputPreviewReviewStatus;
  visualQa?: OutputPreviewVisualQaSummary;
  visualQaReviewing?: boolean;
  onSetReviewStatus: (status: OutputPreviewReviewStatus) => void;
  onRunVisualQa?: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onEdit: () => void;
  onRetry: () => void;
  onSaveAsAsset: () => void;
  onOpenFolder: () => void;
  onCopyPrompt: () => void;
}

export function OutputPreviewModal({
  item,
  index,
  total,
  canPrevious,
  canNext,
  prompt,
  error,
  referenceRoleLabels,
  providerRoleLabels,
  productFocusLabel,
  lockSummary,
  copyPolicy,
  assetInvocationDecisions,
  providerReferenceImages,
  promptOnlyReferenceImages,
  reviewStatus,
  visualQa,
  visualQaReviewing = false,
  onSetReviewStatus,
  onRunVisualQa,
  onPrevious,
  onNext,
  onClose,
  onEdit,
  onRetry,
  onSaveAsAsset,
  onOpenFolder,
  onCopyPrompt,
}: OutputPreviewModalProps) {
  const outputPurposeLabel = getOutputPreviewPurposeLabel(item);
  const outputRatioLabel = getOutputPreviewRatioLabel(item.metadata ?? {});
  const outputSourceVersion = getOutputPreviewSourceVersion(item.metadata ?? {});
  const canRetryOrEdit = Boolean(item.jobId || item.url);
  const retryTitle = item.jobId
    ? "立即重做当前图"
    : item.url
      ? "没有直接重跑任务时让 Agent 改这张"
      : "当前图没有可重做任务";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-warm-ink/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="查看生成大图"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-warm-line/60 bg-warm-paper shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-warm-line/60 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-warm-ink">{item.title}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-warm-muted">
              <span>{total > 1 ? `${index + 1}/${total}` : "生成大图"}</span>
              {item.provider && <span>· {item.provider}</span>}
              {item.model && <span>· {item.model}</span>}
              {productFocusLabel && <span>· {productFocusLabel}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-warm-line/60 bg-warm-bg text-warm-muted transition hover:border-warm-primary/40 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-35"
              disabled={!canPrevious}
              onClick={onPrevious}
              title="上一张"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-warm-line/60 bg-warm-bg text-warm-muted transition hover:border-warm-primary/40 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-35"
              disabled={!canNext}
              onClick={onNext}
              title="下一张"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink"
              onClick={onClose}
              title="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 gap-3 overflow-auto bg-warm-bg p-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-h-[360px] items-center justify-center rounded-md border border-warm-line/50 bg-warm-paper p-2">
            <img
              src={item.url}
              alt={item.title}
              className="h-[min(72vh,620px)] w-full rounded-md object-contain shadow-sm"
            />
          </div>
          <aside className="min-h-0 space-y-3 overflow-y-auto rounded-md border border-warm-line/50 bg-warm-paper p-3">
            <div className="rounded-md border border-warm-line/50 bg-warm-bg p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-warm-ink">本图操作</div>
                <span className={cn("rounded px-1.5 py-0.5 text-[10px]", getOutputPreviewReviewStatusClassName(reviewStatus))}>
                  {getOutputPreviewReviewStatusLabel(reviewStatus)}
                </span>
              </div>
              <div className="mb-2 grid grid-cols-4 gap-1.5">
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-xs font-medium text-emerald-700 transition hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!item.artifactId || reviewStatus === "failed"}
                  onClick={() => onSetReviewStatus("approved")}
                  title="标记这张可用"
                >
                  <Check className="h-3 w-3" />
                  保留
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-warm-line/60 bg-warm-paper px-2 text-xs font-medium text-warm-muted transition hover:border-warm-primary/40 hover:text-warm-ink disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!item.artifactId || reviewStatus === "failed" || reviewStatus === "pending"}
                  onClick={() => onSetReviewStatus("pending")}
                  title="恢复为待检查"
                >
                  <CircleDashed className="h-3 w-3" />
                  待检
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 text-xs font-medium text-amber-700 transition hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!item.artifactId || reviewStatus === "failed"}
                  onClick={() => onSetReviewStatus("needs_redo")}
                  title="标记这张待重做，不会立即生成"
                >
                  <RefreshCw className="h-3 w-3" />
                  待重做
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!item.artifactId || reviewStatus === "failed"}
                  onClick={() => onSetReviewStatus("rejected")}
                  title="淘汰这张"
                >
                  <XCircle className="h-3 w-3" />
                  淘汰
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-warm-line/60 bg-warm-paper px-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!item.url}
                  onClick={onEdit}
                  title="把这张图交给 Agent 再修改"
                >
                  <Wand2 className="h-3 w-3" />
                  让 Agent 改
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-warm-line/60 bg-warm-paper px-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!canRetryOrEdit}
                  onClick={onRetry}
                  title={retryTitle}
                >
                  <RefreshCw className="h-3 w-3" />
                  重做
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-warm-line/60 bg-warm-paper px-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!item.url}
                  onClick={onSaveAsAsset}
                  title="把这张结果保存为可复用资产"
                >
                  <Save className="h-3 w-3" />
                  存为资产
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-warm-line/60 bg-warm-paper px-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!item.url}
                  onClick={onOpenFolder}
                  title="打开生成图片所在的本地文件夹"
                >
                  <FolderOpen className="h-3 w-3" />
                  文件夹
                </button>
                <a
                  href={item.url}
                  download
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-warm-line/60 bg-warm-paper px-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Download className="h-3 w-3" />
                  下载
                </a>
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-warm-line/60 bg-warm-paper px-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!prompt}
                  onClick={onCopyPrompt}
                  title={prompt ? "复制这张图的 prompt" : "没有记录 prompt"}
                >
                  <Copy className="h-3 w-3" />
                  复制 Prompt
                </button>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-warm-ink">生成依据</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {referenceRoleLabels.length > 0 ? referenceRoleLabels.map((label) => (
                  <span key={label} className="rounded bg-warm-bg px-1.5 py-0.5 text-[10px] text-warm-muted">
                    {label}
                  </span>
                )) : (
                  <span className="text-[11px] text-warm-muted">
                    {providerRoleLabels.length > 0 ? "参考角色见 Provider 输入" : "没有记录结构化引用角色"}
                  </span>
                )}
              </div>
              {providerRoleLabels.length > 0 && (
                <div className="mt-1 text-[11px] text-warm-muted">
                  Provider 输入：{providerRoleLabels.join("、")}
                </div>
              )}
            </div>

            <div className="rounded-md border border-warm-line/50 bg-warm-bg px-2 py-1.5">
              <div className="mb-1 text-xs font-semibold text-warm-ink">原图用途 / 比例</div>
              <div className="space-y-1 text-[11px] leading-4 text-warm-muted">
                <div>用途：{outputPurposeLabel}</div>
                <div>比例：{outputRatioLabel}</div>
                {outputSourceVersion && (
                  <div className="truncate">
                    上一版：{outputSourceVersion.title}
                    {outputSourceVersion.artifactId ? ` · ${outputSourceVersion.artifactId}` : ""}
                  </div>
                )}
              </div>
            </div>

            {lockSummary.length > 0 && (
              <div className="rounded-md border border-warm-line/50 bg-warm-bg px-2 py-1.5">
                <div className="mb-1 text-xs font-semibold text-warm-ink">锁定摘要</div>
                <div className="flex flex-wrap gap-1">
                  {lockSummary.map((item) => (
                    <span
                      key={item.key}
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium",
                        getOutputPreviewLockSummaryClassName(item.tone)
                      )}
                    >
                      {item.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] leading-4 text-red-700">
                {error}
              </div>
            )}

            {visualQa && (
              <div className="rounded-md border border-warm-line/50 bg-warm-bg px-2 py-1.5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-warm-ink">视觉 QA</div>
                  <div className="flex items-center gap-1">
                    {onRunVisualQa && (
                      <button
                        type="button"
                        className="inline-flex h-6 items-center justify-center rounded border border-warm-line/60 bg-warm-paper px-1.5 text-[10px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={visualQaReviewing || !item.artifactId}
                        onClick={onRunVisualQa}
                        title="用 Agent 重新审核这张图"
                      >
                        <RefreshCw className={cn("mr-1 h-3 w-3", visualQaReviewing && "animate-spin")} />
                        {visualQaReviewing ? "审核中" : "Agent 审核"}
                      </button>
                    )}
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px]", getOutputPreviewVisualQaStatusClassName(visualQa.status))}>
                      {visualQa.label}
                    </span>
                  </div>
                </div>
                <div className="space-y-1 text-[11px] leading-4 text-warm-muted">
                  {visualQa.issues.length > 0 ? visualQa.issues.map((issue) => (
                    <div key={`${issue.dimension}-${issue.label}`} className="flex gap-1.5">
                      <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", getOutputPreviewVisualQaDotClassName(issue.status))} />
                      <span>
                        <span className="font-medium text-warm-ink">{issue.label}：</span>
                        {issue.summary}
                      </span>
                    </div>
                  )) : (
                    <div>暂无明显风险，仍建议人工看一眼商品、人物、光影和文案位置。</div>
                  )}
                </div>
              </div>
            )}

            {productFocusLabel && (
              <div className="rounded-md border border-warm-line/50 bg-warm-bg px-2 py-1.5">
                <div className="text-[10px] text-warm-muted">商品参考焦点</div>
                <div className="mt-0.5 text-xs font-medium text-warm-ink">{productFocusLabel}</div>
              </div>
            )}

            {copyPolicy && (
              <div className="rounded-md border border-warm-line/50 bg-warm-bg px-2 py-1.5">
                <div className="mb-1 text-xs font-semibold text-warm-ink">文案策略</div>
                <div className="space-y-1 text-[11px] leading-4 text-warm-muted">
                  {copyPolicy.mode && (
                    <div>模式：{getOutputPreviewCopyModeLabel(copyPolicy.mode)}</div>
                  )}
                  {copyPolicy.inImageText.length > 0 && (
                    <div className="truncate">画面文字：{copyPolicy.inImageText.join(" / ")}</div>
                  )}
                  {copyPolicy.sellingPoints.length > 0 && (
                    <div className="truncate">卖点：{copyPolicy.sellingPoints.join(" / ")}</div>
                  )}
                  {copyPolicy.forbiddenClaims.length > 0 && (
                    <div className="truncate">禁止声明：{copyPolicy.forbiddenClaims.join(" / ")}</div>
                  )}
                </div>
              </div>
            )}

            {assetInvocationDecisions.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold text-warm-ink">调用策略</div>
                <div className="space-y-1.5">
                  {assetInvocationDecisions.map((decision) => (
                    <div
                      key={`${decision.role}-${decision.mode}`}
                      className="rounded-md border border-warm-line/50 bg-warm-bg px-2 py-1.5"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-medium text-warm-ink">
                          {getGenerationReferenceRoleLabel(decision.role)}
                        </span>
                        <span className="rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">
                          {getAssetInvocationModeLabel(decision.mode)}
                        </span>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px]",
                            decision.providerInput
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-warm-paper text-warm-muted"
                          )}
                        >
                          {decision.providerInput ? "进模型" : "只约束"}
                        </span>
                      </div>
                      {decision.reason && (
                        <div className="mt-1 text-[11px] leading-4 text-warm-muted">
                          {decision.reason}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <OutputPreviewReferenceSection
              title="强参考图"
              images={providerReferenceImages}
              emptyText="这张图没有送进 provider 的图片参考"
            />
            <OutputPreviewReferenceSection
              title="弱参考 / 文字约束"
              images={promptOnlyReferenceImages}
              emptyText="没有额外弱参考图"
            />

            <div>
              <div className="mb-1 text-xs font-semibold text-warm-ink">Prompt</div>
              {prompt ? (
                <details className="rounded-md border border-warm-line/50 bg-warm-bg">
                  <summary className="cursor-pointer px-2 py-2 text-[11px] font-medium text-warm-muted transition hover:text-warm-ink">
                    查看完整 prompt
                  </summary>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-warm-line/50 p-2 text-[11px] leading-4 text-warm-ink">
                    {prompt}
                  </pre>
                </details>
              ) : (
                <div className="rounded-md border border-warm-line/50 bg-warm-bg p-2 text-[11px] text-warm-muted">
                  这张图还没有记录 prompt。
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function OutputPreviewReferenceSection({
  title,
  images,
  emptyText,
}: {
  title: string;
  images: GenerationReferenceImage[];
  emptyText: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-warm-ink">{title}</span>
        <span className="text-[10px] text-warm-muted">{images.length} 张</span>
      </div>
      {images.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {images.map((image, index) => (
            <a
              key={`${image.role}-${image.url}-${index}`}
              href={image.url}
              target="_blank"
              rel="noreferrer"
              className="group overflow-hidden rounded-md border border-warm-line/50 bg-warm-bg transition hover:border-warm-primary/50"
              title={image.title}
            >
              <div className="aspect-square bg-warm-paper">
                <img
                  src={image.url}
                  alt={image.title}
                  className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                  loading="lazy"
                />
              </div>
              <div className="space-y-1 px-1.5 py-1.5">
                <div className="truncate text-[11px] font-medium text-warm-ink">{image.title}</div>
                <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[10px]", getReferenceImageUsabilityClassName(image))}>
                  {getGenerationReferenceRoleLabel(image.role)}
                </span>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-warm-line/60 bg-warm-bg px-2 py-2 text-[11px] text-warm-muted">
          {emptyText}
        </div>
      )}
    </div>
  );
}

function getOutputPreviewCopyModeLabel(mode: string): string {
  if (mode === "burn_in") return "烧进图";
  if (mode === "layout_layer") return "图层/后期";
  if (mode === "metadata_only") return "仅元数据";
  return mode;
}

function getOutputPreviewPurposeLabel(item: OutputPreviewModalItem): string {
  const metadata = item.metadata ?? {};
  return (
    getOutputPreviewMetadataString(metadata, "planItemTitle") ||
    getOutputPreviewMetadataString(metadata, "batchJobTitle") ||
    getOutputPreviewMetadataString(metadata, "exportItemTitle") ||
    getOutputPreviewMetadataString(metadata, "useCase") ||
    getOutputPreviewMetadataString(metadata, "imageType") ||
    item.title ||
    "未记录"
  );
}

function getOutputPreviewRatioLabel(metadata: Record<string, unknown>): string {
  return (
    getOutputPreviewMetadataString(metadata, "ratio") ||
    getOutputPreviewMetadataString(metadata, "size") ||
    "未记录"
  );
}

function getOutputPreviewSourceVersion(metadata: Record<string, unknown>): {
  artifactId?: string;
  title: string;
} | null {
  const title =
    getOutputPreviewMetadataString(metadata, "rerunSourceArtifactTitle") ||
    getOutputPreviewMetadataString(metadata, "rerunSourcePlanItemTitle") ||
    getOutputPreviewMetadataString(metadata, "rerunSourceExportSpecTitle");
  const artifactId = getOutputPreviewMetadataString(metadata, "rerunSourceArtifactId");
  const jobId = getOutputPreviewMetadataString(metadata, "rerunOfJobId");

  if (!title && !artifactId && !jobId) return null;
  return {
    artifactId,
    title: title || "上一版成片",
  };
}

function getOutputPreviewMetadataString(
  metadata: Record<string, unknown>,
  key: string
): string {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function getOutputPreviewReviewStatusLabel(status: OutputPreviewReviewStatus): string {
  if (status === "approved") return "可用";
  if (status === "needs_redo") return "建议重做";
  if (status === "rejected") return "已淘汰";
  if (status === "failed") return "生成失败";
  return "待检查";
}

function getOutputPreviewReviewStatusClassName(status: OutputPreviewReviewStatus): string {
  if (status === "approved") return "bg-emerald-50 text-emerald-700";
  if (status === "needs_redo") return "bg-amber-50 text-amber-700";
  if (status === "rejected") return "bg-zinc-100 text-zinc-600";
  if (status === "failed") return "bg-red-50 text-red-700";
  return "bg-warm-paper text-warm-muted";
}

function getOutputPreviewVisualQaStatusClassName(status: OutputPreviewVisualQaStatus): string {
  if (status === "pass") return "bg-emerald-50 text-emerald-700";
  if (status === "warn") return "bg-amber-50 text-amber-700";
  if (status === "fail") return "bg-red-50 text-red-700";
  return "bg-warm-paper text-warm-muted";
}

function getOutputPreviewVisualQaDotClassName(status: OutputPreviewVisualQaStatus): string {
  if (status === "pass") return "bg-emerald-500";
  if (status === "warn") return "bg-amber-500";
  if (status === "fail") return "bg-red-500";
  return "bg-warm-muted";
}

function getOutputPreviewLockSummaryClassName(tone: OutputPreviewLockSummaryItem["tone"]): string {
  if (tone === "strong") return "bg-emerald-50 text-emerald-700";
  if (tone === "soft") return "bg-sky-50 text-sky-700";
  if (tone === "copy") return "bg-amber-50 text-amber-700";
  return "bg-warm-paper text-warm-muted";
}

function getAssetInvocationModeLabel(mode: string): string {
  const labels: Record<string, string> = {
    hard_reference: "硬参考",
    identity_reference: "身份参考",
    lighting_space: "空间光影",
    style_finish: "风格完成",
    copy_layer: "文案图层",
    prompt_only: "提示词约束",
    unused: "未使用",
  };
  return labels[mode] ?? mode;
}

function getGenerationReferenceRoleLabel(role: GenerationReferenceRole): string {
  if (role === "product") return "商品";
  if (role === "model") return "模特";
  if (role === "style") return "风格";
  if (role === "copy") return "文案";
  return "场景";
}

function getReferenceImageUsabilityClassName(image: GenerationReferenceImage): string {
  return image.providerUsable
    ? "bg-emerald-50 text-emerald-700"
    : "bg-warm-bg text-warm-muted";
}
