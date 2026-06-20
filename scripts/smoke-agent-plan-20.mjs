#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const port = Number(process.env.AGENT_PLAN_20_SMOKE_PORT || 3536);
const externalBaseUrl = process.env.AGENT_PLAN_20_SMOKE_BASE_URL?.trim();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const shouldSpawnServer = !externalBaseUrl;
const agentPlanMode = process.env.AGENT_PLAN_20_MODE?.trim() || "llm";
const scenarioIdsFilter = (process.env.AGENT_PLAN_20_SCENARIO_IDS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(process.cwd(), "test_artifacts", "api-smoke", `agent-plan-20-${stamp}`);
const reportPath = path.join(outDir, "report.json");
const distDir = process.env.AGENT_PLAN_20_SMOKE_DIST_DIR ||
  path.join(".next-smoke", `agent-plan-20-${stamp}`);
const sourceFileSnapshots = shouldSpawnServer
  ? snapshotSourceFiles(["tsconfig.json", "next-env.d.ts"])
  : [];
let server;
let serverOutput = "";

if (shouldSpawnServer) {
  server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_DIST_DIR: distDir,
      WATCHPACK_POLLING: process.env.WATCHPACK_POLLING || "true",
      IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER: "",
      IMAGE_MASTER_ENABLE_MOCK_BATCH: "",
      IMAGE_MASTER_DISABLE_AGENT_PLAN_LLM: "",
      IMAGE_MASTER_ALLOW_AGENT_PLAN_FALLBACK: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
}

const scenarios = selectScenarios(buildScenarios());
const reports = [];
const issues = [];

try {
  fs.mkdirSync(outDir, { recursive: true });
  await waitForServer(`${baseUrl}/api/settings`);

  for (const [index, scenario] of scenarios.entries()) {
    const started = Date.now();
    console.log(`Running plan scenario ${index + 1}/${scenarios.length}: ${scenario.id}`);
    const response = await requestJson(`${baseUrl}/api/agent-plan`, {
      method: "POST",
      body: JSON.stringify({
        ...scenario.body,
        agentPlanMode,
      }),
    });
    const report = summarizeScenario(scenario, response, Date.now() - started);
    validateScenario(report, scenario);
    reports.push(report);
    console.log(
      `Finished ${scenario.id}: mode=${report.mode}; items=${report.itemCount}; composition=${report.compositionMode}; elapsed=${Math.round(report.elapsedMs / 1000)}s`
    );
  }

  const report = { baseUrl, scenarioCount: scenarios.length, scenarios: reports, issues };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  if (issues.length > 0) {
    throw new Error(`Agent plan ${scenarios.length}-scenario smoke found ${issues.length} issue(s). Report: ${reportPath}`);
  }
  console.log(`Agent plan ${scenarios.length}-scenario smoke passed on ${baseUrl}.`);
  console.log(`Scenarios: ${reports.length}; report: ${reportPath}`);
} catch (error) {
  if (!fs.existsSync(reportPath)) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify({ baseUrl, scenarioCount: scenarios.length, scenarios: reports, issues }, null, 2)}\n`);
  }
  console.error(error);
  if (serverOutput) {
    console.error("--- server output tail ---");
    console.error(serverOutput.slice(-5000));
  }
  process.exitCode = 1;
} finally {
  if (server) server.kill("SIGTERM");
  if (shouldSpawnServer && process.env.AGENT_PLAN_20_SMOKE_KEEP_DIST !== "1") {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  restoreSourceFiles(sourceFileSnapshots);
}

function snapshotSourceFiles(files) {
  return files.map((file) => ({
    file,
    exists: fs.existsSync(file),
    contents: fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "",
  }));
}

function restoreSourceFiles(snapshots) {
  for (const snapshot of snapshots) {
    if (snapshot.exists) {
      fs.writeFileSync(snapshot.file, snapshot.contents);
    } else {
      fs.rmSync(snapshot.file, { force: true });
    }
  }
}

function selectScenarios(allScenarios) {
  if (scenarioIdsFilter.length === 0) return allScenarios;
  return scenarioIdsFilter.map((id) => {
    const scenario = allScenarios.find((item) => item.id === id);
    if (!scenario) throw new Error(`Unknown scenario id: ${id}`);
    return scenario;
  });
}

function summarizeScenario(scenario, response, elapsedMs) {
  const plan = response.agentPlan;
  return {
    id: scenario.id,
    title: scenario.title,
    elapsedMs,
    ok: response.ok,
    validation: response.validation,
    mode: plan?.summary?.mode,
    fallbackUsed: plan?.summary?.fallbackUsed,
    fallbackReason: plan?.summary?.fallbackReason,
    compositionMode: plan?.compositionMode,
    selectedSkillIds: plan?.selectedSkillIds ?? [],
    itemCount: plan?.generationMatrix?.length ?? 0,
    expectedItemCount: scenario.expected.itemCount,
    assetGroups: plan?.assetGroups ?? [],
    generationMatrix: plan?.generationMatrix ?? [],
    missingInputs: plan?.missingInputs ?? [],
  };
}

function validateScenario(report, scenario) {
  const expectedValidationOk = scenario.expected.validationOk ?? true;
  if (report.ok !== expectedValidationOk) {
    addIssue(report.id, "draft_validation", `expected response ok=${expectedValidationOk}, got ${report.ok}`);
  }
  if (report.validation?.ok !== expectedValidationOk) {
    addIssue(report.id, "draft_validation", `expected validation ok=${expectedValidationOk}, got ${report.validation?.ok}`);
  }
  if (report.mode !== "llm_agent_plan_v1") {
    addIssue(report.id, "agent_mode", `expected llm_agent_plan_v1, got ${report.mode}`);
  }
  if (report.fallbackUsed) {
    addIssue(report.id, "agent_fallback", `fallback should stay off; reason=${report.fallbackReason || ""}`);
  }
  if (report.itemCount !== scenario.expected.itemCount) {
    addIssue(report.id, "item_count", `expected ${scenario.expected.itemCount} matrix items, got ${report.itemCount}`);
  }
  if (!Array.isArray(report.selectedSkillIds) || report.selectedSkillIds.length === 0) {
    addIssue(report.id, "skill_selection", "expected at least one selected workflow skill");
  }
  for (const skillId of scenario.expected.selectedSkillIds ?? []) {
    if (!report.selectedSkillIds.includes(skillId)) {
      addIssue(
        report.id,
        "skill_selection",
        `expected selected skill ${skillId}, got ${report.selectedSkillIds.join(",") || "none"}`
      );
    }
  }
  if (scenario.expected.compositionModes?.length && !scenario.expected.compositionModes.includes(report.compositionMode)) {
    addIssue(report.id, "composition_mode", `expected ${scenario.expected.compositionModes.join(" or ")}, got ${report.compositionMode}`);
  }

  for (const role of scenario.expected.availableRoles ?? []) {
    const hasRole = report.assetGroups.some((group) => group.role === role && group.available);
    if (!hasRole) addIssue(report.id, "available_role", `expected available ${role} asset group`);
  }
  for (const role of scenario.expected.missingRoles ?? []) {
    const missing = report.missingInputs.some((input) => input.role === role && input.blocking);
    if (!missing) addIssue(report.id, "missing_role", `expected blocking missing ${role}`);
  }
  for (const input of report.missingInputs ?? []) {
    const expectedMissingRoles = scenario.expected.missingRoles ?? [];
    if (input.blocking && !expectedMissingRoles.includes(input.role)) {
      addIssue(report.id, "missing_role", `unexpected blocking missing ${input.role}: ${input.label}`);
    }
  }

  const burnInCount = report.generationMatrix.filter((item) => item.copyMode === "burn_in").length;
  if (burnInCount < (scenario.expected.burnInMin ?? 0)) {
    addIssue(report.id, "copy_mode", `expected at least ${scenario.expected.burnInMin} burn_in item(s), got ${burnInCount}`);
  }
  if (scenario.expected.noBurnIn && burnInCount > 0) {
    addIssue(report.id, "copy_mode", `expected no burn_in items, got ${burnInCount}`);
  }
  for (const itemId of scenario.expected.layoutLayerItems ?? []) {
    const item = report.generationMatrix.find((candidate) => candidate.itemId === itemId);
    if (item?.copyMode !== "layout_layer") {
      addIssue(report.id, "copy_mode", `${itemId} expected layout_layer copy, got ${item?.copyMode || "missing"}`);
    }
  }

  for (const item of report.generationMatrix) {
    if (!item.itemId || !Array.isArray(item.referenceRoles) || !Array.isArray(item.providerReferenceRoles)) {
      addIssue(report.id, "matrix_shape", `invalid matrix item: ${JSON.stringify(item)}`);
      continue;
    }
    for (const role of item.providerReferenceRoles) {
      if (!item.referenceRoles.includes(role)) {
        addIssue(report.id, "reference_roles", `${item.title} provider role ${role} is not in referenceRoles`);
      }
      if (role === "copy") {
        addIssue(report.id, "provider_roles", `${item.title} should not send copy into providerReferenceRoles`);
      }
    }
    if (scenario.expected.oneProductGroupPerProductItem && item.referenceRoles.includes("product") && !item.missingInputIds?.includes("missing.product")) {
      const count = item.assetGroupIds.filter((id) => id.startsWith("asset.product.")).length;
      if (count !== 1) addIssue(report.id, "product_matrix", `${item.title} selected ${count} product groups`);
    }
    if (scenario.expected.oneSceneGroupPerSceneItem && item.referenceRoles.includes("scene") && !item.missingInputIds?.includes("missing.scene")) {
      const count = item.assetGroupIds.filter((id) => id.startsWith("asset.scene.")).length;
      if (count !== 1) addIssue(report.id, "scene_matrix", `${item.title} selected ${count} scene groups`);
    }
    if (scenario.expected.oneModelGroupPerModelItem && item.referenceRoles.includes("model") && !item.missingInputIds?.includes("missing.model")) {
      const count = item.assetGroupIds.filter((id) => id.startsWith("asset.model.")).length;
      if (count !== 1) addIssue(report.id, "model_matrix", `${item.title} selected ${count} model groups`);
    }
    const expectedProviderOptions = scenario.expected.providerRoleOptionsByItem?.[item.itemId];
    if (expectedProviderOptions) {
      const actual = [...item.providerReferenceRoles].sort();
      const matches = expectedProviderOptions.some((option) => {
        const expected = [...option].sort();
        return JSON.stringify(actual) === JSON.stringify(expected);
      });
      if (!matches) {
        addIssue(
          report.id,
          "provider_roles",
          `${item.title} expected provider roles one of ${expectedProviderOptions.map((option) => option.join(",") || "none").join(" / ")}, got ${actual.join(",") || "none"}`
        );
      }
      continue;
    }
    const expectedProviderRoles = scenario.expected.providerRolesByItem?.[item.itemId];
    if (expectedProviderRoles) {
      const actual = [...item.providerReferenceRoles].sort();
      const expected = [...expectedProviderRoles].sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        addIssue(report.id, "provider_roles", `${item.title} expected provider roles ${expected.join(",") || "none"}, got ${actual.join(",") || "none"}`);
      }
    }

    const expectedAssetTitles = scenario.expected.assetGroupTitleIncludesByItem?.[item.itemId];
    if (expectedAssetTitles) {
      const groupById = new Map(report.assetGroups.map((group) => [group.id, group]));
      for (const [role, fragments] of Object.entries(expectedAssetTitles)) {
        const selectedGroups = item.assetGroupIds
          .map((id) => groupById.get(id))
          .filter((group) => group?.role === role);
        const fragmentList = Array.isArray(fragments) ? fragments : [fragments];
        const matched = selectedGroups.some((group) => {
          const text = `${group.title} ${group.sourceKey}`.toLowerCase();
          return fragmentList.every((fragment) => text.includes(String(fragment).toLowerCase()));
        });
        if (!matched) {
          addIssue(
            report.id,
            "asset_group_match",
            `${item.title} expected ${role} group title/source to include ${fragmentList.join("+")}; got ${selectedGroups.map((group) => group?.title).join(",") || "none"}`
          );
        }
      }
    }
  }
}

function buildScenarios() {
  return [
    scenario({
      id: "template_taobao_short_brief",
      title: "模板意图 + 淘宝短需求",
      projectStarterPrompt: "淘宝详情页图组：上传真实商品后，规划主图、卖点海报、商品细节、使用场景和收尾转化图。商品身份必须强参考真实商品图；文案按每张图用途判断是否烧进画面，不能改商品包装标签。",
      request: "做 12 张，带模特；两张卖点标题直接进图。",
      refs: [
        ref("product", "鹅黄色手提包", "yellow_bag"),
        ref("model", "自然甜感模特", "soft_model"),
        ref("scene", "花店与咖啡厅", "florist_cafe"),
        ref("style", "真实生活方式摄影", "real_lifestyle"),
      ],
      copy: ["轻巧能装", "软糯云朵感"],
      items: [
        planItem("main", "主视觉", "product_model_scene", "商品和模特统一视觉主图。", ["product", "model", "scene", "style"]),
        planItem("feature_01", "卖点标题 1", "product_feature", "卖点标题烧进安全区。", ["product", "style", "copy"], { copyMode: "burn_in", copyText: "轻巧能装" }),
        planItem("feature_02", "卖点标题 2", "product_feature", "卖点标题烧进安全区。", ["product", "style", "copy"], { copyMode: "burn_in", copyText: "软糯云朵感" }),
        planItem("detail", "细节", "product_detail", "材质、五金和容量细节。", ["product", "style"]),
      ],
      expected: {
        itemCount: 4,
        burnInMin: 2,
        selectedSkillIds: ["workflow.taobao_detail.v1"],
        availableRoles: ["product", "model", "scene", "style", "copy"],
        oneProductGroupPerProductItem: true,
        oneModelGroupPerModelItem: true,
        providerRolesByItem: {
          main: ["product", "model", "scene"],
          feature_01: ["product"],
          feature_02: ["product"],
          detail: ["product"],
        },
      },
    }),
    scenario({
      id: "template_cross_platform_short_brief",
      title: "模板意图 + 跨平台短需求",
      projectStarterPrompt: "跨平台上市套图：同一真实商品拆成 Amazon 主图/辅图、社媒封面、商业海报和详情页卖点图。每张图自适应比例和平台用途；商品图强参考，风格和文案按用途调用。",
      request: "手机新品先做 6 张，海报要带一句短标题。",
      refs: [
        ref("product", "旗舰手机", "flagship_phone"),
        ref("scene", "城市夜景桌面", "night_city_desk"),
        ref("style", "高级科技产品摄影", "premium_tech"),
      ],
      copy: ["全新影像旗舰"],
      items: [
        planItem("amazon_main", "Amazon 主图", "product_hero", "白底或浅底平台主图。", ["product"]),
        planItem("amazon_feature", "Amazon 卖点图", "product_feature", "平台卖点图，文字后期可编辑。", ["product", "copy"], { copyMode: "layout_layer" }),
        planItem("social_cover", "社媒封面", "social_cover", "社媒封面短标题烧进安全区。", ["product", "scene", "style", "copy"], { ratio: "4:5", copyMode: "burn_in", copyText: "全新影像旗舰" }),
        planItem("detail", "详情页卖点", "product_detail", "材质、摄像头和握持细节。", ["product", "style"]),
      ],
      expected: {
        itemCount: 4,
        burnInMin: 1,
        layoutLayerItems: ["amazon_feature"],
        selectedSkillIds: ["workflow.amazon_listing.v1"],
        availableRoles: ["product", "scene", "style", "copy"],
        oneProductGroupPerProductItem: true,
        providerRolesByItem: {
          amazon_main: ["product"],
          amazon_feature: ["product"],
          social_cover: ["product", "scene"],
          detail: ["product"],
        },
      },
    }),
    scenario({
      id: "taobao_detail_burn_in",
      title: "淘宝详情页烧字",
      request: "给毛绒小包做淘宝详情页：主图、卖点图、材质细节，卖点图短文案烧进安全区。",
      platforms: ["taobao"],
      outputPacks: ["taobao_detail"],
      copyRenderMode: "burn_in",
      refs: [
        ref("product", "粉白毛绒小包", "plush_bag"),
        ref("model", "甜妹模特", "sweet_model"),
        ref("scene", "花店街边", "florist_street"),
        ref("style", "真实街拍", "street_style"),
      ],
      copy: ["软萌轻巧，出门刚好", "绒感蓬松", "小巧能装"],
      items: [
        planItem("main", "Main", "product_model_scene", "主视觉，统一整套视觉。", ["product", "model", "scene", "style"]),
        planItem("feature", "Feature", "product_feature", "卖点图，安全区放短文案。", ["product", "model", "style", "copy"], { copyMode: "burn_in", copyText: "软萌轻巧，出门刚好" }),
        planItem("material", "Material", "product_detail", "材质和五金细节。", ["product", "scene", "style"]),
      ],
      expected: {
        itemCount: 3,
        burnInMin: 1,
        availableRoles: ["product", "model", "scene", "style", "copy"],
        oneProductGroupPerProductItem: true,
        providerRolesByItem: {
          main: ["product", "model", "scene"],
          feature: ["product"],
        },
        providerRoleOptionsByItem: {
          material: [["product"], ["product", "scene"]],
        },
      },
    }),
    scenario({
      id: "amazon_listing_no_burn",
      title: "Amazon Listing 不烧字",
      request: "给人体工学无线鼠标做 Amazon listing 主图、信息图、尺寸图，默认不要把文字烧进图片。",
      platforms: ["amazon"],
      outputPacks: ["amazon_main"],
      copyRenderMode: "layout_layer",
      refs: [ref("product", "人体工学无线鼠标", "ergo_mouse"), ref("scene", "办公桌", "office_desk"), ref("style", "干净商品摄影", "clean_product")],
      copy: ["Silent Click", "Long Battery", "Ergonomic Grip"],
      items: [
        planItem("white", "White Main", "product_hero", "白底合规主图。", ["product"]),
        planItem("info", "Infographic", "product_feature", "信息图，文案后期叠加。", ["product", "copy"], { copyMode: "layout_layer" }),
        planItem("size", "Dimensions", "product_dimensions", "尺寸图。", ["product", "style"]),
      ],
      expected: {
        itemCount: 3,
        noBurnIn: true,
        layoutLayerItems: ["info"],
        availableRoles: ["product", "copy"],
        oneProductGroupPerProductItem: true,
        providerRolesByItem: {
          white: ["product"],
          info: ["product"],
          size: ["product"],
        },
      },
    }),
    scenario({
      id: "xiaohongshu_cover_set",
      title: "小红书封面组",
      request: "给粉色保温杯做两张小红书封面，标题需要直接出现在画面安全区。",
      platforms: ["xiaohongshu"],
      outputPacks: ["xiaohongshu_cover"],
      copyRenderMode: "burn_in",
      refs: [ref("product", "粉色保温杯", "pink_tumbler"), ref("scene", "晨光厨房", "morning_kitchen"), ref("style", "生活方式摄影", "lifestyle_style")],
      copy: ["早八也要热乎乎", "随身温柔补给"],
      items: [
        planItem("cover_01", "封面 1", "social_cover", "晨光厨房生活方式封面。", ["product", "scene", "style", "copy"], { ratio: "4:5", copyMode: "burn_in", copyText: "早八也要热乎乎" }),
        planItem("cover_02", "封面 2", "social_cover", "通勤桌面场景封面。", ["product", "scene", "style", "copy"], { ratio: "4:5", copyMode: "burn_in", copyText: "随身温柔补给" }),
      ],
      expected: {
        itemCount: 2,
        burnInMin: 2,
        availableRoles: ["product", "scene", "style", "copy"],
        oneProductGroupPerProductItem: true,
        providerRolesByItem: {
          cover_01: ["product", "scene"],
          cover_02: ["product", "scene"],
        },
      },
    }),
    scenario({
      id: "single_model_five_clothes",
      title: "单模特五件衣服",
      request: "同一个模特分别展示五件衣服，每件衣服单独生成一张，不要混成一件商品。",
      outputType: "single_model_multi_product",
      refs: [
        ref("model", "固定东亚模特", "fixed_model"),
        ref("product", "白色针织衫", "white_knit"),
        ref("product", "黑色西装", "black_blazer"),
        ref("product", "银色羽绒服", "silver_down"),
        ref("product", "蓝色牛仔外套", "denim_jacket"),
        ref("product", "米色风衣", "beige_trench"),
        ref("style", "真实街拍自然光", "street_photo"),
      ],
      items: ["白色针织衫", "黑色西装", "银色羽绒服", "蓝色牛仔外套", "米色风衣"].map((name, index) =>
        planItem(`look_${index + 1}`, name, "model_product", `${name}同模特展示。`, ["product", "model", "style"])
      ),
      expected: { itemCount: 5, availableRoles: ["product", "model"], compositionModes: ["single_model_multi_product", "multi_product_separate", "custom_matrix"], oneProductGroupPerProductItem: true, oneModelGroupPerModelItem: true },
    }),
    scenario({
      id: "single_product_four_scenes",
      title: "单商品四场景",
      request: "一个蓝牙音箱分别放在卧室、露营、厨房、办公桌四个场景，每个场景一张。",
      outputType: "single_product_multi_scene",
      refs: [
        ref("product", "蓝牙音箱", "speaker"),
        ref("scene", "卧室床头", "bedroom"),
        ref("scene", "户外露营", "camping"),
        ref("scene", "厨房台面", "kitchen"),
        ref("scene", "办公桌", "desk"),
        ref("style", "真实生活方式摄影", "real_life"),
      ],
      items: ["卧室", "露营", "厨房", "办公桌"].map((name, index) =>
        planItem(`scene_${index + 1}`, `${name}场景`, "product_scene", `${name}中的自然使用场景。`, ["product", "scene", "style"])
      ),
      expected: {
        itemCount: 4,
        availableRoles: ["product", "scene"],
        compositionModes: ["single_product_multi_scene", "product_scene", "custom_matrix"],
        oneProductGroupPerProductItem: true,
        oneSceneGroupPerSceneItem: true,
        providerRolesByItem: {
          scene_1: ["product", "scene"],
          scene_2: ["product", "scene"],
          scene_3: ["product", "scene"],
          scene_4: ["product", "scene"],
        },
      },
    }),
    scenario({
      id: "two_products_same_scene",
      title: "多商品同场景拆分",
      request: "两款包分别在同一个咖啡厅场景各做一张生活方式图，不要把两款包混在同一张图里。",
      outputType: "multi_product_same_scene",
      refs: [
        ref("product", "黑色通勤托特包", "black_commute_tote"),
        ref("product", "米白毛绒小包", "cream_plush_bag"),
        ref("scene", "暖光咖啡厅窗边", "warm_cafe_window"),
        ref("style", "真实生活方式摄影", "real_lifestyle"),
      ],
      items: [
        planItem("black_tote_cafe", "黑色通勤托特包 · 咖啡厅", "product_scene", "黑色通勤托特包单独放在咖啡厅窗边桌面。", ["product", "scene", "style"]),
        planItem("cream_plush_cafe", "米白毛绒小包 · 咖啡厅", "product_scene", "米白毛绒小包单独放在同一个咖啡厅窗边桌面。", ["product", "scene", "style"]),
      ],
      expected: {
        itemCount: 2,
        availableRoles: ["product", "scene"],
        oneProductGroupPerProductItem: true,
        oneSceneGroupPerSceneItem: true,
        providerRolesByItem: {
          black_tote_cafe: ["product", "scene"],
          cream_plush_cafe: ["product", "scene"],
        },
        assetGroupTitleIncludesByItem: {
          black_tote_cafe: { product: "黑色通勤托特包", scene: "咖啡厅" },
          cream_plush_cafe: { product: "米白毛绒小包", scene: "咖啡厅" },
        },
      },
    }),
    scenario({
      id: "two_products_two_scenes",
      title: "多商品多场景矩阵",
      request: "银色羽绒服和黑色冲锋衣分别在雪山和咖啡厅两个场景做模特展示。",
      outputType: "multi_product_multi_scene_model_showcase",
      requiredReferenceRoles: ["product"],
      refs: [ref("product", "银色羽绒服", "silver_down"), ref("product", "黑色冲锋衣", "black_shell"), ref("model", "固定模特", "fixed_model"), ref("scene", "雪山", "snow_mountain"), ref("scene", "咖啡厅", "cafe")],
      items: [
        planItem("silver_snow", "银色羽绒服 · 雪山", "model_product_scene", "雪山自然光展示。", ["product", "model", "scene"]),
        planItem("black_snow", "黑色冲锋衣 · 雪山", "model_product_scene", "雪山自然光展示。", ["product", "model", "scene"]),
        planItem("silver_cafe", "银色羽绒服 · 咖啡厅", "model_product_scene", "咖啡厅室内抓拍。", ["product", "model", "scene"]),
        planItem("black_cafe", "黑色冲锋衣 · 咖啡厅", "model_product_scene", "咖啡厅室内抓拍。", ["product", "model", "scene"]),
      ],
      expected: {
        itemCount: 4,
        availableRoles: ["product", "model", "scene"],
        compositionModes: ["custom_matrix", "single_model_multi_product", "multi_product_separate"],
        oneProductGroupPerProductItem: true,
        oneSceneGroupPerSceneItem: true,
        oneModelGroupPerModelItem: true,
        providerRolesByItem: {
          silver_snow: ["product", "model", "scene"],
          black_snow: ["product", "model", "scene"],
          silver_cafe: ["product", "model", "scene"],
          black_cafe: ["product", "model", "scene"],
        },
      },
    }),
    scenario({
      id: "scrambled_two_products_two_scenes",
      title: "多商品多场景乱序矩阵",
      request: "银色羽绒服和黑色冲锋衣分别在雪山和咖啡厅两个场景做模特展示。条目顺序不是标准矩阵顺序，也要按文字匹配正确素材。",
      outputType: "multi_product_multi_scene_model_showcase",
      requiredReferenceRoles: ["product"],
      refs: [ref("product", "银色羽绒服", "silver_down"), ref("product", "黑色冲锋衣", "black_shell"), ref("model", "固定模特", "fixed_model"), ref("scene", "雪山", "snow_mountain"), ref("scene", "咖啡厅", "cafe")],
      items: [
        planItem("silver_snow_scrambled", "银色羽绒服 · 雪山", "model_product_scene", "雪山自然光展示。", ["product", "model", "scene"]),
        planItem("silver_cafe_scrambled", "银色羽绒服 · 咖啡厅", "model_product_scene", "咖啡厅室内抓拍。", ["product", "model", "scene"]),
        planItem("black_snow_scrambled", "黑色冲锋衣 · 雪山", "model_product_scene", "雪山自然光展示。", ["product", "model", "scene"]),
        planItem("black_cafe_scrambled", "黑色冲锋衣 · 咖啡厅", "model_product_scene", "咖啡厅室内抓拍。", ["product", "model", "scene"]),
      ],
      expected: {
        itemCount: 4,
        availableRoles: ["product", "model", "scene"],
        compositionModes: ["custom_matrix", "single_model_multi_product", "multi_product_separate"],
        oneProductGroupPerProductItem: true,
        oneSceneGroupPerSceneItem: true,
        oneModelGroupPerModelItem: true,
        providerRolesByItem: {
          silver_snow_scrambled: ["product", "model", "scene"],
          silver_cafe_scrambled: ["product", "model", "scene"],
          black_snow_scrambled: ["product", "model", "scene"],
          black_cafe_scrambled: ["product", "model", "scene"],
        },
        assetGroupTitleIncludesByItem: {
          silver_snow_scrambled: { product: "银色羽绒服", scene: "雪山" },
          silver_cafe_scrambled: { product: "银色羽绒服", scene: "咖啡厅" },
          black_snow_scrambled: { product: "黑色冲锋衣", scene: "雪山" },
          black_cafe_scrambled: { product: "黑色冲锋衣", scene: "咖啡厅" },
        },
      },
    }),
    scenario({
      id: "product_multiview_white_sheet",
      title: "商品多角度白底",
      request: "根据多张包包参考图生成一张多角度白底商品图，包含正面、侧面、背面、细节。",
      outputType: "product_multiview_white_sheet",
      refs: [
        ref("product", "黑色托特包正面", "tote_front", { assetId: "black_tote" }),
        ref("product", "黑色托特包侧面", "tote_side", { assetId: "black_tote" }),
        ref("product", "黑色托特包五金", "tote_detail", { assetId: "black_tote" }),
      ],
      items: [
        planItem("front", "正面", "product_white_angle", "正面白底。", ["product"]),
        planItem("side", "侧面", "product_white_angle", "侧面白底。", ["product"]),
        planItem("back", "背面", "product_white_angle", "背面白底。", ["product"]),
        planItem("detail", "细节", "product_macro", "五金和材质细节。", ["product"]),
      ],
      expected: {
        itemCount: 4,
        availableRoles: ["product"],
        compositionModes: ["single_product", "product_only"],
        oneProductGroupPerProductItem: true,
        providerRolesByItem: {
          front: ["product"],
          side: ["product"],
          back: ["product"],
          detail: ["product"],
        },
      },
    }),
    scenario({
      id: "model_asset_generation",
      title: "模特参考资产",
      request: "生成一个亚裔年轻女性自然光下游身份参考资产，不是最终成片。",
      outputType: "reference_asset",
      refs: [ref("style", "自然漫射光人像", "neutral_portrait_style")],
      items: [
        planItem("identity", "下游身份参考", "model_identity_reference_asset", "自然漫射光、非棚拍、脸部清晰。", ["model", "style"]),
        planItem("model_card", "展示模卡", "model_card_asset", "四视图加一张特写。", ["model", "style"]),
      ],
      expected: { itemCount: 2, availableRoles: ["style"], compositionModes: ["style_campaign", "multi_model_variation", "text_only"] },
    }),
    scenario({
      id: "scene_asset_multi_angle",
      title: "场景资产多视角",
      request: "生成一个北欧家居场景参考资产，需要总览、正面、侧面三个视角。",
      outputType: "scene_asset",
      refs: [ref("style", "北欧自然光家居摄影", "nordic_style")],
      items: [
        planItem("overview", "总览", "scene_overview_asset", "交代空间关系。", ["scene", "style"], { ratio: "16:9" }),
        planItem("front", "正面视角", "scene_angle_asset", "正面空间视角。", ["scene", "style"], { ratio: "3:2" }),
        planItem("side", "侧面视角", "scene_angle_asset", "侧面空间视角。", ["scene", "style"], { ratio: "3:2" }),
      ],
      expected: { itemCount: 3, availableRoles: ["style"], compositionModes: ["style_campaign", "multi_scene_variation", "text_only"] },
    }),
    scenario({
      id: "style_asset_prompt",
      title: "风格资产",
      request: "生成一个真实街拍商业摄影风格资产，后续给服装和包包组图复用。",
      outputType: "style_asset",
      refs: [],
      items: [planItem("style", "真实街拍商业风格", "style_reference_asset", "真实摄影、自然光、低棚拍感。", ["style"])],
      expected: { itemCount: 1, compositionModes: ["style_campaign", "text_only"] },
    }),
    scenario({
      id: "copy_layer_export",
      title: "文案层不烧字",
      request: "帮一套手机海报规划文案层，文案不要烧进图，作为可编辑图层。",
      copyRenderMode: "layout_layer",
      refs: [ref("product", "手机", "phone"), ref("style", "科技海报风格", "tech_poster")],
      copy: ["轻薄旗舰", "夜景更清晰", "续航一整天"],
      items: [
        planItem("hero", "主视觉", "poster_hero", "留出标题安全区。", ["product", "style", "copy"], { copyMode: "layout_layer" }),
        planItem("detail", "卖点图", "poster_feature", "卖点图层后期叠加。", ["product", "style", "copy"], { copyMode: "layout_layer" }),
      ],
      expected: { itemCount: 2, noBurnIn: true, layoutLayerItems: ["hero", "detail"], availableRoles: ["product", "style", "copy"], oneProductGroupPerProductItem: true },
    }),
    scenario({
      id: "product_model_scene_copy_burn",
      title: "商品模特场景文案混合",
      request: "用同一个模特拿着毛绒包，在花店和咖啡厅做 4 张图，其中两张要把短标题烧进安全区。",
      copyRenderMode: "burn_in",
      refs: [ref("product", "毛绒包", "plush_bag"), ref("model", "甜妹模特", "sweet_model"), ref("scene", "花店", "florist"), ref("scene", "咖啡厅", "cafe"), ref("style", "自然街拍", "street_style")],
      copy: ["Soft day out", "甜感刚好"],
      items: [
        planItem("florist_hero", "花店主视觉", "model_product_scene", "花店主视觉烧标题。", ["product", "model", "scene", "style", "copy"], { copyMode: "burn_in", copyText: "Soft day out" }),
        planItem("florist_plain", "花店无字", "model_product_scene", "花店无字展示。", ["product", "model", "scene", "style"]),
        planItem("cafe_hero", "咖啡厅标题", "model_product_scene", "咖啡厅标题图。", ["product", "model", "scene", "style", "copy"], { copyMode: "burn_in", copyText: "甜感刚好" }),
        planItem("cafe_plain", "咖啡厅无字", "model_product_scene", "咖啡厅无字展示。", ["product", "model", "scene", "style"]),
      ],
      expected: {
        itemCount: 4,
        burnInMin: 2,
        availableRoles: ["product", "model", "scene", "copy"],
        oneProductGroupPerProductItem: true,
        oneSceneGroupPerSceneItem: true,
        oneModelGroupPerModelItem: true,
        providerRolesByItem: {
          florist_hero: ["product", "model", "scene"],
          florist_plain: ["product", "model", "scene"],
          cafe_hero: ["product", "model", "scene"],
          cafe_plain: ["product", "model", "scene"],
        },
      },
    }),
    scenario({
      id: "concept_product_mockup",
      title: "概念商品无真实锁图",
      request: "概念商品 mockup：设计一个未来感香薰机，不是真实商品投放，只做方向探索。",
      outputType: "concept_product",
      refs: [ref("style", "未来家居设计", "future_home")],
      items: [
        planItem("concept_hero", "概念主视觉", "concept_product_hero", "未来感香薰机概念主视觉。", ["style"], { ratio: "3:2" }),
        planItem("concept_detail", "概念细节", "concept_product_detail", "材质和灯光细节。", ["style"], { ratio: "1:1" }),
      ],
      expected: { itemCount: 2, availableRoles: ["style"], compositionModes: ["style_campaign", "text_only"] },
    }),
    scenario({
      id: "packaging_label_design",
      title: "包装标签设计",
      request: "给咖啡豆包装做标签设计 mockup，这次允许文字出现在包装标签上。",
      copyRenderMode: "burn_in",
      refs: [ref("product", "咖啡豆包装袋", "coffee_pack"), ref("style", "精品咖啡包装设计", "coffee_brand")],
      copy: ["MOUNTAIN BLEND", "Medium Roast"],
      items: [
        planItem("pack_front", "包装正面", "packaging_label_design", "包装正面标签设计。", ["product", "style", "copy"], { copyMode: "burn_in", copyText: "MOUNTAIN BLEND" }),
        planItem("pack_scene", "包装场景", "packaging_scene", "咖啡店台面场景。", ["product", "style"]),
      ],
      expected: { itemCount: 2, burnInMin: 1, availableRoles: ["product", "style", "copy"], oneProductGroupPerProductItem: true },
    }),
    scenario({
      id: "furniture_scene_detail",
      title: "家具多角度详情",
      request: "北欧单人椅做商品图、客厅场景图、材质细节和尺寸对比。",
      refs: [ref("product", "北欧单人椅", "nordic_chair"), ref("scene", "客厅", "living_room"), ref("style", "自然光家居摄影", "home_photo")],
      items: [
        planItem("main", "商品主图", "product_hero", "白底或浅背景主图。", ["product"]),
        planItem("scene", "客厅场景", "product_scene", "放入客厅场景。", ["product", "scene", "style"]),
        planItem("material", "材质细节", "product_detail", "织物和木质扶手细节。", ["product", "style"]),
        planItem("size", "尺寸对比", "product_dimensions", "人物或空间比例对比。", ["product", "scene"]),
      ],
      expected: {
        itemCount: 4,
        availableRoles: ["product", "scene"],
        oneProductGroupPerProductItem: true,
        oneSceneGroupPerSceneItem: true,
        providerRolesByItem: {
          main: ["product"],
          scene: ["product", "scene"],
          size: ["product"],
        },
        providerRoleOptionsByItem: {
          material: [["product"], ["product", "style"]],
        },
      },
    }),
    scenario({
      id: "jewelry_macro_detail",
      title: "珠宝微距详情",
      request: "给银色项链做淘宝主图、佩戴图、微距材质图、礼盒场景图。",
      platforms: ["taobao"],
      outputPacks: ["taobao_detail"],
      refs: [ref("product", "银色项链", "silver_necklace"), ref("model", "颈部佩戴模特", "neck_model"), ref("scene", "礼盒桌面", "gift_table"), ref("style", "珠宝微距摄影", "jewelry_macro")],
      items: [
        planItem("main", "主图", "jewelry_main", "干净主图。", ["product", "style"]),
        planItem("wear", "佩戴图", "jewelry_model", "颈部佩戴展示。", ["product", "model", "style"]),
        planItem("macro", "微距", "jewelry_macro", "链条和吊坠微距。", ["product", "style"]),
        planItem("gift", "礼盒场景", "jewelry_scene", "礼盒桌面场景。", ["product", "scene", "style"]),
      ],
      expected: { itemCount: 4, availableRoles: ["product", "model", "scene"], oneProductGroupPerProductItem: true },
    }),
    scenario({
      id: "beverage_poster_burn",
      title: "饮料海报烧字",
      request: "给气泡水做夏日海报组，三张都需要短标题烧进画面安全区。",
      copyRenderMode: "burn_in",
      refs: [ref("product", "气泡水瓶", "sparkling_water"), ref("scene", "泳池边", "pool"), ref("style", "清爽夏日广告", "summer_ad")],
      copy: ["Fresh Splash", "Zero Sugar", "Ice Cold"],
      items: ["Fresh Splash", "Zero Sugar", "Ice Cold"].map((text, index) =>
        planItem(`poster_${index + 1}`, `海报 ${index + 1}`, "poster", `夏日海报 ${index + 1}。`, ["product", "scene", "style", "copy"], { ratio: "4:5", copyMode: "burn_in", copyText: text })
      ),
      expected: {
        itemCount: 3,
        burnInMin: 3,
        availableRoles: ["product", "scene", "copy"],
        oneProductGroupPerProductItem: true,
        providerRolesByItem: {
          poster_1: ["product", "scene"],
          poster_2: ["product", "scene"],
          poster_3: ["product", "scene"],
        },
      },
    }),
    scenario({
      id: "appliance_detail_page",
      title: "小家电详情页",
      request: "便携咖啡机做详情页：白底主图、厨房场景、露营场景、步骤图、材质特写。",
      platforms: ["taobao"],
      outputPacks: ["taobao_detail"],
      refs: [ref("product", "便携咖啡机", "portable_espresso"), ref("scene", "厨房", "kitchen"), ref("scene", "露营", "camping"), ref("style", "高级商品摄影", "premium_product")],
      items: [
        planItem("white", "白底主图", "product_hero", "白底主图。", ["product"]),
        planItem("kitchen", "厨房场景", "product_scene", "厨房台面场景。", ["product", "scene", "style"]),
        planItem("camp", "露营场景", "product_scene", "户外露营场景。", ["product", "scene", "style"]),
        planItem("steps", "步骤图", "product_steps", "使用步骤图，文案后期加。", ["product", "copy"], { copyMode: "layout_layer" }),
        planItem("material", "材质特写", "product_detail", "金属萃取头细节。", ["product", "style"]),
      ],
      expected: {
        itemCount: 5,
        noBurnIn: true,
        layoutLayerItems: ["steps"],
        availableRoles: ["product", "scene", "style"],
        oneProductGroupPerProductItem: true,
        providerRolesByItem: {
          white: ["product"],
          kitchen: ["product", "scene"],
          camp: ["product", "scene"],
          steps: ["product"],
        },
        providerRoleOptionsByItem: {
          material: [["product"], ["product", "style"]],
        },
      },
    }),
    scenario({
      id: "same_scene_variations",
      title: "同场地发散",
      request: "基于同一个咖啡厅场景，为同一个包包生成四个不同机位和姿态。",
      refs: [ref("product", "棕色通勤包", "brown_bag"), ref("model", "通勤女性模特", "commute_model"), ref("scene", "咖啡厅", "cafe_space"), ref("style", "真实抓拍", "snapshot_style")],
      items: ["靠窗坐姿", "门口回头", "桌边拿包", "走廊侧身"].map((pose, index) =>
        planItem(`angle_${index + 1}`, pose, "model_product_scene", `${pose}，同场地不同机位。`, ["product", "model", "scene", "style"])
      ),
      expected: {
        itemCount: 4,
        availableRoles: ["product", "model", "scene"],
        compositionModes: ["single_product_multi_scene", "product_model_scene", "custom_matrix"],
        oneProductGroupPerProductItem: true,
        oneSceneGroupPerSceneItem: true,
        oneModelGroupPerModelItem: true,
        providerRolesByItem: {
          angle_1: ["product", "model", "scene"],
          angle_2: ["product", "model", "scene"],
          angle_3: ["product", "model", "scene"],
          angle_4: ["product", "model", "scene"],
        },
      },
    }),
    scenario({
      id: "multi_model_same_product",
      title: "多模特同商品",
      request: "同一款太阳镜分别给三位不同气质模特展示，每位一张街拍。",
      refs: [ref("product", "太阳镜", "sunglasses"), ref("model", "酷感模特", "cool_model"), ref("model", "甜感模特", "sweet_model"), ref("model", "成熟商务模特", "business_model"), ref("scene", "城市街头", "city_street"), ref("style", "真实街拍", "street_style")],
      items: ["酷感模特", "甜感模特", "成熟商务模特"].map((name, index) =>
        planItem(`model_${index + 1}`, name, "model_product_scene", `${name}佩戴太阳镜街拍。`, ["product", "model", "scene", "style"])
      ),
      expected: { itemCount: 3, availableRoles: ["product", "model", "scene"], compositionModes: ["multi_model_variation", "product_model_scene", "custom_matrix"], oneProductGroupPerProductItem: true, oneModelGroupPerModelItem: true },
    }),
    scenario({
      id: "missing_real_product_guard",
      title: "真实商品缺参考",
      request: "给一个真实商品做淘宝主图，但我还没上传商品图。",
      requiredReferenceRoles: ["product"],
      refs: [ref("style", "干净商品摄影", "clean_product")],
      items: [planItem("main", "真实商品主图", "product_hero", "必须保持真实商品身份。", ["product", "style"])],
      expected: { itemCount: 1, validationOk: false, missingRoles: ["product"], compositionModes: ["product_only", "style_campaign"] },
    }),
    scenario({
      id: "prompt_knowledge_reference",
      title: "知识文案资产参与规划",
      request: "用我提供的构图知识和卖点文案，给护肤品规划三张高级海报，文案只做图层。",
      copyRenderMode: "layout_layer",
      refs: [ref("product", "护肤精华瓶", "skincare_bottle"), ref("style", "高级护肤品摄影", "skincare_style")],
      copy: ["敏感肌友好", "屏障修护", "清爽不黏"],
      extraRoles: {
        copy: {
          role: "copy",
          title: "护肤品卖点和构图知识",
          sourceNodeIds: ["knowledge_copy_node"],
          componentIds: [],
          assetIds: [],
          promptFragments: ["构图避免廉价电商感，留出右上安全区。", "卖点分层：核心利益、肤感、成分背书。"],
          constraints: ["文案默认作为可编辑 layout layer。"],
          negativeRules: ["不要夸大医疗功效。"],
          qualityRules: ["文案和画面信息层级清楚。"],
        },
      },
      items: [
        planItem("hero", "品牌主视觉", "skincare_hero", "高级主视觉。", ["product", "style", "copy"], { copyMode: "layout_layer" }),
        planItem("texture", "肤感卖点", "skincare_feature", "肤感和质地卖点。", ["product", "style", "copy"], { copyMode: "layout_layer" }),
        planItem("ingredient", "成分背书", "skincare_detail", "成分背书图。", ["product", "style", "copy"], { copyMode: "layout_layer" }),
      ],
      expected: { itemCount: 3, noBurnIn: true, layoutLayerItems: ["hero", "texture", "ingredient"], availableRoles: ["product", "style", "copy"], oneProductGroupPerProductItem: true },
    }),
  ];
}

function scenario({
  id,
  title,
  request,
  refs = [],
  items,
  expected,
  platforms = [],
  outputPacks = [],
  outputType,
  copyRenderMode = "metadata_only",
  copy = [],
  extraRoles = {},
  requiredReferenceRoles = [],
  projectStarterPrompt = "",
}) {
  const workflowId = `agent_plan_20_${id}_${stamp}`;
  const effectiveRequest = buildProjectAwareRequest(projectStarterPrompt, request);
  return {
    id,
    title,
    expected,
    body: {
      workflowId,
      frameNodeId: `${workflowId}_frame`,
      batchId: `${workflowId}_batch`,
      request: effectiveRequest,
      userRequest: request,
      brief: effectiveRequest,
      projectStarterPrompt: projectStarterPrompt || undefined,
      projectIntent: projectStarterPrompt || undefined,
      platforms,
      outputPacks,
      outputType,
      copyRenderMode,
      requiredReferenceRoles,
      referenceContext: referenceContext(`${workflowId}_ref`, refs, copy, extraRoles),
      items,
    },
  };
}

function buildProjectAwareRequest(projectStarterPrompt, request) {
  const starter = String(projectStarterPrompt || "").trim();
  const userRequest = String(request || "").trim();
  if (!starter) return userRequest;
  if (!userRequest) return starter;
  return [`项目模板意图：${starter}`, `用户本次需求：${userRequest}`].join("\n\n");
}

function planItem(itemId, title, type, prompt, referenceRoles, options = {}) {
  const ratio = options.ratio ?? (type.includes("cover") || type.includes("poster") ? "4:5" : "3:2");
  return {
    itemId,
    id: itemId,
    title,
    type,
    ratio,
    size: ratio === "1:1" ? "1024x1024" : ratio === "4:5" ? "1024x1280" : ratio === "16:9" ? "1536x864" : "1536x1024",
    prompt,
    copyText: options.copyText ?? "",
    copyRenderMode: options.copyMode ?? "metadata_only",
    referenceRoles,
    providerReferenceRoles: referenceRoles.filter((role) => role !== "copy"),
    metadata: { smoke: "agent-plan-20" },
  };
}

function referenceContext(targetNodeId, images, copyFragments = [], extraRoles = {}) {
  const roles = {};
  for (const role of ["product", "model", "scene", "style"]) {
    if (!images.some((image) => image.role === role)) continue;
    roles[role] = {
      role,
      title: role,
      sourceNodeIds: [],
      componentIds: [],
      assetIds: [],
      promptFragments: [],
      constraints: role === "product" ? ["商品真实身份必须锁定，不要重设计。"] : [],
      negativeRules: [],
      qualityRules: [],
    };
  }
  if (copyFragments.length > 0 && !extraRoles.copy) {
    roles.copy = {
      role: "copy",
      title: "文案资产",
      sourceNodeIds: [],
      componentIds: [],
      assetIds: [],
      promptFragments: copyFragments,
      constraints: ["除非明确要求烧字，否则文案作为可编辑图层。"],
      negativeRules: ["不要改商品包装标签，除非这是包装设计任务。"],
      qualityRules: ["文案短、清楚、放在画面安全区。"],
    };
  }
  return {
    version: 1,
    source: "agent-plan-20-smoke",
    targetNodeId,
    images,
    roles: {
      ...roles,
      ...extraRoles,
    },
    promptFragments: copyFragments,
    constraints: [],
    negativeRules: [],
    qualityRules: [],
  };
}

function ref(role, title, key, options = {}) {
  return {
    role,
    title,
    assetId: options.assetId ? `${options.assetId}_asset` : `${key}_asset`,
    nodeId: `${key}_node`,
    providerUsable: true,
    url: dataUrl(key),
  };
}

function dataUrl(label) {
  return `data:image/png;base64,${Buffer.from(`image-master-${label}`).toString("base64")}`;
}

function addIssue(scenarioId, category, message) {
  issues.push({ scenarioId, category, message });
}

async function requestJson(url, init = {}, expectedStatus = 200) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      lastError = new Error(`Invalid JSON from ${url}: ${text.slice(0, 300)}`);
      if (shouldRetryApiSmokeResponse(response.status, text, attempt)) {
        await sleep(1000 * attempt);
        continue;
      }
      throw lastError;
    }
    if (response.status !== expectedStatus) {
      lastError = new Error(`Expected status ${expectedStatus}, got ${response.status} from ${url}: ${JSON.stringify(payload).slice(0, 1000)}`);
      if (shouldRetryApiSmokeResponse(response.status, text, attempt)) {
        await sleep(1000 * attempt);
        continue;
      }
      throw lastError;
    }
    return payload;
  }
  throw lastError || new Error(`Request failed for ${url}`);
}

function shouldRetryApiSmokeResponse(status, text, attempt) {
  if (attempt >= 5) return false;
  if ((status === 200 || status === 404 || status === 500) && looksLikeDevServerHtml(text)) return true;
  if (status === 502 || status === 503) return true;
  return false;
}

function looksLikeDevServerHtml(text) {
  const trimmed = text.trim();
  return /^<!DOCTYPE html>/i.test(trimmed) ||
    /^<html/i.test(trimmed) ||
    /^<pre>/i.test(trimmed) ||
    trimmed.includes("missing required error components");
}

async function waitForServer(url) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 45000) {
    try {
      const response = await fetch(url);
      if (response.status === 200) return;
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(750);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
