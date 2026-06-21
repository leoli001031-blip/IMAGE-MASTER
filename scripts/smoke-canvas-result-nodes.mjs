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
  resultNodesSource,
  /const ARTIFACT_RESULT_LAYOUT_VERSION = 8[\s\S]*sourceVersionTitle = getArtifactRerunSourceTitle\(artifact\)[\s\S]*sourceVersionArtifactId = getArtifactRerunSourceArtifactId\(artifact\)[\s\S]*caption: sourceVersionTitle[\s\S]*新版，上一版：\$\{sourceVersionTitle\}[\s\S]*sourceVersionTitle[\s\S]*sourceVersionArtifactId/,
  "artifact result nodes should show rerun or Agent revision source version context on the result wall"
);
assert.match(
  workflowNodeSource,
  /getArtifactNodeCaptionMeta[\s\S]*sourceVersionTitle[\s\S]*"新版"/,
  "artifact result node caption metadata should mark rerun outputs as new versions"
);
assert.match(
  workflowNodeSource,
  /artifactSourceVersionTitle = isArtifactResult \? getArtifactNodeSourceVersionTitle\(data\) : ""[\s\S]*title=\{`上一版：\$\{artifactSourceVersionTitle\}`\}[\s\S]*<RefreshCw[\s\S]*新版[\s\S]*function getArtifactNodeSourceVersionTitle[\s\S]*sourceVersionTitle/,
  "artifact result nodes should render a visible new-version badge with previous-version context"
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
  /getStageArtifactSignature[\s\S]*rerunSourceArtifactTitle[\s\S]*rerunSourcePlanItemTitle[\s\S]*rerunSourceArtifactId[\s\S]*revisionSource/,
  "artifact result signatures should include rerun and Agent revision source metadata so version labels update"
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
  /<AgentProjectContextCard[\s\S]*<AgentScopeContextCard[\s\S]*focusedGroup=\{focusedPlanGroup\}[\s\S]*onClearFocusedGroup=\{\(\) => setFocusedPlanGroup\(null\)\}[\s\S]*<AgentConversation[\s\S]*function AgentScopeContextCard[\s\S]*data-testid="agent-active-scope"[\s\S]*单图：\$\{editTarget\.title\}[\s\S]*分组：\$\{focusedGroup\.title\}[\s\S]*结果墙：\$\{visibleOutputCount\} 张/,
  "Agent panel should show a clear current scope card before chat for single-image, group, and result-wall commands"
);
assert.match(
  workbenchSource,
  /function AgentScopeConfirmationRows[\s\S]*\{item\.label\}[\s\S]*\{item\.text\}[\s\S]*function getAgentScopeConfirmationItems[\s\S]*范围[\s\S]*继承[\s\S]*不影响[\s\S]*getAgentFocusedGroupInheritedText/,
  "Agent scope cards should summarize scope, inherited context, and unaffected areas as scan-friendly rows"
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
  /function AgentReviewSuggestionCards[\s\S]*const visibleSuggestions = suggestions\.slice\(0, 4\)[\s\S]*const hiddenSuggestionCount = Math\.max\(0, suggestions\.length - visibleSuggestions\.length\)[\s\S]*\{visibleSuggestions\.map\(\(suggestion\)[\s\S]*hiddenSuggestionCount > 0[\s\S]*还有 \{hiddenSuggestionCount\} 条建议未展开[\s\S]*function buildAgentExecutableReviewSuggestions[\s\S]*return suggestions;/,
  "Agent review suggestion cards should keep all candidate suggestions and explain when only the top items are shown"
);
assert.match(
  workbenchSource,
  /reviewProgressSummary = buildAgentReviewProgressSummary[\s\S]*activeFilter: resultReviewFilter[\s\S]*<AgentReviewProgress summary=\{reviewProgressSummary\} \/>[\s\S]*function AgentReviewProgress[\s\S]*data-testid="agent-review-progress"[\s\S]*summary\.scopeLabel \? `\$\{summary\.scopeLabel\}进度` : "挑图进度"[\s\S]*QA 风险 \{summary\.risk\}[\s\S]*function buildAgentReviewProgressSummary[\s\S]*activeFilter: ResultReviewFilter[\s\S]*getAgentReviewArtifactsForFilter\(visibleArtifacts, activeFilter\)[\s\S]*scopeLabel = activeFilter === "all" \? "" : getResultReviewFilterLabel\(activeFilter\)[\s\S]*getArtifactReviewStatus\(artifact\)[\s\S]*isArtifactVisualQaRisk\(artifact\)/,
  "Agent review assistant should show filtered pick progress before executable suggestions"
);
assert.match(
  workbenchSource,
  /reviewSuggestionArtifacts = canShowResultReviewAssistant[\s\S]*getAgentReviewArtifactsForFilter\(visibleArtifacts, resultReviewFilter\)[\s\S]*buildAgentExecutableReviewSuggestions\(\{[\s\S]*visibleArtifacts: reviewSuggestionArtifacts[\s\S]*function getAgentReviewArtifactsForFilter[\s\S]*filter === "all"[\s\S]*artifactMatchesResultReviewFilter\(artifact, filter\)/,
  "Agent executable suggestions should be generated from the active result-review filter subset"
);
assert.match(
  workbenchSource,
  /qaSummaryItems = buildAgentQaSummaryItems\(\{[\s\S]*visibleOutputCount: reviewSuggestionArtifacts\.length[\s\S]*visibleArtifacts: reviewSuggestionArtifacts[\s\S]*activeJobCount: canShowResultReviewAssistant \? activeJobCount : 1/,
  "Agent QA summary should describe the same active result-review filter subset as suggestions"
);
assert.match(
  workbenchSource,
  /showReviewSuggestionEmptyState[\s\S]*executableReviewSuggestions\.length === 0[\s\S]*<AgentReviewSuggestionEmptyState[\s\S]*filter=\{resultReviewFilter\}[\s\S]*count=\{reviewSuggestionArtifacts\.length\}[\s\S]*onShowAll=\{\(\) => onShowResultReviewFilter\?\.\("all"\)\}[\s\S]*function AgentReviewSuggestionEmptyState[\s\S]*当前「\$\{label\}」没有可执行建议[\s\S]*data-testid="agent-review-suggestion-empty"[\s\S]*显示全部/,
  "Agent review assistant should explain empty suggestion states and offer to show all results"
);
assert.match(
  workbenchSource,
  /AgentReviewSuggestionCards[\s\S]*getAgentReviewSuggestionImpactItems\(suggestion\)[\s\S]*\{item\.label\}[\s\S]*\{item\.text\}[\s\S]*function getAgentReviewSuggestionImpactItems[\s\S]*只影响这张结果图[\s\S]*只影响「\$\{suggestion\.groupTitle\}」\$\{count\} 张待处理图[\s\S]*已保留\/已淘汰和其他图组不动/,
  "Agent review suggestion cards should show what each executable suggestion affects before the user clicks"
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
  /function formatAgentReviewRemainingSummary[\s\S]*scopeLabel = "当前"[\s\S]*待检查 \$\{pending\}[\s\S]*建议重做 \$\{redo\}[\s\S]*生成失败 \$\{failed\}[\s\S]*\$\{scopeLabel\}还剩 \$\{remaining\} 张待处理/,
  "Agent review suggestion feedback should summarize remaining pending, redo, and failed results for the active scope"
);
assert.match(
  workbenchSource,
  /const getRemainingReviewText[\s\S]*formatAgentReviewRemainingSummary\(visibleArtifacts, overrides\)[\s\S]*const remainingText = getRemainingReviewText\(\[suggestion\.artifactId\], status\)[\s\S]*const remainingText = getRemainingReviewText\(groupArtifactIds, status\)/,
  "Agent review status actions should compute remaining counts after the clicked status change"
);
assert.match(
  workbenchSource,
  /lastReviewSuggestionExecution[\s\S]*setLastReviewSuggestionExecution\(execution\)[\s\S]*agent-review-action-feedback[\s\S]*最近执行：\{lastReviewSuggestionExecution\.label\}[\s\S]*lastReviewSuggestionExecution\.scopeText[\s\S]*影响[\s\S]*lastReviewSuggestionExecution\.scopeText/,
  "Agent review suggestion actions should keep visible recent-action confirmation and affected scope even if suggestions recalculate"
);
assert.match(
  workbenchSource,
  /interface AgentReviewSuggestionExecutionState[\s\S]*suggestionId: string;[\s\S]*scopeText\?: string;[\s\S]*recordAction[\s\S]*suggestionId: suggestion\.id[\s\S]*scopeText: getAgentReviewSuggestionExecutionScopeText\(suggestion\)[\s\S]*function getAgentReviewSuggestionExecutionScopeText[\s\S]*只影响「\$\{suggestion\.title\}」这张结果图[\s\S]*只影响「\$\{suggestion\.groupTitle\}」\$\{count\} 张待处理图/,
  "Agent review suggestion execution state should persist the affected target for post-click traceability"
);
assert.match(
  workbenchSource,
  /if \(!executableReviewSuggestionIds\) \{[\s\S]*setLastReviewSuggestionExecution\(null\)[\s\S]*const ids = new Set\(executableReviewSuggestionIds\.split\("\|"\)\);[\s\S]*setLastReviewSuggestionExecution\(\(execution\) => \{[\s\S]*ids\.has\(execution\.suggestionId\)[\s\S]*return null;/,
  "Agent review suggestion feedback should clear when the active result filter no longer contains that suggestion"
);
assert.match(
  workbenchSource,
  /AgentReviewSuggestionCards[\s\S]*executedActions[\s\S]*已执行：\{execution\.label\}[\s\S]*execution\.text[\s\S]*const disabled = executed && !isAgentReviewSuggestionRepeatableAction\(action\)[\s\S]*disabled=\{disabled\}[\s\S]*function isAgentReviewSuggestionRepeatableAction[\s\S]*action === "open"[\s\S]*action === "group_edit"/,
  "Agent review suggestion cards should keep repeatable detail/edit actions clickable while disabling completed status actions"
);
assert.match(
  workbenchSource,
  /handleAgentReviewSuggestionAction[\s\S]*image-master:generation-frame-output-open[\s\S]*image-master:generation-frame-output-retry[\s\S]*image-master:generation-frame-output-edit[\s\S]*image-master:artifact-group-retry/,
  "Agent review suggestion cards should execute detail, single redo, single edit, and group redo actions"
);
assert.match(
  workbenchSource,
  /action === "redo"[\s\S]*已按原参考图、比例和图组用途重做[\s\S]*getRemainingReviewText\(\)[\s\S]*artifact\?\.url[\s\S]*image-master:generation-frame-output-edit[\s\S]*没有可直接重跑的任务，已切到让 Agent 改这张[\s\S]*接下来只修改这张/,
  "Agent single-image redo suggestions should report remaining review work and select scoped edit when no direct retry job exists"
);
assert.match(
  workbenchSource,
  /handleEdit[\s\S]*const inferredGroup = artifact \? getAgentArtifactResultGroupLabel\(artifact\) : ""[\s\S]*const detailGroup = getStringValue\(detail\.group\)[\s\S]*metadata\.resultGroupTitle = detailGroup/,
  "single-image Agent edit targets should preserve or infer the source result group"
);
assert.match(
  workbenchSource,
  /handleRunAgentImageRevision[\s\S]*reviewStatusIntent = getAgentResultReviewStatusIntent\(brief\)[\s\S]*handleSetArtifactReviewStatus[\s\S]*Agent 自然语言[\s\S]*remainingText = formatAgentReviewRemainingSummary\(visibleArtifacts[\s\S]*只影响这张，其他图不变。\$\{remainingText\}[\s\S]*setComposingWorkflow\(true\)/,
  "focused single-image chat should mark review state and report remaining review work before creating revision jobs"
);
assert.match(
  workbenchSource,
  /handleRunAgentImageRevision[\s\S]*getAgentImageOpenDetailIntent\(brief\)[\s\S]*image-master:generation-frame-output-open[\s\S]*已打开「\$\{target\.title\}」详情[\s\S]*return[\s\S]*getAgentImageSaveAsAssetIntent\(brief\)/,
  "focused single-image chat should open the selected result detail before falling through to save or revision jobs"
);
assert.match(
  workbenchSource,
  /handleRunAgentImageRevision[\s\S]*getAgentImageSaveAsAssetIntent\(brief\)[\s\S]*image-master:generation-frame-output-save[\s\S]*已提交保存「\$\{target\.title\}」为资产[\s\S]*return[\s\S]*getAgentImageOpenFolderIntent\(brief\)/,
  "focused single-image chat should save the selected result as an asset before falling through to revision jobs"
);
assert.match(
  workbenchSource,
  /handleRunAgentImageRevision[\s\S]*getAgentImageOpenFolderIntent\(brief\)[\s\S]*image-master:generation-frame-output-open-folder[\s\S]*正在打开「\$\{target\.title\}」所在文件夹[\s\S]*return[\s\S]*getAgentImageDownloadIntent\(brief\)/,
  "focused single-image chat should open the selected result folder before falling through to revision jobs"
);
assert.match(
  workbenchSource,
  /handleRunAgentImageRevision[\s\S]*getAgentImageDownloadIntent\(brief\)[\s\S]*downloadAgentImageTarget\(target\.url, target\.title\)[\s\S]*已开始下载「\$\{target\.title\}」[\s\S]*return[\s\S]*getAgentImageCopyPromptIntent\(brief\)/,
  "focused single-image chat should download the selected result before falling through to revision jobs"
);
assert.match(
  workbenchSource,
  /handleRunAgentImageRevision[\s\S]*getAgentImageCopyPromptIntent\(brief\)[\s\S]*target\.prompt\?\.trim\(\)[\s\S]*navigator\.clipboard\?\.writeText[\s\S]*await navigator\.clipboard\.writeText\(targetPrompt\)[\s\S]*已复制「\$\{target\.title\}」的 prompt[\s\S]*return[\s\S]*getAgentImageVisualQaIntent\(brief\)/,
  "focused single-image chat should copy the selected result prompt before falling through to revision jobs"
);
assert.match(
  workbenchSource,
  /handleRunAgentImageRevision[\s\S]*getAgentImageVisualQaIntent\(brief\)[\s\S]*!target\.artifactId[\s\S]*还没有可质检的产物记录[\s\S]*handleRunArtifactVisualQa\(target\.artifactId\)[\s\S]*正在用 Agent 审核「\$\{target\.title\}」[\s\S]*return[\s\S]*getAgentImageRetryIntent\(brief\)/,
  "focused single-image chat should run visual QA for the selected artifact before falling through to revision jobs"
);
assert.match(
  workbenchSource,
  /handleRunAgentImageRevision[\s\S]*getAgentImageRetryIntent\(brief\)[\s\S]*image-master:generation-frame-output-retry[\s\S]*group: getAgentImageTargetGroupTitle\(target\)[\s\S]*正在按原上下文重做「\$\{target\.title\}」[\s\S]*return[\s\S]*keepCountIntent = getAgentResultGroupKeepCountIntent\(brief\)/,
  "focused single-image chat should execute direct single-image retry before falling through to review-state marking or revision jobs"
);
assert.match(
  workbenchSource,
  /handleRunAgentImageRevision[\s\S]*keepCountIntent = getAgentResultGroupKeepCountIntent\(brief\)[\s\S]*Agent 自然语言只保留 1 张[\s\S]*remainingText = formatAgentReviewRemainingSummary\(visibleArtifacts[\s\S]*当前选中的是单张图；要只保留 \$\{keepCountIntent\} 张[\s\S]*reviewStatusIntent = getAgentResultReviewStatusIntent\(brief\)/,
  "focused single-image chat should handle only-keep-one and reject larger only-keep-N group commands without creating revision jobs"
);
assert.match(
  workbenchSource,
  /handleRunAgentResultGroupRevision[\s\S]*getAgentResultGroupOpenFolderIntent\(brief\)[\s\S]*urls = sourceArtifacts[\s\S]*image-master:generation-frame-output-open-folder[\s\S]*urls,[\s\S]*artifactIds: sourceArtifacts\.map[\s\S]*正在打开「\$\{group\.title\}」这一组 \$\{urls\.length\} 张图所在文件夹[\s\S]*return[\s\S]*getAgentResultGroupVisualQaIntent\(brief\)/,
  "focused result-group chat should open the selected group folder before falling through to picking or revision jobs"
);
assert.match(
  workbenchSource,
  /handleRunAgentResultGroupRevision[\s\S]*getAgentResultGroupVisualQaIntent\(brief\)[\s\S]*qaArtifacts = sourceArtifacts\.filter[\s\S]*!isAgentArtifactFailed\(artifact\)[\s\S]*正在用 Agent 审核「\$\{group\.title\}」这一组 \$\{qaArtifacts\.length\} 张图[\s\S]*for \(const artifact of qaArtifacts\)[\s\S]*await handleRunArtifactVisualQa\(artifact\.id\)[\s\S]*已完成「\$\{group\.title\}」这一组 \$\{qaArtifacts\.length\} 张图的视觉 QA[\s\S]*return[\s\S]*getAgentResultGroupSaveAsAssetIntent\(brief\)/,
  "focused result-group chat should run visual QA for the selected group before falling through to picking or revision jobs"
);
assert.match(
  workbenchSource,
  /handleRunAgentResultGroupRevision[\s\S]*getAgentResultGroupSaveAsAssetIntent\(brief\)[\s\S]*saveTargets = sourceArtifacts[\s\S]*image-master:generation-frame-output-save[\s\S]*artifactId: target\.artifact\.id[\s\S]*group: group\.title[\s\S]*已提交保存「\$\{group\.title\}」这一组 \$\{saveTargets\.length\} 张图为资产[\s\S]*return[\s\S]*keepCountIntent = getAgentResultGroupKeepCountIntent\(brief\)/,
  "focused result-group chat should save the selected group as assets before falling through to picking or revision jobs"
);
assert.match(
  workbenchSource,
  /action === "group_redo"[\s\S]*retryableGroupArtifacts[\s\S]*length === 0[\s\S]*selectGroupForEdit[\s\S]*没有可直接重跑的任务[\s\S]*artifactIds: retryableGroupArtifacts\.map[\s\S]*\$\{retryableGroupArtifacts\.length\} 张待处理图[\s\S]*getRemainingReviewText\(\)/,
  "Agent group redo suggestions should report batch size and remaining review work, with scoped editing fallback"
);
assert.match(
  workbenchSource,
  /handleRunAgentResultGroupRevision[\s\S]*reviewStatusIntent = getAgentResultReviewStatusIntent\(brief\)[\s\S]*handleSetArtifactGroupReviewStatus[\s\S]*Agent 自然语言[\s\S]*remainingText = formatAgentReviewRemainingSummary\([\s\S]*sourceArtifacts[\s\S]*"本组"[\s\S]*只影响这组，其他图组不变。\$\{remainingText\}[\s\S]*getAgentActionableGroupSuggestionArtifacts/,
  "focused result-group chat should mark group review state and report scoped remaining review work before creating revision jobs"
);
assert.match(
  workbenchSource,
  /handleRunAgentResultGroupRevision[\s\S]*keepCountIntent = getAgentResultGroupKeepCountIntent\(brief\)[\s\S]*selectAgentResultGroupKeepArtifacts\(sourceArtifacts, keepCountIntent\)[\s\S]*Agent 自然语言只保留 \$\{keepCountIntent\} 张[\s\S]*remainingText = formatAgentReviewRemainingSummary\(sourceArtifacts[\s\S]*"本组"[\s\S]*const rejectText = rejectIds\.length > 0[\s\S]*没有淘汰其他图片[\s\S]*reviewStatusIntent = getAgentResultReviewStatusIntent\(brief\)/,
  "focused result-group chat should execute only-keep-N picking, report actual rejected count, and summarize remaining scoped work"
);
assert.match(
  workbenchSource,
  /function formatAgentReviewRemainingSummary\([\s\S]*scopeLabel = "当前"[\s\S]*return `\$\{scopeLabel\}没有待处理结果。`[\s\S]*return `\$\{scopeLabel\}还剩 \$\{remaining\} 张待处理/,
  "remaining review summaries should name the current scope instead of always implying the full result wall"
);
assert.match(
  workbenchSource,
  /function getAgentResultReviewStatusIntent[\s\S]*getAgentResultGroupKeepCountIntent\(text\)[\s\S]*待检查[\s\S]*needs_redo[\s\S]*rejected[\s\S]*approved/,
  "focused Agent chat should parse keep, redo, reject, and pending review-state intents without swallowing only-keep-N requests"
);
const resultReviewStatusIntentSource = workbenchSource.slice(
  workbenchSource.indexOf("function getAgentResultReviewStatusIntent"),
  workbenchSource.indexOf("function getAgentGlobalResultReviewTargets")
);
assert.ok(
  resultReviewStatusIntentSource.includes("const actionText = compactText") &&
    resultReviewStatusIntentSource.includes(".replace(/待重做(都|图|结果|项|的)/g, \"\")") &&
    resultReviewStatusIntentSource.includes(".replace(/已淘汰(都|图|结果|的)?/g, \"\")") &&
    resultReviewStatusIntentSource.includes("撤销|撤回|取消") &&
    resultReviewStatusIntentSource.includes("保留|淘汰|弃用|重做|待重做|建议重做|标记|状态") &&
    resultReviewStatusIntentSource.includes("待检") &&
    resultReviewStatusIntentSource.includes("回到") &&
    resultReviewStatusIntentSource.includes("这张|这组|这些") &&
    resultReviewStatusIntentSource.includes("这组不要") &&
    resultReviewStatusIntentSource.includes("这些不要") &&
    resultReviewStatusIntentSource.includes("一张都不要") &&
    resultReviewStatusIntentSource.includes("这张可以了") &&
    resultReviewStatusIntentSource.includes("就用这张") &&
    resultReviewStatusIntentSource.includes("这组收了") &&
    resultReviewStatusIntentSource.includes("需要重做") &&
    resultReviewStatusIntentSource.includes("该重来") &&
    resultReviewStatusIntentSource.includes("建议重来") &&
    resultReviewStatusIntentSource.indexOf("return \"rejected\"") < resultReviewStatusIntentSource.indexOf("return \"approved\"") &&
    resultReviewStatusIntentSource.indexOf("return \"approved\"") < resultReviewStatusIntentSource.indexOf("return \"needs_redo\""),
  "result review status parsing should strip target-scope words before detecting actions like 已淘汰都保留 or 待重做都淘汰"
);
assert.match(
  workbenchSource,
  /function getAgentResultGroupKeepCountIntent[\s\S]*只保留[\s\S]*parseAgentPlanEditCount[\s\S]*function selectAgentResultGroupKeepArtifacts[\s\S]*getAgentResultGroupKeepRank[\s\S]*status === "approved"[\s\S]*isArtifactVisualQaRisk/,
  "only-keep-N group picking should prefer already kept and lower-risk images"
);
assert.match(
  workbenchSource,
  /function getAgentImageSaveAsAssetIntent[\s\S]*保存为资产[\s\S]*素材库\|资产库[\s\S]*放到\(素材库\|资产库\)/,
  "single-image save-as-asset intent should require explicit asset-library wording"
);
assert.match(
  workbenchSource,
  /function getAgentResultGroupSaveAsAssetIntent[\s\S]*这组\|本组\|这一组\|当前组[\s\S]*保存为资产[\s\S]*素材库\|资产库/,
  "result-group save-as-asset intent should require explicit group and asset-library wording"
);
assert.match(
  workbenchSource,
  /function getAgentImageOpenDetailIntent[\s\S]*详情\|参考图\|提示词\|prompt[\s\S]*锁定信息\|参考信息[\s\S]*\/i\.test\(compactText\)/,
  "single-image detail intent should require explicit detail, reference, prompt, QA, or lock-info wording"
);
assert.match(
  workbenchSource,
  /function getAgentImageOpenFolderIntent[\s\S]*文件夹\|目录\|所在位置\|本地位置[\s\S]*finder\|访达[\s\S]*\/i\.test\(compactText\)/,
  "single-image open-folder intent should require explicit local folder wording"
);
assert.match(
  workbenchSource,
  /function getAgentResultGroupOpenFolderIntent[\s\S]*这组\|本组\|这一组\|当前组[\s\S]*文件夹\|目录\|所在位置\|本地位置[\s\S]*finder\|访达/,
  "result-group open-folder intent should require explicit group and local folder wording"
);
assert.match(
  workbenchSource,
  /function getAgentImageDownloadIntent[\s\S]*下载\|导出\|另存为[\s\S]*保存到\|保存至[\s\S]*本地保存/,
  "single-image download intent should require explicit download or local-save wording"
);
assert.match(
  workbenchSource,
  /function getAgentImageCopyPromptIntent[\s\S]*复制\|拷贝\|copy[\s\S]*prompt\|提示词\|原prompt\|原始prompt[\s\S]*\/i\.test\(compactText\)/,
  "single-image copy-prompt intent should require explicit prompt wording"
);
assert.match(
  workbenchSource,
  /function getAgentImageVisualQaIntent[\s\S]*待检查\|未检查\|没检查\|标记\|状态[\s\S]*return false[\s\S]*qa\|质检\|审核[\s\S]*检查\)\(这张\|当前\)/i,
  "single-image visual QA intent should avoid review-state wording and require explicit QA or check wording"
);
assert.match(
  workbenchSource,
  /function getAgentResultGroupVisualQaIntent[\s\S]*待检查\|未检查\|没检查\|标记\|状态[\s\S]*return false[\s\S]*qa\|质检\|审核[\s\S]*这组\|本组\|这一组\|当前组/,
  "result-group visual QA intent should avoid review-state wording and require explicit group QA wording"
);
assert.match(
  workbenchSource,
  /function getAgentImageRetryIntent[\s\S]*标记\|标为\|标成\|设为[\s\S]*建议重做\|待重做\|需要重做[\s\S]*return false[\s\S]*这张\|当前[\s\S]*重做\|重跑\|重试\|重新生成/,
  "single-image direct retry intent should require execution wording while excluding review-state marking language"
);
assert.match(
  workbenchSource,
  /function getAgentImageTargetGroupTitle[\s\S]*resultGroupTitle[\s\S]*rerunGroupTitle[\s\S]*layoutGroupTitle/,
  "single-image direct retry should preserve the selected result group when available"
);
assert.match(
  workbenchSource,
  /function downloadAgentImageTarget[\s\S]*document\.createElement\("a"\)[\s\S]*link\.download = `\$\{sanitizeAgentDownloadFileName\(title \|\| "image-master-result"\)\}\.png`[\s\S]*link\.click\(\)/,
  "single-image download should use a browser download link with a sanitized filename"
);
assert.match(
  workbenchSource,
  /handleApplyGlobalResultReviewCommand[\s\S]*keepCountIntent = getAgentResultGroupKeepCountIntent\(brief\)[\s\S]*keepCountIntent && \(hasScopeIntent \|\| !workflowPlanPreview\)[\s\S]*selectAgentResultGroupKeepArtifacts\(targets, keepCountIntent\)[\s\S]*handleSetArtifactGroupReviewStatus[\s\S]*Agent 自然语言只保留 \$\{keepCountIntent\} 张[\s\S]*只影响结果墙挑图状态/,
  "global only-keep-N review commands should pick from result-wall targets without hijacking unspecific plan edits while a preview is open"
);
assert.match(
  workbenchSource,
  /handleApplyGlobalResultReviewCommand[\s\S]*hasVisualQaIntent = hasAgentGlobalResultReviewVisualQaIntent\(brief\)[\s\S]*getAgentGlobalResultReviewTargets\(brief, visibleArtifacts, resultReviewFilter\)[\s\S]*qaArtifacts = targets\.filter[\s\S]*!isAgentArtifactFailed\(artifact\)[\s\S]*正在用 Agent 审核 \$\{qaArtifacts\.length\} 张\$\{scopeLabel\}[\s\S]*for \(const artifact of qaArtifacts\)[\s\S]*await handleRunArtifactVisualQa\(artifact\.id\)[\s\S]*已完成 \$\{qaArtifacts\.length\} 张\$\{scopeLabel\}的视觉 QA[\s\S]*return true[\s\S]*hasOpenFolderIntent = hasAgentGlobalResultReviewOpenFolderIntent\(brief\)/,
  "global result review commands should run visual QA for scoped result-wall targets before open-folder, save, retry, or status commands"
);
assert.match(
  workbenchSource,
  /handleApplyGlobalResultReviewCommand[\s\S]*hasOpenFolderIntent = hasAgentGlobalResultReviewOpenFolderIntent\(brief\)[\s\S]*getAgentGlobalResultReviewTargets\(brief, visibleArtifacts, resultReviewFilter\)[\s\S]*urls = targets[\s\S]*image-master:generation-frame-output-open-folder[\s\S]*urls,[\s\S]*artifactIds: targets\.map[\s\S]*正在打开 \$\{urls\.length\} 张\$\{scopeLabel\}所在文件夹[\s\S]*return true[\s\S]*hasSaveAsAssetIntent = hasAgentGlobalResultReviewSaveAsAssetIntent\(brief\)/,
  "global result review commands should open scoped result-wall folders before save, retry, or status commands"
);
assert.match(
  workbenchSource,
  /handleApplyGlobalResultReviewCommand[\s\S]*hasSaveAsAssetIntent = hasAgentGlobalResultReviewSaveAsAssetIntent\(brief\)[\s\S]*getAgentGlobalResultReviewTargets\(brief, visibleArtifacts, resultReviewFilter\)[\s\S]*saveTargets = targets[\s\S]*image-master:generation-frame-output-save[\s\S]*group: getGenerationOutputPreviewGroup\(target\.metadata, target\.artifact\)[\s\S]*已提交保存 \$\{saveTargets\.length\} 张\$\{scopeLabel\}为资产[\s\S]*return true[\s\S]*hasRetryIntent = hasAgentGlobalResultReviewRetryIntent\(brief\)/,
  "global result review commands should save scoped result-wall targets as assets before retry or status commands"
);
assert.match(
  workbenchSource,
  /handleApplyGlobalResultReviewCommand[\s\S]*filterIntent = getAgentGlobalResultReviewFilterIntent\(brief\)[\s\S]*setResultReviewFilter\(filterIntent\)[\s\S]*setHighlightedResultReviewFilter\(filterIntent\)[\s\S]*已切到「\$\{label\}」[\s\S]*const hasScopeIntent = hasAgentGlobalResultReviewScopeIntent\(brief\)/,
  "global result review commands should switch result-wall filters before treating text as status or redo commands"
);
assert.match(
  workbenchSource,
  /handleApplyGlobalResultReviewCommand[\s\S]*hasScopeIntent = hasAgentGlobalResultReviewScopeIntent\(brief\)[\s\S]*reviewStatus = getAgentResultReviewStatusIntent\(brief\)[\s\S]*getAgentGlobalResultReviewTargets\(brief, visibleArtifacts, resultReviewFilter\)[\s\S]*getAgentGlobalResultReviewScopeLabel\(brief, resultReviewFilter\)[\s\S]*当前结果墙里没有找到可处理的\$\{scopeLabel\}[\s\S]*setComposeBrief\(""\)[\s\S]*正在把 \$\{targetIds\.length\} 张\$\{scopeLabel\}标记为[\s\S]*remainingText = formatAgentReviewRemainingSummary[\s\S]*handleSetArtifactGroupReviewStatus[\s\S]*只影响当前结果墙。\$\{remainingText\}/,
  "global result review commands should clear the command, show progress, report remaining review work, and avoid falling through to planning"
);
assert.match(
  workbenchSource,
  /handleApplyGlobalResultReviewCommand[\s\S]*hasRetryIntent = hasAgentGlobalResultReviewRetryIntent\(brief\)[\s\S]*getAgentGlobalResultReviewTargets\(brief, visibleArtifacts, resultReviewFilter\)[\s\S]*当前结果墙里没有找到可重做的\$\{scopeLabel\}[\s\S]*image-master:artifact-group-retry[\s\S]*artifactIds: targets\.map[\s\S]*return true[\s\S]*const reviewStatus = getAgentResultReviewStatusIntent\(brief\)/,
  "global result review commands should execute scoped redo requests before treating them as status-marking commands"
);
assert.match(
  workbenchSource,
  /canApplyResultReviewCommand = !hasEditTarget && visibleOutputCount > 0 && activeJobCount === 0[\s\S]*handlePrimaryAction = async[\s\S]*canApplyResultReviewCommand && composeBrief\.trim\(\) && !focusedPlanGroup && !hasEditTarget[\s\S]*onApplyResultReviewCommand\(composeBrief\)[\s\S]*if \(handled\) return[\s\S]*workflowPlanPreview && focusedPlanGroup/,
  "Agent primary action should try global result review commands before plan or generation actions, even when a stale plan preview still exists"
);
assert.match(
  workbenchSource,
  /canShowResultReviewAssistant = canApplyResultReviewCommand && !workflowPlanPreview/,
  "Agent should still hide review suggestions while a plan preview is open, without disabling review command parsing"
);
assert.match(
  workbenchSource,
  /if \(key\.startsWith\("completion:"\)\)[\s\S]*items\.filter\(\(item\) => !item\.id\.startsWith\("completion:"\) && item\.title !== "生成总结"\)[\s\S]*\.slice\(-8\)/,
  "Agent conversation history should keep only the latest completion summary instead of stacking transient batch-review summaries"
);
assert.match(
  workbenchSource,
  /function getAgentGlobalResultReviewTargets[\s\S]*activeFilter: ResultReviewFilter = "all"[\s\S]*targetsRedoScope = \/\(待重做\(都\|图\|结果\|项\|的\)[\s\S]*targetsPendingScope[\s\S]*targetsApprovedScope[\s\S]*targetsRejectedScope[\s\S]*getArtifactReviewStatus\(artifact\) === "rejected"[\s\S]*hasAgentCurrentFilteredResultScopeIntent\(compactText\)[\s\S]*activeFilter === "all"[\s\S]*artifactMatchesResultReviewFilter\(artifact, activeFilter\)[\s\S]*return artifacts[\s\S]*function hasAgentCurrentFilteredResultScopeIntent[\s\S]*所有结果\|全部结果\|结果墙[\s\S]*function hasAgentGlobalResultReviewScopeIntent/,
  "global result review commands should separate explicit status scopes and let current-filter pronouns target the filtered subset"
);
assert.match(
  workbenchSource,
  /function getAgentGlobalResultReviewFilterIntent[\s\S]*只看\|仅看[\s\S]*全部\|所有[\s\S]*QA风险[\s\S]*待重做[\s\S]*待检查[\s\S]*已淘汰[\s\S]*已保留[\s\S]*return null/,
  "global filter intent parsing should cover common result-wall filter phrases without requiring new UI controls"
);
const resultReviewRetryIntentSource = workbenchSource.slice(
  workbenchSource.indexOf("function hasAgentGlobalResultReviewRetryIntent"),
  workbenchSource.indexOf("function getAgentGlobalResultReviewScopeLabel")
);
assert.ok(
  resultReviewRetryIntentSource.includes("标记|标为|标成") &&
    resultReviewRetryIntentSource.includes("重新生成") &&
    resultReviewRetryIntentSource.includes("重做一下") &&
    resultReviewRetryIntentSource.includes("待重做(都|图|结果|项|的)") &&
    resultReviewRetryIntentSource.includes("当前筛选") &&
    resultReviewRetryIntentSource.includes("return hasRetryAction && hasTargetScope"),
  "global redo execution intent should require an execution verb plus an explicit result scope, while excluding status-marking language"
);
assert.match(
  workbenchSource,
  /function hasAgentGlobalResultReviewSaveAsAssetIntent[\s\S]*hasAgentGlobalResultReviewScopeIntent\(text\)[\s\S]*保存为资产[\s\S]*素材库\|资产库/,
  "global save-as-asset intent should require explicit result scope and asset-library wording"
);
assert.match(
  workbenchSource,
  /function hasAgentGlobalResultReviewVisualQaIntent[\s\S]*hasAgentGlobalResultReviewScopeIntent\(text\)[\s\S]*标记\|标为\|标成[\s\S]*return false[\s\S]*qa\|质检\|审核[\s\S]*当前筛选/,
  "global visual QA intent should require explicit result scope and QA wording while excluding status-marking language"
);
assert.match(
  workbenchSource,
  /function hasAgentGlobalResultReviewOpenFolderIntent[\s\S]*hasAgentGlobalResultReviewScopeIntent\(text\)[\s\S]*文件夹\|目录\|所在位置\|本地位置[\s\S]*finder\|访达/,
  "global open-folder intent should require explicit result scope and local-folder wording"
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
  /可以整组保留、标重做[\s\S]*actions: \["group_edit", "group_redo", "approve", "mark_needs_redo"\][\s\S]*可以整组标重做[\s\S]*actions: hasRisk[\s\S]*\["group_edit", "group_redo", "mark_needs_redo", "reject"\][\s\S]*\["group_edit", "group_redo", "approve", "mark_needs_redo"\]/,
  "Agent group suggestions should expose executable group keep, redo, and reject review-state actions"
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
  /<CanvasAgentPanel[\s\S]*resultReviewFilter=\{resultReviewFilter\}[\s\S]*resultReviewFilterCount=\{resultReviewFilterCounts\[resultReviewFilter\] \?\? 0\}[\s\S]*function AgentScopeContextCard[\s\S]*resultReviewFilter[\s\S]*resultReviewFilterCount[\s\S]*当前筛选「\$\{getResultReviewFilterLabel\(resultReviewFilter\)\}」\$\{resultReviewFilterCount\} 张/,
  "Agent scope card should mirror the active result-review filter context"
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
  /const activeOption = resultReviewFilterOptions\.find[\s\S]*isActiveFilterHighlighted[\s\S]*data-testid="result-review-active-filter"[\s\S]*正在查看：\{activeOption\.label\}[\s\S]*\{activeCount\} 张[\s\S]*onClick=\{\(\) => onChange\("all"\)\}[\s\S]*显示全部/,
  "result review filter should show a clear active-filter summary and a one-click return to all results"
);
assert.match(
  workbenchSource,
  /const emptyHint = value !== "all" && activeCount === 0[\s\S]*data-testid="result-review-empty-filter"[\s\S]*当前筛选没有命中[\s\S]*function getResultReviewEmptyFilterHint[\s\S]*needs_redo[\s\S]*让 Agent 只改这张[\s\S]*qa_risk[\s\S]*文案安全区/,
  "empty result-review filters should explain what to do next instead of leaving a blank result wall"
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
