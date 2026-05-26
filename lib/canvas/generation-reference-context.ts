export type GenerationReferenceRole = "product" | "model" | "style" | "scene" | "copy";

export const generationReferenceRoles = [
  "product",
  "model",
  "style",
  "scene",
  "copy",
] as const satisfies readonly GenerationReferenceRole[];

export interface GenerationReferenceImage {
  role: GenerationReferenceRole;
  title: string;
  url: string;
  providerUsable: boolean;
  providerMode?: "provider_input" | "prompt_only" | "disabled";
  source?: string;
  nodeId?: string;
  assetId?: string;
  componentId?: string;
}

export interface GenerationReferenceRoleContext {
  role: GenerationReferenceRole;
  title: string;
  sourceNodeIds: string[];
  componentIds: string[];
  assetIds: string[];
  parameters?: Record<string, unknown>;
  promptFragments: string[];
  constraints: string[];
  negativeRules: string[];
  qualityRules: string[];
}

export interface GenerationReferenceContext {
  version: 1;
  source: "canvas-workbench";
  targetNodeId?: string;
  targetNodeLabel?: string;
  images: GenerationReferenceImage[];
  roles: Partial<Record<GenerationReferenceRole, GenerationReferenceRoleContext>>;
  promptFragments: string[];
  constraints: string[];
  negativeRules: string[];
  qualityRules: string[];
}

export interface ProviderReferenceAdapter {
  mode: "multi_image_input" | "single_image_input" | "prompt_only";
  strategy: "multi_provider_usable_images" | "product_primary_single_image" | "role_priority_single_image" | "prompt_only";
  primaryImage?: GenerationReferenceImage;
  promptOnlyImages: GenerationReferenceImage[];
  providerUsableImages: GenerationReferenceImage[];
  warnings: string[];
}

const roleLabels: Record<GenerationReferenceRole, string> = {
  product: "Product reference",
  model: "Model reference",
  style: "Visual style",
  scene: "Scene context",
  copy: "Copy brief",
};

const promptBlockMarker = "Reference context:";
const providerReferencePriority: GenerationReferenceRole[] = ["product", "model", "style", "scene", "copy"];

export function appendGenerationReferencePrompt(
  prompt: string,
  context: GenerationReferenceContext | undefined
): string {
  const block = buildGenerationReferencePromptBlock(context, prompt);
  if (!block) return prompt;
  if (prompt.includes(promptBlockMarker)) return prompt;
  return `${prompt.trim()}\n\n${block}`;
}

export function filterGenerationReferenceContextByRoles(
  context: GenerationReferenceContext | undefined,
  referenceRoles: readonly GenerationReferenceRole[] | undefined,
  providerReferenceRoles: readonly GenerationReferenceRole[] | undefined = referenceRoles
): GenerationReferenceContext | undefined {
  if (!context || !isGenerationReferenceContext(context)) return undefined;
  const activeRoleSet = normalizeRoleSet(referenceRoles);
  if (!activeRoleSet) return context;

  const providerRoleSet = normalizeRoleSet(providerReferenceRoles) ?? activeRoleSet;
  const roles: GenerationReferenceContext["roles"] = {};
  for (const role of generationReferenceRoles) {
    if (activeRoleSet.has(role) && context.roles[role]) roles[role] = context.roles[role];
  }

  const images = context.images
    .filter((image) => activeRoleSet.has(image.role))
    .map((image) => {
      if (providerRoleSet.has(image.role)) return image;
      return {
        ...image,
        providerUsable: false,
        providerMode: "prompt_only" as const,
      };
    });

  return {
    ...context,
    images,
    roles,
  };
}

export function buildGenerationReferencePromptBlock(
  context: GenerationReferenceContext | undefined,
  basePrompt = ""
): string {
  if (!context || !isGenerationReferenceContext(context)) return "";

  const lines: string[] = [promptBlockMarker];

  if (hasReferenceRole(context, "product")) {
    lines.push("- 商品参考：只锁商品身份、形状、颜色、材质、五金/肩带/手柄/结构和比例；不要复制拼版、白底、标签或背景。");
  }
  if (hasReferenceRole(context, "model")) {
    lines.push("- 模特参考：只锁同一人身份、脸型、发型、年龄感、身形和气质；不要复制模卡表情、固定眼神、棚拍光、站姿或排版。");
  }
  if (hasReferenceRole(context, "scene")) {
    lines.push("- 场景参考：负责环境、透视、光源方向、阴影和空间尺度；人物和商品要融入场景。");
  }
  if (hasReferenceRole(context, "style")) {
    lines.push("- 风格参考：只负责色调、镜头感、质感和商业完成度；不要覆盖商品、人物或场景事实。");
  }
  if (hasReferenceRole(context, "copy")) {
    lines.push("- 文案参考：默认作为结构化文案/版式信息；除非明确要求，不要把文字烧进图片。");
    const copyRole = context.roles.copy;
    if (copyRole) {
      appendLimitedLines(lines, "Copy brief", copyRole.promptFragments, 4);
      appendLimitedLines(lines, "Copy constraints", copyRole.constraints, 4);
      appendLimitedLines(lines, "Copy negative rules", copyRole.negativeRules, 4);
      appendLimitedLines(lines, "Copy quality rules", copyRole.qualityRules, 4);
    }
  }

  if (hasReferenceRole(context, "model") && hasReferenceRole(context, "scene")) {
    lines.push(
      "- 光影规则：脸、身体、手、商品和地面/桌面接触阴影都跟场景光走，避免棚拍补光和抠图感。"
    );
    lines.push(
      "- 神态规则：同一人，但眼神、表情和动作由当前镜头决定。"
    );
  } else if (hasReferenceRole(context, "product") && hasReferenceRole(context, "scene")) {
    lines.push(
      "- 商品入景规则：商品高光、阴影、反射、接触阴影、透视和颗粒感都要跟场景一致。"
    );
  }

  const adapter = buildProviderReferenceAdapter(context);
  if (adapter.providerUsableImages.length > 1) {
    lines.push(
      `- 已传入参考图：${adapter.providerUsableImages
        .slice(0, 6)
        .map((image) => `${roleLabels[image.role]} "${image.title}"`)
        .join("；")}。`
    );
  } else if (adapter.primaryImage) {
    lines.push(
      `- 已传入参考图：${roleLabels[adapter.primaryImage.role]} "${adapter.primaryImage.title}"。`
    );
  }
  if (adapter.promptOnlyImages.length > 0) {
    lines.push(
      `- 仅作文字约束：${adapter.promptOnlyImages
        .slice(0, 6)
        .map((image) => `${roleLabels[image.role]} "${image.title}"`)
        .join("；")}。`
    );
  }
  if (adapter.mode === "prompt_only" && adapter.promptOnlyImages.length > 0) {
    lines.push(
      "- 注意：当前没有可传入 provider 的图片参考，以上只作为文字约束。"
    );
  }

  return lines.length > 1 ? lines.join("\n") : "";
}

function hasReferenceRole(
  context: GenerationReferenceContext,
  role: GenerationReferenceRole
): boolean {
  return Boolean(context.roles[role]) || context.images.some((image) => image.role === role);
}

function buildRealWorldCaptureRules(
  context: GenerationReferenceContext,
  basePrompt: string
): string[] {
  if (!shouldUseRealWorldCaptureRules(context, basePrompt)) return [];

  return [
    "- Real-world capture rule: For product+model shots, default to a location-captured photograph instead of an e-commerce composite. Use an eye-level camera, 35mm/50mm lens feeling, natural ambient scene light, believable scale between model/product/background, imperfect floor or sidewalk contact, mild real-world clutter, fabric wrinkles, natural skin texture, tiny flyaway hairs, slight body asymmetry, and physically plausible hand-product or garment contact.",
    "- Model action rule: The model should be doing one small believable thing with a reason: adjusting a strap, checking the product detail, pausing at a doorway, turning because someone called her, walking mid-step, looking down while opening the product, or resting the product on a table/lap. Include a restrained expression, gaze direction, weight shift, and realistic hand/product contact. Avoid repeated neutral catalogue standing poses.",
    "- Anti-cheap-composite rule: Avoid catalogue poses, studio beauty face light, porcelain skin, CGI smoothness, shadowless cutout edges, product pasted onto the hand/body, over-clean showroom backgrounds, and glossy mall-ad polish unless the user explicitly asks for that style. The product must remain recognizable, but it should feel naturally worn, held, carried, or used inside the scene.",
  ];
}

function shouldUseRealWorldCaptureRules(
  context: GenerationReferenceContext,
  basePrompt: string
): boolean {
  if (!hasReferenceRole(context, "product") || !hasReferenceRole(context, "model")) {
    return false;
  }

  const text = basePrompt.toLowerCase();
  if (hasStrictProductOrGraphicIntent(text)) return false;
  if (hasReferenceRole(context, "scene")) return true;

  return /(?:lifestyle|street|outdoor|indoor|mall|cafe|room|scene|location|wear|wearing|hold|holding|carry|carrying|model|look|真人|模特|人物|穿|上身|手持|拿着|背着|佩戴|街拍|生活|室内|室外|商场|咖啡|场景|外景)/i.test(
    basePrompt
  );
}

function hasStrictProductOrGraphicIntent(text: string): boolean {
  return /(?:white background|pure white|marketplace main|amazon main|listing image|packshot|product sheet|multi-view|detail page|callout|infographic|text overlay|banner|graphic poster|no model|product-only|product only|白底|纯白|主图|亚马逊主图|商品图|静物|无模特|不要模特|无人物|多角度|详情页|参数图|卖点图|信息图|文字海报|横幅|抠图)/i.test(
    text
  );
}

export function normalizeGenerationReferenceContext(
  value: unknown
): GenerationReferenceContext | undefined {
  if (!isRecord(value)) return undefined;

  const rolesValue = isRecord(value.roles) ? value.roles : {};
  const roles: GenerationReferenceContext["roles"] = {};
  for (const role of generationReferenceRoles) {
    const normalized = normalizeRoleContext(rolesValue[role], role);
    if (normalized) roles[role] = normalized;
  }

  return {
    version: 1,
    source: "canvas-workbench",
    targetNodeId: getString(value.targetNodeId),
    targetNodeLabel: getString(value.targetNodeLabel),
    images: normalizeReferenceImages(value.images),
    roles,
    promptFragments: getStringArray(value.promptFragments),
    constraints: getStringArray(value.constraints),
    negativeRules: getStringArray(value.negativeRules),
    qualityRules: getStringArray(value.qualityRules),
  };
}

export function getPrimaryProductReferenceUrl(
  contextOrMetadata: GenerationReferenceContext | Record<string, unknown> | undefined
): string | undefined {
  if (!contextOrMetadata) return undefined;

  const metadataReferenceUrl =
    "referenceImageUrl" in contextOrMetadata
      ? getString(contextOrMetadata.referenceImageUrl)
      : undefined;
  if (metadataReferenceUrl && isProviderUsableReferenceUrl(metadataReferenceUrl)) {
    return metadataReferenceUrl;
  }

  const context = isGenerationReferenceContext(contextOrMetadata)
    ? contextOrMetadata
    : normalizeGenerationReferenceContext(contextOrMetadata.referenceContext);
  const directImages = Array.isArray((contextOrMetadata as Record<string, unknown>).referenceImages)
    ? normalizeReferenceImages((contextOrMetadata as Record<string, unknown>).referenceImages)
    : [];
  const images = sortReferenceImagesByRole([...(context?.images ?? []), ...directImages]);

  return images.find((image) => image.role === "product" && image.providerUsable)?.url;
}

export function getPrimaryProviderReferenceUrl(
  contextOrMetadata: GenerationReferenceContext | Record<string, unknown> | undefined
): string | undefined {
  return buildProviderReferenceAdapter(contextOrMetadata).primaryImage?.url;
}

export function buildProviderReferenceAdapter(
  contextOrMetadata: GenerationReferenceContext | Record<string, unknown> | undefined
): ProviderReferenceAdapter {
  const images = getAllReferenceImages(contextOrMetadata);
  const providerUsableImages = images.filter(isProviderImageInputEligible);
  const primaryImage = selectPrimaryProviderImage(providerUsableImages);
  const providerImageUrls = new Set(providerUsableImages.map((image) => image.url));
  const promptOnlyImages = images.filter((image) => !providerImageUrls.has(image.url));
  const extraProviderImages = providerUsableImages.filter(
    (image) => !primaryImage || image.url !== primaryImage.url
  );
  const warnings: string[] = [];

  const unusableProductImages = images.filter(
    (image) => image.role === "product" && !isProviderImageInputEligible(image)
  );

  if (providerUsableImages.length === 1 && extraProviderImages.length > 0) {
    warnings.push(
      "Only the primary provider-usable reference is available for image input; remaining references are prompt-only."
    );
  }
  if (unusableProductImages.length > 0) {
    warnings.push("A product reference exists but is not provider-usable, so it remains prompt-only.");
  }
  if (!primaryImage && images.length > 0) {
    warnings.push("No provider-usable product reference is available; all references are prompt-only.");
  }

  return {
    mode: providerUsableImages.length > 1
      ? "multi_image_input"
      : primaryImage
        ? "single_image_input"
        : "prompt_only",
    strategy: providerUsableImages.length > 1
      ? "multi_provider_usable_images"
      : primaryImage
        ? primaryImage.role === "product"
        ? "product_primary_single_image"
        : "role_priority_single_image"
      : "prompt_only",
    primaryImage,
    promptOnlyImages,
    providerUsableImages,
    warnings,
  };
}

function isProviderImageInputEligible(image: GenerationReferenceImage): boolean {
  return image.providerMode !== "prompt_only" &&
    image.providerMode !== "disabled" &&
    image.providerUsable &&
    isProviderUsableReferenceUrl(image.url);
}

export function isProviderUsableReferenceUrl(value: string | undefined): boolean {
  if (!value) return false;
  return isInlineImageUrl(value) || value.startsWith("/api/generated-images/");
}

export function isInlineImageUrl(value: string | undefined): boolean {
  return !!value && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value);
}

function isGenerationReferenceContext(value: unknown): value is GenerationReferenceContext {
  return isRecord(value) && value.source === "canvas-workbench";
}

function normalizeRoleContext(
  value: unknown,
  role: GenerationReferenceRole
): GenerationReferenceRoleContext | undefined {
  if (!isRecord(value)) return undefined;

  const title = getString(value.title) || roleLabels[role];
  return {
    role,
    title,
    sourceNodeIds: getStringArray(value.sourceNodeIds),
    componentIds: getStringArray(value.componentIds),
    assetIds: getStringArray(value.assetIds),
    parameters: isRecord(value.parameters) ? value.parameters : undefined,
    promptFragments: getStringArray(value.promptFragments),
    constraints: getStringArray(value.constraints),
    negativeRules: getStringArray(value.negativeRules),
    qualityRules: getStringArray(value.qualityRules),
  };
}

function normalizeReferenceImages(value: unknown): GenerationReferenceImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): GenerationReferenceImage[] => {
    if (!isRecord(item)) return [];
    const role = normalizeRole(item.role);
    const url = getString(item.url);
    if (!role || !url) return [];
    const providerMode = normalizeProviderMode(item.providerMode);
    const providerUsable = providerMode === "prompt_only" || providerMode === "disabled"
      ? false
      : item.providerUsable !== false && isProviderUsableReferenceUrl(url);

    return [{
      role,
      url,
      title: getString(item.title) || roleLabels[role],
      providerUsable,
      providerMode,
      source: getString(item.source),
      nodeId: getString(item.nodeId),
      assetId: getString(item.assetId),
      componentId: getString(item.componentId),
    }];
  });
}

function getAllReferenceImages(
  contextOrMetadata: GenerationReferenceContext | Record<string, unknown> | undefined
): GenerationReferenceImage[] {
  if (!contextOrMetadata) return [];
  const context = isGenerationReferenceContext(contextOrMetadata)
    ? contextOrMetadata
    : normalizeGenerationReferenceContext(contextOrMetadata.referenceContext);
  const directImages = Array.isArray((contextOrMetadata as Record<string, unknown>).referenceImages)
    ? normalizeReferenceImages((contextOrMetadata as Record<string, unknown>).referenceImages)
    : [];
  const legacyReferenceUrl = getLegacyReferenceImageUrl(contextOrMetadata);
  const legacyImage: GenerationReferenceImage[] = legacyReferenceUrl
    ? [{
        role: "product",
        title: "Product reference",
        url: legacyReferenceUrl,
        providerUsable: isProviderUsableReferenceUrl(legacyReferenceUrl),
        source: "legacy-reference-image-url",
      }]
    : [];

  return sortReferenceImagesByRole(
    dedupeReferenceImages([...(context?.images ?? []), ...directImages, ...legacyImage])
  );
}

function getLegacyReferenceImageUrl(
  value: GenerationReferenceContext | Record<string, unknown>
): string | undefined {
  const metadataReferenceUrl =
    "referenceImageUrl" in value ? getString(value.referenceImageUrl) : undefined;
  if (metadataReferenceUrl) return metadataReferenceUrl;

  const storage: Record<string, unknown> | undefined = isRecord(
    (value as Record<string, unknown>).referenceImageStorage
  )
    ? ((value as Record<string, unknown>).referenceImageStorage as Record<string, unknown>)
    : undefined;
  return getString(storage?.publicUrl);
}

function selectPrimaryProviderImage(
  images: GenerationReferenceImage[]
): GenerationReferenceImage | undefined {
  for (const role of providerReferencePriority) {
    const image = images.find((entry) => entry.role === role);
    if (image) return image;
  }
  return images[0];
}

function sortReferenceImagesByRole(images: GenerationReferenceImage[]): GenerationReferenceImage[] {
  return images
    .map((image, index) => ({ image, index }))
    .sort((left, right) => {
      const roleDelta =
        providerReferencePriority.indexOf(left.image.role) -
        providerReferencePriority.indexOf(right.image.role);
      return roleDelta || left.index - right.index;
    })
    .map((entry) => entry.image);
}

function dedupeReferenceImages(images: GenerationReferenceImage[]): GenerationReferenceImage[] {
  const seen = new Set<string>();
  return images.filter((image) => {
    const key = `${image.role}:${image.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeRole(value: unknown): GenerationReferenceRole | undefined {
  return value === "product" || value === "model" || value === "style" || value === "scene" || value === "copy"
    ? value
    : undefined;
}

function normalizeRoleSet(
  roles: readonly GenerationReferenceRole[] | undefined
): Set<GenerationReferenceRole> | undefined {
  if (!roles) return undefined;
  const normalized = roles.filter((role): role is GenerationReferenceRole =>
    generationReferenceRoles.some((candidate) => candidate === role)
  );
  return normalized.length > 0 ? new Set(normalized) : new Set();
}

function normalizeProviderMode(value: unknown): GenerationReferenceImage["providerMode"] {
  return value === "provider_input" || value === "prompt_only" || value === "disabled"
    ? value
    : undefined;
}

function appendLimitedLines(lines: string[], label: string, values: string[], limit: number): void {
  const normalized = values.map((value) => value.trim()).filter(Boolean).slice(0, limit);
  if (normalized.length > 0) lines.push(`  ${label}: ${normalized.join("; ")}`);
}

function summarizeParameters(value: Record<string, unknown> | undefined): string {
  if (!value) return "";

  return Object.entries(value)
    .flatMap(([key, entry]) => {
      const normalizedKey = key.toLowerCase();
      const isImageParameter =
        normalizedKey.includes("image") ||
        normalizedKey.includes("preview") ||
        normalizedKey.includes("reference") ||
        normalizedKey.includes("url");
      if (!entry && entry !== 0) return [];
      if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
        const text = String(entry).trim();
        if (!text || (isImageParameter && isLongReferenceValue(text))) return [];
        return [`${key}=${truncateParameterValue(text)}`];
      }
      if (Array.isArray(entry)) {
        if (isImageParameter) return [];
        const values = entry
          .filter((item): item is string => typeof item === "string" && !!item.trim())
          .map(truncateParameterValue);
        return values.length ? [`${key}=${values.slice(0, 4).join("/")}`] : [];
      }
      return [];
    })
    .slice(0, 8)
    .join("; ");
}

function isLongReferenceValue(value: string): boolean {
  return value.length > 180 || /^data:image\//i.test(value) || /^https?:\/\//i.test(value);
}

function truncateParameterValue(value: string, limit = 120): string {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && !!item.trim());
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
