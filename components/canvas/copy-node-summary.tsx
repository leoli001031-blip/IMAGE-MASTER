import { FileText } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { getCanvasNodeCopyBriefSummary } from "@/lib/canvas/copy-brief-summary";
import type { CanvasNodeData } from "@/lib/canvas/workbench-data";

export interface CopyNodeSummaryProps {
  data: CanvasNodeData;
  statusText: string;
  kindText: string;
  badgeClassName: string;
  dotClassName: string;
}

export function CopyNodeSummary({
  data,
  statusText,
  kindText,
  badgeClassName,
  dotClassName,
}: CopyNodeSummaryProps) {
  const summary = getCanvasNodeCopyBriefSummary(data);

  return (
    <div className="p-3 pl-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] leading-none",
                badgeClassName
              )}
              title="语义类型：文案"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", dotClassName)} />
              文案
            </span>
            <span className="rounded bg-warm-line/30 px-1.5 py-0.5 text-[10px] leading-none text-warm-muted">
              {statusText}
            </span>
            <span className="rounded bg-warm-bg px-1.5 py-0.5 text-[10px] leading-none text-warm-muted">
              {kindText}
            </span>
          </div>
          <h3 className="line-clamp-2 text-sm font-medium leading-tight text-warm-ink">
            {data.label}
          </h3>
        </div>
        <span className="shrink-0 rounded-md bg-warm-bg p-1 text-warm-muted">
          <FileText className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-warm-muted">
        {summary.preview}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {summary.sections.map((section) => (
          <div
            key={section.id}
            className={cn(
              "min-h-[48px] rounded-md border px-2 py-1.5",
              section.count > 0
                ? "border-warm-line bg-warm-bg/75"
                : "border-warm-line/60 bg-warm-bg/35"
            )}
            title={section.items.join("\n") || `${section.label}暂无内容`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-medium text-warm-muted">
                {section.label}
              </span>
              <span className="text-[10px] text-warm-muted/70">{section.count}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-warm-ink">
              {section.preview || "未填"}
            </p>
          </div>
        ))}
      </div>
      {summary.totalItemCount > 0 && (
        <div className="mt-2 text-[10px] text-warm-muted">
          已拆解 {summary.filledSectionCount} 类 · {summary.totalItemCount} 条
        </div>
      )}
    </div>
  );
}
