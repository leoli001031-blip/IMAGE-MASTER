import { ImageCard } from "./image-card";
import type { GeneratedImage } from "@/lib/types";

interface ImageGroupProps {
  title: string;
  images: GeneratedImage[];
  onDownload: (image: GeneratedImage) => void;
  onRegenerate: (image: GeneratedImage) => void;
  onOpenFolder?: (image: GeneratedImage) => void;
  onPreview?: (image: GeneratedImage) => void;
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
  getReviewLabel,
  getCopyModeLabel,
}: ImageGroupProps) {
  if (images.length === 0) return null;

  return (
    <div aria-label={title}>
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
