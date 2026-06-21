"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Download,
  Sparkles,
} from "lucide-react";
import { useGenerateStore } from "@/lib/store/generate-store";
import { ImageGroup } from "@/components/result/image-group";
import {
  ImageDetailPanel,
  type ImageDetailDiagnostics,
  type ImageDetailItem,
  type ImageDetailReviewStatus,
} from "@/components/result/image-detail-panel";
import { JobCard } from "@/components/ui/job-card";
import { StatusBean } from "@/components/ui/status-bean";
import { resolveGenerationOutputAssetTarget } from "@/lib/canvas/generation-output-asset-target";
import {
  type PendingResultGroupEditTarget,
  writePendingResultEditTarget,
  writePendingResultGroupEditTarget,
} from "@/lib/canvas/result-edit-target-storage";
import type { GeneratedArtifact, GeneratedImage } from "@/lib/types";

export default function ResultPage() {
  const router = useRouter();
  const {
    generatedImages,
    productImageBase64,
    setGeneratedImages,
  } = useGenerateStore();
  const [toast, setToast] = useState<string | null>(null);
  const [retryingImageId, setRetryingImageId] = useState<string | null>(null);
  const [recentGeneratedImages, setRecentGeneratedImages] = useState<GeneratedImage[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const activeImages = generatedImages.length > 0 ? generatedImages : recentGeneratedImages;
  const completedCount = activeImages.filter((img) => img.url && !img.error).length;
  const failedCount = activeImages.filter((img) => img.error || !img.url).length;

  useEffect(() => {
    if (generatedImages.length > 0) return;

    const controller = new AbortController();
    setRecentLoading(true);
    fetch("/api/jobs?status=done&limit=40&summary=0", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : []))
      .then((jobs) => {
        if (!Array.isArray(jobs)) return;
        const displayableJobs = jobs.filter(isDisplayableRecentJob);
        const latestRunKey = getRecentJobRunKey(displayableJobs[0]);
        const recent = displayableJobs
          .filter((job) => getRecentJobRunKey(job) === latestRunKey)
          .slice(0, 30)
          .reverse()
          .map(mapJobToGeneratedImage);
        setRecentGeneratedImages(recent);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          console.warn("Recent result fallback failed:", error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRecentLoading(false);
      });

    return () => controller.abort();
  }, [generatedImages.length]);

  const displayImages = useMemo(
    () =>
      activeImages.map((img) => ({
        ...img,
        title: cleanAssetTitle(img.title || img.copyText || img.type),
        copyText: cleanAssetCopy(img.copyText),
        error: img.error ? toCustomerErrorMessage(img.error, img.errorCode) : undefined,
        errorCode: img.error ? undefined : img.errorCode,
      })),
    [activeImages]
  );

  const groups = useMemo(() => {
    const map: Record<string, GeneratedImage[]> = {
      main: [],
      selling_point: [],
      detail: [],
      model: [],
      scene: [],
      poster: [],
      copy: [],
    };
    displayImages.forEach((img) => {
      const key = img.type in map ? img.type : "poster";
      map[key].push(img);
    });
    return [
      { title: "商品主图", type: "main" as const, images: map.main },
      { title: "卖点图", type: "selling_point" as const, images: map.selling_point },
      { title: "商品详情", type: "detail" as const, images: map.detail },
      { title: "模特展示", type: "model" as const, images: map.model },
      { title: "场景应用", type: "scene" as const, images: map.scene },
      { title: "宣传海报", type: "poster" as const, images: map.poster },
      { title: "文案图层", type: "copy" as const, images: map.copy },
    ].filter((g) => g.images.length > 0);
  }, [displayImages]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleDownload = async (img: GeneratedImage) => {
    if (!img.url) {
      showToast("图片不可用");
      return;
    }
    try {
      if (img.url.startsWith("data:")) {
        const a = document.createElement("a");
        a.href = img.url;
        a.download = `${img.type}_${img.id}.png`;
        a.click();
        return;
      }
      const res = await fetch(img.url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${img.type}_${img.id}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      showToast("下载失败");
    }
  };

  const handleRegenerate = async (img: GeneratedImage) => {
    const sourceImage = activeImages.find((item) => item.id === img.id) || img;
    const jobId = getImageJobId(sourceImage);

    if (jobId) {
      if (retryingImageId) return;
      if (!window.confirm("会带回这张图原来的商品、模特、场景和风格参考，再做一个新版本。继续？")) {
        return;
      }

      setRetryingImageId(sourceImage.id);
      showToast("正在带原参考图创建新版本");
      try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/rerun`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `${sourceImage.title || "成片"} 再做一版`,
            note: "Created from result page with original references",
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "新版本创建失败");
        showToast(payload.queued ? "已带原参考图加入生成队列" : "已创建新版本任务");
      } catch (error) {
        showToast(error instanceof Error ? toCustomerErrorMessage(error.message) : "新版本创建失败");
      } finally {
        setRetryingImageId(null);
      }
      return;
    }

    if (!sourceImage.prompt) {
      showToast("这张图缺少可复用的创作方案，请回到画布重新生成");
      return;
    }
    if (retryingImageId) return;
    if (!window.confirm("只重新制作这一张图，其他成片会保持不变。继续？")) {
      return;
    }

    setRetryingImageId(img.id);
    showToast("正在重新制作这张图");
    try {
      const payload = {
        images: [
          {
            prompt: sourceImage.prompt,
            type: sourceImage.type,
            copyText: sourceImage.copyText,
            title: sourceImage.title || sourceImage.copyText || "单张补图",
          },
        ],
        style: sourceImage.metadata?.style || "auto",
        modelIds: sourceImage.metadata?.modelIds || [],
        productImageBase64,
      };

      const dryRunRes = await fetch("/api/images/generate/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, dryRun: true }),
      });
      const dryRun = await dryRunRes.json().catch(() => ({}));
      if (!dryRunRes.ok) throw new Error(dryRun.error || "图片制作前检查失败");

      const providerCallLimit = Number(
        dryRun.estimate?.maxProviderCallCount || dryRun.estimate?.providerCallCount || 0
      );

      const res = await fetch("/api/images/generate/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          dryRun: false,
          confirmedProviderCallLimit: providerCallLimit,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || "这张图重新制作失败");

      const nextImage = result.images?.[0];
      if (!nextImage || nextImage.error || !nextImage.url) {
        throw new Error(nextImage?.error || "这张图暂时没有产出");
      }

      setGeneratedImages(
        activeImages.map((item) => (item.id === sourceImage.id ? nextImage : item))
      );
      setRecentGeneratedImages(
        activeImages.map((item) => (item.id === sourceImage.id ? nextImage : item))
      );
      showToast("这张图已更新");
    } catch (error) {
      showToast(
        error instanceof Error
          ? toCustomerErrorMessage(error.message)
          : "这张图暂时制作失败，请稍后再试"
      );
    } finally {
      setRetryingImageId(null);
    }
  };

  const handleDownloadAll = async () => {
    for (const img of activeImages.filter((item) => item.url && !item.error)) {
      await handleDownload(img);
      await new Promise((r) => setTimeout(r, 300));
    }
  };

  const handleSaveAsAsset = async (img: GeneratedImage) => {
    const sourceImage = activeImages.find((item) => item.id === img.id) || img;
    if (!sourceImage.url) {
      showToast("这张图还没有可保存的大图");
      return;
    }

    const metadata = getImageMetadata(sourceImage);
    const saveTarget = resolveGenerationOutputAssetTarget({
      outputType:
        getMetadataString(metadata, "generationOutputType") ||
        getMetadataString(metadata, "planItemType") ||
        getMetadataString(metadata, "imageType") ||
        sourceImage.type,
      artifactType: sourceImage.type,
    });

    try {
      const response = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: saveTarget.assetType,
          title: sourceImage.title || sourceImage.copyText || saveTarget.label,
          description: saveTarget.description,
          status: "ready",
          url: sourceImage.url,
          metadata: {
            ...metadata,
            source: "result-page-save",
            savedByUser: true,
            savedAssetType: saveTarget.savedAssetType,
            canvasCategory: saveTarget.canvasCategory,
            componentType: saveTarget.componentType,
            originalType: sourceImage.type,
            prompt: sourceImage.prompt || getMetadataString(metadata, "prompt"),
            previewUrl: sourceImage.url,
            referenceUrl: sourceImage.url,
            savedAt: new Date().toISOString(),
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "save asset failed");
      showToast(saveTarget.message);
    } catch {
      showToast("保存失败");
    }
  };

  const handleOpenFolder = async (img: GeneratedImage) => {
    const sourceImage = activeImages.find((item) => item.id === img.id) || img;
    if (!sourceImage.url) {
      showToast("这张图还没有本地文件");
      return;
    }

    try {
      const response = await fetch("/api/generated-images/open-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceImage.url }),
      });
      if (!response.ok) throw new Error("open folder failed");
      const payload = await response.json().catch(() => ({}));
      showToast(payload.opened ? "已打开本地图像文件夹" : "图片文件夹已定位");
    } catch {
      showToast("打开文件夹失败");
    }
  };

  const handleEditInCanvas = (img: GeneratedImage) => {
    const sourceImage = activeImages.find((item) => item.id === img.id) || img;
    if (!sourceImage.url) {
      showToast("这张图还没有可修改的大图");
      return;
    }

    const metadata = getImageMetadata(sourceImage);
    const stored = writePendingResultEditTarget({
      url: sourceImage.url,
      title: sourceImage.title || sourceImage.copyText || sourceImage.type || "成片",
      outputId: sourceImage.id,
      artifactId: getMetadataString(metadata, "artifactId"),
      jobId: getImageJobId(sourceImage),
      status: sourceImage.error ? "failed" : getMetadataString(metadata, "status") || "done",
      prompt: sourceImage.prompt || getMetadataString(metadata, "prompt"),
      metadata,
    });
    if (!stored) {
      showToast("无法带入这张图，请回到画布后重新选择");
      return;
    }

    showToast("已带入这张图，正在打开画布 Agent");
    router.push("/canvas?restore=1&editResult=1");
  };

  const applyResultReviewStateUpdates = (updates: ResultReviewStateUpdate[]) => {
    if (updates.length === 0) return;
    const updateById = new Map(updates.map((update) => [update.imageId, update]));
    const applyReviewState = (item: GeneratedImage): GeneratedImage => {
      const update = updateById.get(item.id);
      if (!update) return item;
      return {
        ...item,
        metadata: {
          ...item.metadata,
          reviewState: update.reviewState,
          ...(update.artifactId ? { artifactId: update.artifactId } : {}),
        },
      };
    };

    if (generatedImages.length > 0) setGeneratedImages(generatedImages.map(applyReviewState));
    setRecentGeneratedImages((items) => items.map(applyReviewState));
    setSelectedImage((current) => (current ? applyReviewState(current) : current));
  };

  const buildPersistedResultReviewUpdate = async (
    sourceImage: GeneratedImage,
    status: Exclude<ImageDetailReviewStatus, "failed">,
    source: string
  ): Promise<{ update: ResultReviewStateUpdate; persisted: boolean }> => {
    const artifactId = await resolveImageArtifactId(sourceImage);
    const reviewState = buildResultReviewState(status, source);
    if (!artifactId) {
      return {
        update: { imageId: sourceImage.id, reviewState },
        persisted: false,
      };
    }

    const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewState }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "审核状态保存失败");

    const payloadMetadata = isRecord(payload.metadata) ? payload.metadata : {};
    const persistedReviewState = isRecord(payloadMetadata.reviewState)
      ? payloadMetadata.reviewState
      : reviewState;
    return {
      update: {
        imageId: sourceImage.id,
        reviewState: persistedReviewState,
        artifactId,
      },
      persisted: true,
    };
  };

  const handleSetResultReviewStatus = async (
    img: GeneratedImage,
    status: Exclude<ImageDetailReviewStatus, "failed">
  ) => {
    const sourceImage = activeImages.find((item) => item.id === img.id) || img;
    try {
      const result = await buildPersistedResultReviewUpdate(sourceImage, status, "result-page-review");
      applyResultReviewStateUpdates([result.update]);
      showToast(
        result.persisted
          ? `已标记为${RESULT_REVIEW_STATUS_LABELS[status]}`
          : "已临时标记；这张图缺少产物记录，刷新后不会保留"
      );
    } catch {
      showToast("审核状态保存失败");
    }
  };

  const handleSetResultGroupReviewStatus = async (
    images: GeneratedImage[],
    status: Exclude<ImageDetailReviewStatus, "failed">
  ) => {
    const sourceImages = images
      .map((image) => activeImages.find((item) => item.id === image.id) || image)
      .filter((image) => image.url && !image.error);
    if (sourceImages.length === 0) {
      showToast("这组暂时没有可标记的图片");
      return;
    }

    const results = await Promise.all(
      sourceImages.map((image) =>
        buildPersistedResultReviewUpdate(image, status, "result-page-group-review")
          .then((result) => ({ ok: true as const, result }))
          .catch(() => ({ ok: false as const }))
      )
    );
    const updates = results
      .filter((item): item is { ok: true; result: { update: ResultReviewStateUpdate; persisted: boolean } } => item.ok)
      .map((item) => item.result.update);
    applyResultReviewStateUpdates(updates);

    const failed = results.length - updates.length;
    const temporary = results.filter((item) => item.ok && !item.result.persisted).length;
    const suffix = failed > 0
      ? `，${failed} 张保存失败`
      : temporary > 0
        ? `，${temporary} 张为临时标记`
        : "";
    showToast(`已将 ${updates.length} 张标记为${RESULT_REVIEW_STATUS_LABELS[status]}${suffix}`);
  };

  const handleEditResultGroupInCanvas = (groupTitle: string, images: GeneratedImage[]) => {
    const stored = writePendingResultGroupEditTarget(buildResultGroupEditTarget(groupTitle, images));
    if (!stored) {
      showToast("无法带入这组，请回到画布后重新选择");
      return;
    }
    showToast(`已带入「${groupTitle}」，正在打开画布 Agent`);
    router.push("/canvas?restore=1&editResult=1&editGroup=1");
  };

  const handleBackToGenerate = () => {
    useGenerateStore.getState().reset();
    router.push("/canvas");
  };

  if (activeImages.length === 0) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4">
        <div className="max-w-md space-y-4 text-center">
          <div className="space-y-2">
            <h1 className="text-xl font-medium text-warm-ink">
              {recentLoading ? "正在读取最近成片" : "还没有成片"}
            </h1>
            <p className="text-sm leading-6 text-warm-muted">
              {recentLoading
                ? "如果刚刚跑完真实生成，这里会自动补上最近完成的图片。"
                : "这里会展示本次制作的成片。新的商品图、平台图和导出整理请从画布开始。"}
            </p>
          </div>
          <button
            onClick={() => router.push("/canvas")}
            className="rounded-md bg-warm-primary px-4 py-2 text-sm font-medium text-warm-paper transition hover:bg-warm-primary/90"
          >
            打开画布
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10 px-6 py-12 max-w-4xl mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleBackToGenerate}
          className="flex items-center gap-2 text-xs font-medium text-warm-muted uppercase tracking-widest hover:text-warm-ink transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          返回画布
        </button>
        <button
          onClick={handleDownloadAll}
          disabled={completedCount === 0}
          className="flex items-center gap-2 rounded-full bg-warm-primary px-6 py-2 text-xs font-medium text-warm-paper shadow-lg shadow-warm-primary/20 hover:bg-warm-primary/90 transition-all hover:scale-105 active:scale-95"
        >
          <Download className="h-3.5 w-3.5" />
          导出全部
        </button>
      </div>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-serif font-medium text-warm-ink tracking-tight">创作完成</h1>
          <StatusBean
            type={failedCount > 0 ? "retry" : "completed"}
            label={failedCount > 0 ? "待补图" : "可交付"}
          />
        </div>
        <p className="text-[11px] text-warm-muted tracking-[0.2em] opacity-60">
          已完成 {completedCount}/{activeImages.length} 张商业图
        </p>
        {failedCount > 0 && (
          <p className="max-w-xl text-sm leading-6 text-warm-muted">
            {failedCount} 张还没出图，已完成的图片会保留；可以单独重新制作未完成项。
          </p>
        )}
      </div>

      {/* Image groups */}
      <div className="space-y-12">
        {groups.map((group) => (
          <div key={group.title} className="space-y-6">
            <div className="flex items-center gap-4 px-2">
              <h2 className="text-lg font-serif font-medium text-warm-ink">{group.title}</h2>
              <div className="h-px flex-1 bg-warm-line/20" />
              <span className="text-[10px] font-medium text-warm-muted tracking-widest opacity-60">
                {group.images.length} 张
              </span>
            </div>
            <ImageGroup
              title={group.title}
              images={group.images}
              onDownload={handleDownload}
              onRegenerate={handleRegenerate}
              onOpenFolder={handleOpenFolder}
              onPreview={setSelectedImage}
              onEditGroup={(images) => handleEditResultGroupInCanvas(group.title, images)}
              onSetGroupReviewStatus={handleSetResultGroupReviewStatus}
              getReviewLabel={getResultReviewLabel}
              getCopyModeLabel={getCopyModeLabel}
            />
          </div>
        ))}
      </div>

      {/* Footer / Regenerate */}
      <JobCard
        title="不满意？"
        conclusion="可以回到画布调整商品素材、画面方向或导出组合。"
        primaryAction={
          <button
            onClick={handleBackToGenerate}
            className="flex items-center gap-2 rounded-xl bg-warm-primary-soft px-6 py-3 text-sm font-medium text-warm-primary hover:bg-warm-primary-soft/70 transition-colors"
          >
            <Sparkles className="h-4 w-4" />
            打开画布
          </button>
        }
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-warm-ink/90 px-5 py-2.5 text-[11px] font-medium tracking-widest text-warm-paper shadow-2xl animate-in fade-in slide-in-from-bottom-4">
          {toast.includes("失败") ? null : <Check className="h-3.5 w-3.5 text-warm-sage" strokeWidth={3} />}
          {toast}
        </div>
      )}
      {selectedImage && (
        <ImageDetailPanel
          item={buildImageDetailItem(selectedImage, displayImages)}
          open={!!selectedImage}
          onClose={() => setSelectedImage(null)}
          onNavigate={(target) => {
            const next = displayImages.find((image) => image.id === target.id);
            if (next) setSelectedImage(next);
          }}
          onDownload={(item) => {
            const source = displayImages.find((image) => image.id === item.id);
            if (source) void handleDownload(source);
          }}
          onEdit={(item) => {
            const source = displayImages.find((image) => image.id === item.id);
            if (source) handleEditInCanvas(source);
          }}
          onRetry={(item) => {
            const source = displayImages.find((image) => image.id === item.id);
            if (source) void handleRegenerate(source);
          }}
          onSaveAsAsset={(item) => {
            const source = displayImages.find((image) => image.id === item.id);
            if (source) void handleSaveAsAsset(source);
          }}
          onOpenFolder={(item) => {
            const source = displayImages.find((image) => image.id === item.id);
            if (source) void handleOpenFolder(source);
          }}
          onSetReviewStatus={(item, status) => {
            const source = displayImages.find((image) => image.id === item.id);
            if (source) void handleSetResultReviewStatus(source, status);
          }}
        />
      )}
    </div>
  );
}

type RecentJob = {
  id: string;
  status: string;
  prompt: string;
  resultUrl: string;
  error: string;
  metadata?: Record<string, unknown>;
};

function isDisplayableRecentJob(job: unknown): job is RecentJob {
  if (!job || typeof job !== "object") return false;
  const candidate = job as Partial<RecentJob>;
  const metadata = isRecord(candidate.metadata) ? candidate.metadata : {};
  return (
    typeof candidate.id === "string" &&
    typeof candidate.resultUrl === "string" &&
    candidate.resultUrl.length > 0 &&
    getMetadataString(metadata, "source") === "generation-plan-run"
  );
}

function mapJobToGeneratedImage(job: RecentJob): GeneratedImage {
  const metadata = isRecord(job.metadata) ? job.metadata : {};
  const rawType =
    getMetadataString(metadata, "planItemType") ||
    getMetadataString(metadata, "imageType") ||
    getMetadataString(metadata, "useCase") ||
    "poster";

  return {
    id: job.id,
    url: job.resultUrl,
    type: normalizeResultType(rawType),
    title:
      getMetadataString(metadata, "planItemTitle") ||
      getMetadataString(metadata, "exportItemTitle") ||
      rawType,
    copyText:
      getMetadataString(metadata, "copyText") ||
      getMetadataString(metadata, "exportSpecTitle") ||
      getMetadataString(metadata, "platform") ||
      getMetadataString(metadata, "ratio") ||
      "",
    prompt: job.prompt,
    error: job.error || undefined,
    metadata: {
      ...metadata,
      jobId: job.id,
      style:
        getMetadataString(metadata, "style") ||
        getMetadataString(metadata, "platform") ||
        "recent",
      modelIds: getMetadataStringArray(metadata, "modelIds"),
    },
  };
}

function getRecentJobRunKey(job: RecentJob | undefined) {
  if (!job) return "";
  const metadata = isRecord(job.metadata) ? job.metadata : {};
  const batchId = getMetadataString(metadata, "batchId");
  const planId = getMetadataString(metadata, "planId");

  if (batchId) return batchId.replace(/_batch-[a-z0-9-]+$/i, "");
  if (planId) return planId;
  return job.id;
}

function normalizeResultType(type: string) {
  const text = type.toLowerCase();
  if (text.includes("copy") || text.includes("text") || text.includes("caption")) {
    return "copy";
  }
  if (
    text.includes("model") ||
    text.includes("try_on") ||
    text.includes("wearing") ||
    text.includes("lookbook") ||
    text.includes("fashion") ||
    text.includes("person")
  ) {
    return "model";
  }
  if (
    text.includes("scene") ||
    text.includes("lifestyle") ||
    text.includes("context") ||
    text.includes("location") ||
    text.includes("environment")
  ) {
    return "scene";
  }
  if (
    text.includes("main") ||
    text.includes("taobao") ||
    text.includes("amazon") ||
    text.includes("marketplace") ||
    text.includes("product_reference")
  ) {
    return "main";
  }
  if (
    text.includes("detail") ||
    text.includes("feature") ||
    text.includes("selling") ||
    text.includes("material") ||
    text.includes("comparison")
  ) {
    return text.includes("detail") || text.includes("material") ? "detail" : "selling_point";
  }
  return "poster";
}

type ResultReference = {
  role: string;
  title: string;
  url: string;
  providerUsable?: boolean;
  providerMode?: string;
};

type ResultReviewStatus = "pass" | "manual" | "fail";
type ResultArtifactReviewStatus = ImageDetailReviewStatus;

type ResultReviewStateUpdate = {
  imageId: string;
  reviewState: Record<string, unknown>;
  artifactId?: string;
};

const RESULT_REVIEW_STATUS_LABELS: Record<ResultArtifactReviewStatus, string> = {
  approved: "可用",
  pending: "待检查",
  needs_redo: "建议重做",
  rejected: "已淘汰",
  failed: "生成失败",
};

type ResultReviewCheck = {
  id: string;
  label: string;
  status: ResultReviewStatus;
  message: string;
};

type ResultCopyRenderPolicy = {
  mode?: string;
  reason?: string;
  inImageText?: string[];
  sellingPoints?: string[];
  exportCopy?: string[];
  forbiddenClaims?: string[];
};

function getImageMetadata(image: GeneratedImage): Record<string, unknown> {
  return isRecord(image.metadata) ? image.metadata : {};
}

function buildImageDetailItem(image: GeneratedImage, images: GeneratedImage[]): ImageDetailItem {
  const metadata = getImageMetadata(image);
  const references = getResultReferences(image);
  const index = images.findIndex((item) => item.id === image.id);
  const providerInputs = references.filter((reference) => reference.providerUsable);
  const promptOnly = references.filter((reference) => !reference.providerUsable);
  const reviewStatus = getImageReviewStatus(image);

  return {
    id: image.id,
    url: image.url,
    title: image.title || image.copyText || image.type || "成片",
    type: image.type,
    status: image.error || !image.url ? "failed" : getMetadataString(metadata, "status") || "done",
    ratio: getMetadataString(metadata, "ratio") || getMetadataString(metadata, "exportSpecRatio"),
    size: getMetadataString(metadata, "size") || getMetadataString(metadata, "outputSize"),
    prompt: image.prompt,
    provider: getProviderLabelFromMetadata(metadata),
    model: getModelLabelFromMetadata(metadata),
    error: image.error,
    errorCode: image.errorCode,
    reviewStatus,
    reviewLabel: RESULT_REVIEW_STATUS_LABELS[reviewStatus],
    createdAt:
      getMetadataString(metadata, "createdAt") ||
      getMetadataString(metadata, "completedAt") ||
      getMetadataString(metadata, "generatedAt"),
    references: {
      providerInputs,
      promptOnly,
    },
    diagnostics: getResultDiagnostics(image),
    copyPolicy: getCopyRenderPolicy(metadata),
    assetInvocation: getAssetInvocation(metadata),
    prevItem: index > 0 ? { id: images[index - 1].id, title: images[index - 1].title || images[index - 1].type } : undefined,
    nextItem:
      index >= 0 && index < images.length - 1
        ? { id: images[index + 1].id, title: images[index + 1].title || images[index + 1].type }
        : undefined,
  };
}

function getImageJobId(image: GeneratedImage): string | undefined {
  const metadata = getImageMetadata(image);
  const jobId = getMetadataString(metadata, "jobId");
  if (jobId) return jobId;
  return image.id.startsWith("job_") ? image.id : undefined;
}

function getImageArtifactId(image: GeneratedImage): string | undefined {
  const metadata = getImageMetadata(image);
  const artifactId =
    getMetadataString(metadata, "artifactId") ||
    getMetadataString(metadata, "outputArtifactId") ||
    getMetadataString(metadata, "generatedArtifactId");
  if (artifactId) return artifactId;
  return image.id.startsWith("artifact_") ? image.id : undefined;
}

async function resolveImageArtifactId(image: GeneratedImage): Promise<string | undefined> {
  const directArtifactId = getImageArtifactId(image);
  if (directArtifactId) return directArtifactId;

  const jobId = getImageJobId(image);
  if (!jobId) return undefined;

  const response = await fetch(`/api/artifacts?jobId=${encodeURIComponent(jobId)}&limit=1`);
  const payload: unknown = await response.json().catch(() => []);
  if (!response.ok) throw new Error("产物记录读取失败");
  if (!Array.isArray(payload)) return undefined;

  const artifact = payload.find((item): item is GeneratedArtifact => {
    return isRecord(item) && typeof item.id === "string" && item.jobId === jobId;
  });
  return artifact?.id;
}

function buildResultGroupEditTarget(groupTitle: string, images: GeneratedImage[]): PendingResultGroupEditTarget {
  const usableImages = images.filter((image) => image.url && !image.error);
  const sourceImages = usableImages.length > 0 ? usableImages : images;
  return {
    group: groupTitle,
    count: sourceImages.length || 1,
    ratios: uniqueResultStrings(sourceImages.flatMap(getResultImageRatio)),
    artifactIds: uniqueResultStrings(sourceImages.flatMap((image) => getImageArtifactId(image) || [])),
    jobIds: uniqueResultStrings(sourceImages.flatMap((image) => getImageJobId(image) || [])),
    artifactTitles: uniqueResultStrings(sourceImages.map((image) => image.title || image.copyText || image.type)),
    providerRoles: uniqueResultStrings(sourceImages.flatMap(getResultImageProviderRoles)),
    promptOnlyRoles: uniqueResultStrings(sourceImages.flatMap(getResultImagePromptOnlyRoles)),
    copyModes: uniqueResultStrings(sourceImages.flatMap(getResultImageCopyMode)),
    summary: `来自结果页「${groupTitle}」的 ${sourceImages.length || images.length} 张成片`,
  };
}

function getResultImageRatio(image: GeneratedImage): string[] {
  const metadata = getImageMetadata(image);
  const ratio =
    getMetadataString(metadata, "ratio") ||
    getMetadataString(metadata, "exportSpecRatio") ||
    getMetadataString(metadata, "aspectRatioLabel") ||
    getMetadataString(metadata, "outputRatio");
  if (ratio) return [ratio];
  const size = getMetadataString(metadata, "size") || getMetadataString(metadata, "outputSize");
  const match = size.match(/^(\d+)x(\d+)$/i);
  return match ? [`${match[1]}:${match[2]}`] : [];
}

function getResultImageProviderRoles(image: GeneratedImage): string[] {
  const invocation = getAssetInvocation(getImageMetadata(image));
  const roles = [
    ...(invocation?.providerReferenceRoles ?? []),
    ...getResultReferences(image)
      .filter((reference) => reference.providerUsable)
      .map((reference) => reference.role),
  ];
  return uniqueResultStrings(roles);
}

function getResultImagePromptOnlyRoles(image: GeneratedImage): string[] {
  const invocation = getAssetInvocation(getImageMetadata(image));
  const roles = [
    ...(invocation?.promptOnlyRoles ?? []),
    ...getResultReferences(image)
      .filter((reference) => !reference.providerUsable)
      .map((reference) => reference.role),
  ];
  return uniqueResultStrings(roles);
}

function getResultImageCopyMode(image: GeneratedImage): string[] {
  const mode = getCopyRenderPolicy(getImageMetadata(image))?.mode;
  return mode ? [mode] : [];
}

function uniqueResultStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = value?.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function getImageReviewStatus(image: GeneratedImage): ResultArtifactReviewStatus {
  if (image.error || !image.url) return "failed";
  const reviewState = getImageMetadata(image).reviewState;
  if (isRecord(reviewState)) {
    const status = getStringValue(reviewState.status);
    if (isResultArtifactReviewStatus(status)) return status;
  }
  return "pending";
}

function buildResultReviewState(
  status: Exclude<ResultArtifactReviewStatus, "failed">,
  source: string
): Record<string, unknown> {
  return {
    status,
    label: RESULT_REVIEW_STATUS_LABELS[status],
    note: `用户在结果页标记为${RESULT_REVIEW_STATUS_LABELS[status]}`,
    source,
    updatedAt: new Date().toISOString(),
  };
}

function isResultArtifactReviewStatus(value: string): value is ResultArtifactReviewStatus {
  return Object.prototype.hasOwnProperty.call(RESULT_REVIEW_STATUS_LABELS, value);
}

function getResultReferences(image: GeneratedImage): ResultReference[] {
  const metadata = getImageMetadata(image);
  const references = [
    ...normalizeReferenceImages(metadata.referenceImages),
    ...normalizeReferenceImages(metadata.providerReferenceAdapter && isRecord(metadata.providerReferenceAdapter)
      ? metadata.providerReferenceAdapter.providerUsableImages
      : undefined),
    ...normalizeReferenceImages(metadata.providerReferenceAdapter && isRecord(metadata.providerReferenceAdapter)
      ? metadata.providerReferenceAdapter.promptOnlyImages
      : undefined),
  ];
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.role}:${reference.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getResultDiagnostics(image: GeneratedImage): ImageDetailDiagnostics | undefined {
  const metadata = getImageMetadata(image);
  const direct = firstRecord([
    image.diagnostics,
    metadata.providerDiagnostics,
    metadata.diagnostics,
    metadata.providerDiagnostic,
  ]);
  if (direct) return normalizeDetailDiagnostics(direct);

  const ledger = metadata.providerAttemptLedger;
  if (Array.isArray(ledger)) {
    for (let index = ledger.length - 1; index >= 0; index -= 1) {
      const entry = ledger[index];
      if (!isRecord(entry)) continue;
      const diagnostics = firstRecord([entry.diagnostics, entry.providerDiagnostics]);
      if (diagnostics) return normalizeDetailDiagnostics(diagnostics);
    }
  }

  return undefined;
}

function normalizeDetailDiagnostics(value: Record<string, unknown>): ImageDetailDiagnostics {
  return {
    ...value,
    code: getStringValue(value.code),
    summary:
      getStringValue(value.summary) ||
      getStringValue(value.message) ||
      getStringValue(value.error),
    endpoint: getStringValue(value.endpoint) || getStringValue(value.url),
    providerHost:
      getStringValue(value.providerHost) ||
      getStringValue(value.host) ||
      getStringValue(value.hostname),
    responseShape: getStringValue(value.responseShape),
  };
}

function firstRecord(values: unknown[]): Record<string, unknown> | undefined {
  return values.find(isRecord);
}

function getProviderLabelFromMetadata(metadata: Record<string, unknown>): string | undefined {
  const providerTrace = isRecord(metadata.providerTrace) ? metadata.providerTrace : undefined;
  return (
    getStringValue(metadata.provider) ||
    getStringValue(metadata.providerLabel) ||
    getStringValue(providerTrace?.provider) ||
    getStringValue(providerTrace?.host) ||
    undefined
  );
}

function getModelLabelFromMetadata(metadata: Record<string, unknown>): string | undefined {
  const providerTrace = isRecord(metadata.providerTrace) ? metadata.providerTrace : undefined;
  return (
    getStringValue(metadata.model) ||
    getStringValue(metadata.imageModel) ||
    getStringValue(providerTrace?.model) ||
    undefined
  );
}

function normalizeReferenceImages(value: unknown): ResultReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ResultReference[] => {
    if (!isRecord(item)) return [];
    const role = getStringValue(item.role);
    const url = getStringValue(item.url);
    if (!role || !url || !isDisplayableImageUrl(url)) return [];
    return [{
      role,
      url,
      title: getStringValue(item.title) || getReferenceRoleLabel(role),
      providerUsable: item.providerUsable === true,
      providerMode: getStringValue(item.providerMode),
    }];
  });
}

function isDisplayableImageUrl(url: string) {
  return url.startsWith("/api/generated-images/") || url.startsWith("data:image/");
}

function getCopyRenderPolicy(metadata: Record<string, unknown>): ResultCopyRenderPolicy | undefined {
  const policy = metadata.copyRenderPolicy;
  if (!isRecord(policy)) return undefined;
  return {
    mode: getStringValue(policy.mode),
    reason: getStringValue(policy.reason),
    inImageText: getStringArray(policy.inImageText),
    sellingPoints: getStringArray(policy.sellingPoints),
    exportCopy: getStringArray(policy.exportCopy),
    forbiddenClaims: getStringArray(policy.forbiddenClaims),
  };
}

function getAssetInvocation(metadata: Record<string, unknown>): ImageDetailItem["assetInvocation"] {
  const plan = metadata.assetInvocationPlan;
  if (!isRecord(plan)) return undefined;
  const decisions = Array.isArray(plan.decisions)
    ? plan.decisions.flatMap((entry): NonNullable<ImageDetailItem["assetInvocation"]>["decisions"] => {
        if (!isRecord(entry)) return [];
        const role = getStringValue(entry.role);
        const mode = getStringValue(entry.mode);
        if (!role || !mode) return [];
        return [{
          role,
          mode,
          providerInput: entry.providerInput === true,
          reason: getStringValue(entry.reason),
        }];
      })
    : [];
  if (decisions.length === 0) return undefined;
  return {
    mode: getStringValue(plan.mode),
    fallbackUsed: plan.fallbackUsed === true,
    fallbackReason: getStringValue(plan.fallbackReason),
    providerReferenceRoles: getStringArray(plan.providerReferenceRoles),
    promptOnlyRoles: getStringArray(plan.promptOnlyRoles),
    decisions,
  };
}

function getCopyModeLabel(image: GeneratedImage): string | undefined {
  const policy = getCopyRenderPolicy(getImageMetadata(image));
  if (!policy?.mode) return undefined;
  if (policy.mode === "burn_in") return "直接出字";
  if (policy.mode === "layout_layer") return "文案图层";
  if (policy.mode === "metadata_only") return "无文案";
  return policy.mode;
}

function getResultReviewLabel(image: GeneratedImage): string {
  return RESULT_REVIEW_STATUS_LABELS[getImageReviewStatus(image)];
}

function buildResultReviewChecks(image: GeneratedImage): ResultReviewCheck[] {
  const metadata = getImageMetadata(image);
  const roles = new Set([
    ...getMetadataStringArray(metadata, "itemReferenceRoles"),
    ...getMetadataStringArray(metadata, "itemProviderReferenceRoles"),
    ...getResultReferences(image).map((reference) => reference.role),
  ]);
  const copyPolicy = getCopyRenderPolicy(metadata);
  const checks: ResultReviewCheck[] = [];

  if (image.error || !image.url) {
    checks.push({
      id: "artifact",
      label: "产物状态",
      status: "fail",
      message: image.error || "这张图没有可用图片 URL。",
    });
  } else {
    checks.push({
      id: "artifact",
      label: "产物状态",
      status: "pass",
      message: "图片文件已返回，结果页可以预览和下载。",
    });
  }

  if (roles.has("product")) {
    checks.push({
      id: "product-fidelity",
      label: "商品一致性",
      status: "manual",
      message: "需要确认商品轮廓、颜色、材质、拉链/五金/口袋等关键结构没有漂移。",
    });
  }

  if (roles.has("model") || metadata.modelRequired === true) {
    checks.push({
      id: "model-product-relation",
      label: "模特和商品关系",
      status: "manual",
      message: "需要确认人物身份、穿着/手持关系、身体比例和接触阴影是否自然。",
    });
  }

  if (roles.has("scene")) {
    checks.push({
      id: "scene-lighting",
      label: "场景光影",
      status: "manual",
      message: "需要确认人物、商品和背景使用同一光源逻辑，没有棚拍脸或贴图感。",
    });
  }

  if (copyPolicy?.mode === "burn_in") {
    checks.push({
      id: "burned-copy",
      label: "画面文字",
      status: "manual",
      message: "这张图选择了直接出字，需要确认文字可读、无错别字且没有遮挡商品/人物。",
    });
  } else if (copyPolicy?.mode === "layout_layer") {
    checks.push({
      id: "copy-layer",
      label: "文案图层",
      status: "pass",
      message: "文案默认保留为结构化图层/元数据，不强行烧进位图。",
    });
  }

  if (checks.length === 1) {
    checks.push({
      id: "commercial-quality",
      label: "商业质量",
      status: "manual",
      message: "需要人工确认清晰度、构图、质感和是否适合投放。",
    });
  }

  return checks;
}

function getCheckBadgeClass(status: ResultReviewStatus) {
  if (status === "pass") return "rounded-full bg-warm-sage/15 px-2 py-0.5 text-[10px] text-warm-sage";
  if (status === "fail") return "rounded-full bg-warm-clay/15 px-2 py-0.5 text-[10px] text-warm-clay";
  return "rounded-full bg-warm-primary-soft px-2 py-0.5 text-[10px] text-warm-primary";
}

function getCheckStatusLabel(status: ResultReviewStatus) {
  if (status === "pass") return "通过";
  if (status === "fail") return "异常";
  return "人工确认";
}

function getReferenceRoleLabel(role: string) {
  const labels: Record<string, string> = {
    product: "商品参考",
    model: "模特参考",
    scene: "场景参考",
    style: "风格参考",
    copy: "文案参考",
  };
  return labels[role] || role;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" ? value.trim() : "";
}

function getMetadataStringArray(metadata: Record<string, unknown>, key: string) {
  return getStringArray(metadata[key]);
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && !!item.trim());
}

function getStringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanAssetTitle(value: string) {
  return value
    .replace(/\b(prompt|provider|dry[- ]?run|api|metadata)\b/gi, "创作方案")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAssetCopy(value: string) {
  return value
    .replace(/\b(prompt|provider|dry[- ]?run|api|metadata)\b/gi, "画面方案")
    .replace(/\s+/g, " ")
    .trim();
}

function toCustomerErrorMessage(message: string, errorCode?: string) {
  const text = `${message} ${errorCode || ""}`.toLowerCase();

  if (text.includes("rate") || text.includes("429") || text.includes("limit")) {
    return "当前制作排队较多，这张图暂时没出片，可以稍后单独重新制作。";
  }

  if (
    text.includes("provider") ||
    text.includes("prompt") ||
    text.includes("dry") ||
    text.includes("api") ||
    text.includes("token") ||
    text.includes("key") ||
    text.includes("timeout")
  ) {
    return "这张图暂时没制作成功，可以稍后单独重新制作。";
  }

  return message || "这张图暂时没制作成功，可以稍后单独重新制作。";
}
