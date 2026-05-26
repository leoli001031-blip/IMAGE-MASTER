"use client";

import type { ComponentType, ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ImagePlus,
  Layers3,
  Loader2,
  Lock,
  Plus,
  Sparkles,
} from "lucide-react";
import { AssetPreview } from "@/components/canvas/asset-preview";
import { cn } from "@/lib/utils/cn";

export type GenerationFrameSlotTone =
  | "product"
  | "model"
  | "scene"
  | "style"
  | "output"
  | "review"
  | "neutral";

export type GenerationFrameSlotState =
  | "empty"
  | "ready"
  | "running"
  | "needs_review"
  | "completed"
  | "failed";

export interface GenerationFrameSlot {
  id: string;
  title: string;
  description?: string;
  previewUrl?: string;
  previewAlt?: string;
  badge?: string;
  required?: boolean;
  locked?: boolean;
  tone?: GenerationFrameSlotTone;
  state?: GenerationFrameSlotState;
  icon?: ComponentType<{ className?: string }>;
  actionLabel?: string;
  onAction?: () => void;
}

export interface GenerationFrameWorkspaceProps {
  title?: string;
  subtitle?: string;
  promptLabel?: string;
  prompt?: string;
  promptPlaceholder?: string;
  editablePrompt?: boolean;
  slots: GenerationFrameSlot[];
  resultSlot?: GenerationFrameSlot;
  isWorking?: boolean;
  message?: string;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
  onPromptChange?: (value: string) => void;
  onPrimaryAction?: () => void;
  onSecondaryAction?: () => void;
  footer?: ReactNode;
  className?: string;
}

const slotToneClassName: Record<
  GenerationFrameSlotTone,
  {
    rail: string;
    badge: string;
    icon: string;
  }
> = {
  product: {
    rail: "bg-[#7A553C]",
    badge: "border-[#D7BFA4] bg-[#F4E9DE] text-[#5F422F]",
    icon: "bg-[#F4E9DE] text-[#7A553C]",
  },
  model: {
    rail: "bg-[#7562B8]",
    badge: "border-[#CBC4EA] bg-[#F0EDFA] text-[#5B4A98]",
    icon: "bg-[#F0EDFA] text-[#7562B8]",
  },
  scene: {
    rail: "bg-[#2E6F95]",
    badge: "border-[#BBD1DF] bg-[#E8F2F7] text-[#255A78]",
    icon: "bg-[#E8F2F7] text-[#2E6F95]",
  },
  style: {
    rail: "bg-[#2F7D7E]",
    badge: "border-[#B9D7D4] bg-[#E7F3F1] text-[#255F60]",
    icon: "bg-[#E7F3F1] text-[#2F7D7E]",
  },
  output: {
    rail: "bg-[#6F8F5E]",
    badge: "border-[#C6D7BA] bg-[#EEF6E9] text-[#526B45]",
    icon: "bg-[#EEF6E9] text-[#6F8F5E]",
  },
  review: {
    rail: "bg-[#9B4D5F]",
    badge: "border-[#DDBBC3] bg-[#F8E9ED] text-[#753A49]",
    icon: "bg-[#F8E9ED] text-[#9B4D5F]",
  },
  neutral: {
    rail: "bg-warm-line",
    badge: "border-warm-line bg-warm-bg text-warm-muted",
    icon: "bg-warm-bg text-warm-muted",
  },
};

const stateLabel: Record<GenerationFrameSlotState, string> = {
  empty: "待补充",
  ready: "已准备",
  running: "生成中",
  needs_review: "待确认",
  completed: "已完成",
  failed: "需处理",
};

const stateClassName: Record<GenerationFrameSlotState, string> = {
  empty: "bg-warm-line/25 text-warm-muted",
  ready: "bg-warm-primary-soft text-warm-primary",
  running: "bg-warm-primary-soft text-warm-primary",
  needs_review: "bg-warm-clay/15 text-warm-clay",
  completed: "bg-warm-sage/15 text-warm-sage",
  failed: "bg-warm-clay/15 text-warm-clay",
};

export function GenerationFrameWorkspace({
  title = "生成框",
  subtitle = "把参考、要求和结果放在同一个框里确认",
  promptLabel = "本次画面要求",
  prompt = "",
  promptPlaceholder = "写下想要的画面，比如：模特自然站姿，商品颜色准确，背景保持干净。",
  editablePrompt = true,
  slots,
  resultSlot,
  isWorking = false,
  message,
  primaryActionLabel = "开始生成",
  secondaryActionLabel,
  onPromptChange,
  onPrimaryAction,
  onSecondaryAction,
  footer,
  className,
}: GenerationFrameWorkspaceProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-warm-line/60 bg-warm-paper text-warm-ink shadow-sm",
        className
      )}
    >
      <div className="border-b border-warm-line/50 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-tight">{title}</h2>
            <p className="mt-1 text-xs leading-snug text-warm-muted">{subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {secondaryActionLabel && (
              <button
                type="button"
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink"
                onClick={onSecondaryAction}
              >
                {secondaryActionLabel}
              </button>
            )}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-warm-primary px-3 py-1.5 text-xs font-medium text-warm-paper transition hover:bg-warm-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={isWorking}
              onClick={onPrimaryAction}
            >
              {isWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {primaryActionLabel}
            </button>
          </div>
        </div>
        {message && (
          <div className="mt-2 rounded-md bg-warm-primary-soft px-2.5 py-2 text-xs leading-snug text-warm-primary">
            {message}
          </div>
        )}
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)]">
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-warm-muted" htmlFor="generation-frame-prompt">
              {promptLabel}
            </label>
            {editablePrompt ? (
              <textarea
                id="generation-frame-prompt"
                value={prompt}
                rows={3}
                placeholder={promptPlaceholder}
                className="mt-1.5 w-full resize-none rounded-md border border-warm-line/70 bg-warm-bg px-3 py-2 text-sm leading-relaxed text-warm-ink outline-none transition placeholder:text-warm-muted/60 focus:border-warm-primary"
                onChange={(event) => onPromptChange?.(event.target.value)}
              />
            ) : (
              <div className="mt-1.5 min-h-20 rounded-md border border-warm-line/70 bg-warm-bg px-3 py-2 text-sm leading-relaxed text-warm-ink">
                {prompt || "暂未填写画面要求"}
              </div>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {slots.map((slot) => (
              <GenerationFrameSlotCard key={slot.id} slot={slot} />
            ))}
          </div>
        </div>

        <div className="min-h-0">
          {resultSlot ? (
            <GenerationFrameSlotCard slot={{ tone: "output", ...resultSlot }} featured />
          ) : (
            <div className="flex h-full min-h-52 flex-col items-center justify-center rounded-lg border border-dashed border-warm-line bg-warm-bg px-4 py-6 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-warm-primary-soft text-warm-primary">
                <ImagePlus className="h-5 w-5" />
              </div>
              <div className="mt-3 text-sm font-medium text-warm-ink">结果会出现在这里</div>
              <p className="mt-1 max-w-56 text-xs leading-snug text-warm-muted">
                参考和要求确认后，就可以生成候选画面。
              </p>
            </div>
          )}
        </div>
      </div>

      {footer && <div className="border-t border-warm-line/50 px-4 py-3">{footer}</div>}
    </section>
  );
}

export function GenerationFrameSlotCard({
  slot,
  featured = false,
  className,
}: {
  slot: GenerationFrameSlot;
  featured?: boolean;
  className?: string;
}) {
  const tone = slot.tone ?? "neutral";
  const toneClassName = slotToneClassName[tone];
  const state = slot.state ?? (slot.previewUrl ? "ready" : "empty");
  const Icon = slot.icon ?? Layers3;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-warm-line/60 bg-warm-bg",
        featured && "h-full min-h-52",
        className
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-2 left-0 w-1 rounded-r", toneClassName.rail)} />
      <div className={cn("flex gap-3 p-3", featured && "flex-col")}>
        {slot.previewUrl ? (
          <AssetPreview
            src={slot.previewUrl}
            alt={slot.previewAlt ?? slot.title}
            icon={Icon}
            size={featured ? "canvasResult" : "md"}
            className={featured ? "rounded-md" : undefined}
          />
        ) : (
          <div
            className={cn(
              "flex shrink-0 items-center justify-center rounded-md border border-warm-line/60",
              featured ? "h-48 w-full" : "h-16 w-16",
              toneClassName.icon
            )}
          >
            <Icon className={featured ? "h-6 w-6" : "h-4 w-4"} />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <h3 className="truncate text-sm font-medium leading-tight text-warm-ink">{slot.title}</h3>
                {slot.locked && <Lock className="h-3.5 w-3.5 shrink-0 text-warm-muted" />}
              </div>
              {slot.description && (
                <p className="mt-1 line-clamp-2 text-xs leading-snug text-warm-muted">{slot.description}</p>
              )}
            </div>
            <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none", stateClassName[state])}>
              {stateLabel[state]}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {slot.required && (
              <span className="inline-flex items-center gap-1 rounded border border-warm-clay/25 bg-warm-clay/10 px-1.5 py-0.5 text-[10px] leading-none text-warm-clay">
                <AlertCircle className="h-3 w-3" />
                必填
              </span>
            )}
            {slot.badge && (
              <span className={cn("rounded border px-1.5 py-0.5 text-[10px] leading-none", toneClassName.badge)}>
                {slot.badge}
              </span>
            )}
            {state === "completed" && (
              <span className="inline-flex items-center gap-1 rounded bg-warm-sage/15 px-1.5 py-0.5 text-[10px] leading-none text-warm-sage">
                <CheckCircle2 className="h-3 w-3" />
                可用
              </span>
            )}
          </div>

          {slot.actionLabel && (
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-warm-line bg-warm-paper px-2.5 py-1.5 text-xs font-medium text-warm-ink transition hover:border-warm-primary/35 hover:bg-warm-soft disabled:cursor-not-allowed disabled:opacity-45"
              disabled={slot.locked}
              onClick={slot.onAction}
            >
              <Plus className="h-3.5 w-3.5" />
              {slot.actionLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
