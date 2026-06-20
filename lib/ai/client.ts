import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { getConfig, type AppConfig } from "@/lib/store/config-store";
import {
  buildImageProviderDiagnostic,
  extractFirstProviderImage,
  type ImageProviderDiagnostic,
  type ImageProviderMode,
} from "./image-provider-diagnostics";
import { safeLogError } from "@/lib/server/safe-log";

type ModelType = "vision" | "text" | "image";

function resolveConfig(type: ModelType): { apiKey: string; baseURL: string } {
  const c = getConfig();
  const apiKey = c[`${type}ApiKey` as keyof AppConfig] as string || c.apiKey;
  const baseURL = (c[`${type}BaseUrl` as keyof AppConfig] as string) || c.baseUrl || "https://slb.apikey.fun/v1";

  if (!apiKey) throw new Error("API key not configured");
  return { apiKey, baseURL };
}

function getProvider(type: "vision" | "text") {
  const { apiKey, baseURL } = resolveConfig(type);
  return createOpenAI({ apiKey, baseURL });
}

function getApiConfig() {
  const { apiKey, baseURL } = resolveConfig("image");
  return { apiKey, baseURL };
}

/** Safely extract the first JSON object from an AI response */
export function extractJSON(text: string): object {
  // 1. Try parsing the full text directly
  try {
    return JSON.parse(text);
  } catch {
    // no-op
  }

  // 2. Try extracting from ```json ... ``` code fence
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // no-op
    }
  }

  // 3. Fall back to brace counting for the first balanced JSON block
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          start = -1;
        }
      }
    }
  }

  throw new Error("No valid JSON found in AI response");
}

/** Generic error for external exposure — never leaks internal details */
export class AIError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly diagnostics?: ImageProviderDiagnostic
  ) {
    super(message);
    this.name = "AIError";
  }
}

function sanitizeError(e: unknown, fallback: string): never {
  safeLogError("AI call failed", e);
  if (e instanceof AIError) throw e;
  // Never leak raw error messages to callers
  throw new AIError(fallback, "AI_ERROR");
}

interface AnalyzeProductInput {
  imageBase64: string;
  productName?: string;
}

export type ArtifactVisualQaStatus = "pass" | "warn" | "fail" | "pending";
export type ArtifactVisualQaDimension =
  | "product_drift"
  | "model_consistency"
  | "lighting"
  | "copy_safe_area";

export interface ArtifactVisualQaIssue {
  dimension: ArtifactVisualQaDimension;
  status: ArtifactVisualQaStatus;
  label: string;
  summary: string;
  recommendation?: string;
}

export interface ArtifactVisualQaResult {
  status: ArtifactVisualQaStatus;
  label: string;
  issues: ArtifactVisualQaIssue[];
  summary: string;
  source: "vision_model_v1" | "mock_visual_qa_v1";
  reviewedAt: string;
  model?: string;
  confidence?: number;
}

export interface ArtifactVisualQaReferenceImage {
  role?: string;
  title?: string;
  url?: string;
  dataUrl?: string;
  providerUsable?: boolean;
}

interface AnalyzeArtifactVisualQaInput {
  artifact: {
    title: string;
    type?: string;
    status?: string;
    prompt?: string;
    provider?: string;
    model?: string;
    metadata?: Record<string, unknown>;
    imageDataUrl: string;
  };
  providerReferenceImages?: ArtifactVisualQaReferenceImage[];
  promptOnlyReferenceImages?: ArtifactVisualQaReferenceImage[];
}

interface CanvasComponentFactoryInput {
  factoryItem: {
    id?: string;
    title?: string;
    description?: string;
  };
  productAsset?: {
    title?: string;
    description?: string;
  } | null;
  existingNodes?: {
    id?: string;
    label?: string;
    kind?: string;
  }[];
}

export interface GeneratedCanvasComponent {
  title: string;
  caption: string;
  kind?: "asset" | "factory" | "output" | "review";
  status?: "ready" | "running" | "queued" | "review";
  metrics?: string[];
  iconName?: "product" | "model" | "style" | "scene" | "output" | "platform" | "review" | "package" | "ai";
  sourceId?: string;
  edgeLabel?: string;
}

/**
 * 多模态模型分析产品图 → 结构化 JSON
 */
export async function analyzeProduct({ imageBase64, productName }: AnalyzeProductInput) {
  const openai = getProvider("vision");
  const modelName = getConfig().visionModel;

  const { PRODUCT_ANALYSIS_SYSTEM } = await import("./prompts/product-analysis");

  try {
    const result = await generateText({
      model: openai(modelName),
      system: PRODUCT_ANALYSIS_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: productName
                ? `Product name: ${productName}`
                : "Analyze this product image.",
            },
            { type: "image", image: imageBase64 },
          ],
        },
      ],
      temperature: 0.3,
      maxTokens: 500,
    });

    return extractJSON(result.text || "");
  } catch (e) {
    sanitizeError(e, "产品分析失败，请稍后重试");
  }
}

/**
 * 视觉模型审核单张生成图：商品漂移、模特一致性、光影、文案安全区。
 */
export async function analyzeArtifactVisualQa(
  input: AnalyzeArtifactVisualQaInput
): Promise<ArtifactVisualQaResult> {
  const openai = getProvider("vision");
  const modelName = getConfig().visionModel;
  const metadata = input.artifact.metadata ?? {};
  const providerReferences = (input.providerReferenceImages ?? []).slice(0, 6);
  const promptOnlyReferences = (input.promptOnlyReferenceImages ?? []).slice(0, 4);

  const referenceSummary = {
    providerReferences: providerReferences.map(formatVisualQaReference),
    promptOnlyReferences: promptOnlyReferences.map(formatVisualQaReference),
  };

  try {
    const result = await generateText({
      model: openai(modelName),
      system: ARTIFACT_VISUAL_QA_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  artifact: {
                    title: input.artifact.title,
                    type: input.artifact.type,
                    status: input.artifact.status,
                    prompt: input.artifact.prompt,
                    provider: input.artifact.provider,
                    model: input.artifact.model,
                    ratio: readMetadataString(metadata, "ratio"),
                    useCase: readMetadataString(metadata, "useCase"),
                    planItemTitle: readMetadataString(metadata, "planItemTitle"),
                    copyText: readMetadataString(metadata, "copyText"),
                    copyRenderPolicy: metadata.copyRenderPolicy,
                    productReferenceFocus: readMetadataString(metadata, "productReferenceFocus"),
                    itemReferenceRoles: metadata.itemReferenceRoles,
                    itemProviderReferenceRoles: metadata.itemProviderReferenceRoles,
                  },
                  referenceSummary,
                  instruction: "下一张图片是需要审核的最终生成图。之后如果有参考图，它们会按文本标签顺序出现。",
                },
                null,
                2
              ),
            },
            { type: "image", image: input.artifact.imageDataUrl },
            ...providerReferences.flatMap((image, index) => formatVisualQaImageContent(image, index, "provider")),
            ...promptOnlyReferences.flatMap((image, index) => formatVisualQaImageContent(image, index, "prompt_only")),
          ],
        },
      ],
      temperature: 0.1,
      maxTokens: 900,
    });

    return normalizeArtifactVisualQaResult(extractJSON(result.text || ""), {
      source: "vision_model_v1",
      reviewedAt: new Date().toISOString(),
      model: modelName,
    });
  } catch (e) {
    sanitizeError(e, "视觉 QA 失败，请稍后重试");
  }
}

/**
 * 文本模型驱动的对话式图组规划
 */
export async function chatWithPlanner(
  messages: { role: string; text: string }[]
): Promise<{ reply: string; plan?: object }> {
  const openai = getProvider("text");
  const modelName = getConfig().textModel;

  const result = await generateText({
    model: openai(modelName),
    system: PLANNER_SYSTEM,
    messages: messages.map((m) => ({
      role: m.role === "ai" ? "assistant" as const : "user" as const,
      content: m.text,
    })),
    temperature: 0.7,
    maxTokens: 3000,
  });

  const reply = result.text || "";

  // Try to extract image plan from the response
  try {
    const json = extractJSON(reply) as any;
    if (json?.images && Array.isArray(json.images)) {
      return { reply, plan: json };
    }
  } catch {
    // No plan yet, just a normal chat reply
  }

  return { reply };
}

/**
 * 低代码画布组件工厂：把一个组件需求拆成可落到画布上的节点。
 */
export async function generateCanvasComponents(
  input: CanvasComponentFactoryInput
): Promise<GeneratedCanvasComponent[]> {
  const openai = getProvider("text");
  const modelName = getConfig().textModel;

  const result = await generateText({
    model: openai(modelName),
    system: CANVAS_COMPONENT_SYSTEM,
    messages: [
      {
        role: "user",
        content: JSON.stringify(input, null, 2),
      },
    ],
    temperature: 0.25,
    maxTokens: 900,
  });

  const json = extractJSON(result.text || "") as {
    components?: GeneratedCanvasComponent[];
  };

  if (!Array.isArray(json.components)) return [];
  return json.components
    .filter((component) => component && typeof component.title === "string")
    .slice(0, 3);
}

const CANVAS_COMPONENT_SYSTEM = `You create low-code canvas components for a commercial image generation platform.

Return strict JSON only:
{
  "components": [
    {
      "title": "短中文节点标题",
      "caption": "一句中文说明，说明该节点如何用于商业图片生成",
      "kind": "asset|factory|output|review",
      "status": "ready|running|queued|review",
      "metrics": ["最多4个短中文要点"],
      "iconName": "product|model|style|scene|output|platform|review|package|ai",
      "sourceId": "existing node id to connect from",
      "edgeLabel": "2到4个中文字符的连线标签"
    }
  ]
}

Rules:
- Make components practical for e-commerce and marketing image workflows.
- Prefer one or two useful nodes. Use three only when the requested factory item clearly needs a sequence.
- Reuse an existing sourceId from existingNodes when possible.
- Keep visual-language consistency: style, model, scene, platform, review, and output nodes should be compatible with the same product asset.
- Do not include markdown or explanations.`;

const ARTIFACT_VISUAL_QA_SYSTEM = `你是电商商业图的视觉审核 Agent。你只做审核，不生成图片。

请同时看最终生成图和参考图，判断四类风险：
1. product_drift：商品是否漂移，包括形状、比例、材质、Logo、五金、颜色、包装标签。
2. model_consistency：模特是否像同一个人，神态/表情是否自然，是否被模卡锁死。
3. lighting：人物、商品、场景的光源、阴影、透视和接触关系是否一致。
4. copy_safe_area：画面文字是否在安全区，是否误写到商品包装/瓶身标签，是否遮挡主体。

规则：
- 如果没有对应参考图，不要编造“漂移”，而是把问题描述为“需要人工确认”或 pending/warn。
- 商品真实身份优先级最高；广告文案不应改变商品包装原有标签。
- 文案需要烧进图时，要检查位置、安全区、可读性和是否覆盖主体。
- 只返回严格 JSON，不要 Markdown。

JSON schema:
{
  "status": "pass|warn|fail|pending",
  "label": "QA 通过|QA 风险|QA 失败|QA 待查",
  "summary": "一句中文总结",
  "confidence": 0.0,
  "issues": [
    {
      "dimension": "product_drift|model_consistency|lighting|copy_safe_area",
      "status": "pass|warn|fail|pending",
      "label": "商品一致性|模特一致性|空间光影|文案安全区",
      "summary": "具体看到的问题或通过原因",
      "recommendation": "可执行的重做建议"
    }
  ]
}`;

function formatVisualQaReference(image: ArtifactVisualQaReferenceImage): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      role: image.role,
      title: image.title,
      url: image.url,
      providerUsable: image.providerUsable,
      hasImageInput: Boolean(image.dataUrl),
    }).filter(([, value]) => value !== undefined)
  );
}

function formatVisualQaImageContent(
  image: ArtifactVisualQaReferenceImage,
  index: number,
  mode: "provider" | "prompt_only"
) {
  if (!image.dataUrl) return [];
  const role = image.role || "unknown";
  const title = image.title || image.url || `reference ${index + 1}`;
  return [
    {
      type: "text" as const,
      text: `Reference ${index + 1} (${mode}, role=${role}): ${title}`,
    },
    { type: "image" as const, image: image.dataUrl },
  ];
}

function normalizeArtifactVisualQaResult(
  value: object,
  fallback: Pick<ArtifactVisualQaResult, "source" | "reviewedAt" | "model">
): ArtifactVisualQaResult {
  const record = isRecord(value) ? value : {};
  const issues = Array.isArray(record.issues)
    ? record.issues.flatMap((item): ArtifactVisualQaIssue[] => {
        const issue = isRecord(item) ? item : {};
        const dimension = normalizeArtifactVisualQaDimension(issue.dimension);
        const status = normalizeArtifactVisualQaStatus(issue.status);
        const label = readRecordString(issue, "label") || getVisualQaDimensionLabel(dimension);
        const summary = readRecordString(issue, "summary");
        if (!dimension || !status || !summary) return [];
        return [
          {
            dimension,
            status,
            label,
            summary: summary.slice(0, 280),
            recommendation: readRecordString(issue, "recommendation")?.slice(0, 280),
          },
        ];
      })
    : [];
  const status = normalizeArtifactVisualQaStatus(record.status) || summarizeArtifactVisualQaStatus(issues);
  return {
    status,
    label: readRecordString(record, "label") || getVisualQaStatusLabel(status),
    summary: (readRecordString(record, "summary") || getVisualQaStatusLabel(status)).slice(0, 360),
    confidence: typeof record.confidence === "number" && Number.isFinite(record.confidence)
      ? Math.max(0, Math.min(1, record.confidence))
      : undefined,
    issues,
    ...fallback,
  };
}

function summarizeArtifactVisualQaStatus(issues: ArtifactVisualQaIssue[]): ArtifactVisualQaStatus {
  if (issues.some((issue) => issue.status === "fail")) return "fail";
  if (issues.some((issue) => issue.status === "warn")) return "warn";
  if (issues.some((issue) => issue.status === "pending")) return "pending";
  return issues.length > 0 ? "pass" : "pending";
}

function normalizeArtifactVisualQaStatus(value: unknown): ArtifactVisualQaStatus | null {
  return value === "pass" || value === "warn" || value === "fail" || value === "pending" ? value : null;
}

function normalizeArtifactVisualQaDimension(value: unknown): ArtifactVisualQaDimension | null {
  return value === "product_drift" ||
    value === "model_consistency" ||
    value === "lighting" ||
    value === "copy_safe_area"
    ? value
    : null;
}

function getVisualQaStatusLabel(status: ArtifactVisualQaStatus): string {
  if (status === "pass") return "QA 通过";
  if (status === "warn") return "QA 风险";
  if (status === "fail") return "QA 失败";
  return "QA 待查";
}

function getVisualQaDimensionLabel(dimension: ArtifactVisualQaDimension | null): string {
  if (dimension === "product_drift") return "商品一致性";
  if (dimension === "model_consistency") return "模特一致性";
  if (dimension === "lighting") return "空间光影";
  if (dimension === "copy_safe_area") return "文案安全区";
  return "视觉 QA";
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  return readRecordString(metadata, key);
}

function readRecordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const PLANNER_SYSTEM = `You are a marketing visual planning assistant for a professional image generation tool. Your job is to chat with users naturally, understand their needs, and help plan promotional images.

## Context
The first user message contains a product analysis in JSON format (category, features, usage scenario, recommended style, model interaction). Use this information to understand the product and guide the conversation.

## Your Role
1. On first greeting, briefly acknowledge the product you see and ask what kind of images the user wants
2. Chat naturally - don't follow a rigid script or numbered steps
3. Understand what kind of promotional images they want (e.g., e-commerce main images, social media covers, posters, selling point images)
4. Discuss visual style preferences (e.g., minimalist tech, warm lifestyle, vibrant youthful, cinematic, manga/anime style, etc.)
5. Ask about model preferences only if relevant to their request
6. Handle complex requests - users might want multiple sets of images with different styles (e.g., "2 tech-style posters for product + 2 Initial D manga-style posters")

## When User is Ready
When you have enough information and the user confirms readiness (or says "generate", "开始", etc.), output a JSON plan. The plan must contain 3-8 images. Each image has:
- type: "main" (single hero product shot), "selling_point" (feature highlight), or "poster" (promotional/mood/banner)
- title: brief Chinese title
- prompt: detailed English image generation prompt with lighting, composition, mood, product placement. Be specific and vivid
- copyText: short Chinese marketing copy for this image

Output the JSON inside a code block:
\`\`\`json
{
  "images": [
    {
      "type": "main",
      "title": "...",
      "prompt": "...",
      "copyText": "..."
    }
  ]
}
\`\`\`

## Rules
- Always respond in Chinese unless the user speaks English
- Be concise but warm - this is a creative collaboration
- For multiple image sets with different styles, clearly label which style each image uses
- Product descriptions in prompts should be detailed, accurate, and in English
- If user asks for a specific art style (e.g., Initial D manga, Ghibli, cyberpunk), incorporate it into the image prompts with appropriate visual language`;

export const MAX_CONCURRENT_IMAGES = 10;
const DEFAULT_IMAGE_GENERATION_TIMEOUT_MS = 900000;

export interface ImageProviderRequestTrace {
  clientRequestId: string;
  providerRequestId?: string;
  providerHost: string;
  model: string;
  endpoint: "/images/generations" | "/images/edits" | "/responses";
}

export type ImageGenerationSize = "1024x1024" | "1024x1536" | "1536x1024";

interface ImageGenerationOptions {
  clientRequestId?: string;
  referenceImagesBase64?: string[];
  size?: string;
}

const DEFAULT_IMAGE_SIZE: ImageGenerationSize = "1024x1024";
const SUPPORTED_IMAGE_SIZES = new Set<ImageGenerationSize>([
  "1024x1024",
  "1024x1536",
  "1536x1024",
]);

function shouldUseResponsesImageGeneration(modelName: string): boolean {
  const normalized = modelName.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith("dall-e-")) return false;
  return true;
}

/**
 * 生成单张图片。
 *
 * 支持 Responses image_generation 的模型统一走流式链路，
 * 这样纯文生图、单参考图、多参考图都能复用同一套结果解析和长任务传输策略。
 * 旧 DALL-E 系列继续保留 legacy generations/edits 路径。
 */
export async function generateSingleImage(
  prompt: string,
  productImageBase64?: string,
  signal?: AbortSignal,
  options: ImageGenerationOptions = {}
): Promise<{
  image?: { base64?: string; url?: string };
  provider?: ImageProviderRequestTrace;
}> {
  const { apiKey, baseURL } = getApiConfig();
  const modelName = getConfig().imageModel;
  const referenceImagesBase64 = normalizeReferenceImagesBase64(
    options.referenceImagesBase64 ?? (productImageBase64 ? [productImageBase64] : [])
  );
  const primaryReferenceImageBase64 = referenceImagesBase64[0];
  const usesResponsesImageGeneration =
    shouldUseResponsesImageGeneration(modelName) || referenceImagesBase64.length > 1;
  const mode: ImageProviderMode = referenceImagesBase64.length > 0 ? "image_to_image" : "text_to_image";
  const endpoint: ImageProviderRequestTrace["endpoint"] = usesResponsesImageGeneration
    ? "/responses"
    : primaryReferenceImageBase64
      ? "/images/edits"
      : "/images/generations";
  const clientRequestId = options.clientRequestId || `image-master-${crypto.randomUUID()}`;
  const size = normalizeImageGenerationSize(options.size);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getImageGenerationTimeoutMs());
  const combinedSignal = signal
    ? anySignal([signal, controller.signal])
    : controller.signal;

  try {
    let res: Response;

    if (usesResponsesImageGeneration) {
      res = await fetch(`${baseURL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${apiKey}`,
          "X-Client-Request-Id": clientRequestId,
        },
        body: JSON.stringify({
          model: modelName,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: prompt },
                ...referenceImagesBase64.map((image) => ({
                  type: "input_image",
                  image_url: image,
                })),
              ],
            },
          ],
          tools: [{ type: "image_generation", size, quality: "standard" }],
          stream: true,
        }),
        signal: combinedSignal,
      });
    } else if (primaryReferenceImageBase64) {
      // 图生图：使用 /images/edits + multipart
      const base64Data = primaryReferenceImageBase64.replace(/^data:image\/\w+;base64,/, "");
      const imageBuffer = Buffer.from(base64Data, "base64");
      const { body, boundary } = buildMultipart(
        { prompt, model: modelName, n: "1", size },
        [{ name: "image", data: imageBuffer, filename: "product.png", contentType: "image/png" }]
      );

      res = await fetch(`${baseURL}${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "X-Client-Request-Id": clientRequestId,
        },
        body: new Uint8Array(body),
        signal: combinedSignal,
      });
    } else {
      // 纯文本生图
      res = await fetch(`${baseURL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-Client-Request-Id": clientRequestId,
        },
        body: JSON.stringify({ model: modelName, prompt, n: 1, size }),
        signal: combinedSignal,
      });
    }

    clearTimeout(timeoutId);
    const data = endpoint === "/responses" ? await readProviderResponsesPayload(res) : await readProviderJson(res);

    if (!res.ok) {
      const status = res.status;
      throw new AIError(
        status === 429 ? "请求过于频繁，请稍后重试" : "图片生成失败，请稍后重试",
        `IMAGE_GEN_${status}`,
        buildImageProviderDiagnostic({
          code: `IMAGE_GEN_${status}`,
          mode,
          endpoint,
          baseURL,
          model: modelName,
          status,
          ok: false,
          headers: res.headers,
          prompt,
          productImageBase64: primaryReferenceImageBase64,
          payload: data,
          clientRequestId,
        })
      );
    }

    const imageData = extractFirstProviderImage(data);

    if (!imageData?.b64_json && !imageData?.url) {
      throw new AIError(
        "图片生成返回空结果",
        "EMPTY_RESULT",
        buildImageProviderDiagnostic({
          code: "EMPTY_RESULT",
          mode,
          endpoint,
          baseURL,
          model: modelName,
          status: res.status,
          ok: true,
          headers: res.headers,
          prompt,
          productImageBase64: primaryReferenceImageBase64,
          payload: data,
          clientRequestId,
        })
      );
    }

    return {
      image: {
        base64: imageData.b64_json,
        url: imageData.url,
      },
      provider: buildImageProviderRequestTrace({
        baseURL,
        modelName,
        endpoint,
        clientRequestId,
        headers: res.headers,
      }),
    };
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof AIError) throw e;
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new AIError("图片生成超时，请稍后重试", "TIMEOUT");
    }
    const networkError = buildNetworkImageProviderError(e, {
      mode,
      endpoint,
      baseURL,
      modelName,
      prompt,
      productImageBase64,
      referenceImagesBase64,
      clientRequestId,
    });
    if (networkError) throw networkError;
    sanitizeError(e, "图片生成失败，请稍后重试");
  }
}

async function readProviderJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

async function readProviderResponsesPayload(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!contentType.includes("text/event-stream")) {
    try {
      return JSON.parse(text);
    } catch {
      return { rawPreview: text.slice(0, 1200) };
    }
  }

  return {
    responseStream: parseSse(text).map((item) => item.json).filter(Boolean),
    rawPreview: text.slice(0, 1200),
  };
}

function getImageGenerationTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.IMAGE_MASTER_IMAGE_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured >= 30000) {
    return Math.floor(configured);
  }
  return DEFAULT_IMAGE_GENERATION_TIMEOUT_MS;
}

function buildImageProviderRequestTrace({
  baseURL,
  modelName,
  endpoint,
  clientRequestId,
  headers,
}: {
  baseURL: string;
  modelName: string;
  endpoint: ImageProviderRequestTrace["endpoint"];
  clientRequestId: string;
  headers?: Headers;
}): ImageProviderRequestTrace {
  return {
    clientRequestId,
    providerRequestId: getProviderRequestId(headers),
    providerHost: getProviderHost(baseURL),
    model: modelName,
    endpoint,
  };
}

function getProviderRequestId(headers?: Headers): string | undefined {
  return (
    headers?.get("x-request-id") ||
    headers?.get("request-id") ||
    headers?.get("x-ms-request-id") ||
    headers?.get("cf-ray") ||
    undefined
  );
}

function getProviderHost(baseURL: string): string {
  try {
    return new URL(baseURL).host;
  } catch {
    return "unknown-provider";
  }
}

function buildNetworkImageProviderError(
  error: unknown,
  context: {
    mode: ImageProviderMode;
    endpoint: "/images/generations" | "/images/edits" | "/responses";
    baseURL: string;
    modelName: string;
    prompt: string;
    productImageBase64?: string;
    referenceImagesBase64?: string[];
    clientRequestId?: string;
  }
): AIError | undefined {
  const cause = getErrorCause(error);
  const causeCode = typeof cause?.code === "string" ? cause.code : undefined;
  const code =
    causeCode === "UND_ERR_SOCKET"
      ? "PROVIDER_SOCKET_CLOSED"
      : causeCode === "UND_ERR_HEADERS_TIMEOUT"
        ? "PROVIDER_HEADERS_TIMEOUT"
        : error instanceof TypeError && error.message === "fetch failed"
          ? "PROVIDER_NETWORK_ERROR"
          : undefined;
  if (!code) return undefined;

  return new AIError(
    code === "PROVIDER_SOCKET_CLOSED"
      ? "图片生成连接被上游中断，请稍后重试"
      : "图片生成网络连接异常，请稍后重试",
    code,
    buildImageProviderDiagnostic({
      code,
      mode: context.mode,
      endpoint: context.endpoint,
      baseURL: context.baseURL,
      model: context.modelName,
      status: 0,
      ok: false,
      prompt: context.prompt,
      productImageBase64: context.productImageBase64,
      clientRequestId: context.clientRequestId,
      payload: {
        error: {
          type: error instanceof Error ? error.name : typeof error,
          code: causeCode ?? code,
        },
        cause: summarizeErrorCause(cause),
      },
    })
  );
}

function getErrorCause(error: unknown): Record<string, unknown> | undefined {
  if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object" || Array.isArray(cause)) return undefined;
  return cause as Record<string, unknown>;
}

function summarizeErrorCause(cause: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!cause) return undefined;
  const summary: Record<string, unknown> = {};
  for (const key of ["name", "code", "message"]) {
    if (typeof cause[key] === "string") summary[key] = cause[key];
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}

/** 手动构造 multipart/form-data，不依赖 Node 版本 Blob/FormData 兼容性 */
function buildMultipart(
  fields: Record<string, string>,
  files: { name: string; data: Buffer; filename: string; contentType: string }[]
): { body: Buffer; boundary: string } {
  const boundary = `----FormBoundary${crypto.randomUUID()}`;
  const parts: Buffer[] = [];

  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
    ));
  }

  for (const file of files) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`
    ));
    parts.push(file.data);
    parts.push(Buffer.from("\r\n"));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), boundary };
}

export async function generateModelImage(prompt: string) {
  return generateSingleImage(prompt);
}

/**
 * 批量生成图片，限制并发数
 */
export async function generateBatchImages(
  prompts: string[],
  productImageBase64?: string,
  concurrency = MAX_CONCURRENT_IMAGES,
  options: { clientRequestIds?: string[]; referenceImagesBase64?: string[]; imageSizes?: string[]; size?: string } = {}
): Promise<
  {
    image?: { base64?: string; url?: string };
    provider?: ImageProviderRequestTrace;
    error?: { message: string; code: string; diagnostics?: ImageProviderDiagnostic };
  }[]
> {
  const results: {
    image?: { base64?: string; url?: string };
    provider?: ImageProviderRequestTrace;
    error?: { message: string; code: string; diagnostics?: ImageProviderDiagnostic };
  }[] = new Array(prompts.length);
  const referenceImagesBase64 = normalizeReferenceImagesBase64(
    options.referenceImagesBase64 ?? (productImageBase64 ? [productImageBase64] : [])
  );

  for (let i = 0; i < prompts.length; i += concurrency) {
    const chunk = prompts.slice(i, i + concurrency);
    const chunkResults = await Promise.allSettled(
      chunk.map((prompt, chunkIndex) =>
        generateSingleImage(prompt, productImageBase64, undefined, {
          clientRequestId: options.clientRequestIds?.[i + chunkIndex],
          referenceImagesBase64,
          size: options.imageSizes?.[i + chunkIndex] ?? options.size,
        })
      )
    );
    chunkResults.forEach((result, j) => {
      if (result.status === "fulfilled") {
        results[i + j] = result.value;
      } else {
        results[i + j] = {
          image: undefined,
          error: sanitizeBatchImageError(result.reason),
        };
      }
    });
  }

  return results;
}

function normalizeImageGenerationSize(value: string | undefined): ImageGenerationSize {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return SUPPORTED_IMAGE_SIZES.has(trimmed as ImageGenerationSize)
    ? trimmed as ImageGenerationSize
    : DEFAULT_IMAGE_SIZE;
}

function sanitizeBatchImageError(
  error: unknown
): { message: string; code: string; diagnostics?: ImageProviderDiagnostic } {
  if (error instanceof AIError) {
    return {
      message: error.message,
      code: error.code,
      diagnostics: error.diagnostics,
    };
  }

  return {
    message: "图片生成失败，请稍后重试",
    code: "AI_ERROR",
  };
}

function normalizeReferenceImagesBase64(values: string[]): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => /^data:image\/[a-z0-9.+-]+;base64,/i.test(value))
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .slice(0, 6);
}

function parseSse(rawText: string): Array<{ event?: string; json?: unknown }> {
  return rawText.split(/\r?\n\r?\n+/).flatMap((block) => {
    const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const data = block
      .split(/\r?\n/)
      .map((line) => line.trimStart())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!event && !data) return [];
    let json: unknown;
    try {
      json = data && data !== "[DONE]" ? JSON.parse(data) : undefined;
    } catch {
      json = undefined;
    }
    return [{ event, json }];
  });
}

// Polyfill for combining abort signals
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}
