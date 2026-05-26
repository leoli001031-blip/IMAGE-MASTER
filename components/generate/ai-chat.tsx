"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Sparkles, Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useGenerateStore } from "@/lib/store/generate-store";

interface ChatMessage {
  role: "ai" | "user";
  text: string;
}

export function AIChat() {
  const {
    productAnalysis,
    setStatus,
    setError,
    setGeneratedImages,
    selectedModelIds,
    productImageBase64,
  } = useGenerateStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState<object | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedRef = useRef(false);

  // Start conversation when product analysis is ready
  useEffect(() => {
    if (productAnalysis && !startedRef.current) {
      startedRef.current = true;
      startConversation();
    }
  }, [productAnalysis]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [messages]);

  const startConversation = async () => {
    setWaiting(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [], productAnalysis }),
      });
      if (!res.ok) throw new Error("对话失败");
      const data = await res.json();
      setMessages([{ role: "ai", text: data.reply }]);
      if (data.plan) setPlan(data.plan);
    } catch {
      setError("对话失败，请刷新重试");
    } finally {
      setWaiting(false);
    }
  };

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || waiting || generating) return;

    const userMsg: ChatMessage = { role: "user", text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setWaiting(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, productAnalysis }),
      });
      if (!res.ok) throw new Error("对话失败");
      const data = await res.json();
      setMessages([...newMessages, { role: "ai", text: data.reply }]);
      if (data.plan) setPlan(data.plan);
    } catch {
      setError("对话失败，请稍后重试");
    } finally {
      setWaiting(false);
    }
  }, [input, messages, waiting, generating, productAnalysis, setError]);

  const handleGenerate = async () => {
    if (!plan) return;
    setGenerating(true);
    setStatus("generating");
    try {
      const p = plan as any;
      const imagePayload = {
        images: p.images.map((img: any) => ({
          prompt: img.prompt,
          type: img.type,
          copyText: img.copyText,
          title: img.title,
        })),
        style: "auto",
        modelIds: selectedModelIds,
        productImageBase64,
      };

      const dryRunRes = await fetch("/api/images/generate/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...imagePayload,
          dryRun: true,
        }),
      });

      if (!dryRunRes.ok) throw new Error("图片生成前检查失败");
      const dryRun = await dryRunRes.json();
      const providerCallLimit = Number(
        dryRun.estimate?.maxProviderCallCount || dryRun.estimate?.providerCallCount || 0
      );

      const res = await fetch("/api/images/generate/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...imagePayload,
          dryRun: false,
          confirmedProviderCallLimit: providerCallLimit,
        }),
      });

      if (!res.ok) throw new Error("图片生成失败");
      const result = await res.json();
      setGeneratedImages(result.images);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 space-y-4 mb-4">
        {messages.map((msg, i) => (
          <ChatBubble key={i} role={msg.role} text={msg.text} />
        ))}

        {waiting && (
          <div className="flex items-center gap-2 px-2 py-3 text-sm text-warm-muted/60">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            思考中...
          </div>
        )}

        {plan && !generating && (
          <div className="flex justify-center pt-2">
            <button
              onClick={handleGenerate}
              className="flex items-center gap-2 rounded-xl bg-warm-primary px-10 py-3.5 text-sm font-medium text-warm-paper hover:bg-warm-primary/90 transition-colors shadow-lg shadow-warm-primary/20 active:scale-95"
            >
              <Sparkles className="h-4 w-4" />
              开始生成
            </button>
          </div>
        )}

        {generating && (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-warm-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            生成中
          </div>
        )}
      </div>

      {!plan && (
        <div className="flex items-center gap-3 bg-warm-paper rounded-2xl p-2 border border-warm-line/20 shadow-sm focus-within:border-warm-primary/30 focus-within:ring-1 focus-within:ring-warm-primary/10 transition-all">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder={waiting ? "等待回复..." : "描述你想要什么类型的宣传图..."}
            disabled={waiting}
            className="flex-1 bg-transparent px-3 py-2 text-sm text-warm-ink placeholder:text-warm-muted/40 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || waiting}
            className="rounded-xl bg-warm-primary p-2.5 text-warm-paper shadow-lg shadow-warm-primary/20 hover:bg-warm-primary/90 disabled:opacity-30 transition-all active:scale-90"
          >
            {waiting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      )}
    </div>
  );
}

function ChatBubble({ role, text }: { role: "ai" | "user"; text: string }) {
  return (
    <div className={cn("flex", role === "user" ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm transition-all whitespace-pre-wrap",
          role === "ai"
            ? "bg-warm-paper border border-warm-line/30 text-warm-ink rounded-tl-none"
            : "bg-warm-primary text-warm-paper rounded-tr-none shadow-warm-primary/10"
        )}
      >
        {stripJsonBlock(text)}
      </div>
    </div>
  );
}

function stripJsonBlock(text: string): string {
  return text.replace(/```json[\s\S]*?```/g, "").trim();
}
