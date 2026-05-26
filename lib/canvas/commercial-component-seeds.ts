import rawCommercialComponentSeeds from "./commercial-component-seeds.json";
import { normalizeComponentMetadata, normalizeComponentRules } from "@/lib/canvas/component-schema";
import type { CreateComponentParams, StandardComponentType } from "@/lib/types";

export type CommercialComponentSeed = CreateComponentParams & {
  type: StandardComponentType;
  metadata: Record<string, unknown> & {
    seedKey: string;
  };
};

export const COMMERCIAL_COMPONENT_SEED_VERSION = "commercial-component-seeds-v1";

export const COMMERCIAL_TEMPLATE_SCENARIOS = [
  "taobao_detail",
  "amazon_main",
  "xiaohongshu_cover",
  "poster_campaign",
  "model_display",
  "product_detail_page",
] as const;

export type CommercialTemplateScenario = (typeof COMMERCIAL_TEMPLATE_SCENARIOS)[number];

type RawCommercialComponentSeed = {
  type: string;
  title: string;
  description?: string;
  status?: string;
  rules?: Record<string, unknown>;
  metadata: Record<string, unknown> & {
    seedKey: string;
  };
};

const rawSeeds = rawCommercialComponentSeeds as RawCommercialComponentSeed[];

export const COMMERCIAL_COMPONENT_SEEDS: CommercialComponentSeed[] = rawSeeds.map((seed) => {
  const type = seed.type as StandardComponentType;
  const metadata = normalizeComponentMetadata(type, seed.metadata);

  return {
    type,
    title: seed.title,
    description: seed.description,
    status: seed.status,
    rules: normalizeComponentRules(seed.rules),
    metadata: {
      ...metadata,
      seedKey: String(seed.metadata.seedKey),
      seedVersion: COMMERCIAL_COMPONENT_SEED_VERSION,
    },
  };
});

export function getCommercialSeedKeys(): string[] {
  return COMMERCIAL_COMPONENT_SEEDS.map((seed) => seed.metadata.seedKey);
}

export function getCommercialSeedKeysByScenario(scenario: CommercialTemplateScenario): string[] {
  return COMMERCIAL_COMPONENT_SEEDS
    .map((seed) => seed.metadata.seedKey)
    .filter((seedKey) => seedKey.includes(scenario));
}
