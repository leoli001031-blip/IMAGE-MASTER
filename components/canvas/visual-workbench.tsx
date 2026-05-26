import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  Background,
  Controls,
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
  canvasAssets,
  canvasFactoryItems,
  canvasIconMap,
  canvasLibraryCategories,
  initialCanvasNodes,
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
  getCanvasNodeSemanticType,
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
import { buildStructuredCopyBrief } from "@/lib/canvas/copy-brief";
import { WorkflowNode } from "@/components/canvas/workflow-node";
import type { CanvasFlowNode } from "@/components/canvas/workflow-node";
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

const defaultAgentSampleOutputCount = 6;
const maxAgentSampleOutputCount = 10;

function clampAgentSampleOutputCount(value: number): number {
  if (!Number.isFinite(value)) return defaultAgentSampleOutputCount;
  return Math.min(Math.max(Math.round(value), 1), maxAgentSampleOutputCount);
}

function parseRequestedAgentSampleCount(brief: string): number | undefined {
  const text = brief.trim();
  if (!text) return undefined;

  const digitPatterns = [
    /(?:生成|出|做|来|要|需要|create|generate|make)?\s*(\d{1,2})\s*(?:张成片|张图|张|幅|图|p|P|pics?|photos?|shots?|outputs?)/i,
    /(\d{1,2})\s+(?:finished\s+)?(?:images?|photos?|shots?|outputs?)/i,
    /(\d{1,2})\s*(?:张|幅)?\s*(?:成片|最终图|完成图)/i,
  ];
  for (const pattern of digitPatterns) {
    const match = text.match(pattern);
    if (match) return clampAgentSampleOutputCount(Number(match[1]));
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
  if (chineseMatch) return clampAgentSampleOutputCount(chineseDigits[chineseMatch[1]] ?? defaultAgentSampleOutputCount);

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
  },
  {
    id: "review",
    label: "审核",
    description: "人工过审和备注",
    icon: ListChecks,
  },
  {
    id: "diagnostics",
    label: "诊断",
    description: "Provider 和队列健康",
    icon: CircleDot,
  },
  {
    id: "projects",
    label: "项目",
    description: "项目、活动、批次",
    icon: Layers3,
  },
  {
    id: "export",
    label: "交付包",
    description: "规格、ZIP、QA 明细",
    icon: PackageCheck,
  },
  {
    id: "queue",
    label: "任务队列",
    description: "运行、取消、重试",
    icon: Play,
  },
  {
    id: "outputs",
    label: "输出",
    description: "全部产物筛选",
    icon: ImageIcon,
  },
  {
    id: "templates",
    label: "模板",
    description: "工作流模板和计划预览",
    icon: SquareStack,
  },
  {
    id: "factory",
    label: "组件工厂",
    description: "AI 生成可拖拽组件",
    icon: Sparkles,
  },
] as const;

type DrawerToolId = (typeof drawerToolOptions)[number]["id"];

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

type AssetPackCategory = "product_asset" | "model_asset" | "scene_asset" | "style_asset";

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
];

const VISUAL_NODE_LAYOUT_VERSION = 1;
const visualNodeDefaultPositions: Record<string, { x: number; y: number }> = {
  product: { x: 30, y: 170 },
  brief: { x: 380, y: 105 },
  model: { x: 690, y: 0 },
  detail: { x: 690, y: 320 },
  platform: { x: 1040, y: 140 },
  review: { x: 1040, y: 475 },
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
  title: "商品框",
  description: "上传多张商品图，生成一张可复用的白底多视角商品资产",
  iconName: "product",
  label: "商品框",
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
    label: "商品图生成框",
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
    label: "模特生成框",
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
    label: "场景生成框",
    caption: "生成主场景和空间约束，供后续图组复用",
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
    label: "风格生成框",
    caption: "把审美方向整理成可复用风格资产",
    metrics: ["风格", "光线", "构图"],
    edgeLabel: "生成风格",
    outputType: "style_asset",
    promptPlaceholder: "例如：干净高级、自然光、柔和商业质感",
  },
  {
    id: "custom_template",
    title: "图组",
    description: "把素材和一句需求交给 Agent 拆成图组",
    iconName: "ai",
    label: "图组生成框",
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

function getGenerationActionCreatedMessage(action: LineGenerationAction, prefix: string): string {
  const label = action.label || action.title;
  return `${prefix}${label.endsWith("框") ? label : `${label}生成框`}`;
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

interface PersistedGeneratedArtifact {
  id: string;
  workflowId?: string;
  nodeId?: string;
  jobId?: string;
  assetId?: string;
  type: string;
  title: string;
  status: string;
  url: string;
  prompt: string;
  provider: string;
  model: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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
  provider?: string;
  model?: string;
  error?: string;
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
  const [assetLibraryGeneratorOpen, setAssetLibraryGeneratorOpen] = useState(false);
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
  const [jobs, setJobs] = useState<PersistedGenerationJob[]>([]);
  const [queueSnapshot, setQueueSnapshot] = useState<PersistedJobQueueSnapshot | null>(null);
  const [projects, setProjects] = useState<PersistedProjectDetails[]>([]);
  const [components, setComponents] = useState<PersistedComponent[]>([]);
  const [workflowTemplates, setWorkflowTemplates] = useState<PersistedWorkflowTemplate[]>([]);
  const [artifacts, setArtifacts] = useState<PersistedGeneratedArtifact[]>([]);
  const [outputPreview, setOutputPreview] = useState<GenerationOutputPreview | null>(null);
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
  const [composeMessage, setComposeMessage] = useState("");
  const copyBurnInRequested = useMemo(
    () => hasExplicitCopyBurnInRequest(composeBrief),
    [composeBrief]
  );
  const [workflowPlanPreview, setWorkflowPlanPreview] = useState<WorkflowPlanPreview | null>(null);
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
  const [exportPackMessage, setExportPackMessage] = useState("");
  const [focusRequest, setFocusRequest] = useState<CanvasFocusRequest | null>(null);
  const focusRequestCounter = useRef(0);
  const agentProductInputRef = useRef<HTMLInputElement>(null);
  const stageNodesCacheRef = useRef<{ signature: string; nodes: CanvasWorkbenchNode[] } | null>(null);
  const artifactReconcileSignatureRef = useRef("");
  const jobsListSignatureRef = useRef("");
  const artifactsListSignatureRef = useRef("");
  const loadedProjectCanvasRef = useRef("");
  const canvasMutationVersionRef = useRef(0);

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

  useEffect(() => {
    let alive = true;

    async function loadRealAssets() {
      const [assetsResult, modelsResult] = await Promise.allSettled([
        apiFetch("/api/assets", { cache: "no-store" }),
        apiFetch("/api/models", { cache: "no-store" }),
      ]);

      if (!alive) return;

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
    }

    loadRealAssets().catch(() => {
      if (alive) setAssetMessage("真实资产暂时未接入，正在使用示例资产");
    });

    return () => {
      alive = false;
    };
  }, []);

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

  const refreshArtifacts = useCallback(async () => {
    const artifacts = await fetchPersistedArtifacts(workflowId);
    const signature = getPersistedArtifactListSignature(artifacts);
    setArtifacts((current) => {
      if (artifactsListSignatureRef.current === signature) return current;
      if (getPersistedArtifactListSignature(current) === signature) {
        artifactsListSignatureRef.current = signature;
        return current;
      }
      artifactsListSignatureRef.current = signature;
      return artifacts;
    });
    return artifacts;
  }, [workflowId]);

  const refreshJobs = useCallback(async () => {
    const jobs = await fetchPersistedJobs(workflowId);
    const signature = getPersistedJobListSignature(jobs);
    setJobs((current) => {
      if (jobsListSignatureRef.current === signature) return current;
      if (getPersistedJobListSignature(current) === signature) {
        jobsListSignatureRef.current = signature;
        return current;
      }
      jobsListSignatureRef.current = signature;
      return jobs;
    });
    return jobs;
  }, [workflowId]);

  const refreshQueue = useCallback(async () => {
    const queue = await fetchPersistedJobQueueSnapshot();
    setQueueSnapshot(queue);
    return queue;
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
    let alive = true;

    refreshArtifacts().catch(() => {
      if (alive) setArtifactMessage("");
    });

    return () => {
      alive = false;
    };
  }, [refreshArtifacts]);

  useEffect(() => {
    if (artifacts.length === 0 || canvasNodes.length === 0) return;

    const signature = getArtifactReconcileSignature(
      canvasNodes,
      canvasEdges,
      artifacts,
      hiddenArtifactNodeIds
    );
    if (signature === artifactReconcileSignatureRef.current) return;

    const reconciled = reconcileArtifactResultNodes(
      canvasNodes,
      canvasEdges,
      artifacts,
      hiddenArtifactNodeIds
    );
    artifactReconcileSignatureRef.current = getArtifactReconcileSignature(
      reconciled.nodes,
      reconciled.edges,
      artifacts,
      hiddenArtifactNodeIds
    );
    if (reconciled.nodes !== canvasNodes) setCanvasNodes(reconciled.nodes);
    if (reconciled.edges !== canvasEdges) setCanvasEdges(reconciled.edges);
  }, [artifacts, canvasEdges, canvasNodes, hiddenArtifactNodeIds]);

  useEffect(() => {
    let alive = true;

    refreshJobs().catch(() => {
      if (alive) setJobMessage("");
    });
    refreshQueue().catch(() => {
      if (alive) setQueueSnapshot(null);
    });

    return () => {
      alive = false;
    };
  }, [refreshJobs, refreshQueue]);

  const hasActiveBackgroundJob = jobs.some(isActiveBackgroundJob);

  useEffect(() => {
    if (!hasActiveBackgroundJob) return;

    let alive = true;
    const intervalId = window.setInterval(() => {
      void Promise.allSettled([refreshJobs(), refreshArtifacts()]).then(() => {
        void refreshQueue();
        if (alive) setJobMessage((message) => message || "任务生成中，正在等待产物回填");
      });
    }, 2500);

    return () => {
      alive = false;
      window.clearInterval(intervalId);
    };
  }, [hasActiveBackgroundJob, refreshArtifacts, refreshJobs, refreshQueue]);

  useEffect(() => {
    let alive = true;
    const loadMutationVersion = canvasMutationVersionRef.current;

    async function loadSavedWorkflow() {
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
          if (canvasMutationVersionRef.current !== loadMutationVersion) {
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

        const workflowResponse = await apiFetch(`/api/workflows/${encodeURIComponent(projectWorkflowId)}`, {
          cache: "no-store",
        });
        if (!workflowResponse.ok || !alive) {
          setWorkflowMessage("项目画布读取失败，可重新保存当前画布");
          return;
        }
        const workflow = await workflowResponse.json();
        if (canvasMutationVersionRef.current !== loadMutationVersion) {
          setWorkflowMessage("项目画布已在本地修改，未覆盖当前编辑");
          return;
        }
        restoreWorkflowToCanvas(workflow);
        setWorkflowMessage("已恢复项目画布");
        return;
      }

      if (typeof window !== "undefined") {
        const shouldRestore = new URLSearchParams(window.location.search).get("restore") === "1";
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
    }

    loadSavedWorkflow().catch(() => {
      if (alive) setWorkflowMessage("");
    });

    return () => {
      alive = false;
    };
  }, [activeProjectId]);

  const allAssets = useMemo(
    () => [...persistedAssets, ...modelAssets, ...canvasAssets],
    [canvasAssets, persistedAssets, modelAssets]
  );
  const activeProject = useMemo(
    () => (activeProjectId ? projects.find((project) => project.id === activeProjectId) : undefined),
    [activeProjectId, projects]
  );
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
  const selectedNode =
    stageNodes.find((node) => node.id === selectedNodeId) ?? stageNodes[0];
  const visibleFrameOutputCount = useMemo(
    () =>
      stageNodes
        .filter(isGenerationFrameNode)
        .flatMap((node) => normalizeGenerationFrameState(node.data.generationFrame).outputs)
        .filter((output) => !!output.url || output.status === "done" || output.status === "completed")
        .length,
    [stageNodes]
  );
  const visibleArtifactOutputCount = useMemo(() => {
    const frameNodeIds = new Set(
      stageNodes
        .filter(isGenerationFrameNode)
        .map((node) => node.id)
    );
    if (frameNodeIds.size === 0) return 0;
    return artifacts.filter((artifact) => {
      if (!artifact.url) return false;
      const frameNodeId =
        artifact.nodeId ||
        getStringValue(artifact.metadata.frameNodeId) ||
        getStringValue(artifact.metadata.sourceNodeId);
      return !!frameNodeId && frameNodeIds.has(frameNodeId);
    }).length;
  }, [artifacts, stageNodes]);
  const visibleOutputCount = Math.max(visibleFrameOutputCount, visibleArtifactOutputCount);
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
  const activeComposeProductTitle = activeProductComponent?.title ?? canvasProductWorkflowContext?.title ?? "";
  const hasAppliedAgentWorkflow = useMemo(
    () => hasWorkflowComposePlan(canvasNodes),
    [canvasNodes]
  );
  const hasCanvasProductReference = useMemo(
    () => Boolean(findCanvasProductReferenceNode(canvasNodes)),
    [canvasNodes]
  );
  const agentSampleOutputCount = resolveAgentSampleOutputCount(composeBrief, workflowPlanPreview);

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
        setAssetMessage("已放入框，满意后可保存到全局资产库");
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
          const nodePosition = canvasPosition ?? getNextLibraryInsertPosition(canvasNodes, selectedNode);
          const node = createNodeFromAsset(created, nodePosition, canvasNodes.length);
          pushHistorySnapshot();
          setCanvasNodes((nodes) => [...nodes, node]);
          setSelectedNodeId(node.id);
          requestCanvasFocus([node.id]);
          setAssetMessage("素材已放到画布，未进入全局资产库");
          setWorkflowMessage("素材已放到画布；右键节点可保存到全局资产库");
        }
      } else {
        const nodePosition = canvasPosition ?? getNextLibraryInsertPosition(canvasNodes, selectedNode);
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

  const handleUseTrayItemAsAssetPackReference = (item: AssetTrayItem) => {
    if (!item.previewUrl) {
      setAssetPackMessage("这个素材还没有可用预览图，不能作为参考");
      return;
    }

    const referenceLabel = getAssetPackReferenceUploadLabel(assetPackCategory);
    setAssetPackReferenceUploads((items) => [
      ...items,
      {
        id: `asset-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: item.title || referenceLabel,
        dataUrl: item.previewUrl,
        size: 0,
        source: "asset" as const,
      },
    ].slice(0, 12));
    setActiveCategory(mapAssetPackCategoryToLibraryCategory(assetPackCategory));
    setAssetPackMessage(`已把「${item.title}」加入${referenceLabel}`);
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
      setAssetPackMessage(result.createdComponent ? "已保存，可直接拖入生成框" : "已保存到全局资产库");
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

  async function saveWorkflowSnapshot(options: { silent?: boolean } = {}): Promise<string | null> {
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
        nodes: canvasNodes,
        edges: canvasEdges,
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
      setPendingWorkflowDraft(null);
    },
    [pushHistorySnapshot, requestCanvasFocus]
  );

  const runWorkflowCompose = async (
    brief: string,
    productComponent?: PersistedComponent | null,
    source: "compose" | "product-import" = "compose"
  ) => {
    setComposingWorkflow(true);
    setComposeMessage("正在生成工作流草案...");
    if (source === "product-import") setProductImportMessage("正在按导入商品生成工作流...");

    try {
      const productContext = productComponent
        ? getProductComponentWorkflowContext(productComponent)
        : canvasProductWorkflowContext;
      const response = await apiFetch("/api/workflow-compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief,
          productTitle: productContext?.title,
          productDescription: productContext?.description,
          componentIds: productComponent ? [productComponent.id] : undefined,
          copyRenderMode: copyBurnInRequested ? "burn_in" : "layout_layer",
          previewPlan: true,
          saveWorkflow: false,
        }),
      });

      if (!response.ok) throw new Error("workflow compose failed");
      const payload = await response.json();
      const draft = mapWorkflowComposeDraft(payload.workflowDraft);
      if (!draft || draft.nodes.length === 0) throw new Error("invalid workflow draft");
      const planPreview = mapWorkflowPlanPreview(payload.planPreview);

      setPendingWorkflowDraft(draft);
      setWorkflowPlanPreview(planPreview);
      setWorkflowMessage("已生成计划预览，确认后应用到画布");
      setComposeMessage(
        planPreview
          ? `${planPreview.title} · ${planPreview.estimatedCount} 张计划图`
          : `${draft.title} · ${draft.nodes.length} 节点草案`
      );
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
    if (!pendingWorkflowDraft) {
      setComposeMessage("暂无可应用的计划预览");
      return;
    }

    const existingProductNode = findCanvasProductReferenceNode(canvasNodes);
    const draft = existingProductNode
      ? bindExistingProductReferenceToWorkflowDraft(pendingWorkflowDraft, existingProductNode)
      : pendingWorkflowDraft;

    applyWorkflowDraftToCanvas(draft, {
      message: existingProductNode
        ? "计划已放好，可以生成样张"
        : "计划已放好，下一步导入商品图",
      productMessage: existingProductNode
        ? "计划已接入当前商品图，可以生成样张"
        : "计划已放好，先补商品图",
    });
  }, [applyWorkflowDraftToCanvas, canvasNodes, pendingWorkflowDraft]);

  const handleDismissWorkflowPlan = useCallback(() => {
    setWorkflowPlanPreview(null);
    setPendingWorkflowDraft(null);
    setComposeMessage("已关闭计划预览");
  }, []);

  const handleUpdateWorkflowPlanParameter = useCallback(
    (nodeId: string, key: string, value: unknown) => {
      setWorkflowPlanPreview((preview) => updatePlanPreviewParameter(preview, nodeId, key, value));
      setPendingWorkflowDraft((draft) => updateWorkflowDraftParameter(draft, nodeId, key, value));
    },
    []
  );

  const handleComposeWorkflow = async () => {
    const brief = composeBrief.trim();
    if (!brief) {
      setComposeMessage("先输入一个需求 brief");
      return;
    }

    await runWorkflowCompose(brief, activeProductComponent);
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
          setJobMessage(runDecision.message ?? "生成框缺少运行输入");
          return;
        }
        const workflowIdForJob = activeProjectId
          ? await saveWorkflowSnapshot({ silent: true })
          : (workflowIdRef.current ?? workflowId);
        const planPrompt = buildJobPromptFromNode(node, nodeProductAsset, referenceContext);
        const batchId = `frame_batch_${node.id}_${Date.now()}`;
        const planItems = buildGenerationFramePlanItems(node, planPrompt);
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
            frameNodeId: node.id,
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
                frameNodeId: node.id,
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
        setJobMessage(agentPlanText
          ? `开始生成 ${createdJobs.length} 张图 · ${agentPlanText}`
          : `开始生成 ${createdJobs.length} 张图`);
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
      setJobMessage("任务创建失败，请稍后重试");
    } finally {
      setCreatingJobForNodeId(null);
    }
  };

  const handleGenerateAgentSample = async () => {
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

    const cleanBrief = composeBrief.trim();
    const sampleOutputCount = resolveAgentSampleOutputCount(composeBrief, workflowPlanPreview);
    const agentSampleOutputType = "custom_template";
    const generationRequest = [
      cleanBrief || "给当前商品生成一组淘宝商品样张，包含主图海报、卖点图、细节图和生活场景图。",
      `先生成 ${sampleOutputCount} 张样张用于确认方向。文案默认作为可编辑图层，除非明确要求，不直接烧进图片。`,
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
    const generationFrame = bindNodeToGenerationFrameSlot(
      {
        ...migrateLegacyGenerationFrameData(baseFrameNode.data, baseFrameNode.id),
        prompt: generationRequest,
        outputType: agentSampleOutputType,
        updatedAt: now,
      },
      productNode,
      { role: "product", updatedAt: now }
    );
    const frameNode: CanvasWorkbenchNode = {
      ...baseFrameNode,
      data: {
        ...baseFrameNode.data,
        label: "样张生成框",
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
    const frameEdge: CanvasWorkbenchEdge = {
      id: `${productNode.id}-${frameNode.id}`,
      source: productNode.id,
      target: frameNode.id,
      label: "生成样张",
      animated: true,
    };
    const nextNodes = [...canvasNodes, frameNode];
    const nextEdges = [...canvasEdges, frameEdge];

    pushHistorySnapshot();
    setCanvasNodes(nextNodes);
    setCanvasEdges(nextEdges);
    setSelectedNodeId(frameNode.id);
    requestCanvasFocus([productNode.id, frameNode.id]);
    setGeneratingAgentSample(true);
    setJobMessage(`正在创建 ${sampleOutputCount} 张样张任务...`);

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
        setJobMessage(runDecision.message ?? "生成框缺少运行输入");
        return;
      }

      const planPrompt = buildJobPromptFromNode(frameNode, undefined, referenceContext);
      const planItems = buildGenerationFramePlanItems(frameNode, planPrompt).slice(0, sampleOutputCount);
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
          workflowId,
          projectId: activeProjectId || undefined,
          campaignId: activeCampaignId || undefined,
          frameNodeId: frameNode.id,
          batchId,
          batchTitle: "Agent 样张",
          request: generationRequest,
          userRequest: generationRequest,
          outputType: agentSampleOutputType,
          requiredReferenceRoles: runDecision.requiredReferenceRoles,
          referenceContext,
          referenceImages: referenceContext.images,
          style: agentSampleOutputType,
          modelIds: [],
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
      setComposeMessage("样张任务已创建，生成结果会回填到画布");
      void refreshQueue();
      void refreshProjects();
    } catch (error) {
      console.error("Failed to generate agent sample:", error);
      setJobMessage("样张任务创建失败，请稍后重试");
    } finally {
      setGeneratingAgentSample(false);
    }
  };

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

  const handleRetryImageJob = async (job: PersistedGenerationJob) => {
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
        body: JSON.stringify({ confirmedProviderCallLimit: providerCallLimit }),
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
          ? "失败图片已带商品参考图重试完成"
          : "失败图片已按纯文生图重试完成"
      );
      void Promise.allSettled([refreshJobs(), refreshArtifacts(), refreshQueue(), refreshProjects()]);
    } catch (error) {
      console.error("Failed to retry image job:", error);
      setJobMessage(error instanceof Error ? error.message : "失败图片重试失败，请稍后重试");
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
          return [...nodes, createArtifactResultNode(artifact, sourceNode, nodes.length)];
        });
        setCanvasEdges((edges) => {
          if (!artifact.nodeId) return edges;

          const sourceNode = canvasNodes.find((node) => node.id === artifact.nodeId);
          if (!sourceNode) return edges;

          const edgeId = getArtifactResultEdgeId(sourceNode.id, artifact);
          if (edges.some((edge) => edge.id === edgeId || (
            edge.source === sourceNode.id && edge.target === resultNodeId
          ))) {
            return edges;
          }

          return [
            ...edges,
            {
              id: edgeId,
              source: sourceNode.id,
              target: resultNodeId,
              label: "输出产物",
              animated: false,
            },
          ];
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
      const url = detail.url || artifact?.url;
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
            provider: outputArtifact?.provider || getStringValue(metadata.provider),
            model: outputArtifact?.model || getStringValue(metadata.model),
            error: outputJob?.error || getStringValue(metadata.error) || getProviderDiagnosticSummary(metadata),
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
        provider: artifact?.provider || getStringValue(fallbackMetadata.provider),
        model: artifact?.model || getStringValue(fallbackMetadata.model),
        error: job?.error || getStringValue(fallbackMetadata.error) || getProviderDiagnosticSummary(fallbackMetadata),
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
      const url = detail.url || artifact?.url;
      if (!url) {
        setArtifactMessage("这张图还没有可保存的图片");
        return;
      }
      const artifactMetadata = getRecordValue(artifact?.metadata);
      const sourceNodeId =
        detail.nodeId ||
        artifact?.nodeId ||
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
        setArtifactMessage(saveTarget.message);
      } catch (error) {
        console.error("Failed to save generation output as asset:", error);
        setArtifactMessage("保存失败，请稍后重试");
      }
    },
    [artifacts, canvasNodes]
  );

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

    const handleRetry = (event: Event) => {
      const detail = readDetail(event);
      if (!detail?.jobId) {
        setJobMessage("这张图还没有可重做的任务");
        return;
      }
      const job = jobs.find((item) => item.id === detail.jobId);
      if (!job) {
        setJobMessage("没有找到这张图的任务");
        return;
      }
      void (canRetryImageJob(job) ? handleRetryImageJob(job) : handleRetryJob(job));
    };

    const handleRetryAll = (event: Event) => {
      const detail = readDetail(event);
      const jobIds = detail?.jobIds?.filter((value): value is string => typeof value === "string" && !!value.trim()) ?? [];
      const retryJobs = jobs.filter((job) => jobIds.includes(job.id) && (canRetryImageJob(job) || canRetryJob(job)));
      if (retryJobs.length === 0) {
        setJobMessage("当前图组没有可重做的失败图片");
        return;
      }
      setJobMessage(`开始按顺序重做 ${retryJobs.length} 张失败图片`);
      void (async () => {
        for (const job of retryJobs) {
          if (canRetryImageJob(job)) {
            await handleRetryImageJob(job);
          } else {
            await handleRetryJob(job);
          }
        }
      })();
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
    window.addEventListener("image-master:generation-frame-output-retry", handleRetry);
    window.addEventListener("image-master:generation-frame-output-retry-all", handleRetryAll);
    window.addEventListener("image-master:generation-frame-output-save", handleSave);
    window.addEventListener("image-master:generation-frame-output-export", handleExport);
    window.addEventListener("image-master:generation-frame-output-open-folder", handleOpenFolder);
    return () => {
      window.removeEventListener("image-master:generation-frame-output-open", handleOpen);
      window.removeEventListener("image-master:generation-frame-output-retry", handleRetry);
      window.removeEventListener("image-master:generation-frame-output-retry-all", handleRetryAll);
      window.removeEventListener("image-master:generation-frame-output-save", handleSave);
      window.removeEventListener("image-master:generation-frame-output-export", handleExport);
      window.removeEventListener("image-master:generation-frame-output-open-folder", handleOpenFolder);
    };
  }, [
    artifacts,
    handleOpenGenerationOutputPreview,
    handleRetryImageJob,
    handleSaveGenerationOutputAsAsset,
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

  const handleCreateGenerationFrameFromConnection = useCallback(
    ({
      sourceNodeId,
      actionId,
      position,
    }: {
      sourceNodeId: string;
      actionId: LineGenerationActionId;
      position: XYPosition;
    }) => {
      const sourceNode = canvasNodes.find((node) => node.id === sourceNodeId);
      const action = getLineGenerationAction(actionId);
      if (!sourceNode || !action) return;

      const node = createGenerationFrameNode({
        action,
        sourceNode,
        position,
        index: canvasNodes.length,
      });
      const positionedNode = {
        ...node,
        position: findAvailableGenerationFramePosition(canvasNodes, {
          anchorNode: sourceNode,
          preferredPosition: node.position,
        }),
      };

      pushHistorySnapshot();
      setCanvasNodes((nodes) => [...nodes, positionedNode]);
      setCanvasEdges((edges) => [
        ...edges,
        {
          id: `${sourceNode.id}-${positionedNode.id}`,
          source: sourceNode.id,
          target: positionedNode.id,
          label: action.edgeLabel,
          animated: true,
        },
      ]);
      setSelectedNodeId(positionedNode.id);
      requestCanvasFocus([sourceNode.id, positionedNode.id]);
      setWorkflowMessage(getGenerationActionCreatedMessage(action, "已创建"));
    },
    [canvasNodes, pushHistorySnapshot, requestCanvasFocus]
  );

  const handleCreateBlankGenerationFrame = useCallback((position?: XYPosition, actionId?: LineGenerationActionId) => {
    const index = canvasNodes.length + canvasNodes.filter(isGenerationFrameNode).length;
    const action = actionId ? getLineGenerationAction(actionId) : undefined;
    const node = action
      ? createTypedGenerationFrameNode({
          action,
          index,
          position: position ?? findAvailableGenerationFramePosition(canvasNodes),
        })
      : createDefaultGenerationFrameNode({
          productAsset: undefined,
          index,
          position: position ?? findAvailableGenerationFramePosition(canvasNodes),
        });
    pushHistorySnapshot();
    setCanvasNodes((nodes) => [...nodes, node]);
    setSelectedNodeId(node.id);
    requestCanvasFocus([node.id]);
    setWorkflowMessage(action ? getGenerationActionCreatedMessage(action, "已新建") : "已新建一个生成框");
  }, [canvasNodes, pushHistorySnapshot, requestCanvasFocus]);

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
    setWorkflowMessage("文案已放到画布，可拖进生成框");
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

  const handleAddCanvasNodeToGenerationFrame = useCallback((nodeId: string, targetFrameId?: string) => {
    const sourceNode = stageNodes.find((node) => node.id === nodeId && !isGenerationFrameNode(node));
    if (!sourceNode) {
      setWorkflowMessage("没有找到可放入生成框的节点");
      return;
    }
    const frameNode =
      (targetFrameId ? stageNodes.find((node) => node.id === targetFrameId && isGenerationFrameNode(node)) : undefined) ??
      (stageNodes.find((node) => node.id === selectedNodeId && isGenerationFrameNode(node))) ??
      stageNodes.find(isGenerationFrameNode) ??
      defaultGenerationFrameNode;
    const updatedAt = new Date().toISOString();
    const generationFrame = bindNodeToGenerationFrameSlot(
      migrateLegacyGenerationFrameData(frameNode.data, frameNode.id),
      sourceNode,
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
    setSelectedNodeId(nextFrameNode.id);
    requestCanvasFocus([sourceNode.id, nextFrameNode.id]);
    setWorkflowMessage(`${sourceNode.data.label} 已放入生成框`);
  }, [defaultGenerationFrameNode, pushHistorySnapshot, requestCanvasFocus, selectedNodeId, stageNodes]);

  const handleOpenCanvasNodePreview = useCallback((nodeId: string) => {
    const node = stageNodes.find((item) => item.id === nodeId);
    const url = getStringValue(node?.data.previewUrl) || getStringValue(node?.data.referenceUrl);
    if (!node || !url) {
      setArtifactMessage("这个节点没有可查看的大图");
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
  }, [stageNodes]);

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

  const handleChangeLibraryAssetCategory = useCallback(
    async (item: AssetTrayItem, category: CanvasLibraryCategory) => {
      const assetId = item.id.replace(/^asset:/, "");
      const asset = [...persistedAssets, ...modelAssets].find((candidate) => candidate.id === assetId);
      if (!asset || asset.category === category) return;
      if (asset.source === "model-library") {
        setAssetMessage("模特库资产暂不支持改分类");
        return;
      }

      try {
        const updated = await patchLibraryAsset(asset, { category });
        setActiveCategory(updated.category);
        setAssetMessage(`已归类到${updated.category}`);
      } catch (error) {
        console.error("Failed to update asset category:", error);
        setAssetMessage(error instanceof Error ? error.message : "分类更新失败");
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
          ? {
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
          }
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
      setSelectedNodeId(nextFrameNode.id);
      requestCanvasFocus([nextFrameNode.id]);
      setWorkflowMessage(`${asset.title} 已放入生成框`);
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
        "资产已移出生成框"
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
      handleBindAssetToGenerationFrame(asset);
    },
    [allAssets, handleBindAssetToGenerationFrame]
  );

  const handleSelectComponentFromLibrary = useCallback(
    (componentId: string) => {
      const component = components.find((item) => item.id === componentId);
      if (!component) return;

      const matchedAsset = component.assetId
        ? allAssets.find((asset) => asset.id === component.assetId)
        : undefined;
      if (matchedAsset) {
        handleBindAssetToGenerationFrame(matchedAsset);
        return;
      }

      const position = getNextLibraryInsertPosition(canvasNodes, selectedNode);
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
      canvasNodes,
      components,
      handleBindAssetToGenerationFrame,
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
            "组件已放入生成框"
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

  const handleCreateProductAssetFrame = useCallback((position?: XYPosition) => {
    handleCreateBlankGenerationFrame(position, "product_asset");
  }, [handleCreateBlankGenerationFrame]);

  const handleCreateModelAssetFrame = useCallback((position?: XYPosition) => {
    handleCreateBlankGenerationFrame(position, "model_asset");
  }, [handleCreateBlankGenerationFrame]);

  const handleCreateSceneAssetFrame = useCallback((position?: XYPosition) => {
    handleCreateBlankGenerationFrame(position, "scene_asset");
  }, [handleCreateBlankGenerationFrame]);

  const handleCreateStyleAssetFrame = useCallback((position?: XYPosition) => {
    handleCreateBlankGenerationFrame(position, "style_asset");
  }, [handleCreateBlankGenerationFrame]);

  const handleCreateKnowledgeNode = useCallback((position?: XYPosition) => {
    const node = createKnowledgeNode(position ?? findAvailableGenerationFramePosition(canvasNodes), canvasNodes.length);
    pushHistorySnapshot();
    setCanvasNodes((nodes) => [...nodes, node]);
    setSelectedNodeId(node.id);
    requestCanvasFocus([node.id]);
    setWorkflowMessage("知识卡已放到画布，可拖进生成框");
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
  const activeOutputPrompt = activeOutputPreview?.prompt ?? getGenerationOutputPreviewPrompt({
    metadata: activeOutputPreviewMetadata,
  });
  const activeOutputError = activeOutputPreview?.error || getProviderDiagnosticSummary(activeOutputPreviewMetadata);
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
        },
      })
    );
  }, []);

  return (
    <section className="relative flex w-full flex-col overflow-visible rounded-lg border border-warm-line/40 bg-warm-paper shadow-sm lg:h-[calc(100svh-150px)] lg:min-h-[620px] lg:overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-warm-line/40 bg-warm-paper px-3 py-2 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-warm-ink">画布</h2>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 md:justify-end">
          {workflowMessage && (
            <div className="rounded-md bg-warm-primary-soft px-2.5 py-1.5 text-xs text-warm-primary">
              {workflowMessage}
            </div>
          )}
          <div className="rounded-md border border-warm-line/50 bg-warm-bg px-2.5 py-1.5 text-xs text-warm-muted">
            {visibleOutputCount} 结果 · {jobs.filter(isActiveBackgroundJob).length} 生成中
          </div>
          <button
            type="button"
            onClick={() => setShowStatusDrawer(true)}
            className="inline-flex items-center gap-2 rounded-md border border-warm-line/50 bg-warm-paper px-3 py-1.5 text-xs font-medium text-warm-ink transition hover:border-warm-primary/35 hover:text-warm-primary"
          >
            <PackageCheck className="h-3.5 w-3.5" />
            进度
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <ReactFlowProvider>
          <CanvasStage
            nodes={stageNodes}
            edges={stageEdges}
            selectedNodeId={selectedNodeId}
            focusRequest={focusRequest}
            onSelectNode={setSelectedNodeId}
            onNodesChange={handleNodesChange}
            onNodePositionCommit={handleNodePositionCommit}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onCreateGenerationFrame={handleCreateGenerationFrameFromConnection}
            onCreateBlankGenerationFrame={handleCreateBlankGenerationFrame}
            onCreateProductAsset={handleCreateProductAssetFrame}
            onCreateModelAsset={handleCreateModelAssetFrame}
            onCreateSceneAsset={handleCreateSceneAssetFrame}
            onCreateStyleAsset={handleCreateStyleAssetFrame}
            onCreateKnowledgeNode={handleCreateKnowledgeNode}
            onCreateCopyNode={handleCreateCopyNode}
            onSetNodeRole={handleSetCanvasNodeRole}
            onAddNodeToGenerationFrame={handleAddCanvasNodeToGenerationFrame}
            onOpenNodePreview={handleOpenCanvasNodePreview}
            onSaveNodeAsAsset={handleSaveCanvasNodeAsAsset}
            onDeleteNodeById={handleDeleteCanvasNodeById}
            onDropAsset={handleDropAssetOnCanvas}
            onDropComponent={handleDropComponentOnCanvas}
            onUploadProduct={handleUploadProduct}
            onSaveWorkflow={handleSaveWorkflow}
            onBeforeEdit={pushHistorySnapshot}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onDuplicateNode={handleDuplicateSelectedNode}
            onDeleteNode={handleDeleteSelectedNode}
            savingWorkflow={savingWorkflow}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
            canEditSelectedNode={!!selectedNode}
          />
        </ReactFlowProvider>
      </div>

      <CanvasAgentPanel
        productAsset={undefined}
        activeProductComponentTitle={activeComposeProductTitle}
        composeBrief={composeBrief}
        composeMessage={composeMessage}
        composingWorkflow={composingWorkflow}
        generatingSample={generatingAgentSample}
        hasAppliedWorkflow={hasAppliedAgentWorkflow}
        hasProductReference={hasCanvasProductReference}
        sampleOutputCount={agentSampleOutputCount}
        workflowPlanPreview={workflowPlanPreview}
        onComposeBriefChange={setComposeBrief}
        onComposeWorkflow={handleComposeWorkflow}
        onApplyWorkflowPlan={handleApplyWorkflowPlan}
        onDismissWorkflowPlan={handleDismissWorkflowPlan}
        onImportProduct={() => agentProductInputRef.current?.click()}
        onGenerateSample={handleGenerateAgentSample}
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
          className={cn(
            "absolute inset-x-3 bottom-[72px] z-30 overflow-hidden rounded-lg border border-warm-line/70 bg-warm-paper shadow-2xl lg:bottom-[58px]",
            assetLibraryGeneratorOpen
              ? "h-[min(430px,52svh)]"
              : "h-[min(320px,42svh)]"
          )}
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
            onUseTrayItemAsAssetPackReference={handleUseTrayItemAsAssetPackReference}
            onRenameAsset={handleRenameLibraryAsset}
            onToggleFavoriteAsset={handleToggleFavoriteLibraryAsset}
            onDeleteLibraryItem={handleDeleteLibraryItem}
            onChangeAssetCategory={handleChangeLibraryAssetCategory}
            showGenerator={assetLibraryGeneratorOpen}
            showUpload={false}
            className="h-full"
          />
        </div>
      )}

      <CanvasBottomDock
        activePanel={activeBottomPanel}
        outputCount={visibleFrameOutputCount}
        activeJobCount={jobs.filter(isActiveBackgroundJob).length}
        onToggleAssets={() =>
          setActiveBottomPanel((panel) => {
            const next = panel === "assets" ? null : "assets";
            if (next === "assets") setAssetLibraryGeneratorOpen(true);
            return next;
          })
        }
        onCreateTemplateFrame={() => {
          setActiveBottomPanel(null);
          setAssetLibraryGeneratorOpen(false);
          handleCreateBlankGenerationFrame(undefined, "custom_template");
        }}
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
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-warm-ink/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="查看生成大图"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOutputPreview(null);
          }}
        >
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-warm-line/60 bg-warm-paper shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-warm-line/60 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-warm-ink">{activeOutputPreview.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-warm-muted">
                  <span>{previewCount > 1 ? `${outputPreview.index + 1}/${previewCount}` : "生成大图"}</span>
                  {activeOutputPreview.provider && <span>· {activeOutputPreview.provider}</span>}
                  {activeOutputPreview.model && <span>· {activeOutputPreview.model}</span>}
                  {activeProductFocusLabel && <span>· {activeProductFocusLabel}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-warm-line/60 bg-warm-bg px-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!activeOutputPreview.jobId}
                  onClick={() =>
                    dispatchPreviewOutputAction("image-master:generation-frame-output-retry", activeOutputPreview)
                  }
                  title={activeOutputPreview.jobId ? "重做当前图" : "当前图没有可重做任务"}
                >
                  <RefreshCw className="h-3 w-3" />
                  重做
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-warm-line/60 bg-warm-bg px-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!activeOutputPreview.url}
                  onClick={() =>
                    dispatchPreviewOutputAction("image-master:generation-frame-output-save", activeOutputPreview)
                  }
                >
                  <Save className="h-3 w-3" />
                  保存
                </button>
                <a
                  href={activeOutputPreview.url}
                  download
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-warm-line/60 bg-warm-bg px-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Download className="h-3 w-3" />
                  下载
                </a>
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-warm-line/60 bg-warm-bg px-2 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!activeOutputPrompt}
                  onClick={() => {
                    if (!activeOutputPrompt) return;
                    void navigator.clipboard?.writeText(activeOutputPrompt);
                    setArtifactMessage("已复制这张图的 prompt");
                  }}
                  title={activeOutputPrompt ? "复制这张图的 prompt" : "没有记录 prompt"}
                >
                  <Copy className="h-3 w-3" />
                  Prompt
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-warm-line/60 bg-warm-bg text-warm-muted transition hover:border-warm-primary/40 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-35"
                  disabled={!canPreviewPrevious}
                  onClick={() => setPreviewIndex(outputPreview.index - 1)}
                  title="上一张"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-warm-line/60 bg-warm-bg text-warm-muted transition hover:border-warm-primary/40 hover:text-warm-primary disabled:cursor-not-allowed disabled:opacity-35"
                  disabled={!canPreviewNext}
                  onClick={() => setPreviewIndex(outputPreview.index + 1)}
                  title="下一张"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink"
                  onClick={() => setOutputPreview(null)}
                  title="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="grid min-h-0 flex-1 gap-3 overflow-auto bg-warm-bg p-3 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="flex min-h-[360px] items-center justify-center rounded-md border border-warm-line/50 bg-warm-paper p-2">
                <img
                  src={activeOutputPreview.url}
                  alt={activeOutputPreview.title}
                  className="max-h-[78vh] max-w-full rounded-md object-contain shadow-sm"
                />
              </div>
              <aside className="min-h-0 space-y-3 overflow-y-auto rounded-md border border-warm-line/50 bg-warm-paper p-3">
                <div>
                  <div className="text-xs font-semibold text-warm-ink">生成依据</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {activeReferenceRoleLabels.length > 0 ? activeReferenceRoleLabels.map((label) => (
                      <span key={label} className="rounded bg-warm-bg px-1.5 py-0.5 text-[10px] text-warm-muted">
                        {label}
                      </span>
                    )) : (
                      <span className="text-[11px] text-warm-muted">没有记录结构化引用角色</span>
                    )}
                  </div>
                  {activeProviderRoleLabels.length > 0 && (
                    <div className="mt-1 text-[11px] text-warm-muted">
                      Provider 输入：{activeProviderRoleLabels.join("、")}
                    </div>
                  )}
                </div>

                {activeOutputError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] leading-4 text-red-700">
                    {activeOutputError}
                  </div>
                )}

                {activeProductFocusLabel && (
                  <div className="rounded-md border border-warm-line/50 bg-warm-bg px-2 py-1.5">
                    <div className="text-[10px] text-warm-muted">商品参考焦点</div>
                    <div className="mt-0.5 text-xs font-medium text-warm-ink">{activeProductFocusLabel}</div>
                  </div>
                )}

                <OutputPreviewReferenceSection
                  title="强参考图"
                  images={activeProviderReferenceImages}
                  emptyText="这张图没有送进 provider 的图片参考"
                />
                <OutputPreviewReferenceSection
                  title="弱参考 / 文字约束"
                  images={activePromptOnlyReferenceImages}
                  emptyText="没有额外弱参考图"
                />

                <div>
                  <div className="mb-1 text-xs font-semibold text-warm-ink">Prompt</div>
                  {activeOutputPrompt ? (
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-warm-line/50 bg-warm-bg p-2 text-[11px] leading-4 text-warm-ink">
                      {activeOutputPrompt}
                    </pre>
                  ) : (
                    <div className="rounded-md border border-warm-line/50 bg-warm-bg p-2 text-[11px] text-warm-muted">
                      这张图还没有记录 prompt。
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function OutputPreviewReferenceSection({
  title,
  images,
  emptyText,
}: {
  title: string;
  images: GenerationReferenceImage[];
  emptyText: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-warm-ink">{title}</span>
        <span className="text-[10px] text-warm-muted">{images.length} 张</span>
      </div>
      {images.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {images.map((image, index) => (
            <a
              key={`${image.role}-${image.url}-${index}`}
              href={image.url}
              target="_blank"
              rel="noreferrer"
              className="group overflow-hidden rounded-md border border-warm-line/50 bg-warm-bg transition hover:border-warm-primary/50"
              title={image.title}
            >
              <div className="aspect-square bg-warm-paper">
                <img
                  src={image.url}
                  alt={image.title}
                  className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                  loading="lazy"
                />
              </div>
              <div className="space-y-1 px-1.5 py-1.5">
                <div className="truncate text-[11px] font-medium text-warm-ink">{image.title}</div>
                <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[10px]", getReferenceImageUsabilityClassName(image))}>
                  {getGenerationReferenceRoleLabel(image.role)}
                </span>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-warm-line/60 bg-warm-bg px-2 py-2 text-[11px] text-warm-muted">
          {emptyText}
        </div>
      )}
    </div>
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
  onCreateGenerationFrame,
  onCreateBlankGenerationFrame,
  onCreateProductAsset,
  onCreateModelAsset,
  onCreateSceneAsset,
  onCreateStyleAsset,
  onCreateKnowledgeNode,
  onCreateCopyNode,
  onSetNodeRole,
  onAddNodeToGenerationFrame,
  onOpenNodePreview,
  onSaveNodeAsAsset,
  onDeleteNodeById,
  onDropAsset,
  onDropComponent,
  onUploadProduct,
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
  onCreateGenerationFrame: (params: {
    sourceNodeId: string;
    actionId: LineGenerationActionId;
    position: XYPosition;
  }) => void;
  onCreateBlankGenerationFrame: (position?: XYPosition, actionId?: LineGenerationActionId) => void;
  onCreateProductAsset: (position?: XYPosition) => void;
  onCreateModelAsset: (position?: XYPosition) => void;
  onCreateSceneAsset: (position?: XYPosition) => void;
  onCreateStyleAsset: (position?: XYPosition) => void;
  onCreateKnowledgeNode: (position?: XYPosition) => void;
  onCreateCopyNode: (text: string, position: XYPosition) => void;
  onSetNodeRole: (nodeId: string, role: GenerationFrameRole) => void;
  onAddNodeToGenerationFrame: (nodeId: string, targetFrameId?: string) => void;
  onOpenNodePreview: (nodeId: string) => void;
  onSaveNodeAsAsset: (nodeId: string) => void;
  onDeleteNodeById: (nodeId: string) => void;
  onDropAsset: (assetId: string, position: XYPosition, targetFrameId?: string) => void;
  onDropComponent: (componentId: string, position: XYPosition, targetFrameId?: string) => void;
  onUploadProduct: (file: File, targetFrameId?: string, position?: XYPosition) => void;
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
      if (attempt < 8) {
        timeoutId = window.setTimeout(focusNodes, 45);
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

  const openToolbarImageImport = useCallback(() => {
    const bounds = document.querySelector("[data-canvas-stage]")?.getBoundingClientRect();
    const pointer = bounds
      ? {
          x: bounds.left + bounds.width * 0.42,
          y: bounds.top + bounds.height * 0.38,
        }
      : {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        };
    pendingImageImportRef.current = {
      position: reactFlow.screenToFlowPosition(pointer),
    };
    imageImportInputRef.current?.click();
  }, [reactFlow]);

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
    if (action === "create-generation-frame") {
      onCreateBlankGenerationFrame(position);
      return;
    }
    if (action === "create-product-asset") {
      onCreateProductAsset(position);
      return;
    }
    if (action === "create-model-asset") {
      onCreateModelAsset(position);
      return;
    }
    if (action === "create-scene-asset") {
      onCreateSceneAsset(position);
      return;
    }
    if (action === "create-style-asset") {
      onCreateStyleAsset(position);
      return;
    }
    if (action === "create-knowledge-asset") {
      onCreateKnowledgeNode(position);
      return;
    }
    const frameActionId = getFrameActionIdFromContextAction(action);
    if (frameActionId) {
      onCreateBlankGenerationFrame(position, frameActionId);
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
    if (action === "add-to-generation-frame") {
      onAddNodeToGenerationFrame(context.nodeId);
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
    onAddNodeToGenerationFrame,
    onCreateBlankGenerationFrame,
    onCreateModelAsset,
    onCreateKnowledgeNode,
    onCreateProductAsset,
    onCreateSceneAsset,
    onCreateStyleAsset,
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
      onCreateGenerationFrame({
        sourceNodeId: lineActionMenu.sourceNodeId,
        actionId,
        position: lineActionMenu.position,
      });
      setLineActionMenu(null);
    },
    [lineActionMenu, onCreateGenerationFrame]
  );

  return (
    <div
      className="h-full min-h-[420px] overflow-hidden border-y border-warm-line/50 bg-warm-bg sm:min-h-[520px] lg:min-h-0 lg:border-x lg:border-y-0"
      data-canvas-stage
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onContextMenuCapture={(event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest(".react-flow__node")) return;
        openPaneContextMenu(event);
      }}
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
      <div className="flex h-full min-h-[420px] flex-col sm:min-h-[520px] lg:min-h-0">
        <div className="flex flex-col gap-2 border-b border-warm-line/40 bg-warm-paper/70 px-3 py-1.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-warm-line/60 bg-warm-bg px-2.5 text-xs font-medium text-warm-ink transition hover:border-warm-primary/40 hover:text-warm-primary"
              type="button"
              onClick={openToolbarImageImport}
              title="导入一张素材到画布"
            >
              <Upload className="h-3.5 w-3.5" />
              导入素材
            </button>
            <span className="hidden truncate text-[11px] text-warm-muted xl:inline">
              拖入素材，或直接让 Agent 规划一组图
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              className="rounded-md p-1.5 text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink disabled:opacity-35"
              type="button"
              title="撤销"
              disabled={!canUndo}
              onClick={onUndo}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button
              className="rounded-md p-1.5 text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink disabled:opacity-35"
              type="button"
              title="重做"
              disabled={!canRedo}
              onClick={onRedo}
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
            <button
              className="rounded-md p-1.5 text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink disabled:opacity-35"
              type="button"
              title="复制节点"
              disabled={!canEditSelectedNode}
              onClick={onDuplicateNode}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button
              className="rounded-md p-1.5 text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink disabled:opacity-35"
              type="button"
              title="删除节点"
              disabled={!canEditSelectedNode}
              onClick={onDeleteNode}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button
              className="rounded-md p-1.5 text-warm-muted transition hover:bg-warm-soft hover:text-warm-ink disabled:opacity-40"
              type="button"
              title="保存画布"
              disabled={savingWorkflow}
              onClick={onSaveWorkflow}
            >
              {savingWorkflow ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute left-8 top-8 z-10 max-w-[360px] rounded-xl border border-dashed border-warm-line/70 bg-warm-paper/75 px-4 py-3 text-sm shadow-sm backdrop-blur">
              <div className="flex items-center gap-2 font-medium text-warm-ink">
                <Sparkles className="h-4 w-4 text-warm-primary" />
                空画布
              </div>
              <p className="mt-1 text-xs leading-5 text-warm-muted">
                拖入商品、模特、场景或文案；也可以直接在右侧告诉 Agent 要做什么。
              </p>
            </div>
          )}
          <ReactFlow
            className="h-full"
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={canvasNodeTypes}
            onNodeClick={(_, node) => onSelectNode(node.id)}
            onPaneClick={() => setContextMenu(null)}
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
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.45}
            maxZoom={1.65}
            nodesDraggable
            nodesConnectable
            elementsSelectable
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#DDD0C0" gap={24} />
            <Controls className="!border !border-warm-line/60 !bg-warm-paper !shadow-sm" />
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

function CanvasBottomDock({
  activePanel,
  outputCount,
  activeJobCount,
  onToggleAssets,
  onCreateTemplateFrame,
  onOpenStatus,
}: {
  activePanel: "assets" | null;
  outputCount: number;
  activeJobCount: number;
  onToggleAssets: () => void;
  onCreateTemplateFrame: () => void;
  onOpenStatus: () => void;
}) {
  return (
    <div className="absolute inset-x-0 bottom-20 z-40 flex justify-center px-3 lg:inset-x-auto lg:bottom-4 lg:left-20 lg:justify-start">
      <nav
        className="flex items-center gap-1 rounded-full border border-warm-line/70 bg-warm-paper/95 p-1 text-xs text-warm-muted shadow-lg backdrop-blur"
        aria-label="画布快捷操作"
      >
        <button
          type="button"
          onClick={onToggleAssets}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full px-3 font-medium transition",
            activePanel === "assets"
              ? "bg-warm-primary text-warm-paper shadow-sm"
              : "hover:bg-warm-soft hover:text-warm-ink"
          )}
        >
          <ImageIcon className="h-3.5 w-3.5" />
          素材库
        </button>
        <button
          type="button"
          onClick={onCreateTemplateFrame}
          className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 font-medium transition hover:bg-warm-soft hover:text-warm-ink"
        >
          <Sparkles className="h-3.5 w-3.5" />
          新建框
        </button>
        <button
          type="button"
          onClick={onOpenStatus}
          className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 font-medium transition hover:bg-warm-soft hover:text-warm-ink"
        >
          <PackageCheck className="h-3.5 w-3.5" />
          进度
          {(outputCount > 0 || activeJobCount > 0) && (
            <span className="ml-0.5 rounded-full bg-warm-bg px-1.5 py-0.5 text-[10px] leading-none text-warm-muted">
              {outputCount}/{activeJobCount}
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
      aria-label="选择生成框类型"
    >
      <div className="border-b border-warm-line/50 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="block truncate text-xs font-medium text-warm-ink">
              新建生成框
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-warm-muted">
              来自 {sourceLabel}
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
  onUseTrayItemAsAssetPackReference,
  onFavoritesOnlyChange,
  onRenameAsset,
  onToggleFavoriteAsset,
  onDeleteLibraryItem,
  onChangeAssetCategory,
  onSelectAsset,
  onSelectComponent,
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
  onUseTrayItemAsAssetPackReference: (item: AssetTrayItem) => void;
  onFavoritesOnlyChange: (value: boolean) => void;
  onRenameAsset: (item: AssetTrayItem) => void;
  onToggleFavoriteAsset: (item: AssetTrayItem) => void;
  onDeleteLibraryItem: (item: AssetTrayItem) => void;
  onChangeAssetCategory: (item: AssetTrayItem, category: CanvasLibraryCategory) => void;
  onSelectAsset: (assetId: string) => void;
  onSelectComponent: (componentId: string) => void;
  showGenerator?: boolean;
  showUpload?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedTrayItemId, setSelectedTrayItemId] = useState<string | undefined>();
  const visibleCategories = canvasLibraryCategories.filter((category) => category !== "平台" && category !== "质检");

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onUploadProduct(file);
    event.target.value = "";
  };

  const handleAddSelectedItemToGenerationFrame = (item: AssetTrayItem) => {
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
        previewAlt: getOptionalRecordString(component.metadata, "previewAlt") || component.title,
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
      previewAlt: asset.previewAlt ?? asset.title,
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
        secondaryActionLabel={showUpload ? (uploading ? "上传中" : "上传") : undefined}
        emptyMessage="还没有素材"
        onCategoryChange={(category) => onCategoryChange(category as CanvasLibraryCategory)}
        actionLabel={undefined}
        onAction={undefined}
        onSecondaryAction={() => inputRef.current?.click()}
        onSelectItem={(item) => {
          setSelectedTrayItemId(item.id);
        }}
        onRenameItem={onRenameAsset}
        onToggleFavorite={onToggleFavoriteAsset}
        onDeleteItem={onDeleteLibraryItem}
        footer={
          <AssetLibraryFooter
            selectedItem={trayItems.find((item) => item.id === selectedTrayItemId)}
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
            onUseTrayItemAsAssetPackReference={onUseTrayItemAsAssetPackReference}
            onAddSelectedItemToGenerationFrame={handleAddSelectedItemToGenerationFrame}
            onFavoritesOnlyChange={onFavoritesOnlyChange}
            onChangeAssetCategory={onChangeAssetCategory}
            showGenerator={showGenerator}
          />
        }
        compact
        showSearch={false}
        className={cn("max-h-[72svh] lg:max-h-none", className)}
      />
    </>
  );
}

function AssetLibraryFooter({
  selectedItem,
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
  onUseTrayItemAsAssetPackReference,
  onAddSelectedItemToGenerationFrame,
  onFavoritesOnlyChange,
  onChangeAssetCategory,
  showGenerator = true,
}: {
  selectedItem?: AssetTrayItem;
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
  onUseTrayItemAsAssetPackReference: (item: AssetTrayItem) => void;
  onAddSelectedItemToGenerationFrame: (item: AssetTrayItem) => void;
  onFavoritesOnlyChange: (value: boolean) => void;
  onChangeAssetCategory: (item: AssetTrayItem, category: CanvasLibraryCategory) => void;
  showGenerator?: boolean;
}) {
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const SelectedIcon = selectedItem?.icon ?? ImageIcon;
  const isAssetPackBusy = generatingAssetPack || savingAssetPack;
  const draftPreviewUrl = assetPackDraft ? getAssetPackPrimaryReferenceUrl(assetPackDraft) : "";
  const referenceLabel = getAssetPackReferenceUploadLabel(assetPackCategory);
  const referenceHint = getAssetPackReferenceUploadHint(assetPackCategory);
  const [assetGeneratorOpen, setAssetGeneratorOpen] = useState(false);
  const generatorOpen =
    showGenerator &&
    (assetGeneratorOpen ||
      Boolean(assetPackDraft) ||
      Boolean(assetPackRequest.trim()) ||
      assetPackReferenceUploads.length > 0 ||
      Boolean(assetPackMessage));
  const canGenerateAssetPack =
    Boolean(assetPackRequest.trim()) ||
    assetPackReferenceUploads.length > 0;

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
                onClick={() => onAddSelectedItemToGenerationFrame(selectedItem)}
                className="shrink-0 rounded-md bg-warm-primary px-2 py-1 text-[11px] font-medium text-warm-paper transition hover:bg-warm-primary/90"
                title="放入当前生成框；没有生成框时会自动创建"
              >
                放入生成框
              </button>
            )}
            {showGenerator && (
              <button
                type="button"
                disabled={!selectedItem.previewUrl}
                onClick={() => {
                  setAssetGeneratorOpen(true);
                  onUseTrayItemAsAssetPackReference(selectedItem);
                }}
              className="shrink-0 rounded-md bg-warm-primary-soft px-2 py-1 text-[11px] font-medium text-warm-primary transition hover:bg-warm-primary hover:text-warm-paper disabled:opacity-40"
                title={selectedItem.previewUrl ? `作为${referenceLabel}` : "这个素材没有预览图"}
              >
                用作参考
              </button>
            )}
          {selectedItem.id.startsWith("asset:") && (
          <label className="shrink-0 text-[11px] text-warm-muted">
              <select
                value={selectedItem.category}
                onChange={(event) =>
                  onChangeAssetCategory(selectedItem, event.target.value as CanvasLibraryCategory)
                }
              className="rounded-md border border-warm-line/50 bg-warm-paper px-2 py-1 text-[11px] text-warm-ink outline-none focus:border-warm-primary"
              >
                {canvasLibraryCategories
                  .filter((category) => category !== "平台" && category !== "质检")
                  .map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
      )}

      {showGenerator && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-warm-line/45 bg-warm-bg/75 px-2 py-1.5">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-warm-ink">资产生成器</div>
            <div className="mt-0.5 truncate text-[10px] text-warm-muted">
              需要时再打开；生成后满意再保存。
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAssetGeneratorOpen((value) => !value)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-warm-primary px-2.5 py-1.5 text-[11px] font-medium text-warm-paper transition hover:bg-warm-primary/90"
          >
            {assetGeneratorOpen ? <ChevronLeft className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
            {assetGeneratorOpen ? "收起" : "新建资产"}
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
            <button
              type="button"
              onClick={() => onFavoritesOnlyChange(!favoritesOnly)}
              className={cn(
                "rounded-full px-2 py-1 text-[10px] transition",
                favoritesOnly
                  ? "bg-warm-primary-soft text-warm-primary"
                  : "text-warm-muted hover:bg-warm-soft hover:text-warm-ink"
              )}
            >
              收藏
            </button>
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

        <div className="mt-2 grid gap-2 lg:grid-cols-[240px_minmax(0,1fr)_104px]">
          <div className="min-h-[66px] rounded-md border border-dashed border-warm-line/65 bg-warm-paper px-2 py-1.5">
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
                    className="group relative h-9 w-9 shrink-0 overflow-hidden rounded border border-warm-line/60 bg-warm-bg"
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
          <textarea
            value={assetPackRequest}
            onChange={(event) => onAssetPackRequestChange(event.target.value)}
            rows={2}
            className="min-h-[66px] resize-none rounded-md border border-warm-line/55 bg-warm-paper px-2.5 py-2 text-xs leading-snug text-warm-ink outline-none transition placeholder:text-warm-muted/60 focus:border-warm-primary"
            placeholder={
              assetPackCategory === "product_asset"
                ? "可选：补充商品名、材质、要保留的细节"
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
            className="inline-flex min-h-[66px] items-center justify-center gap-1.5 rounded-md bg-warm-primary px-3 py-2 text-xs font-medium text-warm-paper transition hover:bg-warm-primary/90 disabled:opacity-50"
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
  composeBrief,
  composeMessage,
  composingWorkflow,
  generatingSample,
  hasAppliedWorkflow,
  hasProductReference,
  sampleOutputCount,
  workflowPlanPreview,
  onComposeBriefChange,
  onComposeWorkflow,
  onApplyWorkflowPlan,
  onDismissWorkflowPlan,
  onImportProduct,
  onGenerateSample,
}: {
  productAsset?: CanvasAsset;
  activeProductComponentTitle: string;
  composeBrief: string;
  composeMessage: string;
  composingWorkflow: boolean;
  generatingSample: boolean;
  hasAppliedWorkflow: boolean;
  hasProductReference: boolean;
  sampleOutputCount: number;
  workflowPlanPreview: WorkflowPlanPreview | null;
  onComposeBriefChange: (brief: string) => void;
  onComposeWorkflow: () => void;
  onApplyWorkflowPlan: () => void;
  onDismissWorkflowPlan: () => void;
  onImportProduct: () => void;
  onGenerateSample: () => void;
}) {
  const canCompose = !!composeBrief.trim() && !composingWorkflow;
  const agentPlan = workflowPlanPreview?.agentPlan;
  const productLabel = activeProductComponentTitle || productAsset?.title || "未选商品";
  const needsProduct = hasAppliedWorkflow && !hasProductReference && !workflowPlanPreview;
  const canGenerateSample = hasAppliedWorkflow && hasProductReference && !workflowPlanPreview;
  const agentUnderstanding = workflowPlanPreview
    ? `我会按${agentPlan?.shortLabel || "当前需求"}先出样张，再扩展完整图组。`
    : needsProduct
      ? "计划已经放好，先导入商品图。"
      : canGenerateSample
        ? `商品图已接入，可以先生成 ${sampleOutputCount} 张样张。`
        : "说一句需求，我来拆成图组计划。";
  const primaryAction = needsProduct
    ? onImportProduct
    : canGenerateSample
      ? onGenerateSample
      : onComposeWorkflow;
  const primaryDisabled = needsProduct
    ? false
    : canGenerateSample
      ? generatingSample
      : !canCompose;
  const primaryLabel = needsProduct
    ? "导入商品图"
    : canGenerateSample
      ? `生成 ${sampleOutputCount} 张样张`
      : "规划图组";
  const PrimaryIcon = needsProduct ? Upload : canGenerateSample ? Sparkles : Send;
  const requiredRoles = agentPlan?.requiredAssetRoles ?? [];
  const outputSlots = agentPlan?.outputSlots?.length
    ? agentPlan.outputSlots
    : workflowPlanPreview?.items.map((item) => ({
        id: item.id,
        label: item.title,
        purpose: item.purpose,
        ratio: item.ratio,
        samplePhase: true,
      })) ?? [];

  return (
    <div className="pointer-events-none absolute right-3 top-[96px] z-20 w-[min(380px,calc(100%-24px))] max-w-[380px]">
      <section className="pointer-events-auto overflow-hidden rounded-xl border border-warm-line/70 bg-warm-paper/95 shadow-2xl backdrop-blur">
        <div className="border-b border-warm-line/50 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-warm-primary-soft text-warm-primary">
                  <Bot className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-warm-ink">Agent</h3>
                  <p className="mt-0.5 truncate text-[11px] text-warm-muted">
                    {productLabel}
                  </p>
                </div>
              </div>
            </div>
            <span className="shrink-0 rounded bg-warm-bg px-2 py-1 text-[10px] text-warm-muted">
              画布主控
            </span>
          </div>
        </div>

        <div className="space-y-3 p-4">
          <div className="rounded-lg bg-warm-bg px-3 py-2.5">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-warm-primary-soft text-warm-primary">
                <Sparkles className="h-3 w-3" />
              </span>
              <p className="text-xs leading-5 text-warm-ink">{agentUnderstanding}</p>
            </div>
          </div>

          <textarea
            value={composeBrief}
            onChange={(event) => onComposeBriefChange(event.target.value)}
            rows={4}
            className="w-full resize-none rounded-lg border border-warm-line/70 bg-warm-bg px-3 py-2.5 text-sm leading-relaxed text-warm-ink outline-none transition placeholder:text-warm-muted/60 focus:border-warm-primary/60"
            placeholder="比如：羽绒服，淘宝详情页，雪山场景，带模特。"
          />

          <p className="text-[11px] leading-4 text-warm-muted">
            一句话即可。文案默认做图层。
          </p>

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
              {agentPlan && (
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  <QuickFlowMetric label="样张" value={`${agentPlan.sampleCount}`} active />
                  <QuickFlowMetric label="完整包" value={`${agentPlan.fullCount}`} active />
                  <QuickFlowMetric
                    label="文案"
                    value={agentPlan.copyPolicy.requestedMode === "burn_in" ? "带字" : "图层"}
                    active
                  />
                </div>
              )}
              {outputSlots.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-warm-muted">
                    输出槽位
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {outputSlots.slice(0, 7).map((slot) => (
                      <span
                        key={slot.id}
                        className={cn(
                          "max-w-full truncate rounded-md border px-2 py-1 text-[11px]",
                          slot.samplePhase
                            ? "border-warm-primary/25 bg-warm-primary-soft text-warm-primary"
                            : "border-warm-line/50 bg-warm-paper text-warm-muted"
                        )}
                        title={slot.purpose}
                      >
                        {slot.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={onApplyWorkflowPlan}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-warm-primary px-3 py-2 text-xs font-medium text-warm-paper transition hover:bg-warm-primary/90"
                >
                  <Save className="h-3.5 w-3.5" />
                  应用到画布
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

          {composeMessage && (
            <p className="rounded-md bg-warm-bg px-2.5 py-2 text-[11px] leading-4 text-warm-muted">
              {composeMessage}
            </p>
          )}

          <button
            type="button"
            disabled={primaryDisabled}
            onClick={primaryAction}
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
  }, [activeDrawerTool, showAdvancedControls]);

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
                        {selectedIsGenerationFrame ? "生成框" : selectedNode.data.kind === "asset" ? "资产" : "节点"}
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
                    生成框的资产、需求和图组结果都在画布里直接处理。
                  </div>
                ) : selectedReferenceContext ? (
                  <ReferenceContextMiniPanel context={selectedReferenceContext} />
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-warm-line bg-warm-bg px-3 py-4 text-xs leading-5 text-warm-muted">
                在画布右键新建生成框，或把商品节点连到空白处创建图组。
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
                    : "按需打开后台能力，不打断画布里的生成框。"}
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
              <div className="mt-3 grid grid-cols-2 gap-2">
                {drawerToolOptions.map((tool) => {
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
                        title="带参考图重试失败图片"
                      >
                        {runningJobId === item.job.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                        带参考图重试
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
                        title="带参考图重试失败图片"
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

function createGenerationFrameNode({
  action,
  sourceNode,
  position,
  index,
}: {
  action: LineGenerationAction;
  sourceNode: CanvasWorkbenchNode;
  position: XYPosition;
  index: number;
}): CanvasWorkbenchNode {
  const stamp = Date.now();
  const sourceType = getCanvasNodeSemanticType(sourceNode) ?? "unknown";
  const generationFrame = bindNodeToGenerationFrameSlot(
    migrateLegacyGenerationFrameData(
      {
        label: action.label,
        caption: action.caption,
        kind: "output",
        status: "ready",
        metrics: action.metrics,
        iconName: action.iconName,
        generationActionId: action.id,
        generationOutputType: action.outputType,
        promptPlaceholder: `描述你希望 ${sourceNode.data.label} 生成成什么画面`,
      },
      `generation-frame-${action.id}-${stamp}-${index}`
    ),
    sourceNode
  );
  const frameId = generationFrame.frameId ?? `generation-frame-${action.id}-${stamp}-${index}`;

  return {
    id: frameId,
    position: {
      x: position.x + 36,
      y: position.y - 24,
    },
    data: {
      label: action.label,
      caption: action.caption,
      kind: "output",
      status: "ready",
      metrics: action.metrics,
      iconName: action.iconName,
      type: "output",
      componentType: "generation_frame",
      source: "line-action-menu",
      generationActionId: action.id,
      generationOutputType: action.outputType,
      sourceNodeId: sourceNode.id,
      sourceNodeLabel: sourceNode.data.label,
      sourceNodeType: sourceType,
      promptPlaceholder: `描述你希望 ${sourceNode.data.label} 生成成什么画面`,
      generationFrame,
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
      label: "图组生成框",
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
      label: "图组生成框",
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

function getFrameActionIdFromContextAction(
  action: CanvasContextMenuAction
): LineGenerationActionId | undefined {
  if (action === "create-frame-custom-template") return "custom_template";
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

  return presets.map((preset, index) => {
    const copyText = preset.copyText ?? "";
    return {
      itemId: `${preset.id}-${index + 1}`,
      title: preset.title,
      type: preset.type,
      copyText,
      copyRenderMode: preset.copyRenderMode,
      prompt: [
        basePrompt,
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
      },
    };
  });
}

function getNextLibraryInsertPosition(
  nodes: CanvasWorkbenchNode[],
  selectedNode?: CanvasWorkbenchNode
): XYPosition {
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

function getGenerationFrameSlotItems(context: GenerationReferenceContext | undefined) {
  return generationFrameRoles.map((role) => {
    const roleContext = context?.roles[role];
    const images = context?.images.filter((image) => image.role === role) ?? [];
    return {
      role,
      label: getGenerationReferenceRoleLabel(role),
      title: roleContext?.title || "空槽位",
      ready: Boolean(roleContext),
      imageCount: images.length,
      providerImageCount: images.filter((image) => image.providerUsable).length,
    };
  });
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

function getGenerationFramePlanLabel(node: CanvasWorkbenchNode): string {
  const outputType = getStringValue(node.data.generationOutputType);
  if (outputType === "model_try_on") return "模特穿着图组 · 先建 1 个可审核任务";
  if (outputType === "handheld_product") return "手持产品图组 · 先建 1 个可审核任务";
  if (outputType === "scene_display") return "场景多角度图组 · 默认 5 张";
  if (outputType === "white_background") return "白底主图 · 先建 1 个可审核任务";
  if (outputType === "detail_page") return "详情页图组 · 先建 1 个可审核任务";
  if (outputType === "xiaohongshu_cover") return "小红书封面 · 先建 1 个可审核任务";
  if (outputType === "poster_set") return "海报组图 · 先建 1 个可审核任务";
  return "图组输出 · 先建 1 个可审核任务";
}

function getGenerationFrameCostHint(context: GenerationReferenceContext | undefined): string {
  const imageCount = context?.images.length ?? 0;
  const providerImageCount = context?.images.filter((image) => image.providerUsable).length ?? 0;
  return `创建后会出现在任务队列里；真正运行时预计 1 次图片生成调用。已带 ${imageCount} 张引用，${providerImageCount} 张可直接用于图生图。`;
}

function getGenerationFrameReferenceHint(context: GenerationReferenceContext | undefined): string {
  const productImages = context?.images.filter((image) => image.role === "product") ?? [];
  const providerProductImages = productImages.filter((image) => image.providerUsable);

  if (providerProductImages.length > 0) {
    return "商品图可直接作为视觉参考，模特、风格、场景会一起写入提示词和约束。";
  }
  if (productImages.length > 0) {
    return "商品已进入提示词和约束；当前图片类型只做文字锁定，不会直接传入图生图。";
  }
  if (context?.roles.product) {
    return "商品槽已有规则信息；补一张本地生成图后，图生图参考会更稳。";
  }
  return "建议先接入商品槽位，再创建任务，能减少只靠文字生成的偏差。";
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

function getArtifactPreviewUrl(artifact: PersistedGeneratedArtifact): string {
  return getStoredImagePreviewUrl(artifact.metadata) || artifact.url;
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
      imageUrl: model.imageUrl,
      referenceImage: model.imageUrl,
      referenceImages,
    },
    promptFragments,
    constraints,
    negativeRules,
    qualityRules,
  };
}

async function fetchPersistedJobs(workflowId: string | null): Promise<PersistedGenerationJob[]> {
  const query = workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : "";
  const response = await apiFetch(`/api/jobs${query}`, { cache: "no-store" });
  if (!response.ok) return [];

  const payload = await response.json();
  const list = Array.isArray(payload) ? payload : payload.jobs;
  return Array.isArray(list)
    ? (list.map(mapPersistedJob).filter(Boolean) as PersistedGenerationJob[])
    : [];
}

async function fetchPersistedJobQueueSnapshot(): Promise<PersistedJobQueueSnapshot | null> {
  const response = await apiFetch("/api/jobs/queue", { cache: "no-store" });
  if (!response.ok) return null;

  const payload = await response.json();
  return mapPersistedJobQueueSnapshot(payload?.queue);
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

async function fetchPersistedArtifacts(
  workflowId: string | null
): Promise<PersistedGeneratedArtifact[]> {
  const query = workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : "";
  const response = await apiFetch(`/api/artifacts${query}`, { cache: "no-store" });
  if (!response.ok) return [];

  const payload = await response.json();
  const list = Array.isArray(payload) ? payload : payload.artifacts;
  return Array.isArray(list)
    ? (list.map(mapPersistedArtifact).filter(Boolean) as PersistedGeneratedArtifact[])
    : [];
}

function getPersistedJobListSignature(jobs: PersistedGenerationJob[]): string {
  return jobs.map(getStageJobSignature).join("|");
}

function getPersistedArtifactListSignature(artifacts: PersistedGeneratedArtifact[]): string {
  return artifacts.map(getStageArtifactSignature).join("|");
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
    node.data.previewUrl === previewUrl
  ) {
    return node;
  }

  return {
    ...node,
    data: {
      ...node.data,
      status: "ready",
      previewUrl: previewUrl || node.data.previewUrl,
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

function getStageArtifactSignature(artifact: PersistedGeneratedArtifact): string {
  return [
    artifact.id,
    artifact.status,
    artifact.url,
    getArtifactPreviewUrl(artifact),
    artifact.nodeId,
    artifact.jobId,
    artifact.assetId,
    artifact.title,
    artifact.updatedAt,
    getStringValue(artifact.metadata.exportSpecId),
    getStringValue(artifact.metadata.naming),
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
      ].join("~")
    )
    .join(",");
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
    const outputs = outputsByNodeId.get(node.id);
    if (!outputs?.length) return node;

    const frame = mergeGenerationFrameOutputs(
      migrateLegacyGenerationFrameData(node.data, node.id),
      outputs
    );
    const status = getGenerationFrameStatusFromOutputs(frame.status, frame.outputs);
    const nextFrame = { ...frame, status };
    const nextStatus = mapGenerationFrameStatusToNodeStatus(status);
    const nextMetrics = updateGenerationFrameOutputMetrics(
      updateGenerationFrameSlotMetrics(node.data.metrics, nextFrame),
      nextFrame.outputs
    );

    const currentFrame = normalizeGenerationFrameState(node.data.generationFrame);
    const currentStatus = node.data.status;
    if (
      currentStatus === nextStatus &&
      getGenerationFrameStateSignature(currentFrame) === getGenerationFrameStateSignature(nextFrame) &&
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

function getArtifactReconcileSignature(
  nodes: CanvasWorkbenchNode[],
  edges: CanvasWorkbenchEdge[],
  artifacts: PersistedGeneratedArtifact[],
  hiddenArtifactNodeIds: string[]
): string {
  return [
    artifacts.map(getStageArtifactSignature).join("|"),
    hiddenArtifactNodeIds.slice().sort().join(","),
    nodes.map(getArtifactReconcileNodeSignature).join("|"),
    edges.map((edge) => `${edge.id}~${edge.source}~${edge.target}`).join("|"),
  ].join("::");
}

function getArtifactReconcileNodeSignature(node: CanvasWorkbenchNode): string {
  return [
    node.id,
    node.data.source,
    node.data.artifactId,
    node.data.previewUrl,
    node.data.artifactStatus,
    node.data.jobId,
    getGenerationFrameOutputSignature(
      normalizeGenerationFrameState(node.data.generationFrame).outputs
    ),
  ].join("~");
}

function reconcileArtifactResultNodes(
  nodes: CanvasWorkbenchNode[],
  edges: CanvasWorkbenchEdge[],
  artifacts: PersistedGeneratedArtifact[],
  hiddenArtifactNodeIds: string[] = []
): { nodes: CanvasWorkbenchNode[]; edges: CanvasWorkbenchEdge[] } {
  let nextNodes = nodes;
  let nextEdges = edges;
  const hiddenIds = new Set(hiddenArtifactNodeIds);

  for (const artifact of artifacts) {
    if (!artifact.url) continue;

    const sourceNode = artifact.nodeId
      ? nextNodes.find((node) => node.id === artifact.nodeId)
      : undefined;

    if (sourceNode) {
      const enrichedSourceNode = withNodeArtifact(sourceNode, artifact);
      if (enrichedSourceNode !== sourceNode) {
        nextNodes = nextNodes.map((node) =>
          node.id === sourceNode.id ? enrichedSourceNode : node
        );
      }
      if (isGenerationFrameNode(sourceNode)) {
        continue;
      }
    }

    if (hiddenIds.has(artifact.id)) {
      const hiddenNodeIds = new Set(
        nextNodes
          .filter((node) => isHiddenArtifactResultNode(node, hiddenArtifactNodeIds))
          .map((node) => node.id)
      );
      if (hiddenNodeIds.size > 0) {
        nextNodes = nextNodes.filter((node) => !hiddenNodeIds.has(node.id));
        nextEdges = nextEdges.filter(
          (edge) => !hiddenNodeIds.has(edge.source) && !hiddenNodeIds.has(edge.target)
        );
      }
      continue;
    }

    const resultNodeId = getArtifactResultNodeId(artifact);
    const existingResultNode = nextNodes.find(
      (node) => node.id === resultNodeId || (
        node.data.source === "artifact-history" && node.data.artifactId === artifact.id
      )
    );

    if (!sourceNode && !existingResultNode) {
      continue;
    }

    if (!existingResultNode) {
      nextNodes = [
        ...nextNodes,
        createArtifactResultNode(artifact, sourceNode, nextNodes.length),
      ];
    } else {
      const updatedResultNode = withArtifactResultNode(existingResultNode, artifact);
      if (updatedResultNode !== existingResultNode) {
        nextNodes = nextNodes.map((node) =>
          node.id === existingResultNode.id ? updatedResultNode : node
        );
      }
    }

    if (sourceNode) {
      const target = existingResultNode?.id ?? resultNodeId;
      const edgeId = getArtifactResultEdgeId(sourceNode.id, artifact);
      if (!nextEdges.some((edge) => edge.id === edgeId || (
        edge.source === sourceNode.id && edge.target === target
      ))) {
        nextEdges = [
          ...nextEdges,
          {
            id: edgeId,
            source: sourceNode.id,
            target,
            label: "输出产物",
            animated: false,
          },
        ];
      }
    }
  }

  return { nodes: nextNodes, edges: nextEdges };
}

function createArtifactResultNode(
  artifact: PersistedGeneratedArtifact,
  sourceNode: CanvasWorkbenchNode | undefined,
  index: number
): CanvasWorkbenchNode {
  const fallbackBounds = sourceNode ? null : getCanvasBounds([]);
  const artifactIndex = Math.max(0, index - initialCanvasNodes.length);
  const basePosition = sourceNode?.position ?? {
    x: fallbackBounds?.maxX ?? 960,
    y: fallbackBounds?.minY ?? 80,
  };

  return {
    id: getArtifactResultNodeId(artifact),
    position: {
      x: sourceNode ? basePosition.x + 360 : 360 + (artifactIndex % 3) * 320,
      y: sourceNode
        ? basePosition.y + 320 + (index % 3) * 320
        : 675 + Math.floor(artifactIndex / 3) * 330,
    },
    data: createArtifactResultNodeData(artifact, sourceNode),
  };
}

function withArtifactResultNode(
  node: CanvasWorkbenchNode,
  artifact: PersistedGeneratedArtifact
): CanvasWorkbenchNode {
  const previewUrl = getArtifactPreviewUrl(artifact);
  if (
    node.data.artifactId === artifact.id &&
    node.data.previewUrl === previewUrl &&
    node.data.label === artifact.title
  ) {
    return node;
  }

  return {
    ...node,
    data: {
      ...node.data,
      ...createArtifactResultNodeData(artifact, undefined),
      caption: node.data.caption,
    },
  };
}

function createArtifactResultNodeData(
  artifact: PersistedGeneratedArtifact,
  sourceNode: CanvasWorkbenchNode | undefined
): CanvasWorkbenchNode["data"] {
  const providerLabel = artifact.provider || "产物历史";
  const nodeLabel = sourceNode?.data.label;

  return {
    label: artifact.title,
    caption: nodeLabel ? `由 ${nodeLabel} 生成的输出产物` : "从产物历史恢复的输出节点",
    kind: "output",
    status: mapArtifactToNodeStatus(artifact.status),
    metrics: [
      getArtifactStatusLabel(artifact.status),
      providerLabel,
      artifact.model || "默认模型",
    ].filter(Boolean).slice(0, 4),
    iconName: "output",
    previewUrl: getArtifactPreviewUrl(artifact),
    previewAlt: artifact.title,
    artifactId: artifact.id,
    artifactStatus: artifact.status,
    artifactCreatedAt: artifact.createdAt,
    jobId: artifact.jobId,
    assetId: artifact.assetId,
    linkedNodeId: artifact.nodeId,
    source: "artifact-history",
    category: "输出",
  };
}

function getArtifactResultNodeId(artifact: PersistedGeneratedArtifact): string {
  return `artifact-node-${artifact.id}`;
}

function getArtifactResultEdgeId(sourceNodeId: string, artifact: PersistedGeneratedArtifact): string {
  return `artifact-edge-${sourceNodeId}-${artifact.id}`;
}

function mapArtifactToGenerationFrameOutput(
  artifact: PersistedGeneratedArtifact
): GenerationFrameOutput {
  return {
    id: artifact.id,
    artifactId: artifact.id,
    jobId: artifact.jobId,
    nodeId: artifact.nodeId,
    title: artifact.title,
    url: artifact.url,
    previewUrl: getArtifactPreviewUrl(artifact),
    status: artifact.status,
    createdAt: artifact.createdAt,
    metadata: artifact.metadata,
  };
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
      prompt: job.prompt,
      jobStatus: job.status,
      jobError: job.error,
      artifactId: artifact?.id,
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

function getArtifactResultNodeArtifactId(node: CanvasWorkbenchNode): string | null {
  if (node.data.source !== "artifact-history") return null;
  return typeof node.data.artifactId === "string" ? node.data.artifactId : null;
}

function isHiddenArtifactResultNode(
  node: CanvasWorkbenchNode,
  hiddenArtifactNodeIds: string[]
): boolean {
  const artifactId = getArtifactResultNodeArtifactId(node);
  return !!artifactId && hiddenArtifactNodeIds.includes(artifactId);
}

function isArtifactLinkedToNode(
  artifact: PersistedGeneratedArtifact,
  node: CanvasWorkbenchNode
): boolean {
  const resultNodeId = getArtifactResultNodeId(artifact);
  const artifactId = typeof node.data.artifactId === "string" ? node.data.artifactId : "";
  const linkedNodeId = typeof node.data.linkedNodeId === "string" ? node.data.linkedNodeId : "";
  const jobId = typeof node.data.jobId === "string" ? node.data.jobId : "";
  const assetId = typeof node.data.assetId === "string" ? node.data.assetId : "";

  return (
    artifact.nodeId === node.id ||
    resultNodeId === node.id ||
    artifactId === artifact.id ||
    linkedNodeId === artifact.nodeId ||
    linkedNodeId === resultNodeId ||
    (!!artifact.jobId && jobId === artifact.jobId) ||
    (!!artifact.assetId && assetId === artifact.assetId)
  );
}

function getHiddenArtifactNodeIds(metadata?: Record<string, unknown>): string[] {
  const value = metadata?.hiddenArtifactNodeIds;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && !!item.trim());
}

function addUniqueString(items: string[], item: string): string[] {
  return items.includes(item) ? items : [...items, item];
}

function mapArtifactToNodeStatus(status: string): CanvasWorkbenchNode["data"]["status"] {
  if (status === "failed") return "review";
  if (status === "running") return "running";
  if (status === "draft" || status === "queued" || status === "pending") return "queued";
  return "ready";
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

function toFlowNode(node: CanvasWorkbenchNode, selected: boolean): CanvasFlowNode {
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
  return undefined;
}

function getReferenceRoleFromComponentType(type?: string): GenerationReferenceRole | undefined {
  if (type === "product" || type === "product_asset") return "product";
  if (type === "model" || type === "model_asset") return "model";
  if (type === "style" || type === "visual_style" || type === "brand_kit" || type === "prompt_source") {
    return "style";
  }
  if (type === "scene") return "scene";
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
  return nodes.find((node) => isCanvasProductNode(node) && hasExplicitProductReference(node));
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
      metrics: ["文案", `已拆 ${itemCount} 条`, "可拖进生成框"],
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
      metrics: ["知识", "规则", "可拖进生成框"],
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
  return /(烧进|带字|直接出字|画面文字|图中文字|海报标题|封面标题|图片上写|写上|加字|burn[\s-]?in|in-image|render text)/i.test(value);
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
    value === "style_asset"
  ) {
    return value;
  }
  if (value === "product") return "product_asset";
  if (value === "model") return "model_asset";
  if (value === "scene") return "scene_asset";
  if (value === "style" || value === "visual_style") return "style_asset";
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
  return "风格资产";
}

function getAssetPackReferenceRole(category: AssetPackCategory): string {
  if (category === "product_asset") return "product";
  if (category === "model_asset") return "model";
  if (category === "scene_asset") return "scene";
  return "style";
}

function getAssetPackReferenceUploadLabel(category: AssetPackCategory): string {
  if (category === "product_asset") return "商品参考图";
  if (category === "model_asset") return "模特参考图";
  if (category === "scene_asset") return "场景参考图";
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
  return "根据上传的参考图整理成一张可复用视觉风格参考图，提取色彩、光线、镜头、构图、材质感和商业摄影质感，不绑定具体商品或人物。";
}

function getAssetPackDefaultDescription(category: AssetPackCategory, request: string): string {
  if (category === "product_asset") return `商品身份资产：${request}`;
  if (category === "model_asset") return `人物身份资产：${request}`;
  if (category === "scene_asset") return `商业场景资产：${request}`;
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
  return "style";
}

function mapAssetPackCategoryToComponentType(category: AssetPackCategory): string {
  if (category === "scene_asset") return "scene";
  if (category === "style_asset") return "visual_style";
  return category;
}

function mapAssetPackCategoryToLibraryCategory(category: AssetPackCategory): CanvasLibraryCategory {
  if (category === "product_asset") return "商品";
  if (category === "model_asset") return "模特";
  if (category === "scene_asset") return "场景";
  return "风格";
}

function mapCanvasLibraryCategoryToAssetType(category: CanvasLibraryCategory): string {
  if (category === "商品") return "product";
  if (category === "模特") return "model";
  if (category === "风格") return "style";
  if (category === "场景") return "scene";
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
  if (!canRetryJob(job)) return false;
  const source = typeof job.metadata.source === "string" ? job.metadata.source : "";
  return source === "batch-image-api" || source === "batch-image-api-retry";
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

function GenerationFrameWorkOrder({
  node,
  context,
  onPromptChange,
}: {
  node: CanvasWorkbenchNode;
  context?: GenerationReferenceContext;
  onPromptChange: (nodeId: string, prompt: string) => void;
}) {
  const slots = getGenerationFrameSlotItems(context);
  const readyCount = slots.filter((slot) => slot.ready).length;
  const request = getStringValue(node.data.generationUserRequest) ?? "";

  return (
    <div className="mt-3 rounded-md border border-warm-line/50 bg-warm-paper p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-warm-ink">
            <ListChecks className="h-3.5 w-3.5 text-warm-primary" />
            生成框工作单
          </div>
          <p className="mt-1 text-[11px] leading-4 text-warm-muted">
            {getGenerationFramePlanLabel(node)}
          </p>
        </div>
        <span className="shrink-0 rounded bg-warm-bg px-1.5 py-0.5 text-[10px] text-warm-muted">
          槽位 {readyCount}/4
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {slots.map((slot) => (
          <GenerationFrameSlotPill key={slot.role} slot={slot} />
        ))}
      </div>

      <label className="mt-3 block text-[11px] font-medium text-warm-ink" htmlFor={`generation-request-${node.id}`}>
        一句话需求
      </label>
      <textarea
        id={`generation-request-${node.id}`}
        value={request}
        onChange={(event) => onPromptChange(node.id, event.target.value)}
        rows={3}
        className="mt-1.5 w-full resize-none rounded-md border border-warm-line/70 bg-warm-bg px-2.5 py-2 text-xs leading-snug text-warm-ink outline-none transition placeholder:text-warm-muted/60 focus:border-warm-primary/60"
        placeholder={getStringValue(node.data.promptPlaceholder) ?? "例如：生成 4 张高端商务模特图，保持商品颜色和结构不变"}
      />

      <div className="mt-3 rounded-md border border-warm-line/40 bg-warm-bg px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-warm-ink">生成计划</span>
          <span className="rounded bg-warm-paper px-1.5 py-0.5 text-[10px] text-warm-muted">
            {getGenerationFrameSlotSummary(context)}
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-4 text-warm-muted">
          {getGenerationFrameCostHint(context)}
        </p>
        <p className="mt-1 text-[11px] leading-4 text-warm-muted">
          {getGenerationFrameReferenceHint(context)}
        </p>
      </div>
    </div>
  );
}

function GenerationFrameSlotPill({
  slot,
}: {
  slot: {
    role: GenerationReferenceRole;
    label: string;
    title: string;
    ready: boolean;
    imageCount: number;
    providerImageCount: number;
  };
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border px-2 py-1.5",
        slot.ready
          ? "border-warm-primary/25 bg-warm-primary-soft"
          : "border-warm-line/40 bg-warm-bg"
      )}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className={cn("text-[10px] font-medium", slot.ready ? "text-warm-primary" : "text-warm-muted")}>
          {slot.label}
        </span>
        <span className={cn("text-[10px]", slot.ready ? "text-warm-primary" : "text-warm-muted")}>
          {slot.ready ? "已接入" : "待接入"}
        </span>
      </div>
      <div className="mt-0.5 truncate text-[11px] font-medium text-warm-ink">
        {slot.title}
      </div>
      <div className="mt-0.5 text-[10px] text-warm-muted">
        {slot.ready ? `${slot.imageCount} 图 / ${slot.providerImageCount} 可直用` : "拖入或连线补充"}
      </div>
    </div>
  );
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

function getArtifactStatusLabel(status: string): string {
  if (status === "ready" || status === "done" || status === "completed") return "完成";
  if (status === "running") return "生成中";
  if (status === "failed") return "失败";
  if (status === "draft") return "草稿";
  return status || "产物";
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
