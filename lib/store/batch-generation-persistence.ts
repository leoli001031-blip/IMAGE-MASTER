import type { GeneratedArtifact, GenerationJob } from "@/lib/types";
import type { ImageProviderDiagnostic } from "@/lib/ai/image-provider-diagnostics";
import "server-only";
import { getConfigPublic } from "./config-store";
import * as artifactDB from "./artifact-db";
import * as jobDB from "./job-db";
import * as projectDB from "./project-db";
import { storeOutputImage } from "./output-file-store";

export interface BatchGeneratedImageResult {
  id: string;
  url: string;
  type: string;
  copyText: string;
  title: string;
  prompt: string;
  error?: string;
  errorCode?: string;
  diagnostics?: ImageProviderDiagnostic;
  metadata: {
    style: string;
    modelIds: string[];
    [key: string]: unknown;
  };
}

export interface PersistBatchGenerationResultsInput {
  batchId: string;
  batchTitle: string;
  workflowId?: string;
  nodeId?: string;
  assetId?: string;
  platform: string;
  productImageBase64?: string;
  images: BatchGeneratedImageResult[];
  style: string;
  modelIds: string[];
  estimate: Record<string, unknown>;
}

export interface PersistBatchGenerationResultsOutput {
  batchId: string;
  jobIds: string[];
  artifactIds: string[];
  successCount: number;
  failedCount: number;
}

export async function persistBatchGenerationResults({
  batchId,
  batchTitle,
  workflowId,
  nodeId,
  assetId,
  platform,
  productImageBase64,
  images,
  style,
  modelIds,
  estimate,
}: PersistBatchGenerationResultsInput): Promise<PersistBatchGenerationResultsOutput> {
  const config = getConfigPublic();
  const provider = getProviderLabel(config.imageBaseUrl || config.baseUrl);
  const model = config.imageModel;
  const now = new Date().toISOString();
  const persistedJobs: GenerationJob[] = [];
  const persistedArtifacts: GeneratedArtifact[] = [];
  const referenceImage = productImageBase64
    ? await storeOutputImage({
        id: `${batchId}_reference`,
        title: `${batchTitle} reference`,
        url: productImageBase64,
        defaultMimeType: "image/png",
      })
    : null;

  for (const [index, image] of images.entries()) {
    const imageMetadata = image.metadata ?? {};
    const baseMetadata = {
      ...imageMetadata,
      source: "batch-image-api",
      batchId,
      batchIndex: index + 1,
      batchTotal: images.length,
      exportPackTitle: batchTitle,
      batchJobTitle: image.title,
      platform,
      style,
      modelIds,
      provider,
      model,
      generatedAt: now,
      errorCode: image.errorCode,
      providerDiagnostics: image.diagnostics,
      referenceImageUrl: referenceImage?.publicUrl,
      referenceImageStorage: referenceImage?.metadata,
    };
    const storedImage =
      image.url && !image.error
        ? await storeOutputImage({
            id: image.id,
            title: image.title,
            url: image.url,
            defaultMimeType: "image/png",
          })
        : null;

    const job = await jobDB.add({
      workflowId,
      nodeId,
      assetId,
      status: storedImage ? "done" : "failed",
      prompt: image.prompt,
      resultUrl: storedImage?.publicUrl || "",
      error: image.error || "",
      metadata: {
        ...baseMetadata,
        imageId: image.id,
        imageType: image.type,
        copyText: image.copyText,
        resultStorage: storedImage?.metadata,
      },
    });

    const batchState = await projectDB.ensureExportPackBatchForJob(job);
    const enrichedJob = batchState
      ? await jobDB.update(job.id, {
          metadata: {
            ...job.metadata,
            projectId: batchState.projectId,
            campaignId: batchState.campaignId,
            batchState: batchState.state,
          },
        })
      : job;

    persistedJobs.push(enrichedJob ?? job);

    if (storedImage) {
      const artifact = await artifactDB.add({
        workflowId,
        nodeId,
        jobId: job.id,
        assetId,
        type: "image",
        title: `${image.title} 生成产物`,
        status: "ready",
        url: storedImage.publicUrl,
        prompt: image.prompt,
        provider,
        model,
        metadata: {
          ...baseMetadata,
          jobId: job.id,
          imageId: image.id,
          imageType: image.type,
          copyText: image.copyText,
          imageStorage: storedImage.metadata,
        },
      });
      persistedArtifacts.push(artifact);
    }
  }

  const batch = await projectDB.getBatch(batchId);
  if (batch && batch.state !== "locked" && batch.state !== "delivered") {
    const successCount = persistedArtifacts.length;
    const failedCount = images.length - successCount;
    await projectDB.updateBatch(batch.projectId, batch.id, {
      title: batch.title || batchTitle,
      metadata: {
        ...batch.metadata,
        source: "batch-image-api",
        batchId,
        platform,
        itemCount: images.length,
        partialResult: failedCount > 0,
        successCount,
        failedCount,
        jobIds: mergeStringArrays(batch.metadata.jobIds, persistedJobs.map((job) => job.id)),
        artifactIds: mergeStringArrays(
          batch.metadata.artifactIds,
          persistedArtifacts.map((artifact) => artifact.id)
        ),
        provider,
        model,
        referenceImageUrl: referenceImage?.publicUrl,
        referenceImageStorage: referenceImage?.metadata,
        estimate,
        lastPersistedAt: now,
      },
    });
  }

  return {
    batchId,
    jobIds: persistedJobs.map((job) => job.id),
    artifactIds: persistedArtifacts.map((artifact) => artifact.id),
    successCount: persistedArtifacts.length,
    failedCount: images.length - persistedArtifacts.length,
  };
}

function getProviderLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname || "image-provider";
  } catch {
    return baseUrl || "image-provider";
  }
}

function mergeStringArrays(existing: unknown, next: string[]): string[] {
  const values = Array.isArray(existing)
    ? existing.filter((value): value is string => typeof value === "string" && !!value.trim())
    : [];
  return Array.from(new Set([...values, ...next.filter(Boolean)]));
}
