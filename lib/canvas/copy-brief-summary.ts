import {
  buildStructuredCopyBrief,
  normalizeStructuredCopyBrief,
  type StructuredCopyBrief,
  type StructuredCopySection,
} from "./copy-brief";
import type { CanvasAsset, CanvasNodeData } from "./workbench-data";

export interface CopyBriefSectionSummary {
  id: StructuredCopySection;
  label: string;
  items: string[];
  count: number;
  preview: string;
}

export interface CopyBriefSummary {
  brief?: StructuredCopyBrief;
  sourceText: string;
  preview: string;
  sections: CopyBriefSectionSummary[];
  filledSectionCount: number;
  totalItemCount: number;
}

const sectionLabels: Record<StructuredCopySection, string> = {
  inImageText: "画面文字",
  sellingPoints: "卖点",
  exportCopy: "导出",
  forbiddenClaims: "禁止",
};

const sectionOrder: StructuredCopySection[] = [
  "inImageText",
  "sellingPoints",
  "exportCopy",
  "forbiddenClaims",
];

export function getCanvasNodeCopyBriefSummary(
  data: CanvasNodeData | undefined
): CopyBriefSummary {
  const parameters = getRecord(data?.parameters);
  const explicit = normalizeStructuredCopyBrief(parameters?.copyBrief ?? data?.copyBrief);
  const sourceText = getFirstString([
    data?.copyText,
    parameters?.copyText,
    parameters?.sourceText,
    parameters?.text,
    data?.caption,
    data?.label,
  ]);
  return summarizeStructuredCopyBrief(explicit ?? buildBriefFromSource(sourceText), sourceText);
}

export function getCanvasAssetCopyBriefSummary(
  asset: CanvasAsset | undefined
): CopyBriefSummary {
  const explicit = normalizeStructuredCopyBrief(asset?.parameters?.copyBrief);
  const sourceText = getFirstString([
    asset?.parameters?.copyText,
    asset?.parameters?.sourceText,
    asset?.parameters?.text,
    asset?.description,
    asset?.title,
  ]);
  return summarizeStructuredCopyBrief(explicit ?? buildBriefFromSource(sourceText), sourceText);
}

export function summarizeStructuredCopyBrief(
  brief: StructuredCopyBrief | undefined,
  fallbackSourceText = ""
): CopyBriefSummary {
  const sourceText = brief?.sourceText || fallbackSourceText.trim();
  const sections = sectionOrder.map((id) => {
    const items = ((brief?.[id] ?? []) as string[]).map((item) => item.trim()).filter(Boolean);
    return {
      id,
      label: sectionLabels[id],
      items,
      count: items.length,
      preview: summarizeItems(items),
    };
  });

  const filledSections = sections.filter((section) => section.count > 0);
  return {
    brief,
    sourceText,
    preview:
      filledSections[0]?.preview ||
      truncateText(sourceText, 68) ||
      "还没有文案内容",
    sections,
    filledSectionCount: filledSections.length,
    totalItemCount: sections.reduce((sum, section) => sum + section.count, 0),
  };
}

function buildBriefFromSource(sourceText: string): StructuredCopyBrief | undefined {
  return sourceText ? buildStructuredCopyBrief(sourceText) : undefined;
}

function summarizeItems(items: string[]): string {
  return items.length > 0 ? truncateText(items.slice(0, 2).join(" / "), 48) : "";
}

function truncateText(value: string, limit: number): string {
  const text = value.trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function getFirstString(values: unknown[]): string {
  const value = values.find(
    (item): item is string => typeof item === "string" && item.trim().length > 0
  );
  return value?.trim() ?? "";
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
