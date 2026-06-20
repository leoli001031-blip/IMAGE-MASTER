import type { AssetType } from "@/lib/types";

export type GenerationOutputCanvasCategory = "商品" | "模特" | "场景" | "风格" | "平台";

export interface GenerationOutputAssetTargetInput {
  outputType?: unknown;
  frameOutputType?: unknown;
  artifactType?: unknown;
}

export interface GenerationOutputAssetTarget {
  assetType: AssetType;
  canvasCategory: GenerationOutputCanvasCategory;
  componentType?: string;
  savedAssetType: string;
  label: string;
  description: string;
  message: string;
}

export function resolveGenerationOutputAssetTarget({
  outputType,
  frameOutputType,
  artifactType,
}: GenerationOutputAssetTargetInput = {}): GenerationOutputAssetTarget {
  const normalized = normalizeOutputType(outputType) ||
    normalizeOutputType(frameOutputType) ||
    normalizeOutputType(artifactType);

  if (normalized.includes("product_asset") || normalized === "product" || normalized.includes("multiview")) {
    return {
      assetType: "product",
      canvasCategory: "商品",
      componentType: "product_asset",
      savedAssetType: "product_asset",
      label: "商品素材",
      description: "手动保存的商品资产，可拖到画布供 Agent 复用",
      message: "已保存为商品素材",
    };
  }

  if (normalized.includes("model_asset") || normalized === "model" || normalized.includes("identity_reference")) {
    return {
      assetType: "model",
      canvasCategory: "模特",
      componentType: "model_asset",
      savedAssetType: "model_asset",
      label: "模特素材",
      description: "手动保存的模特资产，可拖到画布供 Agent 复用",
      message: "已保存为模特素材",
    };
  }

  if (normalized.includes("scene_asset") || normalized === "scene") {
    return {
      assetType: "scene",
      canvasCategory: "场景",
      componentType: "scene",
      savedAssetType: "scene_asset",
      label: "场景素材",
      description: "手动保存的场景资产，可拖到画布供 Agent 复用",
      message: "已保存为场景素材",
    };
  }

  if (
    normalized.includes("style_asset") ||
    normalized.includes("visual_style") ||
    normalized === "style"
  ) {
    return {
      assetType: "style",
      canvasCategory: "风格",
      componentType: "visual_style",
      savedAssetType: "style_asset",
      label: "风格素材",
      description: "手动保存的风格资产，可拖到画布供 Agent 复用",
      message: "已保存为风格素材",
    };
  }

  return {
    assetType: "output",
    canvasCategory: "平台",
    savedAssetType: "output_reference",
    label: "输出参考",
    description: "手动保存到全局资产库的输出参考，可跨项目拖到画布供 Agent 复用",
    message: "已保存到素材库",
  };
}

function normalizeOutputType(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
    : "";
}
