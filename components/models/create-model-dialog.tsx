"use client";

import { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { MODEL_OPTIONS } from "@/lib/types";
import type { CreateModelParams } from "@/lib/types";
import Image from "next/image";

interface CreateModelDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (params: CreateModelParams) => Promise<{ imageUrl: string }>;
}

export function CreateModelDialog({
  open,
  onClose,
  onCreate,
}: CreateModelDialogProps) {
  const [params, setParams] = useState<CreateModelParams>({
    gender: "female",
    ethnicity: "asian",
    age: 25,
    temperament: "intellectual",
    bodyType: "standard",
  });
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setPreview(null);
      setError(null);
      setGenerating(false);
    }
  }, [open]);

  if (!open) return null;

  const update = (key: keyof CreateModelParams, value: string | number | undefined) => {
    setParams((p) => ({ ...p, [key]: value }));
    setPreview(null);
    setError(null);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const result = await onCreate(params);
      setPreview(result.imageUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-warm-ink/20" onClick={onClose} />

      <div className="relative bg-warm-paper rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-5 animate-in slide-in-from-bottom border border-warm-line">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-warm-ink">创建模特</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-warm-primary-soft transition-colors">
            <X className="h-5 w-5 text-warm-muted" />
          </button>
        </div>

        {/* Gender */}
        <ParamGroup label="性别">
          <div className="flex gap-2">
            {MODEL_OPTIONS.gender.map((o) => (
              <Pill
                key={o.id}
                active={params.gender === o.id}
                onClick={() => update("gender", o.id)}
              >
                {o.label}
              </Pill>
            ))}
          </div>
        </ParamGroup>

        {/* Ethnicity */}
        <ParamGroup label="人种">
          <div className="flex gap-2">
            {MODEL_OPTIONS.ethnicity.map((o) => (
              <Pill
                key={o.id}
                active={params.ethnicity === o.id}
                onClick={() => update("ethnicity", o.id)}
              >
                {o.label}
              </Pill>
            ))}
          </div>
        </ParamGroup>

        {/* Age */}
        <ParamGroup label={`年龄：${params.age}岁`}>
          <input
            type="range"
            min={18}
            max={45}
            value={params.age}
            onChange={(e) => update("age", Number(e.target.value))}
            className="w-full accent-warm-primary"
          />
          <div className="flex justify-between text-[10px] text-warm-muted/50">
            <span>18</span>
            <span>45</span>
          </div>
        </ParamGroup>

        {/* Temperament */}
        <ParamGroup label="气质">
          <div className="flex gap-2 flex-wrap">
            {MODEL_OPTIONS.temperament.map((o) => (
              <Pill
                key={o.id}
                active={params.temperament === o.id}
                onClick={() => update("temperament", o.id)}
              >
                {o.label}
              </Pill>
            ))}
          </div>
        </ParamGroup>

        {/* Body type */}
        <ParamGroup label="体型">
          <div className="flex gap-2">
            {MODEL_OPTIONS.bodyType.map((o) => (
              <Pill
                key={o.id}
                active={params.bodyType === o.id}
                onClick={() => update("bodyType", o.id)}
              >
                {o.label}
              </Pill>
            ))}
          </div>
        </ParamGroup>

        {/* Hair (optional) */}
        <ParamGroup label="发型（可选）">
          <div className="flex gap-2 flex-wrap">
            {MODEL_OPTIONS.hairStyle.map((o) => (
              <Pill
                key={o.id}
                active={params.hairStyle === o.id}
                onClick={() =>
                  update(
                    "hairStyle",
                    params.hairStyle === o.id ? undefined : o.id
                  )
                }
              >
                {o.label}
              </Pill>
            ))}
          </div>
        </ParamGroup>

        {/* Makeup (optional) */}
        <ParamGroup label="妆容（可选）">
          <div className="flex gap-2">
            {MODEL_OPTIONS.makeup.map((o) => (
              <Pill
                key={o.id}
                active={params.makeup === o.id}
                onClick={() =>
                  update(
                    "makeup",
                    params.makeup === o.id ? undefined : o.id
                  )
                }
              >
                {o.label}
              </Pill>
            ))}
          </div>
        </ParamGroup>

        {/* Preview */}
        {preview && (
          <div className="rounded-xl overflow-hidden border border-warm-line">
            <div className="relative aspect-[3/4]">
              <Image
                src={preview}
                alt="模特预览"
                fill
                className="object-cover"
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-sm text-warm-clay text-center">{error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          {!preview ? (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-warm-primary py-3 text-sm font-medium text-warm-paper hover:bg-warm-primary/90 disabled:opacity-50 transition-colors"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  生成中
                </>
              ) : (
                "生成"
              )}
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="flex-1 rounded-xl bg-warm-primary py-3 text-sm font-medium text-warm-paper hover:bg-warm-primary/90 transition-colors"
              >
                入库
              </button>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex-1 rounded-xl bg-warm-primary-soft py-3 text-sm font-medium text-warm-primary hover:bg-warm-primary-soft/70 transition-colors"
              >
                重试
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ParamGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-warm-muted/60 mb-2">{label}</p>
      {children}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-warm-primary text-warm-paper"
          : "bg-warm-primary-soft text-warm-muted hover:bg-warm-primary-soft/70"
      )}
    >
      {children}
    </button>
  );
}
