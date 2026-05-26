import {
  normalizeComponentMetadata,
  normalizeComponentRules,
} from "@/lib/canvas/component-schema";
import type { CreateComponentParams } from "@/lib/types";

export interface ParsedProductInput {
  title?: string;
  name?: string;
  category?: string;
  description?: string;
  sellingPoints?: unknown;
  features?: unknown;
  materials?: unknown;
  brand?: string;
  price?: string | number;
  sku?: string;
  platformHints?: unknown;
  imageUrl?: string;
  referenceImage?: string;
}

export interface ParsedProduct {
  title: string;
  category: string;
  description: string;
  sellingPoints: string[];
  materials: string[];
  brand: string;
  price: string;
  sku: string;
  platformHints: string[];
  imageUrl: string;
  importKey: string;
  sourceRow: Record<string, unknown>;
}

export interface ProductImportParseResult {
  parsedProducts: ParsedProduct[];
  rejectedRows: Array<{
    index: number;
    reason: string;
    row: unknown;
  }>;
}

const FIELD_ALIASES: Record<string, keyof ParsedProductInput> = {
  title: "title",
  name: "name",
  product: "title",
  productname: "name",
  product_name: "name",
  商品名: "title",
  标题: "title",
  名称: "name",
  category: "category",
  类目: "category",
  分类: "category",
  description: "description",
  desc: "description",
  描述: "description",
  sellingpoints: "sellingPoints",
  selling_points: "sellingPoints",
  features: "features",
  feature: "features",
  卖点: "sellingPoints",
  特点: "features",
  materials: "materials",
  material: "materials",
  材质: "materials",
  brand: "brand",
  品牌: "brand",
  price: "price",
  价格: "price",
  sku: "sku",
  platformhints: "platformHints",
  platform_hints: "platformHints",
  platforms: "platformHints",
  platform: "platformHints",
  平台: "platformHints",
  imageurl: "imageUrl",
  image_url: "imageUrl",
  referenceimage: "referenceImage",
  reference_image: "referenceImage",
  图片: "imageUrl",
  参考图: "referenceImage",
};

export function parseProductImportText(text: string): ProductImportParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { parsedProducts: [], rejectedRows: [] };

  const jsonRows = parseJsonRows(trimmed);
  if (jsonRows) return normalizeProductRows(jsonRows);

  const csvRows = parseDelimitedRows(trimmed);
  if (csvRows.length > 0) return normalizeProductRows(csvRows);

  return normalizeProductRows(parseKeyValueBlocks(trimmed));
}

export function normalizeProductRows(rows: unknown[]): ProductImportParseResult {
  const parsedProducts: ParsedProduct[] = [];
  const rejectedRows: ProductImportParseResult["rejectedRows"] = [];
  const seenImportKeys = new Set<string>();

  rows.forEach((row, index) => {
    const record = normalizeInputRecord(row);
    if (!record) {
      rejectedRows.push({ index, reason: "row must be an object", row });
      return;
    }

    const parsed = normalizeProduct(record);
    if (!parsed) {
      rejectedRows.push({ index, reason: "title or name is required", row });
      return;
    }

    if (seenImportKeys.has(parsed.importKey)) return;
    seenImportKeys.add(parsed.importKey);
    parsedProducts.push(parsed);
  });

  return { parsedProducts, rejectedRows };
}

export function productToComponentParams(product: ParsedProduct): CreateComponentParams {
  const images = [product.imageUrl].filter(Boolean);
  const parameters = {
    category: product.category,
    images,
    referenceImages: images,
    sellingPoints: product.sellingPoints,
    features: product.sellingPoints,
    materials: product.materials,
    brand: product.brand,
    price: product.price,
    sku: product.sku,
    platformHints: product.platformHints,
    invariants: [
      product.brand ? `Preserve brand identity: ${product.brand}` : "",
      product.category ? `Preserve product category: ${product.category}` : "",
      ...product.materials.map((material) => `Preserve material: ${material}`),
    ].filter(Boolean),
    forbiddenChanges: ["Do not alter product structure, logo placement, or core material."],
  };

  const metadata = normalizeComponentMetadata("product_asset", {
    label: product.title,
    importKey: product.importKey,
    source: {
      kind: "ai_import",
      referenceId: product.sku || product.title,
      rawText: JSON.stringify(product.sourceRow),
    },
    parameters,
    promptFragments: [
      product.description,
      ...product.sellingPoints,
      ...product.platformHints.map((hint) => `Platform hint: ${hint}`),
    ].filter(Boolean),
  });

  return {
    type: "product_asset",
    title: product.title,
    description: product.description,
    status: "ready",
    rules: normalizeComponentRules({
      constraints: metadata.constraints,
      qualityRules: metadata.qualityRules,
    }),
    metadata,
  };
}

export function productsToComponentParams(products: ParsedProduct[]): CreateComponentParams[] {
  return products.map(productToComponentParams);
}

export function getProductDuplicateKeys(value: {
  title?: string;
  sku?: string;
  metadata?: Record<string, unknown>;
}): string[] {
  const metadata = value.metadata ?? {};
  const parameters =
    metadata.parameters && typeof metadata.parameters === "object" && !Array.isArray(metadata.parameters)
      ? (metadata.parameters as Record<string, unknown>)
      : {};
  const keys = [
    typeof metadata.importKey === "string" ? metadata.importKey : "",
    typeof parameters.sku === "string" ? `sku:${parameters.sku}` : "",
    value.sku ? `sku:${value.sku}` : "",
    value.title ? `title:${value.title}` : "",
  ];

  return keys.map(normalizeKey).filter(Boolean);
}

function parseJsonRows(text: string): unknown[] | null {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.products)) return record.products;
      return [record];
    }
  } catch {
    const rows = text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return undefined;
        }
      });
    if (rows.length > 0 && rows.every((row) => row !== undefined)) return rows;
  }
  return null;
}

function parseDelimitedRows(text: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const delimiter = chooseDelimiter(lines[0]);
  if (!delimiter) return [];

  const headers = splitDelimitedLine(lines[0], delimiter).map((header) => header.trim());
  if (headers.length < 2) return [];

  return lines.slice(1).map((line) => {
    const values = splitDelimitedLine(line, delimiter);
    return headers.reduce<Record<string, unknown>>((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });
}

function parseKeyValueBlocks(text: string): Record<string, unknown>[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => {
      const row: Record<string, unknown> = {};
      for (const line of block.split(/\r?\n/)) {
        const match = line.match(/^\s*([^:：=]+)\s*[:：=]\s*(.+?)\s*$/);
        if (match) row[match[1]] = match[2];
      }
      return row;
    })
    .filter((row) => Object.keys(row).length > 0);
}

function chooseDelimiter(headerLine: string): "," | "\t" | "|" | null {
  const candidates = [",", "\t", "|"] as const;
  const best = candidates
    .map((delimiter) => ({ delimiter, count: splitDelimitedLine(headerLine, delimiter).length }))
    .sort((a, b) => b.count - a.count)[0];
  return best && best.count > 1 ? best.delimiter : null;
}

function splitDelimitedLine(line: string, delimiter: "," | "\t" | "|"): string[] {
  if (delimiter !== ",") return line.split(delimiter).map((part) => part.trim());

  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function normalizeInputRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const normalized: Record<string, unknown> = {};

  for (const [key, fieldValue] of Object.entries(value)) {
    const alias = FIELD_ALIASES[normalizeFieldKey(key)] ?? (key as keyof ParsedProductInput);
    normalized[alias] = fieldValue;
  }

  return normalized;
}

function normalizeProduct(record: Record<string, unknown>): ParsedProduct | null {
  const title = toString(record.title) || toString(record.name);
  if (!title) return null;

  const sku = toString(record.sku);
  const imageUrl = toString(record.imageUrl) || toString(record.referenceImage);
  const product: ParsedProduct = {
    title,
    category: toString(record.category),
    description: toString(record.description),
    sellingPoints: uniqueStrings([...toStringArray(record.sellingPoints), ...toStringArray(record.features)]),
    materials: toStringArray(record.materials),
    brand: toString(record.brand),
    price: toString(record.price),
    sku,
    platformHints: toStringArray(record.platformHints),
    imageUrl,
    importKey: normalizeKey(sku ? `sku:${sku}` : `title:${title}`),
    sourceRow: record,
  };

  return product;
}

function normalizeFieldKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9\u4e00-\u9fff:_ -]/g, "");
}

function toString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return uniqueStrings(value.map(toString));
  if (typeof value === "string") {
    return uniqueStrings(value.split(/[,，;；|、\n]/).map((item) => item.trim()));
  }
  return [];
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
