import type { CopyRenderMode } from "@/lib/canvas/copy-render-policy";
import type { CanvasReferenceRole } from "@/lib/canvas/canvas-reference-slots";
import type {
  WorkflowSkill,
  WorkflowSkillOutputSlot,
} from "@/lib/canvas/workflow-skill-registry";

export interface CampaignBible {
  version: 1;
  source: "agent_campaign_bible";
  workflowSkillId: string;
  title: string;
  brief: string;
  productTitle?: string;
  productDescription?: string;
  platforms: string[];
  outputPacks: string[];
  visualStrategy: {
    primaryObjective: string;
    consistencyRule: string;
    variationRule: string;
  };
  assetPolicy: {
    requiredRoles: CanvasReferenceRole[];
    optionalRoles: CanvasReferenceRole[];
    roleContract: Record<string, string>;
  };
  copyPolicy: {
    defaultMode: CopyRenderMode;
    requestedMode: CopyRenderMode;
    allowBurnIn: boolean;
    rule: string;
  };
  executionPolicy: {
    mode: "sample_first_then_full_pack";
    sampleCount: number;
    fullCount: number;
    phases: Array<{ id: string; label: string; description: string }>;
  };
  qaRules: string[];
}

export interface CampaignShot {
  id: string;
  slot: string;
  label: string;
  intent: string;
  purpose: string;
  ratio: string;
  size?: string;
  samplePhase: boolean;
  copyMode: CopyRenderMode;
  textAllowed: boolean;
  referenceRoles: CanvasReferenceRole[];
  promptHints: string[];
  qaRules: string[];
  naming: string;
  priority: number;
}

export interface CampaignPlanningInput {
  brief: string;
  scenario?: string;
  productTitle?: string;
  productDescription?: string;
  platforms?: string[];
  outputPacks?: string[];
  copyRenderMode?: CopyRenderMode;
}

export function buildCampaignBible(
  input: CampaignPlanningInput,
  skill: WorkflowSkill
): CampaignBible {
  const platforms = normalizeStringArray(input.platforms, skill.platforms);
  const outputPacks = normalizeStringArray(input.outputPacks, skill.outputPacks);
  const requestedMode = input.copyRenderMode ?? skill.defaultCopyRenderMode;
  const requestedCount = parseRequestedCampaignImageCount(input.brief);
  const sampleCount = requestedCount
    ? clampCampaignImageCount(requestedCount, skill.fullCount)
    : skill.sampleCount;
  const title = input.productTitle?.trim()
    ? `${input.productTitle.trim()} · ${skill.shortLabel}`
    : skill.title;

  return {
    version: 1,
    source: "agent_campaign_bible",
    workflowSkillId: skill.id,
    title,
    brief: input.brief.trim(),
    productTitle: input.productTitle?.trim() || undefined,
    productDescription: input.productDescription?.trim() || undefined,
    platforms,
    outputPacks,
    visualStrategy: {
      primaryObjective: skill.description,
      consistencyRule:
        "Treat the full set as one commercial campaign: stable product identity, stable visual language, and varied shot purposes.",
      variationRule:
        "Vary camera distance, composition, scene zone, and proof angle per shot instead of repeating the same background.",
    },
    assetPolicy: {
      requiredRoles: skill.requiredAssetRoles,
      optionalRoles: skill.optionalAssetRoles,
      roleContract: buildRoleContract(skill),
    },
    copyPolicy: {
      defaultMode: skill.defaultCopyRenderMode,
      requestedMode,
      allowBurnIn: skill.allowBurnInCopy,
      rule: skill.allowBurnInCopy
        ? "Keep copy editable by default; burn short approved text into the bitmap only when explicitly requested."
        : "Keep copy outside the bitmap for this workflow.",
    },
    executionPolicy: {
      mode: "sample_first_then_full_pack",
      sampleCount,
      fullCount: skill.fullCount,
      phases: skill.phases,
    },
    qaRules: skill.qaRules,
  };
}

export function buildCampaignShotList(
  input: CampaignPlanningInput,
  skill: WorkflowSkill
): CampaignShot[] {
  const requestedMode = input.copyRenderMode ?? skill.defaultCopyRenderMode;
  const requestedCount = parseRequestedCampaignImageCount(input.brief);
  const targetCount = requestedCount
    ? clampCampaignImageCount(requestedCount, skill.fullCount)
    : skill.outputSlots.length;
  return Array.from({ length: targetCount }, (_, index) => {
    const baseSlot = skill.outputSlots[index % skill.outputSlots.length];
    const cycle = Math.floor(index / skill.outputSlots.length);
    const slot = cycle === 0
      ? baseSlot
      : {
          ...baseSlot,
          id: `${baseSlot.id}-${cycle + 1}`,
          label: `${baseSlot.label} ${cycle + 1}`,
          purpose: `${baseSlot.purpose}，在同一视觉语言下变化姿势、角度或场景区。`,
        };
    return buildCampaignShot({
      slot,
      index,
      skill,
      requestedMode,
    });
  });
}

export function normalizeCampaignBible(value: unknown): CampaignBible | undefined {
  if (!isRecord(value)) return undefined;
  const workflowSkillId = getString(value.workflowSkillId);
  const title = getString(value.title);
  if (!workflowSkillId || !title) return undefined;
  const copyPolicy = isRecord(value.copyPolicy) ? value.copyPolicy : {};
  const executionPolicy = isRecord(value.executionPolicy) ? value.executionPolicy : {};
  const assetPolicy = isRecord(value.assetPolicy) ? value.assetPolicy : {};
  const visualStrategy = isRecord(value.visualStrategy) ? value.visualStrategy : {};

  return {
    version: 1,
    source: "agent_campaign_bible",
    workflowSkillId,
    title,
    brief: getString(value.brief),
    productTitle: getOptionalString(value.productTitle),
    productDescription: getOptionalString(value.productDescription),
    platforms: getStringArray(value.platforms),
    outputPacks: getStringArray(value.outputPacks),
    visualStrategy: {
      primaryObjective: getString(visualStrategy.primaryObjective),
      consistencyRule: getString(visualStrategy.consistencyRule),
      variationRule: getString(visualStrategy.variationRule),
    },
    assetPolicy: {
      requiredRoles: getReferenceRoles(assetPolicy.requiredRoles),
      optionalRoles: getReferenceRoles(assetPolicy.optionalRoles),
      roleContract: getStringRecord(assetPolicy.roleContract),
    },
    copyPolicy: {
      defaultMode: getCopyMode(copyPolicy.defaultMode, "layout_layer"),
      requestedMode: getCopyMode(copyPolicy.requestedMode, "layout_layer"),
      allowBurnIn: copyPolicy.allowBurnIn === true,
      rule: getString(copyPolicy.rule),
    },
    executionPolicy: {
      mode: "sample_first_then_full_pack",
      sampleCount: getPositiveInteger(executionPolicy.sampleCount, 0),
      fullCount: getPositiveInteger(executionPolicy.fullCount, 0),
      phases: getRecordArray(executionPolicy.phases).map((phase, index) => ({
        id: getString(phase.id) || `phase_${index + 1}`,
        label: getString(phase.label) || `Phase ${index + 1}`,
        description: getString(phase.description),
      })),
    },
    qaRules: getStringArray(value.qaRules),
  };
}

export function normalizeCampaignShotList(value: unknown): CampaignShot[] {
  return getRecordArray(value)
    .map((record, index): CampaignShot | undefined => {
      const id = getString(record.id) || getString(record.slot) || `shot_${index + 1}`;
      const slot = getString(record.slot) || id;
      const label = getString(record.label) || humanizeSlot(slot);
      const intent = getString(record.intent) || getString(record.purpose);
      if (!slot || !intent) return undefined;
      const ratio = getString(record.ratio) || "auto";
      const size = getOptionalString(record.size) ?? imageSizeForRatio(ratio);

      return {
        id,
        slot,
        label,
        intent,
        purpose: getString(record.purpose) || intent,
        ratio,
        ...(size ? { size } : {}),
        samplePhase: record.samplePhase !== false,
        copyMode: getCopyMode(record.copyMode, "layout_layer"),
        textAllowed: record.textAllowed !== false,
        referenceRoles: getReferenceRoles(record.referenceRoles),
        promptHints: getStringArray(record.promptHints),
        qaRules: getStringArray(record.qaRules),
        naming: getString(record.naming) || `{project}_${slot}_${index + 1}`,
        priority: getPositiveInteger(record.priority, index + 1),
      };
    })
    .filter((shot): shot is CampaignShot => Boolean(shot));
}

export function findCampaignShotForItem(input: {
  itemId?: string;
  title?: string;
  type?: string;
  index: number;
  shotList: CampaignShot[];
}): CampaignShot | undefined {
  if (input.shotList.length === 0) return undefined;
  const haystack = [input.itemId, input.title, input.type].filter(Boolean).join(" ").toLowerCase();
  const direct = input.shotList.find((shot) => {
    const tokens = [shot.id, shot.slot, shot.label].map((value) => value.toLowerCase());
    return tokens.some((token) => token && haystack.includes(token));
  });
  return direct ?? input.shotList[input.index % input.shotList.length];
}

export function imageSizeForRatio(ratio: string | undefined): string | undefined {
  const normalized = (ratio ?? "").trim().toLowerCase();
  if (!normalized || normalized === "auto") return undefined;
  if (["1:1", "square"].includes(normalized)) return "1024x1024";
  if (["16:9", "3:2", "2:1", "landscape", "横版"].includes(normalized)) return "1536x1024";
  if (["9:16", "4:5", "3:4", "2:3", "portrait", "竖版"].includes(normalized)) return "1024x1536";
  const parts = normalized.split(":").map((part) => Number(part));
  if (parts.length === 2 && parts.every((part) => Number.isFinite(part) && part > 0)) {
    return parts[0] >= parts[1] ? "1536x1024" : "1024x1536";
  }
  return undefined;
}

function buildCampaignShot({
  slot,
  index,
  skill,
  requestedMode,
}: {
  slot: WorkflowSkillOutputSlot;
  index: number;
  skill: WorkflowSkill;
  requestedMode: CopyRenderMode;
}): CampaignShot {
  const textAllowed = allowsTextForSlot(slot, skill);
  const copyMode: CopyRenderMode = textAllowed
    ? requestedMode
    : "layout_layer";
  const referenceRoles = referenceRolesForSlot(slot, skill);
  const qaRules = [
    ...skill.qaRules,
    `Shot purpose must stay focused: ${slot.purpose}`,
    `Output ratio should be ${slot.ratio}.`,
    textAllowed
      ? "If text is used, keep it short, readable, and separated from longer export copy."
      : "Do not render marketing text, badges, or unsupported claims in this shot.",
  ];

  return {
    id: slot.id,
    slot: slot.id,
    label: slot.label,
    intent: slot.purpose,
    purpose: slot.purpose,
    ratio: slot.ratio,
    ...(imageSizeForRatio(slot.ratio) ? { size: imageSizeForRatio(slot.ratio) } : {}),
    samplePhase: slot.samplePhase,
    copyMode,
    textAllowed,
    referenceRoles,
    promptHints: [
      `Create the ${slot.label} shot for ${skill.shortLabel}.`,
      slot.purpose,
      `Use ${referenceRoles.join(", ")} references according to their roles.`,
    ],
    qaRules: dedupeStrings(qaRules),
    naming: `{project}_${skill.shortLabel}_${slot.id}_${index + 1}`,
    priority: index + 1,
  };
}

function referenceRolesForSlot(
  slot: WorkflowSkillOutputSlot,
  skill: WorkflowSkill
): CanvasReferenceRole[] {
  const text = `${slot.id} ${slot.label} ${slot.purpose}`.toLowerCase();
  const roles = new Set<CanvasReferenceRole>(skill.requiredAssetRoles);
  if (skill.optionalAssetRoles.includes("style")) roles.add("style");
  if (skill.optionalAssetRoles.includes("copy") && allowsTextForSlot(slot, skill)) roles.add("copy");
  if (skill.optionalAssetRoles.includes("scene") && /scene|lifestyle|use|cover|banner|海报|场景|生活|使用|封面|横版|竖版/.test(text)) {
    roles.add("scene");
  }
  if (skill.optionalAssetRoles.includes("model") && /model|front|side|wear|look|人|模特|展示|上身|穿|手持/.test(text)) {
    roles.add("model");
  }
  return Array.from(roles);
}

function allowsTextForSlot(slot: WorkflowSkillOutputSlot, skill: WorkflowSkill): boolean {
  if (!skill.allowBurnInCopy) return false;
  const text = `${slot.id} ${slot.label} ${slot.purpose}`.toLowerCase();
  if (/white-main|main|白底|主图/.test(text) && skill.platforms.includes("amazon")) return false;
  return /feature|info|dimension|closing|cover|save|poster|banner|vertical|square|卖点|信息|尺寸|收尾|封面|海报|横版|竖版/.test(text);
}

function parseRequestedCampaignImageCount(brief: string): number | undefined {
  const text = brief.trim();
  if (!text) return undefined;

  const digitPatterns = [
    /(\d{1,2})\s*(?:张成片|张图|张|幅|图|p|P|images?|pics?|photos?|shots?|outputs?)/i,
    /(\d{1,2})\s+(?:finished\s+)?(?:images?|photos?|shots?|outputs?)/i,
    /(\d{1,2})\s*(?:张|幅)?\s*(?:成片|最终图|完成图)/i,
  ];
  for (const pattern of digitPatterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
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
  const chineseMatch = text.match(/([一二两三四五六七八九十])\s*(?:张成片|张图|张|幅|图|成片|最终图|完成图)/);
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
  const englishMatch = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:finished\s+)?(?:images?|photos?|shots?|outputs?)\b/i);
  if (!englishMatch) return undefined;
  return englishDigits[englishMatch[1].toLowerCase()];
}

function clampCampaignImageCount(count: number, fullCount: number): number {
  const maxCount = Math.max(1, fullCount || 12);
  return Math.min(Math.max(Math.round(count), 1), maxCount);
}

function buildRoleContract(skill: WorkflowSkill): Record<string, string> {
  const roles = new Set<CanvasReferenceRole>([
    ...skill.requiredAssetRoles,
    ...skill.optionalAssetRoles,
  ]);
  const contract: Record<string, string> = {};
  if (roles.has("product")) {
    contract.product = "Product reference is the authority for exact shape, color, material, logo, hardware, and scale.";
  }
  if (roles.has("model")) {
    contract.model = "Model reference controls identity, body type, posture language, and temperament; do not copy source studio lighting.";
  }
  if (roles.has("scene")) {
    contract.scene = "Scene reference controls environment, perspective, light direction, shadow logic, and spatial scale.";
  }
  if (roles.has("style")) {
    contract.style = "Style reference controls final finish, color grade, lens feel, and polish without overriding product or scene truth.";
  }
  if (roles.has("copy")) {
    contract.copy = "Copy is structured into image text, selling points, export copy, and forbidden claims; it is not bitmap text unless approved.";
  }
  return contract;
}

function normalizeStringArray(value: unknown, fallback: string[] = []): string[] {
  const items = getStringArray(value);
  return items.length > 0 ? items : fallback;
}

function getReferenceRoles(value: unknown): CanvasReferenceRole[] {
  return getStringArray(value).filter((role): role is CanvasReferenceRole =>
    role === "product" || role === "model" || role === "style" || role === "scene" || role === "copy"
  );
}

function getCopyMode(value: unknown, fallback: CopyRenderMode): CopyRenderMode {
  if (value === "layout_layer" || value === "burn_in" || value === "metadata_only") return value;
  return fallback;
}

function getStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, getString(item)])
      .filter(([, item]) => item)
  );
}

function getRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && !!item.trim());
}

function getOptionalString(value: unknown): string | undefined {
  const text = getString(value);
  return text || undefined;
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getPositiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : fallback;
}

function humanizeSlot(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}
