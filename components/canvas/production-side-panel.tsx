"use client";

import { useState, type ReactNode } from "react";
import {
  Archive,
  CheckCircle2,
  Download,
  Eye,
  FileDown,
  ImageIcon,
  Layers3,
  ListChecks,
  Loader2,
  PackageCheck,
  RefreshCw,
  X,
} from "lucide-react";
import { AssetPreview } from "@/components/canvas/asset-preview";
import { cn } from "@/lib/utils/cn";

export type ProductionPanelTab = "plan" | "results" | "export";
export type ProductionPanelState = "idle" | "working" | "ready" | "needs_review" | "failed";

export interface ProductionPlanItem {
  id: string;
  title: string;
  description?: string;
  detail?: string;
  state?: ProductionPanelState;
  chips?: string[];
}

export interface ProductionResultItem {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  imageAlt?: string;
  state?: ProductionPanelState;
  chips?: string[];
  onOpen?: () => void;
  onRetry?: () => void;
}

export interface ProductionExportItem {
  id: string;
  title: string;
  description?: string;
  state?: ProductionPanelState;
  format?: string;
  size?: string;
  onDownload?: () => void;
}

export interface ProductionSidePanelProps {
  title?: string;
  subtitle?: string;
  activeTab?: ProductionPanelTab;
  defaultTab?: ProductionPanelTab;
  summary?: {
    planCount?: number;
    resultCount?: number;
    exportCount?: number;
    message?: string;
  };
  planItems?: ProductionPlanItem[];
  resultItems?: ProductionResultItem[];
  exportItems?: ProductionExportItem[];
  busy?: boolean;
  emptyMessage?: string;
  onTabChange?: (tab: ProductionPanelTab) => void;
  onRefresh?: () => void;
  onClose?: () => void;
  onPrimaryAction?: () => void;
  primaryActionLabel?: string;
  footer?: ReactNode;
  className?: string;
}

const tabs: Array<{ id: ProductionPanelTab; label: string; icon: typeof ListChecks }> = [
  { id: "plan", label: "计划", icon: ListChecks },
  { id: "results", label: "结果", icon: ImageIcon },
  { id: "export", label: "交付", icon: PackageCheck },
];

const stateLabel: Record<ProductionPanelState, string> = {
  idle: "待处理",
  working: "处理中",
  ready: "已准备",
  needs_review: "待确认",
  failed: "需处理",
};

const stateClassName: Record<ProductionPanelState, string> = {
  idle: "bg-warm-line/25 text-warm-muted",
  working: "bg-warm-primary-soft text-warm-primary",
  ready: "bg-warm-sage/15 text-warm-sage",
  needs_review: "bg-warm-clay/15 text-warm-clay",
  failed: "bg-warm-clay/15 text-warm-clay",
};

export function ProductionSidePanel({
  title = "生产面板",
  subtitle = "查看计划、候选结果和交付文件",
  activeTab,
  defaultTab = "plan",
  summary,
  planItems = [],
  resultItems = [],
  exportItems = [],
  busy = false,
  emptyMessage = "暂无内容",
  onTabChange,
  onRefresh,
  onClose,
  onPrimaryAction,
  primaryActionLabel = "继续处理",
  footer,
  className,
}: ProductionSidePanelProps) {
  const [internalTab, setInternalTab] = useState<ProductionPanelTab>(defaultTab);
  const selectedTab = activeTab ?? internalTab;

  const handleTabChange = (tab: ProductionPanelTab) => {
    if (!activeTab) setInternalTab(tab);
    onTabChange?.(tab);
  };

  return (
    <aside className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-warm-paper text-warm-ink", className)}>
      <div className="border-b border-warm-line/50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-tight">{title}</h2>
            <p className="mt-1 text-xs leading-snug text-warm-muted">{subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onRefresh && (
              <button
                type="button"
                className="rounded-md p-1.5 text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink"
                onClick={onRefresh}
                title="刷新"
              >
                <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
              </button>
            )}
            {onClose && (
              <button
                type="button"
                className="rounded-md p-1.5 text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink"
                onClick={onClose}
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {onPrimaryAction && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md bg-warm-primary px-2.5 py-1.5 text-xs font-medium text-warm-paper transition hover:bg-warm-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
                disabled={busy}
                onClick={onPrimaryAction}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers3 className="h-3.5 w-3.5" />}
                {primaryActionLabel}
              </button>
            )}
          </div>
        </div>

        {(summary?.message || summary?.planCount || summary?.resultCount || summary?.exportCount) && (
          <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-lg border border-warm-line/50 bg-warm-bg p-1.5">
            <SummaryPill label="计划" value={summary.planCount ?? planItems.length} />
            <SummaryPill label="结果" value={summary.resultCount ?? resultItems.length} />
            <SummaryPill label="交付" value={summary.exportCount ?? exportItems.length} />
            {summary.message && (
              <div className="col-span-3 rounded-md bg-warm-paper px-2 py-1.5 text-xs leading-snug text-warm-muted">
                {summary.message}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1 border-b border-warm-line/50 p-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = selectedTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={cn(
                "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition",
                selected
                  ? "bg-warm-primary text-warm-paper shadow-sm"
                  : "text-warm-muted hover:bg-warm-soft hover:text-warm-ink"
              )}
              onClick={() => handleTabChange(tab.id)}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {selectedTab === "plan" && <PlanTab items={planItems} emptyMessage={emptyMessage} />}
        {selectedTab === "results" && <ResultsTab items={resultItems} emptyMessage={emptyMessage} />}
        {selectedTab === "export" && <ExportTab items={exportItems} emptyMessage={emptyMessage} />}
      </div>

      {footer && <div className="border-t border-warm-line/50 p-3">{footer}</div>}
    </aside>
  );
}

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-warm-paper px-2 py-1.5 text-center">
      <div className="text-sm font-semibold leading-none text-warm-ink">{value}</div>
      <div className="mt-1 text-[10px] leading-none text-warm-muted">{label}</div>
    </div>
  );
}

function PlanTab({ items, emptyMessage }: { items: ProductionPlanItem[]; emptyMessage: string }) {
  if (items.length === 0) return <EmptyPanel icon={ListChecks} message={emptyMessage} />;

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={item.id} className="rounded-lg border border-warm-line/60 bg-warm-bg p-3">
          <div className="flex items-start gap-2.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-warm-primary-soft text-xs font-semibold text-warm-primary">
              {index + 1}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 text-sm font-medium leading-tight text-warm-ink">{item.title}</h3>
                <StateBadge state={item.state ?? "idle"} />
              </div>
              {item.description && <p className="mt-1 text-xs leading-snug text-warm-muted">{item.description}</p>}
              {item.detail && <p className="mt-2 text-xs leading-snug text-warm-ink">{item.detail}</p>}
              <ChipList chips={item.chips} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultsTab({ items, emptyMessage }: { items: ProductionResultItem[]; emptyMessage: string }) {
  if (items.length === 0) return <EmptyPanel icon={ImageIcon} message={emptyMessage} />;

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="rounded-lg border border-warm-line/60 bg-warm-bg p-2.5">
          <div className="flex gap-3">
            <AssetPreview
              src={item.imageUrl}
              alt={item.imageAlt ?? item.title}
              icon={ImageIcon}
              size="wide"
              fit="contain"
              className="h-20 w-24"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 text-sm font-medium leading-tight text-warm-ink">{item.title}</h3>
                <StateBadge state={item.state ?? "ready"} />
              </div>
              {item.description && <p className="mt-1 line-clamp-2 text-xs leading-snug text-warm-muted">{item.description}</p>}
              <ChipList chips={item.chips} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {item.onOpen && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-warm-line bg-warm-paper px-2 py-1 text-[11px] font-medium text-warm-ink transition hover:bg-warm-soft"
                    onClick={item.onOpen}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    查看
                  </button>
                )}
                {item.onRetry && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink"
                    onClick={item.onRetry}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    重做
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExportTab({ items, emptyMessage }: { items: ProductionExportItem[]; emptyMessage: string }) {
  if (items.length === 0) return <EmptyPanel icon={PackageCheck} message={emptyMessage} />;

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="rounded-lg border border-warm-line/60 bg-warm-bg p-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-warm-primary-soft text-warm-primary">
              {item.state === "ready" ? <FileDown className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 text-sm font-medium leading-tight text-warm-ink">{item.title}</h3>
                <StateBadge state={item.state ?? "idle"} />
              </div>
              {item.description && <p className="mt-1 text-xs leading-snug text-warm-muted">{item.description}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {item.format && <span className="rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">{item.format}</span>}
                {item.size && <span className="rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">{item.size}</span>}
              </div>
              {item.onDownload && (
                <button
                  type="button"
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-warm-ink px-2.5 py-1.5 text-xs font-medium text-warm-paper transition hover:bg-warm-ink/90"
                  onClick={item.onDownload}
                >
                  <Download className="h-3.5 w-3.5" />
                  下载
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function StateBadge({ state }: { state: ProductionPanelState }) {
  return (
    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none", stateClassName[state])}>
      {state === "ready" && <CheckCircle2 className="mr-1 inline h-3 w-3 align-[-2px]" />}
      {stateLabel[state]}
    </span>
  );
}

function ChipList({ chips }: { chips?: string[] }) {
  if (!chips || chips.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span key={chip} className="max-w-full truncate rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">
          {chip}
        </span>
      ))}
    </div>
  );
}

function EmptyPanel({
  icon: Icon,
  message,
}: {
  icon: typeof ListChecks;
  message: string;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-warm-line bg-warm-bg px-4 py-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-warm-primary-soft text-warm-primary">
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm font-medium text-warm-ink">{message}</p>
      <p className="mt-1 max-w-56 text-xs leading-snug text-warm-muted">选择画布中的节点后，这里会显示可继续处理的内容。</p>
    </div>
  );
}
