import { NextResponse } from "next/server";
import { chatWithPlanner } from "@/lib/ai/client";
import { safeLogError } from "@/lib/server/safe-log";

export async function POST(req: Request) {
  try {
    const { messages, productAnalysis } = await req.json();

    if (!messages || !productAnalysis) {
      return NextResponse.json(
        { error: "缺少参数" },
        { status: 400 }
      );
    }

    // Inject product analysis as the first user message context
    const allMessages = [
      { role: "user", text: `待分析的产品信息：${JSON.stringify(productAnalysis, null, 2)}` },
      ...messages,
    ];

    const result = await chatWithPlanner(allMessages);
    return NextResponse.json(result);
  } catch (e) {
    safeLogError("Chat failed", e);
    return NextResponse.json(
      { error: "对话失败，请稍后重试" },
      { status: 500 }
    );
  }
}
