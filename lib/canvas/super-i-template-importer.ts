import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CreateComponentParams, StandardComponentType } from "@/lib/types";

export const DEFAULT_SUPER_I_SOURCE_ROOT =
  "/Users/lichenhao/Desktop/刺猬星球/super-i_export/ai";
export const SUPER_I_TEMPLATE_IMPORT_VERSION = "super-i-template-import-v1";

export type SuperITemplateComponentType = Extract<
  StandardComponentType,
  "prompt_source" | "image_recipe" | "quality_rule" | "platform_rule"
>;

export interface SuperIImportOptions {
  sourceRoot?: string;
  limit?: number;
  topLimit?: number;
}

export interface SuperITutorial {
  id: string;
  title: string;
  url: string;
  localPage: string;
  published: string;
  author: string;
  categories: string[];
  tags: string[];
  headings: string[];
  mediaCount: number;
  promptBlockCount: number;
  promptCharCount: number;
  promptSamples: string[];
  hasObfuscatedPromptBlocks: boolean;
  contentText: string;
  sourceHash: string;
}

export interface SuperITemplateCandidate {
  id: string;
  title: string;
  description: string;
  componentType: SuperITemplateComponentType;
  score: number;
  reasonTags: string[];
  sourceIds: string[];
  sourceHash: string;
  sourceTitle: string;
  sourceUrl: string;
  sopSummary: SuperISopSummary;
  componentParams: CreateComponentParams;
}

export interface SuperISopSummary {
  intent: string;
  reusablePattern: string;
  workflowSteps: string[];
  inputAssets: string[];
  outputTargets: string[];
  guardrails: string[];
  tags: string[];
}

export interface SuperISourceFiles {
  sourceRoot: string;
  allTutorialsPath: string;
  tutorialIndexPath: string;
  allTutorialsHash: string;
  tutorialIndexHash: string;
}

export interface SuperIImportCounts {
  jsonlRows: number;
  indexRows: number;
  processedTutorials: number;
  matchedIndexRows: number;
  rejectedJsonlRows: number;
  withPromptBlocks: number;
  obfuscatedPromptBlocks: number;
  totalPromptBlocks: number;
  totalMedia: number;
  candidates: number;
  candidatesByType: Record<SuperITemplateComponentType, number>;
}

export interface SuperIImportPlan {
  sourceFiles: SuperISourceFiles;
  counts: SuperIImportCounts;
  sourceIds: string[];
  sourceIdsHash: string;
  candidates: SuperITemplateCandidate[];
  topTemplateCandidates: SuperITemplateCandidate[];
}

export interface SuperIWriteSummary {
  attempted: number;
  created: number;
  updated: number;
  unchanged: number;
  skippedDuplicates: number;
  ids: string[];
}

export interface SuperIImportSummary {
  sourceRoot: string;
  dryRun: boolean;
  counts: SuperIImportCounts;
  source: {
    ids: string[];
    idsHash: string;
    files: {
      allTutorials: { path: string; hash: string };
      tutorialIndex: { path: string; hash: string };
    };
  };
  topTemplateCandidates: Array<{
    rank: number;
    id: string;
    type: SuperITemplateComponentType;
    score: number;
    title: string;
    sourceIds: string[];
    sourceHash: string;
    reasonTags: string[];
    sopSummary: SuperISopSummary;
  }>;
  write?: SuperIWriteSummary;
}

type RawIndexRow = Record<string, string>;

type RawTutorial = Record<string, unknown> & {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  local_page?: unknown;
  published?: unknown;
  author?: unknown;
  categories?: unknown;
  tags?: unknown;
  headings?: unknown;
  media?: unknown;
  prompt_blocks?: unknown;
  has_obfuscated_prompt_blocks?: unknown;
  content_text?: unknown;
};

const SUPPORTED_TEMPLATE_COMPONENT_TYPES = [
  "prompt_source",
  "image_recipe",
  "quality_rule",
  "platform_rule",
] as const;

const TYPE_KEYWORDS: Record<SuperITemplateComponentType, string[]> = {
  prompt_source: [
    "提示词",
    "prompt",
    "分镜",
    "镜头",
    "画面结构",
    "反推",
    "拆解",
    "Seedance",
    "AI视频",
    "视频生成",
  ],
  image_recipe: [
    "电商",
    "产品",
    "广告",
    "主图",
    "详情页",
    "海报",
    "服装",
    "3c",
    "工作流",
    "素材包",
    "生成",
  ],
  quality_rule: [
    "不要",
    "避免",
    "失败",
    "翻车",
    "质检",
    "一致性",
    "真实感",
    "规则",
    "错误",
    "修复",
  ],
  platform_rule: [
    "亚马逊",
    "amazon",
    "淘宝",
    "小红书",
    "抖音",
    "平台",
    "9:16",
    "1:1",
    "竖屏",
    "横屏",
  ],
};

export async function loadSuperITemplateImportPlan(
  options: SuperIImportOptions = {}
): Promise<SuperIImportPlan> {
  const topLimit = normalizeLimit(options.topLimit, 12) ?? 12;
  const sourceRoot = await resolveSourceRoot(options.sourceRoot ?? DEFAULT_SUPER_I_SOURCE_ROOT);
  const allTutorialsPath = path.join(sourceRoot, "all_tutorials.jsonl");
  const tutorialIndexPath = path.join(sourceRoot, "tutorial_index.csv");
  const [jsonlText, indexText] = await Promise.all([
    readFile(allTutorialsPath, "utf8"),
    readFile(tutorialIndexPath, "utf8"),
  ]);

  const parsedJsonl = parseJsonlTutorials(jsonlText);
  const indexRows = parseCsv(indexText);
  const indexById = new Map(indexRows.map((row) => [row.id, row]));
  const limit = normalizeLimit(options.limit);
  const selectedRows = limit ? parsedJsonl.rows.slice(0, limit) : parsedJsonl.rows;
  const tutorials = selectedRows.map((row) => normalizeTutorial(row, indexById.get(String(row.id ?? ""))));
  const candidates = tutorials
    .map(buildTemplateCandidate)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const sourceIds = tutorials.map((tutorial) => tutorial.id);
  const candidatesByType = emptyTypeCounts();

  for (const candidate of candidates) {
    candidatesByType[candidate.componentType] += 1;
  }

  const counts: SuperIImportCounts = {
    jsonlRows: parsedJsonl.rows.length,
    indexRows: indexRows.length,
    processedTutorials: tutorials.length,
    matchedIndexRows: tutorials.filter((tutorial) => indexById.has(tutorial.id)).length,
    rejectedJsonlRows: parsedJsonl.rejectedRows,
    withPromptBlocks: tutorials.filter((tutorial) => tutorial.promptBlockCount > 0).length,
    obfuscatedPromptBlocks: tutorials.filter((tutorial) => tutorial.hasObfuscatedPromptBlocks).length,
    totalPromptBlocks: tutorials.reduce((sum, tutorial) => sum + tutorial.promptBlockCount, 0),
    totalMedia: tutorials.reduce((sum, tutorial) => sum + tutorial.mediaCount, 0),
    candidates: candidates.length,
    candidatesByType,
  };

  return {
    sourceFiles: {
      sourceRoot,
      allTutorialsPath,
      tutorialIndexPath,
      allTutorialsHash: hashString(jsonlText),
      tutorialIndexHash: hashString(indexText),
    },
    counts,
    sourceIds,
    sourceIdsHash: hashString(sourceIds.join("\n")),
    candidates,
    topTemplateCandidates: candidates.slice(0, topLimit),
  };
}

export function toSuperIImportSummary(
  plan: SuperIImportPlan,
  options: { dryRun?: boolean; write?: SuperIWriteSummary } = {}
): SuperIImportSummary {
  return {
    sourceRoot: plan.sourceFiles.sourceRoot,
    dryRun: options.dryRun !== false,
    counts: plan.counts,
    source: {
      ids: plan.sourceIds,
      idsHash: plan.sourceIdsHash,
      files: {
        allTutorials: {
          path: plan.sourceFiles.allTutorialsPath,
          hash: plan.sourceFiles.allTutorialsHash,
        },
        tutorialIndex: {
          path: plan.sourceFiles.tutorialIndexPath,
          hash: plan.sourceFiles.tutorialIndexHash,
        },
      },
    },
    topTemplateCandidates: plan.topTemplateCandidates.map((candidate, index) => ({
      rank: index + 1,
      id: candidate.id,
      type: candidate.componentType,
      score: candidate.score,
      title: candidate.title,
      sourceIds: candidate.sourceIds,
      sourceHash: candidate.sourceHash,
      reasonTags: candidate.reasonTags,
      sopSummary: candidate.sopSummary,
    })),
    ...(options.write ? { write: options.write } : {}),
  };
}

function buildTemplateCandidate(tutorial: SuperITutorial): SuperITemplateCandidate {
  const componentType = chooseComponentType(tutorial);
  const score = scoreTutorial(tutorial, componentType);
  const reasonTags = collectReasonTags(tutorial, componentType);
  const sopSummary = buildSopSummary(tutorial, componentType);
  const title = truncateText(`${componentTypeLabel(componentType)} - ${sopSummary.intent}`, 96);
  const description = truncateText(
    `Reusable commercial image generation pattern distilled for internal SOP execution.`,
    220
  );
  const id = `knowledge-sop:${tutorial.id}:${componentType}`;
  const componentParams = candidateToComponentParams({
    id,
    title,
    description,
    componentType,
    score,
    reasonTags,
    sourceIds: [tutorial.id],
    sourceHash: tutorial.sourceHash,
    sourceTitle: tutorial.title,
    sourceUrl: tutorial.url,
    sopSummary,
  });

  return {
    id,
    title,
    description,
    componentType,
    score,
    reasonTags,
    sourceIds: [tutorial.id],
    sourceHash: tutorial.sourceHash,
    sourceTitle: tutorial.title,
    sourceUrl: tutorial.url,
    sopSummary,
    componentParams,
  };
}

function candidateToComponentParams(candidate: Omit<SuperITemplateCandidate, "componentParams">): CreateComponentParams {
  const promptFragments = buildPromptFragments(candidate);
  const qualityRules = buildQualityRules(candidate);
  const negativeRules = buildNegativeRules(candidate);
  const metadata = {
    schemaVersion: 1,
    componentType: candidate.componentType,
    label: candidate.title,
    importKey: candidate.id,
    importerVersion: SUPER_I_TEMPLATE_IMPORT_VERSION,
    debugSource: {
      kind: "super_i_import",
      ids: candidate.sourceIds,
      hash: candidate.sourceHash,
      title: candidate.sourceTitle,
      url: candidate.sourceUrl,
    },
    source: {
      kind: "ai_import",
      referenceId: candidate.id,
    },
    parameters: buildTypeParameters(candidate),
    sopSummary: candidate.sopSummary,
    promptFragments,
    constraints: candidate.sopSummary.guardrails,
    negativeRules,
    qualityRules,
    compatibleWith: buildCompatibleWith(candidate),
  };

  return {
    type: candidate.componentType,
    title: candidate.title,
    description: candidate.description,
    status: "draft",
    rules: {
      constraints: candidate.sopSummary.guardrails,
      negativeRules,
      qualityRules,
    },
    metadata,
  };
}

function buildTypeParameters(
  candidate: Omit<SuperITemplateCandidate, "componentParams">
): Record<string, unknown> {
  const common = {
    score: candidate.score,
    reasonTags: candidate.reasonTags,
    sopSummary: candidate.sopSummary,
  };

  switch (candidate.componentType) {
    case "prompt_source":
      return {
        ...common,
        rawPrompt: "",
        extractedStyleRules: candidate.sopSummary.guardrails.filter((rule) => /style|light|camera|visual/i.test(rule)),
        extractedSceneRules: candidate.sopSummary.workflowSteps,
        extractedCameraRules: candidate.sopSummary.guardrails.filter((rule) => /camera|shot|lens|composition/i.test(rule)),
        extractedNegativeRules: buildNegativeRules(candidate),
        compatibleRecipes: buildCompatibleWith(candidate),
        riskNotes: candidate.sopSummary.guardrails,
      };
    case "image_recipe":
      return {
        ...common,
        purpose: candidate.sopSummary.intent,
        shotList: candidate.sopSummary.workflowSteps,
        compositionRules: candidate.sopSummary.guardrails,
        copyRequirements: [],
        outputCount: inferOutputCount(candidate.sopSummary),
        inputAssets: candidate.sopSummary.inputAssets,
        outputTargets: candidate.sopSummary.outputTargets,
      };
    case "quality_rule":
      return {
        ...common,
        checks: candidate.sopSummary.guardrails,
        thresholds: {},
        scoreWeights: {
          productConsistency: 0.35,
          visualSpecificity: 0.25,
          platformFit: 0.2,
          promptSafety: 0.2,
        },
        blockingIssues: buildNegativeRules(candidate),
      };
    case "platform_rule":
      return {
        ...common,
        platform: inferPlatform(candidate.sopSummary),
        aspectRatios: inferAspectRatios(candidate.sopSummary),
        safeAreas: ["Keep important subject, product, and CTA zones away from platform crop edges."],
        textAllowance: "Use only externally supplied copy layers; do not ask the image model to render text.",
        backgroundRestrictions: buildNegativeRules(candidate),
        exportNaming: "Use source workflow, platform, aspect ratio, and version in output names.",
        formats: ["png", "jpg"],
      };
  }
}

function normalizeTutorial(raw: RawTutorial, indexRow?: RawIndexRow): SuperITutorial {
  const id = toString(raw.id) || toString(indexRow?.id);
  const title = toString(raw.title) || toString(indexRow?.title) || `Super-i tutorial ${id}`;
  const url = toString(raw.url) || toString(indexRow?.url);
  const localPage = toString(raw.local_page) || toString(indexRow?.local_page);
  const categories = mergeLists(toStringArray(raw.categories), parseDelimitedList(indexRow?.categories));
  const tags = mergeLists(toStringArray(raw.tags), parseDelimitedList(indexRow?.tags));
  const headings = toStringArray(raw.headings).slice(0, 12);
  const promptBlocks = Array.isArray(raw.prompt_blocks) ? raw.prompt_blocks : [];
  const promptSamples = promptBlocks
    .map((block) => (block && typeof block === "object" ? toString((block as Record<string, unknown>).sample) : ""))
    .filter(Boolean)
    .map((sample) => truncateText(sample, 180));
  const promptCharCount = promptBlocks.reduce((sum, block) => {
    if (!block || typeof block !== "object") return sum;
    return sum + toInteger((block as Record<string, unknown>).char_count);
  }, 0);
  const mediaCount = Array.isArray(raw.media) ? raw.media.length : toInteger(indexRow?.media_count);
  const contentText = toString(raw.content_text);
  const sourceHash = hashObject({
    id,
    title,
    url,
    localPage,
    categories,
    tags,
    headings,
    mediaCount,
    promptBlockCount: promptBlocks.length || toInteger(indexRow?.prompt_blocks),
    promptCharCount,
    contentTextHash: hashString(contentText),
  });

  return {
    id,
    title,
    url,
    localPage,
    published: toString(raw.published) || toString(indexRow?.published),
    author: toString(raw.author) || toString(indexRow?.author),
    categories,
    tags,
    headings,
    mediaCount,
    promptBlockCount: promptBlocks.length || toInteger(indexRow?.prompt_blocks),
    promptCharCount,
    promptSamples,
    hasObfuscatedPromptBlocks:
      Boolean(raw.has_obfuscated_prompt_blocks) || /^true$/i.test(toString(indexRow?.has_obfuscated_prompt_blocks)),
    contentText,
    sourceHash,
  };
}

function chooseComponentType(tutorial: SuperITutorial): SuperITemplateComponentType {
  const scores = Object.fromEntries(
    SUPPORTED_TEMPLATE_COMPONENT_TYPES.map((type) => [type, typeSignalScore(tutorial, type)])
  ) as Record<SuperITemplateComponentType, number>;

  if (tutorial.promptBlockCount > 0) scores.prompt_source += 8;
  if (/电商|产品|广告|主图|详情页|海报|工作流/i.test(joinSignals(tutorial))) scores.image_recipe += 10;
  if (/不要|避免|失败|翻车|错误|质检|一致性|真实感/i.test(joinSignals(tutorial))) scores.quality_rule += 8;
  if (/亚马逊|amazon|淘宝|小红书|抖音|平台|9:16|1:1/i.test(joinSignals(tutorial))) scores.platform_rule += 8;

  return SUPPORTED_TEMPLATE_COMPONENT_TYPES.reduce((best, type) => {
    if (scores[type] > scores[best]) return type;
    return best;
  }, "prompt_source");
}

function scoreTutorial(tutorial: SuperITutorial, type: SuperITemplateComponentType): number {
  const promptScore = Math.min(36, tutorial.promptBlockCount * 4 + Math.floor(tutorial.promptCharCount / 500));
  const structureScore = Math.min(18, tutorial.headings.length * 2);
  const mediaScore = Math.min(12, tutorial.mediaCount);
  const typeScore = typeSignalScore(tutorial, type);
  const commercialBonus = /商业教程|电商|广告|产品|主图|详情页/.test(joinSignals(tutorial)) ? 8 : 0;
  return promptScore + structureScore + mediaScore + typeScore + commercialBonus;
}

function typeSignalScore(tutorial: SuperITutorial, type: SuperITemplateComponentType): number {
  const text = joinSignals(tutorial).toLowerCase();
  return TYPE_KEYWORDS[type].reduce((sum, keyword) => {
    const pattern = keyword.toLowerCase();
    return text.includes(pattern) ? sum + 6 : sum;
  }, 0);
}

function collectReasonTags(tutorial: SuperITutorial, type: SuperITemplateComponentType): string[] {
  const text = joinSignals(tutorial).toLowerCase();
  const matched = TYPE_KEYWORDS[type].filter((keyword) => text.includes(keyword.toLowerCase()));
  return uniqueStrings([
    ...tutorial.categories,
    ...tutorial.tags.slice(0, 8),
    ...matched,
    tutorial.promptBlockCount > 0 ? `promptBlocks:${tutorial.promptBlockCount}` : "",
    tutorial.mediaCount > 0 ? `media:${tutorial.mediaCount}` : "",
  ]).slice(0, 14);
}

function buildSopSummary(tutorial: SuperITutorial, type: SuperITemplateComponentType): SuperISopSummary {
  const signalText = joinSignals(tutorial);
  const workflowSteps = inferWorkflowSteps(tutorial);
  const inputAssets = inferInputAssets(signalText);
  const outputTargets = inferOutputTargets(signalText);
  const guardrails = inferGuardrails(signalText, type);

  return {
    intent: inferIntent(tutorial, type),
    reusablePattern: reusablePatternForType(type),
    workflowSteps,
    inputAssets,
    outputTargets,
    guardrails,
    tags: uniqueStrings([...tutorial.categories, ...tutorial.tags]).slice(0, 16),
  };
}

function inferIntent(tutorial: SuperITutorial, type: SuperITemplateComponentType): string {
  const clean = cleanTitle(tutorial.title);
  if (type === "image_recipe") return `Build a reusable commercial image/video recipe from: ${clean}`;
  if (type === "quality_rule") return `Convert source workflow checks into reusable quality gates from: ${clean}`;
  if (type === "platform_rule") return `Capture platform and output constraints from: ${clean}`;
  return `Extract a reusable prompt workflow pattern from: ${clean}`;
}

function reusablePatternForType(type: SuperITemplateComponentType): string {
  switch (type) {
    case "prompt_source":
      return "Distill role, task, inputs, output format, and guardrails into a reusable prompt-source component.";
    case "image_recipe":
      return "Turn source assets, product facts, scene/camera rules, and output targets into a repeatable image recipe.";
    case "quality_rule":
      return "Convert failure modes and hard constraints into blocking checks before generation or export.";
    case "platform_rule":
      return "Capture aspect ratio, platform intent, safe area, copy, and export constraints without storing source media.";
  }
}

function inferWorkflowSteps(tutorial: SuperITutorial): string[] {
  const headingSteps = tutorial.headings
    .map(cleanHeading)
    .filter(Boolean)
    .filter((heading) => !/结语|课程主线|准备工具/.test(heading));
  const steps = headingSteps.length > 0 ? headingSteps : [
    "Collect source assets and define the target output.",
    "Analyze subject, scene, camera, and platform constraints.",
    "Generate a structured prompt or shot list.",
    "Review against hard guardrails before export.",
  ];
  return uniqueStrings(steps).slice(0, 8);
}

function inferInputAssets(text: string): string[] {
  const inputs = [
    /产品|商品|服装|3c|主图/i.test(text) ? "product_reference" : "",
    /人物|老板|模特|角色|真人/i.test(text) ? "person_or_model_reference" : "",
    /场景|环境|车间|空间|背景/i.test(text) ? "scene_reference" : "",
    /品牌|企业|产品信息|卖点|文案/i.test(text) ? "brand_or_product_facts" : "",
    /视频|分镜|镜头|时间线/i.test(text) ? "video_or_storyboard_reference" : "",
    /平台|亚马逊|淘宝|小红书|抖音/i.test(text) ? "target_platform" : "",
  ].filter(Boolean);
  return uniqueStrings(inputs.length > 0 ? inputs : ["source_brief", "reference_assets"]);
}

function inferOutputTargets(text: string): string[] {
  const targets = [
    /视频|短片|分镜|Seedance/i.test(text) ? "short_video_or_storyboard" : "",
    /主图|亚马逊|amazon/i.test(text) ? "commerce_main_image" : "",
    /详情页/i.test(text) ? "product_detail_page" : "",
    /海报|封面|小红书/i.test(text) ? "social_poster_or_cover" : "",
    /提示词|prompt/i.test(text) ? "prompt_template" : "",
  ].filter(Boolean);
  return uniqueStrings(targets.length > 0 ? targets : ["reusable_canvas_template"]);
}

function inferGuardrails(text: string, type: SuperITemplateComponentType): string[] {
  const rules = [
    "Store only generalized SOP summaries, source ids, and hashes; do not persist tutorial body, full prompts, or media.",
    /不要虚构|不能虚构|不虚构/.test(text) ? "Do not invent product, brand, platform, credential, sales, or pricing claims." : "",
    /无字|字幕|文字|标语|品牌字样|屏幕文字/.test(text)
      ? "Keep generated visual frames free of model-rendered text, subtitles, signage, logos, and screen text unless supplied as an external layer."
      : "",
    /参考图|图1|图2|图3|素材/.test(text)
      ? "Name every reference asset by role and keep identity, product, and scene references separated."
      : "",
    /动作|动机|有事可做|自然|真人/.test(text)
      ? "Describe concrete motivated actions, micro-movements, and environment interaction instead of static posing."
      : "",
    /镜头|机位|运镜|构图|景别|光影/.test(text)
      ? "Specify camera position, framing, movement, lighting direction, depth, and subject-environment relationship."
      : "",
    type === "quality_rule" ? "Treat repeated failures and prohibited outputs as blocking checks, not optional style notes." : "",
    type === "platform_rule" ? "Keep aspect ratio, safe area, copy allowance, and export naming explicit per platform." : "",
  ].filter(Boolean);
  return uniqueStrings(rules).slice(0, 8);
}

function buildPromptFragments(candidate: Omit<SuperITemplateCandidate, "componentParams">): string[] {
  return [
    candidate.sopSummary.reusablePattern,
    `Intent: ${candidate.sopSummary.intent}`,
    `Inputs: ${candidate.sopSummary.inputAssets.join(", ")}`,
    `Outputs: ${candidate.sopSummary.outputTargets.join(", ")}`,
    `Guardrails: ${candidate.sopSummary.guardrails.join(" | ")}`,
  ].filter(Boolean);
}

function buildQualityRules(candidate: Omit<SuperITemplateCandidate, "componentParams">): string[] {
  return uniqueStrings([
    ...candidate.sopSummary.guardrails,
    "Verify source ids and hashes before using imported SOP candidates.",
    "Review candidate wording before promotion from draft to production template.",
  ]).slice(0, 10);
}

function buildNegativeRules(candidate: Omit<SuperITemplateCandidate, "componentParams">): string[] {
  return uniqueStrings([
    "Do not store full tutorial text, full prompt blocks, remote media URLs, or local media paths.",
    "Do not turn a tutorial-specific example into a hard rule without generalizing it.",
    candidate.componentType === "platform_rule" ? "Do not mix platform requirements from unrelated channels." : "",
    candidate.componentType === "quality_rule" ? "Do not downgrade blocking quality failures into soft preferences." : "",
  ]).filter(Boolean);
}

function buildCompatibleWith(candidate: Omit<SuperITemplateCandidate, "componentParams">): string[] {
  const compatible = ["commercial-image-canvas"];
  if (candidate.sopSummary.outputTargets.includes("short_video_or_storyboard")) compatible.push("storyboard-workflow");
  if (candidate.sopSummary.outputTargets.includes("commerce_main_image")) compatible.push("commerce-main-image");
  if (candidate.sopSummary.outputTargets.includes("product_detail_page")) compatible.push("product-detail-page");
  if (candidate.sopSummary.outputTargets.includes("social_poster_or_cover")) compatible.push("social-cover-poster");
  return compatible;
}

function inferOutputCount(summary: SuperISopSummary): number {
  if (summary.outputTargets.includes("short_video_or_storyboard")) return 5;
  if (summary.outputTargets.includes("product_detail_page")) return 6;
  if (summary.outputTargets.includes("social_poster_or_cover")) return 3;
  return 1;
}

function inferPlatform(summary: SuperISopSummary): string {
  const text = [...summary.tags, ...summary.outputTargets, summary.intent].join(" ").toLowerCase();
  if (text.includes("amazon") || text.includes("亚马逊")) return "amazon";
  if (text.includes("淘宝")) return "taobao";
  if (text.includes("小红书")) return "xiaohongshu";
  if (text.includes("抖音")) return "douyin";
  return "generic";
}

function inferAspectRatios(summary: SuperISopSummary): string[] {
  const text = [...summary.tags, ...summary.workflowSteps, summary.intent].join(" ");
  const ratios = [
    /9:16|竖屏|短视频|小红书|抖音|Seedance/i.test(text) ? "9:16" : "",
    /1:1|主图|亚马逊|amazon/i.test(text) ? "1:1" : "",
    /详情页|海报/i.test(text) ? "3:4" : "",
    /横屏|16:9/i.test(text) ? "16:9" : "",
  ].filter(Boolean);
  return uniqueStrings(ratios.length > 0 ? ratios : ["1:1", "4:5"]);
}

function parseJsonlTutorials(text: string): { rows: RawTutorial[]; rejectedRows: number } {
  const rows: RawTutorial[] = [];
  let rejectedRows = 0;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        rows.push(parsed as RawTutorial);
      } else {
        rejectedRows += 1;
      }
    } catch {
      rejectedRows += 1;
    }
  }

  return { rows, rejectedRows };
}

function parseCsv(text: string): RawIndexRow[] {
  const rows = splitCsvRows(stripBom(text));
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) => {
    return headers.reduce<RawIndexRow>((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });
}

function splitCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

async function resolveSourceRoot(sourceRoot: string): Promise<string> {
  const explicitRoot = path.resolve(sourceRoot);
  const direct = path.join(explicitRoot, "all_tutorials.jsonl");
  const nested = path.join(explicitRoot, "ai", "all_tutorials.jsonl");

  try {
    await readFile(direct, "utf8");
    return explicitRoot;
  } catch {
    await readFile(nested, "utf8");
    return path.join(explicitRoot, "ai");
  }
}

function emptyTypeCounts(): Record<SuperITemplateComponentType, number> {
  return {
    prompt_source: 0,
    image_recipe: 0,
    quality_rule: 0,
    platform_rule: 0,
  };
}

function componentTypeLabel(type: SuperITemplateComponentType): string {
  return type.replace(/_/g, " ");
}

function joinSignals(tutorial: SuperITutorial): string {
  return [
    tutorial.title,
    ...tutorial.categories,
    ...tutorial.tags,
    ...tutorial.headings,
    ...tutorial.promptSamples,
    tutorial.contentText.slice(0, 4000),
  ].join(" ");
}

function cleanTitle(title: string): string {
  return title.replace(/^【[^】]+】\s*/, "").replace(/\s+/g, " ").trim();
}

function cleanHeading(heading: string): string {
  return heading
    .replace(/^[一二三四五六七八九十]+[、.．]\s*/, "")
    .replace(/^第[一二三四五六七八九十\d]+[章节步]\s*[：:]?\s*/, "")
    .replace(/^\d+([.．、-]\d+)?\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDelimitedList(value: unknown): string[] {
  return toString(value)
    .split(/\s*\|\s*|\s*[,，、]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeLists(...lists: string[][]): string[] {
  return uniqueStrings(lists.flat());
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(toString).filter(Boolean);
  return parseDelimitedList(value);
}

function toString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function toInteger(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  const parsed = Number.parseInt(toString(value), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function normalizeLimit(value: unknown, fallback?: number): number | undefined {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashObject(value: unknown): string {
  return hashString(stableStringify(value));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
