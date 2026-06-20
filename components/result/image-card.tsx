"use client";

import { useState, type CSSProperties } from "react";
import { AlertTriangle, Download, Eye, FolderOpen, RefreshCw, Star } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import Image from "next/image";
import type { ImageDetailItem } from "./image-detail-panel";

interface ImageCardProps {
  id: string;
  url: string;
  previewUrl?: string;
  title: string;
  copyText: string;
  type: string;
  errorMessage?: string;
  errorCode?: string;
  onDownload?: () => void;
  onRegenerate?: () => void;
  onPreview?: () => void;
  onOpenFolder?: () => void;
  onFavorite?: () => void;
  isPlaceholder?: boolean;
  reviewLabel?: string;
  copyModeLabel?: string;
  ratio?: string;
  /** Data for the detail panel — not displayed on the card. */
  detailData?: Partial<ImageDetailItem>;
  isFavorite?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  main: "主图",
  selling_point: "卖点图",
  detail: "详情图",
  model: "模特图",
  scene: "场景图",
  poster: "海报",
  copy: "文案图层",
};

const STATUS_LABELS: Record<string, string> = {
  done: "已完成",
  completed: "已完成",
  running: "生成中",
  queued: "排队中",
  pending: "等待中",
  failed: "失败",
  cancelled: "已取消",
};

export function ImageCard({
  id,
  url,
  previewUrl,
  title,
  copyText,
  type,
  errorMessage,
  errorCode,
  onDownload,
  onRegenerate,
  onPreview,
  onOpenFolder,
  onFavorite,
  isPlaceholder,
  reviewLabel,
  copyModeLabel,
  ratio,
  detailData: _detailData,
  isFavorite,
}: ImageCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const previewStyle: CSSProperties = {
    aspectRatio: normalizeImageAspectRatio(ratio),
  };
  const imagePreviewUrl = previewUrl || url;
  const statusLabel = _detailData?.status
    ? STATUS_LABELS[_detailData.status] || _detailData.status
    : undefined;

  return (
    <div className="group overflow-hidden rounded-lg border border-transparent bg-transparent transition hover:border-warm-line/50">
      <button
        type="button"
        onClick={onPreview}
        disabled={!onPreview}
        className="relative block w-full overflow-hidden rounded-md bg-warm-soft text-left disabled:cursor-default"
        style={previewStyle}
        aria-label={onPreview ? `查看 ${title} 的生成详情` : undefined}
      >
        {imagePreviewUrl && !error ? (
          <>
            {!loaded && <ImageSkeleton />}
            <Image
              src={imagePreviewUrl}
              alt={title}
              fill
              loading="lazy"
              sizes="(min-width: 1024px) 320px, 50vw"
              unoptimized={imagePreviewUrl.startsWith("data:")}
              className={cn(
                "object-contain p-1 transition-opacity duration-300",
                loaded ? "opacity-100" : "opacity-0"
              )}
              onLoad={() => setLoaded(true)}
              onError={() => setError(true)}
            />
          </>
        ) : (
          <ImagePlaceholder
            type={type}
            isPlaceholder={isPlaceholder}
            errorMessage={errorMessage}
            errorCode={errorCode}
          />
        )}

        <div className="absolute top-2 left-2">
          <span className="rounded-full bg-warm-primary/80 px-2 py-0.5 text-[10px] text-warm-paper">
            {TYPE_LABELS[type] || type}
          </span>
        </div>
        {onPreview && (
          <div className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-warm-ink/70 px-2 py-1 text-[10px] text-warm-paper opacity-0 transition group-hover:opacity-100">
            <Eye className="h-3 w-3" />
            详情
          </div>
        )}
      </button>

      <div className="space-y-2 px-1 py-2">
        <div>
          <p className="text-sm font-medium text-warm-ink line-clamp-1">{title}</p>
          {errorMessage && (
            <p className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-warm-clay">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="line-clamp-2">{errorMessage}</span>
            </p>
          )}
          {copyText && (
            <p className="text-xs text-warm-muted/70 mt-0.5 line-clamp-2">{copyText}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {reviewLabel && (
              <span className="rounded-full bg-warm-primary-soft px-2 py-0.5 text-[10px] text-warm-primary">
                {reviewLabel}
              </span>
            )}
            {copyModeLabel && (
              <span className="rounded-full bg-warm-soft px-2 py-0.5 text-[10px] text-warm-muted">
                {copyModeLabel}
              </span>
            )}
            {statusLabel && (
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[10px]",
                _detailData?.status === "failed" || _detailData?.status === "cancelled"
                  ? "bg-red-50 text-red-600"
                  : _detailData?.status === "running" || _detailData?.status === "queued" || _detailData?.status === "pending"
                    ? "bg-blue-50 text-blue-600"
                    : "bg-emerald-50 text-emerald-600"
              )}>
                {statusLabel}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {url && !error && onPreview && (
            <ActionButton icon={Eye} label="详情" onClick={onPreview} />
          )}
          {url && !error && (
            <ActionButton icon={Download} label="下载" onClick={onDownload} />
          )}
          <ActionButton
            icon={RefreshCw}
            label={errorMessage ? "重试此项" : "重试"}
            onClick={onRegenerate}
            disabled={!onRegenerate}
          />
          {onOpenFolder && (
            <ActionButton icon={FolderOpen} label="打开" onClick={onOpenFolder} />
          )}
          {onFavorite !== undefined && (
            <ActionButton
              icon={Star}
              label=""
              onClick={onFavorite}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function normalizeImageAspectRatio(ratio: string | undefined): string {
  if (!ratio) return "1 / 1";
  const match = ratio.trim().match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (!match) return "1 / 1";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "1 / 1";
  }
  return `${width} / ${height}`;
}

function ImageSkeleton() {
  return (
    <div className="absolute inset-0 bg-warm-soft animate-pulse flex items-center justify-center">
      <div className="w-10 h-10 rounded-full bg-warm-line/50" />
    </div>
  );
}

function ImagePlaceholder({
  type,
  isPlaceholder,
  errorMessage,
  errorCode,
}: {
  type: string;
  isPlaceholder?: boolean;
  errorMessage?: string;
  errorCode?: string;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center text-warm-muted/50">
      {isPlaceholder ? (
        <AlertTriangle className="mb-2 h-5 w-5 text-warm-clay" />
      ) : null}
      <p className="text-xs text-warm-ink/70">{isPlaceholder ? "生成失败" : "等待中"}</p>
      <p className="mt-1 text-[10px]">{errorCode || TYPE_LABELS[type] || type}</p>
      {errorMessage && <p className="mt-2 line-clamp-2 text-[10px] leading-4">{errorMessage}</p>}
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ElementType;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition-colors",
        "text-warm-muted hover:bg-warm-primary-soft hover:text-warm-ink",
        "disabled:opacity-30 disabled:cursor-not-allowed"
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}
