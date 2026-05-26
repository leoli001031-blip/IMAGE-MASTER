"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Eye, EyeOff } from "lucide-react";

interface SettingsState {
  apiKey: string;
  baseUrl: string;
  visionModel: string;
  visionApiKey: string;
  visionBaseUrl: string;
  imageModel: string;
  imageApiKey: string;
  imageBaseUrl: string;
  textModel: string;
  textApiKey: string;
  textBaseUrl: string;
  hasKey: boolean;
  hasVisionKey: boolean;
  hasImageKey: boolean;
  hasTextKey: boolean;
}

const EMPTY: SettingsState = {
  apiKey: "", baseUrl: "",
  visionModel: "", visionApiKey: "", visionBaseUrl: "",
  imageModel: "", imageApiKey: "", imageBaseUrl: "",
  textModel: "", textApiKey: "", textBaseUrl: "",
  hasKey: false, hasVisionKey: false, hasImageKey: false, hasTextKey: false,
};

export default function SettingsPage() {
  const [config, setConfig] = useState<SettingsState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        setConfig(d);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const fields = [
        "apiKey", "baseUrl",
        "visionModel", "visionApiKey", "visionBaseUrl",
        "imageModel", "imageApiKey", "imageBaseUrl",
        "textModel", "textApiKey", "textBaseUrl",
      ];
      const body: Record<string, string> = {};
      for (const k of fields) {
        if (config[k as keyof SettingsState]) {
          body[k] = config[k as keyof SettingsState] as string;
        }
      }

      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setToast("已保存");
      setTimeout(() => setToast(""), 2000);
    } catch {
      setToast("保存失败");
      setTimeout(() => setToast(""), 2000);
    } finally {
      setSaving(false);
    }
  };

  const update = (key: string, value: string) =>
    setConfig((c) => ({ ...c, [key]: value }));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-5 w-5 animate-spin text-warm-muted/40" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-10 max-w-xl mx-auto">
      <h1 className="text-lg font-semibold text-warm-ink">模型设置</h1>

      {/* Global defaults */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-warm-muted">全局默认（各模型留空时使用）</h2>
        <Field label="API Key" hint={config.hasKey ? "已设置" : "未设置"}>
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => update("apiKey", e.target.value)}
            placeholder={config.hasKey ? "留空则不修改" : "sk-..."}
            className="input"
          />
        </Field>
        <Field label="API 地址">
          <input
            type="text"
            value={config.baseUrl}
            onChange={(e) => update("baseUrl", e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="input"
          />
        </Field>
      </section>

      {/* Per-model configs */}
      <section className="space-y-6">
        <h2 className="text-sm font-medium text-warm-muted">各模型独立配置</h2>

        {/* Vision */}
        <ModelBlock label="多模态模型" hint="产品识别，需支持图片输入" hasKey={config.hasVisionKey}>
          <input
            type="text" value={config.visionModel}
            onChange={(e) => update("visionModel", e.target.value)}
            placeholder="gpt-4o" className="input"
          />
          <PerModelFields
            apiKey={config.visionApiKey} baseUrl={config.visionBaseUrl}
            onKey={(v) => update("visionApiKey", v)}
            onUrl={(v) => update("visionBaseUrl", v)}
            hasKey={config.hasVisionKey}
          />
        </ModelBlock>

        {/* Image */}
        <ModelBlock label="生图模型" hasKey={config.hasImageKey}>
          <input
            type="text" value={config.imageModel}
            onChange={(e) => update("imageModel", e.target.value)}
            placeholder="dall-e-3" className="input"
          />
          <PerModelFields
            apiKey={config.imageApiKey} baseUrl={config.imageBaseUrl}
            onKey={(v) => update("imageApiKey", v)}
            onUrl={(v) => update("imageBaseUrl", v)}
            hasKey={config.hasImageKey}
          />
        </ModelBlock>

        {/* Text */}
        <ModelBlock label="文本模型" hint="图组规划" hasKey={config.hasTextKey}>
          <input
            type="text" value={config.textModel}
            onChange={(e) => update("textModel", e.target.value)}
            placeholder="gpt-4o" className="input"
          />
          <PerModelFields
            apiKey={config.textApiKey} baseUrl={config.textBaseUrl}
            onKey={(v) => update("textApiKey", v)}
            onUrl={(v) => update("textBaseUrl", v)}
            hasKey={config.hasTextKey}
          />
        </ModelBlock>
      </section>

      <button
        onClick={save}
        disabled={saving}
        className="flex items-center justify-center gap-2 rounded-xl bg-warm-primary py-3 text-sm font-medium text-warm-paper hover:bg-warm-primary/90 disabled:opacity-50 transition-colors"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        保存
      </button>

      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 rounded-full bg-warm-ink/90 px-4 py-2 text-xs text-warm-paper shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

function PerModelFields({
  apiKey, baseUrl, onKey, onUrl, hasKey,
}: {
  apiKey: string; baseUrl: string;
  onKey: (v: string) => void; onUrl: (v: string) => void;
  hasKey: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <input
        type="password" value={apiKey}
        onChange={(e) => onKey(e.target.value)}
        placeholder={hasKey ? "已设置，留空不修改" : "Key（留空用全局）"}
        className="input text-xs"
      />
      <input
        type="text" value={baseUrl}
        onChange={(e) => onUrl(e.target.value)}
        placeholder="地址（留空用全局）"
        className="input text-xs"
      />
    </div>
  );
}

function ModelBlock({
  label, hint, hasKey, children,
}: {
  label: string; hint?: string; hasKey?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-warm-line bg-warm-paper p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-warm-ink">{label}</span>
        {hint && <span className="text-xs text-warm-muted/50">{hint}</span>}
        {hasKey && <span className="text-xs text-warm-sage">独立 Key 已设置</span>}
      </div>
      {children}
    </div>
  );
}

function Field({
  label, hint, children,
}: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-warm-ink">{label}</span>
        {hint && <span className="text-xs text-warm-muted/50">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
