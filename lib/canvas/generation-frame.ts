import {
  isProviderUsableReferenceUrl,
  normalizeGenerationReferenceContext,
  type GenerationReferenceContext,
  type GenerationReferenceImage,
  type GenerationReferenceRole,
  type GenerationReferenceRoleContext,
} from "./generation-reference-context";
import {
  buildStructuredCopyBrief,
  normalizeStructuredCopyBrief,
  type StructuredCopyBrief,
} from "./copy-brief";
import type {
  CanvasAsset,
  CanvasLibraryCategory,
  CanvasNodeData,
  CanvasWorkbenchNode,
} from "./workbench-data";

export type GenerationFrameRole = GenerationReferenceRole;

export const generationFrameRoles = [
  "product",
  "model",
  "style",
  "scene",
  "copy",
] as const satisfies readonly GenerationFrameRole[];

export interface GenerationFramePlanSpec {
  id: string;
  title: string;
  type: string;
  instruction: string;
  size: string;
  ratio: string;
  whiteBackground: boolean;
  textAllowed: boolean;
  modelRequired: boolean;
  exportSpecId: string;
  copyText?: string;
  copyRenderMode?: "layout_layer" | "burn_in" | "metadata_only";
}

export interface BuildGenerationFramePlanSpecsInput {
  request?: string;
  outputType?: string;
  frameLabel?: string;
  maxItems?: number;
}

export type GenerationFrameStatus =
  | "empty"
  | "draft"
  | "queued"
  | "running"
  | "ready"
  | "done"
  | "review"
  | "failed";

export type GenerationFrameSlotSource =
  | "canvas-node"
  | "canvas-asset"
  | "generated-output"
  | "legacy"
  | "manual";

export interface GenerationFrameSlotBinding {
  role: GenerationFrameRole;
  source: GenerationFrameSlotSource;
  title: string;
  bindingId?: string;
  sourceNodeId?: string;
  sourceNodeLabel?: string;
  sourceAssetId?: string;
  sourceComponentId?: string;
  referenceUrl?: string;
  providerUsable: boolean;
  primary?: boolean;
  order?: number;
  weight?: number;
  providerMode?: "provider_input" | "prompt_only" | "disabled";
  parameters?: Record<string, unknown>;
  promptFragments: string[];
  constraints: string[];
  negativeRules: string[];
  qualityRules: string[];
  copyBrief?: StructuredCopyBrief;
  outputIds: string[];
  updatedAt?: string;
}

export type GenerationFrameSlots = Partial<
  Record<GenerationFrameRole, GenerationFrameSlotBinding>
>;

export interface GenerationFrameOutput {
  id: string;
  title?: string;
  url?: string;
  previewUrl?: string;
  nodeId?: string;
  jobId?: string;
  artifactId?: string;
  status?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface GenerationFrameState {
  version: 1;
  frameId?: string;
  actionId?: string;
  outputType?: string;
  prompt?: string;
  promptPlaceholder?: string;
  status: GenerationFrameStatus;
  slots: GenerationFrameSlots;
  assets: GenerationFrameSlotBinding[];
  outputs: GenerationFrameOutput[];
  updatedAt?: string;
}

export function buildGenerationFramePlanSpecs({
  request,
  outputType = "commercial_image_set",
  frameLabel = "Agent 任务",
  maxItems = 20,
}: BuildGenerationFramePlanSpecsInput): GenerationFramePlanSpec[] {
  const cleanRequest = (request ?? "").trim();
  const normalizedRequest = cleanRequest.toLowerCase();
  const explicitCount = parseRequestedImageCount(cleanRequest);
  const targetCount = clampPlanCount(
    explicitCount ?? inferDefaultPlanCount(normalizedRequest, outputType),
    maxItems
  );
  const globalRequestedRatio = extractRequestedRatio(cleanRequest) ?? inferOrientationRatio(cleanRequest);
  const requestedBurnInCopy = extractRequestedShotBurnInText(cleanRequest) ?? extractLooseBurnInText(cleanRequest);
  const requestedShotTemplates = buildRequestedShotTemplates(cleanRequest, targetCount);
  const shouldApplyGlobalHints = requestedShotTemplates.length === 0;
  const seeds = requestedShotTemplates.length > 0
    ? requestedShotTemplates
    : mergeKeywordPlanTemplates(
        selectPlanSeedTemplates(normalizedRequest, outputType),
        normalizedRequest,
        outputType
      );
  const planned = [...seeds];

  while (planned.length < targetCount) {
    planned.push(genericPlanTemplates[planned.length % genericPlanTemplates.length]);
  }

  return planned.slice(0, targetCount).map((template, index) => {
    const copyText = shouldApplyGlobalHints
      ? template.copyText ?? requestedBurnInCopy
      : template.copyText;
    const ratio = shouldApplyGlobalHints && globalRequestedRatio
      ? globalRequestedRatio
      : template.ratio;
    const size = shouldApplyGlobalHints && globalRequestedRatio
      ? imageSizeForRequestedRatio(globalRequestedRatio)
      : template.size;
    return {
      id: `${template.id}-${index + 1}`,
      title: `${frameLabel} · ${template.title}`,
      type: `${outputType}_${template.id}`,
      instruction: template.instruction,
      size,
      ratio,
      whiteBackground: template.whiteBackground,
      textAllowed: template.textAllowed || Boolean(copyText),
      modelRequired: template.modelRequired,
      exportSpecId: template.id,
      copyText,
      copyRenderMode: template.copyRenderMode ?? (copyText ? "burn_in" : undefined),
    };
  });
}

export interface GenerationFrameBindingInput {
  role: GenerationFrameRole;
  source: GenerationFrameSlotSource;
  title?: string;
  bindingId?: string;
  sourceNodeId?: string;
  sourceNodeLabel?: string;
  sourceAssetId?: string;
  sourceComponentId?: string;
  referenceUrl?: string;
  providerUsable?: boolean;
  primary?: boolean;
  order?: number;
  weight?: number;
  providerMode?: "provider_input" | "prompt_only" | "disabled";
  parameters?: Record<string, unknown>;
  promptFragments?: string[];
  constraints?: string[];
  negativeRules?: string[];
  qualityRules?: string[];
  copyBrief?: StructuredCopyBrief;
  outputIds?: string[];
  updatedAt?: string;
}

export interface BindGenerationFrameNodeOptions {
  role?: GenerationFrameRole;
  updatedAt?: string;
}

export interface BindGenerationFrameAssetOptions {
  role?: GenerationFrameRole;
  sourceNodeId?: string;
  updatedAt?: string;
}

const roleLabels: Record<GenerationFrameRole, string> = {
  product: "Product reference",
  model: "Model reference",
  style: "Visual style",
  scene: "Scene context",
  copy: "Copy brief",
};

export function isGenerationFrameRole(value: unknown): value is GenerationFrameRole {
  return generationFrameRoles.includes(value as GenerationFrameRole);
}

export function isGenerationFrameNodeData(data: CanvasNodeData | undefined): boolean {
  return data?.componentType === "generation_frame" || isRecord(data?.generationFrame);
}

export function createGenerationFrameState(
  input: Partial<GenerationFrameState> = {}
): GenerationFrameState {
  return normalizeGenerationFrameState(input);
}

export function normalizeGenerationFrameState(value: unknown): GenerationFrameState {
  const record = isRecord(value) ? value : {};
  const slots = normalizeSlots(record.slots);
  const assets = mergeSlotBindingList([
    ...normalizeAssetBindings(record.assets),
    ...Object.values(slots),
  ]);
  const outputs = normalizeOutputs(record.outputs);

  return {
    version: 1,
    frameId: getString(record.frameId),
    actionId: getString(record.actionId),
    outputType: getString(record.outputType),
    prompt: getString(record.prompt),
    promptPlaceholder: getString(record.promptPlaceholder),
    status: normalizeStatus(record.status, slots, assets, outputs),
    slots,
    assets,
    outputs,
    updatedAt: getString(record.updatedAt),
  };
}

export function normalizeGenerationFrameNode(
  node: CanvasWorkbenchNode
): CanvasWorkbenchNode {
  return {
    ...node,
    data: {
      ...node.data,
      generationFrame: migrateLegacyGenerationFrameData(node.data, node.id),
    },
  };
}

export function migrateLegacyGenerationFrameData(
  data: CanvasNodeData,
  frameId?: string
): GenerationFrameState {
  const explicit = normalizeGenerationFrameState(data.generationFrame);
  const referenceContext = normalizeGenerationReferenceContext(data.referenceContext);
  const legacySourceRole = inferRoleFromLegacySource(data);
  const sourceNodeId = getString(data.sourceNodeId);
  const sourceBinding = sourceNodeId && legacySourceRole
    ? normalizeSlotBinding({
        role: legacySourceRole,
        source: "legacy",
        title: getString(data.sourceNodeLabel) ?? roleLabels[legacySourceRole],
        sourceNodeId,
        sourceNodeLabel: getString(data.sourceNodeLabel),
        promptFragments: getStringArray(data.promptFragments),
        constraints: getStringArray(data.constraints),
        negativeRules: getStringArray(data.negativeRules),
        qualityRules: getStringArray(data.qualityRules),
      })
    : undefined;
  const contextSlots = referenceContextToSlots(referenceContext);
  const slots = mergeSlots(explicit.slots, contextSlots, sourceBinding);
  const assets = mergeSlotBindingList([...explicit.assets, ...Object.values(slots)]);
  const prompt = getString(data.generationUserRequest) ?? explicit.prompt;

  return {
    ...explicit,
    frameId: explicit.frameId ?? frameId,
    actionId: explicit.actionId ?? getString(data.generationActionId),
    outputType: explicit.outputType ?? getString(data.generationOutputType),
    prompt,
    promptPlaceholder: explicit.promptPlaceholder ?? getString(data.promptPlaceholder),
    status: normalizeStatus(data.status, slots, assets, explicit.outputs),
    slots,
    assets,
  };
}

export function bindGenerationFrameSlot(
  frame: GenerationFrameState,
  input: GenerationFrameBindingInput
): GenerationFrameState {
  const current = normalizeGenerationFrameState(frame);
  const binding = normalizeSlotBinding(input);
  if (!binding) return current;
  const previous = current.slots[binding.role];
  const nextBinding = previous ? mergeSlotBinding(previous, binding) : binding;
  const slots = {
    ...current.slots,
    [binding.role]: nextBinding,
  };
  const assets = upsertFrameAsset(current.assets, binding);

  return {
    ...current,
    status: normalizeStatus(current.status, slots, assets, current.outputs),
    slots,
    assets,
    updatedAt: input.updatedAt ?? current.updatedAt,
  };
}

export function removeGenerationFrameAsset(
  frame: GenerationFrameState,
  bindingKey: string
): GenerationFrameState {
  const current = normalizeGenerationFrameState(frame);
  const assets = current.assets.filter(
    (binding) => getGenerationFrameBindingKey(binding) !== bindingKey
  );
  const slots = deriveSlotsFromAssets(assets);

  return {
    ...current,
    status: normalizeStatus(current.status, slots, assets, current.outputs),
    slots,
    assets,
    updatedAt: new Date().toISOString(),
  };
}

export function updateGenerationFrameAssetRole(
  frame: GenerationFrameState,
  bindingKey: string,
  role: GenerationFrameRole
): GenerationFrameState {
  const current = normalizeGenerationFrameState(frame);
  const assets = current.assets.map((binding) =>
    getGenerationFrameBindingKey(binding) === bindingKey
      ? { ...binding, role, updatedAt: new Date().toISOString() }
      : binding
  );
  const slots = deriveSlotsFromAssets(assets);

  return {
    ...current,
    status: normalizeStatus(current.status, slots, assets, current.outputs),
    slots,
    assets,
    updatedAt: new Date().toISOString(),
  };
}

export function markGenerationFramePrimaryAsset(
  frame: GenerationFrameState,
  bindingKey: string
): GenerationFrameState {
  const current = normalizeGenerationFrameState(frame);
  const target = current.assets.find(
    (binding) => getGenerationFrameBindingKey(binding) === bindingKey
  );
  if (!target) return current;

  const assets = current.assets.map((binding) =>
    binding.role === target.role
      ? {
          ...binding,
          primary: getGenerationFrameBindingKey(binding) === bindingKey,
          updatedAt: new Date().toISOString(),
        }
      : binding
  );
  const slots = deriveSlotsFromAssets(assets);

  return {
    ...current,
    status: normalizeStatus(current.status, slots, assets, current.outputs),
    slots,
    assets,
    updatedAt: new Date().toISOString(),
  };
}

export function moveGenerationFrameAsset(
  frame: GenerationFrameState,
  bindingKey: string,
  direction: "previous" | "next"
): GenerationFrameState {
  const current = normalizeGenerationFrameState(frame);
  const ordered = orderFrameAssets(current.assets).map((binding, index) => ({
    ...binding,
    order: index,
  }));
  const index = ordered.findIndex((binding) => getGenerationFrameBindingKey(binding) === bindingKey);
  if (index === -1) return current;

  const swapIndex = direction === "previous" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= ordered.length) return current;

  const reordered = [...ordered];
  const target = reordered[index];
  reordered[index] = reordered[swapIndex];
  reordered[swapIndex] = target;

  const now = new Date().toISOString();
  const assets = reordered.map((binding, nextOrder) => ({
    ...binding,
    order: nextOrder,
    updatedAt: now,
  }));
  const slots = deriveSlotsFromAssets(assets);

  return {
    ...current,
    status: normalizeStatus(current.status, slots, assets, current.outputs),
    slots,
    assets,
    updatedAt: now,
  };
}

export function bindNodeToGenerationFrameSlot(
  frame: GenerationFrameState,
  node: CanvasWorkbenchNode,
  options: BindGenerationFrameNodeOptions = {}
): GenerationFrameState {
  const role = options.role ?? inferRoleFromNode(node);
  if (!role) return normalizeGenerationFrameState(frame);
  const copyBrief = buildCopyBriefForNode(role, node);

  return bindGenerationFrameSlot(frame, {
    role,
    source: "canvas-node",
    title: node.data.label || roleLabels[role],
    sourceNodeId: node.id,
    sourceNodeLabel: node.data.label,
    sourceAssetId: getString(node.data.assetId),
    sourceComponentId: getString(node.data.componentId),
    referenceUrl: getFirstString([
      getString(node.data.referenceUrl),
      node.data.previewUrl,
      ...getStringArray(getRecord(node.data.parameters)?.referenceImages),
      getRecord(node.data.parameters)?.referenceImage,
      getRecord(node.data.parameters)?.imageUrl,
    ]),
    parameters: buildBindingParameters(getRecord(node.data.parameters), copyBrief),
    promptFragments: mergeCopyRules(
      getStringArray(node.data.promptFragments),
      copyBrief?.promptFragments
    ),
    constraints: mergeCopyRules(
      getStringArray(node.data.constraints),
      copyBrief?.constraints
    ),
    negativeRules: mergeCopyRules(
      getStringArray(node.data.negativeRules),
      copyBrief?.negativeRules
    ),
    qualityRules: mergeCopyRules(
      getStringArray(node.data.qualityRules),
      copyBrief?.qualityRules
    ),
    copyBrief,
    updatedAt: options.updatedAt,
  });
}

export function bindAssetToGenerationFrameSlot(
  frame: GenerationFrameState,
  asset: CanvasAsset,
  options: BindGenerationFrameAssetOptions = {}
): GenerationFrameState {
  const role = options.role ?? inferRoleFromAsset(asset);
  if (!role) return normalizeGenerationFrameState(frame);
  const copyBrief = buildCopyBriefForAsset(role, asset);

  return bindGenerationFrameSlot(frame, {
    role,
    source: "canvas-asset",
    title: asset.title || roleLabels[role],
    sourceNodeId: options.sourceNodeId,
    sourceAssetId: asset.id,
    sourceComponentId: getString(asset.parameters?.componentId),
    referenceUrl: asset.referenceUrl ?? asset.previewUrl,
    parameters: buildBindingParameters(asset.parameters, copyBrief),
    promptFragments: mergeCopyRules(asset.promptFragments, copyBrief?.promptFragments),
    constraints: mergeCopyRules(asset.constraints, copyBrief?.constraints),
    negativeRules: mergeCopyRules(asset.negativeRules, copyBrief?.negativeRules),
    qualityRules: mergeCopyRules(asset.qualityRules, copyBrief?.qualityRules),
    copyBrief,
    updatedAt: options.updatedAt,
  });
}

export function mergeGenerationFrameOutputs(
  frame: GenerationFrameState,
  outputs: GenerationFrameOutput[]
): GenerationFrameState {
  const current = normalizeGenerationFrameState(frame);
  const merged = new Map(current.outputs.map((output) => [getOutputKey(output), output]));

  for (const output of normalizeOutputs(outputs)) {
    const key = getOutputKey(output);
    const previous = merged.get(key);
    merged.set(key, previous ? { ...previous, ...output } : output);
  }

  const nextOutputs = Array.from(merged.values());
  return {
    ...current,
    status: normalizeStatus(current.status, current.slots, current.assets, nextOutputs),
    outputs: nextOutputs,
  };
}

export function buildGenerationFrameReferenceContext(
  frame: GenerationFrameState
): GenerationReferenceContext | undefined {
  const current = normalizeGenerationFrameState(frame);
  const bindings = orderFrameAssets(
    current.assets.length > 0
      ? current.assets
      : generationFrameRoles
          .map((role) => current.slots[role])
          .filter((binding): binding is GenerationFrameSlotBinding => !!binding)
  );
  if (bindings.length === 0) return undefined;

  const roles: GenerationReferenceContext["roles"] = {};
  const images: GenerationReferenceImage[] = [];
  for (const binding of bindings) {
    const roleContext = slotBindingToRoleContext(binding);
    roles[binding.role] = roles[binding.role]
      ? mergeRoleContext(roles[binding.role], roleContext)
      : roleContext;
    if (binding.referenceUrl) {
      const providerUsable = binding.providerMode === "prompt_only" || binding.providerMode === "disabled"
        ? false
        : binding.providerUsable;
      images.push({
        role: binding.role,
        title: binding.title,
        url: binding.referenceUrl,
        providerUsable,
        providerMode: binding.providerMode,
        source: binding.source,
        nodeId: binding.sourceNodeId,
        assetId: binding.sourceAssetId,
        componentId: binding.sourceComponentId,
      });
    }
  }

  const roleContexts = Object.values(roles).filter(
    (context): context is GenerationReferenceRoleContext => !!context
  );

  return {
    version: 1,
    source: "canvas-workbench",
    targetNodeId: current.frameId,
    images: dedupeReferenceImages(images),
    roles,
    promptFragments: dedupeStrings(roleContexts.flatMap((context) => context.promptFragments)),
    constraints: dedupeStrings(roleContexts.flatMap((context) => context.constraints)),
    negativeRules: dedupeStrings(roleContexts.flatMap((context) => context.negativeRules)),
    qualityRules: dedupeStrings(roleContexts.flatMap((context) => context.qualityRules)),
  };
}

function referenceContextToSlots(
  context: GenerationReferenceContext | undefined
): GenerationFrameSlots {
  if (!context) return {};

  return generationFrameRoles.reduce<GenerationFrameSlots>((slots, role) => {
    const roleContext = context.roles[role];
    const image = context.images.find((entry) => entry.role === role);
    if (!roleContext && !image) return slots;

    slots[role] = normalizeSlotBinding({
      role,
      source: "legacy",
      title: roleContext?.title ?? image?.title ?? roleLabels[role],
      sourceNodeId: roleContext?.sourceNodeIds[0] ?? image?.nodeId,
      sourceAssetId: roleContext?.assetIds[0] ?? image?.assetId,
      sourceComponentId: roleContext?.componentIds[0] ?? image?.componentId,
      referenceUrl: image?.url,
      providerUsable: image?.providerUsable,
      parameters: roleContext?.parameters,
      promptFragments: roleContext?.promptFragments,
      constraints: roleContext?.constraints,
      negativeRules: roleContext?.negativeRules,
      qualityRules: roleContext?.qualityRules,
    });
    return slots;
  }, {});
}

function slotBindingToRoleContext(
  binding: GenerationFrameSlotBinding
): GenerationReferenceRoleContext {
  return {
    role: binding.role,
    title: binding.title,
    sourceNodeIds: binding.sourceNodeId ? [binding.sourceNodeId] : [],
    componentIds: binding.sourceComponentId ? [binding.sourceComponentId] : [],
    assetIds: binding.sourceAssetId ? [binding.sourceAssetId] : [],
    parameters: buildBindingParameters(binding.parameters, binding.copyBrief),
    promptFragments: binding.promptFragments,
    constraints: binding.constraints,
    negativeRules: binding.negativeRules,
    qualityRules: binding.qualityRules,
  };
}

function buildCopyBriefForNode(
  role: GenerationFrameRole,
  node: CanvasWorkbenchNode
): StructuredCopyBrief | undefined {
  if (role !== "copy") return undefined;
  const parameters = getRecord(node.data.parameters);
  const existing = normalizeStructuredCopyBrief(parameters?.copyBrief ?? node.data.copyBrief);
  if (existing) return existing;

  const sourceText = getFirstString([
    node.data.copyText,
    parameters?.copyText,
    parameters?.sourceText,
    parameters?.text,
    node.data.caption,
    node.data.label,
  ]);
  return sourceText ? buildStructuredCopyBrief(sourceText) : undefined;
}

function buildCopyBriefForAsset(
  role: GenerationFrameRole,
  asset: CanvasAsset
): StructuredCopyBrief | undefined {
  if (role !== "copy") return undefined;
  const existing = normalizeStructuredCopyBrief(asset.parameters?.copyBrief);
  if (existing) return existing;

  const sourceText = getFirstString([
    asset.parameters?.copyText,
    asset.parameters?.sourceText,
    asset.parameters?.text,
    asset.description,
    asset.title,
  ]);
  return sourceText ? buildStructuredCopyBrief(sourceText) : undefined;
}

function buildBindingParameters(
  parameters: Record<string, unknown> | undefined,
  copyBrief: StructuredCopyBrief | undefined
): Record<string, unknown> | undefined {
  return copyBrief ? mergeRecords(parameters, { copyBrief }) : parameters;
}

function mergeCopyRules(
  base: string[] | undefined,
  copyRules: string[] | undefined
): string[] {
  return dedupeStrings([...(base ?? []), ...(copyRules ?? [])]);
}

function sanitizeCopyPromptRules(lines: string[]): string[] {
  return lines
    .map((line) =>
      line
        .replace(/文案资产\s*[:：]\s*/g, "")
        .replace(/(Visible image copy candidates:\s*)(?:画面文字|图中文字|封面标题|海报标题|标题)\s*[:：]\s*/i, "$1")
        .trim()
    )
    .filter(Boolean);
}

function mergeRoleContext(
  base: GenerationReferenceRoleContext | undefined,
  next: GenerationReferenceRoleContext
): GenerationReferenceRoleContext {
  if (!base) return next;
  return {
    ...base,
    title: base.title === next.title ? base.title : `${base.title} / ${next.title}`,
    sourceNodeIds: dedupeStrings([...base.sourceNodeIds, ...next.sourceNodeIds]),
    componentIds: dedupeStrings([...base.componentIds, ...next.componentIds]),
    assetIds: dedupeStrings([...base.assetIds, ...next.assetIds]),
    parameters: mergeRecords(base.parameters, next.parameters),
    promptFragments: dedupeStrings([...base.promptFragments, ...next.promptFragments]),
    constraints: dedupeStrings([...base.constraints, ...next.constraints]),
    negativeRules: dedupeStrings([...base.negativeRules, ...next.negativeRules]),
    qualityRules: dedupeStrings([...base.qualityRules, ...next.qualityRules]),
  };
}

function normalizeSlots(value: unknown): GenerationFrameSlots {
  if (!isRecord(value)) return {};

  return generationFrameRoles.reduce<GenerationFrameSlots>((slots, role) => {
    const rawBinding = getRecord(value[role]);
    if (!rawBinding) return slots;
    const binding = normalizeSlotBinding({ ...rawBinding, role });
    if (binding) slots[role] = binding;
    return slots;
  }, {});
}

function normalizeSlotBinding(
  input: Partial<GenerationFrameBindingInput> | undefined
): GenerationFrameSlotBinding | undefined {
  if (!input || !isGenerationFrameRole(input.role)) return undefined;
  const referenceUrl = getString(input.referenceUrl);
  const providerMode = normalizeProviderMode(input.providerMode);
  const providerUsable = providerMode === "prompt_only" || providerMode === "disabled"
    ? false
    : input.providerUsable === true || isProviderUsableReferenceUrl(referenceUrl);

  return {
    role: input.role,
    source: normalizeSlotSource(input.source),
    title: getString(input.title) ?? roleLabels[input.role],
    bindingId: getString(input.bindingId),
    sourceNodeId: getString(input.sourceNodeId),
    sourceNodeLabel: getString(input.sourceNodeLabel),
    sourceAssetId: getString(input.sourceAssetId),
    sourceComponentId: getString(input.sourceComponentId),
    referenceUrl,
    providerUsable,
    primary: input.primary === true,
    order: getNumber(input.order),
    weight: getNumber(input.weight),
    providerMode,
    parameters: getRecord(input.parameters),
    copyBrief: normalizeStructuredCopyBrief(input.copyBrief ?? getRecord(input.parameters)?.copyBrief),
    promptFragments: input.role === "copy"
      ? sanitizeCopyPromptRules(getStringArray(input.promptFragments))
      : getStringArray(input.promptFragments),
    constraints: getStringArray(input.constraints),
    negativeRules: getStringArray(input.negativeRules),
    qualityRules: getStringArray(input.qualityRules),
    outputIds: getStringArray(input.outputIds),
    updatedAt: getString(input.updatedAt),
  };
}

function normalizeAssetBindings(value: unknown): GenerationFrameSlotBinding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): GenerationFrameSlotBinding[] => {
    const binding = normalizeSlotBinding(isRecord(item) ? item : undefined);
    return binding ? [binding] : [];
  });
}

function mergeSlotBindingList(bindings: Array<GenerationFrameSlotBinding | undefined>): GenerationFrameSlotBinding[] {
  return bindings.reduce<GenerationFrameSlotBinding[]>((items, binding) => {
    if (!binding) return items;
    return upsertFrameAsset(items, binding);
  }, []);
}

function upsertFrameAsset(
  assets: GenerationFrameSlotBinding[],
  binding: GenerationFrameSlotBinding
): GenerationFrameSlotBinding[] {
  const key = getGenerationFrameBindingKey(binding);
  const existingIndex = assets.findIndex((item) => getGenerationFrameBindingKey(item) === key);
  if (existingIndex === -1) return [...assets, binding];
  return assets.map((item, index) =>
    index === existingIndex ? mergeSlotBinding(item, binding) : item
  );
}

export function getGenerationFrameBindingKey(binding: GenerationFrameSlotBinding): string {
  if (binding.bindingId) return binding.bindingId;
  return [
    binding.role,
    binding.source,
    binding.sourceNodeId,
    binding.sourceAssetId,
    binding.sourceComponentId,
    binding.referenceUrl,
    binding.title,
  ].filter(Boolean).join(":");
}

function deriveSlotsFromAssets(
  assets: GenerationFrameSlotBinding[]
): GenerationFrameSlots {
  return orderFrameAssets(assets).reduce<GenerationFrameSlots>((slots, binding) => {
    if (!slots[binding.role]) slots[binding.role] = binding;
    return slots;
  }, {});
}

function orderFrameAssets(
  assets: GenerationFrameSlotBinding[]
): GenerationFrameSlotBinding[] {
  return [...assets].sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    return (a.order ?? 0) - (b.order ?? 0);
  });
}

function mergeSlots(
  base: GenerationFrameSlots,
  contextSlots: GenerationFrameSlots,
  sourceBinding: GenerationFrameSlotBinding | undefined
): GenerationFrameSlots {
  const slots = { ...contextSlots, ...base };
  if (!sourceBinding) return slots;

  const previous = slots[sourceBinding.role];
  slots[sourceBinding.role] = previous
    ? mergeSlotBinding(sourceBinding, previous)
    : sourceBinding;
  return slots;
}

function mergeSlotBinding(
  base: GenerationFrameSlotBinding,
  next: GenerationFrameSlotBinding
): GenerationFrameSlotBinding {
  return {
    ...base,
    ...next,
    parameters: mergeRecords(base.parameters, next.parameters),
    promptFragments: dedupeStrings([...base.promptFragments, ...next.promptFragments]),
    constraints: dedupeStrings([...base.constraints, ...next.constraints]),
    negativeRules: dedupeStrings([...base.negativeRules, ...next.negativeRules]),
    qualityRules: dedupeStrings([...base.qualityRules, ...next.qualityRules]),
    copyBrief: next.copyBrief ?? base.copyBrief,
    outputIds: dedupeStrings([...base.outputIds, ...next.outputIds]),
    providerUsable: base.providerUsable || next.providerUsable,
  };
}

function normalizeOutputs(value: unknown): GenerationFrameOutput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): GenerationFrameOutput[] => {
    if (!isRecord(item)) return [];
    const id = getString(item.id) ??
      getString(item.artifactId) ??
      getString(item.jobId) ??
      getString(item.url);
    if (!id) return [];

    return [{
      id,
      title: getString(item.title),
      url: getString(item.url),
      previewUrl: getString(item.previewUrl),
      nodeId: getString(item.nodeId),
      jobId: getString(item.jobId),
      artifactId: getString(item.artifactId),
      status: getString(item.status),
      createdAt: getString(item.createdAt),
      metadata: getRecord(item.metadata),
    }];
  });
}

function normalizeStatus(
  value: unknown,
  slots: GenerationFrameSlots,
  assets: GenerationFrameSlotBinding[],
  outputs: GenerationFrameOutput[]
): GenerationFrameStatus {
  if (
    value === "draft" ||
    value === "queued" ||
    value === "running" ||
    value === "ready" ||
    value === "done" ||
    value === "review" ||
    value === "failed"
  ) {
    return value;
  }

  if (outputs.length > 0) return "done";
  if (assets.length > 0) return "draft";
  if (Object.keys(slots).length > 0) return "draft";
  return "empty";
}

type PlanTemplate = Omit<GenerationFramePlanSpec, "id" | "title" | "type" | "exportSpecId"> & {
  id: string;
  title: string;
};

const sceneLightingIntegrationInstruction =
  "如有场景参考，以场景光为准：光源方向、阴影、色温、透视和接触阴影一致。人物、脸、手和商品都要融进场景，避免棚拍补光、抠图边和无影效果。";

const productModelRealismInstruction =
  "商品+模特图要像实地拍摄：35/50mm 视角、自然光、比例真实、接触关系清楚、皮肤和衣物有真实细节。";

const modelActionMotivationInstruction =
  "每张模特图都要给出具体动作理由和眼神落点。模特参考只锁身份、脸型、发型、年龄感和身形，不复制模卡表情、站姿、棚拍眼神或排版。表情、眼神和动作跟当前镜头走。";

const photographerDirectingInstruction =
  "动作处方要具体：每张只指定一个姿态状态、一个重心方向、一个头部角度、一个眼神落点和一组手部动作，不给多个备选。";

const accessoryLifestyleCampaignInstruction =
  `${productModelRealismInstruction} ${modelActionMotivationInstruction} ${photographerDirectingInstruction} 整组像一次小型生活方式拍摄：距离、角度、动作、用包方式和场景区都要变化；商品和人物身份保持一致，但每张像同一组拍摄里的不同瞬间。`;

const genericPlanTemplates: PlanTemplate[] = [
  {
    id: "hero",
    title: "主视觉",
    instruction:
      "Create the strongest hero commerce image for this set. Clear product identity, premium composition, unified lighting, no layout text unless explicitly requested.",
    size: "1024x1536",
    ratio: "4:5",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
  {
    id: "selling-point",
    title: "卖点图",
    instruction:
      "Create a selling-point product image that makes one key benefit visually obvious while keeping product form, material, color, and proportions stable.",
    size: "1024x1536",
    ratio: "4:5",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
  {
    id: "detail",
    title: "细节图",
    instruction:
      "Create a detail-focused product image that highlights material, structure, texture, and key selling points while keeping the same visual language.",
    size: "1024x1024",
    ratio: "1:1",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
  {
    id: "scene",
    title: "场景图",
    instruction:
      `Create a contextual scene image where the product feels naturally placed in a commercially usable environment with consistent color and lighting. ${sceneLightingIntegrationInstruction}`,
    size: "1024x1024",
    ratio: "4:5",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
  {
    id: "model",
    title: "模特图",
    instruction:
      `Create a professional model display image with natural pose, stable product shape, and believable commercial styling. If a scene reference is present, relight the model and product into the scene rather than keeping separate studio portrait lighting. ${productModelRealismInstruction} ${modelActionMotivationInstruction} ${sceneLightingIntegrationInstruction}`,
    size: "1024x1024",
    ratio: "4:5",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: true,
  },
  {
    id: "closing",
    title: "收尾图",
    instruction:
      "Create a final conversion-oriented commerce image that keeps the set visually unified and leaves clean room for later copy placement.",
    size: "1024x1024",
    ratio: "1:1",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
];

const detailPageTemplates: PlanTemplate[] = [
  genericPlanTemplates[0],
  genericPlanTemplates[1],
  {
    ...genericPlanTemplates[2],
    id: "material-detail",
    title: "材质细节",
  },
  {
    id: "size-spec",
    title: "尺寸说明",
    instruction:
      "Create a clean product specification image that clearly shows scale, structure, and practical product details without changing the product.",
    size: "1024x1024",
    ratio: "1:1",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
  genericPlanTemplates[3],
  genericPlanTemplates[5],
];

const sceneContinuityInstruction =
  "Preserve one continuous physical environment across the set: same floor plan, horizon line, surface materials, prop family, light source direction, shadow logic, reflection behavior, and natural product/model placement zones. Placement zones must be clean empty physical surfaces or floor areas only; do not draw dashed boxes, outlines, arrows, markers, labels, floor tape, UI overlays, or visible guide graphics. The product must sit naturally in the scene with believable contact shadows and scale. Do not change the product identity, invent extra product features, swap the room, rotate to an impossible angle, add dominant people, add readable brand text, or create conflicting light directions.";

const sceneMultiViewTemplates: PlanTemplate[] = [
  {
    id: "scene-establishing-wide",
    title: "场景总览",
    instruction:
      `Create a wide establishing commerce scene that clearly maps the reusable environment before the tighter shots. Show the full spatial layout, main surface, background depth, prop family, and an obvious product placement zone. Use a 24-35mm wide lens feel, eye-level to slightly high camera, natural perspective, and clean negative space. ${sceneContinuityInstruction}`,
    size: "1536x1024",
    ratio: "3:2",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
  {
    id: "scene-product-hero",
    title: "场景主图",
    instruction:
      `Create the main product-in-scene hero image inside the same environment. Use a medium shot with the product placed in the reserved zone from the establishing view, clear product hierarchy, stable scale, and realistic contact shadows. Keep the camera at eye-level or tabletop height, with the same light direction and surface texture. ${sceneContinuityInstruction}`,
    size: "1024x1024",
    ratio: "4:5",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
  {
    id: "scene-side-angle",
    title: "侧向角度",
    instruction:
      `Create a side-angle scene image from about 30-45 degrees around the same product placement zone. The background, props, floor plan, horizon line, and lighting must remain compatible with the establishing view. Reveal depth and spatial relationships without changing the product shape, material, color, or scale. ${sceneContinuityInstruction}`,
    size: "1024x1024",
    ratio: "4:5",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
  {
    id: "scene-surface-close",
    title: "场景近景",
    instruction:
      `Create a close scene detail that focuses on product material, nearby surface texture, contact shadows, and one or two supporting props from the same environment. Use a 50-85mm lens feel, shallow but believable depth of field, and keep the same light source direction. This should feel like a tighter crop from the same staged scene, not a new setup. ${sceneContinuityInstruction}`,
    size: "1024x1024",
    ratio: "1:1",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
  {
    id: "scene-reverse-context",
    title: "反向环境",
    instruction:
      `Create an alternate or reverse context angle from the same environment, showing enough recurring anchors to prove it is the same scene: matching surface, background depth, light direction, prop family, and product placement logic. Avoid revealing contradictory architecture or unrelated props. ${sceneContinuityInstruction}`,
    size: "1536x1024",
    ratio: "3:2",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
];

const sceneContinuityBoardTemplates: PlanTemplate[] = [
  {
    id: "scene-continuity-board",
    title: "场景正交空间大图",
    instruction:
      `Create one large orthographic scene spatial reference sheet in a single image, arranged as a clean commercial location bible without captions or readable text. Use exactly five panels: 1) one large top-down or high-angle overview panel that clearly maps the whole floor plan, object positions, entrance/architecture side, background direction, light direction, empty model standing/walking zones, and product placement surfaces; 2) a straight-on FRONT elevation view of the same space; 3) a straight-on BACK elevation view from the opposite side; 4) a straight-on LEFT elevation view; 5) a straight-on RIGHT elevation view. The four lower views must be cardinal front, back, left, and right views of the same mapped scene, not diagonal beauty angles, not random cinematic crops, and not 30-45 degree shots. Each panel should leave clear empty zones where a model can later stand, sit, walk, hold a product, or interact without blocking key scene anchors. All panels must share the same floor plan, horizon line, surface materials, prop family, light source direction, shadow logic, reflection behavior, scale cues, and product/model placement zones. Use this as a reusable spatial coordinate pack for later model/product composites, not a final ad poster. ${sceneContinuityInstruction}`,
    size: "1536x1024",
    ratio: "3:2",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
];

const productAssetTemplates: PlanTemplate[] = [
  {
    id: "product-multiview-sheet",
    title: "白底多视角商品资产",
    instruction:
      "Create one single reusable white-background multi-view product identity sheet. Combine the available product references into one clean square reference image that shows front, three-quarter, side/back when safely inferable, and one material/detail view. Preserve product silhouette, proportions, color, materials, logo/label regions, seams, closures, straps, handles, buttons, texture, and construction details. Use pure or near-pure white background, even studio lighting, soft contact shadows, clear whitespace between views, no model, no hands, no props, no scene, no marketing text, no extra product variants, no invented logos.",
    size: "1024x1024",
    ratio: "1:1",
    whiteBackground: true,
    textAllowed: false,
    modelRequired: false,
  },
];

const modelAssetTemplates: PlanTemplate[] = [
  {
    id: "model-identity-reference",
    title: "模特身份资产",
    instruction:
      "Create one reusable adult commercial model identity reference image. Treat this as a person asset only: stable face shape, hair identity, age impression, body proportion, temperament, clean anatomy, natural full-body or three-quarter visibility, and neutral commercial wardrobe. Use compositing-friendly low-contrast diffuse reflected daylight on a warm light-gray or soft beige matte neutral background; avoid pure white seamless backdrop, hard key light, beauty dish catchlights, strong frontal fill, glossy portrait retouching, or baked-in studio face light. Do not include products, logos, selling text, seductive styling, celebrity likeness, children, duplicated limbs, distorted hands, or a final poster composition. Keep the model independent from any product or clothing asset that may be linked later.",
    size: "1024x1024",
    ratio: "1:1",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: true,
  },
];

const styleAssetTemplates: PlanTemplate[] = [
  {
    id: "style-reference-plate",
    title: "风格参考资产",
    instruction:
      "Create one reusable visual style reference plate that clearly expresses palette, lighting character, material finish, lens feel, composition rhythm, contrast level, texture intensity, and commercial polish. Do not lock a specific product, person identity, brand logo, readable text, UI mockup, or busy collage. The output should guide later product, model, and scene images with a consistent visual language.",
    size: "1024x1024",
    ratio: "1:1",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
];

const accessoryLifestyleCampaignTemplates: PlanTemplate[] = [
  {
    id: "accessory-front-hold",
    title: "正面手持",
    instruction:
      `同一位模特在精品街区自然停下，正面手持同一个包。动作处方：身体微侧 20 度，重心压在左脚，肩放松，头向右轻歪，下巴自然，双手自然托住包的手柄，眼睛看镜头右侧 30 厘米的位置。${accessoryLifestyleCampaignInstruction} ${sceneLightingIntegrationInstruction}`,
    size: "1024x1536",
    ratio: "4:5",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: true,
  },
  {
    id: "accessory-material-closeup",
    title: "材质特写",
    instruction:
      "拍一张商品细节照片，不要拼图：近距离展示同一个包的材质、五金、肩带、缝线、扣具、手柄或纹理。浅景深、自然柔光，可有手/桌面接触。不要模特脸，不要额外款式，不要文字。",
    size: "1024x1024",
    ratio: "1:1",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
  {
    id: "accessory-side-glance",
    title: "侧身回眸",
    instruction:
      `同一位模特从 3/4 侧身角度展示同一个包。动作处方：身体略背过去，右肩靠近镜头，重心在后脚，头只轻轻回一点，下巴放松，眼睛看画面右上方的店铺招牌，不要锁镜头。肩带贴住肩部，包的比例要清楚。${accessoryLifestyleCampaignInstruction} ${sceneLightingIntegrationInstruction}`,
    size: "1024x1536",
    ratio: "4:5",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: true,
  },
  {
    id: "accessory-table-hero",
    title: "桌面静物",
    instruction:
      "拍一张商品静物主图：同一个包自然放在咖啡桌、精品店柜台、椅子或长凳上，少量道具呼应场景。柔和环境光、接触阴影、浅景深、轮廓清楚。不要模特、拼图、额外款式和烧字。",
    size: "1024x1024",
    ratio: "1:1",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
  {
    id: "accessory-walking-carry",
    title: "行走携带",
    instruction:
      `同一位模特边走边携带同一个包。动作处方：身体斜着穿过画面，前脚落地、后脚刚离开地面，重心正在移动；一只手扶包带，另一只手自然摆动，头向光源轻歪，眼睛看画面右侧的店铺橱窗。停在动作之间，不是静态目录站姿；包形和肩带位置要清楚。${accessoryLifestyleCampaignInstruction} ${sceneLightingIntegrationInstruction}`,
    size: "1024x1536",
    ratio: "4:5",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: true,
  },
  {
    id: "accessory-seated-interaction",
    title: "坐姿互动",
    instruction:
      `同一位模特坐在咖啡桌边与同一个包互动。动作处方：上身略向包倾斜，头向右轻歪，左手轻托下巴，右手打开腿上的包；眼睛低头看包的开口，眼皮放松，不要模卡式直视。${accessoryLifestyleCampaignInstruction} ${sceneLightingIntegrationInstruction}`,
    size: "1024x1536",
    ratio: "4:5",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: true,
  },
];

const amazonTemplates: PlanTemplate[] = [
  {
    id: "white-main",
    title: "白底主图",
    instruction:
      "Create a platform-ready white background main image. Keep product proportions exact, background pure and clean, no extra props, no text.",
    size: "1024x1024",
    ratio: "1:1",
    whiteBackground: true,
    textAllowed: false,
    modelRequired: false,
  },
  {
    ...genericPlanTemplates[1],
    id: "infographic",
    title: "卖点信息图",
    size: "1024x1024",
    ratio: "1:1",
  },
  {
    id: "dimensions",
    title: "尺寸说明",
    instruction:
      "Create a platform-safe dimensions image that explains scale and practical details with clean product-safe composition.",
    size: "1024x1024",
    ratio: "1:1",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
  genericPlanTemplates[3],
  {
    id: "package",
    title: "包装展示",
    instruction:
      "Create a product and package display image with clean retail presentation and consistent commercial lighting.",
    size: "1024x1024",
    ratio: "1:1",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
];

const whiteProductMultiViewTemplates: PlanTemplate[] = [
  {
    id: "white-front",
    title: "白底正面",
    instruction:
      "Create a platform-ready white background product image from the front angle. Preserve the referenced product identity, proportions, color, material, logo placement, and visible structure. Use pure white background, clean commercial lighting, no props, no model, no text.",
    size: "1024x1024",
    ratio: "1:1",
    whiteBackground: true,
    textAllowed: false,
    modelRequired: false,
  },
  {
    id: "white-three-quarter",
    title: "白底 45°",
    instruction:
      "Create a three-quarter white background product image at about 45 degrees. Keep the same product identity and scale from the reference images, with accurate color, material, and silhouette. Use pure white background, no props, no model, no text.",
    size: "1024x1024",
    ratio: "1:1",
    whiteBackground: true,
    textAllowed: false,
    modelRequired: false,
  },
  {
    id: "white-side",
    title: "白底侧面",
    instruction:
      "Create a clean side-view product image on pure white background. Preserve real product thickness, profile, edge details, material, and proportions. Do not invent extra branding, packaging, props, text, or hands.",
    size: "1024x1024",
    ratio: "1:1",
    whiteBackground: true,
    textAllowed: false,
    modelRequired: false,
  },
  {
    id: "white-back-detail",
    title: "白底背面/结构",
    instruction:
      "Create a white background rear or structural-detail product image. If the back is not visible in the references, infer only safe structural continuity and avoid inventing unseen labels or decorative elements. Keep it suitable as a reusable product reference.",
    size: "1024x1024",
    ratio: "1:1",
    whiteBackground: true,
    textAllowed: false,
    modelRequired: false,
  },
  {
    id: "white-macro-detail",
    title: "白底细节",
    instruction:
      "Create a close product detail image on pure white background, focusing on material, finish, texture, functional part, or craftsmanship. Preserve the same product identity and avoid text, props, hands, or decorative scene elements.",
    size: "1024x1024",
    ratio: "1:1",
    whiteBackground: true,
    textAllowed: false,
    modelRequired: false,
  },
];

const xiaohongshuTemplates: PlanTemplate[] = [
  {
    id: "xiaohongshu-cover",
    title: "小红书封面",
    instruction:
      "Create a strong Xiaohongshu-style cover image with immediate product focus, lifestyle texture, and clean room for later title copy.",
    size: "1024x1536",
    ratio: "3:4",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
  genericPlanTemplates[3],
  genericPlanTemplates[2],
  {
    id: "save-card",
    title: "收藏图",
    instruction:
      "Create a save-worthy social commerce image that feels natural, polished, and visually consistent with the cover.",
    size: "1024x1536",
    ratio: "3:4",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
];

const posterTemplates: PlanTemplate[] = [
  {
    id: "kv",
    title: "品牌主视觉",
    instruction:
      "Create a polished campaign key visual with strong product hierarchy, premium lighting, and clear commercial focus.",
    size: "1024x1536",
    ratio: "4:5",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
  {
    id: "promo-poster",
    title: "促销海报",
    instruction:
      "Create a promotional poster-ready image with strong central composition and clean reserved space for later campaign copy.",
    size: "1024x1536",
    ratio: "4:5",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
  {
    id: "banner",
    title: "渠道 Banner",
    instruction:
      "Create a wide banner-ready commerce image with stable product identity and open negative space for later layout.",
    size: "1536x1024",
    ratio: "3:2",
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  },
];

function buildRequestedShotTemplates(request: string, targetCount: number): PlanTemplate[] {
  const shotNames = parseRequestedShotList(request, targetCount);
  if (shotNames.length < 2) return [];
  return shotNames.map((shotName, index) => {
    const profile = inferRequestedShotProfile(shotName, request);
    const normalizedTitle = normalizeRequestedShotTitle(shotName, index);
    const noTextRequested = isNoTextShotRequested(`${shotName} ${request}`);
    const copyText = noTextRequested ? undefined : extractRequestedShotBurnInText(shotName, request);
    const copyRenderMode = noTextRequested ? "metadata_only" : copyText ? "burn_in" : undefined;
    return {
      id: `requested-${slugifyRequestedShot(normalizedTitle) || index + 1}`,
      title: normalizedTitle,
      instruction: [
        `Create one single finished commercial image for this specific shot only: ${normalizedTitle}.`,
        "Treat this as one independent deliverable in the requested image set.",
        "Do not include the other requested shots inside this image.",
        noTextRequested
          ? "Do not render any readable text, captions, labels, slogans, badges, UI marks, watermarks, or typography inside the bitmap."
          : "",
        copyText
          ? "Render only the approved short text as a clean layout layer in a safe empty area; do not print it on the product, label, zipper, fabric, tag, screen, sign, or scene prop."
          : "",
        profile.instruction,
      ].filter(Boolean).join(" "),
      size: profile.size,
      ratio: profile.ratio,
      whiteBackground: profile.whiteBackground,
      textAllowed: noTextRequested ? false : profile.textAllowed || !!copyText,
      modelRequired: profile.modelRequired,
      copyText,
      copyRenderMode,
    };
  });
}

function parseRequestedShotList(request: string, targetCount: number): string[] {
  const scanRequest = request.replace(/\r/g, "").replace(/\n+/g, "；");
  const patterns = [
    /(?:generate|create|make|produce)\s+(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:finished\s+)?(?:images?|photos?|shots?|outputs?)\s*[:：]\s*([^。.\n]+)/i,
    /(?:generate|create|make|produce)\s+(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:finished\s+)?(?:images?|photos?|shots?|outputs?)\s+([^。.\n]+)/i,
    /(?:生成|输出|做|制作|需要)[^。.\n:：]{0,48}(?:成片|图|图片|样张|最终图|完成图|输出)\s*[:：]\s*([^。.\n]+)/i,
    /(?:生成|输出|做|制作|需要)\s*(?:\d{1,2}|[一二两三四五六七八九十])?\s*(?:张|个)?(?:成片|图|图片|样张|最终图|完成图)?\s*[:：]\s*([^。.\n]+)/i,
    /(?:分别是|包括)\s*[:：]\s*([^。.\n]+)/i,
  ];
  const match = patterns.map((pattern) => scanRequest.match(pattern)).find(Boolean);
  const rawList = match?.[1]?.trim();
  if (!rawList) return [];
  const items = splitRequestedShotItems(rawList)
    .map(cleanRequestedShotItem)
    .flatMap((item) => expandCountedRequestedShot(item, targetCount))
    .filter((item) => item.length >= 2 && item.length <= 140)
    .filter((item) => !/^(and|以及|还有)$/.test(item.toLowerCase()));
  if (items.length < 2) return [];
  return items.slice(0, targetCount);
}

function cleanRequestedShotItem(item: string): string {
  return item
    .trim()
    .replace(/^[-、\s]+/, "")
    .replace(/[。.]$/, "")
    .trim();
}

function expandCountedRequestedShot(item: string, targetCount: number): string[] {
  const match = item.match(/^(\d{1,2}|[一二两三四五六七八九十]|one|two|three|four|five|six|seven|eight|nine|ten)\s*(张成片|张图|张|幅|个|images?|pics?|photos?|shots?|outputs?)?\s*(.+)$/i);
  if (!match?.[1] || !match[3]) return [item];
  if (!match[2]) return [match[3].trim()];

  const count = Math.max(1, Math.min(targetCount, parseRequestedCountToken(match[1]) ?? 1));
  const rest = match[3].trim();
  if (count <= 1) return [rest];

  const baseTitle = stripRequestedShotExpansionNotes(rest);
  const variants = extractRequestedShotVariants(rest, count);
  return Array.from({ length: count }, (_, index) => {
    const variant = variants[index] ?? buildDefaultRequestedShotVariant(baseTitle, index, count);
    return `${baseTitle} ${index + 1}/${count}${variant ? `：${variant}` : ""}`.trim();
  });
}

function parseRequestedCountToken(value: string): number | undefined {
  const normalized = value.trim().toLowerCase();
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric);
  const chinese: Record<string, number> = {
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
  if (chinese[normalized]) return chinese[normalized];
  const english: Record<string, number> = {
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
  return english[normalized];
}

function stripRequestedShotExpansionNotes(value: string): string {
  return value
    .replace(/[:：]\s*(?:分别安排|分别是|分别为|分别)\s*.+$/i, "")
    .replace(/[，,]\s*(?:必须|每张|不要每张|不要|分别安排|分别是|分别为|分别)\s*.+$/i, "")
    .trim();
}

function extractRequestedShotVariants(value: string, count: number): string[] {
  const explicit = value.match(/(?:分别安排|分别是|分别为|分别)\s*[:：]?\s*([^。.\n]+)/i)?.[1]?.trim();
  const source = explicit || "";
  if (!source) return [];
  return source
    .split(/\s*[、,，;；]\s*/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 2)
    .slice(0, count);
}

function buildDefaultRequestedShotVariant(baseTitle: string, index: number, count: number): string {
  const text = baseTitle.toLowerCase();
  const noModel = /无人物|无模特|不要人物|不要模特|不需要人物|不需要模特|不用人物|不用模特|不带人物|不带模特|no model|no person|without model|without person/.test(text);
  if (/细节|材质|五金|特写|macro|detail|texture|material|扣|拉链|绒|皮革/.test(text)) {
    return [
      "材质纹理近景",
      "五金扣具特写",
      "边缘缝线与手柄细节",
      "开口结构与内部容量细节",
    ][index % 4];
  }
  if (/静物|场景|lifestyle|scene|桌面|花店|咖啡|商场/.test(text)) {
    return [
      "正面平拍，商品自然放在场景台面",
      "三分角侧拍，展示商品厚度和环境层次",
      "低机位近景，突出接触阴影和真实尺度",
      "轻俯拍，展示商品轮廓和周边道具关系",
    ][index % 4];
  }
  if (!noModel && /模特|model|look|穿搭|展示|街拍|上身|背|手持|佩戴/.test(text)) {
    return [
      "站立侧身回头，重心压在后脚，眼神看镜头旁边",
      "行走中轻扶商品，前脚落地，眼神看向街边橱窗",
      "坐姿低头整理商品，肩颈放松，眼神落在手部",
      "身体三分之二侧向镜头，一手提商品，另一手自然摆动",
    ][index % 4];
  }
  if (/卖点|海报|封面|poster|cover/.test(text)) {
    return [
      "主标题版式，商品占画面中心",
      "卖点短句版式，商品旁留干净安全区",
      "氛围主视觉版式，背景简洁不压商品",
    ][index % 3];
  }
  return count > 1 ? `第 ${index + 1} 个不同机位` : "";
}

function splitRequestedShotItems(rawList: string): string[] {
  const clean = rawList.trim();
  if (!clean) return [];

  if (/[;；]/.test(clean)) {
    return clean.split(/\s*[;；]\s*/);
  }

  if (/\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:horizontal|vertical|wide|portrait|landscape)\b/i.test(clean)) {
    return clean.split(
      /\s+(?=(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:horizontal|vertical|wide|portrait|landscape)\b)/i
    );
  }

  return clean.split(
    /\s*(?:,|，|、|\/|\||\band\b)\s*(?=(?:\d{1,2}|[一二两三四五六七八九十])?\s*(?:张|个|幅)?\s*(?:\d+\s*:\s*\d+|白底|主图|主视觉|海报|详情|细节|材质|卖点|小红书|封面|模特|场景|环境|雪山|户外|室内|街拍|amazon|taobao|poster|detail|model|scene|cover|banner))/i
  );
}

function normalizeRequestedShotTitle(shotName: string, index: number): string {
  const clean = shotName
    .replace(/\s+/g, " ")
    .replace(/^(a|an|the)\s+/i, "")
    .trim();
  return clean || `自定义成片 ${index + 1}`;
}

function slugifyRequestedShot(value: string): string {
  const ascii = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return ascii || "shot";
}

function inferRequestedShotProfile(shotName: string, fullRequest = ""): Omit<PlanTemplate, "id" | "title" | "instruction"> & {
  instruction: string;
} {
  const shotText = shotName.toLowerCase();
  const text = `${shotName} ${fullRequest}`.toLowerCase();
  const requestedRatio = extractRequestedRatio(shotName) ?? inferOrientationRatio(shotName);
  const requestedSize = requestedRatio ? imageSizeForRequestedRatio(requestedRatio) : undefined;
  const burnInRequested = isShotBurnInRequested(text) && !isNoTextShotRequested(text);
  const productOnlyShot = /商品静物|静物|材质|五金|细节|详情页|参数|尺寸|微距|特写|无人物|无模特|不要人物|不要模特|不需要人物|不需要模特|不用人物|不用模特|不带人物|不带模特/i.test(shotText);
  const hasModelIntent = !productOnlyShot && (
    /model|模特|wear|wearing|carry|carrying|holding|背|拿|手持|上身|穿着|坐姿|行走|回眸|侧身/i.test(shotText) ||
    (/(cover|poster|hero|scene|封面|海报|主视觉|场景图)/i.test(shotText) && /model|模特|同一位|同一个人|真人|人物/.test(text))
  );
  if (/(white|packshot|amazon|listing|白底|主图|亚马逊)/i.test(shotName)) {
    const ratio = requestedRatio ?? "1:1";
    return {
      instruction: "Use a clean product-led marketplace composition with exact product identity and no extra scene clutter.",
      size: requestedSize ?? "1024x1024",
      ratio,
      whiteBackground: /(white|白底|amazon|亚马逊)/i.test(shotName),
      textAllowed: false,
      modelRequired: false,
    };
  }
  if (/(xiaohongshu|rednote|cover|小红书|封面)/i.test(shotName)) {
    const ratio = requestedRatio ?? "3:4";
    return {
      instruction: burnInRequested
        ? "Make it feel like a polished social cover with strong first-glance product hierarchy and a clean copy-safe area for one short visible headline."
        : "Make it feel like a polished social cover with strong first-glance product hierarchy and clean space for later editable copy.",
      size: requestedSize ?? imageSizeForRequestedRatio(ratio),
      ratio,
      whiteBackground: false,
      textAllowed: burnInRequested,
      modelRequired: hasModelIntent,
    };
  }
  if (/(poster|taobao|selling|benefit|卖点|淘宝|海报)/i.test(shotName)) {
    const ratio = requestedRatio ?? "4:5";
    return {
      instruction: burnInRequested
        ? "Use a poster-ready commercial composition with one clear visual selling point and a clean safe area for one short visible copy line."
        : "Use a poster-ready commercial composition with one clear selling point and reserved negative space for editable copy layers.",
      size: requestedSize ?? imageSizeForRequestedRatio(ratio),
      ratio,
      whiteBackground: false,
      textAllowed: burnInRequested,
      modelRequired: hasModelIntent,
    };
  }
  if (/(detail|close|macro|material|texture|特写|细节|材质|五金|肩带|手柄|扣|拉链|绒|皮革|织物)/i.test(shotName)) {
    const ratio = requestedRatio ?? "1:1";
    return {
      instruction: "Focus on one product detail, material, texture, hardware, or craftsmanship proof point without turning it into a multi-panel board.",
      size: requestedSize ?? "1024x1024",
      ratio,
      whiteBackground: false,
      textAllowed: false,
      modelRequired: false,
    };
  }
  if (hasModelIntent) {
    const ratio = requestedRatio ?? "4:5";
    return {
      instruction: `Use a realistic location-shot fashion/product photograph. ${buildShotSpecificActionDirection(shotName, fullRequest)} ${productModelRealismInstruction} ${modelActionMotivationInstruction} ${sceneLightingIntegrationInstruction}`,
      size: requestedSize ?? imageSizeForRequestedRatio(ratio),
      ratio,
      whiteBackground: false,
      textAllowed: false,
      modelRequired: true,
    };
  }
  if (/(outdoor|indoor|street|cafe|room|shop|store|室内|户外|街拍|咖啡|商场|花店|店铺|场景)/i.test(text)) {
    const ratio = requestedRatio ?? "4:5";
    return {
      instruction: "Use a realistic product-only lifestyle location photograph. Place the exact product naturally in the requested environment with believable scale, contact shadows, lens perspective, and scene lighting. Do not add people, models, hands, faces, mannequins, readable labels, or extra product variants unless explicitly requested.",
      size: requestedSize ?? imageSizeForRequestedRatio(ratio),
      ratio,
      whiteBackground: false,
      textAllowed: burnInRequested,
      modelRequired: false,
    };
  }
  if (/(banner|横幅)/i.test(text)) {
    const ratio = requestedRatio ?? "3:2";
    return {
      instruction: "Use a wide channel banner composition with product hierarchy and open copy-safe space.",
      size: requestedSize ?? "1536x1024",
      ratio,
      whiteBackground: false,
      textAllowed: false,
      modelRequired: false,
    };
  }
  const ratio = requestedRatio ?? "4:5";
  return {
    instruction: "Keep the image focused on this one shot purpose with realistic commercial lighting and a clean single-frame composition.",
    size: requestedSize ?? imageSizeForRequestedRatio(ratio),
    ratio,
    whiteBackground: false,
    textAllowed: false,
    modelRequired: false,
  };
}

function isShotBurnInRequested(value: string): boolean {
  return /(烧进|烧字|带字|带文案|短文案|短标题|文案进图|直接出字|画面文字|图中文字|海报标题|封面标题|图片上写|写上|加字|burn[\s-]?in|in-image|render text)/i.test(value);
}

function isNoTextShotRequested(value: string): boolean {
  return /(无字|无文字|不要文字|不要文案|不加字|不带字|不要加字|不烧字|不要烧字|不出字|不要出字|文案不要进图|文字不要进图|文案不进图|文字不进图|不要把文案放进图|不要把文字放进图|不要进图|no\s+text|without\s+text|textless)/i.test(value);
}

function extractRequestedShotBurnInText(value: string, context = ""): string | undefined {
  if (isNoTextShotRequested(`${value} ${context}`)) return undefined;
  if (!isShotBurnInRequested(value)) return undefined;
  const quoted = value.match(/[「『“"]([^」』”"]{1,24})[」』”"]/);
  const text = quoted?.[1]?.trim();
  if (text) return `画面文字：${text}`;
  const fallback = inferDefaultBurnInCopy(value, context);
  return fallback ? `画面文字：${fallback}` : undefined;
}

function extractLooseBurnInText(value: string): string | undefined {
  if (isNoTextShotRequested(value)) return undefined;
  if (!isShotBurnInRequested(value)) return undefined;
  const patterns = [
    /(?:画面文字|图中文字|海报标题|封面标题|短标题|图片上写|写上|加字|烧字|带字|带文案|短文案)\s*[:：]\s*([^。.\n]{1,24})/i,
    /(?:burn[\s-]?in|render)\s+(?:short\s+)?(?:text|copy|words?)\s*[:：]?\s+([a-z0-9][a-z0-9\s'-]{1,30})$/i,
  ];
  const match = patterns.map((pattern) => value.match(pattern)).find(Boolean);
  const text = match?.[1]?.trim().replace(/[。.,，]+$/, "");
  return text ? `画面文字：${text}` : undefined;
}

function inferDefaultBurnInCopy(value: string, context = ""): string | undefined {
  const text = `${value} ${context}`.toLowerCase();
  if (/毛绒|绒|软糯|furry|plush/.test(text) && /包|bag/.test(text)) {
    return "软糯小包 出门刚好";
  }
  if (/羽绒服|down jacket|puffer/.test(text)) return "轻暖出行 不惧寒风";
  if (/手机|phone|小米|xiaomi/.test(text)) return "影像旗舰 随手出片";
  if (/鼠标|mouse|rog|gaming/.test(text)) return "精准掌控 一触即发";
  if (/封面|cover|小红书|rednote/.test(text)) return "今日新品 值得收藏";
  if (/详情|卖点|海报|poster|selling|benefit/.test(text)) return "质感细节 一眼心动";
  return "新品上新 值得收藏";
}

function extractRequestedRatio(value: string): string | undefined {
  const match = value.match(/(?:^|[^\d])((?:1:1|3:2|4:3|3:4|4:5|5:4|9:16|16:9|2:3|3:5))(?:$|[^\d])/i);
  return match?.[1];
}

function inferOrientationRatio(value: string): string | undefined {
  if (/\b(horizontal|wide|landscape)\b|横版|横图/i.test(value)) return "3:2";
  if (/\b(vertical|portrait)\b|竖版|竖图/i.test(value)) return "4:5";
  return undefined;
}

function imageSizeForRequestedRatio(ratio: string): "1024x1024" | "1024x1536" | "1536x1024" {
  const normalized = ratio.trim().toLowerCase();
  if (normalized === "1:1" || normalized === "square") return "1024x1024";
  if (["16:9", "3:2", "2:1", "landscape", "横版"].includes(normalized)) return "1536x1024";
  return "1024x1536";
}

function selectPlanSeedTemplates(request: string, outputType: string): PlanTemplate[] {
  const noModelRequested = isNoModelRequested(request);
  if (outputType.includes("product_asset")) return productAssetTemplates;
  if (outputType.includes("model_asset")) return modelAssetTemplates;
  if (outputType.includes("style_asset") || outputType.includes("visual_style")) return styleAssetTemplates;
  if (isAccessoryLifestyleCampaignRequest(request, outputType)) return accessoryLifestyleCampaignTemplates;
  if (hasAnyKeyword(request, ["亚马逊", "amazon"])) return amazonTemplates;
  if (hasAnyKeyword(request, ["详情页", "详情", "detail"]) || outputType.includes("detail")) {
    return detailPageTemplates;
  }
  if (hasAnyKeyword(request, ["小红书", "种草", "xiaohongshu", "rednote"])) return xiaohongshuTemplates;
  if (hasAnyKeyword(request, ["海报", "poster", "banner", "kv"]) || outputType.includes("poster")) {
    return posterTemplates;
  }
  if (isWhiteBackgroundRequest(request, outputType)) {
    return whiteProductMultiViewTemplates;
  }
  if (!noModelRequested && (hasAnyKeyword(request, ["模特", "上身", "穿着", "model"]) || outputType.includes("model"))) {
    return [genericPlanTemplates[4], genericPlanTemplates[0], genericPlanTemplates[2]];
  }
  if (isSceneRequest(request, outputType)) {
    if (isSceneBoardRequest(request, outputType)) return sceneContinuityBoardTemplates;
    return sceneMultiViewTemplates;
  }
  return genericPlanTemplates.slice(0, 3);
}

function mergeKeywordPlanTemplates(
  templates: PlanTemplate[],
  request: string,
  outputType: string
): PlanTemplate[] {
  let next = [...templates];
  const noModelRequested = isNoModelRequested(request);
  if (next.some((template) => template.id.startsWith("accessory-"))) return next;
  if (
    !noModelRequested &&
    (hasAnyKeyword(request, ["模特", "上身", "穿着", "model"]) || outputType.includes("model")) &&
    !next.some((template) => template.id === "model" || template.modelRequired)
  ) {
    next = insertPlanTemplate(next, genericPlanTemplates[4], 4);
  }
  if (
    isSceneRequest(request, outputType) &&
    !next.some((template) => template.id === "scene" || template.id.startsWith("scene-"))
  ) {
    next = insertPlanTemplate(next, genericPlanTemplates[3], 5);
  }
  return next;
}

function isNoModelRequested(value: string): boolean {
  return /no model|no person|without model|without person|product[-_ ]?only|无模特|无人物|不要模特|不要人物|不需要模特|不需要人物|不用模特|不用人物|不带模特|不带人物|不要使用模特|不要使用人物|无需模特|无需人物|模特不要|人物不要/i.test(value);
}

function buildShotSpecificActionDirection(shotName: string, fullRequest: string): string {
  const text = `${shotName} ${fullRequest}`.toLowerCase();
  if (/(detail|close|macro|特写|细节|材质|五金|肩带|扣|拉链)/i.test(text)) {
    return "Use a tight product or hand-product detail moment with realistic finger pressure, contact shadows, material texture, and shallow depth of field.";
  }
  if (/(seated|sit|sitting|坐|坐姿)/i.test(text)) {
    return "The model should be seated and interacting with the product on her lap or a nearby table, looking down or softly to the side, as if checking or adjusting it.";
  }
  if (/(walk|walking|行走|走路|街拍|逛)/i.test(text)) {
    return "The model should be captured mid-walk with a natural stride, slight body asymmetry, and the product swinging or resting naturally against the body.";
  }
  if (/(side|back|over-shoulder|回眸|侧身|背影|转身)/i.test(text)) {
    return "Use a side or over-shoulder moment: the model turns back slightly with a soft glance, while the product strap or handle remains clearly visible and physically attached.";
  }
  if (/(front|正面|手持|holding|hold|拿|拎)/i.test(text)) {
    return "Use a front or slight 3/4 view where the model naturally holds the product with both hands or one relaxed hand, with a gentle expression and clear handle contact.";
  }
  return "Give the model a small believable moment: pausing at a doorway, adjusting the strap, opening the product, checking a detail, looking toward a shop window, or responding to someone off camera.";
}

function isAccessoryLifestyleCampaignRequest(request: string, outputType: string): boolean {
  const text = `${request} ${outputType}`.toLowerCase();
  const hasAccessory =
    /包包|女包|男包|手袋|手包|背包|小包|毛绒包|挎包|单肩包|托特|腋下包|链条包|水桶包|handbag|(?:^|[^a-z])bag(?:$|[^a-z])|purse|tote|accessory/i.test(text);
  const hasLifestyleModel = hasAnyKeyword(text, [
    "模特",
    "model",
    "背",
    "拿",
    "手持",
    "拎",
    "穿搭",
    "街拍",
    "生活方式",
    "多场景",
    "组图",
    "一组",
    "campaign",
    "lookbook",
    "lifestyle",
  ]);
  return hasAccessory && hasLifestyleModel && !isWhiteBackgroundRequest(request, outputType);
}

function insertPlanTemplate(
  templates: PlanTemplate[],
  template: PlanTemplate,
  index: number
): PlanTemplate[] {
  return [
    ...templates.slice(0, index),
    template,
    ...templates.slice(index),
  ];
}

function inferDefaultPlanCount(request: string, outputType: string): number {
  if (
    outputType.includes("product_asset") ||
    outputType.includes("model_asset") ||
    outputType.includes("style_asset") ||
    outputType.includes("visual_style") ||
    outputType.includes("knowledge_asset")
  ) {
    return 1;
  }
  if (hasAnyKeyword(request, ["亚马逊", "amazon"])) return 5;
  if (hasAnyKeyword(request, ["详情页", "详情", "detail"]) || outputType.includes("detail")) return 6;
  if (hasAnyKeyword(request, ["小红书", "种草", "xiaohongshu", "rednote"])) return 4;
  if (hasAnyKeyword(request, ["海报", "poster", "banner", "kv"]) || outputType.includes("poster")) return 3;
  if (isWhiteBackgroundRequest(request, outputType)) {
    return isMultiViewRequest(request) ? 5 : 4;
  }
  if (hasAnyKeyword(request, ["模特", "上身", "穿着", "model"]) || outputType.includes("model")) return 3;
  if (isSceneBoardRequest(request, outputType)) return 1;
  if (isSceneRequest(request, outputType)) return 5;
  return 3;
}

function isWhiteBackgroundRequest(request: string, outputType: string): boolean {
  return hasAnyKeyword(request, ["白底", "白底图", "主图", "white", "white background"]) || outputType.includes("white");
}

function isMultiViewRequest(request: string): boolean {
  return hasAnyKeyword(request, ["多视角", "多角度", "完整", "一套", "组图", "角度", "multi-view", "multiple angles"]);
}

function isSceneRequest(request: string, outputType: string): boolean {
  return hasAnyKeyword(request, [
    "场景",
    "生活方式",
    "环境",
    "空间",
    "置景",
    "不穿帮",
    "多机位",
    "多角度场景",
    "scene",
    "lifestyle",
    "environment",
  ]) || outputType.includes("scene");
}

function isSceneBoardRequest(request: string, outputType: string): boolean {
  return hasAnyKeyword(request, [
    "大图",
    "合并",
    "一张图",
    "单张",
    "参考板",
    "总览板",
    "设定板",
    "拼图",
    "四宫格",
    "board",
    "contact sheet",
    "single image",
    "one image",
  ]) || outputType.includes("scene_board");
}

function parseRequestedImageCount(request: string): number | undefined {
  const countedMatches = [...request.matchAll(/(\d{1,2})\s*(?:张成片|张图|张|幅|images?|pics?|photos?|shots?|outputs?)/gi)].map((match) => ({
    value: Number(match[1]),
    index: match.index ?? 0,
  }));
  if (countedMatches.length > 1) {
    const first = countedMatches[0];
    const listDelimiterIndex = request.search(/[:：]/);
    const afterDelimiter = listDelimiterIndex >= 0
      ? countedMatches.filter((match) => match.index > listDelimiterIndex)
      : countedMatches;
    const itemCounts = afterDelimiter.length > 1 ? afterDelimiter : countedMatches;
    const itemTotal = itemCounts.reduce((sum, match) => sum + match.value, 0);
    if (first && listDelimiterIndex >= 0 && first.index < listDelimiterIndex) {
      const restTotal = countedMatches
        .filter((match) => match.index > listDelimiterIndex)
        .reduce((sum, match) => sum + match.value, 0);
      return restTotal > 0 ? Math.max(first.value, restTotal) : first.value;
    }
    return itemTotal;
  }

  const digitPatterns = [
    /(\d{1,2})\s*(?:张成片|张图|张|幅|图|p|P|images?|pics?|photos?|shots?|outputs?)/i,
    /(\d{1,2})\s+(?:finished\s+)?(?:images?|photos?|shots?|outputs?)/i,
    /(\d{1,2})\s*(?:张|幅)?\s*(?:成片|最终图|完成图)/i,
  ];
  for (const pattern of digitPatterns) {
    const digitMatch = request.match(pattern);
    if (digitMatch) return Number(digitMatch[1]);
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
  const chineseMatch = request.match(/([一二两三四五六七八九十])\s*(?:张成片|张图|张|幅|图|成片|最终图|完成图)/);
  if (chineseMatch) return chineseDigits[chineseMatch[1]];

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
  const englishMatch = request.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:finished\s+)?(?:images?|photos?|shots?|outputs?)\b/i);
  if (!englishMatch) return undefined;
  return englishDigits[englishMatch[1].toLowerCase()];
}

function clampPlanCount(count: number, maxItems: number): number {
  const max = Math.max(1, maxItems);
  return Math.min(Math.max(Math.round(count), 1), max);
}

function hasAnyKeyword(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}

function normalizeSlotSource(value: unknown): GenerationFrameSlotSource {
  if (
    value === "canvas-node" ||
    value === "canvas-asset" ||
    value === "generated-output" ||
    value === "legacy" ||
    value === "manual"
  ) {
    return value;
  }
  return "manual";
}

function inferRoleFromLegacySource(data: CanvasNodeData): GenerationFrameRole | undefined {
  const sourceType = getString(data.sourceNodeType);
  if (isGenerationFrameRole(sourceType)) return sourceType;
  return undefined;
}

function inferRoleFromNode(node: CanvasWorkbenchNode): GenerationFrameRole | undefined {
  return inferRoleFromCategory(getString(node.data.category)) ??
    inferRoleFromComponentType(getString(node.data.componentType)) ??
    inferRoleFromIcon(getString(node.data.iconName)) ??
    inferRoleFromId(node.id);
}

function inferRoleFromAsset(asset: CanvasAsset): GenerationFrameRole | undefined {
  return inferRoleFromCategory(asset.category) ??
    inferRoleFromComponentType(asset.componentType) ??
    inferRoleFromId(asset.id);
}

function inferRoleFromCategory(category: CanvasLibraryCategory | string | undefined): GenerationFrameRole | undefined {
  if (category === "商品") return "product";
  if (category === "模特") return "model";
  if (category === "风格") return "style";
  if (category === "场景") return "scene";
  if (category === "文案") return "copy";
  return undefined;
}

function inferRoleFromComponentType(value: string | undefined): GenerationFrameRole | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "_");
  if (normalized === "product" || normalized === "product_asset") return "product";
  if (normalized === "model" || normalized === "model_asset") return "model";
  if (
    normalized === "style" ||
    normalized === "visual_style" ||
    normalized === "brand_kit" ||
    normalized === "prompt_source"
  ) {
    return "style";
  }
  if (normalized === "scene") return "scene";
  if (
    normalized === "copy" ||
    normalized === "copy_asset" ||
    normalized === "text" ||
    normalized === "text_asset" ||
    normalized === "knowledge" ||
    normalized === "knowledge_asset" ||
    normalized === "prompt_knowledge" ||
    normalized === "claim" ||
    normalized === "copy_rules"
  ) {
    return "copy";
  }
  return undefined;
}

function inferRoleFromIcon(value: string | undefined): GenerationFrameRole | undefined {
  return isGenerationFrameRole(value) ? value : undefined;
}

function inferRoleFromId(value: string | undefined): GenerationFrameRole | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return generationFrameRoles.find((role) => normalized.includes(role));
}

function dedupeReferenceImages(images: GenerationReferenceImage[]): GenerationReferenceImage[] {
  const seen = new Set<string>();
  return images.filter((image) => {
    const key = `${image.role}:${image.url}:${image.nodeId ?? ""}:${image.assetId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getOutputKey(output: GenerationFrameOutput): string {
  return output.jobId ?? output.artifactId ?? output.url ?? output.id;
}

function getFirstString(values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeProviderMode(value: unknown): GenerationFrameSlotBinding["providerMode"] {
  return value === "provider_input" || value === "prompt_only" || value === "disabled"
    ? value
    : undefined;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && !!item.trim());
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function mergeRecords(
  base: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const merged = {
    ...(base ?? {}),
    ...(next ?? {}),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
