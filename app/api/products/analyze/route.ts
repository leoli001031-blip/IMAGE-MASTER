import { NextResponse } from "next/server";
import { analyzeProduct } from "@/lib/ai/client";
import { safeLogError } from "@/lib/server/safe-log";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB base64 ~= 7.5MB raw

export async function POST(req: Request) {
  try {
    const { imageBase64 } = await req.json();

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json({ error: "缺少产品图片" }, { status: 400 });
    }

    // Size check: base64 is ~1.33x raw size
    if (imageBase64.length > MAX_IMAGE_SIZE) {
      return NextResponse.json(
        { error: "图片过大，请上传小于 7MB 的图片" },
        { status: 400 }
      );
    }

    const analysis = await analyzeProduct({ imageBase64 });

    return NextResponse.json(analysis);
  } catch (e) {
    safeLogError("Product analysis failed", e);
    return NextResponse.json(
      { error: "产品分析失败，请稍后重试" },
      { status: 500 }
    );
  }
}
