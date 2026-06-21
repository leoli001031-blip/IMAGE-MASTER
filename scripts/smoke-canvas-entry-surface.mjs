import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const workbenchPath = path.join(root, "components/canvas/visual-workbench.tsx");
const assetTrayPath = path.join(root, "components/canvas/asset-tray.tsx");
const contextMenuPath = path.join(root, "components/canvas/canvas-context-menu.tsx");
const workbenchJobsHookPath = path.join(root, "components/canvas/hooks/useWorkbenchJobs.ts");
const legacyGenerationFrameWorkspacePath = path.join(root, "components/canvas/generation-frame-workspace.tsx");
const generationFrameNodePath = path.join(root, "components/canvas/generation-frame-node.tsx");
const workflowNodePath = path.join(root, "components/canvas/workflow-node.tsx");
const canvasResultNodesPath = path.join(root, "components/canvas/canvas-result-nodes.ts");
const outputAssetTargetPath = path.join(root, "lib/canvas/generation-output-asset-target.ts");
const projectDetailPath = path.join(root, "app/projects/[id]/page.tsx");
const projectBatchDetailPath = path.join(root, "app/projects/[id]/batches/[batchId]/page.tsx");
const source = fs.readFileSync(workbenchPath, "utf8");
const assetTraySource = fs.readFileSync(assetTrayPath, "utf8");
const contextMenuSource = fs.readFileSync(contextMenuPath, "utf8");
const workbenchJobsHookSource = fs.readFileSync(workbenchJobsHookPath, "utf8");
const generationFrameNodeSource = fs.readFileSync(generationFrameNodePath, "utf8");
const workflowNodeSource = fs.readFileSync(workflowNodePath, "utf8");
const canvasResultNodesSource = fs.readFileSync(canvasResultNodesPath, "utf8");
const outputAssetTargetSource = fs.readFileSync(outputAssetTargetPath, "utf8");
const projectDetailSource = fs.readFileSync(projectDetailPath, "utf8");
const projectBatchDetailSource = fs.readFileSync(projectBatchDetailPath, "utf8");

assert.equal(
  fs.existsSync(legacyGenerationFrameWorkspacePath),
  false,
  "legacy generation-frame workspace component should stay removed so generation frames remain internal task objects"
);

assert.doesNotMatch(
  source,
  />\s*导入素材\s*</,
  "canvas toolbar should not expose a second direct import entry"
);
assert.match(
  source,
  /agentInputHelperText[\s\S]*删组、加组、改数量、改比例或改画面文字/,
  "Agent panel should explain the natural-language plan editing path with scoped helper copy"
);
assert.match(
  source,
  /data-testid="agent-conversation"/,
  "Agent panel should expose a proper conversation area"
);
assert.match(
  source,
  /visibleMessages = compact[\s\S]*getCompactAgentConversationMessages\(messages\)[\s\S]*messages\.slice\(-7\)/,
  "Agent conversation should keep enough recent context visible for plan explanation and follow-up"
);
assert.match(
  source,
  /function getCompactAgentConversationMessages[\s\S]*agent-edit-context[\s\S]*agent-focused-group/,
  "compact Agent conversation should preserve single-image and group-edit context messages"
);
assert.match(
  source,
  /data-testid="agent-plan-board"/,
  "Agent panel should expose a visible production plan board"
);
assert.match(
  source,
  /interface PendingAgentSamplePlan[\s\S]*preview: WorkflowPlanPreview[\s\S]*generationRequest: string/,
  "Agent sample generation should keep a pending plan object before creating jobs"
);
assert.match(
  source,
  /const \[pendingAgentSamplePlan, setPendingAgentSamplePlan\]/,
  "Agent sample plan state should be explicit instead of overloading generated jobs"
);
assert.match(
  source,
  /canGenerateSample[\s\S]*\? `规划 \$\{sampleOutputCount\} 张样张`/,
  "product-ready Agent sample action should preview a plan before generation"
);
assert.match(
  source,
  /workflowPlanActionLabel=\{pendingAgentSamplePlan \? "确认生成样张" : undefined\}/,
  "pending sample plan should turn the plan-board action into an explicit generation confirmation"
);
assert.match(
  source,
  /if \(!confirmedPlan\) \{[\s\S]*buildAgentSampleWorkflowPlanPreview[\s\S]*setPendingAgentSamplePlan[\s\S]*setWorkflowPlanPreview\(preview\)[\s\S]*确认后才会创建生成任务/,
  "first Agent sample click should create a visible plan preview, not enqueue provider jobs"
);
assert.match(
  source,
  /if \(pendingAgentSamplePlan\) \{[\s\S]*handleGenerateAgentSample\(pendingAgentSamplePlan\)/,
  "plan-board confirmation should be the only path that turns a pending sample plan into jobs"
);
assert.match(
  source,
  /buildAgentWorkflowPlanAppliedMessage[\s\S]*计划已应用到画布[\s\S]*结果会自动回填到画布结果墙/,
  "applying an Agent plan should explain where the plan went and where results return"
);
assert.match(
  source,
  /setComposeMessage\(buildAgentSampleRunFeedbackMessage\(confirmedPlan\.preview, createdJobs\.length, agentPlanText\)\)[\s\S]*function buildAgentSampleRunFeedbackMessage[\s\S]*正在排队生成[\s\S]*完成后可以按单张或分组继续修改/,
  "confirmed Agent sample generation should tell users what is running and how results come back"
);
assert.match(
  source,
  /data-testid="agent-gap-checklist"[\s\S]*关键缺口/,
  "Agent panel should expose a visible critical-gap checklist instead of burying missing assets in long chat text"
);
assert.match(
  source,
  /const planAttentionHints = agentUniqueStrings\(\[[\s\S]*missingInputHints[\s\S]*criticalGapItems[\s\S]*hasAgentPlanAttentionItems/,
  "plan board should surface both blocking missing inputs and non-blocking quality risks such as model or scene gaps"
);
assert.match(
  source,
  /hasAgentPlanAttentionItems && \([\s\S]*本轮还要注意这些素材风险[\s\S]*planAttentionHints\.map/,
  "plan board should keep non-blocking Agent gap reminders visible without turning them into execution blockers"
);
assert.match(
  source,
  /id: "agent-critical-gaps"[\s\S]*title: "关键缺口"[\s\S]*criticalGapItems/,
  "critical gaps should also appear in the Agent message flow"
);
assert.match(
  source,
  /interface AgentPlanGroup[\s\S]*reason\?: string;[\s\S]*missingHints\?: string\[\];/,
  "Agent plan groups should carry user-facing reason and missing-input hints"
);
assert.match(
  source,
  /function buildAgentPlanExplanation[\s\S]*项目类型：\$\{projectTypeLabel\}[\s\S]*制作理由：先覆盖[\s\S]*图组目的：\$\{purposeSummary\}[\s\S]*文案策略：/,
  "Agent should explain project type, production reason, group purpose, and copy strategy instead of only listing image slots"
);
assert.match(
  source,
  /function buildAgentPlanExplanation[\s\S]*filter\(Boolean\)\.join\("\\n"\)/,
  "Agent plan explanation should render as short chat lines instead of one dense paragraph"
);
assert.match(
  source,
  /function inferAgentProjectTypeLabel[\s\S]*淘宝详情页项目[\s\S]*商品 \+ 模特 \+ 文案项目[\s\S]*商品场景项目/,
  "Agent should infer a user-facing project type from roles and planned groups"
);
assert.match(
  source,
  /function buildAgentPlanCoverageSummary[\s\S]*getAgentPlanGroupBusinessPurpose/,
  "Agent should summarize why the planned image groups cover the delivery"
);
assert.match(
  source,
  /function getAgentPlanGroupDisplayTitle[\s\S]*white_main: "白底主图"[\s\S]*feature: "卖点图"[\s\S]*material: "材质细节"[\s\S]*front: "正面图"[\s\S]*side: "侧面图"[\s\S]*closing: "收尾图"/,
  "Agent plan board should translate internal slot labels such as Main, Feature, Material, and Closing into Chinese production labels"
);
assert.match(
  source,
  /getAgentPlanGroupDisplayTitle\(item\.title, item\.outputSlotId \|\| item\.type\)/,
  "Agent plan advanced details should use the same Chinese-facing production labels"
);
assert.match(
  source,
  /function getAgentPlanGroupBusinessPurpose[\s\S]*详情\|细节\|材质[\s\S]*海报\|卖点[\s\S]*场景\|生活/,
  "plan explanation should classify detail and selling-point groups before generic scene wording"
);
assert.match(
  source,
  /function buildAgentGroupReason[\s\S]*详情\|细节\|材质[\s\S]*海报\|卖点[\s\S]*场景\|生活/,
  "plan group reasons should not let generic scene copy override detail or poster purposes"
);
assert.match(
  source,
  /id: "agent-plan-explanation"[\s\S]*title: "为什么这样规划"/,
  "Agent plan explanation should appear as a readable conversation message"
);
assert.match(
  source,
  /function buildAgentFollowUpHint[\s\S]*补真实商品图[\s\S]*同场地多角度稳定/,
  "Agent should provide concise next-step hints for missing product, model, scene, or copy context"
);
assert.match(
  source,
  /function buildAgentProductionOrderHint[\s\S]*建议先确认[\s\S]*getAgentProductionOrderRank/,
  "Agent should explain which production group to inspect first instead of only listing slots"
);
assert.match(
  source,
  /function buildAgentClarificationHint[\s\S]*这是要锁真实商品吗[\s\S]*概念 mockup[\s\S]*场景我先按文字发散[\s\S]*烧字图我默认只写短标题/,
  "Agent should ask only key questions while giving conservative defaults for product, scene, and burn-in copy gaps"
);
assert.match(
  source,
  /productionOrderHint[\s\S]*clarificationHint[\s\S]*id: "agent-production-order"[\s\S]*id: "agent-clarification-default"/,
  "Agent conversation should show production order and default continuation guidance in the message stream"
);
assert.match(
  source,
  /userBrief: composeBrief \|\| lastUserBrief[\s\S]*userAskedForScene[\s\S]*多场景可以先按 prompt 生成，但同场地空间一致性会弱/,
  "Agent follow-up hints should preserve multi-scene risk even when fallback planning loses scene roles"
);
assert.match(
  source,
  /function buildAgentEditContextHint[\s\S]*上一版成片参考[\s\S]*只改这张，不改其它图组，也不重写整套计划[\s\S]*强参考会带回[\s\S]*文字约束继续继承/,
  "single-image edit mode should explain which original context and references will be preserved"
);
assert.match(
  source,
  /function buildAgentFocusedGroupHint[\s\S]*只影响这组 \$\{group\.count\} 张；其他图组保持不动，不重写全局计划/,
  "focused group edit mode should explain the scoped modification range"
);
assert.match(
  workflowNodeSource,
  /image-master:artifact-group-edit[\s\S]*artifactIds[\s\S]*providerRoles[\s\S]*promptOnlyRoles[\s\S]*copyModes[\s\S]*调整这组/,
  "artifact result group headers should expose a scoped group-edit entry with generation context"
);
assert.match(
  canvasResultNodesSource,
  /layoutArtifactIds: layout\.artifactIds[\s\S]*layoutProviderRoles: layout\.providerRoles[\s\S]*layoutPromptOnlyRoles: layout\.promptOnlyRoles[\s\S]*layoutCopyModes: layout\.copyModes/,
  "artifact result group nodes should carry artifact ids, reference roles, and copy modes for scoped Agent edits"
);
assert.match(
  source,
  /setFocusedPlanGroup\(\{[\s\S]*id: `artifact-group:\$\{title\}`[\s\S]*providerRoles: getStringArray\(detail\.providerRoles\)[\s\S]*promptOnlyRoles: getStringArray\(detail\.promptOnlyRoles\)[\s\S]*artifactIds[\s\S]*onComposeBriefChange\(`调整「\$\{title\}」：`\)[\s\S]*window\.addEventListener\("image-master:artifact-group-edit", handleArtifactGroupEdit\)/,
  "Agent panel should listen for artifact group edit events and scope the next instruction to that group"
);
assert.match(
  source,
  /<AgentScopeContextCard[\s\S]*focusedGroup=\{focusedPlanGroup\}[\s\S]*focusedGroupScopeText=\{focusedGroupScopeText\}[\s\S]*function AgentScopeContextCard[\s\S]*data-testid="agent-active-scope"[\s\S]*分组：\$\{focusedGroup\.title\}/,
  "focused result group context should be visible in the Agent scope card even after the original plan preview is gone"
);
assert.match(
  source,
  /focusedGroupScopeText = buildAgentFocusedGroupScopeText\(focusedPlanGroup, focusedGroupArtifacts\)[\s\S]*focusedGroupScopeText=\{focusedGroupScopeText\}[\s\S]*function AgentScopeContextCard[\s\S]*\{focusedGroupScopeText \|\| `只影响这组 \$\{focusedGroup\.count\} 张[\s\S]*function buildAgentFocusedGroupScopeText[\s\S]*待处理 \$\{actionableCount\}\/\$\{artifacts\.length\} 张[\s\S]*已保留\/已淘汰 \$\{protectedCount\} 张不动/,
  "focused result group context should show actionable counts and protected keep/reject state"
);
assert.match(
  source,
  /if \(focusedPlanGroup && composeBrief\.trim\(\) && !workflowPlanPreview && !hasEditTarget\) \{[\s\S]*onApplyResultGroupEdit\(focusedPlanGroup, composeBrief, focusedGroupArtifacts\)/,
  "submitting while a result group is focused should run a scoped group edit instead of global replanning"
);
assert.match(
  source,
  /onEditWorkflowPlan: \(preview: WorkflowPlanPreview, scopeGroup\?: AgentPlanGroup \| null\) => void;/,
  "Agent plan editing should accept an optional scoped plan group"
);
assert.match(
  source,
  /if \(workflowPlanPreview && focusedPlanGroup && composeBrief\.trim\(\) && !hasEditTarget\) \{[\s\S]*onEditWorkflowPlan\(workflowPlanPreview, focusedPlanGroup\)/,
  "submitting while a plan group is focused should pass that group into plan editing"
);
assert.match(
  source,
  /setShowAgentPlanAdvanced\(false\)[\s\S]*setFocusedPlanGroup\(null\)[\s\S]*\}, \[workflowPlanPreview\?\.title\]\)/,
  "focused plan group should not be cleared just because a scoped plan edit changed the image count"
);
assert.match(
  source,
  /planGroupSyncSignature = planGroups\.map\(getAgentFocusedGroupSignature\)\.join\("\|"\)[\s\S]*findUpdatedFocusedPlanGroup\(planGroups, focusedPlanGroup\)[\s\S]*setFocusedPlanGroup\(syncedGroup\)[\s\S]*function findUpdatedFocusedPlanGroup[\s\S]*normalizeAgentPlanScopeKey\(group\.id\)[\s\S]*function getAgentFocusedGroupSignature/,
  "focused plan group should sync to the edited plan group after natural-language plan changes"
);
assert.match(
  source,
  /function applyAgentScopedPlanEdit[\s\S]*agentPlanMatrixItemMatchesScopeGroup[\s\S]*agentPlanPreviewItemMatchesScopeGroup[\s\S]*changes\.push\(`「\$\{groupLabel\}」/,
  "focused plan-group edits should use exact group scope instead of broad target keywords"
);
assert.match(
  source,
  /diff: buildAgentPlanDiff\(changes, originalCount, normalizedItems\.length, scopeGroup\)/,
  "scoped plan edits should keep scope information in the visible diff"
);
assert.match(
  source,
  /scopeGroup[\s\S]*`只调整「\$\{scopeGroup\.title\}」这一组。`[\s\S]*其他图组、比例和参考图角色保持不变。/,
  "scoped plan diff should tell users that only the selected group changed"
);
assert.match(
  source,
  /const handleRunAgentResultGroupRevision = async[\s\S]*source: "agent-result-group-revision"[\s\S]*assetInvocationPlanner: \{[\s\S]*mode: "agent_group_revision_v1"[\s\S]*revisionGroup:/,
  "group edits should create traceable group revision jobs that preserve source context"
);
assert.match(
  source,
  /function buildAgentResultGroupRevisionMessage[\s\S]*保留参考角色[\s\S]*比例沿用[\s\S]*其他图组保持不动[\s\S]*文案继续按原烧字策略处理/,
  "Agent should explain preserved context after submitting a result group edit"
);
assert.match(
  source,
  /function buildAgentImageRevisionMessage[\s\S]*filter\(Boolean\)\.join\("\\n"\)[\s\S]*function buildAgentResultGroupRevisionMessage[\s\S]*filter\(Boolean\)\.join\("\\n"\)/,
  "single-image and group-edit replies should stay readable as short chat lines"
);
assert.match(
  source,
  /function formatAgentPlanDiffForConversation[\s\S]*这次改了[\s\S]*id: "agent-plan-diff"[\s\S]*title: "修改记录"[\s\S]*formatAgentPlanDiffForConversation/,
  "natural-language plan edits should appear in the Agent conversation as a reviewable modification record"
);
assert.match(
  source,
  /interface AgentPlanDiff[\s\S]*scopeSummary\?: string;[\s\S]*preservedSummary\?: string;[\s\S]*nextAction\?: string;[\s\S]*affectedGroupTitles\?: string\[\];/,
  "plan diffs should carry scope, preserved-context, and next-action guidance"
);
assert.match(
  source,
  /function buildAgentPlanDiffScopeSummary[\s\S]*只调整文案策略，图组数量和参考角色不变[\s\S]*只调整本次点名的/,
  "plan diff scope copy should explain whether the change affects copy only or specific named groups"
);
assert.match(
  source,
  /preservedSummary: scopeGroup[\s\S]*其他图组、比例和参考图角色保持不变。[\s\S]*未提到的图组、比例和参考图角色保持不变。/,
  "plan diff should explicitly tell users what remains unchanged"
);
assert.match(
  source,
  /function formatAgentPlanDiffForConversation[\s\S]*diff\.scopeSummary[\s\S]*diff\.preservedSummary[\s\S]*diff\.nextAction/,
  "Agent conversation should include scope, preserved context, and next action after a plan edit"
);
assert.match(
  source,
  /function AgentPlanDiffCard[\s\S]*getAgentPlanDiffConfirmationItems\(diff\)[\s\S]*执行前确认[\s\S]*\{item\.label\}[\s\S]*\{item\.text\}[\s\S]*function getAgentPlanDiffConfirmationItems[\s\S]*改动范围[\s\S]*保持不变[\s\S]*下一步/,
  "plan diff card should show a clear execution confirmation checklist"
);
assert.match(
  source,
  /<AgentPlanDiffCard[\s\S]*actionLabel=\{[\s\S]*workflowPlanActionLabel[\s\S]*onAction=\{workflowPlanPreview \? onApplyWorkflowPlan : undefined\}[\s\S]*function AgentPlanDiffCard[\s\S]*确认无误后执行这份计划[\s\S]*disabled=\{actionDisabled\}[\s\S]*\{actionLabel\}/,
  "plan diff card should expose a direct action for applying the adjusted plan"
);
assert.match(
  source,
  /<AgentPlanBoard[\s\S]*planDiff=\{planDiff\}[\s\S]*function AgentPlanBoard[\s\S]*isAgentPlanGroupAffectedByDiff\(group, planDiff\)[\s\S]*已调整/,
  "plan board should mark groups affected by the latest natural-language plan edit"
);
assert.match(
  source,
  /affectedGroupTitles: getAgentPlanDiffAffectedGroupTitles\(changes, scopeGroup\)[\s\S]*function getAgentPlanDiffAffectedGroupTitles[\s\S]*matchAll\(\/「\(\[\^」\]\+\)」\/g\)/,
  "plan diffs should extract quoted scoped group titles for visible plan-board highlighting"
);
assert.match(
  source,
  /<div className="shrink-0 space-y-2\.5 border-t border-warm-line\/50 bg-warm-paper\/95 p-3">[\s\S]*<textarea[\s\S]*placeholder=\{planInputPlaceholder\}[\s\S]*<AgentProgressSteps steps=\{progressSteps\} jobMessage=\{jobMessage\} \/>[\s\S]*\{primaryLabel\}/,
  "Agent input, progress, and primary action should stay in a fixed footer instead of being pushed below the plan board"
);
assert.match(
  source,
  /const planInputPlaceholder = editTarget[\s\S]*focusedPlanGroup[\s\S]*workflowPlanPreview[\s\S]*不要小红书封面[\s\S]*加两张商场场景/,
  "Agent input placeholder should prefer single-image and scoped-group context before generic plan-edit examples"
);
assert.match(
  source,
  /const agentInputHelperText = editTarget[\s\S]*当前只修改这张图[\s\S]*focusedPlanGroup[\s\S]*当前只调整这组[\s\S]*workflowPlanPreview[\s\S]*可以直接删组、加组、改数量、改比例或改画面文字/,
  "Agent footer helper should explain the current edit scope instead of showing one generic instruction"
);
assert.match(
  source,
  /id: "agent-completion-summary"[\s\S]*title: "生成总结"[\s\S]*completionSummary/,
  "post-generation summary should also be part of the Agent message flow"
);
assert.match(
  source,
  /为什么：\{group\.reason\}[\s\S]*缺口：\{group\.missingHints\.slice\(0, 2\)\.join/,
  "plan board should show why each group exists and what is missing"
);
assert.match(
  source,
  /function getAgentGroupPriorityLabel[\s\S]*先补素材[\s\S]*先做[\s\S]*验证[\s\S]*转化[\s\S]*后续/,
  "plan board should label group priority so users know what to inspect or make first"
);
assert.match(
  source,
  /<AgentPlanTinyBadge tone=\{getAgentGroupPriorityTone\(group\)\}>[\s\S]*\{getAgentGroupPriorityLabel\(group\)\}/,
  "plan board should render group priority badges in the production checklist"
);
assert.match(
  source,
  /data-testid="agent-progress-steps"/,
  "Agent panel should expose production progress instead of only a loading button"
);
assert.match(
  source,
  /id: "references"[\s\S]*label: "参考"[\s\S]*id: "qa"[\s\S]*label: "质检"/,
  "Agent progress should show reference preparation and QA steps, not just plan and generation"
);
assert.match(
  source,
  /flex max-h-\[calc\(100vh-24px\)\] flex-col overflow-hidden[\s\S]*min-h-0 flex-1 space-y-2\.5 overflow-y-auto p-3/,
  "Agent panel should stay inside the viewport and scroll its content instead of pushing actions offscreen"
);
assert.match(
  source,
  /interface AgentPlanEnrichmentResult[\s\S]*fallbackUsed: boolean;[\s\S]*fallbackReason\?: string;/,
  "Agent plan enrichment should return explicit fallback state for the UI"
);
assert.match(
  source,
  /if \(!response\.ok\) \{[\s\S]*buildAgentPlanFallbackPreviewResult[\s\S]*Agent 规划接口返回/,
  "Agent plan enrichment should fall back to a visible base plan when the LLM route fails"
);
assert.match(
  source,
  /function getAgentPlanValidationFallbackReason[\s\S]*parseRequestedAgentSampleCount\(brief\)[\s\S]*高级理解结果不完整[\s\S]*高级理解没有覆盖模特展示/,
  "Agent plan enrichment should reject visibly incomplete LLM plans before showing them to the user"
);
assert.match(
  source,
  /function parseRequestedAgentSampleCount[\s\S]*parseRequestedStandaloneAgentSampleCount\(text\)[\s\S]*function isRelativeAgentSampleCountMatch[\s\S]*多\|少\|加\|减[\s\S]*保持[\s\S]*场景各/,
  "relative plan edits such as 详情图多两张 or 主图保持一张 should not be misread as total image counts"
);
assert.match(
  source,
  /function parseRequestedAgentSampleCount[\s\S]*parseRequestedMultiSceneSampleCount\(text\)[\s\S]*function parseRequestedMultiSceneSampleCount[\s\S]*sceneCount \* perSceneCount/,
  "multi-scene requests such as 三个场景每个2张 should be counted as scene count times per-scene count"
);
assert.match(
  source,
  /multiSceneCount \+ parseRequestedAdditionalDeliverableSampleCount\(text\)[\s\S]*function parseRequestedAdditionalDeliverableSampleCount[\s\S]*getFallbackExplicitPosterCount\(brief\)/,
  "multi-scene requested counts should include explicit extra poster deliverables"
);
assert.match(
  source,
  /AbortError[\s\S]*Agent 规划超时，已先展示基础计划/,
  "Agent plan enrichment timeout should show a base plan instead of leaving the user in loading"
);
assert.match(
  source,
  /function shouldFallbackSuppressModelSlots[\s\S]*hasFallbackModelIntent[\s\S]*手机[\s\S]*鼠标/,
  "fallback planning should suppress model slots for electronics or pure-product requests without model intent"
);
assert.match(
  source,
  /function removeFallbackModelSlotsFromPreview[\s\S]*items\.filter[\s\S]*isFallbackModelPreviewItem[\s\S]*estimatedCount: items\.length/,
  "fallback model-slot suppression should update plan items and estimated count"
);
assert.match(
  source,
  /function injectFallbackModelIntentIntoMatrix[\s\S]*hasFallbackModelIntent[\s\S]*referenceRoles\.includes\("model"\)[\s\S]*addModelRoleToFallbackMatrixItem/,
  "fallback planning should keep explicit model intent by adding model as a reference role to suitable groups"
);
assert.match(
  source,
  /function addModelRoleToFallbackMatrixItem[\s\S]*referenceRoles: agentUniqueStrings\(\[\.\.\.item\.referenceRoles, "model"\]\)[\s\S]*包含用户要求的模特出镜/,
  "fallback model-intent injection should explain the model/product relationship in the affected group summary"
);
assert.match(
  source,
  /function ensureFallbackSceneSlotsFromBrief[\s\S]*hasFallbackSceneExpansionIntent[\s\S]*extractFallbackSceneNames[\s\S]*referenceRoles: sceneReferenceRoles/,
  "fallback planning should add explicit scene groups when a poster or detail plan would otherwise swallow multi-scene requirements"
);
assert.match(
  source,
  /function hasFallbackSceneGroupIntent[\s\S]*hasFallbackSceneExpansionIntent\(brief\)[\s\S]*场景图\|使用场景\|场景化/,
  "fallback target group detection should treat ordinary scene-image requests as a scene group even without multi-scene wording"
);
assert.match(
  source,
  /function normalizeFallbackSceneNameList[\s\S]*replace\(\/\^\.\*\[：:\]\//,
  "fallback scene list parsing should strip project prefixes like 多场景项目：卧室 before filtering scene names"
);
assert.match(
  source,
  /const sceneReferenceRoles = sceneCopyMode === "burn_in"[\s\S]*\["product", "style", "scene", "copy"\][\s\S]*referenceRoles: sceneReferenceRoles/,
  "fallback scene posters that burn copy should include the copy role so later copy-mode normalization does not demote them"
);
assert.match(
  source,
  /function getFallbackSceneCopyMode[\s\S]*hasFallbackAdditionalNonSceneDeliverable\(brief\)[\s\S]*!hasFallbackCopyBurnInTargetIntent\(brief, "场景\|多场景\|scene"\)[\s\S]*return "layout_layer"/,
  "explicit extra poster burn-in should not make every multi-scene image burn text"
);
assert.match(
  source,
  /function ensureFallbackPosterSlotFromBrief[\s\S]*getFallbackExplicitPosterCount\(brief\)[\s\S]*hasFallbackExplicitPosterIntent\(brief\)[\s\S]*createAgentPlanItemsForNewTarget/,
  "fallback planning should preserve an explicitly requested poster as its own deliverable"
);
assert.match(
  source,
  /ensureFallbackSceneSlotsFromBrief\(normalizedPreview, brief, copyRenderMode\)[\s\S]*ensureFallbackPosterSlotFromBrief\(normalizedPreview, brief\)[\s\S]*applyFallbackExplicitPosterCount/,
  "fallback normalization should add named scenes first, then restore an explicit poster deliverable before poster trimming"
);
assert.match(
  source,
  /const sceneTitle = sceneCopyMode === "burn_in"[\s\S]*场景海报[\s\S]*承载海报短文案/,
  "fallback scene poster items should keep poster wording so scoped burn-in detection treats them as poster outputs"
);
assert.match(
  source,
  /function ensureFallbackSceneSlotsFromBrief[\s\S]*shouldUseSceneOnlyFallbackPlan[\s\S]*function shouldUseSceneOnlyFallbackPlan[\s\S]*isFallbackGenericPosterPreviewItem/,
  "explicit per-scene fallback plans should replace generic vertical/banner placeholders with named scene outputs"
);
assert.match(
  source,
  /function extractFallbackSceneNames[\s\S]*extractFallbackSceneNamesBeforeCount\(brief\)[\s\S]*function extractFallbackSceneNamesBeforeCount[\s\S]*normalizeFallbackSceneNameList/,
  "fallback scene extraction should prioritize trailing count lists like 卧室、书桌、客厅三个场景各2张"
);
assert.match(
  source,
  /function extractFallbackSceneNamesFromList[\s\S]*explicitSceneList[\s\S]*genericSceneList[\s\S]*trailingSceneList[\s\S]*function normalizeFallbackSceneNameList[\s\S]*split\(\S*\/\[、，,\\\/\|\]\+\//,
  "fallback scene extraction should parse explicit scene lists instead of relying only on fixed keywords"
);
assert.match(
  source,
  /办公室[\s\S]*露营[\s\S]*车库[\s\S]*工具墙[\s\S]*卧室[\s\S]*书桌[\s\S]*客厅/,
  "fallback scene keyword list should cover common office, camping, garage, and tool-wall scenarios"
);
assert.match(
  source,
  /shouldReplaceGenericScene[\s\S]*preview\.items\.filter\(\(item\) => !isFallbackScenePreviewItem\(item\)\)[\s\S]*nextMatrixBase[\s\S]*filter\(\(item\) => !isFallbackScenePlanItem\(item\)\)/,
  "explicit multi-scene fallback planning should replace a generic scene group instead of treating it as already covered"
);
assert.match(
  source,
  /function getFallbackSceneCopyMode[\s\S]*海报\|封面\|poster\|cover[\s\S]*烧字\|烧进\|带字\|进图[\s\S]*return "burn_in"[\s\S]*其他[\s\S]*图层[\s\S]*return "layout_layer"/,
  "multi-scene poster outputs should keep explicit poster burn-in copy before generic other-copy layer rules"
);
assert.match(
  source,
  /function extractFallbackSceneNamesFromList[\s\S]*explicitSceneList[\s\S]*genericSceneList[\s\S]*trailingSceneList[\s\S]*trailingSceneList \?\? explicitSceneList \?\? genericSceneList/,
  "explicit scene lists such as 三个场景：办公室、露营 should be preferred over the generic 多场景 match"
);
assert.match(
  source,
  /function getAgentPlanGroupSlotId[\s\S]*\^scene_\\d\+[\s\S]*getPreviewItemBaseSlotId/,
  "multi-scene fallback groups should stay split as scene_1, scene_2, scene_3 in the plan board"
);
assert.match(
  source,
  /function isFallbackSceneSlotText[\s\S]*\^scene\(\?:\$\|\[-_\]\)/,
  "fallback scene detection should recognize scene_1_1 slots and keep scene posters out of generic poster trimming"
);
assert.match(
  source,
  /function applyFallbackExplicitPosterCount[\s\S]*!isFallbackScenePreviewItem\(item\)[\s\S]*posterItems\.slice\(0, count\)/,
  "fallback planning should respect explicit poster counts instead of expanding one poster request into multiple poster packs"
);
assert.match(
  source,
  /function applyFallbackExplicitTotalCount[\s\S]*parseRequestedStandaloneAgentSampleCount\(brief\)[\s\S]*hasFallbackSceneExpansionIntent\(brief\) && requestedCount < preview\.items\.length[\s\S]*estimatedCount: items\.length/,
  "fallback planning should respect an explicit total image count such as 淘宝详情页 8 张"
);
assert.match(
  source,
  /function hasFallbackAdditionalNonSceneDeliverable[\s\S]*另外[\s\S]*海报/,
  "fallback scene-only replacement should keep separately requested poster/detail deliverables"
);
assert.match(
  source,
  /function getFallbackExplicitPosterCount[\s\S]*\[\^，。；;\]\*\(\?:海报\|poster\|封面\)/,
  "fallback poster counting should understand phrases like 一张带短标题的海报"
);
assert.match(
  source,
  /function ensureFallbackBriefTargetGroups[\s\S]*getFallbackBriefTargetGroupSpecs\(brief\)[\s\S]*createAgentPlanItemsForNewTarget/,
  "fallback planning should add missing target groups from the user's brief before mechanically padding counts"
);
assert.match(
  source,
  /function getFallbackBriefTargetGroupSpecs[\s\S]*hasFallbackModelIntent\(text\)[\s\S]*同一个模特出镜[\s\S]*getFallbackExplicitPosterCount\(brief\)[\s\S]*hasFallbackSceneGroupIntent\(brief\)/,
  "fallback target group detection should preserve explicit model, detail, poster, scene, and copy intent"
);
assert.match(
  source,
  /function cloneFallbackTotalCountItem[\s\S]*按用户要求补足总张数/,
  "fallback planning should label cloned items that only exist to satisfy the user's explicit total count"
);
assert.match(
  source,
  /enrichedPlanPreview\.items\.length !== planPreview\.items\.length[\s\S]*applyEditedPlanItemsToWorkflowDraft/,
  "fallback plan filtering should keep the draft shot list aligned with the visible plan"
);
assert.match(
  source,
  /function markWorkflowPlanPreviewAgentFallback[\s\S]*fallbackUsed: true[\s\S]*fallbackReason: reason[\s\S]*Agent 深度规划暂不可用，已先展示基础制作计划/,
  "Agent fallback plans should be marked in plan metadata so the conversation can explain them"
);
assert.match(
  source,
  /const fallbackCopyMode = copyRenderMode \?\? existing\?\.copyPolicy\?\.requestedMode \?\? "layout_layer"[\s\S]*copyPolicy: fallbackCopyPolicy/,
  "Agent fallback plans should preserve the requested copy render policy such as burn-in"
);
assert.match(
  source,
  /fallbackCopyMode === "burn_in"[\s\S]*用户已要求文案烧进图/,
  "Agent fallback copy policy should explain when burn-in was explicitly requested"
);
assert.match(
  source,
  /function shouldFallbackMatrixItemBurnInCopy[\s\S]*hasFallbackCopyLayerTargetIntent\(brief, "详情页\|商品详情"[\s\S]*hasFallbackCopyBurnInTargetIntent\(brief, "海报\|封面\|poster\|cover"[\s\S]*hasFallbackCopyBurnInTargetIntent\(brief, "卖点\|feature"[\s\S]*hasFallbackCopyBurnInTargetIntent\(brief, "细节\|详情\|参数/,
  "fallback burn-in copy should be scoped by the requested image group instead of forcing every copy role into the image"
);
assert.match(
  source,
  /hasFallbackCopyBurnInTargetIntent\(brief, "海报\|封面\|poster\|cover"[\s\S]*return \/\(海报\|封面\|主视觉\|poster\|cover\|banner\)/,
  "poster burn-in requests should stay on poster-like groups instead of forcing generic feature/detail groups into burn-in"
);
assert.match(
  source,
  /hasFallbackCopyBurnInTargetIntent\(brief, "收尾\|转化尾图\|closing"\)/,
  "Closing burn-in should require an explicit closing/ending target instead of piggybacking on poster copy"
);
assert.match(
  source,
  /function hasFallbackCopyBurnInTargetIntent[\s\S]*const localGap = "\[\^[\s\S]*\]\{0,12\}";[\s\S]*new RegExp/,
  "fallback burn-in target detection should stay local so 海报文案烧进图 does not force detail copy burn-in"
);
assert.match(
  source,
  /const copyPattern = "烧字\|烧进\|进图\|带字\|出字"/,
  "fallback burn-in target detection should not treat the word 文案 alone as a burn-in request"
);
assert.match(
  source,
  /function hasFallbackCopyLayerTargetIntent[\s\S]*图层\|不进图\|不入图\|不烧字[\s\S]*new RegExp/,
  "explicit group-level layer copy requests should override nearby burn-in wording"
);
assert.match(
  source,
  /function getAgentPlanCopyEdit[\s\S]*copyIntentTerms[\s\S]*targetHasLocalIntent\(text, target, copyIntentTerms\)[\s\S]*isExplicitGlobalCopyIntent/,
  "natural-language copy edits should target the mentioned group unless the user explicitly says all/global"
);
assert.match(
  source,
  /function getAgentPlanCopyTextEdit[\s\S]*文案内容调整为[\s\S]*不要改商品包装标签/,
  "natural-language copy text edits should preserve copy content as safe-area or layout text instead of changing product labels"
);
assert.match(
  source,
  /function cleanAgentPlanCopyText[\s\S]*图层[\s\S]*不进图[\s\S]*烧进图/,
  "copy text edits should not mistake copy strategy phrases for visible copy content"
);
assert.match(
  source,
  /function applyAgentPlanCopyTextEditToMatrix[\s\S]*isAgentPlanCopyBearingMatrixItem[\s\S]*mergeAgentPlanContentInstruction/,
  "copy text edits without an explicit target should only touch copy-bearing plan groups"
);
assert.match(
  source,
  /planFallbackReason[\s\S]*我先展示基础计划[\s\S]*基础制作清单/,
  "Agent conversation should tell users when they are viewing a base plan fallback"
);
assert.match(
  source,
  /Agent 质检建议[\s\S]*商品一致性[\s\S]*文案安全区[\s\S]*这张重做/,
  "Agent should expose a post-generation QA summary with actionable redo guidance"
);
assert.match(
  source,
  /label="计划"[\s\S]*visibleOutputCount > 0 \? "已出图" : "待生成"[\s\S]*active=\{hasPlan \|\| visibleOutputCount > 0\}/,
  "Agent project context should not say the plan is pending when completed results already exist"
);
assert.match(
  source,
  /function buildAgentCompletionSummary[\s\S]*versionLineageSummary = formatAgentVersionLineageSummary\(visibleArtifacts\)[\s\S]*结果入口：画布结果墙已按用途分组[\s\S]*已标待重做 \$\{markedRedoCount\} 张[\s\S]*已保留\/已淘汰不会被重做[\s\S]*versionLineageSummary,/,
  "Agent completion summary should use current plan groups, review-state counts, version lineage, result-wall guidance, and single/group redo"
);
assert.match(
  source,
  /const canApplyResultReviewCommand = !hasEditTarget && visibleOutputCount > 0 && activeJobCount === 0[\s\S]*const canShowResultReviewAssistant = canApplyResultReviewCommand && !workflowPlanPreview[\s\S]*visibleOutputCount: canShowResultReviewAssistant \? visibleOutputCount : 0[\s\S]*visibleArtifacts: canShowResultReviewAssistant \? visibleArtifacts : \[\]/,
  "Agent result-review summary should stay hidden while a new plan preview or single-image edit is active"
);
assert.match(
  source,
  /const visibleAgentHistory = canShowResultReviewAssistant[\s\S]*agentEventHistory\.filter[\s\S]*!message\.id\.startsWith\("completion:"\) && message\.title !== "生成总结"[\s\S]*historyMessages: visibleAgentHistory/,
  "stale completion-summary history should not compete with active planning or edit context"
);
assert.match(
  source,
  /whitespace-pre-line[\s\S]*function buildAgentCompletionSummary[\s\S]*join\("\\n"\)/,
  "Agent completion summary should render as short chat lines instead of one dense paragraph"
);
assert.match(
  source,
  /completionSummary && \([\s\S]*space-y-2 rounded-lg border border-emerald[\s\S]*<div className="whitespace-pre-line">\{completionSummary\}<\/div>/,
  "standalone completion summary card should preserve short-line formatting while allowing executable actions"
);
assert.match(
  source,
  /function buildAgentCompletionNextAction[\s\S]*markedRedoCount[\s\S]*先点失败图重试[\s\S]*先执行 \$\{markedRedoCount\} 张待重做项[\s\S]*先点开烧字图检查安全区[\s\S]*先补商品参考图[\s\S]*先看模特脸、眼神、头和手/,
  "Agent completion next action should be driven by failed outputs, marked redo items, copy placement, product lock, and model consistency risks"
);
assert.match(
  source,
  /够用先看[\s\S]*建议重做前复查[\s\S]*建议先重做[\s\S]*下一步/,
  "Agent completion summary should be structured around usable images, redo risks, and the next action"
);
assert.match(
  source,
  /function getAgentArtifactFailureCount[\s\S]*failed[\s\S]*cancelled[\s\S]*metadata\?\.error/,
  "Agent completion summary should count failed artifacts so users know what to retry first"
);
assert.match(
  source,
  /function getAgentUsableArtifactLabels[\s\S]*formatAgentArtifactPointer[\s\S]*第 \$\{index \+ 1\} 张/,
  "Agent completion summary should point to concrete finished images instead of only generic groups"
);
assert.match(
  source,
  /function formatAgentVersionLineageSummary[\s\S]*getAgentArtifactVersionSourceLabel[\s\S]*版本关系：\$\{preview\}\$\{more\}。[\s\S]*function getAgentArtifactVersionContextText[\s\S]*这是从「\$\{source\}」重做出的新版本/,
  "Agent completion and suggestion copy should explain rerun version lineage"
);
assert.match(
  source,
  /function getAgentSuggestedRedoTarget[\s\S]*burnInPoster[\s\S]*先检查烧字位置和文案安全区/,
  "Agent completion summary should prioritize burn-in poster checks when choosing a redo target"
);
assert.match(
  source,
  /function buildAgentCompletionRiskChecks[\s\S]*getAgentArtifactProviderReferenceRoles\(visibleArtifacts\)[\s\S]*商品形状\/Logo\/材质[\s\S]*模特身份和神态[\s\S]*文案安全区[\s\S]*空间光影/,
  "completion risk checks should cover product identity, model consistency, copy placement, and scene lighting"
);
assert.match(
  source,
  /function buildAgentQaSummaryItems[\s\S]*visibleArtifacts: PersistedGeneratedArtifact\[\][\s\S]*getAgentArtifactProviderReferenceRoles\(visibleArtifacts\)[\s\S]*versionLineageSummary = formatAgentVersionLineageSummary\(visibleArtifacts\)[\s\S]*label: "挑图"[\s\S]*label: "版本"[\s\S]*商品[\s\S]*模特[\s\S]*文案[\s\S]*光影[\s\S]*重做/,
  "Agent QA summary should read completed artifact metadata and cover picking progress, version lineage, product, model, copy, lighting, and redo guidance"
);
assert.match(
  source,
  /function getAgentArtifactProviderReferenceRoles[\s\S]*getOutputPreviewProviderReferenceImages\(metadata\)[\s\S]*assetInvocationPlan[\s\S]*getOutputPreviewAssetInvocationDecisions\(metadata\)/,
  "completed artifact metadata should contribute provider reference roles to Agent QA"
);
assert.match(
  source,
  /function getAgentArtifactBurnInCount[\s\S]*getOutputPreviewCopyRenderPolicy\(artifact\.metadata \?\? \{\}\)\?\.mode === "burn_in"/,
  "completed artifact metadata should contribute burn-in copy policy to Agent QA"
);
assert.match(
  source,
  /function getAgentPlanContentEdit[\s\S]*getFocusedAgentPlanEditTarget\(text\)[\s\S]*extractAgentPlanContentInstruction\(text\)/,
  "group edit mode should parse focused content changes like changing one group to a mall scene"
);
assert.match(
  source,
  /getAgentPlanContentEdit\(text\)[\s\S]*agentPlanMatrixItemMatchesTarget\(item, contentEdit\.target\)[\s\S]*mergeAgentPlanContentInstruction\(item\.summary, contentEdit\.instruction\)[\s\S]*agentPlanPreviewItemMatchesTarget\(item, contentEdit\.target\)[\s\S]*mergeAgentPlanContentInstruction\(item\.purpose, contentEdit\.instruction\)/,
  "focused content changes should update only the matching plan group instead of replanning the whole project"
);
assert.match(
  source,
  /id: "amazon"[\s\S]*keywords: \["amazon", "亚马逊", "listing", "asin"\]/,
  "plan edits should understand platform removal such as 不要亚马逊"
);
assert.match(
  source,
  /function getAgentPlanSoftRelativeDelta[\s\S]*少一点[\s\S]*加一组/,
  "plan edits should understand soft count changes such as 主图少一点 and 加一组场景"
);
assert.match(
  source,
  /function getAgentPlanGlobalTotalCountEdit[\s\S]*hasGlobalScope[\s\S]*整套[\s\S]*总张数[\s\S]*return null/,
  "plan edits should understand explicit global total count changes such as 整套只要 6 张"
);
assert.match(
  source,
  /const globalTotalCountEdit = getAgentPlanGlobalTotalCountEdit\(text\)[\s\S]*adjustAgentPlanMatrixToTotalCount[\s\S]*整套计划改为/,
  "global total count edits should adjust the whole visible plan instead of a single target group"
);
assert.match(
  source,
  /function adjustAgentPlanItemsToTotalCount[\s\S]*items\.slice\(0, count\)[\s\S]*cloneAgentPlanPreviewItem/,
  "global total count edits should safely trim or clone preview items"
);
assert.match(
  source,
  /function getAgentPlanRatioEdit[\s\S]*getAgentPlanRatioValue\(text\)[\s\S]*targets\.length === 0 && !isExplicitGlobalRatioIntent/,
  "plan edits should understand targeted ratio changes such as 主图改成 4:5 without making accidental global edits"
);
assert.match(
  source,
  /function getAgentPlanRatioValue[\s\S]*\[:：\][\s\S]*横版[\s\S]*竖版[\s\S]*方图/,
  "plan edits should normalize explicit ratios and common horizontal, vertical, and square wording"
);
assert.match(
  source,
  /const ratio = getAgentPlanRatioValue\(text\)[\s\S]*agentPlanMatrixItemMatchesScopeGroup\(item, group\) \? \{ \.\.\.item, ratio \}/,
  "scoped plan-group edits should apply ratio changes only to the focused group"
);
assert.match(
  source,
  /label: "比例"[\s\S]*values: diff\.ratioChanges/,
  "visible plan diff should show ratio changes as their own category"
);
assert.match(
  source,
  /id: "closing"[\s\S]*label: "收尾图"[\s\S]*keywords: \["收尾", "closing", "转化尾图"\][\s\S]*id: "poster"[\s\S]*keywords: \["海报", "卖点", "封面"/,
  "plan edits should treat 收尾图 as its own target instead of deleting all poster or selling-point images"
);
assert.match(
  source,
  /const minCount = edit\.delta < 0 && isSoftReduceAgentPlanEdit\(text\) \? 1 : 0/,
  "soft plan reductions should keep one image unless the user explicitly removes the group"
);
assert.match(
  source,
  /function getAgentPlanTargetInstruction[\s\S]*商场场景[\s\S]*applyAgentPlanContentInstructionToMatrix/,
  "adding a scene group should keep the requested scene direction such as 商场场景"
);
assert.match(
  source,
  /function applyAgentNamedScenePlanEdits[\s\S]*extractAgentNamedSceneTerms\(text, "remove"\)[\s\S]*extractAgentNamedSceneTerms\(text, "increase"\)[\s\S]*删除\$\{term\.label\}场景[\s\S]*\$\{term\.label\}场景增加[\s\S]*handledSceneIncrease/,
  "plan edits should support named scene changes such as 不要商场快闪 and 茶室多一张 without falling through to generic scene edits"
);
assert.match(
  source,
  /getAgentPlanRelativeCountEditsForTargets\(text\)\.filter[\s\S]*!\(edit\.target\.id === "scene" && namedSceneEdit\.handledSceneIncrease\)[\s\S]*contentEdit && !\(contentEdit\.target\.id === "scene" && namedSceneEdit\.handledSceneIncrease\)/,
  "named scene additions should not also rewrite all existing scene groups as the new scene"
);
assert.match(
  source,
  /function getAgentNamedSceneKeywords[\s\S]*"茶室"[\s\S]*"庭院"[\s\S]*"商场"[\s\S]*"快闪"/,
  "named scene edits should recognize common scene labels from multi-scene plans"
);
assert.match(
  source,
  /const seedItems = matching\.length > 0 \? matching : nextMatrix\.filter\(isAgentNamedSceneSeedMatrixItem\)[\s\S]*function isAgentNamedSceneSeedMatrixItem[\s\S]*!isAgentMarketingPosterLikeText/,
  "named scene increases should clone a true scene item instead of a marketing poster when the exact scene label is not already present"
);
assert.match(
  source,
  /function renameAgentPlanMatrixSceneClone[\s\S]*const slotId = getAgentNamedSceneSlotId\(label\)[\s\S]*outputSlotId: slotId[\s\S]*title: `\$\{label\}场景`/,
  "named scene clones should get a fresh scene slot so they appear as an independent plan group"
);
assert.match(
  source,
  /currentCount === 0 && edit\.delta > 0[\s\S]*createAgentPlanItemsForNewTarget[\s\S]*新增\$\{edit\.target\.label\}/,
  "natural-language plan edits should be able to add a new target group when none exists yet"
);
assert.match(
  source,
  /function createAgentPlanItemsForNewTarget[\s\S]*buildAgentPlanNewTargetPurpose[\s\S]*getAgentPlanNewTargetReferenceRoles/,
  "newly added plan groups should carry purpose, ratio, reference roles, and copy strategy"
);
assert.match(
  source,
  /if \(target\.id === "detail" && \/\(海报\|poster\|cover\|hero\|收尾\|scene\|场景\|主图\|静物\|still\|模特\|真人\|人物\|上身\|穿搭\|model\)/,
  "detail plan edits should not accidentally absorb model display or scene groups"
);
assert.match(
  source,
  /showUpload\s+className="h-full"/,
  "bottom asset library should own the upload entry"
);
assert.match(
  source,
  /\(\) => \[\.\.\.persistedAssets, \.\.\.modelAssets\]/,
  "default asset library should only show real persisted/model assets"
);
assert.doesNotMatch(
  source,
  /\.\.\.canvasAssets/,
  "default asset library should not mix built-in demo seed assets into real assets"
);
assert.match(
  source,
  /if \(!shouldRestore\) \{\s*setWorkflowMessage\(""\);\s*return;\s*\}/,
  "canvas should not auto-restore last workflow unless restore=1 is requested"
);
assert.match(
  source,
  /上传商品、生成模特\/场景\/风格资产，或者直接告诉 Agent 你要做哪一套图。/,
  "empty canvas should explain the asset preparation plus Agent-owned planning path"
);
assert.match(
  source,
  />\s*准备资产\s*</,
  "empty canvas should expose asset preparation as a direct action"
);
assert.match(
  source,
  />\s*告诉 Agent\s*</,
  "empty canvas should expose Agent as the direct planning action"
);
assert.match(
  source,
  /说需求，Agent 出计划/,
  "empty Agent state should advertise Agent as the main planning input"
);
assert.match(
  source,
  /让 Agent 规划/,
  "primary empty Agent action should be phrased as Agent-owned planning"
);
assert.match(
  source,
  /drawerPrimaryToolOptions/,
  "drawer should keep primary project/output tools separate from advanced tools"
);
assert.match(
  source,
  /showDrawerAdvancedTools/,
  "drawer should hide diagnostics, queue, export, templates, and factory behind a secondary advanced reveal"
);
assert.match(
  source,
  />\s*高级工具\s*</,
  "advanced drawer tools should be explicitly collapsed under a secondary label"
);
assert.match(
  source,
  /activeProjectStarterPrompt/,
  "canvas should read the optional project template starter prompt"
);
assert.match(
  source,
  /已带入项目模板需求；上传素材后可让 Agent 规划。/,
  "template starter prompt should be surfaced as Agent context without auto-running"
);
assert.doesNotMatch(
  source,
  /activeProjectStarterPrompt[\s\S]{0,500}handleComposeWorkflow\(/,
  "template starter prompt should not auto-run planning or generation"
);
assert.doesNotMatch(
  source,
  /未选商品/,
  "empty Agent state should not foreground a missing-product error"
);
assert.doesNotMatch(
  assetTraySource,
  /拖入生成框/,
  "asset tray copy should not expose generation frames as the main interaction"
);
assert.doesNotMatch(
  contextMenuSource,
  /生成框菜单/,
  "context menu should call the internal generation frame a user-facing image set task"
);
assert.match(
  contextMenuSource,
  /图组任务菜单/,
  "context menu should describe internal generation frames as image set tasks"
);
assert.match(
  generationFrameNodeSource,
  /data-generation-frame-internal="true"/,
  "generation frame nodes should render as small internal Agent task status nodes"
);
assert.match(
  generationFrameNodeSource,
  /<InternalGenerationTaskNode[\s\S]*export const GenerationFrameNode = memo/,
  "generation frame nodes should be only the internal task UI"
);
assert.doesNotMatch(
  generationFrameNodeSource,
  /dispatchUploadFile|generation-frame-file-upload|CompactAssetFrameNode|ImageSetProductionBand|GenerationFrameOutputPreviewModal/,
  "generation frame nodes should not keep legacy upload, asset-frame, or gallery UI branches"
);
assert.match(
  generationFrameNodeSource,
  /Agent 任务[\s\S]*素材和需求由右上角 Agent 统一规划/,
  "internal generation frame UI should tell users that Agent owns the request path"
);
assert.match(
  assetTraySource,
  /拖到画布/,
  "asset tray should describe the user-facing drag target as the canvas"
);
assert.match(
  source,
  /useWorkbenchJobs\(\{ workflowId \}\)/,
  "visual-workbench should delegate jobs, artifacts, and queue state to useWorkbenchJobs"
);
assert.match(
  source,
  /buildLineActionAgentBrief/,
  "dragging a line from an asset should prepare an Agent brief instead of exposing a generation frame"
);
assert.match(
  source,
  /onPrepareAgentFromLineAction/,
  "line action menu should route into the Agent path"
);
assert.match(
  source,
  /setComposeBrief\(buildLineActionAgentBrief\(action, sourceLabel\)\)/,
  "line action menu should fill the top Agent input"
);
assert.doesNotMatch(
  source,
  /source: "line-action-menu"/,
  "line action menu should not create visible or hidden frame nodes as the user-facing action"
);
assert.doesNotMatch(
  source,
  /可拖进图组/,
  "workbench copy should describe text and knowledge nodes as Agent references, not frame inputs"
);
assert.doesNotMatch(
  source,
  /商品框|模特框|场景框|风格框|图组工作单|选择图组类型|拖入图组/,
  "canvas main surface should not reintroduce frame-based labels or frame-local work orders"
);
assert.doesNotMatch(
  outputAssetTargetSource,
  /生成框|商品框|模特框|场景框|风格框/,
  "saved output asset descriptions should point to canvas and Agent reuse, not generation frames"
);
assert.match(
  outputAssetTargetSource,
  /拖到画布供 Agent 复用/,
  "saved output assets should describe the new reusable asset path"
);
assert.doesNotMatch(
  source,
  /onCreateBlankGenerationFrame|onCreateProductAsset|onCreateModelAsset|onCreateSceneAsset|onCreateStyleAsset|getFrameActionIdFromContextAction/,
  "canvas stage should not keep user-facing branches for manually creating generation frames"
);
assert.doesNotMatch(
  source,
  /放入图组/,
  "asset library should place selected assets on the canvas instead of inserting them into a generation frame"
);
assert.doesNotMatch(
  contextMenuSource,
  /create-generation-frame|create-frame-custom-template|create-product-asset|create-model-asset|create-scene-asset|create-style-asset|add-to-generation-frame/,
  "right-click menu actions should not expose manual generation-frame creation or insertion"
);
assert.match(
  source,
  /onPlaceSelectedItemOnCanvas/,
  "asset tray selected-item action should place assets on the canvas"
);
assert.match(
  source,
  /素材已放到画布，可作为 Agent 参考/,
  "asset tray click path should create canvas reference nodes for Agent planning"
);
assert.match(
  source,
  /showGenerator=\{false\}/,
  "bottom asset library should stay a pure asset drawer by default"
);
assert.doesNotMatch(
  source,
  /setAssetLibraryGeneratorOpen|用作参考/,
  "bottom asset library should not expose asset-generator/reference-picking controls as the main path"
);
assert.doesNotMatch(
  projectDetailSource + projectBatchDetailSource,
  /创建生成框/,
  "project pages should route empty or failed batch states back to Agent planning, not manual generation-frame creation"
);
assert.doesNotMatch(
  source,
  /async function fetchPersistedJobs\b/,
  "visual-workbench should not re-own job list fetching"
);
assert.doesNotMatch(
  source,
  /async function fetchPersistedArtifacts\b/,
  "visual-workbench should not re-own artifact list fetching"
);
assert.match(
  workbenchJobsHookSource,
  /refreshJobs[\s\S]*refreshArtifacts[\s\S]*refreshQueue/,
  "useWorkbenchJobs should own refresh functions for job/artifact/queue state"
);

console.log("canvas entry surface smoke passed");
