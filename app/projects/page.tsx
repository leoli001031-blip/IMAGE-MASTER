"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FolderKanban,
  ImageIcon,
  Loader2,
  PackageCheck,
  Plus,
  Sparkles,
} from "lucide-react";

interface ProjectRecord {
  id: string;
  title: string;
  description: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  campaigns: Array<{ id: string; title: string; status: string; updatedAt?: string }>;
  batches: ProjectBatchRecord[];
  reviewSummary?: ProjectReviewSummary;
}

interface ProjectBatchRecord {
  id: string;
  title: string;
  kind?: string;
  state: BatchState;
  metadata?: Record<string, unknown>;
  updatedAt?: string;
  batchState?: {
    state?: BatchState;
    label?: string;
    locked?: boolean;
    delivered?: boolean;
  };
  reviewSummary?: ProjectReviewSummary;
}

interface ProjectReviewSummary {
  sessionCount: number;
  itemCount?: number;
  approved: number;
  rejected: number;
  needsRevision: number;
  pending: number;
  latestAt?: string;
  latestSessionTitle?: string;
}

interface AssetRecord {
  id: string;
  title: string;
  type: string;
  status: string;
}

type BatchState = "draft" | "generated" | "in_review" | "reviewed" | "locked" | "delivered";

const batchStateLabel: Record<BatchState, string> = {
  draft: "草稿",
  generated: "已生成",
  in_review: "审核中",
  reviewed: "已审核",
  locked: "已锁定",
  delivered: "已交付",
};

const batchStateClass: Record<BatchState, string> = {
  draft: "bg-warm-line/25 text-warm-muted",
  generated: "bg-warm-primary-soft text-warm-primary",
  in_review: "bg-warm-clay/15 text-warm-clay",
  reviewed: "bg-warm-primary-soft text-warm-primary",
  locked: "bg-warm-ink/10 text-warm-ink",
  delivered: "bg-warm-ink text-warm-paper",
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  const visibleProjects = useMemo(
    () => projects.filter((project) => !isHiddenProject(project)),
    [projects]
  );

  const dashboard = useMemo(() => {
    const batches = visibleProjects.flatMap((project) => project.batches ?? []);
    return {
      projectCount: visibleProjects.length,
      assetCount: assets.filter((asset) => asset.status !== "archived").length,
      batchCount: batches.length,
      pendingReviewCount: visibleProjects.reduce(
        (total, project) => total + (project.reviewSummary?.pending ?? 0) + (project.reviewSummary?.needsRevision ?? 0),
        0
      ),
    };
  }, [assets, visibleProjects]);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetch("/api/projects", { cache: "no-store" }).then((res) => res.json()),
      fetch("/api/assets", { cache: "no-store" }).then((res) => res.json()),
    ])
      .then(([projectPayload, assetPayload]) => {
        if (!mounted) return;
        setProjects(Array.isArray(projectPayload.projects) ? projectPayload.projects : []);
        const assetList = Array.isArray(assetPayload) ? assetPayload : assetPayload.assets;
        setAssets(Array.isArray(assetList) ? assetList : []);
      })
      .catch(() => setError("项目列表读取失败"))
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const createProject = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || creating) return;
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          description: description.trim(),
          metadata: {
            source: "project-list",
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "项目创建失败");
      setProjects((current) => [payload.project, ...current]);
      setTitle("");
      setDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "项目创建失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-2 py-4 sm:px-4 lg:py-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-warm-muted/70">
            <FolderKanban className="h-4 w-4" />
            Projects
          </div>
          <h1 className="text-2xl font-semibold text-warm-ink sm:text-3xl">项目</h1>
          <p className="max-w-2xl text-sm leading-6 text-warm-muted">
            一个项目保存一套画布、素材引用和生成批次；全局资产仍可在不同项目复用。
          </p>
        </div>
        <Link
          href="/canvas"
          className="inline-flex items-center justify-center gap-2 rounded-md border border-warm-line/70 bg-warm-paper px-4 py-2 text-sm font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary"
        >
          空画布
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <section className="grid gap-2 border-y border-warm-line/60 py-3 sm:grid-cols-4">
        <ProjectMetric icon={FolderKanban} label="项目" value={dashboard.projectCount} />
        <ProjectMetric icon={ImageIcon} label="全局资产" value={dashboard.assetCount} />
        <ProjectMetric icon={PackageCheck} label="批次" value={dashboard.batchCount} />
        <ProjectMetric icon={Clock3} label="待处理" value={dashboard.pendingReviewCount} />
      </section>

      <section className="grid gap-3 rounded-lg border border-warm-line/70 bg-warm-paper p-3 lg:grid-cols-[1.2fr_1fr_auto] lg:items-end">
        <label className="space-y-1">
          <span className="text-xs font-medium text-warm-muted">新项目</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：618 蓝衣包款投放"
            className="w-full rounded-md border border-warm-line bg-white px-3 py-2 text-sm outline-none transition focus:border-warm-primary"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-warm-muted">备注</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="可选"
            className="w-full rounded-md border border-warm-line bg-white px-3 py-2 text-sm outline-none transition focus:border-warm-primary"
          />
        </label>
        <button
          onClick={createProject}
          disabled={!title.trim() || creating}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-warm-primary px-4 text-sm font-medium text-warm-paper transition hover:bg-warm-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          新建
        </button>
      </section>

      {error && (
        <div className="rounded-md border border-warm-clay/30 bg-warm-clay/10 px-4 py-3 text-sm text-warm-clay">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-warm-muted/50" />
        </div>
      ) : visibleProjects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-warm-line bg-warm-paper px-6 py-12 text-center">
          <h2 className="text-base font-medium text-warm-ink">还没有项目</h2>
          <p className="mt-2 text-sm text-warm-muted">新建一个项目，然后进入画布开始生成。</p>
        </div>
      ) : (
        <div className="divide-y divide-warm-line/70 border-y border-warm-line/70">
          {visibleProjects.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FolderKanban;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 px-1 py-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-warm-primary-soft text-warm-primary">
        <Icon className="h-4 w-4" />
      </span>
      <span>
        <span className="block text-lg font-semibold leading-tight text-warm-ink">{value}</span>
        <span className="text-xs text-warm-muted">{label}</span>
      </span>
    </div>
  );
}

function ProjectRow({ project }: { project: ProjectRecord }) {
  const assetIds = getStringArray(project.metadata.assetIds);
  const recentBatches = getRecentBatches(project.batches).slice(0, 3);
  const latestBatch = recentBatches[0];
  const hasCanvas = !!getString(project.metadata.canvasWorkflowId);
  const reviewSummary = project.reviewSummary;

  return (
    <article className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_360px_auto] lg:items-center">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/projects/${encodeURIComponent(project.id)}`}
            className="truncate text-base font-semibold text-warm-ink transition hover:text-warm-primary"
          >
            {project.title}
          </Link>
          <StatusPill label={project.status || "active"} />
          {hasCanvas ? <StatusPill label="画布已保存" state="generated" /> : <StatusPill label="空画布" state="draft" />}
        </div>
        {project.description && <p className="text-sm leading-6 text-warm-muted">{project.description}</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-warm-muted">
          <span>{project.campaigns.length} 个活动</span>
          <span>{project.batches.length} 个批次</span>
          <span>{assetIds.length} 个资产引用</span>
          <span>更新 {formatDate(project.updatedAt)}</span>
        </div>
      </div>

      <div className="min-w-0">
        {latestBatch ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-xs text-warm-muted">
              <span>最近批次</span>
              {reviewSummary && reviewSummary.sessionCount > 0 && (
                <span>{reviewSummary.approved} 过审 / {reviewSummary.pending + reviewSummary.needsRevision} 待处理</span>
              )}
            </div>
            <div className="space-y-1.5">
              {recentBatches.map((batch) => (
                <div key={batch.id} className="flex items-center gap-2 text-sm">
                  <StatusPill label={getBatchLabel(batch)} state={getBatchState(batch)} />
                  <span className="min-w-0 flex-1 truncate text-warm-ink">{batch.title}</span>
                  <span className="shrink-0 text-xs text-warm-muted">{getBatchItemCount(batch)} 张</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-warm-muted">
            <Sparkles className="h-4 w-4" />
            还没有生成批次
          </div>
        )}
      </div>

      <div className="flex shrink-0 gap-2">
        <Link
          href={`/projects/${encodeURIComponent(project.id)}`}
          className="inline-flex items-center justify-center rounded-md border border-warm-line/70 bg-warm-paper px-3 py-2 text-sm font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary"
        >
          详情
        </Link>
        <Link
          href={`/canvas?projectId=${encodeURIComponent(project.id)}`}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-warm-ink px-4 py-2 text-sm font-medium text-warm-paper transition hover:bg-warm-ink/90"
        >
          {hasCanvas || latestBatch ? "画布" : "开始"}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </article>
  );
}

function isHiddenProject(project: ProjectRecord): boolean {
  const source = getString(project.metadata.source);
  if (project.id === "project_default_canvas" || source === "default-canvas-project") return true;
  if (source && source.includes("smoke")) return true;
  if (project.title.toLowerCase().includes("smoke")) return true;
  return false;
}

function StatusPill({ label, state }: { label: string; state?: BatchState }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${state ? batchStateClass[state] : "bg-warm-soft text-warm-muted"}`}>
      {state === "delivered" || state === "reviewed" ? <CheckCircle2 className="h-3 w-3" /> : null}
      {label}
    </span>
  );
}

function getRecentBatches(batches: ProjectBatchRecord[]): ProjectBatchRecord[] {
  return [...batches].sort((a, b) => getTime(b.updatedAt) - getTime(a.updatedAt));
}

function getBatchState(batch: ProjectBatchRecord): BatchState {
  return normalizeBatchState(batch.batchState?.state ?? batch.state);
}

function getBatchLabel(batch: ProjectBatchRecord): string {
  return batch.batchState?.label || batchStateLabel[getBatchState(batch)];
}

function getBatchItemCount(batch: ProjectBatchRecord): number {
  const metadata = batch.metadata ?? {};
  const counts = getRecord(metadata.counts);
  return (
    getNumber(metadata.itemCount) ??
    getNumber(counts.total) ??
    getNumber(batch.reviewSummary?.itemCount) ??
    0
  );
}

function normalizeBatchState(value: unknown): BatchState {
  if (
    value === "generated" ||
    value === "in_review" ||
    value === "reviewed" ||
    value === "locked" ||
    value === "delivered"
  ) {
    return value;
  }
  return "draft";
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && !!item.trim())
    : [];
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getTime(value: string | undefined): number {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}
