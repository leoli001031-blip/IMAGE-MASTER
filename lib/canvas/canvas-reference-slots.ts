import {
  type GenerationReferenceContext,
  type GenerationReferenceRole,
  isProviderUsableReferenceUrl,
  normalizeGenerationReferenceContext,
} from "@/lib/canvas/generation-reference-context";

export type CanvasReferenceRole = GenerationReferenceRole;

export type CanvasReferenceValidationStatus =
  | "provider_usable"
  | "prompt_only"
  | "missing_required"
  | "optional_missing"
  | "invalid";

export interface CanvasReferenceSlot {
  role: CanvasReferenceRole;
  required: boolean;
  acceptedComponentTypes: string[];
  sourceNodeId?: string;
  sourceAssetId?: string;
  sourceComponentId?: string;
  referenceUrl?: string;
  title?: string;
  providerUsable: boolean;
  validationStatus: CanvasReferenceValidationStatus;
  issues: string[];
}

export interface BuildCanvasReferenceSlotsOptions {
  referenceContext?: GenerationReferenceContext | unknown;
  requiredRoles?: CanvasReferenceRole[];
}

const referenceRoles: CanvasReferenceRole[] = ["product", "model", "style", "scene", "copy"];

const acceptedComponentTypes: Record<CanvasReferenceRole, string[]> = {
  product: ["product_asset", "product"],
  model: ["model_asset", "model"],
  style: ["visual_style", "brand_kit", "prompt_source", "style", "prompt"],
  scene: ["scene"],
  copy: ["copy", "copy_asset", "text", "text_asset", "claim", "copy_rules"],
};

const roleLabels: Record<CanvasReferenceRole, string> = {
  product: "商品图",
  model: "模特参考",
  style: "风格参考",
  scene: "场景参考",
  copy: "文案参考",
};

export function buildCanvasReferenceSlots({
  referenceContext,
  requiredRoles = [],
}: BuildCanvasReferenceSlotsOptions): CanvasReferenceSlot[] {
  const context = normalizeGenerationReferenceContext(referenceContext);
  const requiredSet = new Set(requiredRoles);

  return referenceRoles.map((role) => {
    const roleContext = context?.roles[role];
    const image = context?.images.find((entry) => entry.role === role);
    const sourceNodeId = roleContext?.sourceNodeIds[0] ?? image?.nodeId;
    const sourceAssetId = roleContext?.assetIds[0] ?? image?.assetId;
    const sourceComponentId = roleContext?.componentIds[0] ?? image?.componentId;
    const referenceUrl = image?.url;
    const providerUsable = image?.providerUsable === true || isProviderUsableReferenceUrl(referenceUrl);
    const required = requiredSet.has(role);
    const hasSource = !!(sourceNodeId || sourceAssetId || sourceComponentId || referenceUrl || roleContext);
    const issues: string[] = [];
    let validationStatus: CanvasReferenceValidationStatus;

    if (!hasSource) {
      validationStatus = required ? "missing_required" : "optional_missing";
      if (required) issues.push(`${roleLabels[role]}缺失`);
    } else if (referenceUrl && !providerUsable && role === "product") {
      validationStatus = "prompt_only";
      issues.push("商品图不是 provider 可用引用，只会进入 prompt 约束");
    } else if (referenceUrl && providerUsable) {
      validationStatus = "provider_usable";
    } else {
      validationStatus = "prompt_only";
    }

    return {
      role,
      required,
      acceptedComponentTypes: acceptedComponentTypes[role],
      sourceNodeId,
      sourceAssetId,
      sourceComponentId,
      referenceUrl,
      title: roleContext?.title ?? image?.title,
      providerUsable,
      validationStatus,
      issues,
    };
  });
}

export function getProviderUsableProductSlot(
  slots: CanvasReferenceSlot[]
): CanvasReferenceSlot | undefined {
  return slots.find((slot) => slot.role === "product" && slot.providerUsable);
}
