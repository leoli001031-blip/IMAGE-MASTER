import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FolderKanban,
  ImageIcon,
  Layers3,
  PackageCheck,
  Sparkles,
} from "lucide-react";
import * as assetDB from "@/lib/store/asset-db";
import * as projectDB from "@/lib/store/project-db";
import type { Asset } from "@/lib/types";

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

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await projectDB.getProject(id);
  if (!project) notFound();

  const allAssets = await assetDB.list();
  const linkedAssetIds = collectProjectAssetIds(project);
  const assetsById = new Map(allAssets.map((asset) => [asset.id, asset]));
  const linkedAssets = linkedAssetIds
    .map((assetId) => assetsById.get(assetId))
    .filter((asset): asset is Asset => !!asset);
  const missingAssetIds = linkedAssetIds.filter((assetId) => !assetsById.has(assetId));
  const recentBatches = [...project.batches]
    .sort((a, b) => getTime(b.updatedAt) - getTime(a.updatedAt))
    .slice(0, 8);
  const hasCanvas = !!getString(project.metadata.canvasWorkflowId);
  const reviewSummary = project.reviewSummary;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-2 py-4 sm:px-4 lg:py-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-3">
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 text-xs font-medium text-warm-muted transition hover:text-warm-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            项目列表
          </Link>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-warm-ink sm:text-3xl">{project.title}</h1>
              <StatusPill label={project.status || "active"} />
              {hasCanvas ? <StatusPill label="画布已保存" state="generated" /> : <StatusPill label="空画布" state="draft" />}
            </div>
            {project.description && (
              <p className="max-w-2xl text-sm leading-6 text-warm-muted">{project.description}</p>
            )}
          </div>
        </div>
        <Link
          href={`/canvas?projectId=${encodeURIComponent(project.id)}`}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-warm-ink px-4 py-2 text-sm font-medium text-warm-paper transition hover:bg-warm-ink/90"
        >
          进入画布
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <section className="grid gap-2 border-y border-warm-line/60 py-3 sm:grid-cols-5">
        <ProjectMetric icon={FolderKanban} label="活动" value={project.campaigns.length} />
        <ProjectMetric icon={PackageCheck} label="批次" value={project.batches.length} />
        <ProjectMetric icon={ImageIcon} label="资产" value={linkedAssets.length} />
        <ProjectMetric icon={Clock3} label="待处理" value={(reviewSummary?.pending ?? 0) + (reviewSummary?.needsRevision ?? 0)} />
        <ProjectMetric icon={CheckCircle2} label="已过审" value={reviewSummary?.approved ?? 0} />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-3">
          <SectionHeader icon={PackageCheck} title="最近批次" actionLabel={`${project.batches.length} 个`} />
          {recentBatches.length > 0 ? (
            <div className="divide-y divide-warm-line/70 border-y border-warm-line/70">
              {recentBatches.map((batch) => {
                const state = normalizeBatchState(batch.batchState?.state ?? batch.state);
                return (
                  <div key={batch.id} className="grid gap-2 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                    <StatusPill label={batch.batchState?.label || batchStateLabel[state]} state={state} />
                    <div className="min-w-0">
                      <Link
                        href={`/projects/${encodeURIComponent(project.id)}/batches/${encodeURIComponent(batch.id)}`}
                        className="truncate text-sm font-medium text-warm-ink transition hover:text-warm-primary"
                      >
                        {batch.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-warm-muted">
                        <span>{getBatchItemCount(batch)} 张</span>
                        <span>{batch.reviewSummary?.approved ?? 0} 过审</span>
                        <span>{(batch.reviewSummary?.pending ?? 0) + (batch.reviewSummary?.needsRevision ?? 0)} 待处理</span>
                        <span>更新 {formatDate(batch.updatedAt)}</span>
                      </div>
                    </div>
                    <span className="hidden text-xs text-warm-muted sm:inline">{batch.kind || "export_pack"}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyLine icon={Sparkles} text="还没有生成批次；进入画布后创建生成框即可开始。" />
          )}
        </section>

        <aside className="space-y-5">
          <section className="space-y-3">
            <SectionHeader icon={ImageIcon} title="项目资产" actionLabel={`${linkedAssets.length} 个`} />
            {linkedAssets.length > 0 ? (
              <div className="space-y-2">
                {linkedAssets.slice(0, 8).map((asset) => (
                  <AssetRow key={asset.id} asset={asset} />
                ))}
              </div>
            ) : (
              <EmptyLine icon={ImageIcon} text="还没有资产引用。把商品、模特或场景拖进项目画布后会显示在这里。" />
            )}
            {missingAssetIds.length > 0 && (
              <div className="rounded-md border border-warm-line/70 bg-warm-paper px-3 py-2 text-xs leading-5 text-warm-muted">
                有 {missingAssetIds.length} 个历史资产引用只保留了 ID。
              </div>
            )}
          </section>

          <section className="space-y-3">
            <SectionHeader icon={Layers3} title="活动" actionLabel={`${project.campaigns.length} 个`} />
            {project.campaigns.length > 0 ? (
              <div className="space-y-2">
                {project.campaigns.slice(0, 6).map((campaign) => (
                  <div key={campaign.id} className="rounded-md border border-warm-line/70 bg-warm-paper px-3 py-2">
                    <div className="truncate text-sm font-medium text-warm-ink">{campaign.title}</div>
                    <div className="mt-1 text-xs text-warm-muted">{campaign.status || "active"}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyLine icon={Layers3} text="还没有活动；当前项目会直接使用项目画布。" />
            )}
          </section>
        </aside>
      </div>
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

function SectionHeader({
  icon: Icon,
  title,
  actionLabel,
}: {
  icon: typeof FolderKanban;
  title: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-warm-primary" />
        <h2 className="text-sm font-semibold text-warm-ink">{title}</h2>
      </div>
      {actionLabel && <span className="text-xs text-warm-muted">{actionLabel}</span>}
    </div>
  );
}

function AssetRow({ asset }: { asset: Asset }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-warm-line/70 bg-warm-paper p-2">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-warm-soft">
        {asset.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.url} alt={asset.title} className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="h-4 w-4 text-warm-muted" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-warm-ink">{asset.title}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-warm-muted">
          <span>{getAssetTypeLabel(asset.type)}</span>
          <span>{asset.status}</span>
        </div>
      </div>
    </div>
  );
}

function EmptyLine({ icon: Icon, text }: { icon: typeof Sparkles; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-warm-line bg-warm-paper px-3 py-4 text-sm text-warm-muted">
      <Icon className="h-4 w-4" />
      {text}
    </div>
  );
}

function StatusPill({ label, state }: { label: string; state?: BatchState }) {
  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded px-2 py-0.5 text-xs ${state ? batchStateClass[state] : "bg-warm-soft text-warm-muted"}`}>
      {state === "delivered" || state === "reviewed" ? <CheckCircle2 className="h-3 w-3" /> : null}
      {label}
    </span>
  );
}

function collectProjectAssetIds(project: projectDB.ProjectDetails): string[] {
  const ids = new Set<string>();
  addStringArray(ids, project.metadata.assetIds);
  for (const batch of project.batches) {
    addStringArray(ids, batch.metadata.assetIds);
    addStringArray(ids, batch.metadata.productIds);
    addStringArray(ids, batch.metadata.artifactIds);
    addString(ids, batch.metadata.sourceAssetId);
    addString(ids, batch.metadata.productAssetId);
    addString(ids, batch.metadata.productId);
  }
  return Array.from(ids);
}

function addString(target: Set<string>, value: unknown): void {
  if (typeof value === "string" && value.trim()) target.add(value.trim());
}

function addStringArray(target: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const item of value) addString(target, item);
}

function getBatchItemCount(batch: { metadata: Record<string, unknown>; reviewSummary?: { itemCount?: number } }): number {
  const counts = getRecord(batch.metadata.counts);
  return (
    getNumber(batch.metadata.itemCount) ??
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

function getAssetTypeLabel(type: string): string {
  if (type === "product") return "商品";
  if (type === "model") return "模特";
  if (type === "style") return "风格";
  if (type === "scene") return "场景";
  if (type === "output") return "成片";
  if (type === "platform") return "平台";
  if (type === "quality") return "质检";
  return type;
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

function formatDate(value: string | undefined): string {
  if (!value) return "无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}
