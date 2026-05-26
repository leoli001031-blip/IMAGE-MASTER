import { getAssetSopDefinition } from "./asset-sop-registry";
import { buildAutoAssetName } from "./asset-auto-naming";
import type {
  AssetPackDraft,
  AssetPackReferenceImage,
  AssetPackReferenceRole,
  AssetPackReviewState,
  AssetPackSourceImage,
  AssetPackStatus,
  BuildAssetPackDraftInput,
} from "./asset-pack-types";
import { normalizeAssetPackCategory } from "./asset-pack-types";

const STABLE_DRY_RUN_CREATED_AT = "1970-01-01T00:00:00.000Z";

export function buildAssetPackDraft(input: BuildAssetPackDraftInput): AssetPackDraft {
  const category = normalizeAssetPackCategory(input.category);
  if (!category) {
    throw new Error("Unsupported asset pack category");
  }

  const sop = getAssetSopDefinition(category);
  if (!sop) {
    throw new Error(`Missing SOP definition for ${category}`);
  }

  const userRequest = normalizeText(input.userRequest);
  if (!userRequest) {
    throw new Error("userRequest is required");
  }

  const referenceImages = normalizeReferenceImages(input.sourceImages, sop.role);
  const providerUsablePrimaryReference =
    referenceImages.find((image) => image.providerUsable)?.url ?? null;
  const requestHints = buildRequestHints(userRequest);
  const hasProviderReference = !!providerUsablePrimaryReference;

  return {
    schemaVersion: 1,
    id: buildStableAssetPackId(category, userRequest, referenceImages),
    category,
    label: sop.label,
    sopKey: sop.sopKey,
    title: buildTitle(category, sop.label, userRequest),
    userRequest,
    status: normalizeStatus(input.status),
    review: {
      state: normalizeReviewState(input.reviewState),
      requiredChecks: sop.reviewChecks,
      blockingIssues: hasProviderReference ? [] : ["No provider-usable primary reference is available."],
      notes: [
        "Mock asset pack draft only; no provider call was made.",
        hasProviderReference
          ? "Primary provider reference passed the conservative URL allowlist."
          : "References are kept as planning context until a data:image or /api/generated-images URL is supplied.",
      ],
    },
    referenceImages,
    providerUsablePrimaryReference,
    invariants: mergeRules(sop.invariants, requestHints.invariants),
    allowedVariations: mergeRules(sop.allowedVariations, requestHints.allowedVariations),
    negativeRules: sop.negativeRules,
    qualityRules: sop.qualityRules,
    promptBoundaries: sop.promptBoundaries,
    buildMode: "dry_run",
    createdAt: input.createdAt ?? STABLE_DRY_RUN_CREATED_AT,
    metadata: {
      source: "asset-pack-builder",
      mock: true,
      providerBoundary: "Only data:image/... and /api/generated-images/... are provider usable.",
      referenceImageCount: referenceImages.length,
      providerUsableReferenceCount: referenceImages.filter((image) => image.providerUsable).length,
      requestHints: requestHints.summary,
    },
  };
}

export function isProviderUsableAssetPackReference(value: string | undefined): boolean {
  if (!value) return false;
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value) || value.startsWith("/api/generated-images/");
}

function normalizeReferenceImages(
  sourceImages: AssetPackSourceImage[] | undefined,
  defaultRole: AssetPackReferenceRole
): AssetPackReferenceImage[] {
  if (!Array.isArray(sourceImages)) return [];

  const seen = new Set<string>();
  return sourceImages.flatMap((image, index): AssetPackReferenceImage[] => {
    const normalized = normalizeSourceImage(image);
    if (!normalized) return [];
    if (seen.has(normalized.url)) return [];
    seen.add(normalized.url);

    return [{
      url: normalized.url,
      title: normalized.title || `Reference ${index + 1}`,
      role: normalized.role ?? defaultRole,
      providerUsable: isProviderUsableAssetPackReference(normalized.url),
      source: normalized.source || "dry-run-input",
    }];
  });
}

function normalizeSourceImage(value: AssetPackSourceImage): {
  url: string;
  title?: string;
  role?: AssetPackReferenceRole;
  source?: string;
} | null {
  if (typeof value === "string") {
    const url = normalizeText(value);
    return url ? { url } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const url = normalizeText(value.url);
  if (!url) return null;
  return {
    url,
    title: normalizeText(value.title),
    role: normalizeRole(value.role),
    source: normalizeText(value.source),
  };
}

function normalizeRole(value: unknown): AssetPackReferenceRole | undefined {
  if (value === "product" || value === "model" || value === "scene" || value === "style") return value;
  return undefined;
}

function buildRequestHints(userRequest: string): {
  invariants: string[];
  allowedVariations: string[];
  summary: string[];
} {
  const phrases = userRequest
    .split(/[，。；;,.!\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);

  if (phrases.length === 0) {
    return { invariants: [], allowedVariations: [], summary: [] };
  }

  return {
    invariants: [`Respect user request intent: ${phrases[0]}`],
    allowedVariations: phrases.slice(1).map((phrase) => `May adapt to request detail: ${phrase}`),
    summary: phrases,
  };
}

function buildStableAssetPackId(
  category: string,
  userRequest: string,
  referenceImages: AssetPackReferenceImage[]
): string {
  const hashInput = [
    category,
    userRequest,
    ...referenceImages.map((image) => `${image.role}:${image.url}`),
  ].join("|");
  return `asset_pack_${category}_${hashString(hashInput)}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(6, "0");
}

function buildTitle(category: AssetPackDraft["category"], label: string, userRequest: string): string {
  const autoName = buildAutoAssetName({
    category,
    userRequest,
    fallbackTitle: label,
  });
  return autoName.title;
}

function mergeRules(base: string[], additions: string[]): string[] {
  return Array.from(new Set([...base, ...additions].map((item) => item.trim()).filter(Boolean)));
}

function normalizeStatus(value: AssetPackStatus | undefined): AssetPackStatus {
  return value === "ready" || value === "needs_review" ? value : "draft";
}

function normalizeReviewState(value: AssetPackReviewState | undefined): AssetPackReviewState {
  if (value === "approved" || value === "needs_review" || value === "rejected") return value;
  return "unreviewed";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
