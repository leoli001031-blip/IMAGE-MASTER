import type { GeneratedArtifact, GenerationJob } from "@/lib/types";
import type { ExportPackBatchStateSnapshot } from "@/lib/canvas/export-pack-state";

export interface ExportPackManifestArtifact {
  artifactId: string;
  url: string;
  status: string;
}

export interface ExportPackManifestItem {
  jobId: string;
  status: string;
  title: string;
  naming: string;
  size: string;
  ratio: string;
  specId: string;
  metadata: Record<string, unknown>;
  artifact?: ExportPackManifestArtifact;
}

export interface ExportPackManifestCounts {
  planned: number;
  completed: number;
  failed: number;
  missingArtifact: number;
}

export interface ExportPackManifest {
  batchId: string;
  title: string;
  platform: string;
  items: ExportPackManifestItem[];
  counts: ExportPackManifestCounts;
  batchState?: ExportPackBatchStateSnapshot;
}

interface BuildExportPackManifestsParams {
  jobs: Array<GenerationJob & { metadata: Record<string, unknown> }>;
  artifacts: Array<GeneratedArtifact & { metadata: Record<string, unknown> }>;
}

type ExportPackArtifact = GeneratedArtifact & { metadata: Record<string, unknown> };

interface ArtifactLookupIndex {
  all: ExportPackArtifact[];
  byJobId: Map<string, ExportPackArtifact>;
  byBatchId: Map<string, ExportPackArtifact[]>;
}

export function buildExportPackManifests({
  jobs,
  artifacts,
}: BuildExportPackManifestsParams): ExportPackManifest[] {
  const groups = new Map<string, Array<GenerationJob & { metadata: Record<string, unknown> }>>();
  const artifactIndex = buildArtifactLookupIndex(artifacts);

  for (const job of jobs) {
    const batchId = getStringValue(job.metadata.batchId);
    if (!batchId) continue;
    groups.set(batchId, [...(groups.get(batchId) ?? []), job]);
  }

  return Array.from(groups.entries())
    .map(([batchId, batchJobs]) => buildManifest(batchId, batchJobs, artifactIndex))
    .sort((a, b) => getLatestItemTime(b.items, jobs) - getLatestItemTime(a.items, jobs));
}

function buildManifest(
  batchId: string,
  jobs: Array<GenerationJob & { metadata: Record<string, unknown> }>,
  artifacts: ArtifactLookupIndex
): ExportPackManifest {
  const orderedJobs = [...jobs].sort((a, b) => {
    const aIndex = getNumberValue(a.metadata.batchIndex) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = getNumberValue(b.metadata.batchIndex) ?? Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
  const metadataList = orderedJobs.map((job) => job.metadata);
  const items = orderedJobs.map((job) => {
    const artifact = findArtifactForJob(job, artifacts);

    return {
      jobId: job.id,
      status: job.status,
      title:
        getStringValue(job.metadata.batchJobTitle) ??
        getStringValue(job.metadata.exportSpecTitle) ??
        getStringValue(job.metadata.nodeLabel) ??
        "导出包任务",
      naming: getStringValue(job.metadata.naming) ?? "",
      size: getStringValue(job.metadata.size) ?? "",
      ratio: getStringValue(job.metadata.ratio) ?? "",
      specId: getStringValue(job.metadata.exportSpecId) ?? "",
      metadata: buildManifestItemMetadata(job.metadata),
      artifact: artifact
        ? {
            artifactId: artifact.id,
            url: artifact.url,
            status: artifact.status,
          }
        : undefined,
    };
  });

  return {
    batchId,
    title:
      getFirstString(metadataList, "exportPackTitle") ??
      getFirstString(metadataList, "batchJobTitle") ??
      "导出包批次",
    platform: getFirstString(metadataList, "platform") ?? "multi_channel",
    items,
    counts: countManifestItems(items),
  };
}

function buildManifestItemMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of [
    "source",
    "planId",
    "planItemId",
    "planItemTitle",
    "planItemType",
    "exportItemId",
    "exportItemTitle",
    "exportSpecId",
    "platform",
    "imageType",
    "useCase",
  ]) {
    if (metadata[key] !== undefined) result[key] = metadata[key];
  }

  const itemMetadata = getRecordValue(metadata.itemMetadata);
  if (Object.keys(itemMetadata).length > 0) {
    result.itemMetadata = itemMetadata;
  }

  return result;
}

function findArtifactForJob(
  job: GenerationJob & { metadata: Record<string, unknown> },
  artifacts: ArtifactLookupIndex
): GeneratedArtifact | undefined {
  const byJobId = artifacts.byJobId.get(job.id);
  if (byJobId) return byJobId;

  const batchId = getStringValue(job.metadata.batchId);
  const specId = getStringValue(job.metadata.exportSpecId);
  const naming = getStringValue(job.metadata.naming);
  const assetId = job.assetId || getStringValue(job.metadata.sourceAssetId);
  const candidates = batchId ? artifacts.byBatchId.get(batchId) ?? [] : artifacts.all;

  return candidates.find((artifact) => {
    const artifactBatchId = getStringValue(artifact.metadata.batchId);
    const artifactSpecId = getStringValue(artifact.metadata.exportSpecId);
    const artifactNaming = getStringValue(artifact.metadata.naming);

    if (batchId && artifactBatchId && artifactBatchId !== batchId) return false;
    if (assetId && artifact.assetId && artifact.assetId !== assetId) return false;
    if (specId && artifactSpecId && artifactSpecId === specId) return true;
    if (naming && artifactNaming && artifactNaming === naming) return true;
    return false;
  });
}

function buildArtifactLookupIndex(artifacts: ExportPackArtifact[]): ArtifactLookupIndex {
  const byJobId = new Map<string, ExportPackArtifact>();
  const byBatchId = new Map<string, ExportPackArtifact[]>();

  for (const artifact of artifacts) {
    if (artifact.jobId) {
      byJobId.set(artifact.jobId, artifact);
    }

    const batchId = getStringValue(artifact.metadata.batchId);
    if (batchId) {
      byBatchId.set(batchId, [...(byBatchId.get(batchId) ?? []), artifact]);
    }
  }

  return {
    all: artifacts,
    byJobId,
    byBatchId,
  };
}

function countManifestItems(items: ExportPackManifestItem[]): ExportPackManifestCounts {
  return items.reduce<ExportPackManifestCounts>(
    (counts, item) => {
      if (isFailedStatus(item.status) || isFailedStatus(item.artifact?.status)) {
        counts.failed += 1;
      } else if (isReadyArtifact(item.artifact)) {
        counts.completed += 1;
      } else if (isCompletedJobStatus(item.status)) {
        counts.missingArtifact += 1;
      } else {
        counts.planned += 1;
      }
      return counts;
    },
    { planned: 0, completed: 0, failed: 0, missingArtifact: 0 }
  );
}

function isReadyArtifact(artifact?: ExportPackManifestArtifact): boolean {
  if (!artifact || !artifact.url) return false;
  return ["ready", "done", "completed", "success"].includes(artifact.status);
}

function isCompletedJobStatus(status?: string): boolean {
  return status === "done" || status === "completed";
}

function isFailedStatus(status?: string): boolean {
  return status === "failed";
}

function getLatestItemTime(
  items: ExportPackManifestItem[],
  jobs: Array<GenerationJob & { metadata: Record<string, unknown> }>
): number {
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  return Math.max(
    0,
    ...items.map((item) => {
      const job = jobById.get(item.jobId);
      return job ? new Date(job.updatedAt || job.createdAt).getTime() : 0;
    })
  );
}

function getFirstString(
  metadataList: Array<Record<string, unknown>>,
  key: string
): string | undefined {
  for (const metadata of metadataList) {
    const value = getStringValue(metadata[key]);
    if (value) return value;
  }
  return undefined;
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getRecordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
