"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FolderOpen,
  Info,
  RefreshCw,
  Save,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import Image from "next/image";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ImageDetailReference {
  role: string;
  title: string;
  url: string;
  providerUsable?: boolean;
  providerMode?: string;
}

export interface ImageDetailDiagnostics {
  code?: string;
  summary?: string;
  endpoint?: string;
  providerHost?: string;
  responseShape?: string;
  [key: string]: unknown;
}

export interface ImageDetailItem {
  id: string;
  url: string;
  title: string;
  type?: string;
  status?: string;
  ratio?: string;
  size?: string;
  prompt?: string;
  provider?: string;
  model?: string;
  error?: string;
  errorCode?: string;
  reviewStatus?: ImageDetailReviewStatus;
  reviewLabel?: string;
  createdAt?: string;
  references?: {
    providerInputs: ImageDetailReference[];
    promptOnly: ImageDetailReference[];
  };
  diagnostics?: ImageDetailDiagnostics;
  copyPolicy?: {
    mode?: string;
    reason?: string;
    allowBurnIn?: boolean;
    inImageText?: string[];
    sellingPoints?: string[];
    exportCopy?: string[];
    forbiddenClaims?: string[];
  };
  assetInvocation?: {
    mode?: string;
    fallbackUsed?: boolean;
    fallbackReason?: string;
    providerReferenceRoles?: string[];
    promptOnlyRoles?: string[];
    decisions: Array<{
      role: string;
      mode: string;
      providerInput: boolean;
      reason?: string;
    }>;
  };
  sourceVersion?: {
    artifactId?: string;
    jobId?: string;
    title?: string;
    url?: string;
  };
  prevItem?: { id: string; title: string };
  nextItem?: { id: string; title: string };
}

export type ImageDetailReviewStatus = "approved" | "pending" | "needs_redo" | "rejected" | "failed";

/* ------------------------------------------------------------------ */
/*  Labels                                                             */
/* ------------------------------------------------------------------ */

const ROLE_LABELS: Record<string, string> = {
  product: "商品",
  model: "模特",
  scene: "场景",
  style: "风格",
  copy: "文案",
  previous: "上一版",
};

const TYPE_LABELS: Record<string, string> = {
  main: "主图",
  selling_point: "卖点图",
  detail: "详情图",
  model: "模特图",
  scene: "场景图",
  poster: "海报",
  copy: "文案图层",
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] || role;
}

function typeLabel(type: string | undefined): string {
  return (type && TYPE_LABELS[type]) || type || "";
}

function invocationModeLabel(mode: string): string {
  const labels: Record<string, string> = {
    hard_reference: "硬参考",
    identity_reference: "身份参考",
    lighting_space: "空间光影",
    style_finish: "风格完成",
    copy_layer: "文案图层",
    prompt_only: "提示词约束",
    unused: "未使用",
  };
  return labels[mode] || mode;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface ImageDetailPanelProps {
  item: ImageDetailItem | null;
  open: boolean;
  onClose: () => void;
  onNavigate?: (item: { id: string; title: string }) => void;
  onDownload?: (item: ImageDetailItem) => void;
  onEdit?: (item: ImageDetailItem) => void;
  onRetry?: (item: ImageDetailItem) => void;
  onSaveAsAsset?: (item: ImageDetailItem) => void;
  onOpenFolder?: (item: ImageDetailItem) => void;
  onSetReviewStatus?: (item: ImageDetailItem, status: Exclude<ImageDetailReviewStatus, "failed">) => void;
}

export function ImageDetailPanel({
  item,
  open,
  onClose,
  onNavigate,
  onDownload,
  onEdit,
  onRetry,
  onSaveAsAsset,
  onOpenFolder,
  onSetReviewStatus,
}: ImageDetailPanelProps) {
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [compareWithSource, setCompareWithSource] = useState(false);

  useEffect(() => {
    setCompareWithSource(false);
  }, [item?.id]);

  if (!open || !item) return null;
  const sourceVersionTarget = item.sourceVersion && (item.sourceVersion.jobId || item.sourceVersion.artifactId)
    ? {
        id: item.sourceVersion.jobId || item.sourceVersion.artifactId || "",
        title: item.sourceVersion.title || "上一版成片",
      }
    : null;
  const providerReferenceRoles = item.assetInvocation?.providerReferenceRoles?.length
    ? item.assetInvocation.providerReferenceRoles
    : Array.from(new Set((item.assetInvocation?.decisions ?? [])
        .filter((decision) => decision.providerInput)
        .map((decision) => decision.role)));
  const promptOnlyRoles = item.assetInvocation?.promptOnlyRoles?.length
    ? item.assetInvocation.promptOnlyRoles
    : Array.from(new Set((item.assetInvocation?.decisions ?? [])
        .filter((decision) => !decision.providerInput)
        .map((decision) => decision.role)));

  const handleCopyPrompt = async () => {
    if (!item.prompt) return;
    await navigator.clipboard.writeText(item.prompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-warm-ink/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* panel */}
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-lg border border-warm-line bg-warm-paper shadow-2xl">
        {/* close */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-20 rounded-full bg-warm-ink/70 p-1.5 text-warm-paper transition hover:bg-warm-ink"
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>

        {/* nav arrows */}
        {item.prevItem && onNavigate && (
          <button
            onClick={() => onNavigate(item.prevItem!)}
            className="absolute left-4 top-1/2 z-20 -translate-y-1/2 rounded-full bg-warm-ink/50 p-2 text-warm-paper transition hover:bg-warm-ink"
            aria-label="上一张"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
        )}
        {item.nextItem && onNavigate && (
          <button
            onClick={() => onNavigate(item.nextItem!)}
            className="absolute right-4 top-1/2 z-20 -translate-y-1/2 rounded-full bg-warm-ink/50 p-2 text-warm-paper transition hover:bg-warm-ink"
            aria-label="下一张"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        )}

        {/* body: image + sidebar */}
        <div className="flex w-full flex-col lg:flex-row lg:overflow-hidden">
          {/* image area */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-warm-ink/5 p-4 lg:p-8">
            {item.url ? (
              compareWithSource && item.sourceVersion?.url ? (
                <div className="grid h-[min(70vh,720px)] w-full gap-3 lg:grid-cols-2">
                  <ComparisonImage
                    label="上一版"
                    src={item.sourceVersion.url}
                    alt={item.sourceVersion.title || "上一版成片"}
                  />
                  <ComparisonImage
                    label="当前版"
                    src={item.url}
                    alt={item.title}
                    active
                  />
                </div>
              ) : (
                <div className="relative h-[min(70vh,720px)] w-full">
                  <Image
                    src={item.url}
                    alt={item.title}
                    width={1200}
                    height={1200}
                    className="h-full w-full rounded-lg object-contain"
                    unoptimized={item.url.startsWith("data:")}
                  />
                </div>
              )
            ) : (
              <div className="flex flex-col items-center gap-3 text-warm-muted/50">
                <AlertTriangle className="h-10 w-10" />
                <p className="text-sm">图片不可用</p>
                {item.error && (
                  <p className="max-w-xs text-center text-xs text-warm-clay">{item.error}</p>
                )}
              </div>
            )}

            {/* image overlay badges */}
            <div className="absolute left-4 top-4 flex flex-wrap gap-1.5">
              {item.type && (
                <span className="rounded-full bg-warm-primary/85 px-2.5 py-0.5 text-xs text-warm-paper">
                  {typeLabel(item.type)}
                </span>
              )}
              {item.ratio && (
                <span className="rounded-full bg-warm-ink/60 px-2 py-0.5 text-xs text-warm-paper">
                  {item.ratio}
                </span>
              )}
              {item.size && (
                <span className="rounded-full bg-warm-ink/40 px-2 py-0.5 text-xs text-warm-paper">
                  {item.size}
                </span>
              )}
            </div>
          </div>

          {/* sidebar */}
          <div className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-t border-warm-line p-5 lg:w-[400px] lg:border-l lg:border-t-0">
            {/* header */}
            <div>
              <h2 className="text-base font-semibold text-warm-ink">{item.title}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-warm-muted">
                {item.status && (
                  <span className="rounded-full bg-warm-primary-soft px-2 py-0.5 text-warm-primary">
                    {item.status}
                  </span>
                )}
                {item.provider && <span>{item.provider}</span>}
                {item.model && <span>{item.model}</span>}
                {item.createdAt && (
                  <span>{new Date(item.createdAt).toLocaleString("zh-CN")}</span>
                )}
              </div>
            </div>

            {/* error */}
            {item.error && (
              <Section icon={AlertTriangle} title="错误信息" className="text-warm-clay">
                <p className="text-sm">{item.error}</p>
                {item.errorCode && (
                  <p className="mt-1 text-xs text-warm-muted">code: {item.errorCode}</p>
                )}
              </Section>
            )}

            {onSetReviewStatus && item.reviewStatus !== "failed" && (
              <Section icon={CheckCircle2} title="挑图状态">
                <div className="flex flex-wrap gap-2">
                  <ReviewStatusButton
                    icon={CheckCircle2}
                    label="保留"
                    active={item.reviewStatus === "approved"}
                    onClick={() => onSetReviewStatus(item, "approved")}
                  />
                  <ReviewStatusButton
                    icon={Circle}
                    label="待检"
                    active={!item.reviewStatus || item.reviewStatus === "pending"}
                    onClick={() => onSetReviewStatus(item, "pending")}
                  />
                  <ReviewStatusButton
                    icon={RefreshCw}
                    label="待重做"
                    active={item.reviewStatus === "needs_redo"}
                    onClick={() => onSetReviewStatus(item, "needs_redo")}
                  />
                  <ReviewStatusButton
                    icon={XCircle}
                    label="淘汰"
                    active={item.reviewStatus === "rejected"}
                    onClick={() => onSetReviewStatus(item, "rejected")}
                  />
                </div>
                {item.reviewLabel && (
                  <p className="text-xs text-warm-muted">当前：{item.reviewLabel}</p>
                )}
              </Section>
            )}

            {/* diagnostics */}
            {item.diagnostics && (item.diagnostics.code || item.diagnostics.summary) && (
              <Section icon={Info} title="Provider 诊断">
                <dl className="space-y-1 text-xs">
                  {item.diagnostics.code && <Row label="code" value={String(item.diagnostics.code)} />}
                  {item.diagnostics.endpoint && <Row label="endpoint" value={String(item.diagnostics.endpoint)} />}
                  {item.diagnostics.providerHost && <Row label="host" value={String(item.diagnostics.providerHost)} />}
                  {item.diagnostics.summary && <Row label="summary" value={item.diagnostics.summary} />}
                </dl>
              </Section>
            )}

            {item.sourceVersion && (
              <Section
                icon={RefreshCw}
                title="上一版来源"
                action={
                  <div className="flex items-center gap-1.5">
                    {item.sourceVersion.url && (
                      <button
                        type="button"
                        onClick={() => setCompareWithSource((value) => !value)}
                        className="rounded-md border border-warm-line bg-warm-bg px-2 py-1 text-[11px] font-medium text-warm-muted transition hover:border-warm-primary/40 hover:text-warm-primary"
                      >
                        {compareWithSource ? "退出对比" : "对比当前"}
                      </button>
                    )}
                    {sourceVersionTarget && onNavigate && (
                      <button
                        type="button"
                        onClick={() => onNavigate(sourceVersionTarget)}
                        className="rounded-md border border-warm-line bg-warm-bg px-2 py-1 text-[11px] font-medium text-warm-muted transition hover:border-warm-primary/40 hover:text-warm-primary"
                      >
                        打开上一版
                      </button>
                    )}
                  </div>
                }
              >
                <div className="flex gap-2 rounded-lg border border-warm-line bg-warm-bg p-2">
                  {item.sourceVersion.url && (
                    <ReferenceThumb
                      reference={{
                        role: "previous",
                        title: item.sourceVersion.title || "上一版成片",
                        url: item.sourceVersion.url,
                        providerUsable: true,
                      }}
                    />
                  )}
                  <dl className="min-w-0 flex-1 space-y-1 text-xs">
                    {item.sourceVersion.title && <Row label="原图" value={item.sourceVersion.title} />}
                    {item.sourceVersion.artifactId && <Row label="artifact" value={item.sourceVersion.artifactId} />}
                    {item.sourceVersion.jobId && <Row label="job" value={item.sourceVersion.jobId} />}
                  </dl>
                </div>
              </Section>
            )}

            {/* references */}
            {(item.references?.providerInputs.length || item.references?.promptOnly.length) ? (
              <Section icon={Eye} title="参考图">
                {item.references.providerInputs.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-warm-ink/60">强参考（输入模型）</p>
                    <div className="flex flex-wrap gap-2">
                      {item.references.providerInputs.map((ref, i) => (
                        <ReferenceThumb key={i} reference={ref} />
                      ))}
                    </div>
                  </div>
                )}
                {item.references.promptOnly.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-warm-ink/60">弱参考（仅文字约束）</p>
                    <div className="flex flex-wrap gap-2">
                      {item.references.promptOnly.map((ref, i) => (
                        <ReferenceThumb key={i} reference={ref} />
                      ))}
                    </div>
                  </div>
                )}
              </Section>
            ) : null}

            {/* asset invocation */}
            {item.assetInvocation?.decisions.length ? (
              <Section icon={Info} title="调用策略">
                <div className="space-y-2">
                  <div className="rounded-lg border border-warm-line bg-warm-bg px-2.5 py-2 text-xs">
                    <div className="font-medium text-warm-ink">调用总览</div>
                    <div className="mt-1 space-y-0.5 text-warm-muted">
                      <p>强参考：{providerReferenceRoles.length ? providerReferenceRoles.map(roleLabel).join("、") : "无"}</p>
                      <p>文字/约束：{promptOnlyRoles.length ? promptOnlyRoles.map(roleLabel).join("、") : "无"}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.assetInvocation.mode && (
                      <span className="rounded-full bg-warm-soft px-2 py-0.5 text-[11px] text-warm-muted">
                        {item.assetInvocation.mode}
                      </span>
                    )}
                    {item.assetInvocation.fallbackUsed && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                        fallback
                      </span>
                    )}
                  </div>
                  {item.assetInvocation.fallbackReason && (
                    <p className="text-xs leading-relaxed text-warm-muted">
                      {item.assetInvocation.fallbackReason}
                    </p>
                  )}
                  <div className="space-y-1.5">
                    {item.assetInvocation.decisions.map((decision) => (
                      <div
                        key={`${decision.role}-${decision.mode}`}
                        className="rounded-lg border border-warm-line bg-warm-soft/60 px-2 py-1.5"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-medium text-warm-ink">
                            {roleLabel(decision.role)}
                          </span>
                          <span className="rounded-full bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">
                            {invocationModeLabel(decision.mode)}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px]",
                              decision.providerInput
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-warm-paper text-warm-muted"
                            )}
                          >
                            {decision.providerInput ? "进模型" : "只约束"}
                          </span>
                        </div>
                        {decision.reason && (
                          <p className="mt-1 text-xs leading-relaxed text-warm-muted">
                            {decision.reason}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </Section>
            ) : null}

            {/* copy policy */}
            {item.copyPolicy && (item.copyPolicy.mode || item.copyPolicy.inImageText?.length || item.copyPolicy.sellingPoints?.length) ? (
              <Section icon={Info} title="文案策略">
                <div className="space-y-1.5 text-xs">
                  {item.copyPolicy.mode && <Row label="模式" value={item.copyPolicy.mode} />}
                  {item.copyPolicy.reason && (
                    <p className="mt-1 text-warm-muted">{item.copyPolicy.reason}</p>
                  )}
                  {item.copyPolicy.sellingPoints?.length ? (
                    <div>
                      <p className="font-medium text-warm-ink/60">卖点</p>
                      <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-warm-muted">
                        {item.copyPolicy.sellingPoints.map((point, i) => (
                          <li key={i}>{point}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {item.copyPolicy.inImageText?.length ? (
                    <div>
                      <p className="font-medium text-warm-ink/60">画面文字</p>
                      <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-warm-muted">
                        {item.copyPolicy.inImageText.map((text, i) => (
                          <li key={i}>{text}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {item.copyPolicy.exportCopy?.length ? (
                    <div>
                      <p className="font-medium text-warm-ink/60">导出文案</p>
                      <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-warm-muted">
                        {item.copyPolicy.exportCopy.map((text, i) => (
                          <li key={i}>{text}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {item.copyPolicy.forbiddenClaims?.length ? (
                    <div>
                      <p className="font-medium text-warm-ink/60">禁止声明</p>
                      <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-warm-muted">
                        {item.copyPolicy.forbiddenClaims.map((text, i) => (
                          <li key={i}>{text}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </Section>
            ) : null}

            {/* prompt */}
            {item.prompt && (
              <Section
                icon={showPrompt ? Eye : Eye}
                title="Prompt"
                action={
                  <button
                    onClick={() => setShowPrompt(!showPrompt)}
                    className="text-xs text-warm-muted hover:text-warm-ink"
                  >
                    {showPrompt ? "收起" : "展开"}
                  </button>
                }
              >
                <button
                  onClick={handleCopyPrompt}
                  className="mb-2 flex items-center gap-1 text-xs text-warm-muted hover:text-warm-ink"
                >
                  <Copy className="h-3 w-3" />
                  {copiedPrompt ? "已复制" : "复制 prompt"}
                </button>
                {showPrompt && (
                  <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-warm-soft p-3 text-xs leading-relaxed text-warm-ink/80">
                    {item.prompt}
                  </pre>
                )}
              </Section>
            )}

            {/* actions */}
            <div className="mt-auto flex flex-wrap gap-2 border-t border-warm-line pt-4">
              {onDownload && (
                <ActionBtn icon={Download} label="下载" onClick={() => onDownload(item)} />
              )}
              {onEdit && item.url && (
                <ActionBtn icon={Wand2} label="让 Agent 改" onClick={() => onEdit(item)} />
              )}
              {onRetry && (
                <ActionBtn icon={RefreshCw} label="重做" onClick={() => onRetry(item)} />
              )}
              {onSaveAsAsset && (
                <ActionBtn icon={Save} label="存为资产" onClick={() => onSaveAsAsset(item)} />
              )}
              {onOpenFolder && (
                <ActionBtn icon={FolderOpen} label="打开文件夹" onClick={() => onOpenFolder(item)} />
              )}
              {item.url && (
                <ActionBtn
                  icon={ExternalLink}
                  label="看原图"
                  onClick={() => item.url && window.open(item.url, "_blank")}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function Section({
  icon: Icon,
  title,
  action,
  children,
  className,
}: {
  icon: React.ElementType;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warm-ink/50">
          <Icon className="h-3 w-3" />
          {title}
        </p>
        {action}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-warm-muted/60">{label}</dt>
      <dd className="truncate text-warm-ink/80">{value}</dd>
    </div>
  );
}

function ComparisonImage({
  label,
  src,
  alt,
  active,
}: {
  label: string;
  src: string;
  alt: string;
  active?: boolean;
}) {
  return (
    <div className="relative min-h-0 overflow-hidden rounded-lg border border-warm-line bg-warm-paper/80">
      <Image
        src={src}
        alt={alt}
        width={900}
        height={900}
        className="h-full w-full object-contain"
        unoptimized={src.startsWith("data:")}
      />
      <div
        className={cn(
          "absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs",
          active ? "bg-warm-primary text-warm-paper" : "bg-warm-ink/65 text-warm-paper"
        )}
      >
        {label}
      </div>
    </div>
  );
}

function ReferenceThumb({ reference }: { reference: ImageDetailReference }) {
  const [errored, setErrored] = useState(false);

  return (
    <div className="group relative flex-shrink-0 overflow-hidden rounded-md border border-warm-line bg-warm-soft">
      {reference.url && !errored ? (
        <Image
          src={reference.url}
          alt={reference.title}
          width={80}
          height={80}
          className="h-16 w-16 object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center text-warm-muted/30">
          <Eye className="h-5 w-5" />
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-warm-ink/70 px-1.5 py-0.5 text-[10px] text-warm-paper">
        {roleLabel(reference.role)}
      </div>
    </div>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-3 py-2 text-xs text-warm-muted transition hover:bg-warm-primary-soft hover:text-warm-ink"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function ReviewStatusButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition",
        active
          ? "border-warm-primary/40 bg-warm-primary-soft text-warm-primary"
          : "border-warm-line bg-warm-bg text-warm-muted hover:border-warm-primary/30 hover:text-warm-ink"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
