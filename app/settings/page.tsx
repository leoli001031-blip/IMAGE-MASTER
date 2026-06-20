"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  KeyRound,
  Loader2,
  RotateCcw,
  Server,
  Sparkles,
} from "lucide-react";

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

interface ProviderPreset {
  id: string;
  label: string;
  description: string;
  baseUrl: string;
  visionModel: string;
  imageModel: string;
  textModel: string;
}

type ModelRole = "vision" | "image" | "text";

const EMPTY: SettingsState = {
  apiKey: "",
  baseUrl: "",
  visionModel: "",
  visionApiKey: "",
  visionBaseUrl: "",
  imageModel: "",
  imageApiKey: "",
  imageBaseUrl: "",
  textModel: "",
  textApiKey: "",
  textBaseUrl: "",
  hasKey: false,
  hasVisionKey: false,
  hasImageKey: false,
  hasTextKey: false,
};

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "apikey-fun-slb",
    label: "APIKey.fun 专线",
    description: "演示主用线路，专线直连，适合 gpt-5.5 / Image 2 测试。",
    baseUrl: "https://slb.apikey.fun/v1",
    visionModel: "gpt-5.5",
    imageModel: "gpt-5.5",
    textModel: "gpt-5.5",
  },
  {
    id: "apikey-fun-backup",
    label: "APIKey.fun 备用",
    description: "普通线路备用；专线异常时再切到这里。",
    baseUrl: "https://api.apikey.fun/v1",
    visionModel: "gpt-5.5",
    imageModel: "gpt-5.5",
    textModel: "gpt-5.5",
  },
  {
    id: "openai",
    label: "OpenAI 官方",
    description: "官方兼容地址，只有直连 OpenAI 时使用。",
    baseUrl: "https://api.openai.com/v1",
    visionModel: "gpt-4o",
    imageModel: "gpt-image-2",
    textModel: "gpt-4o",
  },
  {
    id: "custom",
    label: "自定义",
    description: "保留当前字段，手动填写任意 OpenAI-compatible 地址。",
    baseUrl: "",
    visionModel: "",
    imageModel: "",
    textModel: "",
  },
];

const ROLE_CONFIG: Array<{
  role: ModelRole;
  title: string;
  subtitle: string;
  modelKey: keyof SettingsState;
  keyKey: keyof SettingsState;
  urlKey: keyof SettingsState;
  hasKeyKey: keyof SettingsState;
  placeholder: string;
}> = [
  {
    role: "vision",
    title: "多模态模型",
    subtitle: "产品识别、图片理解、参考图分析",
    modelKey: "visionModel",
    keyKey: "visionApiKey",
    urlKey: "visionBaseUrl",
    hasKeyKey: "hasVisionKey",
    placeholder: "gpt-4o / gpt-5.5",
  },
  {
    role: "image",
    title: "生图模型",
    subtitle: "最终成片、资产图、局部重做",
    modelKey: "imageModel",
    keyKey: "imageApiKey",
    urlKey: "imageBaseUrl",
    hasKeyKey: "hasImageKey",
    placeholder: "gpt-image-2 / gpt-5.5",
  },
  {
    role: "text",
    title: "文本模型",
    subtitle: "Agent 规划、提示词、文案策略",
    modelKey: "textModel",
    keyKey: "textApiKey",
    urlKey: "textBaseUrl",
    hasKeyKey: "hasTextKey",
    placeholder: "gpt-4o / gpt-5.5",
  },
];

export default function SettingsPage() {
  const [config, setConfig] = useState<SettingsState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [clearRoleKeys, setClearRoleKeys] = useState<Record<ModelRole, boolean>>({
    vision: false,
    image: false,
    text: false,
  });

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  useEffect(() => {
    let mounted = true;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (!mounted) return;
        setConfig({ ...EMPTY, ...payload });
      })
      .catch(() => showToast("读取设置失败"))
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const activePresetId = useMemo(() => {
    const normalizedBaseUrl = normalizeUrl(config.baseUrl);
    return (
      PROVIDER_PRESETS.find((preset) => preset.baseUrl && normalizeUrl(preset.baseUrl) === normalizedBaseUrl)?.id ??
      "custom"
    );
  }, [config.baseUrl]);

  const providerSummary = useMemo(() => {
    const url = config.baseUrl || "未设置";
    const keyStatus = config.hasKey ? "全局 Key 已设置" : "未设置全局 Key";
    return `${url} · ${keyStatus}`;
  }, [config.baseUrl, config.hasKey]);

  const update = (key: keyof SettingsState, value: string) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

  const applyPreset = (preset: ProviderPreset) => {
    if (preset.id === "custom") return;
    setConfig((current) => ({
      ...current,
      baseUrl: preset.baseUrl,
      visionModel: preset.visionModel,
      imageModel: preset.imageModel,
      textModel: preset.textModel,
      visionBaseUrl: "",
      imageBaseUrl: "",
      textBaseUrl: "",
    }));
    showToast(`已套用 ${preset.label}，保存后生效`);
  };

  const useGlobalKeyForAll = () => {
    setConfig((current) => ({
      ...current,
      visionApiKey: "",
      imageApiKey: "",
      textApiKey: "",
    }));
    setClearRoleKeys({ vision: true, image: true, text: true });
    showToast("三类模型将改用全局 Key");
  };

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, string> = {
        baseUrl: config.baseUrl.trim(),
        visionModel: config.visionModel.trim(),
        visionBaseUrl: config.visionBaseUrl.trim(),
        imageModel: config.imageModel.trim(),
        imageBaseUrl: config.imageBaseUrl.trim(),
        textModel: config.textModel.trim(),
        textBaseUrl: config.textBaseUrl.trim(),
      };

      if (config.apiKey.trim()) body.apiKey = config.apiKey.trim();
      for (const item of ROLE_CONFIG) {
        const value = String(config[item.keyKey] ?? "").trim();
        if (value || clearRoleKeys[item.role]) {
          body[item.keyKey] = value;
        }
      }

      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "保存失败");

      const refreshed = await fetch("/api/settings", { cache: "no-store" }).then((res) => res.json());
      setConfig({ ...EMPTY, ...refreshed, apiKey: "", visionApiKey: "", imageApiKey: "", textApiKey: "" });
      setClearRoleKeys({ vision: false, image: false, text: false });
      showToast("已保存，新的 provider 配置已生效");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-warm-muted/40" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-3 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/canvas?restore=1"
            className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-warm-line/60 bg-warm-paper px-3 py-1.5 text-xs text-warm-muted transition hover:border-warm-primary/40 hover:text-warm-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            回到画布
          </Link>
          <h1 className="text-2xl font-semibold text-warm-ink">模型供应商设置</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-warm-muted">
            这里控制 Agent、图片理解和生图链路使用的 provider。Key 不会回显，留空不会修改已有 Key。
          </p>
        </div>
        <StatusPill ok={config.hasKey || config.hasImageKey || config.hasTextKey || config.hasVisionKey}>
          {providerSummary}
        </StatusPill>
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        {PROVIDER_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => applyPreset(preset)}
            className={`rounded-lg border p-4 text-left transition ${
              activePresetId === preset.id
                ? "border-warm-primary bg-warm-primary-soft/55 shadow-sm"
                : "border-warm-line/70 bg-warm-paper hover:border-warm-primary/45"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-warm-ink">{preset.label}</span>
              {activePresetId === preset.id && <Check className="h-4 w-4 text-warm-primary" />}
            </div>
            <p className="mt-2 min-h-10 text-xs leading-5 text-warm-muted">{preset.description}</p>
            {preset.baseUrl && (
              <div className="mt-3 truncate rounded bg-warm-bg px-2 py-1 text-[11px] text-warm-muted">
                {preset.baseUrl}
              </div>
            )}
          </button>
        ))}
      </section>

      <section className="rounded-xl border border-warm-line/70 bg-warm-paper p-4 shadow-sm">
        <SectionTitle icon={<Server className="h-4 w-4" />} title="全局连接" />
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.2fr]">
          <TextField
            label="全局 API Key"
            type="password"
            value={config.apiKey}
            onChange={(value) => update("apiKey", value)}
            placeholder={config.hasKey ? "已设置，留空不修改" : "sk-..."}
            hint={config.hasKey ? "已设置" : "未设置"}
          />
          <TextField
            label="全局 API 地址"
            value={config.baseUrl}
            onChange={(value) => update("baseUrl", value)}
            placeholder="https://slb.apikey.fun/v1"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warm-bg px-3 py-2">
          <div className="flex items-start gap-2 text-xs leading-5 text-warm-muted">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>多数情况下只需要填全局 Key。三类模型的独立 Key 只在你要拆分 provider 时使用。</span>
          </div>
          <button
            type="button"
            onClick={useGlobalKeyForAll}
            className="inline-flex items-center gap-1.5 rounded-md border border-warm-line/70 bg-warm-paper px-2.5 py-1.5 text-xs font-medium text-warm-ink transition hover:border-warm-primary/45 hover:text-warm-primary"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            三类模型使用全局 Key
          </button>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        {ROLE_CONFIG.map((item) => (
          <ModelCard
            key={item.role}
            item={item}
            config={config}
            clearKey={clearRoleKeys[item.role]}
            onUpdate={update}
            onClearKey={() => {
              update(item.keyKey, "");
              setClearRoleKeys((current) => ({ ...current, [item.role]: true }));
            }}
          />
        ))}
      </section>

      <section className="rounded-xl border border-warm-line/70 bg-warm-paper p-4">
        <SectionTitle icon={<Sparkles className="h-4 w-4" />} title="当前将如何调用" />
        <div className="mt-3 grid gap-2 text-xs leading-5 text-warm-muted md:grid-cols-3">
          {ROLE_CONFIG.map((item) => (
            <div key={item.role} className="rounded-lg bg-warm-bg px-3 py-2">
              <div className="font-medium text-warm-ink">{item.title}</div>
              <div className="mt-1 truncate">{String(config[item.modelKey] || "未设置模型")}</div>
              <div className="truncate">{String(config[item.urlKey] || config.baseUrl || "未设置地址")}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex min-w-40 items-center justify-center gap-2 rounded-lg bg-warm-primary px-5 py-3 text-sm font-medium text-warm-paper shadow-lg transition hover:bg-warm-primary/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          保存配置
        </button>
      </div>

      {toast && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-warm-ink/90 px-4 py-2 text-xs text-warm-paper shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function ModelCard({
  item,
  config,
  clearKey,
  onUpdate,
  onClearKey,
}: {
  item: (typeof ROLE_CONFIG)[number];
  config: SettingsState;
  clearKey: boolean;
  onUpdate: (key: keyof SettingsState, value: string) => void;
  onClearKey: () => void;
}) {
  const hasIndependentKey = Boolean(config[item.hasKeyKey]);
  return (
    <div className="rounded-xl border border-warm-line/70 bg-warm-paper p-4 shadow-sm">
      <SectionTitle icon={<Sparkles className="h-4 w-4" />} title={item.title} />
      <p className="mt-1 text-xs leading-5 text-warm-muted">{item.subtitle}</p>
      <div className="mt-4 space-y-3">
        <TextField
          label="模型名"
          value={String(config[item.modelKey] ?? "")}
          onChange={(value) => onUpdate(item.modelKey, value)}
          placeholder={item.placeholder}
        />
        <TextField
          label="独立 Key"
          type="password"
          value={String(config[item.keyKey] ?? "")}
          onChange={(value) => onUpdate(item.keyKey, value)}
          placeholder={hasIndependentKey && !clearKey ? "已设置，留空不修改" : "留空使用全局 Key"}
          hint={clearKey ? "保存后改用全局 Key" : hasIndependentKey ? "独立 Key 已设置" : "使用全局 Key"}
        />
        {hasIndependentKey && !clearKey && (
          <button
            type="button"
            onClick={onClearKey}
            className="inline-flex items-center gap-1.5 rounded-md border border-warm-line/70 bg-warm-bg px-2.5 py-1.5 text-xs text-warm-muted transition hover:border-warm-primary/45 hover:text-warm-primary"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            改用全局 Key
          </button>
        )}
        <TextField
          label="独立 API 地址"
          value={String(config[item.urlKey] ?? "")}
          onChange={(value) => onUpdate(item.urlKey, value)}
          placeholder="留空使用全局地址"
        />
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  type?: "text" | "password";
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs font-medium text-warm-ink">{label}</span>
        {hint && <span className="rounded bg-warm-bg px-1.5 py-0.5 text-[10px] text-warm-muted">{hint}</span>}
      </div>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-warm-line/75 bg-warm-bg px-3 text-sm text-warm-ink outline-none transition placeholder:text-warm-muted/55 focus:border-warm-primary focus:bg-warm-paper focus:ring-2 focus:ring-warm-primary-soft"
      />
    </label>
  );
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-warm-ink">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-warm-primary-soft text-warm-primary">
        {icon}
      </span>
      {title}
    </div>
  );
}

function StatusPill({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div
      className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-2 text-xs ${
        ok
          ? "border-warm-primary/30 bg-warm-primary-soft/55 text-warm-primary"
          : "border-amber-200 bg-amber-50 text-amber-800"
      }`}
    >
      {ok ? <Check className="h-3.5 w-3.5 shrink-0" /> : <CircleAlert className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{children}</span>
    </div>
  );
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}
