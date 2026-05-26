import { NextResponse } from "next/server";
import {
  generateCanvasComponents,
  type GeneratedCanvasComponent,
} from "@/lib/ai/client";
import {
  getFactoryComponentDuplicateKeys,
  normalizeFactorySuggestionToComponent,
  type CanvasComponentFactoryInput,
} from "@/lib/canvas/component-factory-normalizer";
import { safeLogError } from "@/lib/server/safe-log";
import * as componentDB from "@/lib/store/component-db";
import type { Component } from "@/lib/types";

export const dynamic = "force-dynamic";

interface CanvasFactoryRequest extends CanvasComponentFactoryInput {
  persistComponents?: boolean;
  useLocalFallback?: boolean;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const input = normalizeRequest(body);

    if (typeof input === "string") {
      return NextResponse.json({ error: input }, { status: 400 });
    }

    try {
      const components = input.useLocalFallback ? [] : await generateCanvasComponents(input);
      if (components.length > 0) {
        return NextResponse.json({
          components,
          ...(input.persistComponents
            ? { savedComponents: await persistGeneratedComponents(input, components) }
            : {}),
          fallback: false,
        });
      }
    } catch (error) {
      safeLogError("Canvas component AI generation failed", error);
    }

    const components = [createFallbackComponent(input)];
    return NextResponse.json({
      components,
      ...(input.persistComponents
        ? { savedComponents: await persistGeneratedComponents(input, components) }
        : {}),
      fallback: true,
    });
  } catch (error) {
    safeLogError("Canvas component factory failed", error);
    return NextResponse.json({ error: "组件生成失败，请稍后重试" }, { status: 500 });
  }
}

function normalizeRequest(value: unknown): CanvasFactoryRequest | string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "请求参数无效";
  const body = value as CanvasFactoryRequest;

  if (!body.factoryItem || typeof body.factoryItem !== "object") return "组件类型不能为空";
  if (body.factoryItem.title !== undefined && typeof body.factoryItem.title !== "string") {
    return "组件标题无效";
  }
  if (
    body.factoryItem.description !== undefined &&
    typeof body.factoryItem.description !== "string"
  ) {
    return "组件描述无效";
  }
  if (body.existingNodes !== undefined && !Array.isArray(body.existingNodes)) {
    return "画布节点无效";
  }

  return {
    factoryItem: {
      id: body.factoryItem.id,
      title: body.factoryItem.title,
      description: body.factoryItem.description,
    },
    productAsset: body.productAsset && typeof body.productAsset === "object"
      ? {
          title: body.productAsset.title,
          description: body.productAsset.description,
        }
      : null,
    existingNodes: Array.isArray(body.existingNodes)
      ? body.existingNodes.slice(0, 12).map((node) => ({
          id: node.id,
          label: node.label,
          kind: node.kind,
        }))
      : [],
    persistComponents: body.persistComponents === true,
    useLocalFallback: body.useLocalFallback === true,
  };
}

async function persistGeneratedComponents(
  input: CanvasFactoryRequest,
  components: GeneratedCanvasComponent[]
): Promise<Component[]> {
  const existingComponents = await componentDB.list();
  const seenKeys = new Set<string>();

  for (const component of existingComponents) {
    for (const key of getFactoryComponentDuplicateKeys(component)) {
      seenKeys.add(key);
    }
  }

  const savedComponents: Component[] = [];
  for (const component of components) {
    const params = normalizeFactorySuggestionToComponent(input, component);
    const keys = getFactoryComponentDuplicateKeys({
      title: params.title,
      type: params.type,
      metadata: params.metadata,
    });

    if (keys.some((key) => seenKeys.has(key))) continue;
    keys.forEach((key) => seenKeys.add(key));
    savedComponents.push(await componentDB.add(params));
  }

  return savedComponents;
}

function createFallbackComponent(input: CanvasFactoryRequest): GeneratedCanvasComponent {
  const id = input.factoryItem?.id;
  const title = input.factoryItem?.title || "AI 组件";

  if (id === "factory-model") {
    return {
      title: title || "模特展示任务",
      caption: "匹配模特资产、站姿、镜头和统一商业光线",
      kind: "output",
      status: "queued",
      metrics: ["3 张 4:5", "半身展示", "统一光线"],
      iconName: "model",
      sourceId: "product",
      edgeLabel: "上身",
    };
  }

  if (id === "factory-detail") {
    return {
      title: title || "详情页模块任务",
      caption: "生成首屏、卖点条、细节特写和对比图模块",
      kind: "output",
      status: "queued",
      metrics: ["首屏", "卖点条", "细节特写"],
      iconName: "output",
      sourceId: "brief",
      edgeLabel: "编排",
    };
  }

  if (id === "factory-export") {
    return {
      title: title || "多平台输出包",
      caption: "按淘宝、亚马逊、小红书等渠道整理图片规格",
      kind: "output",
      status: "queued",
      metrics: ["渠道尺寸", "命名规范", "图文包"],
      iconName: "platform",
      sourceId: "platform",
      edgeLabel: "适配",
    };
  }

  if (id === "factory-review") {
    return {
      title: title || "商业一致性质检",
      caption: "检查结构、材质、Logo、遮挡和平台合规风险",
      kind: "review",
      status: "review",
      metrics: ["结构一致", "Logo 检查", "合规风险"],
      iconName: "review",
      sourceId: "platform",
      edgeLabel: "质检",
    };
  }

  return {
    title,
    caption: input.factoryItem?.description || "把需求拆成可复用的低代码画布组件",
    kind: "factory",
    status: "ready",
    metrics: ["结构化字段", "生成规则", "可复用模板"],
    iconName: "ai",
    sourceId: "product",
    edgeLabel: "转译",
  };
}
