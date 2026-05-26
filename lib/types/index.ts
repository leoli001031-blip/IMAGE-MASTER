// 产品识别结果
export interface ProductAnalysis {
  category: string;
  features: string[];
  usageScenario: string;
  recommendedStyle: string;
  modelInteraction: string;
}

// 图组规划 - 单张图的计划
export interface ImagePlanItem {
  type: "main" | "selling_point" | "poster";
  title: string;
  prompt: string;
  copyText: string;
}

// 图组规划
export interface ImagePlan {
  images: ImagePlanItem[];
}

// 生成结果 - 单张图
export interface GeneratedImage {
  id: string;
  url: string;
  type: string;
  copyText: string;
  title?: string;
  prompt?: string;
  error?: string;
  errorCode?: string;
  diagnostics?: Record<string, unknown>;
  metadata: {
    style: string;
    modelIds?: string[];
    [key: string]: unknown;
  };
}

// 画布资产
export type AssetType =
  | "product"
  | "model"
  | "style"
  | "scene"
  | "output"
  | "platform"
  | "quality";

export interface Asset {
  id: string;
  type: AssetType;
  title: string;
  description: string;
  status: string;
  url: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAssetParams {
  type: AssetType;
  title: string;
  description?: string;
  status?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export type UpdateAssetParams = Partial<CreateAssetParams>;

// 画布组件系统
export type StandardComponentType =
  | "product_asset"
  | "model_asset"
  | "visual_style"
  | "scene"
  | "platform_rule"
  | "quality_rule"
  | "output_pack"
  | "brand_kit"
  | "prompt_source"
  | "image_recipe";

export type LegacyComponentType = "product" | "model" | "style" | "prompt";

export type ComponentType = StandardComponentType | LegacyComponentType;

export interface Component {
  id: string;
  type: ComponentType;
  title: string;
  description: string;
  status: string;
  version: number;
  assetId: string;
  rules: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ComponentPort {
  id: string;
  label: string;
  type: string;
  required?: boolean;
}

export interface ComponentSource {
  kind: "manual" | "upload" | "ai_import" | "template" | "generated" | "legacy";
  referenceId?: string;
  rawText?: string;
}

export interface ComponentTemplateMetadata extends Record<string, unknown> {
  schemaVersion: number;
  componentType: StandardComponentType;
  label: string;
  inputs: ComponentPort[];
  outputs: ComponentPort[];
  parameters: Record<string, unknown>;
  constraints: string[];
  promptFragments: string[];
  negativeRules: string[];
  qualityRules: string[];
  compatibleWith: string[];
  source: ComponentSource;
}

export interface ComponentVersion {
  componentId: string;
  version: number;
  snapshot: Component;
  createdAt: string;
}

export interface CreateComponentParams {
  type: ComponentType;
  title: string;
  description?: string;
  status?: string;
  version?: number;
  assetId?: string;
  rules?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type UpdateComponentParams = Partial<CreateComponentParams>;

// 画布工作流
export interface WorkflowNode {
  id: string;
  type?: string;
  title?: string;
  caption?: string;
  status?: string;
  position: {
    x: number;
    y: number;
  };
  data: Record<string, unknown>;
  assetId?: string;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
}

export interface Workflow {
  id: string;
  title: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowParams {
  title: string;
  description?: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  metadata?: Record<string, unknown>;
}

export type UpdateWorkflowParams = Partial<CreateWorkflowParams>;

// 工作流模板
export type WorkflowTemplateCategory =
  | "model_display"
  | "product_detail_page"
  | "platform_output_pack"
  | "poster_set"
  | "quality_review";

export type WorkflowTemplateStatus = "draft" | "published" | "archived";

export interface WorkflowTemplate {
  id: string;
  title: string;
  description: string;
  category: WorkflowTemplateCategory;
  status: WorkflowTemplateStatus;
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowTemplateParams {
  title: string;
  category: WorkflowTemplateCategory;
  description?: string;
  status?: WorkflowTemplateStatus;
  version?: number;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  metadata?: Record<string, unknown>;
}

export type UpdateWorkflowTemplateParams = Partial<CreateWorkflowTemplateParams>;

// 生成任务
export interface GenerationJob {
  id: string;
  workflowId?: string;
  nodeId?: string;
  assetId?: string;
  status: string;
  prompt: string;
  resultUrl: string;
  error: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGenerationJobParams {
  workflowId?: string;
  nodeId?: string;
  assetId?: string;
  status?: string;
  prompt?: string;
  resultUrl?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export type UpdateGenerationJobParams = Partial<CreateGenerationJobParams>;

// 生成产物
export interface GeneratedArtifact {
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

export interface CreateGeneratedArtifactParams {
  workflowId?: string;
  nodeId?: string;
  jobId?: string;
  assetId?: string;
  type?: string;
  title: string;
  status?: string;
  url?: string;
  prompt?: string;
  provider?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export type UpdateGeneratedArtifactParams = Partial<CreateGeneratedArtifactParams>;

// 模特资产
export interface ModelReferenceProfile {
  identityRegion: string;
  age: number;
  gender: string;
  temperament: string;
  beautyStyle: string;
  hair: string;
  makeup: string;
  faceAnchors: string;
  marketContext: string;
  bodyProfile: string;
  wardrobe: string;
}

export interface ModelAssetMetadata extends Record<string, unknown> {
  schemaVersion: 1;
  source: "model-template";
  sourceParams: CreateModelParams;
  profile: ModelReferenceProfile;
  identityAnchors: string[];
  consistencyRules: string[];
  poseRules: string[];
  usageRules: string[];
  safetyRules: string[];
  promptFragments: string[];
  constraints: string[];
  negativeRules: string[];
  qualityRules: string[];
  referenceImages: string[];
  promptSnapshot?: string;
}

export interface AIModel {
  id: string;
  gender: "male" | "female";
  ethnicity: "asian" | "european" | "african";
  age: number;
  temperament: string;
  bodyType: string;
  hairStyle?: string;
  makeup?: string;
  imageUrl: string;
  promptSnapshot: string;
  metadata?: ModelAssetMetadata;
  createdAt: string;
  updatedAt?: string;
}

// 创建模特参数（用户输入）
export interface CreateModelParams {
  gender: "male" | "female";
  ethnicity: "asian" | "european" | "african";
  age: number;
  temperament: string;
  bodyType: string;
  hairStyle?: string;
  makeup?: string;
}

// 生成任务选项
export interface GenerateOptions {
  useCases: string[];
  style: string;
  modelIds: string[];
  productInfo?: {
    name?: string;
    category?: string;
    sellingPoints: string[];
  };
}

// 生成状态
export type GenerateStatus =
  | "idle"
  | "uploading"
  | "analyzing"
  | "planning"
  | "generating"
  | "done"
  | "error";

// 用途选项
export const USE_CASE_OPTIONS = [
  { id: "ecommerce", label: "电商主图" },
  { id: "social", label: "小红书图" },
  { id: "website", label: "官网图" },
  { id: "poster", label: "宣传海报" },
  { id: "detail", label: "详情页图" },
  { id: "all", label: "全部生成" },
] as const;

// 风格选项
export const STYLE_OPTIONS = [
  { id: "minimal", label: "高级简洁", description: "干净、留白" },
  { id: "tech", label: "科技感", description: "未来、几何" },
  { id: "warm", label: "温暖生活", description: "自然、柔和" },
  { id: "vibrant", label: "年轻鲜艳", description: "鲜艳、活力" },
] as const;

// 模特参数选项
export const MODEL_OPTIONS = {
  gender: [
    { id: "female", label: "女" },
    { id: "male", label: "男" },
  ],
  ethnicity: [
    { id: "asian", label: "亚洲" },
    { id: "european", label: "欧美" },
    { id: "african", label: "非洲" },
  ],
  temperament: [
    { id: "intellectual", label: "知性" },
    { id: "energetic", label: "活力" },
    { id: "gentle", label: "温柔" },
    { id: "business", label: "商务" },
    { id: "cool", label: "酷感" },
  ],
  bodyType: [
    { id: "slim", label: "苗条" },
    { id: "standard", label: "标准" },
    { id: "athletic", label: "健美" },
  ],
  hairStyle: [
    { id: "long", label: "长发" },
    { id: "short", label: "短发" },
    { id: "mid", label: "中长发" },
    { id: "tied", label: "束发" },
  ],
  makeup: [
    { id: "natural", label: "裸妆" },
    { id: "light", label: "淡妆" },
  ],
} as const;
