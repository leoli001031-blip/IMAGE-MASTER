"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils/cn";
import type { CanvasFlowNode } from "@/components/canvas/workflow-node";
import {
  buildGenerationFramePlanSpecs,
  generationFrameRoles,
  getGenerationFrameBindingKey,
  normalizeGenerationFrameState,
  type GenerationFrameOutput,
  type GenerationFramePlanSpec,
  type GenerationFrameRole,
  type GenerationFrameSlotBinding,
  type GenerationFrameStatus,
} from "@/lib/canvas/generation-frame";

type SlotViewModel = {
  role: GenerationFrameRole;
  label: string;
  binding: GenerationFrameSlotBinding;
};

const roleView: Record<
  GenerationFrameRole,
  {
    label: string;
  }
> = {
  product: {
    label: "商品",
  },
  model: {
    label: "模特",
  },
  style: {
    label: "风格",
  },
  scene: {
    label: "场景",
  },
  copy: {
    label: "文案",
  },
};

const statusLabel: Record<GenerationFrameStatus, string> = {
  empty: "待补充",
  draft: "草稿",
  queued: "排队中",
  running: "生成中",
  ready: "可生成",
  done: "已完成",
  review: "待检查",
  failed: "需处理",
};

const statusClassName: Record<GenerationFrameStatus, string> = {
  empty: "bg-warm-line/25 text-warm-muted",
  draft: "bg-warm-primary-soft text-warm-primary",
  queued: "bg-warm-primary-soft text-warm-primary",
  running: "bg-warm-primary-soft text-warm-primary",
  ready: "bg-warm-sage/15 text-warm-sage",
  done: "bg-warm-sage/15 text-warm-sage",
  review: "bg-warm-clay/15 text-warm-clay",
  failed: "bg-warm-clay/15 text-warm-clay",
};

type GenerationFrameMode = "product" | "model" | "scene" | "style" | "template";

type ImageSetProductionStatus = "plan" | "queued" | "generating" | "gallery" | "review" | "failed";

interface ImageSetOutputStats {
  total: number;
  done: number;
  failed: number;
  active: number;
  pending: number;
}

const handleBaseClassName =
  "semantic-port !z-20 !h-3.5 !w-3.5 !border-[3px] !shadow-sm !pointer-events-auto transition-transform hover:scale-125";

function GenerationFrameNodeComponent({
  id,
  data,
  selected,
}: NodeProps<CanvasFlowNode>) {
  const frame = normalizeGenerationFrameState(data.generationFrame);
  const bindings = frame.assets.length > 0
    ? frame.assets
    : generationFrameRoles
        .map((role) => frame.slots[role])
        .filter((binding): binding is GenerationFrameSlotBinding => Boolean(binding));
  const assets = bindings.flatMap((binding): SlotViewModel[] => {
    if (!binding || !isConcreteFrameAsset(binding)) return [];
    const view = roleView[binding.role];
    return binding
      ? [
          {
            role: binding.role,
            label: view.label,
            binding,
          },
        ]
      : [];
  });
  const prompt = frame.prompt ?? getString(data.generationUserRequest) ?? "";
  const title = cleanGenerationFrameDisplayLabel(data.label || "图组");
  const outputStats = getImageSetOutputStats(frame.outputs);
  const imageSetStatus = getImageSetStatus(frame.status, outputStats);
  const imageSetSummary = getImageSetSummary(outputStats, imageSetStatus);
  const outputType = getString(data.generationOutputType) ?? frame.outputType ?? "commercial_image_set";
  const frameMode = getGenerationFrameMode(outputType);
  const referenceAssetCount = getFrameReferenceAssetCount(frame);
  const hasProductReference = hasFrameProductReference(frame);
  const hasFrameRequest = prompt.trim().length > 0;
  const planItems = hasFrameRequest
    ? buildGenerationFramePlanSpecs({
        request: prompt,
        outputType,
        frameLabel: title,
      })
    : [];
  const hasRequiredInput = frameMode === "product"
    ? hasProductReference
    : frameMode === "template"
      ? hasFrameRequest
      : referenceAssetCount > 0 || hasFrameRequest;
  const preflightText = hasRequiredInput
    ? buildGenerationFrameHumanPlan({
        assetSlots: assets,
        frameMode,
        outputType,
        planCount: planItems.length,
        request: prompt,
      })
    : "等待 Agent 规划";
  const displayStatusLabel = hasRequiredInput ? statusLabel[frame.status] : getEmptyTaskStatusLabel(frameMode);
  const displayStatusClassName = hasRequiredInput
    ? statusClassName[frame.status]
    : "bg-warm-line/25 text-warm-muted";

  return (
    <InternalGenerationTaskNode
      id={id}
      title={title}
      selected={selected}
      statusLabel={displayStatusLabel}
      statusClassName={displayStatusClassName}
      assets={assets}
      outputs={frame.outputs}
      planItems={planItems}
      preflightText={preflightText}
      hasRequiredInput={hasRequiredInput}
      imageSetStatus={imageSetStatus}
      imageSetSummary={imageSetSummary}
    />
  );
}

export const GenerationFrameNode = memo(GenerationFrameNodeComponent);

function InternalGenerationTaskNode({
  id,
  title,
  selected,
  statusLabel,
  statusClassName,
  assets,
  outputs,
  planItems,
  preflightText,
  hasRequiredInput,
  imageSetStatus,
  imageSetSummary,
}: {
  id: string;
  title: string;
  selected: boolean;
  statusLabel: string;
  statusClassName: string;
  assets: SlotViewModel[];
  outputs: GenerationFrameOutput[];
  planItems: GenerationFramePlanSpec[];
  preflightText: string;
  hasRequiredInput: boolean;
  imageSetStatus: ImageSetProductionStatus;
  imageSetSummary: string;
}) {
  const doneCount = outputs.filter((output) => Boolean(output.url)).length;
  const issueCount = outputs.filter(isRetryableOutput).length;
  const visibleStatus = getImageSetStatusLabel(imageSetStatus);

  return (
    <section
      className={cn(
        "relative w-[260px] rounded-lg border border-warm-line/60 bg-warm-paper/80 p-3 text-left text-warm-ink shadow-sm backdrop-blur-sm transition-all",
        selected && "ring-2 ring-warm-primary/25 shadow-md"
      )}
      data-node-id={id}
      data-generation-frame-internal="true"
      title={`${title} · ${statusLabel}`}
    >
      <Handle
        id="inputs"
        type="target"
        position={Position.Left}
        title="Agent 任务参考输入"
        aria-label={`${title} Agent 任务参考输入`}
        className={cn(
          handleBaseClassName,
          "semantic-port--target !h-3 !w-3 !rounded-full !border-warm-paper !bg-warm-muted"
        )}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-warm-muted">
            Agent 任务
          </div>
          <h2 className="mt-1 truncate text-sm font-semibold leading-tight text-warm-ink">
            {title}
          </h2>
        </div>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none", statusClassName)}>
          {statusLabel}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        <InternalTaskMetric label="素材" value={assets.length} />
        <InternalTaskMetric label="计划" value={planItems.length || "-"} />
        <InternalTaskMetric label="结果" value={outputs.length ? `${doneCount}/${outputs.length}` : "-"} />
      </div>

      <div className="mt-2 rounded-md border border-warm-line/50 bg-warm-bg px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-medium text-warm-ink">
            {visibleStatus}
          </span>
          {issueCount > 0 && (
            <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[10px] leading-none text-red-700">
              {issueCount} 需重做
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-warm-muted">
          {outputs.length > 0 ? imageSetSummary : hasRequiredInput ? preflightText : "素材和需求由右上角 Agent 统一规划。"}
        </p>
      </div>

      <Handle
        id="outputs"
        type="source"
        position={Position.Right}
        title="Agent 任务输出"
        aria-label={`${title} Agent 任务输出`}
        className={cn(
          handleBaseClassName,
          "semantic-port--source !h-3 !w-3 !rounded-full !border-warm-paper !bg-warm-muted"
        )}
      />
    </section>
  );
}

function InternalTaskMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-warm-line/45 bg-warm-bg px-1.5 py-1 text-center">
      <div className="text-[10px] leading-none text-warm-muted">{label}</div>
      <div className="mt-1 text-xs font-semibold leading-none text-warm-ink">{value}</div>
    </div>
  );
}

function buildGenerationFrameHumanPlan({
  assetSlots,
  frameMode,
  outputType,
  planCount,
  request,
}: {
  assetSlots: SlotViewModel[];
  frameMode: GenerationFrameMode;
  outputType: string;
  planCount: number;
  request: string;
}): string {
  const cleanRequest = request.trim();
  const roleSummary = buildRoleCountSummary(assetSlots);
  const requestText = cleanRequest ? `需求是“${cleanRequest.slice(0, 36)}${cleanRequest.length > 36 ? "..." : ""}”。` : "";

  if (frameMode === "product" || outputType.includes("product_asset")) {
    const productCount = assetSlots.filter((slot) => slot.role === "product").length;
    return `会把 ${productCount || assetSlots.length} 张商品参考整理成 1 张白底多视角商品素材。${requestText}`;
  }

  const planLabel = planCount <= 1 ? "1 张图" : `${planCount} 张图组`;
  const copyHint = assetSlots.some((slot) => slot.role === "copy")
    ? "文案会按画面文字、卖点、导出文案和禁用声明分开处理。"
    : "";
  return `会用${roleSummary || "当前素材"}生成 ${planLabel}。${requestText}${copyHint}`;
}

function buildRoleCountSummary(assetSlots: SlotViewModel[]): string {
  const counts = assetSlots.reduce<Record<GenerationFrameRole, number>>(
    (items, slot) => {
      items[slot.role] += 1;
      return items;
    },
    { product: 0, model: 0, style: 0, scene: 0, copy: 0 }
  );
  const parts = generationFrameRoles.flatMap((role) => {
    const count = counts[role];
    if (count <= 0) return [];
    return `${count} 个${roleView[role].label}`;
  });
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join("、")}和${parts[parts.length - 1]}`;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getGenerationFrameMode(outputType: string): GenerationFrameMode {
  const normalized = outputType.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized.includes("model")) return "model";
  if (normalized.includes("scene")) return "scene";
  if (normalized.includes("style") || normalized.includes("visual_style")) return "style";
  if (normalized.includes("template") || normalized.includes("custom")) return "template";
  return "product";
}

function getEmptyTaskStatusLabel(mode: GenerationFrameMode): string {
  if (mode === "product") return "待商品";
  if (mode === "model") return "待模特";
  if (mode === "scene") return "待场景";
  if (mode === "style") return "待风格";
  return "待需求";
}

function getFrameReferenceAssetCount(frame: ReturnType<typeof normalizeGenerationFrameState>): number {
  const bindings = frame.assets.length > 0
    ? frame.assets
    : generationFrameRoles
        .map((role) => frame.slots[role])
        .filter((binding): binding is GenerationFrameSlotBinding => Boolean(binding));
  const keys = new Set(bindings.filter(isConcreteFrameAsset).map((binding) => getGenerationFrameBindingKey(binding)));
  return keys.size;
}

function hasFrameProductReference(frame: ReturnType<typeof normalizeGenerationFrameState>): boolean {
  const bindings = frame.assets.length > 0
    ? frame.assets
    : generationFrameRoles
        .map((role) => frame.slots[role])
        .filter((binding): binding is GenerationFrameSlotBinding => Boolean(binding));
  return bindings.some((binding) => binding.role === "product" && isConcreteFrameAsset(binding));
}

function cleanGenerationFrameDisplayLabel(title: string): string {
  return title
    .replace(/图组生成框/g, "图组")
    .replace(/生成框/g, "图组")
    .trim();
}

function getImageSetOutputStats(outputs: GenerationFrameOutput[]): ImageSetOutputStats {
  return outputs.reduce<ImageSetOutputStats>(
    (stats, output) => {
      const status = output.status ?? "";
      stats.total += 1;
      if (status === "failed" || status === "error") stats.failed += 1;
      else if (status === "running") stats.active += 1;
      else if (status === "queued" || status === "pending" || status === "draft") stats.pending += 1;
      else if (status === "done" || status === "completed" || status === "ready" || output.url) stats.done += 1;
      else stats.pending += 1;
      return stats;
    },
    { total: 0, done: 0, failed: 0, active: 0, pending: 0 }
  );
}

function isRetryableOutput(output: GenerationFrameOutput): boolean {
  return (
    !!output.jobId &&
    (output.status === "failed" ||
      output.status === "cancelled" ||
      output.status === "error")
  );
}

function getImageSetStatus(
  frameStatus: GenerationFrameStatus,
  stats: ImageSetOutputStats
): ImageSetProductionStatus {
  if (frameStatus === "failed") return "failed";
  if (frameStatus === "review") return "review";
  if (stats.failed > 0) return "failed";
  if (stats.active > 0) return "generating";
  if (stats.pending > 0) return "queued";
  if (stats.done > 0) return "gallery";
  if (frameStatus === "queued" || frameStatus === "running") return "generating";
  return "plan";
}

function getImageSetSummary(
  stats: ImageSetOutputStats,
  status: ImageSetProductionStatus
): string {
  if (status === "gallery") return `已生成 ${stats.done} 张，可放大、重试或打开文件夹`;
  if (status === "review") return `已生成 ${stats.done}/${stats.total} 张，等待检查`;
  if (status === "failed") return `已保存 ${stats.done} 张，${stats.failed} 张需单项重试`;
  if (status === "generating") return `正在生成 ${stats.active} 张，已出图 ${stats.done}/${stats.total}`;
  if (status === "queued") return `已创建 ${stats.total} 个图片任务，可在任务队列中运行`;
  return "拖图，说需求，生成";
}

function getImageSetStatusLabel(status: ImageSetProductionStatus): string {
  if (status === "gallery") return "已生成";
  if (status === "review") return "待审核";
  if (status === "failed") return "需处理";
  if (status === "generating") return "生成中";
  if (status === "queued") return "待运行";
  return "待生成";
}

function isConcreteFrameAsset(binding: GenerationFrameSlotBinding): boolean {
  return Boolean(
    binding.referenceUrl ||
      binding.sourceAssetId ||
      binding.sourceNodeId ||
      binding.sourceComponentId ||
      binding.source === "canvas-asset" ||
      binding.source === "canvas-node" ||
      binding.source === "generated-output"
  );
}
