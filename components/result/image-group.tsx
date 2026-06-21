import { CheckCircle2, RefreshCw, Wand2, XCircle } from "lucide-react";
import { ImageCard } from "./image-card";
import type { GeneratedImage } from "@/lib/types";
import type { ImageDetailReviewStatus } from "./image-detail-panel";

interface ImageGroupProps {
  title: string;
  images: GeneratedImage[];
  onDownload: (image: GeneratedImage) => void;
  onRegenerate: (image: GeneratedImage) => void;
  onOpenFolder?: (image: GeneratedImage) => void;
  onPreview?: (image: GeneratedImage) => void;
  onEditGroup?: (images: GeneratedImage[]) => void;
  onSetGroupReviewStatus?: (
    images: GeneratedImage[],
    status: Exclude<ImageDetailReviewStatus, "failed">
  ) => void;
  getReviewLabel?: (image: GeneratedImage) => string | undefined;
  getCopyModeLabel?: (image: GeneratedImage) => string | undefined;
}

export function ImageGroup({
  title,
  images,
  onDownload,
  onRegenerate,
  onOpenFolder,
  onPreview,
  onEditGroup,
  onSetGroupReviewStatus,
  getReviewLabel,
  getCopyModeLabel,
}: ImageGroupProps) {
  if (images.length === 0) return null;

  return (
    <div aria-label={title}>
      {onSetGroupReviewStatus && (
        <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
          <GroupActionButton
            icon={CheckCircle2}
            label="保留这组"
            onClick={() => onSetGroupReviewStatus(images, "approved")}
          />
          <GroupActionButton
            icon={RefreshCw}
            label="标待重做"
            onClick={() => onSetGroupReviewStatus(images, "needs_redo")}
          />
          {onEditGroup && (
            <GroupActionButton
              icon={Wand2}
              label="调整这组"
              onClick={() => onEditGroup(images)}
            />
          )}
          <GroupActionButton
            icon={XCircle}
            label="淘汰这组"
            onClick={() => onSetGroupReviewStatus(images, "rejected")}
          />
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-5">
        {images.map((img) => (
          <ImageCard
            key={img.id}
            id={img.id}
            url={img.url}
            previewUrl={getImagePreviewUrl(img)}
            title={img.title || img.copyText || ""}
            copyText={img.copyText}
            type={img.type}
            errorMessage={img.error}
            errorCode={img.errorCode}
            onDownload={() => onDownload(img)}
            onRegenerate={() => onRegenerate(img)}
            onOpenFolder={onOpenFolder ? () => onOpenFolder(img) : undefined}
            onPreview={onPreview ? () => onPreview(img) : undefined}
            isPlaceholder={!!img.error}
            reviewLabel={getReviewLabel?.(img)}
            copyModeLabel={getCopyModeLabel?.(img)}
            ratio={getImageRatio(img)}
          />
        ))}
      </div>
    </div>
  );
}

function GroupActionButton({
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
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-warm-line bg-warm-paper px-2.5 py-1.5 text-xs text-warm-muted transition hover:border-warm-primary/35 hover:bg-warm-primary-soft hover:text-warm-ink"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function getImagePreviewUrl(image: GeneratedImage): string | undefined {
  const metadata = (image.metadata ?? {}) as Record<string, unknown>;
  const imageStorage = isRecord(metadata.imageStorage) ? metadata.imageStorage : undefined;
  const resultStorage = isRecord(metadata.resultStorage) ? metadata.resultStorage : undefined;
  return getString(metadata.thumbnailUrl) ||
    getString(imageStorage?.thumbnailUrl) ||
    getString(resultStorage?.thumbnailUrl) ||
    image.url;
}

function getImageRatio(image: GeneratedImage): string | undefined {
  const metadata = (image.metadata ?? {}) as Record<string, unknown>;
  const ratio =
    typeof metadata.ratio === "string"
      ? metadata.ratio
      : typeof metadata.exportSpecRatio === "string"
        ? metadata.exportSpecRatio
        : undefined;
  if (ratio) return ratio;
  const size =
    typeof metadata.size === "string"
      ? metadata.size
      : typeof metadata.outputSize === "string"
        ? metadata.outputSize
        : undefined;
  const match = size?.match(/^(\d+)x(\d+)$/i);
  return match ? `${match[1]}:${match[2]}` : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
