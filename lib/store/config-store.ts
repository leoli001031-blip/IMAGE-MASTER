// Server-side config backed by SQLite + env var fallback.
// Cache in memory for hot-path reads, persist writes to DB.
import "server-only";

import db from "./db";

export interface AppConfig {
  // Global fallback
  apiKey: string;
  baseUrl: string;
  // Vision model
  visionModel: string;
  visionApiKey: string;
  visionBaseUrl: string;
  // Image model
  imageModel: string;
  imageApiKey: string;
  imageBaseUrl: string;
  // Text model
  textModel: string;
  textApiKey: string;
  textBaseUrl: string;
}

let cache: AppConfig | null = null;

const CONFIG_DEFAULTS: Record<string, string> = {
  apiKey: "",
  baseUrl: "https://slb.apikey.fun/v1",
  visionModel: "gpt-5.5",
  visionApiKey: "",
  visionBaseUrl: "",
  imageModel: "gpt-5.5",
  imageApiKey: "",
  imageBaseUrl: "",
  textModel: "gpt-5.5",
  textApiKey: "",
  textBaseUrl: "",
};

function loadCache(): AppConfig {
  if (cache) return cache;

  const config: Record<string, string> = {};

  const rows = db.prepare("SELECT key, value FROM config").all() as { key: string; value: string }[];
  for (const { key, value } of rows) {
    if (key in CONFIG_DEFAULTS) config[key] = value;
  }

  cache = {
    apiKey: config.apiKey || process.env.OPENAI_API_KEY || "",
    baseUrl: config.baseUrl || process.env.OPENAI_BASE_URL || CONFIG_DEFAULTS.baseUrl,
    visionModel: config.visionModel || process.env.VISION_MODEL || CONFIG_DEFAULTS.visionModel,
    visionApiKey: config.visionApiKey || process.env.VISION_API_KEY || "",
    visionBaseUrl: config.visionBaseUrl || process.env.VISION_BASE_URL || "",
    imageModel: config.imageModel || process.env.IMAGE_MODEL || CONFIG_DEFAULTS.imageModel,
    imageApiKey: config.imageApiKey || process.env.IMAGE_API_KEY || "",
    imageBaseUrl: config.imageBaseUrl || process.env.IMAGE_BASE_URL || "",
    textModel: config.textModel || process.env.TEXT_MODEL || CONFIG_DEFAULTS.textModel,
    textApiKey: config.textApiKey || process.env.TEXT_API_KEY || "",
    textBaseUrl: config.textBaseUrl || process.env.TEXT_BASE_URL || "",
  };

  return cache;
}

export function getConfig(): AppConfig {
  return loadCache();
}

export function updateConfig(updates: Partial<AppConfig>): void {
  const upsert = db.prepare(
    "INSERT INTO config (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value=@value"
  );

  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(updates)) {
      if (key in CONFIG_DEFAULTS && value !== undefined) {
        upsert.run({ key, value });
      }
    }
  });

  tx();

  // Invalidate cache so next read picks up the new values
  cache = null;
}

export function getConfigPublic(): Omit<AppConfig, "apiKey" | "visionApiKey" | "imageApiKey" | "textApiKey"> {
  const c = getConfig();
  return {
    baseUrl: c.baseUrl,
    visionModel: c.visionModel,
    visionBaseUrl: c.visionBaseUrl,
    imageModel: c.imageModel,
    imageBaseUrl: c.imageBaseUrl,
    textModel: c.textModel,
    textBaseUrl: c.textBaseUrl,
  };
}
