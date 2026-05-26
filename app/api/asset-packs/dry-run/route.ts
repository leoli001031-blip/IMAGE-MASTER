import { NextResponse } from "next/server";
import { buildAssetPackDraft } from "@/lib/canvas/asset-pack-builder";
import type { AssetPackDryRunResponse, AssetPackSourceImage } from "@/lib/canvas/asset-pack-types";
import { normalizeAssetPackCategory } from "@/lib/canvas/asset-pack-types";
import { safeLogError } from "@/lib/server/safe-log";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "请求参数无效" }, { status: 400 });
    }

    const validation = validateDryRunBody(body as Record<string, unknown>);
    if (typeof validation === "string") {
      return NextResponse.json({ error: validation }, { status: 400 });
    }

    const assetPack = buildAssetPackDraft(validation);
    const response: AssetPackDryRunResponse = {
      dryRun: true,
      providerCalls: 0,
      assetPack,
    };

    return NextResponse.json(response);
  } catch (error) {
    safeLogError("Asset pack dry-run failed", error);
    return NextResponse.json({ error: "资产包草案生成失败" }, { status: 500 });
  }
}

function validateDryRunBody(body: Record<string, unknown>) {
  const category = normalizeAssetPackCategory(body.category);
  if (!category) return "资产包 category 无效";
  if (typeof body.userRequest !== "string" || !body.userRequest.trim()) {
    return "userRequest 不能为空";
  }

  const sourceImagesValue = body.sourceImages ?? body.images;
  if (sourceImagesValue !== undefined && !Array.isArray(sourceImagesValue)) {
    return "sourceImages 必须是数组";
  }

  return {
    category,
    userRequest: body.userRequest,
    sourceImages: normalizeSourceImages(sourceImagesValue),
  };
}

function normalizeSourceImages(value: unknown): AssetPackSourceImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): AssetPackSourceImage[] => {
    if (typeof item === "string") return item.trim() ? [item] : [];
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];

    const record = item as Record<string, unknown>;
    if (typeof record.url !== "string" || !record.url.trim()) return [];
    return [{
      url: record.url,
      title: typeof record.title === "string" ? record.title : undefined,
      role:
        record.role === "product" || record.role === "model" || record.role === "scene" || record.role === "style"
          ? record.role
          : undefined,
      source: typeof record.source === "string" ? record.source : undefined,
    }];
  });
}
