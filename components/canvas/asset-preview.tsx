"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface AssetPreviewProps {
  src?: string;
  alt: string;
  icon?: ComponentType<{ className?: string }>;
  size?: "sm" | "md" | "lg" | "wide" | "node" | "nodeTall" | "canvasImage" | "canvasResult" | "canvasResultAuto" | "inspectorHero";
  fit?: "cover" | "contain";
  className?: string;
  eager?: boolean;
  aspectRatio?: number;
}

const sizeClass = {
  sm: "h-12 w-12",
  md: "h-16 w-16",
  lg: "h-28 w-full",
  wide: "h-20 w-full",
  node: "h-32 w-full",
  nodeTall: "h-44 w-full",
  canvasImage: "h-48 w-full",
  canvasResult: "h-60 w-full",
  canvasResultAuto: "w-full",
  inspectorHero: "h-36 w-full",
};

export function AssetPreview({
  src,
  alt,
  icon: Icon = ImageOff,
  size = "md",
  fit = "cover",
  className,
  eager = false,
  aspectRatio,
}: AssetPreviewProps) {
  const [failed, setFailed] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(eager);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setFailed(false);
    setShouldLoad(eager);
  }, [eager, src]);

  useEffect(() => {
    if (!src || eager || shouldLoad) return;
    const node = rootRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "280px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [eager, shouldLoad, src]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative shrink-0 overflow-hidden rounded-md border border-warm-line/50 bg-warm-bg",
        sizeClass[size],
        className
      )}
      style={aspectRatio ? { aspectRatio } : undefined}
    >
      {src && shouldLoad && !failed ? (
        <img
          src={src}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={eager ? "high" : "low"}
          className={cn(
            "h-full w-full",
            fit === "contain"
              ? size === "canvasResultAuto"
                ? "object-contain p-0.5"
                : "object-contain p-1.5"
              : "object-cover"
          )}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-warm-primary-soft text-warm-primary">
          <Icon className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}
