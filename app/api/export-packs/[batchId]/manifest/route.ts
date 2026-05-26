import { NextResponse } from "next/server";
import { buildExportPackManifests } from "@/lib/canvas/export-pack-manifest";
import * as artifactDB from "@/lib/store/artifact-db";
import * as jobDB from "@/lib/store/job-db";
import * as projectDB from "@/lib/store/project-db";
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
      return NextResponse.json({ error: "导出包 manifest 不存在" }, { status: 404 });
    }

    const batchState = await projectDB.ensureExportPackBatchForManifest({
      manifest,
      jobs,
      artifacts,
    });
    const manifestWithState = { ...manifest, batchState };

    if (searchParams.get("download") === "1") {
      return NextResponse.json(
        { manifest: manifestWithState, batchState },
        {
          headers: {
            "Content-Disposition": `attachment; filename="${batchId}-manifest.json"`,
          },
        }
      );
    }

    return NextResponse.json({ manifest: manifestWithState, batchState });
  } catch (e) {
    safeLogError("Export pack manifest failed", e);
    return NextResponse.json({ error: "导出包 manifest 读取失败" }, { status: 500 });
  }
}
