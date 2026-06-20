import {
  buildStructuredCopyBrief,
  normalizeStructuredCopyBrief,
  type StructuredCopyBrief,
} from "@/lib/canvas/copy-brief";

export type CopyRenderMode = "layout_layer" | "burn_in" | "metadata_only";

export interface CopyRenderPolicy {
  schemaVersion: 1;
  mode: CopyRenderMode;
  requestedMode?: CopyRenderMode;
  allowBurnIn: boolean;
  requiresExplicitApproval: boolean;
  reason: string;
  inImageText: string[];
  sellingPoints: string[];
  exportCopy: string[];
  forbiddenClaims: string[];
  promptFragments: string[];
  constraints: string[];
  negativeRules: string[];
  qualityRules: string[];
}

export interface BuildCopyRenderPolicyInput {
  sourceText?: string;
  copyBrief?: unknown;
  textAllowed?: boolean;
  request?: string;
  outputType?: string;
  explicitMode?: unknown;
}

const burnInTerms = [
  "烧进",
  "带字",
  "带文案",
  "短文案",
  "文案进图",
  "直接出字",
  "直接生成文字",
  "把字放进图",
  "图中文字",
  "画面文字",
  "封面标题",
  "海报标题",
  "短标题",
  "in-image",
  "burn in",
  "burn-in",
  "render text",
];

export function buildCopyRenderPolicy(input: BuildCopyRenderPolicyInput): CopyRenderPolicy {
  const copyBrief = normalizeStructuredCopyBrief(input.copyBrief)
    ?? (input.sourceText ? buildStructuredCopyBrief(input.sourceText) : undefined);
  const requestedMode = normalizeCopyRenderMode(input.explicitMode)
    ?? inferRequestedMode(input.request);
  const hasCopy = Boolean(
    copyBrief &&
      (
        copyBrief.inImageText.length > 0 ||
        copyBrief.sellingPoints.length > 0 ||
        copyBrief.exportCopy.length > 0 ||
        copyBrief.forbiddenClaims.length > 0
      )
  );
  const allowBurnIn = input.textAllowed !== false && Boolean(copyBrief?.inImageText.length);
  const mode: CopyRenderMode = !hasCopy
    ? "metadata_only"
    : requestedMode === "burn_in" && allowBurnIn
      ? "burn_in"
      : "layout_layer";
  const reason = buildReason({
    mode,
    requestedMode,
    allowBurnIn,
    hasCopy,
    textAllowed: input.textAllowed,
    outputType: input.outputType,
  });

  if (!copyBrief) {
    return {
      schemaVersion: 1,
      mode,
      requestedMode,
      allowBurnIn,
      requiresExplicitApproval: false,
      reason,
      inImageText: [],
      sellingPoints: [],
      exportCopy: [],
      forbiddenClaims: [],
      promptFragments: [],
      constraints: [],
      negativeRules: [],
      qualityRules: [],
    };
  }

  return {
    schemaVersion: 1,
    mode,
    requestedMode,
    allowBurnIn,
    requiresExplicitApproval: mode === "burn_in",
    reason,
    inImageText: copyBrief.inImageText,
    sellingPoints: copyBrief.sellingPoints,
    exportCopy: copyBrief.exportCopy,
    forbiddenClaims: copyBrief.forbiddenClaims,
    promptFragments: buildPolicyPromptFragments(copyBrief, mode),
    constraints: buildPolicyConstraints(copyBrief, mode),
    negativeRules: buildPolicyNegativeRules(copyBrief, mode),
    qualityRules: buildPolicyQualityRules(mode),
  };
}

export function normalizeCopyRenderPolicy(value: unknown): CopyRenderPolicy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const mode = normalizeCopyRenderMode(record.mode);
  if (!mode) return undefined;
  const policy: CopyRenderPolicy = {
    schemaVersion: 1,
    mode,
    requestedMode: normalizeCopyRenderMode(record.requestedMode),
    allowBurnIn: record.allowBurnIn === true,
    requiresExplicitApproval: record.requiresExplicitApproval === true,
    reason: getString(record.reason),
    inImageText: getStringArray(record.inImageText),
    sellingPoints: getStringArray(record.sellingPoints),
    exportCopy: getStringArray(record.exportCopy),
    forbiddenClaims: getStringArray(record.forbiddenClaims),
    promptFragments: getStringArray(record.promptFragments),
    constraints: getStringArray(record.constraints),
    negativeRules: getStringArray(record.negativeRules),
    qualityRules: getStringArray(record.qualityRules),
  };
  return policy;
}

export function normalizeCopyRenderMode(value: unknown): CopyRenderMode | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "layout_layer" || normalized === "layout" || normalized === "copy_layer") {
    return "layout_layer";
  }
  if (normalized === "burn_in" || normalized === "in_image" || normalized === "visible_text") {
    return "burn_in";
  }
  if (normalized === "metadata_only" || normalized === "metadata") return "metadata_only";
  return undefined;
}

export function inferCopyRenderModeFromText(request: string | undefined): CopyRenderMode | undefined {
  return inferRequestedMode(request);
}

function inferRequestedMode(request: string | undefined): CopyRenderMode | undefined {
  const text = (request ?? "").toLowerCase();
  if (!text) return undefined;
  if (
    /(?:文案|文字).{0,8}(?:不|别|不要|无需|不需要).{0,8}(?:进图|入图|烧字|烧进|写进|渲染|出字|放进图)|(?:不|别|不要|无需|不需要).{0,8}(?:文案|文字|烧字|烧进|直接出字|直接生成文字|把字放进图|把文案放进图|把文字放进图|出字|进图)/.test(text)
  ) {
    return "layout_layer";
  }
  if (burnInTerms.some((term) => text.includes(term.toLowerCase()))) return "burn_in";
  return undefined;
}

function buildReason({
  mode,
  requestedMode,
  allowBurnIn,
  hasCopy,
  textAllowed,
  outputType,
}: {
  mode: CopyRenderMode;
  requestedMode?: CopyRenderMode;
  allowBurnIn: boolean;
  hasCopy: boolean;
  textAllowed?: boolean;
  outputType?: string;
}): string {
  if (!hasCopy) return "No structured copy was supplied.";
  if (mode === "burn_in") return "User explicitly requested visible image text and this output allows short copy.";
  if (requestedMode === "burn_in" && textAllowed === false) {
    return "Visible text was requested, but the selected slot forbids text; keep copy editable outside the image.";
  }
  if (requestedMode === "burn_in" && !allowBurnIn) {
    return "Visible text was requested, but no short in-image text candidate is available.";
  }
  if (outputType?.includes("amazon")) {
    return "Marketplace-safe output keeps copy as editable metadata unless a text-allowed slot is selected.";
  }
  return "Default commerce workflow keeps copy as editable layout metadata; burn-in is opt-in.";
}

function buildPolicyPromptFragments(copyBrief: StructuredCopyBrief, mode: CopyRenderMode): string[] {
  const fragments: string[] = [];
  if (copyBrief.sellingPoints.length > 0) {
    fragments.push(`Grounded selling points for visual planning: ${copyBrief.sellingPoints.slice(0, 8).join(" | ")}`);
  }
  if (mode === "burn_in" && copyBrief.inImageText.length > 0) {
    fragments.push(`Render these short visible text elements in the image: ${copyBrief.inImageText.slice(0, 4).join(" | ")}`);
  }
  if (mode !== "burn_in" && copyBrief.inImageText.length > 0) {
    fragments.push(`Editable layout text candidates, not bitmap text: ${copyBrief.inImageText.slice(0, 4).join(" | ")}`);
  }
  if (copyBrief.exportCopy.length > 0) {
    fragments.push(`Export-only copy notes: ${copyBrief.exportCopy.slice(0, 6).join(" | ")}`);
  }
  return fragments;
}

function buildPolicyConstraints(copyBrief: StructuredCopyBrief, mode: CopyRenderMode): string[] {
  const constraints = [
    "Keep visible image text, selling points, export copy, and forbidden claims as separate structured fields.",
  ];
  if (mode === "burn_in") {
    constraints.push("Render only the short approved in-image text; keep all longer export copy outside the bitmap.");
    constraints.push("Place visible text in a clean copy-safe area and keep it readable at thumbnail size.");
  } else {
    constraints.push("Do not render supplied copy as bitmap text; leave clean copy-safe areas for later layout.");
  }
  if (copyBrief.sellingPoints.length > 0) {
    constraints.push("Use selling points to guide visual proof, not to invent unsupported claims.");
  }
  return constraints;
}

function buildPolicyNegativeRules(copyBrief: StructuredCopyBrief, mode: CopyRenderMode): string[] {
  return [
    ...copyBrief.forbiddenClaims.map((claim) => `Forbidden copy claim: ${claim}`),
    "Do not invent unsupported certifications, discounts, superlatives, platform badges, celebrity endorsements, or medical claims.",
    mode === "burn_in"
      ? "Do not render long paragraphs, tiny unreadable copy, fake UI, fake watermarks, or platform marks."
      : "Do not place any readable marketing copy directly inside the generated image.",
  ];
}

function buildPolicyQualityRules(mode: CopyRenderMode): string[] {
  if (mode === "burn_in") {
    return [
      "Visible text must be short, legible, correctly spelled, and placed in a clean copy-safe zone.",
      "Burned-in text must not cover product-critical details, faces, hands, logos, or material evidence.",
    ];
  }
  return [
    "Copy stays editable as layout metadata by default.",
    "Image composition should reserve clean space for later copy placement when the output format needs text.",
  ];
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && !!item.trim());
}
