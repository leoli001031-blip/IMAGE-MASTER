import { ReactNode } from "react";
import { StatusBean, type StatusType } from "./status-bean";
import { cn } from "@/lib/utils/cn";

interface JobCardProps {
  title: string;
  status?: StatusType;
  statusLabel?: string;
  conclusion?: string;
  primaryAction?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function JobCard({
  title,
  status,
  statusLabel,
  conclusion,
  primaryAction,
  children,
  className,
}: JobCardProps) {
  return (
    <div className={cn(
      "bg-warm-paper rounded-2xl p-6 border border-warm-line/10 shadow-[0_4px_20px_-4px_rgba(47,39,34,0.05)]",
      className
    )}>
      <div className="flex items-start justify-between gap-6 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-xl font-serif font-medium text-warm-ink truncate tracking-tight">{title}</h3>
            {status && <StatusBean type={status} label={statusLabel} />}
          </div>
          {conclusion && (
            <p className="text-sm text-warm-muted/80 leading-relaxed font-medium">{conclusion}</p>
          )}
        </div>
        {primaryAction && (
          <div className="flex-shrink-0 pt-1">
            {primaryAction}
          </div>
        )}
      </div>
      {children && (
        <div className="mt-6 pt-6 border-t border-warm-line/5">
          {children}
        </div>
      )}
    </div>
  );
}
