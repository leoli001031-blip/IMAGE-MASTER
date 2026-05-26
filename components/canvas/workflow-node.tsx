import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ExternalLink, ImageIcon } from "lucide-react";
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

  const Icon = canvasIconMap[data.iconName];
  const semanticType = getCanvasNodeSemanticType({ id, data }) ?? "unknown";
  const semanticVisual = semanticVisuals[semanticType];
  const semanticClassName = `semantic-port--${semanticType}`;
  const kindText = kindLabel[data.kind];
  const isCopyNode = semanticType === "copy";
  const isVisualNode = shouldUseVisualNodeLayout(semanticType, data);
  const previewSize = getVisualNodePreviewSize(semanticType, data);
  const previewFit = getVisualNodePreviewFit(semanticType, data);
  const previewModeLabel = getVisualNodePreviewModeLabel(semanticType, data);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border text-left shadow-sm transition-all",
        isVisualNode
          ? "min-w-[308px] max-w-[356px] p-0"
          : isCopyNode
            ? "min-w-[308px] max-w-[348px] p-0"
            : "min-w-[218px] p-2.5 pl-3.5",
        "text-warm-ink backdrop-blur-sm",
        selected && "ring-2 ring-warm-primary/25 shadow-md",
        kindStyle[data.kind]
      )}
      data-node-id={id}
      data-semantic-type={semanticType}
      title={`${data.label} · ${semanticVisual.label} · ${kindText}`}
    >
      <span
        aria-hidden
        className={cn("absolute inset-y-2 left-0 w-1 rounded-r", semanticVisual.railClassName)}
      />
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
          <div className="relative border-b border-warm-line/50 bg-warm-bg">
            <AssetPreview
              src={data.previewUrl}
              alt={data.previewAlt ?? data.label}
              icon={Icon}
              size={previewSize}
              fit={previewFit}
              className="rounded-none border-0 bg-warm-paper"
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-warm-ink/45 to-transparent" />
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
            <div className="absolute bottom-2 left-2 flex max-w-[calc(100%-16px)] items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded border border-warm-paper/35 bg-warm-ink/65 px-1.5 py-0.5 text-[10px] leading-none text-warm-paper shadow-sm backdrop-blur">
                <ImageIcon className="h-3 w-3" />
                {previewModeLabel}
              </span>
              {data.previewUrl && (
                <a
                  href={data.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="nodrag nopan inline-flex items-center gap-1 rounded border border-warm-paper/35 bg-warm-paper/90 px-1.5 py-0.5 text-[10px] leading-none text-warm-ink shadow-sm backdrop-blur transition hover:bg-warm-paper"
                  title="打开大图"
                  onClick={(event) => event.stopPropagation()}
                >
                  <ExternalLink className="h-3 w-3" />
                  大图
                </a>
              )}
            </div>
          </div>
          <div className="p-2.5 pl-3.5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="min-w-0 text-sm font-medium leading-tight text-warm-ink">{data.label}</h3>
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

function getVisualNodePreviewSize(
  semanticType: PortVisualType,
  data: CanvasNodeData
): "canvasImage" | "canvasResult" {
  if (data.kind === "output" || data.source === "artifact-history") return "canvasResult";
  if (semanticType === "scene" || semanticType === "style") return "canvasResult";
  return "canvasImage";
}

function getVisualNodePreviewFit(
  semanticType: PortVisualType,
  data: CanvasNodeData
): "cover" | "contain" {
  if (semanticType === "product") return "contain";
  if (data.source === "artifact-history") return "cover";
  if (data.kind === "output") return "cover";
  return "cover";
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
