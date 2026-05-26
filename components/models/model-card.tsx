"use client";

import { useState, useEffect, useRef } from "react";
import { Trash2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { buildAutoModelAssetName } from "@/lib/canvas/asset-auto-naming";
import type { AIModel } from "@/lib/types";
import Image from "next/image";

const TEMPERAMENT_LABELS: Record<string, string> = {
  intellectual: "知性",
  energetic: "活力",
  gentle: "温柔",
  business: "商务",
  cool: "酷感",
};

const ETHNICITY_LABELS: Record<string, string> = {
  asian: "亚洲",
  european: "欧美",
  african: "非洲",
};

const GENDER_LABELS: Record<string, string> = {
  male: "男",
  female: "女",
};

interface ModelCardProps {
  model: AIModel;
  onDelete: (id: string) => void;
  onRegenerate: (id: string) => void;
}

export function ModelCard({ model, onDelete, onRegenerate }: ModelCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoName = getModelAutoName(model);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete(model.id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      confirmTimer.current = setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <div className="rounded-xl border border-warm-line overflow-hidden bg-warm-paper">
      <div className="relative aspect-[3/4] bg-warm-soft">
        {model.imageUrl ? (
          <>
            {!loaded && (
              <div className="absolute inset-0 bg-warm-soft animate-pulse" />
            )}
            <Image
              src={model.imageUrl}
              alt={autoName.title}
              fill
              className={cn(
                "object-cover transition-opacity duration-300",
                loaded ? "opacity-100" : "opacity-0"
              )}
              onLoad={() => setLoaded(true)}
            />
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-warm-muted/30 text-xs">
            暂无图片
          </div>
        )}
      </div>

      <div className="p-3 space-y-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-warm-ink">
              {autoName.title}
            </span>
          </div>
          {autoName.subtitle && (
            <div className="truncate text-xs text-warm-muted/60">{autoName.subtitle}</div>
          )}
          <div className="flex items-center gap-1 flex-wrap">
            <Tag>{TEMPERAMENT_LABELS[model.temperament]}</Tag>
            <Tag>{model.bodyType === "slim" ? "苗条" : model.bodyType === "athletic" ? "健美" : "标准"}</Tag>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onRegenerate(model.id)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-warm-muted/50 hover:bg-warm-primary-soft hover:text-warm-muted transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            重试
          </button>
          <button
            onClick={handleDelete}
            className={cn(
              "flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors",
              confirmDelete
                ? "bg-warm-clay/10 text-warm-clay"
                : "text-warm-muted/50 hover:bg-warm-primary-soft hover:text-warm-muted"
            )}
          >
            <Trash2 className="h-3 w-3" />
            {confirmDelete ? "确认" : "删除"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Tag({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-warm-primary-soft px-2 py-0.5 text-[10px] text-warm-primary/80">
      {children}
    </span>
  );
}

function getModelAutoName(model: AIModel) {
  const metadataAutoName = getRecordValue(model.metadata?.autoName);
  const title = getStringValue(metadataAutoName.title);
  const subtitle = getStringValue(metadataAutoName.subtitle);
  if (title) return { title, subtitle };

  return buildAutoModelAssetName({
    params: {
      gender: model.gender,
      ethnicity: model.ethnicity,
      age: model.age,
      temperament: model.temperament,
      bodyType: model.bodyType,
      hairStyle: model.hairStyle,
      makeup: model.makeup,
    },
    metadata: model.metadata,
    fallbackTitle: `${ETHNICITY_LABELS[model.ethnicity]}·${GENDER_LABELS[model.gender]} ${model.age}岁`,
  });
}

function getRecordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
