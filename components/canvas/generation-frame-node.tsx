"use client";

import { memo, useCallback, useEffect, useRef, useState, type ChangeEvent, type ComponentType, type DragEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Box,
  Brush,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Shirt,
  Sparkles,
  Star,
  Upload,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { AssetPreview } from "@/components/canvas/asset-preview";
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
  description: string;
  icon: LucideIcon;
  binding: GenerationFrameSlotBinding;
};

const roleView: Record<
  GenerationFrameRole,
  {
    label: string;
    description: string;
    icon: LucideIcon;
    railClassName: string;
    badgeClassName: string;
    iconClassName: string;
    handleClassName: string;
  }
> = {
  product: {
    label: "商品",
    description: "商品形态、材质、颜色和卖点约束",
    icon: Box,
    railClassName: "bg-[#7A553C]",
    badgeClassName: "border-[#D7BFA4] bg-[#F4E9DE] text-[#5F422F]",
    iconClassName: "bg-[#F4E9DE] text-[#7A553C]",
    handleClassName: "!border-[#7A553C] !bg-[#FFF7ED]",
  },
  model: {
    label: "模特",
    description: "人物身份、姿态、上身关系和比例",
    icon: Shirt,
    railClassName: "bg-[#7562B8]",
    badgeClassName: "border-[#CBC4EA] bg-[#F0EDFA] text-[#5B4A98]",
    iconClassName: "bg-[#F0EDFA] text-[#7562B8]",
    handleClassName: "!border-[#7562B8] !bg-[#F7F4FF]",
  },
  style: {
    label: "风格",
    description: "光线、调色、构图和商业质感",
    icon: Brush,
    railClassName: "bg-[#2F7D7E]",
    badgeClassName: "border-[#B9D7D4] bg-[#E7F3F1] text-[#255F60]",
    iconClassName: "bg-[#E7F3F1] text-[#2F7D7E]",
    handleClassName: "!border-[#2F7D7E] !bg-[#F0FAF8]",
  },
  scene: {
    label: "场景",
    description: "空间、背景、道具和环境光线",
    icon: Camera,
    railClassName: "bg-[#2E6F95]",
    badgeClassName: "border-[#BBD1DF] bg-[#E8F2F7] text-[#255A78]",
    iconClassName: "bg-[#E8F2F7] text-[#2E6F95]",
    handleClassName: "!border-[#2E6F95] !bg-[#F1F8FC]",
  },
  copy: {
    label: "文案",
    description: "画面文字、卖点参数、导出文案和禁用声明",
    icon: FileText,
    railClassName: "bg-[#8A6A2F]",
    badgeClassName: "border-[#D9C99A] bg-[#F7F0D7] text-[#684F22]",
    iconClassName: "bg-[#F7F0D7] text-[#8A6A2F]",
    handleClassName: "!border-[#8A6A2F] !bg-[#FFF9E8]",
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

const outputStatusLabel: Record<string, string> = {
  pending: "排队",
  queued: "排队",
  running: "生成中",
  done: "完成",
  completed: "完成",
  review: "待检查",
  failed: "失败",
};

type GenerationFrameMode = "product" | "model" | "scene" | "style" | "template";
type CompactAssetFrameKind = "product" | "model" | "scene" | "style";

const frameEmptyCopy: Record<
  GenerationFrameMode,
  {
    title: string;
    description: string;
    uploadLabel: string;
    tip: string;
    statusLabel: string;
    blockedReason: string;
  }
> = {
  product: {
    title: "拖入商品素材",
    description: "拖入一张或多张商品图，再写一句目标，比如：生成 5 张白底多视角。",
    uploadLabel: "上传商品图",
    tip: "生成好的白底图可以继续拖进新框，作为海报、场景或模特图参考。",
    statusLabel: "待商品",
    blockedReason: "先上传或拖入商品图",
  },
  model: {
    title: "放入模特参考",
    description: "可以拖入已有模特资产，也可以只写一句需求生成新的模特参考。",
    uploadLabel: "上传模特图",
    tip: "模特预设会优先作为人物一致性约束。",
    statusLabel: "待模特",
    blockedReason: "先放模特参考或写一句需求",
  },
  scene: {
    title: "生成场景资产",
    description: "写一句场景需求，或拖入场景/风格参考图。",
    uploadLabel: "上传场景参考",
    tip: "场景资产用于空间、光线、道具和放置区约束。",
    statusLabel: "待场景",
    blockedReason: "写一句场景需求或拖入参考",
  },
  style: {
    title: "生成风格资产",
    description: "写一句风格方向，或拖入风格参考图。",
    uploadLabel: "上传风格参考",
    tip: "风格资产用于统一光线、调色、构图和商业质感。",
    statusLabel: "待风格",
    blockedReason: "写一句风格需求或拖入参考",
  },
  template: {
    title: "拖入素材或文案",
    description: "商品、模特、风格、场景、文案都能放进来，再用一句话说明目标。",
    uploadLabel: "上传参考图",
    tip: "Agent 会把短需求拆成一组可执行的图组计划。",
    statusLabel: "待需求",
    blockedReason: "先写一句需求，Agent 再拆成图组计划",
  },
};

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
            ...view,
            binding,
          },
        ]
      : [];
  });
  const prompt = frame.prompt ?? getString(data.generationUserRequest) ?? "";
  const promptPlaceholder = normalizePromptPlaceholder(
    frame.promptPlaceholder ??
    getString(data.promptPlaceholder) ??
    "例如：模特穿着这个产品，干净高级，生成 4 张。"
  );
  const title = data.label || "大生成框";
  const subtitle =
    data.caption ||
    "拖进去，说需求。";
  const [draftPrompt, setDraftPrompt] = useState(prompt);
  const [isDragActive, setIsDragActive] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const isWorking = frame.status === "running";
  const outputStats = getImageSetOutputStats(frame.outputs);
  const imageSetStatus = getImageSetStatus(frame.status, outputStats);
  const imageSetSummary = getImageSetSummary(outputStats, imageSetStatus);
  const outputType = getString(data.generationOutputType) ?? frame.outputType ?? "commercial_image_set";
  const frameMode = getGenerationFrameMode(outputType);
  const compactAssetKind = getCompactAssetFrameKind(outputType);
  const emptyCopy = frameEmptyCopy[frameMode];
  const referenceAssetCount = getFrameReferenceAssetCount(frame);
  const hasProductReference = hasFrameProductReference(frame);
  const hasFrameRequest = draftPrompt.trim().length > 0;
  const shouldPreviewPlan = Boolean(compactAssetKind) || hasFrameRequest;
  const planItems = shouldPreviewPlan
    ? buildGenerationFramePlanSpecs({
        request: draftPrompt,
        outputType,
        frameLabel: title,
      })
    : [];
  const hasRequiredInput = frameMode === "product"
    ? hasProductReference
    : frameMode === "template"
      ? hasFrameRequest
      : referenceAssetCount > 0 || hasFrameRequest;
  const canRun = hasRequiredInput && planItems.length > 0 && !isWorking;
  const preflightText = hasRequiredInput
    ? buildGenerationFrameHumanPlan({
        assetSlots: assets,
        frameMode,
        outputType,
        planCount: planItems.length,
        request: draftPrompt,
      })
    : emptyCopy.blockedReason;
  const displayStatusLabel = hasRequiredInput ? statusLabel[frame.status] : emptyCopy.statusLabel;
  const displayStatusClassName = hasRequiredInput
    ? statusClassName[frame.status]
    : "bg-warm-line/25 text-warm-muted";

  useEffect(() => {
    setDraftPrompt(prompt);
  }, [prompt]);

  const commitPrompt = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("image-master:generation-frame-prompt-change", {
        detail: {
          nodeId: id,
          prompt: draftPrompt,
        },
      })
    );
  }, [draftPrompt, id]);

  const runImageSet = useCallback(() => {
    if (!canRun) return;
    commitPrompt();
    window.dispatchEvent(
      new CustomEvent("image-master:generation-frame-run", {
        detail: {
          nodeId: id,
        },
      })
    );
  }, [canRun, commitPrompt, id]);

  const dispatchUploadFile = useCallback((file: File | null | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    window.dispatchEvent(
      new CustomEvent("image-master:generation-frame-file-upload", {
        detail: {
          nodeId: id,
          file,
          role: getDefaultFrameUploadRole(frameMode),
        },
      })
    );
  }, [frameMode, id]);

  const handleUploadInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = getImageFiles(event.target.files);
    if (frameMode === "product") {
      files.forEach(dispatchUploadFile);
    } else {
      dispatchUploadFile(files[0]);
    }
    event.target.value = "";
  }, [dispatchUploadFile, frameMode]);

  const handleDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!hasGenerationFrameDragPayload(event)) return;
    setIsDragActive(true);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!hasGenerationFrameDragPayload(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    setIsDragActive(false);
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    const assetId = event.dataTransfer.getData("application/x-image-master-asset");
    const componentId = event.dataTransfer.getData("application/x-image-master-component");
    const files = getImageFiles(event.dataTransfer.files);
    if (files.length > 0 || assetId || componentId) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (files.length > 0) {
      const uploadFiles = frameMode === "product" ? files : files.slice(0, 1);
      uploadFiles.forEach(dispatchUploadFile);
    } else if (assetId) {
      window.dispatchEvent(
        new CustomEvent("image-master:generation-frame-asset-drop", {
          detail: {
            nodeId: id,
            assetId,
          },
        })
      );
    } else if (componentId) {
      window.dispatchEvent(
        new CustomEvent("image-master:generation-frame-component-drop", {
          detail: {
            nodeId: id,
            componentId,
          },
        })
      );
    }
    setIsDragActive(false);
  }, [dispatchUploadFile, frameMode, id]);

  if (compactAssetKind) {
    return (
      <CompactAssetFrameNode
        id={id}
        title={title}
        kind={compactAssetKind}
        selected={selected}
        isDragActive={isDragActive}
        uploadInputRef={uploadInputRef}
        assets={assets}
        outputs={frame.outputs}
        statusLabel={displayStatusLabel}
        statusClassName={displayStatusClassName}
        imageSetStatus={imageSetStatus}
        imageSetSummary={imageSetSummary}
        draftPrompt={draftPrompt}
        promptPlaceholder={promptPlaceholder}
        isWorking={isWorking}
        canRun={canRun}
        hasRequiredInput={hasRequiredInput}
        preflightText={preflightText}
        blockedReason={emptyCopy.blockedReason}
        onPromptChange={setDraftPrompt}
        onPromptBlur={commitPrompt}
        onRun={runImageSet}
        onUploadClick={() => uploadInputRef.current?.click()}
        onUploadInputChange={handleUploadInputChange}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />
    );
  }

  return (
    <section
      className={cn(
        "relative w-[720px] overflow-hidden rounded-lg border border-warm-line/70 bg-warm-paper text-left text-warm-ink shadow-md transition-all",
        selected && "ring-2 ring-warm-primary/25 shadow-lg",
        isDragActive && "border-warm-primary bg-warm-primary-soft/30 ring-2 ring-warm-primary/30"
      )}
      data-node-id={id}
      data-generation-frame-id={frame.frameId ?? id}
      title={`${title} · ${displayStatusLabel}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="absolute inset-y-0 left-0 w-1 bg-warm-primary" aria-hidden />

      <Handle
        id="inputs"
        type="target"
        position={Position.Left}
        title="把资产拖进生成框"
        aria-label={`${title}资产输入端口`}
        className={cn(
          handleBaseClassName,
          "semantic-port--target !h-4 !w-4 !rounded-full !border-warm-paper !bg-warm-primary"
        )}
      />

      <header className="border-b border-warm-line/40 bg-warm-paper px-4 py-2.5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-warm-primary-soft text-warm-primary">
                <Wand2 className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold leading-tight">{title}</h2>
                <p className="mt-0.5 truncate text-xs leading-snug text-warm-muted">{subtitle}</p>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={cn("rounded px-2 py-1 text-[10px] leading-none", displayStatusClassName)}>
              {displayStatusLabel}
            </span>
          </div>
        </div>
      </header>

      <div className="space-y-3 p-3.5">
        <div
          className={cn(
            "relative min-h-[220px] overflow-hidden rounded-lg border border-dashed border-warm-line bg-warm-bg/75 transition",
            isDragActive && "border-warm-primary bg-warm-paper shadow-inner"
          )}
        >
          {assets.length === 0 ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center px-8 text-center">
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/*"
                multiple={frameMode === "product"}
                className="hidden"
                onChange={handleUploadInputChange}
              />
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-warm-line/70 bg-warm-paper text-warm-primary shadow-sm">
                <Upload className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-warm-ink">{emptyCopy.title}</h3>
              <p className="mt-2 max-w-[340px] text-sm leading-relaxed text-warm-muted">
                {emptyCopy.description}
              </p>
              <button
                type="button"
                className="nodrag nopan mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-warm-primary px-4 text-sm font-medium text-warm-paper shadow-sm transition hover:bg-warm-primary/90"
                onClick={() => uploadInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                {emptyCopy.uploadLabel}
              </button>
              <p className="mt-3 text-xs leading-snug text-warm-muted/80">
                {emptyCopy.tip}
              </p>
            </div>
          ) : (
            <div className="min-h-[240px] p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-warm-ink">资产</h3>
                </div>
                <span className="rounded bg-warm-paper px-2 py-1 text-[10px] leading-none text-warm-muted">
                  {assets.length} 项
                </span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {assets.map((slot, index) => (
                  <GenerationFrameAssetTile
                    key={`${slot.role}:${slot.binding.sourceAssetId ?? slot.binding.sourceNodeId ?? slot.binding.referenceUrl ?? index}`}
                    nodeId={id}
                    slot={slot}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-warm-line/60 bg-warm-bg px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-warm-muted">想要什么</div>
          </div>
          <textarea
            value={draftPrompt}
            onChange={(event) => setDraftPrompt(event.target.value)}
            onBlur={commitPrompt}
            rows={2}
            className="nodrag nopan mt-2 min-h-14 w-full resize-none rounded-md border border-warm-line/60 bg-warm-paper px-3 py-2 text-sm leading-relaxed text-warm-ink outline-none transition placeholder:text-warm-muted/70 focus:border-warm-primary focus:bg-warm-paper"
            placeholder={promptPlaceholder}
          />
        </div>

        <ImageSetProductionBand
          nodeId={id}
          status={imageSetStatus}
          summary={imageSetSummary}
          outputs={frame.outputs}
          isWorking={isWorking}
          canRun={canRun}
          planItems={planItems}
          preflightText={preflightText}
          blockedReason={hasRequiredInput ? undefined : emptyCopy.blockedReason}
          onRun={runImageSet}
        />
      </div>

      <Handle
        id="outputs"
        type="source"
        position={Position.Right}
        title="图组输出端口"
        aria-label={`${title}图组输出端口`}
        className={cn(
          handleBaseClassName,
          "semantic-port--source !h-4 !w-4 !rounded-full !border-warm-paper !bg-warm-primary"
        )}
      />
    </section>
  );
}

export const GenerationFrameNode = memo(GenerationFrameNodeComponent);

const compactAssetCopy: Record<
  CompactAssetFrameKind,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    emptyTitle: string;
    description: string;
    uploadLabel: string;
    promptLabel: string;
    placeholder: string;
    tip: string;
    icon: LucideIcon;
    railClassName: string;
    iconClassName: string;
    handleClassName: string;
  }
> = {
  product: {
    eyebrow: "商品资产",
    title: "商品框",
    subtitle: "多张商品图 -> 一张白底多视角资产",
    emptyTitle: "上传多张商品图",
    description: "正面、侧面、背面、细节都可以丢进来。",
    uploadLabel: "上传商品图",
    promptLabel: "资产目标",
    placeholder: "可选：包包，保留五金、缝线、皮纹和 Logo 区域。",
    tip: "生成后挑一张保存为商品素材，再拖进生成框做海报、场景或详情页。",
    icon: Box,
    railClassName: "bg-[#7A553C]",
    iconClassName: "bg-[#F4E9DE] text-[#7A553C]",
    handleClassName: "!border-[#7A553C] !bg-[#FFF7ED]",
  },
  model: {
    eyebrow: "模特资产",
    title: "模特框",
    subtitle: "漫反射、低对比、下游合成友好",
    emptyTitle: "一句话生成模特资产",
    description: "上传模特参考可选，也可以直接写一句人物需求。",
    uploadLabel: "上传模特参考",
    promptLabel: "模特需求",
    placeholder: "例如：年轻亚洲女性，漫反射低对比模卡，四视图加一张脸部特写。",
    tip: "模特资产用于人物一致性，不需要商品图。",
    icon: Shirt,
    railClassName: "bg-[#7562B8]",
    iconClassName: "bg-[#F0EDFA] text-[#7562B8]",
    handleClassName: "!border-[#7562B8] !bg-[#F7F4FF]",
  },
  scene: {
    eyebrow: "场景资产",
    title: "场景资产",
    subtitle: "一句话生成空间/上传场景参考可选",
    emptyTitle: "一句话生成场景资产",
    description: "生成可复用的空间、光线和放置区参考。",
    uploadLabel: "上传场景参考",
    promptLabel: "场景需求",
    placeholder: "例如：北欧风家居客厅，自然窗光，适合模特和产品出镜。",
    tip: "场景资产只描述环境，商品和模特由独立资产提供。",
    icon: Camera,
    railClassName: "bg-[#2E6F95]",
    iconClassName: "bg-[#E8F2F7] text-[#2E6F95]",
    handleClassName: "!border-[#2E6F95] !bg-[#F1F8FC]",
  },
  style: {
    eyebrow: "风格资产",
    title: "风格资产",
    subtitle: "一句话生成视觉语言/上传风格参考可选",
    emptyTitle: "一句话生成风格资产",
    description: "生成可复用的光线、色彩、构图和质感规则。",
    uploadLabel: "上传风格参考",
    promptLabel: "风格需求",
    placeholder: "例如：干净高级，自然光，柔和商业质感，留白充足。",
    tip: "风格资产只锁定视觉语言，不绑定商品或人物身份。",
    icon: Brush,
    railClassName: "bg-[#2F7D7E]",
    iconClassName: "bg-[#E7F3F1] text-[#2F7D7E]",
    handleClassName: "!border-[#2F7D7E] !bg-[#F0FAF8]",
  },
};

function CompactAssetFrameNode({
  id,
  title,
  kind,
  selected,
  isDragActive,
  uploadInputRef,
  assets,
  outputs,
  statusLabel,
  statusClassName,
  imageSetStatus,
  imageSetSummary,
  draftPrompt,
  promptPlaceholder,
  isWorking,
  canRun,
  hasRequiredInput,
  preflightText,
  blockedReason,
  onPromptChange,
  onPromptBlur,
  onRun,
  onUploadClick,
  onUploadInputChange,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  id: string;
  title: string;
  kind: CompactAssetFrameKind;
  selected: boolean;
  isDragActive: boolean;
  uploadInputRef: RefObject<HTMLInputElement | null>;
  assets: SlotViewModel[];
  outputs: GenerationFrameOutput[];
  statusLabel: string;
  statusClassName: string;
  imageSetStatus: ImageSetProductionStatus;
  imageSetSummary: string;
  draftPrompt: string;
  promptPlaceholder: string;
  isWorking: boolean;
  canRun: boolean;
  hasRequiredInput: boolean;
  preflightText: string;
  blockedReason: string;
  onPromptChange: (value: string) => void;
  onPromptBlur: () => void;
  onRun: () => void;
  onUploadClick: () => void;
  onUploadInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  const copy = compactAssetCopy[kind];
  const Icon = copy.icon as ComponentType<{ className?: string }>;
  const displayTitle = title === "大生成框" ? copy.title : title;
  const displaySubtitle = copy.subtitle;
  const assetPreviewLimit = getCompactAssetPreviewLimit(kind);
  const saveLabel = getCompactAssetSaveLabel(kind);

  return (
    <section
      className={cn(
        "relative w-[292px] overflow-hidden rounded-lg border border-warm-line/70 bg-warm-paper text-left text-warm-ink shadow-sm transition-all",
        selected && "ring-2 ring-warm-primary/25 shadow-md",
        isDragActive && "border-warm-primary bg-warm-primary-soft/25 ring-2 ring-warm-primary/25"
      )}
      data-node-id={id}
      title={`${displayTitle} · ${statusLabel}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span aria-hidden className={cn("absolute inset-x-3 top-0 h-1 rounded-b", copy.railClassName)} />
      <Handle
        id="inputs"
        type="target"
        position={Position.Left}
        title="拖入参考资产"
        aria-label={`${displayTitle}资产输入端口`}
        className={cn(handleBaseClassName, "semantic-port--target", copy.handleClassName)}
      />

      <div className="space-y-2.5 p-3 pt-3.5">
        <header className="flex items-start gap-2.5">
          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", copy.iconClassName)}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-medium leading-none text-warm-muted">{copy.eyebrow}</p>
                <h2 className="mt-1 truncate text-sm font-semibold leading-tight text-warm-ink">
                  {displayTitle}
                </h2>
              </div>
              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none", statusClassName)}>
                {statusLabel}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-warm-muted">
              {displaySubtitle || copy.subtitle}
            </p>
          </div>
        </header>

        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          multiple={kind === "product"}
          className="hidden"
          onChange={onUploadInputChange}
        />

        <div
          className={cn(
            "rounded-md border border-dashed border-warm-line/70 bg-warm-bg/70 p-2.5 transition",
            isDragActive && "border-warm-primary bg-warm-paper shadow-inner"
          )}
        >
          {assets.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-warm-ink">
                  {kind === "product" ? "已接入商品图" : "已接入资产"}
                </span>
                <span className="rounded bg-warm-paper px-1.5 py-0.5 text-[10px] leading-none text-warm-muted">
                  {assets.length} 项
                </span>
              </div>
              {kind === "product" ? (
                <div className="grid grid-cols-3 gap-1.5">
                  {assets.slice(0, assetPreviewLimit).map((slot, index) => (
                    <CompactAssetThumbnail
                      key={`${slot.role}:${slot.binding.sourceAssetId ?? slot.binding.sourceNodeId ?? slot.binding.referenceUrl ?? index}`}
                      nodeId={id}
                      slot={slot}
                      index={index}
                      total={assets.length}
                    />
                  ))}
                </div>
              ) : (
                <div className="grid gap-2">
                  {assets.slice(0, assetPreviewLimit).map((slot, index) => (
                    <CompactAssetTile
                      key={`${slot.role}:${slot.binding.sourceAssetId ?? slot.binding.sourceNodeId ?? slot.binding.referenceUrl ?? index}`}
                      nodeId={id}
                      slot={slot}
                    />
                  ))}
                </div>
              )}
              {assets.length > assetPreviewLimit && (
                <p className="text-[10px] leading-none text-warm-muted">
                  另有 {assets.length - assetPreviewLimit} 个参考已锁定在节点内
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", copy.iconClassName)}>
                <Upload className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-xs font-semibold leading-tight text-warm-ink">{copy.emptyTitle}</h3>
                <p className="mt-1 text-[11px] leading-4 text-warm-muted">{copy.description}</p>
                <button
                  type="button"
                  className="nodrag nopan mt-2 inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-warm-line/70 bg-warm-paper px-2 text-[11px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary"
                  onClick={onUploadClick}
                >
                  <Upload className="h-3 w-3" />
                  {copy.uploadLabel}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-md border border-warm-line/60 bg-warm-bg px-2.5 py-2">
          <label className="block text-[11px] font-medium text-warm-muted" htmlFor={`${id}-asset-prompt`}>
            {copy.promptLabel}
          </label>
          <textarea
            id={`${id}-asset-prompt`}
            value={draftPrompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onBlur={onPromptBlur}
            rows={2}
            className="nodrag nopan mt-1.5 min-h-12 w-full resize-none rounded-md border border-warm-line/60 bg-warm-paper px-2 py-1.5 text-xs leading-5 text-warm-ink outline-none transition placeholder:text-warm-muted/70 focus:border-warm-primary"
            placeholder={kind === "model" ? copy.placeholder : promptPlaceholder || copy.placeholder}
          />
        </div>

        <CompactAssetProductionBand
          nodeId={id}
          status={imageSetStatus}
          summary={imageSetSummary}
          outputs={outputs}
          isWorking={isWorking}
          canRun={canRun}
          hasRequiredInput={hasRequiredInput}
          preflightText={preflightText}
          blockedReason={blockedReason}
          tip={copy.tip}
          saveLabel={saveLabel}
          onRun={onRun}
        />
      </div>

      <Handle
        id="outputs"
        type="source"
        position={Position.Right}
        title="资产输出端口"
        aria-label={`${displayTitle}资产输出端口`}
        className={cn(handleBaseClassName, "semantic-port--source", copy.handleClassName)}
      />
    </section>
  );
}

type ImageSetProductionStatus = "plan" | "queued" | "generating" | "gallery" | "review" | "failed";

interface ImageSetOutputStats {
  total: number;
  done: number;
  failed: number;
  active: number;
  pending: number;
}

function ImageSetProductionBand({
  nodeId,
  status,
  summary,
  outputs,
  isWorking,
  canRun,
  planItems,
  preflightText,
  blockedReason,
  onRun,
}: {
  nodeId: string;
  status: ImageSetProductionStatus;
  summary: string;
  outputs: GenerationFrameOutput[];
  isWorking: boolean;
  canRun: boolean;
  planItems: GenerationFramePlanSpec[];
  preflightText: string;
  blockedReason?: string;
  onRun: () => void;
}) {
  const hasOutputs = outputs.length > 0;
  const visibleOutputs = outputs.slice(0, 12);
  const savedOutputs = outputs.filter((output) => Boolean(output.url));
  const retryableOutputs = outputs.filter(isRetryableOutput);
  const exportableBatchId = getExportableBatchId(outputs);
  const dispatchOutputAction = (type: string, output: GenerationFrameOutput, index: number) => {
    window.dispatchEvent(
      new CustomEvent(type, {
        detail: {
          nodeId: output.nodeId ?? nodeId,
          outputId: output.id,
          artifactId: output.artifactId,
          jobId: output.jobId,
          url: output.url,
          title: output.title ?? `图 ${index + 1}`,
          status: output.status,
        },
      })
    );
  };
  const dispatchGroupAction = (type: string, extra: Record<string, unknown> = {}) => {
    window.dispatchEvent(
      new CustomEvent(type, {
        detail: {
          nodeId,
          outputIds: outputs.map((output) => output.id),
          jobIds: outputs.map((output) => output.jobId).filter(Boolean),
          batchId: exportableBatchId,
          ...extra,
        },
      })
    );
  };

  return (
    <section className="rounded-lg border border-warm-line/70 bg-warm-bg p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn("h-2 w-2 rounded-full", getImageSetStatusDotClassName(status))}
            />
            <span className="text-xs font-medium leading-tight text-warm-ink">
              {getImageSetStatusLabel(status)}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-warm-muted">{summary}</p>
        </div>
        <button
          type="button"
          className="nodrag nopan inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-warm-primary px-3 text-xs font-medium text-warm-paper shadow-sm transition hover:bg-warm-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canRun}
          onClick={onRun}
          title={blockedReason ?? "开始生成当前图组"}
        >
          {isWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {isWorking ? "生成中" : hasOutputs ? "继续生成" : "开始生成"}
        </button>
      </div>

      {!hasOutputs && (
        <div
          className={cn(
            "mt-3 rounded-md border px-2.5 py-2 text-xs leading-snug",
            blockedReason
              ? "border-warm-line/60 bg-warm-paper text-warm-muted"
              : "border-warm-primary/20 bg-warm-primary-soft text-warm-primary"
          )}
        >
          {preflightText}
        </div>
      )}

      {!hasOutputs && planItems.length > 0 && (
        <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
          {planItems.slice(0, 8).map((item, index) => (
            <div
              key={item.id}
              className="min-w-0 rounded-md border border-warm-line/50 bg-warm-paper px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="truncate text-[11px] font-medium text-warm-ink">
                  {index + 1}. {stripFrameTitle(item.title)}
                </span>
                <span className="shrink-0 rounded bg-warm-bg px-1.5 py-0.5 text-[10px] text-warm-muted">
                  {item.ratio}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {hasOutputs && (
        <div className="mt-3 rounded-lg border border-warm-line/50 bg-warm-paper p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="block truncate text-xs font-medium text-warm-ink">
                图组结果
              </span>
              <span className="mt-0.5 block text-[11px] text-warm-muted">
                {savedOutputs.length}/{outputs.length} 已出图
                {retryableOutputs.length > 0 ? ` · ${retryableOutputs.length} 张可重做` : ""}
              </span>
            </div>
            <div className="nodrag nopan flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                disabled={retryableOutputs.length === 0}
                onClick={() => {
                  dispatchGroupAction("image-master:generation-frame-output-retry-all", {
                    outputIds: retryableOutputs.map((output) => output.id),
                    jobIds: retryableOutputs.map((output) => output.jobId).filter(Boolean),
                  });
                }}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-warm-line/60 bg-warm-bg px-2 text-[11px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
                title="按顺序重做失败图片"
              >
                <RefreshCw className="h-3 w-3" />
                重做失败
              </button>
              <button
                type="button"
                disabled={savedOutputs.length === 0}
                onClick={() => {
                  dispatchGroupAction("image-master:generation-frame-output-open-folder", {
                    urls: savedOutputs.map((output) => output.url).filter(Boolean),
                  });
                }}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-warm-line/60 bg-warm-bg px-2 text-[11px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
                title="在 Finder 里打开本地图像文件夹"
              >
                <FolderOpen className="h-3 w-3" />
                打开文件夹
              </button>
            </div>
          </div>
          <div className="mt-2 grid gap-2.5 sm:grid-cols-3">
            {visibleOutputs.map((output, index) => (
              <ImageSetGalleryTile
                key={output.id}
                nodeId={nodeId}
                output={output}
                index={index}
              />
            ))}
          </div>
          {outputs.length > visibleOutputs.length && (
            <p className="mt-2 text-[11px] text-warm-muted">
              已显示前 {visibleOutputs.length} 张，更多结果会继续保存在当前图组。
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function ImageSetGalleryTile({
  nodeId,
  output,
  index,
}: {
  nodeId?: string;
  output: GenerationFrameOutput;
  index: number;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const status = output.status ? outputStatusLabel[output.status] ?? output.status : "已生成";
  const canRetry = isRetryableOutput(output);
  const canSave = Boolean(output.url);
  const canExport = Boolean(output.url);
  const previewUrl = output.previewUrl || output.url;
  const issueText = getOutputIssueText(output);
  const isLoading = output.status === "running" || output.status === "queued" || output.status === "pending";
  const dispatchOutputAction = (type: string) => {
    window.dispatchEvent(
      new CustomEvent(type, {
        detail: {
          nodeId: output.nodeId ?? nodeId,
          outputId: output.id,
          artifactId: output.artifactId,
          jobId: output.jobId,
          url: output.url,
          title: output.title ?? `图 ${index + 1}`,
          status: output.status,
        },
      })
    );
  };

  return (
    <article className={cn(
      "relative overflow-hidden rounded-md border border-warm-line/70 bg-warm-paper",
      index === 0 && "sm:col-span-2"
    )}>
      {previewUrl ? (
        <button
          type="button"
          className="nodrag nopan block w-full text-left"
          onClick={() => setPreviewOpen(true)}
          title="查看大图"
        >
          <AssetPreview
            src={previewUrl}
            alt={output.title ?? `图 ${index + 1}`}
            icon={Camera}
            size="canvasResult"
            fit="cover"
            eager={index === 0}
            className={cn("rounded-none border-0", index === 0 ? "h-48" : "h-32")}
          />
        </button>
      ) : (
        <div className={cn(
          "flex flex-col items-center justify-center gap-1 bg-warm-line/15 px-2 text-center text-warm-muted",
          index === 0 ? "h-48" : "h-32"
        )}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {issueText && (
            <span className="line-clamp-2 text-[10px] leading-4 text-warm-clay">
              {issueText}
            </span>
          )}
        </div>
      )}
      <div className="absolute left-1 top-1">
        <span className={cn(
          "rounded px-1.5 py-0.5 text-[10px] leading-none backdrop-blur",
          canRetry
            ? "bg-red-50/95 text-red-700"
            : isLoading
              ? "bg-warm-primary-soft/95 text-warm-primary"
              : "bg-warm-paper/90 text-warm-muted"
        )}>
          {status}
        </span>
      </div>
      <div className="absolute inset-x-1 bottom-1 flex items-center justify-between gap-1">
        <span className="truncate rounded bg-warm-ink/65 px-1.5 py-0.5 text-[10px] leading-none text-warm-paper backdrop-blur">
          {output.title ?? `图 ${index + 1}`}
        </span>
        <div className="nodrag nopan flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded bg-warm-paper/90 text-warm-muted backdrop-blur transition hover:bg-warm-paper hover:text-warm-ink"
            title="打开大图"
            aria-label={`打开${output.title ?? `图 ${index + 1}`}`}
            onClick={() => setPreviewOpen(true)}
          >
            <Eye className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded bg-warm-paper/90 text-warm-muted backdrop-blur transition hover:bg-warm-paper hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
            title={canRetry ? "重做这张失败图" : "当前状态暂不能重做"}
            aria-label={`重做${output.title ?? `图 ${index + 1}`}`}
            disabled={!canRetry}
            onClick={() => dispatchOutputAction("image-master:generation-frame-output-retry")}
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded bg-warm-paper/90 text-warm-muted backdrop-blur transition hover:bg-warm-paper hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
            title="保存到全局资产库"
            aria-label={`保存${output.title ?? `图 ${index + 1}`}到全局资产库`}
            disabled={!canSave}
            onClick={() => dispatchOutputAction("image-master:generation-frame-output-save")}
          >
            <Plus className="h-3 w-3" />
          </button>
          {canExport ? (
            <a
              href={output.url}
              download
              className="inline-flex h-6 w-6 items-center justify-center rounded bg-warm-paper/90 text-warm-muted backdrop-blur transition hover:bg-warm-paper hover:text-warm-primary"
              title="下载这张"
              aria-label={`下载${output.title ?? `图 ${index + 1}`}`}
              onClick={(event) => event.stopPropagation()}
            >
              <Download className="h-3 w-3" />
            </a>
          ) : (
            <span
              className="inline-flex h-6 w-6 items-center justify-center rounded bg-warm-paper/70 text-warm-muted/45 backdrop-blur"
              title="出图后可下载"
              aria-label={`下载${output.title ?? `图 ${index + 1}`}不可用`}
            >
              <Download className="h-3 w-3" />
            </span>
          )}
        </div>
      </div>
      {previewOpen && (
        <GenerationFrameOutputPreviewModal
          output={output}
          title={output.title ?? `图 ${index + 1}`}
          status={status}
          issueText={issueText}
          previewUrl={previewUrl}
          canRetry={canRetry}
          canSave={canSave}
          onClose={() => setPreviewOpen(false)}
          onRetry={() => dispatchOutputAction("image-master:generation-frame-output-retry")}
          onSave={() => dispatchOutputAction("image-master:generation-frame-output-save")}
        />
      )}
    </article>
  );
}

function GenerationFrameOutputPreviewModal({
  output,
  title,
  status,
  issueText,
  previewUrl,
  canRetry,
  canSave,
  onClose,
  onRetry,
  onSave,
}: {
  output: GenerationFrameOutput;
  title: string;
  status: string;
  issueText?: string;
  previewUrl?: string;
  canRetry: boolean;
  canSave: boolean;
  onClose: () => void;
  onRetry: () => void;
  onSave: () => void;
}) {
  const prompt = getOutputPromptText(output);
  const references = getOutputReferenceImages(output);
  const metadata = getRecord(output.metadata);
  const provider = getString(metadata.provider);
  const model = getString(metadata.model);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-warm-ink/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="查看生成图详情"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-warm-line/60 bg-warm-paper shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-warm-line/60 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-warm-ink">{title}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-warm-muted">
              <span>{status}</span>
              {provider && <span>· {provider}</span>}
              {model && <span>· {model}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1 rounded-md border border-warm-line/60 bg-warm-bg px-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!canRetry}
              onClick={onRetry}
            >
              <RefreshCw className="h-3 w-3" />
              重做
            </button>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1 rounded-md border border-warm-line/60 bg-warm-bg px-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!canSave}
              onClick={onSave}
            >
              <Plus className="h-3 w-3" />
              保存
            </button>
            {output.url && (
              <a
                href={output.url}
                download
                className="inline-flex h-8 items-center gap-1 rounded-md border border-warm-line/60 bg-warm-bg px-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary"
                onClick={(event) => event.stopPropagation()}
              >
                <Download className="h-3 w-3" />
                下载
              </a>
            )}
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink"
              onClick={onClose}
              title="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 gap-3 overflow-auto bg-warm-bg p-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-h-[360px] items-center justify-center rounded-md border border-warm-line/50 bg-warm-paper p-2">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={title}
                className="max-h-[78vh] max-w-full rounded-md object-contain shadow-sm"
              />
            ) : (
              <div className="px-6 text-center text-sm text-warm-muted">
                这张图还没有可查看的大图
              </div>
            )}
          </div>
          <aside className="min-h-0 space-y-3 overflow-y-auto rounded-md border border-warm-line/50 bg-warm-paper p-3">
            {issueText && (
              <section className="rounded-md border border-red-200 bg-red-50 p-2 text-xs leading-relaxed text-red-700">
                {issueText}
              </section>
            )}
            <section>
              <div className="text-xs font-semibold text-warm-ink">参考图</div>
              {references.length > 0 ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {references.map((reference, referenceIndex) => (
                    <div key={`${reference.url}-${referenceIndex}`} className="overflow-hidden rounded-md border border-warm-line/60 bg-warm-bg">
                      <img src={reference.url} alt={reference.title} className="h-24 w-full object-cover" />
                      <div className="space-y-0.5 px-2 py-1.5">
                        <div className="truncate text-[11px] font-medium text-warm-ink">{reference.title}</div>
                        <div className="text-[10px] text-warm-muted">{reference.role}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-warm-muted">没有记录参考图。</p>
              )}
            </section>
            <section>
              <div className="text-xs font-semibold text-warm-ink">Prompt</div>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-warm-line/50 bg-warm-bg p-2 text-[11px] leading-relaxed text-warm-muted">
                {prompt || "没有记录 prompt。"}
              </pre>
            </section>
          </aside>
        </div>
      </div>
    </div>,
    document.body
  );
}

function GenerationFrameAssetTile({ nodeId, slot }: { nodeId: string; slot: SlotViewModel }) {
  const view = roleView[slot.role];
  const Icon = view.icon as ComponentType<{ className?: string }>;
  const binding = slot.binding;
  const bindingKey = getGenerationFrameBindingKey(binding);
  const title = binding.title;
  const detail =
    binding.sourceNodeLabel ??
    slot.description;
  const copyBrief = binding.copyBrief;
  const copyChips = copyBrief ? getCopyBriefChips(copyBrief) : [];

  const dispatchAssetAction = (type: string, extra: Record<string, unknown> = {}) => {
    window.dispatchEvent(
      new CustomEvent(type, {
        detail: {
          nodeId,
          bindingKey,
          ...extra,
        },
      })
    );
  };

  return (
    <article className="relative overflow-hidden rounded-md border border-warm-line/60 bg-warm-paper">
      <div className="flex gap-2 p-2">
        {binding.referenceUrl ? (
          <AssetPreview
            src={binding.referenceUrl}
            alt={binding.title}
            icon={Icon}
            size="sm"
            fit={slot.role === "product" ? "contain" : "cover"}
            className="h-14 w-14 shrink-0 rounded border-warm-line/50"
          />
        ) : (
          <div
            className={cn(
              "flex h-14 w-14 shrink-0 items-center justify-center rounded border border-warm-line/60",
              view.iconClassName
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className={cn("shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none", view.badgeClassName)}>
                {slot.label}
              </span>
              {binding.primary && <span className="shrink-0 text-[10px] leading-none text-warm-primary">主参考</span>}
            </div>
            <div className="nodrag nopan flex shrink-0 items-center gap-1">
              <button
                type="button"
                title={binding.primary ? "主参考" : "设为主参考"}
                onClick={() => dispatchAssetAction("image-master:generation-frame-asset-primary")}
                className={cn(
                  "rounded p-1 transition hover:bg-warm-soft",
                  binding.primary ? "text-warm-primary" : "text-warm-muted"
                )}
              >
                {binding.primary ? <Check className="h-3 w-3" /> : <Star className="h-3 w-3" />}
              </button>
              <button
                type="button"
                title="移出生成框"
                onClick={() => dispatchAssetAction("image-master:generation-frame-asset-remove")}
                className="rounded p-1 text-warm-muted transition hover:bg-warm-soft hover:text-warm-clay"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
          <h3 className="mt-1 truncate text-xs font-medium leading-tight text-warm-ink">
            {title}
          </h3>
          {copyChips.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {copyChips.map((chip) => (
                <span
                  key={chip}
                  className="rounded bg-warm-bg px-1.5 py-0.5 text-[9px] leading-none text-warm-muted"
                >
                  {chip}
                </span>
              ))}
            </div>
          ) : (
            detail && <p className="mt-0.5 truncate text-[10px] leading-3 text-warm-muted">{detail}</p>
          )}
        </div>
      </div>
    </article>
  );
}

function CompactAssetTile({ nodeId, slot }: { nodeId: string; slot: SlotViewModel }) {
  const view = roleView[slot.role];
  const Icon = view.icon as ComponentType<{ className?: string }>;
  const binding = slot.binding;
  const bindingKey = getGenerationFrameBindingKey(binding);
  const detail = binding.sourceNodeLabel ?? slot.description;

  const dispatchAssetAction = (type: string, extra: Record<string, unknown> = {}) => {
    window.dispatchEvent(
      new CustomEvent(type, {
        detail: {
          nodeId,
          bindingKey,
          ...extra,
        },
      })
    );
  };

  return (
    <article className="relative flex min-w-0 items-center gap-2 rounded-md border border-warm-line/60 bg-warm-paper p-1.5">
      {binding.referenceUrl ? (
        <AssetPreview
          src={binding.referenceUrl}
          alt={binding.title}
          icon={Icon}
          size="sm"
          fit={slot.role === "product" ? "contain" : "cover"}
          className="h-10 w-10 shrink-0 rounded border-warm-line/50"
        />
      ) : (
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded border", view.iconClassName)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn("rounded border px-1 py-0.5 text-[9px] leading-none", view.badgeClassName)}>
            {slot.label}
          </span>
          {binding.primary && <span className="text-[9px] leading-none text-warm-primary">主参考</span>}
        </div>
        <h3 className="mt-1 truncate text-xs font-medium leading-tight text-warm-ink">{binding.title}</h3>
        {detail && <p className="mt-0.5 truncate text-[10px] leading-3 text-warm-muted">{detail}</p>}
      </div>
      <div className="nodrag nopan flex shrink-0 flex-col gap-0.5">
        <button
          type="button"
          title={binding.primary ? "主参考" : "设为主参考"}
          onClick={() => dispatchAssetAction("image-master:generation-frame-asset-primary")}
          className={cn(
            "rounded p-1 transition hover:bg-warm-soft",
            binding.primary ? "text-warm-primary" : "text-warm-muted"
          )}
        >
          {binding.primary ? <Check className="h-3 w-3" /> : <Star className="h-3 w-3" />}
        </button>
        <button
          type="button"
          title="移出资产框"
          onClick={() => dispatchAssetAction("image-master:generation-frame-asset-remove")}
          className="rounded p-1 text-warm-muted transition hover:bg-warm-soft hover:text-warm-clay"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </article>
  );
}

function CompactAssetThumbnail({
  nodeId,
  slot,
  index,
  total,
}: {
  nodeId: string;
  slot: SlotViewModel;
  index: number;
  total: number;
}) {
  const view = roleView[slot.role];
  const Icon = view.icon as ComponentType<{ className?: string }>;
  const binding = slot.binding;
  const bindingKey = getGenerationFrameBindingKey(binding);

  const dispatchAssetAction = (type: string, extra: Record<string, unknown> = {}) => {
    window.dispatchEvent(
      new CustomEvent(type, {
        detail: {
          nodeId,
          bindingKey,
          ...extra,
        },
      })
    );
  };

  return (
    <article
      className="group relative overflow-hidden rounded-md border border-warm-line/60 bg-warm-paper"
      title={binding.title}
    >
      {binding.referenceUrl ? (
        <AssetPreview
          src={binding.referenceUrl}
          alt={binding.title}
          icon={Icon}
          size="sm"
          fit="contain"
          className="h-14 w-full rounded-none border-0 bg-white"
        />
      ) : (
        <div className={cn("flex h-14 items-center justify-center rounded border-0", view.iconClassName)}>
          <Icon className="h-4 w-4" />
        </div>
      )}
      <div className="absolute left-1 top-1 flex gap-0.5 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          title={binding.primary ? "主参考" : "设为主参考"}
          onClick={() => dispatchAssetAction("image-master:generation-frame-asset-primary")}
          className={cn(
            "nodrag nopan inline-flex h-4 w-4 items-center justify-center rounded bg-warm-paper/90 shadow-sm transition",
            binding.primary ? "text-warm-primary" : "text-warm-muted hover:text-warm-primary"
          )}
        >
          {binding.primary ? <Check className="h-2.5 w-2.5" /> : <Star className="h-2.5 w-2.5" />}
        </button>
        <button
          type="button"
          title="前移"
          disabled={index === 0}
          onClick={() =>
            dispatchAssetAction("image-master:generation-frame-asset-move", { direction: "previous" })
          }
          className="nodrag nopan inline-flex h-4 w-4 items-center justify-center rounded bg-warm-paper/90 text-warm-muted shadow-sm transition hover:text-warm-primary disabled:opacity-35"
        >
          <ChevronLeft className="h-2.5 w-2.5" />
        </button>
        <button
          type="button"
          title="后移"
          disabled={index >= total - 1}
          onClick={() =>
            dispatchAssetAction("image-master:generation-frame-asset-move", { direction: "next" })
          }
          className="nodrag nopan inline-flex h-4 w-4 items-center justify-center rounded bg-warm-paper/90 text-warm-muted shadow-sm transition hover:text-warm-primary disabled:opacity-35"
        >
          <ChevronRight className="h-2.5 w-2.5" />
        </button>
      </div>
      <button
        type="button"
        title="移出商品图"
        onClick={() => dispatchAssetAction("image-master:generation-frame-asset-remove")}
        className="nodrag nopan absolute right-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded bg-warm-paper/90 text-warm-muted opacity-0 shadow-sm transition hover:text-warm-clay group-hover:opacity-100"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </article>
  );
}

function CompactAssetProductionBand({
  nodeId,
  status,
  summary,
  outputs,
  isWorking,
  canRun,
  hasRequiredInput,
  preflightText,
  blockedReason,
  tip,
  saveLabel,
  onRun,
}: {
  nodeId: string;
  status: ImageSetProductionStatus;
  summary: string;
  outputs: GenerationFrameOutput[];
  isWorking: boolean;
  canRun: boolean;
  hasRequiredInput: boolean;
  preflightText: string;
  blockedReason: string;
  tip: string;
  saveLabel: string;
  onRun: () => void;
}) {
  const hasOutputs = outputs.length > 0;
  const firstOutput = outputs.find((output) => output.previewUrl || output.url) ?? outputs[0];
  const savedOutputs = outputs.filter((output) => Boolean(output.url));

  return (
    <section className="rounded-md border border-warm-line/70 bg-warm-bg p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", getImageSetStatusDotClassName(status))} />
            <span className="text-[11px] font-medium leading-tight text-warm-ink">
              {getImageSetStatusLabel(status)}
            </span>
          </div>
          <p className="mt-1 truncate text-[10px] leading-none text-warm-muted">
            {hasOutputs ? `${savedOutputs.length}/${outputs.length} 已出图` : hasRequiredInput ? summary : blockedReason}
          </p>
        </div>
        <button
          type="button"
          className="nodrag nopan inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md bg-warm-primary px-2 text-[11px] font-medium text-warm-paper shadow-sm transition hover:bg-warm-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canRun}
          onClick={onRun}
          title={hasRequiredInput ? "生成当前资产" : blockedReason}
        >
          {isWorking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {isWorking ? "生成中" : hasOutputs ? "继续生成" : "生成资产"}
        </button>
      </div>

      {hasOutputs && firstOutput ? (
        <CompactAssetOutputTile nodeId={nodeId} output={firstOutput} index={0} saveLabel={saveLabel} />
      ) : (
        <div
          className={cn(
            "mt-2 rounded-md border px-2 py-1.5 text-[10px] leading-4",
            hasRequiredInput
              ? "border-warm-primary/20 bg-warm-primary-soft text-warm-primary"
              : "border-warm-line/60 bg-warm-paper text-warm-muted"
          )}
        >
          {hasRequiredInput ? preflightText : tip}
        </div>
      )}
    </section>
  );
}

function CompactAssetOutputTile({
  nodeId,
  output,
  index,
  saveLabel,
}: {
  nodeId: string;
  output: GenerationFrameOutput;
  index: number;
  saveLabel: string;
}) {
  const previewUrl = output.previewUrl || output.url;
  const status = output.status ? outputStatusLabel[output.status] ?? output.status : "已生成";
  const canRetry = isRetryableOutput(output);
  const canSave = Boolean(output.url);
  const issueText = getOutputIssueText(output);
  const isLoading = output.status === "running" || output.status === "queued" || output.status === "pending";
  const dispatchOutputAction = (type: string) => {
    window.dispatchEvent(
      new CustomEvent(type, {
        detail: {
          nodeId: output.nodeId ?? nodeId,
          outputId: output.id,
          artifactId: output.artifactId,
          jobId: output.jobId,
          url: output.url,
          title: output.title ?? `资产图 ${index + 1}`,
          status: output.status,
        },
      })
    );
  };

  return (
    <article className="mt-2 overflow-hidden rounded-md border border-warm-line/60 bg-warm-paper">
      {previewUrl ? (
        <button
          type="button"
          className="nodrag nopan block w-full text-left"
          onClick={() => dispatchOutputAction("image-master:generation-frame-output-open")}
          title="查看资产预览"
        >
          <AssetPreview
            src={previewUrl}
            alt={output.title ?? `资产图 ${index + 1}`}
            icon={Camera}
            size="canvasImage"
            fit="cover"
            className="h-36 rounded-none border-0"
          />
        </button>
      ) : (
        <div className="flex h-28 flex-col items-center justify-center gap-1 bg-warm-line/15 px-2 text-center text-warm-muted">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {issueText && <span className="line-clamp-2 text-[10px] leading-4 text-warm-clay">{issueText}</span>}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-warm-line/50 px-2 py-1.5">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium leading-tight text-warm-ink">
            {output.title ?? `资产图 ${index + 1}`}
          </p>
          <p className="mt-0.5 text-[10px] leading-none text-warm-muted">{status}</p>
        </div>
        <div className="nodrag nopan flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded bg-warm-bg text-warm-muted transition hover:text-warm-ink"
            title="打开大图"
            aria-label={`打开${output.title ?? `资产图 ${index + 1}`}`}
            onClick={() => dispatchOutputAction("image-master:generation-frame-output-open")}
          >
            <Eye className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded bg-warm-bg text-warm-muted transition hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
            title={canRetry ? "重做这张失败图" : "当前状态暂不能重做"}
            aria-label={`重做${output.title ?? `资产图 ${index + 1}`}`}
            disabled={!canRetry}
            onClick={() => dispatchOutputAction("image-master:generation-frame-output-retry")}
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded bg-warm-bg text-warm-muted transition hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
            title={`保存为${saveLabel}`}
            aria-label={`保存${output.title ?? `资产图 ${index + 1}`}为${saveLabel}`}
            disabled={!canSave}
            onClick={() => dispatchOutputAction("image-master:generation-frame-output-save")}
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>
    </article>
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

function getCopyBriefChips(copyBrief: NonNullable<GenerationFrameSlotBinding["copyBrief"]>): string[] {
  return [
    copyBrief.inImageText.length > 0 ? `画面 ${copyBrief.inImageText.length}` : "",
    copyBrief.sellingPoints.length > 0 ? `卖点 ${copyBrief.sellingPoints.length}` : "",
    copyBrief.exportCopy.length > 0 ? `导出 ${copyBrief.exportCopy.length}` : "",
    copyBrief.forbiddenClaims.length > 0 ? `禁用 ${copyBrief.forbiddenClaims.length}` : "",
  ].filter(Boolean).slice(0, 4);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePromptPlaceholder(value: string): string {
  return value.replaceAll("图组图组", "图组");
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getOutputPromptText(output: GenerationFrameOutput): string | undefined {
  const metadata = getRecord(output.metadata);
  const writer = getRecord(metadata.providerPromptWriter);
  return (
    getString(metadata.prompt) ||
    getString(metadata.providerPrompt) ||
    getString(metadata.revisedPrompt) ||
    getString(metadata.finalPrompt) ||
    getString(writer.prompt) ||
    getString(writer.sourcePromptPreview)
  );
}

function getOutputReferenceImages(output: GenerationFrameOutput): Array<{ role: string; title: string; url: string }> {
  const metadata = getRecord(output.metadata);
  const adapter = getRecord(metadata.providerReferenceAdapter);
  const context = getRecord(metadata.referenceContext);
  const candidates = [
    metadata.providerReferenceImages,
    adapter.providerUsableImages,
    metadata.referenceImages,
    context.images,
  ];
  const seen = new Set<string>();
  const references: Array<{ role: string; title: string; url: string }> = [];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) {
      const record = getRecord(item);
      const url = getString(record.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      references.push({
        role: getString(record.role) ?? "参考",
        title: getString(record.title) ?? getString(record.name) ?? "参考图",
        url,
      });
    }
  }

  const fallbackUrl = getString(metadata.referenceImageUrl);
  if (fallbackUrl && !seen.has(fallbackUrl)) {
    references.push({
      role: getString(metadata.providerReferenceRole) ?? "参考",
      title: "参考图",
      url: fallbackUrl,
    });
  }

  return references.slice(0, 8);
}

function getCompactAssetFrameKind(outputType: string): CompactAssetFrameKind | null {
  const normalized = outputType.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "product_asset") return "product";
  if (normalized === "model_asset") return "model";
  if (normalized === "scene_asset") return "scene";
  if (normalized === "style_asset" || normalized === "visual_style") return "style";
  return null;
}

function getCompactAssetPreviewLimit(kind: CompactAssetFrameKind): number {
  return kind === "product" ? 6 : 2;
}

function getCompactAssetSaveLabel(kind: CompactAssetFrameKind): string {
  if (kind === "product") return "商品素材";
  if (kind === "model") return "模特素材";
  if (kind === "scene") return "场景素材";
  return "风格素材";
}

function getGenerationFrameMode(outputType: string): GenerationFrameMode {
  const normalized = outputType.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized.includes("model")) return "model";
  if (normalized.includes("scene")) return "scene";
  if (normalized.includes("style") || normalized.includes("visual_style")) return "style";
  if (normalized.includes("template") || normalized.includes("custom")) return "template";
  return "product";
}

function getDefaultFrameUploadRole(mode: GenerationFrameMode): GenerationFrameRole {
  if (mode === "model") return "model";
  if (mode === "scene") return "scene";
  if (mode === "style") return "style";
  if (mode === "template") return "style";
  return "product";
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

function stripFrameTitle(title: string): string {
  const parts = title.split("·");
  return parts[parts.length - 1]?.trim() || title;
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

function getExportableBatchId(outputs: GenerationFrameOutput[]): string | undefined {
  const batchIds = outputs
    .map((output) => getString(output.metadata?.batchId) ?? getString(output.metadata?.exportPackId))
    .filter((value): value is string => Boolean(value));
  if (batchIds.length === 0) return undefined;
  const [first] = batchIds;
  return batchIds.every((batchId) => batchId === first) ? first : undefined;
}

function getOutputIssueText(output: GenerationFrameOutput): string | undefined {
  const metadata = output.metadata ?? {};
  const explicitError = getString(metadata.jobError) ?? getString(metadata.error);
  if (explicitError) return explicitError;

  const diagnostics = metadata.providerDiagnostics;
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) {
    return undefined;
  }

  const record = diagnostics as Record<string, unknown>;
  const code = getString(record.code);
  const endpoint = getString(record.endpoint);
  const providerHost = getString(record.providerHost);
  return [code, endpoint, providerHost].filter(Boolean).join(" · ") || undefined;
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

function getImageSetStatusDotClassName(status: ImageSetProductionStatus): string {
  if (status === "gallery") return "bg-warm-sage";
  if (status === "review") return "bg-warm-clay";
  if (status === "failed") return "bg-warm-clay";
  if (status === "generating") return "bg-warm-primary";
  if (status === "queued") return "bg-amber-500";
  return "bg-warm-muted/45";
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

function hasGenerationFrameDragPayload(event: DragEvent<HTMLElement>): boolean {
  const types = Array.from(event.dataTransfer.types);
  return (
    types.includes("Files") ||
    types.includes("application/x-image-master-asset") ||
    types.includes("application/x-image-master-component")
  );
}

function getImageFiles(files: FileList | null | undefined): File[] {
  if (!files) return [];
  return Array.from(files).filter((file) => file.type.startsWith("image/"));
}
