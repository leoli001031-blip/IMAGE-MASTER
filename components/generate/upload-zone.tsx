"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { useGenerateStore } from "@/lib/store/generate-store";
import { cn } from "@/lib/utils/cn";
import Image from "next/image";

interface UploadZoneProps {
  onFile?: (file: File) => void;
}

export function UploadZone({ onFile }: UploadZoneProps) {
  const { uploadedFile, uploadedFileUrl, setUploadedFile } = useGenerateStore();
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;
      setUploadedFile(file);
      onFile?.(file);
    },
    [setUploadedFile, onFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleClick = () => inputRef.current?.click();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleClear = () => {
    setUploadedFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  if (uploadedFileUrl) {
    return (
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-warm-soft">
        <Image
          src={uploadedFileUrl}
          alt="产品图预览"
          fill
          className="object-contain"
        />
        <button
          onClick={handleClear}
          className="absolute top-2 right-2 rounded-full bg-warm-ink/40 p-1.5 text-warm-paper hover:bg-warm-ink/60 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={handleClick}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={cn(
        "relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 transition-colors cursor-pointer bg-warm-paper",
        isDragging
          ? "border-warm-primary bg-warm-primary-soft/50"
          : "border-warm-line hover:border-warm-primary/50 hover:bg-warm-primary-soft/20"
      )}
    >
      <Upload className="h-8 w-8 text-warm-muted/40" />
      <div className="text-center">
        <p className="text-sm font-medium text-warm-muted">
          上传产品图
        </p>
        <p className="text-xs text-warm-muted/50 mt-1">
          拖拽或点击上传
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleChange}
        className="hidden"
      />
    </div>
  );
}
