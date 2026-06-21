import { memo, type CSSProperties } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Check, ExternalLink, ImageIcon, PenLine, RefreshCw, Save, Wand2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { AssetPreview } from "@/components/canvas/asset-preview";
import { CopyNodeSummary } from "@/components/canvas/copy-node-summary";
import { GenerationFrameNode } from "@/components/canvas/generation-frame-node";
import {
  canvasIconMap,
  type CanvasNodeData,
} from "@/lib/canvas/workbench-data";
import {
  getCanvasNodeSemanticType,
  type CanvasNodeSemanticType,
} from "@/lib/canvas/connection-rules";

export type CanvasFlowNode = Node<CanvasNodeData, "canvasWorkflow">;

interface ArtifactGroupEditDetail {
  group: string;
  count?: number;
  ratios: string[];
  artifactIds: string[];
  artifactTitles: string[];
  providerRoles: string[];
  promptOnlyRoles: string[];
  copyModes: string[];
}

type ArtifactReviewStatus = "approved" | "pending" | "needs_redo" | "rejected" | "failed";
type ArtifactVisualQaStatus = "pass" | "warn" | "fail" | "pending";

interface ArtifactReviewStateDetail {
  artifactId?: string;
  artifactIds?: string[];
  status: ArtifactReviewStatus;
  title?: string;
  group?: string;
  note?: string;
}

const statusLabel: Record<CanvasNodeData["status"], string> = {
  ready: "就绪",
  running: "处理中",
  queued: "待生成",
  review: "待检查",
};

const kindStyle: Record<CanvasNodeData["kind"], string> = {
  asset: "border-warm-primary/25 bg-warm-paper",
  factory: "border-warm-clay/25 bg-warm-clay/5",
  output: "border-warm-sage/30 bg-warm-paper",
  review: "border-warm-line bg-warm-soft/60",
};

const kindLabel: Record<CanvasNodeData["kind"], string> = {
  asset: "资产",
  factory: "工厂",
  output: "输出",
  review: "质检",
};

type PortVisualType = CanvasNodeSemanticType | "unknown";

const semanticVisuals: Record<
  PortVisualType,
  {
    label: string;
    railClassName: string;
    badgeClassName: string;
    dotClassName: string;
    targetHandleClassName: string;
    sourceHandleClassName: string;
    inputHint: string;
    outputHint: string;
  }
> = {
  product: {
    label: "商品",
    railClassName: "bg-[#7A553C]",
    badgeClassName: "border-[#D7BFA4] bg-[#F4E9DE] text-[#5F422F]",
    dotClassName: "bg-[#7A553C]",
    targetHandleClassName: "!border-[#7A553C] !bg-[#FFF7ED]",
    sourceHandleClassName: "!border-warm-paper !bg-[#7A553C]",
    inputHint: "商品资产输入",
    outputHint: "商品基准、约束和参考图",
  },
  style: {
    label: "风格",
    railClassName: "bg-[#2F7D7E]",
    badgeClassName: "border-[#B9D7D4] bg-[#E7F3F1] text-[#255F60]",
    dotClassName: "bg-[#2F7D7E]",
    targetHandleClassName: "!border-[#2F7D7E] !bg-[#F0FAF8]",
    sourceHandleClassName: "!border-warm-paper !bg-[#2F7D7E]",
    inputHint: "风格参考输入",
    outputHint: "视觉语言和拍摄氛围",
  },
  model: {
    label: "模特",
    railClassName: "bg-[#7562B8]",
    badgeClassName: "border-[#CBC4EA] bg-[#F0EDFA] text-[#5B4A98]",
    dotClassName: "bg-[#7562B8]",
    targetHandleClassName: "!border-[#7562B8] !bg-[#F7F4FF]",
    sourceHandleClassName: "!border-warm-paper !bg-[#7562B8]",
    inputHint: "模特资产输入",
    outputHint: "人物、姿态和上身参考",
  },
  scene: {
    label: "场景",
    railClassName: "bg-[#2E6F95]",
    badgeClassName: "border-[#BBD1DF] bg-[#E8F2F7] text-[#255A78]",
    dotClassName: "bg-[#2E6F95]",
    targetHandleClassName: "!border-[#2E6F95] !bg-[#F1F8FC]",
    sourceHandleClassName: "!border-warm-paper !bg-[#2E6F95]",
    inputHint: "场景参考输入",
    outputHint: "空间、光线和环境约束",
  },
  copy: {
    label: "文案",
    railClassName: "bg-[#8A6A2F]",
    badgeClassName: "border-[#D9C99A] bg-[#F7F0D7] text-[#684F22]",
    dotClassName: "bg-[#8A6A2F]",
    targetHandleClassName: "!border-[#8A6A2F] !bg-[#FFF9E8]",
    sourceHandleClassName: "!border-warm-paper !bg-[#8A6A2F]",
    inputHint: "文案、卖点和禁用声明输入",
    outputHint: "画面文字、卖点参数、导出文案和禁用声明",
  },
  factory: {
    label: "工厂",
    railClassName: "bg-[#C97961]",
    badgeClassName: "border-[#E5BBAE] bg-[#F9E9E3] text-[#945543]",
    dotClassName: "bg-[#C97961]",
    targetHandleClassName: "!border-[#C97961] !bg-[#FFF4F0]",
    sourceHandleClassName: "!border-warm-paper !bg-[#C97961]",
    inputHint: "资产或规则输入",
    outputHint: "结构化组件和生成任务",
  },
  output: {
    label: "输出",
    railClassName: "bg-[#6F8F5E]",
    badgeClassName: "border-[#C6D7BA] bg-[#EEF6E9] text-[#526B45]",
    dotClassName: "bg-[#6F8F5E]",
    targetHandleClassName: "!border-[#6F8F5E] !bg-[#F4FAEF]",
    sourceHandleClassName: "!border-warm-paper !bg-[#6F8F5E]",
    inputHint: "生成链路输入",
    outputHint: "结果图、衍生图或返工输入",
  },
  platform: {
    label: "平台",
    railClassName: "bg-[#4E67A5]",
    badgeClassName: "border-[#C3CCE6] bg-[#EEF2FB] text-[#3E5182]",
    dotClassName: "bg-[#4E67A5]",
    targetHandleClassName: "!border-[#4E67A5] !bg-[#F4F6FF]",
    sourceHandleClassName: "!border-warm-paper !bg-[#4E67A5]",
    inputHint: "渠道规格输入",
    outputHint: "平台尺寸、命名和合规规则",
  },
  review: {
    label: "质检",
    railClassName: "bg-[#9B4D5F]",
    badgeClassName: "border-[#DDBBC3] bg-[#F8E9ED] text-[#753A49]",
    dotClassName: "bg-[#9B4D5F]",
    targetHandleClassName: "!border-[#9B4D5F] !bg-[#FFF2F5]",
    sourceHandleClassName: "!border-warm-paper !bg-[#9B4D5F]",
    inputHint: "待审输出输入",
    outputHint: "质检结论和返工线索",
  },
  quality: {
    label: "质检",
    railClassName: "bg-[#9B4D5F]",
    badgeClassName: "border-[#DDBBC3] bg-[#F8E9ED] text-[#753A49]",
    dotClassName: "bg-[#9B4D5F]",
    targetHandleClassName: "!border-[#9B4D5F] !bg-[#FFF2F5]",
    sourceHandleClassName: "!border-warm-paper !bg-[#9B4D5F]",
    inputHint: "待审输出输入",
    outputHint: "质检结论和返工线索",
  },
  unknown: {
    label: "未识别",
    railClassName: "bg-warm-line",
    badgeClassName: "border-warm-line bg-warm-bg text-warm-muted",
    dotClassName: "bg-warm-muted",
    targetHandleClassName: "!border-warm-muted !bg-warm-paper",
    sourceHandleClassName: "!border-warm-paper !bg-warm-muted",
    inputHint: "通用输入",
    outputHint: "通用输出",
  },
};

const handleBaseClassName =
  "semantic-port !z-20 !border-[3px] !shadow-sm !pointer-events-auto transition-transform hover:scale-125";

function WorkflowNodeComponent(props: NodeProps<CanvasFlowNode>) {
  const { id, data, selected } = props;

  if (data.componentType === "generation_frame") {
    return <GenerationFrameNode {...props} />;
  }

  if (data.source === "artifact-group-header") {
    return <ArtifactGroupHeaderNode data={data} selected={selected} />;
  }

  const Icon = canvasIconMap[data.iconName];
  const semanticType = getCanvasNodeSemanticType({ id, data }) ?? "unknown";
  const semanticVisual = semanticVisuals[semanticType];
  const semanticClassName = `semantic-port--${semanticType}`;
  const kindText = kindLabel[data.kind];
  const isCopyNode = semanticType === "copy";
  const isVisualNode = shouldUseVisualNodeLayout(semanticType, data);
  const previewSize = getVisualNodePreviewSize(semanticType, data);
  const previewFit = getVisualNodePreviewFit(semanticType, data);
  const previewAspectRatio = getVisualNodeAspectRatio(data);
  const previewModeLabel = getVisualNodePreviewModeLabel(semanticType, data);
  const openPreview = getOpenPreviewHandler(data);
  const isArtifactResult = data.source === "artifact-history";
  const artifactGroupBadge = getArtifactNodeGroupBadge(data);
  const artifactGroupEditDetail = isArtifactResult ? getArtifactGroupEditDetail(data) : null;
  const artifactReviewBadge = isArtifactResult ? getArtifactReviewBadge(data) : null;
  const artifactVisualQaBadge = isArtifactResult ? getArtifactVisualQaBadge(data) : null;
  const artifactReviewDetail = isArtifactResult ? getArtifactReviewDetail(data) : null;
  const artifactCaptionMeta = getArtifactNodeCaptionMeta(data);
  const artifactLayoutStyle = getArtifactNodeLayoutStyle(data);
  const nodeTitle = isArtifactResult
    ? `${getArtifactNodeFullTitle(data)} · ${semanticVisual.label} · ${kindText}`
    : `${data.label} · ${semanticVisual.label} · ${kindText}`;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border text-left shadow-sm transition-all",
        isVisualNode
          ? isArtifactResult
            ? "p-0 shadow-none"
            : "min-w-[308px] max-w-[356px] p-0"
          : isCopyNode
            ? "min-w-[308px] max-w-[348px] p-0"
            : "min-w-[218px] p-2.5 pl-3.5",
        "text-warm-ink backdrop-blur-sm",
        selected && "ring-2 ring-warm-primary/25 shadow-md",
        isArtifactResult
          ? "cursor-zoom-in rounded-[10px] border-transparent bg-transparent shadow-none hover:z-10 hover:scale-[1.005]"
          : kindStyle[data.kind]
      )}
      data-node-id={id}
      data-semantic-type={semanticType}
      title={nodeTitle}
      style={artifactLayoutStyle}
      onClick={(event) => {
        if (!shouldOpenNodePreview(data)) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("a,button,input,textarea,select")) return;
        openPreview?.(id);
      }}
    >
      {!isArtifactResult && (
        <span
          aria-hidden
          className={cn("absolute inset-y-2 left-0 w-1 rounded-r", semanticVisual.railClassName)}
        />
      )}
      {!isArtifactResult && (
        <Handle
          type="target"
          position={Position.Left}
          title={`${semanticVisual.label} · 输入端口：${semanticVisual.inputHint}`}
          aria-label={`${data.label} ${semanticVisual.label}输入端口`}
          className={cn(
            handleBaseClassName,
            "semantic-port--target !h-3 !w-3 !rounded-[4px]",
            semanticClassName,
            semanticVisual.targetHandleClassName
          )}
        />
      )}
      {isCopyNode ? (
        <CopyNodeSummary
          data={data}
          statusText={statusLabel[data.status]}
          kindText={kindText}
          badgeClassName={semanticVisual.badgeClassName}
          dotClassName={semanticVisual.dotClassName}
        />
      ) : isVisualNode ? (
        <>
          <div
            className={cn(
              "relative bg-warm-bg",
              isArtifactResult
                ? "overflow-hidden rounded-[6px] bg-transparent shadow-none"
                : "border-b border-warm-line/50"
            )}
          >
            <AssetPreview
              src={data.previewUrl}
              alt={data.previewAlt ?? getArtifactNodeFullTitle(data)}
              icon={Icon}
              size={previewSize}
              fit={previewFit}
              aspectRatio={previewAspectRatio}
              className={cn(
                "rounded-none border-0 bg-warm-paper",
                isArtifactResult && "rounded-[6px] border-0 bg-transparent shadow-none"
              )}
            />
            <div
              className={cn(
                "pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-warm-ink/45 to-transparent",
                isArtifactResult && "opacity-100"
              )}
            />
            {isArtifactResult ? (
              <div className="absolute left-2 top-2 flex max-w-[calc(100%-16px)] flex-wrap gap-1 opacity-100">
                {artifactGroupBadge && (
                  <span className={cn(
                    "rounded border px-1.5 py-0.5 text-[10px] leading-none shadow-sm backdrop-blur",
                    artifactGroupBadge.isGroupStart
                      ? "border-warm-primary/20 bg-warm-primary/90 text-white"
                      : "border-warm-paper/35 bg-warm-ink/45 text-warm-paper/90"
                  )}>
                    {artifactGroupBadge.label}
                  </span>
                )}
                {getVisualNodeRatioLabel(data) && (
                  <span className="rounded border border-warm-paper/25 bg-warm-paper/75 px-1.5 py-0.5 text-[10px] leading-none text-warm-ink/75 shadow-sm backdrop-blur">
                    {getVisualNodeRatioLabel(data)}
                  </span>
                )}
              </div>
            ) : (
              <div className="absolute left-2 top-2 flex max-w-[calc(100%-16px)] flex-wrap gap-1">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] leading-none shadow-sm backdrop-blur",
                    semanticVisual.badgeClassName
                  )}
                  title={`语义类型：${semanticVisual.label}`}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", semanticVisual.dotClassName)} />
                  {semanticVisual.label}
                </span>
                <span className="rounded border border-warm-line/60 bg-warm-paper/90 px-1.5 py-0.5 text-[10px] leading-none text-warm-muted shadow-sm backdrop-blur">
                  {statusLabel[data.status]}
                </span>
              </div>
            )}
            <div className={cn(
              "absolute bottom-2 left-2 flex max-w-[calc(100%-16px)] items-center gap-1.5",
              isArtifactResult && "left-auto right-2 z-10 rounded-md border border-warm-paper/25 bg-warm-ink/20 p-1 opacity-100 shadow-sm backdrop-blur"
            )}>
              {!isArtifactResult && (
                <span className="inline-flex items-center gap-1 rounded border border-warm-paper/35 bg-warm-ink/65 px-1.5 py-0.5 text-[10px] leading-none text-warm-paper shadow-sm backdrop-blur">
                  <ImageIcon className="h-3 w-3" />
                  {previewModeLabel}
                </span>
              )}
              {isArtifactResult && artifactGroupEditDetail && (
                <button
                  type="button"
                  aria-label={`调整这组：${artifactGroupEditDetail.group}`}
                  className="nodrag nopan inline-flex h-8 items-center gap-1 rounded border border-warm-paper/45 bg-warm-paper/95 px-2 text-[11px] leading-none text-warm-ink shadow-sm backdrop-blur transition hover:bg-warm-paper"
                  title={`只调整「${artifactGroupEditDetail.group}」这一组`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    dispatchArtifactGroupEdit(artifactGroupEditDetail);
                  }}
                >
                  <PenLine className="h-3 w-3" />
                  <span className="hidden sm:inline">调整组</span>
                </button>
              )}
              {isArtifactResult && artifactReviewDetail && (
                <>
                  <button
                    type="button"
                    aria-label={`让 Agent 修改：${data.label}`}
                    className="nodrag nopan inline-flex h-8 items-center gap-1 rounded border border-warm-paper/45 bg-warm-paper/95 px-2 text-[11px] leading-none text-warm-ink shadow-sm backdrop-blur transition hover:bg-warm-paper hover:text-warm-primary"
                    title="让 Agent 只改这张"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      dispatchArtifactEdit(data, id);
                    }}
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">改图</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`保存为资产：${data.label}`}
                    className="nodrag nopan inline-flex h-8 w-8 items-center justify-center rounded border border-warm-paper/45 bg-warm-paper/95 text-warm-ink shadow-sm backdrop-blur transition hover:bg-warm-paper hover:text-warm-primary"
                    title="保存为资产"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      dispatchArtifactSave(data, id);
                    }}
                  >
                    <Save className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`保留：${data.label}`}
                    className="nodrag nopan inline-flex h-8 w-8 items-center justify-center rounded border border-warm-paper/45 bg-warm-paper/95 text-emerald-700 shadow-sm backdrop-blur transition hover:bg-emerald-50"
                    title="保留这张"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      dispatchArtifactReviewState({ ...artifactReviewDetail, status: "approved", note: "用户标记保留" });
                    }}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`重做：${data.label}`}
                    className="nodrag nopan inline-flex h-8 w-8 items-center justify-center rounded border border-warm-paper/45 bg-warm-paper/95 text-amber-700 shadow-sm backdrop-blur transition hover:bg-amber-50"
                    title="按原上下文重做这张"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      dispatchArtifactRetry(data, id);
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`淘汰：${data.label}`}
                    className="nodrag nopan inline-flex h-8 w-8 items-center justify-center rounded border border-warm-paper/45 bg-warm-paper/95 text-zinc-600 shadow-sm backdrop-blur transition hover:bg-zinc-50"
                    title="淘汰这张"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      dispatchArtifactReviewState({ ...artifactReviewDetail, status: "rejected", note: "用户标记淘汰" });
                    }}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
              {(data.previewUrl || data.referenceUrl) && (
                <button
                  type="button"
                  data-canvas-preview-node-id={id}
                  className={cn(
                    "nodrag nopan inline-flex items-center gap-1 rounded border border-warm-paper/35 bg-warm-paper/90 px-1.5 py-0.5 text-[10px] leading-none text-warm-ink shadow-sm backdrop-blur transition hover:bg-warm-paper",
                    isArtifactResult && "h-8 px-2 text-[11px]"
                  )}
                  title="查看大图、参考图和 prompt"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    openPreview?.(id);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    openPreview?.(id);
                  }}
                >
                  <ExternalLink className="h-3 w-3" />
                  <span className={cn(isArtifactResult && "hidden sm:inline")}>详情</span>
                </button>
              )}
            </div>
            {isArtifactResult && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-warm-ink/70 via-warm-ink/20 to-transparent px-3 pb-2.5 pt-10 opacity-0 transition-opacity group-hover:opacity-100">
                <div className="line-clamp-1 text-[12px] font-medium leading-tight text-warm-paper">
                  {data.label}
                </div>
                {getVisualNodeRatioLabel(data) && (
                  <div className="mt-0.5 text-[10px] leading-none text-warm-paper/75">
                    {getVisualNodeRatioLabel(data)}
                  </div>
                )}
              </div>
            )}
          </div>
          {isArtifactResult && (
            <div className="mt-2 px-1 text-left">
              <div className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1 line-clamp-1 text-[12px] font-medium leading-tight text-warm-ink">
                  {data.label}
                </div>
                {artifactReviewBadge && (
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none",
                      getArtifactReviewBadgeClassName(artifactReviewBadge.status)
                    )}
                    title={`挑图状态：${artifactReviewBadge.label}`}
                  >
                    {artifactReviewBadge.label}
                  </span>
                )}
                {artifactVisualQaBadge && (
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none",
                      getArtifactVisualQaBadgeClassName(artifactVisualQaBadge.status)
                    )}
                    title={`视觉 QA：${artifactVisualQaBadge.label}`}
                  >
                    {artifactVisualQaBadge.label}
                  </span>
                )}
              </div>
              {artifactCaptionMeta && (
                <div className="mt-0.5 line-clamp-1 text-[10px] leading-tight text-warm-muted">
                  {artifactCaptionMeta}
                </div>
              )}
              <div className="mt-1 text-[10px] leading-tight text-warm-muted/80">
                点击图片查看参考图和 prompt
              </div>
            </div>
          )}
          {!isArtifactResult && (
            <div className="p-2.5 pl-3.5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 line-clamp-1 text-sm font-medium leading-tight text-warm-ink">{data.label}</h3>
                <span className="shrink-0 rounded bg-warm-line/30 px-1.5 py-0.5 text-[10px] leading-none text-warm-muted">
                  {kindText}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-snug text-warm-muted">{data.caption}</p>
              {data.metrics.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {data.metrics.slice(0, 4).map((metric) => (
                    <span
                      key={metric}
                      className="rounded bg-warm-bg px-2 py-1 text-[10px] leading-none text-warm-muted"
                    >
                      {metric}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-start gap-2.5">
            <AssetPreview
              src={data.previewUrl}
              alt={data.previewAlt ?? data.label}
              icon={Icon}
              size="sm"
              fit="contain"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-medium leading-tight text-warm-ink">{data.label}</h3>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] leading-none",
                      semanticVisual.badgeClassName
                    )}
                    title={`语义类型：${semanticVisual.label}`}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", semanticVisual.dotClassName)} />
                    {semanticVisual.label}
                  </span>
                  <span className="rounded bg-warm-line/30 px-1.5 py-0.5 text-[10px] leading-none text-warm-muted">
                    {statusLabel[data.status]}
                  </span>
                </div>
              </div>
              <p className="mt-1 text-xs leading-snug text-warm-muted">{data.caption}</p>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {data.metrics.map((metric) => (
              <span
                key={metric}
                className="rounded bg-warm-bg px-2 py-1 text-[10px] leading-none text-warm-muted"
              >
                {metric}
              </span>
            ))}
          </div>
        </>
      )}
      {!isArtifactResult && (
        <Handle
          type="source"
          position={Position.Right}
          title={`${semanticVisual.label} · 输出端口：${semanticVisual.outputHint}`}
          aria-label={`${data.label} ${semanticVisual.label}输出端口`}
          className={cn(
            handleBaseClassName,
            "semantic-port--source !h-3.5 !w-3.5 !rounded-full",
            semanticClassName,
            semanticVisual.sourceHandleClassName
          )}
        />
      )}
    </div>
  );
}

export const WorkflowNode = memo(WorkflowNodeComponent);

function shouldUseVisualNodeLayout(
  semanticType: PortVisualType,
  data: CanvasNodeData
): boolean {
  if (!data.previewUrl) return false;
  if (data.kind === "output" || data.source === "artifact-history") return true;
  return semanticType === "product" || semanticType === "model" || semanticType === "scene" || semanticType === "style";
}

function shouldOpenNodePreview(data: CanvasNodeData): boolean {
  if (!data.previewUrl && !data.referenceUrl) return false;
  return data.kind === "asset" || data.kind === "output" || data.source === "artifact-history";
}

function getOpenPreviewHandler(data: CanvasNodeData): ((nodeId: string) => void) | undefined {
  return typeof data.onOpenPreview === "function"
    ? data.onOpenPreview as (nodeId: string) => void
    : undefined;
}

function getVisualNodePreviewSize(
  semanticType: PortVisualType,
  data: CanvasNodeData
): "canvasImage" | "canvasResult" | "canvasResultAuto" {
  if (data.source === "artifact-history") return "canvasResultAuto";
  if (data.kind === "output") return "canvasResult";
  if (semanticType === "scene" || semanticType === "style") return "canvasResult";
  return "canvasImage";
}

function getArtifactNodeFullTitle(data: CanvasNodeData): string {
  const parameters = typeof data.parameters === "object" && data.parameters
    ? data.parameters as Record<string, unknown>
    : undefined;
  const fullTitle = parameters?.fullTitle;
  return typeof fullTitle === "string" && fullTitle.trim() ? fullTitle.trim() : data.label;
}

function getArtifactNodeGroupBadge(data: CanvasNodeData): { label: string; isGroupStart: boolean } | null {
  if (data.source !== "artifact-history") return null;
  const parameters = typeof data.parameters === "object" && data.parameters
    ? data.parameters as Record<string, unknown>
    : undefined;
  if (parameters?.layoutHeaderAvailable === true) return null;
  const category = typeof data.category === "string" && data.category.trim()
    ? data.category.trim()
    : "";
  if (!category) return null;

  const isGroupStart = parameters?.layoutGroupStart === true;
  const groupCount = typeof parameters?.layoutGroupCount === "number" && Number.isFinite(parameters.layoutGroupCount)
    ? parameters.layoutGroupCount
    : undefined;

  return {
    label: isGroupStart && groupCount && groupCount > 1
      ? `${category} · ${groupCount} 张`
      : category,
    isGroupStart,
  };
}

function getArtifactNodeLayoutStyle(data: CanvasNodeData): CSSProperties | undefined {
  if (data.source !== "artifact-history") return undefined;
  const parameters = typeof data.parameters === "object" && data.parameters
    ? data.parameters as Record<string, unknown>
    : undefined;
  const width = typeof parameters?.layoutWidth === "number" && Number.isFinite(parameters.layoutWidth)
    ? parameters.layoutWidth
    : undefined;

  return width
    ? { width, maxWidth: width }
    : { width: 328, maxWidth: 328 };
}

function getArtifactNodeCaptionMeta(data: CanvasNodeData): string {
  if (data.source !== "artifact-history") return "";
  return [
    typeof data.category === "string" ? data.category : "",
    getVisualNodeRatioLabel(data),
  ]
    .filter(Boolean)
    .join(" · ");
}

function getArtifactReviewBadge(data: CanvasNodeData): { status: ArtifactReviewStatus; label: string } | null {
  if (data.source !== "artifact-history") return null;
  const parameters = getNodeParameters(data);
  const status = getArtifactReviewStatusParameter(parameters?.reviewStatus);
  const label = typeof parameters?.reviewLabel === "string" && parameters.reviewLabel.trim()
    ? parameters.reviewLabel.trim()
    : getArtifactReviewStatusLabel(status);
  return { status, label };
}

function getArtifactVisualQaBadge(data: CanvasNodeData): { status: ArtifactVisualQaStatus; label: string } | null {
  if (data.source !== "artifact-history") return null;
  const parameters = getNodeParameters(data);
  const status = getArtifactVisualQaStatusParameter(parameters?.visualQaStatus);
  const label = typeof parameters?.visualQaLabel === "string" && parameters.visualQaLabel.trim()
    ? parameters.visualQaLabel.trim()
    : getArtifactVisualQaStatusLabel(status);
  return { status, label };
}

function getArtifactReviewDetail(data: CanvasNodeData): ArtifactReviewStateDetail | null {
  if (data.source !== "artifact-history") return null;
  const artifactId = typeof data.artifactId === "string" && data.artifactId.trim()
    ? data.artifactId.trim()
    : "";
  if (!artifactId) return null;
  return {
    artifactId,
    status: getArtifactReviewBadge(data)?.status ?? "pending",
    title: getArtifactNodeFullTitle(data),
  };
}

function getArtifactGroupEditDetail(data: CanvasNodeData): ArtifactGroupEditDetail | null {
  const parameters = typeof data.parameters === "object" && data.parameters
    ? data.parameters as Record<string, unknown>
    : undefined;
  const group = typeof parameters?.layoutGroup === "string" && parameters.layoutGroup.trim()
    ? parameters.layoutGroup.trim()
    : typeof data.category === "string" && data.category.trim()
      ? data.category.trim()
      : data.label;
  if (!group) return null;
  const count = typeof parameters?.layoutGroupCount === "number" && Number.isFinite(parameters.layoutGroupCount)
    ? parameters.layoutGroupCount
    : undefined;
  return {
    group,
    count,
    ratios: getStringArrayParameter(parameters?.layoutRatios),
    artifactIds: getStringArrayParameter(parameters?.layoutArtifactIds),
    artifactTitles: getStringArrayParameter(parameters?.layoutArtifactTitles),
    providerRoles: getStringArrayParameter(parameters?.layoutProviderRoles),
    promptOnlyRoles: getStringArrayParameter(parameters?.layoutPromptOnlyRoles),
    copyModes: getStringArrayParameter(parameters?.layoutCopyModes),
  };
}

function dispatchArtifactGroupEdit(detail: ArtifactGroupEditDetail): void {
  window.dispatchEvent(new CustomEvent("image-master:artifact-group-edit", { detail }));
}

function dispatchArtifactReviewState(detail: ArtifactReviewStateDetail): void {
  window.dispatchEvent(new CustomEvent("image-master:artifact-review-state", { detail }));
}

function dispatchArtifactGroupReviewState(detail: ArtifactReviewStateDetail): void {
  window.dispatchEvent(new CustomEvent("image-master:artifact-group-review-state", { detail }));
}

function dispatchArtifactGroupRetry(detail: ArtifactGroupEditDetail): void {
  window.dispatchEvent(new CustomEvent("image-master:artifact-group-retry", { detail }));
}

function dispatchArtifactEdit(data: CanvasNodeData, nodeId: string): void {
  const group = getArtifactGroupEditDetail(data)?.group;
  window.dispatchEvent(
    new CustomEvent("image-master:generation-frame-output-edit", {
      detail: {
        nodeId,
        artifactId: getStringParameter(data.artifactId),
        jobId: getStringParameter(data.jobId),
        url: getStringParameter(data.referenceUrl) || getStringParameter(data.previewUrl),
        title: getArtifactNodeFullTitle(data),
        status: getStringParameter(data.artifactStatus),
        group,
      },
    })
  );
}

function dispatchArtifactSave(data: CanvasNodeData, nodeId: string): void {
  window.dispatchEvent(
    new CustomEvent("image-master:generation-frame-output-save", {
      detail: {
        nodeId,
        artifactId: getStringParameter(data.artifactId),
        jobId: getStringParameter(data.jobId),
        url: getStringParameter(data.referenceUrl) || getStringParameter(data.previewUrl),
        title: getArtifactNodeFullTitle(data),
        status: getStringParameter(data.artifactStatus),
      },
    })
  );
}

function dispatchArtifactRetry(data: CanvasNodeData, nodeId: string): void {
  const group = getArtifactGroupEditDetail(data)?.group;
  window.dispatchEvent(
    new CustomEvent("image-master:generation-frame-output-retry", {
      detail: {
        nodeId,
        artifactId: getStringParameter(data.artifactId),
        jobId: getStringParameter(data.jobId),
        url: getStringParameter(data.referenceUrl) || getStringParameter(data.previewUrl),
        title: getArtifactNodeFullTitle(data),
        status: getStringParameter(data.artifactStatus),
        group,
      },
    })
  );
}

function getVisualNodePreviewFit(
  semanticType: PortVisualType,
  data: CanvasNodeData
): "cover" | "contain" {
  if (semanticType === "product") return "contain";
  if (data.source === "artifact-history") return "contain";
  if (data.kind === "output") return "cover";
  return "cover";
}

function getVisualNodeAspectRatio(data: CanvasNodeData): number | undefined {
  const parameters = typeof data.parameters === "object" && data.parameters
    ? data.parameters as Record<string, unknown>
    : undefined;
  const value = parameters?.aspectRatio;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function getVisualNodeRatioLabel(data: CanvasNodeData): string | undefined {
  const parameters = typeof data.parameters === "object" && data.parameters
    ? data.parameters as Record<string, unknown>
    : undefined;
  const ratio = parameters?.ratio;
  return typeof ratio === "string" && ratio.trim() ? ratio.trim() : undefined;
}

function getVisualNodePreviewModeLabel(
  semanticType: PortVisualType,
  data: CanvasNodeData
): string {
  if (data.source === "artifact-history") return "结果图";
  if (data.kind === "output") return "输出预览";
  if (semanticType === "product") return "商品图";
  if (semanticType === "model") return "模特图";
  if (semanticType === "style") return "风格图";
  if (semanticType === "scene") return "场景图";
  return "参考图";
}

function ArtifactGroupHeaderNode({
  data,
  selected,
}: {
  data: CanvasNodeData;
  selected: boolean;
}) {
  const parameters = typeof data.parameters === "object" && data.parameters
    ? data.parameters as Record<string, unknown>
    : undefined;
  const ratios = Array.isArray(parameters?.layoutRatios)
    ? parameters.layoutRatios.filter((ratio): ratio is string => typeof ratio === "string" && ratio.trim().length > 0)
    : [];
  const artifactIds = getStringArrayParameter(parameters?.layoutArtifactIds);
  const artifactTitles = getStringArrayParameter(parameters?.layoutArtifactTitles);
  const providerRoles = getStringArrayParameter(parameters?.layoutProviderRoles);
  const promptOnlyRoles = getStringArrayParameter(parameters?.layoutPromptOnlyRoles);
  const copyModes = getStringArrayParameter(parameters?.layoutCopyModes);
  const reviewSummary = getStringArrayParameter(parameters?.layoutReviewSummary);
  const visualQaSummary = getStringArrayParameter(parameters?.layoutVisualQaSummary);
  const filterActive = parameters?.layoutFilterActive === true;
  const filteredCount = typeof parameters?.layoutFilteredCount === "number" && Number.isFinite(parameters.layoutFilteredCount)
    ? parameters.layoutFilteredCount
    : undefined;
  const filteredTotalCount = typeof parameters?.layoutFilteredTotalCount === "number" && Number.isFinite(parameters.layoutFilteredTotalCount)
    ? parameters.layoutFilteredTotalCount
    : undefined;
  const filteredArtifactIds = getStringArrayParameter(parameters?.layoutFilteredArtifactIds);
  const filteredArtifactTitles = getStringArrayParameter(parameters?.layoutFilteredArtifactTitles);
  const filteredReviewSummary = getStringArrayParameter(parameters?.layoutFilteredReviewSummary);
  const filteredVisualQaSummary = getStringArrayParameter(parameters?.layoutFilteredVisualQaSummary);
  const groupHighlighted = parameters?.layoutGroupHighlighted === true;
  const count = typeof parameters?.layoutGroupCount === "number" && Number.isFinite(parameters.layoutGroupCount)
    ? parameters.layoutGroupCount
    : undefined;
  const width = typeof parameters?.layoutWidth === "number" && Number.isFinite(parameters.layoutWidth)
    ? parameters.layoutWidth
    : 960;
  const countText = filterActive && filteredCount !== undefined && filteredTotalCount
    ? `筛选后 ${filteredCount} / 共 ${filteredTotalCount}`
    : count ? `${count} 张` : data.caption;
  const activeReviewSummary = filterActive && filteredReviewSummary.length > 0
    ? filteredReviewSummary
    : reviewSummary;
  const activeVisualQaSummary = filterActive && filteredVisualQaSummary.length > 0
    ? filteredVisualQaSummary
    : visualQaSummary;
  const actionArtifactIds = filterActive && filteredArtifactIds.length > 0
    ? filteredArtifactIds
    : artifactIds;
  const actionArtifactTitles = filterActive && filteredArtifactTitles.length > 0
    ? filteredArtifactTitles
    : artifactTitles;
  const actionCount = filterActive && filteredCount !== undefined
    ? filteredCount
    : count;
  const actionScopeText = filterActive && filteredCount !== undefined
    ? `当前筛选的 ${filteredCount} 张`
    : "整组";
  const captionParts = [
    countText,
    ratios.length > 0 ? ratios.slice(0, 4).join(" / ") : "",
    activeReviewSummary.length > 0 ? activeReviewSummary.slice(0, 2).join(" / ") : "",
    activeVisualQaSummary.length > 0 ? activeVisualQaSummary.slice(0, 1).join(" / ") : "",
  ].filter(Boolean);
  const handleEditGroup = () => {
    dispatchArtifactGroupEdit({
      group: data.label,
      count: actionCount,
      ratios,
      artifactIds: actionArtifactIds,
      artifactTitles: actionArtifactTitles,
      providerRoles,
      promptOnlyRoles,
      copyModes,
    });
  };

  return (
    <div
      className={cn(
        "pointer-events-auto nodrag nopan flex h-[30px] items-center gap-3 text-warm-ink transition-all",
        selected && "rounded ring-2 ring-warm-primary/15",
        groupHighlighted && "rounded-md bg-warm-primary-soft/70 px-2 ring-2 ring-warm-primary/25 shadow-sm"
      )}
      data-artifact-group-header="true"
      data-artifact-group-highlighted={groupHighlighted ? "true" : undefined}
      style={{ width, maxWidth: width }}
      title={`${data.label}${captionParts.length ? ` · ${captionParts.join(" · ")}` : ""}`}
    >
      <span className="shrink-0 text-[13px] font-semibold leading-none text-warm-ink">
        {data.label}
      </span>
      {captionParts.length > 0 && (
        <span className="shrink-0 text-[11px] leading-none text-warm-muted">
          {captionParts.join(" · ")}
        </span>
      )}
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          dispatchArtifactGroupReviewState({
            artifactIds: actionArtifactIds,
            group: data.label,
            status: "approved",
            note: filterActive ? "用户保留当前筛选子集" : "用户保留整组",
          });
        }}
        className="nodrag nopan inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700 shadow-sm transition hover:border-emerald-300"
        title={`保留「${data.label}」${actionScopeText}`}
      >
        <Check className="h-3 w-3" />
        保留这组
      </button>
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          dispatchArtifactGroupRetry({
            group: data.label,
            count: actionCount,
            ratios,
            artifactIds: actionArtifactIds,
            artifactTitles: actionArtifactTitles,
            providerRoles,
            promptOnlyRoles,
            copyModes,
          });
        }}
        className="nodrag nopan inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 text-[11px] font-medium text-amber-700 shadow-sm transition hover:border-amber-300"
        title={`按原上下文重做「${data.label}」${actionScopeText}`}
      >
        <RefreshCw className="h-3 w-3" />
        重做这组
      </button>
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          dispatchArtifactGroupReviewState({
            artifactIds: actionArtifactIds,
            group: data.label,
            status: "rejected",
            note: filterActive ? "用户淘汰当前筛选子集" : "用户淘汰整组",
          });
        }}
        className="nodrag nopan inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-[11px] font-medium text-zinc-600 shadow-sm transition hover:border-zinc-300"
        title={`淘汰「${data.label}」${actionScopeText}`}
      >
        <XCircle className="h-3 w-3" />
        淘汰这组
      </button>
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          handleEditGroup();
        }}
        className="nodrag nopan inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-warm-line/70 bg-warm-paper px-2 text-[11px] font-medium text-warm-muted shadow-sm transition hover:border-warm-primary/35 hover:text-warm-primary"
        title={`只调整「${data.label}」${actionScopeText}`}
      >
        <PenLine className="h-3 w-3" />
        调整这组
      </button>
      <span className="h-px min-w-10 flex-1 bg-warm-line/70" />
    </div>
  );
}

function getStringArrayParameter(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function getStringParameter(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNodeParameters(data: CanvasNodeData): Record<string, unknown> | undefined {
  return typeof data.parameters === "object" && data.parameters
    ? data.parameters as Record<string, unknown>
    : undefined;
}

function getArtifactReviewStatusParameter(value: unknown): ArtifactReviewStatus {
  if (value === "approved" || value === "needs_redo" || value === "rejected" || value === "failed") {
    return value;
  }
  return "pending";
}

function getArtifactVisualQaStatusParameter(value: unknown): ArtifactVisualQaStatus {
  if (value === "pass" || value === "warn" || value === "fail" || value === "pending") {
    return value;
  }
  return "pending";
}

function getArtifactReviewStatusLabel(status: ArtifactReviewStatus): string {
  if (status === "approved") return "可用";
  if (status === "needs_redo") return "建议重做";
  if (status === "rejected") return "已淘汰";
  if (status === "failed") return "生成失败";
  return "待检查";
}

function getArtifactVisualQaStatusLabel(status: ArtifactVisualQaStatus): string {
  if (status === "pass") return "QA 通过";
  if (status === "warn") return "QA 风险";
  if (status === "fail") return "QA 失败";
  return "QA 待查";
}

function getArtifactReviewBadgeClassName(status: ArtifactReviewStatus): string {
  if (status === "approved") return "bg-emerald-50 text-emerald-700";
  if (status === "needs_redo") return "bg-amber-50 text-amber-700";
  if (status === "rejected") return "bg-zinc-100 text-zinc-600";
  if (status === "failed") return "bg-red-50 text-red-700";
  return "bg-warm-bg text-warm-muted";
}

function getArtifactVisualQaBadgeClassName(status: ArtifactVisualQaStatus): string {
  if (status === "pass") return "bg-emerald-50 text-emerald-700";
  if (status === "warn") return "bg-amber-50 text-amber-700";
  if (status === "fail") return "bg-red-50 text-red-700";
  return "bg-warm-bg text-warm-muted";
}
