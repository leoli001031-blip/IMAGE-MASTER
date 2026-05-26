import type {
  ComponentPort,
  ComponentSource,
  ComponentTemplateMetadata,
  ComponentType,
  StandardComponentType,
} from "@/lib/types";

export const STANDARD_COMPONENT_TYPES: readonly StandardComponentType[] = [
  "product_asset",
  "model_asset",
  "visual_style",
  "scene",
  "platform_rule",
  "quality_rule",
  "output_pack",
  "brand_kit",
  "prompt_source",
  "image_recipe",
] as const;

export const LEGACY_COMPONENT_TYPE_ALIASES = {
  product: "product_asset",
  model: "model_asset",
  style: "visual_style",
  prompt: "prompt_source",
} as const satisfies Record<string, StandardComponentType>;

export const COMPONENT_TYPE_LABELS: Record<StandardComponentType, string> = {
  product_asset: "Product Asset",
  model_asset: "Model Asset",
  visual_style: "Visual Style",
  scene: "Scene",
  platform_rule: "Platform Rule",
  quality_rule: "Quality Rule",
  output_pack: "Output Pack",
  brand_kit: "Brand Kit",
  prompt_source: "Prompt Source",
  image_recipe: "Image Recipe",
};

const STANDARD_COMPONENT_TYPE_SET = new Set<string>(STANDARD_COMPONENT_TYPES);

export function normalizeComponentType(value: unknown): StandardComponentType | undefined {
  if (typeof value !== "string") return undefined;
  if (STANDARD_COMPONENT_TYPE_SET.has(value)) return value as StandardComponentType;
  return LEGACY_COMPONENT_TYPE_ALIASES[value as keyof typeof LEGACY_COMPONENT_TYPE_ALIASES];
}

export function isComponentType(value: unknown): value is ComponentType {
  return normalizeComponentType(value) !== undefined;
}

export function getComponentTypeLabel(type: ComponentType): string {
  const normalized = normalizeComponentType(type);
  return normalized ? COMPONENT_TYPE_LABELS[normalized] : String(type);
}

export function componentTypeQueryValues(type: ComponentType): ComponentType[] {
  const normalized = normalizeComponentType(type);
  if (!normalized) return [type];

  const legacyAliases = Object.entries(LEGACY_COMPONENT_TYPE_ALIASES)
    .filter(([, canonical]) => canonical === normalized)
    .map(([legacy]) => legacy as ComponentType);

  return [normalized, ...legacyAliases];
}

export function normalizeComponentRules(
  rules: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!rules) return {};
  return {
    constraints: toStringArray(rules.constraints),
    negativeRules: toStringArray(rules.negativeRules),
    qualityRules: toStringArray(rules.qualityRules),
    ...rules,
  };
}

export function normalizeComponentMetadata(
  type: ComponentType,
  metadata: Record<string, unknown> | undefined
): ComponentTemplateMetadata {
  const componentType = normalizeComponentType(type) ?? "image_recipe";
  const base = defaultComponentMetadata(componentType);
  const input = metadata ?? {};

  return {
    ...base,
    ...input,
    schemaVersion: toPositiveInteger(input.schemaVersion, base.schemaVersion),
    componentType,
    label: toNonEmptyString(input.label, base.label),
    inputs: normalizePorts(input.inputs, base.inputs),
    outputs: normalizePorts(input.outputs, base.outputs),
    parameters: toRecord(input.parameters, base.parameters),
    constraints: toStringArray(input.constraints, base.constraints),
    promptFragments: toStringArray(input.promptFragments, base.promptFragments),
    negativeRules: toStringArray(input.negativeRules, base.negativeRules),
    qualityRules: toStringArray(input.qualityRules, base.qualityRules),
    compatibleWith: toStringArray(input.compatibleWith, base.compatibleWith),
    source: normalizeSource(input.source, base.source),
  };
}

export function defaultComponentMetadata(type: StandardComponentType): ComponentTemplateMetadata {
  const label = COMPONENT_TYPE_LABELS[type];
  const common = {
    schemaVersion: 1,
    componentType: type,
    label,
    inputs: [] as ComponentPort[],
    outputs: [{ id: "component", label, type }],
    parameters: {},
    constraints: [] as string[],
    promptFragments: [] as string[],
    negativeRules: [] as string[],
    qualityRules: [] as string[],
    compatibleWith: [] as string[],
    source: { kind: "manual" } as ComponentSource,
  };

  switch (type) {
    case "product_asset":
      return {
        ...common,
        outputs: [{ id: "product", label: "Product", type: "product_asset" }],
        parameters: {
          category: "",
          images: [],
          invariants: [],
          sellingPoints: [],
          forbiddenChanges: [],
        },
        qualityRules: ["Preserve product structure, color, material, and logo regions."],
      };
    case "model_asset":
      return {
        ...common,
        outputs: [{ id: "model", label: "Model", type: "model_asset" }],
        parameters: {
          referenceImages: [],
          identityAnchors: [],
          stylingNotes: [],
          suitableScenes: [],
          forbiddenUses: [],
          consistencyRules: [],
        },
      };
    case "visual_style":
      return {
        ...common,
        inputs: [{ id: "subject", label: "Subject", type: "product_asset" }],
        outputs: [{ id: "style", label: "Style", type: "visual_style" }],
        parameters: {
          colorPalette: [],
          lighting: "",
          composition: "",
          materialLanguage: "",
          backgroundLanguage: "",
          typography: "",
        },
      };
    case "scene":
      return {
        ...common,
        inputs: [{ id: "subject", label: "Subject", type: "product_asset" }],
        outputs: [{ id: "scene", label: "Scene", type: "scene" }],
        parameters: {
          environment: "",
          props: [],
          lighting: "",
          depth: "",
          cameraAngle: "",
          placementRules: [],
        },
      };
    case "platform_rule":
      return {
        ...common,
        inputs: [{ id: "recipe", label: "Recipe", type: "image_recipe" }],
        outputs: [{ id: "platform", label: "Platform Rules", type: "platform_rule" }],
        parameters: {
          platform: "",
          aspectRatios: [],
          safeAreas: [],
          textAllowance: "",
          backgroundRestrictions: [],
          exportNaming: "",
          formats: [],
        },
      };
    case "quality_rule":
      return {
        ...common,
        inputs: [{ id: "artifact", label: "Generated Asset", type: "generated_artifact" }],
        outputs: [{ id: "review", label: "Quality Review", type: "quality_rule" }],
        parameters: {
          checks: [],
          thresholds: {},
          scoreWeights: {},
          blockingIssues: [],
        },
      };
    case "output_pack":
      return {
        ...common,
        inputs: [{ id: "artifacts", label: "Generated Assets", type: "generated_artifact[]" }],
        outputs: [{ id: "pack", label: "Output Pack", type: "output_pack" }],
        parameters: {
          channels: [],
          deliverables: [],
          fileNaming: "",
          includeManifest: true,
          includeQaReport: true,
        },
      };
    case "brand_kit":
      return {
        ...common,
        outputs: [{ id: "brand", label: "Brand Kit", type: "brand_kit" }],
        parameters: {
          logos: [],
          colorPalettes: [],
          fonts: [],
          toneOfVoice: "",
          dos: [],
          donts: [],
          templateLocks: [],
          complianceRules: [],
        },
      };
    case "prompt_source":
      return {
        ...common,
        outputs: [{ id: "prompt", label: "Prompt Source", type: "prompt_source" }],
        parameters: {
          rawPrompt: "",
          extractedStyleRules: [],
          extractedSceneRules: [],
          extractedCameraRules: [],
          extractedNegativeRules: [],
          compatibleRecipes: [],
          riskNotes: [],
        },
        source: { kind: "ai_import" },
      };
    case "image_recipe":
      return {
        ...common,
        inputs: [
          { id: "product", label: "Product", type: "product_asset", required: true },
          { id: "style", label: "Style", type: "visual_style" },
          { id: "scene", label: "Scene", type: "scene" },
        ],
        outputs: [{ id: "image", label: "Image Brief", type: "image_recipe" }],
        parameters: {
          purpose: "",
          shotList: [],
          compositionRules: [],
          copyRequirements: [],
          outputCount: 1,
        },
      };
  }
}

function normalizePorts(value: unknown, fallback: ComponentPort[]): ComponentPort[] {
  if (!Array.isArray(value)) return fallback;
  const ports = value
    .map((port, index) => {
      if (!port || typeof port !== "object" || Array.isArray(port)) return undefined;
      const record = port as Record<string, unknown>;
      const id = toNonEmptyString(record.id, `port_${index + 1}`);
      const type = toNonEmptyString(record.type, "unknown");
      const label = toNonEmptyString(record.label, id);
      return {
        ...record,
        id,
        label,
        type,
        required: typeof record.required === "boolean" ? record.required : undefined,
      } as ComponentPort;
    })
    .filter((port): port is ComponentPort => Boolean(port));

  return ports.length > 0 ? ports : fallback;
}

function normalizeSource(value: unknown, fallback: ComponentSource): ComponentSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  const kind = toNonEmptyString(record.kind, fallback.kind) as ComponentSource["kind"];
  return {
    ...record,
    kind,
    referenceId:
      typeof record.referenceId === "string" && record.referenceId.trim()
        ? record.referenceId.trim()
        : undefined,
    rawText:
      typeof record.rawText === "string" && record.rawText.trim()
        ? record.rawText.trim()
        : undefined,
  };
}

function toRecord(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fallback;
}

function toStringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function toPositiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : fallback;
}

function toNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
