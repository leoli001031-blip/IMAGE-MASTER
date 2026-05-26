import { NextResponse } from "next/server";
import {
  getProductDuplicateKeys,
  normalizeProductRows,
  parseProductImportText,
  productsToComponentParams,
} from "@/lib/canvas/product-importer";
import * as componentDB from "@/lib/store/component-db";
import type { Component, CreateComponentParams } from "@/lib/types";
import { safeLogError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";

interface ProductImportRequest {
  text?: unknown;
  products?: unknown;
  dryRun?: unknown;
  createComponents?: unknown;
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    if (typeof body === "string") {
      return NextResponse.json({ error: body }, { status: 400 });
    }

    const parsed = parseRequestProducts(body);
    if (typeof parsed === "string") {
      return NextResponse.json({ error: parsed }, { status: 400 });
    }

    const componentsPreview = productsToComponentParams(parsed.parsedProducts);
    const response: Record<string, unknown> = {
      parsedProducts: parsed.parsedProducts,
      rejectedRows: parsed.rejectedRows,
      componentsPreview,
      dryRun: body.dryRun === true,
      createComponents: body.createComponents === true,
    };

    if (body.createComponents === true && body.dryRun !== true) {
      response.savedComponents = await saveNewProductComponents(componentsPreview);
    }

    return NextResponse.json(response);
  } catch (error) {
    safeLogError("Product import failed", error);
    return NextResponse.json({ error: "商品参数导入失败，请稍后重试" }, { status: 500 });
  }
}

async function readBody(req: Request): Promise<ProductImportRequest | string> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return "请求参数无效";
    return body as ProductImportRequest;
  } catch {
    return "请求 JSON 无效";
  }
}

function parseRequestProducts(body: ProductImportRequest) {
  if (body.products !== undefined) {
    if (!Array.isArray(body.products)) return "products 必须是数组";
    return normalizeProductRows(body.products);
  }

  if (typeof body.text === "string") {
    return parseProductImportText(body.text);
  }

  return "text 或 products 至少需要提供一个";
}

async function saveNewProductComponents(paramsList: CreateComponentParams[]): Promise<{
  created: Component[];
  skippedDuplicates: Array<{
    title: string;
    importKey?: unknown;
  }>;
}> {
  const existingComponents = await componentDB.list("product_asset");
  const seenKeys = new Set<string>();

  for (const component of existingComponents) {
    for (const key of getProductDuplicateKeys({
      title: component.title,
      metadata: component.metadata,
    })) {
      seenKeys.add(key);
    }
  }

  const created: Component[] = [];
  const skippedDuplicates: Array<{ title: string; importKey?: unknown }> = [];

  for (const params of paramsList) {
    const keys = getProductDuplicateKeys({
      title: params.title,
      metadata: params.metadata,
    });

    if (keys.some((key) => seenKeys.has(key))) {
      skippedDuplicates.push({
        title: params.title,
        importKey: params.metadata?.importKey,
      });
      continue;
    }

    keys.forEach((key) => seenKeys.add(key));
    created.push(await componentDB.add(params));
  }

  return { created, skippedDuplicates };
}
