import { COMPONENT_TYPE_LABELS, normalizeComponentType } from "@/lib/canvas/component-schema";
import type { StandardComponentType, WorkflowNode } from "@/lib/types";
import type { WorkflowComposeInput, WorkflowDraft } from "@/lib/canvas/workflow-composer";

export type EditableParameterType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "string_list"
  | "object_list"
  | "json"
  | "select";

export interface EditableParameterField {
  key: string;
  label: string;
  type: EditableParameterType;
  value: unknown;
  options?: string[];
  placeholder?: string;
  helperText?: string;
}

export interface EditableParameterGroup {
  nodeId: string;
  nodeType: StandardComponentType;
  title: string;
  fields: EditableParameterField[];
}

export interface WorkflowPlanPreviewItem {
  id: string;
  title: string;
  purpose: string;
  slot: string;
  ratio: string;
  size?: string;
  platform?: string;
  componentRefs: string[];
  qualityChecks: string[];
}

export interface WorkflowPlanPreviewComponentRef {
  nodeId: string;
  nodeType: StandardComponentType;
  title: string;
  componentId: string;
  seedKey?: string;
}

export interface WorkflowPlanPreviewQualityCheck {
  nodeId: string;
  title: string;
  checks: string[];
  blockingIssues: string[];
  thresholds?: Record<string, unknown>;
}

export interface WorkflowPlanPreview {
  title: string;
  summary: string;
  items: WorkflowPlanPreviewItem[];
  images: WorkflowPlanPreviewItem[];
  componentRefs: WorkflowPlanPreviewComponentRef[];
  qualityChecks: WorkflowPlanPreviewQualityCheck[];
  estimatedCount: number;
  editableParameters: EditableParameterGroup[];
  agentPlan?: WorkflowPlanPreviewAgentPlan;
}

export interface WorkflowPlanPreviewAgentPlan {
  skillId: string;
  title: string;
  shortLabel: string;
  sampleCount: number;
  fullCount: number;
  requiredAssetRoles: string[];
  optionalAssetRoles: string[];
  copyPolicy: {
    defaultMode: string;
    requestedMode: string;
    allowBurnIn: boolean;
    note: string;
  };
  phases: Array<{
    id: string;
    label: string;
    description: string;
  }>;
  outputSlots: Array<{
    id: string;
    label: string;
    purpose: string;
    ratio: string;
    samplePhase: boolean;
  }>;
}

const EDITABLE_NODE_TYPES = new Set<StandardComponentType>([
  "product_asset",
  "image_recipe",
  "output_pack",
  "platform_rule",
  "quality_rule",
]);

const PARAMETER_LABELS: Record<string, string> = {
  aspectRatios: "Aspect ratios",
  backgroundRestrictions: "Background restrictions",
  blockingIssues: "Blocking issues",
  category: "Category",
  channels: "Channels",
  checks: "Checks",
  compositionRules: "Composition rules",
  copyRequirements: "Copy requirements",
  deliverables: "Deliverables",
  exportNaming: "Export naming",
  fileNaming: "File naming",
  forbiddenChanges: "Forbidden changes",
  formats: "Formats",
  images: "Reference images",
  includeManifest: "Include manifest",
  includeQaReport: "Include QA report",
  invariants: "Product invariants",
  outputCount: "Output count",
  platform: "Platform",
  purpose: "Purpose",
  safeAreas: "Safe areas",
  scoreWeights: "Score weights",
  sellingPoints: "Selling points",
  shotList: "Shot list",
  textAllowance: "Text allowance",
  thresholds: "Thresholds",
};

const PARAMETER_PLACEHOLDERS: Record<string, string> = {
  category: "e.g. commuter tote, skincare serum, desk lamp",
  exportNaming: "{sku}_{platform}_{slot}_{index}.png",
  fileNaming: "{sku}_{slot}_{index}.png",
  platform: "Taobao",
  purpose: "Describe what this image set should accomplish",
  textAllowance: "Describe whether copy, badges, or overlays are allowed",
};

const PLATFORM_OPTIONS = ["Taobao", "Xiaohongshu", "Amazon", "Storefront", "Campaign review"];

export function buildWorkflowPlanPreview(
  workflowDraft: WorkflowDraft,
  input?: WorkflowComposeInput
): WorkflowPlanPreview {
  const nodes = workflowDraft.nodes;
  const recipeNode = findNodeByType(nodes, "image_recipe");
  const outputPackNode = findNodeByType(nodes, "output_pack");
  const platformNode = findNodeByType(nodes, "platform_rule");
  const qualityNodes = nodes.filter((node) => getNodeType(node) === "quality_rule");

  const recipeParams = getNodeParameters(recipeNode);
  const outputParams = getNodeParameters(outputPackNode);
  const platformParams = getNodeParameters(platformNode);
  const componentRefs = buildComponentRefs(nodes);
  const qualityChecks = buildQualityChecks(qualityNodes);
  const items = buildPreviewItems({
    recipeParams,
    outputParams,
    platformParams,
    componentRefs,
    qualityChecks,
  });
  const estimatedCount = items.length || toPositiveInteger(recipeParams.outputCount, 1);

  return {
    title: workflowDraft.title,
    summary: buildSummary(workflowDraft, input, estimatedCount, componentRefs, qualityChecks),
    items,
    images: items,
    componentRefs,
    qualityChecks,
    estimatedCount,
    editableParameters: buildEditableParameterGroups(nodes),
    agentPlan: buildAgentPlan(workflowDraft.metadata),
  };
}

function buildAgentPlan(metadata: Record<string, unknown>): WorkflowPlanPreviewAgentPlan | undefined {
  const agentSkill = getRecord(metadata.agentSkill);
  const skillId = toOptionalString(agentSkill.id);
  if (!skillId) return undefined;
  const copyPolicy = getRecord(agentSkill.copyPolicy);
  const campaignBible = getRecord(metadata.campaignBible);
  const executionPolicy = getRecord(campaignBible.executionPolicy);
  return {
    skillId,
    title: toNonEmptyString(agentSkill.title, "Agent workflow"),
    shortLabel: toNonEmptyString(agentSkill.shortLabel, "Agent"),
    sampleCount: toPositiveInteger(executionPolicy.sampleCount, toPositiveInteger(agentSkill.sampleCount, 0)),
    fullCount: toPositiveInteger(agentSkill.fullCount, 0),
    requiredAssetRoles: toStringArray(agentSkill.requiredAssetRoles),
    optionalAssetRoles: toStringArray(agentSkill.optionalAssetRoles),
    copyPolicy: {
      defaultMode: toNonEmptyString(copyPolicy.defaultMode, "layout_layer"),
      requestedMode: toNonEmptyString(copyPolicy.requestedMode, "layout_layer"),
      allowBurnIn: copyPolicy.allowBurnIn === true,
      note: toNonEmptyString(copyPolicy.note, "Copy stays editable unless explicitly burned in."),
    },
    phases: toRecordArray(agentSkill.phases).map((phase, index) => ({
      id: toNonEmptyString(phase.id, `phase_${index + 1}`),
      label: toNonEmptyString(phase.label, `Phase ${index + 1}`),
      description: toNonEmptyString(phase.description, ""),
    })),
    outputSlots: toRecordArray(agentSkill.outputSlots).map((slot, index) => ({
      id: toNonEmptyString(slot.id, `slot_${index + 1}`),
      label: toNonEmptyString(slot.label, `Slot ${index + 1}`),
      purpose: toNonEmptyString(slot.purpose, ""),
      ratio: toNonEmptyString(slot.ratio, "auto"),
      samplePhase: slot.samplePhase === true,
    })),
  };
}

function buildPreviewItems({
  recipeParams,
  outputParams,
  platformParams,
  componentRefs,
  qualityChecks,
}: {
  recipeParams: Record<string, unknown>;
  outputParams: Record<string, unknown>;
  platformParams: Record<string, unknown>;
  componentRefs: WorkflowPlanPreviewComponentRef[];
  qualityChecks: WorkflowPlanPreviewQualityCheck[];
}): WorkflowPlanPreviewItem[] {
  const shotList = toRecordArray(recipeParams.shotList);
  const deliverables = toRecordArray(outputParams.deliverables);
  const count = Math.max(
    shotList.length,
    deliverables.length,
    toPositiveInteger(recipeParams.outputCount, 0)
  );
  const qualityTitles = qualityChecks.flatMap((check) => check.checks).slice(0, 6);
  const componentIds = componentRefs.map((ref) => ref.nodeId);

  return Array.from({ length: count }, (_, index) => {
    const shot = shotList[index] || {};
    const deliverable = deliverables[index] || {};
    const slot = toNonEmptyString(shot.slot, toNonEmptyString(deliverable.slot, `image_${index + 1}`));
    const ratio = toNonEmptyString(shot.ratio, toNonEmptyString(deliverable.ratio, "auto"));
    const intent = toNonEmptyString(shot.intent, toNonEmptyString(recipeParams.purpose, "Generated commerce image"));
    const size = toOptionalString(shot.size) ?? toOptionalString(deliverable.size);

    return {
      id: `plan_item_${index + 1}`,
      title: humanizeKey(slot),
      purpose: intent,
      slot,
      ratio,
      ...(size ? { size } : {}),
      platform: toOptionalString(platformParams.platform),
      componentRefs: componentIds,
      qualityChecks: qualityTitles,
    };
  });
}

function buildComponentRefs(nodes: WorkflowNode[]): WorkflowPlanPreviewComponentRef[] {
  return nodes
    .map((node) => {
      const nodeType = getNodeType(node);
      if (!nodeType) return undefined;
      const seedKey = toOptionalString(node.data.seedKey);
      return {
        nodeId: node.id,
        nodeType,
        title: toNonEmptyString(node.title, toNonEmptyString(node.data.label, COMPONENT_TYPE_LABELS[nodeType])),
        componentId: toNonEmptyString(node.data.componentId, ""),
        ...(seedKey ? { seedKey } : {}),
      };
    })
    .filter((ref): ref is WorkflowPlanPreviewComponentRef => Boolean(ref));
}

function buildQualityChecks(nodes: WorkflowNode[]): WorkflowPlanPreviewQualityCheck[] {
  return nodes.map((node) => {
    const params = getNodeParameters(node);
    const checks = toStringArray(params.checks, toStringArray(node.data.qualityRules));
    return {
      nodeId: node.id,
      title: toNonEmptyString(node.title, toNonEmptyString(node.data.label, "Quality check")),
      checks,
      blockingIssues: toStringArray(params.blockingIssues),
      thresholds: getRecord(params.thresholds),
    };
  });
}

function buildEditableParameterGroups(nodes: WorkflowNode[]): EditableParameterGroup[] {
  return nodes
    .map((node) => {
      const nodeType = getNodeType(node);
      if (!nodeType || !EDITABLE_NODE_TYPES.has(nodeType)) return undefined;

      const parameters = getNodeParameters(node);
      const fields = Object.entries(parameters).map(([key, value]) => createParameterField(key, value));
      if (fields.length === 0) return undefined;

      return {
        nodeId: node.id,
        nodeType,
        title: toNonEmptyString(node.title, toNonEmptyString(node.data.label, COMPONENT_TYPE_LABELS[nodeType])),
        fields,
      };
    })
    .filter((group): group is EditableParameterGroup => Boolean(group));
}

function createParameterField(key: string, value: unknown): EditableParameterField {
  const field: EditableParameterField = {
    key,
    label: PARAMETER_LABELS[key] || humanizeKey(key),
    type: inferParameterType(key, value),
    value,
    placeholder: PARAMETER_PLACEHOLDERS[key],
  };

  if (key === "platform") {
    field.options = PLATFORM_OPTIONS;
  }
  if (field.type === "object_list") {
    field.helperText = "Edit as a structured list; each item may contain slot, ratio, size, or intent.";
  }
  if (field.type === "json") {
    field.helperText = "Structured object for advanced rules.";
  }

  return field;
}

function inferParameterType(key: string, value: unknown): EditableParameterType {
  if (key === "platform") return "select";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) return "string_list";
    if (value.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      return "object_list";
    }
    return "json";
  }
  if (value && typeof value === "object") return "json";
  if (typeof value === "string" && (value.length > 80 || key.toLowerCase().includes("allowance"))) {
    return "textarea";
  }
  return "text";
}

function buildSummary(
  workflowDraft: WorkflowDraft,
  input: WorkflowComposeInput | undefined,
  estimatedCount: number,
  componentRefs: WorkflowPlanPreviewComponentRef[],
  qualityChecks: WorkflowPlanPreviewQualityCheck[]
): string {
  const platforms = Array.isArray(workflowDraft.metadata.platforms)
    ? workflowDraft.metadata.platforms.filter((item): item is string => typeof item === "string")
    : input?.platforms || [];
  const platformText = platforms.length > 0 ? platforms.join(", ") : "selected platforms";
  const qualityText = qualityChecks.length > 0 ? `${qualityChecks.length} quality gate` : "quality gate";
  const agentSkill = getRecord(workflowDraft.metadata.agentSkill);
  const skillText = toOptionalString(agentSkill.shortLabel);
  const copyPolicy = getRecord(agentSkill.copyPolicy);
  const copyText = toOptionalString(copyPolicy.requestedMode) === "burn_in"
    ? "short copy burn-in requested"
    : "copy kept as editable layout layer";
  return `${skillText ? `${skillText}: ` : ""}${estimatedCount} planned image${estimatedCount === 1 ? "" : "s"} for ${platformText}, using ${componentRefs.length} workflow component${componentRefs.length === 1 ? "" : "s"}, ${qualityText}, ${copyText}.`;
}

function findNodeByType(nodes: WorkflowNode[], type: StandardComponentType): WorkflowNode | undefined {
  return nodes.find((node) => getNodeType(node) === type);
}

function getNodeType(node: WorkflowNode): StandardComponentType | undefined {
  return normalizeComponentType(node.data.componentType) || normalizeComponentType(node.type);
}

function getNodeParameters(node: WorkflowNode | undefined): Record<string, unknown> {
  return getRecord(node?.data.parameters);
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      !!item && typeof item === "object" && !Array.isArray(item)
  );
}

function toStringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function toPositiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : fallback;
}

function toNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function humanizeKey(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
