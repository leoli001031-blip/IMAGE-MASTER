import { NextResponse } from "next/server";
import { buildExportPackArchive } from "@/lib/canvas/export-pack-archive";
import { buildExportPackImageInfoMap } from "@/lib/canvas/export-pack-image-info";
import { buildExportPackManifests } from "@/lib/canvas/export-pack-manifest";
import {
  buildExportPackQaReport,
  buildExportPackQaReviewByJobId,
} from "@/lib/canvas/export-pack-qa";
import * as artifactDB from "@/lib/store/artifact-db";
import * as jobDB from "@/lib/store/job-db";
import { safeLogError } from "@/lib/server/safe-log";

interface RouteContext {
  params: Promise<{
    batchId: string;
  }>;
}

export async function GET(req: Request, context: RouteContext) {
  try {
    const { batchId } = await context.params;
    const { searchParams } = new URL(req.url);
    const approvedOnly =
      searchParams.get("approvedOnly") === "1" ||
      searchParams.get("approved") === "1" ||
      searchParams.get("mode") === "approved";
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
      return NextResponse.json({ error: "导出包下载批次不存在" }, { status: 404 });
    }

    const imageInfoByUrl = await buildExportPackImageInfoMap(manifest);
    const qaReport = buildExportPackQaReport({
      manifest,
      imageInfoByUrl,
      reviewByJobId: buildExportPackQaReviewByJobId(jobs),
    });
    const archive = await buildExportPackArchive({
      manifest,
      qaReport,
      mode: approvedOnly ? "approved" : "all",
    });

    return new NextResponse(new Uint8Array(archive.buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${archive.fileName}"`,
        "Cache-Control": "no-store",
        "X-Export-Pack-Mode": approvedOnly ? "approved" : "all",
        "X-Export-Pack-QA-Status": qaReport.status,
        "X-Export-Pack-Images": String(archive.summary.includedImages),
        "X-Export-Pack-Missing-Artifacts": String(archive.summary.missingArtifacts.length),
        "X-Export-Pack-Skipped-Artifacts": String(archive.summary.skippedArtifacts.length),
      },
    });
  } catch (e) {
    safeLogError("Export pack download failed", e);
    return NextResponse.json({ error: "导出包下载失败" }, { status: 500 });
  }
}
