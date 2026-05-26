import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { generateModelImage } from "@/lib/ai/client";
import {
  buildModelAssetMetadata,
  buildModelPrompt,
} from "@/lib/ai/prompts/model-template";
import { buildAutoModelAssetName } from "@/lib/canvas/asset-auto-naming";
import * as modelDB from "@/lib/store/model-db";
import type { CreateModelParams } from "@/lib/types";
import { safeLogError } from "@/lib/server/safe-log";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "缺少模特 ID" }, { status: 400 });
    }

    const deleted = await modelDB.remove(id);
    if (!deleted) {
      return NextResponse.json({ error: "模特不存在" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "删除模特失败" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "缺少模特 ID" }, { status: 400 });
    }

    const existing = await modelDB.getById(id);
    if (!existing) {
      return NextResponse.json({ error: "模特不存在" }, { status: 404 });
    }

    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "请求参数无效" }, { status: 400 });
    }

    const updates = body as Record<string, unknown>;
    const title = typeof updates.title === "string" ? updates.title.trim() : "";
    const hasFavorite = typeof updates.favorite === "boolean";
    if (updates.title !== undefined && !title) {
      return NextResponse.json({ error: "模特名称不能为空" }, { status: 400 });
    }

    const metadata = {
      ...(existing.metadata ?? {}),
      ...(title
        ? {
            autoName: {
              ...((existing.metadata?.autoName && typeof existing.metadata.autoName === "object")
                ? existing.metadata.autoName
                : {}),
              title,
            },
          }
        : {}),
      ...(hasFavorite ? { favorite: updates.favorite } : {}),
    };

    const updated = await modelDB.update(id, {
      metadata: metadata as NonNullable<typeof existing.metadata>,
    });
    return NextResponse.json(updated);
  } catch (e) {
    safeLogError("Model update failed", e);
    return NextResponse.json(
      { error: "模特资产更新失败，请稍后重试" },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "缺少模特 ID" }, { status: 400 });
    }

    const existing = await modelDB.getById(id);
    if (!existing) {
      return NextResponse.json({ error: "模特不存在" }, { status: 404 });
    }

    const body: Partial<CreateModelParams> = await req.json();

    // Fall back to existing values for any missing fields
    const updateParams: CreateModelParams = {
      gender: body.gender || existing.gender,
      ethnicity: body.ethnicity || existing.ethnicity,
      age: body.age || existing.age,
      temperament: body.temperament || existing.temperament,
      bodyType: body.bodyType || existing.bodyType,
      hairStyle: body.hairStyle || existing.metadata?.sourceParams?.hairStyle || existing.hairStyle,
      makeup: body.makeup || existing.metadata?.sourceParams?.makeup || existing.makeup,
    };

    const prompt = buildModelPrompt(updateParams);
    const result = await generateModelImage(prompt);
    const imageUrl = result.image?.base64
      ? `data:image/png;base64,${result.image.base64}`
      : result.image?.url || existing.imageUrl;

    const metadata = buildModelAssetMetadata(updateParams, { imageUrl, promptSnapshot: prompt });
    const updated = await modelDB.update(id, {
      gender: updateParams.gender,
      ethnicity: updateParams.ethnicity,
      age: updateParams.age,
      temperament: updateParams.temperament,
      bodyType: updateParams.bodyType,
      hairStyle: updateParams.hairStyle,
      makeup: updateParams.makeup,
      imageUrl,
      promptSnapshot: prompt,
      metadata: {
        ...metadata,
        autoName: buildAutoModelAssetName({ params: updateParams, metadata }),
      },
    });

    return NextResponse.json(updated);
  } catch (e) {
    safeLogError("Model regeneration failed", e);
    return NextResponse.json(
      { error: "重新生成失败，请稍后重试" },
      { status: 500 }
    );
  }
}
