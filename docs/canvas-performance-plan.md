# Canvas Performance Plan

## Scope

This is a read-only implementation plan for the current canvas code. It is based on:

- `components/canvas/visual-workbench.tsx`
- `components/canvas/workflow-node.tsx`
- `components/canvas/asset-preview.tsx`

No source changes are included here. The goal is to give the next worker a low-risk path for improving drag smoothness and large-canvas responsiveness without changing canvas semantics.

## Current Hot Spots

1. Canvas state is owned at the `VisualWorkbench` level.
   - `canvasNodes` and `canvasEdges` live in top-level React state.
   - `CanvasStage` receives derived `stageNodes` / `stageEdges`, then maps them into React Flow nodes and edges.
   - `InspectorPanel` receives the same large state tree, so node/edge changes can fan out through both the stage and side panel.

2. Position updates are currently filtered out from `onNodesChange`.
   - `handleNodesChange` ignores every `position` change and only applies structural changes.
   - `handleNodePositionCommit` exists but is not wired to `ReactFlow`.
   - This means React Flow can move nodes internally during drag, but canonical `canvasNodes` positions do not receive a final commit.

3. Artifact reconciliation is coupled to every node/edge identity change.
   - The effect at `visual-workbench.tsx:969` depends on `artifacts`, `canvasEdges`, `canvasNodes`, and `hiddenArtifactNodeIds`.
   - It calls `reconcileArtifactResultNodes`, which loops over artifacts, may update source nodes, may add result nodes, and may add edges.
   - Any canonical node/edge state churn can rerun reconciliation even when artifact data did not change.

4. Animated edges are enabled on common creation paths.
   - Manual connections use `animated: true`.
   - generation-frame creation and export-pack creation also create animated edges.
   - `toFlowEdge` forwards `edge.animated` directly into React Flow.
   - Artifact-history edges are already static, which is a good pattern to extend.

5. Visual nodes decode and paint full preview URLs.
   - `WorkflowNode` renders `AssetPreview` for both compact and visual layouts.
   - Visual nodes use `canvasImage` / `canvasResult` sizes, but `AssetPreview` always uses the raw `src`.
   - `loading="lazy"` helps network scheduling but does not solve decode cost, large bitmap memory, or drag-time repaint pressure once many images are mounted.

## P0: Drag Smoothness and State Churn

### P0.1 Keep Drag Position Local to React Flow Until Drop

Problem:

- Committing every drag position to `canvasNodes` would make `VisualWorkbench`, `CanvasStage`, `InspectorPanel`, artifact reconciliation, and all memoized derived values react to pointer movement.
- The current code avoids that by ignoring position changes, but it also fails to persist the final dragged position.

Plan:

1. Keep `handleNodesChange` structural-only.
   - Continue ignoring `change.type === "position"` in canonical workbench state.
   - Do not call `setCanvasNodes` on every pointer move.

2. Wire a final-position commit through `ReactFlow`:
   - Pass `handleNodePositionCommit` into `CanvasStage` as `onNodePositionCommit`.
   - Add `onNodeDragStop={(_, node) => onNodePositionCommit(node.id, node.position)}` to `ReactFlow`.
   - Keep `onNodeDragStart={() => onBeforeEdit()}` for undo snapshots.

3. Make the commit idempotent:
   - In `handleNodePositionCommit`, compare old and new `x/y`.
   - Return the existing `nodes` array if the committed position is unchanged.
   - This protects `artifact reconciliation`, `flowNodes`, and `InspectorPanel` from needless rerenders after click-without-move.

Implementation sketch:

```tsx
const handleNodePositionCommit = useCallback((nodeId: string, position: XYPosition) => {
  setCanvasNodes((nodes) => {
    let changed = false;
    const next = nodes.map((node) => {
      if (node.id !== nodeId) return node;
      if (node.position.x === position.x && node.position.y === position.y) return node;
      changed = true;
      return { ...node, position };
    });
    return changed ? next : nodes;
  });
}, []);
```

Acceptance:

- Dragging a node feels smooth with 50+ image nodes.
- Dropping a node updates `canvasNodes` exactly once.
- Saving/restoring a workflow preserves the final dragged position.
- Undo after a drag returns to the previous position.

### P0.2 Stop Artifact Reconciliation From Running During Drag

Problem:

- Once final position commits are wired, `canvasNodes` will change after every completed drag.
- The current reconciliation effect depends on all node/edge arrays, so a position-only commit can trigger the full artifact pass.

Plan:

1. Introduce a cheap reconciliation signature.
   - Include artifact identity and fields that affect canvas nodes: `id`, `url`, `status`, `title`, `nodeId`, `jobId`, `assetId`, `updatedAt`.
   - Include hidden artifact ids.
   - Include only node fields needed for reconciliation: `id`, `data.artifactId`, `data.source`, `data.previewUrl`, `data.generationFrame?.outputs` count or latest output ids.
   - Do not include node `position`.

2. Use a ref to skip no-op reconciliation:
   - Compute `reconcileKey` with `useMemo`.
   - In the effect, return early if `reconcileKey === lastReconcileKeyRef.current`.
   - Update the ref only when reconciliation has been attempted.

3. Keep the full `canvasNodes` / `canvasEdges` values available through refs.
   - Maintain `canvasNodesRef.current = canvasNodes` and `canvasEdgesRef.current = canvasEdges`.
   - Run reconciliation against refs inside the effect keyed by `reconcileKey`.
   - This lets reconciliation see fresh arrays without making position-only changes a trigger.

4. Add an explicit trigger after artifact-fetching paths.
   - `refreshArtifacts` updates `artifacts`, which changes `reconcileKey`.
   - Direct artifact insertions in `handleRunJob` / retry paths also update `artifacts`.
   - Manual `handleSelectArtifact` can continue doing explicit node creation because it is user-triggered.

Acceptance:

- Drag-stop position commits do not call `reconcileArtifactResultNodes`.
- New artifacts still enrich the source generation frame and create/show result nodes.
- Hidden artifact nodes stay hidden after refresh and save/restore.

### P0.3 Reduce Render Fanout From Selection

Problem:

- `CanvasStage` maps every node with `selected` embedded in each flow node.
- Changing selection changes the `selected` prop calculation for every node because `flowNodes` depends on `selectedNodeId`.
- This is acceptable for small graphs but gets expensive with image-heavy nodes.

Plan:

1. Keep selection canonical in `selectedNodeId`, but stop embedding `selected` into every flow node if React Flow selection already tracks the clicked node.
2. If explicit selected styling is still required, update only two nodes:
   - previous selected id
   - next selected id
3. A small P0-safe version is to leave this unchanged until P0.1/P0.2 land, then profile selection separately.

Acceptance:

- Clicking nodes should not recreate all node objects on a large canvas.
- Inspector selection must still update immediately.

## P0: Animated Edge Degradation

### P0.4 Make Edge Animation Opt-In and Load-Aware

Problem:

- Animated SVG edges are costly on dense canvases.
- Current code marks many ordinary workflow edges as animated: manual connect, generation frame creation, export pack creation, and queued/running factory suggestions.

Plan:

1. Add a central edge animation policy near `toFlowEdge`.
   - Keep artifact-history edges static.
   - Keep ordinary saved workflow edges static by default.
   - Only animate edges when they communicate active work: source/target node status is `queued` or `running`, or a connection is being previewed by React Flow.

2. Add a graph-size cutoff.
   - If `edges.length > 24` or `nodes.length > 30`, force all persisted edges static.
   - If `prefers-reduced-motion` is true, force all persisted edges static.

3. Preserve the semantic `animated` field as historical data, but degrade in rendering:
   - Do not rewrite existing edges to `animated: false` during load.
   - In `toFlowEdge`, compute `animated` from policy and pass the degraded boolean to React Flow.

Implementation shape:

```tsx
function toFlowEdge(edge: CanvasWorkbenchEdge, options: { allowAnimation: boolean }): Edge {
  return {
    ...,
    animated: options.allowAnimation && edge.animated,
  };
}
```

Acceptance:

- Large canvases do not show persistent animated edge loops.
- Active generation can still have a single clear motion cue when the graph is small.
- Existing saved workflow data remains compatible.

## P0: Image Thumbnail Strategy

### P0.5 Use Canvas Thumbnails Instead of Full-Size Preview URLs

Problem:

- `WorkflowNode` uses `AssetPreview` with `data.previewUrl`.
- Artifact URLs may point at large generated images.
- `AssetPreview` renders raw `<img src={src}>`; browser lazy loading does not prevent large decode once visible.

Plan:

1. Add thumbnail metadata without breaking existing nodes.
   - Preferred fields:
     - `data.thumbnailUrl`
     - `data.previewUrl`
     - `data.fullImageUrl`
   - Preserve `previewUrl` as the provider/reference/full image if it is already used by generation semantics.
   - Use `thumbnailUrl ?? previewUrl` only for rendering.

2. Add a thumbnail URL resolver:
   - For local generated artifacts: route through an image endpoint such as `/api/generated-images/{id}?w=384&fit=cover` if the backend supports it.
   - For data URLs: keep as-is for now, but cap new uploads by creating a client-side thumbnail before save.
   - For static SVG sample assets: keep original URL.

3. Update `AssetPreview` API later to accept both thumbnail and full URL:
   - `src` for thumbnail.
   - `href` / `fullSrc` for "打开大图".
   - Do not make `AssetPreview` itself responsible for generation semantics.

4. For canvas nodes:
   - Visual layout target width can use 384-512 px thumbnails.
   - Compact node thumbnails can use 96-160 px.
   - Inspector hero can use 512-768 px.
   - Production/export panels can use the same thumbnail field, opening full image only on demand.

Acceptance:

- Network panel shows canvas nodes fetching thumbnail-size resources, not original multi-megabyte artifacts.
- Dragging visible image nodes does not trigger large bitmap decode or repaint spikes.
- Clicking "大图" still opens the original image.
- Product-reference generation still uses provider-usable full `previewUrl` or explicit `referenceImages`, not thumbnail URLs.

### Next Round TODO: Incremental Asset Fetching

Goal:

- Keep the asset drawer and canvas hydration fast when output history grows.

Plan:

1. Extend asset/artifact list APIs with a bounded `limit` parameter and an `updatedAfter` cursor.
2. Return `thumbnailUrl` beside full image URLs so drawer rows and canvas nodes can render lightweight thumbnails by default.
3. Let the client request only recent changes after the first load instead of refetching all generated outputs.
4. Keep full-resolution URLs available only for provider references, detail view, export, or explicit open/download actions.

Acceptance:

- Asset drawer refresh payloads stay bounded even after 100+ generated outputs.
- Newly generated outputs appear through `updatedAfter` polling or event refresh without replacing the full drawer state.
- Canvas/image preview rendering uses `thumbnailUrl ?? previewUrl`; generation semantics continue to use the full provider-safe URL.

## P1: Reconciliation and Polling Hygiene

### P1.1 Move Artifact Reconciliation to an Event Boundary

Problem:

- Reconciliation is currently a render/effect concern. It reacts to state shape rather than to domain events.

Plan:

1. Create a `commitArtifactsToCanvas(artifacts, reason)` callback.
2. Call it from:
   - initial artifact load
   - active job polling when artifact ids changed
   - run/retry completion paths
   - manual artifact restore
3. Keep a `lastArtifactVersionRef` keyed by artifact ids/status/updatedAt.
4. Remove `canvasNodes` / `canvasEdges` from the effect dependency path once callback/ref safety is established.

Acceptance:

- Artifact reconciliation runs only after artifact changes, not after drag, selection, or panel-only state.
- New result nodes still appear within one poll interval after job completion.

### P1.2 Split Canvas Store From Inspector Store

Problem:

- `VisualWorkbench` owns canvas geometry, asset libraries, jobs, queues, projects, templates, artifacts, messages, and panel UI state.
- A small canvas interaction can invalidate a large parent component.

Plan:

1. Extract canvas graph state into a reducer or external store:
   - `nodes`
   - `edges`
   - `selectedNodeId`
   - `hiddenArtifactNodeIds`
   - undo/redo stacks
2. Keep server data in separate hooks:
   - `useCanvasAssets`
   - `useCanvasJobs`
   - `useCanvasArtifacts`
   - `useCanvasProjects`
3. Pass stable selectors to `CanvasStage` and `InspectorPanel`.
4. Do this after P0 so the behavior-preserving commit path is already proven.

Acceptance:

- Dragging does not rerender production/export/project panels.
- Updating queue/project status does not recreate React Flow nodes.

### P1.3 Virtualize Non-Canvas Image Lists

Problem:

- The side panel and asset tray can render many `AssetPreview` instances too.
- Even if canvas thumbnails are optimized, large artifact lists can still pressure memory.

Plan:

1. Add list virtualization for artifact/history lists once counts exceed 50.
2. Use small thumbnails in list rows and defer full image loading until detail/open action.
3. Keep selected-node artifact summaries capped; current `slice(0, 5)` summaries are good and should stay.

Acceptance:

- 100+ artifacts remain scrollable without long layout stalls.
- Canvas drag performance does not degrade when artifact history is large but collapsed/offscreen.

## Optional Small Patch Order

If a worker is allowed to touch source later, the safest first patch is:

1. Wire `handleNodePositionCommit` to `CanvasStage` and `ReactFlow.onNodeDragStop`.
2. Make `handleNodePositionCommit` idempotent.
3. Add a temporary `console.debug` behind a local dev flag to count position commits and reconciliation runs during profiling, then remove it before merge.

This patch is small, behavior-preserving, and directly fixes the missing persistence path while keeping drag-local state inside React Flow.

The second patch should be the reconciliation signature/ref guard. Do not combine it with thumbnail/backend work; it needs focused regression testing around artifact restore, hidden result nodes, and generation-frame output merging.

## Verification Checklist

Use a seeded or restored canvas with many image nodes where possible.

1. Drag smoothness:
   - Drag a visual node continuously for 5 seconds.
   - Confirm no visible stutter from side-panel updates.
   - Drop and save; refresh with `?restore=1`; confirm final position persists.

2. Reconciliation:
   - Run or simulate a completed job that creates an artifact.
   - Confirm source node gets artifact metadata/output.
   - Confirm result node appears once and does not duplicate on refresh.
   - Hide/delete an artifact result node and confirm it stays hidden after artifact refresh.

3. Edges:
   - Create manual and generation-frame edges.
   - Confirm large canvases degrade persisted animated edges to static rendering.
   - Confirm active queued/running state can still show a deliberate motion cue when below cutoff.

4. Images:
   - Open devtools network panel.
   - Confirm canvas nodes fetch thumbnail resources after thumbnail patch.
   - Confirm "大图" opens the full original image.
   - Confirm provider reference logic still receives full provider-usable image URLs.

## Key Source Anchors

- `components/canvas/visual-workbench.tsx:734`: top-level `canvasNodes` / `canvasEdges` state.
- `components/canvas/visual-workbench.tsx:969`: artifact reconciliation effect depends on node and edge arrays.
- `components/canvas/visual-workbench.tsx:999`: active job polling refreshes jobs, artifacts, and queue every 2500 ms.
- `components/canvas/visual-workbench.tsx:2315`: `handleNodesChange` filters out position changes.
- `components/canvas/visual-workbench.tsx:2341`: `handleNodePositionCommit` exists but is not wired.
- `components/canvas/visual-workbench.tsx:2378`: manual connection creates animated edges.
- `components/canvas/visual-workbench.tsx:2895`: `CanvasStage` maps workbench nodes to React Flow nodes.
- `components/canvas/visual-workbench.tsx:3194`: `ReactFlow` currently has drag start and node changes, but no drag-stop commit.
- `components/canvas/visual-workbench.tsx:7630`: `reconcileArtifactResultNodes` mutates/enriches nodes and edges from artifacts.
- `components/canvas/visual-workbench.tsx:7898`: `toFlowEdge` forwards `animated` directly.
- `components/canvas/workflow-node.tsx:205`: visual node preview uses `AssetPreview`.
- `components/canvas/workflow-node.tsx:274`: compact node preview uses `AssetPreview`.
- `components/canvas/asset-preview.tsx:50`: `AssetPreview` renders the raw image URL with lazy loading.
