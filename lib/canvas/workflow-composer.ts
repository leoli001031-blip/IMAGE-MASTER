import { normalizeComponentType } from "@/lib/canvas/component-schema";
import {
  selectWorkflowSkill,
  type WorkflowSkill,
} from "@/lib/canvas/workflow-skill-registry";
import {
  buildCampaignBible,
  buildCampaignShotList,
  type CampaignBible,
  type CampaignShot,
} from "@/lib/canvas/campaign-planning";
import {
  inferCopyRenderModeFromText,
  type CopyRenderMode,
} from "@/lib/canvas/copy-render-policy";
import type {
  Component,
  StandardComponentType,
  WorkflowEdge,
  WorkflowNode,
  WorkflowTemplate,
} from "@/lib/types";

export interface WorkflowComposeInput {
  brief: string;
  scenario?: string;
  productTitle?: string;
  productDescription?: string;
  componentIds?: string[];
  platforms?: string[];
  outputPacks?: string[];
  copyRenderMode?: CopyRenderMode;
}

export interface WorkflowDraft {
  title: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  metadata: Record<string, unknown>;
}

interface ComposeContext {
  components: Component[];
  templates: WorkflowTemplate[];
}

type ComponentBucket = Partial<Record<StandardComponentType, Component[]>>;

const DEFAULT_PLATFORMS = ["taobao"];
const FLOW_TYPES: StandardComponentType[] = [
  "product_asset",
  "visual_style",
  "scene",
  "image_recipe",
  "platform_rule",
  "quality_rule",
  "output_pack",
];

export function composeWorkflowDraft(
  input: WorkflowComposeInput,
  context: ComposeContext
): WorkflowDraft {
  const workflowSkill = selectWorkflowSkill(input);
  const normalizedInput = applyWorkflowSkillDefaults(input, workflowSkill);
  const brief = normalizedInput.brief.trim();
  const scenarioText = [normalizedInput.scenario, brief, normalizedInput.productTitle, normalizedInput.productDescription]
    .filter(Boolean)
    .join(" ");
  const selected = selectComponents(normalizedInput, context.components, scenarioText);
  const template = selectTemplate(normalizedInput, context.templates, scenarioText);
  const campaignBible = buildCampaignBible(normalizedInput, workflowSkill);
  const shotList = buildCampaignShotList(normalizedInput, workflowSkill);

  const nodes = createNodes(normalizedInput, selected, campaignBible, shotList);
  const edges = createEdges(nodes);
  const selectedSeedKeys = nodes
    .map((node) => node.data.seedKey)
    .filter((seedKey): seedKey is string => typeof seedKey === "string" && seedKey.length > 0);

  return {
    title: createTitle(normalizedInput, selected.image_recipe, workflowSkill),
    description: createDescription(normalizedInput, selected, template, workflowSkill),
    nodes,
    edges,
    metadata: {
      source: "workflow-compose",
      mode: "agent_workflow_skill",
      brief,
      scenario: normalizedInput.scenario?.trim() || "",
      productTitle: normalizedInput.productTitle?.trim() || "",
      platforms: normalizeStringArray(normalizedInput.platforms, workflowSkill.platforms),
      outputPacks: normalizeStringArray(normalizedInput.outputPacks, workflowSkill.outputPacks),
      requestedComponentIds: normalizeStringArray(normalizedInput.componentIds),
      agentSkill: buildWorkflowSkillMetadata(workflowSkill, normalizedInput.copyRenderMode),
      campaignBible,
      shotList,
      executionMode: "sample_first_then_full_pack",
      selectedSeedKeys,
      selectedComponentIds: nodes
        .map((node) => node.data.componentId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
      templateId: template?.id || "",
      templateTitle: template?.title || "",
    },
  };
}

function applyWorkflowSkillDefaults(
  input: WorkflowComposeInput,
  workflowSkill: WorkflowSkill
): WorkflowComposeInput {
  return {
    ...input,
    platforms: normalizeStringArray(input.platforms, workflowSkill.platforms),
    outputPacks: normalizeStringArray(input.outputPacks, workflowSkill.outputPacks),
    copyRenderMode:
      input.copyRenderMode ??
      inferCopyRenderModeFromText(input.brief) ??
      workflowSkill.defaultCopyRenderMode,
  };
}

function buildWorkflowSkillMetadata(
  workflowSkill: WorkflowSkill,
  copyRenderMode: CopyRenderMode | undefined
): Record<string, unknown> {
  return {
    id: workflowSkill.id,
    title: workflowSkill.title,
    shortLabel: workflowSkill.shortLabel,
    description: workflowSkill.description,
    requiredAssetRoles: workflowSkill.requiredAssetRoles,
    optionalAssetRoles: workflowSkill.optionalAssetRoles,
    sampleCount: workflowSkill.sampleCount,
    fullCount: workflowSkill.fullCount,
    copyPolicy: {
      defaultMode: workflowSkill.defaultCopyRenderMode,
      requestedMode: copyRenderMode ?? workflowSkill.defaultCopyRenderMode,
      allowBurnIn: workflowSkill.allowBurnInCopy,
      note: workflowSkill.allowBurnInCopy
        ? "Copy stays editable by default; burn-in can be tested when explicitly requested."
        : "Copy stays outside the bitmap for this workflow.",
    },
    phases: workflowSkill.phases,
    outputSlots: workflowSkill.outputSlots,
    qaRules: workflowSkill.qaRules,
  };
}

function selectComponents(
  input: WorkflowComposeInput,
  components: Component[],
  scenarioText: string
): ComponentBucket {
  const requestedIds = new Set(normalizeStringArray(input.componentIds));
  const requested = components.filter((component) => requestedIds.has(component.id));
  const pool = requested.length > 0 ? prioritizeRequested(components, requestedIds) : components;
  const buckets = bucketComponents(pool);
  const selected: ComponentBucket = {};

  for (const type of FLOW_TYPES) {
    if (type === "product_asset") {
      const explicitProduct = requested.find((component) => {
        const componentType = normalizeComponentType(component.metadata?.componentType) || normalizeComponentType(component.type);
        return componentType === "product_asset";
      });
      selected[type] = explicitProduct ? [explicitProduct] : [];
      continue;
    }
    selected[type] = [selectComponentForType(type, buckets[type] || [], input, scenarioText)].filter(
      Boolean
    ) as Component[];
  }

  return selected;
}

function prioritizeRequested(components: Component[], requestedIds: Set<string>): Component[] {
  return [...components].sort((a, b) => {
    const aRequested = requestedIds.has(a.id) ? 0 : 1;
    const bRequested = requestedIds.has(b.id) ? 0 : 1;
    return aRequested - bRequested;
  });
}

function bucketComponents(components: Component[]): ComponentBucket {
  const buckets: ComponentBucket = {};
  for (const component of components) {
    const type = normalizeComponentType(component.metadata?.componentType) || normalizeComponentType(component.type);
    if (!type) continue;
    buckets[type] = [...(buckets[type] || []), component];
  }
  return buckets;
}

function selectComponentForType(
  type: StandardComponentType,
  components: Component[],
  input: WorkflowComposeInput,
  scenarioText: string
): Component | undefined {
  if (components.length === 0) return undefined;
  const platformTerms = normalizeStringArray(input.platforms, DEFAULT_PLATFORMS);
  const outputTerms = normalizeStringArray(input.outputPacks);
  const text = `${scenarioText} ${platformTerms.join(" ")} ${outputTerms.join(" ")}`.toLowerCase();
  const scored = components.map((component, index) => ({
    component,
    score: scoreComponent(type, component, text, platformTerms, outputTerms) - index * 0.001,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.component;
}

function scoreComponent(
  type: StandardComponentType,
  component: Component,
  text: string,
  platforms: string[],
  outputPacks: string[]
): number {
  const haystack = [
    component.title,
    component.description,
    component.metadata?.seedKey,
    component.metadata?.label,
    ...(Array.isArray(component.metadata?.compatibleWith) ? component.metadata.compatibleWith : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let score = 0;

  for (const token of tokenize(text)) {
    if (haystack.includes(token)) score += 3;
  }
  for (const platform of platforms) {
    if (haystack.includes(platform.toLowerCase())) score += 8;
  }
  for (const pack of outputPacks) {
    if (haystack.includes(pack.toLowerCase())) score += 8;
  }
  if (type === "quality_rule" && haystack.includes("consistency")) score += 2;
  if (type === "image_recipe" && (haystack.includes("detail") || haystack.includes("model"))) score += 2;
  if (component.status === "published") score += 1;
  if (typeof component.metadata?.seedKey === "string") score += 1;

  return score;
}

function selectTemplate(
  input: WorkflowComposeInput,
  templates: WorkflowTemplate[],
  scenarioText: string
): WorkflowTemplate | undefined {
  const text = `${input.scenario || ""} ${scenarioText} ${normalizeStringArray(input.platforms).join(" ")}`.toLowerCase();
  const scored = templates.map((template) => ({
    template,
    score: tokenize(text).reduce((sum, token) => {
      const haystack = `${template.id} ${template.title} ${template.description} ${(template.metadata?.tags || [])}`.toLowerCase();
      return sum + (haystack.includes(token) ? 2 : 0);
    }, template.status === "published" ? 1 : 0),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.template;
}

function createNodes(
  input: WorkflowComposeInput,
  selected: ComponentBucket,
  campaignBible: CampaignBible,
  shotList: CampaignShot[]
): WorkflowNode[] {
  const productNode = createProductNode(input, selected.product_asset?.[0]);
  const componentNodes = FLOW_TYPES
    .filter((type) => type !== "product_asset")
    .map((type, index) => createComponentNode(type, selected[type]?.[0], index, campaignBible, shotList))
    .filter((node): node is WorkflowNode => Boolean(node));

  return [productNode, ...componentNodes];
}

function createProductNode(input: WorkflowComposeInput, component?: Component): WorkflowNode {
  const metadata = component?.metadata || {};
  const componentParameters = getRecord(metadata.parameters);
  const title = input.productTitle?.trim() || component?.title || "Product Brief";
  const description =
    input.productDescription?.trim() ||
    component?.description ||
    input.brief.trim();
  const parameters = Object.keys(componentParameters).length > 0
    ? componentParameters
    : {
        category: "brief_product",
        productTitle: title,
        productDescription: description,
      };
  const imageUrl = getFirstString([
    metadata.previewUrl,
    parameters.imageUrl,
    parameters.referenceImage,
    ...(Array.isArray(parameters.images) ? parameters.images : []),
    ...(Array.isArray(parameters.referenceImages) ? parameters.referenceImages : []),
  ]);

  return {
    id: "product",
    type: "product_asset",
    title,
    caption: description,
    status: "ready",
    position: { x: 40, y: 180 },
    data: {
      label: title,
      caption: description,
      kind: "asset",
      status: "ready",
      metrics: productNodeMetrics(component, parameters),
      iconName: "product",
      componentId: component?.id || "",
      componentType: "product_asset",
      parameters,
      promptFragments: Array.isArray(metadata.promptFragments) ? metadata.promptFragments : [],
      previewUrl: imageUrl,
      previewAlt: title,
      brief: input.brief.trim(),
      productDescription: description,
    },
  };
}

function createComponentNode(
  type: StandardComponentType,
  component: Component | undefined,
  index: number,
  campaignBible: CampaignBible,
  shotList: CampaignShot[]
): WorkflowNode | undefined {
  if (!component) return undefined;
  const metadata = component.metadata || {};
  const baseParameters = getRecord(metadata.parameters);
  const parameters = type === "image_recipe"
    ? {
        ...baseParameters,
        purpose:
          typeof baseParameters.purpose === "string" && baseParameters.purpose.trim()
            ? baseParameters.purpose
            : campaignBible.visualStrategy.primaryObjective,
        outputCount: shotList.length || baseParameters.outputCount,
        shotList: shotList.map((shot) => ({
          id: shot.id,
          slot: shot.slot,
          label: shot.label,
          intent: shot.intent,
          purpose: shot.purpose,
          ratio: shot.ratio,
          size: shot.size,
          samplePhase: shot.samplePhase,
          copyMode: shot.copyMode,
          textAllowed: shot.textAllowed,
          referenceRoles: shot.referenceRoles,
          promptHints: shot.promptHints,
          qaRules: shot.qaRules,
          naming: shot.naming,
        })),
        campaignBible,
      }
    : baseParameters;
  const x = 320 + index * 240;
  const y = type === "scene" ? 300 : type === "quality_rule" ? 300 : 120;

  return {
    id: nodeIdForType(type),
    type,
    title: component.title,
    caption: component.description,
    status: type === "quality_rule" ? "review" : type === "output_pack" ? "queued" : "ready",
    position: { x, y },
    data: {
      label: component.title,
      caption: component.description,
      kind: nodeKindForType(type),
      status: type === "quality_rule" ? "review" : type === "output_pack" ? "queued" : "ready",
      metrics: nodeMetrics(component),
      iconName: iconForType(type),
      componentId: component.id,
      componentType: metadata.componentType || type,
      seedKey: metadata.seedKey || "",
      compatibleWith: Array.isArray(metadata.compatibleWith) ? metadata.compatibleWith : [],
      parameters,
      promptFragments: Array.isArray(metadata.promptFragments) ? metadata.promptFragments : [],
      qualityRules: Array.isArray(metadata.qualityRules) ? metadata.qualityRules : [],
    },
  };
}

function createEdges(nodes: WorkflowNode[]): WorkflowEdge[] {
  const has = new Set(nodes.map((node) => node.id));
  const edges: WorkflowEdge[] = [];
  const add = (source: string, target: string, label: string, animated = false) => {
    if (has.has(source) && has.has(target)) {
      edges.push({ id: `${source}-${target}`, source, target, label, animated });
    }
  };

  add("product", "visual_style", "style");
  add("product", "scene", "context");
  add("product", "image_recipe", "compose", true);
  add("visual_style", "image_recipe", "style", true);
  add("scene", "image_recipe", "scene");
  add("image_recipe", "platform_rule", "adapt", true);
  add("platform_rule", "quality_rule", "check");
  add("image_recipe", "quality_rule", "review");
  add("quality_rule", "output_pack", "package", true);
  add("platform_rule", "output_pack", "export");

  return edges;
}

function createTitle(
  input: WorkflowComposeInput,
  recipe?: Component[],
  workflowSkill?: WorkflowSkill
): string {
  const product = input.productTitle?.trim();
  if (product) return `${product} · ${workflowSkill?.shortLabel ?? "工作流"}`;
  if (workflowSkill) return `${workflowSkill.shortLabel} · Agent Plan`;
  const recipeTitle = recipe?.[0]?.title;
  if (recipeTitle) return `${recipeTitle} · Agent Plan`;
  return "Commerce Workflow Draft";
}

function createDescription(
  input: WorkflowComposeInput,
  selected: ComponentBucket,
  template?: WorkflowTemplate,
  workflowSkill?: WorkflowSkill
): string {
  const parts = [
    workflowSkill ? `Agent skill: ${workflowSkill.shortLabel}.` : "",
    input.scenario?.trim(),
    input.brief.trim(),
    template ? `Template hint: ${template.title}.` : "",
    `Selected chain: ${FLOW_TYPES.filter((type) => type === "product_asset" || selected[type]?.[0])
      .join(" -> ")}.`,
  ].filter(Boolean);
  return parts.join(" ");
}

function nodeIdForType(type: StandardComponentType): string {
  return type;
}

function nodeKindForType(type: StandardComponentType): string {
  if (type === "quality_rule") return "review";
  if (type === "output_pack") return "output";
  return "factory";
}

function iconForType(type: StandardComponentType): string {
  if (type === "visual_style") return "style";
  if (type === "scene") return "scene";
  if (type === "platform_rule") return "platform";
  if (type === "quality_rule") return "review";
  if (type === "output_pack") return "output";
  if (type === "image_recipe") return "ai";
  return "product";
}

function nodeMetrics(component: Component): string[] {
  const metadata = component.metadata || {};
  const parameters = metadata.parameters;
  const compatibleWith = Array.isArray(metadata.compatibleWith) ? metadata.compatibleWith : [];
  const promptFragments = Array.isArray(metadata.promptFragments) ? metadata.promptFragments : [];

  return [
    typeof metadata.seedKey === "string" ? metadata.seedKey.split(".").slice(-1)[0] : "",
    parameters && typeof parameters === "object" ? `${Object.keys(parameters).length} params` : "",
    compatibleWith.length > 0 ? `${compatibleWith.length} compatible` : "",
    promptFragments.length > 0 ? `${promptFragments.length} prompts` : "",
  ].filter(Boolean).slice(0, 3);
}

function productNodeMetrics(
  component: Component | undefined,
  parameters: Record<string, unknown>
): string[] {
  const sellingPoints = Array.isArray(parameters.sellingPoints) ? parameters.sellingPoints : [];
  const materials = Array.isArray(parameters.materials) ? parameters.materials : [];
  const platformHints = Array.isArray(parameters.platformHints) ? parameters.platformHints : [];
  const metrics = [
    component ? "product component" : "brief",
    typeof parameters.category === "string" && parameters.category ? parameters.category : "",
    sellingPoints.length > 0 ? `${sellingPoints.length} selling points` : "",
    materials.length > 0 ? `${materials.length} materials` : "",
    platformHints.length > 0 ? `${platformHints.length} platforms` : "",
  ].filter(Boolean);

  return metrics.length > 0 ? metrics.slice(0, 4) : ["brief", "product facts", "constraints"];
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getFirstString(values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function normalizeStringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}
