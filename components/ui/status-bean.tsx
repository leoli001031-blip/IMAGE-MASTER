import { cn } from "@/lib/utils/cn";

export type StatusType = "processing" | "continuable" | "confirm" | "completed" | "failed" | "retry" | "pending" | "saved"

interface StatusBeanProps {
  type: StatusType;
  label?: string;
  className?: string;
}

const statusConfig: Record<StatusType, { bg: string; text: string; label: string }> = {
  processing: { bg: "bg-warm-primary-soft", text: "text-warm-primary", label: "分析中" },
  continuable: { bg: "bg-warm-sage/15", text: "text-warm-sage", label: "可继续" },
  confirm: { bg: "bg-warm-clay/15", text: "text-warm-clay", label: "需确认" },
  completed: { bg: "bg-warm-sage/15", text: "text-warm-sage", label: "已完成" },
  failed: { bg: "bg-warm-clay/15", text: "text-warm-clay", label: "有问题" },
  retry: { bg: "bg-warm-clay/15", text: "text-warm-clay", label: "可重试" },
  pending: { bg: "bg-warm-line/20", text: "text-warm-muted", label: "等待中" },
  saved: { bg: "bg-warm-sage/15", text: "text-warm-sage", label: "已保存" },
}

export function StatusBean({ type, label, className }: StatusBeanProps) {
  const config = statusConfig[type] || statusConfig.pending;
  return (
    <span className={cn(
      "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none",
      config.bg,
      config.text,
      className
    )}>
      {label || config.label}
    </span>
  );
}
