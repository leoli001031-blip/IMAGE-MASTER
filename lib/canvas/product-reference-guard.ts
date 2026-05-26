import {
  buildProviderReferenceAdapter,
  isProviderUsableReferenceUrl,
  normalizeGenerationReferenceContext,
  type GenerationReferenceContext,
  type GenerationReferenceImage,
  type GenerationReferenceRoleContext,
} from "@/lib/canvas/generation-reference-context";

export type ProductReferenceKind = "missing" | "parameter_only" | "concept" | "real";

export interface ProductReferenceGuardResult {
  kind: ProductReferenceKind;
  hasProviderUsableRealProductImage: boolean;
  providerUsableProductImage?: GenerationReferenceImage;
  productImages: GenerationReferenceImage[];
  providerUsableProductImages: GenerationReferenceImage[];
  parameterKeys: string[];
  issues: string[];
}

export function hasProviderUsableRealProductImage(
  contextOrMetadata: GenerationReferenceContext | Record<string, unknown> | undefined
): boolean {
  return classifyProductReference(contextOrMetadata).hasProviderUsableRealProductImage;
}

export function classifyProductReference(
  contextOrMetadata: GenerationReferenceContext | Record<string, unknown> | undefined
): ProductReferenceGuardResult {
  const context = normalizeProductReferenceContext(contextOrMetadata);
  const roleContext = context?.roles.product;
  const adapter = buildProviderReferenceAdapter(contextOrMetadata);
  const productImages = collectProductImages(contextOrMetadata, context);
  const providerUsableProductImages = adapter.providerUsableImages.filter((image) => image.role === "product");
  const realProviderImage = providerUsableProductImages.find((image) =>
    isRealProductReferenceImage(image, roleContext)
  );
  const parameterKeys = getProductParameterKeys(roleContext);
  const hasProductText =
    !!roleContext &&
    (parameterKeys.length > 0 ||
      roleContext.promptFragments.length > 0 ||
      roleContext.constraints.length > 0 ||
      roleContext.qualityRules.length > 0 ||
      roleContext.negativeRules.length > 0);
  const issues: string[] = [];

  if (realProviderImage) {
    return {
      kind: "real",
      hasProviderUsableRealProductImage: true,
      providerUsableProductImage: realProviderImage,
      productImages,
      providerUsableProductImages,
      parameterKeys,
      issues,
    };
  }

  if (providerUsableProductImages.length > 0) {
    issues.push("Product image is provider-usable, but it is marked or inferred as concept-only.");
    return {
      kind: "concept",
      hasProviderUsableRealProductImage: false,
      productImages,
      providerUsableProductImages,
      parameterKeys,
      issues,
    };
  }

  if (productImages.length > 0) {
    issues.push("Product image exists, but it is not provider-usable for a real product lock.");
    return {
      kind: "concept",
      hasProviderUsableRealProductImage: false,
      productImages,
      providerUsableProductImages,
      parameterKeys,
      issues,
    };
  }

  if (hasProductText) {
    issues.push("Product role has only text or parameters; no provider-usable real image is available.");
    return {
      kind: "parameter_only",
      hasProviderUsableRealProductImage: false,
      productImages,
      providerUsableProductImages,
      parameterKeys,
      issues,
    };
  }

  issues.push("Product role is missing.");
  return {
    kind: "missing",
    hasProviderUsableRealProductImage: false,
    productImages,
    providerUsableProductImages,
    parameterKeys,
    issues,
  };
}

export function isRealProductReferenceImage(
  image: GenerationReferenceImage,
  roleContext?: GenerationReferenceRoleContext
): boolean {
  if (image.role !== "product") return false;
  if (!isProviderImageInputEligible(image)) return false;
  if (hasConceptOnlySignal(image, roleContext)) return false;
  return true;
}

function normalizeProductReferenceContext(
  contextOrMetadata: GenerationReferenceContext | Record<string, unknown> | undefined
): GenerationReferenceContext | undefined {
  if (!contextOrMetadata) return undefined;
  const nestedContext = isRecord(contextOrMetadata)
    ? contextOrMetadata.referenceContext
    : undefined;
  return normalizeGenerationReferenceContext(contextOrMetadata) ??
    normalizeGenerationReferenceContext(nestedContext);
}

function collectProductImages(
  contextOrMetadata: GenerationReferenceContext | Record<string, unknown> | undefined,
  context: GenerationReferenceContext | undefined
): GenerationReferenceImage[] {
  const directImages = normalizeGenerationReferenceContext({
    version: 1,
    source: "canvas-workbench",
    images: isRecord(contextOrMetadata) ? contextOrMetadata.referenceImages : undefined,
    roles: {},
  })?.images ?? [];
  const metadataReferenceUrl =
    isRecord(contextOrMetadata) && "referenceImageUrl" in contextOrMetadata
      ? getString(contextOrMetadata.referenceImageUrl)
      : undefined;
  const storage = isRecord(contextOrMetadata) && isRecord(contextOrMetadata.referenceImageStorage)
    ? contextOrMetadata.referenceImageStorage
    : undefined;
  const legacyReferenceUrl = metadataReferenceUrl ?? getString(storage?.publicUrl);
  const legacyImage = legacyReferenceUrl
    ? [{
        role: "product" as const,
        title: "Product reference",
        url: legacyReferenceUrl,
        providerUsable: isProviderUsableReferenceUrl(legacyReferenceUrl),
        source: "legacy-reference-image-url",
      }]
    : [];

  return dedupeProductImages([
    ...(context?.images ?? []),
    ...directImages,
    ...legacyImage,
  ].filter((image) => image.role === "product"));
}

function isProviderImageInputEligible(image: GenerationReferenceImage): boolean {
  return image.providerMode !== "prompt_only" &&
    image.providerMode !== "disabled" &&
    image.providerUsable &&
    isProviderUsableReferenceUrl(image.url);
}

function hasConceptOnlySignal(
  image: GenerationReferenceImage,
  roleContext?: GenerationReferenceRoleContext
): boolean {
  const values = [
    image.source,
    image.title,
    getString(roleContext?.parameters?.productReferenceKind),
    getString(roleContext?.parameters?.referenceKind),
    getString(roleContext?.parameters?.sourceKind),
    getString(roleContext?.parameters?.imageOrigin),
    getString(roleContext?.parameters?.origin),
    getString(roleContext?.parameters?.provenance),
    getString(roleContext?.parameters?.lockKind),
  ].filter((value): value is string => !!value);
  return values.some(isConceptOnlyText);
}

function isConceptOnlyText(value: string): boolean {
  return /(?:concept|mockup|mock-up|prototype|draft|sample|placeholder|demo|ai_generated|ai-generated|generated_concept|text_only|text-only|parameter_only|parameter-only|概念|虚拟|生成|草稿|样例|占位|参数)/i.test(
    value
  );
}

function getProductParameterKeys(roleContext: GenerationReferenceRoleContext | undefined): string[] {
  if (!roleContext?.parameters) return [];
  return Object.keys(roleContext.parameters).filter((key) => roleContext.parameters?.[key] !== undefined);
}

function dedupeProductImages(images: GenerationReferenceImage[]): GenerationReferenceImage[] {
  const seen = new Set<string>();
  return images.filter((image) => {
    const key = `${image.role}:${image.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
