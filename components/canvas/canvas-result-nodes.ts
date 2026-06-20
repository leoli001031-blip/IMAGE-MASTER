import type { GenerationFrameOutput } from "@/lib/canvas/generation-frame";
import { normalizeGenerationFrameState } from "@/lib/canvas/generation-frame";
import type { CanvasWorkbenchEdge, CanvasWorkbenchNode } from "@/lib/canvas/workbench-data";

export interface PersistedGeneratedArtifact {
  id: string;
  workflowId?: string;
  nodeId?: string;
  jobId?: string;
  assetId?: string;
  type: string;
  title: string;
  status: string;
  url: string;
  prompt: string;
  provider: string;
  model: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type ArtifactReviewStatus = "approved" | "pending" | "needs_redo" | "rejected" | "failed";
export type ArtifactVisualQaStatus = "pass" | "warn" | "fail" | "pending";
export type ArtifactVisualQaDimension =
  | "product_drift"
  | "model_consistency"
  | "lighting"
  | "copy_safe_area";

export interface ArtifactVisualQaIssue {
  dimension: ArtifactVisualQaDimension;
  status: ArtifactVisualQaStatus;
  label: string;
  summary: string;
}

export interface ArtifactVisualQaSummary {
  status: ArtifactVisualQaStatus;
  label: string;
  issues: ArtifactVisualQaIssue[];
}

interface ArtifactResultLayout {
  index: number;
  group: string;
  groupCount: number;
  groupIndex: number;
  ratios: string[];
  artifactIds: string[];
  artifactTitles: string[];
  providerRoles: string[];
  promptOnlyRoles: string[];
  copyModes: string[];
  reviewSummary: string[];
  visualQaSummary: string[];
  row: number;
  column: number;
  isGroupStart: boolean;
  width: number;
  height: number;
  position: { x: number; y: number };
}

interface ArtifactResultGroupLayout {
  group: string;
  groupCount: number;
  groupIndex: number;
  ratios: string[];
  artifactIds: string[];
  artifactTitles: string[];
  providerRoles: string[];
  promptOnlyRoles: string[];
  copyModes: string[];
  reviewSummary: string[];
  visualQaSummary: string[];
  position: { x: number; y: number };
}

const ARTIFACT_RESULT_LAYOUT_VERSION = 7;
const ARTIFACT_RESULT_BASE_POSITION = { x: 40, y: 40 };
const ARTIFACT_RESULT_ROW_WIDTH = 2040;
const ARTIFACT_RESULT_GAP_X = 44;
const ARTIFACT_RESULT_GAP_Y = 64;
const ARTIFACT_RESULT_GROUP_GAP_Y = 110;
const ARTIFACT_RESULT_GROUP_HEADER_HEIGHT = 30;
const ARTIFACT_RESULT_CAPTION_HEIGHT = 54;
const ARTIFACT_RESULT_CATEGORY_ORDER = [
  "主图",
  "海报",
  "详情图",
  "细节图",
  "模特图",
  "场景图",
  "卖点图",
  "文案图",
  "成片",
];

export function getCanvasVisibleArtifacts(
  artifacts: PersistedGeneratedArtifact[],
  nodes: CanvasWorkbenchNode[]
): PersistedGeneratedArtifact[] {
  if (artifacts.length === 0) return artifacts;

  const frameBatchByNodeId = new Map(
    nodes
      .filter(isGenerationFrameNode)
      .map((node) => [node.id, getStringValue(node.data.generationFrameActiveBatchId)])
  );
  const latestBatchByFrameNodeId = new Map<string, string>();
  for (const artifact of artifacts) {
    const frameNodeId = getArtifactFrameNodeId(artifact);
    const batchId = getArtifactBatchId(artifact);
    if (frameNodeId && batchId && !latestBatchByFrameNodeId.has(frameNodeId)) {
      latestBatchByFrameNodeId.set(frameNodeId, batchId);
    }
  }

  return artifacts.filter((artifact) => {
    if (!artifact.url && !isArtifactFailed(artifact)) return false;
    const frameNodeId = getArtifactFrameNodeId(artifact);
    if (!frameNodeId) return true;

    const activeBatchId =
      frameBatchByNodeId.get(frameNodeId) ||
      latestBatchByFrameNodeId.get(frameNodeId);
    if (!activeBatchId) return !getArtifactBatchId(artifact);

    return getArtifactBatchId(artifact) === activeBatchId;
  });
}

export function getArtifactReconcileSignature(
  nodes: CanvasWorkbenchNode[],
  edges: CanvasWorkbenchEdge[],
  artifacts: PersistedGeneratedArtifact[],
  hiddenArtifactNodeIds: string[]
): string {
  return [
    artifacts.map(getStageArtifactSignature).join("|"),
    hiddenArtifactNodeIds.slice().sort().join(","),
    nodes.map(getArtifactReconcileNodeSignature).join("|"),
    edges.map((edge) => `${edge.id}~${edge.source}~${edge.target}`).join("|"),
  ].join("::");
}

export function reconcileArtifactResultNodes(
  nodes: CanvasWorkbenchNode[],
  edges: CanvasWorkbenchEdge[],
  artifacts: PersistedGeneratedArtifact[],
  hiddenArtifactNodeIds: string[] = [],
  enrichSourceNode?: (
    node: CanvasWorkbenchNode,
    artifact: PersistedGeneratedArtifact
  ) => CanvasWorkbenchNode
): { nodes: CanvasWorkbenchNode[]; edges: CanvasWorkbenchEdge[] } {
  let nextNodes = nodes;
  let nextEdges = edges;
  const hiddenIds = new Set(hiddenArtifactNodeIds);
  const visibleArtifactIds = new Set(artifacts.map((artifact) => artifact.id));
  const visibleArtifacts = artifacts.filter(
    (artifact) => (artifact.url || isArtifactFailed(artifact)) && !hiddenIds.has(artifact.id)
  );
  const artifactLayouts = getArtifactResultLayouts(visibleArtifacts);
  const groupLayouts = getArtifactResultGroupLayouts(visibleArtifacts, artifactLayouts);
  const visibleGroupNodeIds = new Set(groupLayouts.map((layout) => getArtifactResultGroupNodeId(layout.group)));
  const staleResultNodeIds = new Set(
    nextNodes
      .filter(isArtifactResultCanvasNode)
      .filter((node) => {
        const artifactId = getArtifactResultNodeArtifactId(node);
        return !artifactId || hiddenIds.has(artifactId) || !visibleArtifactIds.has(artifactId);
      })
      .map((node) => node.id)
  );
  const staleGroupNodeIds = new Set(
    nextNodes
      .filter(isArtifactResultGroupCanvasNode)
      .filter((node) => !visibleGroupNodeIds.has(node.id))
      .map((node) => node.id)
  );

  if (staleResultNodeIds.size > 0 || staleGroupNodeIds.size > 0) {
    const staleNodeIds = new Set([...staleResultNodeIds, ...staleGroupNodeIds]);
    nextNodes = nextNodes.filter((node) => !staleNodeIds.has(node.id));
    nextEdges = nextEdges.filter(
      (edge) => !staleNodeIds.has(edge.source) && !staleNodeIds.has(edge.target)
    );
  }

  const nodeById = new Map(nextNodes.map((node) => [node.id, node]));
  nextEdges = nextEdges.filter((edge) => {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    return (
      (!sourceNode || (!isArtifactResultCanvasNode(sourceNode) && !isArtifactResultGroupCanvasNode(sourceNode))) &&
      (!targetNode || (!isArtifactResultCanvasNode(targetNode) && !isArtifactResultGroupCanvasNode(targetNode)))
    );
  });
  const appendedNodes: CanvasWorkbenchNode[] = [];
  const resultNodeByArtifactId = new Map<string, CanvasWorkbenchNode>();
  let nodesChanged = nextNodes !== nodes;
  let resultNodeCount = 0;
  for (const node of nextNodes) {
    if (isArtifactResultCanvasNode(node)) {
      resultNodeCount += 1;
      const artifactId = getArtifactResultNodeArtifactId(node);
      if (artifactId) resultNodeByArtifactId.set(artifactId, node);
    }
  }

  const upsertNode = (node: CanvasWorkbenchNode) => {
    if (nodeById.has(node.id)) {
      nodeById.set(node.id, node);
    } else {
      appendedNodes.push(node);
      nodeById.set(node.id, node);
    }
    nodesChanged = true;
  };

  for (const layout of groupLayouts) {
    const groupNodeId = getArtifactResultGroupNodeId(layout.group);
    const existingGroupNode = nodeById.get(groupNodeId);
    const nextGroupNode = createArtifactResultGroupNode(layout);
    if (!existingGroupNode) {
      upsertNode(nextGroupNode);
    } else if (
      existingGroupNode.position.x !== nextGroupNode.position.x ||
      existingGroupNode.position.y !== nextGroupNode.position.y ||
      JSON.stringify(existingGroupNode.data) !== JSON.stringify(nextGroupNode.data)
    ) {
      upsertNode(nextGroupNode);
    }
  }

  for (const artifact of artifacts) {
    if (!artifact.url && !isArtifactFailed(artifact)) continue;

    const sourceNode = artifact.nodeId
      ? nodeById.get(artifact.nodeId)
      : undefined;

    if (sourceNode && enrichSourceNode) {
      const enrichedSourceNode = enrichSourceNode(sourceNode, artifact);
      if (enrichedSourceNode !== sourceNode) {
        upsertNode(enrichedSourceNode);
      }
    }

    if (hiddenIds.has(artifact.id)) continue;

    const resultNodeId = getArtifactResultNodeId(artifact);
    const existingResultNode = nodeById.get(resultNodeId) ?? resultNodeByArtifactId.get(artifact.id);

    if (!existingResultNode) {
      const nextResultNode = createArtifactResultNode(
        artifact,
        sourceNode,
        resultNodeCount,
        artifactLayouts.get(artifact.id)
      );
      resultNodeCount += 1;
      resultNodeByArtifactId.set(artifact.id, nextResultNode);
      upsertNode(nextResultNode);
    } else {
      const updatedResultNode = withArtifactResultNode(
        existingResultNode,
        artifact,
        artifactLayouts.get(artifact.id)
      );
      if (updatedResultNode !== existingResultNode) {
        resultNodeByArtifactId.set(artifact.id, updatedResultNode);
        upsertNode(updatedResultNode);
      }
    }
  }

  if (nodesChanged) {
    nextNodes = [
      ...nextNodes.map((node) => nodeById.get(node.id) ?? node),
      ...appendedNodes,
    ];
  }
  return { nodes: nextNodes, edges: nextEdges };
}

export function createArtifactResultNode(
  artifact: PersistedGeneratedArtifact,
  sourceNode: CanvasWorkbenchNode | undefined,
  index: number,
  layout?: ArtifactResultLayout
): CanvasWorkbenchNode {
  const shouldAnchorToSource = Boolean(sourceNode && !isGenerationFrameNode(sourceNode));
  const peerIndex = Math.max(0, index);
  const basePosition = shouldAnchorToSource && sourceNode
    ? sourceNode.position
    : { x: 40, y: 40 };
  const layoutPosition = layout?.position;

  return {
    id: getArtifactResultNodeId(artifact),
    position: layoutPosition && !shouldAnchorToSource
      ? layoutPosition
      : shouldAnchorToSource
      ? {
          x: basePosition.x + 390 + (peerIndex % 3) * 340,
          y: basePosition.y + Math.floor(peerIndex / 3) * 300,
        }
      : {
          x: basePosition.x + (peerIndex % 4) * 340,
          y: basePosition.y + Math.floor(peerIndex / 4) * 300,
        },
    data: createArtifactResultNodeData(artifact, sourceNode, layout),
  };
}

export function withArtifactResultNode(
  node: CanvasWorkbenchNode,
  artifact: PersistedGeneratedArtifact,
  layout?: ArtifactResultLayout
): CanvasWorkbenchNode {
  const previewUrl = getArtifactPreviewUrl(artifact);
  const displayTitle = getArtifactResultDisplayTitle(artifact);
  const nextData = createArtifactResultNodeData(artifact, undefined, layout);
  const shouldApplyLayout =
    layout &&
    node.data.source === "artifact-history" &&
    (
      getNumberValue((node.data.parameters as Record<string, unknown> | undefined)?.layoutVersion) !==
        ARTIFACT_RESULT_LAYOUT_VERSION ||
      getStringValue((node.data.parameters as Record<string, unknown> | undefined)?.layoutPositionKey) !==
        getStringValue((nextData.parameters as Record<string, unknown> | undefined)?.layoutPositionKey)
    );
  if (
    node.data.artifactId === artifact.id &&
    node.data.previewUrl === previewUrl &&
    node.data.label === displayTitle &&
    node.data.category === nextData.category &&
    JSON.stringify(node.data.parameters ?? null) === JSON.stringify(nextData.parameters ?? null) &&
    node.data.source === "artifact-history" &&
    !shouldApplyLayout
  ) {
    return node;
  }

  return {
    ...node,
    position: shouldApplyLayout ? layout.position : node.position,
    data: {
      ...node.data,
      ...nextData,
      caption: node.data.caption,
    },
  };
}

export function getArtifactPreviewUrl(artifact: PersistedGeneratedArtifact): string {
  return getStoredImagePreviewUrl(artifact.metadata) || artifact.url;
}

export function getArtifactThumbnailUrl(artifact: PersistedGeneratedArtifact): string | undefined {
  return getStoredImagePreviewUrl(artifact.metadata);
}

export function getArtifactStatusLabel(status: string): string {
  if (status === "ready" || status === "done" || status === "completed") return "完成";
  if (status === "running") return "生成中";
  if (status === "failed") return "失败";
  if (status === "draft") return "草稿";
  return status || "产物";
}

export function getArtifactReviewStatus(artifact: PersistedGeneratedArtifact): ArtifactReviewStatus {
  if (isArtifactFailed(artifact)) return "failed";
  const reviewState = getRecordValue(artifact.metadata?.reviewState);
  const status = getStringValue(reviewState?.status);
  if (status === "approved" || status === "pending" || status === "needs_redo" || status === "rejected") {
    return status;
  }
  return "pending";
}

export function getArtifactReviewStatusLabel(status: ArtifactReviewStatus): string {
  if (status === "approved") return "可用";
  if (status === "pending") return "待检查";
  if (status === "needs_redo") return "建议重做";
  if (status === "rejected") return "已淘汰";
  if (status === "failed") return "生成失败";
  return "待检查";
}

export function getArtifactReviewStatusTone(status: ArtifactReviewStatus): string {
  if (status === "approved") return "success";
  if (status === "needs_redo") return "warn";
  if (status === "rejected") return "muted";
  if (status === "failed") return "danger";
  return "pending";
}

export function getArtifactVisualQaSummary(artifact: PersistedGeneratedArtifact): ArtifactVisualQaSummary {
  const stored = normalizeStoredVisualQaSummary(artifact.metadata?.visualQa);
  if (stored) return stored;
  if (isArtifactFailed(artifact)) {
    return {
      status: "fail",
      label: "QA 失败",
      issues: [
        {
          dimension: "product_drift",
          status: "fail",
          label: "生成失败",
          summary: "图片未成功生成，无法进入视觉审核。",
        },
      ],
    };
  }

  const issues = [
    inferProductDriftIssue(artifact),
    inferModelConsistencyIssue(artifact),
    inferLightingIssue(artifact),
    inferCopySafeAreaIssue(artifact),
  ].filter((issue): issue is ArtifactVisualQaIssue => Boolean(issue));
  const status = summarizeVisualQaStatus(issues);
  return {
    status,
    label: getArtifactVisualQaStatusLabel(status),
    issues,
  };
}

export function getArtifactVisualQaStatusLabel(status: ArtifactVisualQaStatus): string {
  if (status === "pass") return "QA 通过";
  if (status === "warn") return "QA 风险";
  if (status === "fail") return "QA 失败";
  return "QA 待查";
}

export function getArtifactVisualQaStatusTone(status: ArtifactVisualQaStatus): string {
  if (status === "pass") return "success";
  if (status === "warn") return "warn";
  if (status === "fail") return "danger";
  return "pending";
}

export function getStageArtifactSignature(artifact: PersistedGeneratedArtifact): string {
  return [
    artifact.id,
    artifact.status,
    artifact.url,
    getArtifactPreviewUrl(artifact),
    artifact.nodeId,
    artifact.jobId,
    artifact.assetId,
    artifact.title,
    artifact.updatedAt,
    getStringValue(artifact.metadata.planItemTitle),
    getStringValue(artifact.metadata.batchJobTitle),
    getStringValue(artifact.metadata.exportSpecId),
    getStringValue(artifact.metadata.naming),
    JSON.stringify(artifact.metadata.reviewState ?? null),
    JSON.stringify(artifact.metadata.visualQa ?? null),
  ].join("~");
}

export function getArtifactResultNodeId(artifact: PersistedGeneratedArtifact): string {
  return `artifact-node-${artifact.id}`;
}

export function getArtifactResultGroupNodeId(group: string): string {
  return `artifact-group-${slugifyArtifactGroup(group)}`;
}

export function mapArtifactToGenerationFrameOutput(
  artifact: PersistedGeneratedArtifact
): GenerationFrameOutput {
  return {
    id: artifact.id,
    artifactId: artifact.id,
    jobId: artifact.jobId,
    nodeId: artifact.nodeId,
    title: artifact.title,
    url: artifact.url,
    previewUrl: getArtifactPreviewUrl(artifact),
    status: artifact.status,
    createdAt: artifact.createdAt,
    metadata: artifact.metadata,
  };
}

export function getArtifactResultNodeArtifactId(node: CanvasWorkbenchNode): string | null {
  if (node.data.source !== "artifact-history") return null;
  return typeof node.data.artifactId === "string" ? node.data.artifactId : null;
}

export function isArtifactResultCanvasNode(node: CanvasWorkbenchNode): boolean {
  return node.data.source === "artifact-history" || node.id.startsWith("artifact-node-");
}

export function isArtifactResultGroupCanvasNode(node: CanvasWorkbenchNode): boolean {
  return node.data.source === "artifact-group-header" || node.id.startsWith("artifact-group-");
}

export function isHiddenArtifactResultNode(
  node: CanvasWorkbenchNode,
  hiddenArtifactNodeIds: string[]
): boolean {
  const artifactId = getArtifactResultNodeArtifactId(node);
  return !!artifactId && hiddenArtifactNodeIds.includes(artifactId);
}

export function isArtifactLinkedToNode(
  artifact: PersistedGeneratedArtifact,
  node: CanvasWorkbenchNode
): boolean {
  const resultNodeId = getArtifactResultNodeId(artifact);
  const artifactId = typeof node.data.artifactId === "string" ? node.data.artifactId : "";
  const linkedNodeId = typeof node.data.linkedNodeId === "string" ? node.data.linkedNodeId : "";
  const jobId = typeof node.data.jobId === "string" ? node.data.jobId : "";
  const assetId = typeof node.data.assetId === "string" ? node.data.assetId : "";

  return (
    artifact.nodeId === node.id ||
    resultNodeId === node.id ||
    artifactId === artifact.id ||
    linkedNodeId === artifact.nodeId ||
    linkedNodeId === resultNodeId ||
    (!!artifact.jobId && jobId === artifact.jobId) ||
    (!!artifact.assetId && assetId === artifact.assetId)
  );
}

export function getArtifactResultWallFocusNodeIds(
  nodes: CanvasWorkbenchNode[],
  limit = 8
): string[] {
  const groupHeaders = nodes
    .filter(isArtifactResultGroupCanvasNode)
    .map((node) => ({
      node,
      groupIndex: getLayoutNumber(node, "layoutGroupIndex") ?? Number.MAX_SAFE_INTEGER,
      x: node.position.x,
      y: node.position.y,
    }))
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y))
    .sort((a, b) => {
      const groupDelta = a.groupIndex - b.groupIndex;
      if (Number.isFinite(groupDelta) && groupDelta !== 0) return groupDelta;
      return a.y - b.y || a.x - b.x;
    });
  const resultNodes = nodes
    .filter(isArtifactResultCanvasNode)
    .map((node) => ({
      node,
      groupIndex: getLayoutNumber(node, "layoutGroupIndex") ?? Number.MAX_SAFE_INTEGER,
      row: getLayoutNumber(node, "layoutRow") ?? Number.MAX_SAFE_INTEGER,
      column: getLayoutNumber(node, "layoutColumn") ?? Number.MAX_SAFE_INTEGER,
      x: node.position.x,
      y: node.position.y,
    }))
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y));
  if (resultNodes.length === 0) return [];

  const previewResults = resultNodes
    .sort((a, b) => {
      const groupDelta = a.groupIndex - b.groupIndex;
      if (Number.isFinite(groupDelta) && groupDelta !== 0) return groupDelta;
      const rowDelta = a.row - b.row;
      if (Number.isFinite(rowDelta) && rowDelta !== 0) return rowDelta;
      const columnDelta = a.column - b.column;
      if (Number.isFinite(columnDelta) && columnDelta !== 0) return columnDelta;
      return a.x - b.x;
    });

  const focusIds: string[] = [];
  const addFocusId = (id: string) => {
    if (!focusIds.includes(id)) focusIds.push(id);
  };

  for (const item of groupHeaders) addFocusId(item.node.id);
  for (const item of previewResults.slice(0, Math.max(1, limit))) addFocusId(item.node.id);

  return focusIds.slice(0, Math.max(1, limit + groupHeaders.length));
}

function createArtifactResultNodeData(
  artifact: PersistedGeneratedArtifact,
  sourceNode: CanvasWorkbenchNode | undefined,
  layout?: ArtifactResultLayout
): CanvasWorkbenchNode["data"] {
  const providerLabel = artifact.provider || "产物历史";
  const fullTitle = getArtifactResultFullTitle(artifact);
  const displayTitle = getArtifactResultDisplayTitle(artifact);
  const ratioLabel = getArtifactResultRatioLabel(artifact);
  const aspectRatio = getArtifactResultAspectRatio(artifact);
  const categoryLabel = getArtifactResultCategoryLabel(artifact);
  const reviewStatus = getArtifactReviewStatus(artifact);
  const reviewLabel = getArtifactReviewStatusLabel(reviewStatus);
  const visualQa = getArtifactVisualQaSummary(artifact);
  const nodeLabel = sourceNode && !isGenerationFrameNode(sourceNode)
    ? cleanArtifactDisplayText(sourceNode.data.label)
    : "";

  return {
    label: displayTitle,
    caption: nodeLabel ? `由 ${nodeLabel} 生成的输出产物` : "生成结果，可点击查看参考图和 prompt",
    kind: "output",
    status: mapArtifactToNodeStatus(artifact.status),
    metrics: [
      categoryLabel,
      ratioLabel,
      reviewLabel,
      visualQa.label || providerLabel,
    ].filter(Boolean).slice(0, 4),
    iconName: "output",
    previewUrl: getArtifactPreviewUrl(artifact),
    referenceUrl: artifact.url,
    previewAlt: fullTitle,
    artifactId: artifact.id,
    artifactStatus: artifact.status,
    artifactCreatedAt: artifact.createdAt,
    jobId: artifact.jobId,
    assetId: artifact.assetId,
    linkedNodeId: artifact.nodeId,
    source: "artifact-history",
    category: categoryLabel,
    parameters: {
      fullTitle,
      compactTitle: displayTitle,
      ratio: ratioLabel,
      aspectRatio,
      layoutVersion: ARTIFACT_RESULT_LAYOUT_VERSION,
      layoutGroup: categoryLabel,
      layoutGroupCount: layout?.groupCount,
      layoutGroupStart: layout?.isGroupStart === true,
      layoutHeaderAvailable: Boolean(layout),
      layoutGroupIndex: layout?.groupIndex,
      layoutRatios: layout?.ratios,
      layoutArtifactIds: layout?.artifactIds,
      layoutArtifactTitles: layout?.artifactTitles,
      layoutProviderRoles: layout?.providerRoles,
      layoutPromptOnlyRoles: layout?.promptOnlyRoles,
      layoutCopyModes: layout?.copyModes,
      layoutReviewSummary: layout?.reviewSummary,
      layoutColumn: layout?.column,
      layoutRow: layout?.row,
      layoutWidth: layout?.width,
      layoutHeight: layout?.height,
      layoutPositionKey: layout
        ? `${layout.groupIndex}:${layout.row}:${layout.column}:${layout.width}x${layout.height}`
        : undefined,
      imageType: artifact.type,
      previewUrl: getArtifactPreviewUrl(artifact),
      originalUrl: artifact.url,
      thumbnailUrl: getArtifactThumbnailUrl(artifact),
      planItemType: getStringValue(artifact.metadata.planItemType),
      exportSpecId: getStringValue(artifact.metadata.exportSpecId),
      reviewStatus,
      reviewLabel,
      reviewTone: getArtifactReviewStatusTone(reviewStatus),
      visualQaStatus: visualQa.status,
      visualQaLabel: visualQa.label,
      visualQaTone: getArtifactVisualQaStatusTone(visualQa.status),
      visualQaIssues: visualQa.issues.map((issue) => ({
        dimension: issue.dimension,
        status: issue.status,
        label: issue.label,
        summary: issue.summary,
      })),
      visualQaSummary: visualQa.issues.map((issue) => `${issue.label}：${issue.summary}`).slice(0, 4),
    },
  };
}

function createArtifactResultGroupNode(layout: ArtifactResultGroupLayout): CanvasWorkbenchNode {
  return {
    id: getArtifactResultGroupNodeId(layout.group),
    position: layout.position,
    data: {
      label: layout.group,
      caption: `${layout.groupCount} 张结果`,
      kind: "output",
      status: "ready",
      metrics: [
        `${layout.groupCount} 张`,
        layout.ratios.slice(0, 3).join(" / "),
        layout.reviewSummary.slice(0, 2).join(" / "),
        layout.visualQaSummary.slice(0, 1).join(" / "),
      ].filter(Boolean),
      iconName: "output",
      source: "artifact-group-header",
      category: layout.group,
      parameters: {
        layoutVersion: ARTIFACT_RESULT_LAYOUT_VERSION,
        layoutGroup: layout.group,
        layoutGroupCount: layout.groupCount,
        layoutGroupIndex: layout.groupIndex,
        layoutRatios: layout.ratios,
        layoutArtifactIds: layout.artifactIds,
        layoutArtifactTitles: layout.artifactTitles,
        layoutProviderRoles: layout.providerRoles,
        layoutPromptOnlyRoles: layout.promptOnlyRoles,
        layoutCopyModes: layout.copyModes,
        layoutReviewSummary: layout.reviewSummary,
        layoutVisualQaSummary: layout.visualQaSummary,
        layoutHeader: true,
        layoutWidth: ARTIFACT_RESULT_ROW_WIDTH,
        layoutHeight: ARTIFACT_RESULT_GROUP_HEADER_HEIGHT,
        layoutPositionKey: `${layout.groupIndex}:header:${layout.position.x}:${layout.position.y}`,
      },
    },
  };
}

function getArtifactReconcileNodeSignature(node: CanvasWorkbenchNode): string {
  return [
    node.id,
    node.data.source,
    node.data.label,
    node.data.caption,
    node.data.artifactId,
    node.data.previewUrl,
    node.data.artifactStatus,
    getStringValue((node.data.parameters as Record<string, unknown> | undefined)?.reviewStatus),
    getStringValue((node.data.parameters as Record<string, unknown> | undefined)?.reviewLabel),
    node.data.jobId,
    node.data.category,
    JSON.stringify(node.data.parameters ?? null),
    getGenerationFrameOutputSignature(
      normalizeGenerationFrameState(node.data.generationFrame).outputs
    ),
  ].join("~");
}

function getArtifactGroupProviderRoles(artifacts: PersistedGeneratedArtifact[]): string[] {
  const roles: string[] = [];
  for (const artifact of artifacts) {
    const metadata = artifact.metadata ?? {};
    roles.push(...getStringArray(getRecordValue(metadata.assetInvocationPlan)?.providerReferenceRoles));
    roles.push(...getReferenceImageRoles(metadata.referenceImages, "provider"));
    for (const decision of getAssetInvocationDecisions(metadata)) {
      if (decision.providerInput) roles.push(decision.role);
    }
  }
  return uniqueStrings(roles);
}

function getArtifactGroupPromptOnlyRoles(artifacts: PersistedGeneratedArtifact[]): string[] {
  const roles: string[] = [];
  for (const artifact of artifacts) {
    const metadata = artifact.metadata ?? {};
    roles.push(...getStringArray(getRecordValue(metadata.assetInvocationPlan)?.promptOnlyRoles));
    roles.push(...getReferenceImageRoles(metadata.promptOnlyReferenceImages, "prompt"));
    roles.push(...getReferenceImageRoles(metadata.referenceImages, "prompt"));
    for (const decision of getAssetInvocationDecisions(metadata)) {
      if (!decision.providerInput) roles.push(decision.role);
    }
  }
  return uniqueStrings(roles);
}

function getArtifactGroupCopyModes(artifacts: PersistedGeneratedArtifact[]): string[] {
  return uniqueStrings(artifacts.flatMap((artifact) => {
    const mode = getStringValue(getRecordValue(artifact.metadata?.copyRenderPolicy)?.mode);
    return mode ? [mode] : [];
  }));
}

function getArtifactGroupReviewSummary(artifacts: PersistedGeneratedArtifact[]): string[] {
  const counts = new Map<ArtifactReviewStatus, number>();
  for (const artifact of artifacts) {
    const status = getArtifactReviewStatus(artifact);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return (["approved", "pending", "needs_redo", "rejected", "failed"] as const)
    .flatMap((status) => {
      const count = counts.get(status) ?? 0;
      return count > 0 ? [`${getArtifactReviewStatusLabel(status)} ${count}`] : [];
    });
}

function getArtifactGroupVisualQaSummary(artifacts: PersistedGeneratedArtifact[]): string[] {
  const counts = new Map<ArtifactVisualQaStatus, number>();
  for (const artifact of artifacts) {
    const status = getArtifactVisualQaSummary(artifact).status;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return (["fail", "warn", "pending", "pass"] as const)
    .flatMap((status) => {
      const count = counts.get(status) ?? 0;
      return count > 0 ? [`${getArtifactVisualQaStatusLabel(status)} ${count}`] : [];
    });
}

function normalizeStoredVisualQaSummary(value: unknown): ArtifactVisualQaSummary | null {
  const record = getRecordValue(value);
  if (!record) return null;
  const status = normalizeVisualQaStatus(record.status);
  if (!status) return null;
  const issues = Array.isArray(record.issues)
    ? record.issues.flatMap((item): ArtifactVisualQaIssue[] => {
        const issue = getRecordValue(item);
        if (!issue) return [];
        const dimension = normalizeVisualQaDimension(issue.dimension);
        const issueStatus = normalizeVisualQaStatus(issue.status);
        const label = getStringValue(issue.label);
        const summary = getStringValue(issue.summary);
        if (!dimension || !issueStatus || !label || !summary) return [];
        return [{ dimension, status: issueStatus, label, summary }];
      })
    : [];
  return {
    status,
    label: getStringValue(record.label) || getArtifactVisualQaStatusLabel(status),
    issues,
  };
}

function inferProductDriftIssue(artifact: PersistedGeneratedArtifact): ArtifactVisualQaIssue | null {
  const text = getArtifactQaSearchText(artifact);
  const expectsProduct = /商品|产品|主图|详情|细节|海报|卖点|包|服装|手机|耳机|product|hero|detail|poster/i.test(text) ||
    getStringArray(artifact.metadata.itemReferenceRoles).includes("product");
  if (!expectsProduct) return null;
  const providerRoles = getArtifactProviderReferenceRoles(artifact);
  const hasProductProviderReference =
    providerRoles.includes("product") ||
    getStringArray(artifact.metadata.providerReferenceImageUrls).length > 0 ||
    getStringValue(artifact.metadata.referenceImageUrl) ||
    getStringArray(artifact.metadata.referenceImageUrls).length > 0 ||
    artifact.metadata.usesProductReference === true;
  if (!hasProductProviderReference) {
    return {
      dimension: "product_drift",
      status: "fail",
      label: "商品漂移",
      summary: "没有检测到真实商品强参考，商品身份可能被模型重画。",
    };
  }
  const focus = getStringValue(artifact.metadata.productReferenceFocus);
  if (!focus && /主图|详情|细节|product|detail|hero/i.test(text)) {
    return {
      dimension: "product_drift",
      status: "warn",
      label: "商品一致性",
      summary: "有商品参考，但未记录锁定焦点，需检查结构和材质是否漂移。",
    };
  }
  return {
    dimension: "product_drift",
    status: "pass",
    label: "商品一致性",
    summary: "商品参考已作为强约束进入生成链路。",
  };
}

function inferModelConsistencyIssue(artifact: PersistedGeneratedArtifact): ArtifactVisualQaIssue | null {
  const text = getArtifactQaSearchText(artifact);
  const expectsModel = /模特|真人|人像|穿着|佩戴|上身|model|person|wear/i.test(text) ||
    getStringArray(artifact.metadata.itemReferenceRoles).includes("model");
  if (!expectsModel) return null;
  const providerRoles = getArtifactProviderReferenceRoles(artifact);
  const promptOnlyRoles = getArtifactPromptOnlyReferenceRoles(artifact);
  if (providerRoles.includes("model")) {
    return {
      dimension: "model_consistency",
      status: "pass",
      label: "模特一致性",
      summary: "模特参考进入 provider 输入，可作为身份一致性依据。",
    };
  }
  if (promptOnlyRoles.includes("model")) {
    return {
      dimension: "model_consistency",
      status: "warn",
      label: "模特一致性",
      summary: "模特只作为文字/弱参考，需人工检查脸、发型和身形。",
    };
  }
  return {
    dimension: "model_consistency",
    status: "warn",
    label: "模特一致性",
    summary: "图组需要模特，但没有检测到模特参考输入。",
  };
}

function inferLightingIssue(artifact: PersistedGeneratedArtifact): ArtifactVisualQaIssue | null {
  const text = getArtifactQaSearchText(artifact);
  const providerRoles = getArtifactProviderReferenceRoles(artifact);
  const promptOnlyRoles = getArtifactPromptOnlyReferenceRoles(artifact);
  const hasSceneIntent = /场景|室内|室外|街拍|商场|雪山|咖啡|家居|光影|自然光|scene|lifestyle|lighting/i.test(text) ||
    getStringArray(artifact.metadata.itemReferenceRoles).includes("scene");
  const hasModelIntent = /模特|真人|人像|穿着|佩戴|model|person|wear/i.test(text) ||
    getStringArray(artifact.metadata.itemReferenceRoles).includes("model");
  if (!hasSceneIntent && !hasModelIntent) return null;
  if (hasModelIntent && !providerRoles.includes("scene") && promptOnlyRoles.includes("scene")) {
    return {
      dimension: "lighting",
      status: "warn",
      label: "光影匹配",
      summary: "人物/商品有场景弱参考，需检查脸部、身体和地面阴影是否统一。",
    };
  }
  if (hasSceneIntent && !providerRoles.includes("scene") && !promptOnlyRoles.includes("scene")) {
    return {
      dimension: "lighting",
      status: "warn",
      label: "光影匹配",
      summary: "场景图未记录明确参考，需检查人物与空间比例和光源方向。",
    };
  }
  return {
    dimension: "lighting",
    status: "pass",
    label: "光影匹配",
    summary: "场景/光影信息已进入生成上下文。",
  };
}

function inferCopySafeAreaIssue(artifact: PersistedGeneratedArtifact): ArtifactVisualQaIssue | null {
  const policy = getRecordValue(artifact.metadata.copyRenderPolicy);
  const mode = getStringValue(policy?.mode) || getStringValue(artifact.metadata.copyRenderMode);
  const inImageText = [
    ...getStringArray(policy?.inImageText),
    getStringValue(artifact.metadata.copyText) || "",
  ].filter(Boolean);
  if (mode !== "burn_in" && inImageText.length === 0) return null;
  const joinedText = inImageText.join(" / ");
  if (/瓶身标签|包装标签|商品标签|改包装|改logo|logo区|贴到包装|label|packaging/i.test(joinedText)) {
    return {
      dimension: "copy_safe_area",
      status: "fail",
      label: "文案安全区",
      summary: "文案疑似被要求写到商品包装/标签上，可能破坏商品身份。",
    };
  }
  if (joinedText.length > 28 || inImageText.length > 2) {
    return {
      dimension: "copy_safe_area",
      status: "warn",
      label: "文案安全区",
      summary: "烧字内容偏多，需检查是否压住主体、脸、手和产品关键结构。",
    };
  }
  return {
    dimension: "copy_safe_area",
    status: "pass",
    label: "文案安全区",
    summary: "文案较短，适合放在画面安全区。",
  };
}

function summarizeVisualQaStatus(issues: ArtifactVisualQaIssue[]): ArtifactVisualQaStatus {
  if (issues.some((issue) => issue.status === "fail")) return "fail";
  if (issues.some((issue) => issue.status === "warn")) return "warn";
  if (issues.length === 0) return "pending";
  if (issues.every((issue) => issue.status === "pass")) return "pass";
  return "pending";
}

function normalizeVisualQaStatus(value: unknown): ArtifactVisualQaStatus | null {
  return value === "pass" || value === "warn" || value === "fail" || value === "pending"
    ? value
    : null;
}

function normalizeVisualQaDimension(value: unknown): ArtifactVisualQaDimension | null {
  return value === "product_drift" ||
    value === "model_consistency" ||
    value === "lighting" ||
    value === "copy_safe_area"
    ? value
    : null;
}

function getArtifactProviderReferenceRoles(artifact: PersistedGeneratedArtifact): string[] {
  const roles = [
    ...getStringArray(artifact.metadata.itemProviderReferenceRoles),
    ...getStringArray(artifact.metadata.providerReferenceRoles),
    ...getStringArray(getRecordValue(artifact.metadata.assetInvocationPlan)?.providerReferenceRoles),
    ...getReferenceImageRoles(artifact.metadata.referenceImages, "provider"),
  ];
  for (const decision of getAssetInvocationDecisions(artifact.metadata)) {
    if (decision.providerInput) roles.push(decision.role);
  }
  return uniqueStrings(roles);
}

function getArtifactPromptOnlyReferenceRoles(artifact: PersistedGeneratedArtifact): string[] {
  const roles = [
    ...getStringArray(getRecordValue(artifact.metadata.assetInvocationPlan)?.promptOnlyRoles),
    ...getReferenceImageRoles(artifact.metadata.promptOnlyReferenceImages, "prompt"),
    ...getReferenceImageRoles(artifact.metadata.referenceImages, "prompt"),
  ];
  for (const decision of getAssetInvocationDecisions(artifact.metadata)) {
    if (!decision.providerInput) roles.push(decision.role);
  }
  return uniqueStrings(roles);
}

function getArtifactQaSearchText(artifact: PersistedGeneratedArtifact): string {
  return [
    artifact.type,
    artifact.title,
    artifact.prompt,
    getStringValue(artifact.metadata.planItemTitle),
    getStringValue(artifact.metadata.batchJobTitle),
    getStringValue(artifact.metadata.exportSpecTitle),
    getStringValue(artifact.metadata.useCase),
    getStringValue(artifact.metadata.copyText),
    getStringValue(artifact.metadata.finalPrompt),
  ].filter(Boolean).join(" ");
}

function getReferenceImageRoles(value: unknown, mode: "provider" | "prompt"): string[] {
  const images = Array.isArray(value) ? value : [];
  return images.flatMap((entry) => {
    const record = getRecordValue(entry);
    const role = getStringValue(record?.role);
    if (!role) return [];
    const providerUsable = record?.providerUsable === true;
    const providerMode = getStringValue(record?.providerMode);
    if (mode === "provider") {
      return providerUsable || providerMode === "provider_input" ? [role] : [];
    }
    return providerUsable || providerMode === "provider_input" ? [] : [role];
  });
}

function getAssetInvocationDecisions(metadata: Record<string, unknown>): Array<{ role: string; providerInput: boolean }> {
  const plan = getRecordValue(metadata.assetInvocationPlan);
  const decisions = Array.isArray(plan?.decisions) ? plan.decisions : [];
  return decisions.flatMap((entry) => {
    const record = getRecordValue(entry);
    const role = getStringValue(record?.role);
    if (!role) return [];
    return [{ role, providerInput: record?.providerInput === true }];
  });
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function getGenerationFrameOutputSignature(outputs: GenerationFrameOutput[] = []): string {
  return outputs
    .map((output) =>
      [
        output.id,
        output.title,
        output.url,
        output.nodeId,
        output.jobId,
        output.artifactId,
        output.status,
        output.createdAt,
        getGenerationFrameOutputMetadataSignature(output.metadata),
      ].join("~")
    )
    .join(",");
}

function getGenerationFrameOutputMetadataSignature(metadata?: Record<string, unknown>): string {
  if (!metadata) return "";
  return [
    getStringValue(metadata.prompt),
    getStringValue(metadata.provider),
    getStringValue(metadata.model),
    getStringValue(metadata.ratio),
    getStringValue(metadata.size),
    JSON.stringify(metadata.referenceImages ?? null),
    JSON.stringify(metadata.referenceContext ?? null),
    JSON.stringify(metadata.providerReferenceAdapter ?? null),
    JSON.stringify(metadata.assetInvocationPlan ?? null),
    JSON.stringify(metadata.providerDiagnostics ?? null),
  ].join("~");
}

function getArtifactResultFullTitle(artifact: PersistedGeneratedArtifact): string {
  return cleanArtifactDisplayText(
    getStringValue(artifact.metadata.planItemTitle) ||
    getStringValue(artifact.metadata.batchJobTitle) ||
    getStringValue(artifact.metadata.exportItemTitle) ||
    artifact.title ||
    "生成图片"
  );
}

function getArtifactResultDisplayTitle(artifact: PersistedGeneratedArtifact): string {
  return compactArtifactResultTitle(
    getArtifactResultFullTitle(artifact),
    getArtifactResultCategoryLabel(artifact)
  );
}

function compactArtifactResultTitle(title: string, category: string): string {
  const parts = title
    .split(/\s*[·|｜]\s*/g)
    .map((part) => part.trim())
    .filter(Boolean);
  const usefulParts = parts.filter((part) => !/项目|图组|批次|生成计划|生成任务/.test(part));
  let compact = usefulParts.length > 0 ? usefulParts.slice(0, 2).join(" · ") : title;
  compact = compact
    .replace(/\b(?:1024|1536|2048)x(?:1024|1536|2048)\b/gi, "")
    .replace(/\b\d+\s*[:/]\s*\d+\b/g, "")
    .replace(/画面安全区烧字|烧字|文案图层|直接出字/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*[·:：-]\s*$/g, "")
    .trim();

  if (!compact) return category || "生成图片";
  if (compact.length <= 28) return compact;
  return `${compact.slice(0, 27).trim()}…`;
}

function cleanArtifactDisplayText(text: string | undefined): string {
  return (text || "")
    .replace(/图组生成框/g, "图组")
    .replace(/生成框/g, "图组")
    .replace(/\s+/g, " ")
    .trim();
}

function getArtifactResultCategoryLabel(artifact: PersistedGeneratedArtifact): string {
  const text = [
    artifact.type,
    getStringValue(artifact.metadata.planItemType),
    getStringValue(artifact.metadata.exportSpecId),
    getStringValue(artifact.metadata.useCase),
    getStringValue(artifact.metadata.imageType),
    getStringValue(artifact.metadata.planItemTitle),
    getStringValue(artifact.metadata.batchJobTitle),
    getStringValue(artifact.metadata.exportItemTitle),
    artifact.title,
  ].filter(Boolean).join(" ").toLowerCase();
  if (/main|hero|主图|主视觉/.test(text)) return "主图";
  if (/poster|campaign|海报|封面/.test(text)) return "海报";
  if (/material|macro|texture|材质|细节|微距|特写/.test(text)) return "细节图";
  if (/detail|详情页|详情图|长图/.test(text)) return "详情图";
  if (/model|wear|look|真人|模特|上身|佩戴/.test(text)) return "模特图";
  if (/scene|lifestyle|street|cafe|room|场景|街拍|生活/.test(text)) return "场景图";
  if (/feature|selling|proof|卖点|证据/.test(text)) return "卖点图";
  if (/copy|text|info|文案|信息/.test(text)) return "文案图";
  return "成片";
}

function getArtifactResultLayouts(
  artifacts: PersistedGeneratedArtifact[]
): Map<string, ArtifactResultLayout> {
  const indexedArtifacts = artifacts.map((artifact, index) => ({
    artifact,
    index,
    group: getArtifactResultCategoryLabel(artifact),
  }));
  const groups = new Map<string, typeof indexedArtifacts>();
  for (const item of indexedArtifacts) {
    groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  }

  const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
    const rankDelta = getArtifactResultCategoryRank(a[0]) - getArtifactResultCategoryRank(b[0]);
    if (rankDelta !== 0) return rankDelta;
    return (a[1][0]?.index ?? 0) - (b[1][0]?.index ?? 0);
  });

  const layouts = new Map<string, ArtifactResultLayout>();
  let y = ARTIFACT_RESULT_BASE_POSITION.y;

  sortedGroups.forEach(([group, groupItems], groupIndex) => {
    const groupArtifacts = groupItems.map((item) => item.artifact);
    const groupRatios = Array.from(
      new Set(groupArtifacts.map(getArtifactResultRatioLabel).filter((ratio): ratio is string => Boolean(ratio)))
    );
    const groupArtifactIds = groupArtifacts.map((artifact) => artifact.id);
    const groupArtifactTitles = groupArtifacts.map((artifact) => artifact.title).filter(Boolean);
    const groupProviderRoles = getArtifactGroupProviderRoles(groupArtifacts);
    const groupPromptOnlyRoles = getArtifactGroupPromptOnlyRoles(groupArtifacts);
    const groupCopyModes = getArtifactGroupCopyModes(groupArtifacts);
    const groupReviewSummary = getArtifactGroupReviewSummary(groupArtifacts);
    const groupVisualQaSummary = getArtifactGroupVisualQaSummary(groupArtifacts);
    let row = 0;
    let column = 0;
    let x = ARTIFACT_RESULT_BASE_POSITION.x;
    let rowHeight = 0;

    groupItems.forEach((item) => {
      const size = getArtifactResultDisplaySize(item.artifact);
      const shouldWrap =
        column > 0 &&
        x + size.width > ARTIFACT_RESULT_BASE_POSITION.x + ARTIFACT_RESULT_ROW_WIDTH;

      if (shouldWrap) {
        y += rowHeight + ARTIFACT_RESULT_GAP_Y;
        row += 1;
        column = 0;
        x = ARTIFACT_RESULT_BASE_POSITION.x;
        rowHeight = 0;
      }

      layouts.set(item.artifact.id, {
        index: item.index,
        group,
        groupCount: groupItems.length,
        groupIndex,
        ratios: groupRatios,
        artifactIds: groupArtifactIds,
        artifactTitles: groupArtifactTitles,
        providerRoles: groupProviderRoles,
        promptOnlyRoles: groupPromptOnlyRoles,
        copyModes: groupCopyModes,
        reviewSummary: groupReviewSummary,
        visualQaSummary: groupVisualQaSummary,
        row,
        column,
        width: size.width,
        height: size.height,
        isGroupStart: row === 0 && column === 0,
        position: { x, y },
      });

      x += size.width + ARTIFACT_RESULT_GAP_X;
      rowHeight = Math.max(rowHeight, size.height);
      column += 1;
    });

    y += rowHeight + ARTIFACT_RESULT_GAP_Y;

    y += ARTIFACT_RESULT_GROUP_GAP_Y;
  });

  return layouts;
}

function getArtifactResultGroupLayouts(
  artifacts: PersistedGeneratedArtifact[],
  artifactLayouts: Map<string, ArtifactResultLayout>
): ArtifactResultGroupLayout[] {
  const byGroup = new Map<string, PersistedGeneratedArtifact[]>();
  for (const artifact of artifacts) {
    const layout = artifactLayouts.get(artifact.id);
    if (!layout) continue;
    byGroup.set(layout.group, [...(byGroup.get(layout.group) ?? []), artifact]);
  }

  return Array.from(byGroup.entries())
    .map(([group, groupArtifacts]) => {
      const firstLayout = groupArtifacts
        .map((artifact) => artifactLayouts.get(artifact.id))
        .filter((layout): layout is ArtifactResultLayout => Boolean(layout))
        .sort((a, b) => a.groupIndex - b.groupIndex || a.row - b.row || a.column - b.column)[0];
      if (!firstLayout) return undefined;
      const ratios = Array.from(
        new Set(groupArtifacts.map(getArtifactResultRatioLabel).filter((ratio): ratio is string => Boolean(ratio)))
      );
      return {
        group,
        groupCount: groupArtifacts.length,
        groupIndex: firstLayout.groupIndex,
        ratios,
        artifactIds: groupArtifacts.map((artifact) => artifact.id),
        artifactTitles: groupArtifacts.map((artifact) => artifact.title).filter(Boolean),
        providerRoles: getArtifactGroupProviderRoles(groupArtifacts),
        promptOnlyRoles: getArtifactGroupPromptOnlyRoles(groupArtifacts),
        copyModes: getArtifactGroupCopyModes(groupArtifacts),
        reviewSummary: getArtifactGroupReviewSummary(groupArtifacts),
        visualQaSummary: getArtifactGroupVisualQaSummary(groupArtifacts),
        position: {
          x: ARTIFACT_RESULT_BASE_POSITION.x,
          y: Math.max(0, firstLayout.position.y - ARTIFACT_RESULT_GROUP_HEADER_HEIGHT - 10),
        },
      };
    })
    .filter((layout): layout is ArtifactResultGroupLayout => Boolean(layout))
    .sort((a, b) => a.groupIndex - b.groupIndex);
}

function getArtifactResultCategoryRank(category: string): number {
  const rank = ARTIFACT_RESULT_CATEGORY_ORDER.indexOf(category);
  return rank >= 0 ? rank : ARTIFACT_RESULT_CATEGORY_ORDER.length;
}

function slugifyArtifactGroup(group: string): string {
  return encodeURIComponent(group.trim() || "result").replace(/%/g, "_").toLowerCase();
}

function getArtifactResultDisplaySize(
  artifact: PersistedGeneratedArtifact
): { width: number; height: number } {
  const aspectRatio = Math.min(2.05, Math.max(0.52, getArtifactResultAspectRatio(artifact)));
  const targetImageHeight = aspectRatio >= 1.55
    ? 330
    : aspectRatio >= 1.15
      ? 360
      : aspectRatio >= 0.9
        ? 370
        : 430;
  const width = Math.max(320, Math.min(640, Math.round(targetImageHeight * aspectRatio)));
  const imageHeight = Math.max(290, Math.min(580, Math.round(width / aspectRatio)));
  const height = imageHeight + ARTIFACT_RESULT_CAPTION_HEIGHT;
  return { width, height };
}

function getArtifactResultRatioLabel(artifact: PersistedGeneratedArtifact): string | undefined {
  return (
    getStringValue(artifact.metadata.ratio) ||
    getRatioLabelFromSize(getStringValue(artifact.metadata.size))
  );
}

function getArtifactResultAspectRatio(artifact: PersistedGeneratedArtifact): number {
  return (
    parseRatioToNumber(getArtifactResultRatioLabel(artifact)) ||
    parseSizeToAspectRatio(getStringValue(artifact.metadata.size)) ||
    4 / 3
  );
}

function getRatioLabelFromSize(size: string | undefined): string | undefined {
  const aspectRatio = parseSizeToAspectRatio(size);
  if (!aspectRatio) return undefined;
  if (Math.abs(aspectRatio - 1) < 0.01) return "1:1";
  if (Math.abs(aspectRatio - 1.5) < 0.01) return "3:2";
  if (Math.abs(aspectRatio - 0.8) < 0.01) return "4:5";
  if (Math.abs(aspectRatio - 16 / 9) < 0.01) return "16:9";
  return undefined;
}

function parseRatioToNumber(ratio: string | undefined): number | undefined {
  const match = ratio?.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : undefined;
}

function parseSizeToAspectRatio(size: string | undefined): number | undefined {
  const match = size?.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : undefined;
}

function getArtifactFrameNodeId(artifact: PersistedGeneratedArtifact): string | undefined {
  return (
    artifact.nodeId ||
    getStringValue(artifact.metadata.frameNodeId) ||
    getStringValue(artifact.metadata.sourceNodeId)
  );
}

function getArtifactBatchId(artifact: PersistedGeneratedArtifact): string | undefined {
  return (
    getStringValue(artifact.metadata?.batchId) ||
    getStringValue(artifact.metadata?.exportPackId)
  );
}

function getStoredImagePreviewUrl(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return undefined;
  const imageStorage = getRecordValue(metadata.imageStorage);
  const resultStorage = getRecordValue(metadata.resultStorage);
  return (
    getStringValue(metadata.thumbnailUrl) ||
    getStringValue(imageStorage?.thumbnailUrl) ||
    getStringValue(resultStorage?.thumbnailUrl)
  );
}

function getRecordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function getNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isArtifactFailed(artifact: PersistedGeneratedArtifact): boolean {
  const status = artifact.status.toLowerCase();
  return status === "failed" || status === "error" || status === "cancelled" || Boolean(artifact.metadata?.error);
}

function getLayoutNumber(node: CanvasWorkbenchNode, key: string): number | undefined {
  return getNumberValue(getRecordValue(node.data.parameters)?.[key]);
}

function isGenerationFrameNode(node: CanvasWorkbenchNode | undefined): boolean {
  return node?.data.componentType === "generation_frame";
}

function mapArtifactToNodeStatus(status: string): CanvasWorkbenchNode["data"]["status"] {
  if (status === "failed") return "review";
  if (status === "running") return "running";
  if (status === "draft" || status === "queued" || status === "pending") return "queued";
  return "ready";
}
