import { spawn } from "node:child_process";
import { seedCommercialComponents } from "./seed-commercial-components.mjs";
import { createSmokeRuntime, stopSmokeServer } from "./smoke-runtime.mjs";

const port = Number(process.env.WORKFLOW_COMPOSE_SMOKE_PORT || 3466);
const baseUrl = `http://127.0.0.1:${port}`;
const createdWorkflowIds = [];
const runtime = createSmokeRuntime({
  name: "workflow-compose",
  stamp: new Date().toISOString().replace(/[:.]/g, "-"),
  externalBaseUrl: process.env.WORKFLOW_COMPOSE_BASE_URL,
});

const server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
  cwd: process.cwd(),
  env: runtime.serverEnv({
    NEXT_TELEMETRY_DISABLED: "1",
  }),
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
  await seedCommercialComponents({ baseUrl });

  const payload = await requestJson(`${baseUrl}/api/workflow-compose`, {
    method: "POST",
    body: JSON.stringify({
      brief:
        "为一款通勤女包生成淘宝详情页和小红书封面素材，需要白底主图、生活方式场景、平台尺寸适配和上线前质检。",
      scenario: "product_detail_page",
      productTitle: "Commuter Tote Smoke",
      productDescription: "A structured everyday tote with leather texture and metal logo hardware.",
      platforms: ["taobao", "xiaohongshu"],
      outputPacks: ["taobao_detail"],
      copyRenderMode: "burn_in",
      previewPlan: true,
      saveWorkflow: true,
    }),
  });

  if (!payload.workflowDraft) throw new Error("Expected workflowDraft in compose response");
  if (!payload.workflow) throw new Error("Expected saved workflow when saveWorkflow=true");
  createdWorkflowIds.push(payload.workflow.id);

  assertDraft(payload.workflowDraft);
  assertDraft(payload.workflow);
  assertPlanPreview(payload.planPreview, payload.workflowDraft);
  assertAgentSkill(payload.planPreview, payload.workflowDraft);

  console.log(
    `Workflow compose smoke passed on ${baseUrl}: ` +
      `${payload.workflowDraft.nodes.length} nodes, ${payload.workflowDraft.edges.length} edges, ` +
      `${payload.planPreview.items.length} preview items, saved ${payload.workflow.id}.`
  );
} finally {
  await cleanup();
  await stopSmokeServer(server);
  runtime.cleanup();
}

function assertAgentSkill(planPreview, draft) {
  const agentSkill = draft.metadata?.agentSkill;
  if (!agentSkill || typeof agentSkill !== "object") {
    throw new Error("Expected workflow draft agentSkill metadata");
  }
  if (agentSkill.id !== "workflow.taobao_detail.v1") {
    throw new Error(`Expected taobao workflow skill, received ${agentSkill.id}`);
  }
  if (!Array.isArray(agentSkill.outputSlots) || agentSkill.outputSlots.length < 5) {
    throw new Error("Expected workflow skill output slots");
  }
  if (!Array.isArray(agentSkill.phases) || agentSkill.phases.length < 4) {
    throw new Error("Expected workflow skill phases");
  }
  if (agentSkill.copyPolicy?.requestedMode !== "burn_in") {
    throw new Error("Expected explicit burn-in copy policy in workflow draft");
  }
  const campaignBible = draft.metadata?.campaignBible;
  if (!campaignBible || campaignBible.source !== "agent_campaign_bible") {
    throw new Error("Expected workflow draft campaignBible metadata");
  }
  if (campaignBible.workflowSkillId !== agentSkill.id) {
    throw new Error("Expected campaignBible to mirror workflow skill");
  }
  if (!Array.isArray(draft.metadata?.shotList) || draft.metadata.shotList.length < 5) {
    throw new Error("Expected campaign shotList metadata");
  }
  const recipeNode = draft.nodes.find((node) => node.data?.componentType === "image_recipe");
  if (!Array.isArray(recipeNode?.data?.parameters?.shotList) || recipeNode.data.parameters.shotList.length < 5) {
    throw new Error("Expected image recipe node to carry campaign shotList");
  }
  if (!planPreview.agentPlan || planPreview.agentPlan.skillId !== agentSkill.id) {
    throw new Error("Expected planPreview agentPlan to mirror draft skill");
  }
  if (planPreview.agentPlan.copyPolicy.requestedMode !== "burn_in") {
    throw new Error("Expected planPreview burn-in copy policy");
  }
}

function assertDraft(draft) {
  if (!Array.isArray(draft.nodes) || draft.nodes.length < 5) {
    throw new Error("Expected workflow draft nodes");
  }
  if (!Array.isArray(draft.edges) || draft.edges.length < 4) {
    throw new Error("Expected workflow draft edges");
  }

  const nodeTypes = new Set(draft.nodes.map((node) => node.data?.componentType || node.type));
  for (const type of ["product_asset", "image_recipe", "output_pack", "quality_rule"]) {
    if (!nodeTypes.has(type)) throw new Error(`Expected ${type} node in workflow draft`);
  }

  for (const node of draft.nodes) {
    if (node.data?.componentType && node.data.componentType !== "product_asset") {
      if (typeof node.data.seedKey !== "string" || !node.data.seedKey) {
        throw new Error(`Node ${node.id} missing seedKey`);
      }
      if (!Array.isArray(node.data.compatibleWith)) {
        throw new Error(`Node ${node.id} missing compatibleWith`);
      }
    }
  }

  const edgePairs = new Set(draft.edges.map((edge) => `${edge.source}->${edge.target}`));
  for (const pair of ["product->image_recipe", "quality_rule->output_pack"]) {
    if (!edgePairs.has(pair)) throw new Error(`Expected edge ${pair}`);
  }
}

function assertPlanPreview(planPreview, draft) {
  if (!planPreview || typeof planPreview !== "object") {
    throw new Error("Expected planPreview when previewPlan=true");
  }
  if (typeof planPreview.title !== "string" || !planPreview.title) {
    throw new Error("planPreview missing title");
  }
  if (typeof planPreview.summary !== "string" || !planPreview.summary) {
    throw new Error("planPreview missing summary");
  }
  if (!Array.isArray(planPreview.items) || planPreview.items.length < 2) {
    throw new Error("Expected planPreview items");
  }
  if (!Array.isArray(planPreview.images) || planPreview.images.length !== planPreview.items.length) {
    throw new Error("Expected planPreview images alias to match items");
  }
  if (planPreview.estimatedCount !== planPreview.items.length) {
    throw new Error("Expected estimatedCount to match preview item count");
  }
  if (!Array.isArray(planPreview.componentRefs) || planPreview.componentRefs.length < 5) {
    throw new Error("Expected componentRefs in planPreview");
  }
  if (!Array.isArray(planPreview.qualityChecks) || planPreview.qualityChecks.length < 1) {
    throw new Error("Expected qualityChecks in planPreview");
  }
  if (!Array.isArray(planPreview.editableParameters) || planPreview.editableParameters.length < 4) {
    throw new Error("Expected editableParameters groups in planPreview");
  }

  const nodeTypes = new Set(draft.nodes.map((node) => node.data?.componentType || node.type));
  for (const type of ["product_asset", "image_recipe", "output_pack", "platform_rule", "quality_rule"]) {
    if (!nodeTypes.has(type)) throw new Error(`Draft missing ${type} for plan preview`);
    const group = planPreview.editableParameters.find((item) => item.nodeType === type);
    if (!group || !Array.isArray(group.fields) || group.fields.length === 0) {
      throw new Error(`Expected editable parameter fields for ${type}`);
    }
  }

  const recipeGroup = planPreview.editableParameters.find((item) => item.nodeType === "image_recipe");
  const outputCount = recipeGroup?.fields.find((field) => field.key === "outputCount");
  if (!outputCount || outputCount.type !== "number") {
    throw new Error("Expected numeric outputCount editable parameter");
  }

  const platformGroup = planPreview.editableParameters.find((item) => item.nodeType === "platform_rule");
  const platform = platformGroup?.fields.find((field) => field.key === "platform");
  if (!platform || platform.type !== "select" || !Array.isArray(platform.options)) {
    throw new Error("Expected platform select editable parameter");
  }

  const firstItem = planPreview.items[0];
  for (const key of ["title", "purpose", "slot", "ratio", "componentRefs", "qualityChecks"]) {
    if (firstItem[key] === undefined) throw new Error(`Preview item missing ${key}`);
  }
}

async function cleanup() {
  for (const id of createdWorkflowIds.reverse()) {
    try {
      await fetch(`${baseUrl}/api/workflows/${id}`, { method: "DELETE" });
    } catch {
      // Best effort cleanup; failures should not hide the primary smoke result.
    }
  }
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

async function requestJson(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${url} failed with ${response.status}`);
  }
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
