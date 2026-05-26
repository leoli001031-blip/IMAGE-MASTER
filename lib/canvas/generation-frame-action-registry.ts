import type { CanvasReferenceRole } from "@/lib/canvas/canvas-reference-slots";
import {
  generationFrameRoles,
  normalizeGenerationFrameState,
  type GenerationFrameRole,
  type GenerationFrameState,
} from "@/lib/canvas/generation-frame";
import { isProviderUsableReferenceUrl } from "@/lib/canvas/generation-reference-context";

export type GenerationFrameActionOutputType =
  | "product_asset"
  | "model_asset"
  | "custom_template"
  | "scene_asset"
  | "style_asset"
  | "knowledge_asset";

export interface GenerationFrameActionRule {
  outputType: GenerationFrameActionOutputType;
  label: string;
  requiredReferenceRoles: CanvasReferenceRole[];
  optionalReferenceRoles: CanvasReferenceRole[];
  allowTextOnly: boolean;
  emptyRunMessage?: string;
}

export interface GenerationFrameRunDecision {
  rule: GenerationFrameActionRule;
  canRun: boolean;
  message?: string;
  requiredReferenceRoles: CanvasReferenceRole[];
}

interface ResolveGenerationFrameRunRuleInput {
  outputType?: string;
  frame?: GenerationFrameState;
  userRequest?: string;
}

const defaultTemplateMessage = "写一句需求或拖入素材";

export const generationFrameActionRules: Record<
  GenerationFrameActionOutputType,
  GenerationFrameActionRule
> = {
  product_asset: {
    outputType: "product_asset",
    label: "商品资产",
    requiredReferenceRoles: ["product"],
    optionalReferenceRoles: [],
    allowTextOnly: false,
    emptyRunMessage: "先拖入商品图",
  },
  model_asset: {
    outputType: "model_asset",
    label: "模特资产",
    requiredReferenceRoles: [],
    optionalReferenceRoles: ["model"],
    allowTextOnly: true,
    emptyRunMessage: "写一句模特需求或拖入模特参考",
  },
  custom_template: {
    outputType: "custom_template",
    label: "模板生成",
    requiredReferenceRoles: [],
    optionalReferenceRoles: ["product", "model", "style", "scene", "copy"],
    allowTextOnly: true,
    emptyRunMessage: defaultTemplateMessage,
  },
  scene_asset: {
    outputType: "scene_asset",
    label: "场景资产",
    requiredReferenceRoles: [],
    optionalReferenceRoles: ["scene", "style", "product"],
    allowTextOnly: true,
    emptyRunMessage: "写一句场景需求或拖入参考",
  },
  style_asset: {
    outputType: "style_asset",
    label: "风格资产",
    requiredReferenceRoles: [],
    optionalReferenceRoles: ["style", "scene", "product"],
    allowTextOnly: true,
    emptyRunMessage: "写一句风格需求或拖入参考",
  },
  knowledge_asset: {
    outputType: "knowledge_asset",
    label: "知识卡",
    requiredReferenceRoles: [],
    optionalReferenceRoles: ["copy", "style", "scene", "product", "model"],
    allowTextOnly: true,
    emptyRunMessage: "写一句知识卡需求",
  },
};

export function getGenerationFrameActionRule(
  outputType: string | undefined
): GenerationFrameActionRule {
  const normalized = normalizeGenerationFrameActionOutputType(outputType);
  return generationFrameActionRules[normalized];
}

export function resolveGenerationFrameRunRule({
  outputType,
  frame,
  userRequest,
}: ResolveGenerationFrameRunRuleInput): GenerationFrameRunDecision {
  const rule = getGenerationFrameActionRule(outputType ?? frame?.outputType);
  const normalizedFrame = frame ? normalizeGenerationFrameState(frame) : undefined;
  const prompt = (userRequest ?? normalizedFrame?.prompt ?? "").trim();

  if (rule.requiredReferenceRoles.some((role) => !hasGenerationFrameReferenceRole(normalizedFrame, role))) {
    return {
      rule,
      canRun: false,
      message: rule.emptyRunMessage,
      requiredReferenceRoles: rule.requiredReferenceRoles,
    };
  }

  if (
    rule.allowTextOnly &&
    !prompt &&
    normalizedFrame &&
    !hasAnyGenerationFrameReference(normalizedFrame) &&
    rule.outputType !== "knowledge_asset"
  ) {
    return {
      rule,
      canRun: false,
      message: rule.emptyRunMessage ?? defaultTemplateMessage,
      requiredReferenceRoles: rule.requiredReferenceRoles,
    };
  }

  return {
    rule,
    canRun: true,
    requiredReferenceRoles: rule.requiredReferenceRoles,
  };
}

export function normalizeGenerationFrameActionOutputType(
  outputType: string | undefined
): GenerationFrameActionOutputType {
  const normalized = (outputType ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "product_asset" || normalized === "product_image") return "product_asset";
  if (normalized === "model_asset") return "model_asset";
  if (normalized === "custom_template" || normalized === "template") return "custom_template";
  if (normalized === "scene_asset") return "scene_asset";
  if (normalized === "style_asset" || normalized === "visual_style") return "style_asset";
  if (normalized === "knowledge_asset" || normalized === "knowledge") return "knowledge_asset";
  return "custom_template";
}

function hasAnyGenerationFrameReference(frame: GenerationFrameState): boolean {
  return getGenerationFrameBindings(frame).some(isConcreteGenerationFrameBinding);
}

function hasGenerationFrameReferenceRole(
  frame: GenerationFrameState | undefined,
  role: CanvasReferenceRole
): boolean {
  if (!frame || !isGenerationFrameRole(role)) return false;
  const bindings = getGenerationFrameBindings(frame).filter(
    (binding) => binding.role === role
  );
  if (bindings.length === 0) return false;
  // Product identity requires a real provider-usable image reference.
  // Other roles (copy, style, scene, model, knowledge) may be text assets.
  if (role === "product") {
    return bindings.some(isProductIdentityBinding);
  }
  return bindings.some(isConcreteGenerationFrameBinding);
}

/**
 * A binding that can serve as a real product identity source.
 *
 * Must carry a provider-usable image URL (data:image or a local generated-image
 * path).  Pure text fields (promptFragments, constraints, copyBrief) are NOT
 * sufficient for locking the physical product appearance — they are only
 * downstream guidance.
 */
function isProductIdentityBinding(
  binding: GenerationFrameState["assets"][number]
): boolean {
  return Boolean(binding.referenceUrl && isProviderUsableReferenceUrl(binding.referenceUrl));
}

function getGenerationFrameBindings(frame: GenerationFrameState) {
  const normalized = normalizeGenerationFrameState(frame);
  return normalized.assets.length > 0
    ? normalized.assets
    : generationFrameRoles
        .map((role) => normalized.slots[role])
        .filter((binding): binding is GenerationFrameState["assets"][number] => Boolean(binding));
}

function isConcreteGenerationFrameBinding(
  binding: GenerationFrameState["assets"][number]
): boolean {
  return Boolean(
    binding.referenceUrl ||
      binding.sourceAssetId ||
      binding.sourceNodeId ||
      binding.sourceComponentId ||
      binding.promptFragments.length > 0 ||
      binding.constraints.length > 0 ||
      binding.qualityRules.length > 0 ||
      binding.copyBrief
  );
}

function isGenerationFrameRole(role: CanvasReferenceRole): role is GenerationFrameRole {
  return generationFrameRoles.some((item) => item === role);
}
