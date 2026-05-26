import { NextResponse } from "next/server";
import { buildExportPackImageInfoMap } from "@/lib/canvas/export-pack-image-info";
import { buildExportPackManifests } from "@/lib/canvas/export-pack-manifest";
import {
  buildExportPackQaReviewByJobId,
  buildExportPackQaReport,
} from "@/lib/canvas/export-pack-qa";
import * as artifactDB from "@/lib/store/artifact-db";
import * as jobDB from "@/lib/store/job-db";
import { safeLogError } from "@/lib/server/safe-log";

interface RouteContext {
  params: Promise<{
    batchId: string;
  }>;
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { batchId } = await context.params;
    let jobs = await jobDB.list({ batchId });
    let artifacts = await artifactDB.list({ batchId });

    if (jobs.length === 0) {
      jobs = await jobDB.list();
      artifacts = await artifactDB.list();
    }

    const manifest = buildExportPackManifests({ jobs, artifacts }).find(
      (item) => item.batchId === batchId
    );

    if (!manifest) {
      return NextResponse.json({ error: "导出包 QA 批次不存在" }, { status: 404 });
    }

    const imageInfoByUrl = await buildExportPackImageInfoMap(manifest);
    const qa = buildExportPackQaReport({
      manifest,
      imageInfoByUrl,
      reviewByJobId: buildExportPackQaReviewByJobId(jobs),
    });

    return NextResponse.json({ qa, manifest });
  } catch (e) {
    safeLogError("Export pack QA failed", e);
    return NextResponse.json({ error: "导出包 QA 读取失败" }, { status: 500 });
  }
}
