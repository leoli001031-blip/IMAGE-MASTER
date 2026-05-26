import { NextResponse } from "next/server";
import { generateModelImage } from "@/lib/ai/client";
import {
  buildModelAssetMetadata,
  buildModelPrompt,
} from "@/lib/ai/prompts/model-template";
import { buildAutoModelAssetName } from "@/lib/canvas/asset-auto-naming";
import * as modelDB from "@/lib/store/model-db";
import type { AIModel, CreateModelParams } from "@/lib/types";
import { safeLogError } from "@/lib/server/safe-log";

export async function GET() {
  try {
    const models = await modelDB.getAll();
    return NextResponse.json(models);
  } catch {
    return NextResponse.json({ error: "读取模特列表失败" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const params: CreateModelParams = await req.json();

    if (
      !params.gender ||
      !params.ethnicity ||
      !params.age ||
      !params.temperament ||
      !params.bodyType
    ) {
      return NextResponse.json(
        { error: "缺少必要参数" },
        { status: 400 }
      );
    }

    const prompt = buildModelPrompt(params);
    const result = await generateModelImage(prompt);
    const imageUrl = result.image?.base64
      ? `data:image/png;base64,${result.image.base64}`
      : result.image?.url || "";
    const now = new Date().toISOString();

    const metadata = buildModelAssetMetadata(params, { imageUrl, promptSnapshot: prompt });
    const autoName = buildAutoModelAssetName({ params, metadata });
    const model: AIModel = {
      id: `model_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      gender: params.gender,
      ethnicity: params.ethnicity,
      age: params.age,
      temperament: params.temperament,
      bodyType: params.bodyType,
      hairStyle: params.hairStyle,
      makeup: params.makeup,
      imageUrl,
      promptSnapshot: prompt,
      metadata: {
        ...metadata,
        autoName,
      },
      createdAt: now,
      updatedAt: now,
    };

    await modelDB.add(model);

    return NextResponse.json(model);
  } catch (e) {
    safeLogError("Model creation failed", e);
    return NextResponse.json(
      { error: "模特创建失败，请稍后重试" },
      { status: 500 }
    );
  }
}
