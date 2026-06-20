import type {
  ProviderCallEstimate,
  ProviderCallPolicy,
} from "@/lib/ai/provider-call-policy";
import type {
  CanvasReferenceRole,
  CanvasReferenceSlot,
} from "@/lib/canvas/canvas-reference-slots";
import type { GenerationReferenceContext } from "@/lib/canvas/generation-reference-context";
import type { KnowledgeTemplateSelection } from "@/lib/canvas/knowledge-template-selector";
import type { CopyRenderMode, CopyRenderPolicy } from "@/lib/canvas/copy-render-policy";
import type { CampaignBible, CampaignShot } from "@/lib/canvas/campaign-planning";

export type GenerationPlanStatus = "draft" | "blocked" | "ready" | "approved";
export type GenerationPlanApprovalStatus = "pending" | "approved" | "blocked" | "not_required";

export interface GenerationPlanItem {
  itemId: string;
  title: string;
  prompt: string;
  type: string;
  copyText: string;
  exportSpecId?: string;
  naming?: string;
  size?: string;
  ratio?: string;
  whiteBackground?: boolean;
  textAllowed?: boolean;
  modelRequired?: boolean;
  referenceRoles?: CanvasReferenceRole[];
  providerReferenceRoles?: CanvasReferenceRole[];
  productReferenceFocus?: string;
  productReferenceFocusInstruction?: string;
  copyRenderPolicy?: CopyRenderPolicy;
  qualityRules?: string[];
  metadata: Record<string, unknown>;
}

export interface SopExecutionPlanStep {
  id: string;
  title: string;
  action:
    | "validate_reference_slots"
    | "merge_prompt_blocks"
    | "check_quality_rules"
    | "prepare_generation_item";
  dependsOn?: string[];
  requiredInputIds: string[];
  promptBlockIds: string[];
  qaRuleIds: string[];
  providerAction: "none" | "deferred_until_user_approval";
}

export interface SopExecutionPlanRequiredInput {
  id: string;
  label: string;
  role?: CanvasReferenceRole;
  source:
    | "reference_slot"
    | "prompt_only_knowledge"
    | "reference_context";
  required: boolean;
  status: "ready" | "missing" | "optional";
  notes: string[];
}

export interface SopExecutionPlanPromptBlock {
  id: string;
  title: string;
  source:
    | "sop_registry"
    | "plan_item"
    | "selected_template"
    | "prompt_only_knowledge"
    | "reference_context";
  content: string[];
}

export interface SopExecutionPlanRetryPolicy {
  maxAttempts: number;
  backoffMs: number[];
  retryableFailureSignals: string[];
  stopConditions: string[];
  fallbackAction: "return_to_draft_for_review";
}

export interface SopExecutionPlanDebugSource {
  source: "knowledgeSelection";
  builtAt: string;
  sopKeys: string[];
  sourceTutorialIds: string[];
  knowledgeTrace: KnowledgeTemplateSelection["knowledgeTrace"];
  selectedTemplateSources: Array<{
    id: string;
    title: string;
    source: string;
    sourceTutorialIds: string[];
    score: number;
  }>;
}

export interface SopExecutionPlan {
  version: 1;
  mode: "dry_run_metadata_only";
  steps: SopExecutionPlanStep[];
  requiredInputs: SopExecutionPlanRequiredInput[];
  promptBlocks: SopExecutionPlanPromptBlock[];
  qaRules: string[];
  retryPolicy: SopExecutionPlanRetryPolicy;
  debugSource: SopExecutionPlanDebugSource;
}

export interface GenerationPlanApproval {
  required: boolean;
  status: GenerationPlanApprovalStatus;
  issues: string[];
  requiredConfirmation?: {
    field: "confirmedProviderCallLimit";
    minimum: number;
  };
}

export interface GenerationPlan {
  planId: string;
  workflowId?: string;
  frameNodeId?: string;
  batchId?: string;
  campaignBible?: CampaignBible;
  shotList?: CampaignShot[];
  items: GenerationPlanItem[];
  referenceContext?: GenerationReferenceContext;
  referenceSlots: CanvasReferenceSlot[];
  estimate: ProviderCallEstimate;
  providerPolicy: ProviderCallPolicy;
  approval: GenerationPlanApproval;
  sopExecutionPlan?: SopExecutionPlan;
  knowledgeSelection?: KnowledgeTemplateSelection;
  metadata?: Record<string, unknown>;
  status: GenerationPlanStatus;
  createdAt: string;
}

export interface GenerationPlanDraftRequest {
  workflowId?: string;
  frameNodeId?: string;
  nodeId?: string;
  projectId?: string;
  campaignId?: string;
  batchId?: string;
  items?: unknown;
  images?: unknown;
  style?: string;
  modelIds?: string[];
  productImageBase64?: string;
  referenceContext?: unknown;
  referenceImages?: unknown;
  requiredReferenceRoles?: CanvasReferenceRole[];
  knowledgeContext?: unknown;
  outputType?: string;
  platforms?: string[];
  outputPacks?: string[];
  request?: string;
  userRequest?: string;
  brief?: string;
  projectStarterPrompt?: string;
  projectIntent?: string;
  campaignBible?: unknown;
  shotList?: unknown;
  templateCandidates?: unknown;
  components?: unknown;
  copyRenderMode?: CopyRenderMode;
  confirmedProviderCallLimit?: number;
}

export interface GenerationPlanDraftResult {
  ok: boolean;
  dryRun: true;
  plan: GenerationPlan;
  estimate: ProviderCallEstimate;
  providerPolicy: ProviderCallPolicy;
  referenceSlots: CanvasReferenceSlot[];
  knowledgeSelection: KnowledgeTemplateSelection;
  sopExecutionPlan: SopExecutionPlan;
  validation: {
    ok: boolean;
    issues: string[];
  };
}
