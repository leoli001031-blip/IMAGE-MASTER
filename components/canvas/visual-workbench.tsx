import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import {
  Background,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";
import {
  AlertCircle,
  Archive,
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Copy,
  Download,
  ImageIcon,
  Layers3,
  Loader2,
  ListChecks,
  LockKeyhole,
  PackageCheck,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  SquareStack,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { AssetPreview } from "@/components/canvas/asset-preview";
import { AssetTray, type AssetTrayItem } from "@/components/canvas/asset-tray";
import {
  CanvasContextMenu,
  type CanvasContextMenuAction,
  type CanvasContextMenuContext,
} from "@/components/canvas/canvas-context-menu";
import {
  ProductionSidePanel,
  type ProductionExportItem,
  type ProductionPanelState,
  type ProductionPanelTab,
  type ProductionPlanItem,
  type ProductionResultItem,
} from "@/components/canvas/production-side-panel";
import {
  canvasFactoryItems,
  canvasIconMap,
  canvasLibraryCategories,
  type CanvasAsset,
  type CanvasFactoryItem,
  type CanvasWorkbenchEdge,
  type CanvasLibraryCategory,
  type CanvasWorkbenchNode,
} from "@/lib/canvas/workbench-data";
import {
  canConnectCanvasNodes,
  getConnectionLabel,
  getConnectionValidationMessage,
} from "@/lib/canvas/connection-rules";
import {
  exportPackRules,
  type ExportPackRule,
} from "@/lib/canvas/export-pack-rules";
import {
  buildExportPackBatchPlan,
  isExportPackNode,
} from "@/lib/canvas/export-pack-planner";
import {
  buildExportPackBatchSummaries,
  type ExportPackBatchSummary,
} from "@/lib/canvas/export-pack-summary";
import {
  buildExportPackManifests,
  type ExportPackManifest,
} from "@/lib/canvas/export-pack-manifest";
import {
  buildExportPackQaReviewByJobId,
  buildExportPackQaReport,
  type ExportPackImageInfo,
  type ExportPackQaReport,
} from "@/lib/canvas/export-pack-qa";
import {
  findAvailableGenerationFramePosition,
  getGenerationFrameAtPosition as getAlignedGenerationFrameAtPosition,
  snapCanvasNodePosition,
  type CanvasSnapTarget,
} from "@/lib/canvas/canvas-alignment";
import {
  appendGenerationReferencePrompt,
  buildProviderReferenceAdapter,
  getPrimaryProviderReferenceUrl,
  isProviderUsableReferenceUrl,
  normalizeGenerationReferenceContext,
  type GenerationReferenceContext,
  type GenerationReferenceImage,
  type GenerationReferenceRole,
  type GenerationReferenceRoleContext,
} from "@/lib/canvas/generation-reference-context";
import {
  bindNodeToGenerationFrameSlot,
  bindAssetToGenerationFrameSlot,
  bindGenerationFrameSlot,
  buildGenerationFramePlanSpecs,
  buildGenerationFrameReferenceContext,
  generationFrameRoles,
  markGenerationFramePrimaryAsset,
  mergeGenerationFrameOutputs,
  migrateLegacyGenerationFrameData,
  moveGenerationFrameAsset,
  normalizeGenerationFrameNode,
  normalizeGenerationFrameState,
  removeGenerationFrameAsset,
  updateGenerationFrameAssetRole,
  type GenerationFrameOutput,
  type GenerationFrameRole,
  type GenerationFrameStatus,
  type GenerationFrameState,
} from "@/lib/canvas/generation-frame";
import { resolveGenerationFrameRunRule } from "@/lib/canvas/generation-frame-action-registry";
import { resolveGenerationOutputAssetTarget } from "@/lib/canvas/generation-output-asset-target";
import {
  takePendingResultEditTarget,
  takePendingResultGroupEditTarget,
} from "@/lib/canvas/result-edit-target-storage";
import { buildStructuredCopyBrief, normalizeStructuredCopyBrief } from "@/lib/canvas/copy-brief";
import { WorkflowNode } from "@/components/canvas/workflow-node";
import type { CanvasFlowNode } from "@/components/canvas/workflow-node";
import {
  OutputPreviewModal,
  type OutputPreviewAssetInvocationDecision,
  type OutputPreviewCopyRenderPolicy,
  type OutputPreviewLockSummaryItem,
  type OutputPreviewVisualQaSummary,
} from "@/components/canvas/output-preview-modal";
import { useWorkbenchJobs } from "@/components/canvas/hooks/useWorkbenchJobs";
import {
  createArtifactResultNode,
  getArtifactReviewStatus,
  getArtifactReviewStatusLabel,
  getArtifactVisualQaSummary,
  getArtifactVisualQaStatusLabel,
  getArtifactPreviewUrl,
  getArtifactReconcileSignature,
  getArtifactResultNodeArtifactId,
  getArtifactResultNodeId,
  getArtifactResultWallFocusNodeIds,
  getArtifactStatusLabel,
  getCanvasVisibleArtifacts,
  getStageArtifactSignature,
  isArtifactLinkedToNode,
  isArtifactResultCanvasNode,
  isHiddenArtifactResultNode,
  mapArtifactToGenerationFrameOutput,
  reconcileArtifactResultNodes,
  type ArtifactReviewStatus,
  type ArtifactVisualQaIssue,
  type ArtifactVisualQaStatus,
  type PersistedGeneratedArtifact,
} from "@/components/canvas/canvas-result-nodes";
import type { AIModel, GenerationJob } from "@/lib/types";
import { buildAutoModelAssetName } from "@/lib/canvas/asset-auto-naming";
import type {
  ReviewQualityCheckStatus,
  ReviewSessionItemStatus,
  ReviewSessionSummary,
  ReviewSessionStatus,
  UpdateReviewSessionInput,
} from "@/lib/canvas/reviewer-session";
import type {
  EditableParameterField,
  WorkflowPlanPreview,
  WorkflowPlanPreviewAgentAssetGroup,
  WorkflowPlanPreviewAgentMatrixItem,
  WorkflowPlanPreviewAgentMissingInput,
  WorkflowPlanPreviewItem,
} from "@/lib/canvas/workflow-plan-preview";

const assetStatusLabel: Record<CanvasAsset["status"], string> = {
  ready: "可用",
  draft: "草稿",
  checking: "检查中",
};

function mapAssetStatusToTrayStatus(status: CanvasAsset["status"]): AssetTrayItem["status"] {
  if (status === "ready") return "ready";
  if (status === "checking") return "checking";
  return "draft";
}

function mapComponentStatusToTrayStatus(status: string): AssetTrayItem["status"] {
  if (status === "ready" || status === "active") return "ready";
  if (status === "checking" || status === "validating") return "checking";
  if (status === "needs_review" || status === "review") return "needs_review";
  return "draft";
}

const jobStatusLabel: Record<string, string> = {
  pending: "排队",
  queued: "排队",
  running: "生成中",
  done: "完成",
  completed: "完成",
  failed: "失败",
  cancelled: "已取消",
};

const workflowTemplateCategoryLabel: Record<string, string> = {
  model_display: "模特展示",
  product_detail_page: "详情页",
  platform_output_pack: "平台包",
  poster_set: "海报组图",
  quality_review: "质检",
};

const quickWorkflowPresets = [
  {
    id: "taobao-detail",
    label: "淘宝详情页",
    count: "6-8 图",
    brief: "给当前商品生成淘宝详情页图组：主图、卖点条、材质细节、使用场景、对比说明和收尾转化图，保持统一干净电商风。",
  },
  {
    id: "amazon-main",
    label: "Amazon 主图",
    count: "4-6 图",
    brief: "给当前商品生成 Amazon 上架图组：白底主图、卖点信息图、尺寸说明、生活场景和包装展示，强调商品一致性和平台可用性。",
  },
  {
    id: "xiaohongshu",
    label: "小红书封面",
    count: "4 图",
    brief: "给当前商品生成小红书种草图组：封面、生活方式场景、卖点拆解和收藏引导，视觉统一、真实自然、有轻商业质感。",
  },
  {
    id: "model-display",
    label: "模特展示",
    count: "3-5 图",
    brief: "给当前商品生成高端商业模特展示图组：正面、侧身、半身细节和场景化展示，保持模特身份稳定、商品形态不变。",
  },
  {
    id: "poster-pack",
    label: "海报组图",
    count: "3 图",
    brief: "给当前商品生成商业海报组图：品牌主视觉、促销主图和渠道 banner，保持同一视觉语言、清晰卖点和统一色彩系统。",
  },
];

type CanvasAgentPrimaryMode = "create_frame" | "plan_frame" | "generate_frame" | "global_plan";
type ResultReviewFilter = "all" | "approved" | "pending" | "needs_redo" | "rejected" | "failed" | "qa_risk";

const resultReviewFilterOptions: Array<{ id: ResultReviewFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "approved", label: "只看可用" },
  { id: "pending", label: "只看待检查" },
  { id: "needs_redo", label: "只看建议重做" },
  { id: "rejected", label: "只看已淘汰" },
  { id: "failed", label: "只看失败" },
  { id: "qa_risk", label: "只看 QA 风险" },
];

const defaultAgentSampleOutputCount = 6;
const maxAgentSampleOutputCount = 20;
const maxAutoVisualQaArtifactsPerBatch = 8;
const autoVisualQaFreshWindowMs = 5 * 60 * 1000;

function clampAgentSampleOutputCount(value: number): number {
  if (!Number.isFinite(value)) return defaultAgentSampleOutputCount;
  return Math.min(Math.max(Math.round(value), 1), maxAgentSampleOutputCount);
}

function parseRequestedAgentSampleCount(brief: string): number | undefined {
  const text = brief.trim();
  if (!text) return undefined;

  const multiSceneCount = parseRequestedMultiSceneSampleCount(text);
  if (multiSceneCount) {
    return clampAgentSampleOutputCount(multiSceneCount + parseRequestedAdditionalDeliverableSampleCount(text));
  }

  return parseRequestedStandaloneAgentSampleCount(text);
}

function parseRequestedAdditionalDeliverableSampleCount(brief: string): number {
  return getFallbackExplicitPosterCount(brief);
}

function parseRequestedStandaloneAgentSampleCount(brief: string): number | undefined {
  const text = brief.trim();
  if (!text) return undefined;

  const digitPatterns = [
    /(?:生成|出|做|来|要|需要|create|generate|make)?\s*(\d{1,2})\s*(?:张成片|张图|张|幅|图|p|P|pics?|photos?|shots?|outputs?)/i,
    /(\d{1,2})\s+(?:finished\s+)?(?:images?|photos?|shots?|outputs?)/i,
    /(\d{1,2})\s*(?:张|幅)?\s*(?:成片|最终图|完成图)/i,
  ];
  for (const pattern of digitPatterns) {
    const match = text.match(pattern);
    if (match && !isRelativeAgentSampleCountMatch(text, match.index ?? 0)) {
      return clampAgentSampleOutputCount(Number(match[1]));
    }
  }

  const chineseDigits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  const chineseMatch = text.match(/([一二两三四五六七八九十])\s*(?:张成片|张图|张|幅|图|成片|最终图|完成图)/);
  if (chineseMatch && !isRelativeAgentSampleCountMatch(text, chineseMatch.index ?? 0)) {
    return clampAgentSampleOutputCount(chineseDigits[chineseMatch[1]] ?? defaultAgentSampleOutputCount);
  }

  const englishDigits: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const englishMatch = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:finished\s+)?(?:images?|photos?|shots?|outputs?)\b/i);
  if (englishMatch) return clampAgentSampleOutputCount(englishDigits[englishMatch[1].toLowerCase()]);

  return undefined;
}

function isRelativeAgentSampleCountMatch(text: string, matchIndex: number): boolean {
  const prefix = text.slice(Math.max(0, matchIndex - 6), matchIndex);
  return /(多|少|加|减|增|删|补|保持|增加|减少|删除|去掉|再加|各|每个|每场景|场景各)$/.test(prefix);
}

function parseRequestedMultiSceneSampleCount(brief: string): number | undefined {
  const compact = brief.replace(/\s+/g, "");
  const hasPerSceneCount = /(?:每个|每个场景|每场景|场景各|各)[0-9一二两三四五六七八九十]+张/.test(compact);
  if (!hasPerSceneCount || !hasFallbackSceneExpansionIntent(brief)) return undefined;
  const perSceneCount = getFallbackPerSceneCount(brief);
  if (perSceneCount <= 0) return undefined;
  const sceneNames = extractFallbackSceneNames(brief);
  const namedSceneCount = sceneNames.length > 0 && sceneNames[0] !== "多场景" ? sceneNames.length : 0;
  const declaredSceneCount = parseAgentPlanEditCount(compact.match(/([0-9一二两三四五六七八九十]+)个?场景/)?.[1]);
  const sceneCount = namedSceneCount || declaredSceneCount;
  if (sceneCount <= 0) return undefined;
  const total = sceneCount * perSceneCount;
  return total > 0 && total <= maxAgentSampleOutputCount ? total : undefined;
}

function resolveAgentSampleOutputCount(
  brief: string,
  workflowPlanPreview: WorkflowPlanPreview | null
): number {
  const explicitCount = parseRequestedAgentSampleCount(brief);
  if (explicitCount) return explicitCount;
  if (workflowPlanPreview?.agentPlan?.sampleCount) {
    return clampAgentSampleOutputCount(workflowPlanPreview.agentPlan.sampleCount);
  }
  if (workflowPlanPreview?.estimatedCount) {
    return clampAgentSampleOutputCount(workflowPlanPreview.estimatedCount);
  }
  return defaultAgentSampleOutputCount;
}

const drawerToolOptions = [
  {
    id: "import",
    label: "批量导入",
    description: "商品参数和商品组件",
    icon: Upload,
    group: "advanced",
  },
  {
    id: "review",
    label: "审核",
    description: "人工过审和备注",
    icon: ListChecks,
    group: "advanced",
  },
  {
    id: "diagnostics",
    label: "诊断",
    description: "Provider 和队列健康",
    icon: CircleDot,
    group: "advanced",
  },
  {
    id: "projects",
    label: "项目",
    description: "项目、活动、批次",
    icon: Layers3,
    group: "primary",
  },
  {
    id: "export",
    label: "交付包",
    description: "规格、ZIP、QA 明细",
    icon: PackageCheck,
    group: "advanced",
  },
  {
    id: "queue",
    label: "任务队列",
    description: "运行、取消、重试",
    icon: Play,
    group: "advanced",
  },
  {
    id: "outputs",
    label: "输出",
    description: "全部产物筛选",
    icon: ImageIcon,
    group: "primary",
  },
  {
    id: "templates",
    label: "模板",
    description: "工作流模板和计划预览",
    icon: SquareStack,
    group: "advanced",
  },
  {
    id: "factory",
    label: "组件工厂",
    description: "AI 生成可拖拽组件",
    icon: Sparkles,
    group: "advanced",
  },
] as const;

type DrawerToolId = (typeof drawerToolOptions)[number]["id"];
const drawerPrimaryToolOptions = drawerToolOptions.filter((tool) => tool.group === "primary");
const drawerAdvancedToolOptions = drawerToolOptions.filter((tool) => tool.group === "advanced");

type ApiFetchResponse = Pick<Response, "ok" | "status" | "statusText" | "json" | "text">;

function getHeaderEntries(headers: RequestInit["headers"]): Array<[string, string]> {
  if (!headers) return [];
  if (headers instanceof Headers) return Array.from(headers.entries());
  if (Array.isArray(headers)) return headers.map(([key, value]) => [key, value]);
  return Object.entries(headers).map(([key, value]) => [key, String(value)]);
}

function getXhrBody(body: RequestInit["body"]): XMLHttpRequestBodyInit | null {
  if (!body) return null;
  if (
    typeof body === "string" ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    body instanceof FormData ||
    body instanceof URLSearchParams
  ) {
    return body;
  }
  if (ArrayBuffer.isView(body)) return body;
  return null;
}

function apiFetch(input: string, init: RequestInit = {}): Promise<ApiFetchResponse> {
  if (typeof window !== "undefined" && typeof window.fetch === "function") {
    return window.fetch(input, init);
  }

  if (typeof XMLHttpRequest === "undefined") {
    return Promise.reject(new TypeError("browser request APIs unavailable"));
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method ?? "GET", input, true);
    xhr.responseType = "text";

    for (const [key, value] of getHeaderEntries(init.headers)) {
      xhr.setRequestHeader(key, value);
    }

    xhr.onload = () => {
      const text = typeof xhr.response === "string" ? xhr.response : xhr.responseText;
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        statusText: xhr.statusText,
        text: async () => text,
        json: async () => (text ? JSON.parse(text) : {}),
      });
    };
    xhr.onerror = () => reject(new TypeError("api request failed"));
    xhr.onabort = () => reject(new DOMException("api request aborted", "AbortError"));
    xhr.ontimeout = () => reject(new DOMException("api request timed out", "TimeoutError"));
    xhr.send(getXhrBody(init.body));
  });
}

type ArtifactScopeFilter = "all" | "selected";
type ArtifactStatusFilter = "all" | "completed" | "running" | "failed" | "draft";

const artifactStatusFilterLabels: Record<ArtifactStatusFilter, string> = {
  all: "全部",
  completed: "完成",
  running: "生成中",
  failed: "失败",
  draft: "草稿或排队",
};

const canvasNodeTypes = {
  canvasWorkflow: WorkflowNode,
};

type AssetPackCategory = "product_asset" | "model_asset" | "scene_asset" | "style_asset" | "copy_asset";

interface AssetPackReferenceImageDraft {
  title: string;
  url: string;
  providerUsable?: boolean;
  role?: string;
}

interface AssetPackDraft {
  id?: string;
  category: AssetPackCategory;
  title: string;
  description: string;
  status: "draft" | "checking" | "ready";
  referenceImages: AssetPackReferenceImageDraft[];
  invariants: string[];
  allowedVariations: string[];
  negativeRules: string[];
  qualityRules: string[];
  promptFragments: string[];
  parameters: Record<string, unknown>;
  providerUsablePrimaryReference?: string;
}

interface AssetPackReferenceUpload {
  id: string;
  name: string;
  dataUrl: string;
  size: number;
  source?: "upload" | "asset";
}

type AssetPackSourceImage = {
  role: string;
  title: string;
  url: string;
};

const assetPackCategoryOptions: Array<{
  id: AssetPackCategory;
  label: string;
  hint: string;
}> = [
  {
    id: "product_asset",
    label: "商品资产",
    hint: "锁定商品结构、材质、颜色、Logo 和卖点",
  },
  {
    id: "model_asset",
    label: "模特资产",
    hint: "人物身份参考：脸、年龄感、体态和禁改规则；商品另由商品资产提供",
  },
  {
    id: "scene_asset",
    label: "场景资产",
    hint: "总览、空镜、放置区、光线、道具和镜头语言",
  },
  {
    id: "style_asset",
    label: "风格资产",
    hint: "色彩、光线、材质、构图和统一视觉规则",
  },
  {
    id: "copy_asset",
    label: "文案资产",
    hint: "画面文字、卖点参数、禁止声明和导出文案，供 Agent 判断是否进图",
  },
];

const VISUAL_NODE_LAYOUT_VERSION = 3;
const LAST_CANVAS_WORKFLOW_STORAGE_KEY = "image-master:last-canvas-workflow-id";
const visualNodeDefaultPositions: Record<string, { x: number; y: number }> = {
  brief: { x: 2040, y: 170 },
  model: { x: 2380, y: 170 },
  detail: { x: 2380, y: 520 },
  platform: { x: 2720, y: 170 },
  review: { x: 2720, y: 520 },
};

type LineGenerationActionId =
  | "product_image"
  | "product_asset"
  | "model_asset"
  | "scene_asset"
  | "style_asset"
  | "knowledge_asset"
  | "custom_template";

interface LineGenerationAction {
  id: LineGenerationActionId;
  title: string;
  description: string;
  iconName: keyof typeof canvasIconMap;
  label: string;
  caption: string;
  metrics: string[];
  edgeLabel: string;
  outputType: string;
  promptPlaceholder?: string;
}

const productAssetGenerationAction: LineGenerationAction = {
  id: "product_asset",
  title: "商品资产",
  description: "上传多张商品图，生成一张可复用的白底多视角商品资产",
  iconName: "product",
  label: "商品资产",
  caption: "多张商品图合成一张白底多视角资产",
  metrics: ["商品", "多图", "白底多视角"],
  edgeLabel: "生成商品资产",
  outputType: "product_asset",
  promptPlaceholder: "可选：写商品名、材质、必须保留的五金/缝线/Logo 区域",
};

const lineGenerationActions: LineGenerationAction[] = [
  {
    id: "product_image",
    title: "商品图",
    description: "用当前素材生成商品主图、白底图或基础参考",
    iconName: "product",
    label: "商品图组",
    caption: "当前素材会作为商品参考，不再重复要求上传商品图",
    metrics: ["商品参考", "1-4 张", "可复用"],
    edgeLabel: "生成商品图",
    outputType: "product_image",
  },
  {
    id: "model_asset",
    title: "模特",
    description: "生成可复用的人物参考资产",
    iconName: "model",
    label: "模特资产",
    caption: "从模特预设或一句话需求生成模特参考",
    metrics: ["模特预设", "参考图", "可复用"],
    edgeLabel: "生成模特",
    outputType: "model_asset",
  },
  {
    id: "scene_asset",
    title: "场景",
    description: "生成可复用的商业场景资产",
    iconName: "scene",
    label: "场景资产",
    caption: "生成主场景和空间约束，供后续 Agent 调用",
    metrics: ["场景", "空间锚点", "可复用"],
    edgeLabel: "生成场景",
    outputType: "scene_asset",
    promptPlaceholder: "例如：北欧风家居客厅，适合模特和产品自然出镜",
  },
  {
    id: "style_asset",
    title: "风格",
    description: "生成统一视觉语言、光线和构图规则",
    iconName: "style",
    label: "风格资产",
    caption: "把审美方向整理成可复用风格资产",
    metrics: ["风格", "光线", "构图"],
    edgeLabel: "生成风格",
    outputType: "style_asset",
    promptPlaceholder: "例如：干净高级、自然光、柔和商业质感",
  },
  {
    id: "custom_template",
    title: "商业图组",
    description: "把素材和一句需求交给 Agent 拆成图组",
    iconName: "ai",
    label: "商业图组",
    caption: "拖进素材，说一句需求，Agent 拆成图组",
    metrics: ["素材", "一句话", "图组"],
    edgeLabel: "生成图组",
    outputType: "custom_template",
  },
];

function getLineGenerationAction(actionId: LineGenerationActionId): LineGenerationAction | undefined {
  if (actionId === "product_asset") return productAssetGenerationAction;
  return lineGenerationActions.find((item) => item.id === actionId);
}

function buildLineActionAgentBrief(action: LineGenerationAction, sourceLabel: string): string {
  const source = `以「${sourceLabel}」作为参考`;
  if (action.id === "product_image") {
    return `${source}，规划一组商品图：白底主图、多角度展示、材质细节和可用于电商详情页的基础图。`;
  }
  if (action.id === "model_asset") {
    return `${source}，规划一个可复用模特资产：保持人物身份特征，生成自然、低棚拍感、适合后续商业图合成的参考图。`;
  }
  if (action.id === "scene_asset") {
    return `${source}，规划一个可复用场景资产：交代空间关系、光源方向、透视和适合产品/模特入镜的位置。`;
  }
  if (action.id === "style_asset") {
    return `${source}，整理成可复用拍摄风格：摄影语言、色调、光线、构图和商业完成度要统一。`;
  }
  if (action.id === "knowledge_asset") {
    return `${source}，整理成可复用知识/文案资产，拆分画面文字、卖点参数、禁止声明和导出文案。`;
  }
  return `${source}，让 Agent 规划一组商业图：判断用途、比例、强参考、弱参考、文案是否进图，以及需要生成多少张。`;
}

function cleanGenerationFrameDisplayLabel(label: string): string {
  return label
    .replace(/图组生成框/g, "图组")
    .replace(/生成框/g, "图组")
    .trim();
}

interface PersistedAsset {
  id: string;
  type: string;
  title: string;
  description?: string;
  status?: string;
  url?: string;
  metadata?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

interface PersistedWorkflow {
  id: string;
  title: string;
  nodes?: CanvasWorkbenchNode[];
  edges?: CanvasWorkbenchEdge[];
  metadata?: Record<string, unknown>;
}

interface PersistedWorkflowTemplate {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  version: number;
  nodes: Array<{
    id: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
    type?: string;
    title?: string;
    status?: string;
  }>;
  edges: CanvasWorkbenchEdge[];
  metadata?: Record<string, unknown>;
}

interface PersistedGenerationJob extends GenerationJob {
  metadata: Record<string, unknown>;
}

type ExportPackBatchStateName =
  | "draft"
  | "generated"
  | "in_review"
  | "reviewed"
  | "locked"
  | "delivered";

interface PersistedExportPackBatchState {
  batchId: string;
  projectId: string;
  campaignId?: string;
  state: ExportPackBatchStateName;
  label: string;
  locked: boolean;
  delivered: boolean;
  canTransitionTo: ExportPackBatchStateName[];
  lockedAt?: string;
  deliveredAt?: string;
  updatedAt: string;
}

interface PersistedProjectReviewHistoryEntry {
  id: string;
  type: string;
  label: string;
  createdAt: string;
  sessionId: string;
  sessionTitle: string;
  batchId?: string;
}

interface PersistedProjectReviewSummary {
  sessionCount: number;
  itemCount: number;
  approved: number;
  rejected: number;
  needsRevision: number;
  pending: number;
  latestAt?: string;
  latestSessionTitle?: string;
  recentHistory: PersistedProjectReviewHistoryEntry[];
}

interface PersistedProjectBatch {
  id: string;
  projectId: string;
  campaignId?: string;
  title: string;
  kind: string;
  state: ExportPackBatchStateName;
  metadata: Record<string, unknown>;
  batchState?: PersistedExportPackBatchState;
  reviewSummary?: PersistedProjectReviewSummary;
  updatedAt?: string;
}

interface PersistedCampaign {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

interface PersistedProjectDetails {
  id: string;
  title: string;
  description?: string;
  status?: string;
  metadata?: Record<string, unknown>;
  campaigns: PersistedCampaign[];
  batches: PersistedProjectBatch[];
  reviewSummary?: PersistedProjectReviewSummary;
  updatedAt?: string;
}

interface PersistedJobQueueSnapshot {
  concurrency: number;
  owner?: string;
  leaseDurationMs?: number;
  runtime: {
    queuedJobIds: string[];
    runningJobIds: string[];
    queuedCount: number;
    runningCount: number;
  };
  database: {
    total: number;
    pending: number;
    queued: number;
    running: number;
    done: number;
    failed: number;
    cancelled: number;
  };
  stale: {
    queuedJobIds: string[];
    runningJobIds: string[];
    expiredJobIds?: string[];
    missingLeaseJobIds?: string[];
    count?: number;
    expiredCount?: number;
  };
  leases?: PersistedJobQueueLease[];
}

interface PersistedJobQueueLease {
  jobId: string;
  status: string;
  owner?: string;
  expired?: boolean;
  inRuntimeQueue?: boolean;
  inRuntimeRunning?: boolean;
}

interface ProviderReadiness {
  hasKey: boolean;
  hasImageKey: boolean;
  hasTextKey: boolean;
  imageModel: string;
  imageBaseUrl?: string;
  textModel: string;
}

interface PersistedComponent {
  id: string;
  type: string;
  title: string;
  description: string;
  status: string;
  version: number;
  assetId?: string;
  rules?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

interface CanvasComponentSuggestion {
  title: string;
  caption: string;
  kind?: CanvasWorkbenchNode["data"]["kind"];
  status?: CanvasWorkbenchNode["data"]["status"];
  metrics?: string[];
  iconName?: keyof typeof canvasIconMap;
  previewUrl?: string;
  previewAlt?: string;
  sourceId?: string;
  edgeLabel?: string;
}

interface WorkflowComposeDraft {
  title: string;
  description?: string;
  nodes: CanvasWorkbenchNode[];
  edges: CanvasWorkbenchEdge[];
  metadata?: Record<string, unknown>;
}

interface ImportedProductPreview {
  title: string;
  category: string;
  description: string;
  sellingPoints: string[];
  sku?: string;
}

interface ProductImportPreview {
  parsedProducts: ImportedProductPreview[];
  rejectedRows: Array<{
    index: number;
    reason: string;
  }>;
  componentsPreview: Array<{
    title: string;
    type: string;
    metadata?: Record<string, unknown>;
  }>;
}

interface CanvasSnapshot {
  nodes: CanvasWorkbenchNode[];
  edges: CanvasWorkbenchEdge[];
  selectedNodeId: string;
  hiddenArtifactNodeIds: string[];
}

interface CanvasFocusRequest {
  id: number;
  nodeIds: string[];
}

interface GenerationFrameOutputActionDetail {
  nodeId?: string;
  outputId?: string;
  outputIds?: string[];
  artifactId?: string;
  jobId?: string;
  jobIds?: string[];
  batchId?: string;
  approvedOnly?: boolean;
  url?: string;
  urls?: string[];
  title?: string;
  status?: string;
  reviewStatus?: ArtifactReviewStatus;
  artifactIds?: string[];
  group?: string;
  note?: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
}

interface GenerationOutputPreview {
  items: GenerationOutputPreviewItem[];
  index: number;
}

interface GenerationOutputPreviewItem {
  url: string;
  title: string;
  outputId?: string;
  artifactId?: string;
  jobId?: string;
  nodeId?: string;
  status?: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
  group?: string;
  provider?: string;
  model?: string;
  error?: string;
  reviewStatus?: ArtifactReviewStatus;
}

interface AgentImageEditTarget {
  url: string;
  title: string;
  outputId?: string;
  artifactId?: string;
  jobId?: string;
  nodeId?: string;
  status?: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
}

interface AgentConversationMessage {
  id: string;
  role: "user" | "agent" | "system";
  title?: string;
  text: string;
  tone?: "default" | "progress" | "success" | "warn";
}

interface AgentPlanGroup {
  id: string;
  title: string;
  count: number;
  ratios: string[];
  copyModes: string[];
  providerRoles: string[];
  promptOnlyRoles: string[];
  assetTitles: string[];
  artifactIds?: string[];
  jobIds?: string[];
  status: "ready" | "blocked";
  summary?: string;
  reason?: string;
  missingHints?: string[];
}

interface AgentPlanDiff {
  summary: string;
  scopeSummary?: string;
  preservedSummary?: string;
  nextAction?: string;
  affectedGroupTitles?: string[];
  additions: string[];
  removals: string[];
  countChanges: string[];
  copyChanges: string[];
  otherChanges: string[];
}

interface AgentQaSummaryItem {
  label: string;
  text: string;
  tone?: "default" | "warn" | "success";
}

type AgentReviewSuggestionAction =
  | "approve"
  | "mark_needs_redo"
  | "reject"
  | "open"
  | "redo"
  | "edit"
  | "copy"
  | "group_edit"
  | "group_redo";

interface AgentExecutableReviewSuggestion {
  id: string;
  title: string;
  body: string;
  tone?: "default" | "warn" | "success";
  artifactId?: string;
  jobId?: string;
  groupTitle?: string;
  artifactIds?: string[];
  editBrief?: string;
  actions: AgentReviewSuggestionAction[];
}

interface AgentReviewSuggestionExecutionState {
  action: AgentReviewSuggestionAction;
  label: string;
  text: string;
}

interface AgentGapHintItem {
  label: string;
  text: string;
  tone?: "default" | "warn";
}

interface AgentPlanEnrichmentResult {
  preview: WorkflowPlanPreview;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

interface PendingAgentSamplePlan {
  preview: WorkflowPlanPreview;
  generationRequest: string;
  userBrief: string;
  structuredProjectStarterPrompt?: string;
  outputType: string;
}

interface AgentProgressStep {
  id: string;
  label: string;
  status: "done" | "active" | "pending";
  detail?: string;
}

const assetTypeCategory: Record<string, CanvasLibraryCategory> = {
  product: "商品",
  model: "模特",
  style: "风格",
  scene: "场景",
  copy: "文案",
  copy_asset: "文案",
  knowledge: "文案",
  knowledge_asset: "文案",
  text: "文案",
  text_asset: "文案",
  claim: "文案",
  copy_rules: "文案",
  output: "平台",
  reference: "风格",
  output_reference: "风格",
  platform: "平台",
  quality: "质检",
};

const assetTypeIcon: Record<string, keyof typeof canvasIconMap> = {
  product: "product",
  model: "model",
  style: "style",
  scene: "scene",
  copy: "copy",
  copy_asset: "copy",
  knowledge: "knowledge",
  knowledge_asset: "knowledge",
  text: "copy",
  text_asset: "copy",
  claim: "copy",
  copy_rules: "copy",
  output: "output",
  reference: "style",
  output_reference: "output",
  platform: "platform",
  quality: "review",
};

const assetCategoryIcon: Record<CanvasLibraryCategory, keyof typeof canvasIconMap> = {
  商品: "product",
  模特: "model",
  风格: "style",
  文案: "copy",
  平台: "platform",
  场景: "scene",
  质检: "review",
};

export function VisualWorkbench() {
  const searchParams = useSearchParams();
  const activeProjectId = searchParams.get("projectId") ?? "";
  const [activeCategory, setActiveCategory] = useState<CanvasLibraryCategory>("商品");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [showStatusDrawer, setShowStatusDrawer] = useState(false);
  const [activeBottomPanel, setActiveBottomPanel] = useState<"assets" | null>(null);
  const [assetLibraryFocusItemId, setAssetLibraryFocusItemId] = useState<string | undefined>();
  const [assetFavoritesOnly, setAssetFavoritesOnly] = useState(false);
  const [persistedAssets, setPersistedAssets] = useState<CanvasAsset[]>([]);
  const [modelAssets, setModelAssets] = useState<CanvasAsset[]>([]);
  const [canvasNodes, setCanvasNodes] = useState<CanvasWorkbenchNode[]>([]);
  const [canvasEdges, setCanvasEdges] = useState<CanvasWorkbenchEdge[]>([]);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const workflowIdRef = useRef<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [composingWorkflow, setComposingWorkflow] = useState(false);
  const [generatingAgentSample, setGeneratingAgentSample] = useState(false);
  const [previewingProductImport, setPreviewingProductImport] = useState(false);
  const [savingProductImport, setSavingProductImport] = useState(false);
  const [factoryLoadingId, setFactoryLoadingId] = useState<string | null>(null);
  const [assetPackCategory, setAssetPackCategory] = useState<AssetPackCategory>("product_asset");
  const [assetPackRequest, setAssetPackRequest] = useState("");
  const [assetPackReferenceUploads, setAssetPackReferenceUploads] = useState<AssetPackReferenceUpload[]>([]);
  const [assetPackDraft, setAssetPackDraft] = useState<AssetPackDraft | null>(null);
  const [generatingAssetPack, setGeneratingAssetPack] = useState(false);
  const [savingAssetPack, setSavingAssetPack] = useState(false);
  const [projects, setProjects] = useState<PersistedProjectDetails[]>([]);
  const [components, setComponents] = useState<PersistedComponent[]>([]);
  const [workflowTemplates, setWorkflowTemplates] = useState<PersistedWorkflowTemplate[]>([]);
  const {
    jobs,
    setJobs,
    queueSnapshot,
    setQueueSnapshot,
    artifacts,
    setArtifacts,
    hasActiveJob: hasActiveBackgroundJob,
    refreshJobs,
    refreshQueue,
    refreshArtifacts,
  } = useWorkbenchJobs({ workflowId });
  const [outputPreview, setOutputPreview] = useState<GenerationOutputPreview | null>(null);
  const [agentImageEditTarget, setAgentImageEditTarget] = useState<AgentImageEditTarget | null>(null);
  const [agentPanelCollapsed, setAgentPanelCollapsed] = useState(false);
  const [resultReviewFilter, setResultReviewFilter] = useState<ResultReviewFilter>("all");
  const [highlightedResultReviewFilter, setHighlightedResultReviewFilter] = useState<ResultReviewFilter | null>(null);
  const [highlightedArtifactGroupTitle, setHighlightedArtifactGroupTitle] = useState("");
  const [hiddenArtifactNodeIds, setHiddenArtifactNodeIds] = useState<string[]>([]);
  const [undoStack, setUndoStack] = useState<CanvasSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<CanvasSnapshot[]>([]);
  const [creatingJobForNodeId, setCreatingJobForNodeId] = useState<string | null>(null);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [reviewingBatchId, setReviewingBatchId] = useState<string | null>(null);
  const [reviewingCheckKey, setReviewingCheckKey] = useState<string | null>(null);
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null);
  const [assetMessage, setAssetMessage] = useState("");
  const [assetPackMessage, setAssetPackMessage] = useState("");
  const [composeBrief, setComposeBrief] = useState("");
  const [agentLastUserBrief, setAgentLastUserBrief] = useState("");
  const [composeMessage, setComposeMessage] = useState("");
  const [workflowPlanPreview, setWorkflowPlanPreview] = useState<WorkflowPlanPreview | null>(null);
  const [appliedWorkflowPlanPreview, setAppliedWorkflowPlanPreview] = useState<WorkflowPlanPreview | null>(null);
  const [pendingAgentSamplePlan, setPendingAgentSamplePlan] = useState<PendingAgentSamplePlan | null>(null);
  const [agentPlanDiff, setAgentPlanDiff] = useState<AgentPlanDiff | null>(null);
  const [pendingWorkflowDraft, setPendingWorkflowDraft] = useState<WorkflowComposeDraft | null>(null);
  const [productImportText, setProductImportText] = useState("");
  const [productImportPreview, setProductImportPreview] = useState<ProductImportPreview | null>(null);
  const [productImportMessage, setProductImportMessage] = useState("");
  const [activeProductComponentId, setActiveProductComponentId] = useState<string | null>(null);
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [factoryMessage, setFactoryMessage] = useState("");
  const [jobMessage, setJobMessage] = useState("");
  const [queueMessage, setQueueMessage] = useState("");
  const [projectMessage, setProjectMessage] = useState("");
  const [queueLoading, setQueueLoading] = useState(false);
  const [reclaimingStaleJobs, setReclaimingStaleJobs] = useState(false);
  const [transitioningBatchId, setTransitioningBatchId] = useState<string | null>(null);
  const [archivingBatchId, setArchivingBatchId] = useState<string | null>(null);
  const [templateMessage, setTemplateMessage] = useState("");
  const [artifactMessage, setArtifactMessage] = useState("");
  const [visualQaReviewingArtifactId, setVisualQaReviewingArtifactId] = useState<string | null>(null);
  const [exportPackMessage, setExportPackMessage] = useState("");
  const [focusRequest, setFocusRequest] = useState<CanvasFocusRequest | null>(null);
  const focusRequestCounter = useRef(0);
  const agentProductInputRef = useRef<HTMLInputElement>(null);
  const stageNodesCacheRef = useRef<{ signature: string; nodes: CanvasWorkbenchNode[] } | null>(null);
  const artifactReconcileSignatureRef = useRef("");
  const loadedProjectCanvasRef = useRef("");
  const canvasMutationVersionRef = useRef(0);
  const appliedProjectStarterPromptRef = useRef("");
  const autoVisualQaInitializedRef = useRef(false);
  const autoVisualQaSeenArtifactIdsRef = useRef<Set<string>>(new Set());
  const autoVisualQaPreJobArtifactIdsRef = useRef<Set<string>>(new Set());
  const autoVisualQaSubmittedArtifactIdsRef = useRef<Set<string>>(new Set());
  const previousActiveVisibleJobCountRef = useRef(0);

  useEffect(() => {
    autoVisualQaInitializedRef.current = false;
    autoVisualQaSeenArtifactIdsRef.current = new Set();
    autoVisualQaPreJobArtifactIdsRef.current = new Set();
    autoVisualQaSubmittedArtifactIdsRef.current = new Set();
    previousActiveVisibleJobCountRef.current = 0;
  }, [workflowId]);

  const requestCanvasFocus = useCallback((nodeIds: string[]) => {
    const cleanNodeIds = Array.from(new Set(nodeIds.filter(Boolean)));
    if (cleanNodeIds.length === 0) return;

    focusRequestCounter.current += 1;
    setFocusRequest({
      id: focusRequestCounter.current,
      nodeIds: cleanNodeIds,
    });
  }, []);

  useEffect(() => {
    if (!showStatusDrawer) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowStatusDrawer(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showStatusDrawer]);

  const refreshAssetLibrary = useCallback(async () => {
    const [assetsResult, modelsResult] = await Promise.allSettled([
      apiFetch("/api/assets", { cache: "no-store" }),
      apiFetch("/api/models", { cache: "no-store" }),
    ]);

    if (assetsResult.status === "fulfilled" && assetsResult.value.ok) {
      const payload = await assetsResult.value.json();
      const list = Array.isArray(payload) ? payload : payload.assets;
      if (Array.isArray(list)) {
        setPersistedAssets(list.map(mapPersistedAssetToCanvas).filter(Boolean) as CanvasAsset[]);
      }
    }

    if (modelsResult.status === "fulfilled" && modelsResult.value.ok) {
      const models = await modelsResult.value.json();
      if (Array.isArray(models)) {
        setModelAssets(models.filter((model) => model.imageUrl).map(mapModelToCanvasAsset));
      }
    }
  }, []);

  useEffect(() => {
    let alive = true;

    refreshAssetLibrary().catch(() => {
      if (alive) setAssetMessage("真实资产暂时未接入，正在使用示例资产");
    });

    return () => {
      alive = false;
    };
  }, [refreshAssetLibrary]);

  useEffect(() => {
    let alive = true;

    async function loadComponents() {
      const response = await apiFetch("/api/components", { cache: "no-store" });
      if (!response.ok || !alive) return;
      const payload = await response.json();
      const list = Array.isArray(payload) ? payload : payload.components;
      if (Array.isArray(list)) {
        setComponents(list.map(mapPersistedComponent).filter(Boolean) as PersistedComponent[]);
      }
    }

    loadComponents().catch(() => {
      if (alive) setWorkflowMessage("");
    });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadWorkflowTemplates() {
      const response = await apiFetch("/api/workflow-templates?status=published", {
        cache: "no-store",
      });
      if (!response.ok || !alive) return;
      const payload = await response.json();
      const list = Array.isArray(payload) ? payload : payload.templates;
      if (Array.isArray(list)) {
        setWorkflowTemplates(
          list.map(mapPersistedWorkflowTemplate).filter(Boolean) as PersistedWorkflowTemplate[]
        );
      }
    }

    loadWorkflowTemplates().catch(() => {
      if (alive) setTemplateMessage("模板库暂时不可用");
    });

    return () => {
      alive = false;
    };
  }, []);

  const refreshProjects = useCallback(async () => {
    const projects = await fetchPersistedProjects();
    setProjects(projects);
    return projects;
  }, []);

  const handleRefreshQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueMessage("正在刷新队列...");
    try {
      const queue = await refreshQueue();
      setQueueMessage(queue ? "队列状态已刷新" : "队列状态暂不可用");
    } catch (error) {
      console.error("Failed to refresh job queue:", error);
      setQueueMessage("队列状态读取失败");
    } finally {
      setQueueLoading(false);
    }
  }, [refreshQueue]);

  const handleReclaimStaleJobs = useCallback(async () => {
    setReclaimingStaleJobs(true);
    setQueueMessage("正在回收 stale jobs，不会启动 provider...");
    try {
      const result = await reclaimStaleJobQueueSnapshot();
      setQueueSnapshot(result.queue);
      await refreshJobs();
      const count = result.reclaimedJobIds.length;
      setQueueMessage(
        count > 0
          ? `已回收 ${count} 个 stale jobs；enqueue=false，未触发 provider`
          : "没有可回收的 stale jobs；未触发 provider"
      );
    } catch (error) {
      console.error("Failed to reclaim stale jobs:", error);
      setQueueMessage("回收 stale jobs 失败，未触发 provider");
    } finally {
      setReclaimingStaleJobs(false);
    }
  }, [refreshJobs]);

  useEffect(() => {
    let alive = true;

    refreshProjects().catch(() => {
      if (alive) setProjectMessage("");
    });

    return () => {
      alive = false;
    };
  }, [refreshProjects]);

  useEffect(() => {
    if (canvasNodes.length === 0) return;
    const canvasArtifacts = getCanvasVisibleArtifacts(artifacts, canvasNodes);

    const signature = getArtifactReconcileSignature(
      canvasNodes,
      canvasEdges,
      canvasArtifacts,
      hiddenArtifactNodeIds
    );
    if (signature === artifactReconcileSignatureRef.current) return;

    const reconciled = reconcileArtifactResultNodes(
      canvasNodes,
      canvasEdges,
      canvasArtifacts,
      hiddenArtifactNodeIds,
      withNodeArtifact
    );
    artifactReconcileSignatureRef.current = getArtifactReconcileSignature(
      reconciled.nodes,
      reconciled.edges,
      canvasArtifacts,
      hiddenArtifactNodeIds
    );
    if (reconciled.nodes !== canvasNodes) {
      setCanvasNodes(reconciled.nodes);
      const resultWallFocusNodeIds = getArtifactResultWallFocusNodeIds(reconciled.nodes, 8);
      requestCanvasFocus(resultWallFocusNodeIds.length
        ? resultWallFocusNodeIds
        : canvasArtifacts.map(getArtifactResultNodeId).slice(0, 8)
      );
    }
    if (reconciled.edges !== canvasEdges) setCanvasEdges(reconciled.edges);
  }, [artifacts, canvasEdges, canvasNodes, hiddenArtifactNodeIds, requestCanvasFocus]);

  useEffect(() => {
    if (!hasActiveBackgroundJob) return;
    if (workflowMessage === "正在按当前图组创建任务") {
      setWorkflowMessage("任务已创建，正在生成");
    }
    if (composeMessage.startsWith("正在为") && composeMessage.includes("创建任务")) {
      setComposeMessage("任务已创建，生成结果会回填到画布");
    }
  }, [composeMessage, hasActiveBackgroundJob, workflowMessage]);

  useEffect(() => {
    if (!hasActiveBackgroundJob) return;
    setJobMessage((message) => message || "任务生成中，正在等待产物回填");
  }, [hasActiveBackgroundJob]);

  useEffect(() => {
    const target = takePendingResultEditTarget();
    if (!target) return;
    setOutputPreview(null);
    setAgentImageEditTarget(target);
    setAgentPanelCollapsed(false);
    setComposeBrief("");
    setWorkflowPlanPreview(null);
    setPendingWorkflowDraft(null);
    setComposeMessage(`已从结果页带入「${target.title}」，直接说要怎么改。`);
  }, []);

  useEffect(() => {
    let alive = true;
    const loadMutationVersion = canvasMutationVersionRef.current;
    const hasCanvasContentAtLoad = canvasNodes.length > 0 || canvasEdges.length > 0;

    async function loadSavedWorkflow() {
      const search = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : undefined;
      const shouldRestore = search?.get("restore") === "1";
      const lastWorkflowId = readLastCanvasWorkflowId();

      if (activeProjectId) {
        if (loadedProjectCanvasRef.current === activeProjectId) return;
        workflowIdRef.current = null;
        setWorkflowId(null);
        const projectResponse = await apiFetch(`/api/projects/${encodeURIComponent(activeProjectId)}`, {
          cache: "no-store",
        });
        if (!projectResponse.ok || !alive) return;
        const projectPayload = await projectResponse.json();
        const project = projectPayload.project;
        const metadata = getRecordValue(project?.metadata);
        const projectWorkflowId = getStringValue(metadata.canvasWorkflowId);
        loadedProjectCanvasRef.current = activeProjectId;

        if (!projectWorkflowId) {
          if (shouldRestore) {
            setWorkflowMessage("当前项目还没有保存画布，正在恢复最近画布");
          } else {
            if (canvasMutationVersionRef.current !== loadMutationVersion && hasCanvasContentAtLoad) {
              setWorkflowMessage("当前项目还没有保存画布，已保留本地编辑");
              return;
            }
            setWorkflowId(null);
            workflowIdRef.current = null;
            setHiddenArtifactNodeIds([]);
            setCanvasNodes([]);
            setCanvasEdges([]);
            setWorkflowMessage("当前项目还没有保存画布");
            return;
          }
        } else {
          const workflowResponse = await apiFetch(`/api/workflows/${encodeURIComponent(projectWorkflowId)}`, {
            cache: "no-store",
          });
          if (!workflowResponse.ok || !alive) {
            setWorkflowMessage("项目画布读取失败，可重新保存当前画布");
            return;
          }
          const workflow = await workflowResponse.json();
          if (canvasMutationVersionRef.current !== loadMutationVersion && hasCanvasContentAtLoad) {
            setWorkflowMessage("项目画布已在本地修改，未覆盖当前编辑");
            return;
          }
          restoreWorkflowToCanvas(workflow);
          setWorkflowMessage("已恢复项目画布");
          return;
        }
      }

      if (!shouldRestore) {
        setWorkflowMessage("");
        return;
      }

      if (lastWorkflowId) {
        const workflowResponse = await apiFetch(`/api/workflows/${encodeURIComponent(lastWorkflowId)}`, {
          cache: "no-store",
        });
        if (workflowResponse.ok && alive) {
          const workflow = await workflowResponse.json();
          restoreWorkflowToCanvas(workflow);
          setWorkflowMessage("已恢复当前画布");
          return;
        }
        clearLastCanvasWorkflowId();
        if (!shouldRestore) {
          setWorkflowMessage("");
          return;
        }
      }

      const response = await apiFetch("/api/workflows", { cache: "no-store" });
      if (!response.ok || !alive) return;

      const payload = await response.json();
      const workflows = Array.isArray(payload) ? payload : payload.workflows;
      if (!Array.isArray(workflows)) return;

      const workflow = workflows.find(
        (item: PersistedWorkflow) => item.metadata?.kind === "canvas-workbench"
      ) ?? workflows[0];

      if (!workflow || !alive) return;

      restoreWorkflowToCanvas(workflow);
      setWorkflowMessage("已恢复上次保存的画布");
    }

    function restoreWorkflowToCanvas(workflow: PersistedWorkflow) {
      const hiddenIds = getHiddenArtifactNodeIds(workflow.metadata);
      const restoredNodes = normalizeRestoredNodes(workflow.nodes, workflow.metadata).filter(
        (node) => !isHiddenArtifactResultNode(node, hiddenIds)
      );
      const restoredNodeIds = new Set(restoredNodes.map((node) => node.id));

      setWorkflowId(workflow.id);
      workflowIdRef.current = workflow.id;
      setHiddenArtifactNodeIds(hiddenIds);
      setCanvasNodes(restoredNodes);
      setCanvasEdges(
        normalizeRestoredEdges(workflow.edges).filter(
          (edge) => restoredNodeIds.has(edge.source) && restoredNodeIds.has(edge.target)
        )
      );
      requestCanvasFocus(getArtifactResultWallFocusNodeIds(restoredNodes, 8));
    }

    loadSavedWorkflow().catch(() => {
      if (alive) setWorkflowMessage("");
    });

    return () => {
      alive = false;
    };
  }, [activeProjectId, requestCanvasFocus]);

  const allAssets = useMemo(
    () => [...persistedAssets, ...modelAssets],
    [persistedAssets, modelAssets]
  );
  const activeProject = useMemo(
    () => (activeProjectId ? projects.find((project) => project.id === activeProjectId) : undefined),
    [activeProjectId, projects]
  );
  const activeProjectStarterPrompt = useMemo(
    () => getStringValue(activeProject?.metadata?.agentStarterPrompt),
    [activeProject]
  );
  useEffect(() => {
    if (!activeProjectId || !activeProjectStarterPrompt) return;
    if (composeBrief.trim() || workflowPlanPreview || agentImageEditTarget) return;

    const promptKey = `${activeProjectId}:${activeProjectStarterPrompt}`;
    if (appliedProjectStarterPromptRef.current === promptKey) return;

    appliedProjectStarterPromptRef.current = promptKey;
    setComposeBrief(activeProjectStarterPrompt);
    setComposeMessage("已带入项目模板需求；上传素材后可让 Agent 规划。");
  }, [
    activeProjectId,
    activeProjectStarterPrompt,
    agentImageEditTarget,
    composeBrief,
    workflowPlanPreview,
  ]);
  const activeCampaignId = useMemo(() => {
    if (!activeProject) return "";
    const metadataCampaignId = getStringValue(activeProject.metadata?.activeCampaignId);
    if (
      metadataCampaignId &&
      activeProject.campaigns.some((campaign) => campaign.id === metadataCampaignId)
    ) {
      return metadataCampaignId;
    }
    return (
      activeProject.campaigns.find((campaign) => campaign.status === "active")?.id ??
      activeProject.campaigns[0]?.id ??
      ""
    );
  }, [activeProject]);

  const latestProductAsset = persistedAssets.find((asset) => asset.category === "商品");
  const defaultGenerationFrameNode = useMemo(
    () =>
      createDefaultGenerationFrameNode({
        productAsset: undefined,
        index: canvasNodes.length,
      }),
    [canvasNodes.length]
  );
  const rawStageNodes = useMemo(
    () => canvasNodes,
    [canvasNodes]
  );
  const stageNodes = useMemo(() => {
    const signature = getStageEnrichmentSignature(rawStageNodes, jobs, artifacts);
    if (stageNodesCacheRef.current?.signature === signature) {
      return stageNodesCacheRef.current.nodes;
    }

    const nodes = enrichGenerationFrameNodesWithJobOutputs(rawStageNodes, jobs, artifacts);
    stageNodesCacheRef.current = { signature, nodes };
    return nodes;
  }, [artifacts, jobs, rawStageNodes]);
  const stageEdges = canvasNodes.length > 0 ? canvasEdges : [];
  const visibleArtifacts = useMemo(
    () => getCanvasVisibleArtifacts(artifacts, stageNodes),
    [artifacts, stageNodes]
  );
  const resultArtifactById = useMemo(
    () => new Map(visibleArtifacts.map((artifact) => [artifact.id, artifact])),
    [visibleArtifacts]
  );
  const resultReviewFilterCounts = useMemo(
    () => buildResultReviewFilterCounts(visibleArtifacts),
    [visibleArtifacts]
  );
  useEffect(() => {
    if (!highlightedResultReviewFilter) return;
    const timeout = window.setTimeout(() => setHighlightedResultReviewFilter(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [highlightedResultReviewFilter]);
  useEffect(() => {
    if (!highlightedArtifactGroupTitle) return;
    const timeout = window.setTimeout(() => setHighlightedArtifactGroupTitle(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [highlightedArtifactGroupTitle]);
  const canvasStageNodes = useMemo(
    () =>
      stageNodes
        .filter((node) => !isGenerationFrameNode(node))
        .filter((node) => isCanvasNodeVisibleForResultReviewFilter(node, resultReviewFilter, resultArtifactById))
        .map((node) => withResultReviewFilterContext(node, resultReviewFilter, resultArtifactById))
        .map((node) => withArtifactGroupHighlightContext(node, highlightedArtifactGroupTitle)),
    [highlightedArtifactGroupTitle, resultArtifactById, resultReviewFilter, stageNodes]
  );
  const canvasStageEdges = useMemo(() => {
    if (canvasStageNodes.length === stageNodes.length) return stageEdges;
    const visibleNodeIds = new Set(canvasStageNodes.map((node) => node.id));
    return stageEdges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));
  }, [canvasStageNodes, stageEdges, stageNodes.length]);
  const selectedCanvasNode = canvasStageNodes.find((node) => node.id === selectedNodeId);
  const selectedNode = selectedCanvasNode ?? canvasStageNodes[0] ?? stageNodes[0];
  const visibleFrameOutputCount = useMemo(
    () =>
      stageNodes
        .filter(isGenerationFrameNode)
        .flatMap((node) => normalizeGenerationFrameState(node.data.generationFrame).outputs)
        .filter((output) => !!output.url || output.status === "done" || output.status === "completed")
        .length,
    [stageNodes]
  );
  const visibleArtifactOutputCount = visibleArtifacts.length;
  const visibleOutputCount = Math.max(visibleFrameOutputCount, visibleArtifactOutputCount);
  useEffect(() => {
    if (visibleOutputCount === 0) {
      setAgentPanelCollapsed(false);
      return;
    }
    if (workflowPlanPreview || agentImageEditTarget || composeBrief.trim() || composeMessage) return;
    setAgentPanelCollapsed(true);
  }, [agentImageEditTarget, composeBrief, composeMessage, visibleOutputCount, workflowPlanPreview]);
  useEffect(() => {
    if (workflowPlanPreview || agentImageEditTarget || composeBrief.trim() || composeMessage || composingWorkflow) {
      setAgentPanelCollapsed(false);
    }
  }, [agentImageEditTarget, composeBrief, composeMessage, composingWorkflow, workflowPlanPreview]);
  const activeVisibleJobCount = useMemo(
    () => {
      const artifactJobIds = new Set(
        artifacts
          .map((artifact) => artifact.jobId)
          .filter((jobId): jobId is string => typeof jobId === "string" && !!jobId)
      );
      return jobs.filter((job) =>
        isActiveBackgroundJob(job) &&
        (!workflowId || job.workflowId === workflowId) &&
        !artifactJobIds.has(job.id)
      ).length;
    },
    [artifacts, jobs, workflowId]
  );
  const visibleAssets = useMemo(
    () =>
      [...persistedAssets, ...modelAssets].filter(
        (asset) =>
          asset.category === activeCategory &&
          isVisibleAssetLibraryItem(asset) &&
          (!assetFavoritesOnly || asset.favorite)
      ),
    [activeCategory, assetFavoritesOnly, modelAssets, persistedAssets]
  );
  const visibleComponents: PersistedComponent[] = [];
  const activeProductComponent = activeProductComponentId
    ? components.find((component) => component.id === activeProductComponentId) ?? null
    : null;
  const canvasProductWorkflowContext = useMemo(
    () => getCanvasProductWorkflowContext(canvasNodes),
    [canvasNodes]
  );
  const activeComposeProductTitle = canvasProductWorkflowContext?.title ?? activeProductComponent?.title ?? "";
  const hasAppliedAgentWorkflow = useMemo(
    () => hasWorkflowComposePlan(canvasNodes),
    [canvasNodes]
  );
  const hasCanvasProductReference = useMemo(
    () => Boolean(findCanvasProductReferenceNode(canvasNodes)),
    [canvasNodes]
  );
  const agentSampleOutputCount = resolveAgentSampleOutputCount(
    composeBrief,
    workflowPlanPreview ?? appliedWorkflowPlanPreview
  );
  const generationFrameNodes = useMemo(
    () => stageNodes.filter(isGenerationFrameNode),
    [stageNodes]
  );
  const activeAgentGenerationFrameNode = undefined;
  const activeAgentGenerationFrameTitle =
    cleanGenerationFrameDisplayLabel(
      activeAgentGenerationFrameNode?.data.label || (activeAgentGenerationFrameNode ? "当前任务" : "")
    );
  const activeAgentGenerationFramePrompt = activeAgentGenerationFrameNode
    ? getGenerationFramePrompt(activeAgentGenerationFrameNode)
    : "";
  const activeAgentGenerationFrameHasSameBrief =
    Boolean(activeAgentGenerationFrameNode) &&
    Boolean(composeBrief.trim()) &&
    activeAgentGenerationFramePrompt.trim() === composeBrief.trim();
  const agentPrimaryMode: CanvasAgentPrimaryMode = activeAgentGenerationFrameNode
    ? activeAgentGenerationFrameHasSameBrief
      ? "generate_frame"
      : "plan_frame"
    : "create_frame";

  const captureSnapshot = useCallback(
    (): CanvasSnapshot => ({
      nodes: canvasNodes,
      edges: canvasEdges,
      selectedNodeId,
      hiddenArtifactNodeIds,
    }),
    [canvasEdges, canvasNodes, hiddenArtifactNodeIds, selectedNodeId]
  );

  const pushHistorySnapshot = useCallback(() => {
    canvasMutationVersionRef.current += 1;
    const snapshot = captureSnapshot();
    setUndoStack((items) => limitSnapshots([...items, snapshot]));
    setRedoStack([]);
  }, [captureSnapshot]);

  const flowStats = useMemo(
    () => [
      { label: "组件", value: canvasNodes.length },
      { label: "连线", value: canvasEdges.length },
      {
        label: "输出",
        value: canvasNodes.filter((node) => node.data.kind === "output").length,
      },
      { label: "任务", value: jobs.length },
      { label: "产物", value: artifacts.length },
    ],
    [artifacts.length, canvasEdges.length, canvasNodes, jobs.length]
  );

  const handleUploadProduct = async (
    file: File,
    targetFrameId?: string,
    canvasPosition?: XYPosition,
    category: CanvasLibraryCategory = "商品"
  ) => {
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    setAssetMessage(`正在导入${category}素材...`);

    try {
      const dataUrl = await fileToDataUrl(file);
      const created = createTemporaryUploadAsset({
        file,
        dataUrl,
        category,
        index: canvasNodes.length,
      });
      setActiveCategory(category);

      if (targetFrameId) {
        handleBindAssetToGenerationFrame(created, targetFrameId);
        setAssetMessage("素材已作为 Agent 参考，满意后可保存到全局资产库");
      } else if (category === "商品") {
        const productPlaceholder = findCanvasProductPlaceholderNode(canvasNodes);
        if (productPlaceholder) {
          const replacement = withUploadedProductAssetNode(productPlaceholder, created);
          pushHistorySnapshot();
          setCanvasNodes((nodes) =>
            nodes.map((node) => (node.id === productPlaceholder.id ? replacement : node))
          );
          setSelectedNodeId(productPlaceholder.id);
          requestCanvasFocus([productPlaceholder.id]);
          setAssetMessage("商品图已接入当前计划，未自动收藏");
          setWorkflowMessage("商品图已接入当前计划，可以生成样张");
          setComposeMessage("商品图已接入，可以生成样张");
        } else {
          const nodePosition = canvasPosition ?? getNextLibraryInsertPosition(canvasNodes, selectedNode, category);
          const node = createNodeFromAsset(created, nodePosition, canvasNodes.length);
          pushHistorySnapshot();
          setCanvasNodes((nodes) => [...nodes, node]);
          setSelectedNodeId(node.id);
          requestCanvasFocus([node.id]);
          setAssetMessage("素材已放到画布，未进入全局资产库");
          setWorkflowMessage("素材已放到画布；右键节点可保存到全局资产库");
        }
      } else {
        const nodePosition = canvasPosition ?? getNextLibraryInsertPosition(canvasNodes, selectedNode, category);
        const node = createNodeFromAsset(created, nodePosition, canvasNodes.length);
        pushHistorySnapshot();
        setCanvasNodes((nodes) => [...nodes, node]);
        setSelectedNodeId(node.id);
        requestCanvasFocus([node.id]);
        setAssetMessage("素材已放到画布，未进入全局资产库");
        setWorkflowMessage("素材已放到画布；右键节点可保存到全局资产库");
      }
    } catch (error) {
      console.error("Failed to upload canvas asset:", error);
      setAssetMessage("素材导入失败，请稍后重试");
    } finally {
      setUploading(false);
    }
  };

  const handleAgentProductInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    await handleUploadProduct(file, undefined, undefined, "商品");
  };

  const handleAddAssetPackReferenceUploads = async (files: FileList | File[]) => {
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      setAssetPackMessage("请选择图片");
      return;
    }

    const category = assetPackCategory;
    const referenceLabel = getAssetPackReferenceUploadLabel(category);
    setAssetPackMessage(`正在读取${referenceLabel}...`);
    try {
      const nextUploads = await Promise.all(
        images.map(async (file, index) => ({
          id: `asset-ref-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name || `${referenceLabel} ${index + 1}`,
          dataUrl: await fileToDataUrl(file),
          size: file.size,
          source: "upload" as const,
        }))
      );
      setAssetPackReferenceUploads((items) => [...items, ...nextUploads].slice(0, 12));
      setActiveCategory(mapAssetPackCategoryToLibraryCategory(category));
      setAssetPackMessage(`已加入 ${nextUploads.length} 张${referenceLabel}，可继续补充或直接生成`);
    } catch (error) {
      console.error("Failed to read asset pack references:", error);
      setAssetPackMessage(`${referenceLabel}读取失败`);
    }
  };

  const handleRemoveAssetPackReferenceUpload = (uploadId: string) => {
    setAssetPackReferenceUploads((items) => items.filter((item) => item.id !== uploadId));
  };

  const getEffectiveAssetPackRequest = () => {
    const request = assetPackRequest.trim();
    if (request) return request;
    if (assetPackReferenceUploads.length > 0) {
      return getAssetPackDefaultRequestFromReferences(assetPackCategory);
    }
    return "";
  };

  const getCurrentAssetPackSourceImages = (category: AssetPackCategory, productAsset: CanvasAsset | undefined) => {
    if (category === "copy_asset") return [];
    if (assetPackReferenceUploads.length > 0) {
      return buildAssetPackReferenceSourceImages(assetPackReferenceUploads, category);
    }
    return buildAssetPackSourceImages(category, productAsset);
  };

  const handlePreviewAssetPack = async () => {
    const request = getEffectiveAssetPackRequest();
    if (!request) {
      setAssetPackMessage("先用一句话描述你想生成的资产");
      return;
    }

    setGeneratingAssetPack(true);
    setAssetPackMessage("正在生成参考资产...");

    try {
      if (assetPackCategory === "copy_asset") {
        const draft = createCopyAssetPackDraft(request);
        setAssetPackDraft(draft);
        setAssetPackMessage("文案资产已结构化，满意后可保存");
        return;
      }
      const draft = await createAssetPackDraft(
        assetPackCategory,
        request,
        getCurrentAssetPackSourceImages(assetPackCategory, latestProductAsset)
      );
      setAssetPackDraft(draft);
      setAssetPackMessage(`${getAssetPackCategoryLabel(draft.category)}已生成，满意后可保存`);
    } catch (error) {
      console.error("Failed to preview asset pack:", error);
      setAssetPackMessage(error instanceof Error ? error.message : "参考资产生成失败");
    } finally {
      setGeneratingAssetPack(false);
    }
  };

  const handleSaveAssetPackDraft = async () => {
    if (!assetPackDraft) {
      setAssetPackMessage("暂无可保存的资产包草案");
      return;
    }

    setSavingAssetPack(true);
    setAssetPackMessage("正在保存...");

    try {
      const result = await persistAssetPackDraft(assetPackDraft);
      setAssetPackDraft(null);
      setAssetPackRequest("");
      setAssetPackReferenceUploads([]);
      await refreshAssetLibrary();
      if (result.createdAsset) {
        setAssetLibraryFocusItemId(`asset:${result.createdAsset.id}`);
      }
      setAssetPackMessage(result.createdComponent ? "已保存，可拖到画布供 Agent 使用" : "已保存到全局资产库");
    } catch (error) {
      console.error("Failed to save asset pack:", error);
      setAssetPackMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSavingAssetPack(false);
    }
  };

  const handleGenerateAssetPackReference = async () => {
    const request = getEffectiveAssetPackRequest();
    if (!request) {
      setAssetPackMessage("说一句你想要的资产");
      return;
    }
    const sourceImages = getCurrentAssetPackSourceImages(assetPackCategory, latestProductAsset);
    if (assetPackCategory === "copy_asset") {
      setGeneratingAssetPack(true);
      setAssetPackDraft(null);
      setAssetPackMessage("正在整理文案资产...");
      try {
        const draft = createCopyAssetPackDraft(request);
        setAssetPackDraft(draft);
        setAssetPackMessage("文案资产已结构化，满意后可保存");
      } finally {
        setGeneratingAssetPack(false);
      }
      return;
    }
    if (assetPackCategory === "product_asset" && sourceImages.length === 0) {
      setAssetPackMessage("先上传或拖入真实商品图；纯文字只能做概念商品，不能当原物品多角度参考");
      return;
    }

    setGeneratingAssetPack(true);
    setAssetPackDraft(null);
    setAssetPackMessage("正在生成参考图...");

    try {
      const draft = await generateAssetPackWithReference(
        assetPackCategory,
        request,
        sourceImages
      );
      setAssetPackDraft(draft);
      setAssetPackMessage(`${getAssetPackCategoryLabel(draft.category)}参考图已生成，满意后再保存`);
    } catch (error) {
      console.error("Failed to generate asset pack reference:", error);
      setAssetPackMessage(error instanceof Error ? error.message : "生成失败");
    } finally {
      setGeneratingAssetPack(false);
    }
  };

  const createAssetPackDraft = async (
    category: AssetPackCategory,
    request: string,
    sourceImages: AssetPackSourceImage[]
  ): Promise<AssetPackDraft> => {
    const response = await apiFetch("/api/asset-packs/dry-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category,
        userRequest: request,
        sourceImages,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(typeof payload.error === "string" ? payload.error : "asset pack dry-run failed");
    }
    return normalizeAssetPackDraft(payload, category, request);
  };

  const createCopyAssetPackDraft = (request: string): AssetPackDraft => {
    const copyBrief = buildStructuredCopyBrief(request);
    const titleSeed =
      copyBrief.inImageText[0] ||
      copyBrief.sellingPoints[0] ||
      copyBrief.exportCopy[0] ||
      request;
    const title = `文案资产 · ${titleSeed.slice(0, 18)}`;

    return {
      id: `copy-asset-pack-${Date.now()}`,
      category: "copy_asset",
      title,
      description: request,
      status: "ready",
      referenceImages: [],
      invariants: copyBrief.constraints,
      allowedVariations: copyBrief.exportCopy,
      negativeRules: copyBrief.negativeRules,
      qualityRules: copyBrief.qualityRules,
      promptFragments: copyBrief.promptFragments,
      parameters: {
        text: request,
        copyText: request,
        copyBrief,
        inImageText: copyBrief.inImageText,
        sellingPoints: copyBrief.sellingPoints,
        exportCopy: copyBrief.exportCopy,
        forbiddenClaims: copyBrief.forbiddenClaims,
      },
      providerUsablePrimaryReference: "",
    };
  };

  const generateAssetPackWithReference = async (
    category: AssetPackCategory,
    request: string,
    sourceImages: AssetPackSourceImage[]
  ): Promise<AssetPackDraft> => {
    const dryRunResponse = await apiFetch("/api/asset-packs/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category,
        userRequest: request,
        sourceImages,
        dryRun: true,
      }),
    });
    const dryRunPayload = await dryRunResponse.json();
    if (!dryRunResponse.ok) {
      throw new Error(
        typeof dryRunPayload.error === "string" ? dryRunPayload.error : "asset pack generate dry-run failed"
      );
    }

    const confirmedProviderCallLimit =
      typeof dryRunPayload?.estimate?.maxProviderCallCount === "number"
        ? dryRunPayload.estimate.maxProviderCallCount
        : 1;
    const generateResponse = await apiFetch("/api/asset-packs/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category,
        userRequest: request,
        sourceImages,
        dryRun: false,
        confirmedProviderCallLimit,
      }),
    });
    const generatePayload = await generateResponse.json();
    if (!generateResponse.ok) {
      throw new Error(
        typeof generatePayload.error === "string" ? generatePayload.error : "asset pack generate failed"
      );
    }
    return normalizeAssetPackDraft(generatePayload, category, request);
  };

  const persistAssetPackDraft = async (
    draft: AssetPackDraft
  ): Promise<{ createdAsset: CanvasAsset | null; createdComponent: PersistedComponent | null }> => {
    const previewUrl = getAssetPackPrimaryReferenceUrl(draft);
    const assetResponse = await apiFetch("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: mapAssetPackCategoryToAssetType(draft.category),
        title: draft.title,
        description: draft.description,
        status: draft.status,
        url: previewUrl,
        metadata: buildAssetPackMetadata(draft),
      }),
    });
    const assetPayload = await assetResponse.json();
    if (!assetResponse.ok) {
      throw new Error(typeof assetPayload.error === "string" ? assetPayload.error : "asset save failed");
    }

    const createdAsset = mapPersistedAssetToCanvas(assetPayload.asset ?? assetPayload);
    const assetId = typeof (assetPayload.asset ?? assetPayload)?.id === "string"
      ? (assetPayload.asset ?? assetPayload).id
      : "";
    let createdComponent: PersistedComponent | null = null;

    if (draft.category === "copy_asset") {
      if (createdAsset) {
        setPersistedAssets((assets) => [
          createdAsset,
          ...assets.filter((asset) => asset.id !== createdAsset.id),
        ]);
      }
      setActiveCategory("文案");
      return { createdAsset, createdComponent };
    }

    const componentResponse = await apiFetch("/api/components", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: mapAssetPackCategoryToComponentType(draft.category),
        title: draft.title,
        description: draft.description,
        status: "draft",
        assetId,
        rules: {
          constraints: draft.invariants,
          negativeRules: draft.negativeRules,
          qualityRules: draft.qualityRules,
        },
        metadata: buildAssetPackMetadata(draft),
      }),
    });
    const componentPayload = await componentResponse.json();
    if (componentResponse.ok) {
      createdComponent = mapPersistedComponent(componentPayload.component ?? componentPayload);
    }

    if (createdAsset) {
      setPersistedAssets((assets) => [
        createdAsset,
        ...assets.filter((asset) => asset.id !== createdAsset.id),
      ]);
    }
    if (createdComponent) {
      setComponents((items) => [
        createdComponent,
        ...items.filter((item) => item.id !== createdComponent?.id),
      ]);
    }

    setActiveCategory(mapAssetPackCategoryToLibraryCategory(draft.category));
    return { createdAsset, createdComponent };
  };

  const handleCreateFactoryItem = async (item: CanvasFactoryItem) => {
    setFactoryLoadingId(item.id);
    setFactoryMessage("AI 正在拆解组件...");
    pushHistorySnapshot();

    try {
      const response = await apiFetch("/api/canvas-components", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factoryItem: {
            id: item.id,
            title: item.title,
            description: item.description,
          },
          productAsset: latestProductAsset
            ? {
                title: latestProductAsset.title,
                description: latestProductAsset.description,
                previewUrl: getCanvasAssetReferenceUrl(latestProductAsset),
              }
            : null,
          existingNodes: canvasNodes.map((node) => ({
            id: node.id,
            label: node.data.label,
            kind: node.data.kind,
          })),
          persistComponents: true,
        }),
      });

      if (!response.ok) throw new Error("component factory failed");

      const payload = await response.json();
      const suggestions: CanvasComponentSuggestion[] = Array.isArray(payload.components)
        ? payload.components
        : [payload.component].filter(Boolean);
      const savedComponents: PersistedComponent[] = Array.isArray(payload.savedComponents)
        ? payload.savedComponents.map(mapPersistedComponent).filter(Boolean) as PersistedComponent[]
        : [];

      const generatedIndex = canvasNodes.filter((node) => node.id.startsWith("generated-")).length;
      const nextNodes = suggestions.map((suggestion: CanvasComponentSuggestion, index: number) =>
        createNodeFromSuggestion(suggestion, generatedIndex + index, savedComponents[index])
      );
      const nextEdges = suggestions.map((suggestion: CanvasComponentSuggestion, index: number) =>
        createEdgeForSuggestion(suggestion, nextNodes[index])
      );

      if (savedComponents.length > 0) {
        setComponents((items) => [
          ...savedComponents,
          ...items.filter((item) => !savedComponents.some((component) => component.id === item.id)),
        ]);
      }
      setCanvasNodes((nodes) => [...nodes, ...nextNodes]);
      setCanvasEdges((edges) => [...edges, ...nextEdges]);
      setSelectedNodeId(nextNodes[0]?.id ?? selectedNodeId);
      requestCanvasFocus(nextNodes.map((node) => node.id));
      setFactoryMessage(
        savedComponents.length > 0
          ? `${payload.fallback ? "本地模板" : "AI"}组件已加入画布，并保存 ${savedComponents.length} 个组件`
          : payload.fallback
            ? "已用本地模板生成组件"
            : "AI 组件已加入画布"
      );
    } catch (error) {
      console.error("Failed to create canvas component:", error);
      const fallback = createLocalFactorySuggestion(item);
      const generatedIndex = canvasNodes.filter((item) => item.id.startsWith("generated-")).length;
      const node = createNodeFromSuggestion(fallback, generatedIndex);
      const edge = createEdgeForSuggestion(fallback, node);
      setCanvasNodes((nodes) => [...nodes, node]);
      setCanvasEdges((edges) => [...edges, edge]);
      setSelectedNodeId(node.id);
      requestCanvasFocus([node.id]);
      setFactoryMessage("AI 暂不可用，已用本地模板生成组件");
    } finally {
      setFactoryLoadingId(null);
    }
  };

  async function saveWorkflowSnapshot(options: {
    silent?: boolean;
    nodes?: CanvasWorkbenchNode[];
    edges?: CanvasWorkbenchEdge[];
  } = {}): Promise<string | null> {
    if (!options.silent) {
      setSavingWorkflow(true);
      setWorkflowMessage("正在保存画布...");
    }

    try {
      const body = {
        title: activeProject ? `${activeProject.title} 画布` : "默认商业图片工作流",
        description: activeProject
          ? "项目内保存的空间化生成工作台"
          : "由画布原型保存的低代码生图流程",
        nodes: options.nodes ?? canvasNodes,
        edges: options.edges ?? canvasEdges,
        metadata: {
          kind: "canvas-workbench",
          projectId: activeProjectId || undefined,
          base: "initial-canvas-v1",
          visualNodeLayoutVersion: VISUAL_NODE_LAYOUT_VERSION,
          hiddenArtifactNodeIds,
          updatedAt: new Date().toISOString(),
        },
      };

      const currentWorkflowId = workflowIdRef.current ?? workflowId;
      const response = await apiFetch(currentWorkflowId ? `/api/workflows/${currentWorkflowId}` : "/api/workflows", {
        method: currentWorkflowId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error("workflow save failed");

      const saved = await response.json();
      const savedWorkflowId = saved.id ?? saved.workflow?.id ?? currentWorkflowId ?? null;
      setWorkflowId(savedWorkflowId);
      workflowIdRef.current = savedWorkflowId;
      if (savedWorkflowId) writeLastCanvasWorkflowId(savedWorkflowId);

      if (activeProjectId && savedWorkflowId) {
        await linkWorkflowToProjectCanvas(activeProjectId, savedWorkflowId);
        loadedProjectCanvasRef.current = activeProjectId;
        await refreshProjects();
        if (!options.silent) setWorkflowMessage("项目画布已保存");
      } else {
        if (!options.silent) setWorkflowMessage("画布已保存");
      }
      return savedWorkflowId ?? null;
    } catch (error) {
      console.error("Failed to save workflow:", error);
      if (!options.silent) setWorkflowMessage("保存失败，稍后重试");
      throw error;
    } finally {
      if (!options.silent) setSavingWorkflow(false);
    }
  }

  const handleSaveWorkflow = async () => {
    try {
      await saveWorkflowSnapshot();
    } catch {
      // saveWorkflowSnapshot already updates the visible message.
    }
  };

  async function linkWorkflowToProjectCanvas(projectId: string, canvasWorkflowId: string) {
    const projectResponse = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      cache: "no-store",
    });
    const projectPayload = await projectResponse.json().catch(() => ({}));
    if (!projectResponse.ok) throw new Error("project read failed");
    const project = getRecordValue(projectPayload.project);
    const metadata = getRecordValue(project.metadata);
    const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityType: "project",
        metadata: {
          ...metadata,
          canvasWorkflowId,
          canvasSavedAt: new Date().toISOString(),
        },
      }),
    });
    if (!response.ok) throw new Error("project canvas link failed");
  }

  const applyWorkflowDraftToCanvas = useCallback(
    (
      draft: WorkflowComposeDraft,
      options: {
        message?: string;
        productMessage?: string;
      } = {}
    ) => {
      const nodeIds = new Set(draft.nodes.map((node) => node.id));
      const edges = draft.edges.filter(
        (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)
      );

      pushHistorySnapshot();
      setWorkflowId(null);
      workflowIdRef.current = null;
      setHiddenArtifactNodeIds([]);
      setCanvasNodes(draft.nodes);
      setCanvasEdges(edges);
      setSelectedNodeId(draft.nodes[0].id);
      requestCanvasFocus(draft.nodes.map((node) => node.id));
      setWorkflowMessage(options.productMessage ?? "已应用工作流草案，保存后会写入工作流");
      setComposeMessage(options.message ?? `${draft.title} · ${draft.nodes.length} 节点 / ${edges.length} 连线`);
      if (options.productMessage) setProductImportMessage(options.productMessage);
      setWorkflowPlanPreview(null);
      setAppliedWorkflowPlanPreview(null);
      setPendingAgentSamplePlan(null);
      setPendingWorkflowDraft(null);
    },
    [pushHistorySnapshot, requestCanvasFocus]
  );

  const runWorkflowCompose = async (
    brief: string,
    productComponent?: PersistedComponent | null,
    source: "compose" | "product-import" = "compose",
    userDisplayBrief = brief
  ) => {
    setComposingWorkflow(true);
    setAgentLastUserBrief(userDisplayBrief.trim());
    setAgentPlanDiff(null);
    setPendingAgentSamplePlan(null);
    setComposeMessage("正在生成工作流草案...");
    if (source === "product-import") setProductImportMessage("正在按导入商品生成工作流...");

    try {
      const productContext = productComponent
        ? getProductComponentWorkflowContext(productComponent)
        : canvasProductWorkflowContext;
      const shouldUseProjectStarterContext = source === "product-import";
      const structuredProjectStarterPrompt = shouldUseProjectStarterContext
        ? activeProjectStarterPrompt || undefined
        : undefined;
      const effectiveBrief = shouldUseProjectStarterContext
        ? buildProjectAwareAgentBrief({
            projectStarterPrompt: structuredProjectStarterPrompt,
            userBrief: brief,
          })
        : brief.trim();
      const copyRenderMode = inferAgentCopyRenderMode(
        effectiveBrief,
        hasExplicitCopyBurnInRequest(effectiveBrief)
      );
      const response = await apiFetch("/api/workflow-compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: effectiveBrief,
          projectStarterPrompt: structuredProjectStarterPrompt,
          projectIntent: structuredProjectStarterPrompt,
          productTitle: productContext?.title,
          productDescription: productContext?.description,
          componentIds: productComponent ? [productComponent.id] : undefined,
          copyRenderMode,
          previewPlan: true,
          saveWorkflow: false,
        }),
      });

      if (!response.ok) throw new Error("workflow compose failed");
      const payload = await response.json();
      const draft = mapWorkflowComposeDraft(payload.workflowDraft);
      if (!draft || draft.nodes.length === 0) throw new Error("invalid workflow draft");
      const planPreview = mapWorkflowPlanPreview(payload.planPreview);
      const enrichment = planPreview
          ? await enrichWorkflowPlanPreviewWithAgentPlan({
            preview: planPreview,
            draft,
            brief: effectiveBrief,
            userBrief: brief,
            projectStarterPrompt: structuredProjectStarterPrompt,
            copyRenderMode,
            referenceContext: buildCanvasAgentPlanningReferenceContext({
              nodes: canvasNodes,
              components,
              assets: allAssets,
            }),
          })
        : null;
      const enrichedPlanPreview = enrichment?.preview ?? null;
      const effectiveDraft =
        planPreview &&
        enrichedPlanPreview &&
        enrichedPlanPreview.items.length !== planPreview.items.length &&
        enrichedPlanPreview.agentPlan?.generationMatrix
          ? applyEditedPlanItemsToWorkflowDraft(
              draft,
              enrichedPlanPreview.items,
              enrichedPlanPreview.agentPlan.generationMatrix
            )
          : draft;

      setAppliedWorkflowPlanPreview(null);
      setPendingWorkflowDraft(effectiveDraft);
      setWorkflowPlanPreview(enrichedPlanPreview);
      setWorkflowMessage("已生成计划预览，确认后应用到画布");
      setComposeMessage(
        enrichedPlanPreview
          ? enrichment?.fallbackUsed
            ? `${enrichedPlanPreview.title} · ${enrichedPlanPreview.estimatedCount} 张基础计划图 · ${enrichment.fallbackReason || "Agent 深度规划暂不可用"}`
            : `${enrichedPlanPreview.title} · ${enrichedPlanPreview.estimatedCount} 张计划图`
          : `${draft.title} · ${draft.nodes.length} 节点草案`
      );
      setAgentLastUserBrief(userDisplayBrief.trim());
      setComposeBrief("");
      if (source === "product-import") {
        setProductImportMessage(`已按 ${productContext?.title || "导入商品"} 生成计划预览`);
      }
    } catch (error) {
      console.error("Failed to compose workflow:", error);
      setComposeMessage("工作流草案生成失败，请稍后重试");
      if (source === "product-import") setProductImportMessage("导入商品工作流生成失败，请稍后重试");
    } finally {
      setComposingWorkflow(false);
    }
  };

  const handleApplyWorkflowPlan = useCallback(() => {
    if (pendingAgentSamplePlan) {
      void handleGenerateAgentSample(pendingAgentSamplePlan);
      return;
    }

    if (!pendingWorkflowDraft) {
      setComposeMessage("暂无可应用的计划预览");
      return;
    }

    const existingProductNode = findCanvasProductReferenceNode(canvasNodes);
    const draft = existingProductNode
      ? bindExistingProductReferenceToWorkflowDraft(pendingWorkflowDraft, existingProductNode)
      : pendingWorkflowDraft;
    const preservedReferenceNodes = getCanvasReferenceNodesToPreserveForWorkflowApply(canvasNodes, draft);
    const preservedIds = new Set(preservedReferenceNodes.map((node) => node.id));
    const mergedDraft = preservedReferenceNodes.length > 0
      ? {
          ...draft,
          nodes: [...preservedReferenceNodes, ...draft.nodes],
          edges: [
            ...canvasEdges.filter(
              (edge) => preservedIds.has(edge.source) && preservedIds.has(edge.target)
            ),
            ...draft.edges,
          ],
        }
      : draft;

    const appliedPlan = workflowPlanPreview;
    const appliedMessage = buildAgentWorkflowPlanAppliedMessage(appliedPlan, Boolean(existingProductNode));
    applyWorkflowDraftToCanvas(mergedDraft, {
      message: appliedMessage,
      productMessage: existingProductNode
        ? "计划已接入当前商品图，可以生成样张"
        : "计划已放好，先补商品图",
    });
    setAppliedWorkflowPlanPreview(appliedPlan);
    setComposeBrief("");
  }, [applyWorkflowDraftToCanvas, canvasNodes, pendingAgentSamplePlan, pendingWorkflowDraft, workflowPlanPreview]);

  const handleDismissWorkflowPlan = useCallback(() => {
    setWorkflowPlanPreview(null);
    setAppliedWorkflowPlanPreview(null);
    setPendingAgentSamplePlan(null);
    setPendingWorkflowDraft(null);
    setAgentPlanDiff(null);
    setComposeMessage("已关闭计划预览");
  }, []);

  const handleUpdateWorkflowPlanParameter = useCallback(
    (nodeId: string, key: string, value: unknown) => {
      setWorkflowPlanPreview((preview) => updatePlanPreviewParameter(preview, nodeId, key, value));
      setPendingWorkflowDraft((draft) => updateWorkflowDraftParameter(draft, nodeId, key, value));
    },
    []
  );

  const handleRunAgentImageRevision = async () => {
    const target = agentImageEditTarget;
    const brief = composeBrief.trim();
    if (!target?.url) {
      setComposeMessage("先点一张要修改的图");
      return;
    }
    if (!brief) {
      setComposeMessage("说一下这张图要怎么改");
      return;
    }

    setComposingWorkflow(true);
    setAgentLastUserBrief(brief);
    setComposeMessage(`正在基于「${target.title}」创建修改任务...`);
    setJobMessage("正在创建图片修改任务...");

    try {
      const sourceNode = target.nodeId
        ? canvasNodes.find((node) => node.id === target.nodeId)
        : undefined;
      const sourceBatchId =
        getStringValue(sourceNode?.data.generationFrameActiveBatchId);
      const batchId = sourceBatchId || `agent_revision_${Date.now()}`;
      const referenceContext = buildAgentImageRevisionReferenceContext(target);
      const providerReferenceAdapter = buildProviderReferenceAdapter(referenceContext);
      const prompt = buildAgentImageRevisionPrompt(target, brief);
      const revisionAssetInvocationPlan = buildAgentImageRevisionAssetInvocationPlan(referenceContext);
      let workflowIdForJob = workflowIdRef.current ?? workflowId;
      try {
        workflowIdForJob = (await saveWorkflowSnapshot({
          silent: true,
          nodes: canvasNodes,
          edges: canvasEdges,
        })) ?? workflowIdForJob;
      } catch {
        setWorkflowMessage("画布自动保存失败，本次修改结果可能不会在刷新后恢复");
      }

      const response = await apiFetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId: workflowIdForJob ?? undefined,
          nodeId: target.nodeId,
          status: "pending",
          prompt,
          metadata: {
            source: "agent-image-revision",
            frameNodeId: target.nodeId,
            batchId,
            batchTitle: "图片再修改",
            batchIndex: 1,
            batchTotal: 1,
            planItemTitle: `${target.title} 再修改`,
            planItemType: "image_revision",
            useCase: "image_revision",
            imageType: "image_revision",
            size: "1536x1024",
            projectId: activeProjectId || undefined,
            campaignId: activeCampaignId || undefined,
            projectSource: activeProjectId ? "canvas-project" : undefined,
            approvedProviderCallLimit: 1,
            referenceContext,
            referenceImages: referenceContext.images,
            providerReferenceAdapter,
            assetInvocationPlan: revisionAssetInvocationPlan,
            assetInvocationPlanner: {
              mode: "agent_image_revision_v1",
              fallbackUsed: false,
            },
            originalPrompt: target.prompt,
            originalRatio: getAgentRevisionRatioText(target.metadata ?? {}),
            originalCopyRenderPolicy: compactCopyRenderPolicyForAsset(target.metadata?.copyRenderPolicy),
            originalVisualQa: getAgentRevisionVisualQaText(target),
            revisionScope: {
              mode: "single_image",
              preserveOtherGroups: true,
            },
            providerReferenceRole: providerReferenceAdapter.primaryImage?.role,
            providerReferenceStrategy: providerReferenceAdapter.strategy,
            providerReferenceCount: providerReferenceAdapter.providerUsableImages.length,
            providerReferenceImageUrls: providerReferenceAdapter.providerUsableImages.map((image) => image.url),
            usesProviderReference: providerReferenceAdapter.providerUsableImages.length > 0,
            revisionSource: {
              outputId: target.outputId,
              artifactId: target.artifactId,
              jobId: target.jobId,
              nodeId: target.nodeId,
              title: target.title,
              url: target.url,
            },
            userRequest: brief,
          },
        }),
      });
      const createdPayload = await response.json();
      const createdJob = mapPersistedJob(createdPayload);
      if (!response.ok || !createdJob) throw new Error("revision job creation failed");
      setJobs((items) => [createdJob, ...items.filter((item) => item.id !== createdJob.id)]);

      const runResponse = await apiFetch(`/api/jobs/${encodeURIComponent(createdJob.id)}/run`, {
        method: "POST",
      });
      const runPayload = await runResponse.json();
      const queuedJob = mapPersistedJob(runPayload.job) ?? createdJob;
      if (!runResponse.ok) throw new Error(getStringValue(runPayload.error) || "revision job run failed");

      setJobs((items) => [queuedJob, ...items.filter((item) => item.id !== queuedJob.id)]);
      setWorkflowMessage("已提交这张图的修改任务，结果会回填到画布");
      setComposeMessage(buildAgentImageRevisionMessage(target, brief));
      setComposeBrief("");
      void Promise.allSettled([refreshJobs(), refreshArtifacts(), refreshQueue(), refreshProjects()]);
    } catch (error) {
      console.error("Failed to run image revision:", error);
      setComposeMessage("图片修改任务创建失败，请稍后重试");
      setJobMessage("图片修改任务创建失败");
    } finally {
      setComposingWorkflow(false);
    }
  };

  const handleRunAgentResultGroupRevision = async (
    group: AgentPlanGroup,
    userBrief: string,
    groupArtifacts: PersistedGeneratedArtifact[]
  ) => {
    const brief = userBrief.trim();
    const sourceArtifacts = groupArtifacts.length > 0
      ? groupArtifacts
      : resolveAgentResultGroupArtifacts(group, artifacts);
    const actionableArtifacts = getAgentActionableGroupSuggestionArtifacts(sourceArtifacts);
    const protectedCount = sourceArtifacts.length - actionableArtifacts.length;
    const targets = actionableArtifacts
      .filter((artifact) => artifact.url)
      .map((artifact): AgentImageEditTarget => {
        const job = artifact.jobId ? jobs.find((item) => item.id === artifact.jobId) : undefined;
        const metadata = mergeGenerationOutputPreviewMetadata({ artifact, job });
        return {
          url: artifact.url,
          title: artifact.title,
          artifactId: artifact.id,
          jobId: artifact.jobId,
          nodeId: artifact.nodeId,
          status: artifact.status,
          prompt: getGenerationOutputPreviewPrompt({ artifact, job, metadata }),
          metadata,
        };
      });

    if (!brief) {
      setComposeMessage("说一下这组要怎么改");
      return;
    }
    if (targets.length === 0) {
      setAgentPlanDiff(buildAgentResultGroupRevisionDiff(group, brief, 0, 0, protectedCount));
      setAgentLastUserBrief(brief);
      setComposeMessage(
        protectedCount > 0
          ? `已选中「${group.title}」，但没有找到可重做的待处理成片；已保留/已淘汰的 ${protectedCount} 张不会被修改。`
          : `已选中「${group.title}」，但没有找到可重做的成片。可以先点单张图确认结果是否还在画布里。`
      );
      return;
    }

    setComposingWorkflow(true);
    setAgentLastUserBrief(brief);
    setComposeMessage(
      `正在为「${group.title}」创建 ${targets.length} 张待处理图片的分组修改任务${protectedCount > 0 ? `，跳过 ${protectedCount} 张已保留/已淘汰图片` : ""}...`
    );
    setJobMessage("正在创建分组修改任务...");

    const batchId = `agent_group_revision_${Date.now()}`;
    let workflowIdForJob = workflowIdRef.current ?? workflowId;
    try {
      workflowIdForJob = (await saveWorkflowSnapshot({
        silent: true,
        nodes: canvasNodes,
        edges: canvasEdges,
      })) ?? workflowIdForJob;
    } catch {
      setWorkflowMessage("画布自动保存失败，本次分组修改结果可能不会在刷新后恢复");
    }

    const queuedJobs: PersistedGenerationJob[] = [];
    let failedCount = 0;

    for (const [index, target] of targets.entries()) {
      try {
        const referenceContext = buildAgentImageRevisionReferenceContext(target);
        const providerReferenceAdapter = buildProviderReferenceAdapter(referenceContext);
        const groupContextPrompt = buildAgentGroupRevisionPromptContext(group, targets, target);
        const prompt = [
          buildAgentImageRevisionPrompt(target, brief),
          groupContextPrompt,
        ].filter(Boolean).join("\n\n");
        const revisionAssetInvocationPlan = buildAgentImageRevisionAssetInvocationPlan(referenceContext);

        const response = await apiFetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflowId: workflowIdForJob ?? undefined,
            nodeId: target.nodeId,
            status: "pending",
            prompt,
            metadata: {
              source: "agent-result-group-revision",
              frameNodeId: target.nodeId,
              batchId,
              batchTitle: `${group.title}分组修改`,
              batchIndex: index + 1,
              batchTotal: targets.length,
              planItemTitle: `${target.title} 分组再修改`,
              planItemType: "group_image_revision",
              useCase: "group_image_revision",
              imageType: "group_image_revision",
              size: "1536x1024",
              projectId: activeProjectId || undefined,
              campaignId: activeCampaignId || undefined,
              projectSource: activeProjectId ? "canvas-project" : undefined,
              approvedProviderCallLimit: 1,
              referenceContext,
              referenceImages: referenceContext.images,
              providerReferenceAdapter,
              assetInvocationPlan: revisionAssetInvocationPlan,
              assetInvocationPlanner: {
                mode: "agent_group_revision_v1",
                fallbackUsed: false,
              },
              originalPrompt: target.prompt,
              originalRatio: getAgentRevisionRatioText(target.metadata ?? {}),
              originalCopyRenderPolicy: compactCopyRenderPolicyForAsset(target.metadata?.copyRenderPolicy),
              originalVisualQa: getAgentRevisionVisualQaText(target),
              providerReferenceRole: providerReferenceAdapter.primaryImage?.role,
              providerReferenceStrategy: providerReferenceAdapter.strategy,
              providerReferenceCount: providerReferenceAdapter.providerUsableImages.length,
              providerReferenceImageUrls: providerReferenceAdapter.providerUsableImages.map((image) => image.url),
              usesProviderReference: providerReferenceAdapter.providerUsableImages.length > 0,
              revisionGroup: {
                title: group.title,
                count: group.count,
                ratios: group.ratios,
                providerRoles: group.providerRoles,
                promptOnlyRoles: group.promptOnlyRoles,
                copyModes: group.copyModes,
                artifactIds: group.artifactIds,
              },
              revisionScope: {
                mode: "group_only",
                targetGroup: group.title,
                targetCount: targets.length,
                skippedProtectedCount: protectedCount,
                preserveOtherGroups: true,
                preserveApprovedRejected: true,
                context: groupContextPrompt,
              },
              revisionSource: {
                artifactId: target.artifactId,
                jobId: target.jobId,
                nodeId: target.nodeId,
                title: target.title,
                url: target.url,
              },
              userRequest: brief,
            },
          }),
        });
        const createdPayload = await response.json();
        const createdJob = mapPersistedJob(createdPayload);
        if (!response.ok || !createdJob) throw new Error("group revision job creation failed");

        const runResponse = await apiFetch(`/api/jobs/${encodeURIComponent(createdJob.id)}/run`, {
          method: "POST",
        });
        const runPayload = await runResponse.json();
        const queuedJob = mapPersistedJob(runPayload.job) ?? createdJob;
        if (!runResponse.ok) throw new Error(getStringValue(runPayload.error) || "group revision job run failed");
        queuedJobs.push(queuedJob);
      } catch (error) {
        failedCount += 1;
        console.error("Failed to run result group revision item:", error);
      }
    }

    if (queuedJobs.length > 0) {
      setJobs((items) => [
        ...queuedJobs,
        ...items.filter((item) => !queuedJobs.some((job) => job.id === item.id)),
      ]);
      setAgentPlanDiff(buildAgentResultGroupRevisionDiff(group, brief, targets.length, queuedJobs.length, protectedCount));
      setWorkflowMessage(`已提交「${group.title}」分组修改任务`);
      setComposeMessage(buildAgentResultGroupRevisionMessage(group, brief, targets.length, queuedJobs.length, failedCount, protectedCount));
      setComposeBrief("");
      void Promise.allSettled([refreshJobs(), refreshArtifacts(), refreshQueue(), refreshProjects()]);
    } else {
      setAgentPlanDiff(buildAgentResultGroupRevisionDiff(group, brief, targets.length, 0, protectedCount));
      setComposeMessage(`「${group.title}」分组修改任务创建失败，没有任务提交成功。`);
      setJobMessage("分组修改任务创建失败");
    }
    setComposingWorkflow(false);
  };

  const handleComposeWorkflow = async () => {
    if (agentImageEditTarget) {
      await handleRunAgentImageRevision();
      return;
    }

    const brief = composeBrief.trim();
    if (!brief) {
      setComposeMessage("先输入一个需求 brief");
      return;
    }

    if (workflowPlanPreview) {
      const planEdit = applyAgentNaturalLanguagePlanEdit({
        preview: workflowPlanPreview,
        draft: pendingWorkflowDraft,
        userBrief: brief,
      });
      if (planEdit.changed) {
        setWorkflowPlanPreview(planEdit.preview);
        if (planEdit.draft) setPendingWorkflowDraft(planEdit.draft);
        setPendingAgentSamplePlan((plan) =>
          plan ? { ...plan, preview: planEdit.preview } : plan
        );
        setAgentPlanDiff(planEdit.diff ?? null);
        setAgentLastUserBrief(brief);
        setComposeBrief("");
        setComposeMessage(planEdit.message);
        setWorkflowMessage("已按你的话调整计划");
        return;
      }

      if (pendingAgentSamplePlan) {
        setComposeMessage("这句计划修改我还没理解。可以直接说：少两张、删掉某组、详情页烧字、横版不要字、加商场场景。");
        return;
      }

      await runWorkflowCompose(
        buildAgentPlanRevisionBrief(workflowPlanPreview, brief),
        canvasProductWorkflowContext ? null : activeProductComponent,
        "compose",
        brief
      );
      return;
    }

    if (activeAgentGenerationFrameNode) {
      const updatedNode = applyPromptToGenerationFrameNode(activeAgentGenerationFrameNode, brief);
      pushHistorySnapshot();
      setCanvasNodes((nodes) =>
        nodes.some((node) => node.id === updatedNode.id)
          ? nodes.map((node) => (node.id === updatedNode.id ? updatedNode : node))
          : [...nodes, updatedNode]
      );
      setWorkflowPlanPreview(null);
      setPendingWorkflowDraft(null);
      if (!activeAgentGenerationFrameHasSameBrief) {
        setWorkflowMessage("已把右上角需求写入当前任务");
        setComposeMessage("已更新当前任务，再点一次开始生成");
        return;
      }

      setWorkflowMessage("正在创建生成任务");
      setComposeMessage(`正在为「${cleanGenerationFrameDisplayLabel(updatedNode.data.label || "当前任务")}」创建任务...`);
      await handleCreateJobForNode(updatedNode);
      return;
    }

    await runWorkflowCompose(brief, canvasProductWorkflowContext ? null : activeProductComponent, "compose", brief);
  };

  const handleEditWorkflowPlanFromAgent = async (
    visiblePreview?: WorkflowPlanPreview | null,
    scopeGroup?: AgentPlanGroup | null
  ) => {
    const brief = composeBrief.trim();
    const activePreview = visiblePreview ?? workflowPlanPreview;
    if (!brief || !activePreview) {
      setComposeMessage("当前计划还没准备好，稍后再试");
      return;
    }

    const planEdit = applyAgentNaturalLanguagePlanEdit({
      preview: activePreview,
      draft: pendingWorkflowDraft,
      userBrief: brief,
      scopeGroup,
    });
    const effectivePlanEdit = planEdit.changed
      ? planEdit
      : applyAgentNaturalLanguagePlanEditFallbackOnly({
          preview: activePreview,
          draft: pendingWorkflowDraft,
          userBrief: brief,
          scopeGroup,
        });
    if (effectivePlanEdit.changed) {
      setWorkflowPlanPreview(effectivePlanEdit.preview);
      if (effectivePlanEdit.draft) setPendingWorkflowDraft(effectivePlanEdit.draft);
      setPendingAgentSamplePlan((plan) =>
        plan ? { ...plan, preview: effectivePlanEdit.preview } : plan
      );
      setAgentPlanDiff(effectivePlanEdit.diff ?? null);
      setAgentLastUserBrief(brief);
      setComposeBrief("");
      setComposeMessage(effectivePlanEdit.message);
      setWorkflowMessage("已按你的话调整计划");
      return;
    }

    if (pendingAgentSamplePlan) {
      setComposeMessage("这句计划修改我还没理解。可以直接说：少两张、删掉某组、详情页烧字、横版不要字、加商场场景。");
      return;
    }

    await runWorkflowCompose(
      buildAgentPlanRevisionBrief(activePreview, brief),
      canvasProductWorkflowContext ? null : activeProductComponent,
      "compose",
      brief
    );
  };

  const handleComposeImportedProductWorkflow = async () => {
    if (!activeProductComponent) {
      setProductImportMessage("先保存一个商品组件");
      return;
    }

    const brief = composeBrief.trim() || createProductWorkflowBrief(activeProductComponent);
    if (!composeBrief.trim()) setComposeBrief(brief);
    await runWorkflowCompose(brief, activeProductComponent, "product-import");
  };

  const handlePreviewProductImport = async () => {
    const text = productImportText.trim();
    if (!text) {
      setProductImportMessage("先粘贴商品参数");
      return;
    }

    setPreviewingProductImport(true);
    setProductImportMessage("正在解析商品参数...");

    try {
      const response = await apiFetch("/api/product-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, dryRun: true }),
      });
      if (!response.ok) throw new Error("product import preview failed");

      const preview = mapProductImportPreview(await response.json());
      setProductImportPreview(preview);
      setProductImportMessage(
        `已解析 ${preview.parsedProducts.length} 个商品，${preview.rejectedRows.length} 行需检查`
      );
    } catch (error) {
      console.error("Failed to preview product import:", error);
      setProductImportMessage("商品参数解析失败，请检查格式");
    } finally {
      setPreviewingProductImport(false);
    }
  };

  const handleSaveProductImport = async () => {
    const text = productImportText.trim();
    if (!text) {
      setProductImportMessage("先粘贴商品参数");
      return;
    }

    setSavingProductImport(true);
    setProductImportMessage("正在保存商品组件...");

    try {
      const response = await apiFetch("/api/product-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, createComponents: true }),
      });
      if (!response.ok) throw new Error("product import save failed");

      const payload = await response.json();
      const preview = mapProductImportPreview(payload);
      const created = Array.isArray(payload.savedComponents?.created)
        ? payload.savedComponents.created.map(mapPersistedComponent).filter(Boolean) as PersistedComponent[]
        : [];
      const skippedCount = Array.isArray(payload.savedComponents?.skippedDuplicates)
        ? payload.savedComponents.skippedDuplicates.length
        : 0;

      if (created.length > 0) {
        setComponents((items) => [
          ...created,
          ...items.filter((item) => !created.some((component) => component.id === item.id)),
        ]);
        setActiveCategory("商品");
      }

      const firstProductComponent = created.find((component) => getComponentCategory(component.type) === "商品");
      if (firstProductComponent) {
        const productNodeId = canvasNodes.some((node) => node.id === "product")
          ? "product"
          : `component-node-${firstProductComponent.id}-${Date.now()}-${canvasNodes.length}`;
        pushHistorySnapshot();
        setActiveProductComponentId(firstProductComponent.id);
        setCanvasNodes((nodes) => upsertProductComponentNode(nodes, firstProductComponent, productNodeId));
        setSelectedNodeId(productNodeId);
        requestCanvasFocus([productNodeId]);
        setWorkflowMessage("导入商品已接入画布，可继续生成工作流");
      }

      setProductImportPreview(preview);
      setProductImportMessage(
        firstProductComponent
          ? `已保存 ${created.length} 个商品组件，跳过 ${skippedCount} 个重复项；已接入画布`
          : `已保存 ${created.length} 个商品组件，跳过 ${skippedCount} 个重复项`
      );
    } catch (error) {
      console.error("Failed to save product import:", error);
      setProductImportMessage("商品组件保存失败，请稍后重试");
    } finally {
      setSavingProductImport(false);
    }
  };

  const handleCreateJobForNode = async (node: CanvasWorkbenchNode) => {
    setCreatingJobForNodeId(node.id);
    setJobMessage(isExportPackNode(node) ? "正在规划导出包任务..." : "正在加入任务队列...");

    try {
      const nodeProductAsset = isGenerationFrameNode(node) ? undefined : latestProductAsset;
      const referenceContext = buildCanvasGenerationReferenceContext({
        targetNode: node,
        nodes: canvasNodes,
        edges: canvasEdges,
        components,
        assets: allAssets,
        productAsset: nodeProductAsset,
      });
      const baseMetadata = buildBaseJobMetadata(node, nodeProductAsset, referenceContext);
      const projectMetadata = activeProjectId
        ? {
            projectId: activeProjectId,
            campaignId: activeCampaignId || undefined,
            projectSource: "canvas-project",
          }
        : {};
      const scopedBaseMetadata = {
        ...baseMetadata,
        ...projectMetadata,
      };

      if (isGenerationFrameNode(node)) {
        const frameState = migrateLegacyGenerationFrameData(node.data, node.id);
        const runDecision = resolveGenerationFrameRunRule({
          outputType: getStringValue(node.data.generationOutputType) ?? frameState.outputType,
          frame: frameState,
          userRequest: getStringValue(node.data.generationUserRequest) ?? frameState.prompt,
        });
        if (!runDecision.canRun) {
          setJobMessage(runDecision.message ?? "任务缺少运行输入");
          return;
        }
        const batchId = `frame_batch_${node.id}_${Date.now()}`;
        const runNode = prepareGenerationFrameNodeForNewBatch(node, batchId);
        const nodesForJob = canvasNodes.some((item) => item.id === runNode.id)
          ? canvasNodes.map((item) => (item.id === runNode.id ? runNode : item))
          : [...canvasNodes, runNode];
        setCanvasNodes(nodesForJob);
        let workflowIdForJob = workflowIdRef.current ?? workflowId;
        try {
          workflowIdForJob = (await saveWorkflowSnapshot({
            silent: true,
            nodes: nodesForJob,
            edges: canvasEdges,
          })) ?? workflowIdForJob;
        } catch {
          setWorkflowMessage("画布自动保存失败，本次结果可能不会在刷新后恢复");
        }
        const planPrompt = buildJobPromptFromNode(runNode, nodeProductAsset, referenceContext);
        const planItems = buildGenerationFramePlanItems(runNode, planPrompt);
        const confirmedProviderCallLimit = planItems.length;
        const generationUserRequest = getStringValue(node.data.generationUserRequest) ?? frameState.prompt ?? "";
        const generationOutputType = getStringValue(node.data.generationOutputType) ?? frameState.outputType ?? "canvas_generation_frame";
        const response = await apiFetch("/api/generation-plans/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflowId: workflowIdForJob,
            projectId: activeProjectId || undefined,
            campaignId: activeCampaignId || undefined,
            frameNodeId: runNode.id,
            batchId,
            batchTitle: `${node.data.label} 图组`,
            request: generationUserRequest,
            userRequest: generationUserRequest,
            outputType: generationOutputType,
            requiredReferenceRoles: runDecision.requiredReferenceRoles,
            referenceContext,
            referenceImages: referenceContext.images,
            style: generationOutputType,
            modelIds: [],
            enqueue: true,
            confirmedProviderCallLimit,
            items: planItems.map((item) => ({
              ...item,
              metadata: {
                ...scopedBaseMetadata,
                ...item.metadata,
                batchId,
                frameNodeId: runNode.id,
              },
            })),
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          const issue = Array.isArray(payload.validation?.issues) && payload.validation.issues.length > 0
            ? payload.validation.issues[0]
            : payload.error;
          throw new Error(typeof issue === "string" ? issue : "generation plan run failed");
        }

        const createdJobs = Array.isArray(payload.jobs)
          ? (payload.jobs.map(mapPersistedJob).filter(Boolean) as PersistedGenerationJob[])
          : [];
        if (createdJobs.length === 0) throw new Error("generation plan created no jobs");
        const createdAt = new Date().toISOString();
        const visibleCreatedJobs = createdJobs.map((job) =>
          job.status === "pending" || job.status === "queued"
            ? {
                ...job,
                metadata: {
                  ...job.metadata,
                  queuedAt: typeof job.metadata.queuedAt === "string" ? job.metadata.queuedAt : createdAt,
                },
              }
            : job
        );

        setJobs((items) => [
          ...visibleCreatedJobs,
          ...items.filter((item) => !visibleCreatedJobs.some((created) => created.id === item.id)),
        ]);
        const agentPlanText = getStringValue(payload.plan?.agentPlan?.summary?.text);
        const createdMessage = agentPlanText
          ? `开始生成 ${createdJobs.length} 张图 · ${agentPlanText}`
          : `开始生成 ${createdJobs.length} 张图`;
        setJobMessage(createdMessage);
        setWorkflowMessage(`已创建 ${createdJobs.length} 张图，结果会自动回填到画布`);
        setComposeMessage(createdMessage);
        void Promise.allSettled([refreshJobs(), refreshArtifacts(), refreshQueue(), refreshProjects()]);
        return;
      }

      if (isExportPackNode(node)) {
        const plannedJobs = buildExportPackBatchPlan(node);
        if (plannedJobs.length === 0) throw new Error("empty export pack plan");

        const results = await Promise.allSettled(
          plannedJobs.map((plannedJob) =>
            createCanvasJob({
              workflowId,
              node,
              prompt: appendGenerationReferencePrompt(plannedJob.prompt, referenceContext),
              metadata: {
                ...scopedBaseMetadata,
                ...plannedJob.metadata,
              },
            })
          )
        );
        const createdJobs = results
          .filter((result): result is PromiseFulfilledResult<PersistedGenerationJob> => (
            result.status === "fulfilled" && !!result.value
          ))
          .map((result) => result.value);
        const failedCount = results.length - createdJobs.length;

        if (createdJobs.length > 0) {
          setJobs((items) => [
            ...createdJobs,
            ...items.filter((item) => !createdJobs.some((created) => created.id === item.id)),
          ]);
          setJobMessage(
            failedCount > 0
              ? `已创建 ${createdJobs.length} 个导出包任务，${failedCount} 个失败`
              : `已创建 ${createdJobs.length} 个导出包任务`
          );
          void refreshProjects();
          return;
        }

        throw new Error("all export pack jobs failed");
      }

      const created = await createCanvasJob({
        workflowId,
        node,
        prompt: buildJobPromptFromNode(node, nodeProductAsset, referenceContext),
        metadata: scopedBaseMetadata,
      });

      if (created) {
        setJobs((items) => [created, ...items.filter((item) => item.id !== created.id)]);
        setJobMessage("任务已加入队列");
        void refreshProjects();
      }
    } catch (error) {
      console.error("Failed to create canvas job:", error);
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : "任务创建失败，请稍后重试";
      setJobMessage(message);
      setWorkflowMessage(message);
      setComposeMessage(message);
    } finally {
      setCreatingJobForNodeId(null);
    }
  };

  async function handleGenerateAgentSample(confirmedPlan?: PendingAgentSamplePlan) {
    const productNode = findCanvasProductReferenceNode(canvasNodes);
    if (!productNode) {
      setComposeMessage("先导入一张商品图，我再生成样张");
      agentProductInputRef.current?.click();
      return;
    }

    const action = getLineGenerationAction("custom_template");
    if (!action) {
      setJobMessage("没有可用的生成模板");
      return;
    }

    const userBrief = confirmedPlan?.userBrief ?? composeBrief.trim();
    const structuredProjectStarterPrompt =
      confirmedPlan?.structuredProjectStarterPrompt ??
      (userBrief ? undefined : activeProjectStarterPrompt || undefined);
    const cleanBrief = userBrief || structuredProjectStarterPrompt || "";
    const explicitSampleBurnIn = hasExplicitCopyBurnInRequest(cleanBrief);
    const sampleOutputCount = confirmedPlan?.preview.estimatedCount ??
      resolveAgentSampleOutputCount(composeBrief, workflowPlanPreview ?? appliedWorkflowPlanPreview);
    const agentSampleOutputType = confirmedPlan?.outputType ?? "custom_template";
    const sampleGuidance = explicitSampleBurnIn
      ? `先生成 ${sampleOutputCount} 张样张用于确认方向。用户已明确要求文案进图，短文案必须烧进画面安全区。`
      : `先生成 ${sampleOutputCount} 张样张用于确认方向。文案默认作为可编辑图层，除非明确要求，不直接烧进图片。`;
    const generationRequest = confirmedPlan?.generationRequest ?? [
        cleanBrief || "给当前商品生成一组淘宝商品样张，包含主图海报、卖点图、细节图和生活场景图。",
        sampleGuidance,
      ].join("\n");
    const framePosition = findAvailableGenerationFramePosition(canvasNodes, {
      anchorNode: productNode,
      preferredPosition: {
        x: productNode.position.x + 430,
        y: productNode.position.y,
      },
    });
    const now = new Date().toISOString();
    const baseFrameNode = createTypedGenerationFrameNode({
      action,
      index: canvasNodes.length,
      position: framePosition,
    });
    const sampleReferenceNodes = getAgentSampleReferenceNodes(canvasNodes, {
      productNode,
    });
    const generationFrame = sampleReferenceNodes.reduce(
      (frame, referenceNode) =>
        bindNodeToGenerationFrameSlot(frame, referenceNode.node, {
          role: referenceNode.role,
          updatedAt: now,
        }),
      {
        ...migrateLegacyGenerationFrameData(baseFrameNode.data, baseFrameNode.id),
        prompt: generationRequest,
        outputType: agentSampleOutputType,
        updatedAt: now,
      }
    );
    const frameNode: CanvasWorkbenchNode = {
      ...baseFrameNode,
      data: {
        ...baseFrameNode.data,
        label: "样张图组",
        caption: "已接入商品图，先出少量样张确认方向。",
        source: "agent-sample",
        generationOutputType: agentSampleOutputType,
        generationUserRequest: generationRequest,
        generationFrame,
        metrics: updateGenerationFrameSlotMetrics(
          updateGenerationFrameMetrics(["样张", `${sampleOutputCount} 张`, "可继续扩展"], generationRequest),
          generationFrame
        ),
      },
    };
    const frameEdges: CanvasWorkbenchEdge[] = sampleReferenceNodes.map(({ node, role }) => ({
      id: `${node.id}-${frameNode.id}`,
      source: node.id,
      target: frameNode.id,
      label: role === "product" ? "生成样张" : getAgentReferenceEdgeLabel(role),
      animated: true,
    }));
    const nextNodes = [...canvasNodes, frameNode];
    const nextEdges = [...canvasEdges, ...frameEdges];

    if (!confirmedPlan) {
      setGeneratingAgentSample(true);
      setComposeMessage(`正在规划 ${sampleOutputCount} 张样张...`);
      setJobMessage("");

      try {
        const referenceContext = buildCanvasGenerationReferenceContext({
          targetNode: frameNode,
          nodes: nextNodes,
          edges: nextEdges,
          components,
          assets: allAssets,
          productAsset: undefined,
        });
        const runDecision = resolveGenerationFrameRunRule({
          outputType: agentSampleOutputType,
          frame: generationFrame,
          userRequest: generationRequest,
        });
        if (!runDecision.canRun) {
          setComposeMessage(runDecision.message ?? "任务缺少运行输入");
          return;
        }

        const sampleCopyRenderMode = inferAgentCopyRenderMode(
          cleanBrief || generationRequest,
          explicitSampleBurnIn
        );
        const planPrompt = buildJobPromptFromNode(frameNode, undefined, referenceContext);
        const planItems = applyAgentSampleCopyPlan({
          items: buildGenerationFramePlanItems(frameNode, planPrompt).slice(0, sampleOutputCount),
          sampleCopyRenderMode,
          referenceContext,
          request: cleanBrief || generationRequest,
        });
        const preview = buildAgentSampleWorkflowPlanPreview({
          planItems,
          generationRequest,
          sampleOutputCount: planItems.length,
          referenceContext,
        });

        setPendingAgentSamplePlan({
          preview,
          generationRequest,
          userBrief,
          structuredProjectStarterPrompt,
          outputType: agentSampleOutputType,
        });
        setWorkflowPlanPreview(preview);
        setAppliedWorkflowPlanPreview(null);
        setPendingWorkflowDraft(null);
        setAgentPlanDiff(null);
        setAgentLastUserBrief(userBrief || cleanBrief || generationRequest);
        setComposeBrief("");
        setWorkflowMessage("已生成样张计划，确认后再生成");
        setComposeMessage(`已拆成 ${preview.estimatedCount} 张样张计划；确认后才会创建生成任务。`);
      } catch (error) {
        console.error("Failed to preview agent sample plan:", error);
        setComposeMessage("样张计划生成失败，请稍后重试");
      } finally {
        setGeneratingAgentSample(false);
      }
      return;
    }

    pushHistorySnapshot();
    setCanvasNodes(nextNodes);
    setCanvasEdges(nextEdges);
    setSelectedNodeId(productNode.id);
    requestCanvasFocus([productNode.id, ...sampleReferenceNodes.map(({ node }) => node.id)]);
    setGeneratingAgentSample(true);
    setJobMessage(`正在创建 ${sampleOutputCount} 张样张任务...`);

    try {
      let workflowIdForJob = workflowIdRef.current ?? workflowId;
      try {
        workflowIdForJob = (await saveWorkflowSnapshot({
          silent: true,
          nodes: nextNodes,
          edges: nextEdges,
        })) ?? workflowIdForJob;
      } catch {
        setWorkflowMessage("画布自动保存失败，本次结果可能不会在刷新后恢复");
      }

      const referenceContext = buildCanvasGenerationReferenceContext({
        targetNode: frameNode,
        nodes: nextNodes,
        edges: nextEdges,
        components,
        assets: allAssets,
        productAsset: undefined,
      });
      const runDecision = resolveGenerationFrameRunRule({
        outputType: agentSampleOutputType,
        frame: generationFrame,
        userRequest: generationRequest,
      });
      if (!runDecision.canRun) {
        setJobMessage(runDecision.message ?? "任务缺少运行输入");
        return;
      }

      const sampleCopyRenderMode = inferAgentCopyRenderMode(
        cleanBrief || generationRequest,
        explicitSampleBurnIn
      );
      const requestCopyRenderMode = sampleCopyRenderMode === "burn_in"
        ? "metadata_only"
        : sampleCopyRenderMode;
      const planPrompt = buildJobPromptFromNode(frameNode, undefined, referenceContext);
      const fallbackPlanItems = applyAgentSampleCopyPlan({
        items: buildGenerationFramePlanItems(frameNode, planPrompt).slice(0, sampleOutputCount),
        sampleCopyRenderMode,
        referenceContext,
        request: cleanBrief || generationRequest,
      });
      const planItems = buildAgentSampleRunItemsFromPreview({
        preview: confirmedPlan.preview,
        fallbackItems: fallbackPlanItems,
        basePrompt: planPrompt,
      });
      const batchId = `agent_sample_${frameNode.id}_${Date.now()}`;
      const baseMetadata = {
        ...buildBaseJobMetadata(frameNode, undefined, referenceContext),
        ...(activeProjectId
          ? {
              projectId: activeProjectId,
              campaignId: activeCampaignId || undefined,
              projectSource: "canvas-project",
            }
          : {}),
      };
      const response = await apiFetch("/api/generation-plans/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId: workflowIdForJob,
          projectId: activeProjectId || undefined,
          campaignId: activeCampaignId || undefined,
          frameNodeId: frameNode.id,
          batchId,
          batchTitle: "Agent 样张",
          request: generationRequest,
          userRequest: userBrief || generationRequest,
          brief: generationRequest,
          projectStarterPrompt: structuredProjectStarterPrompt,
          projectIntent: structuredProjectStarterPrompt,
          outputType: agentSampleOutputType,
          copyRenderMode: requestCopyRenderMode,
          requiredReferenceRoles: runDecision.requiredReferenceRoles,
          referenceContext,
          referenceImages: referenceContext.images,
          style: agentSampleOutputType,
          modelIds: [],
          agentPlanMode: "deterministic",
          enqueue: true,
          confirmedProviderCallLimit: planItems.length,
          items: planItems.map((item) => ({
            ...item,
            metadata: {
              ...baseMetadata,
              ...item.metadata,
              batchId,
              frameNodeId: frameNode.id,
              agentSample: true,
            },
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        const issue = Array.isArray(payload.validation?.issues) && payload.validation.issues.length > 0
          ? payload.validation.issues[0]
          : payload.error;
        throw new Error(typeof issue === "string" ? issue : "agent sample run failed");
      }

      const createdJobs = Array.isArray(payload.jobs)
        ? (payload.jobs.map(mapPersistedJob).filter(Boolean) as PersistedGenerationJob[])
        : [];
      if (createdJobs.length === 0) throw new Error("agent sample created no jobs");
      const agentPlanText = getStringValue(payload.plan?.agentPlan?.summary?.text);

      setJobs((items) => [
        ...createdJobs,
        ...items.filter((item) => !createdJobs.some((created) => created.id === item.id)),
      ]);
      setJobMessage(agentPlanText
        ? `已创建 ${createdJobs.length} 张样张任务 · ${agentPlanText}`
        : `已创建 ${createdJobs.length} 张样张任务`);
      setComposeMessage(buildAgentSampleRunFeedbackMessage(confirmedPlan.preview, createdJobs.length, agentPlanText));
      setWorkflowPlanPreview(null);
      setPendingAgentSamplePlan(null);
      setAppliedWorkflowPlanPreview(confirmedPlan.preview);
      void refreshQueue();
      void refreshProjects();
    } catch (error) {
      console.error("Failed to generate agent sample:", error);
      setJobMessage("样张任务创建失败，请稍后重试");
    } finally {
      setGeneratingAgentSample(false);
    }
  }

  useEffect(() => {
    const handleGenerationFrameRun = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string }>).detail;
      if (!detail?.nodeId) return;
      const node = stageNodes.find((item) => item.id === detail.nodeId && isGenerationFrameNode(item));
      if (!node) return;
      void handleCreateJobForNode(node);
    };

    window.addEventListener("image-master:generation-frame-run", handleGenerationFrameRun);
    return () => {
      window.removeEventListener("image-master:generation-frame-run", handleGenerationFrameRun);
    };
  }, [stageNodes, handleCreateJobForNode]);

  const handleRunJob = async (job: PersistedGenerationJob) => {
    setRunningJobId(job.id);
    setJobMessage("正在运行任务...");

    try {
      const response = await apiFetch(`/api/jobs/${job.id}/run`, {
        method: "POST",
      });
      const payload = await response.json();
      const updated = mapPersistedJob(payload.job ?? payload);

      if (!response.ok) {
        if (updated) {
          setJobs((items) => items.map((item) => (item.id === updated.id ? updated : item)));
        }
        throw new Error("job run failed");
      }

      if (updated) {
        setJobs((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      }

      const artifact = mapPersistedArtifact(payload.artifact);
      if (artifact) {
        setArtifacts((items) => [artifact, ...items.filter((item) => item.id !== artifact.id)]);
        const resultNodeId = getArtifactResultNodeId(artifact);
        setSelectedNodeId(resultNodeId);
        requestCanvasFocus([resultNodeId]);
      }

      if (payload.alreadyQueued) {
        setJobMessage("任务已在队列中");
      } else if (payload.alreadyRunning) {
        setJobMessage("任务正在运行中");
      } else if (payload.queued || payload.started || updated?.status === "running") {
        setJobMessage("任务已开始，稍后产物会自动回填");
        void Promise.allSettled([refreshJobs(), refreshArtifacts(), refreshQueue(), refreshProjects()]);
      } else if (artifact || updated?.status === "done" || updated?.status === "completed") {
        setJobMessage("任务已完成，结果已生成；满意后可手动保存到全局资产库");
        void refreshProjects();
      } else {
        setJobMessage("任务状态已更新");
      }
    } catch (error) {
      console.error("Failed to run canvas job:", error);
      setJobMessage("任务运行失败，请稍后重试");
    } finally {
      setRunningJobId(null);
    }
  };

  const handleCancelJob = async (job: PersistedGenerationJob) => {
    setRunningJobId(job.id);
    setJobMessage("正在取消任务...");

    try {
      const response = await apiFetch(`/api/jobs/${job.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "用户取消" }),
      });
      const payload = await response.json();
      const updated = mapPersistedJob(payload.job ?? payload);

      if (updated) {
        setJobs((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      }

      if (!response.ok) throw new Error("job cancel failed");

      setJobMessage("任务已取消");
      void Promise.allSettled([refreshJobs(), refreshArtifacts(), refreshQueue(), refreshProjects()]);
    } catch (error) {
      console.error("Failed to cancel canvas job:", error);
      setJobMessage("任务取消失败，请稍后重试");
    } finally {
      setRunningJobId(null);
    }
  };

  const handleRetryJob = async (job: PersistedGenerationJob) => {
    setRunningJobId(job.id);
    setJobMessage("正在重置任务...");

    try {
      const response = await apiFetch(`/api/jobs/${job.id}/retry`, {
        method: "POST",
      });
      const payload = await response.json();
      const updated = mapPersistedJob(payload.job ?? payload);

      if (updated) {
        setJobs((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      }

      if (!response.ok) throw new Error("job retry failed");

      const runResponse = await apiFetch(`/api/jobs/${job.id}/run`, {
        method: "POST",
      });
      const runPayload = await runResponse.json();
      const running = mapPersistedJob(runPayload.job ?? runPayload);

      if (running) {
        setJobs((items) => items.map((item) => (item.id === running.id ? running : item)));
      }

      if (!runResponse.ok) throw new Error("job run failed");

      setJobMessage("任务已重试并重新加入队列");
      void Promise.allSettled([refreshJobs(), refreshArtifacts(), refreshQueue(), refreshProjects()]);
    } catch (error) {
      console.error("Failed to retry canvas job:", error);
      setJobMessage("任务重试失败，请稍后重试");
    } finally {
      setRunningJobId(null);
    }
  };

  const handleRetryImageJob = async (
    job: PersistedGenerationJob,
    options: { groupTitle?: string } = {}
  ) => {
    setRunningJobId(job.id);
    setJobMessage("正在估算单图重试成本...");

    try {
      const dryRunResponse = await apiFetch(`/api/jobs/${job.id}/retry-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const dryRun = await dryRunResponse.json();
      if (!dryRunResponse.ok) {
        throw new Error(typeof dryRun.error === "string" ? dryRun.error : "image retry dry-run failed");
      }

      const providerCallLimit =
        typeof dryRun.estimate?.maxProviderCallCount === "number"
          ? dryRun.estimate.maxProviderCallCount
          : 2;
      setJobMessage(`已确认单图重试上限 ${providerCallLimit} 次 provider 调用，正在生成...`);

      const response = await apiFetch(`/api/jobs/${job.id}/retry-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmedProviderCallLimit: providerCallLimit,
          groupTitle: options.groupTitle,
        }),
      });
      const payload = await response.json();
      const updated = mapPersistedJob(payload.job ?? payload);
      const artifact = mapPersistedArtifact(payload.artifact);

      if (updated) {
        setJobs((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      }
      if (artifact) {
        setArtifacts((items) => [artifact, ...items.filter((item) => item.id !== artifact.id)]);
        const resultNodeId = getArtifactResultNodeId(artifact);
        setSelectedNodeId(resultNodeId);
        requestCanvasFocus([resultNodeId]);
      }

      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "image retry failed");
      }

      setJobMessage(
        payload.retry?.usesProductReference
          ? "当前图片已带商品参考图重做完成"
          : "当前图片已按原 prompt 重做完成"
      );
      void Promise.allSettled([refreshJobs(), refreshArtifacts(), refreshQueue(), refreshProjects()]);
    } catch (error) {
      console.error("Failed to retry image job:", error);
      setJobMessage(error instanceof Error ? error.message : "当前图片重做失败，请稍后重试");
    } finally {
      setRunningJobId(null);
    }
  };

  const handleRerunImageJob = async (
    job: PersistedGenerationJob,
    options: { groupTitle?: string } = {}
  ) => {
    setRunningJobId(job.id);
    setJobMessage("正在带原参考图再做一版...");

    try {
      const response = await apiFetch(`/api/jobs/${encodeURIComponent(job.id)}/rerun`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${getJobNodeLabel(job)} 再做一版`,
          note: "Created from canvas image detail with original references",
          groupTitle: options.groupTitle,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      const payloadRecord = isPlainRecord(payload) ? payload : undefined;
      const queueResult = isPlainRecord(payloadRecord?.queueResult) ? payloadRecord.queueResult : undefined;
      const created = mapPersistedJob(payloadRecord?.job ?? queueResult?.job ?? payload);

      if (created) {
        setJobs((items) =>
          items.some((item) => item.id === created.id)
            ? items.map((item) => (item.id === created.id ? created : item))
            : [created, ...items]
        );
      }

      if (!response.ok) {
        throw new Error(getStringValue(payloadRecord?.error) || "image rerun failed");
      }

      setJobMessage(
        payloadRecord?.queued
          ? "已带原参考图加入队列"
          : "已创建再做一版任务"
      );
      void Promise.allSettled([refreshJobs(), refreshArtifacts(), refreshQueue(), refreshProjects()]);
    } catch (error) {
      console.error("Failed to rerun canvas image job:", error);
      setJobMessage(error instanceof Error ? error.message : "再做一版失败，请稍后重试");
    } finally {
      setRunningJobId(null);
    }
  };

  const handleMarkBatchQaPassed = useCallback(
    async (batch: ExportPackBatchSummary, qaReport?: ExportPackQaReport) => {
      const reviewTargets = getBatchManualReviewTargets(qaReport);
      if (reviewTargets.length === 0) {
        setExportPackMessage("当前批次还没有可写入的完成产物人工复核项");
        return;
      }

      setReviewingBatchId(batch.batchId);
      setExportPackMessage(`正在写入 ${reviewTargets.length} 个 QA 复核项...`);

      try {
        const results = await Promise.allSettled(
          reviewTargets.map((target) =>
            apiFetch(`/api/export-packs/${encodeURIComponent(batch.batchId)}/qa/review`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jobId: target.jobId,
                checkId: target.checkId,
                status: "pass",
                note: "Canvas quick review passed",
                reviewer: "canvas",
              }),
            })
          )
        );
        const failedCount = results.filter(
          (result) => result.status === "rejected" || !result.value.ok
        ).length;
        await Promise.allSettled([refreshJobs(), refreshProjects()]);
        setExportPackMessage(
          failedCount > 0
            ? `已写入 ${reviewTargets.length - failedCount} 个 QA 项，${failedCount} 个失败`
            : `已写入 ${reviewTargets.length} 个 QA 复核项`
        );
      } catch (error) {
        console.error("Failed to write batch QA review:", error);
        setExportPackMessage("QA 复核写入失败，请稍后重试");
      } finally {
        setReviewingBatchId(null);
      }
    },
    [refreshJobs, refreshProjects]
  );

  const handleUpdateQaReview = useCallback(
    async (
      batch: ExportPackBatchSummary,
      jobId: string,
      checkId: string,
      status: "pass" | "fail" | "manual"
    ) => {
      const reviewKey = `${batch.batchId}:${jobId}:${checkId}`;
      setReviewingCheckKey(reviewKey);
      setExportPackMessage("正在写入 QA 复核...");

      try {
        const response = await apiFetch(
          `/api/export-packs/${encodeURIComponent(batch.batchId)}/qa/review`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId,
              checkId,
              status,
              note:
                status === "pass"
                  ? "Review passed"
                  : status === "fail"
                    ? "Review failed"
                    : "Review reset",
              reviewer: "canvas",
            }),
          }
        );
        if (!response.ok) throw new Error("qa review update failed");
        await Promise.allSettled([refreshJobs(), refreshProjects()]);
        setExportPackMessage(
          status === "pass" ? "QA 项已标记通过" : status === "fail" ? "QA 项已标记不通过" : "QA 项已重置"
        );
      } catch (error) {
        console.error("Failed to update QA review:", error);
        setExportPackMessage("QA 复核写入失败，请确认产物已完成");
      } finally {
        setReviewingCheckKey(null);
      }
    },
    [refreshJobs, refreshProjects]
  );

  const handleUpdateExportPackBatchState = useCallback(
    async (batch: ExportPackBatchSummary, state: "locked" | "delivered") => {
      const batchState = batch.batchState;
      if (!batchState?.projectId) {
        setProjectMessage("这个批次还没有项目归属，先刷新项目状态");
        return;
      }

      setTransitioningBatchId(`${batch.batchId}:${state}`);
      setProjectMessage(state === "locked" ? "正在锁定导出包..." : "正在交付导出包...");

      try {
        const response = await apiFetch(`/api/projects/${encodeURIComponent(batchState.projectId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entityType: "batch",
            batchId: batch.batchId,
            state,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload.error === "string" ? payload.error : "batch state update failed");
        }
        await refreshProjects();
        setProjectMessage(state === "locked" ? "导出包已锁定" : "导出包已交付");
      } catch (error) {
        console.error("Failed to update export pack batch state:", error);
        setProjectMessage(error instanceof Error ? error.message : "导出包状态更新失败");
      } finally {
        setTransitioningBatchId(null);
      }
    },
    [refreshProjects]
  );

  const handleArchiveExportPackBatchJobs = useCallback(
    async (batch: ExportPackBatchSummary) => {
      const batchState = batch.batchState;
      if (!batchState?.projectId) {
        setProjectMessage("这个批次还没有项目归属，先刷新项目状态");
        return;
      }

      setArchivingBatchId(batch.batchId);
      setExportPackMessage("正在归档批次并取消未完成 jobs；不会启动 provider...");

      try {
        const response = await apiFetch(`/api/projects/${encodeURIComponent(batchState.projectId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entityType: "batch",
            batchId: batch.batchId,
            action: "archive_cleanup",
            reason: "Canvas 批次归档清理",
            archivedBy: "canvas",
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload.error === "string" ? payload.error : "批次归档清理失败");
        }

        const cleanup = isPlainRecord(payload.archiveCleanup) ? payload.archiveCleanup : {};
        const cancelledCount = Array.isArray(cleanup.cancelledJobIds)
          ? cleanup.cancelledJobIds.length
          : 0;
        const skippedCount = Array.isArray(cleanup.skippedJobIds) ? cleanup.skippedJobIds.length : 0;
        await Promise.allSettled([refreshJobs(), refreshQueue(), refreshProjects()]);
        setExportPackMessage(
          `批次已归档：取消 ${cancelledCount} 个未完成 jobs，保留 ${skippedCount} 个已完成/失败记录`
        );
      } catch (error) {
        console.error("Failed to archive export pack batch jobs:", error);
        setExportPackMessage(error instanceof Error ? error.message : "批次归档清理失败");
      } finally {
        setArchivingBatchId(null);
      }
    },
    [refreshJobs, refreshProjects, refreshQueue]
  );

  const handleSelectArtifact = useCallback(
    (artifact: PersistedGeneratedArtifact) => {
      const resultNodeId = getArtifactResultNodeId(artifact);
      if (canvasNodes.some((node) => node.id === resultNodeId)) {
        setSelectedNodeId(resultNodeId);
        requestCanvasFocus([resultNodeId]);
        setArtifactMessage(`已定位到产物节点：${artifact.title}`);
        return;
      }

      if (artifact.url) {
        pushHistorySnapshot();
        setHiddenArtifactNodeIds((ids) => ids.filter((id) => id !== artifact.id));
        setCanvasNodes((nodes) => {
          if (nodes.some((node) => node.id === resultNodeId || (
            node.data.source === "artifact-history" && node.data.artifactId === artifact.id
          ))) {
            return nodes;
          }

          const sourceNode = artifact.nodeId
            ? nodes.find((node) => node.id === artifact.nodeId)
            : undefined;
          const resultIndex = nodes.filter(isArtifactResultCanvasNode).length;
          return [...nodes, createArtifactResultNode(artifact, sourceNode, resultIndex)];
        });
        setSelectedNodeId(resultNodeId);
        requestCanvasFocus([resultNodeId]);
        setArtifactMessage(`已找回产物节点：${artifact.title}`);
        return;
      }

      if (artifact.nodeId && canvasNodes.some((node) => node.id === artifact.nodeId)) {
        setSelectedNodeId(artifact.nodeId);
        requestCanvasFocus([artifact.nodeId]);
        setArtifactMessage(`已定位到节点：${artifact.title}`);
        return;
      }

      setArtifactMessage("这个产物暂未绑定到当前画布节点");
    },
    [canvasNodes, pushHistorySnapshot, requestCanvasFocus]
  );

  const handleOpenGenerationOutputPreview = useCallback(
    (detail: GenerationFrameOutputActionDetail) => {
      const artifactById = new Map(artifacts.map((item) => [item.id, item]));
      const artifactByJobId = new Map(artifacts.filter((item) => item.jobId).map((item) => [item.jobId, item]));
      const jobById = new Map(jobs.map((item) => [item.id, item]));
      const artifact =
        (detail.artifactId ? artifacts.find((item) => item.id === detail.artifactId) : undefined) ??
        (detail.jobId ? artifacts.find((item) => item.jobId === detail.jobId) : undefined);
      const job =
        (detail.jobId ? jobById.get(detail.jobId) : undefined) ??
        (artifact?.jobId ? jobById.get(artifact.jobId) : undefined);
      const url = artifact?.url || detail.url;
      if (!url) {
        setArtifactMessage("这张图还没有可查看的大图");
        return;
      }
      const artifactMetadata = mergeGenerationOutputPreviewMetadata({ artifact, job });
      const sourceNodeId =
        detail.nodeId ||
        artifact?.nodeId ||
        job?.nodeId ||
        getStringValue(artifactMetadata.frameNodeId) ||
        getStringValue(artifactMetadata.sourceNodeId);
      const sourceNode = sourceNodeId
        ? canvasNodes.find((node) => node.id === sourceNodeId)
        : undefined;
      const sourceFrame = sourceNode?.data.generationFrame
        ? normalizeGenerationFrameState(sourceNode.data.generationFrame)
        : undefined;
      const frameItems = (sourceFrame?.outputs ?? [])
        .map((output, index): GenerationOutputPreviewItem | null => {
          const outputUrl = output.url || output.previewUrl;
          if (!outputUrl) return null;
          const outputArtifact =
            (output.artifactId ? artifactById.get(output.artifactId) : undefined) ??
            (output.jobId ? artifactByJobId.get(output.jobId) : undefined);
          const outputJob =
            (output.jobId ? jobById.get(output.jobId) : undefined) ??
            (outputArtifact?.jobId ? jobById.get(outputArtifact.jobId) : undefined);
          const metadata = mergeGenerationOutputPreviewMetadata({
            output,
            artifact: outputArtifact,
            job: outputJob,
          });
          return {
            url: outputUrl,
            title: output.title || `图 ${index + 1}`,
            outputId: output.id,
            artifactId: output.artifactId ?? outputArtifact?.id,
            jobId: output.jobId ?? outputArtifact?.jobId,
            nodeId: output.nodeId || sourceNodeId,
            status: output.status,
            prompt: getGenerationOutputPreviewPrompt({ output, artifact: outputArtifact, job: outputJob, metadata }),
            metadata,
            group: getGenerationOutputPreviewGroup(metadata, outputArtifact),
            provider: outputArtifact?.provider || getStringValue(metadata.provider),
            model: outputArtifact?.model || getStringValue(metadata.model),
            error: outputJob?.error || getStringValue(metadata.error) || getProviderDiagnosticSummary(metadata),
            reviewStatus: outputArtifact ? getArtifactReviewStatus(outputArtifact) : getOutputPreviewReviewStatus(metadata, output.status),
          };
        })
        .filter((item): item is GenerationOutputPreviewItem => Boolean(item));
      const fallbackMetadata = mergeGenerationOutputPreviewMetadata({ artifact, job });
      const fallbackItem: GenerationOutputPreviewItem = {
        url,
        title: detail.title || artifact?.title || "生成图片",
        outputId: detail.outputId,
        artifactId: artifact?.id ?? detail.artifactId,
        jobId: artifact?.jobId ?? detail.jobId,
        nodeId: artifact?.nodeId ?? job?.nodeId ?? detail.nodeId,
        status: detail.status || artifact?.status,
        prompt: getGenerationOutputPreviewPrompt({ artifact, job, metadata: fallbackMetadata }),
        metadata: fallbackMetadata,
        group: getStringValue(detail.group) || getGenerationOutputPreviewGroup(fallbackMetadata, artifact),
        provider: artifact?.provider || getStringValue(fallbackMetadata.provider),
        model: artifact?.model || getStringValue(fallbackMetadata.model),
        error: job?.error || getStringValue(fallbackMetadata.error) || getProviderDiagnosticSummary(fallbackMetadata),
        reviewStatus: artifact ? getArtifactReviewStatus(artifact) : getOutputPreviewReviewStatus(fallbackMetadata, detail.status),
      };
      const items = frameItems.length > 0 ? frameItems : [fallbackItem];
      const index = Math.max(
        0,
        items.findIndex((item) =>
          (!!detail.outputId && item.outputId === detail.outputId) ||
          (!!detail.artifactId && item.artifactId === detail.artifactId) ||
          (!!detail.jobId && item.jobId === detail.jobId) ||
          item.url === url
        )
      );
      setOutputPreview({
        items,
        index,
      });
    },
    [artifacts, canvasNodes, jobs]
  );

  const handleSaveGenerationOutputAsAsset = useCallback(
    async (detail: GenerationFrameOutputActionDetail) => {
      const artifact =
        (detail.artifactId ? artifacts.find((item) => item.id === detail.artifactId) : undefined) ??
        (detail.jobId ? artifacts.find((item) => item.jobId === detail.jobId) : undefined);
      const job = artifact?.jobId
        ? jobs.find((item) => item.id === artifact.jobId)
        : detail.jobId
          ? jobs.find((item) => item.id === detail.jobId)
          : undefined;
      const url = artifact?.url || detail.url;
      if (!url) {
        setArtifactMessage("这张图还没有可保存的图片");
        return;
      }
      const artifactMetadata = mergeGenerationOutputPreviewMetadata({ artifact, job });
      const outputPrompt = getGenerationOutputPreviewPrompt({ artifact, job, metadata: artifactMetadata });
      const sourceNodeId =
        detail.nodeId ||
        artifact?.nodeId ||
        job?.nodeId ||
        getStringValue(artifactMetadata.frameNodeId) ||
        getStringValue(artifactMetadata.sourceNodeId);
      const sourceNode = sourceNodeId
        ? canvasNodes.find((node) => node.id === sourceNodeId)
        : undefined;
      const sourceFrame = sourceNode?.data.generationFrame
        ? normalizeGenerationFrameState(sourceNode.data.generationFrame)
        : undefined;
      const outputType =
        getStringValue(sourceNode?.data.generationOutputType) ||
        sourceFrame?.outputType ||
        getStringValue(artifactMetadata.generationOutputType) ||
        getStringValue(artifactMetadata.style) ||
        artifact?.type;
      const saveTarget = resolveGenerationOutputAssetTarget({
        outputType,
        frameOutputType: sourceFrame?.outputType,
        artifactType: artifact?.type,
      });

      try {
        const response = await apiFetch("/api/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: saveTarget.assetType,
            title: detail.title || artifact?.title || saveTarget.label,
            description: saveTarget.description,
            status: "ready",
            url,
            metadata: {
              source: "generation-frame-output-save",
              libraryScope: "global",
              savedByUser: true,
              originalType: artifact?.type ?? "output",
              savedAssetType: saveTarget.savedAssetType,
              canvasCategory: saveTarget.canvasCategory,
              componentType: saveTarget.componentType,
              generationOutputType: outputType,
              sourceNodeId,
              sourceNodeLabel: sourceNode?.data.label,
              previewUrl: url,
              referenceUrl: url,
              ...buildSavedGenerationOutputTraceMetadata({
                metadata: artifactMetadata,
                artifact,
                job,
                prompt: outputPrompt,
              }),
              outputId: detail.outputId,
              artifactId: artifact?.id ?? detail.artifactId,
              jobId: artifact?.jobId ?? detail.jobId,
              nodeId: artifact?.nodeId ?? detail.nodeId,
              savedAt: new Date().toISOString(),
            },
          }),
        });
        const payload = await response.json();
        const asset = mapPersistedAssetToCanvas(payload);
        if (!response.ok || !asset) throw new Error("asset save failed");

        setPersistedAssets((items) => [asset, ...items.filter((item) => item.id !== asset.id)]);
        setActiveCategory(asset.category);
        setAssetFavoritesOnly(false);
        setActiveBottomPanel("assets");
        setAssetLibraryFocusItemId(`asset:${asset.id}`);
        let reviewMarked = false;
        if (artifact?.id && getArtifactReviewStatus(artifact) !== "approved") {
          const status: ArtifactReviewStatus = "approved";
          const reviewState = {
            status,
            label: getArtifactReviewStatusLabel(status),
            note: "保存为资产时自动标记可用",
            source: "generation-frame-output-save",
            updatedAt: new Date().toISOString(),
          };
          setArtifacts((items) =>
            items.map((item) =>
              item.id === artifact.id
                ? { ...item, metadata: { ...item.metadata, reviewState }, updatedAt: reviewState.updatedAt }
                : item
            )
          );
          setOutputPreview((preview) =>
            preview
              ? {
                  ...preview,
                  items: preview.items.map((item) =>
                    item.artifactId === artifact.id
                      ? {
                          ...item,
                          reviewStatus: status,
                          metadata: { ...(item.metadata ?? {}), reviewState },
                        }
                      : item
                  ),
                }
              : preview
          );
          const highlightedFilter = getResultReviewFilterForArtifactReviewStatus(status);
          if (highlightedFilter) setHighlightedResultReviewFilter(highlightedFilter);

          try {
            const reviewResponse = await apiFetch(`/api/artifacts/${encodeURIComponent(artifact.id)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reviewState }),
            });
            const reviewPayload = await reviewResponse.json().catch(() => null);
            const updatedArtifact = mapPersistedArtifact(reviewPayload);
            if (!reviewResponse.ok || !updatedArtifact) throw new Error("artifact review update failed");
            setArtifacts((items) =>
              items.map((item) => (item.id === updatedArtifact.id ? updatedArtifact : item))
            );
            reviewMarked = true;
          } catch (reviewError) {
            console.error("Failed to mark saved generation output as approved:", reviewError);
            setArtifactMessage(`${saveTarget.message}；挑图状态保存失败，刷新后可能丢失`);
            void refreshArtifacts();
            return;
          }
        }
        setArtifactMessage(reviewMarked ? `${saveTarget.message}，已标记为可用` : saveTarget.message);
      } catch (error) {
        console.error("Failed to save generation output as asset:", error);
        setArtifactMessage("保存失败，请稍后重试");
      }
    },
    [artifacts, canvasNodes, jobs, refreshArtifacts]
  );

  const handleSetArtifactReviewStatus = useCallback(
    async (artifactId: string, status: ArtifactReviewStatus, note?: string) => {
      const artifact = artifacts.find((item) => item.id === artifactId);
      if (!artifact) {
        setArtifactMessage("没有找到这张结果图");
        return;
      }
      const label = getArtifactReviewStatusLabel(status);
      const reviewState = {
        status,
        label,
        note: note || "",
        source: "canvas-review",
        updatedAt: new Date().toISOString(),
      };

      setArtifacts((items) =>
        items.map((item) =>
          item.id === artifactId
            ? { ...item, metadata: { ...item.metadata, reviewState }, updatedAt: reviewState.updatedAt }
            : item
        )
      );
      setOutputPreview((preview) =>
        preview
          ? {
              ...preview,
              items: preview.items.map((item) =>
                item.artifactId === artifactId
                  ? {
                      ...item,
                      reviewStatus: status,
                      metadata: { ...(item.metadata ?? {}), reviewState },
                    }
                  : item
              ),
            }
          : preview
      );
      const highlightedFilter = getResultReviewFilterForArtifactReviewStatus(status);
      if (highlightedFilter) setHighlightedResultReviewFilter(highlightedFilter);
      setArtifactMessage(`已标记「${artifact.title}」为${label}`);

      try {
        const response = await apiFetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewState }),
        });
        const payload = await response.json().catch(() => null);
        const updatedArtifact = mapPersistedArtifact(payload);
        if (!response.ok || !updatedArtifact) throw new Error("artifact review update failed");
        setArtifacts((items) =>
          items.map((item) => (item.id === updatedArtifact.id ? updatedArtifact : item))
        );
      } catch (error) {
        console.error("Failed to update artifact review state:", error);
        setArtifactMessage("挑图状态保存失败，刷新后可能丢失");
        void refreshArtifacts();
      }
    },
    [artifacts, refreshArtifacts, setArtifacts]
  );

  const handleSetArtifactGroupReviewStatus = useCallback(
    async (artifactIds: string[], status: ArtifactReviewStatus, note?: string) => {
      const ids = Array.from(new Set(artifactIds.filter(Boolean)));
      if (ids.length === 0) {
        setArtifactMessage("这组没有可标记的图片");
        return;
      }
      for (const id of ids) {
        await handleSetArtifactReviewStatus(id, status, note);
      }
      setArtifactMessage(`已批量标记 ${ids.length} 张为${getArtifactReviewStatusLabel(status)}`);
    },
    [handleSetArtifactReviewStatus]
  );

  const handleRunArtifactVisualQa = useCallback(
    async (artifactId: string) => {
      const artifact = artifacts.find((item) => item.id === artifactId);
      if (!artifact) {
        setArtifactMessage("没有找到这张结果图");
        return;
      }

      setVisualQaReviewingArtifactId(artifactId);
      setArtifactMessage(`正在审核「${artifact.title}」`);
      try {
        const response = await apiFetch(`/api/artifacts/${encodeURIComponent(artifactId)}/visual-qa`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const payload = await response.json().catch(() => null);
        const updatedArtifact = mapPersistedArtifact(
          payload && typeof payload === "object" && !Array.isArray(payload)
            ? (payload as { artifact?: unknown }).artifact
            : null
        );
        if (!response.ok || !updatedArtifact) throw new Error("artifact visual qa failed");

        setArtifacts((items) =>
          items.map((item) => (item.id === updatedArtifact.id ? updatedArtifact : item))
        );
        setOutputPreview((preview) =>
          preview
            ? {
                ...preview,
                items: preview.items.map((item) =>
                  item.artifactId === updatedArtifact.id
                    ? {
                        ...item,
                        metadata: updatedArtifact.metadata,
                        prompt: updatedArtifact.prompt || item.prompt,
                        provider: updatedArtifact.provider || item.provider,
                        model: updatedArtifact.model || item.model,
                      }
                    : item
                ),
              }
            : preview
        );
        setArtifactMessage(`已完成「${updatedArtifact.title}」视觉 QA`);
      } catch (error) {
        console.error("Failed to run artifact visual QA:", error);
        setArtifactMessage("视觉 QA 失败，请稍后重试");
        void refreshArtifacts();
      } finally {
        setVisualQaReviewingArtifactId((current) => (current === artifactId ? null : current));
      }
    },
    [artifacts, refreshArtifacts, setArtifacts]
  );

  useEffect(() => {
    const visibleIds = new Set(visibleArtifacts.map((artifact) => artifact.id));
    const previousActiveCount = previousActiveVisibleJobCountRef.current;

    if (activeVisibleJobCount > 0) {
      autoVisualQaPreJobArtifactIdsRef.current = visibleIds;
      if (visibleArtifacts.length > 0 && !autoVisualQaInitializedRef.current) {
        autoVisualQaSeenArtifactIdsRef.current = visibleIds;
        autoVisualQaInitializedRef.current = true;
      }
      previousActiveVisibleJobCountRef.current = activeVisibleJobCount;
      return;
    }

    let candidates: PersistedGeneratedArtifact[] = [];
    if (!autoVisualQaInitializedRef.current && previousActiveCount === 0 && visibleArtifacts.length > 0) {
      autoVisualQaSeenArtifactIdsRef.current = visibleIds;
      autoVisualQaPreJobArtifactIdsRef.current = visibleIds;
      autoVisualQaInitializedRef.current = true;
      previousActiveVisibleJobCountRef.current = activeVisibleJobCount;
      candidates = visibleArtifacts.filter(isFreshAutoVisualQaCandidate);
    } else {
      const justFinishedJobs = previousActiveCount > 0 && activeVisibleJobCount === 0;
      const baselineIds = justFinishedJobs
        ? autoVisualQaPreJobArtifactIdsRef.current
        : autoVisualQaSeenArtifactIdsRef.current;
      candidates = visibleArtifacts.filter((artifact) => !baselineIds.has(artifact.id));
    }

    candidates = candidates
      .filter(isAutoVisualQaCandidate)
      .filter((artifact) => !autoVisualQaSubmittedArtifactIdsRef.current.has(artifact.id))
      .slice(0, maxAutoVisualQaArtifactsPerBatch);

    for (const id of visibleIds) {
      autoVisualQaSeenArtifactIdsRef.current.add(id);
    }
    previousActiveVisibleJobCountRef.current = activeVisibleJobCount;

    if (candidates.length === 0) return;
    for (const artifact of candidates) {
      autoVisualQaSubmittedArtifactIdsRef.current.add(artifact.id);
    }

    let cancelled = false;
    void (async () => {
      setArtifactMessage(`Agent 正在自动审核 ${candidates.length} 张新结果`);
      for (const artifact of candidates) {
        if (cancelled) return;
        await handleRunArtifactVisualQa(artifact.id);
      }
      if (!cancelled) {
        setArtifactMessage(`Agent 已自动审核 ${candidates.length} 张新结果`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeVisibleJobCount, handleRunArtifactVisualQa, visibleArtifacts]);

  useEffect(() => {
    const readDetail = (event: Event): GenerationFrameOutputActionDetail | undefined => {
      return event instanceof CustomEvent && isPlainRecord(event.detail)
        ? event.detail as GenerationFrameOutputActionDetail
        : undefined;
    };

    const handleOpen = (event: Event) => {
      const detail = readDetail(event);
      if (!detail) return;
      handleOpenGenerationOutputPreview(detail);
    };

    const handleEdit = (event: Event) => {
      const detail = readDetail(event);
      const artifact =
        (detail?.artifactId ? artifacts.find((item) => item.id === detail.artifactId) : undefined) ??
        (detail?.jobId ? artifacts.find((item) => item.jobId === detail.jobId) : undefined);
      const job = artifact?.jobId
        ? jobs.find((item) => item.id === artifact.jobId)
        : detail?.jobId
          ? jobs.find((item) => item.id === detail.jobId)
          : undefined;
      const url = artifact?.url || detail?.url;
      if (!detail || !url) {
        setComposeMessage("这张图还没有可修改的大图");
        return;
      }
      const metadata = {
        ...getRecordValue(detail.metadata),
        ...mergeGenerationOutputPreviewMetadata({ artifact, job }),
      };
      const inferredGroup = artifact ? getAgentArtifactResultGroupLabel(artifact) : "";
      const detailGroup = getStringValue(detail.group) || (inferredGroup !== "成片" ? inferredGroup : "");
      if (detailGroup && !getStringValue(metadata.resultGroupTitle) && !getStringValue(metadata.rerunGroupTitle)) {
        metadata.resultGroupTitle = detailGroup;
      }
      const target: AgentImageEditTarget = {
        url,
        title: detail.title || artifact?.title || "生成图片",
        outputId: detail.outputId,
        artifactId: artifact?.id ?? detail.artifactId,
        jobId: artifact?.jobId ?? detail.jobId,
        nodeId: artifact?.nodeId ?? detail.nodeId,
        status: detail.status || artifact?.status,
        prompt: detail.prompt || getGenerationOutputPreviewPrompt({ artifact, job, metadata }),
        metadata,
      };
      setOutputPreview(null);
      setAgentImageEditTarget(target);
      setAgentPanelCollapsed(false);
      setComposeBrief("");
      if (target.nodeId) setSelectedNodeId(target.nodeId);
      setWorkflowPlanPreview(null);
      setPendingWorkflowDraft(null);
      const fallbackNote = typeof detail.note === "string" && detail.note.trim()
        ? detail.note.trim()
        : "";
      setComposeMessage(
        fallbackNote
          ? `${fallbackNote}；已选中「${target.title}」，直接说要怎么改。`
          : `已选中「${target.title}」，直接说要怎么改`
      );
    };

    const resolveRetryJob = async (jobId: string): Promise<PersistedGenerationJob | null> => {
      const existingJob = jobs.find((item) => item.id === jobId);
      if (existingJob) return existingJob;
      const fetchedJob = await fetchPersistedJobById(jobId);
      if (fetchedJob) {
        setJobs((items) =>
          items.some((item) => item.id === fetchedJob.id)
            ? items.map((item) => (item.id === fetchedJob.id ? fetchedJob : item))
            : [fetchedJob, ...items]
        );
      }
      return fetchedJob;
    };

    const fallbackRetryToImageEdit = (
      detail: GenerationFrameOutputActionDetail | undefined,
      message: string
    ): boolean => {
      if (!detail) return false;
      const artifact =
        (detail.artifactId ? artifacts.find((item) => item.id === detail.artifactId) : undefined) ??
        (detail.jobId ? artifacts.find((item) => item.jobId === detail.jobId) : undefined);
      const url = artifact?.url || detail.url;
      if (!url) return false;
      setJobMessage(message);
      window.dispatchEvent(
        new CustomEvent("image-master:generation-frame-output-edit", {
          detail: {
            ...detail,
            artifactId: artifact?.id ?? detail.artifactId,
            jobId: artifact?.jobId ?? detail.jobId,
            nodeId: artifact?.nodeId ?? detail.nodeId,
            title: detail.title || artifact?.title,
            status: detail.status || artifact?.status,
            note: message,
            url,
          },
        })
      );
      return true;
    };

    const handleRetry = (event: Event) => {
      const detail = readDetail(event);
      if (!detail?.jobId) {
        if (fallbackRetryToImageEdit(detail, "这张图没有可直接重跑的任务，已切到让 Agent 改这张")) return;
        setJobMessage("这张图还没有可重做的任务");
        return;
      }
      void (async () => {
        const job = await resolveRetryJob(detail.jobId as string);
        if (!job) {
          if (fallbackRetryToImageEdit(detail, "没有找到这张图的任务，已切到让 Agent 改这张")) return;
          setJobMessage("没有找到这张图的任务");
          return;
        }
        if (canRetryImageJob(job)) {
          void handleRetryImageJob(job, { groupTitle: getStringValue(detail.group) });
          return;
        }
        if (canRerunImageJob(job)) {
          void handleRerunImageJob(job, { groupTitle: getStringValue(detail.group) });
          return;
        }
        if (canRetryJob(job)) {
          void handleRetryJob(job);
          return;
        }
        if (fallbackRetryToImageEdit(detail, "这张图暂时不能直接重做，已切到让 Agent 改这张")) return;
        setJobMessage("这张图暂时不能重做");
      })();
    };

    const handleRetryAll = (event: Event) => {
      const detail = readDetail(event);
      const jobIds = detail?.jobIds?.filter((value): value is string => typeof value === "string" && !!value.trim()) ?? [];
      void (async () => {
        const retryJobs: PersistedGenerationJob[] = [];
        for (const jobId of jobIds) {
          const job = await resolveRetryJob(jobId);
          if (job && (canRetryImageJob(job) || canRerunImageJob(job) || canRetryJob(job))) {
            retryJobs.push(job);
          }
        }
        if (retryJobs.length === 0) {
          setJobMessage("当前任务没有可重做图片");
          return;
        }
        setJobMessage(`开始按顺序重做 ${retryJobs.length} 张图片`);
        for (const job of retryJobs) {
          if (canRetryImageJob(job)) {
            await handleRetryImageJob(job, { groupTitle: getStringValue(detail?.group) });
          } else if (canRerunImageJob(job)) {
            await handleRerunImageJob(job, { groupTitle: getStringValue(detail?.group) });
          } else {
            await handleRetryJob(job);
          }
        }
      })();
    };

    const handleReviewState = (event: Event) => {
      const detail = readDetail(event);
      const reviewStatus = normalizeArtifactReviewStatus(detail?.reviewStatus ?? detail?.status);
      if (!detail?.artifactId || !reviewStatus) {
        setArtifactMessage("这张图暂时不能标记挑图状态");
        return;
      }
      void handleSetArtifactReviewStatus(detail.artifactId, reviewStatus, detail.note);
    };

    const handleGroupReviewState = (event: Event) => {
      const detail = readDetail(event);
      const reviewStatus = normalizeArtifactReviewStatus(detail?.reviewStatus ?? detail?.status);
      const artifactIds = detail?.artifactIds?.filter((value): value is string => typeof value === "string" && !!value.trim()) ?? [];
      if (artifactIds.length === 0 || !reviewStatus) {
        setArtifactMessage("这组暂时不能标记挑图状态");
        return;
      }
      if (detail?.group) setHighlightedArtifactGroupTitle(String(detail.group));
      void handleSetArtifactGroupReviewStatus(artifactIds, reviewStatus, detail?.note);
    };

    const handleGroupRetry = (event: Event) => {
      const detail = readDetail(event);
      const artifactIds = detail?.artifactIds?.filter((value): value is string => typeof value === "string" && !!value.trim()) ?? [];
      const groupArtifacts = artifactIds
        .map((artifactId) => artifacts.find((artifact) => artifact.id === artifactId))
        .filter((artifact): artifact is PersistedGeneratedArtifact => Boolean(artifact));
      const retryableArtifacts = groupArtifacts.filter((artifact) => {
        const status = getArtifactReviewStatus(artifact);
        return status !== "approved" && status !== "rejected";
      });
      const protectedCount = groupArtifacts.length - retryableArtifacts.length;
      const jobIds = retryableArtifacts
        .map((artifact) => artifact.jobId)
        .filter((value): value is string => typeof value === "string" && !!value.trim());
      const groupTitle = typeof detail?.group === "string" && detail.group.trim()
        ? detail.group.trim()
        : "当前图组";
      if (jobIds.length === 0) {
        const protectedHint = protectedCount > 0 ? "；已保留/已淘汰的图片不会被重做" : "";
        if (detail?.group) setHighlightedArtifactGroupTitle(String(detail.group));
        setJobMessage(`这组没有可重跑的待处理图片${protectedHint}，已切到调整这组`);
        setComposeMessage(`「${groupTitle}」没有可直接重跑的待处理图片${protectedHint}；已切到调整这组，后续只会改这一组。`);
        window.dispatchEvent(
          new CustomEvent("image-master:artifact-group-edit", {
            detail: {
              ...(detail ?? {}),
              group: groupTitle,
              artifactIds,
            },
          })
        );
        return;
      }
      if (detail?.group) setHighlightedArtifactGroupTitle(String(detail.group));
      setComposeMessage(`按原上下文重做「${groupTitle}」${retryableArtifacts.length} 张待处理图片；已保留和已淘汰图片不受影响。`);
      handleRetryAll(new CustomEvent("image-master:generation-frame-output-retry-all", { detail: { jobIds, group: groupTitle } }));
    };

    const handleSave = (event: Event) => {
      const detail = readDetail(event);
      if (!detail) return;
      void handleSaveGenerationOutputAsAsset(detail);
    };

    const handleExport = (event: Event) => {
      const detail = readDetail(event);
      if (!detail?.batchId) {
        setExportPackMessage("当前图组还没有可导出的批次");
        return;
      }
      const suffix = detail.approvedOnly ? "?approvedOnly=1" : "";
      window.location.href = `/api/export-packs/${encodeURIComponent(detail.batchId)}/download${suffix}`;
    };

    const handleOpenFolder = (event: Event) => {
      const detail = readDetail(event);
      const urls = Array.isArray(detail?.urls)
        ? detail.urls.filter((value): value is string => typeof value === "string" && value.length > 0)
        : undefined;

      setExportPackMessage("正在打开本地图像文件夹...");
      void (async () => {
        try {
          const response = await apiFetch("/api/generated-images/open-folder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: detail?.url,
              urls,
            }),
          });
          if (!response.ok) throw new Error("open folder failed");
          const payload = await response.json() as { folderPath?: string; filePath?: string; opened?: boolean };
          setExportPackMessage(
            payload.opened
              ? "已打开本地图像文件夹"
              : `图片在本地文件夹：${payload.folderPath ?? ".data/generated"}`
          );
        } catch (error) {
          console.error("Failed to open generated image folder:", error);
          setExportPackMessage("打开文件夹失败，可以手动查看 .data/generated");
        }
      })();
    };

    window.addEventListener("image-master:generation-frame-output-open", handleOpen);
    window.addEventListener("image-master:generation-frame-output-edit", handleEdit);
    window.addEventListener("image-master:generation-frame-output-retry", handleRetry);
    window.addEventListener("image-master:generation-frame-output-retry-all", handleRetryAll);
    window.addEventListener("image-master:artifact-review-state", handleReviewState);
    window.addEventListener("image-master:artifact-group-review-state", handleGroupReviewState);
    window.addEventListener("image-master:artifact-group-retry", handleGroupRetry);
    window.addEventListener("image-master:generation-frame-output-save", handleSave);
    window.addEventListener("image-master:generation-frame-output-export", handleExport);
    window.addEventListener("image-master:generation-frame-output-open-folder", handleOpenFolder);
    return () => {
      window.removeEventListener("image-master:generation-frame-output-open", handleOpen);
      window.removeEventListener("image-master:generation-frame-output-edit", handleEdit);
      window.removeEventListener("image-master:generation-frame-output-retry", handleRetry);
      window.removeEventListener("image-master:generation-frame-output-retry-all", handleRetryAll);
      window.removeEventListener("image-master:artifact-review-state", handleReviewState);
      window.removeEventListener("image-master:artifact-group-review-state", handleGroupReviewState);
      window.removeEventListener("image-master:artifact-group-retry", handleGroupRetry);
      window.removeEventListener("image-master:generation-frame-output-save", handleSave);
      window.removeEventListener("image-master:generation-frame-output-export", handleExport);
      window.removeEventListener("image-master:generation-frame-output-open-folder", handleOpenFolder);
    };
  }, [
    artifacts,
    handleOpenGenerationOutputPreview,
    handleRerunImageJob,
    handleRetryImageJob,
    handleSaveGenerationOutputAsAsset,
    handleSetArtifactGroupReviewStatus,
    handleSetArtifactReviewStatus,
    jobs,
  ]);

  const handleApplyWorkflowTemplate = useCallback(
    (template: PersistedWorkflowTemplate) => {
      if (template.nodes.length === 0) {
        setTemplateMessage("模板没有可用节点");
        return;
      }

      setApplyingTemplateId(template.id);
      pushHistorySnapshot();

      const applied = instantiateWorkflowTemplate(template, canvasNodes);
      setCanvasNodes((nodes) => [...nodes, ...applied.nodes]);
      setCanvasEdges((edges) => [...edges, ...applied.edges]);
      setSelectedNodeId(applied.nodes[0]?.id ?? selectedNodeId);
      requestCanvasFocus(applied.nodes.map((node) => node.id));
      setTemplateMessage(`已应用模板：${template.title}`);
      setWorkflowMessage("模板已铺到画布");

      window.setTimeout(() => {
        setApplyingTemplateId((id) => (id === template.id ? null : id));
      }, 350);
    },
    [canvasNodes, pushHistorySnapshot, requestCanvasFocus, selectedNodeId]
  );

  const handleCreateExportPack = useCallback(
    (rule: ExportPackRule) => {
      const node = createExportPackNode(rule, selectedNode, canvasNodes);
      const sourceNode = findExportPackSourceNode(node, selectedNode, canvasNodes);

      pushHistorySnapshot();
      setCanvasNodes((nodes) => [...nodes, node]);
      setCanvasEdges((edges) =>
        sourceNode
          ? [
              ...edges,
              {
                id: `${sourceNode.id}-${node.id}`,
                source: sourceNode.id,
                target: node.id,
                label: getConnectionLabel(sourceNode, node),
                animated: true,
              },
            ]
          : edges
      );
      setSelectedNodeId(node.id);
      requestCanvasFocus([node.id]);
      setExportPackMessage(
        sourceNode
          ? `已创建导出包：${rule.title}`
          : `已创建导出包：${rule.title}，请选择商品或输出节点后再连接`
      );
      setWorkflowMessage(sourceNode ? "导出包节点已连接到画布" : "导出包节点已加入画布");
    },
    [canvasNodes, pushHistorySnapshot, requestCanvasFocus, selectedNode]
  );

  const handleUndo = useCallback(() => {
    setUndoStack((items) => {
      const snapshot = items[items.length - 1];
      if (!snapshot) return items;

      const current = captureSnapshot();
      setRedoStack((redoItems) => limitSnapshots([...redoItems, current]));
      setCanvasNodes(snapshot.nodes);
      setCanvasEdges(snapshot.edges);
      setHiddenArtifactNodeIds(snapshot.hiddenArtifactNodeIds);
      setSelectedNodeId(snapshot.selectedNodeId || snapshot.nodes[0]?.id || "");
      setWorkflowMessage("已撤销上一步");
      return items.slice(0, -1);
    });
  }, [captureSnapshot]);

  const handleRedo = useCallback(() => {
    setRedoStack((items) => {
      const snapshot = items[items.length - 1];
      if (!snapshot) return items;

      const current = captureSnapshot();
      setUndoStack((undoItems) => limitSnapshots([...undoItems, current]));
      setCanvasNodes(snapshot.nodes);
      setCanvasEdges(snapshot.edges);
      setHiddenArtifactNodeIds(snapshot.hiddenArtifactNodeIds);
      setSelectedNodeId(snapshot.selectedNodeId || snapshot.nodes[0]?.id || "");
      setWorkflowMessage("已重做上一步");
      return items.slice(0, -1);
    });
  }, [captureSnapshot]);

  const handleDeleteSelectedNode = useCallback(() => {
    if (!selectedNode) return;

    pushHistorySnapshot();
    const hiddenArtifactId = getArtifactResultNodeArtifactId(selectedNode);
    if (hiddenArtifactId) {
      setHiddenArtifactNodeIds((ids) => addUniqueString(ids, hiddenArtifactId));
    }
    setCanvasNodes((nodes) => {
      const nextNodes = nodes.filter((node) => node.id !== selectedNode.id);
      setSelectedNodeId(nextNodes[0]?.id || "");
      return nextNodes;
    });
    setCanvasEdges((edges) =>
      edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id)
    );
    setWorkflowMessage(`已删除节点：${selectedNode.data.label}`);
  }, [pushHistorySnapshot, selectedNode]);

  const handleDuplicateSelectedNode = useCallback(() => {
    if (!selectedNode) return;

    pushHistorySnapshot();
    const duplicatedNode = duplicateCanvasNode(selectedNode, canvasNodes.length);
    setCanvasNodes((nodes) => [...nodes, duplicatedNode]);
    setSelectedNodeId(duplicatedNode.id);
    setWorkflowMessage(`已复制节点：${selectedNode.data.label}`);
  }, [canvasNodes.length, pushHistorySnapshot, selectedNode]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasFlowNode>[]) => {
      const structuralChanges = changes.filter((change) => change.type !== "position");
      if (structuralChanges.length === 0) return;

      const removedIds = new Set(
        structuralChanges
          .filter((change) => change.type === "remove")
          .map((change) => change.id)
      );
      const removedArtifactIds = canvasNodes
        .filter((node) => removedIds.has(node.id))
        .map(getArtifactResultNodeArtifactId)
        .filter(Boolean) as string[];

      if (removedArtifactIds.length > 0) {
        setHiddenArtifactNodeIds((ids) =>
          removedArtifactIds.reduce(addUniqueString, ids)
        );
      }

      setCanvasNodes((nodes) => applyWorkbenchNodeChanges(nodes, structuralChanges));
    },
    [canvasNodes]
  );

  const handleNodePositionCommit = useCallback((nodeId: string, position: XYPosition) => {
    setCanvasNodes((nodes) => {
      let found = false;
      const next = nodes.map((node) => {
        if (node.id !== nodeId) return node;
        found = true;
        if (areCanvasPositionsEqual(node.position, position)) return node;
        return {
          ...node,
          position,
        };
      });

      if (found) {
        return next.some((node, index) => node !== nodes[index]) ? next : nodes;
      }

      if (nodeId === defaultGenerationFrameNode.id) {
        if (areCanvasPositionsEqual(defaultGenerationFrameNode.position, position)) return nodes;
        return [
          {
            ...defaultGenerationFrameNode,
            position,
          },
        ];
      }

      return next;
    });
  }, [defaultGenerationFrameNode]);

  const handleEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    setCanvasEdges((edges) => applyWorkbenchEdgeChanges(edges, changes));
  }, []);

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const sourceNode = canvasNodes.find((node) => node.id === connection.source);
    const targetNode = canvasNodes.find((node) => node.id === connection.target);
    if (!sourceNode || !targetNode) return;

    const validationMessage = getConnectionValidationMessage(sourceNode, targetNode);
    if (validationMessage || !canConnectCanvasNodes(sourceNode, targetNode)) {
      setWorkflowMessage(validationMessage ?? "这两个节点暂时不能连接");
      return;
    }

    pushHistorySnapshot();
    setCanvasEdges((edges) => [
      ...edges,
      {
        id: `${connection.source}-${connection.target}-${Date.now()}`,
        source: connection.source,
        target: connection.target,
        label: getConnectionLabel(sourceNode, targetNode),
        animated: true,
      },
    ]);
    setWorkflowMessage("节点已连接");
  }, [canvasNodes, pushHistorySnapshot]);

  const handlePrepareAgentFromLineAction = useCallback(
    ({
      sourceNodeId,
      actionId,
    }: {
      sourceNodeId: string;
      actionId: LineGenerationActionId;
    }) => {
      const sourceNode = canvasNodes.find((node) => node.id === sourceNodeId);
      const action = getLineGenerationAction(actionId);
      if (!sourceNode || !action) return;

      const sourceLabel = sourceNode.data.label || "当前素材";
      setComposeBrief(buildLineActionAgentBrief(action, sourceLabel));
      setWorkflowPlanPreview(null);
      setAgentImageEditTarget(null);
      setAgentPanelCollapsed(false);
      setSelectedNodeId(sourceNode.id);
      requestCanvasFocus([sourceNode.id]);
      setWorkflowMessage(`已准备「${action.title}」方向，继续在右上角让 Agent 规划`);
      setComposeMessage(`已把「${sourceLabel}」作为参考；你可以直接规划，或补充更多要求。`);
    },
    [canvasNodes, requestCanvasFocus]
  );

  const handleCreateCopyNode = useCallback((text: string, position: XYPosition) => {
    const cleanText = text.trim();
    if (!cleanText) {
      setWorkflowMessage("剪贴板里没有可用文案");
      return;
    }

    const node = createCopyNodeFromText(cleanText, position, canvasNodes.length);
    pushHistorySnapshot();
    setCanvasNodes((nodes) => [...nodes, node]);
    setSelectedNodeId(node.id);
    requestCanvasFocus([node.id]);
    setWorkflowMessage("文案已放到画布，可作为 Agent 参考");
  }, [canvasNodes.length, pushHistorySnapshot, requestCanvasFocus]);

  const handleSetCanvasNodeRole = useCallback((nodeId: string, role: GenerationFrameRole) => {
    pushHistorySnapshot();
    setCanvasNodes((nodes) =>
      nodes.map((node) => {
        if (node.id !== nodeId || isGenerationFrameNode(node)) return node;
        const category = mapGenerationRoleToCanvasCategory(role);
        const componentType = mapGenerationRoleToComponentType(role);
        const copyBrief = role === "copy"
          ? buildStructuredCopyBrief(
              getFirstString([
                node.data.copyText,
                getRecordValue(node.data.parameters).copyText,
                getRecordValue(node.data.parameters).text,
                node.data.caption,
                node.data.label,
              ]) ?? node.data.label
            )
          : undefined;

        return {
          ...node,
          data: {
            ...node.data,
            kind: "asset",
            iconName: mapGenerationRoleToIconName(role),
            category,
            componentType,
            type: componentType,
            metrics: [
              category,
              "手动设定",
              ...(role === "copy" && copyBrief ? [`文案 ${copyBrief.inImageText.length + copyBrief.sellingPoints.length + copyBrief.exportCopy.length + copyBrief.forbiddenClaims.length} 条`] : []),
            ].slice(0, 4),
            parameters: copyBrief
              ? {
                  ...getRecordValue(node.data.parameters),
                  text: copyBrief.sourceText,
                  copyText: copyBrief.sourceText,
                  copyBrief,
                }
              : node.data.parameters,
            promptFragments: copyBrief?.promptFragments ?? getStringArray(node.data.promptFragments),
            constraints: copyBrief?.constraints ?? getStringArray(node.data.constraints),
            negativeRules: copyBrief?.negativeRules ?? getStringArray(node.data.negativeRules),
            qualityRules: copyBrief?.qualityRules ?? getStringArray(node.data.qualityRules),
          },
        };
      })
    );
    setSelectedNodeId(nodeId);
    setWorkflowMessage(`已设为${getGenerationReferenceRoleLabel(role)}`);
  }, [pushHistorySnapshot]);

  const handleOpenCanvasNodePreview = useCallback((nodeId: string) => {
    const node = stageNodes.find((item) => item.id === nodeId);
    const url = getStringValue(node?.data.referenceUrl) || getStringValue(node?.data.previewUrl);
    if (!node || !url) {
      setArtifactMessage("这个节点没有可查看的大图");
      return;
    }
    const artifactId = getStringValue(node.data.artifactId);
    const jobId = getStringValue(node.data.jobId);
    if (artifactId || jobId) {
      handleOpenGenerationOutputPreview({
        nodeId: getStringValue(node.data.linkedNodeId) || nodeId,
        artifactId,
        jobId,
        url,
        title: node.data.label || "生成图片",
        status: getStringValue(node.data.artifactStatus) || node.data.status,
      });
      return;
    }
    setOutputPreview({
      items: [{
        url,
        title: node.data.label || "画布图片",
        nodeId,
      }],
      index: 0,
    });
  }, [handleOpenGenerationOutputPreview, stageNodes]);

  const handleSaveCanvasNodeAsAsset = useCallback(async (nodeId: string) => {
    const node = stageNodes.find((item) => item.id === nodeId);
    const url = getStringValue(node?.data.referenceUrl) || getStringValue(node?.data.previewUrl);
    if (!node || !url) {
      setAssetMessage("这个节点没有可保存的图片");
      return;
    }

    const categoryValue = getStringValue(node.data.category);
    const category = isCanvasLibraryCategoryValue(categoryValue) ? categoryValue : "商品";
    const title = node.data.label || `${category}素材`;

    setAssetMessage("正在保存到全局资产库...");
    try {
      const response = await apiFetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: mapAssetCategoryToComponentType(category),
          title,
          description: node.data.caption || `从画布保存的${category}素材`,
          status: "ready",
          url,
          metadata: {
            source: "canvas-manual-save",
            libraryScope: "global",
            savedByUser: true,
            canvasCategory: category,
            componentType: getStringValue(node.data.componentType) || mapAssetCategoryToComponentType(category),
            previewUrl: getStringValue(node.data.previewUrl),
            referenceUrl: url,
            parameters: getRecordValue(node.data.parameters),
            promptFragments: getStringArray(node.data.promptFragments),
            constraints: getStringArray(node.data.constraints),
            negativeRules: getStringArray(node.data.negativeRules),
            qualityRules: getStringArray(node.data.qualityRules),
          },
        }),
      });
      if (!response.ok) throw new Error("asset api failed");

      const payload = await response.json();
      const asset = mapPersistedAssetToCanvas(payload.asset ?? payload);
      if (!asset) throw new Error("asset payload invalid");

      setPersistedAssets((items) => [asset, ...items.filter((item) => item.id !== asset.id)]);
      setActiveCategory(asset.category);
      pushHistorySnapshot();
      setCanvasNodes((nodes) =>
        nodes.map((item) =>
          item.id === nodeId
            ? {
                ...item,
                data: {
                  ...item.data,
                  caption: "已保存到全局资产库",
                  metrics: [asset.category, "已保存", "全局资产"],
                  assetId: asset.id,
                  source: "asset-library",
                  previewUrl: asset.previewUrl || getStringValue(item.data.previewUrl),
                  referenceUrl: asset.referenceUrl || getStringValue(item.data.referenceUrl),
                },
              }
            : item
        )
      );
      setAssetMessage("已保存到全局资产库");
      setWorkflowMessage(`${title} 已保存到全局资产库`);
    } catch (error) {
      console.error("Failed to save canvas node as asset:", error);
      setAssetMessage(error instanceof Error ? error.message : "保存失败，请稍后重试");
    }
  }, [pushHistorySnapshot, stageNodes]);

  const patchLibraryAsset = useCallback(
    async (asset: CanvasAsset, updates: { title?: string; favorite?: boolean; category?: CanvasLibraryCategory }) => {
      if (asset.source === "model-library") {
        const modelId = getStringValue(asset.parameters?.modelId) || asset.id.replace(/^model-asset-/, "");
        const response = await apiFetch(`/api/models/${encodeURIComponent(modelId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(typeof payload.error === "string" ? payload.error : "模特资产更新失败");
        }
        const updated = mapModelToCanvasAsset(payload.model ?? payload);
        setModelAssets((items) => items.map((item) => (item.id === asset.id ? updated : item)));
        return updated;
      }

      const response = await apiFetch(`/api/assets/${encodeURIComponent(asset.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(updates.title ? { title: updates.title } : {}),
          ...(updates.category
            ? {
                type: mapCanvasLibraryCategoryToAssetType(updates.category),
                metadata: {
                  ...(asset.rawMetadata ?? {}),
                  canvasCategory: updates.category,
                  libraryScope: "global",
                  savedByUser: true,
                },
              }
            : {}),
          ...(updates.favorite !== undefined
            ? {
                metadata: {
                  ...(asset.rawMetadata ?? {}),
                  favorite: updates.favorite,
                  libraryScope: "global",
                  savedByUser: true,
                },
              }
            : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "资产更新失败");
      }
      const updated = mapPersistedAssetToCanvas(payload.asset ?? payload);
      if (!updated) throw new Error("资产返回无效");
      setPersistedAssets((items) => items.map((item) => (item.id === asset.id ? updated : item)));
      return updated;
    },
    []
  );

  const handleRenameLibraryAsset = useCallback(
    async (item: AssetTrayItem) => {
      const assetId = item.id.replace(/^asset:/, "");
      const asset = [...persistedAssets, ...modelAssets].find((candidate) => candidate.id === assetId);
      if (!asset) return;
      const nextTitle = window.prompt("重命名资产", asset.title)?.trim();
      if (!nextTitle || nextTitle === asset.title) return;

      try {
        const updated = await patchLibraryAsset(asset, { title: nextTitle });
        setAssetMessage(`已重命名：${updated.title}`);
      } catch (error) {
        console.error("Failed to rename library asset:", error);
        setAssetMessage(error instanceof Error ? error.message : "重命名失败");
      }
    },
    [modelAssets, patchLibraryAsset, persistedAssets]
  );

  const handleToggleFavoriteLibraryAsset = useCallback(
    async (item: AssetTrayItem) => {
      const assetId = item.id.replace(/^asset:/, "");
      const asset = [...persistedAssets, ...modelAssets].find((candidate) => candidate.id === assetId);
      if (!asset) return;

      try {
        const updated = await patchLibraryAsset(asset, { favorite: !asset.favorite });
        setAssetMessage(updated.favorite ? "已加入收藏" : "已取消收藏");
      } catch (error) {
        console.error("Failed to update favorite asset:", error);
        setAssetMessage(error instanceof Error ? error.message : "收藏状态更新失败");
      }
    },
    [modelAssets, patchLibraryAsset, persistedAssets]
  );

  const handleDeleteLibraryItem = useCallback(
    async (item: AssetTrayItem) => {
      if (item.id.startsWith("component:")) {
        const componentId = item.id.replace(/^component:/, "");
        const component = components.find((candidate) => candidate.id === componentId);
        if (!component) return;
        if (!window.confirm(`删除组件「${component.title}」？`)) return;

        try {
          const response = await apiFetch(`/api/components/${encodeURIComponent(component.id)}`, {
            method: "DELETE",
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(typeof payload.error === "string" ? payload.error : "组件删除失败");
          }
          setComponents((items) => items.filter((candidate) => candidate.id !== component.id));
          setAssetMessage(`已删除组件：${component.title}`);
        } catch (error) {
          console.error("Failed to delete library component:", error);
          setAssetMessage(error instanceof Error ? error.message : "组件删除失败");
        }
        return;
      }

      if (!item.id.startsWith("asset:")) return;
      const assetId = item.id.replace(/^asset:/, "");
      const asset = [...persistedAssets, ...modelAssets].find((candidate) => candidate.id === assetId);
      if (!asset) return;
      if (!window.confirm(`删除资产「${asset.title}」？画布上已放置的节点不会被删除。`)) return;

      try {
        if (asset.source === "model-library") {
          const modelId = getStringValue(asset.parameters?.modelId) || asset.id.replace(/^model-asset-/, "");
          const response = await apiFetch(`/api/models/${encodeURIComponent(modelId)}`, {
            method: "DELETE",
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(typeof payload.error === "string" ? payload.error : "模特资产删除失败");
          }
          setModelAssets((items) => items.filter((candidate) => candidate.id !== asset.id));
          setAssetMessage(`已删除资产：${asset.title}`);
          return;
        }

        const response = await apiFetch(`/api/assets/${encodeURIComponent(asset.id)}`, {
          method: "DELETE",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload.error === "string" ? payload.error : "资产删除失败");
        }

        const linkedComponentIds = components
          .filter((component) => component.assetId === asset.id)
          .map((component) => component.id);
        if (linkedComponentIds.length > 0) {
          await Promise.allSettled(
            linkedComponentIds.map((componentId) =>
              apiFetch(`/api/components/${encodeURIComponent(componentId)}`, { method: "DELETE" })
            )
          );
          setComponents((items) => items.filter((component) => component.assetId !== asset.id));
        }
        setPersistedAssets((items) => items.filter((candidate) => candidate.id !== asset.id));
        setAssetMessage(`已删除资产：${asset.title}`);
      } catch (error) {
        console.error("Failed to delete library asset:", error);
        setAssetMessage(error instanceof Error ? error.message : "资产删除失败");
      }
    },
    [components, modelAssets, persistedAssets]
  );

  const handleDeleteCanvasNodeById = useCallback((nodeId: string) => {
    pushHistorySnapshot();
    setCanvasNodes((nodes) => nodes.filter((node) => node.id !== nodeId));
    setCanvasEdges((edges) => edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId("");
    setWorkflowMessage("节点已删除");
  }, [pushHistorySnapshot, selectedNodeId]);

  const handleUpdateGenerationFramePrompt = useCallback((nodeId: string, prompt: string) => {
    setCanvasNodes((nodes) =>
      nodes.map((node) =>
        node.id === nodeId
          ? applyPromptToGenerationFrameNode(node, prompt)
          : node
      )
    );
  }, []);

  useEffect(() => {
    const handlePromptChange = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string; prompt?: string }>).detail;
      if (!detail?.nodeId || typeof detail.prompt !== "string") return;
      handleUpdateGenerationFramePrompt(detail.nodeId, detail.prompt);
    };

    window.addEventListener("image-master:generation-frame-prompt-change", handlePromptChange);
    return () => {
      window.removeEventListener("image-master:generation-frame-prompt-change", handlePromptChange);
    };
  }, [handleUpdateGenerationFramePrompt]);

  const handleBindAssetToGenerationFrame = useCallback(
    (asset: CanvasAsset, targetFrameId?: string) => {
      const frameNode =
        (targetFrameId ? stageNodes.find((node) => node.id === targetFrameId && isGenerationFrameNode(node)) : undefined) ??
        (stageNodes.find((node) => node.id === selectedNodeId && isGenerationFrameNode(node))) ??
        stageNodes.find(isGenerationFrameNode) ??
        defaultGenerationFrameNode;
      const updatedAt = new Date().toISOString();
      const generationFrame = bindAssetToGenerationFrameSlot(
        migrateLegacyGenerationFrameData(frameNode.data, frameNode.id),
        asset,
        { updatedAt }
      );
      const nextFrameNode: CanvasWorkbenchNode = {
        ...frameNode,
        data: {
          ...frameNode.data,
          status: generationFrame.status === "empty" ? frameNode.data.status : "ready",
          generationFrame,
          metrics: updateGenerationFrameSlotMetrics(frameNode.data.metrics, generationFrame),
        },
      };

      pushHistorySnapshot();
      setCanvasNodes((nodes) =>
        nodes.some((node) => node.id === nextFrameNode.id)
          ? nodes.map((node) => (node.id === nextFrameNode.id ? nextFrameNode : node))
          : [...nodes, nextFrameNode]
      );
      setWorkflowMessage(`${asset.title} 已作为 Agent 参考`);
      setActiveBottomPanel(null);
    },
    [defaultGenerationFrameNode, pushHistorySnapshot, requestCanvasFocus, selectedNodeId, stageNodes]
  );

  useEffect(() => {
    const handleGenerationFrameFileUpload = (event: Event) => {
      const detail = (event as CustomEvent<{
        nodeId?: string;
        file?: File;
        role?: GenerationFrameRole;
        category?: CanvasLibraryCategory;
      }>).detail;
      if (!detail?.file || !detail.file.type.startsWith("image/")) return;
      const category = isCanvasLibraryCategoryValue(detail.category)
        ? detail.category
        : detail.role
          ? mapGenerationRoleToCanvasCategory(detail.role)
          : "商品";
      void handleUploadProduct(detail.file, detail.nodeId, undefined, category);
    };

    window.addEventListener("image-master:generation-frame-file-upload", handleGenerationFrameFileUpload);
    return () => {
      window.removeEventListener("image-master:generation-frame-file-upload", handleGenerationFrameFileUpload);
    };
  }, [handleUploadProduct]);

  const updateGenerationFrameNodeState = useCallback(
    (
      nodeId: string,
      updateFrame: (frame: GenerationFrameState) => GenerationFrameState,
      message: string
    ) => {
      pushHistorySnapshot();
      setCanvasNodes((nodes) =>
        nodes.map((node) => {
          if (node.id !== nodeId || !isGenerationFrameNode(node)) return node;
          const generationFrame = updateFrame(migrateLegacyGenerationFrameData(node.data, node.id));
          return {
            ...node,
            data: {
              ...node.data,
              status: generationFrame.status === "empty" ? "queued" : "ready",
              generationFrame,
              metrics: updateGenerationFrameSlotMetrics(node.data.metrics, generationFrame),
            },
          };
        })
      );
      setSelectedNodeId(nodeId);
      setWorkflowMessage(message);
    },
    [pushHistorySnapshot]
  );

  useEffect(() => {
    const readDetail = (event: Event): {
      nodeId: string;
      bindingKey: string;
      role?: string;
      direction?: string;
    } | null => {
      const detail = (event as CustomEvent<{
        nodeId?: string;
        bindingKey?: string;
        role?: string;
        direction?: string;
      }>).detail;
      return detail?.nodeId && detail.bindingKey
        ? {
            nodeId: detail.nodeId,
            bindingKey: detail.bindingKey,
            role: detail.role,
            direction: detail.direction,
          }
        : null;
    };

    const handleRemove = (event: Event) => {
      const detail = readDetail(event);
      if (!detail) return;
      updateGenerationFrameNodeState(
        detail.nodeId,
        (frame) => removeGenerationFrameAsset(frame, detail.bindingKey),
        "资产已从后台任务移出"
      );
    };

    const handlePrimary = (event: Event) => {
      const detail = readDetail(event);
      if (!detail) return;
      updateGenerationFrameNodeState(
        detail.nodeId,
        (frame) => markGenerationFramePrimaryAsset(frame, detail.bindingKey),
        "已设为主参考"
      );
    };

    const handleRoleChange = (event: Event) => {
      const detail = readDetail(event);
      const role = detail?.role;
      if (!detail || !isGenerationFrameRoleValue(role)) return;
      updateGenerationFrameNodeState(
        detail.nodeId,
        (frame) => updateGenerationFrameAssetRole(frame, detail.bindingKey, role),
        "资产角色已更新"
      );
    };

    const handleMove = (event: Event) => {
      const detail = readDetail(event);
      const direction = detail?.direction;
      if (!detail || (direction !== "previous" && direction !== "next")) return;
      updateGenerationFrameNodeState(
        detail.nodeId,
        (frame) => moveGenerationFrameAsset(frame, detail.bindingKey, direction),
        direction === "previous" ? "资产已前移" : "资产已后移"
      );
    };

    window.addEventListener("image-master:generation-frame-asset-remove", handleRemove);
    window.addEventListener("image-master:generation-frame-asset-primary", handlePrimary);
    window.addEventListener("image-master:generation-frame-asset-role-change", handleRoleChange);
    window.addEventListener("image-master:generation-frame-asset-move", handleMove);
    return () => {
      window.removeEventListener("image-master:generation-frame-asset-remove", handleRemove);
      window.removeEventListener("image-master:generation-frame-asset-primary", handlePrimary);
      window.removeEventListener("image-master:generation-frame-asset-role-change", handleRoleChange);
      window.removeEventListener("image-master:generation-frame-asset-move", handleMove);
    };
  }, [updateGenerationFrameNodeState]);

  const handleSelectAssetFromLibrary = useCallback(
    (assetId: string) => {
      const asset = allAssets.find((item) => item.id === assetId);
      if (!asset) return;
      const position = getNextLibraryInsertPosition(canvasNodes, selectedNode, asset.category);
      const node = createNodeFromAsset(asset, position, canvasNodes.length);
      pushHistorySnapshot();
      setCanvasNodes((nodes) => [...nodes, node]);
      setSelectedNodeId(node.id);
      requestCanvasFocus([node.id]);
      setActiveBottomPanel(null);
      setAgentPanelCollapsed(false);
      setWorkflowMessage("素材已放到画布，可作为 Agent 参考");
    },
    [allAssets, canvasNodes, pushHistorySnapshot, requestCanvasFocus, selectedNode]
  );

  const handleSelectComponentFromLibrary = useCallback(
    (componentId: string) => {
      const component = components.find((item) => item.id === componentId);
      if (!component) return;

      const position = getNextLibraryInsertPosition(canvasNodes, selectedNode, getComponentCategory(component.type));
      const node = createNodeFromComponent(component, position, canvasNodes.length);
      pushHistorySnapshot();
      setCanvasNodes((nodes) => [...nodes, node]);
      setSelectedNodeId(node.id);
      if (getComponentCategory(component.type) === "商品") {
        setActiveProductComponentId(component.id);
      }
      requestCanvasFocus([node.id]);
      setActiveBottomPanel(null);
      setAgentPanelCollapsed(false);
      setWorkflowMessage("组件已放到画布，可作为 Agent 参考");
    },
    [
      canvasNodes,
      components,
      pushHistorySnapshot,
      requestCanvasFocus,
      selectedNode,
    ]
  );

  const handleDropAssetOnCanvas = useCallback(
    async (assetId: string, position: XYPosition, targetFrameId?: string) => {
      const asset = allAssets.find((item) => item.id === assetId);
      if (!asset) return;

      if (targetFrameId) {
        handleBindAssetToGenerationFrame(asset, targetFrameId);
        return;
      }

      const node = createNodeFromAsset(asset, position, canvasNodes.length);
      pushHistorySnapshot();
      setCanvasNodes((nodes) => [...nodes, node]);
      setSelectedNodeId(node.id);
      requestCanvasFocus([node.id]);
      setWorkflowMessage("资产已放入画布");

      try {
        const existingComponent = components.find(
          (component) => component.assetId === asset.id && component.metadata?.source === "asset-library"
        );
        if (existingComponent) {
          setCanvasNodes((nodes) =>
            nodes.map((item) =>
              item.id === node.id
                ? withNodeComponentId(item, existingComponent.id)
                : item
            )
          );
          return;
        }

        const response = await apiFetch("/api/components", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: mapAssetCategoryToComponentType(asset.category),
            title: asset.title,
            description: asset.description,
            status: "ready",
            assetId: asset.id,
            rules: {
              category: asset.category,
              status: asset.status,
            },
            metadata: {
              source: "asset-library",
              previewUrl: asset.previewUrl,
              previewAlt: asset.previewAlt,
            },
          }),
        });

        if (!response.ok) throw new Error("component api failed");
        const component = mapPersistedComponent(await response.json());
        if (component) {
          setComponents((items) => [
            component,
            ...items.filter((item) => item.id !== component.id),
          ]);
          setCanvasNodes((nodes) =>
            nodes.map((item) =>
              item.id === node.id
                ? withNodeComponentId(item, component.id)
                : item
            )
          );
          setWorkflowMessage("资产已生成组件并放入画布");
        }
      } catch (error) {
        console.error("Failed to persist canvas component:", error);
        setWorkflowMessage("资产已放入画布，组件保存稍后重试");
      }
    },
    [
      allAssets,
      canvasNodes.length,
      components,
      handleBindAssetToGenerationFrame,
      pushHistorySnapshot,
      requestCanvasFocus,
    ]
  );

  const handleDropComponentOnCanvas = useCallback(
    (componentId: string, position: XYPosition, targetFrameId?: string) => {
      const component = components.find((item) => item.id === componentId);
      if (!component) return;

      if (targetFrameId) {
        const matchedAsset = component.assetId
          ? allAssets.find((asset) => asset.id === component.assetId)
          : undefined;
        if (matchedAsset) {
          handleBindAssetToGenerationFrame(matchedAsset, targetFrameId);
          return;
        }

        const role = getGenerationFrameRoleFromComponent(component);
        if (role) {
          updateGenerationFrameNodeState(
            targetFrameId,
            (frame) =>
              bindGenerationFrameSlot(frame, {
                role,
                source: "canvas-node",
                title: component.title,
                sourceComponentId: component.id,
                sourceAssetId: component.assetId,
                referenceUrl: getOptionalRecordString(component.metadata, "previewUrl"),
                parameters: getComponentParameters(component),
                promptFragments: getStringArray(component.metadata?.promptFragments),
                constraints: getStringArray(component.metadata?.constraints),
                negativeRules: getStringArray(component.metadata?.negativeRules),
                qualityRules: getStringArray(component.metadata?.qualityRules),
                updatedAt: new Date().toISOString(),
              }),
            "组件已作为 Agent 参考"
          );
          return;
        }

        setWorkflowMessage("这个组件暂时不能作为生成参考");
        return;
      }

      const node = createNodeFromComponent(component, position, canvasNodes.length);
      pushHistorySnapshot();
      setCanvasNodes((nodes) => [...nodes, node]);
      setSelectedNodeId(node.id);
      if (getComponentCategory(component.type) === "商品") {
        setActiveProductComponentId(component.id);
      }
      requestCanvasFocus([node.id]);
      setWorkflowMessage("组件已放入画布");
    },
    [
      allAssets,
      canvasNodes.length,
      components,
      handleBindAssetToGenerationFrame,
      pushHistorySnapshot,
      requestCanvasFocus,
      updateGenerationFrameNodeState,
    ]
  );

  useEffect(() => {
    const handleFrameAssetDrop = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string; assetId?: string }>).detail;
      if (!detail?.nodeId || !detail.assetId) return;
      const asset = allAssets.find((item) => item.id === detail.assetId);
      if (!asset) {
        setWorkflowMessage("没有找到这个资产");
        return;
      }
      handleBindAssetToGenerationFrame(asset, detail.nodeId);
    };

    const handleFrameComponentDrop = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string; componentId?: string }>).detail;
      if (!detail?.nodeId || !detail.componentId) return;
      const frameNode = stageNodes.find((node) => node.id === detail.nodeId && isGenerationFrameNode(node));
      handleDropComponentOnCanvas(
        detail.componentId,
        frameNode?.position ?? { x: 0, y: 0 },
        detail.nodeId
      );
    };

    window.addEventListener("image-master:generation-frame-asset-drop", handleFrameAssetDrop);
    window.addEventListener("image-master:generation-frame-component-drop", handleFrameComponentDrop);
    return () => {
      window.removeEventListener("image-master:generation-frame-asset-drop", handleFrameAssetDrop);
      window.removeEventListener("image-master:generation-frame-component-drop", handleFrameComponentDrop);
    };
  }, [allAssets, handleBindAssetToGenerationFrame, handleDropComponentOnCanvas, stageNodes]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEditingTarget(event.target)) return;

      const isMod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (isMod && key === "z" && event.shiftKey) {
        event.preventDefault();
        handleRedo();
        return;
      }

      if (isMod && key === "z") {
        event.preventDefault();
        handleUndo();
        return;
      }

      if (isMod && key === "y") {
        event.preventDefault();
        handleRedo();
        return;
      }

      if (isMod && key === "d") {
        event.preventDefault();
        handleDuplicateSelectedNode();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        handleDeleteSelectedNode();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDeleteSelectedNode, handleDuplicateSelectedNode, handleRedo, handleUndo]);

  const handleCreateKnowledgeNode = useCallback((position?: XYPosition) => {
    const node = createKnowledgeNode(position ?? findAvailableGenerationFramePosition(canvasNodes), canvasNodes.length);
    pushHistorySnapshot();
    setCanvasNodes((nodes) => [...nodes, node]);
    setSelectedNodeId(node.id);
    requestCanvasFocus([node.id]);
    setWorkflowMessage("知识卡已放到画布，可作为 Agent 参考");
  }, [canvasNodes, pushHistorySnapshot, requestCanvasFocus]);

  const activeOutputPreview = outputPreview?.items[outputPreview.index];
  const previewCount = outputPreview?.items.length ?? 0;
  const canPreviewPrevious = Boolean(outputPreview && outputPreview.index > 0);
  const canPreviewNext = Boolean(outputPreview && outputPreview.index < previewCount - 1);
  const activeOutputPreviewMetadata = activeOutputPreview?.metadata ?? {};
  const activeProviderReferenceImages = getOutputPreviewProviderReferenceImages(activeOutputPreviewMetadata);
  const activePromptOnlyReferenceImages = getOutputPreviewPromptOnlyReferenceImages(activeOutputPreviewMetadata);
  const activeReferenceRoleLabels = getOutputPreviewReferenceRoleLabels(activeOutputPreviewMetadata);
  const activeProviderRoleLabels = getOutputPreviewProviderRoleLabels(activeOutputPreviewMetadata);
  const activeProductFocusLabel = getOutputPreviewProductFocusLabel(activeOutputPreviewMetadata);
  const activeAssetInvocationDecisions = getOutputPreviewAssetInvocationDecisions(activeOutputPreviewMetadata);
  const activeOutputCopyPolicy = getOutputPreviewCopyRenderPolicy(activeOutputPreviewMetadata);
  const activeOutputLockSummary = getOutputPreviewLockSummary({
    metadata: activeOutputPreviewMetadata,
    decisions: activeAssetInvocationDecisions,
    copyPolicy: activeOutputCopyPolicy,
  });
  const activeOutputPrompt = activeOutputPreview?.prompt ?? getGenerationOutputPreviewPrompt({
    metadata: activeOutputPreviewMetadata,
  });
  const activeOutputError = activeOutputPreview?.error || getProviderDiagnosticSummary(activeOutputPreviewMetadata);
  const activeOutputReviewStatus = activeOutputPreview?.reviewStatus ??
    getOutputPreviewReviewStatus(activeOutputPreviewMetadata, activeOutputPreview?.status);
  const activeOutputVisualQa = useMemo(
    () => getOutputPreviewVisualQaSummary({
      item: activeOutputPreview,
      artifacts,
    }),
    [activeOutputPreview, artifacts]
  );
  const setPreviewIndex = useCallback((nextIndex: number) => {
    setOutputPreview((preview) => {
      if (!preview) return preview;
      const clampedIndex = Math.max(0, Math.min(nextIndex, preview.items.length - 1));
      return { ...preview, index: clampedIndex };
    });
  }, []);
  const dispatchPreviewOutputAction = useCallback((type: string, item: GenerationOutputPreviewItem | undefined) => {
    if (!item) return;
    window.dispatchEvent(
      new CustomEvent(type, {
        detail: {
          nodeId: item.nodeId,
          outputId: item.outputId,
          artifactId: item.artifactId,
          jobId: item.jobId,
          url: item.url,
          title: item.title,
          status: item.status,
          prompt: item.prompt,
          metadata: item.metadata,
          group: item.group,
        },
      })
    );
  }, []);
  const handleClearAgentImageEditTarget = useCallback(() => {
    setAgentImageEditTarget(null);
    setComposeBrief("");
    setComposeMessage("");
  }, []);
  const handleCanvasPaneClick = useCallback(() => {
    if (!agentImageEditTarget || composeBrief.trim() || workflowPlanPreview || composingWorkflow) return;
    handleClearAgentImageEditTarget();
    if (visibleOutputCount > 0) setAgentPanelCollapsed(true);
  }, [
    agentImageEditTarget,
    composeBrief,
    composingWorkflow,
    handleClearAgentImageEditTarget,
    visibleOutputCount,
    workflowPlanPreview,
  ]);

  const hasCanvasStatus = Boolean(workflowMessage || visibleOutputCount > 0 || activeVisibleJobCount > 0);

  return (
    <section className="relative flex h-[calc(100svh-92px)] min-h-[680px] w-full flex-col overflow-hidden bg-transparent">
      {hasCanvasStatus && (
        <div className="pointer-events-none absolute left-3 right-3 top-3 z-30 flex justify-end gap-2 lg:right-[350px]">
          {workflowMessage && (
            <div className="rounded-full bg-warm-primary-soft px-2.5 py-1.5 text-xs text-warm-primary shadow-sm">
              {workflowMessage}
            </div>
          )}
          {(visibleOutputCount > 0 || activeVisibleJobCount > 0) && (
            <div className="rounded-full border border-warm-line/50 bg-warm-paper/90 px-2.5 py-1.5 text-xs text-warm-muted shadow-sm backdrop-blur">
              {visibleOutputCount} 结果 · {activeVisibleJobCount} 生成中
            </div>
          )}
        </div>
      )}
      {visibleArtifacts.length > 0 && (
        <ResultReviewFilterBar
          value={resultReviewFilter}
          counts={resultReviewFilterCounts}
          highlightedValue={highlightedResultReviewFilter}
          onChange={setResultReviewFilter}
        />
      )}

      <div className="min-h-0 flex-1 overflow-hidden bg-warm-bg">
        <ReactFlowProvider>
          <CanvasStage
            nodes={canvasStageNodes}
            edges={canvasStageEdges}
            selectedNodeId={selectedCanvasNode?.id ?? ""}
            focusRequest={focusRequest}
            onSelectNode={setSelectedNodeId}
            onNodesChange={handleNodesChange}
            onNodePositionCommit={handleNodePositionCommit}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onPrepareAgentFromLineAction={handlePrepareAgentFromLineAction}
            onCreateKnowledgeNode={handleCreateKnowledgeNode}
            onCreateCopyNode={handleCreateCopyNode}
            onSetNodeRole={handleSetCanvasNodeRole}
            onOpenNodePreview={handleOpenCanvasNodePreview}
            onPaneClick={handleCanvasPaneClick}
            onSaveNodeAsAsset={handleSaveCanvasNodeAsAsset}
            onDeleteNodeById={handleDeleteCanvasNodeById}
            onDropAsset={handleDropAssetOnCanvas}
            onDropComponent={handleDropComponentOnCanvas}
            onUploadProduct={handleUploadProduct}
            onOpenAssets={() => setActiveBottomPanel("assets")}
            onFocusAgent={() => setAgentPanelCollapsed(false)}
            onSaveWorkflow={handleSaveWorkflow}
            onBeforeEdit={pushHistorySnapshot}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onDuplicateNode={handleDuplicateSelectedNode}
            onDeleteNode={handleDeleteSelectedNode}
            savingWorkflow={savingWorkflow}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
            canEditSelectedNode={!!selectedCanvasNode}
          />
        </ReactFlowProvider>
      </div>

      <CanvasAgentPanel
        productAsset={undefined}
        activeProductComponentTitle={activeComposeProductTitle}
        activeGenerationFrameTitle={activeAgentGenerationFrameTitle}
        editTarget={agentImageEditTarget}
        primaryMode={agentPrimaryMode}
        composeBrief={composeBrief}
        lastUserBrief={agentLastUserBrief}
        composeMessage={composeMessage}
        composingWorkflow={composingWorkflow}
        generatingSample={generatingAgentSample}
        hasAppliedWorkflow={hasAppliedAgentWorkflow}
        hasProductReference={hasCanvasProductReference}
        sampleOutputCount={agentSampleOutputCount}
        visibleOutputCount={visibleOutputCount}
        visibleArtifacts={visibleArtifacts}
        activeJobCount={activeVisibleJobCount}
        jobMessage={jobMessage}
        workflowPlanPreview={workflowPlanPreview}
        planDiff={agentPlanDiff}
        workflowPlanActionLabel={pendingAgentSamplePlan ? "确认生成样张" : undefined}
        collapsed={agentPanelCollapsed}
        onComposeBriefChange={setComposeBrief}
        onComposeWorkflow={handleComposeWorkflow}
        onEditWorkflowPlan={handleEditWorkflowPlanFromAgent}
        onApplyResultGroupEdit={handleRunAgentResultGroupRevision}
        onApplyWorkflowPlan={handleApplyWorkflowPlan}
        onDismissWorkflowPlan={handleDismissWorkflowPlan}
        onClearEditTarget={handleClearAgentImageEditTarget}
        onImportProduct={() => agentProductInputRef.current?.click()}
        onGenerateSample={() => void handleGenerateAgentSample()}
        onCollapsedChange={setAgentPanelCollapsed}
        onHighlightArtifactGroup={setHighlightedArtifactGroupTitle}
        onShowResultReviewFilter={(filter) => {
          setResultReviewFilter(filter);
          setHighlightedResultReviewFilter(filter);
        }}
      />
      <input
        ref={agentProductInputRef}
        type="file"
        accept="image/*"
        data-testid="agent-product-input"
        className="hidden"
        onChange={handleAgentProductInputChange}
      />

      {activeBottomPanel === "assets" && (
        <div
          className="absolute inset-x-3 bottom-[58px] z-50 h-[min(320px,42svh)] overflow-hidden rounded-lg border border-warm-line/60 bg-warm-paper shadow-xl lg:bottom-[48px]"
        >
          <AssetLibrary
            activeCategory={activeCategory}
            assets={visibleAssets}
            components={visibleComponents}
            assetMessage={assetMessage}
            assetPackCategory={assetPackCategory}
            assetPackRequest={assetPackRequest}
            assetPackDraft={assetPackDraft}
            assetPackMessage={assetPackMessage}
            generatingAssetPack={generatingAssetPack}
            savingAssetPack={savingAssetPack}
            uploading={uploading}
            onCategoryChange={setActiveCategory}
            onUploadProduct={(file) => handleUploadProduct(file)}
            onAssetPackCategoryChange={(category) => {
              setAssetPackCategory(category);
              setActiveCategory(mapAssetPackCategoryToLibraryCategory(category));
            }}
            onAssetPackRequestChange={setAssetPackRequest}
            onPreviewAssetPack={handlePreviewAssetPack}
            onSaveAssetPackDraft={handleSaveAssetPackDraft}
            onGenerateAssetPackReference={handleGenerateAssetPackReference}
            onDismissAssetPackDraft={() => setAssetPackDraft(null)}
            onSelectAsset={handleSelectAssetFromLibrary}
            onSelectComponent={handleSelectComponentFromLibrary}
            assetPackReferenceUploads={assetPackReferenceUploads}
            favoritesOnly={assetFavoritesOnly}
            onFavoritesOnlyChange={setAssetFavoritesOnly}
            onAddAssetPackReferenceUploads={handleAddAssetPackReferenceUploads}
            onRemoveAssetPackReferenceUpload={handleRemoveAssetPackReferenceUpload}
            onClearAssetPackReferenceUploads={() => setAssetPackReferenceUploads([])}
            onRenameAsset={handleRenameLibraryAsset}
            onToggleFavoriteAsset={handleToggleFavoriteLibraryAsset}
            onDeleteLibraryItem={handleDeleteLibraryItem}
            focusItemId={assetLibraryFocusItemId}
            showGenerator
            showUpload
            className="h-full"
          />
        </div>
      )}

      <CanvasBottomDock
        activePanel={activeBottomPanel}
        outputCount={visibleFrameOutputCount}
        activeJobCount={activeVisibleJobCount}
        onToggleAssets={() =>
          setActiveBottomPanel((panel) => (panel === "assets" ? null : "assets"))
        }
        onOpenStatus={() => setShowStatusDrawer(true)}
      />

      {showStatusDrawer && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-warm-ink/20 backdrop-blur-[1px]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowStatusDrawer(false);
          }}
        >
          <div className="h-full w-full max-w-[390px] border-l border-warm-line/60 bg-warm-paper shadow-2xl">
            <InspectorPanel
              selectedNode={selectedNode}
              canvasNodes={canvasNodes}
              canvasEdges={canvasEdges}
              components={components}
              jobs={jobs}
              queueSnapshot={queueSnapshot}
              projects={projects}
              assets={allAssets}
              productAsset={latestProductAsset}
              artifacts={artifacts}
              workflowTemplates={workflowTemplates}
              composeBrief={composeBrief}
              composingWorkflow={composingWorkflow}
              workflowPlanPreview={workflowPlanPreview}
              productImportText={productImportText}
              productImportPreview={productImportPreview}
              previewingProductImport={previewingProductImport}
              savingProductImport={savingProductImport}
              activeProductComponentTitle={activeComposeProductTitle}
              creatingJobForNodeId={creatingJobForNodeId}
              runningJobId={runningJobId}
              reviewingBatchId={reviewingBatchId}
              reviewingCheckKey={reviewingCheckKey}
              applyingTemplateId={applyingTemplateId}
              factoryLoadingId={factoryLoadingId}
              composeMessage={composeMessage}
              productImportMessage={productImportMessage}
              factoryMessage={factoryMessage}
              jobMessage={jobMessage}
              queueMessage={queueMessage}
              projectMessage={projectMessage}
              queueLoading={queueLoading}
              reclaimingStaleJobs={reclaimingStaleJobs}
              transitioningBatchId={transitioningBatchId}
              archivingBatchId={archivingBatchId}
              templateMessage={templateMessage}
              artifactMessage={artifactMessage}
              exportPackMessage={exportPackMessage}
              onClose={() => setShowStatusDrawer(false)}
              onCreateJob={handleCreateJobForNode}
              onRunJob={handleRunJob}
              onCancelJob={handleCancelJob}
              onRetryJob={handleRetryJob}
              onRetryImageJob={handleRetryImageJob}
              onRefreshQueue={handleRefreshQueue}
              onReclaimStaleJobs={handleReclaimStaleJobs}
              onRefreshProjects={refreshProjects}
              onComposeBriefChange={setComposeBrief}
              onComposeWorkflow={handleComposeWorkflow}
              onApplyWorkflowPlan={handleApplyWorkflowPlan}
              onDismissWorkflowPlan={handleDismissWorkflowPlan}
              onUpdateWorkflowPlanParameter={handleUpdateWorkflowPlanParameter}
              onProductImportTextChange={setProductImportText}
              onPreviewProductImport={handlePreviewProductImport}
              onSaveProductImport={handleSaveProductImport}
              onComposeImportedProductWorkflow={handleComposeImportedProductWorkflow}
              onSelectBatch={(batch, manifest) => {
                setJobMessage(
                  `${batch.title}：${batch.progressLabel}，${batch.pending + batch.queuedRunning} 个排队/生成中。Manifest: ${manifest?.counts.completed ?? 0}/${manifest?.items.length ?? batch.total} artifacts ready`
                );
              }}
              onMarkBatchQaPassed={handleMarkBatchQaPassed}
              onUpdateBatchState={handleUpdateExportPackBatchState}
              onArchiveBatchJobs={handleArchiveExportPackBatchJobs}
              onUpdateQaReview={handleUpdateQaReview}
              onReviewSessionSynced={() => {
                void Promise.allSettled([refreshJobs(), refreshProjects()]);
              }}
              onUpdateGenerationFramePrompt={handleUpdateGenerationFramePrompt}
              onSelectArtifact={handleSelectArtifact}
              onCreateExportPack={handleCreateExportPack}
              onApplyWorkflowTemplate={handleApplyWorkflowTemplate}
              onCreateFactoryItem={handleCreateFactoryItem}
            />
          </div>
        </div>
      )}
      {outputPreview && activeOutputPreview && (
        <OutputPreviewModal
          item={activeOutputPreview}
          index={outputPreview.index}
          total={previewCount}
          canPrevious={canPreviewPrevious}
          canNext={canPreviewNext}
          prompt={activeOutputPrompt}
          error={activeOutputError}
          referenceRoleLabels={activeReferenceRoleLabels}
          providerRoleLabels={activeProviderRoleLabels}
          productFocusLabel={activeProductFocusLabel}
          lockSummary={activeOutputLockSummary}
          copyPolicy={activeOutputCopyPolicy}
          assetInvocationDecisions={activeAssetInvocationDecisions}
          providerReferenceImages={activeProviderReferenceImages}
          promptOnlyReferenceImages={activePromptOnlyReferenceImages}
          reviewStatus={activeOutputReviewStatus}
          visualQa={activeOutputVisualQa}
          visualQaReviewing={visualQaReviewingArtifactId === activeOutputPreview.artifactId}
          onSetReviewStatus={(status) => {
            if (!activeOutputPreview.artifactId) {
              setArtifactMessage("这张图还没有可保存的产物记录");
              return;
            }
            void handleSetArtifactReviewStatus(activeOutputPreview.artifactId, status, "详情面板标记");
          }}
          onRunVisualQa={
            activeOutputPreview.artifactId
              ? () => void handleRunArtifactVisualQa(activeOutputPreview.artifactId!)
              : undefined
          }
          onPrevious={() => setPreviewIndex(outputPreview.index - 1)}
          onNext={() => setPreviewIndex(outputPreview.index + 1)}
          onClose={() => setOutputPreview(null)}
          onEdit={() => {
            dispatchPreviewOutputAction("image-master:generation-frame-output-edit", activeOutputPreview);
            setOutputPreview(null);
          }}
          onRetry={() =>
            dispatchPreviewOutputAction("image-master:generation-frame-output-retry", activeOutputPreview)
          }
          onSaveAsAsset={() =>
            dispatchPreviewOutputAction("image-master:generation-frame-output-save", activeOutputPreview)
          }
          onOpenFolder={() =>
            dispatchPreviewOutputAction("image-master:generation-frame-output-open-folder", activeOutputPreview)
          }
          onCopyPrompt={() => {
            if (!activeOutputPrompt) return;
            void navigator.clipboard?.writeText(activeOutputPrompt);
            setArtifactMessage("已复制这张图的 prompt");
          }}
        />
      )}
    </section>
  );
}

function mergeGenerationOutputPreviewMetadata({
  output,
  artifact,
  job,
}: {
  output?: GenerationFrameOutput;
  artifact?: PersistedGeneratedArtifact;
  job?: PersistedGenerationJob;
}): Record<string, unknown> {
  return {
    ...getRecordValue(job?.metadata),
    ...getRecordValue(artifact?.metadata),
    ...getRecordValue(output?.metadata),
  };
}

function getGenerationOutputPreviewPrompt({
  output,
  artifact,
  job,
  metadata = {},
}: {
  output?: GenerationFrameOutput;
  artifact?: PersistedGeneratedArtifact;
  job?: PersistedGenerationJob;
  metadata?: Record<string, unknown>;
}): string | undefined {
  const outputMetadata = getRecordValue(output?.metadata);
  return (
    getStringValue(outputMetadata.prompt) ||
    getStringValue(outputMetadata.finalPrompt) ||
    getStringValue(outputMetadata.revisedPrompt) ||
    getStringValue(artifact?.prompt) ||
    getStringValue(job?.prompt) ||
    getStringValue(metadata.prompt) ||
    getStringValue(metadata.finalPrompt) ||
    getStringValue(metadata.revisedPrompt)
  );
}

function getGenerationOutputPreviewGroup(
  metadata: Record<string, unknown>,
  artifact?: PersistedGeneratedArtifact
): string | undefined {
  return (
    getStringValue(metadata.resultGroupTitle) ||
    getStringValue(metadata.rerunGroupTitle) ||
    (artifact ? getAgentArtifactResultGroupLabel(artifact) : undefined)
  );
}

function buildSavedGenerationOutputTraceMetadata({
  metadata,
  artifact,
  job,
  prompt,
}: {
  metadata: Record<string, unknown>;
  artifact?: PersistedGeneratedArtifact;
  job?: PersistedGenerationJob;
  prompt?: string;
}): Record<string, unknown> {
  const providerImages = getOutputPreviewProviderReferenceImages(metadata)
    .map(compactGenerationReferenceImageForAsset)
    .filter(Boolean);
  const promptOnlyImages = getOutputPreviewPromptOnlyReferenceImages(metadata)
    .map(compactGenerationReferenceImageForAsset)
    .filter(Boolean);
  const trace = {
    prompt: truncateRevisionText(prompt, 6000),
    finalPrompt: truncateRevisionText(getStringValue(metadata.finalPrompt), 6000),
    revisedPrompt: truncateRevisionText(getStringValue(metadata.revisedPrompt), 6000),
    provider: artifact?.provider || getStringValue(metadata.provider),
    model: artifact?.model || getStringValue(metadata.model),
    generatedAt: artifact?.createdAt || job?.updatedAt || getStringValue(metadata.generatedAt),
    referenceImages: providerImages.length > 0 ? providerImages : undefined,
    promptOnlyReferenceImages: promptOnlyImages.length > 0 ? promptOnlyImages : undefined,
    assetInvocationPlan: compactAssetInvocationPlanForAsset(metadata.assetInvocationPlan),
    copyRenderPolicy: compactCopyRenderPolicyForAsset(metadata.copyRenderPolicy),
    productReferenceFocus: getStringValue(metadata.productReferenceFocus),
    providerReferenceCount: getMetadataNumber(metadata.providerReferenceCount),
  };

  return Object.fromEntries(Object.entries(trace).filter(([, value]) => value !== undefined));
}

function compactGenerationReferenceImageForAsset(image: GenerationReferenceImage): Record<string, unknown> | undefined {
  const url = getTraceableImageUrl(image.url);
  if (!url) return undefined;
  const compact = {
    role: image.role,
    title: truncateRevisionText(image.title, 160),
    url,
    providerUsable: image.providerUsable,
    providerMode: image.providerMode,
    source: truncateRevisionText(image.source, 120),
    nodeId: image.nodeId,
    assetId: image.assetId,
    componentId: image.componentId,
  };
  return Object.fromEntries(Object.entries(compact).filter(([, value]) => value !== undefined));
}

function compactAssetInvocationPlanForAsset(value: unknown): Record<string, unknown> | undefined {
  const plan = getRecordValue(value);
  const decisions = getOutputPreviewAssetInvocationDecisions({ assetInvocationPlan: plan }).slice(0, 8);
  if (Object.keys(plan).length === 0 && decisions.length === 0) return undefined;
  const compact = {
    mode: getStringValue(plan.mode),
    planner: getStringValue(plan.planner) || getStringValue(plan.source),
    providerReferenceRoles: getStringArray(plan.providerReferenceRoles),
    promptOnlyRoles: getStringArray(plan.promptOnlyRoles),
    decisions: decisions.length > 0 ? decisions.map((decision) => ({
      role: decision.role,
      mode: decision.mode,
      providerInput: decision.providerInput,
      reason: truncateRevisionText(decision.reason, 240),
    })) : undefined,
  };
  return Object.fromEntries(Object.entries(compact).filter(([, item]) => item !== undefined));
}

function compactCopyRenderPolicyForAsset(value: unknown): Record<string, unknown> | undefined {
  const policy = getRecordValue(value);
  if (Object.keys(policy).length === 0) return undefined;
  const compact = {
    mode: getStringValue(policy.mode),
    allowBurnIn: typeof policy.allowBurnIn === "boolean" ? policy.allowBurnIn : undefined,
    reason: truncateRevisionText(getStringValue(policy.reason), 320),
    inImageText: getStringArray(policy.inImageText).slice(0, 8),
    sellingPoints: getStringArray(policy.sellingPoints).slice(0, 8),
  };
  return Object.fromEntries(Object.entries(compact).filter(([, item]) =>
    Array.isArray(item) ? item.length > 0 : item !== undefined
  ));
}

function getTraceableImageUrl(value: unknown): string | undefined {
  const url = getStringValue(value);
  if (!url) return undefined;
  if (url.startsWith("data:image/") && url.length > 4096) return undefined;
  return url;
}

function getOutputPreviewProviderReferenceImages(
  metadata: Record<string, unknown>
): GenerationReferenceImage[] {
  const adapter = getRecordValue(metadata.providerReferenceAdapter);
  const adapterImages = getReferenceImagesFromMetadata(adapter.providerUsableImages);
  if (adapterImages.length > 0) return dedupeReferenceImages(adapterImages);

  const context = normalizeGenerationReferenceContext(metadata.referenceContext) ??
    normalizeGenerationReferenceContext(metadata);
  const images = dedupeReferenceImages([
    ...(context?.images ?? []),
    ...getReferenceImagesFromMetadata(metadata.referenceImages),
  ]);
  return images.filter((image) => image.providerUsable || image.providerMode === "provider_input");
}

function getOutputPreviewPromptOnlyReferenceImages(
  metadata: Record<string, unknown>
): GenerationReferenceImage[] {
  const adapter = getRecordValue(metadata.providerReferenceAdapter);
  const adapterPromptOnlyImages = getReferenceImagesFromMetadata(adapter.promptOnlyImages);
  const directPromptOnlyImages = getReferenceImagesFromMetadata(metadata.promptOnlyReferenceImages);
  const explicitPromptOnlyImages = dedupeReferenceImages([
    ...adapterPromptOnlyImages,
    ...directPromptOnlyImages,
  ]);
  if (explicitPromptOnlyImages.length > 0) return explicitPromptOnlyImages;

  const context = normalizeGenerationReferenceContext(metadata.referenceContext) ??
    normalizeGenerationReferenceContext(metadata);
  const providerImages = getOutputPreviewProviderReferenceImages(metadata);
  const providerKeys = new Set(providerImages.map((image) => `${image.role}:${image.url}`));
  const allImages = dedupeReferenceImages([
    ...(context?.images ?? []),
    ...getReferenceImagesFromMetadata(metadata.referenceImages),
  ]);

  return allImages.filter((image) => {
    if (providerKeys.has(`${image.role}:${image.url}`)) return false;
    return image.providerUsable === false || image.providerMode === "prompt_only";
  });
}

function getOutputPreviewReferenceRoleLabels(metadata: Record<string, unknown>): string[] {
  const routing = getRecordValue(metadata.referenceRouting);
  const context = normalizeGenerationReferenceContext(metadata.referenceContext) ??
    normalizeGenerationReferenceContext(metadata);
  const roles = getGenerationReferenceRolesFromValue(routing.activeRoles).length > 0
    ? getGenerationReferenceRolesFromValue(routing.activeRoles)
    : getGenerationReferenceRolesFromValue(metadata.itemReferenceRoles).length > 0
      ? getGenerationReferenceRolesFromValue(metadata.itemReferenceRoles)
      : generationFrameRoles.filter((role) => context?.roles[role]);
  return roles.map((role) => getGenerationReferenceRoleLabel(role));
}

function getOutputPreviewProviderRoleLabels(metadata: Record<string, unknown>): string[] {
  const routing = getRecordValue(metadata.referenceRouting);
  const providerRoles = getGenerationReferenceRolesFromValue(routing.providerInputRoles).length > 0
    ? getGenerationReferenceRolesFromValue(routing.providerInputRoles)
    : getGenerationReferenceRolesFromValue(metadata.itemProviderReferenceRoles);
  if (providerRoles.length > 0) return providerRoles.map((role) => getGenerationReferenceRoleLabel(role));

  return Array.from(
    new Set(getOutputPreviewProviderReferenceImages(metadata).map((image) => getGenerationReferenceRoleLabel(image.role)))
  );
}

function getOutputPreviewProductFocusLabel(metadata: Record<string, unknown>): string | undefined {
  const routing = getRecordValue(metadata.referenceRouting);
  const focus = getStringValue(metadata.productReferenceFocus) || getStringValue(routing.productReferenceFocus);
  if (!focus) return undefined;
  const labels: Record<string, string> = {
    front_main: "商品焦点：正面主图",
    material_detail: "商品焦点：材质细节",
    silhouette_structure: "商品焦点：廓形结构",
    scale_spec: "商品焦点：尺寸比例",
    model_wear: "商品焦点：上身展示",
    scene_lifestyle: "商品焦点：场景生活方式",
    feature_proof: "商品焦点：卖点证明",
    product_identity: "商品焦点：商品一致性",
  };
  return labels[focus] ?? `商品焦点：${focus}`;
}

function getOutputPreviewAssetInvocationDecisions(
  metadata: Record<string, unknown>
): OutputPreviewAssetInvocationDecision[] {
  const plan = getRecordValue(metadata.assetInvocationPlan);
  const decisions = Array.isArray(plan.decisions) ? plan.decisions : [];
  return decisions.flatMap((entry): OutputPreviewAssetInvocationDecision[] => {
    const record = getRecordValue(entry);
    const role = getGenerationReferenceRole(record.role);
    if (!role) return [];
    const mode = getStringValue(record.mode) || "prompt_only";
    const providerInput = record.providerInput === true;
    if (mode === "unused" && !providerInput) return [];
    return [{
      role,
      mode,
      providerInput,
      reason: getStringValue(record.reason),
    }];
  });
}

function getOutputPreviewCopyRenderPolicy(
  metadata: Record<string, unknown>
): OutputPreviewCopyRenderPolicy | undefined {
  const policy = getRecordValue(metadata.copyRenderPolicy);
  if (Object.keys(policy).length === 0) return undefined;
  return {
    mode: getStringValue(policy.mode),
    allowBurnIn: typeof policy.allowBurnIn === "boolean" ? policy.allowBurnIn : undefined,
    reason: getStringValue(policy.reason),
    inImageText: getStringArray(policy.inImageText),
    sellingPoints: getStringArray(policy.sellingPoints),
    exportCopy: getStringArray(policy.exportCopy),
    forbiddenClaims: getStringArray(policy.forbiddenClaims),
  };
}

function getOutputPreviewLockSummary({
  metadata,
  decisions,
  copyPolicy,
}: {
  metadata: Record<string, unknown>;
  decisions: OutputPreviewAssetInvocationDecision[];
  copyPolicy?: OutputPreviewCopyRenderPolicy;
}): OutputPreviewLockSummaryItem[] {
  const items: OutputPreviewLockSummaryItem[] = [];
  const usedKeys = new Set<string>();
  const push = (item: OutputPreviewLockSummaryItem) => {
    if (usedKeys.has(item.key)) return;
    usedKeys.add(item.key);
    items.push(item);
  };

  for (const decision of decisions) {
    const item = getOutputPreviewLockSummaryItem(decision);
    if (item) push(item);
  }

  for (const image of getOutputPreviewProviderReferenceImages(metadata)) {
    const item = getProviderImageLockSummaryItem(image.role);
    if (item) push(item);
  }

  if (copyPolicy?.mode) {
    push({
      key: `copy:${copyPolicy.mode}`,
      label: getOutputPreviewCopyLockLabel(copyPolicy.mode),
      tone: "copy",
    });
  }

  return items.slice(0, 8);
}

function getOutputPreviewLockSummaryItem(
  decision: OutputPreviewAssetInvocationDecision
): OutputPreviewLockSummaryItem | undefined {
  if (decision.role === "copy") return undefined;
  if (decision.providerInput) return getProviderImageLockSummaryItem(decision.role);

  if (decision.mode === "unused") return undefined;
  const labels: Partial<Record<GenerationReferenceRole, string>> = {
    product: "商品只作文字约束",
    model: "模特只作文字约束",
    scene: "场景只作空间描述",
    style: "风格只约束质感",
  };
  const label = labels[decision.role];
  if (!label) return undefined;
  return {
    key: `${decision.role}:prompt_only`,
    label,
    tone: decision.role === "product" || decision.role === "model" ? "soft" : "muted",
  };
}

function getProviderImageLockSummaryItem(
  role: GenerationReferenceRole
): OutputPreviewLockSummaryItem | undefined {
  const labels: Partial<Record<GenerationReferenceRole, string>> = {
    product: "商品强锁",
    model: "模特身份参考",
    scene: "场景锁光影",
    style: "风格图进模型",
  };
  const label = labels[role];
  if (!label) return undefined;
  return {
    key: `${role}:provider`,
    label,
    tone: role === "product" || role === "model" ? "strong" : "soft",
  };
}

function getOutputPreviewCopyLockLabel(mode: string): string {
  if (mode === "burn_in") return "文案烧进图";
  if (mode === "layout_layer") return "文案图层";
  if (mode === "metadata_only") return "文案不进图";
  return `文案 ${mode}`;
}

function getGenerationReferenceRolesFromValue(value: unknown): GenerationReferenceRole[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(getGenerationReferenceRole)
    .filter((role): role is GenerationReferenceRole => Boolean(role));
}

function CanvasStage({
  nodes,
  edges,
  selectedNodeId,
  focusRequest,
  onSelectNode,
  onNodesChange,
  onNodePositionCommit,
  onEdgesChange,
  onConnect,
  onPrepareAgentFromLineAction,
  onCreateKnowledgeNode,
  onCreateCopyNode,
  onSetNodeRole,
  onOpenNodePreview,
  onPaneClick,
  onSaveNodeAsAsset,
  onDeleteNodeById,
  onDropAsset,
  onDropComponent,
  onUploadProduct,
  onOpenAssets,
  onFocusAgent,
  onSaveWorkflow,
  onBeforeEdit,
  onUndo,
  onRedo,
  onDuplicateNode,
  onDeleteNode,
  savingWorkflow,
  canUndo,
  canRedo,
  canEditSelectedNode,
}: {
  nodes: CanvasWorkbenchNode[];
  edges: CanvasWorkbenchEdge[];
  selectedNodeId: string;
  focusRequest: CanvasFocusRequest | null;
  onSelectNode: (nodeId: string) => void;
  onNodesChange: (changes: NodeChange<CanvasFlowNode>[]) => void;
  onNodePositionCommit: (nodeId: string, position: XYPosition) => void;
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void;
  onConnect: (connection: Connection) => void;
  onPrepareAgentFromLineAction: (params: {
    sourceNodeId: string;
    actionId: LineGenerationActionId;
  }) => void;
  onCreateKnowledgeNode: (position?: XYPosition) => void;
  onCreateCopyNode: (text: string, position: XYPosition) => void;
  onSetNodeRole: (nodeId: string, role: GenerationFrameRole) => void;
  onOpenNodePreview: (nodeId: string) => void;
  onPaneClick?: () => void;
  onSaveNodeAsAsset: (nodeId: string) => void;
  onDeleteNodeById: (nodeId: string) => void;
  onDropAsset: (assetId: string, position: XYPosition, targetFrameId?: string) => void;
  onDropComponent: (componentId: string, position: XYPosition, targetFrameId?: string) => void;
  onUploadProduct: (file: File, targetFrameId?: string, position?: XYPosition) => void;
  onOpenAssets: () => void;
  onFocusAgent: () => void;
  onSaveWorkflow: () => void;
  onBeforeEdit: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicateNode: () => void;
  onDeleteNode: () => void;
  savingWorkflow: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canEditSelectedNode: boolean;
}) {
  const reactFlow = useReactFlow<CanvasFlowNode, Edge>();
  const [lineActionMenu, setLineActionMenu] = useState<{
    sourceNodeId: string;
    sourceLabel: string;
    position: XYPosition;
    screenPosition: { x: number; y: number };
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuContext | null>(null);
  const lineDragStartRef = useRef<{
    sourceNodeId: string;
    sourceLabel: string;
    start: { x: number; y: number };
  } | null>(null);
  const imageImportInputRef = useRef<HTMLInputElement>(null);
  const pendingImageImportRef = useRef<{ position: XYPosition; targetFrameId?: string } | null>(null);
  const isDraggingNodeRef = useRef(false);
  const [alignmentGuides, setAlignmentGuides] = useState<CanvasSnapTarget[]>([]);
  const [flowNodes, setFlowNodes] = useState<CanvasFlowNode[]>(() =>
    nodes.map((node) => toFlowNode(node, node.id === selectedNodeId))
  );
  const flowNodesRef = useRef(flowNodes);
  const flowEdges = useMemo(() => edges.map((edge) => toFlowEdge(edge, edges.length)), [edges]);
  const backstageFlowNodeIds = useMemo(
    () => new Set(flowNodes.filter(isCanvasBackstageNode).map((node) => node.id)),
    [flowNodes]
  );
  const visibleFlowNodes = useMemo(
    () => flowNodes.filter((node) => !backstageFlowNodeIds.has(node.id)),
    [backstageFlowNodeIds, flowNodes]
  );
  const visibleFlowEdges = useMemo(
    () => flowEdges.filter((edge) =>
      !backstageFlowNodeIds.has(String(edge.source)) &&
      !backstageFlowNodeIds.has(String(edge.target))
    ),
    [backstageFlowNodeIds, flowEdges]
  );
  const initialFitViewMinZoom = nodes.some(isArtifactResultCanvasNode)
    ? 0.82
    : nodes.length > 12
      ? 0.62
      : 0.5;

  useEffect(() => {
    flowNodesRef.current = flowNodes;
  }, [flowNodes]);

  useEffect(() => {
    if (isDraggingNodeRef.current) return;
    setFlowNodes((current) => syncFlowNodesWithWorkbenchNodes(current, nodes, selectedNodeId));
  }, [nodes, selectedNodeId]);

  const handleFlowNodesChange = useCallback(
    (changes: NodeChange<CanvasFlowNode>[]) => {
      const positionChanges = changes.filter((change) => change.type === "position");
      const structuralChanges = changes.filter((change) => change.type !== "position");
      const draggingPositionChange = [...positionChanges]
        .reverse()
        .find((change) => change.type === "position" && change.position && change.dragging);
      const draggedSourceNode =
        draggingPositionChange?.type === "position"
          ? nodes.find((node) => node.id === draggingPositionChange.id)
          : undefined;
      const snapResult =
        draggedSourceNode && draggingPositionChange?.type === "position" && draggingPositionChange.position
          ? snapCanvasNodePosition(
              draggedSourceNode,
              draggingPositionChange.position,
              nodes,
              {
                threshold: 8,
                includeSpacingGuides: true,
              }
            )
          : null;

      if (positionChanges.length > 0) {
        setAlignmentGuides(snapResult?.snapped ? snapResult.guides : []);
        setFlowNodes((items) => {
          const next = applyNodeChanges(positionChanges, items);
          if (!snapResult?.snapped || !draggingPositionChange) return next;
          return next.map((node) =>
            node.id === draggingPositionChange.id
              ? {
                  ...node,
                  position: snapResult.position,
                }
              : node
          );
        });
      }

      if (structuralChanges.length > 0) {
        setFlowNodes((items) => applyNodeChanges(structuralChanges, items));
        onNodesChange(structuralChanges);
      }
    },
    [nodes, onNodesChange]
  );

  const handleNodeDragStart = useCallback(() => {
    isDraggingNodeRef.current = true;
    onBeforeEdit();
  }, [onBeforeEdit]);

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: CanvasFlowNode) => {
      isDraggingNodeRef.current = false;
      setAlignmentGuides([]);
      const latestNode = flowNodesRef.current.find((item) => item.id === node.id) ?? node;
      onNodePositionCommit(node.id, latestNode.position);
    },
    [onNodePositionCommit]
  );

  useEffect(() => {
    if (!focusRequest?.nodeIds.length) return;

    let timeoutId: number | null = null;
    let frameId: number | null = null;
    let cancelled = false;
    let attempt = 0;

    const focusNodes = () => {
      if (cancelled) return;

      const existingNodeIds = focusRequest.nodeIds.filter((nodeId) =>
        Boolean(reactFlow.getNode(nodeId))
      );

      if (existingNodeIds.length > 0) {
        frameId = window.requestAnimationFrame(() => {
          void reactFlow.fitView({
            nodes: existingNodeIds.map((id) => ({ id })),
            padding: existingNodeIds.length > 1 ? 0.24 : 0.34,
            duration: 360,
            maxZoom: 1.12,
          });
        });
        return;
      }

      attempt += 1;
      if (attempt < 18) {
        timeoutId = window.setTimeout(focusNodes, 70);
      }
    };

    timeoutId = window.setTimeout(focusNodes, 70);

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, [focusRequest, reactFlow]);

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleStageClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    const explicitPreviewTarget = target?.closest("[data-canvas-preview-node-id]");
    const explicitPreviewNodeId = explicitPreviewTarget?.getAttribute("data-canvas-preview-node-id");
    if (explicitPreviewNodeId) {
      event.preventDefault();
      event.stopPropagation();
      onOpenNodePreview(explicitPreviewNodeId);
      return;
    }

    if (target?.closest("a,button,input,textarea,select")) return;
    const nodeElement = target?.closest("[data-node-id]");
    const nodeId = nodeElement?.getAttribute("data-node-id");
    if (!nodeId) return;
    const node = nodes.find((item) => item.id === nodeId);
    if (!node || !shouldOpenCanvasNodeOnClick(node)) return;
    onOpenNodePreview(node.id);
  }, [nodes, onOpenNodePreview]);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setLineActionMenu(null);
    setContextMenu(null);
    const assetId = event.dataTransfer.getData("application/x-image-master-asset");
    const componentId = event.dataTransfer.getData("application/x-image-master-component");
    const position = reactFlow.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    const targetFrameId = getGenerationFrameAtPosition(nodes, position)?.id;
    const imageFile = getFirstImageFile(event.dataTransfer.files);

    if (imageFile) {
      onUploadProduct(imageFile, targetFrameId, targetFrameId ? undefined : position);
      return;
    }

    if (componentId) {
      onDropComponent(componentId, position, targetFrameId);
      return;
    }

    if (assetId) onDropAsset(assetId, position, targetFrameId);
  };

  const handleImageImportChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const target = pendingImageImportRef.current;
    pendingImageImportRef.current = null;
    event.target.value = "";
    if (!file || !target) return;
    onUploadProduct(file, target.targetFrameId, target.targetFrameId ? undefined : target.position);
  }, [onUploadProduct]);

  const openPaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    setLineActionMenu(null);
    const position = reactFlow.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    setContextMenu({
      type: "pane",
      x: event.clientX,
      y: event.clientY,
      flowPosition: position,
    });
  }, [reactFlow]);

  const openNodeContextMenu = useCallback((event: React.MouseEvent, node: CanvasFlowNode) => {
    event.preventDefault();
    event.stopPropagation();
    setLineActionMenu(null);
    const isFrame = isGenerationFrameNode(node);
    const frame = isFrame ? migrateLegacyGenerationFrameData(node.data, node.id) : undefined;
    const failedOutputs = frame?.outputs.filter((output) => isRetryableGenerationFrameOutput(output)) ?? [];
    const exportableBatchId = frame ? getExportableGenerationFrameBatchId(frame.outputs) : undefined;
    const outputUrls = frame?.outputs
      .map((output) => output.url)
      .filter((value): value is string => typeof value === "string" && value.length > 0) ?? [];
    const nodeImageUrl = getStringValue(node.data.previewUrl) || getStringValue(node.data.referenceUrl);
    const nodeSource = getStringValue(node.data.source);
    setContextMenu({
      type: isFrame ? "generationFrame" : "imageNode",
      x: event.clientX,
      y: event.clientY,
      nodeId: node.id,
      label: node.data.label,
      flowPosition: node.position,
      targetFrameId: isFrame ? node.id : undefined,
      canRetryFailed: failedOutputs.length > 0,
      canExport: outputUrls.length > 0,
      batchId: exportableBatchId,
      outputUrls,
      retryJobIds: failedOutputs.map((output) => output.jobId).filter((value): value is string => Boolean(value)),
      canSaveAsAsset: Boolean(!isFrame && nodeImageUrl && nodeSource !== "asset-library"),
    });
  }, []);

  const handleContextMenuAction = useCallback(async (
    action: CanvasContextMenuAction,
    context: CanvasContextMenuContext
  ) => {
    const position = context.flowPosition ?? { x: 80, y: 120 };
    if (action === "create-knowledge-asset") {
      onCreateKnowledgeNode(position);
      return;
    }
    if (action === "import-image") {
      pendingImageImportRef.current = {
        position,
        targetFrameId: context.targetFrameId,
      };
      imageImportInputRef.current?.click();
      return;
    }
    if (action === "paste-as-copy") {
      try {
        const text = await navigator.clipboard.readText();
        onCreateCopyNode(text, position);
      } catch (error) {
        console.error("Failed to read clipboard text:", error);
      }
      return;
    }
    if (!context.nodeId) return;

    const role = getGenerationRoleFromContextAction(action);
    if (role) {
      onSetNodeRole(context.nodeId, role);
      return;
    }
    if (action === "open-preview") {
      onOpenNodePreview(context.nodeId);
      return;
    }
    if (action === "save-as-asset") {
      onSaveNodeAsAsset(context.nodeId);
      return;
    }
    if (action === "delete") {
      onDeleteNodeById(context.nodeId);
      return;
    }
    if (action === "run-generation-frame") {
      window.dispatchEvent(new CustomEvent("image-master:generation-frame-run", {
        detail: { nodeId: context.nodeId },
      }));
      return;
    }
    if (action === "retry-failed") {
      window.dispatchEvent(new CustomEvent("image-master:generation-frame-output-retry-all", {
        detail: {
          nodeId: context.nodeId,
          jobIds: context.retryJobIds ?? [],
        },
      }));
      return;
    }
    if (action === "export") {
      window.dispatchEvent(new CustomEvent("image-master:generation-frame-output-open-folder", {
        detail: {
          nodeId: context.nodeId,
          batchId: context.batchId,
          urls: context.outputUrls ?? [],
        },
      }));
    }
  }, [
    onCreateKnowledgeNode,
    onCreateCopyNode,
    onDeleteNodeById,
    onOpenNodePreview,
    onSaveNodeAsAsset,
    onSetNodeRole,
  ]);

  const openLineActionMenu = useCallback(
    ({
      sourceNodeId,
      sourceLabel,
      pointer,
      stageElement,
    }: {
      sourceNodeId: string;
      sourceLabel: string;
      pointer: { x: number; y: number };
      stageElement?: Element | null;
    }) => {
      const stageBoundsElement =
        stageElement && typeof stageElement.getBoundingClientRect === "function"
          ? stageElement
          : null;
      const bounds =
        stageBoundsElement?.getBoundingClientRect() ??
        document.querySelector("[data-canvas-stage]")?.getBoundingClientRect();
      const screenPosition = bounds
        ? {
            x: Math.min(Math.max(pointer.x - bounds.left, 12), bounds.width - 292),
            y: Math.min(Math.max(pointer.y - bounds.top, 12), bounds.height - 318),
          }
        : { x: pointer.x, y: pointer.y };

      setLineActionMenu({
        sourceNodeId,
        sourceLabel,
        position: reactFlow.screenToFlowPosition(pointer),
        screenPosition,
      });
    },
    [reactFlow]
  );

  const handleStageMouseDownCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.button === 2 && !target?.closest(".react-flow__node")) {
        openPaneContextMenu(event);
        return;
      }
      const handle = target?.closest(".semantic-port--source");
      const nodeElement = handle?.closest("[data-node-id]");
      const sourceNodeId = nodeElement?.getAttribute("data-node-id");
      if (!sourceNodeId) return;

      const sourceNode = nodes.find((node) => node.id === sourceNodeId);
      lineDragStartRef.current = {
        sourceNodeId,
        sourceLabel: sourceNode?.data.label ?? "当前节点",
        start: { x: event.clientX, y: event.clientY },
      };
    },
    [nodes, openPaneContextMenu]
  );

  const handleStageMouseUpCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const pending = lineDragStartRef.current;
      lineDragStartRef.current = null;
      if (!pending) return;

      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".semantic-port--target")) return;

      const distance = Math.hypot(
        event.clientX - pending.start.x,
        event.clientY - pending.start.y
      );
      if (distance < 24) return;

      openLineActionMenu({
        sourceNodeId: pending.sourceNodeId,
        sourceLabel: pending.sourceLabel,
        pointer: { x: event.clientX, y: event.clientY },
        stageElement: event.currentTarget,
      });
    },
    [openLineActionMenu]
  );

  useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.button === 2 &&
        target?.closest("[data-canvas-stage]") &&
        !target.closest(".react-flow__node")
      ) {
        openPaneContextMenu(event);
        return;
      }
      const handle = target?.closest(".semantic-port--source");
      const nodeElement = handle?.closest("[data-node-id]");
      const sourceNodeId = nodeElement?.getAttribute("data-node-id");
      if (!sourceNodeId) return;

      const sourceNode = nodes.find((node) => node.id === sourceNodeId);
      lineDragStartRef.current = {
        sourceNodeId,
        sourceLabel: sourceNode?.data.label ?? "当前节点",
        start: { x: event.clientX, y: event.clientY },
      };
    };

    const handleDocumentMouseUp = (event: MouseEvent) => {
      const pending = lineDragStartRef.current;
      lineDragStartRef.current = null;
      if (!pending) return;

      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".semantic-port--target")) return;

      const distance = Math.hypot(
        event.clientX - pending.start.x,
        event.clientY - pending.start.y
      );
      if (distance < 24) return;

      openLineActionMenu({
        sourceNodeId: pending.sourceNodeId,
        sourceLabel: pending.sourceLabel,
        pointer: { x: event.clientX, y: event.clientY },
        stageElement: document.querySelector("[data-canvas-stage]"),
      });
    };

    document.addEventListener("mousedown", handleDocumentMouseDown, true);
    document.addEventListener("mouseup", handleDocumentMouseUp, true);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown, true);
      document.removeEventListener("mouseup", handleDocumentMouseUp, true);
    };
  }, [nodes, openLineActionMenu, openPaneContextMenu]);

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      const fromNodeId = connectionState.fromNode?.id;
      const toNodeId = connectionState.toNode?.id;
      if (!fromNodeId || toNodeId) return;

      const pointer = getConnectionPointer(event);
      if (!pointer) return;

      const sourceNode = nodes.find((node) => node.id === fromNodeId);

      openLineActionMenu({
        sourceNodeId: fromNodeId,
        sourceLabel: sourceNode?.data.label ?? "当前节点",
        pointer,
        stageElement: event.currentTarget as Element | null,
      });
    },
    [nodes, openLineActionMenu]
  );

  const handleSelectLineAction = useCallback(
    (actionId: LineGenerationActionId) => {
      if (!lineActionMenu) return;
      onPrepareAgentFromLineAction({
        sourceNodeId: lineActionMenu.sourceNodeId,
        actionId,
      });
      setLineActionMenu(null);
    },
    [lineActionMenu, onPrepareAgentFromLineAction]
  );

  return (
    <div
      className="h-full min-h-[420px] overflow-hidden bg-warm-bg sm:min-h-[520px] lg:min-h-0"
      data-canvas-stage
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onContextMenuCapture={(event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest(".react-flow__node")) return;
        openPaneContextMenu(event);
      }}
      onClickCapture={handleStageClickCapture}
      onMouseDownCapture={handleStageMouseDownCapture}
      onMouseUpCapture={handleStageMouseUpCapture}
    >
      <input
        ref={imageImportInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageImportChange}
      />
      <div className="relative flex h-full min-h-[420px] flex-col sm:min-h-[520px] lg:min-h-0">
        <div className="relative min-h-0 flex-1">
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute left-1/2 top-[42%] z-10 w-[min(460px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 text-center">
              <div className="rounded-2xl border border-warm-line/55 bg-warm-paper/82 px-5 py-5 shadow-sm backdrop-blur">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-warm-primary-soft text-warm-primary">
                  <Sparkles className="h-5 w-5" />
                </div>
                <h2 className="mt-3 text-base font-semibold text-warm-ink">从素材或一句话开始</h2>
                <p className="mx-auto mt-1 max-w-[340px] text-xs leading-5 text-warm-muted">
                  上传商品、生成模特/场景/风格资产，或者直接告诉 Agent 你要做哪一套图。
                </p>
                <div className="pointer-events-auto mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={onOpenAssets}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-warm-line/60 bg-warm-bg px-3 py-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary"
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    准备资产
                  </button>
                  <button
                    type="button"
                    onClick={onFocusAgent}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-warm-primary px-3 py-2 text-xs font-medium text-warm-paper transition hover:bg-warm-primary/90"
                  >
                    <Bot className="h-3.5 w-3.5" />
                    告诉 Agent
                  </button>
                </div>
              </div>
            </div>
          )}
          <ReactFlow
            className="h-full"
            nodes={visibleFlowNodes}
            edges={visibleFlowEdges}
            nodeTypes={canvasNodeTypes}
            onNodeClick={(_, node) => {
              onSelectNode(node.id);
              if (shouldOpenCanvasNodeOnClick(node)) onOpenNodePreview(node.id);
            }}
            onPaneClick={() => {
              setContextMenu(null);
              onPaneClick?.();
            }}
            onPaneContextMenu={openPaneContextMenu}
            onNodeContextMenu={openNodeContextMenu}
            onNodeDragStart={handleNodeDragStart}
            onNodeDragStop={handleNodeDragStop}
            onNodesChange={handleFlowNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectEnd={handleConnectEnd}
            deleteKeyCode={null}
            fitView
            fitViewOptions={{ padding: 0.24, minZoom: initialFitViewMinZoom }}
            minZoom={0.45}
            maxZoom={1.65}
            nodesDraggable
            nodesConnectable
            elementsSelectable
            onlyRenderVisibleElements
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#eadfce" gap={28} />
            <ViewportPortal>
              <CanvasAlignmentGuides guides={alignmentGuides} />
            </ViewportPortal>
          </ReactFlow>
          {lineActionMenu && (
            <LineActionMenu
              sourceLabel={lineActionMenu.sourceLabel}
              position={lineActionMenu.screenPosition}
              onSelect={handleSelectLineAction}
              onDismiss={() => setLineActionMenu(null)}
            />
          )}
          <CanvasContextMenu
            context={contextMenu}
            onAction={handleContextMenuAction}
            onClose={() => setContextMenu(null)}
          />
        </div>
      </div>
    </div>
  );
}

function ResultReviewFilterBar({
  value,
  counts,
  highlightedValue,
  onChange,
}: {
  value: ResultReviewFilter;
  counts: Record<ResultReviewFilter, number>;
  highlightedValue?: ResultReviewFilter | null;
  onChange: (value: ResultReviewFilter) => void;
}) {
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-40 flex flex-wrap gap-1.5 lg:right-[350px]">
      <div className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-warm-line/55 bg-warm-paper/90 p-1 text-[11px] text-warm-muted shadow-sm backdrop-blur">
        {resultReviewFilterOptions.map((option) => {
          const active = option.id === value;
          const highlighted = option.id === highlightedValue;
          const count = counts[option.id] ?? 0;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-medium transition",
                active
                  ? "bg-warm-ink text-warm-paper shadow-sm"
                  : "text-warm-muted hover:bg-warm-bg hover:text-warm-ink",
                highlighted && !active && "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
              )}
              title={`${option.label}：${count} 张`}
            >
              <span>{option.label}</span>
              <span className={cn("text-[10px]", active ? "text-warm-paper/75" : "text-warm-muted/75")}>
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function buildResultReviewFilterCounts(
  artifacts: PersistedGeneratedArtifact[]
): Record<ResultReviewFilter, number> {
  const counts: Record<ResultReviewFilter, number> = {
    all: artifacts.length,
    approved: 0,
    pending: 0,
    needs_redo: 0,
    rejected: 0,
    failed: 0,
    qa_risk: 0,
  };
  for (const artifact of artifacts) {
    const status = getArtifactReviewStatus(artifact);
    if (status === "approved") counts.approved += 1;
    if (status === "pending") counts.pending += 1;
    if (status === "needs_redo") counts.needs_redo += 1;
    if (status === "rejected") counts.rejected += 1;
    if (status === "failed") counts.failed += 1;
    if (isArtifactVisualQaRisk(artifact)) counts.qa_risk += 1;
  }
  return counts;
}

function getResultReviewFilterForArtifactReviewStatus(status: ArtifactReviewStatus): ResultReviewFilter | null {
  if (status === "approved") return "approved";
  if (status === "pending") return "pending";
  if (status === "needs_redo") return "needs_redo";
  if (status === "rejected") return "rejected";
  if (status === "failed") return "failed";
  return null;
}

function isCanvasNodeVisibleForResultReviewFilter(
  node: CanvasFlowNode,
  filter: ResultReviewFilter,
  artifactById: Map<string, PersistedGeneratedArtifact>
): boolean {
  if (filter === "all") return true;

  const data = node.data;
  if (data.source === "artifact-history") {
    const artifactId = getArtifactResultNodeArtifactId(node);
    const artifact = artifactId ? artifactById.get(artifactId) : undefined;
    if (!artifact) return false;
    return filter === "qa_risk"
      ? isArtifactVisualQaRisk(artifact)
      : getArtifactReviewStatus(artifact) === filter;
  }

  if (data.source === "artifact-group-header") {
    const parameters = typeof data.parameters === "object" && data.parameters
      ? data.parameters as Record<string, unknown>
      : undefined;
    const artifactIds = Array.isArray(parameters?.layoutArtifactIds)
      ? parameters.layoutArtifactIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : [];
    return artifactIds.some((artifactId) => {
      const artifact = artifactById.get(artifactId);
      if (!artifact) return false;
      return filter === "qa_risk"
        ? isArtifactVisualQaRisk(artifact)
        : getArtifactReviewStatus(artifact) === filter;
    });
  }

  return false;
}

function withResultReviewFilterContext(
  node: CanvasFlowNode,
  filter: ResultReviewFilter,
  artifactById: Map<string, PersistedGeneratedArtifact>
): CanvasFlowNode {
  if (filter === "all" || node.data.source !== "artifact-group-header") return node;

  const parameters = typeof node.data.parameters === "object" && node.data.parameters
    ? node.data.parameters as Record<string, unknown>
    : {};
  const artifactIds = getStringArray(parameters.layoutArtifactIds);
  if (artifactIds.length === 0) return node;

  const artifacts = artifactIds
    .map((artifactId) => artifactById.get(artifactId))
    .filter((artifact): artifact is PersistedGeneratedArtifact => Boolean(artifact));
  const matchedArtifacts = artifacts.filter((artifact) => artifactMatchesResultReviewFilter(artifact, filter));
  if (matchedArtifacts.length === 0) return node;

  return {
    ...node,
    data: {
      ...node.data,
      parameters: {
        ...parameters,
        layoutFilterActive: true,
        layoutFilterLabel: getResultReviewFilterLabel(filter),
        layoutFilteredCount: matchedArtifacts.length,
        layoutFilteredTotalCount: artifacts.length || artifactIds.length,
        layoutFilteredArtifactIds: matchedArtifacts.map((artifact) => artifact.id),
        layoutFilteredArtifactTitles: matchedArtifacts.map((artifact) => artifact.title),
        layoutFilteredReviewSummary: buildArtifactReviewSummaryParts(matchedArtifacts),
        layoutFilteredVisualQaSummary: buildArtifactVisualQaSummaryParts(matchedArtifacts),
      },
    },
  };
}

function withArtifactGroupHighlightContext(
  node: CanvasFlowNode,
  highlightedGroupTitle: string
): CanvasFlowNode {
  if (!highlightedGroupTitle || node.data.source !== "artifact-group-header") return node;
  const parameters = typeof node.data.parameters === "object" && node.data.parameters
    ? node.data.parameters as Record<string, unknown>
    : {};
  const groupTitle = getStringValue(parameters.layoutGroup) || node.data.label;
  if (normalizeArtifactGroupTitle(groupTitle) !== normalizeArtifactGroupTitle(highlightedGroupTitle)) {
    return node;
  }
  return {
    ...node,
    data: {
      ...node.data,
      parameters: {
        ...parameters,
        layoutGroupHighlighted: true,
      },
    },
  };
}

function normalizeArtifactGroupTitle(value: string): string {
  return value.trim().replace(/\s+/g, "").toLowerCase();
}

function artifactMatchesResultReviewFilter(
  artifact: PersistedGeneratedArtifact,
  filter: ResultReviewFilter
): boolean {
  return filter === "qa_risk"
    ? isArtifactVisualQaRisk(artifact)
    : getArtifactReviewStatus(artifact) === filter;
}

function buildArtifactReviewSummaryParts(artifacts: PersistedGeneratedArtifact[]): string[] {
  const counts = new Map<ArtifactReviewStatus, number>();
  for (const artifact of artifacts) {
    const status = getArtifactReviewStatus(artifact);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return (["approved", "pending", "needs_redo", "rejected", "failed"] as const)
    .flatMap((status) => {
      const count = counts.get(status) ?? 0;
      return count > 0 ? [`${getArtifactReviewStatusLabel(status)} ${count}`] : [];
    });
}

function buildArtifactVisualQaSummaryParts(artifacts: PersistedGeneratedArtifact[]): string[] {
  const counts = new Map<ArtifactVisualQaStatus, number>();
  for (const artifact of artifacts) {
    const status = getArtifactVisualQaSummary(artifact).status;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return (["fail", "warn", "pending", "pass"] as const)
    .flatMap((status) => {
      const count = counts.get(status) ?? 0;
      return count > 0 ? [`${getArtifactVisualQaStatusLabel(status)} ${count}`] : [];
    });
}

function getResultReviewFilterLabel(filter: ResultReviewFilter): string {
  return resultReviewFilterOptions.find((option) => option.id === filter)?.label ?? "筛选";
}

function isArtifactVisualQaRisk(artifact: PersistedGeneratedArtifact): boolean {
  const qa = getArtifactVisualQaSummary(artifact);
  return qa.status === "fail" || qa.status === "warn";
}

function hasStoredArtifactVisualQa(artifact: PersistedGeneratedArtifact): boolean {
  const visualQa = getRecordValue(artifact.metadata?.visualQa);
  return !!getStringValue(visualQa.status);
}

function isAutoVisualQaCandidate(artifact: PersistedGeneratedArtifact): boolean {
  if (!artifact.url || isAgentArtifactFailed(artifact) || hasStoredArtifactVisualQa(artifact)) return false;
  const status = artifact.status.toLowerCase();
  return status === "ready" || status === "done" || status === "completed" || status === "success";
}

function isFreshAutoVisualQaCandidate(artifact: PersistedGeneratedArtifact): boolean {
  const time = Date.parse(artifact.updatedAt || artifact.createdAt || "");
  if (!Number.isFinite(time)) return false;
  return Date.now() - time <= autoVisualQaFreshWindowMs;
}

function CanvasBottomDock({
  activePanel,
  outputCount,
  activeJobCount,
  onToggleAssets,
  onOpenStatus,
}: {
  activePanel: "assets" | null;
  outputCount: number;
  activeJobCount: number;
  onToggleAssets: () => void;
  onOpenStatus: () => void;
}) {
  return (
    <div className="absolute inset-x-0 bottom-4 z-40 flex justify-center px-3 lg:inset-x-auto lg:left-4 lg:justify-start">
      <nav
        className="flex items-center gap-1 rounded-full border border-warm-line/55 bg-warm-paper/90 p-1 text-xs text-warm-muted shadow-sm backdrop-blur"
        aria-label="画布快捷操作"
      >
        <button
          type="button"
          onClick={onToggleAssets}
          title="素材库"
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-full font-medium transition",
            activePanel === "assets"
              ? "bg-warm-primary text-warm-paper shadow-sm"
              : "hover:bg-warm-soft hover:text-warm-ink"
          )}
        >
          <ImageIcon className="h-3.5 w-3.5" />
          <span className="sr-only">素材库</span>
        </button>
        <button
          type="button"
          onClick={onOpenStatus}
          title={`进度：${outputCount} 结果 · ${activeJobCount} 生成中`}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-full font-medium transition hover:bg-warm-soft hover:text-warm-ink"
        >
          <PackageCheck className="h-3.5 w-3.5" />
          <span className="sr-only">进度</span>
          {(outputCount > 0 || activeJobCount > 0) && (
            <span className="absolute -right-0.5 -top-0.5 rounded-full bg-warm-primary px-1 text-[9px] leading-4 text-warm-paper">
              {outputCount}
            </span>
          )}
        </button>
      </nav>
    </div>
  );
}

function CanvasAlignmentGuides({ guides }: { guides: CanvasSnapTarget[] }) {
  if (guides.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {guides.map((guide, index) => {
        const isVertical = guide.axis === "x";
        return (
          <span
            key={`${guide.axis}-${guide.value}-${guide.nodeId ?? "spacing"}-${index}`}
            className="absolute bg-warm-primary/55 shadow-[0_0_0_1px_rgba(122,85,60,0.12)]"
            style={
              isVertical
                ? {
                    left: guide.value,
                    top: -50000,
                    width: 1,
                    height: 100000,
                  }
                : {
                    left: -50000,
                    top: guide.value,
                    width: 100000,
                    height: 1,
                  }
            }
          />
        );
      })}
    </div>
  );
}

function LineActionMenu({
  sourceLabel,
  position,
  onSelect,
  onDismiss,
}: {
  sourceLabel: string;
  position: { x: number; y: number };
  onSelect: (actionId: LineGenerationActionId) => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="absolute z-20 w-[280px] overflow-hidden rounded-lg border border-warm-line/70 bg-warm-paper shadow-lg"
      style={{ left: position.x, top: position.y }}
      role="dialog"
      aria-label="选择 Agent 规划方向"
    >
      <div className="border-b border-warm-line/50 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="block truncate text-xs font-medium text-warm-ink">
              交给 Agent
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-warm-muted">
              以 {sourceLabel} 作为参考
            </span>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink"
          >
            取消
          </button>
        </div>
      </div>
      <div className="grid max-h-[312px] grid-cols-1 gap-1 overflow-auto p-2">
        {lineGenerationActions.map((action) => {
          const Icon = canvasIconMap[action.iconName];
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => onSelect(action.id)}
              className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition hover:bg-warm-soft focus:outline-none focus:ring-2 focus:ring-warm-primary/20"
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-warm-primary-soft text-warm-primary">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-warm-ink">
                  {action.title}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-warm-muted">
                  {action.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AssetLibrary({
  activeCategory,
  assets,
  components,
  assetMessage,
  assetPackCategory,
  assetPackRequest,
  assetPackDraft,
  assetPackMessage,
  assetPackReferenceUploads,
  favoritesOnly,
  generatingAssetPack,
  savingAssetPack,
  uploading,
  onCategoryChange,
  onUploadProduct,
  onAssetPackCategoryChange,
  onAssetPackRequestChange,
  onPreviewAssetPack,
  onSaveAssetPackDraft,
  onGenerateAssetPackReference,
  onDismissAssetPackDraft,
  onAddAssetPackReferenceUploads,
  onRemoveAssetPackReferenceUpload,
  onClearAssetPackReferenceUploads,
  onFavoritesOnlyChange,
  onRenameAsset,
  onToggleFavoriteAsset,
  onDeleteLibraryItem,
  onSelectAsset,
  onSelectComponent,
  focusItemId,
  showGenerator = true,
  showUpload = true,
  className,
}: {
  activeCategory: CanvasLibraryCategory;
  assets: CanvasAsset[];
  components: PersistedComponent[];
  assetMessage: string;
  assetPackCategory: AssetPackCategory;
  assetPackRequest: string;
  assetPackDraft: AssetPackDraft | null;
  assetPackMessage: string;
  assetPackReferenceUploads: AssetPackReferenceUpload[];
  favoritesOnly: boolean;
  generatingAssetPack: boolean;
  savingAssetPack: boolean;
  uploading: boolean;
  onCategoryChange: (category: CanvasLibraryCategory) => void;
  onUploadProduct: (file: File) => void;
  onAssetPackCategoryChange: (category: AssetPackCategory) => void;
  onAssetPackRequestChange: (request: string) => void;
  onPreviewAssetPack: () => void;
  onSaveAssetPackDraft: () => void;
  onGenerateAssetPackReference: () => void;
  onDismissAssetPackDraft: () => void;
  onAddAssetPackReferenceUploads: (files: FileList | File[]) => void;
  onRemoveAssetPackReferenceUpload: (uploadId: string) => void;
  onClearAssetPackReferenceUploads: () => void;
  onFavoritesOnlyChange: (value: boolean) => void;
  onRenameAsset: (item: AssetTrayItem) => void;
  onToggleFavoriteAsset: (item: AssetTrayItem) => void;
  onDeleteLibraryItem: (item: AssetTrayItem) => void;
  onSelectAsset: (assetId: string) => void;
  onSelectComponent: (componentId: string) => void;
  focusItemId?: string;
  showGenerator?: boolean;
  showUpload?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedTrayItemId, setSelectedTrayItemId] = useState<string | undefined>();
  const [previewingTrayItem, setPreviewingTrayItem] = useState<AssetTrayItem | null>(null);
  const [assetGeneratorOpen, setAssetGeneratorOpen] = useState(false);
  const visibleCategories = canvasLibraryCategories.filter((category) => category !== "平台" && category !== "质检");

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onUploadProduct(file);
    event.target.value = "";
  };

  const handlePlaceSelectedItemOnCanvas = (item: AssetTrayItem) => {
    const dragType = item.dragData?.type;
    const dragValue = item.dragData?.value;
    if (!dragValue) return;
    if (dragType === "application/x-image-master-asset") {
      onSelectAsset(dragValue);
      return;
    }
    if (dragType === "application/x-image-master-component") {
      onSelectComponent(dragValue);
    }
  };

  const trayItems: AssetTrayItem[] = [
    ...components.slice(0, 6).map((component) => {
      const iconName = getComponentIconName(component.type);
      return {
        id: `component:${component.id}`,
        title: component.title,
        description: component.description || getComponentFallbackDescription(component.type),
        category: getComponentTypeLabel(component.type),
        status: mapComponentStatusToTrayStatus(component.status),
        previewUrl: getOptionalRecordString(component.metadata, "previewUrl"),
        referenceUrl:
          getOptionalRecordString(component.metadata, "referenceUrl") ||
          getOptionalRecordString(component.metadata, "previewUrl"),
        previewAlt: getOptionalRecordString(component.metadata, "previewAlt") || component.title,
        sourceLabel: getAssetTraySourceLabel(getStringValue(component.metadata?.source) || "component-library"),
        prompt: getAssetTrayPromptFromMetadata(component.metadata),
        provider: getStringValue(component.metadata?.provider),
        model: getStringValue(component.metadata?.model),
        referenceImages: getAssetTrayReferenceImages(component.metadata, getOptionalRecordString(component.metadata, "referenceUrl")),
        promptFragments: getStringArray(component.metadata?.promptFragments),
        constraints: getStringArray(component.metadata?.constraints),
        negativeRules: getStringArray(component.metadata?.negativeRules),
        qualityRules: getStringArray(component.metadata?.qualityRules),
        icon: canvasIconMap[iconName],
        chips: getComponentLibraryChips(component),
        canDelete: true,
        dragData: {
          type: "application/x-image-master-component",
          value: component.id,
        },
      } satisfies AssetTrayItem;
    }),
    ...assets.map((asset) => ({
      id: `asset:${asset.id}`,
      title: asset.title,
      description: asset.description,
      category: asset.category,
      status: mapAssetStatusToTrayStatus(asset.status),
      previewUrl: asset.previewUrl,
      referenceUrl: asset.referenceUrl || asset.previewUrl,
      previewAlt: asset.previewAlt ?? asset.title,
      sourceLabel: getAssetTraySourceLabel(asset.source),
      prompt: getAssetTrayPromptFromMetadata(asset.rawMetadata),
      provider: getStringValue(asset.rawMetadata?.provider),
      model: getStringValue(asset.rawMetadata?.model),
      referenceImages: getAssetTrayReferenceImages(asset.rawMetadata, asset.referenceUrl || asset.previewUrl),
      promptFragments: asset.promptFragments,
      constraints: asset.constraints,
      negativeRules: asset.negativeRules,
      qualityRules: asset.qualityRules,
      icon: asset.icon,
      favorite: asset.favorite,
      canRename: true,
      canFavorite: true,
      canDelete: true,
      chips: [asset.category, asset.favorite ? "收藏" : assetStatusLabel[asset.status]],
      dragData: {
        type: "application/x-image-master-asset",
        value: asset.id,
      },
    } satisfies AssetTrayItem)),
  ];
  const selectedTrayItem = trayItems.find((item) => item.id === selectedTrayItemId);

  useEffect(() => {
    if (!focusItemId) return;
    const exists = trayItems.some((item) => item.id === focusItemId);
    if (exists) {
      setSelectedTrayItemId(focusItemId);
      setAssetGeneratorOpen(false);
    }
  }, [assets, components, focusItemId]);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <AssetTray
        title="素材库"
        categories={visibleCategories}
        activeCategory={activeCategory}
        items={trayItems}
        selectedItemId={selectedTrayItemId}
        message={assetMessage}
        secondaryActionLabel={showGenerator ? (assetGeneratorOpen ? "收起资产生成器" : "新建资产") : showUpload ? (uploading ? "上传中" : "上传") : undefined}
        emptyMessage="还没有素材"
        onCategoryChange={(category) => onCategoryChange(category as CanvasLibraryCategory)}
        actionLabel={undefined}
        onAction={undefined}
        onSecondaryAction={() => {
          if (showGenerator) {
            setAssetGeneratorOpen((value) => !value);
            return;
          }
          inputRef.current?.click();
        }}
        onSelectItem={(item) => {
          setSelectedTrayItemId(item.id);
        }}
        onRenameItem={onRenameAsset}
        onToggleFavorite={onToggleFavoriteAsset}
        onDeleteItem={onDeleteLibraryItem}
        onPreviewItem={setPreviewingTrayItem}
        onPlaceItem={handlePlaceSelectedItemOnCanvas}
        footer={
          selectedTrayItem ? (
          <AssetLibraryFooter
            selectedItem={selectedTrayItem}
            assetGeneratorOpen={false}
            assetPackCategory={assetPackCategory}
            assetPackRequest={assetPackRequest}
            assetPackDraft={assetPackDraft}
            assetPackMessage={assetPackMessage}
            assetPackReferenceUploads={assetPackReferenceUploads}
            favoritesOnly={favoritesOnly}
            generatingAssetPack={generatingAssetPack}
            savingAssetPack={savingAssetPack}
            onAssetPackCategoryChange={onAssetPackCategoryChange}
            onAssetPackRequestChange={onAssetPackRequestChange}
            onPreviewAssetPack={onPreviewAssetPack}
            onSaveAssetPackDraft={onSaveAssetPackDraft}
            onGenerateAssetPackReference={onGenerateAssetPackReference}
            onDismissAssetPackDraft={onDismissAssetPackDraft}
            onAddAssetPackReferenceUploads={onAddAssetPackReferenceUploads}
            onRemoveAssetPackReferenceUpload={onRemoveAssetPackReferenceUpload}
            onClearAssetPackReferenceUploads={onClearAssetPackReferenceUploads}
            onPlaceSelectedItemOnCanvas={handlePlaceSelectedItemOnCanvas}
            onPreviewItem={setPreviewingTrayItem}
            onFavoritesOnlyChange={onFavoritesOnlyChange}
            onAssetGeneratorOpenChange={setAssetGeneratorOpen}
            showGenerator={false}
          />
          ) : undefined
        }
        compact
        showSearch={false}
        className={cn("max-h-[72svh] lg:max-h-none", className)}
      />
      {showGenerator && assetGeneratorOpen && typeof document !== "undefined" ? createPortal((
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-warm-ink/35 p-3 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="新建资产"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAssetGeneratorOpen(false);
          }}
        >
          <div
            className="max-h-[82svh] w-full max-w-2xl overflow-auto rounded-xl border border-warm-line/65 bg-warm-paper p-4 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <AssetLibraryFooter
              selectedItem={undefined}
              assetGeneratorOpen
              assetPackCategory={assetPackCategory}
              assetPackRequest={assetPackRequest}
              assetPackDraft={assetPackDraft}
              assetPackMessage={assetPackMessage}
              assetPackReferenceUploads={assetPackReferenceUploads}
              favoritesOnly={favoritesOnly}
              generatingAssetPack={generatingAssetPack}
              savingAssetPack={savingAssetPack}
              onAssetPackCategoryChange={onAssetPackCategoryChange}
              onAssetPackRequestChange={onAssetPackRequestChange}
              onPreviewAssetPack={onPreviewAssetPack}
              onSaveAssetPackDraft={onSaveAssetPackDraft}
              onGenerateAssetPackReference={onGenerateAssetPackReference}
              onDismissAssetPackDraft={onDismissAssetPackDraft}
              onAddAssetPackReferenceUploads={onAddAssetPackReferenceUploads}
              onRemoveAssetPackReferenceUpload={onRemoveAssetPackReferenceUpload}
              onClearAssetPackReferenceUploads={onClearAssetPackReferenceUploads}
              onPlaceSelectedItemOnCanvas={handlePlaceSelectedItemOnCanvas}
              onPreviewItem={setPreviewingTrayItem}
              onFavoritesOnlyChange={onFavoritesOnlyChange}
              onAssetGeneratorOpenChange={setAssetGeneratorOpen}
              showGenerator
            />
          </div>
        </div>
      ), document.body) : null}
      <AssetLibraryImagePreviewModal
        item={previewingTrayItem}
        onClose={() => setPreviewingTrayItem(null)}
      />
    </>
  );
}

function AssetLibraryImagePreviewModal({
  item,
  onClose,
}: {
  item: AssetTrayItem | null;
  onClose: () => void;
}) {
  const imageUrl = item?.referenceUrl || item?.previewUrl;
  if (!item) return null;
  if (typeof document === "undefined") return null;
  const itemStatusLabel = getAssetTrayStatusText(item.status);
  const PreviewIcon = item.icon ?? ImageIcon;

  return createPortal((
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-warm-ink/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="查看素材大图"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-warm-line/60 bg-warm-paper shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-warm-line/60 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-warm-ink">{item.title}</div>
            <div className="mt-0.5 truncate text-[11px] text-warm-muted">
              {item.category || "素材"} · {itemStatusLabel}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {imageUrl && (
              <>
                <a
                  href={imageUrl}
                  download
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-warm-line/60 bg-warm-bg px-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Download className="h-3 w-3" />
                  下载
                </a>
                <a
                  href={imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center rounded-md border border-warm-line/60 bg-warm-bg px-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary"
                  onClick={(event) => event.stopPropagation()}
                >
                  打开原图
                </a>
              </>
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
        <div className="grid min-h-0 flex-1 gap-3 overflow-auto bg-warm-bg p-3 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="flex min-h-[360px] items-center justify-center rounded-md border border-warm-line/50 bg-warm-paper p-2">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={item.previewAlt ?? item.title}
                className="max-h-[78vh] max-w-full rounded-md object-contain shadow-sm"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-center text-warm-muted">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-warm-primary-soft text-warm-primary">
                  <PreviewIcon className="h-8 w-8" />
                </span>
                <div>
                  <div className="text-sm font-medium text-warm-ink">无图片预览</div>
                  <p className="mt-1 max-w-sm text-xs leading-5">
                    这个资产主要提供文案、规则或知识内容，可在右侧查看结构化信息。
                  </p>
                </div>
              </div>
            )}
          </div>
          <aside className="space-y-3 rounded-md border border-warm-line/50 bg-warm-paper p-3">
            <div>
              <div className="text-xs font-semibold text-warm-ink">素材信息</div>
              <div className="mt-2 space-y-1 text-xs leading-5 text-warm-muted">
                <div>类型：{item.category || "未分类"}</div>
                <div>状态：{itemStatusLabel}</div>
                {item.sourceLabel && <div>来源：{item.sourceLabel}</div>}
                {item.provider && <div>Provider：{item.provider}</div>}
                {item.model && <div>模型：{item.model}</div>}
              </div>
            </div>
            {item.description && (
              <div>
                <div className="mb-1 text-xs font-semibold text-warm-ink">说明</div>
                <p className="text-xs leading-5 text-warm-muted">{item.description}</p>
              </div>
            )}
            {item.referenceImages && item.referenceImages.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold text-warm-ink">参考图</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {item.referenceImages.slice(0, 9).map((image, index) => (
                    <a
                      key={`${image.url}-${index}`}
                      href={image.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group overflow-hidden rounded border border-warm-line/50 bg-warm-bg"
                      title={image.title}
                    >
                      <img src={image.url} alt={image.title} className="h-14 w-full object-cover transition group-hover:scale-105" />
                      <div className="truncate px-1 py-0.5 text-[9px] text-warm-muted">
                        {image.role || image.title}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
            {item.prompt && (
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-warm-ink">Prompt</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-warm-line/50 bg-warm-bg px-1.5 py-0.5 text-[10px] text-warm-muted transition hover:border-warm-primary/40 hover:text-warm-primary"
                    onClick={() => void navigator.clipboard?.writeText(item.prompt || "")}
                  >
                    <Copy className="h-3 w-3" />
                    复制
                  </button>
                </div>
                <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded border border-warm-line/45 bg-warm-bg p-2 text-[10px] leading-4 text-warm-muted">
                  {item.prompt}
                </pre>
              </div>
            )}
            {getAssetTrayRuleSummary(item).length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold text-warm-ink">规则</div>
                <div className="space-y-1">
                  {getAssetTrayRuleSummary(item).map((rule) => (
                    <div key={rule} className="rounded bg-warm-bg px-2 py-1 text-[10px] leading-4 text-warm-muted">
                      {rule}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {item.chips && item.chips.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold text-warm-ink">标签</div>
                <div className="flex flex-wrap gap-1">
                  {item.chips.map((chip) => (
                    <span key={chip} className="rounded bg-warm-bg px-1.5 py-0.5 text-[10px] text-warm-muted">
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  ), document.body);
}

function getAssetTrayStatusText(status: AssetTrayItem["status"]): string {
  if (status === "ready") return "可用";
  if (status === "checking") return "确认中";
  if (status === "needs_review") return "待确认";
  return "草稿";
}

function getAssetTraySourceLabel(source: string | undefined): string | undefined {
  if (!source) return undefined;
  if (source === "asset-pack-generator") return "资产生成器";
  if (source === "model-library") return "模特库";
  if (source === "component-library") return "组件库";
  if (source === "asset-library" || source === "persisted-asset") return "素材库";
  if (source === "canvas-manual-save") return "画布保存";
  if (source === "generation-frame-output-save") return "生成结果保存";
  if (source === "canvas-upload") return "本地上传";
  return source;
}

function getAssetTrayPromptFromMetadata(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return undefined;
  return (
    getStringValue(metadata.prompt) ||
    getStringValue(metadata.finalPrompt) ||
    getStringValue(metadata.revisedPrompt) ||
    getStringArray(metadata.promptFragments).join("\n")
  ) || undefined;
}

function getAssetTrayReferenceImages(
  metadata: Record<string, unknown> | undefined,
  fallbackUrl?: string
): AssetTrayItem["referenceImages"] {
  const images = [
    ...getAssetTrayReferenceImagesFromValue(metadata?.referenceImages),
    ...getAssetTrayReferenceImagesFromValue(metadata?.providerReferenceImages),
    ...getAssetTrayReferenceImagesFromValue(metadata?.promptOnlyReferenceImages),
  ];

  if (fallbackUrl && !images.some((image) => image.url === fallbackUrl)) {
    images.unshift({
      title: "主参考图",
      url: fallbackUrl,
      providerUsable: isProviderUsableReferenceUrl(fallbackUrl),
    });
  }

  return images.length > 0 ? images.slice(0, 12) : undefined;
}

function getAssetTrayReferenceImagesFromValue(value: unknown): NonNullable<AssetTrayItem["referenceImages"]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (typeof item === "string" && item.trim()) {
      return [{
        title: `参考图 ${index + 1}`,
        url: item.trim(),
        providerUsable: isProviderUsableReferenceUrl(item.trim()),
      }];
    }
    if (!isPlainRecord(item)) return [];
    const url = getStringValue(item.url) || getStringValue(item.src);
    if (!url) return [];
    return [{
      title: getStringValue(item.title) || getStringValue(item.label) || `参考图 ${index + 1}`,
      url,
      role: getStringValue(item.role),
      providerUsable: item.providerUsable === true || isProviderUsableReferenceUrl(url),
    }];
  });
}

function getAssetTrayRuleSummary(item: AssetTrayItem): string[] {
  return [
    ...((item.promptFragments ?? []).slice(0, 2).map((rule) => `Prompt：${rule}`)),
    ...((item.constraints ?? []).slice(0, 3).map((rule) => `约束：${rule}`)),
    ...((item.negativeRules ?? []).slice(0, 2).map((rule) => `禁用：${rule}`)),
    ...((item.qualityRules ?? []).slice(0, 2).map((rule) => `质检：${rule}`)),
  ].slice(0, 7);
}

function AssetLibraryFooter({
  selectedItem,
  assetGeneratorOpen,
  assetPackCategory,
  assetPackRequest,
  assetPackDraft,
  assetPackMessage,
  assetPackReferenceUploads,
  favoritesOnly,
  generatingAssetPack,
  savingAssetPack,
  onAssetPackCategoryChange,
  onAssetPackRequestChange,
  onPreviewAssetPack,
  onSaveAssetPackDraft,
  onGenerateAssetPackReference,
  onDismissAssetPackDraft,
  onAddAssetPackReferenceUploads,
  onRemoveAssetPackReferenceUpload,
  onClearAssetPackReferenceUploads,
  onPlaceSelectedItemOnCanvas,
  onPreviewItem,
  onFavoritesOnlyChange,
  onAssetGeneratorOpenChange,
  showGenerator = true,
}: {
  selectedItem?: AssetTrayItem;
  assetGeneratorOpen: boolean;
  assetPackCategory: AssetPackCategory;
  assetPackRequest: string;
  assetPackDraft: AssetPackDraft | null;
  assetPackMessage: string;
  assetPackReferenceUploads: AssetPackReferenceUpload[];
  favoritesOnly: boolean;
  generatingAssetPack: boolean;
  savingAssetPack: boolean;
  onAssetPackCategoryChange: (category: AssetPackCategory) => void;
  onAssetPackRequestChange: (request: string) => void;
  onPreviewAssetPack: () => void;
  onSaveAssetPackDraft: () => void;
  onGenerateAssetPackReference: () => void;
  onDismissAssetPackDraft: () => void;
  onAddAssetPackReferenceUploads: (files: FileList | File[]) => void;
  onRemoveAssetPackReferenceUpload: (uploadId: string) => void;
  onClearAssetPackReferenceUploads: () => void;
  onPlaceSelectedItemOnCanvas: (item: AssetTrayItem) => void;
  onPreviewItem: (item: AssetTrayItem) => void;
  onFavoritesOnlyChange: (value: boolean) => void;
  onAssetGeneratorOpenChange: (value: boolean) => void;
  showGenerator?: boolean;
}) {
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const SelectedIcon = selectedItem?.icon ?? ImageIcon;
  const isAssetPackBusy = generatingAssetPack || savingAssetPack;
  const draftPreviewUrl = assetPackDraft ? getAssetPackPrimaryReferenceUrl(assetPackDraft) : "";
  const referenceLabel = getAssetPackReferenceUploadLabel(assetPackCategory);
  const referenceHint = getAssetPackReferenceUploadHint(assetPackCategory);
  const generatorOpen = showGenerator && assetGeneratorOpen;
  const isCopyAssetPack = assetPackCategory === "copy_asset";
  const canGenerateAssetPack =
    Boolean(assetPackRequest.trim()) ||
    (!isCopyAssetPack && assetPackReferenceUploads.length > 0);

  return (
    <div className="space-y-2">
      {selectedItem && (
        <div className="flex items-center gap-2 rounded-md border border-warm-line/40 bg-warm-bg/70 px-2 py-1.5">
          <AssetPreview
            src={selectedItem.previewUrl}
            alt={selectedItem.previewAlt ?? selectedItem.title}
            icon={SelectedIcon}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-warm-ink">{selectedItem.title}</div>
            <div className="mt-0.5 truncate text-[10px] leading-none text-warm-muted">
              {selectedItem.category || "素材"}
            </div>
          </div>
          {selectedItem.dragData && (
            <button
              type="button"
              onClick={() => onPlaceSelectedItemOnCanvas(selectedItem)}
              className="shrink-0 rounded-md bg-warm-primary px-2 py-1 text-[11px] font-medium text-warm-paper transition hover:bg-warm-primary/90"
              title="放到画布，作为 Agent 可判断的素材"
            >
              放到画布
            </button>
          )}
          <button
            type="button"
            onClick={() => onPreviewItem(selectedItem)}
            className="shrink-0 rounded-md border border-warm-line/60 bg-warm-paper px-2 py-1 text-[11px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:opacity-40"
            title="查看素材详情"
          >
            查看
          </button>
        </div>
      )}

      {showGenerator && generatorOpen && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-warm-line/45 bg-warm-bg/75 px-2 py-1.5">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-warm-ink">新建资产</div>
            <div className="mt-0.5 truncate text-[10px] text-warm-muted">
              选类型，补参考图或一句话，满意后保存到素材库。
            </div>
          </div>
          <button
            type="button"
            onClick={() => onAssetGeneratorOpenChange(false)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-warm-line/60 bg-warm-paper px-2.5 py-1.5 text-[11px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary"
          >
            <ChevronLeft className="h-3 w-3" />
            收起
          </button>
        </div>
      )}

      {generatorOpen && (
      <div className="rounded-md border border-warm-line/45 bg-warm-bg/75 p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-warm-ink">新资产类型</span>
          {assetPackCategoryOptions.map((option) => {
            const selected = option.id === assetPackCategory;
            return (
              <button
                key={option.id}
                type="button"
                title={option.hint}
                onClick={() => onAssetPackCategoryChange(option.id)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                  selected
                    ? "bg-warm-primary text-warm-paper"
                    : "bg-warm-paper text-warm-muted hover:bg-warm-soft hover:text-warm-ink"
                )}
              >
                {option.label.replace("资产", "")}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-1">
            {assetPackDraft && (
              <button
                type="button"
                onClick={onDismissAssetPackDraft}
                className="rounded-full px-2 py-1 text-[10px] text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink"
              >
                清草案
              </button>
            )}
          </div>
        </div>

        <div
          className={cn(
            "mt-3 grid gap-2",
            isCopyAssetPack ? "lg:grid-cols-[minmax(0,1fr)_108px]" : "lg:grid-cols-[220px_minmax(0,1fr)_108px]"
          )}
        >
          {!isCopyAssetPack && (
          <div className="min-h-[88px] rounded-lg border border-dashed border-warm-line/65 bg-warm-paper px-2.5 py-2">
            <input
              ref={referenceInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) onAddAssetPackReferenceUploads(event.target.files);
                event.target.value = "";
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-medium text-warm-ink">{referenceLabel}</span>
              <div className="flex items-center gap-1">
                {assetPackReferenceUploads.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearAssetPackReferenceUploads}
                    className="rounded px-1 py-0.5 text-[10px] text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink"
                  >
                    清空
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => referenceInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded bg-warm-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-warm-primary transition hover:bg-warm-primary hover:text-warm-paper"
                >
                  <Upload className="h-3 w-3" />
                  上传
                </button>
              </div>
            </div>
            {assetPackReferenceUploads.length > 0 ? (
              <div className="mt-1.5 flex gap-1.5 overflow-x-auto">
                {assetPackReferenceUploads.map((upload, index) => (
                  <div
                    key={upload.id}
                    className="group relative h-11 w-11 shrink-0 overflow-hidden rounded-md border border-warm-line/60 bg-warm-bg"
                    title={upload.name}
                  >
                    <img
                      src={upload.dataUrl}
                      alt={upload.name}
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute left-0.5 top-0.5 rounded bg-warm-ink/70 px-0.5 text-[8px] leading-tight text-warm-paper">
                      {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveAssetPackReferenceUpload(upload.id)}
                      className="absolute right-0.5 top-0.5 rounded bg-warm-ink/70 p-0.5 text-warm-paper opacity-0 transition group-hover:opacity-100"
                      title="移除"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1.5 line-clamp-2 text-[10px] leading-4 text-warm-muted">
                {referenceHint}
              </p>
            )}
          </div>
          )}
          <textarea
            value={assetPackRequest}
            onChange={(event) => onAssetPackRequestChange(event.target.value)}
            rows={3}
            className="min-h-[88px] resize-none rounded-lg border border-warm-line/55 bg-warm-paper px-3 py-2.5 text-xs leading-relaxed text-warm-ink outline-none transition placeholder:text-warm-muted/60 focus:border-warm-primary"
            placeholder={
              assetPackCategory === "product_asset"
                ? "可选：补充商品名、材质、要保留的细节"
                : assetPackCategory === "copy_asset"
                  ? "例如：标题：暖意随身；卖点：柔软毛绒、轻量容量；禁止：不要夸大功效"
                : assetPackCategory === "style_asset"
                  ? "可选：比如杂志硬光、日系自然光、奢侈品广告感"
                  : assetPackCategory === "scene_asset"
                    ? "可选：比如咖啡厅、雪山、北欧家居"
                : "一句话描述，比如：28岁东欧女性，高级通勤感"
            }
          />
          <button
            type="button"
            disabled={isAssetPackBusy || !canGenerateAssetPack}
            onClick={onGenerateAssetPackReference}
            className="inline-flex min-h-[88px] items-center justify-center gap-1.5 rounded-lg bg-warm-primary px-3 py-2 text-xs font-medium text-warm-paper transition hover:bg-warm-primary/90 disabled:opacity-50"
          >
            {isAssetPackBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            生成
          </button>
        </div>

        {assetPackDraft && (
          <div className="mt-2 flex items-center gap-2 rounded-md bg-warm-paper px-2 py-1.5">
            {draftPreviewUrl && (
              <AssetPreview
                src={draftPreviewUrl}
                alt={assetPackDraft.title}
                icon={ImageIcon}
                size="sm"
                eager
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-medium text-warm-ink">{assetPackDraft.title}</div>
              {assetPackDraft.description && (
                <p className="mt-0.5 line-clamp-1 text-[10px] leading-4 text-warm-muted">
                  {assetPackDraft.description}
                </p>
              )}
            </div>
              <button
                type="button"
                disabled={savingAssetPack}
                onClick={onSaveAssetPackDraft}
              className="shrink-0 rounded-md bg-warm-primary-soft px-2 py-1 text-[10px] font-medium text-warm-primary transition hover:bg-warm-primary hover:text-warm-paper disabled:opacity-50"
              >
              保存
              </button>
            <button
              type="button"
              disabled={generatingAssetPack || !canGenerateAssetPack}
              onClick={onGenerateAssetPackReference}
            className="shrink-0 text-[10px] font-medium text-warm-muted transition hover:text-warm-primary disabled:opacity-50"
            >
            重做
            </button>
          </div>
        )}
        {assetPackMessage && (
          <div className="mt-2 rounded bg-warm-primary-soft px-2 py-1 text-[11px] leading-snug text-warm-primary">
            {assetPackMessage}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function CanvasAgentPanel({
  productAsset,
  activeProductComponentTitle,
  activeGenerationFrameTitle,
  editTarget,
  primaryMode,
  composeBrief,
  lastUserBrief,
  composeMessage,
  composingWorkflow,
  generatingSample,
  hasAppliedWorkflow,
  hasProductReference,
  sampleOutputCount,
  visibleOutputCount,
  visibleArtifacts,
  activeJobCount,
  jobMessage,
  workflowPlanPreview,
  planDiff,
  workflowPlanActionLabel,
  collapsed,
  onComposeBriefChange,
  onComposeWorkflow,
  onEditWorkflowPlan,
  onApplyResultGroupEdit,
  onApplyWorkflowPlan,
  onDismissWorkflowPlan,
  onClearEditTarget,
  onImportProduct,
  onGenerateSample,
  onCollapsedChange,
  onHighlightArtifactGroup,
  onShowResultReviewFilter,
}: {
  productAsset?: CanvasAsset;
  activeProductComponentTitle: string;
  activeGenerationFrameTitle?: string;
  editTarget: AgentImageEditTarget | null;
  primaryMode: CanvasAgentPrimaryMode;
  composeBrief: string;
  lastUserBrief: string;
  composeMessage: string;
  composingWorkflow: boolean;
  generatingSample: boolean;
  hasAppliedWorkflow: boolean;
  hasProductReference: boolean;
  sampleOutputCount: number;
  visibleOutputCount: number;
  visibleArtifacts: PersistedGeneratedArtifact[];
  activeJobCount: number;
  jobMessage: string;
  workflowPlanPreview: WorkflowPlanPreview | null;
  planDiff: AgentPlanDiff | null;
  workflowPlanActionLabel?: string;
  collapsed: boolean;
  onComposeBriefChange: (brief: string) => void;
  onComposeWorkflow: () => void;
  onEditWorkflowPlan: (preview: WorkflowPlanPreview, scopeGroup?: AgentPlanGroup | null) => void;
  onApplyResultGroupEdit: (
    group: AgentPlanGroup,
    brief: string,
    artifacts: PersistedGeneratedArtifact[]
  ) => void;
  onApplyWorkflowPlan: () => void;
  onDismissWorkflowPlan: () => void;
  onClearEditTarget: () => void;
  onImportProduct: () => void;
  onGenerateSample: () => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onHighlightArtifactGroup: (groupTitle: string) => void;
  onShowResultReviewFilter?: (filter: ResultReviewFilter) => void;
}) {
  const [agentEventHistory, setAgentEventHistory] = useState<AgentConversationMessage[]>([]);
  const [executedReviewSuggestionActions, setExecutedReviewSuggestionActions] = useState<Record<string, AgentReviewSuggestionExecutionState>>({});
  const [lastReviewSuggestionExecution, setLastReviewSuggestionExecution] = useState<AgentReviewSuggestionExecutionState | null>(null);
  const hasComposeBrief = !!composeBrief.trim();
  const canCompose = hasComposeBrief && !composingWorkflow;
  const agentPlan = workflowPlanPreview?.agentPlan;
  const productLabel = activeProductComponentTitle || productAsset?.title || "等待需求";
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const agentHeaderSubtitle = editTarget
    ? `修改：${editTarget.title}`
    : activeGenerationFrameTitle
      ? `当前任务：${activeGenerationFrameTitle}`
      : activeProductComponentTitle || productAsset?.title
        ? productLabel
        : "说需求，Agent 出计划";
  const hasEditTarget = Boolean(editTarget?.url);
  const [showAgentPlanAdvanced, setShowAgentPlanAdvanced] = useState(false);
  const [focusedPlanGroup, setFocusedPlanGroup] = useState<AgentPlanGroup | null>(null);
  const hasFocusedGroupContext = Boolean(focusedPlanGroup && !hasEditTarget);
  const focusedGroupArtifacts = useMemo(() => {
    const ids = new Set(focusedPlanGroup?.artifactIds ?? []);
    const jobIds = new Set(focusedPlanGroup?.jobIds ?? []);
    if (ids.size === 0 && jobIds.size === 0) return [];
    return visibleArtifacts.filter((artifact) =>
      ids.has(artifact.id) || (artifact.jobId ? jobIds.has(artifact.jobId) : false)
    );
  }, [focusedPlanGroup?.artifactIds, focusedPlanGroup?.jobIds, visibleArtifacts]);
  const isEditingVisiblePlan = Boolean(workflowPlanPreview && hasComposeBrief && !hasEditTarget);
  const hasActiveGenerationFrame = primaryMode === "plan_frame" || primaryMode === "generate_frame";
  const willCreateGenerationFrame = primaryMode === "create_frame";
  const needsProduct = hasAppliedWorkflow && !hasProductReference && !workflowPlanPreview;
  const requestedSampleCount = parseRequestedAgentSampleCount(composeBrief);
  const canGenerateSample =
    hasProductReference &&
    !workflowPlanPreview &&
    ((hasAppliedWorkflow && !hasComposeBrief) || Boolean(requestedSampleCount));
  const planFallbackReason = workflowPlanPreview?.agentPlan?.summary?.fallbackUsed
    ? workflowPlanPreview.agentPlan.summary.fallbackReason || "Agent 深度规划暂不可用"
    : "";
  const agentUnderstanding = workflowPlanPreview
    ? planFallbackReason
      ? `我先展示基础计划：${planFallbackReason}。你可以先改数量、图组和文案策略。`
      : `我会按${agentPlan?.shortLabel || "当前需求"}先出样张，再扩展完整图组。`
    : hasEditTarget
      ? `已选中「${editTarget?.title || "这张图"}」；说要怎么改，我会把它当作上一版参考。`
      : hasActiveGenerationFrame
      ? primaryMode === "generate_frame"
        ? "当前需求已写入任务；再次点击会开始生成。"
        : "正在作用于当前任务：素材在画布里，需求在这里说。"
      : needsProduct
      ? "计划已经放好，先导入商品图。"
      : canGenerateSample
        ? `商品图已接入，可以先规划 ${sampleOutputCount} 张样张，确认后再生成。`
      : willCreateGenerationFrame
        ? "说需求，我会判断用途、比例、参考图和文案策略。"
        : "说需求，我会判断要做哪些图、怎么调用素材。";
  const primaryAction = hasEditTarget
    ? onComposeWorkflow
    : isEditingVisiblePlan
    ? () => workflowPlanPreview ? onEditWorkflowPlan(workflowPlanPreview) : onComposeWorkflow()
    : needsProduct
    ? onImportProduct
    : canGenerateSample
      ? onGenerateSample
    : hasActiveGenerationFrame || willCreateGenerationFrame
    ? onComposeWorkflow
      : onComposeWorkflow;
  const handlePrimaryAction = () => {
    if (workflowPlanPreview && focusedPlanGroup && composeBrief.trim() && !hasEditTarget) {
      onEditWorkflowPlan(workflowPlanPreview, focusedPlanGroup);
      return;
    }
    if (focusedPlanGroup && composeBrief.trim() && !workflowPlanPreview && !hasEditTarget) {
      onApplyResultGroupEdit(focusedPlanGroup, composeBrief, focusedGroupArtifacts);
      return;
    }
    if (workflowPlanPreview && composeBrief.trim() && !hasEditTarget) {
      onEditWorkflowPlan(workflowPlanPreview);
      return;
    }
    primaryAction();
  };
  const primaryDisabled = hasEditTarget
    ? !canCompose
    : needsProduct
    ? false
    : canGenerateSample
      ? generatingSample
    : hasActiveGenerationFrame || willCreateGenerationFrame
    ? !canCompose
      : !canCompose;
  const primaryLabel =
    hasEditTarget
      ? "修改这张图"
      : hasFocusedGroupContext && hasComposeBrief
        ? "调整这组"
      : needsProduct
        ? "导入商品图"
      : canGenerateSample
        ? `规划 ${sampleOutputCount} 张样张`
      : workflowPlanPreview && hasComposeBrief
        ? "按这句话调整计划"
      : primaryMode === "generate_frame"
      ? "开始生成"
      : primaryMode === "plan_frame"
        ? "规划当前任务"
        : primaryMode === "create_frame"
          ? "让 Agent 规划"
          : "让 Agent 规划";
  const PrimaryIcon =
    hasEditTarget
      ? Wand2
      : needsProduct
        ? Upload
      : canGenerateSample
        ? Sparkles
      : primaryMode === "create_frame"
      ? Send
      : hasActiveGenerationFrame
        ? Sparkles
        : Send;
  const requiredRoles = agentPlan?.requiredAssetRoles ?? [];
  const matrixItems = agentPlan?.generationMatrix?.length
    ? agentPlan.generationMatrix
    : buildAgentMatrixFromPreviewItems(workflowPlanPreview?.items ?? []);
  const assetGroupsById = new Map((agentPlan?.assetGroups ?? []).map((group) => [group.id, group]));
  const missingInputById = new Map((agentPlan?.missingInputs ?? []).map((input) => [input.id, input]));
  const outputSlots = agentPlan?.outputSlots?.length
    ? agentPlan.outputSlots
    : workflowPlanPreview?.items.map((item) => ({
        id: item.id,
        label: item.title,
        purpose: item.purpose,
        ratio: item.ratio,
        samplePhase: true,
      })) ?? [];
  const blockedMatrixItemCount = matrixItems.filter((item) => item.status === "blocked").length;
  const missingInputHints = buildAgentMissingInputHints(
    agentPlan?.missingInputs ?? [],
    matrixItems,
    requiredRoles,
    agentPlan?.assetGroups ?? []
  );
  const hasBlockedAgentPlanItems = blockedMatrixItemCount > 0 || missingInputHints.length > 0;
  const canShowCompactPanel =
    collapsed &&
    !workflowPlanPreview &&
    !hasEditTarget &&
    !composeBrief.trim() &&
    !composeMessage &&
    !composingWorkflow &&
    !generatingSample;
  const compactStatus = visibleOutputCount > 0
    ? `${visibleOutputCount} 张结果`
    : "说需求";
  const estimatedCallCount =
    matrixItems.length ||
    workflowPlanPreview?.items.length ||
    workflowPlanPreview?.estimatedCount ||
    0;
  const planGroups = buildAgentPlanGroups({
    matrixItems,
    outputSlots,
    assetGroupsById,
    missingInputById,
  });
  const planGroupSyncSignature = planGroups.map(getAgentFocusedGroupSignature).join("|");
  const focusedPlanGroupSyncSignature = focusedPlanGroup
    ? getAgentFocusedGroupSignature(focusedPlanGroup)
    : "";
  const planExplanation = buildAgentPlanExplanation({
    workflowPlanPreview,
    planGroups,
    matrixItems,
  });
  const productionOrderHint = buildAgentProductionOrderHint({
    workflowPlanPreview,
    planGroups,
  });
  const followUpHint = buildAgentFollowUpHint({
    workflowPlanPreview,
    userBrief: composeBrief || lastUserBrief,
    missingInputHints,
    hasProductReference,
    matrixItems,
    planGroups,
  });
  const criticalGapItems = buildAgentCriticalGapItems({
    workflowPlanPreview,
    userBrief: composeBrief || lastUserBrief,
    missingInputHints,
    hasProductReference,
    matrixItems,
    planGroups,
  });
  const clarificationHint = buildAgentClarificationHint({
    workflowPlanPreview,
    userBrief: composeBrief || lastUserBrief,
    hasProductReference,
    matrixItems,
    planGroups,
    criticalGapItems,
  });
  const planAttentionHints = agentUniqueStrings([
    ...missingInputHints,
    ...criticalGapItems
      .filter((item) => !missingInputHints.some((hint) => hint.includes(item.label)))
      .map((item) => `${item.label}：${item.text}`),
  ]).slice(0, 4);
  const hasAgentPlanAttentionItems = planAttentionHints.length > 0;
  const editContextHint = buildAgentEditContextHint(editTarget);
  const focusedGroupHint = buildAgentFocusedGroupHint(focusedPlanGroup);
  const focusedGroupScopeText = buildAgentFocusedGroupScopeText(focusedPlanGroup, focusedGroupArtifacts);
  const progressSteps = buildAgentProgressSteps({
    hasComposeBrief,
    hasPlan: Boolean(workflowPlanPreview),
    composingWorkflow,
    generatingSample,
    activeJobCount,
    visibleOutputCount,
  });
  const canShowResultReviewAssistant = !workflowPlanPreview && !hasEditTarget && visibleOutputCount > 0 && activeJobCount === 0;
  const completionSummary = buildAgentCompletionSummary({
    visibleOutputCount: canShowResultReviewAssistant ? visibleOutputCount : 0,
    visibleArtifacts: canShowResultReviewAssistant ? visibleArtifacts : [],
    activeJobCount: canShowResultReviewAssistant ? activeJobCount : 1,
    hasPlan: Boolean(workflowPlanPreview || hasAppliedWorkflow),
    planGroups,
    matrixItems,
  });
  const qaSummaryItems = buildAgentQaSummaryItems({
    visibleOutputCount: canShowResultReviewAssistant ? visibleOutputCount : 0,
    visibleArtifacts: canShowResultReviewAssistant ? visibleArtifacts : [],
    activeJobCount: canShowResultReviewAssistant ? activeJobCount : 1,
    planGroups,
    matrixItems,
  });
  const executableReviewSuggestions = buildAgentExecutableReviewSuggestions({
    visibleArtifacts: canShowResultReviewAssistant ? visibleArtifacts : [],
    planGroups,
    matrixItems,
    activeJobCount: canShowResultReviewAssistant ? activeJobCount : 1,
  });
  const executableReviewSuggestionIds = executableReviewSuggestions.map((suggestion) => suggestion.id).join("|");
  useEffect(() => {
    if (!canShowResultReviewAssistant) {
      setLastReviewSuggestionExecution(null);
      return;
    }
    if (!executableReviewSuggestionIds) {
      setExecutedReviewSuggestionActions({});
      return;
    }
    const ids = new Set(executableReviewSuggestionIds.split("|"));
    setExecutedReviewSuggestionActions((items) => {
      const next = Object.fromEntries(Object.entries(items).filter(([id]) => ids.has(id)));
      return Object.keys(next).length === Object.keys(items).length ? items : next;
    });
  }, [canShowResultReviewAssistant, executableReviewSuggestionIds]);
  const visibleAgentHistory = canShowResultReviewAssistant
    ? agentEventHistory
    : agentEventHistory.filter((message) =>
        !message.id.startsWith("completion:") && message.title !== "生成总结"
      );
  const agentMessages = buildAgentConversationMessages({
    historyMessages: visibleAgentHistory,
    composeBrief,
    lastUserBrief,
    agentUnderstanding,
    composeMessage,
    workflowPlanPreview,
    editTarget,
    composingWorkflow,
    generatingSample,
    planFallbackReason,
    planExplanation,
    productionOrderHint,
    followUpHint,
    clarificationHint,
    criticalGapItems,
    planDiff,
    editContextHint,
    focusedGroupHint,
    completionSummary,
  });
  const planInputPlaceholder = workflowPlanPreview
    ? "直接说怎么改计划，比如：模特图少两张，详情页要烧字，加两张商场场景。"
    : editTarget
      ? "比如：把背景换成室外街拍，人物表情更自然，保留产品和构图。"
      : focusedPlanGroup
        ? "比如：这组动作太重复，换一批姿势；或这组改成商场场景。"
      : "说你要做什么，比如：羽绒服，淘宝详情页，雪山场景，带模特。";
  const criticalGapHistoryText = criticalGapItems
    .slice(0, 3)
    .map((item) => `${item.label}：${item.text}`)
    .join("\n");
  const planDiffHistoryText = planDiff ? formatAgentPlanDiffForConversation(planDiff) : "";
  const rememberAgentEvent = useCallback((key: string, message: Omit<AgentConversationMessage, "id">) => {
    const cleanText = message.text.trim();
    if (!cleanText) return;
    const signature = `${key}:${message.role}:${message.title ?? ""}:${cleanText}`;
    setAgentEventHistory((items) => {
      if (items.some((item) => item.id === signature || `${key}:${item.role}:${item.title ?? ""}:${item.text}` === signature)) {
        return items;
      }
      return [
        ...items,
        {
          ...message,
          id: signature,
          text: cleanText,
        },
      ].slice(-8);
    });
  }, []);

  useEffect(() => {
    const text = lastUserBrief.trim();
    if (!text) return;
    rememberAgentEvent(`user:${text}`, {
      role: "user",
      title: "你的需求",
      text,
    });
  }, [lastUserBrief, rememberAgentEvent]);

  useEffect(() => {
    if (!workflowPlanPreview || !planExplanation) return;
    rememberAgentEvent(`plan:${workflowPlanPreview.title}:${workflowPlanPreview.estimatedCount}`, {
      role: "agent",
      title: "计划解释",
      text: planExplanation,
    });
  }, [planExplanation, rememberAgentEvent, workflowPlanPreview]);

  useEffect(() => {
    if (!criticalGapHistoryText) return;
    rememberAgentEvent(`gaps:${criticalGapHistoryText}`, {
      role: "agent",
      title: "关键缺口",
      text: criticalGapHistoryText,
      tone: criticalGapItems.some((item) => item.tone === "warn") ? "warn" : "default",
    });
  }, [criticalGapHistoryText, criticalGapItems, rememberAgentEvent]);

  useEffect(() => {
    if (!planDiffHistoryText) return;
    rememberAgentEvent(`diff:${planDiffHistoryText}`, {
      role: "agent",
      title: "修改记录",
      text: planDiffHistoryText,
      tone: "success",
    });
  }, [planDiffHistoryText, rememberAgentEvent]);

  useEffect(() => {
    if (!completionSummary) return;
    rememberAgentEvent(`completion:${completionSummary}`, {
      role: "agent",
      title: "生成总结",
      text: completionSummary,
      tone: "success",
    });
  }, [completionSummary, rememberAgentEvent]);

  useEffect(() => {
    setShowAgentPlanAdvanced(false);
    setFocusedPlanGroup(null);
  }, [workflowPlanPreview?.title]);

  useEffect(() => {
    if (!workflowPlanPreview || !focusedPlanGroup || isArtifactFocusedPlanGroup(focusedPlanGroup)) return;
    const syncedGroup = findUpdatedFocusedPlanGroup(planGroups, focusedPlanGroup);
    if (!syncedGroup) {
      setFocusedPlanGroup(null);
      return;
    }
    if (getAgentFocusedGroupSignature(syncedGroup) !== focusedPlanGroupSyncSignature) {
      setFocusedPlanGroup(syncedGroup);
    }
  }, [
    focusedPlanGroup,
    focusedPlanGroupSyncSignature,
    planGroups,
    planGroupSyncSignature,
    workflowPlanPreview,
  ]);

  useEffect(() => {
    const target = takePendingResultGroupEditTarget();
    if (!target) return;
    const title = target.group || "结果分组";
    setFocusedPlanGroup({
      id: `artifact-group:${title}`,
      title,
      count: target.count,
      ratios: target.ratios?.length ? target.ratios : ["auto"],
      copyModes: target.copyModes ?? [],
      providerRoles: target.providerRoles ?? [],
      promptOnlyRoles: target.promptOnlyRoles ?? [],
      assetTitles: target.artifactTitles ?? [],
      artifactIds: target.artifactIds ?? [],
      jobIds: target.jobIds ?? [],
      status: "ready",
      summary: target.summary || "已从结果页带入，后续修改只影响这一组。",
      reason: "这是结果页中的一个成片分组，适合批量换姿势、换场景或调整文案策略。",
      missingHints: [],
    });
    onHighlightArtifactGroup(title);
    if (!composeBrief.trim()) onComposeBriefChange(`调整「${title}」：`);
    onCollapsedChange(false);
  }, []);

  useEffect(() => {
    const handleArtifactGroupEdit = (event: Event) => {
      const detail = event instanceof CustomEvent && isPlainRecord(event.detail)
        ? event.detail
        : undefined;
      if (!detail) return;
      const title = getStringValue(detail.group) || "结果分组";
      const count = typeof detail.count === "number" && Number.isFinite(detail.count)
        ? detail.count
        : 1;
      const ratios = getStringArray(detail.ratios);
      const artifactIds = getStringArray(detail.artifactIds);
      const jobIds = getStringArray(detail.jobIds);
      setFocusedPlanGroup({
        id: `artifact-group:${title}`,
        title,
        count,
        ratios: ratios.length > 0 ? ratios : ["auto"],
        copyModes: getStringArray(detail.copyModes),
        providerRoles: getStringArray(detail.providerRoles),
        promptOnlyRoles: getStringArray(detail.promptOnlyRoles),
        assetTitles: getStringArray(detail.artifactTitles),
        artifactIds,
        jobIds,
        status: "ready",
        summary: "已生成结果分组，后续修改只影响这一组。",
        reason: "这是成片墙中的一个结果分组，适合批量换姿势、换场景或重做风格。",
        missingHints: [],
      });
      onHighlightArtifactGroup(title);
      if (!composeBrief.trim()) onComposeBriefChange(`调整「${title}」：`);
      onCollapsedChange(false);
    };
    window.addEventListener("image-master:artifact-group-edit", handleArtifactGroupEdit);
    return () => window.removeEventListener("image-master:artifact-group-edit", handleArtifactGroupEdit);
  }, [composeBrief, onCollapsedChange, onComposeBriefChange, onHighlightArtifactGroup]);

  const handleAgentReviewSuggestionAction = useCallback((suggestion: AgentExecutableReviewSuggestion, action: AgentReviewSuggestionAction) => {
    const artifact = suggestion.artifactId
      ? visibleArtifacts.find((item) => item.id === suggestion.artifactId)
      : undefined;
    const group = suggestion.groupTitle
      ? planGroups.find((item) => item.title === suggestion.groupTitle)
      : undefined;
    const groupArtifactIds = suggestion.artifactIds ?? group?.artifactIds ?? [];
    const groupArtifacts = groupArtifactIds.length > 0
      ? visibleArtifacts.filter((item) => groupArtifactIds.includes(item.id))
      : [];
    const groupTitle = suggestion.groupTitle || group?.title || suggestion.title;
    const recordAction = (text: string) => {
      const execution = {
        action,
        label: getAgentReviewSuggestionActionLabel(action),
        text,
      };
      setExecutedReviewSuggestionActions((items) => ({
        ...items,
        [suggestion.id]: execution,
      }));
      setLastReviewSuggestionExecution(execution);
      rememberAgentEvent(`review-action:${suggestion.id}:${action}`, {
        role: "agent",
        title: "已执行建议",
        text,
        tone: "success",
      });
    };
    const showReviewFilterForStatus = (status: ArtifactReviewStatus): string => {
      const filter = getResultReviewFilterForArtifactReviewStatus(status);
      if (!filter) return "";
      onShowResultReviewFilter?.(filter);
      return getResultReviewFilterLabel(filter);
    };
    const getRemainingReviewText = (
      artifactIds: string[] = [],
      status?: ArtifactReviewStatus
    ): string => {
      const overrides = status && artifactIds.length > 0
        ? Object.fromEntries(artifactIds.map((artifactId) => [artifactId, status]))
        : {};
      return formatAgentReviewRemainingSummary(visibleArtifacts, overrides);
    };

    if (action === "approve" || action === "mark_needs_redo" || action === "reject") {
      const status: ArtifactReviewStatus =
        action === "approve" ? "approved" : action === "reject" ? "rejected" : "needs_redo";
      const filterLabel = showReviewFilterForStatus(status);
      const filterText = filterLabel ? `，已切到「${filterLabel}」` : "";
      if (suggestion.artifactId) {
        const remainingText = getRemainingReviewText([suggestion.artifactId], status);
        window.dispatchEvent(
          new CustomEvent("image-master:artifact-review-state", {
            detail: {
              artifactId: suggestion.artifactId,
              status,
              note: `Agent 建议卡片：${suggestion.title}`,
            },
          })
        );
        recordAction(`已把「${suggestion.title}」标记为${getArtifactReviewStatusLabel(status)}${filterText}。${remainingText}`);
        return;
      }
      if (groupArtifactIds.length > 0) {
        const remainingText = getRemainingReviewText(groupArtifactIds, status);
        window.dispatchEvent(
          new CustomEvent("image-master:artifact-group-review-state", {
            detail: {
              artifactIds: groupArtifactIds,
              group: groupTitle,
              status,
              note: `Agent 建议卡片：${suggestion.title}`,
            },
          })
        );
        recordAction(`已把「${groupTitle}」这一组标记为${getArtifactReviewStatusLabel(status)}${filterText}。${remainingText}`);
      }
      return;
    }

    if (action === "open") {
      if (!artifact) {
        recordAction(`没有找到「${suggestion.title}」对应的大图。`);
        return;
      }
      window.dispatchEvent(
        new CustomEvent("image-master:generation-frame-output-open", {
          detail: {
            artifactId: artifact.id,
            jobId: artifact.jobId,
            nodeId: artifact.nodeId,
            title: artifact.title,
            url: artifact.url,
            status: artifact.status,
          },
        })
      );
      recordAction(`已打开「${artifact.title}」详情，可以检查参考图、prompt 和 QA。`);
      return;
    }

    if (action === "redo") {
      if (suggestion.jobId || artifact?.jobId) {
        window.dispatchEvent(
          new CustomEvent("image-master:generation-frame-output-retry", {
            detail: {
              artifactId: suggestion.artifactId,
              jobId: suggestion.jobId || artifact?.jobId,
              title: artifact?.title || suggestion.title,
              group: artifact ? getAgentArtifactResultGroupLabel(artifact) : undefined,
            },
          })
        );
        recordAction(`已按原参考图、比例和图组用途重做「${artifact?.title || suggestion.title}」。${getRemainingReviewText()}`);
        return;
      }
      if (artifact?.url) {
        window.dispatchEvent(
          new CustomEvent("image-master:generation-frame-output-edit", {
            detail: {
              artifactId: artifact.id,
              jobId: artifact.jobId,
              nodeId: artifact.nodeId,
              title: artifact.title,
              url: artifact.url,
              status: artifact.status,
              note: "这张图没有可直接重跑的任务，已切到让 Agent 改这张",
            },
          })
        );
        window.setTimeout(() => {
          onComposeBriefChange(
            suggestion.editBrief || `重做「${artifact.title}」：只改这张，保留原参考图、比例和用途。`
          );
        }, 0);
        recordAction(`这张图没有可直接重跑的任务；已选中「${artifact.title}」，接下来只修改这张。`);
        return;
      }
      onComposeBriefChange(suggestion.editBrief || `重做「${suggestion.title}」：只改这张，保留原参考图、比例和用途。`);
      recordAction(`已切到自然语言修改；只会处理「${suggestion.title}」。`);
      return;
    }

    if (action === "edit" || action === "copy") {
      if (!artifact?.url) {
        onComposeBriefChange(suggestion.editBrief || `修改「${suggestion.title}」：只改这张，保留其他结果。`);
        recordAction(`已把「${suggestion.title}」作为单张修改目标。`);
        return;
      }
      window.dispatchEvent(
        new CustomEvent("image-master:generation-frame-output-edit", {
          detail: {
            artifactId: artifact.id,
            jobId: artifact.jobId,
            nodeId: artifact.nodeId,
            title: artifact.title,
            url: artifact.url,
            status: artifact.status,
          },
        })
      );
      const brief = action === "copy"
        ? "这张文案短一点，放在画面安全区，不要改商品包装标签；保留原商品、比例和图组用途。"
        : suggestion.editBrief || `修改这张图：${suggestion.body}；保留原参考图、比例和图组用途。`;
      window.setTimeout(() => onComposeBriefChange(brief), 0);
      recordAction(`已选中「${artifact.title}」；接下来只修改这张，保留原参考图、比例和用途。`);
      return;
    }

    const selectGroupForEdit = (text: string, brief?: string) => {
      const nextGroup = group ?? {
        id: `artifact-group:${groupTitle}`,
        title: groupTitle,
        count: groupArtifacts.length || groupArtifactIds.length || 1,
        ratios: ["auto"],
        copyModes: [],
        providerRoles: [],
        promptOnlyRoles: [],
        assetTitles: groupArtifacts.map((item) => item.title),
        artifactIds: groupArtifactIds,
        status: "ready" as const,
        summary: "已生成结果分组，后续修改只影响这一组。",
        reason: "来自 Agent 审核建议，可局部重做或调整。",
        missingHints: [],
      };
      setFocusedPlanGroup(nextGroup);
      onHighlightArtifactGroup(groupTitle);
      onComposeBriefChange(brief || suggestion.editBrief || `调整「${groupTitle}」：只改这一组，其他已保留图片不变。`);
      onCollapsedChange(false);
      recordAction(text);
    };

    if (action === "group_redo") {
      const retryableGroupArtifacts = groupArtifacts.filter((item) => item.jobId);
      if (retryableGroupArtifacts.length === 0) {
        selectGroupForEdit(
          `「${groupTitle}」没有可直接重跑的任务；已切到调整这组，后续只会改这一组。`,
          `调整「${groupTitle}」：这组没有可直接重跑的任务，请按原用途重做这一组；其他已保留图片不变。`
        );
        return;
      }
      window.dispatchEvent(
        new CustomEvent("image-master:artifact-group-retry", {
          detail: {
            group: groupTitle,
            count: retryableGroupArtifacts.length,
            ratios: group?.ratios ?? [],
            artifactIds: retryableGroupArtifacts.map((item) => item.id),
            artifactTitles: retryableGroupArtifacts.map((item) => item.title),
            providerRoles: group?.providerRoles ?? [],
            promptOnlyRoles: group?.promptOnlyRoles ?? [],
            copyModes: group?.copyModes ?? [],
          },
        })
      );
      recordAction(`已按原上下文重做「${groupTitle}」这一组 ${retryableGroupArtifacts.length} 张待处理图；其他图片不会被重写。${getRemainingReviewText()}`);
      return;
    }

    if (action === "group_edit") {
      selectGroupForEdit(`已选中「${groupTitle}」这一组；接下来只调整这组。`);
    }
  }, [
    onCollapsedChange,
    onComposeBriefChange,
    onHighlightArtifactGroup,
    onShowResultReviewFilter,
    planGroups,
    rememberAgentEvent,
    visibleArtifacts,
  ]);

  useEffect(() => {
    if (!hasEditTarget || workflowPlanPreview || collapsed) return;
    const id = window.setTimeout(() => {
      editTextareaRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [collapsed, editTarget?.artifactId, editTarget?.jobId, editTarget?.url, hasEditTarget, workflowPlanPreview]);

  if (canShowCompactPanel) {
    return (
      <div className="pointer-events-none absolute right-3 top-3 z-40">
        <button
          type="button"
          onClick={() => onCollapsedChange(false)}
          className="pointer-events-auto inline-flex max-w-[240px] items-center gap-2 rounded-full border border-warm-line/55 bg-warm-paper/90 px-3 py-2 text-left shadow-sm backdrop-blur transition hover:border-warm-primary/40 hover:text-warm-primary"
          title="展开 Agent"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-warm-primary-soft text-warm-primary">
            <Bot className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold leading-4 text-warm-ink">Agent</span>
            <span className="block truncate text-[11px] leading-4 text-warm-muted">{compactStatus}</span>
          </span>
          <ChevronLeft className="h-4 w-4 shrink-0 text-warm-muted" />
        </button>
      </div>
    );
  }

  if (hasEditTarget && !workflowPlanPreview) {
    return (
      <div className="pointer-events-none absolute right-3 top-3 z-40 w-[min(320px,calc(100%-24px))] max-w-[320px]">
        <section className="pointer-events-auto flex max-h-[calc(100vh-24px)] flex-col overflow-hidden rounded-xl border border-warm-line/55 bg-warm-paper/92 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between gap-2 border-b border-warm-line/50 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-warm-primary-soft text-warm-primary">
                <Wand2 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-warm-ink">修改这张图</h3>
                <p className="mt-0.5 truncate text-[11px] text-warm-muted">
                  作为上一版参考
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClearEditTarget}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-warm-muted transition hover:bg-warm-bg hover:text-warm-ink"
              title="取消修改目标"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
            {editTarget && (
              <div className="flex items-center gap-2 rounded-lg border border-warm-line/60 bg-warm-bg p-2">
                <img
                  src={editTarget.url}
                  alt={editTarget.title}
                  className="h-12 w-12 shrink-0 rounded-md bg-warm-paper object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-warm-ink">{editTarget.title}</div>
                  <div className="mt-0.5 truncate text-[11px] text-warm-muted">
                    保留需要保留的主体，按你的话改
                  </div>
                </div>
              </div>
            )}
            <AgentConversation messages={agentMessages} compact />
            <textarea
              ref={editTextareaRef}
              data-testid="agent-image-edit-brief"
              value={composeBrief}
              onChange={(event) => onComposeBriefChange(event.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-warm-line/70 bg-warm-bg px-3 py-2.5 text-sm leading-relaxed text-warm-ink outline-none transition placeholder:text-warm-muted/60 focus:border-warm-primary/60"
              placeholder="比如：换成室外街拍光，产品不变，文字更清晰。"
            />
            <AgentProgressSteps steps={progressSteps} />
            {composeMessage && (
              <p className="rounded-md bg-warm-bg px-2.5 py-2 text-[11px] leading-4 text-warm-muted">
                {composeMessage}
              </p>
            )}
            <button
              type="button"
              disabled={primaryDisabled}
              onClick={handlePrimaryAction}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-warm-primary px-3 py-2.5 text-sm font-medium text-warm-paper transition hover:bg-warm-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {composingWorkflow ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              {primaryLabel}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute right-3 top-3 z-40 w-[min(330px,calc(100%-24px))] max-w-[330px]">
      <section className="pointer-events-auto flex max-h-[calc(100vh-24px)] flex-col overflow-hidden rounded-xl border border-warm-line/55 bg-warm-paper/92 shadow-lg backdrop-blur">
        <div className="border-b border-warm-line/50 px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-warm-primary-soft text-warm-primary">
                  <Bot className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-warm-ink">Agent</h3>
                  <p className="mt-0.5 truncate text-[11px] text-warm-muted">
                    {agentHeaderSubtitle}
                  </p>
                </div>
              </div>
            </div>
            <span className="hidden shrink-0 rounded bg-warm-bg px-2 py-1 text-[10px] text-warm-muted sm:inline">
              主控
            </span>
            <button
              type="button"
              onClick={() => onCollapsedChange(true)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-warm-muted transition hover:bg-warm-bg hover:text-warm-ink"
              title="收起 Agent"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
          <AgentProjectContextCard
            productLabel={productLabel}
            hasProductReference={hasProductReference}
            hasPlan={Boolean(workflowPlanPreview || hasAppliedWorkflow)}
            visibleOutputCount={visibleOutputCount}
            activeJobCount={activeJobCount}
          />

          <AgentConversation messages={agentMessages} />

          {criticalGapItems.length > 0 && (
            <AgentGapChecklist items={criticalGapItems} />
          )}

          {planDiff && (
            <AgentPlanDiffCard
              diff={planDiff}
              actionLabel={
                workflowPlanPreview
                  ? workflowPlanActionLabel || (hasActiveGenerationFrame ? "应用到当前任务" : "应用到画布")
                  : undefined
              }
              actionDisabled={Boolean(workflowPlanPreview && hasBlockedAgentPlanItems)}
              actionHelpText={
                workflowPlanPreview && hasBlockedAgentPlanItems
                  ? "先补齐关键素材，再应用这份已调整计划。"
                  : "确认无误后，可以直接执行这份已调整计划。"
              }
              onAction={workflowPlanPreview ? onApplyWorkflowPlan : undefined}
            />
          )}

          {focusedPlanGroup && !editTarget && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-warm-primary/20 bg-warm-primary-soft/55 px-2.5 py-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-warm-ink">
                  正在调整：{focusedPlanGroup.title}
                </div>
                <div className="mt-0.5 text-[11px] text-warm-muted">
                  {focusedGroupScopeText}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFocusedPlanGroup(null)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-warm-muted transition hover:bg-warm-paper hover:text-warm-ink"
                title="取消分组上下文"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {editTarget && (
            <div className="flex items-center gap-2 rounded-lg border border-warm-primary/20 bg-warm-primary-soft/55 p-2">
              <img
                src={editTarget.url}
                alt={editTarget.title}
                className="h-12 w-12 shrink-0 rounded-md bg-warm-paper object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-warm-ink">{editTarget.title}</div>
                <div className="mt-0.5 text-[11px] leading-4 text-warm-muted">
                  这张会作为上一版参考图
                </div>
              </div>
              <button
                type="button"
                onClick={onClearEditTarget}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-warm-muted transition hover:bg-warm-paper hover:text-warm-ink"
                title="取消修改目标"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {completionSummary && (
            <div className="space-y-2 rounded-lg border border-emerald-200/70 bg-emerald-50 px-3 py-2 text-[11px] leading-4 text-emerald-800">
              <div className="whitespace-pre-line">{completionSummary}</div>
            </div>
          )}
          {lastReviewSuggestionExecution && (
            <div
              className="rounded-lg border border-emerald-200/80 bg-emerald-50 px-3 py-2 text-[11px] leading-4 text-emerald-800"
              data-testid="agent-review-action-feedback"
            >
              <div className="font-medium">最近执行：{lastReviewSuggestionExecution.label}</div>
              <div className="mt-0.5 text-emerald-700">{lastReviewSuggestionExecution.text}</div>
            </div>
          )}
          {executableReviewSuggestions.length > 0 && (
            <AgentReviewSuggestionCards
              suggestions={executableReviewSuggestions}
              executedActions={executedReviewSuggestionActions}
              onAction={handleAgentReviewSuggestionAction}
            />
          )}
          {qaSummaryItems.length > 0 && (
            <AgentQaSummary items={qaSummaryItems} />
          )}

          {workflowPlanPreview ? (
            <div className="rounded-lg border border-warm-line/60 bg-warm-bg p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-medium text-warm-ink">
                    {agentPlan?.shortLabel || workflowPlanPreview.title}
                  </h4>
                  <p className="mt-1 text-[11px] leading-4 text-warm-muted">
                    {requiredRoles.length > 0
                      ? `需要 ${requiredRoles.map(getGenerationReferenceRoleLabel).join("、")} 资产。`
                      : "可先从文字需求生成样张。"}
                  </p>
                </div>
                <span className="shrink-0 rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">
                  {workflowPlanPreview.estimatedCount} 图
                </span>
              </div>
              <AgentPlanBoard
                groups={planGroups}
                totalCount={estimatedCallCount || workflowPlanPreview.estimatedCount}
                blockedCount={hasBlockedAgentPlanItems ? blockedMatrixItemCount || missingInputHints.length : 0}
                planDiff={planDiff}
                onFocusGroup={(group) => {
                  setFocusedPlanGroup(group);
                  onComposeBriefChange(`调整「${group.title}」：`);
                }}
              />
              {hasAgentPlanAttentionItems && (
                <div className="mt-2 rounded-md border border-amber-200/80 bg-amber-50 px-2.5 py-2 text-[11px] leading-4 text-amber-800">
                  <div>
                    {hasBlockedAgentPlanItems
                      ? "当前计划缺少关键素材。先补齐关键参考，再应用计划。"
                      : "本轮还要注意这些素材风险；不阻塞规划，但会影响成片稳定性。"}
                  </div>
                  {planAttentionHints.length > 0 && (
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {planAttentionHints.map((hint) => (
                        <li key={hint}>{hint}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {matrixItems.length > 0 && (
                <div className="mt-3 border-t border-warm-line/50 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAgentPlanAdvanced((value) => !value)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-left text-[11px] font-medium text-warm-muted transition hover:bg-warm-paper hover:text-warm-ink"
                  >
                    <span>
                      查看参考图细节
                      {agentPlan?.compositionMode ? ` · ${getCompositionModeLabel(agentPlan.compositionMode)}` : ""}
                    </span>
                    <ChevronRight className={cn("h-3.5 w-3.5 transition", showAgentPlanAdvanced && "rotate-90")} />
                  </button>
                  {showAgentPlanAdvanced && (
                    <div className="mt-1.5 max-h-[218px] space-y-1.5 overflow-y-auto pr-1">
                      {matrixItems.slice(0, 8).map((item, index) => {
                        const providerRoles = item.providerReferenceRoles;
                        const promptOnlyRoles = item.referenceRoles.filter((role) => !providerRoles.includes(role));
                        const assetTitles = item.assetGroupIds
                          .map((id) => assetGroupsById.get(id)?.title)
                          .filter((title): title is string => Boolean(title));
                        return (
                          <div
                            key={item.id || item.itemId}
                            className={cn(
                              "rounded-md border bg-warm-paper px-2.5 py-2",
                              item.status === "blocked"
                                ? "border-red-200/80"
                                : "border-warm-line/55"
                            )}
                          >
                            <div className="truncate text-[12px] font-medium text-warm-ink">
                              {index + 1}. {getAgentPlanGroupDisplayTitle(item.title, item.outputSlotId || item.type)}
                            </div>
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              <AgentPlanTinyBadge>{item.ratio || "auto"}</AgentPlanTinyBadge>
                              <AgentPlanTinyBadge>{getCopyModeLabel(item.copyMode)}</AgentPlanTinyBadge>
                              {item.status === "blocked" && <AgentPlanTinyBadge tone="warn">缺素材</AgentPlanTinyBadge>}
                            </div>
                            <div className="mt-1.5 space-y-0.5 text-[11px] leading-4 text-warm-muted">
                              <div className="truncate">
                                强参考：{providerRoles.length ? providerRoles.map(getAgentPlanRoleLabel).join("、") : "无"}
                              </div>
                              <div className="truncate">
                                文字/约束：{promptOnlyRoles.length ? promptOnlyRoles.map(getAgentPlanRoleLabel).join("、") : "无"}
                              </div>
                              {assetTitles.length > 0 && (
                                <div className="truncate">素材：{assetTitles.slice(0, 3).join("、")}</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={onApplyWorkflowPlan}
                  disabled={hasBlockedAgentPlanItems}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-warm-primary px-3 py-2 text-xs font-medium text-warm-paper transition hover:bg-warm-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Save className="h-3.5 w-3.5" />
                  {workflowPlanActionLabel || (hasActiveGenerationFrame ? "应用到当前任务" : "应用到画布")}
                </button>
                <button
                  type="button"
                  onClick={onDismissWorkflowPlan}
                  className="inline-flex items-center justify-center rounded-md border border-warm-line/60 bg-warm-paper px-3 py-2 text-xs font-medium text-warm-muted transition hover:border-warm-primary/40 hover:text-warm-primary"
                >
                  关闭
                </button>
              </div>
            </div>
          ) : null}

        </div>
        <div className="shrink-0 space-y-2.5 border-t border-warm-line/50 bg-warm-paper/95 p-3">
          <textarea
            value={composeBrief}
            onChange={(event) => onComposeBriefChange(event.target.value)}
            rows={3}
            className="w-full resize-none rounded-lg border border-warm-line/70 bg-warm-bg px-3 py-2.5 text-sm leading-relaxed text-warm-ink outline-none transition placeholder:text-warm-muted/60 focus:border-warm-primary/60"
            placeholder={planInputPlaceholder}
          />

          <p className="text-[11px] leading-4 text-warm-muted">
            你可以直接说“不要这组”“这类少两张”“这张重做”；Agent 会先改计划，再执行。
          </p>

          <AgentProgressSteps steps={progressSteps} jobMessage={jobMessage} />

          {composeMessage && (
            <p className="rounded-md bg-warm-bg px-2.5 py-2 text-[11px] leading-4 text-warm-muted">
              {composeMessage}
            </p>
          )}

          <button
            type="button"
            disabled={primaryDisabled}
            onClick={handlePrimaryAction}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-warm-primary px-3 py-2.5 text-sm font-medium text-warm-paper transition hover:bg-warm-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {composingWorkflow || generatingSample ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PrimaryIcon className="h-4 w-4" />
            )}
            {primaryLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function AgentProjectContextCard({
  productLabel,
  hasProductReference,
  hasPlan,
  visibleOutputCount,
  activeJobCount,
}: {
  productLabel: string;
  hasProductReference: boolean;
  hasPlan: boolean;
  visibleOutputCount: number;
  activeJobCount: number;
}) {
  return (
    <div className="rounded-lg border border-warm-line/55 bg-warm-bg px-3 py-2.5" data-testid="agent-project-context">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-warm-muted">
            当前项目理解
          </div>
          <div className="mt-1 truncate text-xs font-medium text-warm-ink">
            {productLabel}
          </div>
        </div>
        <span className={cn(
          "shrink-0 rounded-full px-2 py-1 text-[10px]",
          hasProductReference
            ? "bg-warm-primary-soft text-warm-primary"
            : "bg-warm-paper text-warm-muted"
        )}>
          {hasProductReference ? "已锁商品" : "待商品图"}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <AgentContextMetric
          label="计划"
          value={hasPlan ? "已准备" : visibleOutputCount > 0 ? "已出图" : "待生成"}
          active={hasPlan || visibleOutputCount > 0}
        />
        <AgentContextMetric label="结果" value={`${visibleOutputCount} 张`} active={visibleOutputCount > 0} />
        <AgentContextMetric label="生成" value={activeJobCount > 0 ? `${activeJobCount} 中` : "空闲"} active={activeJobCount > 0} />
      </div>
    </div>
  );
}

function AgentContextMetric({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <div className={cn(
      "min-w-0 rounded-md border px-2 py-1.5",
      active ? "border-warm-primary/25 bg-warm-paper" : "border-warm-line/45 bg-warm-soft/35"
    )}>
      <span className="block text-[10px] text-warm-muted">{label}</span>
      <span className="mt-0.5 block truncate text-[11px] font-medium text-warm-ink">{value}</span>
    </div>
  );
}

function AgentConversation({
  messages,
  compact = false,
}: {
  messages: AgentConversationMessage[];
  compact?: boolean;
}) {
  const visibleMessages = compact
    ? getCompactAgentConversationMessages(messages)
    : messages.slice(-7);
  return (
    <div className={cn("rounded-lg border border-warm-line/55 bg-warm-paper", compact ? "p-2" : "p-2.5")} data-testid="agent-conversation">
      {!compact && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-warm-muted">对话</span>
          <span className="text-[10px] text-warm-muted">自然语言改计划</span>
        </div>
      )}
      <div className="space-y-1.5">
        {visibleMessages.map((message) => {
          const isUser = message.role === "user";
          return (
            <div
              key={message.id}
              className={cn(
                "flex",
                isUser ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[92%] rounded-lg px-2.5 py-2 text-[11px] leading-4",
                  isUser
                    ? "bg-warm-primary text-warm-paper"
                    : message.tone === "success"
                      ? "bg-emerald-50 text-emerald-800"
                      : message.tone === "warn"
                        ? "bg-amber-50 text-amber-800"
                      : message.tone === "progress"
                        ? "bg-warm-primary-soft text-warm-primary"
                        : "bg-warm-bg text-warm-ink"
                )}
              >
                {message.title && (
                  <div className={cn(
                    "mb-0.5 text-[10px] font-medium",
                    isUser ? "text-warm-paper/80" : "text-warm-muted"
                  )}>
                    {message.title}
                  </div>
                )}
                <div className="whitespace-pre-line">{message.text}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getCompactAgentConversationMessages(
  messages: AgentConversationMessage[]
): AgentConversationMessage[] {
  const pinnedIds = new Set(["agent-edit-context", "agent-focused-group"]);
  const pinnedMessages = messages.filter((message) => pinnedIds.has(message.id));
  const tailMessages = messages.slice(-2);
  const seen = new Set<string>();
  return [...pinnedMessages, ...tailMessages].filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  }).slice(-4);
}

function AgentProgressSteps({
  steps,
  jobMessage,
}: {
  steps: AgentProgressStep[];
  jobMessage?: string;
}) {
  return (
    <div className="rounded-lg border border-warm-line/55 bg-warm-bg px-3 py-2" data-testid="agent-progress-steps">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-warm-muted">制作进度</span>
        {jobMessage && <span className="truncate text-[10px] text-warm-muted">{jobMessage}</span>}
      </div>
      <div className="mt-2 grid grid-cols-6 gap-1.5">
        {steps.map((step) => (
          <div key={step.id} className="min-w-0">
            <div className={cn(
              "mb-1 h-1 rounded-full",
              step.status === "done"
                ? "bg-warm-primary"
                : step.status === "active"
                  ? "bg-warm-primary/55"
                  : "bg-warm-line/60"
            )} />
            <div className={cn(
              "truncate text-[10px]",
              step.status === "pending" ? "text-warm-muted" : "text-warm-ink"
            )}>
              {step.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentPlanBoard({
  groups,
  totalCount,
  blockedCount,
  planDiff,
  onFocusGroup,
}: {
  groups: AgentPlanGroup[];
  totalCount: number;
  blockedCount: number;
  planDiff?: AgentPlanDiff | null;
  onFocusGroup: (group: AgentPlanGroup) => void;
}) {
  const visibleGroups = groups.slice(0, 6);
  const hiddenCount = Math.max(0, groups.length - visibleGroups.length);
  return (
    <div className="mt-3 rounded-lg border border-warm-line/55 bg-warm-paper p-2.5" data-testid="agent-plan-board">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-warm-muted">
            制作清单
          </div>
          <div className="mt-0.5 text-[11px] text-warm-muted">
            共 {totalCount || groups.reduce((sum, group) => sum + group.count, 0)} 张{blockedCount > 0 ? " · 有缺素材" : ""}
          </div>
        </div>
        <ListChecks className="h-4 w-4 text-warm-primary" />
      </div>
      <div className="mt-2 space-y-1.5">
        {visibleGroups.map((group) => {
          const changed = isAgentPlanGroupAffectedByDiff(group, planDiff);
          return (
            <div
              key={group.id}
              className={cn(
                "rounded-md border bg-warm-bg px-2.5 py-2",
                group.status === "blocked" ? "border-amber-200/80" : "border-warm-line/50",
                changed && "border-warm-primary/45 bg-warm-primary-soft/35"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-warm-ink">
                    {group.title}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {changed && <AgentPlanTinyBadge tone="priority">已调整</AgentPlanTinyBadge>}
                    <AgentPlanTinyBadge tone={getAgentGroupPriorityTone(group)}>
                      {getAgentGroupPriorityLabel(group)}
                    </AgentPlanTinyBadge>
                    <AgentPlanTinyBadge>{group.count} 张</AgentPlanTinyBadge>
                    {group.ratios.slice(0, 2).map((ratio) => (
                      <AgentPlanTinyBadge key={ratio}>{ratio}</AgentPlanTinyBadge>
                    ))}
                    {group.copyModes.slice(0, 2).map((mode) => (
                      <AgentPlanTinyBadge key={mode}>{getCopyModeLabel(mode)}</AgentPlanTinyBadge>
                    ))}
                    {group.status === "blocked" && <AgentPlanTinyBadge tone="warn">缺素材</AgentPlanTinyBadge>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onFocusGroup(group)}
                  className="shrink-0 rounded-md border border-warm-line/55 bg-warm-paper px-2 py-1 text-[10px] font-medium text-warm-muted transition hover:border-warm-primary/40 hover:text-warm-primary"
                >
                  改这组
                </button>
              </div>
              <div className="mt-1.5 space-y-0.5 text-[11px] leading-4 text-warm-muted">
                <div className="truncate">
                  强参考：{group.providerRoles.length ? group.providerRoles.map(getAgentPlanRoleLabel).join("、") : "无"}
                </div>
                <div className="truncate">
                  文字/约束：{group.promptOnlyRoles.length ? group.promptOnlyRoles.map(getAgentPlanRoleLabel).join("、") : "无"}
                </div>
                <div className="truncate">
                  文案：{formatAgentPlanCopyModes(group.copyModes)}
                </div>
                {group.assetTitles.length > 0 && (
                  <div className="truncate">素材：{group.assetTitles.slice(0, 3).join("、")}</div>
                )}
                {group.summary && <div className="line-clamp-2">用途：{group.summary}</div>}
                <div className="truncate">
                  状态：{group.status === "blocked" ? "缺关键素材，暂不建议执行" : "可执行，可继续微调"}
                </div>
                {group.reason && <div className="line-clamp-2">为什么：{group.reason}</div>}
                {group.missingHints && group.missingHints.length > 0 && (
                  <div className="line-clamp-2 text-amber-700">
                    缺口：{group.missingHints.slice(0, 2).join("；")}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {hiddenCount > 0 && (
          <div className="rounded-md bg-warm-bg px-2.5 py-2 text-[11px] text-warm-muted">
            还有 {hiddenCount} 组，应用后会按用途回到画布结果墙。
          </div>
        )}
      </div>
      <div className="mt-2 rounded-md bg-warm-bg px-2.5 py-2 text-[11px] leading-4 text-warm-muted">
        想改就直接说：这组少两张、不要封面、文案烧进详情页、加商场场景。
      </div>
    </div>
  );
}

function AgentPlanDiffCard({
  diff,
  actionLabel,
  actionDisabled = false,
  actionHelpText,
  onAction,
}: {
  diff: AgentPlanDiff;
  actionLabel?: string;
  actionDisabled?: boolean;
  actionHelpText?: string;
  onAction?: () => void;
}) {
  const sections = [
    { label: "新增", values: diff.additions },
    { label: "删除", values: diff.removals },
    { label: "数量", values: diff.countChanges },
    { label: "文案", values: diff.copyChanges },
    { label: "其他", values: diff.otherChanges },
  ].filter((section) => section.values.length > 0);

  return (
    <div className="rounded-lg border border-warm-primary/20 bg-warm-primary-soft/45 px-3 py-2 text-[11px] leading-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-warm-ink">本次计划变更</span>
        <span className="text-warm-muted">{diff.summary}</span>
      </div>
      {(diff.scopeSummary || diff.preservedSummary || diff.nextAction) && (
        <div className="mt-1.5 space-y-0.5 text-warm-muted">
          {diff.scopeSummary && <div>{diff.scopeSummary}</div>}
          {diff.preservedSummary && <div>{diff.preservedSummary}</div>}
          {diff.nextAction && <div>{diff.nextAction}</div>}
        </div>
      )}
      {sections.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {sections.map((section) => (
            <div key={section.label} className="flex gap-2">
              <span className="w-8 shrink-0 text-warm-muted">{section.label}</span>
              <span className="min-w-0 flex-1 text-warm-ink">{section.values.join("；")}</span>
            </div>
          ))}
        </div>
      )}
      {onAction && actionLabel && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-warm-primary/15 bg-warm-paper/75 px-2 py-1.5">
          <span className="min-w-0 text-warm-muted">
            {actionHelpText || "确认无误后执行这份计划。"}
          </span>
          <button
            type="button"
            disabled={actionDisabled}
            onClick={onAction}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-warm-primary px-2 text-[10px] font-medium text-warm-paper transition hover:bg-warm-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Save className="h-3 w-3" />
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  );
}

function isAgentPlanGroupAffectedByDiff(group: AgentPlanGroup, diff?: AgentPlanDiff | null): boolean {
  if (!diff) return false;
  const groupKeys = [group.id, group.title]
    .map(normalizeAgentPlanScopeKey)
    .filter(Boolean);
  if (groupKeys.length === 0) return false;

  const explicitKeys = (diff.affectedGroupTitles ?? [])
    .map(normalizeAgentPlanScopeKey)
    .filter(Boolean);
  if (explicitKeys.some((key) => groupKeys.some((groupKey) => groupKey === key || groupKey.includes(key) || key.includes(groupKey)))) {
    return true;
  }

  const changeText = normalizeAgentPlanScopeKey([
    diff.scopeSummary,
    diff.summary,
    ...getAgentPlanDiffChangeLines(diff),
  ].filter(Boolean).join(" "));
  return groupKeys.some((key) => key.length > 1 && changeText.includes(key));
}

function getAgentPlanDiffChangeLines(diff: AgentPlanDiff): string[] {
  return [
    ...diff.additions,
    ...diff.removals,
    ...diff.countChanges,
    ...diff.copyChanges,
    ...diff.otherChanges,
  ];
}

function AgentGapChecklist({ items }: { items: AgentGapHintItem[] }) {
  return (
    <div className="rounded-lg border border-amber-200/70 bg-amber-50/80 px-3 py-2 text-[11px] leading-4" data-testid="agent-gap-checklist">
      <div className="mb-1.5 flex items-center gap-1.5 font-medium text-amber-900">
        <AlertCircle className="h-3.5 w-3.5" />
        关键缺口
      </div>
      <div className="space-y-1">
        {items.slice(0, 4).map((item) => (
          <div key={item.label} className="flex gap-2">
            <span className={cn(
              "w-12 shrink-0",
              item.tone === "warn" ? "text-amber-800" : "text-warm-muted"
            )}>
              {item.label}
            </span>
            <span className="min-w-0 flex-1 text-amber-900">{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentQaSummary({ items }: { items: AgentQaSummaryItem[] }) {
  return (
    <div className="rounded-lg border border-warm-line/60 bg-warm-paper px-3 py-2 text-[11px] leading-4">
      <div className="mb-1.5 flex items-center gap-1.5 font-medium text-warm-ink">
        <ListChecks className="h-3.5 w-3.5 text-warm-primary" />
        Agent 质检建议
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.label} className="flex gap-2">
            <span
              className={cn(
                "w-14 shrink-0",
                item.tone === "warn"
                  ? "text-amber-700"
                  : item.tone === "success"
                    ? "text-emerald-700"
                    : "text-warm-muted"
              )}
            >
              {item.label}
            </span>
            <span className="min-w-0 flex-1 text-warm-muted">{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentReviewSuggestionCards({
  suggestions,
  executedActions,
  onAction,
}: {
  suggestions: AgentExecutableReviewSuggestion[];
  executedActions: Record<string, AgentReviewSuggestionExecutionState>;
  onAction: (suggestion: AgentExecutableReviewSuggestion, action: AgentReviewSuggestionAction) => void;
}) {
  return (
    <div className="space-y-1.5" data-testid="agent-review-suggestions">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-warm-ink">
        <Sparkles className="h-3.5 w-3.5 text-warm-primary" />
        可执行建议
      </div>
      {suggestions.slice(0, 4).map((suggestion) => {
        const execution = executedActions[suggestion.id];
        return (
          <div
            key={suggestion.id}
            className={cn(
              "rounded-lg border px-2.5 py-2 text-[11px] leading-4",
              suggestion.tone === "warn"
                ? "border-amber-200/80 bg-amber-50/80"
                : suggestion.tone === "success"
                  ? "border-emerald-200/80 bg-emerald-50/80"
                  : "border-warm-line/60 bg-warm-paper"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 font-medium text-warm-ink">{suggestion.title}</div>
              {execution && (
                <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] leading-none text-emerald-700">
                  已执行：{execution.label}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-warm-muted">{suggestion.body}</div>
            {execution && (
              <div className="mt-1.5 rounded-md bg-white/70 px-2 py-1 text-[10px] leading-4 text-emerald-700">
                {execution.text}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestion.actions.map((action) => {
                const ActionIcon = getAgentReviewSuggestionActionIcon(action);
                const executed = execution?.action === action;
                return (
                  <button
                    key={`${suggestion.id}-${action}`}
                    type="button"
                    className={cn(
                      "inline-flex h-7 items-center gap-1 rounded-md border bg-white/75 px-2 text-[10px] font-medium transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-55",
                      action === "approve"
                        ? "border-emerald-200 text-emerald-700 hover:border-emerald-300"
                        : action === "reject"
                          ? "border-zinc-200 text-zinc-600 hover:border-zinc-300"
                          : action === "mark_needs_redo" || action === "redo" || action === "group_redo"
                            ? "border-amber-200 text-amber-700 hover:border-amber-300"
                            : "border-warm-line/60 text-warm-ink hover:border-warm-primary/40 hover:text-warm-primary",
                      executed && "border-emerald-300 bg-emerald-50 text-emerald-700"
                    )}
                    disabled={executed}
                    title={executed ? "这个建议动作已执行" : getAgentReviewSuggestionActionLabel(action)}
                    onClick={() => onAction(suggestion, action)}
                  >
                    <ActionIcon className="h-3 w-3" />
                    {getAgentReviewSuggestionActionLabel(action)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getAgentReviewSuggestionActionLabel(action: AgentReviewSuggestionAction): string {
  if (action === "approve") return "保留";
  if (action === "mark_needs_redo") return "标记重做";
  if (action === "reject") return "淘汰";
  if (action === "open") return "看详情";
  if (action === "redo") return "执行重做";
  if (action === "edit") return "让 Agent 改";
  if (action === "copy") return "修改文案";
  if (action === "group_edit") return "调整这组";
  return "重做这组";
}

function getAgentReviewSuggestionActionIcon(action: AgentReviewSuggestionAction) {
  if (action === "approve") return PackageCheck;
  if (action === "reject") return Trash2;
  if (action === "open") return Search;
  if (action === "redo" || action === "group_redo" || action === "mark_needs_redo") return RefreshCw;
  if (action === "copy") return Copy;
  return Wand2;
}

function QuickProductionFlowPanel({
  productAsset,
  activeProductComponentTitle,
  workflowPlanPreview,
  focusedBatch,
  providerReadiness,
  composingWorkflow,
  composeBrief,
  onComposeBriefChange,
  onComposeWorkflow,
  onApplyWorkflowPlan,
}: {
  productAsset?: CanvasAsset;
  activeProductComponentTitle: string;
  workflowPlanPreview: WorkflowPlanPreview | null;
  focusedBatch?: ExportPackBatchSummary;
  providerReadiness: ProviderReadiness | null;
  composingWorkflow: boolean;
  composeBrief: string;
  onComposeBriefChange: (brief: string) => void;
  onComposeWorkflow: () => void;
  onApplyWorkflowPlan: () => void;
}) {
  const productLabel = activeProductComponentTitle || productAsset?.title || "示例商品";
  const planLabel = workflowPlanPreview
    ? `${workflowPlanPreview.estimatedCount} 张计划`
    : composeBrief.trim()
      ? "待生成计划"
      : "待选择场景";
  const batchLabel = focusedBatch ? `${focusedBatch.completed}/${focusedBatch.total} 完成` : "待生成批次";
  const providerLabel = getProviderReadyLabel(providerReadiness);
  const canCompose = !!composeBrief.trim() && !composingWorkflow;

  return (
    <div className="mt-4 rounded-lg border border-warm-line/50 bg-warm-bg p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SquareStack className="h-4 w-4 text-warm-primary" />
          <h4 className="text-sm font-medium text-warm-ink">生产主线</h4>
        </div>
        <span className={cn("rounded px-1.5 py-0.5 text-[10px]", getProviderReadyClassName(providerReadiness))}>
          {providerLabel}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        <QuickFlowMetric label="商品" value={productLabel} active={!!productAsset || !!activeProductComponentTitle} />
        <QuickFlowMetric label="计划" value={planLabel} active={!!workflowPlanPreview} />
        <QuickFlowMetric label="批次" value={batchLabel} active={!!focusedBatch} />
        <QuickFlowMetric label="审核" value={focusedBatch?.statusLabel || "待验收"} active={!!focusedBatch?.completed} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {quickWorkflowPresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onComposeBriefChange(preset.brief)}
            className={cn(
              "rounded-md border px-2 py-1.5 text-left transition",
              composeBrief === preset.brief
                ? "border-warm-primary/50 bg-warm-primary-soft text-warm-primary"
                : "border-warm-line/60 bg-warm-paper text-warm-ink hover:border-warm-primary/35 hover:text-warm-primary"
            )}
          >
            <span className="block truncate text-[11px] font-medium">{preset.label}</span>
            <span className="mt-0.5 block text-[10px] text-warm-muted">{preset.count}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!canCompose}
          onClick={onComposeWorkflow}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-warm-primary px-3 py-2 text-xs font-medium text-warm-paper transition hover:bg-warm-primary/90 disabled:opacity-50"
        >
          {composingWorkflow ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          生成计划
        </button>
        <button
          type="button"
          disabled={!workflowPlanPreview}
          onClick={onApplyWorkflowPlan}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-warm-line/60 bg-warm-paper px-3 py-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          应用到画布
        </button>
      </div>
    </div>
  );
}

function QuickFlowMetric({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border px-2 py-1.5",
        active ? "border-warm-primary/25 bg-warm-paper" : "border-warm-line/50 bg-warm-soft/40"
      )}
    >
      <span className="block text-[10px] text-warm-muted">{label}</span>
      <span className="mt-0.5 block truncate text-[11px] font-medium text-warm-ink">{value}</span>
    </div>
  );
}

function AgentPlanTinyBadge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "warn" | "priority";
}) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] leading-none",
        tone === "warn"
          ? "bg-red-50 text-red-700"
          : tone === "priority"
            ? "bg-warm-primary-soft text-warm-primary"
            : "bg-warm-bg text-warm-muted"
      )}
    >
      {children}
    </span>
  );
}

function getAgentPlanRoleLabel(role: string): string {
  if (role === "product") return "商品";
  if (role === "model") return "模特";
  if (role === "scene") return "场景";
  if (role === "style") return "风格";
  if (role === "copy") return "文案";
  return role || "未知";
}

function getCopyModeLabel(mode?: string): string {
  if (mode === "burn_in") return "烧字";
  if (mode === "metadata_only") return "不进图";
  return "图层";
}

function getAgentGroupPriorityLabel(group: AgentPlanGroup): string {
  if (group.status === "blocked") return "先补素材";
  const text = `${group.title} ${group.summary ?? ""}`.toLowerCase();
  if (/主图|main|hero/.test(text)) return "先做";
  if (/海报|卖点|封面|收尾|poster|feature|cover/.test(text)) return "转化";
  if (/详情|细节|材质|特写|工艺|场景|生活|使用|室内|户外|商场|咖啡|scene|lifestyle|detail|macro|material/.test(text)) return "验证";
  return "后续";
}

function getAgentGroupPriorityTone(group: AgentPlanGroup): "warn" | "priority" | undefined {
  const label = getAgentGroupPriorityLabel(group);
  if (label === "先补素材") return "warn";
  if (label === "先做") return "priority";
  return undefined;
}

function formatAgentPlanCopyModes(modes: string[]): string {
  const labels = agentUniqueStrings(modes.map(getCopyModeLabel));
  return labels.length > 0 ? labels.join("、") : "图层";
}

function buildAgentMatrixFromPreviewItems(
  items: WorkflowPlanPreviewItem[]
): WorkflowPlanPreviewAgentMatrixItem[] {
  return items.map((item, index) => ({
    id: `preview_matrix_${item.id || index + 1}`,
    itemId: item.id || `plan_item_${index + 1}`,
    title: item.title || `图 ${index + 1}`,
    type: item.slot || item.id || `image_${index + 1}`,
    outputSlotId: getPreviewItemBaseSlotId(item.slot),
    ratio: item.ratio,
    size: item.size,
    referenceRoles: inferPreviewItemReferenceRoles(item),
    providerReferenceRoles: [],
    assetGroupIds: [],
    copyMode: item.copyMode || "layout_layer",
    missingInputIds: [],
    status: "ready",
    summary: item.purpose,
  }));
}

function getPreviewItemBaseSlotId(slot: string): string {
  return (slot || "image").replace(/[-_]\d+$/, "");
}

function inferPreviewItemReferenceRoles(item: WorkflowPlanPreviewItem): string[] {
  const text = `${item.title} ${item.slot} ${item.purpose}`.toLowerCase();
  const roles = new Set<string>();
  roles.add("product");
  roles.add("style");
  if (/model|模特|真人|人物|上身|穿搭/.test(text)) roles.add("model");
  if (/scene|lifestyle|场景|生活|使用环境|桌面|室内|户外|商场|海报|poster|closing/.test(text)) roles.add("scene");
  if (item.copyMode === "burn_in" || /copy|text|文案|文字|海报|poster|closing|卖点|feature/.test(text)) roles.add("copy");
  return Array.from(roles);
}

function buildAgentPlanGroups({
  matrixItems,
  outputSlots,
  assetGroupsById,
  missingInputById,
}: {
  matrixItems: WorkflowPlanPreviewAgentMatrixItem[];
  outputSlots: Array<{
    id: string;
    label: string;
    purpose: string;
    ratio: string;
    samplePhase: boolean;
  }>;
  assetGroupsById: Map<string, WorkflowPlanPreviewAgentAssetGroup>;
  missingInputById: Map<string, WorkflowPlanPreviewAgentMissingInput>;
}): AgentPlanGroup[] {
  const outputSlotById = new Map(outputSlots.map((slot) => [slot.id, slot]));
  const byId = new Map<string, AgentPlanGroup>();

  for (const item of matrixItems) {
    const baseSlotId = getAgentPlanGroupSlotId(item);
    const slot = outputSlotById.get(baseSlotId) || (item.outputSlotId ? outputSlotById.get(item.outputSlotId) : undefined);
    const id = slot?.id || baseSlotId || item.type || item.title;
    const existing = byId.get(id);
    const providerRoles = item.providerReferenceRoles;
    const promptOnlyRoles = item.referenceRoles.filter((role) => !providerRoles.includes(role));
    const assetTitles = item.assetGroupIds
      .map((assetGroupId) => assetGroupsById.get(assetGroupId)?.title)
      .filter((title): title is string => Boolean(title));
    const missingHints = (item.missingInputIds ?? [])
      .map((id) => missingInputById.get(id))
      .filter((input): input is WorkflowPlanPreviewAgentMissingInput => Boolean(input))
      .map((input) => `${input.label}：${getAgentMissingInputAction(input.role)}`);
    const displayTitle = getAgentPlanGroupDisplayTitle(slot?.label || item.title, id);
    const next: AgentPlanGroup = existing ?? {
      id,
      title: displayTitle,
      count: 0,
      ratios: [],
      copyModes: [],
      providerRoles: [],
      promptOnlyRoles: [],
      assetTitles: [],
      status: "ready",
      summary: getAgentPlanGroupSummary(slot?.purpose, item.summary),
      reason: "",
      missingHints: [],
    };

    next.count += 1;
    next.ratios = agentUniqueStrings([...next.ratios, item.ratio || slot?.ratio || "auto"]);
    next.copyModes = agentUniqueStrings([...next.copyModes, item.copyMode || "layout_layer"]);
    next.providerRoles = agentUniqueStrings([...next.providerRoles, ...providerRoles]);
    next.promptOnlyRoles = agentUniqueStrings([...next.promptOnlyRoles, ...promptOnlyRoles]);
    next.assetTitles = agentUniqueStrings([...next.assetTitles, ...assetTitles]);
    next.missingHints = agentUniqueStrings([...(next.missingHints ?? []), ...missingHints]);
    if (item.status === "blocked") next.status = "blocked";
    next.summary = getAgentPlanGroupSummary(next.summary, item.summary);
    next.reason = buildAgentGroupReason(next);
    byId.set(id, next);
  }

  if (byId.size > 0) return Array.from(byId.values()).map((group) => ({
    ...group,
    reason: group.reason || buildAgentGroupReason(group),
  }));

  return outputSlots.map((slot) => ({
    id: slot.id,
    title: getAgentPlanGroupDisplayTitle(slot.label, slot.id),
    count: 1,
    ratios: [slot.ratio || "auto"],
    copyModes: ["layout_layer"],
    providerRoles: [],
    promptOnlyRoles: [],
    assetTitles: [],
    status: "ready",
    summary: slot.purpose,
    reason: buildAgentGroupReason({
      id: slot.id,
      title: slot.label,
      count: 1,
      ratios: [slot.ratio || "auto"],
      copyModes: ["layout_layer"],
      providerRoles: [],
      promptOnlyRoles: [],
      assetTitles: [],
      status: "ready",
      summary: slot.purpose,
      missingHints: [],
    }),
    missingHints: [],
  }));
}

function getAgentPlanGroupSlotId(item: WorkflowPlanPreviewAgentMatrixItem): string {
  if (item.outputSlotId && /^scene_\d+$/i.test(item.outputSlotId)) return item.outputSlotId;
  return getPreviewItemBaseSlotId(item.outputSlotId || item.type || item.title);
}

function getAgentPlanGroupDisplayTitle(rawTitle: string | undefined, slotId: string | undefined): string {
  const title = rawTitle?.trim() || "图组";
  const slotKey = (slotId || "").trim().toLowerCase();
  if (/^scene_\d+/.test(slotKey) && /场景(?:海报)?\s+\d+$/.test(title)) {
    return title.replace(/\s+\d+$/, "");
  }
  if (/[\u4e00-\u9fff]/.test(title)) return title;
  const normalizedSlot = (slotId || title)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+\d+$/, "");
  const normalizedTitle = title
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+\d+$/, "");
  const numberMatch = title.match(/(?:^|[\s_-])(\d+)$/) || slotId?.match(/(?:^|[\s_-])(\d+)$/);
  const suffix = numberMatch?.[1] ? ` ${numberMatch[1]}` : "";
  const key = normalizedSlot || normalizedTitle;
  const titleKey = normalizedTitle || key;
  const labels: Record<string, string> = {
    main: "主图",
    hero: "主视觉",
    white_main: "白底主图",
    feature: "卖点图",
    infographic: "信息图",
    dimensions: "尺寸图",
    material: "材质细节",
    detail: "商品细节",
    macro: "特写细节",
    front: "正面图",
    side: "侧面图",
    back: "背面图",
    rear: "背面图",
    overview: "整体图",
    closeup: "局部特写",
    scene: "场景图",
    lifestyle: "生活方式图",
    model: "模特展示",
    poster: "海报图",
    cover: "封面图",
    closing: "收尾图",
  };
  return labels[key] ? `${labels[key]}${suffix}` : labels[titleKey] ? `${labels[titleKey]}${suffix}` : title;
}

function getAgentPlanGroupSummary(current: string | undefined, itemSummary: string | undefined): string | undefined {
  const summary = itemSummary?.trim();
  if (summary) return summary;
  return current?.trim() || undefined;
}

function buildAgentGroupReason(group: AgentPlanGroup): string {
  const text = `${group.title} ${group.summary ?? ""}`.toLowerCase();
  const titleText = group.title.toLowerCase();
  if (/主图|main|hero/.test(text)) return "先交代商品正面价值，保证平台首图能快速识别。";
  if (/海报|卖点|封面|收尾|poster|feature|cover/.test(text)) {
    return group.copyModes.includes("burn_in")
      ? "承担转化信息，短文案会直接进图，需要留安全区。"
      : "承担营销主视觉，文案默认作为后期图层更方便修改。";
  }
  if (/详情|细节|材质|特写|工艺|detail|macro|material/.test(text)) return "补足材质、结构和做工证据，降低用户下单疑虑。";
  if (/场景|生活|使用|室内|户外|商场|咖啡|scene|lifestyle/.test(titleText)) return "把商品放进具体环境，验证空间、光影和使用氛围。";
  if (/模特|真人|人物|上身|穿搭|model/.test(text)) return "展示尺度、上身状态和情绪，让商品进入真实使用关系。";
  if (/场景|生活|使用|室内|户外|商场|咖啡|scene|lifestyle/.test(text)) return "把商品放进具体环境，验证空间、光影和使用氛围。";
  if (group.copyModes.includes("burn_in")) return "这组需要直接承载画面文字，重点检查字的位置和可读性。";
  return "补齐这组能让整套图更完整，方便后续挑图和单张重做。";
}

function buildAgentPlanExplanation({
  workflowPlanPreview,
  planGroups,
  matrixItems,
}: {
  workflowPlanPreview: WorkflowPlanPreview | null;
  planGroups: AgentPlanGroup[];
  matrixItems: WorkflowPlanPreviewAgentMatrixItem[];
}): string {
  if (!workflowPlanPreview) return "";
  const sourceTypeLabel =
    workflowPlanPreview.agentPlan?.shortLabel ||
    getCompositionModeLabel(workflowPlanPreview.agentPlan?.compositionMode || "") ||
    workflowPlanPreview.title;
  const projectTypeLabel = inferAgentProjectTypeLabel({
    workflowPlanPreview,
    planGroups,
    matrixItems,
    fallbackLabel: sourceTypeLabel,
  });
  const purposeSummary = buildAgentPlanPurposeSummary(planGroups);
  const coverageSummary = buildAgentPlanCoverageSummary(planGroups);
  const referenceSummary = buildAgentReferenceStrategySummary(matrixItems);
  const copySummary = buildAgentCopyStrategySummary(matrixItems);
  return [
    `项目类型：${projectTypeLabel}${projectTypeLabel !== sourceTypeLabel ? `（${sourceTypeLabel}）` : ""}，预计 ${workflowPlanPreview.estimatedCount} 张。`,
    coverageSummary ? `制作理由：先覆盖${coverageSummary}，避免只靠单张图硬撑整套交付。` : "",
    purposeSummary ? `图组目的：${purposeSummary}` : "",
    referenceSummary ? `参考策略：${referenceSummary}` : "",
    `文案策略：${copySummary}`,
  ].filter(Boolean).join("\n");
}

function inferAgentProjectTypeLabel({
  workflowPlanPreview,
  planGroups,
  matrixItems,
  fallbackLabel,
}: {
  workflowPlanPreview: WorkflowPlanPreview;
  planGroups: AgentPlanGroup[];
  matrixItems: WorkflowPlanPreviewAgentMatrixItem[];
  fallbackLabel: string;
}): string {
  const text = [
    workflowPlanPreview.title,
    workflowPlanPreview.summary,
    workflowPlanPreview.agentPlan?.title,
    workflowPlanPreview.agentPlan?.shortLabel,
    workflowPlanPreview.agentPlan?.compositionMode,
    ...planGroups.flatMap((group) => [group.title, group.summary ?? ""]),
  ].join(" ").toLowerCase();
  const hasRole = (role: string) => matrixItems.some((item) => item.referenceRoles.includes(role));
  const hasGroup = (pattern: RegExp) => planGroups.some((group) => pattern.test(`${group.title} ${group.summary ?? ""}`));
  const hasProduct = hasRole("product") || hasGroup(/商品|产品|主图|详情|海报|product|main|detail|poster/i);
  const hasModel = hasRole("model") || hasGroup(/模特|真人|人物|上身|穿搭|model/i);
  const hasScene = hasRole("scene") || hasGroup(/场景|生活|室内|户外|街拍|商场|咖啡|scene|lifestyle/i);
  const hasCopy = hasRole("copy") || matrixItems.some((item) => item.copyMode === "burn_in") || /文案|卖点|标题|烧字|copy/.test(text);

  if (/淘宝|taobao|详情页/.test(text)) return "淘宝详情页项目";
  if (/amazon|亚马逊/.test(text)) return "Amazon 主图项目";
  if (/小红书|xiaohongshu|rednote|封面/.test(text)) return "小红书内容项目";
  if (hasProduct && hasModel && hasCopy) return "商品 + 模特 + 文案项目";
  if (hasProduct && hasModel) return "商品模特展示项目";
  if (hasProduct && hasScene) return "商品场景项目";
  if (hasProduct && hasCopy) return "商品海报项目";
  if (hasModel && hasScene) return "模特场景项目";
  return fallbackLabel || "商业图片项目";
}

function buildAgentPlanCoverageSummary(planGroups: AgentPlanGroup[]): string {
  const purposes = agentUniqueStrings(
    planGroups.map((group) => getAgentPlanGroupBusinessPurpose(group))
  ).slice(0, 3);
  return purposes.join("、");
}

function buildAgentPlanPurposeSummary(planGroups: AgentPlanGroup[]): string {
  return planGroups
    .slice(0, 4)
    .map((group) => `${group.title}解决${getAgentPlanGroupBusinessPurpose(group)}`)
    .join("；");
}

function getAgentPlanGroupBusinessPurpose(group: AgentPlanGroup): string {
  const text = `${group.title} ${group.summary ?? ""}`.toLowerCase();
  const titleText = group.title.toLowerCase();
  if (/主图|main|hero/.test(text)) return "第一眼识别和点击";
  if (/海报|卖点|封面|收尾|poster|feature|cover/.test(text)) return "转化信息和活动表达";
  if (/详情|细节|材质|特写|工艺|detail|macro|material/.test(text)) return "材质、结构和信任证据";
  if (/场景|生活|使用|室内|户外|商场|咖啡|scene|lifestyle/.test(titleText)) return "使用氛围、空间和光影";
  if (/模特|真人|人物|上身|穿搭|model/.test(text)) return "上身比例、姿态和情绪";
  if (/场景|生活|使用|室内|户外|商场|咖啡|scene|lifestyle/.test(text)) return "使用氛围、空间和光影";
  return "补齐整套项目的可挑选项";
}

function buildAgentReferenceStrategySummary(matrixItems: WorkflowPlanPreviewAgentMatrixItem[]): string {
  const activeRoles = agentUniqueStrings(matrixItems.flatMap((item) => item.referenceRoles));
  if (activeRoles.length === 0) return "先按文字需求生成，后续可补素材提高稳定性。";
  const providerRoles = new Set(matrixItems.flatMap((item) => item.providerReferenceRoles));
  const parts: string[] = [];
  if (activeRoles.includes("product")) {
    parts.push(providerRoles.has("product") ? "商品用强参考锁身份" : "缺商品强参考时只能做概念样张");
  }
  if (activeRoles.includes("model")) {
    parts.push(providerRoles.has("model") ? "模特用参考保同一人" : "模特先按文字设定");
  }
  if (activeRoles.includes("scene")) {
    parts.push(providerRoles.has("scene") ? "场景参考负责空间光影" : "场景先按 prompt 发散");
  }
  if (activeRoles.includes("style")) parts.push("风格只约束完成度");
  return parts.length ? parts.join("；") : `${activeRoles.map(getAgentPlanRoleLabel).join("、")}参与规划。`;
}

function buildAgentCopyStrategySummary(matrixItems: WorkflowPlanPreviewAgentMatrixItem[]): string {
  const burnInCount = matrixItems.filter((item) => item.copyMode === "burn_in").length;
  const copyRoleCount = matrixItems.filter((item) => item.referenceRoles.includes("copy")).length;
  if (burnInCount > 0) {
    return `${burnInCount} 张会把短文案烧进图，必须检查安全区，不能写到商品包装标签上。`;
  }
  if (copyRoleCount > 0) {
    return "文案作为图层/导出文案保留，后期改字更稳；需要成片带字时可直接说烧进图。";
  }
  return "当前没有强文案需求；需要海报或详情页带字时再补短标题和卖点。";
}

function buildAgentProductionOrderHint({
  workflowPlanPreview,
  planGroups,
}: {
  workflowPlanPreview: WorkflowPlanPreview | null;
  planGroups: AgentPlanGroup[];
}): string {
  if (!workflowPlanPreview || planGroups.length === 0) return "";
  const blockedGroups = planGroups.filter((group) => group.status === "blocked");
  if (blockedGroups.length > 0) {
    return `先补 ${blockedGroups.slice(0, 2).map((group) => group.title).join("、")} 的关键素材；补完再生成，能少走很多无效重做。`;
  }

  const seenBaseTitles = new Set<string>();
  const sortedGroups = [...planGroups]
    .sort((a, b) => {
      const priorityDelta = getAgentProductionOrderRank(a) - getAgentProductionOrderRank(b);
      return priorityDelta !== 0 ? priorityDelta : b.count - a.count;
    })
    .filter((group) => {
      const baseTitle = getAgentProductionOrderBaseTitle(group.title);
      if (seenBaseTitles.has(baseTitle)) return false;
      seenBaseTitles.add(baseTitle);
      return true;
    });
  const first = sortedGroups[0]?.title;
  const second = sortedGroups.slice(1, 3).map((group) => group.title);
  const last = sortedGroups.find((group) => getAgentProductionOrderRank(group) >= 3)?.title;
  if (!first) return "";

  return [
    `建议先确认${first}，它决定整套方向。`,
    second.length ? `再看${second.join("、")}。` : "",
    last && last !== first && !second.includes(last) ? `最后挑${last}，不满意再局部重做。` : "最后按问题单张或单组重做。"
  ].filter(Boolean).join("");
}

function getAgentProductionOrderRank(group: AgentPlanGroup): number {
  const priority = getAgentGroupPriorityLabel(group);
  if (priority === "先补素材") return 0;
  if (priority === "先做") return 1;
  if (priority === "验证") return 2;
  if (priority === "转化") return 3;
  return 4;
}

function getAgentProductionOrderBaseTitle(title: string): string {
  return title.replace(/\s+\d+$/, "").trim() || title;
}

function buildAgentFollowUpHint({
  workflowPlanPreview,
  userBrief,
  missingInputHints,
  hasProductReference,
  matrixItems,
  planGroups,
}: {
  workflowPlanPreview: WorkflowPlanPreview | null;
  userBrief: string;
  missingInputHints: string[];
  hasProductReference: boolean;
  matrixItems: WorkflowPlanPreviewAgentMatrixItem[];
  planGroups: AgentPlanGroup[];
}): string {
  if (!workflowPlanPreview) return "";
  const userBriefText = userBrief.toLowerCase();
  const userAskedForScene = /(多场景|场景|花店|咖啡|商场|室内|户外|街拍|雪山|家居|办公室|商圈|门店)/.test(userBriefText);
  const hasSceneProvider = matrixItems.some((item) => item.providerReferenceRoles.includes("scene"));
  const sceneWeakHint = userAskedForScene && !hasSceneProvider
    ? "多场景可以先按 prompt 生成，但同场地空间一致性会弱；后续可补场景参考。"
    : "";
  const productNeeded = matrixItems.some((item) => item.referenceRoles.includes("product"));
  if (productNeeded && !hasProductReference) {
    return sceneWeakHint
      ? `下一步先补真实商品图，这样商品形状、Logo、材质不会漂。${sceneWeakHint}`
      : "下一步先补真实商品图，这样商品形状、Logo、材质不会漂。";
  }
  if (missingInputHints.length > 0) return `下一步先补：${missingInputHints[0]}`;
  const hasModelGroup = planGroups.some((group) =>
    group.providerRoles.includes("model") ||
    group.promptOnlyRoles.includes("model") ||
    /模特|真人|人物|上身/.test(group.title)
  );
  const hasModelProvider = matrixItems.some((item) => item.providerReferenceRoles.includes("model"));
  if (hasModelGroup && !hasModelProvider) {
    return "如果要同一个人稳定出镜，建议先上传或生成模特资产；不补也能先做概念样张。";
  }
  const hasSceneGroup = planGroups.some((group) =>
    group.providerRoles.includes("scene") ||
    group.promptOnlyRoles.includes("scene") ||
    /场景|室内|户外|商场|咖啡/.test(group.title)
  );
  if (hasSceneGroup && !hasSceneProvider) {
    return "场景可以先按文字生成；如果要同场地多角度稳定，后面再补场景参考。";
  }
  if (sceneWeakHint) return sceneWeakHint;
  const burnInCount = matrixItems.filter((item) => item.copyMode === "burn_in").length;
  if (burnInCount > 0) return "生成前最好确认短标题和卖点，避免文字写到商品包装或脸上。";
  return "计划可以先应用到画布；不满意时直接说“这组少两张”或“加一组商场场景”。";
}

function buildAgentClarificationHint({
  workflowPlanPreview,
  userBrief,
  hasProductReference,
  matrixItems,
  planGroups,
  criticalGapItems,
}: {
  workflowPlanPreview: WorkflowPlanPreview | null;
  userBrief: string;
  hasProductReference: boolean;
  matrixItems: WorkflowPlanPreviewAgentMatrixItem[];
  planGroups: AgentPlanGroup[];
  criticalGapItems: AgentGapHintItem[];
}): string {
  if (!workflowPlanPreview) return "";
  const text = userBrief.toLowerCase();
  const productNeeded = matrixItems.some((item) => item.referenceRoles.includes("product"));
  if (productNeeded && !hasProductReference) {
    return "先问一句：这是要锁真实商品吗？如果是，先补商品图；如果只是概念 mockup，我会按概念样张继续。";
  }

  const modelNeeded = planGroups.some((group) =>
    group.providerRoles.includes("model") ||
    group.promptOnlyRoles.includes("model") ||
    /模特|真人|人物|上身|穿搭/.test(`${group.title} ${group.summary ?? ""}`)
  );
  const hasModelProvider = matrixItems.some((item) => item.providerReferenceRoles.includes("model"));
  if (modelNeeded && !hasModelProvider) {
    return "模特资产不影响先规划；我默认先按年轻商业模特概念做，等你上传/生成模特后再锁同一人。";
  }

  const sceneNeeded =
    /(多场景|场景|商场|室内|户外|街拍|雪山|家居|咖啡|门店|办公室)/.test(text) ||
    planGroups.some((group) => /场景|室内|户外|商场|咖啡|街拍|雪山|家居|门店|办公室/.test(group.title));
  const hasSceneProvider = matrixItems.some((item) => item.providerReferenceRoles.includes("scene"));
  if (sceneNeeded && !hasSceneProvider) {
    return "场景我先按文字发散；如果你要同一个场地多角度稳定，再补一张场景参考。";
  }

  const burnInCount = matrixItems.filter((item) => item.copyMode === "burn_in").length;
  const hasCopyProviderOrPrompt = matrixItems.some((item) => item.referenceRoles.includes("copy"));
  if (burnInCount > 0 && !hasCopyProviderOrPrompt) {
    return "烧字图我默认只写短标题和一个核心卖点，放画面安全区，不改商品包装标签。";
  }

  if (criticalGapItems.length > 0) {
    return "我只追问会明显影响结果的缺口；其他风格和细节先按当前项目默认值推进。";
  }

  return "";
}

function buildAgentCriticalGapItems({
  workflowPlanPreview,
  userBrief,
  missingInputHints,
  hasProductReference,
  matrixItems,
  planGroups,
}: {
  workflowPlanPreview: WorkflowPlanPreview | null;
  userBrief: string;
  missingInputHints: string[];
  hasProductReference: boolean;
  matrixItems: WorkflowPlanPreviewAgentMatrixItem[];
  planGroups: AgentPlanGroup[];
}): AgentGapHintItem[] {
  if (!workflowPlanPreview) return [];
  const text = userBrief.toLowerCase();
  const items: AgentGapHintItem[] = [];
  const productNeeded = matrixItems.some((item) => item.referenceRoles.includes("product"));
  if (productNeeded && !hasProductReference) {
    items.push({
      label: "商品",
      text: "缺商品参考图，无法锁商品身份；可以先规划，但真实项目执行前要补图。",
      tone: "warn",
    });
  }

  const hasModelGroup = planGroups.some((group) =>
    group.providerRoles.includes("model") ||
    group.promptOnlyRoles.includes("model") ||
    /模特|真人|人物|上身|穿搭|model/.test(`${group.title} ${group.summary ?? ""}`.toLowerCase())
  );
  const hasModelProvider = matrixItems.some((item) => item.providerReferenceRoles.includes("model"));
  if (hasModelGroup && !hasModelProvider) {
    items.push({
      label: "模特",
      text: "模特展示缺模特资产；可先生成/上传模特，否则只适合概念样张。",
      tone: "warn",
    });
  }

  const wantsScene = /(多场景|场景|商场|室内|户外|街拍|雪山|家居|咖啡|门店|办公室)/.test(text);
  const hasSceneGroup = planGroups.some((group) =>
    group.providerRoles.includes("scene") ||
    group.promptOnlyRoles.includes("scene") ||
    /场景|室内|户外|商场|咖啡|街拍|雪山|家居|门店|办公室/.test(`${group.title} ${group.summary ?? ""}`.toLowerCase())
  );
  const hasSceneProvider = matrixItems.some((item) => item.providerReferenceRoles.includes("scene"));
  if ((wantsScene || hasSceneGroup) && !hasSceneProvider) {
    items.push({
      label: "场景",
      text: "可继续用 prompt 生成场景；如果要同场地多角度稳定，建议补场景参考。",
    });
  }

  const wantsCopy =
    /(文案|卖点|参数|标题|海报|详情|烧字|进图|带字|出字)/.test(text) ||
    matrixItems.some((item) => item.referenceRoles.includes("copy") || item.copyMode === "burn_in");
  const hasCopyAsset = matrixItems.some((item) => item.referenceRoles.includes("copy"));
  const hasBurnIn = matrixItems.some((item) => item.copyMode === "burn_in");
  if (wantsCopy && !hasCopyAsset) {
    items.push({
      label: "文案",
      text: hasBurnIn
        ? "本轮要烧字，但缺明确卖点/标题；先用保守短文案，后续可单独改字。"
        : "需要商品卖点/参数/标题时，补一句文案资产或直接在需求里说。",
    });
  }

  for (const hint of missingInputHints) {
    if (items.length >= 4) break;
    const label = hint.includes("商品")
      ? "商品"
      : hint.includes("模特")
        ? "模特"
        : hint.includes("场景")
          ? "场景"
          : hint.includes("文案")
            ? "文案"
            : "素材";
    if (items.some((item) => item.label === label)) continue;
    items.push({ label, text: hint, tone: "warn" });
  }

  return items.slice(0, 4);
}

function buildAgentEditContextHint(editTarget: AgentImageEditTarget | null): string {
  if (!editTarget) return "";
  const metadata = editTarget.metadata ?? {};
  const providerImages = getOutputPreviewProviderReferenceImages(metadata);
  const promptOnlyImages = getOutputPreviewPromptOnlyReferenceImages(metadata);
  const providerRoles = agentUniqueStrings(providerImages.map((image) => getAgentPlanRoleLabel(image.role)));
  const promptOnlyRoles = agentUniqueStrings(promptOnlyImages.map((image) => getAgentPlanRoleLabel(image.role)));
  const ratio = getStringValue(metadata.ratio) || getStringValue(metadata.exportSpecRatio);
  const purposeText = getAgentRevisionPurposeText(metadata, editTarget.title);
  const contextParts = [
    `我会把「${editTarget.title}」作为上一版成片参考，只改这张，不改其它图组，也不重写整套计划。`,
    purposeText ? `图组用途沿用：${purposeText}。` : "",
    ratio ? `比例继续按 ${ratio}。` : "",
    providerRoles.length ? `强参考会带回：${providerRoles.join("、")}。` : "没有强参考图时，会优先保留原图主体和构图。",
    promptOnlyRoles.length ? `文字约束继续继承：${promptOnlyRoles.join("、")}。` : "",
    editTarget.prompt?.trim() ? "原 prompt 会作为必要约束继承，不从零重写。" : "",
    getOutputPreviewCopyRenderPolicy(metadata)?.mode === "burn_in"
      ? "原本烧进图的短文案会继续按安全区处理；要改字可以直接说。"
      : "",
  ];
  return contextParts.filter(Boolean).join("\n");
}

function buildAgentFocusedGroupHint(group: AgentPlanGroup | null): string {
  if (!group) return "";
  const roles = agentUniqueStrings([
    ...group.providerRoles.map(getAgentPlanRoleLabel),
    ...group.promptOnlyRoles.map(getAgentPlanRoleLabel),
  ]);
  return [
    `正在调整「${group.title}」，只影响这组 ${group.count} 张；其他图组保持不动，不重写全局计划。`,
    group.summary ? `这组用途继续按：${group.summary}。` : "",
    roles.length ? `参考角色继续按 ${roles.join("、")}。` : "没有强参考角色时，会优先沿用本组成片主体和构图。",
    "可以直接说换场景、改数量、文案烧进图或不要这组。",
  ].filter(Boolean).join("\n");
}

function isArtifactFocusedPlanGroup(group: AgentPlanGroup): boolean {
  return group.id.startsWith("artifact-group:");
}

function findUpdatedFocusedPlanGroup(
  groups: AgentPlanGroup[],
  focusedGroup: AgentPlanGroup
): AgentPlanGroup | null {
  const focusedId = normalizeAgentPlanScopeKey(focusedGroup.id);
  const focusedTitle = normalizeAgentPlanScopeKey(focusedGroup.title);
  return groups.find((group) =>
    normalizeAgentPlanScopeKey(group.id) === focusedId ||
    (!!focusedTitle && normalizeAgentPlanScopeKey(group.title) === focusedTitle)
  ) ?? null;
}

function getAgentFocusedGroupSignature(group: AgentPlanGroup): string {
  return [
    group.id,
    group.title,
    group.count,
    group.status,
    group.ratios.join(","),
    group.copyModes.join(","),
    group.providerRoles.join(","),
    group.promptOnlyRoles.join(","),
    group.artifactIds?.join(",") ?? "",
    group.jobIds?.join(",") ?? "",
    group.summary ?? "",
  ].join("~");
}

function buildAgentFocusedGroupScopeText(
  group: AgentPlanGroup | null,
  artifacts: PersistedGeneratedArtifact[]
): string {
  if (!group) return "";
  if (artifacts.length === 0) return `只影响这组，当前 ${group.count} 张`;

  const actionableCount = artifacts.filter((artifact) => {
    const status = getArtifactReviewStatus(artifact);
    return status !== "approved" && status !== "rejected";
  }).length;
  const protectedCount = artifacts.length - actionableCount;
  const parts = [
    `只影响这组，待处理 ${actionableCount}/${artifacts.length} 张`,
    protectedCount > 0 ? `已保留/已淘汰 ${protectedCount} 张不动` : "",
    `状态：${formatAgentArtifactReviewSummary(artifacts) || "待检查"}`,
  ].filter(Boolean);
  return parts.join("；");
}

function buildAgentResultGroupRevisionDiff(
  group: AgentPlanGroup,
  userBrief: string,
  targetCount: number,
  submittedCount: number,
  protectedCount = 0
): AgentPlanDiff {
  const otherChanges = [
    `只调整「${group.title}」`,
    `修改要求：${truncateRevisionText(userBrief, 120)}`,
    protectedCount > 0 ? `跳过已保留/已淘汰 ${protectedCount} 张` : "",
  ].filter(Boolean);
  const countChanges = targetCount > 0
    ? [`本组 ${targetCount} 张，已提交 ${submittedCount} 张`]
    : [`本组暂无可重做成片`];
  const copyChanges = group.copyModes.includes("burn_in")
    ? ["继承原本烧字策略，继续检查文案安全区"]
    : [];
  return {
    summary: `只影响「${group.title}」这一组，其他图组保持不动。`,
    scopeSummary: `修改范围：只重做「${group.title}」这一组的待处理图片。`,
    preservedSummary: protectedCount > 0
      ? `已保留/已淘汰的 ${protectedCount} 张和未点名图组都保持不变。`
      : "未点名的图组、比例和参考图角色保持不变。",
    nextAction: targetCount > 0
      ? "下一步先看本组重做结果，再决定是否继续扩大修改范围。"
      : "下一步可以换一个有成片的图组继续改。",
    affectedGroupTitles: [group.title],
    additions: [],
    removals: [],
    countChanges,
    copyChanges,
    otherChanges,
  };
}

function resolveAgentResultGroupArtifacts(
  group: AgentPlanGroup,
  artifactPool: PersistedGeneratedArtifact[]
): PersistedGeneratedArtifact[] {
  const artifactIds = new Set(group.artifactIds ?? []);
  const jobIds = new Set(group.jobIds ?? []);
  if (artifactIds.size === 0 && jobIds.size === 0) return [];
  return artifactPool.filter((artifact) =>
    artifactIds.has(artifact.id) || (artifact.jobId ? jobIds.has(artifact.jobId) : false)
  );
}

function buildAgentWorkflowPlanAppliedMessage(
  preview: WorkflowPlanPreview | null,
  hasProductReference: boolean
): string {
  const count = preview?.estimatedCount || preview?.items.length || 0;
  const groupSummary = formatAgentWorkflowPlanGroupSummary(preview);
  return [
    hasProductReference
      ? "计划已应用到画布，并接入当前商品图。"
      : "计划已应用到画布；下一步先导入商品图。",
    count > 0 ? `本轮会做 ${count} 张${groupSummary ? `：${groupSummary}` : ""}。` : "",
    hasProductReference
      ? "下一步可以生成样张；结果会自动回填到画布结果墙。"
      : "补齐商品图后，再让 Agent 生成样张。",
  ].filter(Boolean).join("\n");
}

function buildAgentSampleRunFeedbackMessage(
  preview: WorkflowPlanPreview,
  createdCount: number,
  agentPlanText?: string
): string {
  const groupSummary = formatAgentWorkflowPlanGroupSummary(preview);
  return [
    `已创建 ${createdCount} 张样张任务，正在排队生成。`,
    groupSummary ? `覆盖图组：${groupSummary}。` : "",
    agentPlanText ? `规划摘要：${agentPlanText}` : "",
    "生成结果会自动回填到画布结果墙，完成后可以按单张或分组继续修改。",
  ].filter(Boolean).join("\n");
}

function formatAgentWorkflowPlanGroupSummary(preview: WorkflowPlanPreview | null): string {
  if (!preview) return "";
  const sourceTitles = preview.agentPlan?.generationMatrix?.length
    ? preview.agentPlan.generationMatrix.map((item) =>
        getAgentPlanGroupDisplayTitle(item.title, item.outputSlotId || item.type)
      )
    : preview.items.map((item) => getAgentPlanGroupDisplayTitle(item.title, item.slot));
  const titles = agentUniqueStrings(sourceTitles).slice(0, 4);
  if (titles.length === 0) return "";
  const hiddenCount = Math.max(0, sourceTitles.length - titles.length);
  return `${titles.join("、")}${hiddenCount > 0 ? `等 ${sourceTitles.length} 组` : ""}`;
}

function buildAgentImageRevisionMessage(target: AgentImageEditTarget, userBrief: string): string {
  const metadata = target.metadata ?? {};
  const providerRoles = agentUniqueStrings(
    getOutputPreviewProviderReferenceImages(metadata).map((image) => getAgentPlanRoleLabel(image.role))
  );
  const promptOnlyRoles = agentUniqueStrings(
    getOutputPreviewPromptOnlyReferenceImages(metadata).map((image) => getAgentPlanRoleLabel(image.role))
  );
  const ratio = getStringValue(metadata.ratio) || getStringValue(metadata.exportSpecRatio);
  const purposeText = getAgentRevisionPurposeText(metadata, target.title);
  return [
    `已提交「${target.title}」单图修改，只影响这张，不重写整套计划。`,
    purposeText ? `图组用途沿用：${purposeText}。` : "",
    ratio ? `比例沿用 ${ratio}。` : "",
    providerRoles.length ? `强参考继续带回：${providerRoles.join("、")}。` : "保留上一版成片主体、构图和商业质感。",
    promptOnlyRoles.length ? `文字约束继续继承：${promptOnlyRoles.join("、")}。` : "",
    target.prompt?.trim() ? "原 prompt 已作为必要约束带回。" : "",
    getOutputPreviewCopyRenderPolicy(metadata)?.mode === "burn_in"
      ? "原烧字策略继续保留，文案只放安全区。"
      : "",
    `修改要求：${formatRevisionTextForSentence(userBrief, 120)}。`,
  ].filter(Boolean).join("\n");
}

function buildAgentResultGroupRevisionMessage(
  group: AgentPlanGroup,
  userBrief: string,
  targetCount: number,
  submittedCount: number,
  failedCount: number,
  protectedCount = 0
): string {
  const roles = agentUniqueStrings([
    ...group.providerRoles.map(getAgentPlanRoleLabel),
    ...group.promptOnlyRoles.map(getAgentPlanRoleLabel),
  ]);
  const roleText = roles.length ? `保留参考角色：${roles.join("、")}。` : "保留上一版成片主体和构图。";
  const ratioText = group.ratios.length ? `比例沿用 ${group.ratios.slice(0, 3).join(" / ")}。` : "";
  const purposeText = group.summary ? `图组用途继续按：${group.summary}。` : "";
  const protectedText = protectedCount > 0 ? `已保留/已淘汰的 ${protectedCount} 张不会被修改。` : "";
  const failText = failedCount > 0 ? `有 ${failedCount} 张创建失败，稍后可单张重试。` : "";
  return [
    targetCount > 0
      ? `已只针对「${group.title}」提交 ${submittedCount}/${targetCount} 张修改，其他图组保持不动。`
      : `「${group.title}」暂无可重做成片，其他图组保持不动。`,
    purposeText,
    roleText,
    ratioText,
    protectedText,
    group.copyModes.includes("burn_in") ? "文案继续按原烧字策略处理，注意安全区。" : "",
    `修改要求：${formatRevisionTextForSentence(userBrief, 120)}。`,
    failText,
  ].filter(Boolean).join("\n");
}

function formatAgentPlanDiffForConversation(diff: AgentPlanDiff): string {
  const changes = [
    ...diff.additions,
    ...diff.removals,
    ...diff.countChanges,
    ...diff.copyChanges,
    ...diff.otherChanges,
  ].slice(0, 3);
  return [
    diff.summary,
    diff.scopeSummary,
    changes.length > 0 ? `这次改了：${changes.join("；")}。` : "",
    diff.preservedSummary,
    diff.nextAction,
  ].filter(Boolean).join("\n");
}

function buildAgentConversationMessages({
  historyMessages,
  composeBrief,
  lastUserBrief,
  agentUnderstanding,
  composeMessage,
  workflowPlanPreview,
  editTarget,
  composingWorkflow,
  generatingSample,
  planFallbackReason,
  planExplanation,
  productionOrderHint,
  followUpHint,
  clarificationHint,
  criticalGapItems,
  planDiff,
  editContextHint,
  focusedGroupHint,
  completionSummary,
}: {
  historyMessages?: AgentConversationMessage[];
  composeBrief: string;
  lastUserBrief: string;
  agentUnderstanding: string;
  composeMessage: string;
  workflowPlanPreview: WorkflowPlanPreview | null;
  editTarget: AgentImageEditTarget | null;
  composingWorkflow: boolean;
  generatingSample: boolean;
  planFallbackReason?: string;
  planExplanation?: string;
  productionOrderHint?: string;
  followUpHint?: string;
  clarificationHint?: string;
  criticalGapItems?: AgentGapHintItem[];
  planDiff?: AgentPlanDiff | null;
  editContextHint?: string;
  focusedGroupHint?: string;
  completionSummary?: string;
}): AgentConversationMessage[] {
  const messages: AgentConversationMessage[] = [...(historyMessages ?? [])];
  const brief = composeBrief.trim() || lastUserBrief.trim();

  if (brief) {
    messages.push({
      id: "user-brief",
      role: "user",
      title: editTarget ? "你要改这张图" : workflowPlanPreview ? "你要调整计划" : "你的需求",
      text: brief,
    });
  }

  messages.push({
    id: "agent-understanding",
    role: "agent",
    title: workflowPlanPreview ? "Agent 理解" : editTarget ? "Agent 修改目标" : "Agent 准备",
    text: workflowPlanPreview
      ? planFallbackReason
        ? `我先把需求整理成 ${workflowPlanPreview.estimatedCount} 张基础制作清单。${planFallbackReason}。你可以继续修改数量、图组、比例和文案策略。`
        : `我已把需求拆成 ${workflowPlanPreview.estimatedCount} 张制作清单。你可以继续说要删哪组、加哪组、文案要不要进图。`
      : agentUnderstanding,
  });

  if (planExplanation) {
    messages.push({
      id: "agent-plan-explanation",
      role: "agent",
      title: "为什么这样规划",
      text: planExplanation,
    });
  }

  if (productionOrderHint) {
    messages.push({
      id: "agent-production-order",
      role: "agent",
      title: "先做什么",
      text: productionOrderHint,
    });
  }

  if (followUpHint) {
    messages.push({
      id: "agent-next-step",
      role: "agent",
      title: "下一步",
      text: followUpHint,
      tone: followUpHint.includes("缺") || followUpHint.includes("补真实商品图") ? "warn" : "default",
    });
  }

  if (clarificationHint) {
    messages.push({
      id: "agent-clarification-default",
      role: "agent",
      title: "默认推进",
      text: clarificationHint,
      tone: clarificationHint.includes("先问一句") || clarificationHint.includes("真实商品") ? "warn" : "default",
    });
  }

  if (criticalGapItems?.length) {
    messages.push({
      id: "agent-critical-gaps",
      role: "agent",
      title: "关键缺口",
      text: criticalGapItems.slice(0, 3).map((item) => `${item.label}：${item.text}`).join("\n"),
      tone: criticalGapItems.some((item) => item.tone === "warn") ? "warn" : "default",
    });
  }

  if (focusedGroupHint) {
    messages.push({
      id: "agent-focused-group",
      role: "agent",
      title: "当前修改范围",
      text: focusedGroupHint,
      tone: "progress",
    });
  }

  if (editContextHint) {
    messages.push({
      id: "agent-edit-context",
      role: "agent",
      title: "单图修改上下文",
      text: editContextHint,
      tone: "progress",
    });
  }

  if (planDiff) {
    messages.push({
      id: "agent-plan-diff",
      role: "agent",
      title: "修改记录",
      text: formatAgentPlanDiffForConversation(planDiff),
      tone: "success",
    });
  }

  if (composingWorkflow || generatingSample) {
    messages.push({
      id: "agent-progress",
      role: "agent",
      title: "正在处理",
      text: generatingSample ? "我正在创建样张任务，结果会回到画布。" : "我正在理解需求并更新制作计划。",
      tone: "progress",
    });
  } else if (composeMessage) {
    messages.push({
      id: "agent-message",
      role: "system",
      title: "状态",
      text: composeMessage,
      tone: workflowPlanPreview ? "success" : "default",
    });
  }

  if (completionSummary) {
    messages.push({
      id: "agent-completion-summary",
      role: "agent",
      title: "生成总结",
      text: completionSummary,
      tone: "success",
    });
  }

  return dedupeAgentConversationMessages(messages);
}

function dedupeAgentConversationMessages(messages: AgentConversationMessage[]): AgentConversationMessage[] {
  const seen = new Set<string>();
  return messages.filter((message, index) => {
    const key = `${message.role}:${message.title ?? ""}:${message.text}`;
    const laterDuplicate = messages
      .slice(index + 1)
      .some((next) => `${next.role}:${next.title ?? ""}:${next.text}` === key);
    if (laterDuplicate || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildAgentProgressSteps({
  hasComposeBrief,
  hasPlan,
  composingWorkflow,
  generatingSample,
  activeJobCount,
  visibleOutputCount,
}: {
  hasComposeBrief: boolean;
  hasPlan: boolean;
  composingWorkflow: boolean;
  generatingSample: boolean;
  activeJobCount: number;
  visibleOutputCount: number;
}): AgentProgressStep[] {
  const isGenerating = generatingSample || activeJobCount > 0;
  return [
    {
      id: "understand",
      label: "理解",
      status: hasComposeBrief || hasPlan || visibleOutputCount > 0 ? "done" : composingWorkflow ? "active" : "pending",
    },
    {
      id: "plan",
      label: "规划",
      status: hasPlan ? "done" : composingWorkflow ? "active" : "pending",
    },
    {
      id: "references",
      label: "参考",
      status: hasPlan ? "done" : composingWorkflow ? "active" : "pending",
    },
    {
      id: "generate",
      label: "生成",
      status: isGenerating ? "active" : visibleOutputCount > 0 ? "done" : "pending",
    },
    {
      id: "qa",
      label: "质检",
      status: visibleOutputCount > 0 && activeJobCount === 0 ? "done" : "pending",
    },
    {
      id: "review",
      label: "挑图",
      status: visibleOutputCount > 0 && activeJobCount === 0 ? "active" : "pending",
    },
  ];
}

function buildAgentCompletionSummary({
  visibleOutputCount,
  visibleArtifacts,
  activeJobCount,
  hasPlan,
  planGroups,
  matrixItems,
}: {
  visibleOutputCount: number;
  visibleArtifacts: PersistedGeneratedArtifact[];
  activeJobCount: number;
  hasPlan: boolean;
  planGroups: AgentPlanGroup[];
  matrixItems: WorkflowPlanPreviewAgentMatrixItem[];
}): string {
  if (visibleOutputCount <= 0 || activeJobCount > 0) return "";
  const failedCount = getAgentArtifactFailureCount(visibleArtifacts);
  const reviewSummary = formatAgentArtifactReviewSummary(visibleArtifacts);
  const visualQaSummary = formatAgentVisualQaSummary(visibleArtifacts);
  const markedRedoCount = visibleArtifacts.filter((artifact) => getArtifactReviewStatus(artifact) === "needs_redo").length;
  const candidateGroups = planGroups
    .filter((group) => /主图|详情|细节|海报|模特|场景|卖点|封面/.test(group.title))
    .slice(0, 3)
    .map((group) => group.title);
  const usableArtifactLabels = getAgentUsableArtifactLabels(visibleArtifacts);
  const redoTarget = getAgentSuggestedRedoTarget(visibleArtifacts, candidateGroups);
  const riskChecks = agentUniqueStrings([
    ...buildAgentCompletionRiskChecks({ planGroups, matrixItems, visibleArtifacts }),
    ...getAgentVisualQaRiskLabels(visibleArtifacts),
  ]);
  const keepText = usableArtifactLabels.length
    ? `够用先看：${usableArtifactLabels.join("、")}。`
    : candidateGroups.length
    ? `够用先看：${candidateGroups.join("、")}。`
    : "够用先看：点开图片检查参考图和 prompt。";
  const riskText = riskChecks.length
    ? `建议重做前复查：${riskChecks.join("、")}。`
    : "建议重做前复查：主体稳定、画面能否直接交付。";
  const redoText = failedCount > 0
    ? `建议先重做：${redoTarget?.label || `${failedCount} 张失败图`}，先排除失败或不可用。`
    : redoTarget
      ? `建议先重做：${redoTarget.label}，${redoTarget.reason}。`
      : `建议先重做：先挑最影响转化的 ${candidateGroups[0] || "主图/海报"}，只重做问题单张。`;
  const resultEntryText =
    "结果入口：画布结果墙已按用途分组；点单张看大图、参考图和 prompt，点分组只改这一组。";
  const reviewActionText = markedRedoCount > 0
    ? `已标待重做 ${markedRedoCount} 张：可执行建议会优先处理这些图；已保留/已淘汰不会被重做。`
    : "";
  const nextText = buildAgentCompletionNextAction({
    failedCount,
    markedRedoCount,
    hasPlan,
    redoTarget,
    riskChecks,
  });
  return [
    `已完成 ${visibleOutputCount} 张结果。`,
    reviewSummary ? `挑图状态：${reviewSummary}。` : "",
    visualQaSummary ? `视觉 QA：${visualQaSummary}。` : "",
    resultEntryText,
    reviewActionText,
    keepText,
    riskText,
    redoText,
    nextText,
  ].filter(Boolean).join("\n");
}

function buildAgentCompletionNextAction({
  failedCount,
  markedRedoCount,
  hasPlan,
  redoTarget,
  riskChecks,
}: {
  failedCount: number;
  markedRedoCount: number;
  hasPlan: boolean;
  redoTarget: { label: string; reason: string } | null;
  riskChecks: string[];
}): string {
  if (failedCount > 0) {
    return "下一步：先点失败图重试，稳定后再挑图导出。";
  }
  if (markedRedoCount > 0) {
    return `下一步：先执行 ${markedRedoCount} 张待重做项；也可以点图说具体怎么改。`;
  }
  if (riskChecks.includes("文案安全区")) {
    return "下一步：先点开烧字图检查安全区；不满意就说“这张文案短一点”。";
  }
  if (riskChecks.includes("商品一致性风险")) {
    return "下一步：先补商品参考图，或只重做商品主图。";
  }
  if (riskChecks.includes("模特身份和神态")) {
    return "下一步：先看模特脸、眼神、头和手；不自然就点单张具体改。";
  }
  if (redoTarget) {
    return `下一步：先确认 ${redoTarget.label}，没问题再导出。`;
  }
  return hasPlan
    ? "下一步：有问题点单张说“这张重做”，或点一组说“换一批”。"
    : "下一步：可以点图让 Agent 改单张。";
}

function buildAgentCompletionRiskChecks({
  planGroups,
  matrixItems,
  visibleArtifacts,
}: {
  planGroups: AgentPlanGroup[];
  matrixItems: WorkflowPlanPreviewAgentMatrixItem[];
  visibleArtifacts: PersistedGeneratedArtifact[];
}): string[] {
  const risks: string[] = [];
  const artifactProviderRoles = getAgentArtifactProviderReferenceRoles(visibleArtifacts);
  const artifactPromptOnlyRoles = getAgentArtifactPromptOnlyReferenceRoles(visibleArtifacts);
  const hasProductRole =
    matrixItems.some((item) => item.referenceRoles.includes("product")) ||
    artifactProviderRoles.includes("product") ||
    artifactPromptOnlyRoles.includes("product");
  const hasProductProvider =
    matrixItems.some((item) => item.providerReferenceRoles.includes("product")) ||
    artifactProviderRoles.includes("product");
  if (hasProductRole) {
    risks.push(hasProductProvider ? "商品形状/Logo/材质" : "商品一致性风险");
  }
  const hasModelGroup = planGroups.some((group) =>
    group.providerRoles.includes("model") ||
    group.promptOnlyRoles.includes("model") ||
    /模特|真人|人物|上身|穿搭/.test(group.title)
  ) || artifactProviderRoles.includes("model") || artifactPromptOnlyRoles.includes("model");
  if (hasModelGroup) risks.push("模特身份和神态");
  const burnInCount =
    matrixItems.filter((item) => item.copyMode === "burn_in").length +
    getAgentArtifactBurnInCount(visibleArtifacts);
  if (burnInCount > 0) risks.push("文案安全区");
  const hasSceneGroup = planGroups.some((group) =>
    group.providerRoles.includes("scene") ||
    group.promptOnlyRoles.includes("scene") ||
    /场景|室内|户外|商场|咖啡|卧室|办公/.test(group.title)
  ) || artifactProviderRoles.includes("scene") || artifactPromptOnlyRoles.includes("scene");
  if (hasSceneGroup) risks.push("空间光影");
  return agentUniqueStrings(risks).slice(0, 4);
}

function buildAgentMissingInputHints(
  missingInputs: WorkflowPlanPreviewAgentMissingInput[],
  matrixItems: WorkflowPlanPreviewAgentMatrixItem[],
  requiredRoles: string[],
  assetGroups: WorkflowPlanPreviewAgentAssetGroup[]
): string[] {
  const missingById = new Map(missingInputs.map((input) => [input.id, input]));
  const roleCounts = new Map<string, number>();
  for (const item of matrixItems) {
    for (const id of item.missingInputIds ?? []) {
      const input = missingById.get(id);
      const label = input?.label || id;
      roleCounts.set(label, (roleCounts.get(label) ?? 0) + 1);
    }
  }

  const hints = missingInputs
    .filter((input) => input.blocking)
    .map((input) => {
      const count = roleCounts.get(input.label) ?? 0;
      const prefix = count > 0 ? `${count} 张图缺 ${input.label}` : `缺 ${input.label}`;
      return `${prefix}：${getAgentMissingInputAction(input.role)}`;
    });

  for (const role of requiredRoles) {
    const hasProviderAsset = assetGroups.some((group) =>
      group.role === role && group.available && group.providerUsable
    );
    if (hasProviderAsset) continue;
    hints.push(`缺 ${getAgentPlanRoleLabel(role)}：${getAgentMissingInputAction(role)}`);
  }

  return hints.length > 0 ? agentUniqueStrings(hints) : [];
}

function getAgentMissingInputAction(role?: string): string {
  if (role === "product") return "上传或拖入真实商品图，用来锁商品身份。";
  if (role === "model") return "上传或生成一个模特资产，用来保持同一人物。";
  if (role === "scene") return "上传或生成场景参考，用来确定空间和光影。";
  if (role === "style") return "补一张风格参考，或把风格写进需求。";
  if (role === "copy") return "补卖点/文案资产，或在需求里说明要写什么。";
  return "补齐对应素材后再执行。";
}

function buildAgentQaSummaryItems({
  visibleOutputCount,
  visibleArtifacts,
  activeJobCount,
  planGroups,
  matrixItems,
}: {
  visibleOutputCount: number;
  visibleArtifacts: PersistedGeneratedArtifact[];
  activeJobCount: number;
  planGroups: AgentPlanGroup[];
  matrixItems: WorkflowPlanPreviewAgentMatrixItem[];
}): AgentQaSummaryItem[] {
  if (visibleOutputCount <= 0 || activeJobCount > 0) return [];

  const artifactProviderRoles = getAgentArtifactProviderReferenceRoles(visibleArtifacts);
  const artifactPromptOnlyRoles = getAgentArtifactPromptOnlyReferenceRoles(visibleArtifacts);
  const hasProductProvider =
    matrixItems.some((item) => item.providerReferenceRoles.includes("product")) ||
    artifactProviderRoles.includes("product");
  const hasModelProvider =
    matrixItems.some((item) => item.providerReferenceRoles.includes("model")) ||
    artifactProviderRoles.includes("model");
  const hasSceneProvider =
    matrixItems.some((item) => item.providerReferenceRoles.includes("scene")) ||
    artifactProviderRoles.includes("scene");
  const burnInCount =
    matrixItems.filter((item) => item.copyMode === "burn_in").length +
    getAgentArtifactBurnInCount(visibleArtifacts);
  const failedCount = getAgentArtifactFailureCount(visibleArtifacts);
  const modelGroup = planGroups.find((group) => group.providerRoles.includes("model") || group.promptOnlyRoles.includes("model"));
  const hasPromptOnlyModel =
    matrixItems.some((item) => item.referenceRoles.includes("model") && !item.providerReferenceRoles.includes("model")) ||
    artifactPromptOnlyRoles.includes("model");
  const visualQaItems = getAgentVisualQaSummaryItems(visibleArtifacts);
  const reviewSummary = formatAgentArtifactReviewSummary(visibleArtifacts);
  const hasReviewRisk = visibleArtifacts.some((artifact) => {
    const status = getArtifactReviewStatus(artifact);
    return status === "needs_redo" || status === "failed";
  });
  const allApproved = visibleArtifacts.length > 0 &&
    visibleArtifacts.every((artifact) => getArtifactReviewStatus(artifact) === "approved");

  return [
    ...visualQaItems,
    {
      label: "挑图",
      tone: hasReviewRisk ? "warn" : allApproved ? "success" : "default",
      text: reviewSummary
        ? `${reviewSummary}。先处理建议重做和失败，再保留可用图；误标后可在详情里恢复待检查。`
        : `共 ${visibleOutputCount} 张结果待挑；先看主图、海报和详情图。`
    },
    {
      label: "商品",
      tone: hasProductProvider ? "success" : "warn",
      text: hasProductProvider
        ? "已检测到商品强参考；重点看多角度图有没有改形状、Logo、材质和五金。"
        : "未检测到商品强参考；如果是真实商品项目，建议先补商品图再重跑。"
    },
    {
      label: "模特",
      tone: hasModelProvider ? "success" : "default",
      text: hasModelProvider
        ? "已检测到模特参考；如果神态太死，点选对应图说具体眼神、头部和手部动作。"
        : modelGroup || hasPromptOnlyModel ? "模特更偏文字约束；适合概念图，不适合严格同一人物。" : "本轮没有强模特约束。"
    },
    {
      label: "文案",
      tone: burnInCount > 0 ? "warn" : "default",
      text: burnInCount > 0
        ? `${burnInCount} 张计划烧字；检查文案在画面安全区，不要写到商品包装标签上。`
        : "当前文案默认不烧进图或作为图层；需要成片带字时直接说“这组文案烧进图”。"
    },
    {
      label: "光影",
      tone: hasSceneProvider ? "success" : "default",
      text: hasSceneProvider
        ? "已使用场景参考；重点看人物脸、手、商品和地面的阴影是否来自同一光源。"
        : "没有强场景参考时，空间和光影更依赖 prompt，可点图单张修。"
    },
    {
      label: "重做",
      tone: failedCount > 0 ? "warn" : "default",
      text: failedCount > 0
        ? `有 ${failedCount} 张失败或不可用，先点对应图重试；如果只是审美不满意，再点图说具体要改哪里。`
        : "如果只是一张不满意，点图后说“这张重做”；如果一组重复，点该组说“换一批姿势/场景”。"
    },
  ];
}

function formatAgentVisualQaSummary(artifacts: PersistedGeneratedArtifact[]): string {
  if (artifacts.length === 0) return "";
  const counts = new Map<ArtifactVisualQaStatus, number>();
  for (const artifact of artifacts) {
    const status = getArtifactVisualQaSummary(artifact).status;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return (["fail", "warn", "pending", "pass"] as const)
    .flatMap((status) => {
      const count = counts.get(status) ?? 0;
      return count > 0 ? [`${getArtifactVisualQaStatusLabel(status)} ${count}`] : [];
    })
    .join(" / ");
}

function getAgentVisualQaRiskLabels(artifacts: PersistedGeneratedArtifact[]): string[] {
  const labels: string[] = [];
  for (const artifact of artifacts) {
    const qa = getArtifactVisualQaSummary(artifact);
    if (qa.status !== "fail" && qa.status !== "warn") continue;
    for (const issue of qa.issues) {
      if (issue.status !== "fail" && issue.status !== "warn") continue;
      labels.push(issue.label);
    }
  }
  return agentUniqueStrings(labels).slice(0, 4);
}

function getAgentVisualQaSummaryItems(artifacts: PersistedGeneratedArtifact[]): AgentQaSummaryItem[] {
  const issueCounts = new Map<string, { label: string; fail: number; warn: number }>();
  for (const artifact of artifacts) {
    const qa = getArtifactVisualQaSummary(artifact);
    for (const issue of qa.issues) {
      if (issue.status !== "fail" && issue.status !== "warn") continue;
      const entry = issueCounts.get(issue.dimension) ?? { label: issue.label, fail: 0, warn: 0 };
      if (issue.status === "fail") entry.fail += 1;
      if (issue.status === "warn") entry.warn += 1;
      issueCounts.set(issue.dimension, entry);
    }
  }

  return Array.from(issueCounts.values())
    .slice(0, 4)
    .map((entry) => {
      const countText = [
        entry.fail > 0 ? `${entry.fail} 张失败` : "",
        entry.warn > 0 ? `${entry.warn} 张风险` : "",
      ].filter(Boolean).join("，");
      return {
        label: entry.label,
        tone: entry.fail > 0 ? "warn" : "default",
        text: `${countText || "有风险"}；可以点对应图“让 Agent 修改这张图”，或在分组上说“只重做这一组”。`,
      };
    });
}

function getAgentArtifactVisualQaRiskText(artifact: PersistedGeneratedArtifact): string {
  const qa = getArtifactVisualQaSummary(artifact);
  const issue = qa.issues.find((item) => item.status === "fail") ??
    qa.issues.find((item) => item.status === "warn");
  return issue ? `${issue.label}：${issue.summary}` : qa.label;
}

function getAgentArtifactProviderReferenceRoles(artifacts: PersistedGeneratedArtifact[]): string[] {
  const roles: string[] = [];
  for (const artifact of artifacts) {
    const metadata = artifact.metadata ?? {};
    roles.push(...getOutputPreviewProviderReferenceImages(metadata).map((image) => image.role));
    roles.push(...getStringArray(getRecordValue(metadata.assetInvocationPlan).providerReferenceRoles));
    roles.push(
      ...getOutputPreviewAssetInvocationDecisions(metadata)
        .filter((decision) => decision.providerInput)
        .map((decision) => decision.role)
    );
  }
  return agentUniqueStrings(roles);
}

function getAgentArtifactPromptOnlyReferenceRoles(artifacts: PersistedGeneratedArtifact[]): string[] {
  const roles: string[] = [];
  for (const artifact of artifacts) {
    const metadata = artifact.metadata ?? {};
    roles.push(...getOutputPreviewPromptOnlyReferenceImages(metadata).map((image) => image.role));
    roles.push(...getStringArray(getRecordValue(metadata.assetInvocationPlan).promptOnlyRoles));
    roles.push(
      ...getOutputPreviewAssetInvocationDecisions(metadata)
        .filter((decision) => !decision.providerInput)
        .map((decision) => decision.role)
    );
  }
  return agentUniqueStrings(roles);
}

function getAgentArtifactBurnInCount(artifacts: PersistedGeneratedArtifact[]): number {
  return artifacts.filter((artifact) =>
    getOutputPreviewCopyRenderPolicy(artifact.metadata ?? {})?.mode === "burn_in"
  ).length;
}

function getAgentArtifactFailureCount(artifacts: PersistedGeneratedArtifact[]): number {
  return artifacts.filter((artifact) => {
    const status = artifact.status.toLowerCase();
    return status === "failed" || status === "error" || status === "cancelled" || Boolean(artifact.metadata?.error);
  }).length;
}

function getAgentUsableArtifactLabels(artifacts: PersistedGeneratedArtifact[]): string[] {
  const approved = artifacts.filter((artifact) => getArtifactReviewStatus(artifact) === "approved");
  const candidates = approved.length > 0
    ? approved
    : artifacts.filter((artifact) => {
        const reviewStatus = getArtifactReviewStatus(artifact);
        return reviewStatus === "pending" && !isAgentArtifactFailed(artifact);
      });
  return candidates
    .slice(0, 3)
    .map((artifact, index) => formatAgentArtifactPointer(artifact, index));
}

function getAgentSuggestedRedoTarget(
  artifacts: PersistedGeneratedArtifact[],
  candidateGroups: string[]
): { label: string; reason: string; artifactId?: string; jobId?: string; groupTitle?: string } | null {
  const indexedArtifacts = artifacts.map((artifact, index) => ({ artifact, index }));
  const manuallyMarked = indexedArtifacts.find(({ artifact }) => getArtifactReviewStatus(artifact) === "needs_redo");
  if (manuallyMarked) {
    return {
      label: formatAgentArtifactPointer(manuallyMarked.artifact, manuallyMarked.index),
      reason: "你已经标记为建议重做",
      artifactId: manuallyMarked.artifact.id,
      jobId: manuallyMarked.artifact.jobId,
    };
  }

  const failed = indexedArtifacts.find(({ artifact }) => isAgentArtifactFailed(artifact));
  if (failed) {
    return {
      label: formatAgentArtifactPointer(failed.artifact, failed.index),
      reason: "先排除失败或不可用",
      artifactId: failed.artifact.id,
      jobId: failed.artifact.jobId,
    };
  }

  const visualQaRisk = indexedArtifacts.find(({ artifact }) => {
    const qa = getArtifactVisualQaSummary(artifact);
    return getArtifactReviewStatus(artifact) === "pending" && (qa.status === "fail" || qa.status === "warn");
  });
  if (visualQaRisk) {
    return {
      label: formatAgentArtifactPointer(visualQaRisk.artifact, visualQaRisk.index),
      reason: getAgentArtifactVisualQaRiskText(visualQaRisk.artifact),
      artifactId: visualQaRisk.artifact.id,
      jobId: visualQaRisk.artifact.jobId,
    };
  }

  const burnInPoster = indexedArtifacts.find(({ artifact }) =>
    getArtifactReviewStatus(artifact) === "pending" &&
    getOutputPreviewCopyRenderPolicy(artifact.metadata ?? {})?.mode === "burn_in" &&
    /海报|卖点|封面|文案|poster|banner|cover/i.test(getAgentArtifactSearchText(artifact))
  );
  if (burnInPoster) {
    return {
      label: formatAgentArtifactPointer(burnInPoster.artifact, burnInPoster.index),
      reason: "先检查烧字位置和文案安全区",
      artifactId: burnInPoster.artifact.id,
      jobId: burnInPoster.artifact.jobId,
    };
  }

  const commerceLead = indexedArtifacts.find(({ artifact }) =>
    getArtifactReviewStatus(artifact) === "pending" &&
    /主图|海报|卖点|详情|封面|hero|poster|feature|detail/i.test(getAgentArtifactSearchText(artifact))
  );
  if (commerceLead) {
    return {
      label: formatAgentArtifactPointer(commerceLead.artifact, commerceLead.index),
      reason: "这张最影响首屏转化",
      artifactId: commerceLead.artifact.id,
      jobId: commerceLead.artifact.jobId,
    };
  }

  if (candidateGroups[0]) {
    return {
      label: candidateGroups[0],
      reason: "这是最靠前的关键图组",
      groupTitle: candidateGroups[0],
    };
  }

  return null;
}

function buildAgentExecutableReviewSuggestions({
  visibleArtifacts,
  planGroups,
  matrixItems,
  activeJobCount,
}: {
  visibleArtifacts: PersistedGeneratedArtifact[];
  planGroups: AgentPlanGroup[];
  matrixItems: WorkflowPlanPreviewAgentMatrixItem[];
  activeJobCount: number;
}): AgentExecutableReviewSuggestion[] {
  if (activeJobCount > 0 || visibleArtifacts.length === 0) return [];

  const suggestions: AgentExecutableReviewSuggestion[] = [];
  const seen = new Set<string>();
  const indexedArtifacts = visibleArtifacts.map((artifact, index) => ({ artifact, index }));
  const add = (suggestion: AgentExecutableReviewSuggestion | null | undefined) => {
    if (!suggestion || seen.has(suggestion.id)) return;
    seen.add(suggestion.id);
    suggestions.push(suggestion);
  };
  const buildArtifactSuggestion = (
    artifact: PersistedGeneratedArtifact,
    index: number,
    kind: string,
    titlePrefix: string,
    body: string,
    actions: AgentReviewSuggestionAction[],
    tone: AgentExecutableReviewSuggestion["tone"] = "default",
    editBrief?: string
  ): AgentExecutableReviewSuggestion => ({
    id: `${kind}:${artifact.id}`,
    title: `${titlePrefix}：${formatAgentArtifactPointer(artifact, index)}`,
    body,
    tone,
    artifactId: artifact.id,
    jobId: artifact.jobId,
    editBrief,
    actions,
  });

  const manuallyMarked = indexedArtifacts.find(({ artifact }) => getArtifactReviewStatus(artifact) === "needs_redo");
  if (manuallyMarked) {
    add(buildArtifactSuggestion(
      manuallyMarked.artifact,
      manuallyMarked.index,
      "marked-redo",
      "你已标记重做",
      "按原参考图、比例和图组用途重做这张；其他已保留图片不受影响。",
      ["redo", "edit", "reject", "approve"],
      "warn"
    ));
  }

  const failed = indexedArtifacts.find(({ artifact }) => isAgentArtifactFailed(artifact));
  if (failed) {
    add(buildArtifactSuggestion(
      failed.artifact,
      failed.index,
      "failed",
      "先处理失败图",
      "这张失败或不可用，建议先按原上下文重试，避免后面挑图时混在一起。",
      ["redo", "reject"],
      "warn"
    ));
  }

  const visualQaRisk = indexedArtifacts.find(({ artifact }) => {
    const qa = getArtifactVisualQaSummary(artifact);
    return getArtifactReviewStatus(artifact) === "pending" && (qa.status === "fail" || qa.status === "warn");
  });
  if (visualQaRisk) {
    const riskText = getAgentArtifactVisualQaRiskText(visualQaRisk.artifact);
    add(buildArtifactSuggestion(
      visualQaRisk.artifact,
      visualQaRisk.index,
      "visual-qa",
      "视觉 QA 风险",
      `${riskText}。建议先让 Agent 只修这张，或标记为重做。`,
      ["open", "edit", "mark_needs_redo", "approve"],
      "warn",
      `只修改这张图的 QA 风险：${riskText}。保留原商品、模特、场景、比例和图组用途。`
    ));
  }

  const burnInPoster = indexedArtifacts.find(({ artifact }) =>
    getArtifactReviewStatus(artifact) === "pending" &&
    getOutputPreviewCopyRenderPolicy(artifact.metadata ?? {})?.mode === "burn_in" &&
    /海报|卖点|封面|文案|poster|banner|cover/i.test(getAgentArtifactSearchText(artifact))
  );
  if (burnInPoster) {
    add(buildArtifactSuggestion(
      burnInPoster.artifact,
      burnInPoster.index,
      "copy-risk",
      "检查烧字图",
      "这张含画面文字，优先检查文案是否在安全区，不要改到商品包装标签。",
      ["open", "copy", "mark_needs_redo", "approve"],
      "warn"
    ));
  }

  const commerceLead = indexedArtifacts.find(({ artifact }) =>
    getArtifactReviewStatus(artifact) === "pending" &&
    /主图|海报|卖点|详情|封面|hero|poster|feature|detail/i.test(getAgentArtifactSearchText(artifact))
  );
  if (commerceLead) {
    add(buildArtifactSuggestion(
      commerceLead.artifact,
      commerceLead.index,
      "commerce-lead",
      "优先挑关键图",
      "这张更影响首屏或转化，建议先点开看商品一致性、构图和文案。",
      ["open", "edit", "approve", "reject"]
    ));
  }

  add(buildAgentExecutableGroupSuggestion(visibleArtifacts, planGroups, matrixItems));

  return suggestions.slice(0, 4);
}

function buildAgentExecutableGroupSuggestion(
  artifacts: PersistedGeneratedArtifact[],
  planGroups: AgentPlanGroup[],
  matrixItems: WorkflowPlanPreviewAgentMatrixItem[]
): AgentExecutableReviewSuggestion | null {
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const explicitGroup = planGroups
    .map((group) => {
      const groupArtifacts = (group.artifactIds ?? [])
        .map((artifactId) => artifactById.get(artifactId))
        .filter((artifact): artifact is PersistedGeneratedArtifact => Boolean(artifact));
      return {
        group,
        artifacts: getAgentActionableGroupSuggestionArtifacts(groupArtifacts),
      };
    })
    .filter((entry) => entry.artifacts.length > 1)
    .sort(
      (a, b) =>
        getAgentResultGroupSuggestionRank(a.group.title, a.artifacts, matrixItems) -
        getAgentResultGroupSuggestionRank(b.group.title, b.artifacts, matrixItems)
    )[0];
  if (explicitGroup) {
    return {
      id: `group:${explicitGroup.group.title}`,
      title: `调整「${explicitGroup.group.title}」这组`,
      body: `这组还有 ${explicitGroup.artifacts.length} 张待处理。可以只重做这组待处理图片，或让 Agent 换姿势、换场景、调整烧字策略。`,
      groupTitle: explicitGroup.group.title,
      artifactIds: explicitGroup.artifacts.map((artifact) => artifact.id),
      editBrief: `调整「${explicitGroup.group.title}」：只改这一组待处理图片，其他已保留图片不变。`,
      actions: ["group_edit", "group_redo"],
    };
  }

  const byGroup = new Map<string, PersistedGeneratedArtifact[]>();
  for (const artifact of artifacts) {
    const group = getAgentArtifactResultGroupLabel(artifact);
    byGroup.set(group, [...(byGroup.get(group) ?? []), artifact]);
  }
  const candidate = Array.from(byGroup.entries())
    .map(([groupTitle, items]) => [
      groupTitle,
      getAgentActionableGroupSuggestionArtifacts(items),
    ] as const)
    .filter(([, items]) => items.length > 1)
    .sort((a, b) => getAgentResultGroupSuggestionRank(a[0], a[1], matrixItems) - getAgentResultGroupSuggestionRank(b[0], b[1], matrixItems))[0];
  if (!candidate) return null;

  const [groupTitle, groupArtifacts] = candidate;
  const hasRisk = groupArtifacts.some((artifact) => isArtifactVisualQaRisk(artifact) || getArtifactReviewStatus(artifact) === "needs_redo");
  return {
    id: `group:${groupTitle}:${groupArtifacts.map((artifact) => artifact.id).join("-")}`,
    title: `检查「${groupTitle}」这一组`,
    body: hasRisk
      ? `这组里有图片被标记为风险或建议重做。可以只调整这组，不影响其他图。`
      : `这组有 ${groupArtifacts.length} 张，适合批量换动作、换场景或统一文案策略。`,
    tone: hasRisk ? "warn" : "default",
    groupTitle,
    artifactIds: groupArtifacts.map((artifact) => artifact.id),
    editBrief: `调整「${groupTitle}」：只改这一组，其他已保留图片不变。`,
    actions: ["group_edit", "group_redo"],
  };
}

function getAgentActionableGroupSuggestionArtifacts(
  artifacts: PersistedGeneratedArtifact[]
): PersistedGeneratedArtifact[] {
  return artifacts.filter((artifact) => {
    const reviewStatus = getArtifactReviewStatus(artifact);
    return reviewStatus !== "approved" && reviewStatus !== "rejected";
  });
}

function getAgentArtifactResultGroupLabel(artifact: PersistedGeneratedArtifact): string {
  const metadata = artifact.metadata ?? {};
  const explicitGroup =
    getStringValue(metadata.resultGroupTitle) ||
    getStringValue(metadata.rerunGroupTitle);
  if (explicitGroup) return explicitGroup;

  const text = getAgentArtifactSearchText(artifact).toLowerCase();
  if (/main|hero|主图|主视觉/.test(text)) return "主图";
  if (/poster|campaign|海报|封面/.test(text)) return "海报";
  if (/material|macro|texture|材质|细节|微距|特写/.test(text)) return "细节图";
  if (/detail|详情页|详情图|长图/.test(text)) return "详情图";
  if (/model|wear|look|真人|模特|上身|佩戴/.test(text)) return "模特图";
  if (/scene|lifestyle|street|cafe|room|场景|街拍|生活/.test(text)) return "场景图";
  if (/feature|selling|proof|卖点|证据/.test(text)) return "卖点图";
  if (/copy|text|info|文案|信息/.test(text)) return "文案图";
  return "成片";
}

function getAgentResultGroupSuggestionRank(
  groupTitle: string,
  artifacts: PersistedGeneratedArtifact[],
  matrixItems: WorkflowPlanPreviewAgentMatrixItem[]
): number {
  if (artifacts.some((artifact) => isArtifactVisualQaRisk(artifact) || getArtifactReviewStatus(artifact) === "needs_redo")) return 0;
  if (/主图|海报|卖点/.test(groupTitle)) return 1;
  if (/模特|场景/.test(groupTitle)) return 2;
  if (matrixItems.some((item) => item.title.includes(groupTitle))) return 3;
  return 4;
}

function formatAgentArtifactReviewSummary(artifacts: PersistedGeneratedArtifact[]): string {
  if (artifacts.length === 0) return "";
  const counts = new Map<ArtifactReviewStatus, number>();
  for (const artifact of artifacts) {
    const status = getArtifactReviewStatus(artifact);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return (["approved", "pending", "needs_redo", "rejected", "failed"] as const)
    .flatMap((status) => {
      const count = counts.get(status) ?? 0;
      return count > 0 ? [`${getArtifactReviewStatusLabel(status)} ${count}`] : [];
    })
    .join(" / ");
}

function formatAgentReviewRemainingSummary(
  artifacts: PersistedGeneratedArtifact[],
  statusOverrides: Record<string, ArtifactReviewStatus> = {}
): string {
  if (artifacts.length === 0) return "";
  const counts = new Map<ArtifactReviewStatus, number>();
  for (const artifact of artifacts) {
    const status = statusOverrides[artifact.id] ?? getArtifactReviewStatus(artifact);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const pending = counts.get("pending") ?? 0;
  const redo = counts.get("needs_redo") ?? 0;
  const failed = counts.get("failed") ?? 0;
  const remaining = pending + redo + failed;
  if (remaining <= 0) return "当前没有待处理结果。";
  const parts = [
    pending > 0 ? `待检查 ${pending}` : "",
    redo > 0 ? `建议重做 ${redo}` : "",
    failed > 0 ? `生成失败 ${failed}` : "",
  ].filter(Boolean);
  return `当前还剩 ${remaining} 张待处理（${parts.join(" / ")}）。`;
}

function isAgentArtifactFailed(artifact: PersistedGeneratedArtifact): boolean {
  const status = artifact.status.toLowerCase();
  return status === "failed" || status === "error" || status === "cancelled" || Boolean(artifact.metadata?.error);
}

function formatAgentArtifactPointer(artifact: PersistedGeneratedArtifact, index: number): string {
  return `第 ${index + 1} 张「${truncateRevisionText(artifact.title || "未命名成片", 18)}」`;
}

function getAgentArtifactSearchText(artifact: PersistedGeneratedArtifact): string {
  const metadata = artifact.metadata ?? {};
  return [
    artifact.title,
    artifact.type,
    getStringValue(metadata.resultGroupTitle),
    getStringValue(metadata.rerunGroupTitle),
    getStringValue(metadata.planItemTitle),
    getStringValue(metadata.batchJobTitle),
    getStringValue(metadata.outputSlotId),
    getStringValue(metadata.exportSpecId),
  ].filter(Boolean).join(" ");
}

function agentUniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function buildProjectAwareAgentBrief({
  projectStarterPrompt,
  userBrief,
}: {
  projectStarterPrompt?: string;
  userBrief: string;
}): string {
  const starter = (projectStarterPrompt ?? "").trim();
  const brief = userBrief.trim();
  if (!starter) return brief;
  if (!brief) return starter;
  if (brief.includes(starter)) return brief;
  return [`项目模板意图：${starter}`, `用户本次需求：${brief}`].join("\n\n");
}

function buildAgentPlanRevisionBrief(
  preview: WorkflowPlanPreview,
  userBrief: string
): string {
  const cleanUserBrief = userBrief.trim();
  const itemSummary = preview.items
    .slice(0, 8)
    .map((item, index) => `${index + 1}. ${item.title}，${item.ratio || "自适应比例"}，${item.purpose}`)
    .join("\n");
  const agentMatrixSummary = preview.agentPlan?.generationMatrix
    ?.slice(0, 8)
    .map((item, index) => {
      const references = item.referenceRoles.length
        ? item.referenceRoles.map(getAgentPlanRoleLabel).join("、")
        : "无明确参考";
      return `${index + 1}. ${item.title}，${item.ratio || "自适应比例"}，参考：${references}，文案：${getCopyModeLabel(item.copyMode)}`;
    })
    .join("\n");

  return [
    "请基于当前已生成的制作计划进行修改，而不是从零理解为无上下文的新项目。",
    `当前计划：${preview.title}，预计 ${preview.estimatedCount} 张图。`,
    preview.summary ? `当前计划摘要：${preview.summary}` : "",
    agentMatrixSummary ? `当前执行清单：\n${agentMatrixSummary}` : itemSummary ? `当前图组：\n${itemSummary}` : "",
    `用户本次修改要求：${cleanUserBrief}`,
    "请输出一版新的商业图组计划：保留用户没有否定的资产、参考图、商品身份和项目方向；只调整用户明确提出要改的数量、用途、比例、场景、文案是否进图或质量风格。",
  ].filter(Boolean).join("\n\n");
}

function inferAgentCopyRenderMode(
  brief: string,
  explicitBurnInRequested: boolean
): "layout_layer" | "burn_in" | "metadata_only" {
  const text = brief.toLowerCase();
  if (
    /(文案|文字).{0,8}(不|别|不要|无需|不需要).{0,8}(进图|入图|烧字|烧进|渲染|写进|出字|放进图)/.test(text) ||
    /(不|别|不要|无需|不需要).{0,8}(烧字|烧进|把字放进图|把文案放进图|把文字放进图|直接出字|直接生成文字|出字|进图)/.test(text)
  ) {
    return "layout_layer";
  }
  if (explicitBurnInRequested) return "burn_in";
  if (
    [
      "烧进",
      "烧字",
      "带字",
      "带文案",
      "短文案",
      "文案进图",
      "直接出字",
      "直接生成文字",
      "把字放进图",
      "图中文字",
      "画面文字",
      "封面标题",
      "海报标题",
      "短标题",
      "in-image",
      "burn in",
      "burn-in",
      "render text",
    ].some((term) => text.includes(term))
  ) {
    return "burn_in";
  }
  return "layout_layer";
}

function getCompositionModeLabel(mode: string): string {
  const labels: Record<string, string> = {
    single_product: "单商品",
    single_product_multi_scene: "单商品多场景",
    single_model_multi_product: "单模特多商品",
    multi_product_separate: "多商品拆分",
    multi_product_bundle: "多商品组合",
    multi_scene_variation: "多场景发散",
    multi_model_variation: "多模特发散",
    custom_matrix: "自定义矩阵",
    product_only: "商品图",
    product_model: "商品+模特",
    product_scene: "商品+场景",
    product_model_scene: "商品+模特+场景",
    style_campaign: "风格组图",
    copy_layout: "文案图层",
    text_only: "纯文本规划",
  };
  return labels[mode] ?? mode;
}

function InspectorPanel({
  selectedNode,
  canvasNodes,
  canvasEdges,
  components,
  jobs,
  queueSnapshot,
  projects,
  assets,
  productAsset,
  artifacts,
  workflowTemplates,
  composeBrief,
  composingWorkflow,
  workflowPlanPreview,
  productImportText,
  productImportPreview,
  previewingProductImport,
  savingProductImport,
  activeProductComponentTitle,
  creatingJobForNodeId,
  runningJobId,
  reviewingBatchId,
  reviewingCheckKey,
  applyingTemplateId,
  factoryLoadingId,
  composeMessage,
  productImportMessage,
  factoryMessage,
  jobMessage,
  queueMessage,
  projectMessage,
  queueLoading,
  reclaimingStaleJobs,
  transitioningBatchId,
  archivingBatchId,
  templateMessage,
  artifactMessage,
  exportPackMessage,
  onCreateJob,
  onRunJob,
  onCancelJob,
  onRetryJob,
  onRetryImageJob,
  onRefreshQueue,
  onReclaimStaleJobs,
  onRefreshProjects,
  onComposeBriefChange,
  onComposeWorkflow,
  onApplyWorkflowPlan,
  onDismissWorkflowPlan,
  onUpdateWorkflowPlanParameter,
  onProductImportTextChange,
  onPreviewProductImport,
  onSaveProductImport,
  onComposeImportedProductWorkflow,
  onSelectBatch,
  onMarkBatchQaPassed,
  onUpdateBatchState,
  onArchiveBatchJobs,
  onUpdateQaReview,
  onReviewSessionSynced,
  onUpdateGenerationFramePrompt,
  onSelectArtifact,
  onCreateExportPack,
  onApplyWorkflowTemplate,
  onCreateFactoryItem,
  onClose,
}: {
  selectedNode?: CanvasWorkbenchNode;
  canvasNodes: CanvasWorkbenchNode[];
  canvasEdges: CanvasWorkbenchEdge[];
  components: PersistedComponent[];
  jobs: PersistedGenerationJob[];
  queueSnapshot: PersistedJobQueueSnapshot | null;
  projects: PersistedProjectDetails[];
  assets: CanvasAsset[];
  productAsset?: CanvasAsset;
  artifacts: PersistedGeneratedArtifact[];
  workflowTemplates: PersistedWorkflowTemplate[];
  composeBrief: string;
  composingWorkflow: boolean;
  workflowPlanPreview: WorkflowPlanPreview | null;
  productImportText: string;
  productImportPreview: ProductImportPreview | null;
  previewingProductImport: boolean;
  savingProductImport: boolean;
  activeProductComponentTitle: string;
  creatingJobForNodeId: string | null;
  runningJobId: string | null;
  reviewingBatchId: string | null;
  reviewingCheckKey: string | null;
  applyingTemplateId: string | null;
  factoryLoadingId: string | null;
  composeMessage: string;
  productImportMessage: string;
  factoryMessage: string;
  jobMessage: string;
  queueMessage: string;
  projectMessage: string;
  queueLoading: boolean;
  reclaimingStaleJobs: boolean;
  transitioningBatchId: string | null;
  archivingBatchId: string | null;
  templateMessage: string;
  artifactMessage: string;
  exportPackMessage: string;
  onCreateJob: (node: CanvasWorkbenchNode) => void;
  onRunJob: (job: PersistedGenerationJob) => void;
  onCancelJob: (job: PersistedGenerationJob) => void;
  onRetryJob: (job: PersistedGenerationJob) => void;
  onRetryImageJob: (job: PersistedGenerationJob) => void;
  onRefreshQueue: () => void;
  onReclaimStaleJobs: () => void;
  onRefreshProjects: () => void;
  onComposeBriefChange: (brief: string) => void;
  onComposeWorkflow: () => void;
  onApplyWorkflowPlan: () => void;
  onDismissWorkflowPlan: () => void;
  onUpdateWorkflowPlanParameter: (nodeId: string, key: string, value: unknown) => void;
  onProductImportTextChange: (text: string) => void;
  onPreviewProductImport: () => void;
  onSaveProductImport: () => void;
  onComposeImportedProductWorkflow: () => void;
  onSelectBatch: (batch: ExportPackBatchSummary, manifest?: ExportPackManifest) => void;
  onMarkBatchQaPassed: (batch: ExportPackBatchSummary, qaReport?: ExportPackQaReport) => void;
  onUpdateBatchState: (batch: ExportPackBatchSummary, state: "locked" | "delivered") => void;
  onArchiveBatchJobs: (batch: ExportPackBatchSummary) => void;
  onUpdateQaReview: (
    batch: ExportPackBatchSummary,
    jobId: string,
    checkId: string,
    status: "pass" | "fail" | "manual"
  ) => void;
  onReviewSessionSynced: () => void;
  onUpdateGenerationFramePrompt: (nodeId: string, prompt: string) => void;
  onSelectArtifact: (artifact: PersistedGeneratedArtifact) => void;
  onCreateExportPack: (rule: ExportPackRule) => void;
  onApplyWorkflowTemplate: (template: PersistedWorkflowTemplate) => void;
  onCreateFactoryItem: (item: CanvasFactoryItem) => void;
  onClose?: () => void;
}) {
  const Icon = selectedNode ? canvasIconMap[selectedNode.data.iconName] : Bot;
  const searchParams = useSearchParams();
  const requestedProjectId = searchParams.get("projectId") ?? "";
  const appliedProjectQueryRef = useRef("");
  const [focusedBatchId, setFocusedBatchId] = useState<string | null>(null);
  const [artifactScopeFilter, setArtifactScopeFilter] = useState<ArtifactScopeFilter>("all");
  const [artifactStatusFilter, setArtifactStatusFilter] = useState<ArtifactStatusFilter>("all");
  const [artifactTypeFilter, setArtifactTypeFilter] = useState("all");
  const [reviewSession, setReviewSession] = useState<ReviewSessionSummary | null>(null);
  const [reviewSessionMessage, setReviewSessionMessage] = useState("");
  const [reviewActionKey, setReviewActionKey] = useState<string | null>(null);
  const [reviewNotesByItemId, setReviewNotesByItemId] = useState<Record<string, string>>({});
  const [providerReadiness, setProviderReadiness] = useState<ProviderReadiness | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedProjectBatchId, setSelectedProjectBatchId] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newCampaignTitle, setNewCampaignTitle] = useState("");
  const [projectRenameTitle, setProjectRenameTitle] = useState("");
  const [campaignRenameTitle, setCampaignRenameTitle] = useState("");
  const [creatingProjectEntity, setCreatingProjectEntity] = useState<"project" | "campaign" | null>(null);
  const [updatingProjectEntity, setUpdatingProjectEntity] = useState<"project" | "campaign" | null>(null);
  const [projectFormMessage, setProjectFormMessage] = useState("");
  const [activeProductionTab, setActiveProductionTab] = useState<ProductionPanelTab>("plan");
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [showDrawerAdvancedTools, setShowDrawerAdvancedTools] = useState(false);
  const [activeDrawerTool, setActiveDrawerTool] = useState<DrawerToolId | null>(null);
  const activeDrawerToolConfig = drawerToolOptions.find((tool) => tool.id === activeDrawerTool);
  const recentJobs = jobs.slice(0, 4);
  const projectBatchByBatchId = useMemo(
    () =>
      new Map(
        projects.flatMap((project) =>
          project.batches.map((batch) => [batch.id, batch] as const)
        )
      ),
    [projects]
  );
  const projectBatchStateByBatchId = useMemo(() => buildProjectBatchStateMap(projects), [projects]);
  const exportPackBatches = useMemo(
    () => buildExportPackBatchSummaries({
      jobs,
      assets,
      selectedNode,
      limit: 3,
      batchStates: projectBatchStateByBatchId,
    }),
    [assets, jobs, projectBatchStateByBatchId, selectedNode]
  );
  const exportPackManifestByBatchId = useMemo(() => {
    const manifests = buildExportPackManifests({ jobs, artifacts });
    return new Map(manifests.map((manifest) => [manifest.batchId, manifest]));
  }, [artifacts, jobs]);
  const exportPackImageInfoByUrl = useMemo(() => buildArtifactImageInfoByUrl(artifacts), [artifacts]);
  const exportPackQaReviewByJobId = useMemo(() => buildExportPackQaReviewByJobId(jobs), [jobs]);
  const exportPackQaByBatchId = useMemo(() => {
    return new Map(
      Array.from(exportPackManifestByBatchId.values()).map((manifest) => [
        manifest.batchId,
        buildExportPackQaReport({
          manifest,
          imageInfoByUrl: exportPackImageInfoByUrl,
          reviewByJobId: exportPackQaReviewByJobId,
        }),
      ])
    );
  }, [exportPackImageInfoByUrl, exportPackManifestByBatchId, exportPackQaReviewByJobId]);
  const focusedBatch = exportPackBatches.find((batch) => batch.batchId === focusedBatchId) ?? exportPackBatches[0];
  const focusedManifest = focusedBatch ? exportPackManifestByBatchId.get(focusedBatch.batchId) : undefined;
  const focusedQaReport = focusedBatch ? exportPackQaByBatchId.get(focusedBatch.batchId) : undefined;
  const focusedProjectBatch = focusedBatch ? projectBatchByBatchId.get(focusedBatch.batchId) : undefined;
  const focusedBatchImageItems = useMemo(
    () =>
      buildFocusedBatchImageItems({
        manifest: focusedManifest,
        qaReport: focusedQaReport,
        jobs,
        imageInfoByUrl: exportPackImageInfoByUrl,
      }),
    [exportPackImageInfoByUrl, focusedManifest, focusedQaReport, jobs]
  );
  const focusedBatchRunSummary = useMemo(
    () =>
      focusedBatch
        ? buildFocusedBatchRunSummary({
            batch: focusedBatch,
            jobs,
            manifest: focusedManifest,
            projectBatch: focusedProjectBatch,
            qaReport: focusedQaReport,
          })
        : undefined,
    [focusedBatch, focusedManifest, focusedProjectBatch, focusedQaReport, jobs]
  );
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? projects[0];
  const selectedCampaign =
    selectedProject?.campaigns.find((campaign) => campaign.id === selectedCampaignId) ??
    selectedProject?.campaigns[0];
  const selectedProjectBatch =
    selectedProject?.batches.find((batch) => batch.id === selectedProjectBatchId) ??
    selectedProject?.batches[0];
  const artifactTypeOptions = useMemo(() => {
    const types = Array.from(
      new Set(artifacts.map((artifact) => artifact.type).filter(Boolean))
    );
    return types.length > 0 ? types.sort((a, b) => a.localeCompare(b)) : ["image", "output_pack"];
  }, [artifacts]);
  const filteredArtifacts = useMemo(
    () =>
      artifacts.filter((artifact) => {
        if (
          artifactScopeFilter === "selected" &&
          (!selectedNode || !isArtifactLinkedToNode(artifact, selectedNode))
        ) {
          return false;
        }
        if (
          artifactStatusFilter !== "all" &&
          getArtifactStatusFilter(artifact.status) !== artifactStatusFilter
        ) {
          return false;
        }
        if (artifactTypeFilter !== "all" && artifact.type !== artifactTypeFilter) {
          return false;
        }
        return true;
      }),
    [artifactScopeFilter, artifactStatusFilter, artifactTypeFilter, artifacts, selectedNode]
  );
  const visibleArtifacts = filteredArtifacts.slice(0, 8);
  const selectedNodeArtifacts = selectedNode
    ? artifacts.filter((artifact) => isArtifactLinkedToNode(artifact, selectedNode))
    : [];
  const selectedIsExportPack = selectedNode ? isExportPackNode(selectedNode) : false;
  const selectedIsGenerationFrame = selectedNode ? isGenerationFrameNode(selectedNode) : false;
  const hasArtifactFilters =
    artifactScopeFilter !== "all" ||
    artifactStatusFilter !== "all" ||
    artifactTypeFilter !== "all";
  const queueHealth = getQueueHealthSummary(queueSnapshot);
  const selectedReferenceContext = useMemo(
    () =>
      selectedNode
        ? buildCanvasGenerationReferenceContext({
            targetNode: selectedNode,
            nodes: canvasNodes,
            edges: canvasEdges,
            components,
            assets,
            productAsset: isGenerationFrameNode(selectedNode) ? undefined : productAsset,
          })
        : undefined,
    [assets, canvasEdges, canvasNodes, components, productAsset, selectedNode]
  );

  useEffect(() => {
    if (!showAdvancedControls && activeDrawerTool) {
      setActiveDrawerTool(null);
    }
    if (!showAdvancedControls && showDrawerAdvancedTools) {
      setShowDrawerAdvancedTools(false);
    }
  }, [activeDrawerTool, showAdvancedControls, showDrawerAdvancedTools]);

  useEffect(() => {
    if (projects.length === 0) {
      if (selectedProjectId) setSelectedProjectId("");
      if (selectedProjectBatchId) setSelectedProjectBatchId("");
      if (selectedCampaignId) setSelectedCampaignId("");
      return;
    }

    if (!projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedCampaignId, selectedProjectBatchId, selectedProjectId]);

  useEffect(() => {
    if (!requestedProjectId || appliedProjectQueryRef.current === requestedProjectId) return;
    if (!projects.some((project) => project.id === requestedProjectId)) return;
    appliedProjectQueryRef.current = requestedProjectId;
    setSelectedProjectId(requestedProjectId);
    setSelectedCampaignId("");
    setSelectedProjectBatchId("");
    setProjectFormMessage("已打开项目");
  }, [projects, requestedProjectId]);

  useEffect(() => {
    if (!selectedProject) {
      if (selectedCampaignId) setSelectedCampaignId("");
      return;
    }
    if (selectedProject.campaigns.length === 0) {
      if (selectedCampaignId) setSelectedCampaignId("");
      return;
    }

    if (!selectedProject.campaigns.some((campaign) => campaign.id === selectedCampaignId)) {
      setSelectedCampaignId(selectedProject.campaigns[0].id);
    }
  }, [selectedCampaignId, selectedProject]);

  useEffect(() => {
    if (!selectedProject) return;
    if (selectedProject.batches.length === 0) {
      if (selectedProjectBatchId) setSelectedProjectBatchId("");
      return;
    }

    if (!selectedProject.batches.some((batch) => batch.id === selectedProjectBatchId)) {
      setSelectedProjectBatchId(selectedProject.batches[0].id);
    }
  }, [selectedProject, selectedProjectBatchId]);

  useEffect(() => {
    setProjectRenameTitle(selectedProject?.title ?? "");
  }, [selectedProject?.id, selectedProject?.title]);

  useEffect(() => {
    setCampaignRenameTitle(selectedCampaign?.title ?? "");
  }, [selectedCampaign?.id, selectedCampaign?.title]);

  useEffect(() => {
    let alive = true;

    async function loadProviderReadiness() {
      const response = await apiFetch("/api/settings", { cache: "no-store" });
      if (!response.ok || !alive) return;
      const payload = await response.json();
      setProviderReadiness({
        hasKey: payload.hasKey === true,
        hasImageKey: payload.hasImageKey === true,
        hasTextKey: payload.hasTextKey === true,
        imageModel: typeof payload.imageModel === "string" ? payload.imageModel : "",
        imageBaseUrl: typeof payload.imageBaseUrl === "string" ? payload.imageBaseUrl : "",
        textModel: typeof payload.textModel === "string" ? payload.textModel : "",
      });
    }

    loadProviderReadiness().catch(() => {
      if (alive) setProviderReadiness(null);
    });

    return () => {
      alive = false;
    };
  }, []);

  const loadLatestReviewSession = useCallback(async () => {
    setReviewSessionMessage("正在读取审核会话...");
    try {
      const response = await apiFetch("/api/review-sessions?limit=1", { cache: "no-store" });
      if (!response.ok) throw new Error("review session list failed");
      const payload = await response.json();
      const session = Array.isArray(payload.sessions) ? payload.sessions[0] : null;
      setReviewSession(session ?? null);
      setReviewSessionMessage(session ? "已载入最近审核会话" : "暂无审核会话");
    } catch (error) {
      console.error("Failed to load review sessions:", error);
      setReviewSessionMessage("审核会话读取失败");
    }
  }, []);

  useEffect(() => {
    void loadLatestReviewSession();
  }, [loadLatestReviewSession]);

  const handleCreateReviewSessionFromBatch = useCallback(async () => {
    if (!focusedBatch || !focusedManifest || !focusedQaReport) {
      setReviewSessionMessage("先选择一个有产物或 QA 的导出包批次");
      return;
    }

    setReviewActionKey("create:batch");
    setReviewSessionMessage("正在创建导出包审核会话...");

    try {
      const response = await apiFetch("/api/review-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildReviewSessionPayloadFromBatch(focusedBatch, focusedManifest, focusedQaReport)),
      });
      if (!response.ok) throw new Error("review session create failed");
      const payload = await response.json();
      setReviewSession(payload.session ?? null);
      setReviewNotesByItemId({});
      onReviewSessionSynced();
      setReviewSessionMessage("已创建导出包审核会话");
    } catch (error) {
      console.error("Failed to create review session:", error);
      setReviewSessionMessage("审核会话创建失败");
    } finally {
      setReviewActionKey(null);
    }
  }, [focusedBatch, focusedManifest, focusedQaReport, onReviewSessionSynced]);

  const handleCreateDemoReviewSession = useCallback(async () => {
    setReviewActionKey("create:demo");
    setReviewSessionMessage("正在创建演示审核会话...");

    try {
      const response = await apiFetch("/api/review-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildDemoReviewSessionPayload()),
      });
      if (!response.ok) throw new Error("demo review session create failed");
      const payload = await response.json();
      setReviewSession(payload.session ?? null);
      setReviewNotesByItemId({});
      setReviewSessionMessage("已创建演示审核会话");
    } catch (error) {
      console.error("Failed to create demo review session:", error);
      setReviewSessionMessage("演示审核会话创建失败");
    } finally {
      setReviewActionKey(null);
    }
  }, []);

  const handleReviewSessionAction = useCallback(
    async (action: UpdateReviewSessionInput["action"], itemId?: string) => {
      if (!reviewSession) {
        setReviewSessionMessage("先创建或载入审核会话");
        return;
      }

      const noteKey = itemId ?? "session";
      const note = reviewNotesByItemId[noteKey]?.trim() || "";
      if (action === "add_note" && !note) {
        setReviewSessionMessage("先输入备注");
        return;
      }

      const actionKey = `${action}:${noteKey}`;
      setReviewActionKey(actionKey);
      setReviewSessionMessage("正在写入审核结果...");

      try {
        const response = await apiFetch(`/api/review-sessions?id=${encodeURIComponent(reviewSession.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            itemId,
            note: note || undefined,
            metadata: {
              source: "canvas-reviewer",
            },
          }),
        });
        if (!response.ok) throw new Error("review session update failed");
        const payload = await response.json();
        setReviewSession(payload.session ?? null);
        const syncStatus =
          payload.exportPackSync && typeof payload.exportPackSync.status === "string"
            ? payload.exportPackSync.status
            : "";
        onReviewSessionSynced();
        if (note) {
          setReviewNotesByItemId((items) => ({ ...items, [noteKey]: "" }));
        }
        setReviewSessionMessage(
          syncStatus === "synced"
            ? `${getReviewActionMessage(action)}，已同步导出包 QA`
            : getReviewActionMessage(action)
        );
      } catch (error) {
        console.error("Failed to update review session:", error);
        setReviewSessionMessage("审核结果写入失败");
      } finally {
        setReviewActionKey(null);
      }
    },
    [onReviewSessionSynced, reviewNotesByItemId, reviewSession]
  );

  const handleCreateProject = useCallback(async () => {
    const title = newProjectTitle.trim();
    if (!title) {
      setProjectFormMessage("先输入项目名");
      return;
    }

    setCreatingProjectEntity("project");
    setProjectFormMessage("正在创建项目...");

    try {
      const response = await apiFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "project",
          title,
          metadata: {
            source: "canvas-project-panel",
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "项目创建失败");
      }
      const projectId = typeof payload.project?.id === "string" ? payload.project.id : "";
      await onRefreshProjects();
      if (projectId) setSelectedProjectId(projectId);
      setSelectedProjectBatchId("");
      setSelectedCampaignId("");
      setNewProjectTitle("");
      setProjectFormMessage("项目已创建");
    } catch (error) {
      console.error("Failed to create project:", error);
      setProjectFormMessage(error instanceof Error ? error.message : "项目创建失败");
    } finally {
      setCreatingProjectEntity(null);
    }
  }, [newProjectTitle, onRefreshProjects]);

  const handleCreateCampaign = useCallback(async () => {
    const title = newCampaignTitle.trim();
    if (!selectedProject) {
      setProjectFormMessage("先选择项目");
      return;
    }
    if (!title) {
      setProjectFormMessage("先输入活动名");
      return;
    }

    setCreatingProjectEntity("campaign");
    setProjectFormMessage("正在创建活动...");

    try {
      const response = await apiFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "campaign",
          projectId: selectedProject.id,
          title,
          metadata: {
            source: "canvas-project-panel",
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "活动创建失败");
      }
      const campaignId = typeof payload.campaign?.id === "string" ? payload.campaign.id : "";
      await onRefreshProjects();
      if (campaignId) setSelectedCampaignId(campaignId);
      setNewCampaignTitle("");
      setProjectFormMessage("活动已创建");
    } catch (error) {
      console.error("Failed to create campaign:", error);
      setProjectFormMessage(error instanceof Error ? error.message : "活动创建失败");
    } finally {
      setCreatingProjectEntity(null);
    }
  }, [newCampaignTitle, onRefreshProjects, selectedProject]);

  const handleRenameProject = useCallback(async () => {
    const title = projectRenameTitle.trim();
    if (!selectedProject) {
      setProjectFormMessage("先选择项目");
      return;
    }
    if (!title) {
      setProjectFormMessage("项目名不能为空");
      return;
    }
    if (title === selectedProject.title) {
      setProjectFormMessage("项目名没有变化");
      return;
    }

    setUpdatingProjectEntity("project");
    setProjectFormMessage("正在更新项目名...");

    try {
      const response = await apiFetch(`/api/projects/${encodeURIComponent(selectedProject.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "project",
          title,
          metadata: {
            ...(selectedProject.metadata ?? {}),
            renamedFromCanvasAt: new Date().toISOString(),
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "项目名更新失败");
      }
      await onRefreshProjects();
      setSelectedProjectId(selectedProject.id);
      setProjectFormMessage("项目名已更新");
    } catch (error) {
      console.error("Failed to rename project:", error);
      setProjectFormMessage(error instanceof Error ? error.message : "项目名更新失败");
    } finally {
      setUpdatingProjectEntity(null);
    }
  }, [onRefreshProjects, projectRenameTitle, selectedProject]);

  const handleRenameCampaign = useCallback(async () => {
    const title = campaignRenameTitle.trim();
    if (!selectedProject || !selectedCampaign) {
      setProjectFormMessage("先选择活动");
      return;
    }
    if (!title) {
      setProjectFormMessage("活动名不能为空");
      return;
    }
    if (title === selectedCampaign.title) {
      setProjectFormMessage("活动名没有变化");
      return;
    }

    setUpdatingProjectEntity("campaign");
    setProjectFormMessage("正在更新活动名...");

    try {
      const response = await apiFetch(`/api/projects/${encodeURIComponent(selectedProject.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "campaign",
          campaignId: selectedCampaign.id,
          title,
          metadata: {
            ...(selectedCampaign.metadata ?? {}),
            renamedFromCanvasAt: new Date().toISOString(),
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "活动名更新失败");
      }
      await onRefreshProjects();
      setSelectedCampaignId(selectedCampaign.id);
      setProjectFormMessage("活动名已更新");
    } catch (error) {
      console.error("Failed to rename campaign:", error);
      setProjectFormMessage(error instanceof Error ? error.message : "活动名更新失败");
    } finally {
      setUpdatingProjectEntity(null);
    }
  }, [campaignRenameTitle, onRefreshProjects, selectedCampaign, selectedProject]);

  const productionPlanItems: ProductionPlanItem[] = useMemo(() => {
    const items: ProductionPlanItem[] = [];
    if (selectedNode) {
      items.push({
        id: `selected:${selectedNode.id}`,
        title: selectedNode.data.label,
        description: selectedNode.data.caption,
        detail: selectedIsGenerationFrame
          ? `参考槽位：${getGenerationFrameSlotSummary(selectedReferenceContext)}`
          : selectedReferenceContext
            ? `参考：${getGenerationFrameSlotSummary(selectedReferenceContext)}`
            : undefined,
        state: selectedIsGenerationFrame ? "ready" : "idle",
        chips: selectedNode.data.metrics.slice(0, 3),
      });
    }

    if (workflowPlanPreview) {
      items.push(
        ...workflowPlanPreview.items.slice(0, 5).map((item) => ({
          id: `preview:${item.id}`,
          title: item.title,
          description: item.purpose || workflowPlanPreview.summary,
          detail: item.platform ? `${item.platform} · ${item.slot}` : item.slot,
          state: "idle" as ProductionPanelState,
          chips: [item.ratio, item.size, item.platform].filter((value): value is string => Boolean(value)),
        }))
      );
    }

    return items;
  }, [selectedIsGenerationFrame, selectedNode, selectedReferenceContext, workflowPlanPreview]);

  const productionResultItems: ProductionResultItem[] = useMemo(() => {
    if (selectedNodeArtifacts.length > 0) {
      return selectedNodeArtifacts.slice(0, 5).map((artifact) => ({
        id: artifact.id,
        title: artifact.title,
        description: getArtifactStatusLabel(artifact.status),
        imageUrl: getArtifactPreviewUrl(artifact),
        imageAlt: artifact.title,
        state: mapProductionStateFromStatus(artifact.status),
        chips: [artifact.type, getArtifactStatusLabel(artifact.status)].filter(Boolean),
        onOpen: () => onSelectArtifact(artifact),
      }));
    }

    if (focusedBatchImageItems.length > 0) {
      return focusedBatchImageItems.slice(0, 5).map((item) => ({
        id: item.jobId,
        title: item.title,
        description: item.statusLabel,
        imageUrl: item.previewUrl,
        imageAlt: item.title,
        state: mapProductionStateFromStatus(item.tone),
        chips: [item.statusLabel],
      }));
    }

    return visibleArtifacts.slice(0, 5).map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      description: getArtifactStatusLabel(artifact.status),
      imageUrl: getArtifactPreviewUrl(artifact),
      imageAlt: artifact.title,
      state: mapProductionStateFromStatus(artifact.status),
      chips: [artifact.type, getArtifactStatusLabel(artifact.status)].filter(Boolean),
      onOpen: () => onSelectArtifact(artifact),
    }));
  }, [focusedBatchImageItems, onSelectArtifact, selectedNodeArtifacts, visibleArtifacts]);

  const productionExportItems: ProductionExportItem[] = useMemo(() => {
    const items: ProductionExportItem[] = [];
    if (focusedBatch) {
      items.push({
        id: `focused:${focusedBatch.batchId}`,
        title: focusedBatch.title,
        description: focusedBatch.progressLabel,
        state: focusedManifest ? "ready" : mapProductionStateFromStatus(focusedBatch.statusLabel),
        format: "ZIP",
        size: focusedBatch.completed > 0 ? `${focusedBatch.completed} 张` : undefined,
        onDownload: focusedManifest
          ? () => {
              window.location.href = `/api/export-packs/${encodeURIComponent(focusedBatch.batchId)}/download`;
            }
          : undefined,
      });
    }

    items.push(
      ...exportPackBatches
        .filter((batch) => batch.batchId !== focusedBatch?.batchId)
        .slice(0, 4)
        .map((batch) => ({
          id: batch.batchId,
          title: batch.title,
          description: batch.progressLabel,
          state: mapProductionStateFromStatus(batch.statusLabel),
          format: "导出包",
          size: batch.total > 0 ? `${batch.completed}/${batch.total}` : undefined,
        } satisfies ProductionExportItem))
    );

    return items;
  }, [exportPackBatches, focusedBatch, focusedManifest]);

  const productionSummaryMessage = jobMessage || composeMessage || queueMessage || projectMessage;

  return (
    <aside className="flex min-h-0 flex-col overflow-y-auto bg-warm-paper lg:h-full">
      <ProductionSidePanel
        title="状态"
        subtitle="只看当前进度和结果。"
        activeTab={activeProductionTab}
        onTabChange={(tab: ProductionPanelTab) => setActiveProductionTab(tab)}
        summary={{
          planCount: productionPlanItems.length,
          resultCount: productionResultItems.length,
          exportCount: productionExportItems.length,
          message: productionSummaryMessage,
        }}
        planItems={productionPlanItems}
        resultItems={productionResultItems}
        exportItems={productionExportItems}
        busy={composingWorkflow || Boolean(selectedNode && creatingJobForNodeId === selectedNode.id)}
        emptyMessage={
          activeProductionTab === "plan"
            ? "选中画布框后查看计划"
            : activeProductionTab === "results"
              ? "结果会随画布框同步"
              : "交付包在审核后出现"
        }
        onRefresh={onRefreshProjects}
        onClose={onClose}
        footer={
          <div className="space-y-3">
            {selectedNode ? (
              <div className="rounded-lg border border-warm-line/50 bg-warm-bg p-2.5">
                <div className="flex items-start gap-2.5">
                  <AssetPreview
                    src={selectedNode.data.previewUrl}
                    alt={selectedNode.data.previewAlt ?? selectedNode.data.label}
                    icon={Icon}
                    size="md"
                    fit={selectedNode.data.iconName === "product" ? "contain" : "cover"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="truncate text-sm font-medium text-warm-ink">{selectedNode.data.label}</h4>
                        <p className="mt-1 line-clamp-2 text-xs leading-snug text-warm-muted">
                          {selectedNode.data.caption}
                        </p>
                      </div>
                      <span className="shrink-0 rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">
                        {selectedIsGenerationFrame ? "任务" : selectedNode.data.kind === "asset" ? "资产" : "节点"}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {selectedNode.data.metrics.slice(0, 3).map((metric) => (
                        <span
                          key={metric}
                          className="max-w-full truncate rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted"
                        >
                          {metric}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                {selectedIsGenerationFrame ? (
                  <div className="mt-3 rounded-md border border-warm-line/50 bg-warm-paper px-3 py-2 text-xs leading-5 text-warm-muted">
                    这是后台 Agent 任务；素材和需求从右上角进入，结果会回到画布图片墙。
                  </div>
                ) : selectedReferenceContext ? (
                  <ReferenceContextMiniPanel context={selectedReferenceContext} />
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-warm-line bg-warm-bg px-3 py-4 text-xs leading-5 text-warm-muted">
                上传或拖入素材后，在右上角告诉 Agent 你要做什么。
              </div>
            )}

            {workflowPlanPreview && (
              <button
                type="button"
                onClick={onApplyWorkflowPlan}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-warm-primary px-3 py-2 text-xs font-medium text-warm-paper transition hover:bg-warm-primary/90"
              >
                <Save className="h-3.5 w-3.5" />
                应用 {workflowPlanPreview.estimatedCount} 张计划到画布
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (showAdvancedControls) setActiveDrawerTool(null);
                setShowAdvancedControls((value) => !value);
              }}
              className={cn(
                "inline-flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition",
                showAdvancedControls
                  ? "border-warm-primary/40 bg-warm-primary-soft text-warm-primary"
                  : "border-warm-line/60 bg-warm-bg text-warm-muted hover:border-warm-primary/40 hover:text-warm-primary"
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {showAdvancedControls ? "收起管理工具" : "管理工具"}
            </button>
          </div>
        }
        className="border-b border-warm-line/50"
      />

      {showAdvancedControls && (
        <>
          <div className="border-b border-warm-line/50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-warm-muted">
                  管理工具
                </h3>
                <p className="mt-1 text-xs leading-snug text-warm-muted">
                  {activeDrawerToolConfig
                    ? activeDrawerToolConfig.description
                    : "按需打开后台能力，不打断画布结果。"}
                </p>
              </div>
              {activeDrawerTool ? (
                <button
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1 text-[11px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary"
                  type="button"
                  onClick={() => setActiveDrawerTool(null)}
                >
                  <ChevronRight className="h-3 w-3 rotate-180" />
                  返回
                </button>
              ) : (
                <button
                  className="rounded-md p-1.5 text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink"
                  type="button"
                  title="收起管理工具"
                  onClick={() => setShowAdvancedControls(false)}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
              )}
            </div>

            {activeDrawerTool ? (
              <div className="mt-3 rounded-md border border-warm-line/50 bg-warm-bg px-2.5 py-2 text-xs font-medium text-warm-ink">
                {activeDrawerToolConfig?.label}
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  {drawerPrimaryToolOptions.map((tool) => {
                    const ToolIcon = tool.icon;
                    return (
                      <button
                        key={tool.id}
                        type="button"
                        onClick={() => setActiveDrawerTool(tool.id)}
                        className="min-w-0 rounded-lg border border-warm-line/50 bg-warm-bg p-2.5 text-left transition hover:border-warm-primary/35 hover:bg-warm-soft/45"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-warm-primary-soft text-warm-primary">
                            <ToolIcon className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 truncate text-xs font-medium text-warm-ink">
                            {tool.label}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-warm-muted">
                          {tool.description}
                        </p>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setShowDrawerAdvancedTools((value) => !value)}
                  className="flex w-full items-center justify-between rounded-md border border-warm-line/45 bg-warm-bg/70 px-2.5 py-2 text-left text-xs font-medium text-warm-muted transition hover:border-warm-primary/35 hover:text-warm-primary"
                >
                  <span>高级工具</span>
                  <ChevronRight
                    className={cn("h-3.5 w-3.5 transition", showDrawerAdvancedTools && "rotate-90")}
                  />
                </button>

                {showDrawerAdvancedTools && (
                  <div className="grid grid-cols-2 gap-2">
                    {drawerAdvancedToolOptions.map((tool) => {
                      const ToolIcon = tool.icon;
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          onClick={() => setActiveDrawerTool(tool.id)}
                          className="min-w-0 rounded-lg border border-warm-line/50 bg-warm-bg p-2.5 text-left transition hover:border-warm-primary/35 hover:bg-warm-soft/45"
                        >
                          <div className="flex items-center gap-2">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-warm-soft text-warm-muted">
                              <ToolIcon className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0 truncate text-xs font-medium text-warm-ink">
                              {tool.label}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-warm-muted">
                            {tool.description}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

      {activeDrawerTool === "templates" && workflowPlanPreview && (
        <div className="border-b border-warm-line/50 p-4">
          <div className="rounded-lg border border-warm-line/50 bg-warm-bg p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="block truncate text-xs font-medium text-warm-ink">
                  计划预览 · {workflowPlanPreview.title}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-warm-muted">
                  {workflowPlanPreview.summary}
                </span>
              </div>
              <span className="shrink-0 rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">
                {workflowPlanPreview.estimatedCount} 张
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onApplyWorkflowPlan}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-warm-primary px-3 py-2 text-xs font-medium text-warm-paper transition hover:bg-warm-primary/90"
              >
                <Save className="h-3.5 w-3.5" />
                应用计划
              </button>
              <button
                type="button"
                onClick={onDismissWorkflowPlan}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-warm-line/60 bg-warm-bg px-3 py-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary"
              >
                关闭预览
              </button>
            </div>
            <div className="mt-2 space-y-1.5">
              {workflowPlanPreview.items.slice(0, 4).map((item) => (
                <div key={item.id} className="rounded-md bg-warm-paper px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-medium text-warm-ink">
                      {item.title}
                    </span>
                    <span className="shrink-0 rounded bg-warm-bg px-1.5 py-0.5 text-[10px] text-warm-muted">
                      {item.ratio}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-[10px] text-warm-muted">
                    {item.purpose}
                  </p>
                </div>
              ))}
            </div>
            {workflowPlanPreview.editableParameters.length > 0 && (
              <div className="mt-3 border-t border-warm-line/50 pt-2">
                <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-warm-muted">
                  可调参数
                </span>
                <div className="mt-2 space-y-2">
                  {workflowPlanPreview.editableParameters.slice(0, 3).map((group) => (
                    <div key={group.nodeId} className="rounded-md bg-warm-paper px-2 py-2">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] font-medium text-warm-ink">
                          {group.title}
                        </span>
                        <span className="shrink-0 rounded bg-warm-bg px-1.5 py-0.5 text-[10px] text-warm-muted">
                          {group.fields.length}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {group.fields.slice(0, 3).map((field) => (
                          <WorkflowPlanParameterField
                            key={`${group.nodeId}:${field.key}`}
                            field={field}
                            onChange={(value) => onUpdateWorkflowPlanParameter(group.nodeId, field.key, value)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={cn("border-b border-warm-line/50 p-4", activeDrawerTool !== "import" && "hidden")}>
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-warm-primary" />
          <h3 className="text-sm font-medium text-warm-ink">批量商品导入</h3>
        </div>
        <textarea
          value={productImportText}
          onChange={(event) => onProductImportTextChange(event.target.value)}
          rows={4}
          className="mt-3 w-full resize-none rounded-md border border-warm-line/60 bg-warm-bg px-2.5 py-2 text-xs leading-snug text-warm-ink outline-none transition placeholder:text-warm-muted/60 focus:border-warm-primary/60"
          placeholder="粘贴 JSON、CSV 或 key:value 商品参数"
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={previewingProductImport || savingProductImport || !productImportText.trim()}
            onClick={onPreviewProductImport}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-warm-line/60 bg-warm-bg px-3 py-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:opacity-50"
          >
            {previewingProductImport ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            预览
          </button>
          <button
            type="button"
            disabled={previewingProductImport || savingProductImport || !productImportText.trim()}
            onClick={onSaveProductImport}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-warm-primary px-3 py-2 text-xs font-medium text-warm-paper transition hover:bg-warm-primary/90 disabled:opacity-50"
          >
            {savingProductImport ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            保存组件
          </button>
        </div>
        {productImportMessage && (
          <div className="mt-2 rounded-md bg-warm-primary-soft px-2.5 py-2 text-xs text-warm-primary">
            {productImportMessage}
          </div>
        )}
        {activeProductComponentTitle && (
          <div className="mt-3 rounded-lg border border-warm-line/50 bg-warm-bg p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] font-medium text-warm-ink">
                {activeProductComponentTitle}
              </span>
              <span className="shrink-0 rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">
                已接入
              </span>
            </div>
            <button
              type="button"
              disabled={composingWorkflow || previewingProductImport || savingProductImport}
              onClick={onComposeImportedProductWorkflow}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md bg-warm-ink px-3 py-2 text-xs font-medium text-warm-paper transition hover:bg-warm-ink/90 disabled:opacity-50"
            >
              {composingWorkflow ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              生成商品工作流
            </button>
          </div>
        )}
        {productImportPreview && (
          <div className="mt-3 rounded-lg border border-warm-line/50 bg-warm-bg p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-warm-ink">导入预览</span>
              <span className="rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">
                {productImportPreview.parsedProducts.length} 商品
              </span>
            </div>
            <div className="mt-2 space-y-1.5">
              {productImportPreview.parsedProducts.slice(0, 3).map((product, index) => (
                <div key={`${product.title}-${index}`} className="rounded-md bg-warm-paper px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-medium text-warm-ink">
                      {product.title}
                    </span>
                    <span className="shrink-0 rounded bg-warm-bg px-1.5 py-0.5 text-[10px] text-warm-muted">
                      {product.category || "商品"}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-[10px] text-warm-muted">
                    {product.sellingPoints.slice(0, 3).join(" / ") || product.description}
                  </p>
                </div>
              ))}
            </div>
            {productImportPreview.rejectedRows.length > 0 && (
              <div className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-[10px] text-red-700">
                {productImportPreview.rejectedRows.length} 行未解析
              </div>
            )}
          </div>
        )}
      </div>

      <div className={cn("border-b border-warm-line/50 p-4", activeDrawerTool !== "review" && "hidden")}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-warm-primary" />
            <h3 className="text-sm font-medium text-warm-ink">审核工作台</h3>
          </div>
          {reviewSession && (
            <span className={cn("rounded px-1.5 py-0.5 text-[10px]", getReviewSessionStatusClassName(reviewSession.status))}>
              {getReviewSessionStatusLabel(reviewSession.status)}
            </span>
          )}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button
            type="button"
            disabled={!focusedBatch || !focusedManifest || reviewActionKey === "create:batch"}
            onClick={handleCreateReviewSessionFromBatch}
            className="rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1.5 text-[11px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:opacity-45"
          >
            {reviewActionKey === "create:batch" ? "创建中" : "当前批次"}
          </button>
          <button
            type="button"
            disabled={reviewActionKey === "create:demo"}
            onClick={handleCreateDemoReviewSession}
            className="rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1.5 text-[11px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:opacity-45"
          >
            {reviewActionKey === "create:demo" ? "创建中" : "演示"}
          </button>
          <button
            type="button"
            onClick={loadLatestReviewSession}
            className="rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1.5 text-[11px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary"
          >
            刷新
          </button>
        </div>
        {reviewSessionMessage && (
          <div className="mt-2 rounded-md bg-warm-primary-soft px-2.5 py-2 text-xs text-warm-primary">
            {reviewSessionMessage}
          </div>
        )}
        {reviewSession ? (
          <div className="mt-3 rounded-lg border border-warm-line/50 bg-warm-bg p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="block truncate text-xs font-medium text-warm-ink">
                  {reviewSession.title}
                </span>
                <span className="mt-0.5 block text-[11px] text-warm-muted">
                  {getReviewCounterLabel(reviewSession)}
                </span>
              </div>
              <span className="shrink-0 rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">
                {reviewSession.itemList.length} 图
              </span>
            </div>
            <div className="mt-2 space-y-2">
              {reviewSession.itemList.slice(0, 4).map((item) => {
                const itemActionPrefix = `${item.id}`;
                const noteValue = reviewNotesByItemId[item.id] ?? "";
                return (
                  <div key={item.id} className="rounded-md border border-warm-line/40 bg-warm-paper px-2 py-2">
                    <div className="flex items-start gap-2">
                      <AssetPreview
                        src={item.imageUrl || "/canvas-assets/product-main.svg"}
                        alt={item.title}
                        icon={ImageIcon}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="line-clamp-2 text-[11px] font-medium text-warm-ink">
                            {item.title}
                          </span>
                          <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px]", getReviewItemStatusClassName(item.status))}>
                            {getReviewItemStatusLabel(item.status)}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          <button
                            type="button"
                            disabled={reviewActionKey === `approve_item:${itemActionPrefix}`}
                            onClick={() => handleReviewSessionAction("approve_item", item.id)}
                            className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                          >
                            通过
                          </button>
                          <button
                            type="button"
                            disabled={reviewActionKey === `reject_item:${itemActionPrefix}`}
                            onClick={() => handleReviewSessionAction("reject_item", item.id)}
                            className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                          >
                            打回
                          </button>
                          <button
                            type="button"
                            disabled={reviewActionKey === `request_revision:${itemActionPrefix}`}
                            onClick={() => handleReviewSessionAction("request_revision", item.id)}
                            className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                          >
                            需改
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      <input
                        value={noteValue}
                        onChange={(event) =>
                          setReviewNotesByItemId((items) => ({ ...items, [item.id]: event.target.value }))
                        }
                        className="min-w-0 flex-1 rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1 text-[11px] text-warm-ink outline-none placeholder:text-warm-muted/60 focus:border-warm-primary/50"
                        placeholder="备注"
                      />
                      <button
                        type="button"
                        disabled={!noteValue.trim() || reviewActionKey === `add_note:${itemActionPrefix}`}
                        onClick={() => handleReviewSessionAction("add_note", item.id)}
                        className="shrink-0 rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1 text-[11px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:opacity-45"
                      >
                        记
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {reviewSession.notes.length > 0 && (
              <div className="mt-2 rounded-md bg-warm-paper px-2 py-1.5 text-[10px] text-warm-muted">
                最新备注：{reviewSession.notes[reviewSession.notes.length - 1]}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-dashed border-warm-line bg-warm-bg px-2.5 py-3 text-xs text-warm-muted">
            暂无审核会话，可从当前导出包批次或演示数据创建
          </div>
        )}
      </div>

      <div className={cn("border-b border-warm-line/50 p-4", activeDrawerTool !== "diagnostics" && "hidden")}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CircleDot className="h-4 w-4 text-warm-primary" />
            <h3 className="text-sm font-medium text-warm-ink">生成安全</h3>
          </div>
          <a
            href="/settings"
            className="rounded border border-warm-line/60 bg-warm-bg px-2 py-1 text-[10px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary"
          >
            设置
          </a>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-md border border-warm-line/50 bg-warm-bg px-2.5 py-2">
            <span className="block text-[10px] text-warm-muted">Image key</span>
            <span className={cn("mt-1 block text-xs font-medium", getProviderReadyClassName(providerReadiness))}>
              {getProviderReadyLabel(providerReadiness)}
            </span>
          </div>
          <div className="rounded-md border border-warm-line/50 bg-warm-bg px-2.5 py-2">
            <span className="block text-[10px] text-warm-muted">Model</span>
            <span className="mt-1 block truncate text-xs font-medium text-warm-ink">
              {providerReadiness?.imageModel || "未读取"}
            </span>
          </div>
        </div>
        <div className="mt-2 rounded-md bg-warm-bg px-2.5 py-2 text-[11px] text-warm-muted">
          {getGenerationSafetyLabel(providerReadiness, queueSnapshot)}
        </div>
        <div className="mt-3 rounded-lg border border-warm-line/50 bg-warm-bg p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="block text-xs font-medium text-warm-ink">队列状态</span>
              <span className="mt-0.5 block truncate text-[11px] text-warm-muted">
                Owner: {queueHealth.owner} · 并发 {queueHealth.concurrency}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={queueLoading || reclaimingStaleJobs}
                onClick={onRefreshQueue}
                className="inline-flex items-center gap-1 rounded border border-warm-line/60 bg-warm-paper px-2 py-1 text-[10px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:opacity-45"
                title="刷新队列状态"
              >
                {queueLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RotateCw className="h-3 w-3" />
                )}
                刷新
              </button>
              <button
                type="button"
                disabled={reclaimingStaleJobs}
                onClick={onReclaimStaleJobs}
                className="inline-flex items-center gap-1 rounded border border-warm-line/60 bg-warm-paper px-2 py-1 text-[10px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:opacity-45"
                title="POST /api/jobs/queue action=reclaim enqueue=false，不启动 provider"
              >
                {reclaimingStaleJobs ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RotateCcw className="h-3 w-3" />
                )}
                回收 stale jobs
              </button>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <QueueMetric label="待运行" value={queueHealth.pending} />
            <QueueMetric label="排队" value={queueHealth.queued} />
            <QueueMetric label="运行" value={queueHealth.running} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <QueueMetric label="活动租约" value={queueHealth.activeLeases} />
            <QueueMetric label="卡住" value={queueHealth.stale} />
            <QueueMetric label="过期" value={queueHealth.expired} />
            <QueueMetric label="缺租约" value={queueHealth.missingLease} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-warm-muted">
            <span>{queueSnapshot ? getQueueRuntimeLabel(queueSnapshot) : "队列快照未读取"}</span>
            <span>{queueSnapshot ? getQueueStaleLabel(queueSnapshot) : "可手动刷新"}</span>
          </div>
          {queueMessage && (
            <div className="mt-2 rounded-md bg-warm-primary-soft px-2 py-1.5 text-[11px] text-warm-primary">
              {queueMessage}
            </div>
          )}
        </div>
      </div>

      <div className={cn("border-b border-warm-line/50 p-4", activeDrawerTool !== "projects" && "hidden")}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers3 className="h-4 w-4 text-warm-primary" />
            <h3 className="text-sm font-medium text-warm-ink">项目批次</h3>
          </div>
          <button
            type="button"
            onClick={onRefreshProjects}
            className="rounded border border-warm-line/60 bg-warm-bg px-2 py-1 text-[10px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary"
          >
            刷新
          </button>
        </div>
        {projects.length > 0 ? (
          <div className="mt-3 space-y-2">
            <label className="block text-[11px] text-warm-muted">
              <span className="mb-1 block">Project</span>
              <select
                value={selectedProject?.id ?? ""}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                className="w-full rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1.5 text-xs text-warm-ink outline-none focus:border-warm-primary/60"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </label>
            {selectedProject && (
              <div className="grid grid-cols-[1fr_auto] gap-1.5">
                <input
                  value={projectRenameTitle}
                  onChange={(event) => setProjectRenameTitle(event.target.value)}
                  className="min-w-0 rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1.5 text-xs text-warm-ink outline-none placeholder:text-warm-muted/60 focus:border-warm-primary/60"
                  placeholder="项目显示名"
                />
                <button
                  type="button"
                  disabled={
                    updatingProjectEntity !== null ||
                    creatingProjectEntity !== null ||
                    !projectRenameTitle.trim() ||
                    projectRenameTitle.trim() === selectedProject.title
                  }
                  onClick={handleRenameProject}
                  className="inline-flex items-center gap-1 rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1.5 text-[11px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:opacity-45"
                >
                  {updatingProjectEntity === "project" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                  改名
                </button>
              </div>
            )}
            {selectedProject && selectedProject.campaigns.length > 0 && (
              <>
                <label className="block text-[11px] text-warm-muted">
                  <span className="mb-1 block">Campaign</span>
                  <select
                    value={selectedCampaign?.id ?? ""}
                    onChange={(event) => setSelectedCampaignId(event.target.value)}
                    className="w-full rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1.5 text-xs text-warm-ink outline-none focus:border-warm-primary/60"
                  >
                    {selectedProject.campaigns.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.title}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedCampaign && (
                  <div className="grid grid-cols-[1fr_auto] gap-1.5">
                    <input
                      value={campaignRenameTitle}
                      onChange={(event) => setCampaignRenameTitle(event.target.value)}
                      className="min-w-0 rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1.5 text-xs text-warm-ink outline-none placeholder:text-warm-muted/60 focus:border-warm-primary/60"
                      placeholder="活动显示名"
                    />
                    <button
                      type="button"
                      disabled={
                        updatingProjectEntity !== null ||
                        creatingProjectEntity !== null ||
                        !campaignRenameTitle.trim() ||
                        campaignRenameTitle.trim() === selectedCampaign.title
                      }
                      onClick={handleRenameCampaign}
                      className="inline-flex items-center gap-1 rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1.5 text-[11px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:opacity-45"
                    >
                      {updatingProjectEntity === "campaign" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Save className="h-3 w-3" />
                      )}
                      改名
                    </button>
                  </div>
                )}
              </>
            )}
            {selectedProject && (
              <label className="block text-[11px] text-warm-muted">
                <span className="mb-1 block">Batch</span>
                <select
                  value={selectedProjectBatch?.id ?? ""}
                  onChange={(event) => setSelectedProjectBatchId(event.target.value)}
                  className="w-full rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1.5 text-xs text-warm-ink outline-none focus:border-warm-primary/60"
                >
                  {selectedProject.batches.length > 0 ? (
                    selectedProject.batches.map((batch) => (
                      <option key={batch.id} value={batch.id}>
                        {batch.title} · {getBatchStateLabel(batch.batchState?.state ?? batch.state)}
                      </option>
                    ))
                  ) : (
                    <option value="">暂无批次</option>
                  )}
                </select>
              </label>
            )}
            <div className="grid grid-cols-[1fr_auto] gap-1.5">
              <input
                value={newProjectTitle}
                onChange={(event) => setNewProjectTitle(event.target.value)}
                className="min-w-0 rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1.5 text-xs text-warm-ink outline-none placeholder:text-warm-muted/60 focus:border-warm-primary/60"
                placeholder="新项目名"
              />
              <button
                type="button"
                disabled={creatingProjectEntity !== null || !newProjectTitle.trim()}
                onClick={handleCreateProject}
                className="inline-flex items-center gap-1 rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1.5 text-[11px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:opacity-45"
              >
                {creatingProjectEntity === "project" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                项目
              </button>
            </div>
            {selectedProject && (
              <div className="grid grid-cols-[1fr_auto] gap-1.5">
                <input
                  value={newCampaignTitle}
                  onChange={(event) => setNewCampaignTitle(event.target.value)}
                  className="min-w-0 rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1.5 text-xs text-warm-ink outline-none placeholder:text-warm-muted/60 focus:border-warm-primary/60"
                  placeholder="当前项目下的新活动"
                />
                <button
                  type="button"
                  disabled={creatingProjectEntity !== null || !newCampaignTitle.trim()}
                  onClick={handleCreateCampaign}
                  className="inline-flex items-center gap-1 rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1.5 text-[11px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:opacity-45"
                >
                  {creatingProjectEntity === "campaign" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  活动
                </button>
              </div>
            )}
            {selectedProject?.reviewSummary && (
              <ProjectReviewSummaryCard
                title="项目审核"
                summary={selectedProject.reviewSummary}
              />
            )}
            {selectedProjectBatch ? (
              <div className="rounded-lg border border-warm-line/50 bg-warm-bg p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="block truncate text-xs font-medium text-warm-ink">
                      {selectedProjectBatch.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-warm-muted">
                      {selectedProjectBatch.kind} · {selectedProjectBatch.id}
                    </span>
                  </div>
                  <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px]", getBatchStateClassName(selectedProjectBatch.batchState?.state ?? selectedProjectBatch.state))}>
                    {getBatchStateLabel(selectedProjectBatch.batchState?.state ?? selectedProjectBatch.state)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-warm-muted">
                  <span>{selectedProject?.campaigns.length ?? 0} campaigns</span>
                  <span>{selectedProject?.batches.length ?? 0} batches</span>
                </div>
                {getBatchArchiveCleanupLabel(selectedProjectBatch.metadata) && (
                  <div className="mt-2 rounded-md bg-warm-paper px-2 py-1.5 text-[11px] text-warm-muted">
                    {getBatchArchiveCleanupLabel(selectedProjectBatch.metadata)}
                  </div>
                )}
                {getBatchPartialResultLabel(selectedProjectBatch.metadata) && (
                  <div className="mt-2 rounded-md border border-warm-clay/20 bg-warm-clay/10 px-2 py-1.5 text-[11px] text-warm-clay">
                    {getBatchPartialResultLabel(selectedProjectBatch.metadata)}
                  </div>
                )}
                {selectedProjectBatch.reviewSummary && (
                  <div className="mt-2 border-t border-warm-line/50 pt-2">
                    <ProjectReviewSummaryCard
                      title="批次审核"
                      summary={selectedProjectBatch.reviewSummary}
                      compact
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-warm-line bg-warm-bg px-2.5 py-3 text-xs text-warm-muted">
                当前项目暂无批次
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-dashed border-warm-line bg-warm-bg px-2.5 py-3 text-xs text-warm-muted">
            暂无项目数据，创建导出包或刷新 manifest 后会自动建立默认项目
          </div>
        )}
        {projectMessage && (
          <div className="mt-2 rounded-md bg-warm-primary-soft px-2.5 py-2 text-xs text-warm-primary">
            {projectMessage}
          </div>
        )}
        {projectFormMessage && (
          <div className="mt-2 rounded-md bg-warm-primary-soft px-2.5 py-2 text-xs text-warm-primary">
            {projectFormMessage}
          </div>
        )}
      </div>

      <div className={cn("border-b border-warm-line/50 p-4", activeDrawerTool !== "export" && "hidden")}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PackageCheck className="h-4 w-4 text-warm-primary" />
            <h3 className="text-sm font-medium text-warm-ink">导出包</h3>
          </div>
          <span className="rounded bg-warm-line/30 px-1.5 py-0.5 text-[10px] text-warm-muted">
            {exportPackRules.length}
          </span>
        </div>
        {exportPackMessage && (
          <div className="mt-3 rounded-md bg-warm-primary-soft px-2.5 py-2 text-xs text-warm-primary">
            {exportPackMessage}
          </div>
        )}
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {exportPackRules.map((rule) => {
            const totalCount = getExportPackTotalCount(rule);
            const firstSpec = rule.specs[0];
            return (
              <button
                key={rule.id}
                type="button"
                onClick={() => onCreateExportPack(rule)}
                title={rule.description}
                className="rounded-lg border border-warm-line/50 bg-warm-bg p-2.5 text-left transition hover:border-warm-primary/30 hover:bg-warm-soft/45"
              >
                <span className="block truncate text-xs font-medium text-warm-ink">
                  {rule.title}
                </span>
                <span className="mt-1 block truncate text-[11px] text-warm-muted">
                  {rule.items.length} 项 · {firstSpec?.size ?? "多尺寸"} · {totalCount} 张
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={cn("border-b border-warm-line/50 p-4", activeDrawerTool !== "export" && "hidden")}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CircleDot className="h-4 w-4 text-warm-primary" />
            <h3 className="text-sm font-medium text-warm-ink">导出包批次</h3>
          </div>
          <span className="rounded bg-warm-line/30 px-1.5 py-0.5 text-[10px] text-warm-muted">
            {exportPackBatches.length}
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {exportPackBatches.length > 0 ? (
            exportPackBatches.map((batch) => {
              const qaItems = [...batch.qaGaps, ...batch.qaChecklist].slice(0, 4);
              const manifest = exportPackManifestByBatchId.get(batch.batchId);
              const qaReport = exportPackQaByBatchId.get(batch.batchId);
              const manifestLabel = getManifestSummaryLabel(batch, manifest);
              const qaLabel = getQaCardLabel(batch, qaReport);
              const canReviewQa = canMarkBatchQaPassed(qaReport);
              const canDownloadApprovedZip = (qaReport?.counts.passed ?? 0) > 0;
              const firstNaming = getFirstManifestNaming(manifest);
              const batchState = batch.batchState;
              const stateName = batchState?.state;
              const canLockBatch = batchState?.canTransitionTo.includes("locked") === true;
              const canDeliverBatch = batchState?.canTransitionTo.includes("delivered") === true;
              const canArchiveBatchJobs = canArchiveExportPackBatchJobs(batch);
              return (
                <div
                  key={batch.batchId}
                  onClick={() => {
                    setFocusedBatchId(batch.batchId);
                    onSelectBatch(batch, manifest);
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setFocusedBatchId(batch.batchId);
                      onSelectBatch(batch, manifest);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "w-full cursor-pointer rounded-lg border bg-warm-bg p-2.5 text-left transition hover:border-warm-primary/30 hover:bg-warm-soft/45 focus:outline-none focus:ring-2 focus:ring-warm-primary/20",
                    batch.relatedToSelectedNode ? "border-warm-primary/40" : "border-warm-line/50"
                  )}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 sm:flex-1">
                      <span className="block truncate text-xs font-medium text-warm-ink">
                        {batch.title}
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-warm-muted">
                        {batch.platform} · {getBatchSizeSummary(batch)}
                      </span>
                    </div>
                    <div className="flex max-w-full flex-wrap items-center gap-1 sm:shrink-0 sm:justify-end">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          window.open(
                            `/api/export-packs/${encodeURIComponent(batch.batchId)}/download`,
                            "_blank",
                            "noopener,noreferrer"
                          );
                        }}
                        className="rounded border border-warm-line/50 bg-warm-paper px-1.5 py-0.5 text-[10px] font-medium text-warm-ink transition hover:border-warm-primary/30 hover:text-warm-primary"
                        title="下载导出包 ZIP"
                      >
                        ZIP
                      </button>
                      <button
                        type="button"
                        disabled={!canDownloadApprovedZip}
                        onClick={(event) => {
                          event.stopPropagation();
                          window.open(
                            `/api/export-packs/${encodeURIComponent(batch.batchId)}/download?approvedOnly=1`,
                            "_blank",
                            "noopener,noreferrer"
                          );
                        }}
                        className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-45"
                        title="只下载 QA 通过的图片"
                      >
                        过审
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          window.open(
                            `/api/export-packs/${encodeURIComponent(batch.batchId)}/manifest?download=1`,
                            "_blank",
                            "noopener,noreferrer"
                          );
                        }}
                        className="rounded border border-warm-line/50 bg-warm-paper px-1.5 py-0.5 text-[10px] font-medium text-warm-ink transition hover:border-warm-primary/30 hover:text-warm-primary"
                        title="下载 JSON manifest"
                      >
                        JSON
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          window.open(
                            `/api/export-packs/${encodeURIComponent(batch.batchId)}/qa`,
                            "_blank",
                            "noopener,noreferrer"
                          );
                        }}
                        className="rounded border border-warm-line/50 bg-warm-paper px-1.5 py-0.5 text-[10px] font-medium text-warm-ink transition hover:border-warm-primary/30 hover:text-warm-primary"
                        title="查看 QA JSON"
                      >
                        QA
                      </button>
                      <button
                        type="button"
                        disabled={!canReviewQa || reviewingBatchId === batch.batchId}
                        onClick={(event) => {
                          event.stopPropagation();
                          onMarkBatchQaPassed(batch, qaReport);
                        }}
                        className="rounded border border-warm-line/50 bg-warm-paper px-1.5 py-0.5 text-[10px] font-medium text-warm-ink transition hover:border-warm-primary/30 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
                        title="将已完成产物的人工 QA 项标记通过"
                      >
                        {reviewingBatchId === batch.batchId ? "..." : "验收"}
                      </button>
                      <button
                        type="button"
                        disabled={!canArchiveBatchJobs || archivingBatchId === batch.batchId}
                        onClick={(event) => {
                          event.stopPropagation();
                          onArchiveBatchJobs(batch);
                        }}
                        className="rounded border border-warm-line/50 bg-warm-paper px-1.5 py-0.5 text-[10px] font-medium text-warm-ink transition hover:border-warm-primary/30 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
                        title="取消这个批次内未完成 jobs，并把清理结果写入批次 metadata；不删除图片、不启动 provider"
                      >
                        {archivingBatchId === batch.batchId ? (
                          "..."
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Archive className="h-2.5 w-2.5" />
                            归档
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={!canLockBatch || transitioningBatchId === `${batch.batchId}:locked`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onUpdateBatchState(batch, "locked");
                        }}
                        className="rounded border border-warm-line/50 bg-warm-paper px-1.5 py-0.5 text-[10px] font-medium text-warm-ink transition hover:border-warm-primary/30 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
                        title="锁定导出包，防止继续修改 QA 和交付内容"
                      >
                        {transitioningBatchId === `${batch.batchId}:locked` ? (
                          "..."
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <LockKeyhole className="h-2.5 w-2.5" />
                            锁定
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={!canDeliverBatch || transitioningBatchId === `${batch.batchId}:delivered`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onUpdateBatchState(batch, "delivered");
                        }}
                        className="rounded border border-warm-line/50 bg-warm-paper px-1.5 py-0.5 text-[10px] font-medium text-warm-ink transition hover:border-warm-primary/30 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
                        title="标记为已交付"
                      >
                        {transitioningBatchId === `${batch.batchId}:delivered` ? (
                          "..."
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Send className="h-2.5 w-2.5" />
                            交付
                          </span>
                        )}
                      </button>
                      <span className="rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">
                        {batch.statusLabel}
                      </span>
                    </div>
                  </div>
                  {stateName && (
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-warm-muted">
                      <span>Batch state</span>
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px]", getBatchStateClassName(stateName))}>
                        {getBatchStateLabel(stateName)}
                      </span>
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-warm-muted">
                    <span className="font-medium text-warm-ink">{batch.progressLabel}</span>
                    <span>{getBatchQueueSummary(batch)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-warm-muted">
                    <span className="truncate">{manifestLabel}</span>
                      <span className={cn("min-w-0 shrink-0 truncate rounded px-1.5 py-0.5 text-[10px]", getQaCardClassName(qaReport))}>
                      {qaLabel}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-warm-muted">
                    {firstNaming && (
                      <span className="shrink-0 truncate rounded bg-warm-paper px-1.5 py-0.5 text-[10px]">
                        {firstNaming}
                      </span>
                    )}
                  </div>
                  {qaItems.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {qaItems.map((item) => {
                        const isGap = batch.qaGaps.includes(item);
                        return (
                          <span
                            key={item}
                            className={cn(
                              "max-w-full truncate rounded px-1.5 py-0.5 text-[10px]",
                              isGap
                                ? "bg-red-50 text-red-700"
                                : "bg-warm-paper text-warm-muted"
                            )}
                          >
                            {item}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="rounded-md border border-dashed border-warm-line bg-warm-bg px-2.5 py-3 text-xs text-warm-muted">
              暂无导出包批次，规划导出包后会在这里汇总
            </div>
          )}
        </div>
        {focusedBatch && focusedBatchRunSummary && (
          <div className="mt-3 rounded-lg border border-warm-line/50 bg-warm-bg p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="block truncate text-xs font-medium text-warm-ink">
                  生成证据 · {focusedBatch.title}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-warm-muted">
                  {focusedBatchRunSummary.providerLabel} · {focusedBatchRunSummary.modelLabel}
                </span>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                  getFocusedBatchRunToneClassName(focusedBatchRunSummary.tone)
                )}
              >
                {focusedBatchRunSummary.statusLabel}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <BatchEvidenceMetric label="调用" value={focusedBatchRunSummary.callLabel} />
              <BatchEvidenceMetric label="重试" value={focusedBatchRunSummary.retryLabel} />
              <BatchEvidenceMetric label="参考图" value={focusedBatchRunSummary.referenceLabel} />
              <BatchEvidenceMetric label="ZIP" value={focusedBatchRunSummary.zipLabel} />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <BatchEvidenceMetric label="产物" value={focusedBatchRunSummary.resultLabel} />
              <BatchEvidenceMetric label="队列" value={focusedBatchRunSummary.queueLabel} />
              <BatchEvidenceMetric label="QA" value={focusedBatchRunSummary.qaLabel} />
            </div>
            {focusedBatchRunSummary.issues.length > 0 && (
              <div className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-[10px] leading-4 text-red-700">
                {focusedBatchRunSummary.issues.slice(0, 2).join(" · ")}
              </div>
            )}
            {focusedBatchRunSummary.diagnostics.length > 0 && (
              <div className="mt-1.5 rounded-md bg-warm-paper px-2 py-1.5 text-[10px] leading-4 text-warm-muted">
                诊断：{focusedBatchRunSummary.diagnostics.slice(0, 2).join(" · ")}
              </div>
            )}
          </div>
        )}
        {focusedBatch && focusedBatchImageItems.length > 0 && (
          <div className="mt-3 rounded-lg border border-warm-line/50 bg-warm-bg p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="block truncate text-xs font-medium text-warm-ink">
                  图片项 · {focusedBatch.title}
                </span>
                <span className="mt-0.5 block text-[11px] text-warm-muted">
                  成功图优先预览，失败项可直接重试
                </span>
              </div>
              <span className="shrink-0 rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">
                {focusedBatchImageItems.length}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {focusedBatchImageItems.slice(0, 6).map((item) => (
                <div
                  key={item.jobId}
                  className={cn(
                    "min-w-0 rounded-md border bg-warm-paper p-2",
                    item.tone === "ready"
                      ? "border-emerald-100"
                      : item.tone === "failed"
                        ? "border-red-100"
                        : "border-warm-line/50"
                  )}
                >
                  <div className="relative">
                    <AssetPreview
                      src={item.previewUrl}
                      alt={item.title}
                      icon={item.icon}
                      size="wide"
                      fit="cover"
                      className={cn(
                        item.previewUrl ? "bg-warm-bg" : "bg-warm-primary-soft",
                        item.tone === "failed" && "border-red-100"
                      )}
                    />
                    <span
                      className={cn(
                        "absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium",
                        getFocusedBatchImageStatusClassName(item.tone)
                      )}
                    >
                      {item.statusLabel}
                    </span>
                  </div>
                  <div className="mt-2 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-[11px] font-medium text-warm-ink">
                        {item.title}
                      </span>
                      {item.sizeLabel && (
                        <span className="shrink-0 rounded bg-warm-bg px-1.5 py-0.5 text-[10px] text-warm-muted">
                          {item.sizeLabel}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 min-h-[2rem] text-[11px] leading-4 text-warm-muted">
                      {item.reason}
                    </p>
                    <BatchImageReferenceStrip
                      summary={item.referenceSummary}
                      diagnosticSummary={item.diagnosticSummary}
                      tone={item.tone}
                    />
                    {item.job && canRetryImageJob(item.job) && (
                      <button
                        type="button"
                        disabled={runningJobId === item.job.id}
                        onClick={() => {
                          if (item.job) onRetryImageJob(item.job);
                        }}
                        className="mt-2 inline-flex items-center gap-1 rounded border border-warm-line/60 bg-warm-bg px-2 py-1 text-[11px] font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-50"
                        title="带参考图重做当前图片"
                      >
                        {runningJobId === item.job.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                        带参考图重做
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {focusedBatchImageItems.length > 6 && (
              <p className="mt-2 text-[11px] text-warm-muted">
                已显示前 6 张，完整列表可在导出包产物中继续筛选
              </p>
            )}
          </div>
        )}
        {focusedBatch && focusedQaReport && (
          <div className="mt-3 rounded-lg border border-warm-line/50 bg-warm-bg p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="block truncate text-xs font-medium text-warm-ink">
                  QA 明细 · {focusedBatch.title}
                </span>
                <span className="mt-0.5 block text-[11px] text-warm-muted">
                  {focusedQaReport.summaryLabel}
                </span>
              </div>
              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px]", getQaCardClassName(focusedQaReport))}>
                {focusedQaReport.counts.passed}/{focusedQaReport.counts.total}
              </span>
            </div>
            <div className="mt-2 space-y-2">
              {focusedQaReport.items.slice(0, 3).map((item) => (
                <div key={item.jobId} className="rounded-md border border-warm-line/40 bg-warm-paper px-2 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-medium text-warm-ink">
                      {item.title}
                    </span>
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px]", getQaStatusClassName(item.status))}>
                      {getQaStatusLabel(item.status)}
                    </span>
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {item.checks.map((check) => {
                      const canReview = item.artifactStatus === "ready" && check.status === "manual";
                      const reviewKey = `${focusedBatch.batchId}:${item.jobId}:${check.id}`;
                      return (
                        <div key={check.id} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="min-w-0 truncate text-warm-muted">
                            {check.label}
                          </span>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className={cn("rounded px-1.5 py-0.5 text-[10px]", getQaStatusClassName(check.status))}>
                              {getQaStatusLabel(check.status)}
                            </span>
                            {canReview && (
                              <>
                                <button
                                  type="button"
                                  disabled={reviewingCheckKey === reviewKey}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onUpdateQaReview(focusedBatch, item.jobId, check.id, "pass");
                                  }}
                                  className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                                  title="标记通过"
                                >
                                  过
                                </button>
                                <button
                                  type="button"
                                  disabled={reviewingCheckKey === reviewKey}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onUpdateQaReview(focusedBatch, item.jobId, check.id, "fail");
                                  }}
                                  className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                                  title="标记不通过"
                                >
                                  退
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={cn("border-b border-warm-line/50 p-4", activeDrawerTool !== "queue" && "hidden")}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-warm-primary" />
            <h3 className="text-sm font-medium text-warm-ink">任务队列</h3>
          </div>
          <span className="rounded bg-warm-line/30 px-1.5 py-0.5 text-[10px] text-warm-muted">
            {jobs.length}
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {queueSnapshot && (
            <div className="rounded-md border border-warm-line/50 bg-warm-bg px-2.5 py-2 text-[11px] text-warm-muted">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-warm-ink">{getQueueRuntimeLabel(queueSnapshot)}</span>
                <span className="rounded bg-warm-paper px-1.5 py-0.5 text-[10px]">
                  并发 {queueSnapshot.concurrency}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span>
                  DB: {queueSnapshot.database.pending} 待运行 / {queueSnapshot.database.queued} 排队 / {queueSnapshot.database.running} 运行
                </span>
                <span>{getQueueStaleLabel(queueSnapshot)}</span>
              </div>
            </div>
          )}
          {recentJobs.length > 0 ? (
            recentJobs.map((job) => (
              <div key={job.id} className="rounded-md border border-warm-line/50 bg-warm-bg px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-warm-ink">
                    {getJobNodeLabel(job)}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">
                      {jobStatusLabel[job.status] ?? job.status}
                    </span>
                    {canRunJob(job) && (
                      <button
                        type="button"
                        disabled={runningJobId === job.id}
                        onClick={() => onRunJob(job)}
                        title="运行任务"
                        className="rounded bg-warm-primary px-1.5 py-0.5 text-warm-paper transition hover:bg-warm-primary/90 disabled:opacity-50"
                      >
                        {runningJobId === job.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                      </button>
                    )}
                    {canCancelJob(job) && (
                      <button
                        type="button"
                        disabled={runningJobId === job.id}
                        onClick={() => onCancelJob(job)}
                        title="取消任务"
                        className="rounded bg-warm-paper px-1.5 py-0.5 text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink disabled:opacity-50"
                      >
                        {runningJobId === job.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    )}
                    {canRetryImageJob(job) && (
                      <button
                        type="button"
                        disabled={runningJobId === job.id}
                        onClick={() => onRetryImageJob(job)}
                        title="带参考图重做当前图片"
                        className="rounded bg-warm-paper px-1.5 py-0.5 text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink disabled:opacity-50"
                      >
                        {runningJobId === job.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ImageIcon className="h-3 w-3" />
                        )}
                      </button>
                    )}
                    {canRetryJob(job) && (
                      <button
                        type="button"
                        disabled={runningJobId === job.id}
                        onClick={() => onRetryJob(job)}
                        title="重试任务"
                        className="rounded bg-warm-paper px-1.5 py-0.5 text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink disabled:opacity-50"
                      >
                        {runningJobId === job.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-1 truncate text-[11px] text-warm-muted">
                  {getJobStatusCaption(job)}
                </p>
              </div>
            ))
          ) : (
            <div className="rounded-md border border-dashed border-warm-line bg-warm-bg px-2.5 py-3 text-xs text-warm-muted">
              暂无任务，选择节点后加入队列
            </div>
          )}
        </div>
      </div>

      <div className={cn("border-b border-warm-line/50 p-4", activeDrawerTool !== "outputs" && "hidden")}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-warm-primary" />
            <h3 className="text-sm font-medium text-warm-ink">输出产物</h3>
          </div>
          <span className="rounded bg-warm-line/30 px-1.5 py-0.5 text-[10px] text-warm-muted">
            {filteredArtifacts.length}/{artifacts.length}
          </span>
        </div>
        {artifactMessage && (
          <div className="mt-3 rounded-md bg-warm-primary-soft px-2.5 py-2 text-xs text-warm-primary">
            {artifactMessage}
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-[11px] text-warm-muted">
            <span className="mb-1 block">Scope</span>
            <select
              value={artifactScopeFilter}
              onChange={(event) => setArtifactScopeFilter(event.target.value as ArtifactScopeFilter)}
              className="w-full rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1.5 text-xs text-warm-ink outline-none transition focus:border-warm-primary/60"
            >
              <option value="all">全部</option>
              <option value="selected" disabled={!selectedNode}>当前节点</option>
            </select>
          </label>
          <label className="text-[11px] text-warm-muted">
            <span className="mb-1 block">Status</span>
            <select
              value={artifactStatusFilter}
              onChange={(event) => setArtifactStatusFilter(event.target.value as ArtifactStatusFilter)}
              className="w-full rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1.5 text-xs text-warm-ink outline-none transition focus:border-warm-primary/60"
            >
              {(Object.keys(artifactStatusFilterLabels) as ArtifactStatusFilter[]).map((status) => (
                <option key={status} value={status}>
                  {artifactStatusFilterLabels[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 text-[11px] text-warm-muted">
            <span className="mb-1 block">Type</span>
            <select
              value={artifactTypeFilter}
              onChange={(event) => setArtifactTypeFilter(event.target.value)}
              className="w-full rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1.5 text-xs text-warm-ink outline-none transition focus:border-warm-primary/60"
            >
              <option value="all">全部</option>
              {artifactTypeOptions.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
          {visibleArtifacts.length > 0 ? (
            visibleArtifacts.map((artifact) => {
              const linkedToSelected = !!selectedNode && isArtifactLinkedToNode(artifact, selectedNode);
              return (
                <button
                  key={artifact.id}
                  type="button"
                  onClick={() => onSelectArtifact(artifact)}
                  className={cn(
                    "w-full rounded-lg border bg-warm-bg p-2.5 text-left transition hover:border-warm-primary/30 hover:bg-warm-soft/45",
                    linkedToSelected ? "border-warm-primary/40" : "border-warm-line/50"
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <AssetPreview
                      src={getArtifactPreviewUrl(artifact)}
                      alt={artifact.title}
                      icon={ImageIcon}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-warm-ink">
                          {artifact.title}
                        </span>
                        <span className="shrink-0 rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">
                          {getArtifactStatusLabel(artifact.status)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-warm-muted">
                        {artifact.type} · {artifact.nodeId ? `节点 ${artifact.nodeId}` : "未绑定节点"} · {formatJobTime(artifact.createdAt)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="rounded-md border border-dashed border-warm-line bg-warm-bg px-2.5 py-3 text-xs text-warm-muted">
              {artifacts.length === 0
                ? "暂无输出产物"
                : hasArtifactFilters
                  ? "当前筛选无产物"
                  : "暂无输出产物"}
            </div>
          )}
        </div>
        {filteredArtifacts.length > visibleArtifacts.length && (
          <p className="mt-2 text-[11px] text-warm-muted">
            已显示前 {visibleArtifacts.length} 个，继续调整筛选查看其余产物
          </p>
        )}
      </div>

      <div className={cn("border-b border-warm-line/50 p-4", activeDrawerTool !== "templates" && "hidden")}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SquareStack className="h-4 w-4 text-warm-primary" />
            <h3 className="text-sm font-medium text-warm-ink">工作流模板</h3>
          </div>
          <span className="rounded bg-warm-line/30 px-1.5 py-0.5 text-[10px] text-warm-muted">
            {workflowTemplates.length}
          </span>
        </div>
        {templateMessage && (
          <div className="mt-3 rounded-md bg-warm-primary-soft px-2.5 py-2 text-xs text-warm-primary">
            {templateMessage}
          </div>
        )}
        <div className="mt-3 space-y-2">
          {workflowTemplates.slice(0, 5).map((template) => (
            <button
              key={template.id}
              type="button"
              disabled={!!applyingTemplateId}
              onClick={() => onApplyWorkflowTemplate(template)}
              className="w-full rounded-lg border border-warm-line/50 bg-warm-bg p-2.5 text-left transition hover:border-warm-primary/30 hover:bg-warm-soft/45 disabled:opacity-60"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="block truncate text-xs font-medium text-warm-ink">
                    {template.title}
                  </span>
                  <span className="mt-1 block text-[11px] text-warm-muted">
                    {getWorkflowTemplateCategoryLabel(template.category)} · {template.nodes.length} 节点
                  </span>
                </div>
                <span className="shrink-0 rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">
                  v{template.version}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-warm-muted">
                {template.description}
              </p>
              {applyingTemplateId === template.id && (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-warm-primary">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>正在应用</span>
                </div>
              )}
            </button>
          ))}
          {workflowTemplates.length === 0 && (
            <div className="rounded-md border border-dashed border-warm-line bg-warm-bg px-2.5 py-3 text-xs text-warm-muted">
              暂无模板
            </div>
          )}
        </div>
      </div>

      <div className={cn("border-b border-warm-line/50 p-4", activeDrawerTool !== "factory" && "hidden")}>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-warm-primary" />
          <h3 className="text-sm font-medium text-warm-ink">AI 组件工厂</h3>
        </div>
        <p className="mt-1 text-xs leading-snug text-warm-muted">
          从自然语言或资产生成语义组件，再放入画布流程。
        </p>
        {factoryMessage && (
          <div className="mt-3 rounded-md bg-warm-primary-soft px-2.5 py-2 text-xs text-warm-primary">
            {factoryMessage}
          </div>
        )}
      </div>

      <div className={cn("min-h-0 flex-1 space-y-2 overflow-auto p-3", activeDrawerTool !== "factory" && "hidden")}>
        {canvasFactoryItems.map((item) => {
          const FactoryIcon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              disabled={!!factoryLoadingId}
              onClick={() => onCreateFactoryItem(item)}
              className="w-full rounded-lg border border-warm-line/50 bg-warm-paper p-3 text-left transition hover:border-warm-primary/30 hover:bg-warm-soft/45"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-warm-primary-soft text-warm-primary">
                  {factoryLoadingId === item.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FactoryIcon className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-warm-ink">{item.title}</span>
                  <p className="mt-1 text-xs leading-snug text-warm-muted">{item.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
        </>
      )}
    </aside>
  );
}

export default VisualWorkbench;

function limitSnapshots(items: CanvasSnapshot[]): CanvasSnapshot[] {
  return items.slice(-30);
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function getConnectionPointer(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
  if ("changedTouches" in event) {
    const touch = event.changedTouches[0] ?? event.touches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  return { x: event.clientX, y: event.clientY };
}

function readLastCanvasWorkflowId(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage?.getItem?.(LAST_CANVAS_WORKFLOW_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeLastCanvasWorkflowId(workflowId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem?.(LAST_CANVAS_WORKFLOW_STORAGE_KEY, workflowId);
  } catch {
    // Some embedded browser contexts disable storage; restore=1 still works without this cache.
  }
}

function clearLastCanvasWorkflowId(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.removeItem?.(LAST_CANVAS_WORKFLOW_STORAGE_KEY);
  } catch {
    // Ignore storage errors in embedded browser contexts.
  }
}

function duplicateCanvasNode(
  node: CanvasWorkbenchNode,
  index: number
): CanvasWorkbenchNode {
  return {
    ...node,
    id: `${node.id}-copy-${Date.now()}-${index}`,
    position: {
      x: node.position.x + 36,
      y: node.position.y + 36,
    },
    data: {
      ...node.data,
      label: `${node.data.label} 副本`,
      metrics: [...node.data.metrics],
    },
  };
}

function createDefaultGenerationFrameNode({
  productAsset,
  index,
  position,
}: {
  productAsset?: CanvasAsset;
  index: number;
  position?: XYPosition;
}): CanvasWorkbenchNode {
  const baseId = `generation-frame-default-${index}`;
  const baseFrame = migrateLegacyGenerationFrameData(
    {
      label: "图组",
      caption: "拖进素材，说一句需求。",
      kind: "output",
      status: "ready",
      metrics: ["素材", "一句话", "图组"],
      iconName: "ai",
      generationOutputType: "custom_template",
      promptPlaceholder: "例如：甜妹毛绒小包街拍，6 张，动作和眼神自然",
    },
    baseId
  );
  const generationFrame = productAsset
    ? bindAssetToGenerationFrameSlot(baseFrame, productAsset)
    : baseFrame;

  return {
    id: baseId,
    position: position ?? { x: 320, y: 64 },
    data: {
      label: "图组",
      caption: "拖进素材，说一句需求。",
      kind: "output",
      status: "ready",
      metrics: ["素材", "一句话", "图组"],
      iconName: "ai",
      type: "output",
      componentType: "generation_frame",
      source: "empty-workbench",
      generationOutputType: "custom_template",
      promptPlaceholder: "例如：甜妹毛绒小包街拍，6 张，动作和眼神自然",
      generationFrame,
    },
  };
}

function createTypedGenerationFrameNode({
  action,
  index,
  position,
}: {
  action: LineGenerationAction;
  index: number;
  position: XYPosition;
}): CanvasWorkbenchNode {
  const stamp = Date.now().toString(36);
  const frameId = `generation-frame-${action.id}-${stamp}-${index}`;
  const generationFrame = migrateLegacyGenerationFrameData(
    {
      label: action.label,
      caption: action.caption,
      kind: "output",
      status: "ready",
      metrics: action.metrics,
      iconName: action.iconName,
      generationActionId: action.id,
      generationOutputType: action.outputType,
      promptPlaceholder: action.promptPlaceholder ?? `一句话描述你想要的${action.title}`,
    },
    frameId
  );

  return {
    id: frameId,
    position,
    data: {
      label: action.label,
      caption: action.caption,
      kind: "output",
      status: "ready",
      metrics: action.metrics,
      iconName: action.iconName,
      type: "output",
      componentType: "generation_frame",
      source: "pane-context-menu",
      generationActionId: action.id,
      generationOutputType: action.outputType,
      promptPlaceholder: action.promptPlaceholder ?? `一句话描述你想要的${action.title}`,
      generationFrame,
    },
  };
}

function isGenerationFrameNode(node: CanvasWorkbenchNode | undefined): boolean {
  return node?.data.componentType === "generation_frame";
}

function getGenerationFrameAtPosition(
  nodes: CanvasWorkbenchNode[],
  position: XYPosition
): CanvasWorkbenchNode | undefined {
  return getAlignedGenerationFrameAtPosition(nodes, position);
}

function getPreferredGenerationFrameDropTarget(
  nodes: CanvasWorkbenchNode[],
  position: XYPosition,
  selectedNodeId: string
): CanvasWorkbenchNode | undefined {
  const directTarget = getGenerationFrameAtPosition(nodes, position);
  if (directTarget) return directTarget;

  const selectedFrame = nodes.find((node) => node.id === selectedNodeId && isGenerationFrameNode(node));
  if (selectedFrame) return selectedFrame;

  return getNearestGenerationFrame(nodes, position, 520);
}

function getNearestGenerationFrame(
  nodes: CanvasWorkbenchNode[],
  position: XYPosition,
  maxDistance: number
): CanvasWorkbenchNode | undefined {
  let nearest: { node: CanvasWorkbenchNode; distance: number } | undefined;

  for (const node of nodes) {
    if (!isGenerationFrameNode(node)) continue;
    const center = {
      x: node.position.x + 360,
      y: node.position.y + 220,
    };
    const distance = Math.hypot(center.x - position.x, center.y - position.y);
    if (distance > maxDistance) continue;
    if (!nearest || distance < nearest.distance) nearest = { node, distance };
  }

  return nearest?.node;
}

function getGenerationRoleFromContextAction(
  action: CanvasContextMenuAction
): GenerationFrameRole | undefined {
  if (action === "set-role-product") return "product";
  if (action === "set-role-model") return "model";
  if (action === "set-role-style") return "style";
  if (action === "set-role-scene") return "scene";
  if (action === "set-role-copy") return "copy";
  return undefined;
}

function isRetryableGenerationFrameOutput(output: GenerationFrameOutput): boolean {
  return Boolean(
    output.jobId &&
      (output.status === "failed" ||
        output.status === "cancelled" ||
        output.status === "error")
  );
}

function getExportableGenerationFrameBatchId(outputs: GenerationFrameOutput[]): string | undefined {
  const batchIds = outputs
    .map((output) => getStringValue(output.metadata?.batchId) || getStringValue(output.metadata?.exportPackId))
    .filter((value): value is string => Boolean(value));
  if (batchIds.length === 0) return undefined;
  const first = batchIds[0];
  return batchIds.every((batchId) => batchId === first) ? first : undefined;
}

function updateGenerationFrameMetrics(metrics: string[], prompt: string): string[] {
  const base = metrics.filter((metric) => !metric.startsWith("需求"));
  const request = prompt.trim();
  return request
    ? [...base.slice(0, 3), `需求 ${Math.min(request.length, 99)}字`]
    : base;
}

function getGenerationFramePrompt(node: CanvasWorkbenchNode): string {
  const frame = migrateLegacyGenerationFrameData(node.data, node.id);
  return frame.prompt || getStringValue(node.data.generationUserRequest) || "";
}

function applyPromptToGenerationFrameNode(
  node: CanvasWorkbenchNode,
  prompt: string
): CanvasWorkbenchNode {
  return {
    ...node,
    data: {
      ...node.data,
      generationUserRequest: prompt,
      generationFrame: {
        ...migrateLegacyGenerationFrameData(node.data, node.id),
        prompt,
        updatedAt: new Date().toISOString(),
      },
      metrics: updateGenerationFrameMetrics(node.data.metrics, prompt),
    },
  };
}

function prepareGenerationFrameNodeForNewBatch(
  node: CanvasWorkbenchNode,
  batchId: string
): CanvasWorkbenchNode {
  const frame = {
    ...migrateLegacyGenerationFrameData(node.data, node.id),
    status: "queued" as const,
    outputs: [],
    updatedAt: new Date().toISOString(),
  };

  return {
    ...node,
    data: {
      ...node.data,
      status: "queued",
      generationFrame: frame,
      generationFrameActiveBatchId: batchId,
      metrics: updateGenerationFrameOutputMetrics(
        updateGenerationFrameSlotMetrics(node.data.metrics, frame),
        []
      ),
    },
  };
}

function updateGenerationFrameSlotMetrics(
  metrics: string[],
  frame: GenerationFrameState
): string[] {
  const assetCount = frame.assets.length || generationFrameRoles.filter((role) => frame.slots[role]).length;
  const base = metrics.filter((metric) => !metric.startsWith("槽位") && !metric.startsWith("资产"));
  return assetCount > 0 ? [...base.slice(0, 2), `资产 ${assetCount} 项`] : base.slice(0, 3);
}

function updateGenerationFrameOutputMetrics(
  metrics: string[],
  outputs: GenerationFrameOutput[]
): string[] {
  const base = metrics.filter((metric) => !metric.startsWith("图组"));
  if (outputs.length === 0) return base;

  const done = outputs.filter((output) =>
    output.status === "done" ||
    output.status === "completed" ||
    output.status === "ready" ||
    !!output.url
  ).length;
  const failed = outputs.filter((output) =>
    output.status === "failed" || output.status === "error"
  ).length;
  const suffix = failed > 0 ? ` · ${failed} 失败` : "";
  return [...base.slice(0, 3), `图组 ${done}/${outputs.length}${suffix}`];
}

function applyAgentSampleCopyPlan({
  items,
  sampleCopyRenderMode,
  referenceContext,
  request,
}: {
  items: ReturnType<typeof buildGenerationFramePlanItems>;
  sampleCopyRenderMode: "layout_layer" | "burn_in" | "metadata_only";
  referenceContext: GenerationReferenceContext;
  request: string;
}): ReturnType<typeof buildGenerationFramePlanItems> {
  const referenceCopyText = sampleCopyRenderMode === "burn_in"
    ? getPreferredBurnInCopyTextFromReferenceContext(referenceContext)
    : undefined;
  const sampleCopyText = sampleCopyRenderMode === "burn_in"
    ? extractAgentBurnInCopyText(request)
    : undefined;
  const allowGlobalSampleBurnIn = sampleCopyRenderMode === "burn_in";

  return items.map((item) => {
    const itemWantsBurnIn =
      item.copyRenderMode === "burn_in" ||
      (allowGlobalSampleBurnIn && item.textAllowed);
    const itemCopyText = itemWantsBurnIn
      ? referenceCopyText ?? item.copyText ?? (item.textAllowed ? sampleCopyText : undefined)
      : undefined;
    return {
      ...item,
      textAllowed: itemWantsBurnIn ? item.textAllowed || Boolean(itemCopyText) : false,
      copyText: itemCopyText,
      copyRenderMode: itemWantsBurnIn && itemCopyText
        ? "burn_in"
        : item.copyRenderMode ?? sampleCopyRenderMode,
    };
  });
}

function buildAgentSampleWorkflowPlanPreview({
  planItems,
  generationRequest,
  sampleOutputCount,
  referenceContext,
}: {
  planItems: ReturnType<typeof buildGenerationFramePlanItems>;
  generationRequest: string;
  sampleOutputCount: number;
  referenceContext: GenerationReferenceContext;
}): WorkflowPlanPreview {
  const previewItems = planItems.map((item, index): WorkflowPlanPreviewItem => ({
    id: item.itemId || `agent_sample_${index + 1}`,
    title: item.title || `样张 ${index + 1}`,
    purpose: getAgentSampleItemPurpose(item),
    slot: item.type || item.exportSpecId || `sample_${index + 1}`,
    ratio: item.ratio || "auto",
    size: item.size,
    copyMode: item.copyRenderMode || (item.textAllowed ? "layout_layer" : "metadata_only"),
    componentRefs: [],
    qualityChecks: item.qualityRules ?? [],
  }));
  const assetGroups = buildAgentSampleAssetGroups(referenceContext);
  const assetGroupIdsByRole = new Map(assetGroups.map((group) => [group.role, group.id]));
  const availableProviderRoles = new Set(
    referenceContext.images
      .filter((image) => image.providerUsable)
      .map((image) => image.role)
  );
  const generationMatrix = planItems.map((item, index): WorkflowPlanPreviewAgentMatrixItem => {
    const itemId = previewItems[index]?.id || item.itemId || `agent_sample_${index + 1}`;
    const referenceRoles = normalizeAgentSampleReferenceRoles(item.referenceRoles);
    const providerReferenceRoles = normalizeAgentSampleReferenceRoles(item.providerReferenceRoles)
      .filter((role) => availableProviderRoles.has(role));
    return {
      id: `agent_sample_matrix_${itemId}`,
      itemId,
      title: item.title || `样张 ${index + 1}`,
      type: item.type || item.exportSpecId || itemId,
      ratio: item.ratio,
      size: item.size,
      skillId: "agent_sample_plan.v1",
      outputSlotId: itemId,
      referenceRoles,
      providerReferenceRoles,
      assetGroupIds: referenceRoles
        .map((role) => assetGroupIdsByRole.get(role))
        .filter((id): id is string => Boolean(id)),
      copyMode: item.copyRenderMode || "layout_layer",
      missingInputIds: [],
      status: "ready",
      summary: getAgentSampleItemPurpose(item),
    };
  });

  return {
    title: "Agent 样张计划",
    summary: "先确认图组结构，再创建真实生成任务。",
    items: previewItems,
    images: previewItems,
    componentRefs: [],
    qualityChecks: [],
    estimatedCount: sampleOutputCount,
    editableParameters: [],
    agentPlan: {
      skillId: "agent_sample_plan.v1",
      title: "Agent 样张计划",
      shortLabel: "样张计划",
      compositionMode: "custom_matrix",
      summary: {
        mode: "agent_sample_preview",
        text: "先预览计划，确认后再生成。",
        itemCount: sampleOutputCount,
        readyItemCount: sampleOutputCount,
        blockedItemCount: 0,
      },
      sampleCount: sampleOutputCount,
      fullCount: sampleOutputCount,
      requiredAssetRoles: ["product"],
      optionalAssetRoles: agentUniqueStrings(
        generationMatrix.flatMap((item) => item.referenceRoles).filter((role) => role !== "product")
      ),
      copyPolicy: {
        defaultMode: "layout_layer",
        requestedMode: generationMatrix.some((item) => item.copyMode === "burn_in") ? "burn_in" : "layout_layer",
        allowBurnIn: generationMatrix.some((item) => item.copyMode === "burn_in"),
        note: "逐张判断文案是否进图；确认计划后再创建任务。",
      },
      phases: [
        {
          id: "preview",
          label: "计划",
          description: "先让用户确认图组、比例、参考图和文案策略。",
        },
        {
          id: "generate",
          label: "生成",
          description: "确认后创建真实生成任务。",
        },
      ],
      outputSlots: previewItems.map((item) => ({
        id: item.id,
        label: item.title,
        purpose: item.purpose,
        ratio: item.ratio,
        samplePhase: true,
      })),
      assetGroups,
      generationMatrix,
      missingInputs: [],
    },
  };
}

function buildAgentSampleRunItemsFromPreview({
  preview,
  fallbackItems,
  basePrompt,
}: {
  preview: WorkflowPlanPreview;
  fallbackItems: ReturnType<typeof buildGenerationFramePlanItems>;
  basePrompt: string;
}): ReturnType<typeof buildGenerationFramePlanItems> {
  const matrixByItemId = new Map(
    (preview.agentPlan?.generationMatrix ?? []).map((item) => [item.itemId, item])
  );
  const fallbackById = new Map(fallbackItems.map((item) => [item.itemId, item]));
  const setContextPrompt = buildGenerationFrameSetContextPrompt(basePrompt);

  return preview.items.map((item, index) => {
    const fallback = fallbackById.get(item.id) ?? fallbackItems[index] ?? fallbackItems[0];
    const matrix = matrixByItemId.get(item.id);
    const referenceRoles = normalizeAgentSampleReferenceRoles(
      matrix?.referenceRoles ?? fallback?.referenceRoles ?? ["product"]
    );
    const providerReferenceRoles = normalizeAgentSampleReferenceRoles(
      matrix?.providerReferenceRoles ?? fallback?.providerReferenceRoles ?? ["product"]
    );
    const copyRenderMode = normalizeAgentSampleCopyMode(
      matrix?.copyMode || item.copyMode || fallback?.copyRenderMode
    );
    const purpose = item.purpose || matrix?.summary || fallback?.prompt || "";
    return {
      ...(fallback ?? {}),
      itemId: item.id || fallback?.itemId || `agent_sample_${index + 1}`,
      title: item.title || fallback?.title || `样张 ${index + 1}`,
      type: item.slot || fallback?.type || item.id || `sample_${index + 1}`,
      copyRenderMode,
      copyText: copyRenderMode === "burn_in"
        ? fallback?.copyText || extractAgentBurnInCopyText(`${item.title} ${purpose}`) || ""
        : "",
      textAllowed: copyRenderMode === "burn_in",
      prompt: [
        setContextPrompt,
        "Single-image execution rule: render exactly one finished image for this item only. Do not create a collage, multi-panel board, contact sheet, grid, storyboard, tiled layout, comparison sheet, moodboard, or one image containing multiple deliverables. The requested set count means multiple separate jobs, not multiple panels inside this image.",
        `Confirmed Agent plan item ${index + 1}/${preview.items.length}: ${item.title}.`,
        purpose,
        copyRenderMode === "burn_in"
          ? "This item must place only the requested short copy inside a clean visual safe area. Do not modify product packaging labels."
          : "Do not burn marketing copy into the image unless explicitly requested for this item.",
        "This image must feel like part of the same commercial image set as the other planned outputs.",
      ].filter(Boolean).join("\n"),
      exportSpecId: item.id || fallback?.exportSpecId || `agent_sample_${index + 1}`,
      naming: `${item.id || fallback?.naming || `agent_sample_${index + 1}`}_${index + 1}`,
      size: item.size || fallback?.size || "1024x1024",
      ratio: item.ratio || fallback?.ratio || "1:1",
      whiteBackground: fallback?.whiteBackground ?? false,
      modelRequired: fallback?.modelRequired ?? referenceRoles.includes("model"),
      referenceRoles,
      providerReferenceRoles,
      qualityRules: fallback?.qualityRules ?? [
        "Keep product identity stable.",
        "Avoid malformed hands, distorted logos, and inconsistent material.",
        "Keep the visual language consistent across the set.",
      ],
      metadata: {
        ...(fallback?.metadata ?? {}),
        frameOutputRole: item.id || fallback?.exportSpecId,
        frameOutputIndex: index + 1,
        plannedFrameOutput: true,
        copyRenderMode,
        agentSamplePlanConfirmed: true,
        shotIntentText: [item.title, item.slot, purpose].filter(Boolean).join(" "),
      },
    };
  });
}

function getAgentSampleItemPurpose(
  item: ReturnType<typeof buildGenerationFramePlanItems>[number]
): string {
  const text = `${item.title} ${item.type}`.toLowerCase();
  if (/主图|main|hero/.test(text)) return "交代商品主视觉，用于首屏识别和点击。";
  if (/细节|材质|特写|detail|macro|material/.test(text)) return "展示材质、结构或局部特征，补足信任证据。";
  if (/详情|卖点|海报|poster|feature|taobao|淘宝/.test(text)) {
    return item.copyRenderMode === "burn_in"
      ? "承载短标题或核心卖点，文案放画面安全区，不改商品包装标签。"
      : "作为营销视觉使用，文案默认保留为后期图层。";
  }
  if (/banner|横版|活动/.test(text)) return "用于横版活动入口或投放版位，保持画面干净可延展。";
  if (/场景|客厅|露营|室内|户外|scene|lifestyle/.test(text)) return "把商品放入具体环境，验证空间、光影和使用氛围。";
  if (/模特|真人|人物|上身|穿搭|model/.test(text)) return "展示人物关系、尺度和使用情绪。";
  return item.copyRenderMode === "burn_in"
    ? "这张需要直接承载画面短文案，重点检查安全区。"
    : "补齐整套商业图组，方便后续挑图和单张重做。";
}

function buildAgentSampleAssetGroups(
  referenceContext: GenerationReferenceContext
): WorkflowPlanPreviewAgentAssetGroup[] {
  return generationFrameRoles
    .map((role): WorkflowPlanPreviewAgentAssetGroup | undefined => {
      const images = referenceContext.images.filter((image) => image.role === role);
      const roleContext = referenceContext.roles[role];
      if (images.length === 0 && !roleContext) return undefined;
      return {
        id: `sample_asset_${role}`,
        role,
        title: roleContext?.title || getGenerationReferenceRoleLabel(role),
        required: role === "product",
        available: images.length > 0 || Boolean(roleContext),
        providerUsable: images.some((image) => image.providerUsable),
        usage: role === "product" ? "锁定商品身份" : "作为计划参考",
        imageCount: images.length,
        assetIds: agentUniqueStrings([
          ...images.map((image) => image.assetId || ""),
          ...(roleContext?.assetIds ?? []),
        ]),
        sourceNodeIds: agentUniqueStrings([
          ...images.map((image) => image.nodeId || ""),
          ...(roleContext?.sourceNodeIds ?? []),
        ]),
        componentIds: agentUniqueStrings([
          ...images.map((image) => image.componentId || ""),
          ...(roleContext?.componentIds ?? []),
        ]),
      };
    })
    .filter((group): group is WorkflowPlanPreviewAgentAssetGroup => Boolean(group));
}

function normalizeAgentSampleReferenceRoles(values: readonly string[] | undefined): GenerationReferenceRole[] {
  const allowed = new Set<GenerationReferenceRole>(["product", "model", "style", "scene", "copy"]);
  return agentUniqueStrings([...(values ?? [])])
    .filter((value): value is GenerationReferenceRole => allowed.has(value as GenerationReferenceRole));
}

function normalizeAgentSampleCopyMode(value: unknown): "layout_layer" | "burn_in" | "metadata_only" {
  if (value === "burn_in" || value === "metadata_only" || value === "layout_layer") return value;
  return "layout_layer";
}

function buildGenerationFramePlanItems(
  node: CanvasWorkbenchNode,
  basePrompt: string
) {
  const frame = node.data.generationFrame
    ? normalizeGenerationFrameState(node.data.generationFrame)
    : undefined;
  const outputType = getStringValue(node.data.generationOutputType) ??
    frame?.outputType ??
    "commercial_image_set";
  const userRequest = getStringValue(node.data.generationUserRequest) ?? frame?.prompt ?? "";
  const cleanRequest = userRequest.trim();
  const presets = buildGenerationFramePlanSpecs({
    request: cleanRequest,
    outputType,
    frameLabel: node.data.label,
  });
  const productAssetSop =
    outputType.includes("product_asset")
      ? [
          "Product asset SOP:",
          "Create exactly one reusable white-background multi-view product identity sheet.",
          "Use every product reference as the same physical item from different angles.",
          "Preserve silhouette, proportions, material, color, construction, hardware, seams, handles, labels, logo regions, and functional details.",
          "No model, no hands, no scene props, no marketing text, no extra product variants, no invented logos.",
        ].join("\n")
      : "";
  const setContextPrompt = buildGenerationFrameSetContextPrompt(basePrompt);

  return presets.map((preset, index) => {
      const copyText = preset.copyText ?? "";
      const itemReferenceRoles: GenerationReferenceRole[] = [
        "product",
        ...(preset.modelRequired ? (["model"] as const) : []),
        ...(!preset.whiteBackground ? (["scene", "style"] as const) : []),
        ...(preset.textAllowed || copyText ? (["copy"] as const) : []),
      ];
      const itemProviderReferenceRoles = itemReferenceRoles.filter((role) =>
        role === "product" ||
        role === "scene" ||
        (role === "model" && preset.modelRequired)
      );
      return {
        itemId: `${preset.id}-${index + 1}`,
        title: preset.title,
      type: preset.type,
      copyText,
      copyRenderMode: preset.copyRenderMode,
      prompt: [
        setContextPrompt,
        productAssetSop,
        "Single-image execution rule: render exactly one finished image for this item only. Do not create a collage, multi-panel board, contact sheet, grid, storyboard, tiled layout, comparison sheet, moodboard, or one image containing multiple deliverables. The requested set count means multiple separate jobs, not multiple panels inside this image.",
        `Image set item ${index + 1}/${presets.length}: ${preset.title}.`,
        preset.instruction,
        "This image must feel like part of the same commercial image set as the other planned outputs.",
      ].join("\n"),
      exportSpecId: preset.id,
      naming: `${preset.id}_${index + 1}`,
      size: preset.size,
      ratio: preset.ratio,
        whiteBackground: preset.whiteBackground,
        textAllowed: preset.textAllowed,
        modelRequired: preset.modelRequired,
        referenceRoles: itemReferenceRoles,
        providerReferenceRoles: itemProviderReferenceRoles,
        qualityRules: [
        "Keep product identity stable.",
        "Avoid malformed hands, distorted logos, and inconsistent material.",
        "Keep the visual language consistent across the set.",
      ],
      metadata: {
        frameOutputRole: preset.id,
        frameOutputIndex: index + 1,
        plannedFrameOutput: true,
        copyRenderMode: preset.copyRenderMode,
        shotIntentText: [
          preset.title,
          preset.type,
          preset.instruction,
          copyText,
        ].filter(Boolean).join(" "),
      },
    };
  });
}

function buildGenerationFrameSetContextPrompt(basePrompt: string): string {
  return basePrompt
    .split("\n")
    .filter((line) => !line.startsWith("User generation request:"))
    .join("\n")
    .trim();
}

function buildAgentImageRevisionPrompt(target: AgentImageEditTarget, userRequest: string): string {
  const originalPrompt = truncateRevisionText(target.prompt, 1200);
  const purposeText = getAgentRevisionPurposeText(target.metadata ?? {}, target.title);
  const metadata = target.metadata ?? {};
  const ratioText = getAgentRevisionRatioText(metadata);
  const copyPolicyText = getAgentRevisionCopyPolicyText(metadata);
  const referenceText = getAgentRevisionReferenceText(metadata);
  const qaText = getAgentRevisionVisualQaText(target);
  return [
    "基于参考图进行再修改，不要从零重画。",
    `参考图：${target.title}`,
    purposeText ? `原图组用途：${purposeText}` : "",
    ratioText ? `原比例：${ratioText}` : "",
    copyPolicyText ? `原文案策略：${copyPolicyText}` : "",
    referenceText ? `原参考图角色：${referenceText}` : "",
    qaText ? `原视觉 QA 问题：${qaText}` : "",
    originalPrompt ? `原始生成 prompt：${originalPrompt}` : "",
    `用户修改要求：${userRequest.trim()}`,
    "本次只修改这张成片，不扩展为整套项目重做，也不要改变其它图组的规划。",
    "保留参考图里已经正确的主体、产品、人物、场景关系、构图、透视和商业质感；只修改用户明确要求的部分。",
    "如果需要加广告文案，把文案放在画面安全区；不要改商品包装标签，除非用户明确要求修改包装。",
    "输出一张完成图。",
  ].filter(Boolean).join("\n");
}

function getAgentRevisionRatioText(metadata: Record<string, unknown>): string {
  const ratio =
    getStringValue(metadata.ratio) ||
    getStringValue(metadata.aspectRatioLabel) ||
    getStringValue(metadata.outputRatio) ||
    getStringValue(metadata.size);
  return ratio || "";
}

function getAgentRevisionCopyPolicyText(metadata: Record<string, unknown>): string {
  const policy = getOutputPreviewCopyRenderPolicy(metadata);
  if (!policy) return "";
  const modeLabel =
    policy.mode === "burn_in" ? "文案烧进图" :
      policy.mode === "layout_layer" ? "文案图层" :
        policy.mode === "metadata_only" ? "文案不进图" :
          policy.mode || "沿用原策略";
  const copyText = [
    ...(policy.inImageText ?? []),
    ...(policy.sellingPoints ?? []),
  ].slice(0, 4).join(" / ");
  return [modeLabel, copyText ? `画面文字：${copyText}` : ""].filter(Boolean).join("；");
}

function getAgentRevisionReferenceText(metadata: Record<string, unknown>): string {
  const providerRoles = getOutputPreviewProviderReferenceImages(metadata)
    .map((image) => getGenerationReferenceRoleLabel(image.role));
  const promptOnlyRoles = getOutputPreviewPromptOnlyReferenceImages(metadata)
    .map((image) => getGenerationReferenceRoleLabel(image.role));
  const parts = [
    providerRoles.length > 0 ? `强参考 ${agentUniqueStrings(providerRoles).join("、")}` : "",
    promptOnlyRoles.length > 0 ? `文字参考 ${agentUniqueStrings(promptOnlyRoles).join("、")}` : "",
  ].filter(Boolean);
  return parts.join("；");
}

function getAgentRevisionVisualQaText(target: AgentImageEditTarget): string {
  const source: PersistedGeneratedArtifact = {
    id: target.artifactId || target.outputId || target.jobId || "revision-target",
    workflowId: undefined,
    nodeId: target.nodeId,
    jobId: target.jobId,
    assetId: undefined,
    type: getStringValue(target.metadata?.planItemType) || getStringValue(target.metadata?.imageType) || "image_revision",
    title: target.title,
    status: target.status || "done",
    url: target.url,
    prompt: target.prompt || "",
    provider: getStringValue(target.metadata?.provider),
    model: getStringValue(target.metadata?.model),
    metadata: target.metadata ?? {},
    createdAt: "",
    updatedAt: "",
  };
  const qa = getArtifactVisualQaSummary(source);
  return qa.issues
    .filter((issue) => issue.status === "fail" || issue.status === "warn")
    .map((issue) => `${issue.label}：${issue.summary}`)
    .slice(0, 4)
    .join("；");
}

function buildAgentGroupRevisionPromptContext(
  group: AgentPlanGroup,
  targets: AgentImageEditTarget[],
  currentTarget: AgentImageEditTarget
): string {
  const groupRatios = agentUniqueStrings([
    ...group.ratios,
    ...targets.map((target) => getAgentRevisionRatioText(target.metadata ?? {})),
  ]);
  const copyModes = agentUniqueStrings([
    ...group.copyModes,
    ...targets.map((target) => getAgentRevisionCopyPolicyText(target.metadata ?? {})),
  ]);
  const providerRoles = agentUniqueStrings(group.providerRoles);
  const promptOnlyRoles = agentUniqueStrings(group.promptOnlyRoles);
  return [
    `分组修改范围：只重做「${group.title}」这一组，共 ${targets.length} 张。`,
    "不要重写整个项目计划，不要影响其它已保留图片或其它结果分组。",
    `当前正在重做：${currentTarget.title}。`,
    groupRatios.length > 0 ? `本组原比例：${groupRatios.slice(0, 5).join(" / ")}。` : "",
    providerRoles.length > 0 || promptOnlyRoles.length > 0
      ? `本组参考角色：${[
        providerRoles.length > 0 ? `强参考 ${providerRoles.join("、")}` : "",
        promptOnlyRoles.length > 0 ? `文字参考 ${promptOnlyRoles.join("、")}` : "",
      ].filter(Boolean).join("；")}。`
      : "",
    copyModes.length > 0 ? `本组文案策略：${copyModes.slice(0, 4).join(" / ")}。` : "",
    "如果用户说动作重复，只替换这一组的姿势、角度和表情节奏；商品、模特身份、场景和风格沿用原上下文。",
  ].filter(Boolean).join("\n");
}

function getAgentRevisionPurposeText(metadata: Record<string, unknown>, fallbackTitle = ""): string {
  const title =
    getStringValue(metadata.planItemTitle) ||
    getStringValue(metadata.batchJobTitle) ||
    getStringValue(metadata.exportSpecTitle) ||
    fallbackTitle;
  const type =
    getStringValue(metadata.planItemType) ||
    getStringValue(metadata.imageType) ||
    getStringValue(metadata.useCase);
  const slot =
    getStringValue(metadata.outputSlotId) ||
    getStringValue(metadata.exportSpecId) ||
    getStringValue(metadata.exportItemId);
  const parts = [
    title ? title : "",
    type && type !== title ? getAgentRevisionPurposeTypeLabel(type) : "",
    slot && slot !== title && slot !== type ? slot : "",
  ].filter(Boolean);
  return agentUniqueStrings(parts).slice(0, 3).join(" / ");
}

function getAgentRevisionPurposeTypeLabel(type: string): string {
  const normalized = type.toLowerCase();
  if (/main|hero|主图|主视觉/.test(normalized)) return "主图/主视觉";
  if (/poster|cover|海报|封面|feature|卖点/.test(normalized)) return "海报/卖点";
  if (/detail|macro|material|细节|材质/.test(normalized)) return "详情/细节";
  if (/model|模特|真人/.test(normalized)) return "模特展示";
  if (/scene|lifestyle|场景|生活/.test(normalized)) return "场景图";
  if (/revision|rerun/.test(normalized)) return "再修改图";
  return type;
}

function buildAgentImageRevisionReferenceContext(target: AgentImageEditTarget): GenerationReferenceContext {
  const originalContext =
    normalizeGenerationReferenceContext(target.metadata?.referenceContext) ??
    normalizeGenerationReferenceContext(target.metadata);
  const originalProviderImages = target.metadata
    ? getOutputPreviewProviderReferenceImages(target.metadata)
    : [];
  const originalPromptOnlyImages = target.metadata
    ? getOutputPreviewPromptOnlyReferenceImages(target.metadata)
    : [];
  const roleContext: GenerationReferenceRoleContext = {
    role: "style",
    title: "上一版成片",
    sourceNodeIds: target.nodeId ? [target.nodeId] : [],
    componentIds: [],
    assetIds: [],
    parameters: {
      revisionSource: true,
      outputId: target.outputId,
      artifactId: target.artifactId,
      jobId: target.jobId,
    },
    promptFragments: [
      "Use the reference image as the previous finished image to revise.",
    ],
    constraints: [
      "Preserve the existing subject, product identity, composition, perspective, and commercial finish unless the user explicitly asks to change them.",
      "Only change the parts requested by the user.",
    ],
    negativeRules: [
      "Do not redraw the whole image from scratch.",
      "Do not redesign the product.",
      "Do not move advertising copy onto product packaging labels unless explicitly requested.",
    ],
    qualityRules: [
      "The revised image should still look like the same production set.",
    ],
  };
  const originalStyleRole = originalContext?.roles.style;
  const mergedStyleRole: GenerationReferenceRoleContext = originalStyleRole
    ? {
        ...roleContext,
        sourceNodeIds: dedupeStrings([...originalStyleRole.sourceNodeIds, ...roleContext.sourceNodeIds]),
        componentIds: dedupeStrings([...originalStyleRole.componentIds, ...roleContext.componentIds]),
        assetIds: dedupeStrings([...originalStyleRole.assetIds, ...roleContext.assetIds]),
        parameters: {
          ...originalStyleRole.parameters,
          ...roleContext.parameters,
        },
        promptFragments: dedupeStrings([...roleContext.promptFragments, ...originalStyleRole.promptFragments]),
        constraints: dedupeStrings([...roleContext.constraints, ...originalStyleRole.constraints]),
        negativeRules: dedupeStrings([...roleContext.negativeRules, ...originalStyleRole.negativeRules]),
        qualityRules: dedupeStrings([...roleContext.qualityRules, ...originalStyleRole.qualityRules]),
      }
    : roleContext;
  const images = dedupeReferenceImages([
    {
      role: "style",
      title: "上一版成片",
      url: target.url,
      providerUsable: true,
      providerMode: "provider_input",
      source: "generated-output",
      nodeId: target.nodeId,
    },
    ...originalProviderImages.map((image) => ({
      ...image,
      title: image.title || `${getGenerationReferenceRoleLabel(image.role)}原始参考`,
      source: image.source || "original-generation-reference",
      providerUsable: true,
      providerMode: "provider_input" as const,
    })),
    ...originalPromptOnlyImages.map((image) => ({
      ...image,
      title: image.title || `${getGenerationReferenceRoleLabel(image.role)}文字参考`,
      source: image.source || "original-generation-reference",
      providerUsable: false,
      providerMode: "prompt_only" as const,
    })),
  ]);

  return {
    version: 1,
    source: "canvas-workbench",
    targetNodeId: target.nodeId,
    targetNodeLabel: target.title,
    images,
    roles: {
      ...originalContext?.roles,
      style: mergedStyleRole,
    },
    promptFragments: dedupeStrings([
      ...roleContext.promptFragments,
      ...(originalContext?.promptFragments ?? []),
    ]),
    constraints: dedupeStrings([
      ...roleContext.constraints,
      ...(originalContext?.constraints ?? []),
    ]),
    negativeRules: dedupeStrings([
      ...roleContext.negativeRules,
      ...(originalContext?.negativeRules ?? []),
    ]),
    qualityRules: dedupeStrings([
      ...roleContext.qualityRules,
      ...(originalContext?.qualityRules ?? []),
    ]),
  };
}

function buildAgentImageRevisionAssetInvocationPlan(referenceContext: GenerationReferenceContext) {
  const imagesByRole = new Map<GenerationReferenceRole, GenerationReferenceImage[]>();
  for (const image of referenceContext.images) {
    imagesByRole.set(image.role, [...(imagesByRole.get(image.role) ?? []), image]);
  }

  const decisions = generationFrameRoles
    .filter((role) => referenceContext.roles[role] || imagesByRole.has(role))
    .map((role) => {
      const images = imagesByRole.get(role) ?? [];
      const providerInput = images.some((image) => image.providerUsable || image.providerMode === "provider_input");
      return {
        role,
        mode: getRevisionAssetInvocationMode(role, providerInput),
        providerInput,
        reason: providerInput
          ? `${getGenerationReferenceRoleLabel(role)}会作为再修改任务的参考输入。`
          : `${getGenerationReferenceRoleLabel(role)}只作为 prompt 和约束继承。`,
        imageCount: images.length,
      };
    });

  return {
    mode: "agent_image_revision_v1",
    referenceRoles: decisions.map((decision) => decision.role),
    providerReferenceRoles: decisions.filter((decision) => decision.providerInput).map((decision) => decision.role),
    decisions,
  };
}

function getRevisionAssetInvocationMode(role: GenerationReferenceRole, providerInput: boolean): string {
  if (role === "product") return providerInput ? "hard_reference" : "prompt_only";
  if (role === "model") return providerInput ? "identity_reference" : "prompt_only";
  if (role === "scene") return providerInput ? "lighting_space" : "prompt_only";
  if (role === "style") return providerInput ? "style_finish" : "prompt_only";
  if (role === "copy") return "copy_layer";
  return "prompt_only";
}

function truncateRevisionText(value: string | undefined, maxLength: number): string {
  const text = value?.trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function formatRevisionTextForSentence(value: string | undefined, maxLength: number): string {
  return truncateRevisionText(value, maxLength).replace(/[。.!?！？；;，,]+$/, "");
}

function getNextLibraryInsertPosition(
  nodes: CanvasWorkbenchNode[],
  selectedNode?: CanvasWorkbenchNode,
  category?: CanvasLibraryCategory
): XYPosition {
  if (category) {
    return getNextCategoryLanePosition(nodes, category);
  }

  if (selectedNode) {
    return {
      x: selectedNode.position.x + 72,
      y: selectedNode.position.y + 72,
    };
  }

  return {
    x: 80 + (nodes.length % 4) * 32,
    y: 160 + (nodes.length % 5) * 36,
  };
}

function getNextCategoryLanePosition(
  nodes: CanvasWorkbenchNode[],
  category: CanvasLibraryCategory
): XYPosition {
  const categoryNodeCount = nodes.filter((node) => (
    getStringValue(node.data.category) === category &&
    getStringValue(node.data.source) !== "artifact-history"
  )).length;

  return getCategoryLanePosition(category, categoryNodeCount);
}

function getCategoryLanePosition(
  category: CanvasLibraryCategory,
  index: number
): XYPosition {
  const basePositions: Record<CanvasLibraryCategory, XYPosition> = {
    商品: { x: 80, y: 560 },
    模特: { x: 430, y: 560 },
    场景: { x: 780, y: 560 },
    风格: { x: 1130, y: 560 },
    文案: { x: 1480, y: 560 },
    平台: { x: 2040, y: 560 },
    质检: { x: 2380, y: 560 },
  };
  const base = basePositions[category];

  return {
    x: base.x,
    y: base.y + index * 390,
  };
}

function getCanvasNodeLibraryCategory(node: CanvasWorkbenchNode): CanvasLibraryCategory | undefined {
  const category = getStringValue(node.data.category);
  if (isCanvasLibraryCategoryValue(category)) return category;

  const role = getNodeReferenceRole(node);
  if (role === "product") return "商品";
  if (role === "model") return "模特";
  if (role === "scene") return "场景";
  if (role === "style") return "风格";
  if (role === "copy") return "文案";
  return undefined;
}

function isCanvasBackstageNode(node: Pick<CanvasWorkbenchNode, "data"> & { id?: string }): boolean {
  const nodeId = typeof node.id === "string" ? node.id : "";
  const kind = getStringValue(node.data.kind);
  const source = getStringValue(node.data.source);
  const category = getStringValue(node.data.category);
  const componentType = getStringValue(node.data.componentType);
  const nodeType = getStringValue(node.data.type);
  if (source === "artifact-history" || nodeId.startsWith("artifact-node-")) return false;
  if (/^(image_recipe|platform_rule|quality_rule|output_pack)$/.test(nodeId)) return true;
  if (category === "平台" || category === "质检") return true;
  if (/recipe|rule|quality|compliance|output_pack|export_pack/.test(`${componentType} ${nodeType}`)) return true;
  return kind === "factory" ||
    kind === "platform" ||
    kind === "quality";
}

function getCreateJobButtonLabel(isGenerationFrame: boolean, isExportPack: boolean): string {
  if (isGenerationFrame) return "生成计划并创建任务";
  if (isExportPack) return "规划导出包任务";
  return "创建单图任务";
}

function getGenerationFrameSlotSummary(
  context: GenerationReferenceContext | undefined
): string {
  const roles = generationFrameRoles
    .filter((role) => context?.roles[role]);
  return roles.length > 0
    ? roles.map((role) => getGenerationReferenceRoleLabel(role)).join(" + ")
    : "等待资产";
}

function isGenerationFrameRoleValue(value: unknown): value is GenerationFrameRole {
  return generationFrameRoles.some((role) => role === value);
}

function isCanvasLibraryCategoryValue(value: unknown): value is CanvasLibraryCategory {
  return typeof value === "string" && canvasLibraryCategories.some((category) => category === value);
}

function getGenerationFrameRoleFromComponent(
  component: PersistedComponent
): GenerationFrameRole | undefined {
  const category = getComponentCategory(component.type);
  if (category === "商品") return "product";
  if (category === "模特") return "model";
  if (category === "风格") return "style";
  if (category === "场景") return "scene";
  if (category === "文案") return "copy";
  return undefined;
}

function createExportPackNode(
  rule: ExportPackRule,
  selectedNode: CanvasWorkbenchNode | undefined,
  existingNodes: CanvasWorkbenchNode[]
): CanvasWorkbenchNode {
  const stamp = Date.now();
  const totalCount = getExportPackTotalCount(rule);
  const sizes = getExportPackSizes(rule);
  const qualityHighlights = getExportPackQualityHighlights(rule);
  const existingBounds = getCanvasBounds(existingNodes);
  const index = existingNodes.filter((node) => String(node.data.exportPackId ?? "").trim()).length;

  return {
    id: `export-pack-${rule.id}-${stamp}`,
    position: selectedNode
      ? {
          x: selectedNode.position.x + 300,
          y: selectedNode.position.y + 18 + (index % 3) * 24,
        }
      : {
          x: existingBounds.maxX + 180,
          y: Math.max(40, existingBounds.minY) + (index % 3) * 32,
        },
    data: {
      label: rule.title,
      caption: rule.description,
      kind: "output",
      status: "queued",
      metrics: [
        `${totalCount} 张`,
        sizes.length > 1 ? `${sizes.length} 种尺寸` : sizes[0] ?? "待定尺寸",
        qualityHighlights[0] ?? "平台质检",
        rule.platform,
      ],
      iconName: "platform",
      exportPackId: rule.id,
      exportItems: rule.items,
      exportSpecs: rule.specs,
      platform: rule.platform,
      category: "platform",
      type: "platform",
      useCase: rule.useCase,
      source: "export-pack-rules",
      qualityRules: qualityHighlights,
      linkedFromNodeId: selectedNode?.id,
      linkedFromNodeLabel: selectedNode?.data.label,
    },
  };
}

function findExportPackSourceNode(
  exportPackNode: CanvasWorkbenchNode,
  selectedNode: CanvasWorkbenchNode | undefined,
  existingNodes: CanvasWorkbenchNode[]
): CanvasWorkbenchNode | null {
  if (selectedNode && canConnectCanvasNodes(selectedNode, exportPackNode)) {
    return selectedNode;
  }

  return (
    [...existingNodes]
      .reverse()
      .find((node) => canConnectCanvasNodes(node, exportPackNode)) ?? null
  );
}

function getExportPackTotalCount(rule: ExportPackRule): number {
  return rule.specs.reduce((sum, spec) => sum + spec.count, 0);
}

function getExportPackSizes(rule: ExportPackRule): string[] {
  return Array.from(new Set(rule.specs.map((spec) => spec.size).filter(Boolean)));
}

function getExportPackQualityHighlights(rule: ExportPackRule): string[] {
  return Array.from(
    new Set(rule.specs.flatMap((spec) => spec.qualityRules).filter(Boolean))
  ).slice(0, 4);
}

function ProjectReviewSummaryCard({
  title,
  summary,
  compact = false,
}: {
  title: string;
  summary: PersistedProjectReviewSummary;
  compact?: boolean;
}) {
  const history = summary.recentHistory.slice(0, compact ? 2 : 3);

  return (
    <div className={cn(compact ? "space-y-2" : "rounded-lg border border-warm-line/50 bg-warm-bg p-2.5")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-warm-ink">{title}</span>
        <span className="rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">
          {summary.sessionCount} sessions
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <ReviewSummaryMetric label="图" value={summary.itemCount} />
        <ReviewSummaryMetric label="过" value={summary.approved} tone="pass" />
        <ReviewSummaryMetric label="改" value={summary.needsRevision} tone="warn" />
        <ReviewSummaryMetric label="退" value={summary.rejected} tone="fail" />
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-warm-muted">
        <span className="truncate">
          {summary.latestSessionTitle || "暂无审核会话"}
        </span>
        <span className="shrink-0">{formatReviewSummaryTime(summary.latestAt)}</span>
      </div>
      {history.length > 0 && (
        <div className="space-y-1">
          {history.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-2 text-[10px] text-warm-muted">
              <span className="min-w-0 truncate">{entry.label}</span>
              <span className="shrink-0">{formatReviewSummaryTime(entry.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewSummaryMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "pass" | "warn" | "fail";
}) {
  const toneClass =
    tone === "pass"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "fail"
          ? "text-red-700"
          : "text-warm-ink";

  return (
    <div className="min-w-0 rounded-md bg-warm-paper px-2 py-1.5">
      <span className="block truncate text-[10px] text-warm-muted">{label}</span>
      <span className={cn("mt-0.5 block text-xs font-medium", toneClass)}>{value}</span>
    </div>
  );
}

function formatReviewSummaryTime(value?: string): string {
  if (!value) return "无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "无记录";
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function WorkflowPlanParameterField({
  field,
  onChange,
}: {
  field: EditableParameterField;
  onChange: (value: unknown) => void;
}) {
  if (field.type === "boolean") {
    return (
      <label className="flex items-center justify-between gap-2 text-[11px] text-warm-muted">
        <span className="truncate">{field.label}</span>
        <input
          type="checkbox"
          checked={field.value === true}
          onChange={(event) => onChange(event.target.checked)}
          className="h-3.5 w-3.5 accent-warm-primary"
        />
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label className="block text-[11px] text-warm-muted">
        <span className="mb-1 block truncate">{field.label}</span>
        <select
          value={formatParameterFieldValue(field)}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1 text-[11px] text-warm-ink outline-none focus:border-warm-primary/50"
        >
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const isTextarea =
    field.type === "textarea" ||
    field.type === "string_list" ||
    field.type === "object_list" ||
    field.type === "json";

  return (
    <label className="block text-[11px] text-warm-muted">
      <span className="mb-1 block truncate">{field.label}</span>
      {isTextarea ? (
        <textarea
          value={formatParameterFieldValue(field)}
          onChange={(event) => onChange(parseParameterFieldValue(field, event.target.value))}
          rows={field.type === "textarea" ? 2 : 3}
          className="w-full resize-none rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1 text-[11px] text-warm-ink outline-none focus:border-warm-primary/50"
          placeholder={field.placeholder}
        />
      ) : (
        <input
          type={field.type === "number" ? "number" : "text"}
          value={formatParameterFieldValue(field)}
          onChange={(event) => onChange(parseParameterFieldValue(field, event.target.value))}
          className="w-full rounded-md border border-warm-line/60 bg-warm-bg px-2 py-1 text-[11px] text-warm-ink outline-none focus:border-warm-primary/50"
          placeholder={field.placeholder}
        />
      )}
    </label>
  );
}

function mapPersistedWorkflowTemplate(template: unknown): PersistedWorkflowTemplate | null {
  if (!template || typeof template !== "object" || Array.isArray(template)) return null;
  const value = template as Partial<PersistedWorkflowTemplate>;
  if (!value.id || typeof value.id !== "string") return null;
  if (!value.title || typeof value.title !== "string") return null;

  return {
    id: value.id,
    title: value.title,
    description: typeof value.description === "string" ? value.description : "",
    category: typeof value.category === "string" ? value.category : "poster_set",
    status: typeof value.status === "string" ? value.status : "published",
    version: typeof value.version === "number" ? value.version : 1,
    nodes: Array.isArray(value.nodes)
      ? value.nodes.filter(isTemplateNode)
      : [],
    edges: Array.isArray(value.edges)
      ? value.edges.map(normalizeTemplateEdge).filter(Boolean) as CanvasWorkbenchEdge[]
      : [],
    metadata:
      value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
        ? value.metadata
        : {},
  };
}

function mapWorkflowComposeDraft(draft: unknown): WorkflowComposeDraft | null {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return null;
  const value = draft as Partial<WorkflowComposeDraft>;
  if (!Array.isArray(value.nodes)) return null;

  const nodes = value.nodes
    .map((node) => normalizeComposedNode(node))
    .filter(Boolean) as CanvasWorkbenchNode[];
  const edges = Array.isArray(value.edges)
    ? value.edges.map(normalizeComposedEdge).filter(Boolean) as CanvasWorkbenchEdge[]
    : [];

  return {
    title: typeof value.title === "string" && value.title.trim() ? value.title : "工作流草案",
    description: typeof value.description === "string" ? value.description : "",
    nodes,
    edges,
    metadata:
      value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
        ? value.metadata
        : {},
  };
}

function mapWorkflowPlanPreview(payload: unknown): WorkflowPlanPreview | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Partial<WorkflowPlanPreview>;
  if (!Array.isArray(value.items) || !Array.isArray(value.editableParameters)) return null;

  return {
    title: getStringValue(value.title) || "计划预览",
    summary: getStringValue(value.summary) || "",
    items: value.items,
    images: Array.isArray(value.images) ? value.images : value.items,
    componentRefs: Array.isArray(value.componentRefs) ? value.componentRefs : [],
    qualityChecks: Array.isArray(value.qualityChecks) ? value.qualityChecks : [],
    estimatedCount:
      typeof value.estimatedCount === "number" && Number.isFinite(value.estimatedCount)
        ? value.estimatedCount
        : value.items.length,
    editableParameters: value.editableParameters,
    agentPlan:
      value.agentPlan && typeof value.agentPlan === "object" && !Array.isArray(value.agentPlan)
        ? value.agentPlan
        : undefined,
  };
}

async function enrichWorkflowPlanPreviewWithAgentPlan({
  preview,
            draft,
            brief,
            userBrief,
  projectStarterPrompt,
  copyRenderMode,
  referenceContext,
}: {
  preview: WorkflowPlanPreview;
  draft: WorkflowComposeDraft;
  brief: string;
  userBrief?: string;
  projectStarterPrompt?: string;
  copyRenderMode: "layout_layer" | "burn_in" | "metadata_only";
  referenceContext: GenerationReferenceContext;
}): Promise<AgentPlanEnrichmentResult> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timeout = controller
    ? window.setTimeout(() => controller.abort(), 12_000)
    : undefined;
  try {
    const response = await apiFetch("/api/agent-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller?.signal,
      body: JSON.stringify(buildAgentPlanPreviewRequest({
        preview,
        draft,
        brief,
        userBrief,
        projectStarterPrompt,
        copyRenderMode,
        referenceContext,
      })),
    });
    if (!response.ok) {
      return buildAgentPlanFallbackPreviewResult(
        preview,
        `Agent 规划接口返回 ${response.status}，已先展示基础计划`,
        copyRenderMode,
        userBrief || brief
      );
    }
    const payload = await response.json();
    const enrichedPreview = mergeAgentPlanIntoWorkflowPlanPreview(preview, payload);
    const validationFallbackReason = getAgentPlanValidationFallbackReason(
      enrichedPreview,
      userBrief || brief
    );
    if (validationFallbackReason) {
      return buildAgentPlanFallbackPreviewResult(preview, validationFallbackReason, copyRenderMode, userBrief || brief);
    }
    return {
      preview: enrichedPreview,
      fallbackUsed: enrichedPreview.agentPlan?.summary?.fallbackUsed === true,
      fallbackReason: enrichedPreview.agentPlan?.summary?.fallbackReason,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return buildAgentPlanFallbackPreviewResult(preview, "Agent 规划超时，已先展示基础计划", copyRenderMode, userBrief || brief);
    }
    console.warn("Agent plan preview enrichment failed:", error instanceof Error ? error.message : error);
    return buildAgentPlanFallbackPreviewResult(preview, "Agent 深度规划失败，已先展示基础计划", copyRenderMode, userBrief || brief);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

function buildAgentPlanFallbackPreviewResult(
  preview: WorkflowPlanPreview,
  reason: string,
  copyRenderMode?: "layout_layer" | "burn_in" | "metadata_only",
  brief = ""
): AgentPlanEnrichmentResult {
  return {
    preview: markWorkflowPlanPreviewAgentFallback(preview, reason, copyRenderMode, brief),
    fallbackUsed: true,
    fallbackReason: reason,
  };
}

function getAgentPlanValidationFallbackReason(
  preview: WorkflowPlanPreview,
  brief: string
): string | undefined {
  const requestedCount = parseRequestedAgentSampleCount(brief);
  if (requestedCount && preview.estimatedCount < Math.ceil(requestedCount * 0.6)) {
    return `高级理解结果不完整（只覆盖 ${preview.estimatedCount}/${requestedCount} 张），已先展示基础计划`;
  }

  const matrixItems = preview.agentPlan?.generationMatrix?.length
    ? preview.agentPlan.generationMatrix
    : buildAgentMatrixFromPreviewItems(preview.items);
  const modelRequested = hasFallbackModelIntent(brief.toLowerCase());
  const modelPresent = matrixItems.some((item) =>
    item.referenceRoles.includes("model") ||
    item.providerReferenceRoles.includes("model") ||
    /模特|真人|人物|上身|穿搭|model/.test(`${item.title} ${item.type} ${item.summary}`.toLowerCase())
  );
  if (modelRequested && !modelPresent) {
    return "高级理解没有覆盖模特展示，已先展示基础计划";
  }

  return undefined;
}

function shouldFallbackSuppressModelSlots(brief: string): boolean {
  const text = brief.toLowerCase();
  if (hasFallbackModelIntent(text)) return false;
  return /(手机|数码|电子|硬件|电脑|键盘|鼠标|耳机|相机|平板|充电器|显示器|路由器|音箱|phone|laptop|keyboard|mouse|headphone|camera|tablet|charger|monitor|speaker)/.test(text) ||
    /(纯商品|商品静物|只要商品|仅商品|无模特|无人物|不要模特|不要人物|不需要模特|不用模特|不带模特|product[-_ ]?only|no model|no person)/.test(text);
}

function hasFallbackModelIntent(text: string): boolean {
  if (/(无模特|无人物|不要模特|不要人物|不需要模特|不用模特|不带模特|no model|no person|without model|without person)/.test(text)) {
    return false;
  }
  return /(模特|真人|人物|上身|穿搭|试穿|背着|拿着|手持|佩戴|lookbook|model|person|human|wearing|holding|carrying)/.test(text);
}

function injectFallbackModelIntentIntoMatrix(
  items: WorkflowPlanPreviewAgentMatrixItem[],
  brief: string
): WorkflowPlanPreviewAgentMatrixItem[] {
  const text = brief.toLowerCase();
  if (!hasFallbackModelIntent(text)) return items;
  if (items.some((item) => item.referenceRoles.includes("model"))) return items;

  let injected = false;
  const nextItems = items.map((item) => {
    if (!isFallbackModelFriendlyMatrixItem(item)) return item;
    injected = true;
    return addModelRoleToFallbackMatrixItem(item);
  });

  if (injected) return nextItems;
  return items.map((item, index) => index === 0 ? addModelRoleToFallbackMatrixItem(item) : item);
}

function isFallbackModelFriendlyMatrixItem(item: WorkflowPlanPreviewAgentMatrixItem): boolean {
  const text = `${item.title} ${item.type} ${item.outputSlotId ?? ""} ${item.summary}`.toLowerCase();
  if (/(详情|细节|材质|特写|工艺|detail|macro|material)/.test(text)) return false;
  return /(场景|生活|使用|海报|卖点|封面|主图|收尾|scene|lifestyle|poster|feature|cover|hero|main|closing)/.test(text);
}

function addModelRoleToFallbackMatrixItem(
  item: WorkflowPlanPreviewAgentMatrixItem
): WorkflowPlanPreviewAgentMatrixItem {
  return {
    ...item,
    referenceRoles: agentUniqueStrings([...item.referenceRoles, "model"]),
    summary: mergeAgentPlanContentInstruction(item.summary, "包含用户要求的模特出镜和商品佩戴/手持关系"),
  };
}

function removeFallbackModelSlotsFromPreview(preview: WorkflowPlanPreview): WorkflowPlanPreview {
  const items = preview.items.filter((item) => !isFallbackModelPreviewItem(item));
  if (items.length === 0 || items.length === preview.items.length) return preview;
  const itemIds = new Set(items.map((item) => item.id));
  const itemSlots = new Set(items.flatMap((item) => [item.slot, getPreviewItemBaseSlotId(item.slot)]));
  const agentPlan = preview.agentPlan;
  const filteredImages = preview.images.filter((item) => itemIds.has(item.id) || !isFallbackModelPreviewItem(item));
  return {
    ...preview,
    items,
    images: filteredImages.length > 0 ? filteredImages : items,
    estimatedCount: items.length,
    agentPlan: agentPlan
      ? {
          ...agentPlan,
          sampleCount: Math.min(agentPlan.sampleCount, items.length),
          fullCount: Math.min(agentPlan.fullCount, items.length),
          outputSlots: agentPlan.outputSlots.filter((slot) =>
            itemSlots.has(slot.id) || !isFallbackModelSlotText(`${slot.id} ${slot.label} ${slot.purpose}`)
          ),
          generationMatrix: agentPlan.generationMatrix?.filter((item) =>
            itemIds.has(item.itemId) ||
            itemSlots.has(item.outputSlotId || "") ||
            !isFallbackModelSlotText(`${item.itemId} ${item.outputSlotId ?? ""} ${item.type} ${item.title} ${item.summary}`)
          ),
        }
      : undefined,
  };
}

function isFallbackModelPreviewItem(item: WorkflowPlanPreviewItem): boolean {
  return isFallbackModelSlotText(`${item.id} ${item.slot} ${item.title} ${item.purpose}`);
}

function isFallbackModelSlotText(text: string): boolean {
  return /(^|[\s_-])(model|model_display|model-showcase)([\s_-]|$)|模特|真人|人物|上身|穿搭/.test(text.toLowerCase());
}

function ensureFallbackSceneSlotsFromBrief(
  preview: WorkflowPlanPreview,
  brief: string,
  copyRenderMode?: "layout_layer" | "burn_in" | "metadata_only"
): WorkflowPlanPreview {
  if (!hasFallbackSceneExpansionIntent(brief)) return preview;
  const scenes = extractFallbackSceneNames(brief);
  if (scenes.length === 0) return preview;
  const shouldReplaceGenericScene = scenes.length > 1 || scenes[0] !== "多场景";
  if (preview.items.some(isFallbackScenePreviewItem) && !shouldReplaceGenericScene) return preview;

  const perSceneCount = getFallbackPerSceneCount(brief);
  const sceneCopyMode = getFallbackSceneCopyMode(brief, copyRenderMode);
  const sceneOnlyPlan = shouldUseSceneOnlyFallbackPlan(brief, preview, scenes, perSceneCount);
  const baseItems = sceneOnlyPlan
    ? []
    : shouldReplaceGenericScene
    ? preview.items.filter((item) => !isFallbackScenePreviewItem(item))
    : preview.items;
  const baseImages = sceneOnlyPlan
    ? []
    : shouldReplaceGenericScene
    ? preview.images.filter((item) => !isFallbackScenePreviewItem(item))
    : preview.images;
  const startIndex = baseItems.length + 1;
  const sceneItems = scenes.flatMap((scene, sceneIndex) =>
    Array.from({ length: perSceneCount }, (_, itemIndex): WorkflowPlanPreviewItem => {
      const ordinal = startIndex + sceneIndex * perSceneCount + itemIndex;
      const sceneTitle = sceneCopyMode === "burn_in"
        ? `${scene}场景海报 ${itemIndex + 1}`
        : `${scene}场景 ${itemIndex + 1}`;
      return {
        id: `scene_fallback_${ordinal}`,
        title: sceneTitle,
        purpose: sceneCopyMode === "burn_in"
          ? `展示商品在${scene}场景里的空间、光影和使用氛围，并承载海报短文案`
          : `展示商品在${scene}场景里的空间、光影和使用氛围`,
        slot: `scene_${sceneIndex + 1}_${itemIndex + 1}`,
        ratio: "4:5",
        copyMode: sceneCopyMode,
        platform: preview.items[0]?.platform,
        componentRefs: [],
        qualityChecks: [],
      };
    })
  );
  const sceneReferenceRoles = sceneCopyMode === "burn_in"
    ? ["product", "style", "scene", "copy"]
    : ["product", "style", "scene"];
  const sceneMatrix = sceneItems.map((item): WorkflowPlanPreviewAgentMatrixItem => ({
    id: `matrix_${item.id}`,
    itemId: item.id,
    title: item.title,
    type: item.slot,
    outputSlotId: getPreviewItemBaseSlotId(item.slot),
    ratio: item.ratio,
    size: item.size,
    referenceRoles: sceneReferenceRoles,
    providerReferenceRoles: [],
    assetGroupIds: [],
    copyMode: sceneCopyMode,
    missingInputIds: [],
    status: "ready",
    summary: item.purpose,
  }));
  const sceneSlots = scenes.map((scene, index) => ({
    id: `scene_${index + 1}`,
    label: `${scene}场景`,
    purpose: `让商品进入${scene}场景，验证空间、光影和使用氛围`,
    ratio: "4:5",
    samplePhase: true,
  }));
  const agentPlan = preview.agentPlan;
  const nextItems = [...baseItems, ...sceneItems];
  const baseMatrix = sceneOnlyPlan
    ? []
    : agentPlan?.generationMatrix?.length
    ? agentPlan.generationMatrix
    : buildAgentMatrixFromPreviewItems(baseItems);
  const nextMatrixBase = sceneOnlyPlan
    ? []
    : shouldReplaceGenericScene
    ? baseMatrix.filter((item) => !isFallbackScenePlanItem(item))
    : baseMatrix;
  return {
    ...preview,
    items: nextItems,
    images: [...baseImages, ...sceneItems],
    estimatedCount: nextItems.length,
    agentPlan: agentPlan
      ? {
          ...agentPlan,
          sampleCount: Math.max(agentPlan.sampleCount, nextItems.length),
          fullCount: Math.max(agentPlan.fullCount, nextItems.length),
          optionalAssetRoles: agentUniqueStrings([...agentPlan.optionalAssetRoles, "scene"]),
          outputSlots: [
            ...(sceneOnlyPlan
              ? []
              : shouldReplaceGenericScene
              ? agentPlan.outputSlots.filter((slot) => !isFallbackSceneSlotText(`${slot.id} ${slot.label} ${slot.purpose}`))
              : agentPlan.outputSlots),
            ...sceneSlots,
          ],
          generationMatrix: [...nextMatrixBase, ...sceneMatrix],
        }
      : preview.agentPlan,
  };
}

function shouldUseSceneOnlyFallbackPlan(
  brief: string,
  preview: WorkflowPlanPreview,
  scenes: string[],
  perSceneCount: number
): boolean {
  if (hasFallbackAdditionalNonSceneDeliverable(brief)) return false;
  const requestedSceneCount = parseRequestedMultiSceneSampleCount(brief);
  if (!requestedSceneCount || requestedSceneCount !== scenes.length * perSceneCount) return false;
  if (scenes.length <= 1 || preview.items.length > 3) return false;
  return preview.items.every(isFallbackGenericPosterPreviewItem);
}

function hasFallbackAdditionalNonSceneDeliverable(brief: string): boolean {
  const compact = brief.replace(/\s+/g, "");
  return /(另外|另做|再做|再来|加一?张|加[0-9一二两三四五六七八九十]+张).*(海报|封面|主图|详情|细节|卖点|poster|cover|detail)/i.test(compact);
}

function hasFallbackSceneExpansionIntent(brief: string): boolean {
  const text = brief.toLowerCase();
  return /(多场景|[0-9一二两三四五六七八九十]+个?场景|场景各|各[0-9一二两三四五六七八九十]+张|办公室|健身房|露营|车库|工具墙|商场|咖啡厅|家居|厨房|卧室|雪山|街拍|户外|室内)/.test(text);
}

function hasFallbackSceneGroupIntent(brief: string): boolean {
  return hasFallbackSceneExpansionIntent(brief) ||
    /(场景图|使用场景|场景化|生活方式|生活场景|scene|lifestyle)/i.test(brief);
}

function extractFallbackSceneNames(brief: string): string[] {
  const trailingScenes = extractFallbackSceneNamesBeforeCount(brief);
  if (trailingScenes.length > 0) return trailingScenes.slice(0, 5);

  const explicitScenes = extractFallbackSceneNamesFromList(brief);
  if (explicitScenes.length > 0) return explicitScenes.slice(0, 5);

  const sceneTerms = ["办公室", "健身房", "露营", "车库", "工具墙", "商场", "咖啡厅", "家居", "厨房", "卧室", "书桌", "客厅", "雪山", "街拍", "户外", "室内"];
  const found = sceneTerms.filter((term) => brief.includes(term));
  return found.length > 0 ? agentUniqueStrings(found).slice(0, 5) : ["多场景"];
}

function extractFallbackSceneNamesBeforeCount(brief: string): string[] {
  const match = brief.match(
    /(?:^|[，,。；;])([^。；;]+?)[0-9一二两三四五六七八九十]+个?场景(?:每个|每场景|场景各|各)?\s*[0-9一二两三四五六七八九十]+\s*张/
  );
  return normalizeFallbackSceneNameList(match?.[1]);
}

function extractFallbackSceneNamesFromList(brief: string): string[] {
  const explicitSceneList = brief.match(
    /[0-9一二两三四五六七八九十]+个?场景[：:，,\s]*(.+?)(?:每个|各[0-9一二两三四五六七八九十]+张|另外|再做|不要|更偏|。|；|;|$)/
  );
  const genericSceneList = brief.match(
    /多场景[：:，,\s]*(.+?)(?:每个|各[0-9一二两三四五六七八九十]+张|另外|再做|不要|更偏|。|；|;|$)/
  );
  const trailingSceneList = brief.match(
    /(?:^|[，,。；;])([^。；;]+?)[0-9一二两三四五六七八九十]+个?场景(?:每个|每场景|场景各|各)?\s*[0-9一二两三四五六七八九十]+\s*张/
  );
  const match = trailingSceneList ?? explicitSceneList ?? genericSceneList;
  const listText = match?.[1]?.trim();
  return normalizeFallbackSceneNameList(listText);
}

function normalizeFallbackSceneNameList(listText?: string): string[] {
  if (!listText) return [];
  return agentUniqueStrings(
    listText
      .split(/[、，,\/|]+/)
      .map((item) => item.replace(/^.*[：:]/, "").replace(/^(分别是|包括|包含|有|和|与)/, "").replace(/场景$/, "").trim())
      .filter((item) => item.length >= 2 && item.length <= 12)
  );
}

function getFallbackPerSceneCount(brief: string): number {
  const compact = brief.replace(/\s+/g, "");
  const count = parseAgentPlanEditCount(
    compact.match(/(?:每个|每个场景|每场景|场景各|各)([0-9一二两三四五六七八九十]+)张/)?.[1]
  );
  return count > 0 ? Math.min(count, 4) : 2;
}

function getFallbackSceneCopyMode(
  brief: string,
  copyRenderMode?: "layout_layer" | "burn_in" | "metadata_only"
): string {
  const compact = brief.replace(/\s+/g, "");
  if (
    hasFallbackAdditionalNonSceneDeliverable(brief) &&
    !hasFallbackCopyBurnInTargetIntent(brief, "场景|多场景|scene")
  ) {
    return "layout_layer";
  }
  if (/(海报|封面|poster|cover).*(烧字|烧进|带字|进图)/.test(compact)) return "burn_in";
  if (/(其他|场景|详情).*(图层|不进图|后期改字)/.test(compact)) return "layout_layer";
  if (/(场景|多场景).*(烧字|烧进|带字|进图)/.test(compact)) return "burn_in";
  return copyRenderMode === "metadata_only" ? "metadata_only" : "layout_layer";
}

function ensureFallbackPosterSlotFromBrief(
  preview: WorkflowPlanPreview,
  brief: string
): WorkflowPlanPreview {
  const requestedCount = getFallbackExplicitPosterCount(brief) || (hasFallbackExplicitPosterIntent(brief) ? 1 : 0);
  if (requestedCount <= 0) return preview;
  const existingPosterCount = preview.items.filter((item) =>
    isFallbackPosterPreviewItem(item) && !isFallbackScenePreviewItem(item)
  ).length;
  if (existingPosterCount >= requestedCount) return preview;

  const target = agentPlanEditTargets.find((item) => item.id === "poster");
  if (!target) return preview;
  const existingMatrix = preview.agentPlan?.generationMatrix?.length
    ? preview.agentPlan.generationMatrix
    : buildAgentMatrixFromPreviewItems(preview.items);
  const created = createAgentPlanItemsForNewTarget({
    target,
    count: requestedCount - existingPosterCount,
    instruction: "卖点海报，短文案放画面安全区",
    existingItems: preview.items,
    existingMatrix,
  });
  const items = [...preview.items, ...created.items];
  const matrix = [...existingMatrix, ...created.matrix];
  const addedSlots = created.items.map((item) => ({
    id: item.slot || item.id,
    label: item.title,
    purpose: item.purpose,
    ratio: item.ratio,
    samplePhase: true,
  }));

  return {
    ...preview,
    items,
    images: [...preview.images, ...created.items],
    estimatedCount: items.length,
    agentPlan: preview.agentPlan
      ? {
          ...preview.agentPlan,
          sampleCount: Math.max(preview.agentPlan.sampleCount, items.length),
          fullCount: Math.max(preview.agentPlan.fullCount, items.length),
          outputSlots: [...preview.agentPlan.outputSlots, ...addedSlots],
          generationMatrix: matrix,
        }
      : preview.agentPlan,
  };
}

function hasFallbackExplicitPosterIntent(brief: string): boolean {
  const compact = brief.replace(/\s+/g, "");
  return /(海报|封面|poster|cover)/i.test(compact) &&
    /(再加|另外|另做|加一?张|带短标题|短标题|海报写|封面写|文案烧进图|烧字|烧进|带字|进图)/i.test(compact);
}

function applyFallbackExplicitPosterCount(
  preview: WorkflowPlanPreview,
  brief: string
): WorkflowPlanPreview {
  const count = getFallbackExplicitPosterCount(brief);
  if (count <= 0) return preview;
  const posterItems = preview.items.filter((item) =>
    isFallbackPosterPreviewItem(item) && !isFallbackScenePreviewItem(item)
  );
  if (posterItems.length <= count) return preview;

  const keptPosterIds = new Set(posterItems.slice(0, count).map((item) => item.id));
  const items = preview.items.filter((item) =>
    !isFallbackPosterPreviewItem(item) || isFallbackScenePreviewItem(item) || keptPosterIds.has(item.id)
  );
  const itemIds = new Set(items.map((item) => item.id));
  const itemSlots = new Set(items.flatMap((item) => [item.slot, getPreviewItemBaseSlotId(item.slot)]));
  const agentPlan = preview.agentPlan;

  return {
    ...preview,
    items,
    images: preview.images.filter((item) => itemIds.has(item.id) || !isFallbackPosterPreviewItem(item)),
    estimatedCount: items.length,
    agentPlan: agentPlan
      ? {
          ...agentPlan,
          sampleCount: Math.min(agentPlan.sampleCount, items.length),
          fullCount: Math.min(agentPlan.fullCount, items.length),
          outputSlots: agentPlan.outputSlots.filter((slot) =>
            itemSlots.has(slot.id) || !isFallbackPosterSlotText(`${slot.id} ${slot.label} ${slot.purpose}`)
          ),
          generationMatrix: agentPlan.generationMatrix?.filter((item) =>
            itemIds.has(item.itemId) ||
            itemSlots.has(item.outputSlotId || "") ||
            !isFallbackPosterSlotText(`${item.itemId} ${item.outputSlotId ?? ""} ${item.type} ${item.title} ${item.summary}`)
          ),
        }
      : preview.agentPlan,
  };
}

function getFallbackExplicitPosterCount(brief: string): number {
  const compact = brief.replace(/\s+/g, "");
  const count = parseAgentPlanEditCount(
    compact.match(/([0-9一二两三四五六七八九十]+)张(?:商品)?(?:海报|poster|封面)/i)?.[1] ??
      compact.match(/([0-9一二两三四五六七八九十]+)张[^，。；;]*(?:海报|poster|封面)/i)?.[1] ??
      compact.match(/(?:海报|poster|封面)(?:要|做|来)?([0-9一二两三四五六七八九十]+)张/i)?.[1]
  );
  return count > 0 && count <= 20 ? count : 0;
}

function isFallbackPosterPreviewItem(item: WorkflowPlanPreviewItem): boolean {
  return isFallbackPosterSlotText(`${item.id} ${item.slot} ${item.title} ${item.purpose}`);
}

function isFallbackGenericPosterPreviewItem(item: WorkflowPlanPreviewItem): boolean {
  return /(海报|封面|banner|poster|cover|hero|主视觉|标题区|vertical|横版|竖版)/i.test(
    `${item.id} ${item.slot} ${item.title} ${item.purpose}`.toLowerCase()
  );
}

function isFallbackPosterSlotText(text: string): boolean {
  return /(海报|封面|banner|poster|cover|hero|主视觉|标题区)/i.test(text.toLowerCase());
}

function applyFallbackExplicitTotalCount(
  preview: WorkflowPlanPreview,
  brief: string
): WorkflowPlanPreview {
  const requestedCount = parseRequestedStandaloneAgentSampleCount(brief);
  if (!requestedCount || requestedCount <= 0 || requestedCount > maxAgentSampleOutputCount) return preview;
  if (hasFallbackSceneExpansionIntent(brief) && requestedCount < preview.items.length) return preview;
  let normalizedPreview = preview.items.length < requestedCount
    ? ensureFallbackBriefTargetGroups(preview, brief, requestedCount)
    : preview;
  if (normalizedPreview.items.length === requestedCount) return normalizedPreview;
  if (normalizedPreview.items.length === 0) return normalizedPreview;

  if (normalizedPreview.items.length > requestedCount) {
    const items = normalizedPreview.items.slice(0, requestedCount);
    const itemIds = new Set(items.map((item) => item.id));
    return {
      ...normalizedPreview,
      items,
      images: normalizedPreview.images.filter((item) => itemIds.has(item.id)),
      estimatedCount: items.length,
    };
  }

  const sourceItem = getFallbackTotalCountExpansionSourceItem(normalizedPreview.items, brief);
  const extraItems = Array.from(
    { length: requestedCount - normalizedPreview.items.length },
    (_, index) => cloneFallbackTotalCountItem(sourceItem, normalizedPreview.items.length + index + 1, index + 1)
  );
  const items = [...normalizedPreview.items, ...extraItems];
  return {
    ...normalizedPreview,
    items,
    images: [...normalizedPreview.images, ...extraItems],
    estimatedCount: items.length,
  };
}

function ensureFallbackBriefTargetGroups(
  preview: WorkflowPlanPreview,
  brief: string,
  requestedCount: number
): WorkflowPlanPreview {
  const specs = getFallbackBriefTargetGroupSpecs(brief);
  if (specs.length === 0) return preview;

  let items = [...preview.items];
  let matrix = preview.agentPlan?.generationMatrix?.length
    ? [...preview.agentPlan.generationMatrix]
    : buildAgentMatrixFromPreviewItems(items);
  let remaining = Math.max(0, requestedCount - items.length);
  if (remaining === 0) return preview;

  for (const spec of specs) {
    if (remaining <= 0) break;
    const hasTarget =
      items.some((item) => agentPlanPreviewItemMatchesTarget(item, spec.target)) ||
      matrix.some((item) => agentPlanMatrixItemMatchesTarget(item, spec.target));
    if (hasTarget) continue;
    const count = Math.min(spec.count, remaining);
    const created = createAgentPlanItemsForNewTarget({
      target: spec.target,
      count,
      instruction: spec.instruction,
      existingItems: items,
      existingMatrix: matrix,
    });
    items = [...items, ...created.items];
    matrix = [...matrix, ...created.matrix];
    remaining -= created.items.length;
  }

  if (items.length === preview.items.length) return preview;
  const outputSlots = items.map((item) => ({
    id: item.slot || item.id,
    label: item.title,
    purpose: item.purpose,
    ratio: item.ratio,
    samplePhase: true,
  }));
  return {
    ...preview,
    items,
    images: [...preview.images, ...items.filter((item) => !preview.items.some((existing) => existing.id === item.id))],
    estimatedCount: items.length,
    agentPlan: preview.agentPlan
      ? {
          ...preview.agentPlan,
          sampleCount: items.length,
          fullCount: Math.max(preview.agentPlan.fullCount, items.length),
          outputSlots,
          generationMatrix: matrix,
        }
      : preview.agentPlan,
  };
}

function getFallbackBriefTargetGroupSpecs(
  brief: string
): Array<{ target: AgentPlanEditTarget; count: number; instruction: string }> {
  const text = brief.toLowerCase();
  const specs: Array<{ target: AgentPlanEditTarget; count: number; instruction: string }> = [];
  const push = (targetId: AgentPlanEditTarget["id"], count: number, instruction: string) => {
    const target = agentPlanEditTargets.find((item) => item.id === targetId);
    if (!target || specs.some((item) => item.target.id === target.id)) return;
    specs.push({ target, count, instruction });
  };

  if (/(主图|白底|main|hero)/i.test(text)) push("main", 1, "商品主图/白底主图");
  if (hasFallbackModelIntent(text)) push("model", 3, "同一个模特出镜，动作和神态要有变化");
  if (/(详情|细节|材质|特写|参数|detail|macro|material|spec)/i.test(text)) {
    push("detail", 2, "商品细节、材质、参数和做工证据");
  }
  if (/(海报|卖点|封面|poster|feature|cover)/i.test(text)) {
    push("poster", getFallbackExplicitPosterCount(brief) || 2, "卖点海报，短文案放画面安全区");
  }
  if (hasFallbackSceneGroupIntent(brief)) push("scene", 2, "场景化使用氛围");
  return specs;
}

function getFallbackTotalCountExpansionSourceItem(
  items: WorkflowPlanPreviewItem[],
  brief: string
): WorkflowPlanPreviewItem {
  const text = brief.toLowerCase();
  const pick = (pattern: RegExp) =>
    items.find((item) => pattern.test(`${item.title} ${item.purpose} ${item.slot}`.toLowerCase()));
  if (/详情|细节|参数|detail|spec/.test(text)) {
    const detail = pick(/详情|细节|材质|参数|detail|macro|spec/);
    if (detail) return detail;
  }
  if (/海报|卖点|封面|poster|cover|feature/.test(text)) {
    const poster = pick(/海报|卖点|封面|poster|cover|feature/);
    if (poster) return poster;
  }
  if (/场景|生活|街拍|商场|户外|室内|scene|lifestyle/.test(text)) {
    const scene = pick(/场景|生活|使用|scene|lifestyle/);
    if (scene) return scene;
  }
  return [...items].reverse().find((item) => !isFallbackClosingPreviewItem(item)) ?? items[items.length - 1] ?? items[0];
}

function cloneFallbackTotalCountItem(
  item: WorkflowPlanPreviewItem,
  ordinal: number,
  sequence: number
): WorkflowPlanPreviewItem {
  return {
    ...item,
    id: `${item.id}_explicit_${sequence}`,
    title: `${item.title} ${sequence + 1}`,
    slot: `${item.slot}_explicit_${sequence}`,
    purpose: `${item.purpose}（按用户要求补足总张数）`,
  };
}

function isFallbackClosingPreviewItem(item: WorkflowPlanPreviewItem): boolean {
  return /(收尾|closing|转化尾图)/i.test(`${item.title} ${item.purpose} ${item.slot}`);
}

function markWorkflowPlanPreviewAgentFallback(
  preview: WorkflowPlanPreview,
  reason: string,
  copyRenderMode?: "layout_layer" | "burn_in" | "metadata_only",
  brief = ""
): WorkflowPlanPreview {
  let normalizedPreview = shouldFallbackSuppressModelSlots(brief)
    ? removeFallbackModelSlotsFromPreview(preview)
    : preview;
  normalizedPreview = ensureFallbackSceneSlotsFromBrief(normalizedPreview, brief, copyRenderMode);
  normalizedPreview = ensureFallbackPosterSlotFromBrief(normalizedPreview, brief);
  normalizedPreview = applyFallbackExplicitPosterCount(normalizedPreview, brief);
  normalizedPreview = applyFallbackExplicitTotalCount(normalizedPreview, brief);
  const existing = normalizedPreview.agentPlan;
  const rawFallbackMatrixBase = existing?.generationMatrix?.length
    && existing.generationMatrix.length === normalizedPreview.items.length
    ? existing.generationMatrix
    : buildAgentMatrixFromPreviewItems(normalizedPreview.items);
  const rawFallbackMatrix = injectFallbackModelIntentIntoMatrix(rawFallbackMatrixBase, brief);
  const fallbackMatrix = copyRenderMode && copyRenderMode !== "layout_layer"
    ? rawFallbackMatrix.map((item) => ({
        ...item,
        copyMode: copyRenderMode === "burn_in" && shouldFallbackMatrixItemBurnInCopy(item, brief)
          ? "burn_in"
          : copyRenderMode === "metadata_only"
            ? "metadata_only"
            : "layout_layer",
      }))
    : rawFallbackMatrix;
  const fallbackOutputSlots = existing?.outputSlots?.length
    && existing.outputSlots.length === normalizedPreview.items.length
    ? existing.outputSlots
    : normalizedPreview.items.map((item) => ({
        id: getPreviewItemBaseSlotId(item.slot || item.id),
        label: getAgentPlanGroupDisplayTitle(item.title, getPreviewItemBaseSlotId(item.slot || item.id)),
        purpose: item.purpose,
        ratio: item.ratio,
        samplePhase: true,
      }));
  const fallbackCopyMode = copyRenderMode ?? existing?.copyPolicy?.requestedMode ?? "layout_layer";
  const fallbackCopyPolicy = existing?.copyPolicy
    ? {
        ...existing.copyPolicy,
        requestedMode: fallbackCopyMode,
        allowBurnIn: existing.copyPolicy.allowBurnIn || fallbackCopyMode === "burn_in",
        note: fallbackCopyMode === "burn_in"
          ? "用户已要求文案烧进图；fallback 计划会保留该策略，生成时需检查安全区。"
          : existing.copyPolicy.note,
      }
    : {
        defaultMode: "layout_layer",
        requestedMode: fallbackCopyMode,
        allowBurnIn: fallbackCopyMode === "burn_in",
        note: fallbackCopyMode === "burn_in"
          ? "用户已要求文案烧进图；fallback 计划会保留该策略，生成时需检查安全区。"
          : "文案默认作为图层，Agent 会按需求判断是否烧进图。",
      };

  return {
    ...normalizedPreview,
    estimatedCount: fallbackMatrix.length || normalizedPreview.estimatedCount,
    agentPlan: {
      skillId: existing?.skillId || "agent-plan-fallback",
      title: existing?.title || "基础计划",
      shortLabel: existing?.shortLabel || "基础计划",
      compositionMode: existing?.compositionMode || "unknown",
      summary: {
        mode: existing?.summary?.mode || "deterministic_agent_plan_v1",
        fallbackUsed: true,
        fallbackReason: reason,
        text: "Agent 深度规划暂不可用，已先展示基础制作计划。",
        itemCount: fallbackMatrix.length,
        readyItemCount: fallbackMatrix.filter((item) => item.status === "ready").length,
        blockedItemCount: fallbackMatrix.filter((item) => item.status === "blocked").length,
      },
      sampleCount: fallbackMatrix.length || existing?.sampleCount || normalizedPreview.estimatedCount,
      fullCount: fallbackMatrix.length || existing?.fullCount || normalizedPreview.estimatedCount,
      requiredAssetRoles: existing?.requiredAssetRoles ?? [],
      optionalAssetRoles: existing?.optionalAssetRoles ?? [],
      copyPolicy: fallbackCopyPolicy,
      phases: existing?.phases ?? [],
      outputSlots: fallbackOutputSlots,
      assetGroups: existing?.assetGroups ?? [],
      generationMatrix: fallbackMatrix,
      missingInputs: existing?.missingInputs ?? [],
    },
  };
}

function buildAgentPlanPreviewRequest({
  preview,
  draft,
  brief,
  userBrief,
  projectStarterPrompt,
  copyRenderMode,
  referenceContext,
}: {
  preview: WorkflowPlanPreview;
  draft: WorkflowComposeDraft;
  brief: string;
  userBrief?: string;
  projectStarterPrompt?: string;
  copyRenderMode: "layout_layer" | "burn_in" | "metadata_only";
  referenceContext: GenerationReferenceContext;
}) {
  const metadata = draft.metadata ?? {};
  const platforms = getStringArray(metadata.platforms);
  const outputPacks = getStringArray(metadata.outputPacks);
  const campaignBible = getRecordValue(metadata.campaignBible);
  const shotList = Array.isArray(metadata.shotList) ? metadata.shotList : undefined;

  return {
    workflowId: `agent_preview_${Date.now()}`,
    frameNodeId: "agent-preview-frame",
    batchId: "agent-preview-batch",
    request: brief,
    userRequest: userBrief || brief,
    brief,
    projectStarterPrompt: projectStarterPrompt || undefined,
    projectIntent: projectStarterPrompt || undefined,
    platforms,
    outputPacks,
    copyRenderMode,
    referenceContext,
    campaignBible: Object.keys(campaignBible).length > 0 ? campaignBible : undefined,
    shotList,
    items: preview.items.map((item) => ({
      itemId: item.id,
      id: item.id,
      title: item.title,
      type: item.slot || item.id,
      prompt: item.purpose,
      ratio: item.ratio === "auto" ? undefined : item.ratio,
      size: item.size,
      copyRenderMode,
      metadata: {
        planPreviewSlot: item.slot,
        platform: item.platform,
      },
    })),
    agentPlanMode: "llm",
  };
}

function mergeAgentPlanIntoWorkflowPlanPreview(
  preview: WorkflowPlanPreview,
  payload: unknown
): WorkflowPlanPreview {
  const record = getRecordValue(payload);
  const agentRecord = getRecordValue(record.agentPlan);
  if (Object.keys(agentRecord).length === 0) return preview;
  const existing = preview.agentPlan;
  const summary = getRecordValue(agentRecord.summary);
  const selectedSkillIds = getStringArray(agentRecord.selectedSkillIds);
  const skillId = existing?.skillId || selectedSkillIds[0] || "agent-plan";

  return {
    ...preview,
    agentPlan: {
      skillId,
      title: existing?.title || skillId,
      shortLabel: existing?.shortLabel || "Agent",
      sampleCount: existing?.sampleCount ?? preview.estimatedCount,
      fullCount: existing?.fullCount ?? preview.estimatedCount,
      requiredAssetRoles: existing?.requiredAssetRoles ?? [],
      optionalAssetRoles: existing?.optionalAssetRoles ?? [],
      copyPolicy: existing?.copyPolicy ?? {
        defaultMode: "layout_layer",
        requestedMode: "layout_layer",
        allowBurnIn: false,
        note: "文案默认作为图层，Agent 会按需求判断是否烧进图。",
      },
      phases: existing?.phases ?? [],
      outputSlots: existing?.outputSlots ?? [],
      compositionMode: getStringValue(agentRecord.compositionMode),
      summary: {
        mode: getStringValue(summary.mode),
        fallbackUsed: summary.fallbackUsed === true,
        fallbackReason: getStringValue(summary.fallbackReason),
        text: getStringValue(summary.text),
        itemCount: getFiniteNumber(summary.itemCount),
        readyItemCount: getFiniteNumber(summary.readyItemCount),
        blockedItemCount: getFiniteNumber(summary.blockedItemCount),
      },
      assetGroups: mapAgentPlanAssetGroups(agentRecord.assetGroups),
      generationMatrix: mapAgentPlanMatrixItems(agentRecord.generationMatrix),
      missingInputs: mapAgentPlanMissingInputs(agentRecord.missingInputs),
    },
  };
}

function shouldFallbackMatrixItemBurnInCopy(
  item: WorkflowPlanPreviewAgentMatrixItem,
  brief: string
): boolean {
  if (!item.referenceRoles.includes("copy")) return false;
  const text = `${item.title} ${item.type} ${item.outputSlotId ?? ""} ${item.summary}`.toLowerCase();
  if (hasFallbackCopyLayerTargetIntent(brief, "详情页|商品详情") && /(详情|细节|材质|参数|场景|detail|macro|material|spec|scene)/i.test(text)) {
    return false;
  }
  if (hasFallbackCopyLayerTargetIntent(brief, "场景|多场景|scene") && /(场景|scene|lifestyle)/i.test(text)) {
    return false;
  }
  if (hasFallbackCopyLayerTargetIntent(brief, "海报|封面|poster|cover") && /(海报|封面|poster|cover)/i.test(text)) {
    return false;
  }
  if (hasFallbackCopyBurnInTargetIntent(brief, "全部|所有|整套")) return true;
  if (hasFallbackCopyBurnInTargetIntent(brief, "详情页|商品详情") && /(详情|细节|材质|参数|detail|macro|material|spec)/i.test(text)) {
    return true;
  }
  if (hasFallbackCopyBurnInTargetIntent(brief, "海报|封面|poster|cover")) {
    return /(海报|封面|主视觉|poster|cover|banner)/i.test(text);
  }
  if (hasFallbackCopyBurnInTargetIntent(brief, "卖点|feature")) {
    return /(卖点|feature)/i.test(text);
  }
  if (hasFallbackCopyBurnInTargetIntent(brief, "收尾|转化尾图|closing")) {
    return /(收尾|转化尾图|closing)/i.test(text);
  }
  if (hasFallbackCopyBurnInTargetIntent(brief, "主图|白底|main|hero")) {
    return /(主图|白底|main|hero)/i.test(text);
  }
  if (hasFallbackCopyBurnInTargetIntent(brief, "细节|详情|参数|detail|macro|spec")) {
    return /(细节|详情|参数|detail|macro|spec)/i.test(text);
  }
  return /(海报|封面|主视觉|poster|cover|banner)/i.test(text);
}

function hasFallbackCopyBurnInTargetIntent(brief: string, targetPattern: string): boolean {
  const compact = brief.replace(/\s+/g, "").toLowerCase();
  const localGap = "[^，。；、:：,.!?\\n]{0,12}";
  const copyPattern = "烧字|烧进|进图|带字|出字";
  return new RegExp(`(?:${targetPattern})${localGap}(?:${copyPattern})|(?:${copyPattern})${localGap}(?:${targetPattern})`, "i").test(compact);
}

function hasFallbackCopyLayerTargetIntent(brief: string, targetPattern: string): boolean {
  const compact = brief.replace(/\s+/g, "").toLowerCase();
  const localGap = "[^，。；、:：,.!?\\n]{0,14}";
  const layerPattern = "图层|不进图|不入图|不烧字|不烧进|后期改字|可编辑";
  return new RegExp(`(?:${targetPattern})${localGap}(?:${layerPattern})|(?:${layerPattern})${localGap}(?:${targetPattern})`, "i").test(compact);
}

function mapAgentPlanAssetGroups(value: unknown): WorkflowPlanPreviewAgentAssetGroup[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): WorkflowPlanPreviewAgentAssetGroup[] => {
    const record = getRecordValue(item);
    const id = getStringValue(record.id);
    const role = getStringValue(record.role);
    if (!id || !role) return [];
    return [{
      id,
      role,
      title: getStringValue(record.title) || role,
      required: record.required === true,
      available: record.available === true,
      providerUsable: record.providerUsable === true,
      usage: getStringValue(record.usage) || "optional",
      imageCount: getFiniteNumber(record.imageCount) ?? 0,
      assetIds: getStringArray(record.assetIds),
      sourceNodeIds: getStringArray(record.sourceNodeIds),
      componentIds: getStringArray(record.componentIds),
      notes: getStringArray(record.notes),
    }];
  });
}

function mapAgentPlanMatrixItems(value: unknown): WorkflowPlanPreviewAgentMatrixItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): WorkflowPlanPreviewAgentMatrixItem[] => {
    const record = getRecordValue(item);
    const id = getStringValue(record.id);
    const itemId = getStringValue(record.itemId);
    if (!id || !itemId) return [];
    return [{
      id,
      itemId,
      title: getStringValue(record.title) || itemId,
      type: getStringValue(record.type) || "image",
      ratio: getStringValue(record.ratio),
      size: getStringValue(record.size),
      skillId: getStringValue(record.skillId),
      outputSlotId: getStringValue(record.outputSlotId),
      referenceRoles: getStringArray(record.referenceRoles),
      providerReferenceRoles: getStringArray(record.providerReferenceRoles),
      assetGroupIds: getStringArray(record.assetGroupIds),
      copyMode: getStringValue(record.copyMode),
      missingInputIds: getStringArray(record.missingInputIds),
      status: getStringValue(record.status) === "blocked" ? "blocked" : "ready",
      summary: getStringValue(record.summary) || "",
    }];
  });
}

function mapAgentPlanMissingInputs(value: unknown): WorkflowPlanPreviewAgentMissingInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): WorkflowPlanPreviewAgentMissingInput[] => {
    const record = getRecordValue(item);
    const id = getStringValue(record.id);
    if (!id) return [];
    return [{
      id,
      label: getStringValue(record.label) || id,
      role: getStringValue(record.role),
      required: record.required === true,
      reason: getStringValue(record.reason) || "",
      blocking: record.blocking === true,
    }];
  });
}

function updatePlanPreviewParameter(
  preview: WorkflowPlanPreview | null,
  nodeId: string,
  key: string,
  value: unknown
): WorkflowPlanPreview | null {
  if (!preview) return preview;
  return {
    ...preview,
    editableParameters: preview.editableParameters.map((group) =>
      group.nodeId === nodeId
        ? {
            ...group,
            fields: group.fields.map((field) =>
              field.key === key ? { ...field, value } : field
            ),
          }
        : group
    ),
  };
}

function updateWorkflowDraftParameter(
  draft: WorkflowComposeDraft | null,
  nodeId: string,
  key: string,
  value: unknown
): WorkflowComposeDraft | null {
  if (!draft) return draft;
  return {
    ...draft,
    nodes: draft.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      const parameters =
        node.data.parameters &&
        typeof node.data.parameters === "object" &&
        !Array.isArray(node.data.parameters)
          ? node.data.parameters as Record<string, unknown>
          : {};
      return {
        ...node,
        data: {
          ...node.data,
          parameters: {
            ...parameters,
            [key]: value,
          },
        },
      };
    }),
  };
}

function applyAgentNaturalLanguagePlanEdit({
  preview,
  draft,
  userBrief,
  scopeGroup,
}: {
  preview: WorkflowPlanPreview;
  draft: WorkflowComposeDraft | null;
  userBrief: string;
  scopeGroup?: AgentPlanGroup | null;
}): {
  preview: WorkflowPlanPreview;
  draft: WorkflowComposeDraft | null;
  changed: boolean;
  message: string;
  diff?: AgentPlanDiff;
} {
  const text = normalizeAgentPlanEditText(userBrief);
  if (!text) {
    return { preview, draft, changed: false, message: "" };
  }

  let nextItems = [...preview.items];
  let nextMatrix = [...(preview.agentPlan?.generationMatrix ?? [])];
  const editsUseMatrix = nextMatrix.length > 0;
  const changes: string[] = [];

  const originalCount = editsUseMatrix ? nextMatrix.length : nextItems.length;
  const scopedEdit = scopeGroup
    ? applyAgentScopedPlanEdit({
        text,
        items: nextItems,
        matrix: nextMatrix,
        editsUseMatrix,
        group: scopeGroup,
      })
    : null;
  if (scopedEdit) {
    nextItems = scopedEdit.items;
    nextMatrix = scopedEdit.matrix;
    changes.push(...scopedEdit.changes);
  } else {
    const namedSceneEdit = applyAgentNamedScenePlanEdits({
      text,
      items: nextItems,
      matrix: nextMatrix,
      editsUseMatrix,
    });
    nextItems = namedSceneEdit.items;
    nextMatrix = namedSceneEdit.matrix;
    changes.push(...namedSceneEdit.changes);

    const removalTargets = getAgentPlanRemovalTargets(text).filter((target) =>
      !(target.id === "scene" && namedSceneEdit.handledSceneRemoval)
    );
    for (const target of removalTargets) {
      const beforeItems = nextItems.length;
      const beforeMatrix = nextMatrix.length;
      if (editsUseMatrix) {
        nextMatrix = nextMatrix.filter((item) => !agentPlanMatrixItemMatchesTarget(item, target));
      } else {
        nextItems = nextItems.filter((item) => !agentPlanPreviewItemMatchesTarget(item, target));
      }
      let removed = editsUseMatrix ? beforeMatrix - nextMatrix.length : beforeItems - nextItems.length;
      if (removed === 0 && target.id === "scene") {
        if (editsUseMatrix) {
          nextMatrix = nextMatrix.filter((item) => !isFallbackScenePlanItem(item));
          removed = beforeMatrix - nextMatrix.length;
        } else {
          nextItems = nextItems.filter((item) => !isFallbackScenePreviewItem(item));
          removed = beforeItems - nextItems.length;
        }
      }
      if (removed > 0) changes.push(`删除${target.label} ${removed} 张`);
    }

    const relativeCountEdits = getAgentPlanRelativeCountEditsForTargets(text).filter((edit) =>
      !(edit.target.id === "scene" && namedSceneEdit.handledSceneIncrease)
    );
    const relativeTargetIds = new Set(relativeCountEdits.map((edit) => edit.target.id));
    for (const edit of relativeCountEdits) {
      const currentCount = getAgentPlanTargetCount({
        items: nextItems,
        matrix: nextMatrix,
        editsUseMatrix,
        target: edit.target,
      });
      const minCount = edit.delta < 0 && isSoftReduceAgentPlanEdit(text) ? 1 : 0;
      const nextCount = Math.max(minCount, currentCount + edit.delta);
      if (currentCount > 0 && nextCount !== currentCount) {
        if (editsUseMatrix) {
          nextMatrix = adjustAgentPlanMatrixToCount(nextMatrix, edit.target, nextCount);
        } else {
          nextItems = adjustAgentPlanItemsToCount(nextItems, edit.target, nextCount);
        }
        const instruction = edit.target.id === "scene" ? getAgentPlanTargetInstruction(text, edit.target) : "";
        if (instruction) {
          nextMatrix = applyAgentPlanContentInstructionToMatrix(nextMatrix, edit.target, instruction);
          nextItems = applyAgentPlanContentInstructionToItems(nextItems, edit.target, instruction);
        }
        changes.push(`${edit.target.label}${edit.label}，剩 ${nextCount} 张${instruction ? `，方向：${instruction}` : ""}`);
      } else if (currentCount === 0 && edit.delta > 0) {
        const instruction = edit.target.id === "scene" ? getAgentPlanTargetInstruction(text, edit.target) : "";
        const added = createAgentPlanItemsForNewTarget({
          target: edit.target,
          count: edit.delta,
          instruction,
          existingItems: nextItems,
          existingMatrix: nextMatrix,
        });
        nextItems = [...nextItems, ...added.items];
        if (editsUseMatrix) nextMatrix = [...nextMatrix, ...added.matrix];
        changes.push(`新增${edit.target.label} ${edit.delta} 张${instruction ? `，方向：${instruction}` : ""}`);
      }
    }

    const countEdits = getAgentPlanCountEdits(text).filter((edit) => !relativeTargetIds.has(edit.target.id));
    for (const edit of countEdits) {
      const beforeItems = nextItems.length;
      const beforeMatrix = nextMatrix.length;
      if (editsUseMatrix) {
        nextMatrix = adjustAgentPlanMatrixToCount(nextMatrix, edit.target, edit.count);
      } else {
        nextItems = adjustAgentPlanItemsToCount(nextItems, edit.target, edit.count);
      }
      if ((editsUseMatrix && nextMatrix.length !== beforeMatrix) || (!editsUseMatrix && nextItems.length !== beforeItems)) {
        changes.push(`${edit.target.label}改为 ${edit.count} 张`);
      }
    }

    const focusedTarget = getFocusedAgentPlanEditTarget(text);
    const relativeCountEdit = getAgentPlanRelativeCountEdit(text);
    if (focusedTarget && relativeCountEdit) {
      const currentCount = getAgentPlanTargetCount({
        items: nextItems,
        matrix: nextMatrix,
        editsUseMatrix,
        target: focusedTarget,
      });
      const minCount = relativeCountEdit.delta < 0 && isSoftReduceAgentPlanEdit(text) ? 1 : 0;
      const nextCount = Math.max(minCount, currentCount + relativeCountEdit.delta);
      if (currentCount > 0 && nextCount !== currentCount) {
        if (editsUseMatrix) {
          nextMatrix = adjustAgentPlanMatrixToCount(nextMatrix, focusedTarget, nextCount);
        } else {
          nextItems = adjustAgentPlanItemsToCount(nextItems, focusedTarget, nextCount);
        }
        const instruction = focusedTarget.id === "scene" ? getAgentPlanTargetInstruction(text, focusedTarget) : "";
        if (instruction) {
          nextMatrix = applyAgentPlanContentInstructionToMatrix(nextMatrix, focusedTarget, instruction);
          nextItems = applyAgentPlanContentInstructionToItems(nextItems, focusedTarget, instruction);
        }
        changes.push(`${focusedTarget.label}${relativeCountEdit.label}，剩 ${nextCount} 张${instruction ? `，方向：${instruction}` : ""}`);
      } else if (currentCount === 0 && relativeCountEdit.delta > 0) {
        const instruction = focusedTarget.id === "scene" ? getAgentPlanTargetInstruction(text, focusedTarget) : "";
        const added = createAgentPlanItemsForNewTarget({
          target: focusedTarget,
          count: relativeCountEdit.delta,
          instruction,
          existingItems: nextItems,
          existingMatrix: nextMatrix,
        });
        nextItems = [...nextItems, ...added.items];
        if (editsUseMatrix) nextMatrix = [...nextMatrix, ...added.matrix];
        changes.push(`新增${focusedTarget.label} ${relativeCountEdit.delta} 张${instruction ? `，方向：${instruction}` : ""}`);
      }
    }

    const copyEdit = getAgentPlanCopyEdit(text);
    if (copyEdit) {
      nextMatrix = nextMatrix.map((item) =>
        copyEdit.targets.length === 0 || copyEdit.targets.some((target) => agentPlanMatrixItemMatchesTarget(item, target))
          ? { ...item, copyMode: copyEdit.mode }
          : item
      );
      const targetLabel = copyEdit.targets.length > 0
        ? `${copyEdit.targets.map((target) => target.label).join("、")} `
        : "";
      changes.push(copyEdit.mode === "burn_in" ? `${targetLabel}文案改为烧进图` : `${targetLabel}文案改为图层/不进图`);
    }

    const contentEdit = getAgentPlanContentEdit(text);
    if (contentEdit && !(contentEdit.target.id === "scene" && namedSceneEdit.handledSceneIncrease)) {
      if (editsUseMatrix) {
        nextMatrix = nextMatrix.map((item) =>
          agentPlanMatrixItemMatchesTarget(item, contentEdit.target)
            ? {
                ...item,
                summary: mergeAgentPlanContentInstruction(item.summary, contentEdit.instruction),
              }
            : item
        );
      }
      nextItems = nextItems.map((item) =>
        agentPlanPreviewItemMatchesTarget(item, contentEdit.target)
          ? {
              ...item,
              purpose: mergeAgentPlanContentInstruction(item.purpose, contentEdit.instruction),
            }
          : item
      );
      changes.push(`${contentEdit.target.label}换成${contentEdit.instruction}`);
    }

    if (changes.length === 0) {
      const fallbackEdit = applyAgentPlanEditFallback({
        text,
        items: nextItems,
        matrix: nextMatrix,
        editsUseMatrix,
      });
      nextItems = fallbackEdit.items;
      nextMatrix = fallbackEdit.matrix;
      changes.push(...fallbackEdit.changes);
    }
  }

  if (changes.length === 0 || nextItems.length === 0) {
    return { preview, draft, changed: false, message: "" };
  }

  if (editsUseMatrix) {
    nextItems = syncEditedPlanItemsFromMatrix(nextItems, nextMatrix);
  }

  if (changes.length === 0 || nextItems.length === 0 || (editsUseMatrix && nextMatrix.length === 0)) {
    return { preview, draft, changed: false, message: "" };
  }

  const normalizedItems = nextItems.map((item, index) => normalizeEditedPlanItem(item, index, nextMatrix));
  const normalizedMatrix = normalizeEditedAgentMatrix(nextMatrix, normalizedItems);
  const nextPreview: WorkflowPlanPreview = {
    ...preview,
    items: normalizedItems,
    images: normalizedItems,
    estimatedCount: normalizedItems.length,
    summary: `${preview.summary} 已按用户修改：${changes.join("；")}。`,
    agentPlan: preview.agentPlan
      ? {
          ...preview.agentPlan,
          sampleCount: normalizedItems.length,
          fullCount: Math.max(preview.agentPlan.fullCount, normalizedItems.length),
          outputSlots: preview.agentPlan.outputSlots.filter((slot) =>
            normalizedItems.some((item) => item.slot === slot.id || item.id === slot.id)
          ),
          generationMatrix: normalizedMatrix,
          summary: {
            ...preview.agentPlan.summary,
            text: `已按用户修改：${changes.join("；")}。`,
            itemCount: normalizedItems.length,
            readyItemCount: normalizedMatrix.filter((item) => item.status === "ready").length,
            blockedItemCount: normalizedMatrix.filter((item) => item.status === "blocked").length,
          },
        }
      : preview.agentPlan,
  };

  return {
    preview: nextPreview,
    draft: draft ? applyEditedPlanItemsToWorkflowDraft(draft, normalizedItems, normalizedMatrix) : null,
    changed: true,
    message: `已按你的话调整计划：${changes.join("；")}。`,
    diff: buildAgentPlanDiff(changes, originalCount, normalizedItems.length, scopeGroup),
  };
}

function normalizeAgentPlanEditText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function applyAgentScopedPlanEdit({
  text,
  items,
  matrix,
  editsUseMatrix,
  group,
}: {
  text: string;
  items: WorkflowPlanPreviewItem[];
  matrix: WorkflowPlanPreviewAgentMatrixItem[];
  editsUseMatrix: boolean;
  group: AgentPlanGroup;
}): {
  items: WorkflowPlanPreviewItem[];
  matrix: WorkflowPlanPreviewAgentMatrixItem[];
  changes: string[];
} | null {
  let nextItems = [...items];
  let nextMatrix = [...matrix];
  const scopedItems = nextItems.filter((item) => agentPlanPreviewItemMatchesScopeGroup(item, group));
  const scopedMatrix = nextMatrix.filter((item) => agentPlanMatrixItemMatchesScopeGroup(item, group));
  const hasScope = editsUseMatrix ? scopedMatrix.length > 0 : scopedItems.length > 0;
  if (!hasScope) return null;

  const changes: string[] = [];
  const groupLabel = group.title || "这组";
  if (shouldRemoveScopedPlanGroup(text, group)) {
    if (editsUseMatrix) {
      const before = nextMatrix.length;
      nextMatrix = nextMatrix.filter((item) => !agentPlanMatrixItemMatchesScopeGroup(item, group));
      changes.push(`删除「${groupLabel}」${before - nextMatrix.length} 张`);
    } else {
      const before = nextItems.length;
      nextItems = nextItems.filter((item) => !agentPlanPreviewItemMatchesScopeGroup(item, group));
      changes.push(`删除「${groupLabel}」${before - nextItems.length} 张`);
    }
    return { items: nextItems, matrix: nextMatrix, changes };
  }

  const relativeCountEdit = getAgentPlanRelativeCountEdit(text);
  const absoluteCount = relativeCountEdit ? 0 : getScopedAgentPlanCountEdit(text);
  if (relativeCountEdit || absoluteCount > 0) {
    const currentCount = editsUseMatrix ? scopedMatrix.length : scopedItems.length;
    const minCount = relativeCountEdit?.delta && relativeCountEdit.delta < 0 && isSoftReduceAgentPlanEdit(text) ? 1 : 0;
    const nextCount = absoluteCount > 0
      ? absoluteCount
      : Math.max(minCount, currentCount + (relativeCountEdit?.delta ?? 0));
    if (currentCount > 0 && nextCount !== currentCount) {
      if (editsUseMatrix) {
        nextMatrix = adjustScopedAgentPlanMatrixToCount(nextMatrix, group, nextCount);
      } else {
        nextItems = adjustScopedAgentPlanItemsToCount(nextItems, group, nextCount);
      }
      const label = relativeCountEdit?.label ? `${relativeCountEdit.label}，剩 ${nextCount} 张` : `改为 ${nextCount} 张`;
      changes.push(`「${groupLabel}」${label}`);
    }
  }

  const copyMode = getScopedAgentPlanCopyMode(text);
  if (copyMode) {
    nextMatrix = nextMatrix.map((item) =>
      agentPlanMatrixItemMatchesScopeGroup(item, group) ? { ...item, copyMode } : item
    );
    nextItems = nextItems.map((item) =>
      agentPlanPreviewItemMatchesScopeGroup(item, group) ? { ...item, copyMode } : item
    );
    changes.push(copyMode === "burn_in" ? `「${groupLabel}」文案改为烧进图` : `「${groupLabel}」文案改为图层/不进图`);
  }

  const contentInstruction = extractAgentPlanContentInstruction(text);
  const freeformInstruction = changes.length === 0 ? getScopedAgentPlanFreeformInstruction(text, group) : "";
  const instruction = contentInstruction || freeformInstruction;
  if (instruction) {
    nextMatrix = nextMatrix.map((item) =>
      agentPlanMatrixItemMatchesScopeGroup(item, group)
        ? { ...item, summary: mergeAgentPlanContentInstruction(item.summary, instruction) }
        : item
    );
    nextItems = nextItems.map((item) =>
      agentPlanPreviewItemMatchesScopeGroup(item, group)
        ? { ...item, purpose: mergeAgentPlanContentInstruction(item.purpose, instruction) }
        : item
    );
    changes.push(`「${groupLabel}」更新方向：${instruction}`);
  }

  return changes.length > 0 ? { items: nextItems, matrix: nextMatrix, changes } : null;
}

function agentPlanPreviewItemMatchesScopeGroup(item: WorkflowPlanPreviewItem, group: AgentPlanGroup): boolean {
  const groupId = normalizeAgentPlanScopeKey(group.id);
  const groupTitle = normalizeAgentPlanScopeKey(group.title);
  const slot = normalizeAgentPlanScopeKey(item.slot);
  const baseSlot = normalizeAgentPlanScopeKey(getPreviewItemBaseSlotId(item.slot));
  const id = normalizeAgentPlanScopeKey(item.id);
  const title = normalizeAgentPlanScopeKey(getAgentPlanGroupDisplayTitle(item.title, item.slot));
  return [slot, baseSlot, id, title].includes(groupId) || (!!groupTitle && title === groupTitle);
}

function agentPlanMatrixItemMatchesScopeGroup(
  item: WorkflowPlanPreviewAgentMatrixItem,
  group: AgentPlanGroup
): boolean {
  const groupId = normalizeAgentPlanScopeKey(group.id);
  const groupTitle = normalizeAgentPlanScopeKey(group.title);
  const groupSlot = normalizeAgentPlanScopeKey(getAgentPlanGroupSlotId(item));
  const outputSlot = normalizeAgentPlanScopeKey(item.outputSlotId);
  const type = normalizeAgentPlanScopeKey(item.type);
  const itemId = normalizeAgentPlanScopeKey(item.itemId);
  const id = normalizeAgentPlanScopeKey(item.id);
  const title = normalizeAgentPlanScopeKey(getAgentPlanGroupDisplayTitle(item.title, item.outputSlotId || item.type));
  return [groupSlot, outputSlot, type, itemId, id, title].includes(groupId) || (!!groupTitle && title === groupTitle);
}

function normalizeAgentPlanScopeKey(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function shouldRemoveScopedPlanGroup(text: string, group: AgentPlanGroup): boolean {
  const compactText = text.replace(/\s+/g, "");
  if (/(不要|别|无需|不需要)(文案|文字|字幕|字|烧字|出字|带字|进图)/.test(compactText)) return false;
  const removeIntent = /(不要|删除|去掉|不用|取消|别做|拿掉|删掉)/;
  if (!removeIntent.test(compactText)) return false;
  if (/(这组|这一组|这个图组|本组|当前组|该组|整组)/.test(compactText)) return true;
  const groupTitle = group.title.replace(/\s+/g, "");
  return !!groupTitle && compactText.includes(groupTitle);
}

function getScopedAgentPlanCountEdit(text: string): number {
  const compactText = text.replace(/\s+/g, "");
  const patterns = [
    /(?:改成|改为|变成|调整为|保留|留|只留|只要|要|做|来)([0-9一二两三四五六七八九十]+)(?:张|组|个)/,
    /([0-9一二两三四五六七八九十]+)(?:张|组|个)(?:就够|即可|够了|就行)/,
  ];
  for (const pattern of patterns) {
    const count = parseAgentPlanEditCount(compactText.match(pattern)?.[1]);
    if (count > 0 && count <= 20) return count;
  }
  return 0;
}

function getScopedAgentPlanCopyMode(text: string): "burn_in" | "layout_layer" | null {
  const compactText = text.replace(/\s+/g, "");
  const wantsNoBurn =
    /(不要|别|无需|不需要)(文案|文字|字幕|字|烧字|出字|带字|进图)/.test(compactText) ||
    /(不烧字|不烧进|不进图|图层|后期改字|可编辑文字|可编辑文案)/.test(compactText);
  if (wantsNoBurn) return "layout_layer";
  const wantsBurn = /(烧字|烧进|进图|带字|出字|把文案写进图|文字进图|文案进图)/.test(compactText);
  return wantsBurn ? "burn_in" : null;
}

function getScopedAgentPlanFreeformInstruction(text: string, group: AgentPlanGroup): string {
  const cleaned = text
    .replace(/调整[「"][^」"]+[」"][:：]?/g, "")
    .replace(new RegExp(escapeRegExp(group.title), "g"), "")
    .replace(/^(这组|这一组|这个图组|本组|当前组|该组|整组)[:：,，]*/g, "")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 80) return "";
  if (/^(少|减少|减掉|删掉|去掉|加|增加|新增|多|再来|改成|改为|变成|调整为)/.test(cleaned)) return "";
  return cleaned;
}

function adjustScopedAgentPlanItemsToCount(
  items: WorkflowPlanPreviewItem[],
  group: AgentPlanGroup,
  count: number
): WorkflowPlanPreviewItem[] {
  const matching = items.filter((item) => agentPlanPreviewItemMatchesScopeGroup(item, group));
  if (matching.length === 0) return items;
  const others = items.filter((item) => !agentPlanPreviewItemMatchesScopeGroup(item, group));
  const adjusted = Array.from({ length: count }, (_, index) =>
    cloneAgentPlanPreviewItem(matching[Math.min(index, matching.length - 1)], index)
  );
  return restoreAgentPlanOrder(items, others, matching[0], adjusted);
}

function adjustScopedAgentPlanMatrixToCount(
  items: WorkflowPlanPreviewAgentMatrixItem[],
  group: AgentPlanGroup,
  count: number
): WorkflowPlanPreviewAgentMatrixItem[] {
  const matching = items.filter((item) => agentPlanMatrixItemMatchesScopeGroup(item, group));
  if (matching.length === 0) return items;
  const others = items.filter((item) => !agentPlanMatrixItemMatchesScopeGroup(item, group));
  const adjusted = Array.from({ length: count }, (_, index) =>
    cloneAgentPlanMatrixItem(matching[Math.min(index, matching.length - 1)], index)
  );
  return restoreAgentPlanOrder(items, others, matching[0], adjusted);
}

function applyAgentNamedScenePlanEdits({
  text,
  items,
  matrix,
  editsUseMatrix,
}: {
  text: string;
  items: WorkflowPlanPreviewItem[];
  matrix: WorkflowPlanPreviewAgentMatrixItem[];
  editsUseMatrix: boolean;
}): {
  items: WorkflowPlanPreviewItem[];
  matrix: WorkflowPlanPreviewAgentMatrixItem[];
  changes: string[];
  handledSceneRemoval: boolean;
  handledSceneIncrease: boolean;
} {
  const removeTerms = extractAgentNamedSceneTerms(text, "remove");
  const increaseTerms = extractAgentNamedSceneTerms(text, "increase");
  let nextItems = items;
  let nextMatrix = matrix;
  const changes: string[] = [];

  for (const term of removeTerms) {
    if (editsUseMatrix) {
      const before = nextMatrix.length;
      nextMatrix = nextMatrix.filter((item) => !agentPlanMatrixItemMatchesNamedScene(item, term.keywords));
      const removed = before - nextMatrix.length;
      if (removed > 0) changes.push(`删除${term.label}场景 ${removed} 张`);
    } else {
      const before = nextItems.length;
      nextItems = nextItems.filter((item) => !agentPlanPreviewItemMatchesNamedScene(item, term.keywords));
      const removed = before - nextItems.length;
      if (removed > 0) changes.push(`删除${term.label}场景 ${removed} 张`);
    }
  }

  for (const term of increaseTerms) {
    if (editsUseMatrix) {
      const matching = nextMatrix.filter((item) => agentPlanMatrixItemMatchesNamedScene(item, term.keywords));
      const seedItems = matching.length > 0 ? matching : nextMatrix.filter(isAgentNamedSceneSeedMatrixItem);
      if (seedItems.length > 0) {
        nextMatrix = insertAgentPlanNamedSceneMatrixClonesAfterLastMatch(nextMatrix, seedItems, term);
        changes.push(`${term.label}场景增加 ${term.count} 张`);
      }
    } else {
      const matching = nextItems.filter((item) => agentPlanPreviewItemMatchesNamedScene(item, term.keywords));
      const seedItems = matching.length > 0 ? matching : nextItems.filter(isAgentNamedSceneSeedPreviewItem);
      if (seedItems.length > 0) {
        nextItems = insertAgentPlanNamedScenePreviewClonesAfterLastMatch(nextItems, seedItems, term);
        changes.push(`${term.label}场景增加 ${term.count} 张`);
      }
    }
  }

  return {
    items: nextItems,
    matrix: nextMatrix,
    changes,
    handledSceneRemoval: removeTerms.length > 0,
    handledSceneIncrease: changes.some((change) => /场景增加/.test(change)),
  };
}

function extractAgentNamedSceneTerms(
  text: string,
  mode: "remove" | "increase"
): Array<{ label: string; keywords: string[]; count: number }> {
  const clauses = text.split(/[，。；、,.!?\n]/).map((item) => item.trim()).filter(Boolean);
  const terms: Array<{ label: string; keywords: string[]; count: number }> = [];
  for (const clause of clauses) {
    const compact = clause.replace(/\s+/g, "");
    const hasIntent = mode === "remove"
      ? /(不要|删除|去掉|不用|取消|别做|拿掉)/.test(compact)
      : /(多|加|增加|新增|再来|补)/.test(compact);
    if (!hasIntent) continue;
    const keywords = getAgentNamedSceneKeywords(compact);
    if (keywords.length === 0) continue;
    const countMatch = compact.match(/([0-9一二两三四五六七八九十]+)(?:张|组|个)/);
    terms.push({
      label: getAgentNamedSceneLabel(keywords),
      keywords,
      count: mode === "increase" ? Math.max(1, parseAgentPlanEditCount(countMatch?.[1]) || 1) : 1,
    });
  }
  return terms;
}

function getAgentNamedSceneKeywords(text: string): string[] {
  const keywords = [
    "茶室",
    "庭院",
    "商场",
    "快闪",
    "咖啡",
    "街拍",
    "雪山",
    "家居",
    "办公室",
    "露营",
    "门店",
    "展厅",
    "厨房",
    "卧室",
    "客厅",
    "书房",
    "花店",
    "天台",
    "海边",
    "室内",
    "户外",
  ].filter((keyword) => text.includes(keyword));
  return agentUniqueStrings(keywords).slice(0, 3);
}

function getAgentNamedSceneLabel(keywords: string[]): string {
  const specific = keywords.filter((keyword) => keyword !== "室内" && keyword !== "户外" && keyword !== "快闪");
  return (specific[0] || keywords[0] || "指定") ;
}

function agentPlanMatrixItemMatchesNamedScene(
  item: WorkflowPlanPreviewAgentMatrixItem,
  keywords: string[]
): boolean {
  const text = planItemText([item.title, item.type, item.outputSlotId, item.summary]).join(" ");
  return isAgentNamedSceneTextMatch(text, keywords);
}

function agentPlanPreviewItemMatchesNamedScene(
  item: WorkflowPlanPreviewItem,
  keywords: string[]
): boolean {
  const text = planItemText([item.title, item.purpose, item.slot, item.platform]).join(" ");
  return isAgentNamedSceneTextMatch(text, keywords);
}

function isAgentNamedSceneTextMatch(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const hasSceneSurface = isAgentSceneLikeText(text);
  return hasSceneSurface && keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function isAgentSceneLikeMatrixItem(item: WorkflowPlanPreviewAgentMatrixItem): boolean {
  return isAgentSceneLikeText(planItemText([item.title, item.type, item.outputSlotId, item.summary]).join(" "));
}

function isAgentSceneLikePreviewItem(item: WorkflowPlanPreviewItem): boolean {
  return isAgentSceneLikeText(planItemText([item.title, item.purpose, item.slot, item.platform]).join(" "));
}

function isAgentNamedSceneSeedMatrixItem(item: WorkflowPlanPreviewAgentMatrixItem): boolean {
  const text = planItemText([item.title, item.type, item.outputSlotId, item.summary]).join(" ");
  return isAgentSceneLikeText(text) && !isAgentMarketingPosterLikeText(text);
}

function isAgentNamedSceneSeedPreviewItem(item: WorkflowPlanPreviewItem): boolean {
  const text = planItemText([item.title, item.purpose, item.slot, item.platform]).join(" ");
  return isAgentSceneLikeText(text) && !isAgentMarketingPosterLikeText(text);
}

function isAgentSceneLikeText(text: string): boolean {
  return /(场景|scene|lifestyle|海报|poster|环境|空间|茶室|庭院|商场|咖啡|街拍|雪山|家居|办公室|露营|门店|展厅)/i.test(text);
}

function isAgentMarketingPosterLikeText(text: string): boolean {
  return /(海报|poster|cover|hero|banner|卖点|feature|收尾|closing|文案|copy)/i.test(text);
}

function insertAgentPlanNamedSceneMatrixClonesAfterLastMatch(
  items: WorkflowPlanPreviewAgentMatrixItem[],
  matching: WorkflowPlanPreviewAgentMatrixItem[],
  term: { label: string; count: number }
): WorkflowPlanPreviewAgentMatrixItem[] {
  const anchor = matching[matching.length - 1];
  return items.flatMap((item) =>
    item === anchor
      ? [
          item,
          ...Array.from({ length: term.count }, (_, index) =>
            renameAgentPlanMatrixSceneClone(
              cloneAgentPlanMatrixItem(anchor, matching.length + index + 1),
              term.label
            )
          ),
        ]
      : [item]
  );
}

function insertAgentPlanNamedScenePreviewClonesAfterLastMatch(
  items: WorkflowPlanPreviewItem[],
  matching: WorkflowPlanPreviewItem[],
  term: { label: string; count: number }
): WorkflowPlanPreviewItem[] {
  const anchor = matching[matching.length - 1];
  return items.flatMap((item) =>
    item === anchor
      ? [
          item,
          ...Array.from({ length: term.count }, (_, index) =>
            renameAgentPlanPreviewSceneClone(
              cloneAgentPlanPreviewItem(anchor, matching.length + index + 1),
              term.label
            )
          ),
        ]
      : [item]
  );
}

function renameAgentPlanMatrixSceneClone(
  item: WorkflowPlanPreviewAgentMatrixItem,
  label: string
): WorkflowPlanPreviewAgentMatrixItem {
  const slotId = getAgentNamedSceneSlotId(label);
  return {
    ...item,
    id: `${item.id}_${slotId}`,
    itemId: `${item.itemId}_${slotId}`,
    title: `${label}场景`,
    type: slotId,
    outputSlotId: slotId,
    referenceRoles: agentUniqueStrings([...item.referenceRoles, "scene"]),
    copyMode: item.copyMode === "burn_in" ? "layout_layer" : item.copyMode,
    summary: `补充${label}场景，用来验证商品在不同环境里的空间、光影和使用氛围`,
  };
}

function renameAgentPlanPreviewSceneClone(
  item: WorkflowPlanPreviewItem,
  label: string
): WorkflowPlanPreviewItem {
  const slotId = getAgentNamedSceneSlotId(label);
  return {
    ...item,
    id: `${item.id}_${slotId}`,
    title: `${label}场景`,
    slot: slotId,
    copyMode: item.copyMode === "burn_in" ? "layout_layer" : item.copyMode,
    purpose: `补充${label}场景，用来验证商品在不同环境里的空间、光影和使用氛围`,
  };
}

function getAgentNamedSceneSlotId(label: string): string {
  const known: Record<string, string> = {
    商场: "mall",
    茶室: "tea_room",
    庭院: "courtyard",
    咖啡: "cafe",
    街拍: "street",
    雪山: "snow_mountain",
    家居: "home",
    办公室: "office",
    露营: "camping",
    露营地: "camping",
    门店: "store",
    展厅: "showroom",
    厨房: "kitchen",
    卧室: "bedroom",
    客厅: "living_room",
    书房: "study",
    花店: "flower_shop",
    天台: "rooftop",
    海边: "seaside",
    室内: "indoor",
    户外: "outdoor",
  };
  const key = known[label] || label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `scene_${key || "named"}`;
}

function buildAgentPlanDiff(
  changes: string[],
  beforeCount: number,
  afterCount: number,
  scopeGroup?: AgentPlanGroup | null
): AgentPlanDiff {
  const additions: string[] = [];
  const removals: string[] = [];
  const countChanges: string[] = [];
  const copyChanges: string[] = [];
  const otherChanges: string[] = [];

  for (const change of changes) {
    if (/文案|烧字|进图|图层/.test(change)) {
      copyChanges.push(change);
    } else if (/删除|去掉|不要|取消|减少|减掉|删掉/.test(change)) {
      removals.push(change);
    } else if (/增加|新增|添加|加/.test(change)) {
      additions.push(change);
    } else if (/改为|改成|调整为|剩\s*\d+\s*张/.test(change)) {
      countChanges.push(change);
    } else {
      otherChanges.push(change);
    }
  }

  return {
    summary: beforeCount === afterCount
      ? `总张数保持 ${afterCount} 张。`
      : `计划从 ${beforeCount} 张调整为 ${afterCount} 张。`,
    scopeSummary: scopeGroup
      ? `只调整「${scopeGroup.title}」这一组。`
      : buildAgentPlanDiffScopeSummary({ additions, removals, countChanges, copyChanges, otherChanges }),
    preservedSummary: scopeGroup
      ? "其他图组、比例和参考图角色保持不变。"
      : "未提到的图组、比例和参考图角色保持不变。",
    nextAction: buildAgentPlanDiffNextAction({ additions, removals, countChanges, copyChanges, otherChanges }),
    affectedGroupTitles: getAgentPlanDiffAffectedGroupTitles(changes, scopeGroup),
    additions,
    removals,
    countChanges,
    copyChanges,
    otherChanges,
  };
}

function getAgentPlanDiffAffectedGroupTitles(
  changes: string[],
  scopeGroup?: AgentPlanGroup | null
): string[] {
  const titles = new Set<string>();
  if (scopeGroup?.title) titles.add(scopeGroup.title);
  for (const change of changes) {
    const quotedMatches = change.matchAll(/「([^」]+)」/g);
    for (const match of quotedMatches) {
      if (match[1]) titles.add(match[1]);
    }
  }
  return Array.from(titles);
}

function buildAgentPlanDiffScopeSummary({
  additions,
  removals,
  countChanges,
  copyChanges,
  otherChanges,
}: Pick<AgentPlanDiff, "additions" | "removals" | "countChanges" | "copyChanges" | "otherChanges">): string {
  const structuralChangeCount = additions.length + removals.length + countChanges.length + otherChanges.length;
  if (copyChanges.length > 0 && structuralChangeCount === 0) {
    return "只调整文案策略，图组数量和参考角色不变。";
  }
  const affected: string[] = [];
  if (additions.length > 0) affected.push("新增图组");
  if (removals.length > 0) affected.push("删除图组");
  if (countChanges.length > 0) affected.push("数量");
  if (copyChanges.length > 0) affected.push("文案策略");
  if (otherChanges.length > 0) affected.push("点名方向");
  return affected.length > 0
    ? `只调整本次点名的${affected.join("、")}。`
    : "这次没有识别到明确改动，原计划保持不变。";
}

function buildAgentPlanDiffNextAction({
  additions,
  removals,
  countChanges,
  copyChanges,
}: Pick<AgentPlanDiff, "additions" | "removals" | "countChanges" | "copyChanges" | "otherChanges">): string {
  if (copyChanges.some((change) => /烧字|进图/.test(change))) {
    return "下一步先检查烧字安全区，再执行生成。";
  }
  if (additions.length > 0) {
    return "下一步确认新增图组是否需要商品、模特或场景参考。";
  }
  if (removals.length > 0 || countChanges.length > 0) {
    return "下一步可以直接应用计划，或继续微调数量。";
  }
  return "下一步可以继续补充场景、风格或直接执行。";
}

function applyAgentNaturalLanguagePlanEditFallbackOnly({
  preview,
  draft,
  userBrief,
  scopeGroup,
}: {
  preview: WorkflowPlanPreview;
  draft: WorkflowComposeDraft | null;
  userBrief: string;
  scopeGroup?: AgentPlanGroup | null;
}): {
  preview: WorkflowPlanPreview;
  draft: WorkflowComposeDraft | null;
  changed: boolean;
  message: string;
  diff?: AgentPlanDiff;
} {
  const text = normalizeAgentPlanEditText(userBrief);
  const baseMatrix = [...(preview.agentPlan?.generationMatrix ?? [])];
  const editsUseMatrix = baseMatrix.length > 0;
  const fallbackEdit = scopeGroup
    ? applyAgentScopedPlanEdit({
        text,
        items: [...preview.items],
        matrix: baseMatrix,
        editsUseMatrix,
        group: scopeGroup,
      }) ?? { items: [...preview.items], matrix: baseMatrix, changes: [] }
    : applyAgentPlanEditFallback({
        text,
        items: [...preview.items],
        matrix: baseMatrix,
        editsUseMatrix,
      });
  if (fallbackEdit.changes.length === 0) {
    return { preview, draft, changed: false, message: "" };
  }

  const nextItems = editsUseMatrix
    ? syncEditedPlanItemsFromMatrix(fallbackEdit.items, fallbackEdit.matrix)
    : fallbackEdit.items;
  if (nextItems.length === 0 || (editsUseMatrix && fallbackEdit.matrix.length === 0)) {
    return { preview, draft, changed: false, message: "" };
  }

  const normalizedItems = nextItems.map((item, index) =>
    normalizeEditedPlanItem(item, index, fallbackEdit.matrix)
  );
  const normalizedMatrix = normalizeEditedAgentMatrix(fallbackEdit.matrix, normalizedItems);
  const nextPreview: WorkflowPlanPreview = {
    ...preview,
    items: normalizedItems,
    images: normalizedItems,
    estimatedCount: normalizedItems.length,
    summary: `${preview.summary} 已按用户修改：${fallbackEdit.changes.join("；")}。`,
    agentPlan: preview.agentPlan
      ? {
          ...preview.agentPlan,
          sampleCount: normalizedItems.length,
          fullCount: Math.max(preview.agentPlan.fullCount, normalizedItems.length),
          outputSlots: preview.agentPlan.outputSlots.filter((slot) =>
            normalizedItems.some((item) => item.slot === slot.id || item.id === slot.id)
          ),
          generationMatrix: normalizedMatrix,
          summary: {
            ...preview.agentPlan.summary,
            text: `已按用户修改：${fallbackEdit.changes.join("；")}。`,
            itemCount: normalizedItems.length,
            readyItemCount: normalizedMatrix.filter((item) => item.status === "ready").length,
            blockedItemCount: normalizedMatrix.filter((item) => item.status === "blocked").length,
          },
        }
      : preview.agentPlan,
  };

  return {
    preview: nextPreview,
    draft: draft ? applyEditedPlanItemsToWorkflowDraft(draft, normalizedItems, normalizedMatrix) : null,
    changed: true,
    message: `已按你的话调整计划：${fallbackEdit.changes.join("；")}。`,
    diff: buildAgentPlanDiff(fallbackEdit.changes, preview.estimatedCount, normalizedItems.length, scopeGroup),
  };
}

const agentPlanEditTargets = [
  {
    id: "amazon",
    label: "Amazon 图组",
    keywords: ["amazon", "亚马逊", "listing", "asin"],
  },
  {
    id: "xiaohongshu",
    label: "小红书封面",
    keywords: ["小红书", "种草", "笔记", "xiaohongshu", "xhs"],
  },
  {
    id: "model",
    label: "模特展示",
    keywords: ["模特", "上身", "真人", "model"],
  },
  {
    id: "detail",
    label: "商品细节",
    keywords: ["细节", "详情", "材质", "特写", "结构", "工艺", "detail", "material", "macro"],
  },
  {
    id: "closing",
    label: "收尾图",
    keywords: ["收尾", "closing", "转化尾图"],
  },
  {
    id: "poster",
    label: "海报/卖点图",
    keywords: ["海报", "卖点", "封面", "poster", "feature", "cover", "hero"],
  },
  {
    id: "scene",
    label: "场景图",
    keywords: ["场景", "生活方式", "桌面", "商场", "室内", "户外", "scene", "lifestyle"],
  },
  {
    id: "main",
    label: "商品主图",
    keywords: ["主图", "白底", "主视觉", "main"],
  },
] satisfies Array<{
  id: string;
  label: string;
  keywords: string[];
}>;

type AgentPlanEditTarget = (typeof agentPlanEditTargets)[number];

function getAgentPlanRemovalTargets(text: string): AgentPlanEditTarget[] {
  let targets = agentPlanEditTargets.filter((target) =>
    targetHasLocalIntent(text, target, ["不要", "删除", "去掉", "不用", "取消", "别做", "拿掉"])
  );
  const compactText = text.replace(/\s+/g, "");
  const ensureTarget = (targetId: AgentPlanEditTarget["id"], pattern: RegExp) => {
    if (!pattern.test(compactText)) return;
    const target = agentPlanEditTargets.find((item) => item.id === targetId);
    if (target && !targets.some((item) => item.id === target.id)) targets.push(target);
  };
  ensureTarget("scene", /(?:(?:场景图|场景|scene|lifestyle)(?:不要|删除|去掉|不用|取消|别做|拿掉)|(?:不要|删除|去掉|不用|取消|别做|拿掉)(?:场景图|场景|scene|lifestyle))/i);
  ensureTarget("closing", /(?:(?:收尾图|收尾|closing)(?:不要|删除|去掉|不用|取消|别做|拿掉)|(?:不要|删除|去掉|不用|取消|别做|拿掉)(?:收尾图|收尾|closing))/i);
  ensureTarget("poster", /(?:(?:海报|封面|poster|cover)(?:不要|删除|去掉|不用|取消|别做|拿掉)|(?:不要|删除|去掉|不用|取消|别做|拿掉)(?:海报|封面|poster|cover))/i);
  if (targets.some((target) => target.id === "xiaohongshu")) {
    targets = targets.filter((target) => target.id !== "poster");
  }
  return targets;
}

function getAgentPlanCountEdits(text: string): Array<{ target: AgentPlanEditTarget; count: number }> {
  return agentPlanEditTargets.flatMap((target) => {
    const keywordPattern = target.keywords.map(escapeRegExp).join("|");
    const localGap = "[^，。；、:：,.!?\\n]{0,12}";
    const patterns = [
      new RegExp(`(?:${keywordPattern})${localGap}(?:改成|改为|变成|调整为|要|来|做)?\\s*([0-9一二两三四五六七八九十]+)\\s*张`, "i"),
      new RegExp(`([0-9一二两三四五六七八九十]+)\\s*张${localGap}(?:${keywordPattern})`, "i"),
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const count = parseAgentPlanEditCount(match?.[1]);
      if (count > 0 && count <= 20) return [{ target, count }];
    }
    return [];
  });
}

function getFocusedAgentPlanEditTarget(text: string): AgentPlanEditTarget | null {
  const targetLabel = text.match(/调整[「\"]([^」\"]+)[」\"]/)?.[1]?.trim();
  if (!targetLabel) return null;
  return agentPlanEditTargets.find((target) => {
    if (target.label === targetLabel || targetLabel.includes(target.label) || target.label.includes(targetLabel)) {
      return true;
    }
    return target.keywords.some((keyword) => targetLabel.toLowerCase().includes(keyword.toLowerCase()));
  }) ?? null;
}

function getAgentPlanRelativeCountEdit(text: string): { delta: number; label: string } | null {
  const compactText = text.replace(/\s+/g, "");
  const decreaseMatch = compactText.match(/(?:少|减少|减掉|删掉|去掉)([0-9一二两三四五六七八九十]+)(?:张|组|个)?/);
  const increaseMatch = compactText.match(/(?:加|增加|新增|多|再来)([0-9一二两三四五六七八九十]+)(?:张|组|个)?/);
  if (decreaseMatch) {
    const count = parseAgentPlanEditCount(decreaseMatch[1]);
    return count > 0 ? { delta: -count, label: `减少 ${count} 张` } : null;
  }
  if (increaseMatch) {
    const count = parseAgentPlanEditCount(increaseMatch[1]);
    return count > 0 ? { delta: count, label: `增加 ${count} 张` } : null;
  }
  if (/(少一点|少一些|减少一点|少做一点)/.test(compactText)) return { delta: -1, label: "减少 1 张" };
  if (/(多一点|多一些|加一组|加一张|新增一组|再来一组)/.test(compactText)) return { delta: 1, label: "增加 1 张" };
  return null;
}

function getAgentPlanRelativeCountEditsForTargets(text: string): Array<{
  target: AgentPlanEditTarget;
  delta: number;
  label: string;
}> {
  return agentPlanEditTargets.flatMap((target) => {
    const keywordPattern = target.keywords.map(escapeRegExp).join("|");
    const localGap = "[^，。；、:：,.!?\\n]{0,12}";
  const patterns = [
      {
        regex: new RegExp(`(?:${keywordPattern})${localGap}(?:少|减少|减掉|少做|删掉|去掉)([0-9一二两三四五六七八九十]+)\\s*(?:张|组|个)?`, "i"),
        sign: -1,
        verb: "减少",
      },
      {
        regex: new RegExp(`(?:少|减少|减掉|少做|删掉|去掉)([0-9一二两三四五六七八九十]+)\\s*(?:张|组|个)?${localGap}(?:${keywordPattern})`, "i"),
        sign: -1,
        verb: "减少",
      },
      {
        regex: new RegExp(`(?:${keywordPattern})${localGap}(?:加|增加|新增|多|再来)([0-9一二两三四五六七八九十]+)\\s*(?:张|组|个)?`, "i"),
        sign: 1,
        verb: "增加",
      },
      {
        regex: new RegExp(`(?:加|增加|新增|多|再来)([0-9一二两三四五六七八九十]+)\\s*(?:张|组|个)?${localGap}(?:${keywordPattern})`, "i"),
        sign: 1,
        verb: "增加",
      },
    ];

    for (const pattern of patterns) {
      const count = parseAgentPlanEditCount(text.match(pattern.regex)?.[1]);
      if (count > 0 && count <= 20) {
        return [{
          target,
          delta: pattern.sign * count,
          label: `${pattern.verb} ${count} 张`,
        }];
      }
    }
    const softDelta = getAgentPlanSoftRelativeDelta(text, target);
    return softDelta ? [{ target, ...softDelta }] : [];
  });
}

function getAgentPlanSoftRelativeDelta(
  text: string,
  target: AgentPlanEditTarget
): { delta: number; label: string } | null {
  if (targetHasLocalIntent(text, target, ["少一点", "少一些", "减少一点", "少做一点"])) {
    return { delta: -1, label: "减少 1 张" };
  }
  if (targetHasLocalIntent(text, target, ["多一点", "多一些", "加一组", "加一张", "新增一组", "再来一组"])) {
    return { delta: 1, label: "增加 1 张" };
  }
  return null;
}

function isSoftReduceAgentPlanEdit(text: string): boolean {
  return /(少一点|少一些|减少一点|少做一点)/.test(text.replace(/\s+/g, ""));
}

function getAgentPlanCopyEdit(text: string): { mode: "burn_in" | "layout_layer"; targets: AgentPlanEditTarget[] } | null {
  const compactText = text.replace(/\s+/g, "");
  const wantsNoBurn = hasLocalKeywordIntent(text, ["烧字", "烧进", "进图", "带字", "出字"], ["不", "别", "不要", "无需", "不需要"]);
  const wantsBurn =
    /(烧字|烧进|进图|带字|出字|文案.*图)/.test(compactText) ||
    ((compactText.includes("文案") || compactText.includes("文字")) && /(烧|进图|带字|出字)/.test(compactText));
  if (!wantsNoBurn && !wantsBurn) return null;
  const copyIntentTerms = wantsNoBurn
    ? ["图层", "不进图", "不入图", "不烧字", "不烧进", "后期改字", "可编辑", "文案", "文字"]
    : ["烧字", "烧进", "进图", "带字", "出字", "文案", "文字"];
  const targets = agentPlanEditTargets.filter((target) =>
    targetHasLocalIntent(text, target, copyIntentTerms)
  );
  const isExplicitGlobalCopyIntent = /(全部|所有|整套|全局)/.test(compactText);
  return {
    mode: wantsNoBurn ? "layout_layer" : "burn_in",
    targets: isExplicitGlobalCopyIntent ? [] : targets,
  };
}

function getAgentPlanContentEdit(text: string): { target: AgentPlanEditTarget; instruction: string } | null {
  const focusedTarget = getFocusedAgentPlanEditTarget(text);
  const target = focusedTarget ?? getFocusedAgentPlanEditTargetByKeyword(text);
  if (!target) return null;

  const instruction = extractAgentPlanContentInstruction(text);
  if (!instruction) return null;

  return { target, instruction };
}

function getFocusedAgentPlanEditTargetByKeyword(text: string): AgentPlanEditTarget | null {
  return agentPlanEditTargets.find((target) =>
    targetHasLocalIntent(text, target, ["换成", "改成", "改为", "变成", "换到", "改到"])
  ) ?? null;
}

function extractAgentPlanContentInstruction(text: string): string {
  const match = text.match(/(?:换成|改成|改为|变成|换到|改到)([^，。；、,.!?\n]{2,28})/);
  const value = match?.[1]?.trim() ?? "";
  if (!value) return "";
  if (/^[0-9一二两三四五六七八九十]+\s*张/.test(value)) return "";
  return value.replace(/^(一个|一组|一些|那种|这种)\s*/, "").trim();
}

function mergeAgentPlanContentInstruction(current: string | undefined, instruction: string): string {
  const cleanCurrent = (current ?? "").trim();
  if (!cleanCurrent) return instruction;
  if (cleanCurrent.includes(instruction)) return cleanCurrent;
  return `${cleanCurrent}；本组调整：${instruction}`;
}

function getAgentPlanTargetInstruction(text: string, target: AgentPlanEditTarget): string {
  if (target.id === "scene") {
    const sceneTerms = ["商场场景", "商场", "室外街拍", "户外街拍", "咖啡厅", "北欧家居", "雪山", "室内场景"];
    const term = sceneTerms.find((value) => text.includes(value));
    if (term) return term.endsWith("场景") || term.includes("街拍") ? term : `${term}场景`;
  }
  const match = text.match(/(?:换成|改成|改为|变成|换到|改到|加一组|新增一组|再来一组|加一张|新增一张)([^，。；、,.!?\n]{2,28})/);
  const value = match?.[1]?.trim() ?? "";
  if (!value || /^[0-9一二两三四五六七八九十]+\s*(张|组|个)?/.test(value)) return "";
  return value.replace(/^(一个|一组|一些|那种|这种)\s*/, "").trim();
}

function applyAgentPlanContentInstructionToMatrix(
  items: WorkflowPlanPreviewAgentMatrixItem[],
  target: AgentPlanEditTarget,
  instruction: string
): WorkflowPlanPreviewAgentMatrixItem[] {
  return items.map((item) =>
    agentPlanMatrixItemMatchesTarget(item, target)
      ? { ...item, summary: mergeAgentPlanContentInstruction(item.summary, instruction) }
      : item
  );
}

function applyAgentPlanContentInstructionToItems(
  items: WorkflowPlanPreviewItem[],
  target: AgentPlanEditTarget,
  instruction: string
): WorkflowPlanPreviewItem[] {
  return items.map((item) =>
    agentPlanPreviewItemMatchesTarget(item, target)
      ? { ...item, purpose: mergeAgentPlanContentInstruction(item.purpose, instruction) }
      : item
  );
}

function getAgentPlanTargetCount({
  items,
  matrix,
  editsUseMatrix,
  target,
}: {
  items: WorkflowPlanPreviewItem[];
  matrix: WorkflowPlanPreviewAgentMatrixItem[];
  editsUseMatrix: boolean;
  target: AgentPlanEditTarget;
}): number {
  if (editsUseMatrix) {
    return matrix.filter((item) => agentPlanMatrixItemMatchesTarget(item, target)).length;
  }
  return items.filter((item) => agentPlanPreviewItemMatchesTarget(item, target)).length;
}

function createAgentPlanItemsForNewTarget({
  target,
  count,
  instruction,
  existingItems,
  existingMatrix,
}: {
  target: AgentPlanEditTarget;
  count: number;
  instruction: string;
  existingItems: WorkflowPlanPreviewItem[];
  existingMatrix: WorkflowPlanPreviewAgentMatrixItem[];
}): {
  items: WorkflowPlanPreviewItem[];
  matrix: WorkflowPlanPreviewAgentMatrixItem[];
} {
  const safeCount = Math.max(1, Math.min(count, 20));
  const startIndex = existingItems.length + 1;
  const titleBase = instruction || getAgentPlanNewTargetTitle(target);
  const copyMode = getAgentPlanNewTargetCopyMode(target, existingMatrix, existingItems);
  const missingInputIds = getAgentPlanInheritedMissingInputIds(target, existingMatrix);
  const referenceRoles = getAgentPlanNewTargetReferenceRoles(target, copyMode);
  const ratio = getAgentPlanNewTargetRatio(target);
  const items = Array.from({ length: safeCount }, (_, index): WorkflowPlanPreviewItem => {
    const ordinal = startIndex + index;
    const title = safeCount > 1 ? `${titleBase} ${index + 1}` : titleBase;
    return {
      id: `${target.id}_extra_${ordinal}`,
      title,
      purpose: buildAgentPlanNewTargetPurpose(target, instruction),
      slot: `${target.id}_extra_${ordinal}`,
      ratio,
      copyMode,
      componentRefs: [],
      qualityChecks: [],
    };
  });
  return {
    items,
    matrix: items.map((item): WorkflowPlanPreviewAgentMatrixItem => ({
      id: `matrix_${item.id}`,
      itemId: item.id,
      title: item.title,
      type: item.slot,
      outputSlotId: getPreviewItemBaseSlotId(item.slot),
      ratio: item.ratio,
      size: item.size,
      referenceRoles,
      providerReferenceRoles: [],
      assetGroupIds: [],
      copyMode,
      missingInputIds,
      status: missingInputIds.length > 0 ? "blocked" : "ready",
      summary: item.purpose,
    })),
  };
}

function getAgentPlanNewTargetTitle(target: AgentPlanEditTarget): string {
  if (target.id === "scene") return "新增场景图";
  if (target.id === "model") return "新增模特展示";
  if (target.id === "detail") return "新增商品细节";
  if (target.id === "closing") return "新增收尾图";
  if (target.id === "poster") return "新增卖点海报";
  if (target.id === "main") return "新增商品主图";
  if (target.id === "amazon") return "新增 Amazon 图";
  if (target.id === "xiaohongshu") return "新增小红书封面";
  return `新增${target.label}`;
}

function buildAgentPlanNewTargetPurpose(target: AgentPlanEditTarget, instruction: string): string {
  const direction = instruction ? `；本组调整：${instruction}` : "";
  if (target.id === "scene") return `补充一个新的场景表达，用来验证商品在不同环境里的空间、光影和使用氛围${direction}`;
  if (target.id === "model") return `补充模特展示，用来检查上身比例、动作和情绪是否自然${direction}`;
  if (target.id === "detail") return `补充商品细节，用来展示材质、结构、工艺和卖点证据${direction}`;
  if (target.id === "closing") return `补充收尾图，用来承接最终转化和行动提醒${direction}`;
  if (target.id === "poster") return `补充卖点海报，用来承载短文案和转化信息${direction}`;
  if (target.id === "main") return `补充商品主图，用来强化第一眼识别和平台点击${direction}`;
  if (target.id === "amazon") return `补充 Amazon 展示图，用来覆盖 listing 需要的商品信息${direction}`;
  if (target.id === "xiaohongshu") return `补充小红书封面，用来提高种草场景的点击感${direction}`;
  return `按用户要求补充新的图组${direction}`;
}

function getAgentPlanNewTargetRatio(target: AgentPlanEditTarget): string {
  if (target.id === "main") return "1:1";
  if (target.id === "amazon") return "1:1";
  if (target.id === "xiaohongshu") return "3:4";
  if (target.id === "closing") return "3:4";
  if (target.id === "poster") return "3:4";
  return "4:5";
}

function getAgentPlanNewTargetCopyMode(
  target: AgentPlanEditTarget,
  existingMatrix: WorkflowPlanPreviewAgentMatrixItem[],
  existingItems: WorkflowPlanPreviewItem[]
): string {
  if (target.id === "poster" || target.id === "closing" || target.id === "xiaohongshu") {
    return "burn_in";
  }
  return "layout_layer";
}

function getAgentPlanNewTargetReferenceRoles(target: AgentPlanEditTarget, copyMode: string): string[] {
  const roles = new Set<string>(["product", "style"]);
  if (target.id === "model") roles.add("model");
  if (target.id === "scene") roles.add("scene");
  if (target.id === "poster" || target.id === "closing" || target.id === "xiaohongshu" || copyMode === "burn_in") roles.add("copy");
  return Array.from(roles);
}

function getAgentPlanInheritedMissingInputIds(
  target: AgentPlanEditTarget,
  existingMatrix: WorkflowPlanPreviewAgentMatrixItem[]
): string[] {
  const wantedRoles = getAgentPlanNewTargetReferenceRoles(target, "layout_layer");
  const ids = existingMatrix.flatMap((item) => {
    const itemRoles = new Set(item.referenceRoles);
    if (!wantedRoles.some((role) => itemRoles.has(role))) return [];
    return item.missingInputIds ?? [];
  });
  return agentUniqueStrings(ids).slice(0, 4);
}

function applyAgentPlanEditFallback({
  text,
  items,
  matrix,
  editsUseMatrix,
}: {
  text: string;
  items: WorkflowPlanPreviewItem[];
  matrix: WorkflowPlanPreviewAgentMatrixItem[];
  editsUseMatrix: boolean;
}): {
  items: WorkflowPlanPreviewItem[];
  matrix: WorkflowPlanPreviewAgentMatrixItem[];
  changes: string[];
} {
  const compactText = text.replace(/\s+/g, "");
  let nextItems = [...items];
  let nextMatrix = [...matrix];
  const changes: string[] = [];

  if (/(场景|桌面|scene|lifestyle)/i.test(compactText) && /(不要|删除|去掉|不用|取消|别做|拿掉)/.test(compactText)) {
    if (editsUseMatrix) {
      const before = nextMatrix.length;
      nextMatrix = nextMatrix.filter((item) => !isFallbackScenePlanItem(item));
      if (before !== nextMatrix.length) changes.push(`删除场景图 ${before - nextMatrix.length} 张`);
    } else {
      const before = nextItems.length;
      nextItems = nextItems.filter((item) => !isFallbackScenePreviewItem(item));
      if (before !== nextItems.length) changes.push(`删除场景图 ${before - nextItems.length} 张`);
    }
  }

  const detailCount = parseAgentPlanEditCount(
    compactText.match(/(?:商品)?(?:细节|详情|feature|detail|卖点|材质|特写)(?:改成|改为|变成|调整为|要|来|做)?([0-9一二两三四五六七八九十]+)张/i)?.[1]
  );
  if (detailCount > 0 && detailCount <= 20) {
    if (editsUseMatrix) {
      const matching = nextMatrix.filter(isFallbackDetailPlanItem);
      if (matching.length > 0 && matching.length !== detailCount) {
        const others = nextMatrix.filter((item) => !isFallbackDetailPlanItem(item));
        const adjusted = Array.from({ length: detailCount }, (_, index) =>
          cloneAgentPlanMatrixItem(matching[Math.min(index, matching.length - 1)], index)
        );
        nextMatrix = restoreAgentPlanOrder(nextMatrix, others, matching[0], adjusted);
        changes.push(`商品细节改为 ${detailCount} 张`);
      }
    } else {
      const matching = nextItems.filter(isFallbackDetailPreviewItem);
      if (matching.length > 0 && matching.length !== detailCount) {
        const others = nextItems.filter((item) => !isFallbackDetailPreviewItem(item));
        const adjusted = Array.from({ length: detailCount }, (_, index) =>
          cloneAgentPlanPreviewItem(matching[Math.min(index, matching.length - 1)], index)
        );
        nextItems = restoreAgentPlanOrder(nextItems, others, matching[0], adjusted);
        changes.push(`商品细节改为 ${detailCount} 张`);
      }
    }
  }

  const wantsCopyLayer = hasLocalKeywordIntent(
    text,
    ["烧字", "烧进", "进图", "带字", "出字"],
    ["不", "别", "不要", "无需", "不需要"]
  );
  const wantsCopyBurn =
    !wantsCopyLayer &&
    (/(烧字|烧进|进图|带字|出字)/.test(compactText) ||
      ((compactText.includes("文案") || compactText.includes("文字")) && /(烧|进图|带字|出字)/.test(compactText)));
  if (wantsCopyLayer || wantsCopyBurn) {
    const copyMode = wantsCopyLayer ? "layout_layer" : "burn_in";
    if (editsUseMatrix) {
      nextMatrix = nextMatrix.map((item) => ({ ...item, copyMode }));
    }
    changes.push(copyMode === "burn_in" ? "文案改为烧进图" : "文案改为图层/不进图");
  }

  return { items: nextItems, matrix: nextMatrix, changes };
}

function isFallbackDetailPlanItem(item: WorkflowPlanPreviewAgentMatrixItem): boolean {
  return planItemText([item.title, item.type, item.outputSlotId, item.summary]).some((text) =>
    /(细节|详情|feature|detail|material|macro|卖点|材质|特写)/i.test(text)
  );
}

function isFallbackDetailPreviewItem(item: WorkflowPlanPreviewItem): boolean {
  return planItemText([item.title, item.purpose, item.slot, item.platform]).some((text) =>
    /(细节|详情|feature|detail|material|macro|卖点|材质|特写)/i.test(text)
  );
}

function isFallbackScenePlanItem(item: WorkflowPlanPreviewAgentMatrixItem): boolean {
  return planItemText([item.title, item.type, item.outputSlotId]).some((text) =>
    isFallbackSceneSlotText(text)
  );
}

function isFallbackScenePreviewItem(item: WorkflowPlanPreviewItem): boolean {
  return planItemText([item.title, item.slot, item.platform]).some((text) =>
    isFallbackSceneSlotText(text)
  );
}

function isFallbackSceneSlotText(text: string): boolean {
  return /(场景|商品场景|生活方式|^scene(?:$|[-_])|lifestyle)/i.test(text);
}

function planItemText(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase());
}

function targetHasLocalIntent(text: string, target: AgentPlanEditTarget, intents: string[]): boolean {
  return hasLocalKeywordIntent(text, target.keywords, intents);
}

function hasLocalKeywordIntent(text: string, keywords: string[], intents: string[]): boolean {
  const keywordPattern = keywords.map(escapeRegExp).join("|");
  const intentPattern = intents.map(escapeRegExp).join("|");
  const localGap = "[^，。；、:：,.!?\\n]{0,14}";
  return (
    new RegExp(`(?:${intentPattern})${localGap}(?:${keywordPattern})`, "i").test(text) ||
    new RegExp(`(?:${keywordPattern})${localGap}(?:${intentPattern})`, "i").test(text)
  );
}

function agentPlanPreviewItemMatchesTarget(item: WorkflowPlanPreviewItem, target: AgentPlanEditTarget): boolean {
  const text = [
    item.title,
    target.id === "scene" ? "" : item.purpose,
    item.slot,
    item.platform,
  ].filter(Boolean).join(" ").toLowerCase();
  if (target.id === "scene") {
    if (!/(场景|scene|lifestyle|环境|室内|户外|商场)/i.test(text)) return false;
    if (/(海报|poster|cover|hero|收尾|detail|细节|详情|特写)/i.test(text)) return false;
    return true;
  }
  if (target.id === "detail" && /(海报|poster|cover|hero|收尾|scene|场景|主图|静物|still|模特|真人|人物|上身|穿搭|model)/i.test(text)) {
    return false;
  }
  return target.keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function agentPlanMatrixItemMatchesTarget(
  item: WorkflowPlanPreviewAgentMatrixItem,
  target: AgentPlanEditTarget
): boolean {
  const summary = target.id === "scene" ? "" : item.summary;
  const text = [
    item.title,
    item.type,
    item.outputSlotId,
    summary,
  ].filter(Boolean).join(" ").toLowerCase();
  if (target.id === "scene") {
    if (!/(场景|scene|lifestyle|环境|室内|户外|商场)/i.test(text)) return false;
    if (/(海报|poster|cover|hero|closing|收尾|detail|细节|详情|特写)/i.test(text)) return false;
    return true;
  }
  if (target.id === "detail" && /(海报|poster|cover|hero|closing|收尾|scene|场景|主图|静物|still|模特|真人|人物|上身|穿搭|model)/i.test(text)) {
    return false;
  }
  return target.keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function adjustAgentPlanItemsToCount(
  items: WorkflowPlanPreviewItem[],
  target: AgentPlanEditTarget,
  count: number
): WorkflowPlanPreviewItem[] {
  const matching = items.filter((item) => agentPlanPreviewItemMatchesTarget(item, target));
  if (matching.length === 0) return items;
  const others = items.filter((item) => !agentPlanPreviewItemMatchesTarget(item, target));
  const adjusted = Array.from({ length: count }, (_, index) =>
    cloneAgentPlanPreviewItem(matching[Math.min(index, matching.length - 1)], index)
  );
  return restoreAgentPlanOrder(items, others, matching[0], adjusted);
}

function adjustAgentPlanMatrixToCount(
  items: WorkflowPlanPreviewAgentMatrixItem[],
  target: AgentPlanEditTarget,
  count: number
): WorkflowPlanPreviewAgentMatrixItem[] {
  const matching = items.filter((item) => agentPlanMatrixItemMatchesTarget(item, target));
  if (matching.length === 0) return items;
  const others = items.filter((item) => !agentPlanMatrixItemMatchesTarget(item, target));
  const adjusted = Array.from({ length: count }, (_, index) =>
    cloneAgentPlanMatrixItem(matching[Math.min(index, matching.length - 1)], index)
  );
  return restoreAgentPlanOrder(items, others, matching[0], adjusted);
}

function restoreAgentPlanOrder<T>(
  original: T[],
  others: T[],
  anchor: T,
  adjusted: T[]
): T[] {
  const result: T[] = [];
  let inserted = false;
  for (const item of original) {
    if (item === anchor) {
      result.push(...adjusted);
      inserted = true;
      continue;
    }
    if (others.includes(item)) result.push(item);
  }
  return inserted ? result : [...others, ...adjusted];
}

function cloneAgentPlanPreviewItem(item: WorkflowPlanPreviewItem, index: number): WorkflowPlanPreviewItem {
  if (index === 0) return item;
  return {
    ...item,
    id: `${item.id}_${index + 1}`,
    title: item.title,
    slot: `${item.slot}_${index + 1}`,
  };
}

function cloneAgentPlanMatrixItem(
  item: WorkflowPlanPreviewAgentMatrixItem,
  index: number
): WorkflowPlanPreviewAgentMatrixItem {
  if (index === 0) return item;
  return {
    ...item,
    id: `${item.id}_${index + 1}`,
    itemId: `${item.itemId}_${index + 1}`,
    title: item.title,
  };
}

function syncEditedPlanItemsFromMatrix(
  originalItems: WorkflowPlanPreviewItem[],
  matrixItems: WorkflowPlanPreviewAgentMatrixItem[]
): WorkflowPlanPreviewItem[] {
  return matrixItems.map((matrixItem, index) => {
    const matchedItem = originalItems.find((item) =>
      matrixItem.itemId === item.id ||
      matrixItem.outputSlotId === item.slot ||
      matrixItem.title === item.title
    );
    return {
      id: matrixItem.itemId || matchedItem?.id || `plan_item_${index + 1}`,
      title: matrixItem.title || matchedItem?.title || `图 ${index + 1}`,
      purpose: matchedItem?.purpose || matrixItem.summary || "",
      slot: matrixItem.outputSlotId || matchedItem?.slot || matrixItem.type || `image_${index + 1}`,
      ratio: matrixItem.ratio || matchedItem?.ratio || "auto",
      size: matrixItem.size || matchedItem?.size,
      copyMode: matrixItem.copyMode || matchedItem?.copyMode,
      platform: matchedItem?.platform,
      componentRefs: matchedItem?.componentRefs ?? [],
      qualityChecks: matchedItem?.qualityChecks ?? [],
    };
  });
}

function normalizeEditedPlanItem(
  item: WorkflowPlanPreviewItem,
  index: number,
  matrixItems: WorkflowPlanPreviewAgentMatrixItem[]
): WorkflowPlanPreviewItem {
  const matchedMatrix = matrixItems.find((matrixItem) =>
    matrixItem.itemId === item.id || matrixItem.outputSlotId === item.slot || matrixItem.title === item.title
  );
  return {
    ...item,
    id: item.id || `plan_item_${index + 1}`,
    title: item.title || `图 ${index + 1}`,
    slot: item.slot || matchedMatrix?.type || `image_${index + 1}`,
    ratio: matchedMatrix?.ratio || item.ratio || "auto",
    copyMode: matchedMatrix?.copyMode || item.copyMode,
  };
}

function normalizeEditedAgentMatrix(
  matrixItems: WorkflowPlanPreviewAgentMatrixItem[],
  planItems: WorkflowPlanPreviewItem[]
): WorkflowPlanPreviewAgentMatrixItem[] {
  if (matrixItems.length > 0) {
    return matrixItems.map((item, index) => ({
      ...item,
      id: item.id || `matrix_${index + 1}`,
      itemId: item.itemId || planItems[index]?.id || `plan_item_${index + 1}`,
      title: item.title || planItems[index]?.title || `图 ${index + 1}`,
      ratio: item.ratio || planItems[index]?.ratio,
    }));
  }

  return planItems.map((item, index) => ({
    id: `matrix_${item.id || index + 1}`,
    itemId: item.id,
    title: item.title,
    type: item.slot,
    outputSlotId: getPreviewItemBaseSlotId(item.slot),
    ratio: item.ratio,
    size: item.size,
    referenceRoles: inferPreviewItemReferenceRoles(item),
    providerReferenceRoles: [],
    assetGroupIds: [],
    copyMode: item.copyMode || "layout_layer",
    missingInputIds: [],
    status: "ready",
    summary: item.purpose,
  }));
}

function applyEditedPlanItemsToWorkflowDraft(
  draft: WorkflowComposeDraft,
  items: WorkflowPlanPreviewItem[],
  matrixItems: WorkflowPlanPreviewAgentMatrixItem[]
): WorkflowComposeDraft {
  const shotList = items.map((item, index) => {
    const matchedMatrix = matrixItems.find((matrixItem) =>
      matrixItem.itemId === item.id || matrixItem.outputSlotId === item.slot || matrixItem.title === item.title
    );
    const copyMode = matchedMatrix?.copyMode || "layout_layer";
    return {
      id: item.id || `shot_${index + 1}`,
      slot: item.slot || item.id || `image_${index + 1}`,
      label: item.title,
      intent: item.purpose,
      purpose: item.purpose,
      ratio: item.ratio,
      size: item.size,
      samplePhase: true,
      copyMode,
      textAllowed: copyMode === "burn_in",
      referenceRoles: matchedMatrix?.referenceRoles ?? [],
      promptHints: [],
      qaRules: item.qualityChecks ?? [],
      naming: item.slot || item.id || `image_${index + 1}`,
    };
  });

  return {
    ...draft,
    metadata: {
      ...draft.metadata,
      shotList,
    },
    nodes: draft.nodes.map((node) => {
      if (node.data.componentType !== "image_recipe") return node;
      const parameters = getRecordValue(node.data.parameters);
      return {
        ...node,
        data: {
          ...node.data,
          parameters: {
            ...parameters,
            outputCount: shotList.length,
            shotList,
          },
        },
      };
    }),
  };
}

function parseAgentPlanEditCount(value: string | undefined): number {
  if (!value) return 0;
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) return Number(normalized);
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (normalized === "十") return 10;
  if (normalized.startsWith("十")) return 10 + (map[normalized.slice(1)] ?? 0);
  if (normalized.endsWith("十")) return (map[normalized.slice(0, 1)] ?? 0) * 10;
  if (normalized.includes("十")) {
    const [tens, ones] = normalized.split("十");
    return (map[tens] ?? 1) * 10 + (map[ones] ?? 0);
  }
  return map[normalized] ?? 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatParameterFieldValue(field: EditableParameterField): string {
  if (field.type === "string_list" && Array.isArray(field.value)) {
    return field.value.filter((item): item is string => typeof item === "string").join(", ");
  }
  if (field.type === "json" || field.type === "object_list") {
    if (typeof field.value === "string") return field.value;
    try {
      return JSON.stringify(field.value, null, 2);
    } catch {
      return "";
    }
  }
  if (field.value === undefined || field.value === null) return "";
  return String(field.value);
}

function parseParameterFieldValue(field: EditableParameterField, value: string): unknown {
  if (field.type === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (field.type === "string_list") {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (field.type === "json" || field.type === "object_list") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function mapProductImportPreview(payload: unknown): ProductImportPreview {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { parsedProducts: [], rejectedRows: [], componentsPreview: [] };
  }
  const value = payload as {
    parsedProducts?: unknown;
    rejectedRows?: unknown;
    componentsPreview?: unknown;
  };

  return {
    parsedProducts: Array.isArray(value.parsedProducts)
      ? value.parsedProducts.map(mapImportedProductPreview).filter(Boolean) as ImportedProductPreview[]
      : [],
    rejectedRows: Array.isArray(value.rejectedRows)
      ? value.rejectedRows.map(mapRejectedProductRow).filter(Boolean) as ProductImportPreview["rejectedRows"]
      : [],
    componentsPreview: Array.isArray(value.componentsPreview)
      ? value.componentsPreview.map(mapProductComponentPreview).filter(Boolean) as ProductImportPreview["componentsPreview"]
      : [],
  };
}

function mapImportedProductPreview(product: unknown): ImportedProductPreview | null {
  if (!product || typeof product !== "object" || Array.isArray(product)) return null;
  const value = product as Partial<ImportedProductPreview>;
  const title = getStringValue(value.title);
  if (!title) return null;

  return {
    title,
    category: getStringValue(value.category) || "商品",
    description: getStringValue(value.description) || "",
    sellingPoints: getStringArray(value.sellingPoints),
    sku: getStringValue(value.sku),
  };
}

function mapRejectedProductRow(row: unknown): ProductImportPreview["rejectedRows"][number] | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const value = row as { index?: unknown; reason?: unknown };
  return {
    index: typeof value.index === "number" ? value.index : 0,
    reason: getStringValue(value.reason) || "无法解析",
  };
}

function mapProductComponentPreview(component: unknown): ProductImportPreview["componentsPreview"][number] | null {
  if (!component || typeof component !== "object" || Array.isArray(component)) return null;
  const value = component as Partial<ProductImportPreview["componentsPreview"][number]>;
  const title = getStringValue(value.title);
  const type = getStringValue(value.type);
  if (!title || !type) return null;

  return {
    title,
    type,
    metadata:
      value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
        ? value.metadata
        : {},
  };
}

function normalizeComposedNode(node: unknown): CanvasWorkbenchNode | null {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const value = node as {
    id?: unknown;
    title?: unknown;
    caption?: unknown;
    status?: unknown;
    position?: { x?: unknown; y?: unknown };
    data?: unknown;
  };
  const id = getStringValue(value.id);
  if (!id) return null;

  const data = value.data && typeof value.data === "object" && !Array.isArray(value.data)
    ? value.data as Record<string, unknown>
    : {};
  const label = getStringValue(data.label) || getStringValue(value.title) || id;
  const caption = getStringValue(data.caption) || getStringValue(value.caption) || "由需求生成的工作流组件";
  const iconName = normalizeIconName(getStringValue(data.iconName) as keyof typeof canvasIconMap);

  return {
    id,
    position: {
      x: typeof value.position?.x === "number" ? value.position.x : 80,
      y: typeof value.position?.y === "number" ? value.position.y : 120,
    },
    data: {
      ...data,
      label,
      caption,
      kind: normalizeCanvasKind(getStringValue(data.kind) as CanvasWorkbenchNode["data"]["kind"]),
      status: normalizeCanvasStatus(
        (getStringValue(data.status) || getStringValue(value.status)) as CanvasWorkbenchNode["data"]["status"]
      ),
      metrics: normalizeMetrics(Array.isArray(data.metrics) ? data.metrics as string[] : []),
      iconName,
      previewUrl: getStringValue(data.previewUrl),
      previewAlt: getStringValue(data.previewAlt) || label,
      source: getStringValue(data.source) || "workflow-compose",
    },
  };
}

function normalizeComposedEdge(edge: unknown): CanvasWorkbenchEdge | null {
  if (!edge || typeof edge !== "object" || Array.isArray(edge)) return null;
  const value = edge as Partial<CanvasWorkbenchEdge>;
  if (!value.source || !value.target) return null;

  return {
    id: typeof value.id === "string" && value.id.trim()
      ? value.id
      : `${value.source}-${value.target}`,
    source: value.source,
    target: value.target,
    label: typeof value.label === "string" && value.label.trim() ? value.label : "生成",
    animated: typeof value.animated === "boolean" ? value.animated : false,
  };
}

function instantiateWorkflowTemplate(
  template: PersistedWorkflowTemplate,
  existingNodes: CanvasWorkbenchNode[]
): { nodes: CanvasWorkbenchNode[]; edges: CanvasWorkbenchEdge[] } {
  const stamp = Date.now();
  const prefix = `tpl-${template.id}-${stamp}`;
  const templateBounds = getTemplateBounds(template.nodes);
  const existingBounds = getCanvasBounds(existingNodes);
  const offset = {
    x: existingBounds.maxX + 180 - templateBounds.minX,
    y: Math.max(40, existingBounds.minY) - templateBounds.minY,
  };
  const idMap = new Map<string, string>();

  const nodes = template.nodes.map((node, index) => {
    const id = `${prefix}-${node.id}`;
    idMap.set(node.id, id);

    return {
      id,
      position: {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y + (index % 2) * 4,
      },
      data: normalizeTemplateNodeData(node, template),
    };
  });

  const edges = template.edges
    .map((edge) => {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) return null;

      return {
        id: `${prefix}-${edge.id}`,
        source,
        target,
        label: edge.label || "模板",
        animated: edge.animated,
      };
    })
    .filter(Boolean) as CanvasWorkbenchEdge[];

  return { nodes, edges };
}

function isTemplateNode(value: unknown): value is PersistedWorkflowTemplate["nodes"][number] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const node = value as Partial<PersistedWorkflowTemplate["nodes"][number]>;
  return (
    typeof node.id === "string" &&
    !!node.id.trim() &&
    !!node.position &&
    typeof node.position.x === "number" &&
    typeof node.position.y === "number" &&
    !!node.data &&
    typeof node.data === "object" &&
    !Array.isArray(node.data)
  );
}

function normalizeTemplateEdge(edge: unknown): CanvasWorkbenchEdge | null {
  if (!edge || typeof edge !== "object" || Array.isArray(edge)) return null;
  const value = edge as Partial<CanvasWorkbenchEdge>;
  if (!value.id || !value.source || !value.target) return null;

  return {
    id: value.id,
    source: value.source,
    target: value.target,
    label: typeof value.label === "string" ? value.label : "模板",
    animated: typeof value.animated === "boolean" ? value.animated : false,
  };
}

function normalizeTemplateNodeData(
  node: PersistedWorkflowTemplate["nodes"][number],
  template: PersistedWorkflowTemplate
): CanvasWorkbenchNode["data"] {
  const data = node.data;
  const label = getStringValue(data.label) || node.title || "模板节点";
  const caption = getStringValue(data.caption) || template.title;
  const iconName = normalizeIconName(getStringValue(data.iconName) as keyof typeof canvasIconMap);

  return {
    label,
    caption,
    kind: normalizeCanvasKind(getStringValue(data.kind) as CanvasWorkbenchNode["data"]["kind"]),
    status: normalizeCanvasStatus(
      getStringValue(data.status) as CanvasWorkbenchNode["data"]["status"]
    ),
    metrics: normalizeMetrics(Array.isArray(data.metrics) ? data.metrics : [
      getWorkflowTemplateCategoryLabel(template.category),
      `${template.nodes.length} 节点`,
      `v${template.version}`,
    ]),
    iconName,
    previewUrl: getStringValue(data.previewUrl),
    previewAlt: getStringValue(data.previewAlt) || label,
    parameters: isPlainRecord(data.parameters) ? data.parameters : undefined,
    promptFragments: getStringArray(data.promptFragments),
    constraints: getStringArray(data.constraints),
    negativeRules: getStringArray(data.negativeRules),
    qualityRules: getStringArray(data.qualityRules),
    templateId: template.id,
    templateNodeId: node.id,
    source: "workflow-template",
    category: template.category,
  };
}

function getWorkflowTemplateCategoryLabel(category: string): string {
  return workflowTemplateCategoryLabel[category] ?? "模板";
}

function getTemplateBounds(nodes: PersistedWorkflowTemplate["nodes"]): {
  minX: number;
  minY: number;
} {
  if (nodes.length === 0) return { minX: 0, minY: 0 };

  return nodes.reduce(
    (bounds, node) => ({
      minX: Math.min(bounds.minX, node.position.x),
      minY: Math.min(bounds.minY, node.position.y),
    }),
    { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY }
  );
}

function getCanvasBounds(nodes: CanvasWorkbenchNode[]): {
  minY: number;
  maxX: number;
} {
  if (nodes.length === 0) return { minY: 40, maxX: 40 };

  return nodes.reduce(
    (bounds, node) => ({
      minY: Math.min(bounds.minY, node.position.y),
      maxX: Math.max(bounds.maxX, node.position.x),
    }),
    { minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY }
  );
}

function areCanvasPositionsEqual(
  current: XYPosition | undefined,
  next: XYPosition | undefined
): boolean {
  if (!current || !next) return false;
  return Math.abs(current.x - next.x) < 0.5 && Math.abs(current.y - next.y) < 0.5;
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getStoredImagePreviewUrl(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return undefined;
  const imageStorage = getRecordValue(metadata.imageStorage);
  const resultStorage = getRecordValue(metadata.resultStorage);
  return (
    getStringValue(metadata.thumbnailUrl) ||
    getStringValue(imageStorage.thumbnailUrl) ||
    getStringValue(resultStorage.thumbnailUrl)
  );
}

function getPersistedAssetPreviewUrl(asset: PersistedAsset, metadata: Record<string, unknown>): string {
  return getStoredImagePreviewUrl(metadata) || getStringValue(metadata.previewUrl) || asset.url || "";
}

function getPersistedAssetReferenceUrl(asset: PersistedAsset, metadata: Record<string, unknown>): string | undefined {
  const imageStorage = getRecordValue(metadata.imageStorage);
  const resultStorage = getRecordValue(metadata.resultStorage);
  return (
    getStringValue(metadata.referenceUrl) ||
    getStringValue(imageStorage.publicUrl) ||
    getStringValue(resultStorage.publicUrl) ||
    getStringValue(metadata.previewUrl) ||
    asset.url
  );
}

function getJobOutputPreviewUrl(
  job: PersistedGenerationJob,
  artifact: PersistedGeneratedArtifact | undefined
): string | undefined {
  return artifact
    ? getArtifactPreviewUrl(artifact)
    : getStoredImagePreviewUrl(job.metadata) || job.resultUrl || undefined;
}

function getCanvasAssetReferenceUrl(asset: CanvasAsset | undefined): string | undefined {
  if (!asset) return undefined;
  return (
    asset.referenceUrl ||
    getStringValue(asset.parameters?.referenceImage) ||
    getStringValue(asset.parameters?.imageUrl) ||
    asset.previewUrl
  );
}

function buildAssetPackSourceImages(
  category: AssetPackCategory,
  productAsset: CanvasAsset | undefined
): AssetPackSourceImage[] {
  if (category !== "product_asset" || !productAsset) return [];
  const sourceImageUrl = getCanvasAssetReferenceUrl(productAsset);
  if (!sourceImageUrl) return [];
  return [{
    role: "product",
    title: productAsset.title,
    url: sourceImageUrl,
  }];
}

function buildAssetPackReferenceSourceImages(
  uploads: AssetPackReferenceUpload[],
  category: AssetPackCategory
): AssetPackSourceImage[] {
  const role = getAssetPackReferenceRole(category);
  return uploads.map((upload, index) => ({
    role,
    title: upload.name || `${getAssetPackReferenceUploadLabel(category)} ${index + 1}`,
    url: upload.dataUrl,
  }));
}

function isVisibleAssetLibraryItem(asset: CanvasAsset): boolean {
  const source = (asset.source || "").toLowerCase();
  if (!source) return true;
  if (source === "job-runner") return false;
  if (source.includes("smoke") || source.includes("demo")) return false;
  return true;
}

function mapPersistedAssetToCanvas(asset: PersistedAsset): CanvasAsset | null {
  if (!asset?.id || !asset?.type || !asset?.title) return null;
  const iconName = assetTypeIcon[asset.type] ?? "product";
  const metadata = getRecordValue(asset.metadata);
  if (isLegacyDemoUploadAsset(asset, metadata)) return null;
  const parameters = getRecordValue(metadata.parameters);
  const metadataCategory = getStringValue(metadata.canvasCategory);
  const category = isCanvasLibraryCategoryValue(metadataCategory)
    ? metadataCategory
    : assetTypeCategory[asset.type] ?? "商品";

  return {
    id: asset.id,
    category,
    title: asset.title,
    description: asset.description || "已保存到全局资产库",
    status: mapAssetStatus(asset.status),
    icon: canvasIconMap[iconName],
    previewUrl: getPersistedAssetPreviewUrl(asset, metadata),
    referenceUrl: getPersistedAssetReferenceUrl(asset, metadata),
    previewAlt: asset.title,
    favorite: metadata.favorite === true,
    rawMetadata: metadata,
    source: getStringValue(metadata.source) || "persisted-asset",
    componentType: getStringValue(metadata.componentType),
    parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
    promptFragments: getStringArray(metadata.promptFragments),
    constraints: getStringArray(metadata.constraints),
    negativeRules: getStringArray(metadata.negativeRules),
    qualityRules: getStringArray(metadata.qualityRules),
  };
}

function isLegacyDemoUploadAsset(
  asset: PersistedAsset,
  metadata: Record<string, unknown>
): boolean {
  return (
    getStringValue(metadata.source) === "canvas-upload" &&
    getStringValue(metadata.fileName) === "product-detail.svg" &&
    asset.title === "上传商品细节图"
  );
}

function mapModelToCanvasAsset(model: AIModel): CanvasAsset {
  const genderLabel = model.gender === "female" ? "女模特" : "男模特";
  const metadata = model.metadata;
  const profile = metadata?.profile;
  const metadataAutoName = getRecordValue(metadata?.autoName);
  const autoNameTitle =
    getStringValue(metadataAutoName.title) ||
    buildAutoModelAssetName({
      params: {
        gender: model.gender,
        ethnicity: model.ethnicity,
        age: model.age,
        temperament: model.temperament,
        bodyType: model.bodyType,
        hairStyle: model.hairStyle,
        makeup: model.makeup,
      },
      metadata,
      fallbackTitle: `${genderLabel} · ${model.age}岁`,
    }).title;
  const referenceImages = dedupeStrings([
    model.imageUrl,
    ...(metadata?.referenceImages ?? []),
  ]);
  const identityAnchors = metadata?.identityAnchors ?? [
    `${model.age}岁 ${model.ethnicity} ${genderLabel}`,
    model.temperament,
    model.bodyType,
  ];
  const consistencyRules = metadata?.consistencyRules ?? [
    "保持同一个成年专业模特身份、发型、脸部特征和身体比例一致。",
  ];
  const promptFragments = metadata?.promptFragments ?? [
    `Consistent professional model asset: ${genderLabel}, ${model.age} years old, ${model.ethnicity}, ${model.temperament}.`,
  ];
  const constraints = metadata?.constraints ?? [
    ...consistencyRules,
    "Treat this as a person asset; product details must come from product references.",
  ];
  const downstreamReferenceRules = metadata?.downstreamReferenceRules ?? [
    "Prefer the downstream identity reference zone for final image generation.",
    "Preserve identity anchors only; scene lighting and current shot pose override the model card.",
  ];
  const negativeRules = metadata?.negativeRules ?? [
    "Do not change model identity, hairstyle, age impression, face anchors, or body profile.",
  ];
  const qualityRules = metadata?.qualityRules ?? [
    "Stable model identity, coherent anatomy, natural commercial pose, clean lighting.",
  ];

  return {
    id: `model-asset-${model.id}`,
    category: "模特",
    title: autoNameTitle,
    description: `${model.ethnicity} / ${model.temperament} / ${model.bodyType}`,
    status: "ready",
    icon: canvasIconMap.model,
    previewUrl: model.imageUrl,
    referenceUrl: model.imageUrl,
    previewAlt: `${genderLabel}资产`,
    favorite: metadata?.favorite === true,
    rawMetadata: metadata,
    source: "model-library",
    componentType: "model_asset",
    parameters: {
      modelId: model.id,
      autoName: metadataAutoName,
      gender: model.gender,
      ethnicity: model.ethnicity,
      age: model.age,
      temperament: model.temperament,
      bodyType: model.bodyType,
      hairStyle: model.hairStyle ?? metadata?.sourceParams?.hairStyle,
      makeup: model.makeup ?? metadata?.sourceParams?.makeup,
      profile,
      identityAnchors,
      consistencyRules,
      poseRules: metadata?.poseRules ?? [],
      usageRules: metadata?.usageRules ?? [],
      safetyRules: metadata?.safetyRules ?? [],
      modelPromptSource: metadata?.source ?? "model-template",
      promptSnapshotAvailable: Boolean(metadata?.promptSnapshot ?? model.promptSnapshot),
      downstreamReferenceMode:
        metadata?.downstreamReferenceMode ?? "prefer_zone_b_neutral_identity_reference",
      downstreamReferenceRules,
      imageUrl: model.imageUrl,
      referenceImage: model.imageUrl,
      referenceImages,
    },
    promptFragments,
    constraints: dedupeStrings([...constraints, ...downstreamReferenceRules]),
    negativeRules,
    qualityRules,
  };
}

async function fetchPersistedJobById(jobId: string): Promise<PersistedGenerationJob | null> {
  const response = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
  if (!response.ok) return null;
  return mapPersistedJob(await response.json());
}

async function fetchPersistedProjects(): Promise<PersistedProjectDetails[]> {
  const response = await apiFetch("/api/projects", { cache: "no-store" });
  if (!response.ok) return [];

  const payload = await response.json();
  const list = Array.isArray(payload) ? payload : payload.projects;
  return Array.isArray(list)
    ? (list.map(mapPersistedProject).filter(Boolean) as PersistedProjectDetails[])
    : [];
}

async function reclaimStaleJobQueueSnapshot(): Promise<{
  queue: PersistedJobQueueSnapshot | null;
  reclaimedJobIds: string[];
}> {
  const response = await apiFetch("/api/jobs/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reclaim", enqueue: false }),
  });
  if (!response.ok) throw new Error("job queue reclaim failed");

  const payload = await response.json();
  const reclaim = payload?.reclaim && typeof payload.reclaim === "object" ? payload.reclaim : {};
  return {
    queue: mapPersistedJobQueueSnapshot(payload?.queue),
    reclaimedJobIds: getStringArray((reclaim as { reclaimedJobIds?: unknown }).reclaimedJobIds),
  };
}

async function createCanvasJob({
  workflowId,
  node,
  prompt,
  metadata,
}: {
  workflowId: string | null;
  node: CanvasWorkbenchNode;
  prompt: string;
  metadata: Record<string, unknown>;
}): Promise<PersistedGenerationJob> {
  const response = await apiFetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workflowId: workflowId ?? undefined,
      nodeId: node.id,
      status: "pending",
      prompt,
      metadata,
    }),
  });

  if (!response.ok) throw new Error("job api failed");

  const created = mapPersistedJob(await response.json());
  if (!created) throw new Error("invalid job api response");
  return created;
}

function mapPersistedJob(job: unknown): PersistedGenerationJob | null {
  if (!job || typeof job !== "object" || Array.isArray(job)) return null;
  const value = job as Partial<PersistedGenerationJob>;
  if (!value.id || typeof value.id !== "string") return null;

  return {
    id: value.id,
    workflowId: typeof value.workflowId === "string" ? value.workflowId : undefined,
    nodeId: typeof value.nodeId === "string" ? value.nodeId : undefined,
    assetId: typeof value.assetId === "string" ? value.assetId : undefined,
    status: typeof value.status === "string" ? value.status : "pending",
    prompt: typeof value.prompt === "string" ? value.prompt : "",
    resultUrl: typeof value.resultUrl === "string" ? value.resultUrl : "",
    error: typeof value.error === "string" ? value.error : "",
    metadata:
      value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
        ? value.metadata
        : {},
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
  };
}

function mapPersistedJobQueueSnapshot(value: unknown): PersistedJobQueueSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Partial<PersistedJobQueueSnapshot>;
  const runtime = snapshot.runtime && typeof snapshot.runtime === "object" ? snapshot.runtime : {};
  const database = snapshot.database && typeof snapshot.database === "object" ? snapshot.database : {};
  const stale = snapshot.stale && typeof snapshot.stale === "object" ? snapshot.stale : {};

  return {
    concurrency: getNumberValue(snapshot.concurrency, 0),
    owner: typeof snapshot.owner === "string" && snapshot.owner ? snapshot.owner : undefined,
    leaseDurationMs: getNumberValue(snapshot.leaseDurationMs, 0),
    runtime: {
      queuedJobIds: getStringArray((runtime as PersistedJobQueueSnapshot["runtime"]).queuedJobIds),
      runningJobIds: getStringArray((runtime as PersistedJobQueueSnapshot["runtime"]).runningJobIds),
      queuedCount: getNumberValue((runtime as PersistedJobQueueSnapshot["runtime"]).queuedCount, 0),
      runningCount: getNumberValue((runtime as PersistedJobQueueSnapshot["runtime"]).runningCount, 0),
    },
    database: {
      total: getNumberValue((database as PersistedJobQueueSnapshot["database"]).total, 0),
      pending: getNumberValue((database as PersistedJobQueueSnapshot["database"]).pending, 0),
      queued: getNumberValue((database as PersistedJobQueueSnapshot["database"]).queued, 0),
      running: getNumberValue((database as PersistedJobQueueSnapshot["database"]).running, 0),
      done: getNumberValue((database as PersistedJobQueueSnapshot["database"]).done, 0),
      failed: getNumberValue((database as PersistedJobQueueSnapshot["database"]).failed, 0),
      cancelled: getNumberValue((database as PersistedJobQueueSnapshot["database"]).cancelled, 0),
    },
    stale: {
      queuedJobIds: getStringArray((stale as PersistedJobQueueSnapshot["stale"]).queuedJobIds),
      runningJobIds: getStringArray((stale as PersistedJobQueueSnapshot["stale"]).runningJobIds),
      expiredJobIds: getStringArray((stale as PersistedJobQueueSnapshot["stale"]).expiredJobIds),
      missingLeaseJobIds: getStringArray((stale as PersistedJobQueueSnapshot["stale"]).missingLeaseJobIds),
      count: getOptionalNumberValue((stale as PersistedJobQueueSnapshot["stale"]).count),
      expiredCount: getOptionalNumberValue((stale as PersistedJobQueueSnapshot["stale"]).expiredCount),
    },
    leases: Array.isArray(snapshot.leases)
      ? snapshot.leases.map(mapPersistedJobQueueLease).filter(Boolean) as PersistedJobQueueLease[]
      : [],
  };
}

function mapPersistedJobQueueLease(value: unknown): PersistedJobQueueLease | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const lease = value as Partial<PersistedJobQueueLease>;
  if (typeof lease.jobId !== "string" || !lease.jobId) return null;
  return {
    jobId: lease.jobId,
    status: typeof lease.status === "string" ? lease.status : "",
    owner: typeof lease.owner === "string" ? lease.owner : undefined,
    expired: lease.expired === true,
    inRuntimeQueue: lease.inRuntimeQueue === true,
    inRuntimeRunning: lease.inRuntimeRunning === true,
  };
}

function mapPersistedProject(value: unknown): PersistedProjectDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const project = value as Partial<PersistedProjectDetails>;
  if (typeof project.id !== "string" || !project.id) return null;
  if (typeof project.title !== "string" || !project.title) return null;

  return {
    id: project.id,
    title: project.title,
    description: typeof project.description === "string" ? project.description : "",
    status: typeof project.status === "string" ? project.status : "active",
    metadata: isPlainRecord(project.metadata) ? project.metadata : {},
    campaigns: Array.isArray(project.campaigns)
      ? (project.campaigns.map(mapPersistedCampaign).filter(Boolean) as PersistedCampaign[])
      : [],
    batches: Array.isArray(project.batches)
      ? (project.batches.map(mapPersistedProjectBatch).filter(Boolean) as PersistedProjectBatch[])
      : [],
    reviewSummary: mapPersistedProjectReviewSummary(project.reviewSummary),
    updatedAt: typeof project.updatedAt === "string" ? project.updatedAt : undefined,
  };
}

function mapPersistedCampaign(value: unknown): PersistedCampaign | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const campaign = value as Partial<PersistedCampaign>;
  if (typeof campaign.id !== "string" || !campaign.id) return null;
  if (typeof campaign.projectId !== "string" || !campaign.projectId) return null;
  if (typeof campaign.title !== "string" || !campaign.title) return null;

  return {
    id: campaign.id,
    projectId: campaign.projectId,
    title: campaign.title,
    description: typeof campaign.description === "string" ? campaign.description : "",
    status: typeof campaign.status === "string" ? campaign.status : "active",
    metadata: isPlainRecord(campaign.metadata) ? campaign.metadata : {},
  };
}

function mapPersistedProjectBatch(value: unknown): PersistedProjectBatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const batch = value as Partial<PersistedProjectBatch>;
  if (typeof batch.id !== "string" || !batch.id) return null;
  if (typeof batch.projectId !== "string" || !batch.projectId) return null;
  if (typeof batch.title !== "string" || !batch.title) return null;
  const state = normalizeBatchState(batch.state);
  const batchState = mapPersistedBatchState(batch.batchState);

  return {
    id: batch.id,
    projectId: batch.projectId,
    campaignId: typeof batch.campaignId === "string" ? batch.campaignId : undefined,
    title: batch.title,
    kind: typeof batch.kind === "string" ? batch.kind : "export_pack",
    state,
    metadata: isPlainRecord(batch.metadata) ? batch.metadata : {},
    batchState,
    reviewSummary: mapPersistedProjectReviewSummary(batch.reviewSummary),
    updatedAt: typeof batch.updatedAt === "string" ? batch.updatedAt : undefined,
  };
}

function mapPersistedProjectReviewSummary(value: unknown): PersistedProjectReviewSummary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const summary = value as Partial<PersistedProjectReviewSummary>;
  return {
    sessionCount: getNumberValue(summary.sessionCount, 0),
    itemCount: getNumberValue(summary.itemCount, 0),
    approved: getNumberValue(summary.approved, 0),
    rejected: getNumberValue(summary.rejected, 0),
    needsRevision: getNumberValue(summary.needsRevision, 0),
    pending: getNumberValue(summary.pending, 0),
    latestAt: typeof summary.latestAt === "string" ? summary.latestAt : undefined,
    latestSessionTitle: typeof summary.latestSessionTitle === "string" ? summary.latestSessionTitle : undefined,
    recentHistory: Array.isArray(summary.recentHistory)
      ? (summary.recentHistory
          .map(mapPersistedProjectReviewHistoryEntry)
          .filter(Boolean) as PersistedProjectReviewHistoryEntry[])
      : [],
  };
}

function mapPersistedProjectReviewHistoryEntry(value: unknown): PersistedProjectReviewHistoryEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Partial<PersistedProjectReviewHistoryEntry>;
  if (typeof entry.id !== "string" || !entry.id) return null;
  if (typeof entry.label !== "string" || !entry.label) return null;
  if (typeof entry.sessionId !== "string" || !entry.sessionId) return null;
  return {
    id: entry.id,
    type: typeof entry.type === "string" ? entry.type : "session",
    label: entry.label,
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
    sessionId: entry.sessionId,
    sessionTitle: typeof entry.sessionTitle === "string" ? entry.sessionTitle : "",
    batchId: typeof entry.batchId === "string" ? entry.batchId : undefined,
  };
}

function mapPersistedBatchState(value: unknown): PersistedExportPackBatchState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const state = value as Partial<PersistedExportPackBatchState>;
  if (typeof state.batchId !== "string" || !state.batchId) return undefined;
  if (typeof state.projectId !== "string" || !state.projectId) return undefined;
  const stateName = normalizeBatchState(state.state);

  return {
    batchId: state.batchId,
    projectId: state.projectId,
    campaignId: typeof state.campaignId === "string" ? state.campaignId : undefined,
    state: stateName,
    label: typeof state.label === "string" && state.label ? state.label : getBatchStateLabel(stateName),
    locked: state.locked === true,
    delivered: state.delivered === true,
    canTransitionTo: Array.isArray(state.canTransitionTo)
      ? state.canTransitionTo.map(normalizeBatchState).filter((item, index, list) => list.indexOf(item) === index)
      : [],
    lockedAt: typeof state.lockedAt === "string" ? state.lockedAt : undefined,
    deliveredAt: typeof state.deliveredAt === "string" ? state.deliveredAt : undefined,
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : "",
  };
}

function buildProjectBatchStateMap(
  projects: PersistedProjectDetails[]
): Record<string, PersistedExportPackBatchState | undefined> {
  return Object.fromEntries(
    projects.flatMap((project) =>
      project.batches.map((batch) => [
        batch.id,
        batch.batchState ?? {
          batchId: batch.id,
          projectId: batch.projectId,
          campaignId: batch.campaignId,
          state: batch.state,
          label: getBatchStateLabel(batch.state),
          locked: batch.state === "locked" || batch.state === "delivered",
          delivered: batch.state === "delivered",
          canTransitionTo: getFallbackBatchTransitions(batch.state),
          updatedAt: batch.updatedAt ?? "",
        },
      ])
    )
  );
}

function normalizeBatchState(value: unknown): ExportPackBatchStateName {
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

function getFallbackBatchTransitions(state: ExportPackBatchStateName): ExportPackBatchStateName[] {
  if (state === "draft") return ["generated"];
  if (state === "generated") return ["in_review"];
  if (state === "in_review") return ["reviewed"];
  if (state === "reviewed") return ["locked"];
  if (state === "locked") return ["delivered"];
  return [];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getNumberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getOptionalNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function mapPersistedArtifact(artifact: unknown): PersistedGeneratedArtifact | null {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return null;
  const value = artifact as Partial<PersistedGeneratedArtifact>;
  if (!value.id || typeof value.id !== "string") return null;
  if (!value.title || typeof value.title !== "string") return null;

  return {
    id: value.id,
    workflowId: typeof value.workflowId === "string" ? value.workflowId : undefined,
    nodeId: typeof value.nodeId === "string" ? value.nodeId : undefined,
    jobId: typeof value.jobId === "string" ? value.jobId : undefined,
    assetId: typeof value.assetId === "string" ? value.assetId : undefined,
    type: typeof value.type === "string" ? value.type : "image",
    title: value.title,
    status: typeof value.status === "string" ? value.status : "ready",
    url: typeof value.url === "string" ? value.url : "",
    prompt: typeof value.prompt === "string" ? value.prompt : "",
    provider: typeof value.provider === "string" ? value.provider : "",
    model: typeof value.model === "string" ? value.model : "",
    metadata:
      value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
        ? value.metadata
        : {},
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
  };
}

function mapPersistedComponent(component: unknown): PersistedComponent | null {
  if (!component || typeof component !== "object" || Array.isArray(component)) return null;
  const value = component as Partial<PersistedComponent>;
  if (!value.id || typeof value.id !== "string") return null;
  if (!value.title || typeof value.title !== "string") return null;

  return {
    id: value.id,
    type: typeof value.type === "string" ? value.type : "product",
    title: value.title,
    description: typeof value.description === "string" ? value.description : "",
    status: typeof value.status === "string" ? value.status : "draft",
    version: typeof value.version === "number" ? value.version : 1,
    assetId: typeof value.assetId === "string" ? value.assetId : undefined,
    rules:
      value.rules && typeof value.rules === "object" && !Array.isArray(value.rules)
        ? value.rules
        : {},
    metadata:
      value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
        ? value.metadata
        : {},
    createdAt: typeof value.createdAt === "string" ? value.createdAt : undefined,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
  };
}

function mapAssetStatus(status?: string): CanvasAsset["status"] {
  if (status === "checking" || status === "review") return "checking";
  if (status === "draft" || status === "pending" || status === "queued") return "draft";
  return "ready";
}

function withNodeAsset(
  node: CanvasWorkbenchNode,
  asset: CanvasAsset,
  caption: string
): CanvasWorkbenchNode {
  return {
    ...node,
    data: {
      ...node.data,
      caption,
      previewUrl: asset.previewUrl,
      referenceUrl: getCanvasAssetReferenceUrl(asset),
      previewAlt: asset.previewAlt ?? asset.title,
      metrics: [asset.title, ...node.data.metrics.slice(1)],
    },
  };
}

function withUploadedProductAssetNode(
  node: CanvasWorkbenchNode,
  asset: CanvasAsset
): CanvasWorkbenchNode {
  const referenceUrl = getCanvasAssetReferenceUrl(asset);
  const previousParameters = getRecordValue(node.data.parameters);
  return {
    ...node,
    data: {
      ...node.data,
      label: asset.title,
      caption: "已导入商品图，未自动收藏到全局资产库。",
      kind: "asset",
      status: "ready",
      metrics: ["商品", "当前计划", "可生成样张"],
      iconName: "product",
      previewUrl: asset.previewUrl,
      referenceUrl,
      previewAlt: asset.previewAlt ?? asset.title,
      assetId: asset.id,
      componentType: "product_asset",
      type: "product_asset",
      source: "canvas-upload",
      category: "商品",
      parameters: {
        ...previousParameters,
        ...asset.parameters,
        originalPlanLabel: getStringValue(previousParameters.originalPlanLabel) ?? node.data.label,
        originalPlanCaption: getStringValue(previousParameters.originalPlanCaption) ?? node.data.caption,
      },
      promptFragments: asset.promptFragments ?? getStringArray(node.data.promptFragments),
      constraints: asset.constraints ?? getStringArray(node.data.constraints),
      negativeRules: asset.negativeRules ?? getStringArray(node.data.negativeRules),
      qualityRules: asset.qualityRules ?? getStringArray(node.data.qualityRules),
    },
  };
}

function bindExistingProductReferenceToWorkflowDraft(
  draft: WorkflowComposeDraft,
  productNode: CanvasWorkbenchNode
): WorkflowComposeDraft {
  const placeholder = findCanvasProductPlaceholderNode(draft.nodes);
  if (!placeholder) return draft;

  return {
    ...draft,
    nodes: draft.nodes.map((node) =>
      node.id === placeholder.id
        ? withExistingProductReferenceNode(node, productNode)
        : node
    ),
  };
}

function withExistingProductReferenceNode(
  placeholder: CanvasWorkbenchNode,
  productNode: CanvasWorkbenchNode
): CanvasWorkbenchNode {
  const productParameters = getRecordValue(productNode.data.parameters);
  const previousParameters = getRecordValue(placeholder.data.parameters);
  return {
    ...placeholder,
    data: {
      ...placeholder.data,
      label: productNode.data.label || placeholder.data.label,
      caption: "已接入当前画布商品图，未自动收藏到全局资产库。",
      kind: "asset",
      status: "ready",
      metrics: ["商品", "当前画布", "可生成样张"],
      iconName: "product",
      previewUrl: getStringValue(productNode.data.previewUrl),
      referenceUrl: getStringValue(productNode.data.referenceUrl) || getStringValue(productNode.data.previewUrl),
      previewAlt: getStringValue(productNode.data.previewAlt) || getStringValue(productNode.data.label),
      assetId: getStringValue(productNode.data.assetId),
      componentId: getStringValue(productNode.data.componentId),
      componentType: "product_asset",
      type: "product_asset",
      source: getStringValue(productNode.data.source) || "canvas-upload",
      category: "商品",
      parameters: {
        ...previousParameters,
        ...productParameters,
        originalPlanLabel: getStringValue(previousParameters.originalPlanLabel) ?? placeholder.data.label,
        originalPlanCaption: getStringValue(previousParameters.originalPlanCaption) ?? placeholder.data.caption,
      },
      promptFragments: getStringArray(productNode.data.promptFragments),
      constraints: getStringArray(productNode.data.constraints),
      negativeRules: getStringArray(productNode.data.negativeRules),
      qualityRules: getStringArray(productNode.data.qualityRules),
    },
  };
}

function withNodeArtifact(
  node: CanvasWorkbenchNode,
  artifact: PersistedGeneratedArtifact
): CanvasWorkbenchNode {
  const previewUrl = getArtifactPreviewUrl(artifact);
  if (
    node.data.artifactId === artifact.id &&
    node.data.previewUrl === previewUrl &&
    node.data.referenceUrl === artifact.url
  ) {
    return node;
  }

  return {
    ...node,
    data: {
      ...node.data,
      status: "ready",
      previewUrl: previewUrl || node.data.previewUrl,
      referenceUrl: artifact.url || getStringValue(node.data.referenceUrl),
      previewAlt: artifact.title || node.data.previewAlt,
      artifactId: artifact.id,
      artifactStatus: artifact.status,
      artifactCreatedAt: artifact.createdAt,
      metrics: mergeNodeMetrics(node.data.metrics, ["已生成产物", getArtifactStatusLabel(artifact.status)]),
      generationFrame: isGenerationFrameNode(node)
        ? mergeGenerationFrameOutputs(migrateLegacyGenerationFrameData(node.data, node.id), [
            mapArtifactToGenerationFrameOutput(artifact),
          ])
        : node.data.generationFrame,
    },
  };
}

function getStageEnrichmentSignature(
  nodes: CanvasWorkbenchNode[],
  jobs: PersistedGenerationJob[],
  artifacts: PersistedGeneratedArtifact[]
): string {
  return [
    nodes.map(getStageNodeSignature).join("|"),
    jobs.map(getStageJobSignature).join("|"),
    artifacts.map(getStageArtifactSignature).join("|"),
  ].join("::");
}

function getStageNodeSignature(node: CanvasWorkbenchNode): string {
  return [
    node.id,
    Math.round(node.position.x),
    Math.round(node.position.y),
    node.data.label,
    node.data.caption,
    node.data.kind,
    node.data.status,
    node.data.previewUrl,
    node.data.artifactId,
    node.data.assetId,
    node.data.jobId,
    node.data.source,
    node.data.category,
    JSON.stringify(node.data.parameters ?? null),
    node.data.generationUserRequest,
    (node.data.metrics ?? []).join(","),
    getGenerationFrameStateSignature(node.data.generationFrame),
  ].join("~");
}

function getStageJobSignature(job: PersistedGenerationJob): string {
  return [
    job.id,
    job.status,
    job.nodeId,
    job.assetId,
    job.resultUrl,
    job.error,
    job.updatedAt,
    getStringValue(job.metadata.frameNodeId),
    getStringValue(job.metadata.sourceNodeId),
    getStringValue(job.metadata.batchJobTitle),
    getStringValue(job.metadata.planItemTitle),
    getStringValue(job.metadata.exportItemTitle),
  ].join("~");
}

function getGenerationFrameStateSignature(frameValue: unknown): string {
  const frame = normalizeGenerationFrameState(frameValue);
  return [
    frame.frameId,
    frame.actionId,
    frame.outputType,
    frame.prompt,
    frame.status,
    frame.updatedAt,
    frame.assets.map(getGenerationFrameBindingSignature).join(","),
    getGenerationFrameOutputSignature(frame.outputs),
  ].join("~");
}

function getGenerationFrameBindingSignature(binding: GenerationFrameState["assets"][number]): string {
  return [
    binding.bindingId,
    binding.role,
    binding.source,
    binding.title,
    binding.sourceNodeId,
    binding.sourceAssetId,
    binding.sourceComponentId,
    binding.referenceUrl,
    binding.providerUsable ? "1" : "0",
    binding.primary ? "1" : "0",
    binding.order,
    binding.weight,
    binding.providerMode,
    binding.updatedAt,
  ].join("~");
}

function getGenerationFrameOutputSignature(outputs: GenerationFrameOutput[] = []): string {
  return outputs
    .map((output) =>
      [
        output.id,
        output.title,
        output.url,
        output.nodeId,
        output.jobId,
        output.artifactId,
        output.status,
        output.createdAt,
        getGenerationFrameOutputMetadataSignature(output.metadata),
      ].join("~")
    )
    .join(",");
}

function getGenerationFrameOutputMetadataSignature(metadata?: Record<string, unknown>): string {
  if (!metadata) return "";
  return [
    getStringValue(metadata.prompt),
    getStringValue(metadata.provider),
    getStringValue(metadata.model),
    getStringValue(metadata.ratio),
    getStringValue(metadata.size),
    JSON.stringify(metadata.referenceImages ?? null),
    JSON.stringify(metadata.referenceContext ?? null),
    JSON.stringify(metadata.providerReferenceAdapter ?? null),
    JSON.stringify(metadata.assetInvocationPlan ?? null),
    JSON.stringify(metadata.providerDiagnostics ?? null),
  ].join("~");
}

function isGenerationFrameOutputInBatch(output: GenerationFrameOutput, batchId: string): boolean {
  return (
    getStringValue(output.metadata?.batchId) === batchId ||
    getStringValue(output.metadata?.exportPackId) === batchId
  );
}

function enrichGenerationFrameNodesWithJobOutputs(
  nodes: CanvasWorkbenchNode[],
  jobs: PersistedGenerationJob[],
  artifacts: PersistedGeneratedArtifact[]
): CanvasWorkbenchNode[] {
  if (nodes.length === 0 || (jobs.length === 0 && artifacts.length === 0)) return nodes;

  const artifactsByJobId = new Map(
    artifacts
      .filter((artifact) => artifact.jobId)
      .map((artifact) => [artifact.jobId as string, artifact])
  );
  const outputsByNodeId = new Map<string, GenerationFrameOutput[]>();

  for (const job of jobs) {
    const nodeId = job.nodeId || getStringValue(job.metadata.frameNodeId) || getStringValue(job.metadata.sourceNodeId);
    if (!nodeId) continue;
    const artifact = artifactsByJobId.get(job.id);
    const output = mapJobToGenerationFrameOutput(job, artifact);
    outputsByNodeId.set(nodeId, [...(outputsByNodeId.get(nodeId) ?? []), output]);
  }

  for (const artifact of artifacts) {
    if (!artifact.nodeId || artifact.jobId) continue;
    outputsByNodeId.set(artifact.nodeId, [
      ...(outputsByNodeId.get(artifact.nodeId) ?? []),
      mapArtifactToGenerationFrameOutput(artifact),
    ]);
  }

  if (outputsByNodeId.size === 0) return nodes;

  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (!isGenerationFrameNode(node)) return node;
    const activeBatchId = getStringValue(node.data.generationFrameActiveBatchId);
    const currentFrame = migrateLegacyGenerationFrameData(node.data, node.id);
    const batchScopedFrame = activeBatchId
      ? {
          ...currentFrame,
          outputs: currentFrame.outputs.filter((output) =>
            isGenerationFrameOutputInBatch(output, activeBatchId)
          ),
        }
      : currentFrame;
    const outputs = activeBatchId
      ? outputsByNodeId.get(node.id)?.filter((output) =>
          isGenerationFrameOutputInBatch(output, activeBatchId)
        )
      : outputsByNodeId.get(node.id);
    if (!outputs?.length && batchScopedFrame.outputs.length === currentFrame.outputs.length) return node;

    const frame = mergeGenerationFrameOutputs(
      batchScopedFrame,
      outputs ?? []
    );
    const status = getGenerationFrameStatusFromOutputs(frame.status, frame.outputs);
    const nextFrame = { ...frame, status };
    const nextStatus = mapGenerationFrameStatusToNodeStatus(status);
    const nextMetrics = updateGenerationFrameOutputMetrics(
      updateGenerationFrameSlotMetrics(node.data.metrics, nextFrame),
      nextFrame.outputs
    );

    const currentStoredFrame = normalizeGenerationFrameState(node.data.generationFrame);
    const currentStatus = node.data.status;
    if (
      currentStatus === nextStatus &&
      getGenerationFrameStateSignature(currentStoredFrame) === getGenerationFrameStateSignature(nextFrame) &&
      stringArraysEqual(node.data.metrics, nextMetrics)
    ) {
      return node;
    }

    changed = true;
    return {
      ...node,
      data: {
        ...node.data,
        status: nextStatus,
        metrics: nextMetrics,
        generationFrame: nextFrame,
      },
    };
  });

  return changed ? nextNodes : nodes;
}

function stringArraysEqual(first: readonly string[] = [], second: readonly string[] = []): boolean {
  if (first.length !== second.length) return false;
  return first.every((value, index) => value === second[index]);
}

function mapJobToGenerationFrameOutput(
  job: PersistedGenerationJob,
  artifact: PersistedGeneratedArtifact | undefined
): GenerationFrameOutput {
  const title =
    getStringValue(job.metadata.batchJobTitle) ??
    getStringValue(job.metadata.planItemTitle) ??
    getStringValue(job.metadata.exportItemTitle) ??
    getJobNodeLabel(job);

  return {
    id: artifact?.id ?? job.id,
    artifactId: artifact?.id,
    jobId: job.id,
    nodeId: job.nodeId,
    title,
    url: artifact?.url || job.resultUrl || undefined,
    previewUrl: getJobOutputPreviewUrl(job, artifact),
    status: artifact?.status || job.status,
    createdAt: artifact?.createdAt || job.createdAt,
    metadata: {
      ...job.metadata,
      ...(artifact?.metadata ?? {}),
      prompt: artifact?.prompt || job.prompt,
      provider: artifact?.provider || getStringValue(job.metadata.provider),
      model: artifact?.model || getStringValue(job.metadata.model),
      jobStatus: job.status,
      jobError: job.error,
      artifactId: artifact?.id,
      artifactStatus: artifact?.status,
    },
  };
}

function getGenerationFrameStatusFromOutputs(
  currentStatus: GenerationFrameStatus,
  outputs: GenerationFrameOutput[]
): GenerationFrameStatus {
  if (outputs.length === 0) return currentStatus;
  if (outputs.some((output) => output.status === "failed" || output.status === "error")) return "failed";
  if (outputs.some((output) => output.status === "running")) return "running";
  if (outputs.some((output) => output.status === "queued" || output.status === "pending" || output.status === "draft")) return "queued";
  if (outputs.some((output) => output.status === "review")) return "review";
  return "done";
}

function mapGenerationFrameStatusToNodeStatus(
  status: GenerationFrameStatus
): CanvasWorkbenchNode["data"]["status"] {
  if (status === "running") return "running";
  if (status === "queued" || status === "draft" || status === "empty") return "queued";
  if (status === "failed" || status === "review") return "review";
  return "ready";
}

function getHiddenArtifactNodeIds(metadata?: Record<string, unknown>): string[] {
  const value = metadata?.hiddenArtifactNodeIds;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && !!item.trim());
}

function addUniqueString(items: string[], item: string): string[] {
  return items.includes(item) ? items : [...items, item];
}

function withNodeComponentId(
  node: CanvasWorkbenchNode,
  componentId: string
): CanvasWorkbenchNode {
  return {
    ...node,
    data: {
      ...node.data,
      componentId,
    },
  };
}

function mergeNodeMetrics(current: string[], additions: string[]): string[] {
  const next = [...current];
  for (const addition of additions) {
    if (addition && !next.includes(addition)) next.push(addition);
  }
  return next.slice(0, 5);
}

function toFlowNode(
  node: CanvasWorkbenchNode,
  selected: boolean
): CanvasFlowNode {
  return {
    id: node.id,
    type: "canvasWorkflow",
    position: node.position,
    data: node.data,
    selected,
  };
}

function syncFlowNodesWithWorkbenchNodes(
  current: CanvasFlowNode[],
  nodes: CanvasWorkbenchNode[],
  selectedNodeId: string
): CanvasFlowNode[] {
  const currentById = new Map(current.map((node) => [node.id, node]));
  let changed = current.length !== nodes.length;
  const next = nodes.map((node) => {
    const selected = node.id === selectedNodeId;
    const previous = currentById.get(node.id);
    if (
      previous &&
      previous.data === node.data &&
      previous.selected === selected &&
      previous.type === "canvasWorkflow" &&
      areCanvasPositionsEqual(previous.position, node.position)
    ) {
      return previous;
    }

    changed = true;
    return toFlowNode(node, selected);
  });

  return changed ? next : current;
}

function toFlowEdge(edge: CanvasWorkbenchEdge, edgeCount = 0): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    animated: edge.animated && edgeCount <= 12,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#7A553C",
    },
    style: {
      stroke: "#7A553C",
      strokeOpacity: 0.72,
      strokeWidth: 1.6,
    },
    labelStyle: {
      fill: "#7C6F63",
      fontSize: 10,
    },
    labelBgStyle: {
      fill: "#FFFCF6",
      fillOpacity: 0.88,
    },
  };
}

function shouldOpenCanvasNodeOnClick(node: Pick<CanvasWorkbenchNode, "data">): boolean {
  if (!node.data.previewUrl && !node.data.referenceUrl) return false;
  return node.data.kind === "asset" || node.data.kind === "output" || node.data.source === "artifact-history";
}

function applyWorkbenchNodeChanges(
  nodes: CanvasWorkbenchNode[],
  changes: NodeChange<CanvasFlowNode>[]
): CanvasWorkbenchNode[] {
  let next = nodes;

  for (const change of changes) {
    if (change.type === "position" && change.position) {
      next = next.map((node) =>
        node.id === change.id
          ? {
              ...node,
              position: change.position ?? node.position,
            }
          : node
      );
    }

    if (change.type === "remove") {
      next = next.filter((node) => node.id !== change.id);
    }
  }

  return next;
}

function applyWorkbenchEdgeChanges(
  edges: CanvasWorkbenchEdge[],
  changes: EdgeChange<Edge>[]
): CanvasWorkbenchEdge[] {
  let next = edges;

  for (const change of changes) {
    if (change.type === "remove") {
      next = next.filter((edge) => edge.id !== change.id);
    }
  }

  return next;
}

function normalizeRestoredNodes(
  nodes?: CanvasWorkbenchNode[],
  metadata?: Record<string, unknown>
): CanvasWorkbenchNode[] {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [
      createDefaultGenerationFrameNode({
        productAsset: undefined,
        index: 0,
      }),
    ];
  }

  const restored = nodes.map((node) =>
    isGenerationFrameNode(node) ? normalizeGenerationFrameNode(node) : node
  );
  return shouldMigrateVisualNodeLayout(metadata)
    ? applyVisualNodeLayoutMigration(restored)
    : restored;
}

function shouldMigrateVisualNodeLayout(metadata?: Record<string, unknown>): boolean {
  const version = getMetadataNumber(metadata?.visualNodeLayoutVersion);
  return !version || version < VISUAL_NODE_LAYOUT_VERSION;
}

function applyVisualNodeLayoutMigration(nodes: CanvasWorkbenchNode[]): CanvasWorkbenchNode[] {
  let artifactIndex = 0;
  let backstageIndex = 0;
  const laneIndexes = new Map<CanvasLibraryCategory, number>();

  return nodes.map((node) => {
    const basePosition = visualNodeDefaultPositions[node.id];
    if (basePosition) {
      return { ...node, position: basePosition };
    }

    if (node.data.source === "artifact-history" || node.id.startsWith("artifact-node-")) {
      const position = {
        x: 360 + (artifactIndex % 3) * 320,
        y: 675 + Math.floor(artifactIndex / 3) * 330,
      };
      artifactIndex += 1;
      return { ...node, position };
    }

    if (isCanvasBackstageNode(node)) {
      const position = {
        x: 2040 + (backstageIndex % 3) * 340,
        y: 170 + Math.floor(backstageIndex / 3) * 330,
      };
      backstageIndex += 1;
      return { ...node, position };
    }

    const category = getCanvasNodeLibraryCategory(node);
    if (category && isUserCanvasReferenceNode(node)) {
      const laneIndex = laneIndexes.get(category) ?? 0;
      laneIndexes.set(category, laneIndex + 1);
      return {
        ...node,
        position: getCategoryLanePosition(category, laneIndex),
      };
    }

    return node;
  });
}

function normalizeRestoredEdges(edges?: CanvasWorkbenchEdge[]): CanvasWorkbenchEdge[] {
  if (!Array.isArray(edges) || edges.length === 0) return [];
  return edges;
}

function getMiniMapNodeColor(node: CanvasFlowNode): string {
  if (node.data.kind === "asset") return "#7A553C";
  if (node.data.kind === "factory") return "#C97961";
  if (node.data.kind === "output") return "#8E9A83";
  return "#DDD0C0";
}

function buildJobPromptFromNode(
  node: CanvasWorkbenchNode,
  productAsset?: CanvasAsset,
  referenceContext?: GenerationReferenceContext
): string {
  const productLine = productAsset
    ? `Product asset: ${productAsset.title}. ${productAsset.description}`
    : "Product asset: use the current canvas product component as the visual reference.";
  const frame = node.data.generationFrame
    ? normalizeGenerationFrameState(node.data.generationFrame)
    : undefined;
  const userRequest = getStringValue(node.data.generationUserRequest) ?? frame?.prompt;

  const prompt = [
    `Commercial image generation task: ${node.data.label}`,
    `Node intent: ${node.data.caption}`,
    `Node kind: ${node.data.kind}`,
    userRequest
      ? `User generation request: ${userRequest}`
      : "",
    productLine,
    `Generation requirements: ${node.data.metrics.join("; ")}`,
    "Keep product identity consistent across the image set. Use a unified commercial visual language and avoid changing product structure, logos, material, or key proportions.",
  ].filter(Boolean).join("\n");

  return appendGenerationReferencePrompt(prompt, referenceContext);
}

function buildBaseJobMetadata(
  node: CanvasWorkbenchNode,
  productAsset?: CanvasAsset,
  referenceContext?: GenerationReferenceContext
): Record<string, unknown> {
  const providerReferenceAdapter = buildProviderReferenceAdapter(referenceContext);
  const referenceImageUrl = getPrimaryProviderReferenceUrl(referenceContext);
  const generationFrame = node.data.generationFrame
    ? normalizeGenerationFrameState(node.data.generationFrame)
    : undefined;

  return {
    source: "canvas-workbench",
    sourceNodeId: node.id,
    sourceNodeLabel: node.data.label,
    nodeLabel: node.data.label,
    nodeKind: node.data.kind,
    nodeStatus: node.data.status,
    nodeMetrics: node.data.metrics,
    generationUserRequest: getStringValue(node.data.generationUserRequest) ?? generationFrame?.prompt,
    generationFrame,
    generationActionId: getStringValue(node.data.generationActionId),
    generationOutputType: getStringValue(node.data.generationOutputType),
    productAssetId: productAsset?.id,
    productAssetTitle: productAsset?.title,
    referenceImages: referenceContext?.images ?? [],
    referenceContext,
    referenceImageUrl,
    providerReferenceRole: providerReferenceAdapter.primaryImage?.role,
    providerReferenceStrategy: providerReferenceAdapter.strategy,
    promptOnlyReferenceImages: providerReferenceAdapter.promptOnlyImages,
    usesProviderReference: !!referenceImageUrl,
    usesProductReference: providerReferenceAdapter.primaryImage?.role === "product",
  };
}

function buildCanvasGenerationReferenceContext({
  targetNode,
  nodes,
  edges,
  components,
  assets,
  productAsset,
}: {
  targetNode: CanvasWorkbenchNode;
  nodes: CanvasWorkbenchNode[];
  edges: CanvasWorkbenchEdge[];
  components: PersistedComponent[];
  assets: CanvasAsset[];
  productAsset?: CanvasAsset;
}): GenerationReferenceContext {
  const frameState = targetNode.data.generationFrame || isGenerationFrameNode(targetNode)
    ? migrateLegacyGenerationFrameData(targetNode.data, targetNode.id)
    : undefined;
  const frameContext = frameState ? buildGenerationFrameReferenceContext(frameState) : undefined;
  if (
    frameContext &&
    (frameContext.images.length > 0 || Object.keys(frameContext.roles).length > 0)
  ) {
    return {
      ...frameContext,
      targetNodeId: targetNode.id,
      targetNodeLabel: targetNode.data.label,
    };
  }

  const componentById = new Map(components.map((component) => [component.id, component]));
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const relevantNodes = getReferenceRelevantNodes(targetNode, nodes, edges);
  const roleMap = new Map<GenerationReferenceRole, GenerationReferenceRoleContext>();
  const images: GenerationReferenceImage[] = [];

  for (const node of relevantNodes) {
    const componentId = getStringValue(node.data.componentId);
    const assetId = getStringValue(node.data.assetId);
    const component = componentId ? componentById.get(componentId) : undefined;
    const asset = assetId ? assetById.get(assetId) : undefined;
    const role = getNodeReferenceRole(node, component, asset);
    if (!role) continue;

    const nodeContext = buildNodeReferenceRoleContext({ role, node, component, asset });
    const current = roleMap.get(role);
    roleMap.set(role, current ? mergeReferenceRoleContext(current, nodeContext) : nodeContext);

    images.push(...buildNodeReferenceImages({ role, node, component, asset }));
  }

  if (!roleMap.has("product") && productAsset) {
    const fallbackNodeId = getStringValue(targetNode.data.sourceNodeId) ?? targetNode.id;
    const fallbackContext: GenerationReferenceRoleContext = {
      role: "product",
      title: productAsset.title,
      sourceNodeIds: [fallbackNodeId],
      componentIds: [],
      assetIds: [productAsset.id],
      promptFragments: [],
      constraints: [],
      negativeRules: [],
      qualityRules: [
        "Preserve product structure, color, material, logo regions, and key proportions.",
      ],
    };
    roleMap.set("product", fallbackContext);
    const productReferenceUrl = getCanvasAssetReferenceUrl(productAsset);
    if (productReferenceUrl) {
      images.push({
        role: "product",
        title: productAsset.title,
        url: productReferenceUrl,
        providerUsable: isProviderUsableReferenceUrl(productReferenceUrl),
        source: "product-asset-fallback",
        assetId: productAsset.id,
      });
    }
  }

  const roles = Object.fromEntries(roleMap.entries()) as GenerationReferenceContext["roles"];
  const roleContexts = Array.from(roleMap.values());

  return {
    version: 1,
    source: "canvas-workbench",
    targetNodeId: targetNode.id,
    targetNodeLabel: targetNode.data.label,
    images: dedupeReferenceImages(images),
    roles,
    promptFragments: dedupeStrings(roleContexts.flatMap((context) => context.promptFragments)),
    constraints: dedupeStrings(roleContexts.flatMap((context) => context.constraints)),
    negativeRules: dedupeStrings(roleContexts.flatMap((context) => context.negativeRules)),
    qualityRules: dedupeStrings(roleContexts.flatMap((context) => context.qualityRules)),
  };
}

function buildCanvasAgentPlanningReferenceContext({
  nodes,
  components,
  assets,
}: {
  nodes: CanvasWorkbenchNode[];
  components: PersistedComponent[];
  assets: CanvasAsset[];
}): GenerationReferenceContext {
  const componentById = new Map(components.map((component) => [component.id, component]));
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const roleMap = new Map<GenerationReferenceRole, GenerationReferenceRoleContext>();
  const images: GenerationReferenceImage[] = [];

  for (const node of nodes) {
    if (isGenerationFrameNode(node) || node.data.source === "artifact-history") continue;
    const componentId = getStringValue(node.data.componentId);
    const assetId = getStringValue(node.data.assetId);
    const component = componentId ? componentById.get(componentId) : undefined;
    const asset = assetId ? assetById.get(assetId) : undefined;
    const role = getNodeReferenceRole(node, component, asset);
    if (!role) continue;

    const nodeContext = buildNodeReferenceRoleContext({ role, node, component, asset });
    const current = roleMap.get(role);
    roleMap.set(role, current ? mergeReferenceRoleContext(current, nodeContext) : nodeContext);
    images.push(...buildNodeReferenceImages({ role, node, component, asset }));
  }

  const roleContexts = Array.from(roleMap.values());
  return {
    version: 1,
    source: "canvas-workbench",
    targetNodeId: "agent-plan-preview",
    targetNodeLabel: "Agent 计划预览",
    images: dedupeReferenceImages(images),
    roles: Object.fromEntries(roleMap.entries()) as GenerationReferenceContext["roles"],
    promptFragments: dedupeStrings(roleContexts.flatMap((context) => context.promptFragments)),
    constraints: dedupeStrings(roleContexts.flatMap((context) => context.constraints)),
    negativeRules: dedupeStrings(roleContexts.flatMap((context) => context.negativeRules)),
    qualityRules: dedupeStrings(roleContexts.flatMap((context) => context.qualityRules)),
  };
}

function getReferenceRelevantNodes(
  targetNode: CanvasWorkbenchNode,
  nodes: CanvasWorkbenchNode[],
  edges: CanvasWorkbenchEdge[]
): CanvasWorkbenchNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByTarget = new Map<string, string[]>();
  for (const edge of edges) {
    incomingByTarget.set(edge.target, [...(incomingByTarget.get(edge.target) ?? []), edge.source]);
  }

  const ids = new Set<string>();
  const visit = (nodeId: string) => {
    if (ids.has(nodeId)) return;
    ids.add(nodeId);
    for (const sourceId of incomingByTarget.get(nodeId) ?? []) visit(sourceId);
  };
  visit(targetNode.id);

  if (nodeById.has("product")) ids.add("product");
  return nodes.filter((node) => ids.has(node.id));
}

function buildNodeReferenceRoleContext({
  role,
  node,
  component,
  asset,
}: {
  role: GenerationReferenceRole;
  node: CanvasWorkbenchNode;
  component?: PersistedComponent;
  asset?: CanvasAsset;
}): GenerationReferenceRoleContext {
  const nodeParameters = getRecordValue(node.data.parameters);
  const componentParameters = component ? getComponentParameters(component) : {};
  const parameters = mergeRecords(componentParameters, nodeParameters);
  const promptFragments = [
    ...getStringArray(component?.metadata?.promptFragments),
    ...getStringArray(node.data.promptFragments),
  ];
  const constraints = [
    ...getStringArray(component?.metadata?.constraints),
    ...getStringArray(node.data.constraints),
  ];
  const negativeRules = [
    ...getStringArray(component?.metadata?.negativeRules),
    ...getStringArray(node.data.negativeRules),
  ];
  const qualityRules = [
    ...getStringArray(component?.metadata?.qualityRules),
    ...getStringArray(node.data.qualityRules),
    ...getRoleQualityRules(role, parameters),
  ];

  return {
    role,
    title: node.data.label || asset?.title || component?.title || role,
    sourceNodeIds: [node.id],
    componentIds: component?.id ? [component.id] : [],
    assetIds: asset?.id ? [asset.id] : [],
    parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
    promptFragments: dedupeStrings(promptFragments),
    constraints: dedupeStrings(constraints),
    negativeRules: dedupeStrings(negativeRules),
    qualityRules: dedupeStrings(qualityRules),
  };
}

function buildNodeReferenceImages({
  role,
  node,
  component,
  asset,
}: {
  role: GenerationReferenceRole;
  node: CanvasWorkbenchNode;
  component?: PersistedComponent;
  asset?: CanvasAsset;
}): GenerationReferenceImage[] {
  const parameters = mergeRecords(
    component ? getComponentParameters(component) : {},
    getRecordValue(node.data.parameters)
  );
  const urls = dedupeStrings([
    getStringValue(node.data.referenceUrl),
    getCanvasAssetReferenceUrl(asset),
    getStringValue(node.data.previewUrl),
    getOptionalRecordString(component?.metadata, "previewUrl"),
    getStringValue(parameters.imageUrl),
    getStringValue(parameters.referenceImage),
    ...getStringArray(parameters.images),
    ...getStringArray(parameters.referenceImages),
  ]);

  return urls.map((url) => ({
    role,
    title: node.data.label || asset?.title || component?.title || role,
    url,
    providerUsable: isProviderUsableReferenceUrl(url),
    source: getStringValue(node.data.source) || "canvas-node",
    nodeId: node.id,
    assetId: asset?.id,
    componentId: component?.id,
  }));
}

function getNodeReferenceRole(
  node: CanvasWorkbenchNode,
  component?: PersistedComponent,
  asset?: CanvasAsset
): GenerationReferenceRole | undefined {
  const category = getStringValue(node.data.category);
  const roleFromCategory = getReferenceRoleFromCategory(category || asset?.category);
  if (roleFromCategory) return roleFromCategory;

  const componentType = getStringValue(node.data.componentType) || component?.type;
  const roleFromComponent = getReferenceRoleFromComponentType(componentType);
  if (roleFromComponent) return roleFromComponent;

  if (node.id === "product" && node.data.kind === "asset") return "product";
  return undefined;
}

function getReferenceRoleFromCategory(category?: string): GenerationReferenceRole | undefined {
  if (category === "商品") return "product";
  if (category === "模特") return "model";
  if (category === "风格") return "style";
  if (category === "场景") return "scene";
  if (category === "文案") return "copy";
  return undefined;
}

function getReferenceRoleFromComponentType(type?: string): GenerationReferenceRole | undefined {
  if (type === "product" || type === "product_asset") return "product";
  if (type === "model" || type === "model_asset") return "model";
  if (type === "style" || type === "visual_style" || type === "brand_kit" || type === "prompt_source") {
    return "style";
  }
  if (type === "scene") return "scene";
  if (
    type === "copy" ||
    type === "copy_asset" ||
    type === "knowledge" ||
    type === "knowledge_asset" ||
    type === "text" ||
    type === "text_asset" ||
    type === "copy_rules"
  ) {
    return "copy";
  }
  return undefined;
}

function mergeReferenceRoleContext(
  current: GenerationReferenceRoleContext,
  next: GenerationReferenceRoleContext
): GenerationReferenceRoleContext {
  return {
    ...current,
    title: current.title || next.title,
    sourceNodeIds: dedupeStrings([...current.sourceNodeIds, ...next.sourceNodeIds]),
    componentIds: dedupeStrings([...current.componentIds, ...next.componentIds]),
    assetIds: dedupeStrings([...current.assetIds, ...next.assetIds]),
    parameters: mergeRecords(current.parameters ?? {}, next.parameters ?? {}),
    promptFragments: dedupeStrings([...current.promptFragments, ...next.promptFragments]),
    constraints: dedupeStrings([...current.constraints, ...next.constraints]),
    negativeRules: dedupeStrings([...current.negativeRules, ...next.negativeRules]),
    qualityRules: dedupeStrings([...current.qualityRules, ...next.qualityRules]),
  };
}

function getRoleQualityRules(
  role: GenerationReferenceRole,
  parameters: Record<string, unknown>
): string[] {
  if (role === "product") {
    return [
      "Preserve product structure, color, material, logos, and key proportions.",
      ...getStringArray(parameters.invariants),
      ...getStringArray(parameters.forbiddenChanges).map((rule) => `Avoid product change: ${rule}`),
    ];
  }
  if (role === "model") {
    return [
      ...getStringArray(parameters.identityAnchors).map((rule) => `Model identity anchor: ${rule}`),
      ...getStringArray(parameters.consistencyRules),
      ...getStringArray(parameters.downstreamReferenceRules),
    ];
  }
  if (role === "scene") {
    return [
      ...getStringArray(parameters.placementRules),
    ];
  }
  return [];
}

function dedupeReferenceImages(images: GenerationReferenceImage[]): GenerationReferenceImage[] {
  const seen = new Set<string>();
  const deduped: GenerationReferenceImage[] = [];
  for (const image of images) {
    const key = `${image.role}:${image.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(image);
  }
  return deduped.slice(0, 12);
}

function dedupeStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value?.trim()).map((value) => value.trim())));
}

function getRecordValue(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

function mergeRecords(
  base: Record<string, unknown>,
  next: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...base,
    ...next,
  };
}

function createNodeFromComponent(
  component: PersistedComponent,
  position: XYPosition,
  index: number
): CanvasWorkbenchNode {
  const iconName = getComponentIconName(component.type);
  const category = getComponentCategory(component.type);

  return {
    id: `component-node-${component.id}-${Date.now()}-${index}`,
    position,
    data: {
      label: component.title,
      caption: component.description || getComponentFallbackDescription(component.type),
      kind: getComponentNodeKind(component.type),
      status: getComponentNodeStatus(component.status),
      metrics: getComponentNodeMetrics(component),
      iconName,
      previewUrl: getOptionalRecordString(component.metadata, "previewUrl"),
      previewAlt: getOptionalRecordString(component.metadata, "previewAlt") || component.title,
      componentId: component.id,
      componentType: component.type,
      parameters: getComponentParameters(component),
      promptFragments: getStringArray(component.metadata?.promptFragments),
      constraints: getStringArray(component.metadata?.constraints),
      negativeRules: getStringArray(component.metadata?.negativeRules),
      qualityRules: getStringArray(component.metadata?.qualityRules),
      source: "component-library",
      category,
    },
  };
}

function upsertProductComponentNode(
  nodes: CanvasWorkbenchNode[],
  component: PersistedComponent,
  productNodeId: string
): CanvasWorkbenchNode[] {
  const existingProductNode = nodes.find((node) => node.id === "product");
  if (existingProductNode) {
    return nodes.map((node) =>
      node.id === existingProductNode.id ? withNodeProductComponent(node, component) : node
    );
  }

  const node = withNodeProductComponent(
    createNodeFromComponent(component, { x: 40, y: 180 }, nodes.length),
    component
  );
  return [{ ...node, id: productNodeId }, ...nodes];
}

function withNodeProductComponent(
  node: CanvasWorkbenchNode,
  component: PersistedComponent
): CanvasWorkbenchNode {
  const context = getProductComponentWorkflowContext(component);
  return {
    ...node,
    data: {
      ...node.data,
      label: context.title || component.title,
      caption: context.description || component.description || node.data.caption,
      kind: "asset",
      status: getComponentNodeStatus(component.status),
      metrics: getProductComponentMetrics(component),
      iconName: "product",
      previewUrl: context.previewUrl || node.data.previewUrl,
      referenceUrl: context.previewUrl || getStringValue(node.data.referenceUrl) || node.data.previewUrl,
      previewAlt: context.title || component.title,
      componentId: component.id,
      componentType: component.type,
      source: "product-import",
      category: "商品",
      parameters: getComponentParameters(component),
      promptFragments: getStringArray(component.metadata?.promptFragments),
      constraints: getStringArray(component.metadata?.constraints),
      negativeRules: getStringArray(component.metadata?.negativeRules),
      qualityRules: getStringArray(component.metadata?.qualityRules),
    },
  };
}

function getCanvasProductWorkflowContext(nodes: CanvasWorkbenchNode[]): {
  title: string;
  description: string;
} | undefined {
  const node = findCanvasProductReferenceNode(nodes);
  if (!node) return undefined;
  return {
    title: node.data.label || "画布商品",
    description: node.data.caption || "画布中已放入的商品素材",
  };
}

function hasWorkflowComposePlan(nodes: CanvasWorkbenchNode[]): boolean {
  return nodes.some((node) => getStringValue(node.data.source) === "workflow-compose");
}

function isCanvasProductNode(node: CanvasWorkbenchNode): boolean {
  const category = getStringValue(node.data.category);
  const componentType = getStringValue(node.data.componentType);
  const nodeType = getStringValue(node.data.type);
  return category === "商品" || componentType === "product_asset" || nodeType === "product_asset";
}

function hasExplicitProductReference(node: CanvasWorkbenchNode): boolean {
  const source = getStringValue(node.data.source);
  return (
    !!getStringValue(node.data.assetId) ||
    !!getStringValue(node.data.previewUrl) ||
    !!getStringValue(node.data.referenceUrl) ||
    source === "canvas-upload" ||
    source === "asset-library" ||
    source === "product-import"
  );
}

function findCanvasProductReferenceNode(nodes: CanvasWorkbenchNode[]): CanvasWorkbenchNode | undefined {
  return [...nodes].reverse().find((node) => isCanvasProductNode(node) && hasExplicitProductReference(node));
}

function findCanvasProductPlaceholderNode(nodes: CanvasWorkbenchNode[]): CanvasWorkbenchNode | undefined {
  return (
    nodes.find((node) =>
      isCanvasProductNode(node) &&
      getStringValue(node.data.source) === "workflow-compose" &&
      !hasExplicitProductReference(node)
    ) ??
    nodes.find((node) => isCanvasProductNode(node) && !hasExplicitProductReference(node))
  );
}

function getCanvasReferenceNodesToPreserveForWorkflowApply(
  nodes: CanvasWorkbenchNode[],
  draft: WorkflowComposeDraft
): CanvasWorkbenchNode[] {
  const draftNodeIds = new Set(draft.nodes.map((node) => node.id));
  const hasBoundProductInDraft = draft.nodes.some(
    (node) => getNodeReferenceRole(node) === "product" && hasExplicitProductReference(node)
  );

  return nodes.filter((node) => {
    if (draftNodeIds.has(node.id)) return false;
    if (!isUserCanvasReferenceNode(node)) return false;
    const role = getNodeReferenceRole(node);
    if (role === "product" && hasBoundProductInDraft) return false;
    return true;
  });
}

function getAgentSampleReferenceNodes(
  nodes: CanvasWorkbenchNode[],
  {
    productNode,
  }: {
    productNode: CanvasWorkbenchNode;
  }
): Array<{ node: CanvasWorkbenchNode; role: GenerationReferenceRole }> {
  const selected: Array<{ node: CanvasWorkbenchNode; role: GenerationReferenceRole }> = [
    { node: productNode, role: "product" },
  ];
  const seenNodeIds = new Set([productNode.id]);
  const seenRoles = new Set<GenerationReferenceRole>(["product"]);

  for (const node of [...nodes].reverse()) {
    if (seenNodeIds.has(node.id) || !isUserCanvasReferenceNode(node)) continue;
    const role = getNodeReferenceRole(node);
    if (!role || role === "product") continue;
    if (seenRoles.has(role)) continue;
    selected.push({ node, role });
    seenNodeIds.add(node.id);
    seenRoles.add(role);
  }

  return selected.sort((a, b) => getReferenceRoleOrder(a.role) - getReferenceRoleOrder(b.role));
}

function getPreferredBurnInCopyTextFromReferenceContext(
  context: GenerationReferenceContext | undefined
): string | undefined {
  const copyBrief = normalizeStructuredCopyBrief(context?.roles.copy?.parameters?.copyBrief);
  const text = copyBrief?.inImageText.length
    ? copyBrief.inImageText
    : copyBrief?.sourceText
      ? [copyBrief.sourceText]
      : [];
  return text.slice(0, 2).join(" / ") || undefined;
}

function isUserCanvasReferenceNode(node: CanvasWorkbenchNode): boolean {
  const source = getStringValue(node.data.source);
  return Boolean(
    getNodeReferenceRole(node) &&
    !isGenerationFrameNode(node) &&
    source !== "workflow-compose" &&
    source !== "artifact-history" &&
    hasCanvasReferenceSignal(node)
  );
}

function hasCanvasReferenceSignal(node: CanvasWorkbenchNode): boolean {
  return Boolean(
    getStringValue(node.data.referenceUrl) ||
    getStringValue(node.data.previewUrl) ||
    getStringValue(node.data.assetId) ||
    getStringValue(node.data.componentId) ||
    getStringArray(node.data.promptFragments).length > 0 ||
    getStringArray(node.data.constraints).length > 0 ||
    node.data.copyBrief
  );
}

function getReferenceRoleOrder(role: GenerationReferenceRole): number {
  if (role === "product") return 0;
  if (role === "model") return 1;
  if (role === "scene") return 2;
  if (role === "style") return 3;
  if (role === "copy") return 4;
  return 99;
}

function getAgentReferenceEdgeLabel(role: GenerationReferenceRole): string {
  if (role === "model") return "模特参考";
  if (role === "scene") return "场景参考";
  if (role === "style") return "风格参考";
  if (role === "copy") return "文案约束";
  return "参考";
}

function getProductComponentWorkflowContext(component: PersistedComponent): {
  title: string;
  description: string;
  previewUrl?: string;
} {
  const parameters = getComponentParameters(component);
  const sellingPoints = getStringArray(parameters.sellingPoints);
  const materials = getStringArray(parameters.materials);
  const category = getStringValue(parameters.category);
  const previewUrl = getFirstString([
    getOptionalRecordString(component.metadata, "previewUrl"),
    getStringValue(parameters.imageUrl),
    getStringValue(parameters.referenceImage),
    ...getStringArray(parameters.images),
    ...getStringArray(parameters.referenceImages),
  ]);
  const description = component.description ||
    [category, sellingPoints.slice(0, 3).join(" / "), materials.slice(0, 2).join(" / ")]
      .filter(Boolean)
      .join(" · ") ||
    "导入的商品参数";

  return {
    title: component.title,
    description,
    previewUrl,
  };
}

function createProductWorkflowBrief(component: PersistedComponent): string {
  const context = getProductComponentWorkflowContext(component);
  const parameters = getComponentParameters(component);
  const sellingPoints = getStringArray(parameters.sellingPoints).slice(0, 3);
  const platformHints = getStringArray(parameters.platformHints).slice(0, 3);
  const parts = [
    `${context.title} 生成一组商业可用图片`,
    context.description,
    sellingPoints.length > 0 ? `突出卖点：${sellingPoints.join("、")}` : "",
    platformHints.length > 0 ? `适配平台：${platformHints.join("、")}` : "",
    "包含商品主图、详情页卖点图、统一视觉语言的场景图和导出质检。",
  ].filter(Boolean);

  return parts.join("。");
}

function getProductComponentMetrics(component: PersistedComponent): string[] {
  const parameters = getComponentParameters(component);
  const sellingPoints = getStringArray(parameters.sellingPoints);
  const materials = getStringArray(parameters.materials);
  const platformHints = getStringArray(parameters.platformHints);
  const metrics = [
    getStringValue(parameters.category) || "商品",
    sellingPoints.length > 0 ? `卖点 ${sellingPoints.length}` : "",
    materials.length > 0 ? `材质 ${materials.length}` : "",
    platformHints.length > 0 ? `平台 ${platformHints.length}` : "",
    getStringValue(parameters.sku) ? "SKU" : "",
  ].filter(Boolean);

  return metrics.length > 0 ? metrics.slice(0, 4) : getComponentNodeMetrics(component);
}

function getComponentParameters(component: PersistedComponent): Record<string, unknown> {
  const parameters = component.metadata?.parameters;
  return parameters && typeof parameters === "object" && !Array.isArray(parameters)
    ? parameters as Record<string, unknown>
    : {};
}

function getFirstString(values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function createCopyNodeFromText(
  text: string,
  position: XYPosition,
  index: number
): CanvasWorkbenchNode {
  const copyBrief = buildStructuredCopyBrief(text);
  const title =
    copyBrief.inImageText[0] ||
    copyBrief.sellingPoints[0] ||
    copyBrief.exportCopy[0] ||
    "文案素材";
  const itemCount =
    copyBrief.inImageText.length +
    copyBrief.sellingPoints.length +
    copyBrief.exportCopy.length +
    copyBrief.forbiddenClaims.length;

  return {
    id: `copy-node-${Date.now()}-${index}`,
    position,
    data: {
      label: title.slice(0, 42),
      caption: text,
      kind: "asset",
      status: "ready",
      metrics: ["文案", `已拆 ${itemCount} 条`, "Agent 参考"],
      iconName: "copy",
      type: "copy_asset",
      componentType: "copy_asset",
      category: "文案",
      parameters: {
        text,
        copyText: text,
        copyBrief,
      },
      copyText: text,
      copyBrief,
      promptFragments: copyBrief.promptFragments,
      constraints: copyBrief.constraints,
      negativeRules: copyBrief.negativeRules,
      qualityRules: copyBrief.qualityRules,
      source: "canvas-paste-copy",
    },
  };
}

function createKnowledgeNode(position: XYPosition, index: number): CanvasWorkbenchNode {
  const title = "知识卡";
  const defaultText = "把构图规则、平台规范、提示词经验或禁忌项写在这里。";

  return {
    id: `knowledge-node-${Date.now()}-${index}`,
    position,
    data: {
      label: title,
      caption: defaultText,
      kind: "asset",
      status: "ready",
      metrics: ["知识", "规则", "Agent 参考"],
      iconName: "knowledge",
      type: "knowledge_asset",
      componentType: "knowledge_asset",
      category: "文案",
      parameters: {
        text: defaultText,
        knowledgeText: defaultText,
      },
      promptFragments: [
        "Knowledge card guidance:",
        defaultText,
      ],
      constraints: [
        "Treat knowledge cards as generation rules and quality constraints, not as visible image copy by default.",
      ],
      qualityRules: [
        "Apply the knowledge card only when it improves composition, platform fit, product truthfulness, or visual consistency.",
      ],
      negativeRules: [
        "Do not render knowledge-card text into the image unless a separate copy card explicitly asks for visible text.",
      ],
      source: "canvas-knowledge-card",
    },
  };
}

function mapGenerationRoleToCanvasCategory(role: GenerationFrameRole): CanvasLibraryCategory {
  if (role === "product") return "商品";
  if (role === "model") return "模特";
  if (role === "style") return "风格";
  if (role === "scene") return "场景";
  return "文案";
}

function mapGenerationRoleToIconName(role: GenerationFrameRole): keyof typeof canvasIconMap {
  if (role === "product") return "product";
  if (role === "model") return "model";
  if (role === "style") return "style";
  if (role === "scene") return "scene";
  return "copy";
}

function mapGenerationRoleToComponentType(role: GenerationFrameRole): string {
  if (role === "product") return "product_asset";
  if (role === "model") return "model_asset";
  if (role === "style") return "style";
  if (role === "scene") return "scene";
  return "copy_asset";
}

function createTemporaryUploadAsset({
  file,
  dataUrl,
  category,
  index,
}: {
  file: File;
  dataUrl: string;
  category: CanvasLibraryCategory;
  index: number;
}): CanvasAsset {
  const title = file.name.replace(/\.[^.]+$/, "") || `上传${category}图`;
  return {
    id: `local-upload-${Date.now()}-${index}`,
    category,
    title,
    description: `当前画布里的${category}素材，右键可保存到全局资产库`,
    status: "ready",
    icon: canvasIconMap[assetCategoryIcon[category] ?? "product"],
    previewUrl: dataUrl,
    referenceUrl: dataUrl,
    previewAlt: title,
    source: "canvas-upload",
    componentType: mapAssetCategoryToComponentType(category),
    parameters: {
      imageUrl: dataUrl,
      referenceImage: dataUrl,
      category,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    },
  };
}

function createNodeFromAsset(
  asset: CanvasAsset,
  position: XYPosition,
  index: number
): CanvasWorkbenchNode {
  const iconName = assetCategoryIcon[asset.category] ?? "product";
  const isTemporaryUpload = asset.source === "canvas-upload";

  return {
    id: `asset-node-${asset.id}-${Date.now()}-${index}`,
    position,
    data: {
      label: asset.title,
      caption: asset.description || "从全局资产库拖入的可复用组件",
      kind: mapAssetCategoryToNodeKind(asset.category),
      status: mapAssetToNodeStatus(asset.status),
      metrics: [
        asset.category,
        assetStatusLabel[asset.status],
        isTemporaryUpload ? "当前画布" : "来自全局资产库",
      ],
      iconName,
      previewUrl: asset.previewUrl,
      referenceUrl: getCanvasAssetReferenceUrl(asset),
      previewAlt: asset.previewAlt ?? asset.title,
      assetId: asset.id,
      componentType: asset.componentType,
      parameters: asset.parameters,
      promptFragments: asset.promptFragments ?? [],
      constraints: asset.constraints ?? [],
      negativeRules: asset.negativeRules ?? [],
      qualityRules: asset.qualityRules ?? [],
      source: asset.source || "asset-library",
      category: asset.category,
    },
  };
}

function createNodeFromSuggestion(
  suggestion: CanvasComponentSuggestion,
  index: number,
  component?: PersistedComponent
): CanvasWorkbenchNode {
  const id = `generated-${Date.now()}-${index}`;

  return {
    id,
    position: nextGeneratedPosition(index),
    data: {
      label: suggestion.title?.trim() || "AI 组件",
      caption: suggestion.caption?.trim() || "由组件工厂生成，可继续接入生成链路",
      kind: normalizeCanvasKind(suggestion.kind),
      status: normalizeCanvasStatus(suggestion.status),
      metrics: normalizeMetrics(suggestion.metrics),
      iconName: normalizeIconName(suggestion.iconName),
      previewUrl: suggestion.previewUrl,
      previewAlt: suggestion.previewAlt || suggestion.title || "AI 组件预览",
      componentId: component?.id,
      componentType: component?.metadata?.componentType ?? component?.type,
      parameters: component ? getComponentParameters(component) : undefined,
      promptFragments: component ? getStringArray(component.metadata?.promptFragments) : [],
      constraints: component ? getStringArray(component.metadata?.constraints) : [],
      negativeRules: component ? getStringArray(component.metadata?.negativeRules) : [],
      qualityRules: component ? getStringArray(component.metadata?.qualityRules) : [],
      source: component ? "component-factory" : "ai-component-factory",
    },
  };
}

function createEdgeForSuggestion(
  suggestion: CanvasComponentSuggestion,
  node: CanvasWorkbenchNode
): CanvasWorkbenchEdge {
  const source = typeof suggestion.sourceId === "string" && suggestion.sourceId.trim()
    ? suggestion.sourceId
    : "product";

  return {
    id: `${source}-${node.id}`,
    source,
    target: node.id,
    label: suggestion.edgeLabel?.trim() || "生成",
    animated: node.data.status === "running" || node.data.status === "queued",
  };
}

function createLocalFactorySuggestion(item: CanvasFactoryItem): CanvasComponentSuggestion {
  const fallback: Record<string, CanvasComponentSuggestion> = {
    "factory-brief": {
      title: "商品规格组件",
      caption: "把商品图拆成材质、结构、不可变元素和生成禁区",
      kind: "factory",
      status: "ready",
      metrics: ["商品识别字段", "不可变元素", "生成禁区"],
      iconName: "ai",
      sourceId: "product",
      edgeLabel: "转译",
    },
    "factory-model": {
      title: "模特展示任务",
      caption: "为商品匹配模特资产、姿势、镜头和统一光线",
      kind: "output",
      status: "queued",
      metrics: ["6 张 4:5", "商业半身", "统一光线"],
      iconName: "model",
      sourceId: "product",
      edgeLabel: "上身",
    },
    "factory-detail": {
      title: "详情页模块任务",
      caption: "围绕首屏、卖点条、细节特写和对比图生成模块",
      kind: "output",
      status: "queued",
      metrics: ["首屏/卖点/细节", "750px 宽", "中文文案"],
      iconName: "output",
      sourceId: "brief",
      edgeLabel: "编排",
    },
    "factory-export": {
      title: "多平台输出包",
      caption: "按淘宝、亚马逊、小红书等渠道整理图集和文案",
      kind: "output",
      status: "queued",
      metrics: ["渠道尺寸", "命名规范", "封面+详情"],
      iconName: "platform",
      sourceId: "platform",
      edgeLabel: "适配",
    },
    "factory-review": {
      title: "商业一致性质检",
      caption: "检查商品结构、材质、Logo、遮挡和平台风险",
      kind: "review",
      status: "review",
      metrics: ["商品结构", "Logo/材质", "平台风险"],
      iconName: "review",
      sourceId: "platform",
      edgeLabel: "质检",
    },
  };

  return fallback[item.id] ?? {
    title: item.title,
    caption: item.description,
    kind: "factory",
    status: "queued",
    metrics: ["可复用模板", "可连接资产", "可继续生成"],
    iconName: "ai",
    sourceId: "product",
    edgeLabel: "生成",
  };
}

function nextGeneratedPosition(index: number): CanvasWorkbenchNode["position"] {
  const slots = [
    { x: 310, y: 415 },
    { x: 610, y: 415 },
    { x: 900, y: 500 },
    { x: 310, y: 585 },
    { x: 610, y: 585 },
    { x: 900, y: 640 },
  ];
  return slots[index % slots.length];
}

function normalizeCanvasKind(kind?: CanvasComponentSuggestion["kind"]): CanvasWorkbenchNode["data"]["kind"] {
  if (kind === "asset" || kind === "factory" || kind === "output" || kind === "review") return kind;
  return "factory";
}

function normalizeCanvasStatus(
  status?: CanvasComponentSuggestion["status"]
): CanvasWorkbenchNode["data"]["status"] {
  if (status === "ready" || status === "running" || status === "queued" || status === "review") {
    return status;
  }
  return "queued";
}

function normalizeIconName(iconName?: CanvasComponentSuggestion["iconName"]): keyof typeof canvasIconMap {
  if (iconName && canvasIconMap[iconName]) return iconName;
  return "ai";
}

function normalizeMetrics(metrics?: string[]): string[] {
  const validMetrics = Array.isArray(metrics)
    ? metrics.filter((metric): metric is string => typeof metric === "string" && !!metric.trim())
    : [];
  return validMetrics.slice(0, 4).length > 0 ? validMetrics.slice(0, 4) : ["待配置", "可连接资产", "可继续生成"];
}

function getComponentCategory(type: string): CanvasLibraryCategory {
  if (type === "product" || type === "product_asset") return "商品";
  if (type === "model" || type === "model_asset") return "模特";
  if (
    type === "style" ||
    type === "visual_style" ||
    type === "brand_kit" ||
    type === "prompt" ||
    type === "prompt_source"
  ) {
    return "风格";
  }
  if (
    type === "copy" ||
    type === "copy_asset" ||
    type === "text" ||
    type === "text_asset" ||
    type === "claim" ||
    type === "copy_rules"
  ) {
    return "文案";
  }
  if (type === "scene") return "场景";
  if (type === "quality_rule") return "质检";
  return "平台";
}

function getComponentIconName(type: string): keyof typeof canvasIconMap {
  if (type === "product" || type === "product_asset") return "product";
  if (type === "model" || type === "model_asset") return "model";
  if (type === "style" || type === "visual_style" || type === "brand_kit" || type === "prompt_source") {
    return "style";
  }
  if (
    type === "copy" ||
    type === "copy_asset" ||
    type === "text" ||
    type === "text_asset" ||
    type === "claim" ||
    type === "copy_rules"
  ) {
    return "copy";
  }
  if (type === "scene") return "scene";
  if (type === "quality_rule") return "review";
  if (type === "output_pack" || type === "image_recipe") return "package";
  if (type === "platform_rule") return "platform";
  return "ai";
}

function getComponentNodeKind(type: string): CanvasWorkbenchNode["data"]["kind"] {
  if (type === "quality_rule") return "review";
  if (type === "output_pack" || type === "platform_rule") return "output";
  if (type === "prompt" || type === "prompt_source" || type === "image_recipe") return "factory";
  return "asset";
}

function getComponentNodeStatus(status: string): CanvasWorkbenchNode["data"]["status"] {
  if (status === "running") return "running";
  if (status === "review" || status === "checking") return "review";
  if (status === "draft" || status === "pending" || status === "queued") return "queued";
  return "ready";
}

function getComponentTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    product: "商品",
    product_asset: "商品",
    model: "模特",
    model_asset: "模特",
    style: "风格",
    visual_style: "风格",
    scene: "场景",
    platform_rule: "平台",
    output_pack: "图包",
    quality_rule: "质检",
    prompt: "Prompt",
    prompt_source: "Prompt",
    brand_kit: "品牌",
    image_recipe: "配方",
  };
  return labels[type] ?? "组件";
}

function getComponentStatusLabel(status: string): string {
  if (status === "ready" || status === "published") return "可用";
  if (status === "review" || status === "checking") return "待审";
  if (status === "archived") return "归档";
  return "草稿";
}

function hasExplicitCopyBurnInRequest(value: string): boolean {
  return /(烧进|带字|带文案|短文案|短标题|文案进图|直接出字|画面文字|图中文字|海报标题|封面标题|图片上写|写上|加字|burn[\s-]?in|in-image|render text)/i.test(value);
}

function extractAgentBurnInCopyText(value: string): string | undefined {
  if (!hasExplicitCopyBurnInRequest(value)) return undefined;
  const quoted = value.match(/[「『“"]([^」』”"]{1,32})[」』”"]/);
  if (quoted?.[1]?.trim()) return quoted[1].trim();

  const patterns = [
    /(?:文案烧进图|文案烧进|画面文字|图中文字|海报标题|封面标题|短标题|图片上写|写上|加字|烧字|带字|带文案|短文案)\s*[:：]\s*([^。.\n]{1,32})/i,
    /(?:burn[\s-]?in|render)\s+(?:short\s+)?(?:text|copy|words?)\s*[:：]?\s+([a-z0-9][a-z0-9\s'-]{1,36})$/i,
  ];
  const match = patterns.map((pattern) => value.match(pattern)).find(Boolean);
  return match?.[1]?.trim().replace(/[。.,，]+$/, "") || undefined;
}

function getComponentFallbackDescription(type: string): string {
  if (type === "brand_kit") return "品牌视觉、颜色、字体和禁用规则";
  if (type === "prompt" || type === "prompt_source") return "从外部 prompt 标准化得到的可复用规则";
  if (type === "image_recipe") return "定义单张图的目的、构图、尺寸和质量要求";
  if (type === "output_pack") return "一组面向平台或营销场景的输出规格";
  if (type === "quality_rule") return "用于检查商品一致性、平台合规和商业质量";
  return "可拖入画布并连接到生成流程";
}

function normalizeAssetPackDraft(
  payload: unknown,
  fallbackCategory: AssetPackCategory,
  fallbackRequest: string
): AssetPackDraft {
  const body = getRecordValue(payload);
  const draft = getRecordValue(
    body.assetPack ?? body.pack ?? body.draft ?? body.assetPackDraft ?? body
  );
  const category = normalizeAssetPackCategory(draft.category ?? draft.type, fallbackCategory);
  const referenceImages = normalizeAssetPackReferenceImages(
    draft.referenceImages ?? draft.references ?? draft.images
  );
  const parameters = getRecordValue(draft.parameters ?? draft.metadata);
  const invariants = getStringArray(draft.invariants ?? draft.identityLocks ?? draft.constraints);
  const allowedVariations = getStringArray(draft.allowedVariations ?? draft.variations);
  const negativeRules = getStringArray(draft.negativeRules ?? draft.forbiddenChanges);
  const qualityRules = getStringArray(draft.qualityRules ?? draft.qaChecklist);
  const promptFragments = getStringArray(draft.promptFragments ?? draft.promptBoundaries);
  const title =
    getStringValue(draft.title) ||
    `${getAssetPackCategoryLabel(category)} · ${fallbackRequest.slice(0, 18) || "新资产"}`;
  const providerUsablePrimaryReference =
    getStringValue(draft.providerUsablePrimaryReference) ||
    referenceImages.find((image) => image.providerUsable)?.url;

  return {
    id: getStringValue(draft.id),
    category,
    title,
    description:
      getStringValue(draft.description) ||
      getStringValue(draft.label) ||
      getAssetPackDefaultDescription(category, fallbackRequest),
    status: normalizeAssetPackStatus(draft.status),
    referenceImages,
    invariants,
    allowedVariations,
    negativeRules,
    qualityRules,
    promptFragments,
    parameters: {
      ...parameters,
      userRequest: getStringValue(draft.userRequest) || fallbackRequest,
      referenceImages,
      invariants,
      allowedVariations,
      providerUsablePrimaryReference,
    },
    providerUsablePrimaryReference,
  };
}

function normalizeAssetPackCategory(value: unknown, fallback: AssetPackCategory): AssetPackCategory {
  if (
    value === "product_asset" ||
    value === "model_asset" ||
    value === "scene_asset" ||
    value === "style_asset" ||
    value === "copy_asset"
  ) {
    return value;
  }
  if (value === "product") return "product_asset";
  if (value === "model") return "model_asset";
  if (value === "scene") return "scene_asset";
  if (value === "style" || value === "visual_style") return "style_asset";
  if (value === "copy" || value === "prompt_source" || value === "knowledge") return "copy_asset";
  return fallback;
}

function normalizeAssetPackStatus(value: unknown): AssetPackDraft["status"] {
  if (value === "ready") return "ready";
  if (value === "checking" || value === "review" || value === "needs_review") return "checking";
  return "draft";
}

function normalizeAssetPackReferenceImages(value: unknown): AssetPackReferenceImageDraft[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index): AssetPackReferenceImageDraft[] => {
    if (typeof item === "string" && item.trim()) {
      return [{
        title: `参考图 ${index + 1}`,
        url: item.trim(),
        providerUsable: isProviderUsableReferenceUrl(item.trim()),
      }];
    }
    if (!isPlainRecord(item)) return [];
    const url = getStringValue(item.url) || getStringValue(item.src);
    if (!url) return [];
    return [{
      title: getStringValue(item.title) || getStringValue(item.label) || `参考图 ${index + 1}`,
      url,
      role: getStringValue(item.role),
      providerUsable: item.providerUsable === true || isProviderUsableReferenceUrl(url),
    }];
  });
}

function getAssetPackCategoryLabel(category: AssetPackCategory): string {
  if (category === "product_asset") return "商品资产";
  if (category === "model_asset") return "模特资产";
  if (category === "scene_asset") return "场景资产";
  if (category === "copy_asset") return "文案资产";
  return "风格资产";
}

function getAssetPackReferenceRole(category: AssetPackCategory): string {
  if (category === "product_asset") return "product";
  if (category === "model_asset") return "model";
  if (category === "scene_asset") return "scene";
  if (category === "copy_asset") return "copy";
  return "style";
}

function getAssetPackReferenceUploadLabel(category: AssetPackCategory): string {
  if (category === "product_asset") return "商品参考图";
  if (category === "model_asset") return "模特参考图";
  if (category === "scene_asset") return "场景参考图";
  if (category === "copy_asset") return "文案参考";
  return "风格参考图";
}

function getAssetPackReferenceUploadHint(category: AssetPackCategory): string {
  if (category === "product_asset") {
    return "上传正面、侧面、背面、细节等多张商品图；系统会整理成白底多视角商品资产。";
  }
  if (category === "model_asset") {
    return "上传人物或模卡参考；系统会提取脸型、发型、年龄感、体态和可复用模特规则。";
  }
  if (category === "scene_asset") {
    return "上传空间或氛围参考；系统会提取布局、光线方向、材质、道具和可放置区域。";
  }
  if (category === "copy_asset") {
    return "直接输入画面文字、卖点参数、导出文案和禁止声明；默认不需要图片参考。";
  }
  return "上传你喜欢的摄影图；系统会提取色彩、光线、镜头、构图和商业摄影质感。";
}

function getAssetPackDefaultRequestFromReferences(category: AssetPackCategory): string {
  if (category === "product_asset") {
    return "根据上传的多张商品参考图，整理成一张干净白底多视角商品资产图，保持同一商品结构、材质、颜色和细节一致。";
  }
  if (category === "model_asset") {
    return "根据上传的参考图整理成可复用成年商业模特资产，保留脸型、发型、年龄感、体态和气质，使用柔和漫反射光，避免绑定具体商品或场景。";
  }
  if (category === "scene_asset") {
    return "根据上传的参考图整理成可复用商业场景资产，提取空间布局、光线方向、材质、道具、可放置区域和统一透视关系。";
  }
  if (category === "copy_asset") {
    return "整理一份可复用文案资产，拆分画面文字、卖点参数、导出文案和禁止声明，供 Agent 判断是否进图。";
  }
  return "根据上传的参考图整理成一张可复用视觉风格参考图，提取色彩、光线、镜头、构图、材质感和商业摄影质感，不绑定具体商品或人物。";
}

function getAssetPackDefaultDescription(category: AssetPackCategory, request: string): string {
  if (category === "product_asset") return `商品身份资产：${request}`;
  if (category === "model_asset") return `人物身份资产：${request}`;
  if (category === "scene_asset") return `商业场景资产：${request}`;
  if (category === "copy_asset") return request;
  return `统一视觉风格资产：${request}`;
}

function getAssetPackPrimaryReferenceUrl(draft: AssetPackDraft): string {
  return (
    draft.providerUsablePrimaryReference ||
    draft.referenceImages.find((image) => image.providerUsable)?.url ||
    draft.referenceImages[0]?.url ||
    ""
  );
}

function buildAssetPackMetadata(draft: AssetPackDraft): Record<string, unknown> {
  return {
    source: "asset-pack-generator",
    libraryScope: "global",
    savedByUser: true,
    componentType: mapAssetPackCategoryToComponentType(draft.category),
    canvasCategory: mapAssetPackCategoryToLibraryCategory(draft.category),
    assetPackId: draft.id,
    assetPackCategory: draft.category,
    label: getAssetPackCategoryLabel(draft.category),
    previewUrl: getAssetPackPrimaryReferenceUrl(draft),
    previewAlt: draft.title,
    referenceImages: draft.referenceImages,
    promptFragments: draft.promptFragments,
    constraints: draft.invariants,
    negativeRules: draft.negativeRules,
    qualityRules: draft.qualityRules,
    parameters: {
      ...draft.parameters,
      referenceImages: draft.referenceImages,
      invariants: draft.invariants,
      allowedVariations: draft.allowedVariations,
      providerUsablePrimaryReference: draft.providerUsablePrimaryReference,
    },
  };
}

function mapAssetPackCategoryToAssetType(category: AssetPackCategory): string {
  if (category === "product_asset") return "product";
  if (category === "model_asset") return "model";
  if (category === "scene_asset") return "scene";
  if (category === "copy_asset") return "copy";
  return "style";
}

function mapAssetPackCategoryToComponentType(category: AssetPackCategory): string {
  if (category === "scene_asset") return "scene";
  if (category === "style_asset") return "visual_style";
  if (category === "copy_asset") return "prompt_source";
  return category;
}

function mapAssetPackCategoryToLibraryCategory(category: AssetPackCategory): CanvasLibraryCategory {
  if (category === "product_asset") return "商品";
  if (category === "model_asset") return "模特";
  if (category === "scene_asset") return "场景";
  if (category === "copy_asset") return "文案";
  return "风格";
}

function mapCanvasLibraryCategoryToAssetType(category: CanvasLibraryCategory): string {
  if (category === "商品") return "product";
  if (category === "模特") return "model";
  if (category === "风格") return "style";
  if (category === "场景") return "scene";
  if (category === "文案") return "copy";
  if (category === "平台") return "platform";
  if (category === "质检") return "quality";
  return "output";
}

function getComponentNodeMetrics(component: PersistedComponent): string[] {
  const metadataMetrics = getStringArray(component.metadata?.metrics);
  const ruleMetrics = getStringArray(component.rules?.metrics);
  const tags = getStringArray(component.metadata?.tags);
  const compatibleWith = getStringArray(component.metadata?.compatibleWith);
  const promptFragments = getStringArray(component.metadata?.promptFragments);
  const qualityRules = getStringArray(component.metadata?.qualityRules);
  const constraints = getStringArray(component.metadata?.constraints);
  const fields = [
    getComponentTypeLabel(component.type),
    ...metadataMetrics,
    ...ruleMetrics,
    ...tags,
    compatibleWith.length > 0 ? `兼容 ${compatibleWith.length}` : "",
    promptFragments.length > 0 ? `Prompt ${promptFragments.length}` : "",
    qualityRules.length > 0 ? `质检 ${qualityRules.length}` : "",
    constraints.length > 0 ? `约束 ${constraints.length}` : "",
    component.assetId ? "关联资产" : "",
    `v${component.version}`,
  ].filter(Boolean);

  return Array.from(new Set(fields)).slice(0, 4);
}

function getComponentLibraryChips(component: PersistedComponent): string[] {
  const compatibleWith = getStringArray(component.metadata?.compatibleWith);
  const promptFragments = getStringArray(component.metadata?.promptFragments);
  const qualityRules = getStringArray(component.metadata?.qualityRules);
  const constraints = getStringArray(component.metadata?.constraints);
  const source = getComponentSourceKind(component.metadata?.source);
  const chips = [
    `v${component.version}`,
    source ? getComponentSourceLabel(source) : "",
    compatibleWith.length > 0 ? `兼容 ${compatibleWith.length}` : "",
    promptFragments.length > 0 ? `Prompt ${promptFragments.length}` : "",
    constraints.length > 0 ? `约束 ${constraints.length}` : "",
    qualityRules.length > 0 ? `质检 ${qualityRules.length}` : "",
    getComponentStatusLabel(component.status),
  ].filter(Boolean);

  return Array.from(new Set(chips)).slice(0, 6);
}

function getComponentSourceKind(source: unknown): string | undefined {
  if (!source || typeof source !== "object" || Array.isArray(source)) return undefined;
  const kind = (source as { kind?: unknown }).kind;
  return typeof kind === "string" && kind.trim() ? kind : undefined;
}

function getComponentSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    manual: "手动",
    upload: "上传",
    ai_import: "AI 导入",
    template: "模板",
    generated: "生成",
    legacy: "旧组件",
  };
  return labels[source] ?? source;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && !!item.trim());
}

function getOptionalRecordString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

type FocusedBatchImageTone = "ready" | "failed" | "missing" | "pending";
type BatchImageReferenceProductState = "provider" | "prompt" | "none";
type FocusedBatchRunTone = "ready" | "failed" | "manual" | "pending";

interface BatchImageReferenceSummary {
  roleLabels: string[];
  imageCount: number;
  providerImageCount: number;
  ruleCount: number;
  productState: BatchImageReferenceProductState;
  primaryProductReferenceUrl?: string;
}

interface FocusedBatchImageItem {
  jobId: string;
  title: string;
  sizeLabel: string;
  previewUrl?: string;
  statusLabel: string;
  tone: FocusedBatchImageTone;
  reason: string;
  icon: typeof ImageIcon;
  referenceSummary: BatchImageReferenceSummary;
  diagnosticSummary?: string;
  job?: PersistedGenerationJob;
}

interface FocusedBatchRunSummary {
  providerLabel: string;
  modelLabel: string;
  callLabel: string;
  retryLabel: string;
  referenceLabel: string;
  resultLabel: string;
  queueLabel: string;
  qaLabel: string;
  zipLabel: string;
  statusLabel: string;
  tone: FocusedBatchRunTone;
  issues: string[];
  diagnostics: string[];
}

function buildFocusedBatchRunSummary({
  batch,
  jobs,
  manifest,
  projectBatch,
  qaReport,
}: {
  batch: ExportPackBatchSummary;
  jobs: PersistedGenerationJob[];
  manifest?: ExportPackManifest;
  projectBatch?: PersistedProjectBatch;
  qaReport?: ExportPackQaReport;
}): FocusedBatchRunSummary {
  const batchJobs = jobs.filter((job) => getStringValue(job.metadata.batchId) === batch.batchId);
  const metadataList = [
    ...(projectBatch ? [projectBatch.metadata] : []),
    ...batchJobs.map((job) => job.metadata),
  ];
  const estimate = getRecordValue(projectBatch?.metadata.estimate);
  const provider = getFirstMetadataString(metadataList, "provider") ?? "provider 未记录";
  const model = getFirstMetadataString(metadataList, "model") ?? "model 未记录";
  const providerCallCount = getOptionalNumberValue(estimate.providerCallCount);
  const maxProviderCallCount = getOptionalNumberValue(estimate.maxProviderCallCount);
  const providerCallCountUsed =
    getOptionalNumberValue(estimate.providerCallCountUsed) ?? providerCallCount;
  const retryCount =
    getOptionalNumberValue(estimate.retryCount) ??
    batchJobs.reduce((sum, job) => sum + getNumberValue(job.metadata.retryCount, 0), 0);
  const usesProductReference =
    estimate.usesProductReference === true ||
    metadataList.some((metadata) => {
      const summary = getBatchImageReferenceSummary(metadata);
      return summary.productState === "provider";
    });
  const referenceBytes = getOptionalNumberValue(estimate.referenceImageBytes);
  const referenceLabel = usesProductReference
    ? referenceBytes
      ? `商品参考 ${formatByteCount(referenceBytes)}`
      : "商品参考已接入"
    : "无商品参考";
  const queueCount = batch.pending + batch.queuedRunning;
  const qaCounts = qaReport?.counts;
  const tone = getFocusedBatchRunTone(batch, qaReport);
  const statusLabel = getFocusedBatchRunStatusLabel(tone, qaReport);
  const diagnostics = dedupeStrings(
    batchJobs.map((job) => getProviderDiagnosticSummary(job.metadata))
  );
  const issues = dedupeStrings(
    batchJobs
      .filter((job) => job.status === "failed" || job.error)
      .map((job) => job.error || getProviderDiagnosticSummary(job.metadata) || getJobStatusCaption(job))
  );

  return {
    providerLabel: provider,
    modelLabel: model,
    callLabel:
      providerCallCountUsed || providerCallCount || maxProviderCallCount
        ? `${providerCallCountUsed ?? providerCallCount ?? 0}/${maxProviderCallCount ?? providerCallCount ?? providerCallCountUsed ?? 0}`
        : "待确认",
    retryLabel: `${retryCount ?? 0}`,
    referenceLabel,
    resultLabel: `${manifest?.counts.completed ?? batch.completed}/${batch.total} 完成`,
    queueLabel: queueCount > 0 ? `${queueCount} 待处理` : batch.failed > 0 ? `${batch.failed} 失败` : "清空",
    qaLabel: qaCounts ? `${qaCounts.passed}/${qaCounts.total} 通过` : "待 QA",
    zipLabel:
      qaReport?.status === "pass" && (qaCounts?.passed ?? 0) > 0
        ? "过审 ZIP 就绪"
        : qaReport?.status === "manual"
          ? "待人工复核"
          : qaReport?.status === "fail"
            ? "QA 未通过"
            : "待产物",
    statusLabel,
    tone,
    issues,
    diagnostics,
  };
}

function buildFocusedBatchImageItems({
  manifest,
  qaReport,
  jobs,
  imageInfoByUrl,
}: {
  manifest?: ExportPackManifest;
  qaReport?: ExportPackQaReport;
  jobs: PersistedGenerationJob[];
  imageInfoByUrl: Record<string, ExportPackImageInfo>;
}): FocusedBatchImageItem[] {
  if (!manifest) return [];

  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const qaItemByJobId = new Map((qaReport?.items ?? []).map((item) => [item.jobId, item]));

  return manifest.items.map((item) => {
    const job = jobById.get(item.jobId);
    const qaItem = qaItemByJobId.get(item.jobId);
    const imageInfo = item.artifact?.url ? imageInfoByUrl[item.artifact.url] : undefined;
    const tone = getFocusedBatchImageTone(item, qaItem, imageInfo);
    const isReady = tone === "ready";
    const title = item.title || (job ? getJobNodeLabel(job) : "导出包图片");
    const diagnosticSummary = job ? getProviderDiagnosticSummary(job.metadata) : undefined;

    return {
      jobId: item.jobId,
      title,
      sizeLabel: [item.size, item.ratio].filter(Boolean).join(" · "),
      previewUrl: isReady ? item.artifact?.url : undefined,
      statusLabel: getFocusedBatchImageStatusLabel(tone, item.status),
      tone,
      reason: getFocusedBatchImageReason({ item, qaItem, job, imageInfo, tone }),
      icon: ImageIcon,
      referenceSummary: getBatchImageReferenceSummary(job?.metadata),
      diagnosticSummary,
      job,
    };
  });
}

function getBatchImageReferenceSummary(
  metadata: Record<string, unknown> | undefined
): BatchImageReferenceSummary {
  const context = normalizeGenerationReferenceContext(metadata?.referenceContext);
  const images = dedupeReferenceImages([
    ...(context?.images ?? []),
    ...getReferenceImagesFromMetadata(metadata?.referenceImages),
  ]);
  const roles = generationFrameRoles
    .filter((role) => context?.roles[role]);
  const fallbackRoles = roles.length > 0
    ? roles
    : Array.from(new Set(images.map((image) => image.role)));
  const productImages = images.filter((image) => image.role === "product");
  const providerImages = images.filter((image) => image.providerUsable);
  const providerProductImages = productImages.filter((image) => image.providerUsable);
  const primaryProductReferenceUrl = providerProductImages[0]?.url;
  const ruleCount = [
    ...(context?.promptFragments ?? []),
    ...(context?.constraints ?? []),
    ...(context?.negativeRules ?? []),
    ...(context?.qualityRules ?? []),
  ].length;

  return {
    roleLabels: fallbackRoles.map((role) => getGenerationReferenceRoleLabel(role)),
    imageCount: images.length,
    providerImageCount: providerImages.length,
    ruleCount,
    productState: primaryProductReferenceUrl || providerProductImages.length > 0
      ? "provider"
      : productImages.length > 0
        ? "prompt"
        : "none",
    primaryProductReferenceUrl,
  };
}

function getReferenceImagesFromMetadata(value: unknown): GenerationReferenceImage[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): GenerationReferenceImage[] => {
    if (!isPlainRecord(item)) return [];
    const role = getGenerationReferenceRole(item.role);
    const url = getStringValue(item.url);
    if (!role || !url) return [];

    return [{
      role,
      url,
      title: getStringValue(item.title) || getGenerationReferenceRoleLabel(role),
      providerUsable: item.providerUsable === true || isProviderUsableReferenceUrl(url),
      source: getStringValue(item.source),
      nodeId: getStringValue(item.nodeId),
      assetId: getStringValue(item.assetId),
      componentId: getStringValue(item.componentId),
    }];
  });
}

function getGenerationReferenceRole(value: unknown): GenerationReferenceRole | undefined {
  if (value === "product" || value === "model" || value === "style" || value === "scene" || value === "copy") {
    return value;
  }
  return undefined;
}

function getFocusedBatchImageTone(
  item: ExportPackManifest["items"][number],
  qaItem: ExportPackQaReport["items"][number] | undefined,
  imageInfo: ExportPackImageInfo | undefined
): FocusedBatchImageTone {
  if (qaItem?.artifactStatus === "failed" || item.status === "failed" || item.artifact?.status === "failed") {
    return "failed";
  }
  if (qaItem?.artifactStatus === "missing" || (isCompletedJobStatus(item.status) && !item.artifact?.url)) {
    return "missing";
  }
  if (qaItem?.artifactStatus === "ready" && item.artifact?.url && imageInfo?.exists !== false) {
    return "ready";
  }
  if (item.artifact?.url && isCompletedJobStatus(item.status) && imageInfo?.exists !== false) {
    return "ready";
  }
  return "pending";
}

function getFocusedBatchImageStatusLabel(tone: FocusedBatchImageTone, status: string): string {
  if (tone === "ready") return "已出图";
  if (tone === "failed") return "失败";
  if (tone === "missing") return "缺图";
  if (status === "running") return "生成中";
  if (status === "queued" || status === "pending") return "等待";
  return jobStatusLabel[status] ?? "等待";
}

function getFocusedBatchImageStatusClassName(tone: FocusedBatchImageTone): string {
  if (tone === "ready") return "bg-emerald-50 text-emerald-700";
  if (tone === "failed") return "bg-red-50 text-red-700";
  if (tone === "missing") return "bg-amber-50 text-amber-700";
  return "bg-warm-paper text-warm-muted";
}

function getFocusedBatchImageReason({
  item,
  qaItem,
  job,
  imageInfo,
  tone,
}: {
  item: ExportPackManifest["items"][number];
  qaItem?: ExportPackQaReport["items"][number];
  job?: PersistedGenerationJob;
  imageInfo?: ExportPackImageInfo;
  tone: FocusedBatchImageTone;
}): string {
  const artifactCheck = qaItem?.checks.find((check) => check.id === "artifact");
  const diagnosticSummary = job ? getProviderDiagnosticSummary(job.metadata) : undefined;
  const jobError = getStringValue(job?.error);
  const statusCaption = job ? getJobStatusCaption(job) : undefined;

  if (tone === "ready") {
    const dimensions = imageInfo?.width && imageInfo.height ? `${imageInfo.width}x${imageInfo.height}` : "";
    return [item.naming, dimensions, "可用于 QA"].filter(Boolean).join(" · ");
  }

  if (tone === "failed") {
    return jobError || diagnosticSummary || statusCaption || artifactCheck?.message || "生成失败，可重试";
  }

  if (tone === "missing") {
    return jobError || diagnosticSummary || artifactCheck?.message || "任务已完成但没有找到图片产物";
  }

  return statusCaption || artifactCheck?.message || "等待生成完成后回填图片";
}

function getProviderDiagnosticSummary(metadata: Record<string, unknown>): string | undefined {
  const diagnostics = metadata.providerDiagnostics;
  if (!isPlainRecord(diagnostics)) return undefined;
  const explicitSummary = getStringValue(diagnostics.summary);
  if (explicitSummary) return explicitSummary;

  const code = getStringValue(diagnostics.code);
  const endpoint = getStringValue(diagnostics.endpoint);
  const providerHost = getStringValue(diagnostics.providerHost);
  const responseShape = isPlainRecord(diagnostics.responseShape)
    ? diagnostics.responseShape
    : undefined;
  const dataLength = getNumberValue(responseShape?.dataLength, -1);
  const dataLabel = dataLength >= 0 ? `data ${dataLength}` : getStringValue(responseShape?.dataType);
  const firstKeys = getStringArray(responseShape?.firstDataKeys).join("/");
  const parts = [
    code,
    endpoint,
    providerHost,
    dataLabel,
    firstKeys ? `keys ${firstKeys}` : "",
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function isCompletedJobStatus(status?: string): boolean {
  return status === "done" || status === "completed";
}

function mapAssetCategoryToNodeKind(category: CanvasLibraryCategory): CanvasWorkbenchNode["data"]["kind"] {
  if (category === "平台") return "output";
  if (category === "质检") return "review";
  return "asset";
}

function mapAssetCategoryToComponentType(category: CanvasLibraryCategory): string {
  if (category === "商品") return "product";
  if (category === "模特") return "model";
  if (category === "风格") return "style";
  if (category === "场景") return "scene";
  if (category === "文案") return "copy";
  if (category === "平台") return "platform_rule";
  if (category === "质检") return "quality_rule";
  return "product";
}

function mapAssetToNodeStatus(status: CanvasAsset["status"]): CanvasWorkbenchNode["data"]["status"] {
  if (status === "checking") return "review";
  if (status === "draft") return "queued";
  return "ready";
}

function getJobNodeLabel(job: PersistedGenerationJob): string {
  const batchTitle = job.metadata.batchJobTitle;
  if (typeof batchTitle === "string" && batchTitle.trim()) return batchTitle;
  const label = job.metadata.nodeLabel;
  if (typeof label === "string" && label.trim()) return label;
  return job.nodeId ? `节点 ${job.nodeId}` : "画布任务";
}

function canRunJob(job: PersistedGenerationJob): boolean {
  return job.status === "pending";
}

function canCancelJob(job: PersistedGenerationJob): boolean {
  return job.status === "pending" || job.status === "queued" || job.status === "running";
}

function canRetryJob(job: PersistedGenerationJob): boolean {
  return job.status === "failed" || job.status === "cancelled";
}

function canRetryImageJob(job: PersistedGenerationJob): boolean {
  const source = typeof job.metadata.source === "string" ? job.metadata.source : "";
  const isBatchImageSource = source === "batch-image-api" || source === "batch-image-api-retry";
  if (!isBatchImageSource) return false;
  return job.status === "failed" ||
    job.status === "cancelled" ||
    job.status === "done" ||
    job.status === "completed";
}

function canRerunImageJob(job: PersistedGenerationJob): boolean {
  return (job.status === "done" || job.status === "completed") &&
    !!job.prompt.trim() &&
    !!job.resultUrl.trim();
}

function canArchiveExportPackBatchJobs(batch: ExportPackBatchSummary): boolean {
  if (batch.batchState?.locked || batch.batchState?.delivered) return false;
  return batch.pending + batch.queuedRunning > 0;
}

function isActiveBackgroundJob(job: PersistedGenerationJob): boolean {
  if (job.status === "running") return true;
  if (job.status !== "pending" && job.status !== "queued") return false;
  return typeof job.metadata.startedAt === "string" || typeof job.metadata.queuedAt === "string";
}

function getJobStatusCaption(job: PersistedGenerationJob): string {
  const batchCaption = job.metadata.batchCaption;
  if (typeof batchCaption === "string" && batchCaption.trim()) {
    return batchCaption;
  }
  if (job.status === "done" || job.status === "completed") return "结果已保存为输出资产";
  if (job.status === "failed") return job.error || "任务失败，可重试";
  if (job.status === "cancelled") return "任务已取消，可重试";
  if (job.status === "running") return "正在生成中";
  if (job.status === "queued") return "任务已排队";
  return formatJobTime(job.createdAt);
}

function getBatchSizeSummary(batch: ExportPackBatchSummary): string {
  if (batch.sizes.length === 0) return "尺寸待定";
  if (batch.sizes.length <= 2) return batch.sizes.join(" / ");
  return `${batch.sizes.slice(0, 2).join(" / ")} +${batch.sizes.length - 2}`;
}

function getBatchQueueSummary(batch: ExportPackBatchSummary): string {
  const queueCount = batch.pending + batch.queuedRunning;
  if (queueCount > 0) return `${queueCount} pending/排队`;
  if (batch.failed > 0) return `${batch.failed} 失败`;
  if (batch.cancelled > 0) return `${batch.cancelled} 已取消`;
  return "无待处理";
}

function getFocusedBatchRunTone(
  batch: ExportPackBatchSummary,
  qaReport?: ExportPackQaReport
): FocusedBatchRunTone {
  if (batch.failed > 0 || qaReport?.status === "fail") return "failed";
  if (qaReport?.status === "pass") return "ready";
  if (qaReport?.status === "manual") return "manual";
  return "pending";
}

function getFocusedBatchRunStatusLabel(
  tone: FocusedBatchRunTone,
  qaReport?: ExportPackQaReport
): string {
  if (tone === "ready") return "可交付";
  if (tone === "failed") return "需处理";
  if (tone === "manual") return "待复核";
  if (qaReport?.counts.pendingArtifact) return "待产物";
  return "生成中";
}

function getFocusedBatchRunToneClassName(tone: FocusedBatchRunTone): string {
  if (tone === "ready") return "bg-emerald-50 text-emerald-700";
  if (tone === "failed") return "bg-red-50 text-red-700";
  if (tone === "manual") return "bg-blue-50 text-blue-700";
  return "bg-amber-50 text-amber-700";
}

function getFirstMetadataString(
  metadataList: Array<Record<string, unknown>>,
  key: string
): string | undefined {
  for (const metadata of metadataList) {
    const value = getStringValue(metadata[key]);
    if (value) return value;
  }
  return undefined;
}

function formatByteCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0B";
  if (value < 1024) return `${Math.round(value)}B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

function getBatchArchiveCleanupLabel(metadata?: Record<string, unknown>): string | undefined {
  if (!metadata) return undefined;
  const archivedAt = typeof metadata.archivedAt === "string" ? metadata.archivedAt : "";
  const cleanup = isPlainRecord(metadata.archiveCleanup) ? metadata.archiveCleanup : undefined;
  if (!archivedAt && !cleanup) return undefined;

  const cancelledCount = getNumberValue(cleanup?.cancelledCount, 0);
  const skippedCount = getNumberValue(cleanup?.skippedCount, 0);
  return `已归档 · 取消 ${cancelledCount} 个未完成 jobs · 保留 ${skippedCount} 个记录`;
}

function getBatchPartialResultLabel(metadata?: Record<string, unknown>): string | undefined {
  if (!metadata || metadata.partialResult !== true) return undefined;
  const successCount = getNumberValue(metadata.successCount, 0);
  const failedCount = getNumberValue(metadata.failedCount, 0);
  return `部分完成 · 已保存 ${successCount} 张 · ${failedCount} 张需单项重试`;
}

function getManifestSummaryLabel(
  batch: ExportPackBatchSummary,
  manifest?: ExportPackManifest
): string {
  if (!manifest) return `${batch.total} planned`;
  const total = manifest.items.length || batch.total;
  if (manifest.counts.completed > 0 || manifest.counts.missingArtifact > 0) {
    return `Manifest ${manifest.counts.completed}/${total} ready`;
  }
  if (manifest.counts.failed > 0) return `Manifest ${manifest.counts.failed} failed`;
  return `${manifest.counts.planned || total} planned`;
}

function getQaCardLabel(
  batch: ExportPackBatchSummary,
  qaReport?: ExportPackQaReport
): string {
  if (!qaReport) {
    const pending = batch.pending + batch.queuedRunning;
    if (batch.failed > 0) return "QA 有失败";
    if (pending > 0) return "QA 待生成";
    return "QA 待产物";
  }
  return qaReport.summaryLabel;
}

function getQaCardClassName(qaReport?: ExportPackQaReport): string {
  if (!qaReport) return "bg-warm-paper text-warm-muted";
  if (qaReport.status === "fail") return "bg-red-50 text-red-700";
  if (qaReport.status === "pending") return "bg-amber-50 text-amber-700";
  if (qaReport.status === "manual") return "bg-blue-50 text-blue-700";
  return "bg-emerald-50 text-emerald-700";
}

function getQaStatusClassName(status: string): string {
  if (status === "pass") return "bg-emerald-50 text-emerald-700";
  if (status === "fail") return "bg-red-50 text-red-700";
  if (status === "pending") return "bg-amber-50 text-amber-700";
  if (status === "manual") return "bg-blue-50 text-blue-700";
  return "bg-warm-paper text-warm-muted";
}

function getQaStatusLabel(status: string): string {
  if (status === "pass") return "通过";
  if (status === "fail") return "不通过";
  if (status === "pending") return "待检查";
  if (status === "manual") return "待复核";
  return status;
}

function normalizeArtifactReviewStatus(value: unknown): ArtifactReviewStatus | null {
  if (
    value === "approved" ||
    value === "pending" ||
    value === "needs_redo" ||
    value === "rejected" ||
    value === "failed"
  ) {
    return value;
  }
  return null;
}

function getOutputPreviewReviewStatus(
  metadata: Record<string, unknown>,
  outputStatus?: string
): ArtifactReviewStatus {
  const reviewState = getRecordValue(metadata.reviewState);
  const reviewStatus = normalizeArtifactReviewStatus(reviewState.status);
  if (reviewStatus) return reviewStatus;
  const normalizedOutputStatus = (outputStatus || "").toLowerCase();
  if (
    normalizedOutputStatus === "failed" ||
    normalizedOutputStatus === "error" ||
    normalizedOutputStatus === "cancelled" ||
    Boolean(metadata.error)
  ) {
    return "failed";
  }
  return "pending";
}

function getOutputPreviewVisualQaSummary({
  item,
  artifacts,
}: {
  item?: GenerationOutputPreviewItem;
  artifacts: PersistedGeneratedArtifact[];
}): OutputPreviewVisualQaSummary | undefined {
  if (!item) return undefined;
  const artifact =
    (item.artifactId ? artifacts.find((candidate) => candidate.id === item.artifactId) : undefined) ??
    (item.jobId ? artifacts.find((candidate) => candidate.jobId === item.jobId) : undefined);
  const source: PersistedGeneratedArtifact = artifact ?? {
    id: item.artifactId || item.outputId || item.jobId || "preview",
    workflowId: undefined,
    nodeId: item.nodeId,
    jobId: item.jobId,
    assetId: undefined,
    type: getStringValue(item.metadata?.imageType) || getStringValue(item.metadata?.planItemType) || "preview",
    title: item.title,
    status: item.status || "done",
    url: item.url,
    prompt: item.prompt || getStringValue(item.metadata?.prompt) || "",
    provider: item.provider || getStringValue(item.metadata?.provider) || "",
    model: item.model || getStringValue(item.metadata?.model) || "",
    metadata: item.metadata ?? {},
    createdAt: "",
    updatedAt: "",
  };
  const qa = getArtifactVisualQaSummary(source);
  return {
    status: qa.status,
    label: qa.label,
    issues: qa.issues,
  };
}

function getBatchStateLabel(state?: string): string {
  if (state === "draft") return "草稿";
  if (state === "generated") return "已生成";
  if (state === "in_review") return "复核中";
  if (state === "reviewed") return "已复核";
  if (state === "locked") return "已锁定";
  if (state === "delivered") return "已交付";
  return "未归属";
}

function getBatchStateClassName(state?: string): string {
  if (state === "delivered") return "bg-emerald-50 text-emerald-700";
  if (state === "locked") return "bg-zinc-100 text-zinc-700";
  if (state === "reviewed") return "bg-blue-50 text-blue-700";
  if (state === "in_review") return "bg-amber-50 text-amber-700";
  if (state === "generated") return "bg-warm-paper text-warm-ink";
  return "bg-warm-paper text-warm-muted";
}

function buildReviewSessionPayloadFromBatch(
  batch: ExportPackBatchSummary,
  manifest: ExportPackManifest,
  qaReport: ExportPackQaReport
) {
  const qaByJobId = new Map(qaReport.items.map((item) => [item.jobId, item]));
  return {
    title: `${batch.title} 审核`,
    items: manifest.items.map((item) => {
      const qaItem = qaByJobId.get(item.jobId);
      return {
        id: item.jobId,
        title: item.title,
        imageUrl: item.artifact?.url || "/canvas-assets/product-main.svg",
        status: mapQaStatusToReviewItemStatus(qaItem?.status),
        sourceId: item.jobId,
        metadata: {
          batchId: batch.batchId,
          projectId: batch.batchState?.projectId,
          campaignId: batch.batchState?.campaignId,
          naming: item.naming,
          size: item.size,
          ratio: item.ratio,
          specId: item.specId,
          artifactId: item.artifact?.artifactId,
        },
      };
    }),
    qualityChecks: qaReport.items.flatMap((item) =>
      item.checks.map((check) => ({
        id: `${item.jobId}:${check.id}`,
        itemId: item.jobId,
        label: check.label,
        status: mapQaStatusToReviewCheckStatus(check.status),
        message: check.message,
        severity: check.status === "fail" ? "high" : check.status === "manual" ? "medium" : "low",
        metadata: {
          checkId: check.id,
          expected: check.expected,
          actual: check.actual,
        },
      }))
    ),
    notes: [`Created from export pack ${batch.batchId}`],
    metadata: {
      source: "export_pack",
      batchId: batch.batchId,
      projectId: batch.batchState?.projectId,
      campaignId: batch.batchState?.campaignId,
      platform: batch.platform,
      manifestCounts: manifest.counts,
    },
  };
}

function buildDemoReviewSessionPayload() {
  return {
    title: "Demo 审核工作台",
    items: [
      {
        id: "demo-main",
        title: "商品主图 · 白底",
        imageUrl: "/canvas-assets/product-main.svg",
        status: "pending",
        sourceId: "demo-main",
      },
      {
        id: "demo-detail",
        title: "详情页卖点图",
        imageUrl: "/canvas-assets/product-detail.svg",
        status: "pending",
        sourceId: "demo-detail",
      },
      {
        id: "demo-lifestyle",
        title: "场景海报图",
        imageUrl: "/canvas-assets/scene-cafe.svg",
        status: "needs_revision",
        sourceId: "demo-lifestyle",
      },
    ],
    qualityChecks: [
      {
        id: "demo-main-size",
        itemId: "demo-main",
        label: "尺寸检查",
        status: "pass",
        message: "主图尺寸满足平台要求",
      },
      {
        id: "demo-detail-copy",
        itemId: "demo-detail",
        label: "文字合规",
        status: "manual",
        message: "详情文案需要人工确认",
        severity: "medium",
      },
      {
        id: "demo-lifestyle-quality",
        itemId: "demo-lifestyle",
        label: "商业质感",
        status: "warn",
        message: "场景图需要复核商品质感",
        severity: "medium",
      },
    ],
    notes: ["Demo session created from canvas reviewer workspace."],
    metadata: {
      source: "canvas_demo",
      smokeSafe: true,
    },
  };
}

function mapQaStatusToReviewItemStatus(status?: string): ReviewSessionItemStatus {
  if (status === "pass") return "approved";
  if (status === "fail") return "rejected";
  if (status === "manual") return "needs_revision";
  return "pending";
}

function mapQaStatusToReviewCheckStatus(status?: string): ReviewQualityCheckStatus {
  if (status === "pass" || status === "fail" || status === "manual" || status === "pending") {
    return status;
  }
  return "pending";
}

function getReviewCounterLabel(session: ReviewSessionSummary): string {
  const counts = session.statusCounters;
  return `${counts.approved} 通过 / ${counts.needsRevision} 需改 / ${counts.rejected} 打回 / ${counts.pending} 待审`;
}

function getReviewActionMessage(action: UpdateReviewSessionInput["action"]): string {
  if (action === "approve_item") return "已标记通过";
  if (action === "reject_item") return "已打回";
  if (action === "request_revision") return "已标记需修改";
  return "备注已保存";
}

function getReviewSessionStatusLabel(status: ReviewSessionStatus): string {
  if (status === "approved") return "已通过";
  if (status === "rejected") return "有打回";
  if (status === "needs_revision") return "需修改";
  if (status === "in_review") return "审核中";
  return "待审核";
}

function getReviewSessionStatusClassName(status: ReviewSessionStatus): string {
  if (status === "approved") return "bg-emerald-50 text-emerald-700";
  if (status === "rejected") return "bg-red-50 text-red-700";
  if (status === "needs_revision") return "bg-amber-50 text-amber-700";
  if (status === "in_review") return "bg-blue-50 text-blue-700";
  return "bg-warm-paper text-warm-muted";
}

function getReviewItemStatusLabel(status: ReviewSessionItemStatus): string {
  if (status === "approved") return "通过";
  if (status === "rejected") return "打回";
  if (status === "needs_revision") return "需改";
  return "待审";
}

function getReviewItemStatusClassName(status: ReviewSessionItemStatus): string {
  if (status === "approved") return "bg-emerald-50 text-emerald-700";
  if (status === "rejected") return "bg-red-50 text-red-700";
  if (status === "needs_revision") return "bg-amber-50 text-amber-700";
  return "bg-warm-paper text-warm-muted";
}

function getProviderReadyLabel(provider: ProviderReadiness | null): string {
  if (!provider) return "未读取";
  if (provider.hasImageKey || provider.hasKey) return "已配置";
  return "缺少 key";
}

function getProviderReadyClassName(provider: ProviderReadiness | null): string {
  if (!provider) return "text-warm-muted";
  if (provider.hasImageKey || provider.hasKey) return "text-emerald-700";
  return "text-red-700";
}

function ReferenceContextMiniPanel({ context }: { context: GenerationReferenceContext }) {
  const roles = generationFrameRoles
    .map((role) => context.roles[role])
    .filter((role): role is GenerationReferenceRoleContext => Boolean(role));
  const productImages = context.images.filter((image) => image.role === "product");
  const providerProductImages = productImages.filter((image) => image.providerUsable);
  const visibleImages = context.images.slice(0, 3);
  const ruleCount =
    context.promptFragments.length +
    context.constraints.length +
    context.negativeRules.length +
    context.qualityRules.length;

  return (
    <div className="mt-3 rounded-md border border-warm-line/50 bg-warm-paper p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-warm-ink">生成引用</span>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
            providerProductImages.length > 0
              ? "bg-emerald-50 text-emerald-700"
              : productImages.length > 0
                ? "bg-amber-50 text-amber-700"
                : "bg-warm-bg text-warm-muted"
          )}
        >
          {providerProductImages.length > 0
            ? "商品图可用"
            : productImages.length > 0
              ? "仅规则引用"
              : "无商品图"}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <ReferenceMetric label="角色" value={roles.length} />
        <ReferenceMetric label="图片" value={context.images.length} />
        <ReferenceMetric label="规则" value={ruleCount} />
      </div>
      {roles.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {roles.map((role) => (
            <span
              key={role.role}
              className="max-w-full truncate rounded bg-warm-bg px-1.5 py-0.5 text-[10px] text-warm-muted"
            >
              {getGenerationReferenceRoleLabel(role.role)} · {role.title}
            </span>
          ))}
        </div>
      )}
      {visibleImages.length > 0 && (
        <div className="mt-2 space-y-1">
          {visibleImages.map((image, index) => (
            <div
              key={`${image.role}:${image.url}:${index}`}
              className="flex items-center justify-between gap-2 text-[11px]"
            >
              <span className="min-w-0 truncate text-warm-muted">
                {getGenerationReferenceRoleLabel(image.role)} · {image.title}
              </span>
              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px]", getReferenceImageUsabilityClassName(image))}>
                {image.providerUsable ? "provider" : "prompt"}
              </span>
            </div>
          ))}
        </div>
      )}
      {productImages.length > 0 && providerProductImages.length === 0 && (
        <p className="mt-2 text-[11px] leading-4 text-warm-muted">
          当前商品图会进入提示词和约束；只有本地生成图或 inline 图片会进入图生图 provider。
        </p>
      )}
    </div>
  );
}

function ReferenceMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded border border-warm-line/40 bg-warm-bg px-2 py-1.5">
      <span className="block truncate text-[10px] text-warm-muted">{label}</span>
      <span className="mt-0.5 block text-xs font-medium text-warm-ink">{value}</span>
    </div>
  );
}

function getGenerationReferenceRoleLabel(role: GenerationReferenceRole): string {
  if (role === "product") return "商品";
  if (role === "model") return "模特";
  if (role === "style") return "风格";
  if (role === "copy") return "文案";
  return "场景";
}

function getReferenceImageUsabilityClassName(image: GenerationReferenceImage): string {
  return image.providerUsable
    ? "bg-emerald-50 text-emerald-700"
    : "bg-warm-bg text-warm-muted";
}

function BatchImageReferenceStrip({
  summary,
  diagnosticSummary,
  tone,
}: {
  summary: BatchImageReferenceSummary;
  diagnosticSummary?: string;
  tone: FocusedBatchImageTone;
}) {
  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-warm-line/40 bg-warm-bg px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", getBatchReferenceProductClassName(summary.productState))}>
          {getBatchReferenceProductLabel(summary.productState)}
        </span>
        <span className="rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">
          图 {summary.imageCount}/{summary.providerImageCount}
        </span>
        <span className="rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">
          规则 {summary.ruleCount}
        </span>
      </div>
      {summary.roleLabels.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {summary.roleLabels.map((label) => (
            <span
              key={label}
              className="max-w-full truncate rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted"
            >
              {label}
            </span>
          ))}
        </div>
      ) : (
        <div className="text-[10px] text-warm-muted">无结构化引用角色</div>
      )}
      {diagnosticSummary && tone !== "ready" && (
        <div className="line-clamp-2 rounded bg-red-50 px-1.5 py-1 text-[10px] leading-4 text-red-700">
          诊断：{diagnosticSummary}
        </div>
      )}
    </div>
  );
}

function getBatchReferenceProductLabel(state: BatchImageReferenceProductState): string {
  if (state === "provider") return "商品图 provider";
  if (state === "prompt") return "商品图 prompt";
  return "无商品图";
}

function getBatchReferenceProductClassName(state: BatchImageReferenceProductState): string {
  if (state === "provider") return "bg-emerald-50 text-emerald-700";
  if (state === "prompt") return "bg-amber-50 text-amber-700";
  return "bg-warm-paper text-warm-muted";
}

function BatchEvidenceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-warm-line/40 bg-warm-paper px-2 py-1.5">
      <span className="block truncate text-[10px] text-warm-muted">{label}</span>
      <span className="mt-0.5 block truncate text-[11px] font-medium text-warm-ink">{value}</span>
    </div>
  );
}

function QueueMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-md border border-warm-line/40 bg-warm-paper px-2 py-1.5">
      <span className="block truncate text-[10px] text-warm-muted">{label}</span>
      <span className="mt-0.5 block text-xs font-medium text-warm-ink">{value}</span>
    </div>
  );
}

function getQueueHealthSummary(queue: PersistedJobQueueSnapshot | null): {
  owner: string;
  concurrency: number;
  pending: number;
  queued: number;
  running: number;
  activeLeases: number;
  stale: number;
  expired: number;
  missingLease: number;
} {
  const staleFallback =
    (queue?.stale.queuedJobIds.length ?? 0) + (queue?.stale.runningJobIds.length ?? 0);
  return {
    owner: queue?.owner || "未读取",
    concurrency: queue?.concurrency ?? 0,
    pending: queue?.database.pending ?? 0,
    queued: queue?.database.queued ?? 0,
    running: queue?.database.running ?? 0,
    activeLeases: queue?.leases?.length ?? 0,
    stale: queue?.stale.count ?? staleFallback,
    expired: queue?.stale.expiredCount ?? queue?.stale.expiredJobIds?.length ?? 0,
    missingLease: queue?.stale.missingLeaseJobIds?.length ?? 0,
  };
}

function getGenerationSafetyLabel(
  provider: ProviderReadiness | null,
  queue: PersistedJobQueueSnapshot | null
): string {
  if (!provider) return "正在读取 provider 状态；真实生图前请确认设置页配置。";
  if (!provider.hasImageKey && !provider.hasKey) {
    return "真实生图暂不可用：请先配置 Image key 或全局 API key。";
  }
  const activeCount = (queue?.runtime.runningCount ?? 0) + (queue?.runtime.queuedCount ?? 0);
  if (activeCount > 0) return `真实生图可用；当前本地队列还有 ${activeCount} 个任务。`;
  return "真实生图可用；队列空闲，运行任务会调用当前 image provider。";
}

function getQueueRuntimeLabel(queue: PersistedJobQueueSnapshot): string {
  if (queue.runtime.runningCount > 0) {
    return `运行中 ${queue.runtime.runningCount} · 等待 ${queue.runtime.queuedCount}`;
  }
  if (queue.runtime.queuedCount > 0) return `等待运行 ${queue.runtime.queuedCount}`;
  return "本地队列空闲";
}

function getQueueStaleLabel(queue: PersistedJobQueueSnapshot): string {
  const staleCount = queue.stale.count ?? queue.stale.queuedJobIds.length + queue.stale.runningJobIds.length;
  if (staleCount > 0) return `${staleCount} 个需恢复`;
  return "无卡住任务";
}

function canMarkBatchQaPassed(qaReport?: ExportPackQaReport): boolean {
  return getBatchManualReviewTargets(qaReport).length > 0;
}

function getBatchManualReviewTargets(
  qaReport?: ExportPackQaReport
): Array<{ jobId: string; checkId: string }> {
  if (!qaReport) return [];
  return qaReport.items.flatMap((item) => {
    if (item.artifactStatus !== "ready") return [];
    return item.checks
      .filter((check) => check.status === "manual")
      .map((check) => ({ jobId: item.jobId, checkId: check.id }));
  });
}

function buildArtifactImageInfoByUrl(
  artifacts: PersistedGeneratedArtifact[]
): Record<string, ExportPackImageInfo> {
  const entries: Array<[string, ExportPackImageInfo]> = [];
  for (const artifact of artifacts) {
    const width = getMetadataNumber(artifact.metadata.imageWidth ?? artifact.metadata.width);
    const height = getMetadataNumber(artifact.metadata.imageHeight ?? artifact.metadata.height);
    if (!artifact.url || !width || !height) continue;
    entries.push([
      artifact.url,
      {
        exists: true,
        width,
        height,
        mimeType:
          typeof artifact.metadata.mimeType === "string" ? artifact.metadata.mimeType : undefined,
        byteSize: getMetadataNumber(artifact.metadata.byteSize),
      },
    ]);
  }
  return Object.fromEntries(entries);
}

function getMetadataNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function getFirstManifestNaming(manifest?: ExportPackManifest): string {
  const naming = manifest?.items.find((item) => item.naming)?.naming;
  if (!naming) return "";
  return naming.length > 18 ? `${naming.slice(0, 15)}...` : naming;
}

function mapProductionStateFromStatus(status: string): ProductionPanelState {
  const normalized = status.toLowerCase();
  if (
    normalized.includes("failed") ||
    normalized.includes("error") ||
    normalized.includes("失败") ||
    normalized.includes("缺图")
  ) {
    return "failed";
  }
  if (
    normalized.includes("review") ||
    normalized.includes("manual") ||
    normalized.includes("待确认") ||
    normalized.includes("待检查")
  ) {
    return "needs_review";
  }
  if (
    normalized.includes("running") ||
    normalized.includes("queued") ||
    normalized.includes("pending") ||
    normalized.includes("生成中") ||
    normalized.includes("等待") ||
    normalized.includes("处理中")
  ) {
    return "working";
  }
  if (
    normalized.includes("ready") ||
    normalized.includes("done") ||
    normalized.includes("completed") ||
    normalized.includes("完成") ||
    normalized.includes("已出图") ||
    normalized.includes("delivered") ||
    normalized.includes("locked")
  ) {
    return "ready";
  }
  return "idle";
}

function getArtifactStatusFilter(status: string): ArtifactStatusFilter {
  if (status === "ready" || status === "done" || status === "completed" || status === "success") {
    return "completed";
  }
  if (status === "running" || status === "processing" || status === "generating") {
    return "running";
  }
  if (status === "failed" || status === "error") return "failed";
  if (status === "draft" || status === "queued" || status === "pending" || status === "created") {
    return "draft";
  }
  return "draft";
}

function formatJobTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚创建";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getFirstImageFile(files: FileList | null | undefined): File | undefined {
  if (!files) return undefined;
  return Array.from(files).find((file) => file.type.startsWith("image/"));
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
