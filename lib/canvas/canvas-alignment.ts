import type { XYPosition } from "@xyflow/react";

import type { CanvasWorkbenchEdge, CanvasWorkbenchNode } from "./workbench-data";

export interface CanvasSize {
  width: number;
  height: number;
}

export interface CanvasRect extends CanvasSize {
  id?: string;
  x: number;
  y: number;
}

export type CanvasGuideAxis = "x" | "y";
export type CanvasGuideKind = "start" | "center" | "end" | "spacing";

export interface CanvasReferenceGuide {
  axis: CanvasGuideAxis;
  value: number;
  kind: CanvasGuideKind;
  nodeId?: string;
}

export interface CanvasSnapTarget extends CanvasReferenceGuide {
  movingKind: CanvasGuideKind;
  distance: number;
}

export interface CanvasSnapResult {
  position: XYPosition;
  delta: XYPosition;
  snapped: boolean;
  guides: CanvasSnapTarget[];
}

export interface CanvasNodeSizeOptions {
  defaultSize?: CanvasSize;
  generationFrameSize?: CanvasSize;
  outputNodeSize?: CanvasSize;
  reviewNodeSize?: CanvasSize;
  assetNodeSize?: CanvasSize;
}

export interface CanvasSnapOptions extends CanvasNodeSizeOptions {
  threshold?: number;
  includeSpacingGuides?: boolean;
  ignoreNodeIds?: Iterable<string>;
}

export interface AvailableFramePositionOptions extends CanvasNodeSizeOptions {
  anchorNode?: CanvasWorkbenchNode;
  preferredPosition?: XYPosition;
  frameSize?: CanvasSize;
  gap?: number;
  searchStep?: XYPosition;
  maxAttempts?: number;
  padding?: number;
}

export interface ArrangeCanvasNodesOptions extends CanvasNodeSizeOptions {
  edges?: CanvasWorkbenchEdge[];
  origin?: XYPosition;
  columnGap?: number;
  rowGap?: number;
  strategy?: "ranked" | "kind" | "grid";
  preserveIds?: Iterable<string>;
}

export const CANVAS_DEFAULT_NODE_SIZE: CanvasSize = { width: 260, height: 168 };
export const CANVAS_ASSET_NODE_SIZE: CanvasSize = { width: 260, height: 188 };
export const CANVAS_OUTPUT_NODE_SIZE: CanvasSize = { width: 280, height: 210 };
export const CANVAS_REVIEW_NODE_SIZE: CanvasSize = { width: 280, height: 190 };
export const CANVAS_GENERATION_FRAME_SIZE: CanvasSize = { width: 720, height: 460 };
export const CANVAS_SNAP_THRESHOLD = 12;
export const CANVAS_NODE_GAP = 48;
export const CANVAS_COLUMN_GAP = 120;
export const CANVAS_ROW_GAP = 56;

const KIND_RANK: Record<CanvasWorkbenchNode["data"]["kind"], number> = {
  asset: 0,
  factory: 1,
  output: 2,
  review: 3,
};

export function isGenerationFrameNode(node: CanvasWorkbenchNode | undefined): boolean {
  return node?.data.componentType === "generation_frame";
}

export function getCanvasNodeSize(
  node: CanvasWorkbenchNode,
  options: CanvasNodeSizeOptions = {}
): CanvasSize {
  if (isGenerationFrameNode(node)) {
    return options.generationFrameSize ?? CANVAS_GENERATION_FRAME_SIZE;
  }
  if (node.data.kind === "asset") {
    return options.assetNodeSize ?? options.defaultSize ?? CANVAS_ASSET_NODE_SIZE;
  }
  if (node.data.kind === "output") {
    return options.outputNodeSize ?? options.defaultSize ?? CANVAS_OUTPUT_NODE_SIZE;
  }
  if (node.data.kind === "review") {
    return options.reviewNodeSize ?? options.defaultSize ?? CANVAS_REVIEW_NODE_SIZE;
  }
  return options.defaultSize ?? CANVAS_DEFAULT_NODE_SIZE;
}

export function getCanvasNodeRect(
  node: CanvasWorkbenchNode,
  options: CanvasNodeSizeOptions = {}
): CanvasRect {
  return {
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    ...getCanvasNodeSize(node, options),
  };
}

export function getCanvasRectEdges(rect: CanvasRect): {
  left: number;
  centerX: number;
  right: number;
  top: number;
  centerY: number;
  bottom: number;
} {
  return {
    left: rect.x,
    centerX: rect.x + rect.width / 2,
    right: rect.x + rect.width,
    top: rect.y,
    centerY: rect.y + rect.height / 2,
    bottom: rect.y + rect.height,
  };
}

export function getCanvasBounds(
  nodes: CanvasWorkbenchNode[],
  options: CanvasNodeSizeOptions = {}
): CanvasRect {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const rects = nodes.map((node) => getCanvasNodeRect(node, options));
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function getReferenceGuidesForRect(rect: CanvasRect): CanvasReferenceGuide[] {
  const edges = getCanvasRectEdges(rect);
  return [
    { axis: "x", value: edges.left, kind: "start", nodeId: rect.id },
    { axis: "x", value: edges.centerX, kind: "center", nodeId: rect.id },
    { axis: "x", value: edges.right, kind: "end", nodeId: rect.id },
    { axis: "y", value: edges.top, kind: "start", nodeId: rect.id },
    { axis: "y", value: edges.centerY, kind: "center", nodeId: rect.id },
    { axis: "y", value: edges.bottom, kind: "end", nodeId: rect.id },
  ];
}

export function getCanvasReferenceGuides(
  nodes: CanvasWorkbenchNode[],
  options: CanvasSnapOptions = {}
): CanvasReferenceGuide[] {
  const ignored = new Set(options.ignoreNodeIds ?? []);
  const rects = nodes
    .filter((node) => !ignored.has(node.id))
    .map((node) => getCanvasNodeRect(node, options));
  const guides = rects.flatMap(getReferenceGuidesForRect);

  return options.includeSpacingGuides
    ? [...guides, ...getSpacingGuides(rects)]
    : guides;
}

export function calculateCanvasSnap(
  rect: CanvasRect,
  guides: CanvasReferenceGuide[],
  options: Pick<CanvasSnapOptions, "threshold"> = {}
): CanvasSnapResult {
  const threshold = options.threshold ?? CANVAS_SNAP_THRESHOLD;
  const xTarget = getBestSnapTarget(rect, guides, "x", threshold);
  const yTarget = getBestSnapTarget(rect, guides, "y", threshold);
  const delta = {
    x: xTarget ? xTarget.value - getMovingGuideValue(rect, "x", xTarget.movingKind) : 0,
    y: yTarget ? yTarget.value - getMovingGuideValue(rect, "y", yTarget.movingKind) : 0,
  };

  return {
    position: {
      x: rect.x + delta.x,
      y: rect.y + delta.y,
    },
    delta,
    snapped: Boolean(xTarget || yTarget),
    guides: [xTarget, yTarget].filter(Boolean) as CanvasSnapTarget[],
  };
}

export function snapCanvasNodePosition(
  node: CanvasWorkbenchNode,
  position: XYPosition,
  nodes: CanvasWorkbenchNode[],
  options: CanvasSnapOptions = {}
): CanvasSnapResult {
  const size = getCanvasNodeSize(node, options);
  const ignoreNodeIds = new Set(options.ignoreNodeIds ?? []);
  ignoreNodeIds.add(node.id);

  return calculateCanvasSnap(
    { id: node.id, x: position.x, y: position.y, ...size },
    getCanvasReferenceGuides(nodes, { ...options, ignoreNodeIds }),
    options
  );
}

export function rectsOverlap(
  a: CanvasRect,
  b: CanvasRect,
  padding = 0
): boolean {
  return (
    a.x < b.x + b.width + padding &&
    a.x + a.width + padding > b.x &&
    a.y < b.y + b.height + padding &&
    a.y + a.height + padding > b.y
  );
}

export function findAvailableGenerationFramePosition(
  nodes: CanvasWorkbenchNode[],
  options: AvailableFramePositionOptions = {}
): XYPosition {
  const frameSize = options.frameSize ?? options.generationFrameSize ?? CANVAS_GENERATION_FRAME_SIZE;
  const gap = options.gap ?? CANVAS_NODE_GAP;
  const padding = options.padding ?? 16;
  const searchStep = options.searchStep ?? {
    x: frameSize.width + gap,
    y: Math.round(frameSize.height / 2 + gap),
  };
  const occupied = nodes.map((node) => getCanvasNodeRect(node, options));
  const preferred = getPreferredGenerationFramePosition(nodes, frameSize, gap, options);
  const maxAttempts = options.maxAttempts ?? 80;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = getSearchPosition(preferred, searchStep, attempt);
    const candidateRect = { ...candidate, ...frameSize };
    if (!occupied.some((rect) => rectsOverlap(candidateRect, rect, padding))) {
      return candidate;
    }
  }

  const bounds = getCanvasBounds(nodes, options);
  return {
    x: Math.max(40, bounds.x + bounds.width + gap),
    y: Math.max(40, bounds.y),
  };
}

export function getGenerationFrameAtPosition(
  nodes: CanvasWorkbenchNode[],
  position: XYPosition,
  options: CanvasNodeSizeOptions & { padding?: number } = {}
): CanvasWorkbenchNode | undefined {
  const padding = options.padding ?? 12;
  return [...nodes].reverse().find((node) => {
    if (!isGenerationFrameNode(node)) return false;
    const rect = getCanvasNodeRect(node, options);
    return (
      position.x >= rect.x - padding &&
      position.x <= rect.x + rect.width + padding &&
      position.y >= rect.y - padding &&
      position.y <= rect.y + rect.height + padding
    );
  });
}

export function arrangeCanvasNodes(
  nodes: CanvasWorkbenchNode[],
  options: ArrangeCanvasNodesOptions = {}
): CanvasWorkbenchNode[] {
  const preserveIds = new Set(options.preserveIds ?? []);
  const movable = nodes.filter((node) => !preserveIds.has(node.id));
  const preserved = nodes.filter((node) => preserveIds.has(node.id));
  const ranks = getArrangementRanks(movable, options);
  const origin = options.origin ?? { x: 40, y: 80 };
  const columnGap = options.columnGap ?? CANVAS_COLUMN_GAP;
  const rowGap = options.rowGap ?? CANVAS_ROW_GAP;
  const arrangedPositions = new Map<string, XYPosition>();
  const columns = groupByRank(movable, ranks);
  let x = origin.x;

  for (const column of columns) {
    let y = origin.y;
    const columnWidth = Math.max(
      ...column.map((node) => getCanvasNodeSize(node, options).width),
      CANVAS_DEFAULT_NODE_SIZE.width
    );

    for (const node of column) {
      const size = getCanvasNodeSize(node, options);
      arrangedPositions.set(node.id, { x, y });
      y += size.height + rowGap;
    }

    x += columnWidth + columnGap;
  }

  return nodes.map((node) => {
    const position = arrangedPositions.get(node.id);
    return position ? { ...node, position } : node;
  });
}

function getSpacingGuides(rects: CanvasRect[]): CanvasReferenceGuide[] {
  const guides: CanvasReferenceGuide[] = [];

  for (const rect of rects) {
    guides.push(
      { axis: "x", value: rect.x - CANVAS_NODE_GAP, kind: "spacing", nodeId: rect.id },
      { axis: "x", value: rect.x + rect.width + CANVAS_NODE_GAP, kind: "spacing", nodeId: rect.id },
      { axis: "y", value: rect.y - CANVAS_NODE_GAP, kind: "spacing", nodeId: rect.id },
      { axis: "y", value: rect.y + rect.height + CANVAS_NODE_GAP, kind: "spacing", nodeId: rect.id }
    );
  }

  return guides;
}

function getBestSnapTarget(
  rect: CanvasRect,
  guides: CanvasReferenceGuide[],
  axis: CanvasGuideAxis,
  threshold: number
): CanvasSnapTarget | undefined {
  let best: CanvasSnapTarget | undefined;

  for (const guide of guides) {
    if (guide.axis !== axis) continue;

    for (const movingKind of ["start", "center", "end"] as const) {
      const movingValue = getMovingGuideValue(rect, axis, movingKind);
      const distance = Math.abs(guide.value - movingValue);
      if (distance > threshold) continue;
      if (!best || distance < best.distance) {
        best = { ...guide, movingKind, distance };
      }
    }
  }

  return best;
}

function getMovingGuideValue(
  rect: CanvasRect,
  axis: CanvasGuideAxis,
  kind: CanvasGuideKind
): number {
  if (axis === "x") {
    if (kind === "center") return rect.x + rect.width / 2;
    if (kind === "end") return rect.x + rect.width;
    return rect.x;
  }

  if (kind === "center") return rect.y + rect.height / 2;
  if (kind === "end") return rect.y + rect.height;
  return rect.y;
}

function getPreferredGenerationFramePosition(
  nodes: CanvasWorkbenchNode[],
  frameSize: CanvasSize,
  gap: number,
  options: AvailableFramePositionOptions
): XYPosition {
  if (options.preferredPosition) return options.preferredPosition;

  if (options.anchorNode) {
    const anchorRect = getCanvasNodeRect(options.anchorNode, options);
    return {
      x: anchorRect.x + anchorRect.width + gap,
      y: anchorRect.y + Math.round((anchorRect.height - frameSize.height) / 2),
    };
  }

  if (nodes.length === 0) return { x: 340, y: 120 };

  const bounds = getCanvasBounds(nodes, options);
  return {
    x: bounds.x + bounds.width + gap,
    y: Math.max(40, bounds.y),
  };
}

function getSearchPosition(
  origin: XYPosition,
  step: XYPosition,
  attempt: number
): XYPosition {
  if (attempt === 0) return origin;

  const ring = Math.ceil((Math.sqrt(attempt + 1) - 1) / 2);
  const side = ring * 2;
  const index = attempt - (side - 1) * (side - 1) - 1;
  const leg = Math.floor(index / side);
  const offset = index % side;

  const points = [
    { x: ring, y: -ring + offset },
    { x: ring - offset, y: ring },
    { x: -ring, y: ring - offset },
    { x: -ring + offset, y: -ring },
  ];
  const point = points[Math.min(leg, points.length - 1)] ?? points[0];

  return {
    x: origin.x + point.x * step.x,
    y: origin.y + point.y * step.y,
  };
}

function getArrangementRanks(
  nodes: CanvasWorkbenchNode[],
  options: ArrangeCanvasNodesOptions
): Map<string, number> {
  if (options.strategy === "grid") {
    return new Map(nodes.map((node, index) => [node.id, Math.floor(index / 3)]));
  }

  if (options.strategy === "kind" || !options.edges?.length) {
    return new Map(nodes.map((node) => [node.id, KIND_RANK[node.data.kind] ?? 0]));
  }

  return getRankedLayoutMap(nodes, options.edges);
}

function getRankedLayoutMap(
  nodes: CanvasWorkbenchNode[],
  edges: CanvasWorkbenchEdge[]
): Map<string, number> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const queue = nodes
    .filter((node) => (incomingCount.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const ranks = new Map(nodes.map((node) => [node.id, 0]));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);

    for (const target of outgoing.get(id) ?? []) {
      ranks.set(target, Math.max(ranks.get(target) ?? 0, (ranks.get(id) ?? 0) + 1));
      incomingCount.set(target, (incomingCount.get(target) ?? 1) - 1);
      if ((incomingCount.get(target) ?? 0) <= 0) queue.push(target);
    }
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      ranks.set(node.id, Math.max(ranks.get(node.id) ?? 0, KIND_RANK[node.data.kind] ?? 0));
    }
  }

  return ranks;
}

function groupByRank(
  nodes: CanvasWorkbenchNode[],
  ranks: Map<string, number>
): CanvasWorkbenchNode[][] {
  const grouped = new Map<number, CanvasWorkbenchNode[]>();

  for (const node of nodes) {
    const rank = ranks.get(node.id) ?? 0;
    grouped.set(rank, [...(grouped.get(rank) ?? []), node]);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, column]) =>
      [...column].sort((a, b) => {
        const kindDelta = (KIND_RANK[a.data.kind] ?? 0) - (KIND_RANK[b.data.kind] ?? 0);
        if (kindDelta !== 0) return kindDelta;
        if (a.position.y !== b.position.y) return a.position.y - b.position.y;
        return a.position.x - b.position.x;
      })
    );
}
