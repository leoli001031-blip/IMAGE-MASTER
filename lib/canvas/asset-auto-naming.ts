import type { AssetType, CreateModelParams, ModelAssetMetadata } from "@/lib/types";
import type { AssetPackCategory } from "./asset-pack-types";

export type AutoAssetNameCategory =
  | AssetType
  | AssetPackCategory
  | "output_reference"
  | "generated_output";

export interface AutoAssetNameInput {
  category: AutoAssetNameCategory;
  userRequest?: string;
  fallbackTitle?: string;
  metadata?: Record<string, unknown>;
}

export interface AutoAssetName {
  title: string;
  subtitle: string;
  tags: string[];
  slug: string;
  source: "auto";
}

const CATEGORY_LABELS: Record<string, string> = {
  product: "商品",
  product_asset: "商品",
  model: "模特",
  model_asset: "模特",
  style: "风格",
  style_asset: "风格",
  scene: "场景",
  scene_asset: "场景",
  copy: "文案",
  copy_asset: "文案",
  output: "输出图",
  output_reference: "输出参考",
  generated_output: "生成图",
  platform: "平台规则",
  quality: "质检规则",
};

const GENDER_LABELS: Record<string, string> = {
  female: "女模特",
  male: "男模特",
};

const ETHNICITY_LABELS: Record<string, string> = {
  asian: "东亚",
  european: "欧美",
  african: "非洲",
};

const TEMPERAMENT_LABELS: Record<string, string> = {
  intellectual: "知性",
  energetic: "活力",
  gentle: "温柔",
  business: "商务",
  cool: "酷感",
};

const BODY_LABELS: Record<string, string> = {
  slim: "轻盈",
  standard: "标准",
  athletic: "运动",
};

const HAIR_LABELS: Record<string, string> = {
  short: "短发",
  mid: "中发",
  long: "长发",
  tied: "低马尾",
};

export function buildAutoAssetName(input: AutoAssetNameInput): AutoAssetName {
  const category = input.category;
  if (category === "model" || category === "model_asset") {
    return buildAutoModelAssetName({
      userRequest: input.userRequest,
      fallbackTitle: input.fallbackTitle,
      metadata: input.metadata,
    });
  }

  const label = CATEGORY_LABELS[category] ?? "资产";
  const requestName = extractUsefulRequestName(input.userRequest);
  const fallbackName = extractUsefulRequestName(input.fallbackTitle);
  const baseName = requestName || fallbackName || "新资产";
  const tags = dedupeStrings([label, ...extractKeywordTags(`${input.userRequest ?? ""} ${input.fallbackTitle ?? ""}`)]);

  return {
    title: compactTitle(`${label} · ${baseName}`, 28),
    subtitle: tags.slice(1, 4).join(" / "),
    tags,
    slug: slugify(`${label}-${baseName}`),
    source: "auto",
  };
}

export function buildAutoModelAssetName({
  params,
  metadata,
  userRequest,
  fallbackTitle,
}: {
  params?: Partial<CreateModelParams>;
  metadata?: Record<string, unknown> | ModelAssetMetadata;
  userRequest?: string;
  fallbackTitle?: string;
}): AutoAssetName {
  const modelMetadata = metadata as Partial<ModelAssetMetadata> | undefined;
  const sourceParams = {
    ...getRecordValue(metadata?.sourceParams),
    ...params,
  };
  const profile = getRecordValue(metadata?.profile);
  const age = getNumberValue(sourceParams.age) ?? getNumberValue(profile.age) ?? extractAge(userRequest) ?? extractAge(fallbackTitle);
  const gender = getStringValue(sourceParams.gender) || getStringValue(profile.gender);
  const region =
    humanizeRegion(getStringValue(profile.identityRegion)) ||
    humanizeRegion(getStringValue(sourceParams.ethnicity)) ||
    inferRegionFromText(`${userRequest ?? ""} ${fallbackTitle ?? ""}`) ||
    "商业";
  const temperament =
    TEMPERAMENT_LABELS[getStringValue(sourceParams.temperament)] ||
    extractTemperamentLabel(getStringValue(profile.temperament)) ||
    inferTemperamentFromText(`${userRequest ?? ""} ${fallbackTitle ?? ""}`);
  const hair =
    HAIR_LABELS[getStringValue(sourceParams.hairStyle)] ||
    extractHairLabel(getStringValue(profile.hair)) ||
    inferHairFromText(`${userRequest ?? ""} ${fallbackTitle ?? ""}`);
  const body = BODY_LABELS[getStringValue(sourceParams.bodyType)] || "";
  const genderLabel = GENDER_LABELS[gender] ?? "模特";

  const core = [age ? `${age}岁` : "", region, genderLabel].filter(Boolean).join("");
  const descriptor = dedupeStrings([hair, temperament, body]).slice(0, 2).join(" · ");
  const requestHint = extractUsefulRequestName(userRequest);
  const title = compactTitle(
    descriptor ? `${core || "商业模特"} · ${descriptor}` : core || requestHint || "商业模特",
    30
  );
  const tags = dedupeStrings([
    "模特",
    age ? `${age}岁` : "",
    region,
    genderLabel,
    hair,
    temperament,
    body,
    ...extractKeywordTags(userRequest ?? ""),
  ]);
  const subtitle = dedupeStrings([
    getStringValue(profile.marketContext),
    getStringValue(profile.bodyProfile),
    getStringValue(modelMetadata?.source),
  ])
    .slice(0, 2)
    .join(" / ");

  return {
    title,
    subtitle,
    tags,
    slug: slugify(`${title}-${requestHint || fallbackTitle || ""}`),
    source: "auto",
  };
}

function extractUsefulRequestName(value: unknown): string {
  const text = getStringValue(value)
    .replace(/^(商品|模特|场景|风格|输出|参考|资产|product|model|scene|style)\s*(资产|参考图|reference)?[:：·-]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";

  const firstPhrase = text.split(/[，。；;,.!\n]+/)[0]?.trim() || text;
  return compactTitle(firstPhrase, 24);
}

function extractKeywordTags(value: string): string[] {
  const text = value.toLowerCase();
  const tags: string[] = [];
  const checks: Array<[RegExp, string]> = [
    [/小红书|xhs|rednote/, "小红书"],
    [/淘宝|taobao/, "淘宝"],
    [/亚马逊|amazon/, "Amazon"],
    [/海报|poster/, "海报"],
    [/详情页|detail/, "详情页"],
    [/白底|white background/, "白底"],
    [/高级|premium|luxury/, "高级"],
    [/极简|minimal/, "极简"],
    [/户外|outdoor/, "户外"],
    [/家居|home/, "家居"],
    [/短发|short hair/, "短发"],
    [/长发|long hair/, "长发"],
  ];
  for (const [pattern, label] of checks) {
    if (pattern.test(text)) tags.push(label);
  }
  return tags;
}

function extractAge(value: unknown): number | undefined {
  const match = getStringValue(value).match(/(\d{2})\s*(岁|year|yo)?/i);
  if (!match) return undefined;
  const age = Number(match[1]);
  return Number.isInteger(age) && age >= 18 && age <= 80 ? age : undefined;
}

function humanizeRegion(value: string): string {
  if (!value) return "";
  const lower = value.toLowerCase();
  if (lower.includes("japan")) return "日本";
  if (lower.includes("korea") || lower.includes("seoul")) return "韩国";
  if (lower.includes("china") || lower.includes("mainland")) return "中国";
  if (lower.includes("ukrain") || lower.includes("eastern european")) return "东欧";
  if (lower.includes("brazil") || lower.includes("sao paulo")) return "巴西";
  if (ETHNICITY_LABELS[lower]) return ETHNICITY_LABELS[lower];
  return value.replace(/commercial|e-commerce|catalog/gi, "").trim();
}

function inferRegionFromText(text: string): string {
  const lower = text.toLowerCase();
  if (/日本|japan|tokyo|kyoto|osaka/.test(lower)) return "日本";
  if (/韩国|korea|seoul|busan|jeju/.test(lower)) return "韩国";
  if (/中国|china|shanghai|beijing|hangzhou|chengdu|guangzhou|shenzhen/.test(lower)) return "中国";
  if (/乌克兰|ukrain|eastern europe/.test(lower)) return "东欧";
  if (/欧美|europe|global/.test(lower)) return "欧美";
  if (/巴西|brazil|sao paulo/.test(lower)) return "巴西";
  return "";
}

function extractTemperamentLabel(value: string): string {
  const lower = value.toLowerCase();
  if (/business|professional|composed|executive/.test(lower)) return "商务";
  if (/gentle|soft|warm/.test(lower)) return "温柔";
  if (/energetic|active|sport/.test(lower)) return "活力";
  if (/cool|editorial|poised/.test(lower)) return "酷感";
  if (/clean|approachable|natural/.test(lower)) return "清爽";
  return "";
}

function inferTemperamentFromText(text: string): string {
  if (/商务|专业|business|executive|premium/.test(text)) return "商务";
  if (/温柔|柔和|gentle|soft/.test(text)) return "温柔";
  if (/运动|活力|energetic|active|sport/.test(text)) return "活力";
  if (/高级|酷|editorial|cool/.test(text)) return "高级";
  if (/干净|清爽|clean|minimal/.test(text)) return "清爽";
  return "";
}

function extractHairLabel(value: string): string {
  const lower = value.toLowerCase();
  if (/short|bob|短发/.test(lower)) return "短发";
  if (/ponytail|tied|马尾/.test(lower)) return "低马尾";
  if (/medium|mid|中发/.test(lower)) return "中发";
  if (/long|长发/.test(lower)) return "长发";
  return "";
}

function inferHairFromText(text: string): string {
  if (/短发|short|bob/.test(text)) return "短发";
  if (/马尾|ponytail|tied/.test(text)) return "低马尾";
  if (/长发|long/.test(text)) return "长发";
  return "";
}

function compactTitle(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, " ").replace(/\s*·\s*/g, " · ").trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(1, maxLength - 1)).trimEnd() + "…";
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "asset";
}

function dedupeStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((item) => item?.trim()).filter(Boolean) as string[]));
}

function getRecordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
