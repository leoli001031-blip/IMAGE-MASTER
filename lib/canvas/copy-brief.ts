export type StructuredCopySection =
  | "inImageText"
  | "sellingPoints"
  | "exportCopy"
  | "forbiddenClaims";

export interface StructuredCopyBrief {
  schemaVersion: 1;
  sourceText: string;
  inImageText: string[];
  sellingPoints: string[];
  exportCopy: string[];
  forbiddenClaims: string[];
  promptFragments: string[];
  constraints: string[];
  negativeRules: string[];
  qualityRules: string[];
}

const inImageKeywords = [
  "画面文字",
  "图中文字",
  "封面标题",
  "海报标题",
  "标题",
  "slogan",
  "headline",
];

const sellingPointKeywords = [
  "卖点",
  "参数",
  "规格",
  "功能",
  "材质",
  "尺寸",
  "优势",
  "benefit",
  "feature",
  "spec",
];

const exportCopyKeywords = [
  "导出文案",
  "正文",
  "描述",
  "详情",
  "笔记",
  "caption",
  "description",
  "listing",
];

const forbiddenClaimKeywords = [
  "禁止",
  "不要",
  "不能",
  "避免",
  "不允许",
  "不夸大",
  "禁用",
  "forbid",
  "avoid",
  "never",
  "must not",
];

export function buildStructuredCopyBrief(sourceText: string): StructuredCopyBrief {
  const normalizedText = sourceText.trim();
  const buckets: Record<StructuredCopySection, string[]> = {
    inImageText: [],
    sellingPoints: [],
    exportCopy: [],
    forbiddenClaims: [],
  };

  for (const line of splitCopyLines(normalizedText)) {
    buckets[classifyCopyLine(line)].push(stripCopyPrefix(line));
  }

  if (
    buckets.inImageText.length === 0 &&
    buckets.sellingPoints.length === 0 &&
    buckets.exportCopy.length === 0 &&
    buckets.forbiddenClaims.length === 0 &&
    normalizedText
  ) {
    buckets.sellingPoints.push(normalizedText);
  }

  const brief = normalizeStructuredCopyBrief({
    schemaVersion: 1,
    sourceText: normalizedText,
    ...buckets,
    promptFragments: buildCopyPromptFragments(buckets),
    constraints: buildCopyConstraints(buckets),
    negativeRules: buildCopyNegativeRules(buckets),
    qualityRules: [
      "Keep any visible text short, readable, and placed in a clean copy-safe area.",
      "Use supplied selling points only as grounded product claims; do not invent proof.",
      "Export copy should stay editable metadata unless the user explicitly asks to burn short copy into the image.",
    ],
  });
  if (brief) return brief;

  return {
    schemaVersion: 1,
    sourceText: normalizedText,
    ...buckets,
    promptFragments: [],
    constraints: [],
    negativeRules: [],
    qualityRules: [],
  };
}

export function normalizeStructuredCopyBrief(value: unknown): StructuredCopyBrief | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const sourceText = getString(record.sourceText);
  const inImageText = getStringArray(record.inImageText);
  const sellingPoints = getStringArray(record.sellingPoints);
  const exportCopy = getStringArray(record.exportCopy);
  const forbiddenClaims = getStringArray(record.forbiddenClaims);
  if (!sourceText && inImageText.length + sellingPoints.length + exportCopy.length + forbiddenClaims.length === 0) {
    return undefined;
  }

  const buckets = { inImageText, sellingPoints, exportCopy, forbiddenClaims };
  return {
    schemaVersion: 1,
    sourceText,
    inImageText,
    sellingPoints,
    exportCopy,
    forbiddenClaims,
    promptFragments: getStringArray(record.promptFragments).length
      ? getStringArray(record.promptFragments)
      : buildCopyPromptFragments(buckets),
    constraints: getStringArray(record.constraints).length
      ? getStringArray(record.constraints)
      : buildCopyConstraints(buckets),
    negativeRules: getStringArray(record.negativeRules).length
      ? getStringArray(record.negativeRules)
      : buildCopyNegativeRules(buckets),
    qualityRules: getStringArray(record.qualityRules).length
      ? getStringArray(record.qualityRules)
      : [
          "Visible copy must remain readable and must not cover product-critical details.",
          "Claims must be grounded in the supplied product brief.",
        ],
  };
}

function classifyCopyLine(line: string): StructuredCopySection {
  const normalized = line.toLowerCase();
  if (hasKeyword(normalized, forbiddenClaimKeywords)) return "forbiddenClaims";
  if (hasKeyword(normalized, inImageKeywords)) return "inImageText";
  if (hasKeyword(normalized, exportCopyKeywords)) return "exportCopy";
  if (hasKeyword(normalized, sellingPointKeywords)) return "sellingPoints";
  return line.length <= 24 ? "inImageText" : "sellingPoints";
}

function splitCopyLines(text: string): string[] {
  return text
    .split(/\n|；|;|。/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripCopyPrefix(line: string): string {
  return line
    .replace(/^\s*[-*•\d.、)）]+/, "")
    .replace(/^\s*(画面文字|图中文字|封面标题|海报标题|标题|卖点|参数|规格|功能|材质|尺寸|导出文案|正文|描述|详情|笔记|禁止|不要|不能|避免|不允许|不夸大)\s*[:：]\s*/i, "")
    .trim();
}

function buildCopyPromptFragments(buckets: Pick<StructuredCopyBrief, "inImageText" | "sellingPoints" | "exportCopy">): string[] {
  const fragments: string[] = [];
  if (buckets.inImageText.length > 0) {
    fragments.push(`Visible image copy candidates: ${buckets.inImageText.slice(0, 6).join(" | ")}`);
  }
  if (buckets.sellingPoints.length > 0) {
    fragments.push(`Grounded selling points: ${buckets.sellingPoints.slice(0, 8).join(" | ")}`);
  }
  if (buckets.exportCopy.length > 0) {
    fragments.push(`Export-only copy notes: ${buckets.exportCopy.slice(0, 6).join(" | ")}`);
  }
  return fragments;
}

function buildCopyConstraints(buckets: Pick<StructuredCopyBrief, "inImageText" | "sellingPoints" | "exportCopy">): string[] {
  const constraints = [
    "Treat copy as structured guidance: visible image text, selling points, and export-only copy are separate.",
  ];
  if (buckets.inImageText.length > 0) {
    constraints.push("Visible image text may be used only when the selected template allows text and burn-in is explicitly enabled.");
  }
  if (buckets.exportCopy.length > 0) {
    constraints.push("Export-only copy should remain metadata or caption text unless explicitly requested in the image.");
  }
  return constraints;
}

function buildCopyNegativeRules(buckets: Pick<StructuredCopyBrief, "forbiddenClaims">): string[] {
  return [
    ...buckets.forbiddenClaims.map((claim) => `Forbidden copy claim: ${claim}`),
    "Do not invent unsupported product claims, certifications, discounts, celebrity endorsements, or platform marks.",
    "Do not place long paragraphs, unreadable fine print, or dense copy directly inside generated images.",
  ];
}

function hasKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && !!item.trim());
}
