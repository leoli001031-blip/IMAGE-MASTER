export const ASSET_PACK_CATEGORIES = [
  "product_asset",
  "model_asset",
  "scene_asset",
  "style_asset",
] as const;

export type AssetPackCategory = (typeof ASSET_PACK_CATEGORIES)[number];

export type AssetPackReferenceRole = "product" | "model" | "scene" | "style";

export type AssetPackStatus = "draft" | "ready" | "needs_review";

export type AssetPackReviewState = "unreviewed" | "needs_review" | "approved" | "rejected";

export interface AssetPackSourceImageInput {
  url: string;
  title?: string;
  role?: AssetPackReferenceRole;
  source?: string;
}

export type AssetPackSourceImage = string | AssetPackSourceImageInput;

export interface AssetPackReferenceImage {
  url: string;
  title: string;
  role: AssetPackReferenceRole;
  providerUsable: boolean;
  source: string;
}

export interface AssetPackReview {
  state: AssetPackReviewState;
  requiredChecks: string[];
  blockingIssues: string[];
  notes: string[];
}

export interface AssetSopDefinition {
  category: AssetPackCategory;
  label: string;
  role: AssetPackReferenceRole;
  sopKey: string;
  description: string;
  invariants: string[];
  allowedVariations: string[];
  negativeRules: string[];
  qualityRules: string[];
  reviewChecks: string[];
  promptBoundaries: string[];
}

export interface AssetPackDraft {
  schemaVersion: 1;
  id: string;
  category: AssetPackCategory;
  label: string;
  sopKey: string;
  title: string;
  userRequest: string;
  status: AssetPackStatus;
  review: AssetPackReview;
  referenceImages: AssetPackReferenceImage[];
  providerUsablePrimaryReference: string | null;
  invariants: string[];
  allowedVariations: string[];
  negativeRules: string[];
  qualityRules: string[];
  promptBoundaries: string[];
  buildMode: "dry_run" | "mock" | "generated";
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface BuildAssetPackDraftInput {
  category: AssetPackCategory | string;
  userRequest: string;
  sourceImages?: AssetPackSourceImage[];
  status?: AssetPackStatus;
  reviewState?: AssetPackReviewState;
  createdAt?: string;
}

export interface AssetPackDryRunResponse {
  dryRun: true;
  providerCalls: 0;
  assetPack: AssetPackDraft;
}

const CATEGORY_SET = new Set<string>(ASSET_PACK_CATEGORIES);

export function isAssetPackCategory(value: unknown): value is AssetPackCategory {
  return typeof value === "string" && CATEGORY_SET.has(value);
}

export function normalizeAssetPackCategory(value: unknown): AssetPackCategory | undefined {
  if (isAssetPackCategory(value)) return value;
  if (value === "product") return "product_asset";
  if (value === "model") return "model_asset";
  if (value === "scene") return "scene_asset";
  if (value === "style" || value === "visual_style") return "style_asset";
  return undefined;
}
