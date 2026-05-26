"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useModelStore } from "@/lib/store/model-store";
import { ModelCard } from "@/components/models/model-card";
import { CreateModelDialog } from "@/components/models/create-model-dialog";
import { JobCard } from "@/components/ui/job-card";
import type { CreateModelParams } from "@/lib/types";

export default function ModelsPage() {
  const { models, isLoading, error, loadModels, createModel, deleteModel, regenerateModel, clearError } =
    useModelStore();
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const handleCreate = async (params: CreateModelParams) => {
    const model = await createModel(params);
    return { imageUrl: model.imageUrl };
  };

  const handleDelete = async (id: string) => {
    await deleteModel(id);
  };

  const handleRegenerate = async (id: string) => {
    await regenerateModel(id);
  };

  return (
    <div className="flex flex-col gap-10 px-6 py-12 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-serif font-medium text-warm-ink tracking-tight">模特库</h1>
          <p className="text-[11px] text-warm-muted uppercase tracking-[0.3em] opacity-40">
            Manage your AI visual assets
          </p>
        </div>
        <button
          onClick={() => setDialogOpen(true)}
          className="flex items-center gap-2 rounded-full bg-warm-primary px-6 py-2.5 text-xs font-medium text-warm-paper shadow-lg shadow-warm-primary/20 hover:bg-warm-primary/90 transition-all hover:scale-105 active:scale-95"
        >
          <Plus className="h-4 w-4" />
          新建模特
        </button>
      </div>

      {/* Model list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-warm-muted/50 font-serif">加载中...</p>
        </div>
      ) : models.length === 0 ? (
        <JobCard title="还没有模特" conclusion="创建一个模特，让您的产品宣传图更具真实感。">
          <div className="flex justify-center py-4">
            <button
              onClick={() => setDialogOpen(true)}
              className="rounded-xl bg-warm-primary px-8 py-3 text-sm font-medium text-warm-paper shadow-lg shadow-warm-primary/20 hover:bg-warm-primary/90 transition-all active:scale-95"
            >
              立即创建
            </button>
          </div>
        </JobCard>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          {models.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              onDelete={handleDelete}
              onRegenerate={handleRegenerate}
            />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-4 rounded-xl border border-warm-clay/20 bg-warm-paper p-4 shadow-2xl z-50">
          <div className="h-2 w-2 rounded-full bg-warm-clay" />
          <span className="text-sm font-medium text-warm-clay">{error}</span>
          <button onClick={clearError} className="text-xs text-warm-muted hover:text-warm-ink transition-colors underline">
            关闭
          </button>
        </div>
      )}

      {/* Create dialog */}
      <CreateModelDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}
