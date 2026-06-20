"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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

interface SampleProjectTemplate {
  id: string;
  title: string;
  description: string;
  agentStarterPrompt: string;
  requiredInputs: string[];
  expectedOutputs: string[];
  tags: string[];
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

const sampleProjectTemplates: SampleProjectTemplate[] = [
  {
    id: "taobao-detail-product-set",
    title: "淘宝详情页图组",
    description: "上传商品图后，让 Agent 规划主图、卖点海报、细节和详情页。",
    agentStarterPrompt:
      "我会上传一个真实商品。请帮我规划一套淘宝详情页图组：主图、卖点海报、商品细节、使用场景和收尾转化图。商品身份必须强参考真实商品图；文案按每张图的用途判断是否烧进画面，不能改商品包装标签。",
    requiredInputs: ["真实商品图", "卖点/参数文案"],
    expectedOutputs: ["主图", "卖点海报", "细节图", "详情页"],
    tags: ["商品强参考", "烧字按需", "多比例"],
  },
  {
    id: "model-multi-scene-campaign",
    title: "模特多场景宣传图",
    description: "一个模特、一件或多件商品，拆成室内/户外/商场等场景成片。",
    agentStarterPrompt:
      "我会上传模特资产、商品图和可选场景/风格参考。请规划一套模特多场景宣传图：每张图明确商品、模特、场景和风格的引用方式。模特只用于身份和气质，商品必须保持真实外观，多件商品要分别成组，不要混成一张商品资产。",
    requiredInputs: ["模特资产", "商品或服装图", "可选场景/风格图"],
    expectedOutputs: ["模特展示", "场景图", "海报图"],
    tags: ["同一模特", "多商品矩阵", "场景发散"],
  },
  {
    id: "cross-platform-launch-kit",
    title: "跨平台上市套图",
    description: "同一商品拆成 Amazon、社媒封面、海报和详情页方向。",
    agentStarterPrompt:
      "我会上传商品图和基础卖点。请帮我规划一套跨平台上市套图：Amazon 主图/辅图、社媒封面、商业海报、详情页卖点图。每张图自适应比例和平台用途；商品图强参考，风格和文案按用途调用。",
    requiredInputs: ["真实商品图", "卖点/参数", "可选风格参考"],
    expectedOutputs: ["Amazon 图", "社媒封面", "海报", "详情页"],
    tags: ["跨平台", "渠道比例", "统一视觉"],
  },
];

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [templateMessage, setTemplateMessage] = useState("");

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

  const createProjectFromTemplate = async (template: SampleProjectTemplate) => {
    if (creatingTemplateId) return;
    setCreatingTemplateId(template.id);
    setError("");
    setTemplateMessage("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: template.title,
          description: template.description,
          metadata: {
            source: "sample-template",
            sampleTemplateId: template.id,
            agentStarterPrompt: template.agentStarterPrompt,
            onboarding: {
              kind: "optional-sample-template",
              autoPopulateCanvas: false,
              requiredInputs: template.requiredInputs,
              expectedOutputs: template.expectedOutputs,
              tags: template.tags,
            },
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "项目模板创建失败");
      setProjects((current) => [payload.project, ...current]);
      setTemplateMessage("已创建空项目，画布不会自动塞入示例资产。");
      router.push(`/canvas?projectId=${encodeURIComponent(payload.project.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "项目模板创建失败");
    } finally {
      setCreatingTemplateId(null);
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

      <section className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-warm-ink">快速开始模板</h2>
            <p className="text-xs text-warm-muted">
              只保存 Agent 起始需求，不自动塞入素材或画布节点。
            </p>
          </div>
          {templateMessage && <span className="text-xs text-warm-primary">{templateMessage}</span>}
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {sampleProjectTemplates.map((template) => (
            <article
              key={template.id}
              className="flex min-h-[180px] flex-col justify-between gap-4 rounded-lg border border-warm-line/70 bg-warm-paper p-4"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-warm-ink">{template.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-warm-muted">{template.description}</p>
                  </div>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-warm-primary-soft text-warm-primary">
                    <Sparkles className="h-4 w-4" />
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {template.tags.map((tag) => (
                    <span key={tag} className="rounded bg-warm-soft px-2 py-1 text-xs text-warm-muted">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <button
                onClick={() => createProjectFromTemplate(template)}
                disabled={!!creatingTemplateId}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-warm-ink px-3 text-sm font-medium text-warm-paper transition hover:bg-warm-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creatingTemplateId === template.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                用这个开始
              </button>
            </article>
          ))}
        </div>
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
          <p className="mt-2 text-sm text-warm-muted">
            新建一个项目，或从上方模板开始；模板不会自动塞入示例素材。
          </p>
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
