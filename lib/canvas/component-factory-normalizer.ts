import type { GeneratedCanvasComponent } from "@/lib/ai/client";
import { normalizeComponentMetadata, normalizeComponentRules } from "@/lib/canvas/component-schema";
import type { CreateComponentParams, StandardComponentType } from "@/lib/types";

export interface CanvasComponentFactoryInput {
  factoryItem: {
    id?: string;
    title?: string;
    description?: string;
  };
  productAsset?: {
    title?: string;
    description?: string;
  } | null;
  existingNodes?: {
    id?: string;
    label?: string;
    kind?: string;
  }[];
}

export function normalizeFactorySuggestionToComponent(
  input: CanvasComponentFactoryInput,
  suggestion: GeneratedCanvasComponent
): CreateComponentParams {
  const type = inferComponentType(input, suggestion);
  const metrics = toStringArray(suggestion.metrics);
  const title = cleanText(suggestion.title, input.factoryItem.title || "AI Component");
  const description = cleanText(suggestion.caption, input.factoryItem.description || "");
  const factoryKey = createFactoryKey(input.factoryItem.id, title, type);
  const promptFragments = [description, ...metrics].filter(Boolean);

  const metadata = normalizeComponentMetadata(type, {
    componentType: type,
    label: title,
    factoryKey,
    factoryItem: {
      id: input.factoryItem.id || "",
      title: input.factoryItem.title || "",
      description: input.factoryItem.description || "",
    },
    canvasSuggestion: {
      kind: suggestion.kind || "",
      status: suggestion.status || "",
      iconName: suggestion.iconName || "",
      sourceId: suggestion.sourceId || "",
      edgeLabel: suggestion.edgeLabel || "",
      metrics,
    },
    productAsset: input.productAsset || null,
    parameters: createParameters(type, input, suggestion, metrics),
    promptFragments,
    constraints: createConstraints(type, metrics),
    qualityRules: createQualityRules(type, metrics),
    compatibleWith: createCompatibleTypes(type),
    source: {
      kind: "generated",
      referenceId: input.factoryItem.id || factoryKey,
      rawText: JSON.stringify({
        factoryItem: input.factoryItem,
        suggestion,
      }),
    },
  });

  return {
    type,
    title,
    description,
    status: "draft",
    rules: normalizeComponentRules({
      constraints: metadata.constraints,
      qualityRules: metadata.qualityRules,
    }),
    metadata,
  };
}

export function getFactoryComponentDuplicateKeys(component: {
  title?: string;
  type?: string;
  metadata?: Record<string, unknown>;
}): string[] {
  const keys = new Set<string>();
  const metadata = component.metadata || {};
  const factoryKey = typeof metadata.factoryKey === "string" ? metadata.factoryKey.trim() : "";
  if (factoryKey) keys.add(`factoryKey:${factoryKey}`);

  const source = metadata.source;
  const sourceKind =
    source && typeof source === "object" && !Array.isArray(source)
      ? String((source as Record<string, unknown>).kind || "").trim()
      : "";
  const title = cleanText(component.title, "");
  const componentType =
    typeof metadata.componentType === "string" && metadata.componentType.trim()
      ? metadata.componentType.trim()
      : String(component.type || "").trim();

  if (sourceKind && title && componentType) {
    keys.add(`sourceTitle:${sourceKind}:${componentType}:${title.toLowerCase()}`);
  }

  return Array.from(keys);
}

function inferComponentType(
  input: CanvasComponentFactoryInput,
  suggestion: GeneratedCanvasComponent
): StandardComponentType {
  const factoryId = input.factoryItem.id || "";
  const text = `${input.factoryItem.title || ""} ${input.factoryItem.description || ""} ${
    suggestion.title || ""
  } ${suggestion.caption || ""} ${suggestion.iconName || ""}`.toLowerCase();

  if (factoryId === "factory-review" || text.includes("质检") || text.includes("review")) {
    return "quality_rule";
  }
  if (factoryId === "factory-export") {
    return text.includes("规则") || text.includes("rule") ? "platform_rule" : "output_pack";
  }
  if (factoryId === "factory-detail") {
    return text.includes("输出包") || text.includes("pack") ? "output_pack" : "image_recipe";
  }
  if (factoryId === "factory-model") {
    return text.includes("输出包") || text.includes("pack") ? "output_pack" : "image_recipe";
  }
  if (factoryId === "factory-brief") {
    return input.productAsset?.title || text.includes("商品") || text.includes("product")
      ? "product_asset"
      : "prompt_source";
  }

  if (suggestion.kind === "review") return "quality_rule";
  if (suggestion.kind === "output") return "output_pack";
  if (suggestion.kind === "asset") return "product_asset";
  return "image_recipe";
}

function createParameters(
  type: StandardComponentType,
  input: CanvasComponentFactoryInput,
  suggestion: GeneratedCanvasComponent,
  metrics: string[]
): Record<string, unknown> {
  const productTitle = input.productAsset?.title || "";
  const productDescription = input.productAsset?.description || "";
  const purpose = suggestion.caption || input.factoryItem.description || "";

  switch (type) {
    case "product_asset":
      return {
        category: productTitle,
        images: [],
        invariants: metrics,
        sellingPoints: [productDescription].filter(Boolean),
        forbiddenChanges: ["Do not alter product structure, material, color, or logo regions."],
      };
    case "prompt_source":
      return {
        rawPrompt: purpose,
        extractedStyleRules: metrics,
        extractedSceneRules: [],
        extractedCameraRules: [],
        extractedNegativeRules: [],
        compatibleRecipes: [],
        riskNotes: [],
      };
    case "platform_rule":
      return {
        platform: input.factoryItem.title || "",
        aspectRatios: metrics,
        safeAreas: [],
        textAllowance: "",
        backgroundRestrictions: [],
        exportNaming: suggestion.edgeLabel || "",
        formats: [],
      };
    case "quality_rule":
      return {
        checks: metrics.length > 0 ? metrics : [purpose].filter(Boolean),
        thresholds: {},
        scoreWeights: {},
        blockingIssues: [],
      };
    case "output_pack":
      return {
        channels: metrics,
        deliverables: [suggestion.title].filter(Boolean),
        fileNaming: suggestion.edgeLabel || "",
        includeManifest: true,
        includeQaReport: true,
      };
    case "image_recipe":
    default:
      return {
        purpose,
        shotList: metrics,
        compositionRules: [suggestion.edgeLabel].filter(Boolean),
        copyRequirements: [],
        outputCount: inferOutputCount(metrics),
      };
  }
}

function createConstraints(type: StandardComponentType, metrics: string[]): string[] {
  if (type === "product_asset") {
    return ["Keep product identity stable across generated outputs.", ...metrics];
  }
  if (type === "platform_rule") {
    return ["Respect platform-specific dimensions, safe areas, and export naming.", ...metrics];
  }
  return metrics;
}

function createQualityRules(type: StandardComponentType, metrics: string[]): string[] {
  if (type === "quality_rule") return metrics;
  if (type === "product_asset") {
    return ["Preserve product structure, color, material, and logo regions."];
  }
  return [];
}

function createCompatibleTypes(type: StandardComponentType): string[] {
  switch (type) {
    case "product_asset":
    case "prompt_source":
      return ["image_recipe", "output_pack", "quality_rule"];
    case "image_recipe":
      return ["product_asset", "visual_style", "scene", "platform_rule", "output_pack"];
    case "platform_rule":
      return ["image_recipe", "output_pack"];
    case "output_pack":
      return ["image_recipe", "platform_rule", "quality_rule"];
    case "quality_rule":
      return ["product_asset", "image_recipe", "output_pack"];
    default:
      return [];
  }
}

function createFactoryKey(
  factoryId: string | undefined,
  title: string,
  type: StandardComponentType
): string {
  return `canvas-factory:${factoryId || "unknown"}:${type}:${slugify(title)}`;
}

function inferOutputCount(metrics: string[]): number {
  const joined = metrics.join(" ");
  const match = joined.match(/(\d+)/);
  return match ? Math.max(1, Number(match[1])) : 1;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function cleanText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]/g, "")
    .slice(0, 64) || "component";
}
