#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const workbenchPath = path.join(root, "components/canvas/visual-workbench.tsx");
const source = fs.readFileSync(workbenchPath, "utf8");

assert.match(
  source,
  /interface AgentImageEditTarget[\s\S]*prompt\?: string;[\s\S]*metadata\?: Record<string, unknown>;/,
  "image revision target should keep original prompt and metadata"
);

assert.match(
  source,
  /const metadata = mergeGenerationOutputPreviewMetadata\(\{ artifact, job \}\);[\s\S]*prompt: getGenerationOutputPreviewPrompt\(\{ artifact, job, metadata \}\),[\s\S]*metadata,/,
  "clicking a result for revision should capture the artifact/job metadata and original prompt"
);

assert.match(
  source,
  /setOutputPreview\(null\);[\s\S]*setAgentImageEditTarget\(target\);[\s\S]*setAgentPanelCollapsed\(false\);[\s\S]*setComposeBrief\(""\);/,
  "choosing Modify from image detail should close the preview, expand Agent, and clear stale brief text"
);
assert.match(
  source,
  /const fallbackRetryToImageEdit[\s\S]*image-master:generation-frame-output-edit[\s\S]*没有可直接重跑的任务，已切到让 Agent 改这张[\s\S]*这张图暂时不能直接重做，已切到让 Agent 改这张/,
  "single-image retry should fall back to Agent edit mode when a direct retry is unavailable"
);
assert.match(
  source,
  /fallbackNote[\s\S]*detail\.note[\s\S]*\$\{fallbackNote\}；已选中「\$\{target\.title\}」，直接说要怎么改。[\s\S]*note: message/,
  "single-image retry fallback should explain why it switched into Agent edit mode"
);
assert.match(
  source,
  /const handleClearAgentImageEditTarget = useCallback\(\(\) => \{[\s\S]*setAgentImageEditTarget\(null\);[\s\S]*setComposeBrief\(""\);[\s\S]*setComposeMessage\(""\);[\s\S]*onClearEditTarget=\{handleClearAgentImageEditTarget\}/,
  "cancelling single-image edit mode should clear stale selected-image status text"
);

assert.match(
  source,
  /const editTextareaRef = useRef<HTMLTextAreaElement \| null>\(null\);[\s\S]*editTextareaRef\.current\?\.focus\(\);[\s\S]*data-testid="agent-image-edit-brief"/,
  "image revision mode should focus the Agent edit brief field"
);

assert.match(
  source,
  /function buildAgentEditContextHint[\s\S]*上一版成片参考[\s\S]*只改这张，不改其它图组，也不重写整套计划[\s\S]*图组用途沿用[\s\S]*强参考会带回[\s\S]*文字约束继续继承[\s\S]*原 prompt 会作为必要约束继承/,
  "image revision mode should explain that the previous image, provider references, and prompt-only constraints stay in context"
);

assert.match(
  source,
  /function buildAgentEditContextHint[\s\S]*mode === "burn_in"[\s\S]*原本烧进图的短文案会继续按安全区处理/,
  "single-image edit mode should explain that burn-in copy policy stays scoped to the current image"
);

assert.match(
  source,
  /id: "agent-edit-context"[\s\S]*title: "单图修改上下文"[\s\S]*text: editContextHint/,
  "Agent conversation should include a single-image modification context message"
);

assert.match(
  source,
  /const originalPrompt = truncateRevisionText\(target\.prompt, 1200\);[\s\S]*原图组用途[\s\S]*原始生成 prompt/,
  "revision prompts should include a bounded copy of the original generation prompt and original image purpose"
);

assert.match(
  source,
  /function buildAgentImageRevisionPrompt[\s\S]*本次只修改这张成片，不扩展为整套项目重做/,
  "revision prompts should keep the user request scoped to the selected image"
);

assert.match(
  source,
  /setComposeMessage\(buildAgentImageRevisionMessage\(target, brief\)\)/,
  "submitting a single-image edit should use a contextual Agent response instead of a generic loading message"
);

assert.match(
  source,
  /function buildAgentImageRevisionMessage[\s\S]*单图修改，只影响这张，不重写整套计划[\s\S]*图组用途沿用[\s\S]*比例沿用[\s\S]*强参考继续带回[\s\S]*原 prompt 已作为必要约束带回[\s\S]*原烧字策略继续保留/,
  "single-image edit submission should explain preserved purpose, ratio, prompt, references, and burn-in copy policy"
);

assert.match(
  source,
  /function buildAgentFocusedGroupHint[\s\S]*只影响这组 \$\{group\.count\} 张[\s\S]*这组用途继续按[\s\S]*参考角色继续按/,
  "focused result group context should explain preserved group purpose and reference roles"
);

assert.match(
  source,
  /function buildAgentResultGroupRevisionMessage[\s\S]*其他图组保持不动/,
  "group edit submission should explain scoped group-only changes"
);
assert.match(
  source,
  /function buildAgentResultGroupRevisionMessage[\s\S]*图组用途继续按/,
  "group edit submission should explain preserved group purpose"
);
assert.match(
  source,
  /function buildAgentResultGroupRevisionMessage[\s\S]*保留参考角色/,
  "group edit submission should explain preserved reference roles"
);
assert.match(
  source,
  /function buildAgentResultGroupRevisionMessage[\s\S]*比例沿用/,
  "group edit submission should explain preserved ratio"
);

assert.match(
  source,
  /function getAgentRevisionPurposeText[\s\S]*planItemTitle[\s\S]*planItemType[\s\S]*exportSpecId[\s\S]*function getAgentRevisionPurposeTypeLabel/,
  "revision context should derive a user-facing purpose from saved generation metadata"
);

assert.match(
  source,
  /const originalContext =[\s\S]*normalizeGenerationReferenceContext\(target\.metadata\?\.referenceContext\)[\s\S]*normalizeGenerationReferenceContext\(target\.metadata\)/,
  "revision reference context should inherit the original structured reference context"
);

assert.match(
  source,
  /const originalProviderImages = target\.metadata[\s\S]*getOutputPreviewProviderReferenceImages\(target\.metadata\)[\s\S]*const originalPromptOnlyImages = target\.metadata[\s\S]*getOutputPreviewPromptOnlyReferenceImages\(target\.metadata\)/,
  "revision reference context should inherit original provider and prompt-only references"
);

assert.match(
  source,
  /上一版成片[\s\S]*\.\.\.originalProviderImages\.map[\s\S]*providerMode: "provider_input"[\s\S]*\.\.\.originalPromptOnlyImages\.map[\s\S]*providerMode: "prompt_only"/,
  "revision provider inputs should include the previous output plus original references with explicit modes"
);

assert.match(
  source,
  /assetInvocationPlan: revisionAssetInvocationPlan[\s\S]*assetInvocationPlanner:[\s\S]*agent_image_revision_v1[\s\S]*originalPrompt: target\.prompt/,
  "revision jobs should persist invocation strategy and original prompt metadata"
);

assert.match(
  source,
  /function buildAgentImageRevisionAssetInvocationPlan[\s\S]*providerReferenceRoles[\s\S]*decisions/,
  "revision jobs should build a traceable asset invocation plan"
);

assert.match(
  source,
  /function canRetryImageJob[\s\S]*job\.status === "done"[\s\S]*job\.status === "completed"/,
  "successful batch images should be eligible for single-image regenerate"
);

assert.match(
  source,
  /if \(canRetryImageJob\(job\)\) \{[\s\S]*handleRetryImageJob\(job\)[\s\S]*if \(canRerunImageJob\(job\)\) \{[\s\S]*handleRerunImageJob\(job\)[\s\S]*if \(canRetryJob\(job\)\) \{[\s\S]*handleRetryJob\(job\)/,
  "result detail retry should prefer image regenerate, then completed-image rerun, before generic failed-job retry"
);

assert.match(
  source,
  /const handleRerunImageJob = async \(job: PersistedGenerationJob\) => \{[\s\S]*\/api\/jobs\/\$\{encodeURIComponent\(job\.id\)\}\/rerun[\s\S]*Created from canvas image detail with original references[\s\S]*已带原参考图加入队列/,
  "canvas image detail should create a new version for completed Agent images through the rerun API"
);

assert.match(
  source,
  /function canRerunImageJob[\s\S]*job\.status === "done"[\s\S]*job\.resultUrl\.trim\(\)/,
  "completed Agent images should be eligible for rerun when prompt and result URL are present"
);

assert.match(
  source,
  /这张图暂时不能重做/,
  "result detail retry should explain when an image cannot be regenerated"
);

assert.match(
  source,
  /当前图片已带商品参考图重做完成[\s\S]*当前图片已按原 prompt 重做完成[\s\S]*当前图片重做失败/,
  "single-image regenerate copy should describe current-image regeneration, not failed-image retry"
);

assert.match(
  source,
  /带参考图重做当前图片[\s\S]*带参考图重做/,
  "batch image action copy should support regenerating successful images as current images"
);

console.log("agent image revision context smoke passed");
