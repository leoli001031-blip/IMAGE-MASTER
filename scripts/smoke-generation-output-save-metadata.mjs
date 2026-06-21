#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const workbenchSource = fs.readFileSync(path.join(root, "components/canvas/visual-workbench.tsx"), "utf8");
const outputPreviewModalSource = fs.readFileSync(path.join(root, "components/canvas/output-preview-modal.tsx"), "utf8");
const assetsRouteSource = fs.readFileSync(path.join(root, "app/api/assets/route.ts"), "utf8");
const resultPageSource = fs.readFileSync(path.join(root, "app/result/page.tsx"), "utf8");
const imageDetailPanelSource = fs.readFileSync(path.join(root, "components/result/image-detail-panel.tsx"), "utf8");
const imageCardSource = fs.readFileSync(path.join(root, "components/result/image-card.tsx"), "utf8");
const imageGroupSource = fs.readFileSync(path.join(root, "components/result/image-group.tsx"), "utf8");
const resultEditTargetStorageSource = fs.readFileSync(path.join(root, "lib/canvas/result-edit-target-storage.ts"), "utf8");

assert.match(
  workbenchSource,
  /const job = artifact\?\.jobId[\s\S]*jobs\.find[\s\S]*mergeGenerationOutputPreviewMetadata\(\{ artifact, job \}\)/,
  "saving a generated output as an asset should merge artifact and job metadata"
);

assert.match(
  workbenchSource,
  /const outputPrompt = getGenerationOutputPreviewPrompt\(\{ artifact, job, metadata: artifactMetadata \}\)/,
  "saving a generated output as an asset should capture the original prompt"
);

assert.match(
  workbenchSource,
  /\.\.\.buildSavedGenerationOutputTraceMetadata\(\{[\s\S]*metadata: artifactMetadata,[\s\S]*artifact,[\s\S]*job,[\s\S]*prompt: outputPrompt,[\s\S]*\}\)/,
  "saved output assets should preserve trace metadata in one explicit helper"
);

assert.match(
  workbenchSource,
  /setPersistedAssets\(\(items\) => \[asset,[\s\S]*setActiveCategory\(asset\.category\)[\s\S]*setAssetFavoritesOnly\(false\)[\s\S]*setActiveBottomPanel\("assets"\)[\s\S]*setAssetLibraryFocusItemId\(`asset:\$\{asset\.id\}`\)/,
  "saving a generated output should open the asset library and select the saved asset"
);

assert.match(
  workbenchSource,
  /getArtifactReviewStatus\(artifact\) !== "approved"[\s\S]*source: "generation-frame-output-save"[\s\S]*\/api\/artifacts\/\$\{encodeURIComponent\(artifact\.id\)\}[\s\S]*已标记为可用/,
  "saving a generated output as an asset should mark the source result as approved for picking"
);

assert.match(
  workbenchSource,
  /showGenerator=\{false\}/,
  "asset library opened from saved outputs should keep the bottom tray in asset-management mode"
);

assert.match(
  workbenchSource,
  /function buildSavedGenerationOutputTraceMetadata[\s\S]*getOutputPreviewProviderReferenceImages\(metadata\)[\s\S]*getOutputPreviewPromptOnlyReferenceImages\(metadata\)[\s\S]*assetInvocationPlan:[\s\S]*copyRenderPolicy:/,
  "saved output trace metadata should include strong references, weak references, invocation plan, and copy policy"
);

assert.match(
  workbenchSource,
  /activeOutputCopyPolicy = getOutputPreviewCopyRenderPolicy\(activeOutputPreviewMetadata\)[\s\S]*copyPolicy=\{activeOutputCopyPolicy\}/,
  "canvas image preview should pass copy policy details to the extracted preview modal"
);

assert.match(
  outputPreviewModalSource,
  /文案策略[\s\S]*画面文字：[\s\S]*禁止声明：/,
  "canvas image preview modal should show copy policy details next to prompt and references"
);

assert.match(
  imageDetailPanelSource,
  /providerReferenceRoles\?: string\[\];[\s\S]*promptOnlyRoles\?: string\[\];[\s\S]*调用总览[\s\S]*强参考：[\s\S]*文字\/约束：/,
  "shared image detail panel should summarize strong and prompt-only invocation roles"
);

assert.match(
  imageDetailPanelSource,
  /onSaveAsAsset\?: \(item: ImageDetailItem\) => void;[\s\S]*<ActionBtn icon=\{Save\} label="存为资产"/,
  "shared image detail panel should expose save-as-asset only inside the detail surface"
);
assert.match(
  imageDetailPanelSource,
  /onEdit\?: \(item: ImageDetailItem\) => void;[\s\S]*Wand2[\s\S]*label="让 Agent 改"/,
  "shared image detail panel should expose a handoff action for Agent single-image edits"
);
assert.match(
  imageDetailPanelSource,
  /onSetReviewStatus\?:[\s\S]*挑图状态[\s\S]*label="保留"[\s\S]*label="待重做"[\s\S]*label="淘汰"/,
  "shared image detail panel should let result surfaces mark keep, redo, and reject review states"
);

assert.match(
  imageDetailPanelSource,
  /item\.url && \([\s\S]*label="看原图"/,
  "shared image detail panel should allow opening the original image even when prompt metadata is missing"
);

assert.match(
  imageDetailPanelSource,
  /h-\[min\(70vh,720px\)\] w-full[\s\S]*h-full w-full rounded-lg object-contain/,
  "shared image detail panel should scale small originals up inside the large preview area"
);

assert.match(
  imageDetailPanelSource,
  /exportCopy\?: string\[\];[\s\S]*forbiddenClaims\?: string\[\];[\s\S]*导出文案[\s\S]*禁止声明/,
  "shared image detail panel should expose structured copy layers beyond in-image text"
);

assert.match(
  workbenchSource,
  /focusItemId\?: string;[\s\S]*useEffect\(\(\) => \{[\s\S]*if \(!focusItemId\) return;[\s\S]*setSelectedTrayItemId\(focusItemId\)/,
  "asset library should focus the saved asset when opened from a generated result"
);

assert.match(
  workbenchSource,
  /function getTraceableImageUrl[\s\S]*data:image\/[\s\S]*url\.length > 4096/,
  "saved output trace metadata should avoid persisting large inline reference images"
);

assert.match(
  assetsRouteSource,
  /assetInvocationPlan: summarizeAssetInvocationPlan\(metadata\.assetInvocationPlan\)[\s\S]*copyRenderPolicy: summarizeCopyRenderPolicy\(metadata\.copyRenderPolicy\)[\s\S]*productReferenceFocus:/,
  "asset list summaries should keep saved-output trace metadata after reload"
);

assert.match(
  resultPageSource,
  /providerReferenceRoles: getStringArray\(plan\.providerReferenceRoles\)[\s\S]*promptOnlyRoles: getStringArray\(plan\.promptOnlyRoles\)/,
  "result detail data should keep asset invocation strong and prompt-only roles"
);

assert.match(
  resultPageSource,
  /resolveGenerationOutputAssetTarget[\s\S]*handleSaveAsAsset[\s\S]*fetch\("\/api\/assets"[\s\S]*source: "result-page-save"[\s\S]*savedAssetType: saveTarget\.savedAssetType/,
  "result page details should save generated images back into the asset library with trace metadata"
);
assert.match(
  resultPageSource,
  /writePendingResultEditTarget[\s\S]*prompt: sourceImage\.prompt \|\| getMetadataString\(metadata, "prompt"\)[\s\S]*router\.push\("\/canvas\?restore=1&editResult=1"\)/,
  "result page detail edits should hand off the selected image, prompt, and metadata to the canvas Agent"
);
assert.match(
  resultPageSource,
  /buildPersistedResultReviewUpdate[\s\S]*\/api\/artifacts\/\$\{encodeURIComponent\(artifactId\)\}[\s\S]*reviewState[\s\S]*handleSetResultReviewStatus[\s\S]*onSetReviewStatus=\{\(item, status\)/,
  "result page image details should persist keep, pending, redo, and reject review states"
);
assert.match(
  resultPageSource,
  /async function resolveImageArtifactId[\s\S]*getImageArtifactId\(image\)[\s\S]*getImageJobId\(image\)[\s\S]*\/api\/artifacts\?jobId=\$\{encodeURIComponent\(jobId\)\}&limit=1/,
  "result page should resolve restored recent job images back to artifacts before persisting review state"
);
assert.match(
  resultPageSource,
  /handleSetResultGroupReviewStatus[\s\S]*result-page-group-review[\s\S]*onSetGroupReviewStatus=\{handleSetResultGroupReviewStatus\}/,
  "result page groups should batch mark keep, redo, and reject review states"
);
assert.match(
  resultPageSource,
  /writePendingResultGroupEditTarget\(buildResultGroupEditTarget\(groupTitle, images\)\)[\s\S]*router\.push\("\/canvas\?restore=1&editResult=1&editGroup=1"\)/,
  "result page group edits should hand off scoped group context to the canvas Agent"
);
assert.match(
  resultPageSource,
  /function buildResultGroupEditTarget[\s\S]*artifactIds:[\s\S]*jobIds:/,
  "result page group edit handoff should include artifact ids and job ids"
);
assert.match(
  workbenchSource,
  /takePendingResultEditTarget\(\)[\s\S]*setAgentImageEditTarget\(target\)[\s\S]*已从结果页带入/,
  "canvas Agent should restore a pending result-page edit target"
);
assert.match(
  workbenchSource,
  /focusedGroupArtifacts[\s\S]*focusedPlanGroup\?\.artifactIds[\s\S]*focusedPlanGroup\?\.jobIds[\s\S]*ids\.has\(artifact\.id\)[\s\S]*jobIds\.has\(artifact\.jobId\)/,
  "canvas Agent should match focused result groups by artifact id or job id"
);
assert.match(
  workbenchSource,
  /takePendingResultGroupEditTarget\(\)[\s\S]*setFocusedPlanGroup\(\{[\s\S]*artifactIds: target\.artifactIds \?\? \[\][\s\S]*jobIds: target\.jobIds \?\? \[\][\s\S]*已从结果页带入/,
  "canvas Agent should restore a pending result-page group edit target"
);
assert.match(
  resultEditTargetStorageSource,
  /PENDING_RESULT_EDIT_METADATA_KEYS[\s\S]*referenceContext[\s\S]*copyRenderPolicy[\s\S]*visualQa/,
  "result-page Agent edit handoff should keep only metadata needed for scoped image revision"
);
assert.match(
  resultEditTargetStorageSource,
  /MAX_PENDING_METADATA_TEXT_LENGTH[\s\S]*MAX_PENDING_INLINE_IMAGE_URL_LENGTH[\s\S]*compactPendingResultEditMetadata[\s\S]*data:image\/[\s\S]*MAX_PENDING_INLINE_IMAGE_URL_LENGTH/,
  "result-page Agent edit handoff should avoid storing oversized inline reference images"
);
assert.match(
  resultEditTargetStorageSource,
  /const url = getStorageSafeImageUrl\(value\.url\)[\s\S]*function getStorageSafeImageUrl[\s\S]*data:image\/[\s\S]*MAX_PENDING_INLINE_IMAGE_URL_LENGTH/,
  "result-page Agent edit handoff should reject oversized inline result image URLs before sessionStorage"
);
assert.match(
  resultEditTargetStorageSource,
  /PENDING_RESULT_GROUP_EDIT_TARGET_STORAGE_KEY[\s\S]*writePendingResultGroupEditTarget[\s\S]*takePendingResultGroupEditTarget[\s\S]*normalizePendingResultGroupEditTarget[\s\S]*jobIds: compactStringArray\(value\.jobIds\)/,
  "result-page group edit handoff should store compact scoped group context"
);

assert.match(
  resultPageSource,
  /handleOpenFolder[\s\S]*fetch\("\/api\/generated-images\/open-folder"[\s\S]*onOpenFolder=\{handleOpenFolder\}/,
  "result page image wall should expose local folder access through the detail/action path"
);

assert.match(
  imageGroupSource,
  /previewUrl=\{getImagePreviewUrl\(img\)\}[\s\S]*metadata\.thumbnailUrl[\s\S]*imageStorage\?\.thumbnailUrl[\s\S]*resultStorage\?\.thumbnailUrl/,
  "result cards should use persisted thumbnails for grid previews before falling back to original images"
);

assert.match(
  imageGroupSource,
  /grid-cols-\[repeat\(auto-fill,minmax\(220px,1fr\)\)\]/,
  "result groups should use responsive real-ratio image-wall columns instead of a fixed two-column card grid"
);
assert.match(
  imageGroupSource,
  /onSetGroupReviewStatus[\s\S]*保留这组[\s\S]*标待重做[\s\S]*调整这组[\s\S]*淘汰这组/,
  "result groups should expose lightweight group-level picking actions"
);

assert.match(
  imageCardSource,
  /const imagePreviewUrl = previewUrl \|\| url[\s\S]*src=\{imagePreviewUrl\}[\s\S]*loading="lazy"[\s\S]*sizes="\(min-width: 1024px\) 320px, 50vw"/,
  "result image cards should lazy-load the preview URL with bounded responsive sizes"
);

assert.match(
  imageCardSource,
  /border border-transparent bg-transparent[\s\S]*overflow-hidden rounded-md bg-warm-soft[\s\S]*object-contain p-1/,
  "result image cards should keep chrome light so large result sets read as an image wall"
);

console.log("generation output save metadata smoke passed");
