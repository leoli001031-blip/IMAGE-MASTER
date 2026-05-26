import type { CanvasWorkbenchNode } from "@/lib/canvas/workbench-data";

export type CanvasNodeSemanticType =
  | "product"
  | "style"
  | "model"
  | "scene"
  | "copy"
  | "factory"
  | "output"
  | "platform"
  | "review"
  | "quality";

export type CanvasConnectionNodeData = {
  label?: string;
  kind?: string;
  iconName?: string;
  category?: string;
  type?: string;
};

export type CanvasConnectionNode =
  | CanvasWorkbenchNode
  | {
      id?: string;
      type?: string;
      category?: string;
      data?: CanvasConnectionNodeData;
    };

type CanonicalCanvasNodeType = Exclude<CanvasNodeSemanticType, "quality">;

const canvasConnectionTargets: Record<CanonicalCanvasNodeType, CanonicalCanvasNodeType[]> = {
  product: ["style", "model", "scene", "copy", "factory", "output", "review", "platform"],
  style: ["output"],
  model: ["output"],
  scene: ["output"],
  copy: ["output", "platform", "review"],
  factory: ["factory", "output", "platform", "review"],
  output: ["review", "platform", "output"],
  platform: ["output", "review"],
  review: [],
};

const canvasConnectionLabels: Partial<
  Record<CanonicalCanvasNodeType, Partial<Record<CanonicalCanvasNodeType, string>>>
> = {
  product: {
    style: "风格参考",
    model: "上身",
    scene: "置景",
    copy: "提炼文案",
    factory: "组件化",
    output: "生成",
    platform: "适配",
    review: "基准质检",
  },
  style: {
    output: "风格化",
  },
  model: {
    output: "上身",
  },
  scene: {
    output: "置景",
  },
  copy: {
    output: "文案",
    platform: "适配",
    review: "合规",
  },
  factory: {
    factory: "细分",
    output: "生成",
    platform: "适配",
    review: "质检",
  },
  output: {
    review: "质检",
    platform: "适配",
    output: "派生",
  },
  platform: {
    output: "返工",
    review: "合规",
  },
};

const semanticTypeLabels: Record<CanonicalCanvasNodeType, string> = {
  product: "商品",
  style: "风格",
  model: "模特",
  scene: "场景",
  copy: "文案",
  factory: "工厂",
  output: "输出",
  platform: "平台",
  review: "质检",
};

const semanticTypeCandidates: Record<string, CanvasNodeSemanticType | undefined> = {
  product: "product",
  commodity: "product",
  sku: "product",
  style: "style",
  model: "model",
  scene: "scene",
  copy: "copy",
  text: "copy",
  claim: "copy",
  factory: "factory",
  ai: "factory",
  brief: "factory",
  component: "factory",
  generator: "factory",
  workflow: "factory",
  output: "output",
  result: "output",
  image: "output",
  images: "output",
  package: "platform",
  export: "platform",
  platform: "platform",
  review: "review",
  quality: "quality",
  qa: "quality",
  check: "quality",
  "商品": "product",
  "商品资产": "product",
  "风格": "style",
  "模特": "model",
  "场景": "scene",
  "文案": "copy",
  "卖点": "copy",
  "参数": "copy",
  "禁止声明": "copy",
  "工厂": "factory",
  "组件": "factory",
  "生成器": "factory",
  "商品-brief": "factory",
  "ai-商品-brief": "factory",
  "ai-组件": "factory",
  "平台": "platform",
  "质检": "quality",
  "输出": "output",
};

export function canConnectCanvasNodes(
  source: CanvasConnectionNode,
  target: CanvasConnectionNode
): boolean {
  if (source.id && target.id && source.id === target.id) return false;

  const sourceType = getCanonicalSemanticType(source);
  const targetType = getCanonicalSemanticType(target);

  if (!sourceType || !targetType) return false;
  return canvasConnectionTargets[sourceType].includes(targetType);
}

export function getConnectionLabel(
  source: CanvasConnectionNode,
  target: CanvasConnectionNode
): string {
  const sourceType = getCanonicalSemanticType(source);
  const targetType = getCanonicalSemanticType(target);

  if (!sourceType || !targetType) return "连接";
  return canvasConnectionLabels[sourceType]?.[targetType] ?? "连接";
}

export function getConnectionValidationMessage(
  source: CanvasConnectionNode,
  target: CanvasConnectionNode
): string | null {
  if (source.id && target.id && source.id === target.id) {
    return "不能连接到同一个节点。";
  }

  const sourceType = getCanonicalSemanticType(source);
  const targetType = getCanonicalSemanticType(target);

  if (!sourceType || !targetType) {
    return "无法识别节点类型，请先补充商品、风格、模特、场景、文案、工厂、输出、平台或质检语义。";
  }

  if (canvasConnectionTargets[sourceType].includes(targetType)) return null;

  const allowedTargets = canvasConnectionTargets[sourceType]
    .map((type) => semanticTypeLabels[type])
    .join("、");
  const targetLabel = semanticTypeLabels[targetType];
  const sourceLabel = semanticTypeLabels[sourceType];

  if (!allowedTargets) {
    return `${sourceLabel}节点主要用于接收结果，不建议继续向外连接。`;
  }

  return `${sourceLabel}节点不能连接到${targetLabel}节点，可连接到：${allowedTargets}。`;
}

export function getCanvasNodeSemanticType(
  node: CanvasConnectionNode
): CanvasNodeSemanticType | null {
  return resolveSemanticType(node);
}

function getCanonicalSemanticType(node: CanvasConnectionNode): CanonicalCanvasNodeType | null {
  const semanticType = resolveSemanticType(node);
  if (!semanticType) return null;
  return semanticType === "quality" ? "review" : semanticType;
}

function resolveSemanticType(node: CanvasConnectionNode): CanvasNodeSemanticType | null {
  const data = node.data;
  const rawCandidates = [
    data?.iconName,
    data?.type,
    getNodeType(node),
    data?.category,
    getNodeCategory(node),
    data?.kind,
    node.id,
    data?.label,
  ];

  for (const rawCandidate of rawCandidates) {
    const semanticType = normalizeSemanticType(rawCandidate);
    if (semanticType) return semanticType;
  }

  return null;
}

function getNodeType(node: CanvasConnectionNode): string | undefined {
  return "type" in node ? node.type : undefined;
}

function getNodeCategory(node: CanvasConnectionNode): string | undefined {
  return "category" in node ? node.category : undefined;
}

function normalizeSemanticType(value: unknown): CanvasNodeSemanticType | undefined {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "-");
  if (!normalized) return undefined;

  return semanticTypeCandidates[normalized] ?? semanticTypeCandidates[value.trim()];
}
