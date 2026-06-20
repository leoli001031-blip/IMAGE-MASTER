import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const workbenchSource = fs.readFileSync(
  path.join(root, "components/canvas/visual-workbench.tsx"),
  "utf8"
);
const generationPlanTypesSource = fs.readFileSync(
  path.join(root, "lib/canvas/generation-plan.ts"),
  "utf8"
);
const generationPlanBuilderSource = fs.readFileSync(
  path.join(root, "lib/canvas/generation-plan-builder.ts"),
  "utf8"
);
const agentPlanBuilderSource = fs.readFileSync(
  path.join(root, "lib/canvas/agent-plan-builder.ts"),
  "utf8"
);
const agentPlanRouteSource = fs.readFileSync(
  path.join(root, "app/api/agent-plan/route.ts"),
  "utf8"
);
const generationPlansRunRouteSource = fs.readFileSync(
  path.join(root, "app/api/generation-plans/run/route.ts"),
  "utf8"
);
const agentPlan20SmokeSource = fs.readFileSync(
  path.join(root, "scripts/smoke-agent-plan-20.mjs"),
  "utf8"
);

assert.match(
  workbenchSource,
  /function buildProjectAwareAgentBrief/,
  "canvas should merge project template intent with the user's current brief"
);
assert.match(
  workbenchSource,
  /const shouldUseProjectStarterContext = source === "product-import"/,
  "direct Agent input should not be overridden by a stale project starter prompt"
);
assert.match(
  workbenchSource,
  /effectiveBrief = shouldUseProjectStarterContext[\s\S]*buildProjectAwareAgentBrief[\s\S]*: brief\.trim\(\)/,
  "direct Agent compose requests should keep the explicit user brief as the effective brief"
);
assert.match(
  workbenchSource,
  /项目模板意图：\$\{starter\}/,
  "merged brief should label template intent separately from the user's current request"
);
assert.match(
  workbenchSource,
  /用户本次需求：\$\{brief\}/,
  "merged brief should preserve the user's current request as a separate section"
);
assert.match(
  workbenchSource,
  /brief: effectiveBrief/,
  "workflow-compose should receive the project-aware effective brief"
);
assert.match(
  workbenchSource,
  /projectStarterPrompt: structuredProjectStarterPrompt/,
  "canvas requests should forward project starter prompt only through the scoped structured field"
);
assert.match(
  workbenchSource,
  /projectIntent: structuredProjectStarterPrompt/,
  "canvas requests should forward project intent only through the scoped structured field"
);
assert.match(
  workbenchSource,
  /strongReferenceRoleLabels[\s\S]*providerReferenceRoles[\s\S]*promptOnlyReferenceRoleLabels[\s\S]*referenceRoles\.filter/,
  "Agent plan preview should derive strong and prompt-only reference summaries from the matrix"
);
assert.match(
  workbenchSource,
  /burnInItemCount[\s\S]*copyMode === "burn_in"[\s\S]*素材调用[\s\S]*强参考：[\s\S]*文字\/约束：[\s\S]*张烧进图/s,
  "Agent plan preview should show reference routing and copy burn-in policy before generation"
);
assert.match(
  generationPlanTypesSource,
  /projectStarterPrompt\?: string;/,
  "GenerationPlanDraftRequest should type the project starter prompt"
);
assert.match(
  generationPlanTypesSource,
  /projectIntent\?: string;/,
  "GenerationPlanDraftRequest should type the project intent"
);
assert.match(
  generationPlanBuilderSource,
  /request\.projectStarterPrompt[\s\S]*request\.projectIntent[\s\S]*request\.request/,
  "generation plan builder should include project intent before user request text"
);
assert.match(
  agentPlanBuilderSource,
  /request\?\.projectStarterPrompt[\s\S]*request\?\.projectIntent[\s\S]*request\?\.request/,
  "plan-level Agent should include project intent in request text"
);
assert.match(
  agentPlanBuilderSource,
  /const llmGate = getLlmGate\(input\);[\s\S]*if \(!llmGate\.enabled\) \{[\s\S]*shouldAllowDeterministicAgentPlan\(input\)[\s\S]*throw new Error/,
  "plan-level Agent should make LLM the normal path and keep deterministic planning as an explicit fallback"
);
assert.match(
  agentPlanBuilderSource,
  /input\.mock === true[\s\S]*IMAGE_MASTER_ALLOW_AGENT_PLAN_FALLBACK === "1"/,
  "deterministic Agent planning should be limited to mock mode or explicit fallback opt-in"
);
assert.doesNotMatch(
  generationPlansRunRouteSource,
  /buildAgentPlan\(\{[\s\S]{0,500}(mock:\s*true|mode:\s*"deterministic")/,
  "real generation-plan runs should not force mock or deterministic Agent planning"
);
assert.match(
  agentPlanRouteSource,
  /normalizeAgentPlanMode\(request\.agentPlanMode\)/,
  "plan-only API should expose Agent mode only as an explicit request field"
);
assert.match(
  agentPlan20SmokeSource,
  /template_taobao_short_brief/,
  "agent plan smoke should cover template intent plus a short Taobao user brief"
);
assert.match(
  agentPlan20SmokeSource,
  /template_cross_platform_short_brief/,
  "agent plan smoke should cover template intent plus a short cross-platform user brief"
);
assert.match(
  agentPlan20SmokeSource,
  /selectedSkillIds: \["workflow\.taobao_detail\.v1"\]/,
  "template Taobao scenario should require the Taobao detail skill"
);
assert.match(
  agentPlan20SmokeSource,
  /selectedSkillIds: \["workflow\.amazon_listing\.v1"\]/,
  "cross-platform template scenario should require the Amazon listing skill"
);

console.log("agent project intent context smoke passed");
