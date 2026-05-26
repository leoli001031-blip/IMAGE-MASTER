import {
  BadgeCheck,
  Box,
  Brush,
  Camera,
  CheckCircle2,
  ClipboardList,
  Image,
  Images,
  Layers3,
  MonitorUp,
  PackageCheck,
  ScanSearch,
  Shirt,
  Sparkles,
  Store,
  Wand2,
  type LucideIcon,
} from "lucide-react";

export type CanvasLibraryCategory =
  | "商品"
  | "模特"
  | "风格"
  | "文案"
  | "平台"
  | "场景"
  | "质检";

export type CanvasNodeKind = "asset" | "factory" | "output" | "review";

export interface CanvasAsset {
  id: string;
  category: CanvasLibraryCategory;
  title: string;
  description: string;
  status: "ready" | "draft" | "checking";
  icon: LucideIcon;
  previewUrl?: string;
  referenceUrl?: string;
  previewAlt?: string;
  favorite?: boolean;
  rawMetadata?: Record<string, unknown>;
  source?: string;
  componentType?: string;
  parameters?: Record<string, unknown>;
  promptFragments?: string[];
  constraints?: string[];
  negativeRules?: string[];
  qualityRules?: string[];
}

export interface CanvasFactoryItem {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

export interface CanvasNodeData extends Record<string, unknown> {
  label: string;
  caption: string;
  kind: CanvasNodeKind;
  status: "ready" | "running" | "queued" | "review";
  metrics: string[];
  iconName: keyof typeof canvasIconMap;
  previewUrl?: string;
  previewAlt?: string;
  generationFrame?: import("./generation-frame").GenerationFrameState;
}

export interface CanvasWorkbenchNode {
  id: string;
  position: { x: number; y: number };
  data: CanvasNodeData;
}

export interface CanvasWorkbenchEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  animated?: boolean;
}

export const canvasIconMap = {
  product: Box,
  model: Shirt,
  style: Brush,
  scene: Camera,
  copy: ClipboardList,
  output: Images,
  platform: Store,
  review: ScanSearch,
  package: PackageCheck,
  knowledge: Layers3,
  ai: Wand2,
} as const;

export const canvasLibraryCategories: CanvasLibraryCategory[] = [
  "商品",
  "模特",
  "风格",
  "文案",
  "平台",
  "场景",
  "质检",
];

export const canvasAssets: CanvasAsset[] = [
  {
    id: "product-main",
    category: "商品",
    title: "主商品图",
    description: "透明底、材质、卖点已识别",
    status: "ready",
    icon: Box,
    previewUrl: "/canvas-assets/product-main.svg",
    previewAlt: "白色针织上衣商品图",
  },
  {
    id: "product-detail",
    category: "商品",
    title: "细节特写",
    description: "纹理、口袋、Logo 区域",
    status: "draft",
    icon: Image,
    previewUrl: "/canvas-assets/product-detail.svg",
    previewAlt: "商品细节纹理图",
  },
  {
    id: "model-daily",
    category: "模特",
    title: "日常通勤模特",
    description: "半身、自然站姿、轻商业感",
    status: "ready",
    icon: Shirt,
    previewUrl: "/canvas-assets/model-daily.svg",
    previewAlt: "日常通勤模特资产",
  },
  {
    id: "model-sport",
    category: "模特",
    title: "运动场景模特",
    description: "动态姿态、户外光线",
    status: "checking",
    icon: Sparkles,
    previewUrl: "/canvas-assets/model-sport.svg",
    previewAlt: "运动场景模特资产",
  },
  {
    id: "style-clean",
    category: "风格",
    title: "干净电商风",
    description: "柔光、低饱和、留白充足",
    status: "ready",
    icon: Brush,
    previewUrl: "/canvas-assets/style-clean.svg",
    previewAlt: "干净电商风格参考",
  },
  {
    id: "platform-taobao",
    category: "平台",
    title: "淘宝详情页",
    description: "首屏、卖点条、细节模块",
    status: "ready",
    icon: Store,
    previewUrl: "/canvas-assets/platform-taobao.svg",
    previewAlt: "淘宝详情页输出规格",
  },
  {
    id: "scene-cafe",
    category: "场景",
    title: "咖啡店生活场景",
    description: "暖调背景、真实陈列",
    status: "draft",
    icon: Camera,
    previewUrl: "/canvas-assets/scene-cafe.svg",
    previewAlt: "咖啡店生活场景参考",
  },
  {
    id: "quality-commerce",
    category: "质检",
    title: "商品一致性质检",
    description: "颜色、结构、Logo、手部遮挡",
    status: "ready",
    icon: CheckCircle2,
    previewUrl: "/canvas-assets/quality-commerce.svg",
    previewAlt: "商品一致性质检视图",
  },
];

export const canvasFactoryItems: CanvasFactoryItem[] = [
  {
    id: "factory-brief",
    title: "商品 Brief",
    description: "把上传图转成可复用商品组件",
    icon: ClipboardList,
  },
  {
    id: "factory-model",
    title: "模特展示图",
    description: "自动选择模特、姿势和场景",
    icon: Shirt,
  },
  {
    id: "factory-detail",
    title: "详情页模块",
    description: "生成卖点、细节、对比图组合",
    icon: Layers3,
  },
  {
    id: "factory-export",
    title: "平台输出包",
    description: "按渠道规格整理图集和文案",
    icon: MonitorUp,
  },
  {
    id: "factory-review",
    title: "AI 质检",
    description: "检查商品一致性和平台合规",
    icon: BadgeCheck,
  },
];

export const initialCanvasNodes: CanvasWorkbenchNode[] = [
  {
    id: "product",
    position: { x: 30, y: 170 },
    data: {
      label: "商品资产",
      caption: "上传图已转成商品组件",
      kind: "asset",
      status: "ready",
      metrics: ["材质: 棉质针织", "主色: 暖白", "卖点: 版型清爽"],
      iconName: "product",
      previewUrl: "/canvas-assets/product-main.svg",
      previewAlt: "白色针织上衣商品资产",
    },
  },
  {
    id: "brief",
    position: { x: 380, y: 105 },
    data: {
      label: "AI 商品 Brief",
      caption: "结构化卖点与不可变规则",
      kind: "factory",
      status: "ready",
      metrics: ["保留领口比例", "Logo 不得重绘", "袖长需一致"],
      iconName: "ai",
      previewUrl: "/canvas-assets/brief.svg",
      previewAlt: "商品 Brief 结构化分析",
    },
  },
  {
    id: "model",
    position: { x: 690, y: 0 },
    data: {
      label: "模特展示图",
      caption: "日常通勤半身展示",
      kind: "output",
      status: "ready",
      metrics: ["3 张", "4:5", "自然暖光"],
      iconName: "model",
      previewUrl: "/canvas-assets/output-model.svg",
      previewAlt: "模特展示图输出预览",
    },
  },
  {
    id: "detail",
    position: { x: 690, y: 320 },
    data: {
      label: "详情页模块",
      caption: "首屏、细节、卖点条",
      kind: "output",
      status: "ready",
      metrics: ["6 屏", "750px 宽", "中文文案"],
      iconName: "output",
      previewUrl: "/canvas-assets/output-detail.svg",
      previewAlt: "详情页模块输出预览",
    },
  },
  {
    id: "platform",
    position: { x: 1040, y: 140 },
    data: {
      label: "平台输出包",
      caption: "淘宝 / 小红书 / 站内 Banner",
      kind: "output",
      status: "ready",
      metrics: ["12 张", "命名规范", "含封面"],
      iconName: "platform",
      previewUrl: "/canvas-assets/output-platform.svg",
      previewAlt: "平台输出包图集预览",
    },
  },
  {
    id: "review",
    position: { x: 1040, y: 475 },
    data: {
      label: "AI 质检",
      caption: "一致性、遮挡、平台风险",
      kind: "review",
      status: "review",
      metrics: ["颜色偏差 < 8%", "Logo 检查", "手部遮挡"],
      iconName: "review",
      previewUrl: "/canvas-assets/quality-commerce.svg",
      previewAlt: "AI 质检结果预览",
    },
  },
];

export const initialCanvasEdges: CanvasWorkbenchEdge[] = [
  {
    id: "product-brief",
    source: "product",
    target: "brief",
    animated: true,
    label: "分析",
  },
  {
    id: "product-model",
    source: "product",
    target: "model",
    label: "穿搭展示",
  },
  {
    id: "brief-detail",
    source: "brief",
    target: "detail",
    animated: true,
    label: "编排",
  },
  {
    id: "model-platform",
    source: "model",
    target: "platform",
    label: "图集",
  },
  {
    id: "detail-platform",
    source: "detail",
    target: "platform",
    label: "页面",
  },
  {
    id: "platform-review",
    source: "platform",
    target: "review",
    animated: true,
    label: "质检",
  },
];
