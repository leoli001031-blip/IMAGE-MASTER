import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const resultNodesPath = path.join(root, "components/canvas/canvas-result-nodes.ts");
const workbenchPath = path.join(root, "components/canvas/visual-workbench.tsx");
const outputPreviewModalPath = path.join(root, "components/canvas/output-preview-modal.tsx");
const artifactRoutePath = path.join(root, "app/api/artifacts/[id]/route.ts");
const artifactVisualQaRoutePath = path.join(root, "app/api/artifacts/[id]/visual-qa/route.ts");
const artifactListRoutePath = path.join(root, "app/api/artifacts/route.ts");
const aiClientPath = path.join(root, "lib/ai/client.ts");

const resultNodesSource = fs.readFileSync(resultNodesPath, "utf8");
const workbenchSource = fs.readFileSync(workbenchPath, "utf8");
const outputPreviewModalSource = fs.readFileSync(outputPreviewModalPath, "utf8");
const workflowNodeSource = fs.readFileSync(path.join(root, "components/canvas/workflow-node.tsx"), "utf8");
const artifactRouteSource = fs.readFileSync(artifactRoutePath, "utf8");
const artifactVisualQaRouteSource = fs.readFileSync(artifactVisualQaRoutePath, "utf8");
const artifactListRouteSource = fs.readFileSync(artifactListRoutePath, "utf8");
const aiClientSource = fs.readFileSync(aiClientPath, "utf8");

for (const exportedName of [
  "getCanvasVisibleArtifacts",
  "getArtifactReconcileSignature",
  "reconcileArtifactResultNodes",
  "createArtifactResultNode",
  "getArtifactPreviewUrl",
  "getArtifactThumbnailUrl",
  "getArtifactResultWallFocusNodeIds",
  "mapArtifactToGenerationFrameOutput",
]) {
  assert.match(
    resultNodesSource,
    new RegExp(`export function ${exportedName}\\b`),
    `${exportedName} should live in canvas-result-nodes.ts`
  );
}

assert.match(
  workbenchSource,
  /from "@\/components\/canvas\/canvas-result-nodes"/,
  "visual-workbench should import the extracted result node helpers"
);
assert.match(
  resultNodesSource,
  /node\.data\.label[\s\S]*node\.data\.caption[\s\S]*node\.data\.artifactId/,
  "artifact reconcile signature should include visible label/caption text"
);
assert.match(
  resultNodesSource,
  /ARTIFACT_RESULT_LAYOUT_VERSION = [1-9]\d*/,
  "artifact result nodes should carry an explicit layout version"
);
assert.match(
  resultNodesSource,
  /ARTIFACT_RESULT_ROW_WIDTH[\s\S]*getArtifactResultDisplaySize/,
  "artifact result nodes should use a bounded row width and ratio-aware sizing helper"
);
assert.match(
  resultNodesSource,
  /layoutWidth[\s\S]*layoutHeight[\s\S]*layoutPositionKey/,
  "artifact result nodes should use ratio-aware masonry sizing metadata"
);
assert.match(
  resultNodesSource,
  /ARTIFACT_RESULT_CAPTION_HEIGHT[\s\S]*imageHeight \+ ARTIFACT_RESULT_CAPTION_HEIGHT/,
  "artifact result layout should include the always-visible caption height so rows do not overlap"
);
assert.match(
  resultNodesSource,
  /function compactArtifactResultTitle\b/,
  "artifact result nodes should compact long production titles for the canvas"
);
assert.match(
  resultNodesSource,
  /fullTitle[\s\S]*compactTitle[\s\S]*layoutGroup[\s\S]*layoutGroupCount[\s\S]*layoutGroupStart/,
  "artifact result node parameters should keep full provenance title and visible group metadata"
);
assert.match(
  resultNodesSource,
  /source: "artifact-group-header"[\s\S]*layoutRatios[\s\S]*layoutHeader: true/,
  "artifact result nodes should create lightweight group header nodes for each result category"
);
assert.match(
  resultNodesSource,
  /"详情图"[\s\S]*"细节图"[\s\S]*"模特图"[\s\S]*"场景图"[\s\S]*"卖点图"[\s\S]*"文案图"/,
  "artifact result wall should use user-facing image group labels, including copy images"
);
assert.match(
  resultNodesSource,
  /layoutHeaderAvailable: Boolean\(layout\)/,
  "artifact image nodes should know when repeated category badges can be suppressed"
);
assert.match(
  resultNodesSource,
  /!artifact\.url && !isArtifactFailed\(artifact\)[\s\S]*artifact\.url \|\| isArtifactFailed\(artifact\)/,
  "failed artifacts without image URLs should still appear in the review wall"
);
assert.match(
  resultNodesSource,
  /export function getArtifactResultWallFocusNodeIds[\s\S]*groupHeaders[\s\S]*previewResults[\s\S]*for \(const item of groupHeaders\) addFocusId/,
  "result wall focus should include group headers and cross-group preview items instead of only the first row"
);
assert.match(
  resultNodesSource,
  /previewUrl: getArtifactPreviewUrl\(artifact\)[\s\S]*referenceUrl: artifact\.url/,
  "artifact result nodes should use thumbnails for canvas preview while preserving the original URL for detail actions"
);
assert.match(
  resultNodesSource,
  /originalUrl: artifact\.url[\s\S]*thumbnailUrl: getArtifactThumbnailUrl\(artifact\)/,
  "artifact result node parameters should expose original and thumbnail URLs separately"
);
assert.match(
  workflowNodeSource,
  /getArtifactNodeGroupBadge[\s\S]*getArtifactNodeLayoutStyle[\s\S]*layoutWidth/,
  "artifact image nodes should render ratio-aware image wall items with group badges"
);
assert.match(
  workflowNodeSource,
  /getArtifactNodeCaptionMeta[\s\S]*line-clamp-1 text-\[12px\][\s\S]*artifactCaptionMeta/,
  "artifact image nodes should keep a lightweight visible title and purpose line instead of hiding all context behind hover"
);
assert.match(
  workflowNodeSource,
  /data\.source === "artifact-group-header"[\s\S]*ArtifactGroupHeaderNode[\s\S]*data-artifact-group-header="true"/,
  "artifact group headers should render as lightweight separators rather than normal workflow cards"
);
assert.match(
  workflowNodeSource,
  /layoutGroupHighlighted[\s\S]*data-artifact-group-highlighted=\{groupHighlighted \? "true" : undefined\}/,
  "artifact group headers should expose a brief highlighted state after group actions"
);
assert.match(
  workflowNodeSource,
  /layoutHeaderAvailable[\s\S]*return null/,
  "artifact result nodes should hide repeated group badges when a group header exists"
);
assert.match(
  workflowNodeSource,
  /border-transparent bg-transparent shadow-none[\s\S]*hover:scale-\[1\.005\]/,
  "artifact image nodes should reduce card chrome and feel like an image wall"
);
assert.match(
  workflowNodeSource,
  /isArtifactResult && "rounded-\[6px\] border-0 bg-transparent shadow-none"/,
  "artifact result images should not add a second card border or heavy shadow around each image"
);
assert.match(
  workflowNodeSource,
  /!isArtifactResult && \([\s\S]*<Handle[\s\S]*type="target"[\s\S]*!isArtifactResult && \([\s\S]*<Handle[\s\S]*type="source"/,
  "artifact image nodes should hide connection handles so the result wall reads as images, not workflow cards"
);
assert.doesNotMatch(
  resultNodesSource,
  /artifact-edge-|getArtifactResultEdgeId|appendedEdges/,
  "artifact result wall should not create React Flow edges to image nodes without handles"
);
assert.match(
  fs.readFileSync(path.join(root, "components/canvas/asset-preview.tsx"), "utf8"),
  /size === "canvasResultAuto"[\s\S]*object-contain p-0\.5/,
  "canvas result images should preserve full image content with minimal padding"
);
assert.match(
  workbenchSource,
  /const url = artifact\?\.url \|\| detail\.url/,
  "output preview should prefer artifact original URL over canvas thumbnail URL"
);
assert.match(
  workbenchSource,
  /OutputPreviewModal[\s\S]*onEdit[\s\S]*image-master:generation-frame-output-edit[\s\S]*onSaveAsAsset[\s\S]*image-master:generation-frame-output-save[\s\S]*onOpenFolder[\s\S]*image-master:generation-frame-output-open-folder/,
  "visual-workbench should delegate image preview actions to the extracted output preview modal"
);
assert.match(
  outputPreviewModalSource,
  /本图操作[\s\S]*onEdit[\s\S]*让 Agent 改[\s\S]*onSaveAsAsset[\s\S]*onOpenFolder/,
  "image detail preview should expose an explicit Agent-edit callback in the detail sidebar"
);
assert.match(
  outputPreviewModalSource,
  /canRetryOrEdit[\s\S]*item\.jobId \|\| item\.url[\s\S]*没有直接重跑任务时让 Agent 改这张[\s\S]*disabled=\{!canRetryOrEdit\}/,
  "image detail retry should stay clickable when a URL can fall back to Agent single-image edit"
);
assert.match(
  workflowNodeSource,
  /让 Agent 修改[\s\S]*dispatchArtifactEdit\(data, id\)[\s\S]*改图[\s\S]*保存为资产[\s\S]*dispatchArtifactSave\(data, id\)[\s\S]*重做[\s\S]*dispatchArtifactRetry\(data, id\)/,
  "artifact result cards should expose direct single-image Agent edit, save-as-asset, and retry actions"
);
assert.match(
  workflowNodeSource,
  /function dispatchArtifactEdit[\s\S]*const group = getArtifactGroupEditDetail\(data\)\?\.group;[\s\S]*image-master:generation-frame-output-edit[\s\S]*artifactId[\s\S]*jobId[\s\S]*url[\s\S]*getArtifactNodeFullTitle[\s\S]*group,/,
  "artifact result cards should dispatch the same single-image edit context and group as the detail preview"
);
assert.match(
  workflowNodeSource,
  /function dispatchArtifactSave[\s\S]*image-master:generation-frame-output-save[\s\S]*artifactId[\s\S]*jobId[\s\S]*url[\s\S]*getArtifactNodeFullTitle/,
  "artifact result cards should dispatch the same save-as-asset context as the detail preview"
);
assert.match(
  workflowNodeSource,
  /function dispatchArtifactRetry[\s\S]*const group = getArtifactGroupEditDetail\(data\)\?\.group;[\s\S]*image-master:generation-frame-output-retry[\s\S]*artifactId[\s\S]*jobId[\s\S]*url[\s\S]*getArtifactNodeFullTitle[\s\S]*group,/,
  "artifact result cards should dispatch the same single-image retry context and group as the detail preview"
);
assert.match(
  outputPreviewModalSource,
  /锁定摘要[\s\S]*lockSummary/,
  "image detail preview should expose a human-readable lock summary"
);
assert.match(
  outputPreviewModalSource,
  /providerRoleLabels\.length > 0 \? "参考角色见 Provider 输入" : "没有记录结构化引用角色"/,
  "image detail preview should not say structured references are missing when provider input roles are available"
);
assert.match(
  workbenchSource,
  /getOutputPreviewLockSummary/,
  "visual-workbench should still derive lock summary from output metadata"
);
assert.match(
  workbenchSource,
  /商品强锁/,
  "lock summary should explain product/model/scene/style reference roles in plain language"
);
for (const label of ["模特身份参考", "场景锁光影", "风格只约束质感"]) {
  assert.match(
    workbenchSource,
    new RegExp(label),
    `lock summary should include ${label}`
  );
}
assert.match(
  workbenchSource,
  /文案烧进图[\s\S]*文案图层[\s\S]*文案不进图/,
  "lock summary should make copy burn-in/layout/metadata policy visible"
);
assert.match(
  outputPreviewModalSource,
  /<details className="rounded-md border border-warm-line\/50 bg-warm-bg">[\s\S]*查看完整 prompt/,
  "image detail preview should keep long prompts available but collapsed by default"
);
assert.match(
  outputPreviewModalSource,
  /h-\[min\(72vh,620px\)\] w-full rounded-md object-contain/,
  "image detail preview should scale small originals up inside the large preview area"
);
assert.doesNotMatch(
  workbenchSource,
  /function OutputPreviewReferenceSection\b/,
  "output preview reference rendering should live outside visual-workbench"
);
assert.match(
  workbenchSource,
  /getArtifactResultWallFocusNodeIds\(reconciled\.nodes, 8\)/,
  "canvas should focus a coherent result wall row after artifact reconciliation"
);
assert.match(
  workbenchSource,
  /requestCanvasFocus\(getArtifactResultWallFocusNodeIds\(restoredNodes, 8\)\)/,
  "restored project canvases should also focus the result wall when results exist"
);

assert.match(
  resultNodesSource,
  /export type ArtifactReviewStatus = "approved" \| "pending" \| "needs_redo" \| "rejected" \| "failed"/,
  "artifact result nodes should define the five user-facing review states"
);
assert.match(
  resultNodesSource,
  /export function getArtifactReviewStatus[\s\S]*reviewState[\s\S]*return "pending"/,
  "artifact review status should default successful images to pending review"
);
assert.match(
  resultNodesSource,
  /getArtifactReviewStatusLabel[\s\S]*可用[\s\S]*待检查[\s\S]*建议重做[\s\S]*已淘汰[\s\S]*生成失败/,
  "artifact review status labels should match the picking workflow language"
);
assert.match(
  resultNodesSource,
  /JSON\.stringify\(artifact\.metadata\.reviewState \?\? null\)/,
  "artifact result signatures should include review state so badges update after marking"
);
assert.match(
  resultNodesSource,
  /layoutReviewSummary[\s\S]*getArtifactGroupReviewSummary/,
  "artifact groups should expose review-state summaries for quick scanning"
);
assert.match(
  workflowNodeSource,
  /image-master:artifact-review-state[\s\S]*image-master:artifact-group-review-state[\s\S]*image-master:artifact-group-retry/,
  "canvas result nodes should dispatch single-image, group-review, and group-retry actions"
);
assert.match(
  workflowNodeSource,
  /保留这组[\s\S]*重做这组[\s\S]*淘汰这组[\s\S]*调整这组/,
  "artifact group headers should expose keep, redo, reject, and adjust actions"
);
assert.match(
  workflowNodeSource,
  /保留这张[\s\S]*按原上下文重做这张[\s\S]*淘汰这张/,
  "artifact cards should expose keep, retry, and reject actions"
);
assert.match(
  outputPreviewModalSource,
  /reviewStatus[\s\S]*onSetReviewStatus[\s\S]*保留[\s\S]*onSetReviewStatus\("pending"\)[\s\S]*待检[\s\S]*onSetReviewStatus\("needs_redo"\)[\s\S]*待重做[\s\S]*淘汰/,
  "image detail preview should let users mark or reset review state without confusing it with immediate retry"
);
assert.match(
  outputPreviewModalSource,
  /const retryTitle = item\.jobId[\s\S]*立即重做当前图[\s\S]*没有直接重跑任务时让 Agent 改这张[\s\S]*onClick=\{onRetry\}[\s\S]*重做/,
  "image detail preview should label immediate retry separately from the needs-redo review state"
);
assert.match(
  outputPreviewModalSource,
  /原图用途 \/ 比例[\s\S]*getOutputPreviewPurposeLabel[\s\S]*getOutputPreviewRatioLabel/,
  "image detail preview should explicitly show original purpose and ratio"
);
assert.match(
  workbenchSource,
  /handleSetArtifactReviewStatus[\s\S]*\/api\/artifacts\/\$\{encodeURIComponent\(artifactId\)\}[\s\S]*reviewState/,
  "visual workbench should persist image review state through the artifact API"
);
assert.match(
  workbenchSource,
  /window\.addEventListener\("image-master:artifact-review-state"[\s\S]*"image-master:artifact-group-review-state"[\s\S]*"image-master:artifact-group-retry"/,
  "visual workbench should wire review and group retry events"
);
assert.match(
  workbenchSource,
  /highlightedArtifactGroupTitle[\s\S]*withArtifactGroupHighlightContext[\s\S]*layoutGroupHighlighted/,
  "visual workbench should pass highlighted group context into result group headers"
);
assert.match(
  workbenchSource,
  /handleGroupReviewState[\s\S]*setHighlightedArtifactGroupTitle\(String\(detail\.group\)\)[\s\S]*handleGroupRetry[\s\S]*setHighlightedArtifactGroupTitle\(String\(detail\.group\)\)/,
  "group keep/retry actions should briefly highlight the affected result group"
);
assert.match(
  workbenchSource,
  /handleGroupRetry[\s\S]*jobIds\.length === 0[\s\S]*没有可重跑的待处理图片[\s\S]*已切到调整这组[\s\S]*image-master:artifact-group-edit/,
  "direct group retry should fall back to scoped group editing when no retryable jobs exist"
);
assert.match(
  workbenchSource,
  /handleGroupRetry[\s\S]*retryableArtifacts[\s\S]*getArtifactReviewStatus\(artifact\)[\s\S]*status !== "approved" && status !== "rejected"[\s\S]*待处理图片[\s\S]*已保留和已淘汰图片不受影响/,
  "direct group retry should skip already-approved and rejected images"
);
assert.match(
  workbenchSource,
  /<CanvasAgentPanel[\s\S]*onHighlightArtifactGroup=\{setHighlightedArtifactGroupTitle\}[\s\S]*handleArtifactGroupEdit[\s\S]*onHighlightArtifactGroup\(title\)/,
  "group adjust actions should briefly highlight the affected result group"
);
assert.match(
  workbenchSource,
  /const selectGroupForEdit[\s\S]*onHighlightArtifactGroup\(groupTitle\)[\s\S]*action === "group_edit"[\s\S]*selectGroupForEdit/,
  "Agent group edit suggestions should reuse the scoped group-edit path and highlight the affected group"
);
assert.match(
  workbenchSource,
  /AgentReviewSuggestionCards[\s\S]*agent-review-suggestions[\s\S]*getAgentReviewSuggestionActionLabel[\s\S]*看详情[\s\S]*执行重做/,
  "Agent completion recommendations should render executable suggestion cards with a direct detail action"
);
assert.match(
  workbenchSource,
  /setExecutedReviewSuggestionActions[\s\S]*getAgentReviewSuggestionActionLabel\(action\)[\s\S]*text/,
  "Agent review suggestion actions should record visible per-card execution feedback"
);
assert.match(
  workbenchSource,
  /onShowResultReviewFilter=\{\(filter\) => \{[\s\S]*setResultReviewFilter\(filter\)[\s\S]*setHighlightedResultReviewFilter\(filter\)[\s\S]*showReviewFilterForStatus[\s\S]*getResultReviewFilterForArtifactReviewStatus\(status\)[\s\S]*onShowResultReviewFilter\?\.\(filter\)[\s\S]*已切到「\$\{filterLabel\}」/,
  "Agent review suggestion status actions should switch the result wall to the affected review-state filter"
);
assert.match(
  workbenchSource,
  /lastReviewSuggestionExecution[\s\S]*setLastReviewSuggestionExecution\(execution\)[\s\S]*agent-review-action-feedback[\s\S]*最近执行：\{lastReviewSuggestionExecution\.label\}/,
  "Agent review suggestion actions should keep a visible recent-action confirmation even if suggestions recalculate"
);
assert.match(
  workbenchSource,
  /AgentReviewSuggestionCards[\s\S]*executedActions[\s\S]*已执行：\{execution\.label\}[\s\S]*execution\.text[\s\S]*executed && "border-emerald-300[\s\S]*disabled=\{executed\}[\s\S]*这个建议动作已执行/,
  "Agent review suggestion cards should show and disable the action that has already run"
);
assert.match(
  workbenchSource,
  /handleAgentReviewSuggestionAction[\s\S]*image-master:generation-frame-output-open[\s\S]*image-master:generation-frame-output-retry[\s\S]*image-master:generation-frame-output-edit[\s\S]*image-master:artifact-group-retry/,
  "Agent review suggestion cards should execute detail, single redo, single edit, and group redo actions"
);
assert.match(
  workbenchSource,
  /action === "redo"[\s\S]*artifact\?\.url[\s\S]*image-master:generation-frame-output-edit[\s\S]*没有可直接重跑的任务，已切到让 Agent 改这张[\s\S]*接下来只修改这张/,
  "Agent single-image redo suggestions should select the image for scoped edit when no direct retry job exists"
);
assert.match(
  workbenchSource,
  /handleEdit[\s\S]*const inferredGroup = artifact \? getAgentArtifactResultGroupLabel\(artifact\) : ""[\s\S]*const detailGroup = getStringValue\(detail\.group\)[\s\S]*metadata\.resultGroupTitle = detailGroup/,
  "single-image Agent edit targets should preserve or infer the source result group"
);
assert.match(
  workbenchSource,
  /action === "group_redo"[\s\S]*retryableGroupArtifacts[\s\S]*length === 0[\s\S]*selectGroupForEdit[\s\S]*没有可直接重跑的任务[\s\S]*artifactIds: retryableGroupArtifacts\.map/,
  "Agent group redo suggestions should fall back to scoped group editing when no retryable jobs exist"
);
assert.match(
  workbenchSource,
  /视觉 QA 风险[\s\S]*\["open", "edit", "mark_needs_redo", "approve"\][\s\S]*检查烧字图[\s\S]*\["open", "copy", "mark_needs_redo", "approve"\][\s\S]*优先挑关键图[\s\S]*\["open", "edit", "approve", "reject"\]/,
  "Agent review suggestions that ask users to inspect a result should expose a direct detail action"
);
assert.match(
  workbenchSource,
  /function buildAgentExecutableGroupSuggestion[\s\S]*getAgentActionableGroupSuggestionArtifacts[\s\S]*artifactIds: explicitGroup\.artifacts\.map[\s\S]*只改这一组待处理图片/,
  "Agent group suggestions should only bind actionable pending or redo images, not already picked results"
);
assert.match(
  workbenchSource,
  /function getAgentActionableGroupSuggestionArtifacts[\s\S]*reviewStatus !== "approved" && reviewStatus !== "rejected"/,
  "Agent group suggestions should skip already kept or rejected images"
);
assert.match(
  artifactRouteSource,
  /normalizeReviewStatePatch[\s\S]*reviewState[\s\S]*artifactDB\.update\(id,[\s\S]*metadata: \{[\s\S]*\.\.\.existing\.metadata[\s\S]*reviewState/,
  "artifact PATCH should merge review state into existing metadata instead of replacing prompt/reference context"
);
assert.match(
  artifactListRouteSource,
  /summarizeReviewState[\s\S]*reviewState: summarizeReviewState\(metadata\.reviewState\)/,
  "artifact list summaries should include persisted review state for refresh/reopen"
);
assert.match(
  resultNodesSource,
  /export type ArtifactVisualQaStatus = "pass" \| "warn" \| "fail" \| "pending"/,
  "artifact result nodes should define visual QA states"
);
for (const dimension of ["product_drift", "model_consistency", "lighting", "copy_safe_area"]) {
  assert.match(
    resultNodesSource,
    new RegExp(dimension),
    `visual QA should cover ${dimension}`
  );
}
assert.match(
  resultNodesSource,
  /getArtifactVisualQaSummary[\s\S]*visualQaStatus[\s\S]*layoutVisualQaSummary/,
  "artifact result nodes should expose per-image and group visual QA summaries"
);
assert.match(
  workflowNodeSource,
  /getArtifactVisualQaBadge[\s\S]*getArtifactVisualQaBadgeClassName/,
  "artifact cards should show compact visual QA badges"
);
assert.match(
  outputPreviewModalSource,
  /视觉 QA[\s\S]*visualQa\.issues/,
  "image detail preview should show visual QA issues"
);
assert.match(
  aiClientSource,
  /analyzeArtifactVisualQa[\s\S]*ARTIFACT_VISUAL_QA_SYSTEM[\s\S]*product_drift[\s\S]*model_consistency[\s\S]*lighting[\s\S]*copy_safe_area/,
  "AI client should provide a vision-model artifact QA evaluator for the four commercial risk dimensions"
);
assert.match(
  artifactVisualQaRouteSource,
  /readOutputImageAsDataUrl[\s\S]*analyzeArtifactVisualQa[\s\S]*artifactDB\.update\(id,[\s\S]*visualQa/,
  "artifact visual QA route should read local output images, run the evaluator, and persist visualQa metadata"
);
assert.match(
  artifactVisualQaRouteSource,
  /mock_visual_qa_v1[\s\S]*IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER/,
  "artifact visual QA route should support mock mode for smoke/front-end tests without burning provider calls"
);
assert.match(
  artifactListRouteSource,
  /summarizeVisualQa[\s\S]*visualQa: summarizeVisualQa\(metadata\.visualQa\)/,
  "artifact list summaries should keep persisted visual QA for result-wall refresh and filtering"
);
assert.match(
  outputPreviewModalSource,
  /visualQaReviewing[\s\S]*onRunVisualQa[\s\S]*Agent 审核/,
  "image detail preview should expose an executable Agent visual QA action"
);
assert.match(
  workbenchSource,
  /handleRunArtifactVisualQa[\s\S]*\/api\/artifacts\/\$\{encodeURIComponent\(artifactId\)\}\/visual-qa[\s\S]*setOutputPreview/,
  "visual workbench should call the visual QA route and refresh the active preview metadata"
);
assert.match(
  workbenchSource,
  /ResultReviewFilterBar[\s\S]*resultReviewFilter[\s\S]*isCanvasNodeVisibleForResultReviewFilter/,
  "canvas should expose a result review filter view"
);
assert.match(
  workbenchSource,
  /highlightedResultReviewFilter[\s\S]*getResultReviewFilterForArtifactReviewStatus\(status\)[\s\S]*ResultReviewFilterBar[\s\S]*highlightedValue=\{highlightedResultReviewFilter\}/,
  "review status changes should visually highlight the matching result-review filter"
);
assert.match(
  workbenchSource,
  /function ResultReviewFilterBar[\s\S]*highlightedValue[\s\S]*highlighted && !active[\s\S]*ring-emerald-200/,
  "result review filter buttons should show a brief highlight when counts change from a review action"
);
assert.match(
  workbenchSource,
  /type ResultReviewFilter = "all" \| "approved" \| "pending" \| "needs_redo" \| "rejected" \| "failed" \| "qa_risk"[\s\S]*只看待检查[\s\S]*只看已淘汰[\s\S]*只看 QA 风险/,
  "result review filter should expose every pick-state plus a QA-risk view for large result sets"
);
assert.match(
  workbenchSource,
  /buildResultReviewFilterCounts[\s\S]*pending: 0[\s\S]*rejected: 0[\s\S]*status === "pending"[\s\S]*status === "rejected"[\s\S]*qa_risk[\s\S]*isArtifactVisualQaRisk/,
  "result review filter counts should include pending, rejected, and visual QA risk counts"
);
assert.match(
  workbenchSource,
  /getResultReviewFilterForArtifactReviewStatus[\s\S]*status === "pending"[\s\S]*return "pending"[\s\S]*status === "rejected"[\s\S]*return "rejected"/,
  "review status changes should highlight pending and rejected filters too"
);
assert.match(
  workbenchSource,
  /isCanvasNodeVisibleForResultReviewFilter[\s\S]*filter === "qa_risk"[\s\S]*isArtifactVisualQaRisk/,
  "result review filtering should show QA-risk images and matching group headers"
);
assert.match(
  workbenchSource,
  /withResultReviewFilterContext[\s\S]*layoutFilterActive[\s\S]*layoutFilteredCount[\s\S]*layoutFilteredArtifactIds[\s\S]*layoutFilteredArtifactTitles[\s\S]*buildArtifactReviewSummaryParts[\s\S]*buildArtifactVisualQaSummaryParts/,
  "filtered result group headers should receive filtered counts, artifact ids, titles, and status summaries"
);
assert.match(
  workflowNodeSource,
  /layoutFilterActive[\s\S]*筛选后 \$\{filteredCount\} \/ 共 \$\{filteredTotalCount\}/,
  "artifact group headers should display partial filter counts like 筛选后 1 / 共 3"
);
assert.match(
  workflowNodeSource,
  /layoutFilteredArtifactIds[\s\S]*layoutFilteredArtifactTitles[\s\S]*actionArtifactIds[\s\S]*filterActive[\s\S]*filteredArtifactIds\.length > 0[\s\S]*dispatchArtifactGroupReviewState\(\{[\s\S]*artifactIds: actionArtifactIds[\s\S]*dispatchArtifactGroupRetry\(\{[\s\S]*artifactIds: actionArtifactIds/,
  "filtered group actions should operate only on visible filtered artifact ids"
);
assert.match(
  workbenchSource,
  /maxAutoVisualQaArtifactsPerBatch[\s\S]*autoVisualQaFreshWindowMs[\s\S]*autoVisualQaSeenArtifactIdsRef[\s\S]*autoVisualQaPreJobArtifactIdsRef[\s\S]*handleRunArtifactVisualQa/,
  "visual workbench should automatically audit bounded fresh artifacts without re-auditing stale historical results"
);
assert.match(
  workbenchSource,
  /isFreshAutoVisualQaCandidate[\s\S]*Date\.now\(\) - time <= autoVisualQaFreshWindowMs/,
  "automatic visual QA should only treat recently generated first-load artifacts as auto-audit candidates"
);
assert.match(
  workbenchSource,
  /Agent 正在自动审核[\s\S]*Agent 已自动审核/,
  "automatic visual QA should surface progress in the lightweight artifact message"
);
assert.match(
  workbenchSource,
  /formatAgentVisualQaSummary[\s\S]*getAgentVisualQaRiskLabels[\s\S]*getAgentArtifactVisualQaRiskText/,
  "Agent completion summary should include executable visual QA risks"
);
assert.match(
  workbenchSource,
  /originalRatio[\s\S]*originalCopyRenderPolicy[\s\S]*originalVisualQa[\s\S]*revisionScope/,
  "single-image and group redo jobs should preserve ratio, copy policy, visual QA, and revision scope"
);
assert.match(
  workbenchSource,
  /buildAgentGroupRevisionPromptContext[\s\S]*只重做[\s\S]*不要重写整个项目计划/,
  "group redo prompts should be scoped to the selected group"
);

for (const localFunction of [
  "getCanvasVisibleArtifacts",
  "getArtifactReconcileSignature",
  "reconcileArtifactResultNodes",
  "createArtifactResultNode",
]) {
  assert.doesNotMatch(
    workbenchSource,
    new RegExp(`function ${localFunction}\\b`),
    `${localFunction} should not be redefined inside visual-workbench.tsx`
  );
}

console.log("canvas result node extraction smoke passed");
