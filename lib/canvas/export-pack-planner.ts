import type { CanvasWorkbenchNode } from "@/lib/canvas/workbench-data";
import type { ExportPackItem, ExportPackSpec } from "@/lib/canvas/export-pack-rules";

export interface ExportPackPlannedJob {
  title: string;
  prompt: string;
  metadata: Record<string, unknown>;
}

export function isExportPackNode(node: CanvasWorkbenchNode): boolean {
  return (
    typeof node.data.exportPackId === "string" &&
    !!node.data.exportPackId.trim() &&
    Array.isArray(node.data.exportSpecs) &&
    node.data.exportSpecs.length > 0
  );
}

export function buildExportPackBatchPlan(
  node: CanvasWorkbenchNode,
  batchId = `batch_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
): ExportPackPlannedJob[] {
  const specs = normalizeExportSpecs(node.data.exportSpecs);
  if (specs.length === 0) return [];

  const items = normalizeExportItems(node.data.exportItems);
  const batchTotal = specs.reduce((sum, spec) => sum + Math.max(1, Math.floor(spec.count)), 0);
  const exportPackTitle = getStringValue(node.data.label) ?? "导出包";
  const platform = getStringValue(node.data.platform) ?? "multi_channel";
  const qualityRules = getStringArray(node.data.qualityRules);
  const useCase = getStringValue(node.data.useCase);
  const plannedJobs: ExportPackPlannedJob[] = [];

  specs.forEach((spec, specIndex) => {
    const item = items[specIndex] ?? items[items.length - 1] ?? null;
    const count = Math.max(1, Math.floor(spec.count));

    for (let copyIndex = 1; copyIndex <= count; copyIndex += 1) {
      const batchIndex = plannedJobs.length + 1;
      const title = [
        exportPackTitle,
        item?.title,
        spec.title,
        count > 1 ? `${copyIndex}/${count}` : "",
      ].filter(Boolean).join(" · ");
      const naming = formatExportNaming(spec.naming, copyIndex, count);
      const combinedQualityRules = Array.from(
        new Set([...spec.qualityRules, ...qualityRules].filter(Boolean))
      );

      plannedJobs.push({
        title,
        prompt: buildExportPackPrompt({
          exportPackTitle,
          node,
          item,
          spec,
          copyIndex,
          count,
          platform,
          useCase,
          naming,
          qualityRules: combinedQualityRules,
        }),
        metadata: {
          batchId,
          batchIndex,
          batchTotal,
          batchJobTitle: title,
          batchCaption: `导出包 ${batchIndex}/${batchTotal} · ${spec.size}`,
          exportPackId: node.data.exportPackId,
          exportPackTitle,
          exportItemId: item?.id,
          exportItemTitle: item?.title,
          exportItemRole: item?.role,
          exportSpecId: spec.id,
          exportSpecTitle: spec.title,
          exportSpecPurpose: spec.purpose,
          platform,
          size: spec.size,
          ratio: spec.ratio,
          naming,
          qualityRules: combinedQualityRules,
          useCase,
          whiteBackground: spec.whiteBackground,
          textAllowed: spec.textAllowed,
          modelRequired: spec.modelRequired,
        },
      });
    }
  });

  return plannedJobs;
}

function buildExportPackPrompt({
  exportPackTitle,
  node,
  item,
  spec,
  copyIndex,
  count,
  platform,
  useCase,
  naming,
  qualityRules,
}: {
  exportPackTitle: string;
  node: CanvasWorkbenchNode;
  item: ExportPackItem | null;
  spec: ExportPackSpec;
  copyIndex: number;
  count: number;
  platform: string;
  useCase?: string;
  naming: string;
  qualityRules: string[];
}): string {
  return [
    `Export pack planning task: ${exportPackTitle}`,
    `Canvas node: ${node.data.label}`,
    `Node intent: ${node.data.caption}`,
    item ? `Export item: ${item.title}. ${item.role}` : "Export item: follow the export pack item plan.",
    `Export spec: ${spec.title}. ${spec.purpose}`,
    `Platform: ${platform}`,
    useCase ? `Use case: ${useCase}` : "",
    `Output ${copyIndex}/${count}: ${spec.size}, ${spec.ratio}, naming ${naming}.`,
    `Constraints: white background ${spec.whiteBackground ? "required" : "optional"}; text ${spec.textAllowed ? "allowed" : "not allowed"}; model ${spec.modelRequired ? "required" : "optional"}.`,
    `Quality rules: ${qualityRules.join("; ")}`,
    "Keep product identity consistent and do not change product structure, logos, material, or key proportions.",
  ].filter(Boolean).join("\n");
}

function normalizeExportSpecs(value: unknown): ExportPackSpec[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeExportSpec).filter(Boolean) as ExportPackSpec[];
}

function normalizeExportSpec(value: unknown): ExportPackSpec | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const spec = value as Partial<ExportPackSpec>;
  const id = getStringValue(spec.id);
  const title = getStringValue(spec.title);
  if (!id || !title) return null;

  return {
    id,
    title,
    purpose: getStringValue(spec.purpose) ?? title,
    size: getStringValue(spec.size) ?? "待定尺寸",
    ratio: getStringValue(spec.ratio) ?? "待定比例",
    count: typeof spec.count === "number" && Number.isFinite(spec.count) ? spec.count : 1,
    naming: getStringValue(spec.naming) ?? id,
    whiteBackground: spec.whiteBackground === true,
    textAllowed: spec.textAllowed === true,
    modelRequired: spec.modelRequired === true,
    qualityRules: getStringArray(spec.qualityRules),
  };
}

function normalizeExportItems(value: unknown): ExportPackItem[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeExportItem).filter(Boolean) as ExportPackItem[];
}

function normalizeExportItem(value: unknown): ExportPackItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<ExportPackItem>;
  const id = getStringValue(item.id);
  const title = getStringValue(item.title);
  if (!id || !title) return null;

  return {
    id,
    title,
    role: getStringValue(item.role) ?? title,
    count: typeof item.count === "number" && Number.isFinite(item.count) ? item.count : 1,
    requiredAssets: getStringArray(item.requiredAssets),
    outputType: item.outputType ?? "single_image",
  };
}

function formatExportNaming(naming: string, copyIndex: number, count: number): string {
  if (count <= 1) return naming;
  const suffix = String(copyIndex).padStart(2, "0");
  if (/\d{2}-\d{2}$/.test(naming)) return naming.replace(/\d{2}-\d{2}$/, suffix);
  if (/\d-\d$/.test(naming)) return naming.replace(/\d-\d$/, String(copyIndex));
  return `${naming}_${suffix}`;
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && !!item.trim());
}
