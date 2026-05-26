import type { GenerationJob } from "@/lib/types";
import type { CanvasAsset, CanvasWorkbenchNode } from "@/lib/canvas/workbench-data";
import type { ExportPackBatchStateSnapshot } from "@/lib/canvas/export-pack-state";

export interface ExportPackBatchSummary {
  batchId: string;
  title: string;
  platform: string;
  total: number;
  pending: number;
  queuedRunning: number;
  completed: number;
  failed: number;
  cancelled: number;
  progressLabel: string;
  statusLabel: string;
  sizes: string[];
  qualityRules: string[];
  qaChecklist: string[];
  qaGaps: string[];
  latestAt: string;
  relatedToSelectedNode: boolean;
  batchState?: ExportPackBatchStateSnapshot;
}

interface BuildExportPackBatchSummariesParams {
  jobs: Array<GenerationJob & { metadata: Record<string, unknown> }>;
  assets: CanvasAsset[];
  selectedNode?: CanvasWorkbenchNode;
  limit?: number;
  batchStates?: Record<string, ExportPackBatchStateSnapshot | undefined>;
}

export function buildExportPackBatchSummaries({
  jobs,
  assets,
  selectedNode,
  limit = 3,
  batchStates = {},
}: BuildExportPackBatchSummariesParams): ExportPackBatchSummary[] {
  const groups = new Map<string, Array<GenerationJob & { metadata: Record<string, unknown> }>>();

  for (const job of jobs) {
    const batchId = getStringValue(job.metadata.batchId);
    if (!batchId) continue;
    groups.set(batchId, [...(groups.get(batchId) ?? []), job]);
  }

  const summaries = Array.from(groups.entries()).map(([batchId, batchJobs]) =>
    summarizeBatch(batchId, batchJobs, assets, selectedNode, batchStates[batchId])
  );

  return summaries
    .sort((a, b) => {
      if (a.relatedToSelectedNode !== b.relatedToSelectedNode) {
        return a.relatedToSelectedNode ? -1 : 1;
      }
      return new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime();
    })
    .slice(0, limit);
}

function summarizeBatch(
  batchId: string,
  jobs: Array<GenerationJob & { metadata: Record<string, unknown> }>,
  assets: CanvasAsset[],
  selectedNode?: CanvasWorkbenchNode,
  batchState?: ExportPackBatchStateSnapshot
): ExportPackBatchSummary {
  const firstJob = jobs[0];
  const metadataList = jobs.map((job) => job.metadata);
  const totalFromMetadata = metadataList
    .map((metadata) => getNumberValue(metadata.batchTotal))
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => b - a)[0];
  const total = totalFromMetadata ?? jobs.length;
  const completed = countStatuses(jobs, ["done", "completed"]);
  const pending = countStatuses(jobs, ["pending"]);
  const queuedRunning = countStatuses(jobs, ["queued", "running"]);
  const failed = countStatuses(jobs, ["failed"]);
  const cancelled = countStatuses(jobs, ["cancelled"]);
  const title =
    getFirstString(metadataList, "exportPackTitle") ??
    getFirstString(metadataList, "batchJobTitle") ??
    "导出包批次";
  const platform = getFirstString(metadataList, "platform") ?? "multi_channel";
  const sizes = getUniqueMetadataStrings(metadataList, "size");
  const qualityRules = getUniqueQualityRules(metadataList);
  const latestAt = jobs
    .map((job) => job.updatedAt || job.createdAt)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? "";
  const relatedToSelectedNode = isBatchRelatedToSelectedNode(jobs, selectedNode);
  const { checklist, gaps } = buildQaReadiness(metadataList, assets, selectedNode);

  return {
    batchId,
    title,
    platform,
    total,
    pending,
    queuedRunning,
    completed,
    failed,
    cancelled,
    progressLabel: `${completed}/${total} 完成`,
    statusLabel: getBatchStatusLabel({ total, pending, queuedRunning, completed, failed, cancelled }),
    sizes,
    qualityRules,
    qaChecklist: checklist,
    qaGaps: gaps,
    latestAt: latestAt || firstJob?.createdAt || "",
    relatedToSelectedNode,
    batchState,
  };
}

function buildQaReadiness(
  metadataList: Array<Record<string, unknown>>,
  assets: CanvasAsset[],
  selectedNode?: CanvasWorkbenchNode
): { checklist: string[]; gaps: string[] } {
  const checklist: string[] = [];
  const gaps: string[] = [];
  const modelRequired = metadataList.some((metadata) => metadata.modelRequired === true);
  const hasModelAsset = hasUsableModelAsset(assets, selectedNode);

  if (modelRequired) {
    if (hasModelAsset) {
      checklist.push("模特资产已准备");
    } else {
      gaps.push("需要模特资产");
    }
  }

  if (metadataList.some((metadata) => metadata.whiteBackground === true)) {
    checklist.push("白底要求");
  }

  if (metadataList.some((metadata) => metadata.textAllowed === true)) {
    checklist.push("允许文字");
  } else if (metadataList.some((metadata) => metadata.textAllowed === false)) {
    checklist.push("避免文字");
  }

  const ratios = getUniqueMetadataStrings(metadataList, "ratio");
  if (ratios.length > 0) checklist.push(`比例 ${formatListSummary(ratios)}`);

  const sizes = getUniqueMetadataStrings(metadataList, "size");
  if (sizes.length > 0) checklist.push(`尺寸 ${formatListSummary(sizes)}`);

  checklist.push(...getUniqueQualityRules(metadataList).slice(0, 3));

  return {
    checklist: Array.from(new Set(checklist)).slice(0, 6),
    gaps: Array.from(new Set(gaps)),
  };
}

function hasUsableModelAsset(assets: CanvasAsset[], selectedNode?: CanvasWorkbenchNode): boolean {
  if (selectedNode && (
    selectedNode.data.iconName === "model" ||
    selectedNode.data.kind === "asset" && selectedNode.data.category === "模特" ||
    typeof selectedNode.data.modelId === "string" ||
    typeof selectedNode.data.modelAssetId === "string"
  )) {
    return true;
  }

  return assets.some((asset) => asset.category === "模特" && asset.status === "ready");
}

function isBatchRelatedToSelectedNode(
  jobs: Array<GenerationJob & { metadata: Record<string, unknown> }>,
  selectedNode?: CanvasWorkbenchNode
): boolean {
  if (!selectedNode) return false;
  const selectedExportPackId = getStringValue(selectedNode.data.exportPackId);

  return jobs.some((job) => {
    const exportPackId = getStringValue(job.metadata.exportPackId);
    return (
      job.nodeId === selectedNode.id ||
      exportPackId === selectedNode.id ||
      (!!selectedExportPackId && exportPackId === selectedExportPackId)
    );
  });
}

function getBatchStatusLabel({
  total,
  pending,
  queuedRunning,
  completed,
  failed,
  cancelled,
}: {
  total: number;
  pending: number;
  queuedRunning: number;
  completed: number;
  failed: number;
  cancelled: number;
}): string {
  if (failed > 0) return "有失败";
  if (completed >= total && total > 0) return "已完成";
  if (queuedRunning > 0) return "生成中";
  if (pending > 0) return "排队";
  if (cancelled > 0) return "已取消";
  return "待处理";
}

function countStatuses(
  jobs: Array<GenerationJob & { metadata: Record<string, unknown> }>,
  statuses: string[]
): number {
  return jobs.filter((job) => statuses.includes(job.status)).length;
}

function getFirstString(
  metadataList: Array<Record<string, unknown>>,
  key: string
): string | undefined {
  for (const metadata of metadataList) {
    const value = getStringValue(metadata[key]);
    if (value) return value;
  }
  return undefined;
}

function getUniqueMetadataStrings(
  metadataList: Array<Record<string, unknown>>,
  key: string
): string[] {
  return Array.from(
    new Set(metadataList.map((metadata) => getStringValue(metadata[key])).filter(Boolean) as string[])
  );
}

function getUniqueQualityRules(metadataList: Array<Record<string, unknown>>): string[] {
  return Array.from(
    new Set(
      metadataList.flatMap((metadata) => {
        const rules = metadata.qualityRules;
        return Array.isArray(rules)
          ? rules.filter((rule): rule is string => typeof rule === "string" && !!rule.trim())
          : [];
      })
    )
  );
}

function formatListSummary(items: string[]): string {
  if (items.length <= 2) return items.join(" / ");
  return `${items.slice(0, 2).join(" / ")} +${items.length - 2}`;
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
