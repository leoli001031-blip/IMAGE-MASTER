"use client";

import { Loader2, Check } from "lucide-react";
import { useGenerateStore } from "@/lib/store/generate-store";
import { cn } from "@/lib/utils/cn";
import { StatusBean } from "../ui/status-bean";

const STEPS = [
  { key: "analyzing", label: "分析产品" },
  { key: "planning", label: "规划图组" },
  { key: "generating", label: "生成图片" },
] as const;

export function ProgressCard() {
  const status = useGenerateStore((s) => s.status);

  const currentStep = STEPS.findIndex((s) => s.key === status);
  const isDone = status === "done";

  if (isDone) {
    return (
      <div className="w-full max-w-sm bg-warm-paper rounded-2xl p-8 border border-warm-line/10 shadow-[0_4px_20px_-4px_rgba(47,39,34,0.05)] text-center space-y-6">
        <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-warm-sage/20">
          <Check className="h-6 w-6 text-warm-sage" strokeWidth={3} />
        </div>
        <div className="space-y-1">
          <p className="text-lg font-serif font-medium text-warm-ink">任务完成</p>
          <p className="text-xs text-warm-muted uppercase tracking-widest opacity-50">Success</p>
        </div>
        <StatusBean type="completed" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm bg-warm-paper rounded-2xl p-8 border border-warm-line/10 shadow-[0_4px_20px_-4px_rgba(47,39,34,0.05)] space-y-8">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-xl font-serif font-medium text-warm-ink">正在创作</p>
          <p className="text-xs text-warm-muted uppercase tracking-widest opacity-50">Processing</p>
        </div>
        <Loader2 className="h-5 w-5 animate-spin text-warm-primary/60" />
      </div>

      <div className="space-y-4">
        {STEPS.map((step, i) => {
          const done = i < currentStep;
          const current = i === currentStep;
          const pending = i > currentStep;

          return (
            <div
              key={step.key}
              className={cn(
                "flex items-center gap-4 transition-all duration-500",
                pending && "opacity-20 grayscale"
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors border",
                  done && "bg-warm-sage border-warm-sage text-warm-paper",
                  current && "bg-warm-primary border-warm-primary text-warm-paper shadow-lg shadow-warm-primary/20",
                  pending && "bg-warm-soft border-warm-line text-warm-muted/40"
                )}
              >
                {done ? (
                  <Check className="h-4 w-4" strokeWidth={3} />
                ) : current ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  i + 1
                )}
              </div>
              <div className="flex-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    current ? "text-warm-ink" : "text-warm-muted",
                    done && "text-warm-sage"
                  )}
                >
                  {step.label}
                </p>
                {current && (
                  <p className="text-[10px] text-warm-primary/60 mt-0.5 font-medium animate-pulse">正在处理中...</p>
                )}
              </div>
              {done && <StatusBean type="completed" label="OK" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
