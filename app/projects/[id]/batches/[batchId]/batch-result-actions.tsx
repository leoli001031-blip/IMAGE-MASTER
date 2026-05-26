"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, FolderOpen, RotateCcw, Save, X } from "lucide-react";

const MANUAL_CHECK_IDS = [
  "white-background",
  "text-policy",
  "model-quality",
  "commercial-quality",
] as const;

const ASSET_TYPE_OPTIONS = [
  { value: "output", label: "成片" },
  { value: "product", label: "商品" },
  { value: "model", label: "模特" },
  { value: "scene", label: "场景" },
  { value: "style", label: "风格" },
] as const;

interface BatchResultActionsProps {
  urls: string[];
  fallbackTitle: string;
}

interface ResultImagePreviewProps {
  title: string;
  url: string;
}

interface ResultItemActionsProps {
  batchId: string;
  jobId: string;
  title: string;
  url?: string;
  retryable: boolean;
  rerunnable: boolean;
  reviewable: boolean;
  reviewStatus: "none" | "manual" | "pass" | "fail";
  metadata: Record<string, unknown>;
}

export function BatchResultActions({ urls, fallbackTitle }: BatchResultActionsProps) {
  const [message, setMessage] = useState("");
  const [opening, setOpening] = useState(false);

  const openFolder = async () => {
    setOpening(true);
    setMessage("正在打开文件夹...");
    try {
      const response = await fetch("/api/generated-images/open-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "open folder failed");
      setMessage(payload.opened ? "已打开本地图像文件夹" : `图片目录：${payload.folderPath ?? ".data/generated"}`);
    } catch {
      setMessage("打开失败，可手动查看 .data/generated");
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={openFolder}
        disabled={opening}
        className="inline-flex items-center justify-center gap-2 rounded-md border border-warm-line/70 bg-warm-paper px-3 py-2 text-sm font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:opacity-50"
      >
        <FolderOpen className="h-4 w-4" />
        {opening ? "打开中" : "打开本地文件夹"}
      </button>
      <span className="text-xs text-warm-muted">{message || fallbackTitle}</span>
    </div>
  );
}

export function ResultImagePreview({ title, url }: ResultImagePreviewProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-warm-primary transition hover:text-warm-ink"
      >
        <Eye className="h-3.5 w-3.5" />
        预览大图
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-warm-ink/80 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-label={`${title} 大图预览`}
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-full w-full max-w-6xl flex-col gap-3"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 text-warm-paper">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{title}</p>
                <p className="text-xs text-warm-paper/70">点击空白处关闭</p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-warm-paper/20 px-3 py-1.5 text-xs font-medium transition hover:bg-warm-paper/10"
                >
                  新窗口
                </a>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-warm-paper/20 transition hover:bg-warm-paper/10"
                  aria-label="关闭预览"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-lg bg-warm-paper">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={title} className="max-h-[82vh] w-auto max-w-full object-contain" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ResultItemActions({
  batchId,
  jobId,
  title,
  url,
  retryable,
  rerunnable,
  reviewable,
  reviewStatus,
  metadata,
}: ResultItemActionsProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [assetTitle, setAssetTitle] = useState(title);
  const [assetType, setAssetType] = useState<(typeof ASSET_TYPE_OPTIONS)[number]["value"]>("output");
  const [reviewNote, setReviewNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [reviewing, setReviewing] = useState<"pass" | "fail" | undefined>();

  const saveAsAsset = async () => {
    if (!url) {
      setMessage("当前没有可保存图片");
      return;
    }
    setSaving(true);
    setMessage("正在保存...");
    try {
      const response = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: assetType,
          title: assetTitle.trim() || title,
          status: "ready",
          url,
          metadata: {
            ...metadata,
            source: "project-batch-result",
            savedByUser: true,
            savedAt: new Date().toISOString(),
            savedAsAssetType: assetType,
            originalResultTitle: title,
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "save asset failed");
      setMessage(`已保存为${getAssetTypeLabel(assetType)}`);
      setSaveOpen(false);
    } catch {
      setMessage("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const resetFailedJob = async () => {
    if (!retryable) return;
    setRetrying(true);
    setMessage("正在重置...");
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/retry`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "retry failed");
      setMessage("已放回待生成");
      router.refresh();
    } catch {
      setMessage("重做失败");
    } finally {
      setRetrying(false);
    }
  };

  const createRerunJob = async () => {
    if (!rerunnable) return;
    setRerunning(true);
    setMessage("正在创建新版本...");
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/rerun`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${title} 再做一版`,
          note: "Created from result page",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "rerun failed");
      setMessage("已加入待生成");
      router.refresh();
    } catch {
      setMessage("创建新版本失败");
    } finally {
      setRerunning(false);
    }
  };

  const submitReview = async (status: "pass" | "fail") => {
    if (!reviewable) return;
    setReviewing(status);
    setMessage(status === "pass" ? "正在标记通过..." : "正在驳回...");

    try {
      for (const checkId of MANUAL_CHECK_IDS) {
        const response = await fetch(`/api/export-packs/${encodeURIComponent(batchId)}/qa/review`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId,
            checkId,
            status,
            note: reviewNote.trim() || (status === "pass" ? "Result page approved" : "Result page rejected"),
            reviewer: "project-result-page",
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "review failed");
      }

      setMessage(status === "pass" ? "已通过" : "已驳回");
      router.refresh();
    } catch {
      setMessage(status === "pass" ? "通过失败" : "驳回失败");
    } finally {
      setReviewing(undefined);
    }
  };

  return (
    <div className="space-y-2">
      {reviewable && (
        <div className="flex flex-col gap-2 rounded-md bg-warm-soft/60 p-2">
          <input
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
            placeholder="备注，可选"
            className="h-8 rounded border border-warm-line/70 bg-warm-paper px-2 text-xs text-warm-ink outline-none transition placeholder:text-warm-muted focus:border-warm-primary/50"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => submitReview("pass")}
              disabled={!!reviewing || reviewStatus === "pass"}
              className="inline-flex items-center gap-1.5 rounded-md border border-warm-primary/30 bg-warm-primary-soft px-2.5 py-1.5 text-xs font-medium text-warm-primary transition hover:border-warm-primary/50 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              {reviewing === "pass" ? "写入中" : "通过"}
            </button>
            <button
              type="button"
              onClick={() => submitReview("fail")}
              disabled={!!reviewing || reviewStatus === "fail"}
              className="inline-flex items-center gap-1.5 rounded-md border border-warm-clay/30 bg-warm-clay/10 px-2.5 py-1.5 text-xs font-medium text-warm-clay transition hover:border-warm-clay/50 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              {reviewing === "fail" ? "写入中" : "驳回"}
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {url && (
          <button
            type="button"
            onClick={() => setSaveOpen((value) => !value)}
            className="inline-flex items-center gap-1.5 rounded-md border border-warm-line/70 bg-warm-paper px-2.5 py-1.5 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary"
          >
            <Save className="h-3.5 w-3.5" />
            保存为资产
          </button>
        )}
        {retryable && (
          <button
            type="button"
            onClick={resetFailedJob}
            disabled={retrying}
            className="inline-flex items-center gap-1.5 rounded-md border border-warm-clay/30 bg-warm-clay/10 px-2.5 py-1.5 text-xs font-medium text-warm-clay transition hover:border-warm-clay/50 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {retrying ? "重做中" : "重做"}
          </button>
        )}
        {rerunnable && (
          <button
            type="button"
            onClick={createRerunJob}
            disabled={rerunning}
            className="inline-flex items-center gap-1.5 rounded-md border border-warm-line/70 bg-warm-paper px-2.5 py-1.5 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {rerunning ? "创建中" : "再做一张"}
          </button>
        )}
        {message && <span className="text-xs text-warm-muted">{message}</span>}
      </div>
      {url && saveOpen && (
        <div className="grid gap-2 rounded-md border border-warm-line/70 bg-warm-paper p-2 sm:grid-cols-[1fr_auto]">
          <label className="min-w-0">
            <span className="mb-1 block text-[11px] text-warm-muted">保存名称</span>
            <input
              value={assetTitle}
              onChange={(event) => setAssetTitle(event.target.value)}
              className="h-8 w-full rounded border border-warm-line/70 bg-warm-soft/60 px-2 text-xs text-warm-ink outline-none transition focus:border-warm-primary/50"
            />
          </label>
          <div className="grid grid-cols-[minmax(86px,110px)_auto] gap-2">
            <label>
              <span className="mb-1 block text-[11px] text-warm-muted">保存类型</span>
              <select
                value={assetType}
                onChange={(event) =>
                  setAssetType(event.target.value as (typeof ASSET_TYPE_OPTIONS)[number]["value"])
                }
                className="h-8 w-full rounded border border-warm-line/70 bg-warm-soft/60 px-2 text-xs text-warm-ink outline-none transition focus:border-warm-primary/50"
              >
                {ASSET_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={saveAsAsset}
              disabled={saving}
              className="self-end rounded-md bg-warm-ink px-3 py-2 text-xs font-medium text-warm-paper transition hover:bg-warm-ink/90 disabled:opacity-50"
            >
              {saving ? "保存中" : "保存"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function getAssetTypeLabel(type: (typeof ASSET_TYPE_OPTIONS)[number]["value"]): string {
  return ASSET_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? "资产";
}
