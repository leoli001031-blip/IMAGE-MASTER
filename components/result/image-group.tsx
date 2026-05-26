import { ImageCard } from "./image-card";
import type { GeneratedImage } from "@/lib/types";

interface ImageGroupProps {
  title: string;
  images: GeneratedImage[];
  onDownload: (image: GeneratedImage) => void;
  onRegenerate: (image: GeneratedImage) => void;
  onPreview?: (image: GeneratedImage) => void;
  getReviewLabel?: (image: GeneratedImage) => string | undefined;
  getCopyModeLabel?: (image: GeneratedImage) => string | undefined;
}

export function ImageGroup({
  title,
  images,
  onDownload,
  onRegenerate,
  onPreview,
  getReviewLabel,
  getCopyModeLabel,
}: ImageGroupProps) {
  if (images.length === 0) return null;

  return (
    <div>
      <h3 className="text-sm font-medium text-warm-muted mb-3">{title}</h3>
      <div className="grid grid-cols-2 gap-3">
        {images.map((img) => (
          <ImageCard
            key={img.id}
            id={img.id}
            url={img.url}
            title={img.title || img.copyText || ""}
            copyText={img.copyText}
            type={img.type}
            errorMessage={img.error}
            errorCode={img.errorCode}
            onDownload={() => onDownload(img)}
            onRegenerate={() => onRegenerate(img)}
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
