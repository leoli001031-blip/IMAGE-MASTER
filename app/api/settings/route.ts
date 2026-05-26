import { NextResponse } from "next/server";
import { getConfigPublic, updateConfig, getConfig } from "@/lib/store/config-store";

export async function GET() {
  try {
    const c = getConfig();
    return NextResponse.json({
      ...getConfigPublic(),
      hasKey: !!c.apiKey,
      hasVisionKey: !!c.visionApiKey,
      hasImageKey: !!c.imageApiKey,
      hasTextKey: !!c.textApiKey,
    });
  } catch {
    return NextResponse.json({ error: "读取配置失败" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!isLocalSettingsRequest(req)) {
      return NextResponse.json({ error: "配置接口仅允许本地访问" }, { status: 403 });
    }

    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "请求参数无效" }, { status: 400 });
    }

    const allowed = [
      "apiKey", "baseUrl",
      "visionModel", "visionApiKey", "visionBaseUrl",
      "imageModel", "imageApiKey", "imageBaseUrl",
      "textModel", "textApiKey", "textBaseUrl",
    ];
    const updates: Record<string, string> = {};
    for (const key of allowed) {
      const value = (body as Record<string, unknown>)[key];
      if (value === undefined) continue;
      if (typeof value !== "string") {
        return NextResponse.json({ error: `${key} 必须是字符串` }, { status: 400 });
      }
      updates[key] = value.trim();
    }
    updateConfig(updates);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "保存失败" }, { status: 400 });
  }
}

function isLocalSettingsRequest(req: Request): boolean {
  const url = new URL(req.url);
  if (isLocalHostname(url.hostname)) return true;

  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
    .split(":")[0]
    ?.trim()
    .toLowerCase();
  if (isLocalHostname(host)) return true;

  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (isLocalHostname(new URL(origin).hostname)) return true;
    } catch {
      return false;
    }
  }

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      if (isLocalHostname(new URL(referer).hostname)) return true;
    } catch {
      return false;
    }
  }

  return false;
}

function isLocalHostname(hostname: string | undefined): boolean {
  const value = (hostname || "").toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value === "[::1]";
}
