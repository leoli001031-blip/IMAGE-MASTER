"use client";

import type { ComponentType, DragEvent, ReactNode } from "react";
import { GripVertical, ImageIcon, Pencil, Plus, Search, Sparkles, Star, Trash2 } from "lucide-react";
import { AssetPreview } from "@/components/canvas/asset-preview";
import { cn } from "@/lib/utils/cn";

export type AssetTrayItemState = "ready" | "draft" | "checking" | "needs_review";

export interface AssetTrayItem {
  id: string;
  title: string;
  description?: string;
  category?: string;
  status?: AssetTrayItemState;
  previewUrl?: string;
  previewAlt?: string;
  icon?: ComponentType<{ className?: string }>;
  chips?: string[];
  favorite?: boolean;
  canRename?: boolean;
  canFavorite?: boolean;
  canDelete?: boolean;
  dragData?: {
    type: string;
    value: string;
  };
}

export interface AssetTrayProps {
  title?: string;
  categories?: string[];
  activeCategory?: string;
  searchLabel?: string;
  items: AssetTrayItem[];
  selectedItemId?: string;
  message?: string;
  actionLabel?: string;
  secondaryActionLabel?: string;
  emptyMessage?: string;
  onCategoryChange?: (category: string) => void;
  onSelectItem?: (item: AssetTrayItem) => void;
  onAction?: () => void;
  onSecondaryAction?: () => void;
  onRenameItem?: (item: AssetTrayItem) => void;
  onToggleFavorite?: (item: AssetTrayItem) => void;
  onDeleteItem?: (item: AssetTrayItem) => void;
  onItemDragStart?: (item: AssetTrayItem, event: DragEvent<HTMLElement>) => void;
  footer?: ReactNode;
  compact?: boolean;
  showSearch?: boolean;
  className?: string;
}

const statusLabel: Record<AssetTrayItemState, string> = {
  ready: "已准备",
  draft: "草稿",
  checking: "确认中",
  needs_review: "待确认",
};

const statusClassName: Record<AssetTrayItemState, string> = {
  ready: "bg-warm-sage/15 text-warm-sage",
  draft: "bg-warm-line/25 text-warm-muted",
  checking: "bg-warm-primary-soft text-warm-primary",
  needs_review: "bg-warm-clay/15 text-warm-clay",
};

export function AssetTray({
  title = "资产托盘",
  categories = [],
  activeCategory,
  searchLabel = "搜索资产",
  items,
  selectedItemId,
  message,
  actionLabel,
  secondaryActionLabel,
  emptyMessage = "当前没有可用资产",
  onCategoryChange,
  onSelectItem,
  onAction,
  onSecondaryAction,
  onRenameItem,
  onToggleFavorite,
  onDeleteItem,
  onItemDragStart,
  footer,
  compact = false,
  showSearch = true,
  className,
}: AssetTrayProps) {
  return (
    <aside className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-warm-paper text-warm-ink", className)}>
      <div className="border-b border-warm-line/50 p-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 text-sm font-semibold leading-tight">{title}</h2>
          <div className="flex shrink-0 items-center gap-1">
            {secondaryActionLabel && (
              <button
                type="button"
                className="rounded-md p-1.5 text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink"
                onClick={onSecondaryAction}
                title={secondaryActionLabel}
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
            {actionLabel && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md bg-warm-primary px-2.5 py-1.5 text-xs font-medium text-warm-paper transition hover:bg-warm-primary/90"
                onClick={onAction}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {actionLabel}
              </button>
            )}
          </div>
        </div>
        {showSearch && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-warm-line/50 bg-warm-bg px-2.5 py-2">
            <Search className="h-3.5 w-3.5 text-warm-muted" />
            <span className="text-xs text-warm-muted/70">{searchLabel}</span>
          </div>
        )}
        {message && (
          <div className="mt-2 rounded-md bg-warm-primary-soft px-2.5 py-2 text-xs leading-snug text-warm-primary">
            {message}
          </div>
        )}
      </div>

      {categories.length > 0 && (
        <div className="flex gap-1 overflow-x-auto border-b border-warm-line/50 p-2">
          {categories.map((category) => {
            const selected = category === activeCategory;
            return (
              <button
                key={category}
                type="button"
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition",
                  selected
                    ? "bg-warm-primary text-warm-paper shadow-sm"
                    : "text-warm-muted hover:bg-warm-soft hover:text-warm-ink"
                )}
                onClick={() => onCategoryChange?.(category)}
              >
                {category}
              </button>
            );
          })}
        </div>
      )}

      <div className={cn("min-h-0 flex-1 overflow-auto p-2.5", compact ? "space-y-1.5" : "space-y-2")}>
        {items.map((item) => (
          <AssetTrayCard
            key={item.id}
            item={item}
            selected={item.id === selectedItemId}
            onSelect={onSelectItem}
            onRename={onRenameItem}
            onToggleFavorite={onToggleFavorite}
            onDelete={onDeleteItem}
            onItemDragStart={onItemDragStart}
            compact={compact}
          />
        ))}
        {items.length === 0 && (
          <div className="rounded-md border border-dashed border-warm-line bg-warm-bg px-3 py-4 text-center">
            <div className="text-xs leading-snug text-warm-muted">{emptyMessage}</div>
            {(secondaryActionLabel || actionLabel) && (
              <div className="mt-3 grid gap-2">
                {secondaryActionLabel && (
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border border-warm-line/60 bg-warm-paper px-2.5 py-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary"
                    onClick={onSecondaryAction}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {secondaryActionLabel}
                  </button>
                )}
                {actionLabel && (
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-1.5 rounded-md bg-warm-primary px-2.5 py-2 text-xs font-medium text-warm-paper transition hover:bg-warm-primary/90"
                    onClick={onAction}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {actionLabel}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {footer && <div className="max-h-[56%] overflow-auto border-t border-warm-line/50 p-2">{footer}</div>}
    </aside>
  );
}

export function AssetTrayCard({
  item,
  selected = false,
  onSelect,
  onRename,
  onToggleFavorite,
  onDelete,
  onItemDragStart,
  compact = false,
  className,
}: {
  item: AssetTrayItem;
  selected?: boolean;
  onSelect?: (item: AssetTrayItem) => void;
  onRename?: (item: AssetTrayItem) => void;
  onToggleFavorite?: (item: AssetTrayItem) => void;
  onDelete?: (item: AssetTrayItem) => void;
  onItemDragStart?: (item: AssetTrayItem, event: DragEvent<HTMLElement>) => void;
  compact?: boolean;
  className?: string;
}) {
  const Icon = item.icon ?? ImageIcon;
  const status = item.status ?? "draft";

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    if (item.dragData) {
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(item.dragData.type, item.dragData.value);
    }
    onItemDragStart?.(item, event);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={Boolean(item.dragData || onItemDragStart)}
      className={cn(
        "group w-full rounded-md border bg-warm-paper text-left transition hover:border-warm-primary/30 hover:bg-warm-soft/45",
        compact ? "p-2" : "p-3",
        selected ? "border-warm-primary/45 ring-2 ring-warm-primary/15" : "border-warm-line/50",
        className
      )}
      onClick={() => onSelect?.(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.(item);
        }
      }}
      onDragStart={handleDragStart}
    >
      <div className={cn("flex items-start", compact ? "gap-2" : "gap-3")}>
        <AssetPreview
          src={item.previewUrl}
          alt={item.previewAlt ?? item.title}
          icon={Icon}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className={cn("truncate font-medium leading-tight text-warm-ink", compact ? "text-xs" : "text-sm")}>
                {item.title}
              </h3>
              {item.category && <div className="mt-1 text-[10px] leading-none text-warm-muted">{item.category}</div>}
            </div>
            {(item.canFavorite || item.canRename || item.canDelete) && (
              <span className="flex shrink-0 items-center gap-0.5">
                {item.canFavorite && (
                  <button
                    type="button"
                    className={cn(
                      "rounded p-1 transition hover:bg-warm-bg",
                      item.favorite ? "text-warm-primary" : "text-warm-muted"
                    )}
                    title={item.favorite ? "取消收藏" : "收藏"}
                    aria-label={item.favorite ? "取消收藏" : "收藏"}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleFavorite?.(item);
                    }}
                  >
                    <Star className={cn("h-3.5 w-3.5", item.favorite && "fill-current")} />
                  </button>
                )}
                {item.canRename && (
                  <button
                    type="button"
                    className="rounded p-1 text-warm-muted transition hover:bg-warm-bg hover:text-warm-ink"
                    title="重命名"
                    aria-label="重命名"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRename?.(item);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                {item.canDelete && (
                  <button
                    type="button"
                    className="rounded p-1 text-warm-muted transition hover:bg-red-50 hover:text-red-600"
                    title="删除"
                    aria-label="删除"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete?.(item);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            )}
            {compact ? (
              <span
                className="shrink-0 rounded border border-warm-line/60 bg-warm-bg px-1.5 py-1 text-warm-muted transition group-hover:border-warm-primary/30 group-hover:text-warm-primary"
                title="拖入生成框"
                aria-hidden
              >
                <GripVertical className="h-3.5 w-3.5" />
              </span>
            ) : (
              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none", statusClassName[status])}>
                {statusLabel[status]}
              </span>
            )}
          </div>
          {compact && (
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none", statusClassName[status])}>
                {status === "ready" ? "可用" : statusLabel[status]}
              </span>
              <span className="truncate text-[10px] leading-none text-warm-muted/75">
                拖入生成框
              </span>
            </div>
          )}
          {!compact && item.description && <p className="mt-1 line-clamp-2 text-xs leading-snug text-warm-muted">{item.description}</p>}
          {!compact && item.chips && item.chips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.chips.map((chip) => (
                <span key={chip} className="max-w-full truncate rounded bg-warm-bg px-1.5 py-0.5 text-[10px] text-warm-muted">
                  {chip}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
