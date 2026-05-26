import { getAssetSopDefinition } from "@/lib/canvas/asset-sop-registry";
import type { CanvasReferenceSlot } from "@/lib/canvas/canvas-reference-slots";
import type {
  GenerationPlanItem,
  SopExecutionPlan,
  SopExecutionPlanPromptBlock,
  SopExecutionPlanRequiredInput,
  SopExecutionPlanStep,
} from "@/lib/canvas/generation-plan";
import type { GenerationReferenceContext } from "@/lib/canvas/generation-reference-context";
import type { KnowledgeTemplateSelection } from "@/lib/canvas/knowledge-template-selector";
import { normalizeCopyRenderPolicy } from "@/lib/canvas/copy-render-policy";

export interface BuildSopExecutionPlanInput {
  items: GenerationPlanItem[];
  knowledgeSelection: KnowledgeTemplateSelection;
  referenceContext?: GenerationReferenceContext;
  referenceSlots: CanvasReferenceSlot[];
  createdAt: string;
}

export function buildSopExecutionPlan({
  items,
  knowledgeSelection,
  referenceContext,
  referenceSlots,
  createdAt,
}: BuildSopExecutionPlanInput): SopExecutionPlan {
  const promptBlocks = buildPromptBlocks({ items, knowledgeSelection, referenceContext });
  const qaRules = buildQaRules(knowledgeSelection);
  const requiredInputs = buildRequiredInputs({ knowledgeSelection, referenceSlots, referenceContext });
  const steps = buildSteps({ items, knowledgeSelection, promptBlocks, qaRules });

  return {
    version: 1,
    mode: "dry_run_metadata_only",
    steps,
    requiredInputs,
    promptBlocks,
    qaRules,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: [1200, 3000],
      retryableFailureSignals: [
        "provider_timeout",
        "provider_socket_closed",
        "transient_5xx",
        "reference_upload_retryable",
      ],
      stopConditions: [
        "missing_required_input",
        "identity_or_sop_boundary_violation",
        "provider_call_not_confirmed",
      ],
      fallbackAction: "return_to_draft_for_review",
    },
    debugSource: {
      source: "knowledgeSelection",
      builtAt: createdAt,
      sopKeys: knowledgeSelection.sopKeys,
      sourceTutorialIds: knowledgeSelection.sourceTutorialIds,
      knowledgeTrace: knowledgeSelection.knowledgeTrace,
      selectedTemplateSources: knowledgeSelection.selectedTemplates.map((template) => ({
        id: template.id,
        title: template.title,
        source: template.source,
        sourceTutorialIds: template.sourceTutorialIds,
        score: template.score,
      })),
    },
  };
}

export function publicKnowledgeSelection(
  knowledgeSelection: KnowledgeTemplateSelection
): KnowledgeTemplateSelection {
  return {
    ...knowledgeSelection,
    sourceTutorialIds: [],
    knowledgeTrace: knowledgeSelection.knowledgeTrace.map(({ sourceId: _sourceId, ...entry }) => entry),
    selectedTemplates: knowledgeSelection.selectedTemplates.map((template) => ({
      ...template,
      sourceTutorialIds: [],
    })),
  };
}

function buildRequiredInputs({
  knowledgeSelection,
  referenceSlots,
  referenceContext,
}: {
  knowledgeSelection: KnowledgeTemplateSelection;
  referenceSlots: CanvasReferenceSlot[];
  referenceContext?: GenerationReferenceContext;
}): SopExecutionPlanRequiredInput[] {
  const slotInputs = referenceSlots.map((slot): SopExecutionPlanRequiredInput => ({
    id: `reference.${slot.role}`,
    label: `${slot.role} reference`,
    role: slot.role,
    source: "reference_slot",
    required: slot.required,
    status: slot.validationStatus === "provider_usable" ? "ready" : slot.required ? "missing" : "optional",
    notes: slot.issues,
  }));

  const promptOnlyKnowledge = knowledgeSelection.selectedTemplates
    .filter((template) => template.referenceMode === "prompt_only")
    .map((template): SopExecutionPlanRequiredInput => ({
      id: `knowledge.${template.id}`,
      label: template.title,
      source: "prompt_only_knowledge",
      required: false,
      status: "ready",
      notes: ["Use as prompt guidance only; do not send as provider image input."],
    }));

  const contextInputs = referenceContext?.promptFragments?.length
    ? [{
        id: "context.prompt_fragments",
        label: "Reference prompt fragments",
        source: "reference_context" as const,
        required: false,
        status: "ready" as const,
        notes: [`${referenceContext.promptFragments.length} prompt fragments available.`],
      }]
    : [];

  return dedupeById([...slotInputs, ...promptOnlyKnowledge, ...contextInputs]);
}

function buildPromptBlocks({
  items,
  knowledgeSelection,
  referenceContext,
}: {
  items: GenerationPlanItem[];
  knowledgeSelection: KnowledgeTemplateSelection;
  referenceContext?: GenerationReferenceContext;
}): SopExecutionPlanPromptBlock[] {
  const roleBlocks = knowledgeSelection.sopKeys.flatMap((sopKey): SopExecutionPlanPromptBlock[] => {
    const sop = getSopByKey(sopKey);
    if (!sop) return [];
    return [{
      id: `sop.${sop.role}`,
      title: `${sop.label} SOP`,
      source: "sop_registry",
      content: [
        sop.description,
        ...sop.invariants,
        ...sop.promptBoundaries,
        ...sop.negativeRules.map((rule) => `Negative: ${rule}`),
      ],
    }];
  });

  const itemBlocks = items.map((item): SopExecutionPlanPromptBlock => ({
    id: `item.${item.itemId}`,
    title: item.title,
    source: "plan_item",
    content: buildItemPromptContent(item),
  }));

  const knowledgeBlocks = knowledgeSelection.selectedTemplates.map((template): SopExecutionPlanPromptBlock => ({
    id: `knowledge.${template.id}`,
    title: template.title,
    source: template.referenceMode === "prompt_only" ? "prompt_only_knowledge" : "selected_template",
    content: [
      `${template.title} guidance`,
      ...template.qualityRules,
      ...template.reasons.map((reason) => `Selection reason: ${reason}`),
    ],
  }));

  const referenceBlock: SopExecutionPlanPromptBlock[] = referenceContext
    ? [{
        id: "reference.context",
        title: "Reference Context",
        source: "reference_context",
        content: [
          ...(referenceContext.promptFragments ?? []),
          ...(referenceContext.constraints ?? []),
          ...(referenceContext.negativeRules ?? []).map((rule) => `Negative: ${rule}`),
          ...(referenceContext.qualityRules ?? []),
        ],
      }]
    : [];

  return dedupeById([...roleBlocks, ...knowledgeBlocks, ...referenceBlock, ...itemBlocks])
    .filter((block) => block.content.length > 0);
}

function buildItemPromptContent(item: GenerationPlanItem): string[] {
  const policy = item.copyRenderPolicy ?? normalizeCopyRenderPolicy(item.metadata.copyRenderPolicy);
  const content = [item.prompt].filter(Boolean);
  if (!policy || policy.mode === "metadata_only") return content;

  content.push(...policy.promptFragments);
  content.push(...policy.constraints);
  content.push(...policy.negativeRules.map((rule) => `Negative: ${rule}`));
  if (policy.mode === "layout_layer" && item.copyText) {
    content.push("Copy is available as editable layout metadata; do not render it as readable bitmap text.");
  }
  if (policy.mode === "burn_in" && item.copyText) {
    content.push("Visible copy burn-in is explicitly enabled for this item; render only approved short text.");
  }
  return dedupeStrings(content);
}

function buildQaRules(knowledgeSelection: KnowledgeTemplateSelection): string[] {
  const sopQaRules = knowledgeSelection.sopKeys.flatMap((sopKey) => getSopByKey(sopKey)?.reviewChecks ?? []);
  return dedupeStrings([
    ...sopQaRules,
    ...knowledgeSelection.qualityRules,
    "Do not expose tutorial, course, or Super-i source labels in user-facing copy.",
    "Keep source lineage in debug metadata only.",
  ]);
}

function buildSteps({
  items,
  knowledgeSelection,
  promptBlocks,
  qaRules,
}: {
  items: GenerationPlanItem[];
  knowledgeSelection: KnowledgeTemplateSelection;
  promptBlocks: SopExecutionPlanPromptBlock[];
  qaRules: string[];
}): SopExecutionPlanStep[] {
  const steps: SopExecutionPlanStep[] = [
    {
      id: "collect-inputs",
      title: "Collect required inputs",
      action: "validate_reference_slots",
      requiredInputIds: knowledgeSelection.requiredReferenceRoles.map((role) => `reference.${role}`),
      promptBlockIds: [],
      qaRuleIds: [],
      providerAction: "none",
    },
    {
      id: "compose-prompt",
      title: "Compose SOP prompt blocks",
      action: "merge_prompt_blocks",
      dependsOn: ["collect-inputs"],
      requiredInputIds: [],
      promptBlockIds: promptBlocks.map((block) => block.id),
      qaRuleIds: [],
      providerAction: "none",
    },
    {
      id: "qa-gate",
      title: "Run SOP QA gate",
      action: "check_quality_rules",
      dependsOn: ["compose-prompt"],
      requiredInputIds: [],
      promptBlockIds: [],
      qaRuleIds: qaRules.map((_, index) => `qa.${index + 1}`),
      providerAction: "none",
    },
  ];

  for (const item of items) {
    steps.push({
      id: `prepare-item.${item.itemId}`,
      title: `Prepare ${item.title}`,
      action: "prepare_generation_item",
      dependsOn: ["qa-gate"],
      requiredInputIds: [],
      promptBlockIds: [`item.${item.itemId}`],
      qaRuleIds: qaRules.map((_, index) => `qa.${index + 1}`),
      providerAction: "deferred_until_user_approval",
    });
  }

  return steps;
}

function getSopByKey(sopKey: string) {
  for (const category of ["product_asset", "model_asset", "scene_asset", "style_asset"] as const) {
    const sop = getAssetSopDefinition(category);
    if (sop?.sopKey === sopKey) return sop;
  }
  return undefined;
}

function dedupeById<T extends { id: string }>(values: T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.id)) return false;
    seen.add(value.id);
    return true;
  });
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
