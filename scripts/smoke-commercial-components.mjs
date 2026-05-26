import { spawn } from "node:child_process";
import { seedCommercialComponents } from "./seed-commercial-components.mjs";

const port = Number(process.env.COMPONENT_COMMERCIAL_SMOKE_PORT || 3464);
const baseUrl = `http://127.0.0.1:${port}`;

const requiredMinimums = {
  visual_style: 3,
  scene: 3,
  platform_rule: 5,
  brand_kit: 1,
  quality_rule: 3,
  image_recipe: 6,
  output_pack: 6,
};

const requiredScenarios = [
  "taobao_detail",
  "amazon_main",
  "xiaohongshu_cover",
  "poster_campaign",
  "model_display",
  "product_detail_page",
];

const requiredTemplateScenarios = [
  "model_display",
  "product_detail_page",
  "platform_output_pack",
  "poster_campaign",
  "quality_review",
];

const requiredSeedKeys = [
  "commercial.visual_style.clean_ecommerce_white",
  "commercial.visual_style.premium_business_model",
  "commercial.visual_style.warm_lifestyle",
  "commercial.scene.home_lifestyle",
  "commercial.scene.cafe_lifestyle",
  "commercial.scene.office_business",
  "commercial.platform.amazon_main_image",
  "commercial.platform.taobao_detail_page",
  "commercial.platform.xiaohongshu_cover",
  "commercial.platform.poster_campaign",
  "commercial.platform.product_detail_page",
  "commercial.brand.default_commerce",
  "commercial.quality.product_consistency",
  "commercial.quality.platform_compliance",
  "commercial.quality.commercial_polish",
  "commercial.recipe.taobao_detail",
  "commercial.recipe.amazon_main",
  "commercial.recipe.model_display",
  "commercial.recipe.xiaohongshu_cover",
  "commercial.recipe.poster_campaign",
  "commercial.recipe.product_detail_page",
  "commercial.output_pack.taobao_detail",
  "commercial.output_pack.amazon_main",
  "commercial.output_pack.model_display",
  "commercial.output_pack.xiaohongshu_cover",
  "commercial.output_pack.poster_campaign",
  "commercial.output_pack.product_detail_page",
];

const server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

try {
  await waitForServer(`${baseUrl}/api/components`);
  const summary = await seedCommercialComponents({ baseUrl });
  const components = await fetchJson(`${baseUrl}/api/components`);
  const templates = await fetchJson(`${baseUrl}/api/workflow-templates`);
  const seeded = components.filter((component) => requiredSeedKeys.includes(component?.metadata?.seedKey));

  if (seeded.length < requiredSeedKeys.length) {
    throw new Error(`Expected ${requiredSeedKeys.length} seeded components, found ${seeded.length}`);
  }

  const presentKeys = new Set(seeded.map((component) => component.metadata.seedKey));
  for (const seedKey of requiredSeedKeys) {
    if (!presentKeys.has(seedKey)) {
      throw new Error(`Missing seeded component ${seedKey}`);
    }
  }

  const counts = {};
  for (const component of seeded) {
    const type = component.metadata?.componentType || component.type;
    counts[type] = (counts[type] || 0) + 1;
    if (component.metadata?.componentType !== component.type) {
      throw new Error(`Component ${component.title} was not schema-normalized`);
    }
    if (!Array.isArray(component.metadata?.inputs) || !Array.isArray(component.metadata?.outputs)) {
      throw new Error(`Component ${component.title} is missing normalized ports`);
    }
    assertCommercialSeedMetadata(component);
  }

  for (const [type, minimum] of Object.entries(requiredMinimums)) {
    if ((counts[type] || 0) < minimum) {
      throw new Error(`Expected at least ${minimum} ${type} seeds, found ${counts[type] || 0}`);
    }
  }

  for (const scenario of requiredScenarios) {
    assertScenarioCoverage(seeded, scenario);
  }

  for (const scenario of requiredTemplateScenarios) {
    const template = templates.find((item) => item?.metadata?.scenario === scenario);
    if (!template) {
      throw new Error(`Missing workflow template scenario metadata for ${scenario}`);
    }
    assertTemplateMetadata(template);
  }

  console.log(
    `Commercial component seed smoke passed on ${baseUrl}: ${seeded.length} seeds; ` +
      `${summary.created} created, ${summary.updated} updated, ${summary.unchanged} unchanged.`
  );
  console.log(`Counts: ${Object.entries(counts).map(([type, count]) => `${type}=${count}`).join(", ")}`);
  console.log(`Scenario coverage: ${requiredScenarios.join(", ")}`);
} finally {
  server.kill("SIGTERM");
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) break;
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`Next dev server did not become ready.\n${serverOutput.slice(-2000)}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}`);
  }
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertCommercialSeedMetadata(component) {
  const parameters = component.metadata?.parameters || {};
  const seedKey = component.metadata?.seedKey;

  if (component.type === "platform_rule") {
    for (const field of ["platform", "aspectRatios", "sizes", "imageCount", "requiredAssets", "costTier", "suitableFor", "exportNaming"]) {
      assertPresent(parameters[field], `${seedKey} parameters.${field}`);
    }
  }

  if (component.type === "image_recipe") {
    for (const field of ["platformRules", "brandConstraints", "styleConstraints", "outputPack", "shotList", "outputCount"]) {
      assertPresent(parameters[field], `${seedKey} parameters.${field}`);
    }
  }

  if (component.type === "output_pack") {
    for (const field of ["platformRules", "imageRecipe", "brandConstraints", "deliverables", "fileNaming"]) {
      assertPresent(parameters[field], `${seedKey} parameters.${field}`);
    }
  }
}

function assertScenarioCoverage(seeded, scenario) {
  const matchingKeys = seeded
    .map((component) => component?.metadata?.seedKey)
    .filter((key) => typeof key === "string" && key.includes(scenario));

  const hasPlatform = matchingKeys.some((key) => key.startsWith("commercial.platform."));
  const hasRecipe = matchingKeys.some((key) => key.startsWith("commercial.recipe."));
  const hasOutputPack = matchingKeys.some((key) => key.startsWith("commercial.output_pack."));

  if (!hasRecipe || !hasOutputPack) {
    throw new Error(`Scenario ${scenario} requires recipe and output pack seeds; found ${matchingKeys.join(", ")}`);
  }

  if (!hasPlatform && !["model_display"].includes(scenario)) {
    throw new Error(`Scenario ${scenario} requires a platform rule seed; found ${matchingKeys.join(", ")}`);
  }
}

function assertTemplateMetadata(template) {
  const metadata = template.metadata || {};
  for (const field of [
    "platforms",
    "sizes",
    "aspectRatios",
    "imageCount",
    "requiredAssets",
    "qualityRules",
    "costTier",
    "prohibitions",
    "outputNaming",
    "suitableFor",
  ]) {
    assertPresent(metadata[field], `${template.id} metadata.${field}`);
  }
}

function assertPresent(value, label) {
  if (Array.isArray(value)) {
    if (value.length === 0) throw new Error(`Missing ${label}`);
    return;
  }
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing ${label}`);
  }
}
