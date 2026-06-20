import { NextResponse, type NextRequest } from "next/server";
import {
  analyzeArtifactVisualQa,
  type ArtifactVisualQaReferenceImage,
  type ArtifactVisualQaResult,
} from "@/lib/ai/client";
import * as artifactDB from "@/lib/store/artifact-db";
import { readOutputImageAsDataUrl } from "@/lib/store/output-file-store";
import { sanitizePayloadForJson } from "@/lib/store/metadata-image-sanitizer";
import { safeLogError } from "@/lib/server/safe-log";

type VisualQaMode = "vision" | "mock";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readReferenceImages(value: unknown): ArtifactVisualQaReferenceImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ArtifactVisualQaReferenceImage[] => {
    if (!isRecord(item)) return [];
    const url = getString(item.url);
    if (!url) return [];
    return [
      {
        role: getString(item.role),
        title: getString(item.title),
        url,
        providerUsable: getBoolean(item.providerUsable),
      },
    ];
  });
}

async function attachDataUrls(images: ArtifactVisualQaReferenceImage[], limit: number) {
  const withData: ArtifactVisualQaReferenceImage[] = [];
  for (const image of images.slice(0, limit)) {
    const dataUrl = image.url?.startsWith("data:image/")
      ? image.url
      : image.url
        ? await readOutputImageAsDataUrl(image.url)
        : undefined;
    withData.push({ ...image, dataUrl });
  }
  return withData;
}

function getProviderReferenceImages(metadata: Record<string, unknown>): ArtifactVisualQaReferenceImage[] {
  const adapter = isRecord(metadata.providerReferenceAdapter) ? metadata.providerReferenceAdapter : {};
  const adapterImages = readReferenceImages(adapter.providerUsableImages);
  if (adapterImages.length > 0) return adapterImages;

  const referenceContext = isRecord(metadata.referenceContext) ? metadata.referenceContext : {};
  const contextImages = readReferenceImages(referenceContext.images);
  const directImages = readReferenceImages(metadata.referenceImages);
  return [...contextImages, ...directImages].filter((image) =>
    image.providerUsable || image.providerUsable === undefined
  );
}

function getPromptOnlyReferenceImages(metadata: Record<string, unknown>): ArtifactVisualQaReferenceImage[] {
  const adapter = isRecord(metadata.providerReferenceAdapter) ? metadata.providerReferenceAdapter : {};
  const promptOnlyImages = [
    ...readReferenceImages(adapter.promptOnlyImages),
    ...readReferenceImages(metadata.promptOnlyReferenceImages),
  ];
  if (promptOnlyImages.length > 0) return promptOnlyImages;

  return readReferenceImages(metadata.referenceImages).filter((image) => image.providerUsable === false);
}

function buildMockVisualQa(metadata: Record<string, unknown>): ArtifactVisualQaResult {
  const hasProduct = getProviderReferenceImages(metadata).some((image) => image.role === "product");
  const burnIn = isRecord(metadata.copyRenderPolicy) && metadata.copyRenderPolicy.mode === "burn_in";
  const issues: ArtifactVisualQaResult["issues"] = [
    {
      dimension: "product_drift",
      status: hasProduct ? "pass" : "warn",
      label: "商品一致性",
      summary: hasProduct ? "检测到商品参考图，商品身份进入人工复核队列。" : "没有检测到商品参考图，需要人工确认商品是否漂移。",
      recommendation: hasProduct ? "点开大图核对商品形状、材质和 Logo。" : "补商品参考图后只重做相关商品图。",
    },
    {
      dimension: "copy_safe_area",
      status: burnIn ? "warn" : "pass",
      label: "文案安全区",
      summary: burnIn ? "本图包含烧字策略，需要确认文案没有压主体或写到商品包装标签上。" : "本图没有强烧字策略。",
      recommendation: burnIn ? "如果文案压主体，点图说“这张文案短一点，放到画面安全区”。" : "无需优先处理。",
    },
  ];
  const status = issues.some((issue) => issue.status === "warn") ? "warn" : "pass";
  return {
    status,
    label: status === "warn" ? "QA 风险" : "QA 通过",
    summary: status === "warn" ? "Mock 视觉 QA 标记了需要人工复核的风险。" : "Mock 视觉 QA 未发现明显风险。",
    issues,
    source: "mock_visual_qa_v1",
    reviewedAt: new Date().toISOString(),
    model: "mock",
    confidence: 0.5,
  };
}

function resolveVisualQaMode(req: NextRequest, body: Record<string, unknown>): VisualQaMode {
  if (body.mock === true) return "mock";
  if (new URL(req.url).searchParams.get("mock") === "1") return "mock";
  if (process.env.IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER === "1") return "mock";
  return "vision";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少产物 ID" }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const requestBody = isRecord(body) ? body : {};
    const artifact = await artifactDB.get(id);
    if (!artifact) {
      return NextResponse.json({ error: "产物不存在" }, { status: 404 });
    }
    if (!artifact.url) {
      return NextResponse.json({ error: "产物没有可审核图片" }, { status: 400 });
    }

    const mode = resolveVisualQaMode(req, requestBody);
    const metadata = artifact.metadata ?? {};
    const resultImage = artifact.url.startsWith("data:image/")
      ? artifact.url
      : await readOutputImageAsDataUrl(artifact.url);
    if (!resultImage && mode !== "mock") {
      return NextResponse.json({ error: "只能审核本地生成图片，请先打开详情确认图片可访问" }, { status: 400 });
    }

    const visualQa = mode === "mock"
      ? buildMockVisualQa(metadata)
      : await analyzeArtifactVisualQa({
          artifact: {
            title: artifact.title,
            type: artifact.type,
            status: artifact.status,
            prompt: artifact.prompt || getString(metadata.prompt) || getString(metadata.finalPrompt),
            provider: artifact.provider,
            model: artifact.model,
            metadata,
            imageDataUrl: resultImage!,
          },
          providerReferenceImages: await attachDataUrls(getProviderReferenceImages(metadata), 6),
          promptOnlyReferenceImages: await attachDataUrls(getPromptOnlyReferenceImages(metadata), 4),
        });

    const updated = await artifactDB.update(id, {
      metadata: {
        ...metadata,
        visualQa,
      },
    });
    if (!updated) {
      return NextResponse.json({ error: "产物不存在" }, { status: 404 });
    }

    return NextResponse.json(sanitizePayloadForJson({ artifact: updated, visualQa }));
  } catch (error) {
    safeLogError("Artifact visual QA failed", error);
    return NextResponse.json({ error: "视觉 QA 失败，请稍后重试" }, { status: 500 });
  }
}
