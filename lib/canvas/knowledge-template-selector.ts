import {
  normalizeAssetPackCategory,
  type AssetPackCategory,
} from "./asset-pack-types";
import { getAssetSopDefinition } from "./asset-sop-registry";
import type { CanvasReferenceRole } from "./canvas-reference-slots";
import {
  generationReferenceRoles,
  normalizeGenerationReferenceContext,
  type GenerationReferenceContext,
  type GenerationReferenceRole,
} from "./generation-reference-context";

export type KnowledgeCandidateSource = "template" | "component";
export type KnowledgeReferenceMode = "provider_input" | "prompt_only";

export interface KnowledgeTemplateCandidate {
  id?: string;
  title?: string;
  description?: string;
  category?: string;
  status?: string;
  type?: string;
  rules?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeComponentCandidate {
  id?: string;
  title?: string;
  description?: string;
  type?: string;
  status?: string;
  rules?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeTraceEntry {
  stage: string;
  message: string;
  role?: CanvasReferenceRole;
  source?: KnowledgeCandidateSource | "request" | "reference_context" | "sop_registry";
  sourceId?: string;
  score?: number;
}

export interface SelectedKnowledgeTemplate {
  id: string;
  title: string;
  source: KnowledgeCandidateSource;
  sourceTutorialIds: string[];
  qualityRules: string[];
  score: number;
  reasons: string[];
  referenceMode: KnowledgeReferenceMode;
}

export interface KnowledgeTemplateSelection {
  sopKeys: string[];
  requiredReferenceRoles: CanvasReferenceRole[];
  selectedTemplates: SelectedKnowledgeTemplate[];
  sourceTutorialIds: string[];
  knowledgeTrace: KnowledgeTraceEntry[];
  qualityRules: string[];
  warnings: string[];
}

export interface SelectKnowledgeTemplatesInput {
  request?: string;
  referenceContext?: GenerationReferenceContext | unknown;
  roles?: CanvasReferenceRole[];
  requiredReferenceRoles?: CanvasReferenceRole[];
  templateCandidates?: unknown;
  components?: unknown;
}

type RoleSignalMap = Record<GenerationReferenceRole, number>;

const COPY_PROMPT_ONLY_SOP_KEY = "sop.copy_prompt_only.v1";
const KNOWLEDGE_PROMPT_ONLY_SOP_KEY = "sop.knowledge_prompt_only.v1";

const roleTerms: Record<GenerationReferenceRole, string[]> = {
  product: [
    "amazon",
    "asin",
    "detail",
    "detail-page",
    "ecommerce",
    "listing",
    "product",
    "sku",
    "产品",
    "商品",
    "详情",
    "详情页",
    "主图",
    "一致性",
    "产品一致性",
    "商品一致性",
  ],
  model: [
    "human",
    "model",
    "person",
    "people",
    "realism",
    "try-on",
    "wearing",
    "人物",
    "人物真实感",
    "真人",
    "模特",
    "穿着",
    "上身",
    "手部",
    "脸",
  ],
  scene: [
    "background",
    "environment",
    "lifestyle",
    "room",
    "scene",
    "场景",
    "环境",
    "背景",
    "空间",
  ],
  style: [
    "art direction",
    "lighting",
    "palette",
    "style",
    "visual",
    "光线",
    "视觉",
    "质感",
    "调性",
    "风格",
  ],
  copy: [
    "badge",
    "claim",
    "copy",
    "headline",
    "selling point",
    "text",
    "卖点",
    "声明",
    "文案",
    "标题",
  ],
};

const productCentricTerms = new Set([
  "amazon",
  "asin",
  "detail",
  "detail-page",
  "ecommerce",
  "listing",
  "product",
  "sku",
  "产品",
  "商品",
  "详情",
  "详情页",
  "主图",
  "一致性",
  "产品一致性",
  "商品一致性",
]);

const candidateBonusTerms = {
  amazon: ["amazon", "asin"],
  detail: ["detail", "detail-page", "详情", "详情页", "product_detail_page"],
  modelRealism: ["human", "model", "person", "realism", "人物", "人物真实感", "真人", "模特"],
  productConsistency: ["consistency", "truthful", "identity", "产品一致性", "商品一致性", "product_consistency"],
};

export function selectKnowledgeTemplates(
  input: SelectKnowledgeTemplatesInput
): KnowledgeTemplateSelection {
  const request = normalizeText(input.request);
  const context = normalizeGenerationReferenceContext(input.referenceContext);
  const explicitRoles = normalizeRoles(input.roles);
  const requiredInputRoles = normalizeRoles(input.requiredReferenceRoles);
  const roleSignals = buildRoleSignals(request, context, explicitRoles, requiredInputRoles);
  const referenceAssetRequest = isReferenceAssetKnowledgeRequest(request, context, requiredInputRoles);
  const trace: KnowledgeTraceEntry[] = [];
  const warnings: string[] = [];

  if (referenceAssetRequest && !hasReferenceRole(context, "product") && !requiredInputRoles.includes("product")) {
    roleSignals.product = 0;
    trace.push({
      stage: "role_signal_suppressed",
      role: "product",
      source: "request",
      message: "Reference asset generation should not inherit product SOP from incidental commerce words",
    });
  }

  for (const role of generationReferenceRoles) {
    if (roleSignals[role] > 0) {
      trace.push({
        stage: "role_signal",
        role,
        source: "request",
        score: roleSignals[role],
        message: `${role} role signal detected`,
      });
    }
  }

  const selectedSopRoles = selectSopRoles(roleSignals);
  const sopKeys = selectedSopRoles.flatMap((role) => sopKeysForRole(role));
  const requiredReferenceRoles = dedupeRoles([
    ...requiredInputRoles,
    ...(selectedSopRoles.includes("product") ? ["product" as const] : []),
  ]);

  if (selectedSopRoles.includes("product")) {
    trace.push({
      stage: "sop_priority",
      role: "product",
      source: "sop_registry",
      message: "Product SOP is selected first for commerce/detail-page/product-consistency requests",
    });
  }

  if (selectedSopRoles.includes("copy")) {
    warnings.push("Copy knowledge is prompt-only by default and is not selected as provider image input.");
    trace.push({
      stage: "reference_mode",
      role: "copy",
      source: "sop_registry",
      message: "Copy role remains prompt_only unless a later explicit render step asks to burn text into image",
    });
  }

  if (hasKnowledgeCandidates(input.templateCandidates, input.components)) {
    sopKeys.push(KNOWLEDGE_PROMPT_ONLY_SOP_KEY);
    warnings.push("Knowledge cards and prompt sources are prompt-only dry-run inputs.");
  }

  const scoredCandidates = scoreCandidates({
    request,
    roleSignals,
    templateCandidates: input.templateCandidates,
    components: input.components,
  });
  const selectedTemplates = scoredCandidates
    .filter((candidate) => !(referenceAssetRequest && roleSignals.product === 0 && isProductCandidate(candidate)))
    .filter((candidate) => candidate.score > 0)
    .slice(0, 6)
    .map(toSelectedTemplate);

  for (const selected of selectedTemplates) {
    trace.push({
      stage: "candidate_selected",
      source: selected.source,
      sourceId: selected.id,
      score: selected.score,
      message: `${selected.title} selected: ${selected.reasons.join(", ")}`,
    });
    if (selected.referenceMode === "prompt_only") {
      warnings.push(`${selected.title} is prompt-only knowledge and will not be sent as image input.`);
    }
  }

  if (selectedSopRoles.includes("product") && !hasReferenceRole(context, "product")) {
    warnings.push("Product SOP selected but no product reference is present yet; provider run should wait for a product asset.");
  }
  if (selectedSopRoles.includes("model") && !hasReferenceRole(context, "model")) {
    warnings.push("Model realism will use SOP and prompt guidance until a model asset/reference is connected.");
  }

  const qualityRules = buildQualityRules(selectedSopRoles, selectedTemplates);
  const sourceTutorialIds = dedupeStrings(
    selectedTemplates.flatMap((template) => template.sourceTutorialIds)
  );

  return {
    sopKeys: dedupeStrings(sopKeys),
    requiredReferenceRoles,
    selectedTemplates,
    sourceTutorialIds,
    knowledgeTrace: trace,
    qualityRules,
    warnings: dedupeStrings(warnings),
  };
}

function buildRoleSignals(
  request: string,
  context: GenerationReferenceContext | undefined,
  explicitRoles: CanvasReferenceRole[],
  requiredRoles: CanvasReferenceRole[]
): RoleSignalMap {
  const signals = generationReferenceRoles.reduce((acc, role) => {
    acc[role] = 0;
    return acc;
  }, {} as RoleSignalMap);

  const tokens = tokenize(request);
  for (const role of generationReferenceRoles) {
    for (const term of roleTerms[role]) {
      if (tokens.includes(term.toLowerCase()) || request.includes(term.toLowerCase())) {
        signals[role] += productCentricTerms.has(term) && role === "product" ? 3 : 2;
      }
    }
  }

  for (const role of explicitRoles) signals[role] += 3;
  for (const role of requiredRoles) signals[role] += 4;

  for (const role of generationReferenceRoles) {
    if (hasReferenceRole(context, role)) signals[role] += 3;
  }

  if (signals.product > 0 && hasAnyTerm(request, ["amazon", "detail", "详情", "详情页"])) {
    signals.product += 4;
  }
  if (signals.product > 0 && hasAnyTerm(request, ["consistency", "一致性", "identity"])) {
    signals.product += 3;
  }

  return signals;
}

function isReferenceAssetKnowledgeRequest(
  request: string,
  context: GenerationReferenceContext | undefined,
  requiredRoles: CanvasReferenceRole[]
): boolean {
  if (requiredRoles.includes("product") || hasReferenceRole(context, "product")) {
    return false;
  }
  return /model_asset|character_sheet|scene_asset|style_asset|visual_style|reference_asset|scene_style_asset|模卡|模特资产|场景资产|风格资产|参考资产|素材资产/.test(request);
}

function selectSopRoles(signals: RoleSignalMap): GenerationReferenceRole[] {
  const roles: GenerationReferenceRole[] = [];
  if (signals.product > 0) roles.push("product");
  for (const role of ["model", "scene", "style", "copy"] as const) {
    if (signals[role] > 0) roles.push(role);
  }
  return roles;
}

function sopKeysForRole(role: GenerationReferenceRole): string[] {
  if (role === "copy") return [COPY_PROMPT_ONLY_SOP_KEY];
  const category = role === "product"
    ? "product_asset"
    : role === "model"
      ? "model_asset"
      : role === "scene"
        ? "scene_asset"
        : role === "style"
          ? "style_asset"
          : undefined;
  const sop = category ? getAssetSopDefinition(category) : undefined;
  return sop ? [sop.sopKey] : [];
}

function buildQualityRules(
  selectedSopRoles: GenerationReferenceRole[],
  selectedTemplates: SelectedKnowledgeTemplate[]
): string[] {
  const rules: string[] = [];

  for (const role of selectedSopRoles) {
    if (role === "copy") {
      rules.push("Copy and knowledge cards stay prompt-only metadata unless copy render policy is explicitly set to burn-in.");
      rules.push("Keep image text, claims, selling points, forbidden claims, and export copy as separate structured layers.");
      continue;
    }

    const category = roleToCategory(role);
    const sop = category ? getAssetSopDefinition(category) : undefined;
    rules.push(...(sop?.qualityRules ?? []));
    rules.push(...(sop?.promptBoundaries ?? []));
  }

  for (const template of selectedTemplates) {
    rules.push(...templateQualityRules(template));
  }

  if (selectedSopRoles.includes("product") && selectedSopRoles.includes("model")) {
    rules.push("Product identity must come from product SOP; model SOP controls person realism only.");
  }

  return dedupeStrings(rules);
}

function scoreCandidates({
  request,
  roleSignals,
  templateCandidates,
  components,
}: {
  request: string;
  roleSignals: RoleSignalMap;
  templateCandidates: unknown;
  components: unknown;
}): ScoredCandidate[] {
  const normalized = [
    ...normalizeCandidates(templateCandidates, "template"),
    ...normalizeCandidates(components, "component"),
  ];

  return normalized
    .map((candidate, index) => ({
      ...candidate,
      ...scoreCandidate(candidate, request, roleSignals),
      index,
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
}

interface Candidate {
  id: string;
  title: string;
  description: string;
  type: string;
  category: string;
  status: string;
  source: KnowledgeCandidateSource;
  rules: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

interface ScoredCandidate extends Candidate {
  score: number;
  reasons: string[];
}

function normalizeCandidates(value: unknown, source: KnowledgeCandidateSource): Candidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index): Candidate[] => {
    if (!isRecord(item)) return [];
    const metadata = isRecord(item.metadata) ? item.metadata : {};
    const id = getString(item.id) ?? `${source}_${index + 1}`;
    return [{
      id,
      title: getString(item.title) ?? getString(metadata.title) ?? id,
      description: getString(item.description) ?? getString(metadata.description) ?? "",
      type: getString(item.type) ?? getString(metadata.componentType) ?? "",
      category: getString(item.category) ?? getString(metadata.category) ?? "",
      status: getString(item.status) ?? getString(metadata.status) ?? "",
      source,
      rules: isRecord(item.rules) ? item.rules : {},
      metadata,
    }];
  });
}

function scoreCandidate(
  candidate: Candidate,
  request: string,
  roleSignals: RoleSignalMap
): { score: number; reasons: string[] } {
  const haystack = candidateHaystack(candidate);
  const requestTokens = tokenize(request);
  let score = candidate.status === "published" ? 1 : 0;
  const reasons: string[] = [];

  for (const token of requestTokens) {
    if (token.length >= 2 && haystack.includes(token)) {
      score += 2;
      if (reasons.length < 4) reasons.push(`matches "${token}"`);
    }
  }

  for (const [reason, terms] of Object.entries(candidateBonusTerms)) {
    if (hasAnyTerm(request, terms) && hasAnyTerm(haystack, terms)) {
      score += 8;
      reasons.push(reason);
    }
  }

  const componentType = getCandidateComponentType(candidate);
  if (roleSignals.product > 0 && isProductCandidate(candidate)) {
    score += 10;
    reasons.push("product-first");
  }
  if (roleSignals.model > 0 && componentType === "quality_rule" && hasAnyTerm(haystack, candidateBonusTerms.modelRealism)) {
    score += 8;
    reasons.push("model-realism-rule");
  }
  if (roleSignals.product > 0 && componentType === "quality_rule" && hasAnyTerm(haystack, candidateBonusTerms.productConsistency)) {
    score += 8;
    reasons.push("product-consistency-rule");
  }
  if (isPromptOnlyCandidate(candidate)) {
    score += roleSignals.copy > 0 ? 4 : 1;
    reasons.push("prompt-only-knowledge");
  }

  return {
    score,
    reasons: dedupeStrings(reasons),
  };
}

function toSelectedTemplate(candidate: ScoredCandidate): SelectedKnowledgeTemplate {
  return {
    id: candidate.id,
    title: candidate.title,
    source: candidate.source,
    sourceTutorialIds: extractSourceTutorialIds(candidate),
    qualityRules: extractCandidateQualityRules(candidate),
    score: candidate.score,
    reasons: candidate.reasons,
    referenceMode: isPromptOnlyCandidate(candidate) ? "prompt_only" : "provider_input",
  };
}

function templateQualityRules(template: SelectedKnowledgeTemplate): string[] {
  return template.qualityRules;
}

function extractCandidateQualityRules(candidate: Candidate): string[] {
  return dedupeStrings([
    ...normalizeStringArray(candidate.rules.qualityRules),
    ...normalizeStringArray(candidate.metadata.qualityRules),
    ...normalizeStringArray(candidate.metadata.constraints),
  ]);
}

function extractSourceTutorialIds(candidate: Candidate): string[] {
  const metadata = candidate.metadata;
  const source = isRecord(metadata.source) ? metadata.source : {};
  const debugSource = isRecord(metadata.debugSource) ? metadata.debugSource : {};
  return dedupeStrings([
    ...normalizeStringArray(candidate.rules.sourceTutorialIds),
    ...normalizeStringArray(metadata.sourceTutorialIds),
    ...normalizeStringArray(metadata.tutorialIds),
    ...normalizeStringArray(metadata.sourceTutorialId),
    ...normalizeStringArray(metadata.tutorialId),
    ...normalizeStringArray(source.referenceId),
    ...normalizeStringArray(debugSource.ids),
  ]);
}

function hasKnowledgeCandidates(templateCandidates: unknown, components: unknown): boolean {
  return [
    ...normalizeCandidates(templateCandidates, "template"),
    ...normalizeCandidates(components, "component"),
  ].some(isPromptOnlyCandidate);
}

function isProductCandidate(candidate: Candidate): boolean {
  const category = candidate.category || candidate.type || getString(candidate.metadata.componentType) || "";
  const assetCategory = normalizeAssetPackCategory(category);
  return candidate.category === "product_detail_page" ||
    candidate.metadata.scenario === "product_detail_page" ||
    candidate.metadata.scenario === "amazon_main" ||
    assetCategory === "product_asset" ||
    hasAnyTerm(candidateHaystack(candidate), candidateBonusTerms.productConsistency);
}

function isPromptOnlyCandidate(candidate: Candidate): boolean {
  const type = getCandidateComponentType(candidate);
  return type === "prompt_source" ||
    type === "copy" ||
    type === "copy_asset" ||
    candidate.category === "knowledge" ||
    candidate.category === "prompt_knowledge" ||
    candidate.metadata.referenceMode === "prompt_only" ||
    candidate.metadata.providerMode === "prompt_only";
}

function getCandidateComponentType(candidate: Candidate): string {
  return getString(candidate.metadata.componentType) || candidate.type || candidate.category;
}

function candidateHaystack(candidate: Candidate): string {
  return [
    candidate.id,
    candidate.title,
    candidate.description,
    candidate.type,
    candidate.category,
    candidate.status,
    ...recordValues(candidate.rules),
    ...recordValues(candidate.metadata),
  ].join(" ").toLowerCase();
}

function roleToCategory(role: GenerationReferenceRole): AssetPackCategory | undefined {
  if (role === "product") return "product_asset";
  if (role === "model") return "model_asset";
  if (role === "scene") return "scene_asset";
  if (role === "style") return "style_asset";
  return undefined;
}

function hasReferenceRole(
  context: GenerationReferenceContext | undefined,
  role: GenerationReferenceRole
): boolean {
  return Boolean(context?.roles[role]) || Boolean(context?.images.some((image) => image.role === role));
}

function normalizeRoles(value: unknown): CanvasReferenceRole[] {
  if (!Array.isArray(value)) return [];
  return dedupeRoles(value.filter((role): role is CanvasReferenceRole =>
    generationReferenceRoles.includes(role as GenerationReferenceRole)
  ));
}

function dedupeRoles(roles: CanvasReferenceRole[]): CanvasReferenceRole[] {
  const seen = new Set<string>();
  return roles.filter((role) => {
    if (seen.has(role)) return false;
    seen.add(role);
    return true;
  });
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function tokenize(value: string): string[] {
  const asciiTokens = value
    .toLowerCase()
    .split(/[^a-z0-9_/-]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
  const cjkTerms = Object.values(roleTerms)
    .flat()
    .filter((term) => /[\u3400-\u9fff]/u.test(term) && value.includes(term.toLowerCase()));
  return dedupeStrings([...asciiTokens, ...cjkTerms.map((term) => term.toLowerCase())]);
}

function hasAnyTerm(value: string, terms: string[]): boolean {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && !!item.trim());
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function recordValues(value: Record<string, unknown>): string[] {
  return Object.values(value).flatMap((entry): string[] => {
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      return [String(entry)];
    }
    if (Array.isArray(entry)) {
      return entry.flatMap((item) => {
        if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
          return [String(item)];
        }
        if (isRecord(item)) return recordValues(item);
        return [];
      });
    }
    if (isRecord(entry)) return recordValues(entry);
    return [];
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

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
