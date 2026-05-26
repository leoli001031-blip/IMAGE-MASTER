"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { useGenerateStore } from "@/lib/store/generate-store";
import { useModelStore } from "@/lib/store/model-store";

const MAX_FILE_SIZE = 8 * 1024 * 1024; // Match image-reference API guardrail.

export function GenerateButton() {
  const {
    uploadedFile,
    selectedUseCases,
    selectedStyle,
    selectedModelIds,
    status,
    setStatus,
    setProgressText,
    setProductAnalysis,
    setImagePlan,
    setGeneratedImages,
    setError,
  } = useGenerateStore();

  const models = useModelStore((s) => s.models);
  const isRunning = status !== "idle" && status !== "error" && status !== "done";

  const handleGenerate = async () => {
    if (!uploadedFile || isRunning) return;

    // Validate file size
    if (uploadedFile.size > MAX_FILE_SIZE) {
      setError("图片过大，请上传小于 8MB 的图片");
      return;
    }

    try {
      setStatus("analyzing");
      setProgressText("分析中");

      const base64 = await fileToBase64(uploadedFile);

      const analyzeRes = await fetch("/api/products/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
      });

      if (!analyzeRes.ok) {
        const err = await analyzeRes.json();
        throw new Error(err.error || "分析失败");
      }

      const analysis = await analyzeRes.json();
      setProductAnalysis(analysis);

      setStatus("planning");
      setProgressText("规划中");

      const selectedModels = models.filter((m) => selectedModelIds.includes(m.id));

      const planRes = await fetch("/api/projects/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productAnalysis: analysis,
          useCases: selectedUseCases,
          style: selectedStyle,
          models: selectedModels.map((m) => ({
            id: m.id,
            description: m.promptSnapshot,
          })),
        }),
      });

      if (!planRes.ok) {
        const err = await planRes.json();
        throw new Error(err.error || "规划失败");
      }

      const plan = await planRes.json();
      setImagePlan(plan.plan);

      setStatus("generating");
      setProgressText("生成中");

      const imagePayload = {
        images: plan.images.map(
          (img: { prompt: string; type: string; copyText: string; title: string }) => ({
            prompt: img.prompt,
            type: img.type,
            copyText: img.copyText,
            title: img.title,
          })
        ),
        style: selectedStyle,
        modelIds: selectedModelIds,
        productImageBase64: base64,
      };

      const dryRunRes = await fetch("/api/images/generate/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...imagePayload,
          dryRun: true,
        }),
      });

      if (!dryRunRes.ok) {
        const err = await dryRunRes.json();
        throw new Error(err.error || "生成前检查失败");
      }

      const dryRun = await dryRunRes.json();
      const providerCallLimit = Number(
        dryRun.estimate?.maxProviderCallCount || dryRun.estimate?.providerCallCount || 0
      );
      setProgressText(`生成中 · 预计 ${providerCallLimit} 次 provider 调用`);

      const imageRes = await fetch("/api/images/generate/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...imagePayload,
          dryRun: false,
          confirmedProviderCallLimit: providerCallLimit,
        }),
      });

      if (!imageRes.ok) {
        const err = await imageRes.json();
        throw new Error(err.error || "生成失败");
      }

      const generated = await imageRes.json();
      setGeneratedImages(generated.images);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败，可重试");
    }
  };

  return (
    <button
      onClick={handleGenerate}
      disabled={!uploadedFile || isRunning}
      className="w-full flex items-center justify-center gap-2 rounded-xl bg-warm-primary py-3.5 text-sm font-medium text-warm-paper hover:bg-warm-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {isRunning ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          生成中
        </>
      ) : (
        <>
          <Sparkles className="h-4 w-4" />
          生成
        </>
      )}
    </button>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
