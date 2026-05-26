# Image Master Canvas Workflow Development Report

Date: 2026-05-15
Project: `/Users/lichenhao/Desktop/image master`

## 1. Executive Decision

The product should become an AI-assisted visual production canvas:

- Left side: asset and component library.
- Center: infinite-feeling canvas for assets, references, generated results, annotations, and executable workflows.
- Right side: inspector, AI component factory, job status, and quality review.
- Backend: persistent assets, workflow graphs, component templates, generation jobs, generated artifacts, and review reports.

The safest technical choice is:

- Primary executable canvas: `@xyflow/react` / React Flow, MIT.
- Optional freeform annotation layer: Excalidraw, MIT, either embedded as an auxiliary board or added later as an image annotation modal.
- Inspiration only: tldraw image-pipeline / workflow templates. Do not make tldraw a required dependency for the public GitHub project unless a suitable tldraw license is obtained.

This keeps the project publishable on GitHub under a clean license story while preserving the product direction: whiteboard freedom plus workflow execution.

## 2. Research Summary

### tldraw

tldraw is the closest product-feel match. Its repository includes official starter kits for workflow builders and image pipelines. The image-pipeline template already has typed ports, connection bindings, a DAG execution graph, template save/restore, image nodes, prompt nodes, generation nodes, preview nodes, style transfer, upscale, and a worker/provider layer.

The problem is licensing. The root tldraw license defines production environments broadly, including web apps made available to end users or the public, and its conditions forbid production use without an appropriate license key. The README also states that production use requires a license key.

Conclusion: excellent reference architecture, not the public open-source default.

Sources:

- https://github.com/tldraw/tldraw
- https://github.com/tldraw/tldraw/blob/main/LICENSE.md
- https://tldraw.dev/pricing

### React Flow / xyflow

React Flow is a strong fit for a safe, public project. It is MIT licensed, React-native, TypeScript-friendly, and designed for node-based editors, graphs, diagrams, and workflow UIs. Its examples cover the exact primitives needed here: custom nodes, handles, connection validation, drag-and-drop node creation, save/restore, node data, minimap, controls, and background grids.

Compared with tldraw, it has less native whiteboard charm, but it is better as the stable execution surface for semantic components and generation workflows.

Conclusion: choose this as the main canvas engine.

Sources:

- https://github.com/xyflow/xyflow
- https://reactflow.dev/examples/interaction/save-and-restore/

### Excalidraw

Excalidraw is MIT and can be embedded as a React component. It is strong for freeform sketching, handwritten notes, annotations, arrows, image markups, and moodboard-like ideation. It is not naturally a typed workflow engine.

Conclusion: use later for annotation and whiteboard affordances, not as the core workflow runtime.

Sources:

- https://github.com/excalidraw/excalidraw
- https://excalidraw-excalidraw.mintlify.app/components/excalidraw

### Rete.js

Rete.js is MIT and focused on visual programming / node editors. It has a more framework-like graph programming feel than React Flow. It is a good fallback if React Flow becomes too UI-oriented and the project needs deeper graph-programming semantics.

Conclusion: keep as second-choice technical reference.

Sources:

- https://github.com/retejs/rete
- https://retejs.org/examples/basic/react

### ComfyUI

ComfyUI is the key product reference for node-based image generation workflows. It proves the mental model: users accept nodes when they want control over generation pipelines. But ComfyUI is too technical for this product's target direction. The useful lesson is not "copy ComfyUI"; it is "hide low-level nodes behind semantic components and AI-generated workflows."

Conclusion: use it as a conceptual benchmark, not as a code dependency.

Sources:

- https://en.wikipedia.org/wiki/ComfyUI
- https://arxiv.org/abs/2503.17671
- https://arxiv.org/abs/2505.17908
- https://arxiv.org/abs/2506.09790

### Miro / Figma / Canva

These products show the asset-library pattern:

- Miro: infinite canvas plus templates.
- Figma: libraries of reusable components, styles, variables, and shared assets.
- Canva: brand kits with logos, colors, fonts, icons, imagery, graphics, templates, and usage guidance.

The important lesson is that users do not want a raw node graph first. They want reusable assets, templates, and guided composition. The canvas should expose the workflow only when it helps.

Sources:

- https://miro.com/whiteboard/
- https://help.miro.com/hc/en-us/articles/360017572134-Templates
- https://www.figma.com/best-practices/components-styles-and-shared-libraries/
- https://help.figma.com/hc/en-us/articles/360041051154-Guide-to-libraries-in-Figma
- https://www.canva.com/pro/brand-kit/
- https://www.canva.com/business/features/brand/

### n8n / Node-RED

n8n and Node-RED are workflow references. n8n is source-available / fair-code, so it is not a dependency candidate, but its product pattern is useful: template catalog, nodes, credentials, executions, retries, and human-readable runs. Node-RED is Apache 2.0 and more permissive, but it is too IoT/API-workflow flavored for this product's UI.

Conclusion: borrow the execution-history and template-library concepts, not the implementation.

Sources:

- https://docs.n8n.io/sustainable-use-license/
- https://docs.n8n.io/
- https://github.com/node-red/node-red/blob/master/LICENSE

## 3. Product Direction

The product should not be a prompt box with a canvas attached. It should be a visual production system where the user starts from products and grows outward into multiple commercial image outputs.

Typical user journey:

1. User imports a product image or a product parameter sheet.
2. AI analyzes the product into a reusable Product Asset.
3. User chooses or asks for a scenario: model display, Amazon main image, Taobao detail page, Xiaohongshu cover, website hero, poster set, lifestyle scene, brand campaign.
4. AI creates a canvas workflow from templates.
5. User can adjust the generated component graph visually.
6. System generates an image set.
7. Results stay on the canvas, can be annotated, regenerated, branched, scored, and exported.

The key promise:

The user does not need to write prompts. They provide intent and assets; AI creates structured components and workflows.

## 4. Canvas Concept

The center canvas should support four object classes.

### 4.1 Free Canvas Objects

These are not executable by default:

- Reference images.
- Generated result images.
- Notes.
- Arrows.
- Frames / groups.
- Moodboard sections.
- Manual labels.
- Annotation marks.

These make the app feel like a visual workspace, not a rigid workflow editor.

### 4.2 Asset Components

These are reusable and can feed workflows:

- Product Asset.
- Model Asset.
- Brand Asset.
- Style Asset.
- Scene Asset.
- Prompt Asset.
- Platform Rule Asset.
- Output Spec Asset.
- Quality Rule Asset.

Asset components can live in the left asset library and be dragged onto the canvas.

### 4.3 Executable Nodes

These perform transformations or generation:

- Analyze Product.
- Import Prompt to Component.
- Extract Style From Image.
- Build Product Brief.
- Plan Image Set.
- Compile Prompt.
- Generate Image.
- Generate Image Set.
- Review Quality.
- Regenerate Failed Items.
- Export Pack.

Executable nodes should be semantic, not low-level model nodes.

### 4.4 Workflow Templates

Templates are reusable subgraphs:

- Product to Taobao Main Image.
- Product to Amazon Main Image.
- Product to Model Display Set.
- Product to Detail Page Set.
- Product to Xiaohongshu Launch Set.
- Prompt to Visual Style Component.
- Model Image to Model Asset.
- Brand Assets to Brand Kit.
- Generated Set to Quality Review and Export.

Templates are the bridge between "low-code" and "AI automatic setup."

## 5. Left Asset Library Taxonomy

The left library should be comprehensive but not overwhelming. Recommended top-level tabs:

### 5.1 Products

Stored product assets:

- Main product images.
- Cutout / transparent product image.
- Packaging image.
- Detail closeups.
- Logo region references.
- Product invariant rules.
- Selling points.
- Materials.
- Dimensions.
- Price tier.
- Target audience.
- Forbidden changes.

Product Asset schema:

```ts
type ProductAsset = {
  id: string
  name: string
  category: string
  images: AssetImage[]
  invariants: string[]
  sellingPoints: string[]
  materials?: string[]
  dimensions?: string
  targetAudience?: string
  forbiddenChanges: string[]
  source: 'upload' | 'csv' | 'ai_import' | 'manual'
}
```

### 5.2 Models

Stored model/persona assets:

- Original reference images.
- Face anchors.
- Body anchors.
- Outfit defaults.
- Suitable categories.
- Pose range.
- Usage rules.
- Safety rules.
- Identity consistency notes.

Model Asset schema:

```ts
type ModelAsset = {
  id: string
  name: string
  referenceImages: AssetImage[]
  identityAnchors: string[]
  bodyAnchors?: string[]
  stylingNotes: string[]
  suitableScenes: string[]
  forbiddenUses: string[]
  consistencyRules: string[]
}
```

### 5.3 Styles

Visual style components:

- Color palette.
- Lighting.
- composition.
- Material language.
- Background language.
- Lens/camera language.
- Typography direction.
- Negative rules.
- Quality checks.
- Compatible output types.

Style examples:

- Premium black-gold fragrance.
- Clean Amazon product commerce.
- Warm home lifestyle.
- High-end business model editorial.
- Youth streetwear campaign.
- Minimal tech hardware.
- Fresh skincare beauty.

### 5.4 Platforms

Platform rule components:

- Amazon.
- Taobao.
- Tmall.
- JD.
- Xiaohongshu.
- Douyin cover.
- Website hero.
- Shopify product page.
- Instagram post/story.
- WeChat article cover.

Rules should include:

- Aspect ratio.
- Safe areas.
- Text allowance.
- Background restrictions.
- Product size in frame.
- Model allowed or not.
- Commercial quality criteria.
- Export naming and formats.

### 5.5 Scenes

Scene components:

- Studio white background.
- Premium studio set.
- Kitchen counter.
- Office desk.
- Bathroom vanity.
- Outdoor trail.
- Street fashion.
- Cafe table.
- Luxury hotel room.
- Gym / sports field.
- E-commerce detail layout.

Each scene should have:

- Environment.
- Props.
- Lighting.
- Depth.
- Camera angle.
- Product placement rules.

### 5.6 Recipes

Image recipe components:

- Main Product Image.
- White Background Product Image.
- Selling Point Image.
- Detail Page Image.
- Lifestyle Scene.
- Model Display.
- Poster.
- Banner.
- Social Cover.
- Comparison Image.
- Before/After Image.
- Packaging Hero.

Recipe defines the purpose of one generated asset.

### 5.7 Brand Kits

Brand kit components:

- Logos.
- Color palettes.
- Fonts.
- Tone of voice.
- Visual dos and don'ts.
- Example references.
- Template locks.
- Compliance rules.

This category borrows from Canva/Figma. It should be central for repeated commercial use.

### 5.8 Prompt Components

Imported prompt assets:

- Raw source prompt.
- Extracted style rules.
- Extracted scene rules.
- Extracted camera rules.
- Extracted negative rules.
- Compatible recipes.
- Risk notes.

The raw prompt should never be executed directly by default. It should be normalized into a component.

### 5.9 Quality Checks

Quality check components:

- Product identity preserved.
- Product not deformed.
- Text readable.
- Platform compliance.
- Style consistency.
- Model consistency.
- No illegal logo changes.
- No hallucinated features.
- No visual clutter.
- Commercial usability score.

### 5.10 Output Packs

Output pack components:

- Amazon launch pack.
- Taobao detail pack.
- Xiaohongshu seeding pack.
- Website hero pack.
- Brand campaign pack.
- Model display pack.
- Full commerce pack.

This is what non-technical users will understand best.

## 6. AI Component Factory

This should be a first-class feature.

User inputs:

- "I found this prompt online. Turn it into a reusable style component."
- "This model image should become a model asset."
- "This product sheet has 30 products. Build reusable product assets."
- "This generated image looks good. Extract its visual language."
- "Make a component for Amazon premium skincare main images."

Pipeline:

1. Ingest raw input.
2. Classify component type.
3. Extract structured fields.
4. Normalize to platform schema.
5. Run validation.
6. Show component draft.
7. User confirms.
8. Save to library.
9. Recommend compatible templates.

The AI should generate declarative JSON, not arbitrary executable code.

Core schema:

```ts
type ComponentTemplate = {
  id: string
  type:
    | 'product_asset'
    | 'model_asset'
    | 'visual_style'
    | 'platform_rule'
    | 'scene'
    | 'image_recipe'
    | 'brand_kit'
    | 'quality_check'
    | 'output_pack'
  name: string
  description: string
  inputs: ComponentPort[]
  outputs: ComponentPort[]
  parameters: Record<string, unknown>
  constraints: string[]
  promptFragments: string[]
  negativeRules: string[]
  qualityRules: string[]
  compatibleWith: string[]
  source: ComponentSource
  version: number
}
```

## 7. Workflow Model

The workflow graph should be stored independently from the visual canvas.

Canvas state:

- Node position.
- Edge position.
- Viewport.
- Freeform annotations.
- Frames.

Workflow state:

- Semantic node type.
- Component references.
- Port connections.
- Execution order.
- Job records.
- Output asset IDs.

Recommended storage:

```ts
type WorkflowGraph = {
  id: string
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  viewport?: CanvasViewport
  createdAt: string
  updatedAt: string
}

type WorkflowNode = {
  id: string
  type: string
  componentId?: string
  data: Record<string, unknown>
  position: { x: number; y: number }
}

type WorkflowEdge = {
  id: string
  source: string
  sourceHandle?: string
  target: string
  targetHandle?: string
}
```

## 8. Generation Architecture

The generation logic should stay outside the canvas UI.

Recommended layers:

1. Canvas UI.
2. Workflow compiler.
3. Planner.
4. Prompt compiler.
5. Provider adapter.
6. Job runner.
7. Artifact store.
8. Quality reviewer.

Provider interface:

```ts
type ImageProviderAdapter = {
  id: string
  capabilities: {
    textToImage: boolean
    imageToImage: boolean
    multiReference: boolean
    maskEdit: boolean
    aspectRatios: string[]
    returnsBase64: boolean
    returnsUrl: boolean
  }
  generate(input: ProviderGenerateInput): Promise<ProviderGenerateResult>
}
```

This gives the project room to change image providers later without changing the canvas or component system.

## 9. Recommended Stack

Core:

- Next.js App Router.
- TypeScript.
- SQLite for local-first state.
- `@xyflow/react` for workflow canvas.
- Zustand or server-backed React state for current canvas session.
- Zod for schema validation.

Optional:

- Excalidraw for annotation/moodboard mode.
- JSZip for export packs.
- Sharp or equivalent for thumbnail generation.
- Object storage later: local folder first, S3/R2/OSS later.

Avoid as core dependencies:

- tldraw, unless license is accepted.
- n8n, because its license is source-available / fair-code rather than clean MIT.
- ComfyUI code, because GPL and too technical; use only as inspiration or external backend integration.

## 10. Database Plan

Add these tables:

- `assets`
- `asset_images`
- `component_templates`
- `workflow_graphs`
- `workflow_versions`
- `generation_jobs`
- `generated_assets`
- `quality_reports`
- `prompt_sources`
- `brand_kits`

Minimum schema direction:

```sql
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE component_templates (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  source_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE workflow_graphs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  graph_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE generation_jobs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL,
  plan_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE generated_assets (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  type TEXT NOT NULL,
  url TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

## 11. First Build Scope

Do not build the entire fusion product in one pass. Build a thin vertical slice.

### V1 Canvas Slice

Goal: one product grows into one image set.

Features:

- `/canvas` route.
- React Flow canvas.
- Left library with mock categories: Products, Styles, Models, Platforms, Output Packs.
- Drag components onto canvas.
- Connect:
  - Product Asset
  - Visual Style
  - Platform Rule
  - Image Set Planner
  - Generate Pack
  - Result Gallery
- Save graph to SQLite.
- Run workflow with existing image generation backend.
- Persist generated results.

### V1 AI Component Factory

Goal: import external prompt into style component.

Features:

- Paste prompt.
- AI extracts visual style fields.
- Show editable component draft.
- Save component to library.
- Drag it into canvas.

### V1 Asset Importer

Goal: turn images into reusable assets.

Features:

- Product image import.
- Model image import.
- AI asset analysis.
- Save as Product Asset or Model Asset.

## 12. UX Layout

Suggested layout:

- Top bar:
  - Project name.
  - Run button.
  - Save status.
  - Export button.
  - View mode switch: Canvas / Runs / Library.

- Left sidebar:
  - Search.
  - Asset categories.
  - Component cards.
  - "Create with AI" button.

- Canvas:
  - Infinite pan/zoom.
  - Nodes.
  - Frames.
  - Generated image cards.
  - Workflow branches.

- Right inspector:
  - Selected node details.
  - Inputs/outputs.
  - Component rules.
  - Prompt preview.
  - Quality report.
  - Regenerate controls.

## 13. Example User Flow

User says:

"I have a coffee machine. I want Taobao main images, Xiaohongshu lifestyle images, and a high-end business model display set."

AI creates:

- Product Asset: Coffee Machine.
- Style Component: Premium Warm Appliance Commercial.
- Platform Rule: Taobao Main Image.
- Platform Rule: Xiaohongshu Cover.
- Model Asset: Business Woman, if selected or generated.
- Output Pack: Commerce Launch Pack.
- Workflow:
  - Product Asset -> Product Analysis.
  - Product Analysis + Style + Platform Rules -> Image Set Planner.
  - Planner + Product Asset + Model Asset -> Generate Pack.
  - Generate Pack -> Quality Review.
  - Quality Review -> Export Pack.

Generated outputs:

- 1 Taobao main image.
- 2 selling point images.
- 2 Xiaohongshu lifestyle covers.
- 1 business model display image.
- 1 website/banner crop.

## 14. Risks

### License Risk

Avoid source-available dependencies for public project foundation. Keep tldraw as reference only.

### Product Complexity

Canvas tools can become too technical. Mitigation: AI generates workflows first; users edit visually after.

### Prompt Drift

Imported prompts can be messy or unsafe. Mitigation: normalize prompts into schema, validate, and never execute raw external prompt by default.

### Asset Consistency

Product and model consistency are hard. Mitigation: store invariants and quality checks as first-class data.

### Job Reliability

Image generation will fail often. Mitigation: persistent jobs, per-image status, retry failed items, provider fallback.

### Overbuilding

Do not build a full whiteboard and full workflow engine at once. Start with semantic nodes and simple freeform annotation later.

## 15. Development Roadmap

### Phase 0: Cleanup

- Remove or quarantine dead `GenerateButton` route usage.
- Add lint script that does not open interactive Next ESLint setup.
- Keep current generation path working.

### Phase 1: Data Foundation

- Add asset and component tables.
- Add workflow graph table.
- Add generation job and generated asset tables.
- Persist result page assets.

### Phase 2: React Flow Canvas

- Install `@xyflow/react`.
- Add `/canvas`.
- Implement node registry.
- Implement typed handles.
- Implement graph save/restore.
- Implement simple workflow run.

### Phase 3: Component Library

- Left sidebar categories.
- Component cards.
- Drag to canvas.
- Component detail inspector.
- Component versioning.

### Phase 4: AI Component Factory

- Prompt importer.
- Product asset importer.
- Model asset importer.
- Style-from-image extractor.
- Component draft editor.

### Phase 5: Image Set Planner

- Output pack templates.
- Platform rules.
- Recipe compiler.
- Prompt compiler.
- Generate pack job.

### Phase 6: Quality and Export

- Quality review nodes.
- Per-image retry.
- Export zip.
- Naming templates.
- History and runs page.

## 16. Final Recommendation

Build the "super fusion" product, but use a clean-license architecture:

- React Flow is the executable canvas.
- Excalidraw is an optional annotation/moodboard layer.
- tldraw is a reference, not a dependency.
- Assets and components are the real product moat.
- AI component generation is the differentiator.
- The canvas should be AI-created first, user-edited second.

The user experience should feel like:

"I bring a product, some assets, or a prompt. The system turns them into reusable components and automatically builds a visual production workflow. I can then move, connect, branch, annotate, generate, review, and export a complete commercial image set."

## 17. Implementation Update: 2026-05-15

### Completed Prototype Slices

- Added a canvas-first route at `/canvas` and redirected `/` to it.
- Added left asset library categories for products, models, styles, platforms, scenes, and quality assets.
- Connected real persisted assets from `/api/assets` and model assets from `/api/models` into the canvas library.
- Added image upload from the canvas library and persisted uploaded product assets into SQLite.
- Added AI component factory via `/api/canvas-components`.
- The component factory uses the configured text model first and falls back to local templates when AI is unavailable.
- Added persistent workflow storage:
  - `workflows` table.
  - `/api/workflows`.
  - `/api/workflows/:id`.
- Added persistent generation job storage:
  - `generation_jobs` table.
  - `/api/jobs`.
  - `/api/jobs/:id`.
- Added right-panel task queue UI.
- Selected canvas nodes can now create generation jobs with a compiled prompt draft and node metadata.
- Added `/api/jobs/:id/run` as the first job runner endpoint.
- The runner can execute a job with the existing image generation function, save the result as an `output` asset, and update the job status/result linkage.
- Replaced the static center canvas with `@xyflow/react`.
- Canvas nodes can now be dragged, manually connected, minimized through the MiniMap, and saved as a full workflow graph.

### Verified

- `npx tsc --noEmit` passed.
- `npm run build` passed.
- Production route `http://localhost:3457/canvas` loaded successfully.
- Browser verification confirmed:
  - canvas loads,
  - saved workflow restores,
  - AI component factory creates canvas nodes,
  - workflow save persists to `/api/workflows`,
  - selected node creates a pending job in `/api/jobs`,
  - task queue renders the new job,
  - runnable pending jobs expose a run action in the right panel,
  - React Flow renders 8 nodes and 8 edges,
  - dragging the product node updates its position,
  - saving persists the updated node position to `/api/workflows`,
  - refreshing restores the dragged position.
- The job runner endpoint was compiled and routed, but was not invoked in browser verification to avoid spending image generation quota during this UI smoke.
- Screenshots:
  - `test_artifacts/canvas-workflow-after-components.png`
  - `test_artifacts/canvas-job-queue.png`
  - `test_artifacts/canvas-react-flow.png`

### Current Persistent Demo Data

- One product asset exists from canvas upload:
  - `asset_1778805177057_af2bd813`
  - title: `上传商品细节图`
- One saved canvas workflow exists:
  - `workflow_1778835125220_5180fc86`
  - nodes: 8
  - edges: 8
  - product node position after React Flow drag verification: `{ x: 131.475, y: 235.35 }`
- One pending generation job exists:
  - `job_1778852539949_6069eb8e`
  - node: `模特风格选择`
  - status: `pending`

### Known Gaps

- Drag and manual connection work, but node creation is still button-driven from the right panel rather than drag-and-drop from the asset library.
- Node deletion, group/frame layout, duplicate/clone, and undo/redo are not implemented yet.
- Edge labels are basic; a full edge inspector or typed handle validation is still missing.
- The first runner exists, but it is still synchronous and should later move to a safer background queue.
- Generated images currently persist as `output` assets; a richer generated-artifact table is still missing.
- Job deletion is not implemented.
- Next build still shows the existing multi-lockfile workspace-root warning.

### Recommended Next Execution Order

1. Add drag-and-drop from the left asset library onto the React Flow canvas.
2. Add a formal component schema:
   - asset component,
   - style component,
   - model component,
   - platform rule component,
   - output pack component,
   - quality rule component.
3. Add typed handles and connection validation so product/style/model/platform/review nodes connect in valid directions.
4. Move `/api/jobs/:id/run` from a synchronous request into a background-safe runner with retries and cancellation.
5. Add generated artifact persistence:
   - image URL/base64 storage strategy,
   - job linkage,
   - node linkage,
   - prompt snapshot,
   - provider response metadata.
6. Add a run/history panel so users can inspect queued, running, failed, and completed jobs.
7. Add quality review nodes that can score product consistency, platform fit, and visual-language consistency.
8. Add export packs for Taobao, Amazon, Xiaohongshu, poster sets, and model display sets.

## 18. Implementation Update: 2026-05-15 Round 2

### Completed

- Left asset cards can now be dragged directly onto the React Flow canvas.
- Dropping an asset creates a canvas node and persists the asset as a reusable component through `/api/components`.
- Added first-class component persistence:
  - `components` table.
  - `component_versions` table.
  - `/api/components`.
  - `/api/components/:id`.
- Added component version snapshots on create/update.
- Added connection rules in `lib/canvas/connection-rules.ts` so product, style, model, scene, platform, output, and review nodes only connect in valid semantic directions.
- Added generated artifact persistence:
  - `generated_artifacts` table.
  - `/api/artifacts`.
  - `/api/artifacts/:id`.
- Updated `/api/jobs/:id/run` so a successful image run can create an output asset and a linked generated artifact.
- Workflow save/restore now keeps dropped asset nodes and their `componentId` linkage.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run build` passed.
- API smoke passed without invoking image generation:
  - component create/list/patch/delete.
  - artifact create/get/patch/delete.
- Browser smoke passed at `http://localhost:3457/canvas`:
  - React Flow restored the saved graph.
  - dragging `细节特写` from the asset library added a new node.
  - the new node persisted a component record.
  - saving updated the workflow from 8 nodes to 9 nodes.
  - reloading restored 9 nodes and 8 edges.
- Screenshot:
  - `test_artifacts/canvas-drag-component-smoke.png`

### Current Persistent Demo Data After Round 2

- One saved canvas workflow:
  - `workflow_1778835125220_5180fc86`
  - nodes: 9
  - edges: 8
- One component created from the dropped asset:
  - `component_1778856853177_24f3cfe2`
  - type: `product`
  - title: `细节特写`
  - assetId: `product-detail`
- Newest workflow node:
  - `asset-node-product-detail-1778856853174-8`
  - label: `细节特写`
  - componentId: `component_1778856853177_24f3cfe2`

### Remaining Gaps

- `workflow_templates` is still not implemented. It should be the next data slice before template catalog UI.
- Typed handles are validated by connection rules, but the handles are not yet visually differentiated by port type.
- Background execution is still missing; `/api/jobs/:id/run` remains request-bound.
- Generated artifacts persist through the API, but the right panel does not yet show artifact cards/history.
- Component creation from natural language is still a canvas-node factory, not a full schema-normalized component editor.
- Node deletion, duplicate, undo/redo, grouping, and frame sections are still missing.
- Next build still shows the existing multi-lockfile workspace-root warning.

### Next Execution Order

1. Add `workflow_templates` table/API and seed templates for model display, product detail page, platform output pack, poster set, and quality review.
2. Add visual typed ports and edge labels for product/style/model/scene/platform/output/review flows.
3. Add node deletion, duplicate, and undo/redo for the canvas.
4. Add artifact history in the right inspector and link completed jobs back to visible output nodes.
5. Move generation runs to a background-safe runner with retry/cancel states.
6. Add a component editor that can normalize imported prompts, product parameters, model references, and style rules into reusable components.
7. Add output-pack templates for Taobao, Amazon, Xiaohongshu, poster sets, model display sets, and website hero crops.
8. Add quality-review nodes for product consistency, platform compliance, and unified visual-language scoring.

## 19. Implementation Update: 2026-05-15 Round 3

### Completed

- Added workflow template persistence:
  - `workflow_templates` table.
  - `/api/workflow-templates`.
  - `/api/workflow-templates/:id`.
- Added 5 default seeded workflow templates:
  - `model_display`
  - `product_detail_page`
  - `platform_output_pack`
  - `poster_set`
  - `quality_review`
- Added visual typed ports on canvas nodes:
  - semantic node badge and color strip.
  - semantic input/output handle colors.
  - `semantic-port--*` class names for future validation states.
  - `title` and `aria-label` on handles.
- Expanded connection semantics with `factory` nodes so product-to-factory and factory-to-output/platform/review flows are valid.
- Added baseline canvas editing controls:
  - undo.
  - redo.
  - duplicate selected node.
  - delete selected node.
  - keyboard shortcuts for undo/redo, duplicate, and delete.
- Kept the work split clean:
  - workflow-template worker touched backend/API only.
  - typed-port worker touched node/connection visuals only.
  - main thread touched canvas editing UI/state only.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run build` passed.
- Production server restarted at `http://localhost:3457/canvas`.
- Workflow-template API smoke passed:
  - seeded 5 templates.
  - category/status filtering works.
  - create/get/patch/delete works.
  - patch increments version from 1 to 2 when no explicit version is provided.
- Browser smoke passed:
  - canvas restored 9 nodes and 8 edges.
  - semantic node count: 9.
  - semantic handle count: 18.
  - duplicate selected node: 9 -> 10 nodes, 8 edges preserved.
  - delete selected duplicate: 10 -> 9 nodes, 8 edges preserved.
  - undo delete: 9 -> 10 nodes.
  - undo duplicate: 10 -> 9 nodes.
- Screenshots:
  - `test_artifacts/typed-ports-visual-polish-final.png`
  - `test_artifacts/canvas-drag-component-smoke.png`

### Current State After Round 3

- Primary demo URL:
  - `http://localhost:3457/canvas`
- Saved workflow:
  - `workflow_1778835125220_5180fc86`
  - nodes: 9
  - edges: 8
- Workflow template seeds:
  - 5 published defaults are present after first `/api/workflow-templates` read.
- The app still avoids real image generation during smoke checks unless explicitly requested.

### Remaining Gaps

- Workflow templates exist in the API but are not yet visible in the right panel or asset library.
- Artifact history exists in the API but is not yet shown as canvas output cards.
- Edge strokes and markers are still mostly one color; semantic edge coloring is a good next polish step.
- Dragging an edge does not yet show live valid/invalid target feedback.
- The generation runner is still request-bound and should become a background-safe queue.
- Grouping, frames, canvas sections, and export-pack UI are still missing.

### Next Execution Order

1. Add a template gallery in the right panel and allow applying a workflow template onto the canvas.
2. Add artifact history/output cards and link completed jobs back to output nodes.
3. Add semantic edge coloring and live connection validation feedback while dragging.
4. Move `/api/jobs/:id/run` to a background-safe runner with retry/cancel.
5. Add template-driven output packs for Taobao, Amazon, Xiaohongshu, poster sets, model display sets, and website hero crops.
6. Add quality-review UI for product consistency, platform compliance, and unified visual-language scoring.

## 20. Implementation Update: 2026-05-15 Round 4

### Completed

- Added a right-panel workflow template gallery.
- The gallery reads published templates from `/api/workflow-templates?status=published`.
- Each template card shows:
  - template title.
  - localized category label.
  - node count.
  - version.
  - description.
- Clicking a template instantiates it on the current canvas:
  - template node IDs are namespaced to avoid collisions.
  - template edges are remapped to the new node IDs.
  - template nodes keep semantic data for typed ports.
  - applied nodes include `templateId`, `templateNodeId`, and `source: workflow-template`.
- Applying a template is undoable through the canvas history stack.
- Applied templates can be saved into the existing workflow and restored after refresh.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run build` passed.
- Production server restarted at `http://localhost:3457/canvas`.
- Browser smoke passed:
  - template panel is visible.
  - 5 published templates render in the right panel.
  - applying `Model Display Set` changes the canvas from 9 nodes to 12 nodes.
  - semantic handle count changes from 18 to 24.
  - saving persists the applied template.
  - refreshing restores 12 nodes and 10 edges.
- API check passed:
  - saved workflow: `workflow_1778835125220_5180fc86`.
  - nodes: 12.
  - edges: 10.
  - template count: 5.
- Screenshot capture through the browser tool timed out in this round after fonts loaded; DOM/API/browser interaction checks still passed. Previous visual proof remains:
  - `test_artifacts/typed-ports-visual-polish-final.png`
  - `test_artifacts/canvas-drag-component-smoke.png`

### Current State After Round 4

- Primary demo URL:
  - `http://localhost:3457/canvas`
- Saved workflow:
  - `workflow_1778835125220_5180fc86`
  - nodes: 12
  - edges: 10
- The applied template added the `Model Display Set` chain.

### Remaining Gaps

- Applying a template appends it to the right of the existing graph; there is not yet an auto-fit animation after insertion.
- Template cards are shown in a simple list; category filtering and search are still missing.
- Artifact history/output cards are still not shown in the right panel.
- Edge coloring and live valid/invalid connection feedback are still missing.
- Background-safe job execution is still not implemented.

### Next Execution Order

1. Add artifact history/output cards in the right panel and link completed jobs back to output nodes.
2. Add auto-fit or focus behavior after applying a template.
3. Add template category filters and search.
4. Add semantic edge coloring and live connection validation feedback.
5. Move generation runs to a background-safe runner with retry/cancel states.

## 21. Implementation Update: 2026-05-15 Round 5

### Completed

- Added a right-panel output artifact section.
- The panel reads generated artifacts from `/api/artifacts`, scoped to the current workflow when a workflow is loaded.
- Artifact cards show:
  - generated image preview.
  - title.
  - status.
  - linked node id.
  - created time.
- Clicking an artifact card selects the linked canvas node when `nodeId` exists in the current graph.
- Linked nodes are enriched from artifact history:
  - preview image is updated from the artifact URL.
  - metrics include `已生成产物`.
  - `artifactId`, `artifactStatus`, and `artifactCreatedAt` are added to node data.
- The inspector now shows a compact `最近产物` preview when the selected node has linked artifacts.
- Running a job now immediately inserts the returned artifact into the UI state and selects the linked node.
- Added a non-provider demo artifact for UI verification:
  - `artifact_1778859136175_2c841233`
  - title: `模特展示图 Demo 输出`
  - nodeId: `model`

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run build` passed.
- Production server restarted at `http://localhost:3457/canvas`.
- API check passed:
  - saved workflow: `workflow_1778835125220_5180fc86`.
  - nodes: 12.
  - edges: 10.
  - artifact count: 1.
- Browser smoke passed:
  - output artifact panel is visible.
  - `模特展示图 Demo 输出` appears in the right panel.
  - `模特展示图` node shows `已生成产物`.
  - artifact preview image renders from a data URL.
  - clicking the artifact card selects `模特展示图`.
  - selected inspector shows `最近产物`.
- No real image-generation provider call was made in this round.

### Current State After Round 5

- Primary demo URL:
  - `http://localhost:3457/canvas`
- Saved workflow:
  - `workflow_1778835125220_5180fc86`
  - nodes: 12
  - edges: 10
- Visible artifact:
  - `artifact_1778859136175_2c841233`
  - `模特展示图 Demo 输出`
  - linked node: `model`

### Remaining Gaps

- The artifact panel is a simple recent list; filtering by status/node/template is still missing.
- Generated artifacts are linked to nodes, but output nodes are not yet auto-created when a job returns.
- The job runner is still request-bound and should move to a background-safe queue.
- Export pack UI is still missing.

### Next Execution Order

1. Add artifact filters and node-scoped history tabs.
2. Add auto-created output/result nodes when a job completes.
3. Add export-pack UI for Taobao, Amazon, Xiaohongshu, poster sets, model display sets, and website hero crops.
4. Move generation runs to a background-safe runner with retry/cancel states.

## 22. Implementation Update: 2026-05-15 Round 6

### Completed

- Completed the artifact-to-result-node loop.
- Generated artifacts now synthesize a dedicated canvas output node:
  - id pattern: `artifact-node-{artifactId}`.
  - node kind: `output`.
  - preview image comes from the artifact URL.
  - source data keeps `artifactId`, `jobId`, `assetId`, `linkedNodeId`, status, and created time.
- The source node remains enriched with artifact history:
  - preview image.
  - `已生成产物` metric.
  - artifact status metadata.
- Each synthesized result node gets a source-to-output edge:
  - id pattern: `artifact-edge-{sourceNodeId}-{artifactId}`.
  - label: `输出产物`.
- Clicking an artifact history card now prefers the generated result node when it exists, instead of only selecting the source node.
- Artifact reconciliation is idempotent:
  - refresh restores the artifact node from history.
  - saved workflows that already contain the result node do not create duplicates.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run build` passed.
- Production server restarted at `http://localhost:3457/canvas`.
- Browser smoke passed:
  - visible React Flow nodes: 13.
  - visible React Flow edges: 11.
  - `模特展示图 Demo 输出` is visible as an output node.
  - `模特展示图` source node still shows `已生成产物`.
  - `输出产物` edge label is visible.
  - clicking the artifact card selects `artifact-node-artifact_1778859136175_2c841233`.
  - inspector still shows `最近产物`.
  - page refresh keeps 13 nodes / 11 edges, with no duplicate result node.
- API check passed after save:
  - workflow: `workflow_1778835125220_5180fc86`.
  - nodes: 13.
  - edges: 11.
  - artifact result nodes: 1.
  - artifact result edges: 1.
  - artifact count: 1.
- No real image-generation provider call was made in this round.

### Current State After Round 6

- Primary demo URL:
  - `http://localhost:3457/canvas`
- Saved workflow:
  - `workflow_1778835125220_5180fc86`
  - nodes: 13
  - edges: 11
- Visible artifact:
  - `artifact_1778859136175_2c841233`
  - `模特展示图 Demo 输出`
  - linked source node: `model`
  - synthesized output node: `artifact-node-artifact_1778859136175_2c841233`

### Remaining Gaps

- Artifact history still needs filters by status, source node, template, and output type.
- Export pack UI is still missing.
- The job runner is still request-bound and should move to a background-safe queue with retry/cancel states.
- Result-node placement is deterministic but basic; auto-fit/focus and smarter layout around the source node would make it feel more intentional.

### Next Execution Order

1. Add artifact filters and node-scoped history tabs.
2. Add export-pack UI for Taobao, Amazon, Xiaohongshu, poster sets, model display sets, and website hero crops.
3. Add auto-fit/focus behavior after artifact node creation and template insertion.
4. Move generation runs to a background-safe runner with retry/cancel states.

## 23. Implementation Update: 2026-05-16 Round 7

### Completed

- Fixed artifact result node deletion semantics.
- Deleted artifact-history result nodes are now tracked with `hiddenArtifactNodeIds`.
- Hidden artifact result nodes are skipped during artifact reconciliation instead of being immediately re-created.
- Hidden result-node state is included in undo/redo snapshots.
- Hidden result-node state is saved to workflow metadata and restored on page load.
- Job loading is now workflow-scoped:
  - with a loaded workflow, the canvas requests `/api/jobs?workflowId={workflowId}`.
  - without a workflow id, the demo-friendly fallback still loads all jobs.
- Added local generated-image storage for new job outputs:
  - inline base64/data URL results are written under `.data/generated/`.
  - stored images are served by `/api/generated-images/{file}`.
  - `asset.url`, `artifact.url`, and `job.resultUrl` now use the public generated-image URL for new job outputs.
  - storage metadata is recorded on assets, artifacts, and jobs.
- Added a prototype background-safe job runner:
  - `startGenerationJob(jobId)` uses an in-memory running-job guard.
  - `/api/jobs/{id}/run` now starts work and returns quickly with `queued/started`.
  - image generation, local storage, asset creation, artifact creation, and job completion happen asynchronously.
  - completed jobs return existing artifact/asset instead of generating again.
- The canvas no longer treats a started background job as completed.
- Running jobs are polled every 2.5 seconds while active so completed artifacts can auto-fill the canvas.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run build` passed.
- Production server restarted at `http://localhost:3457/canvas`.
- Browser smoke passed:
  - visible React Flow nodes: 13.
  - visible React Flow edges: 11.
  - output result node remains visible.
  - job count remains workflow-scoped.
  - artifact count remains workflow-scoped.
- Artifact deletion smoke passed:
  - deleting `artifact-node-artifact_1778859136175_2c841233` reduced the canvas to 12 nodes / 10 edges.
  - the result node was not immediately re-created by artifact history.
  - saving and reloading preserved the hidden state.
  - the demo workflow was restored back to 13 nodes / 11 edges after the smoke.
- Job scope API check passed:
  - `/api/jobs?workflowId=workflow_1778835125220_5180fc86` returned 1 job.
  - `/api/jobs?workflowId=workflow_nonexistent_scope_smoke` returned 0 jobs.
- Generated-image route check passed:
  - valid generated file returned `200 image/png`.
  - path traversal attempt returned `404`.
- No real image-generation provider call was made in this round.

### Current State After Round 7

- Primary demo URL:
  - `http://localhost:3457/canvas`
- Saved workflow:
  - `workflow_1778835125220_5180fc86`
  - nodes: 13
  - edges: 11
  - hidden artifact result nodes: none
- Existing demo artifact:
  - `artifact_1778859136175_2c841233`
  - still uses its old data URL because no data migration was performed.
- New future job outputs:
  - use `/api/generated-images/{file}` when the provider returns inline/base64 image data.

### Remaining Gaps

- Artifact history still needs real filters by status, source node, template, and output type.
- Export pack UI is still missing.
- The background runner is local-process only; a production deployment still needs a durable queue.
- New local image files do not yet have cleanup, retention, or migration tooling.
- Result-node placement is still deterministic and basic.

### Next Execution Order

1. Add artifact filters and node-scoped history tabs.
2. Add export-pack UI for Taobao, Amazon, Xiaohongshu, poster sets, model display sets, and website hero crops.
3. Add auto-fit/focus behavior after artifact node creation and template insertion.
4. Add durable queue/retention controls when moving beyond the local prototype.

## 24. Implementation Update: 2026-05-16 Round 8

### Completed

- Upgraded the right-panel artifact history into a filtered output workbench.
- Added artifact scope filtering:
  - all artifacts.
  - artifacts linked to the currently selected node.
- Current-node matching now supports:
  - `artifact.nodeId`.
  - synthesized artifact result node id.
  - selected node `artifactId`.
  - selected node `linkedNodeId`.
  - selected node `jobId`.
  - selected node `assetId`.
- Added artifact status filtering:
  - all.
  - completed.
  - running.
  - failed.
  - draft or queued.
- Added artifact type filtering:
  - dynamic types from current artifacts.
  - fallback options for `image` and `output_pack`.
- Artifact list now shows up to 8 filtered items in a scrollable area instead of a fixed recent 4.
- Empty states now distinguish:
  - no artifacts exist.
  - current filters have no matching artifacts.
- Existing artifact click behavior is preserved and still locates the result/source node.

### Verified In This Round

- `npm run build` passed.
- `npx tsc --noEmit` passed after the build regenerated `.next/types`.
- Production server restarted at `http://localhost:3457/canvas`.
- Browser smoke passed:
  - artifact panel shows `1/1`.
  - Scope, Status, and Type filters are present.
  - `Scope=当前节点` keeps the linked demo artifact visible.
  - `Status=失败` shows `当前筛选无产物` and `0/1`.
  - `Status=完成` restores the demo artifact and `1/1`.
  - clicking the artifact still selects `artifact-node-artifact_1778859136175_2c841233`.
- No real image-generation provider call was made in this round.

### Current State After Round 8

- Primary demo URL:
  - `http://localhost:3457/canvas`
- Saved workflow:
  - `workflow_1778835125220_5180fc86`
  - nodes: 13
  - edges: 11
- Right panel now supports:
  - task queue.
  - artifact filters.
  - workflow templates.
  - AI component factory.

### Remaining Gaps

- Export pack UI is still missing.
- Result-node auto-fit/focus is still missing.
- The local background runner still needs durable production queue semantics before deployment.
- Local generated-image retention and cleanup are still missing.

### Next Execution Order

1. Add export-pack UI for Taobao, Amazon, Xiaohongshu, poster sets, model display sets, and website hero crops.
2. Add auto-fit/focus behavior after artifact node creation and template insertion.
3. Add durable queue/retention controls when moving beyond the local prototype.
4. Refresh README and open-source demo docs.

## 28. Implementation Update: 2026-05-16 Round 12

### Completed

- Added a dry-run-first maintenance script for `.data/generated/`.
- The cleanup tool scans local generated files and preserves anything referenced by:
  - `assets.url`.
  - `assets.metadata`.
  - `generated_artifacts.url`.
  - `generated_artifacts.metadata`.
  - `generation_jobs.resultUrl`.
  - `generation_jobs.metadata`.
- Unsafe filenames that do not match the generated-image route naming rule are reported but never deleted.
- Added npm scripts for dry-run and delete mode:
  - `npm run generated:cleanup`.
  - `npm run generated:cleanup:delete`.

### Safety Defaults

- The command defaults to dry-run mode.
- `--delete` is required for deletion.
- `--max-age-days` defaults to `0`, so all safe orphan files are eligible unless a retention age is provided.

## 25. Implementation Update: 2026-05-16 Round 9

### Completed

- Added an export-pack rule catalog in `lib/canvas/export-pack-rules.ts`.
- The current catalog includes six commercial output packs:
  - Taobao detail page.
  - Amazon main image pack.
  - Xiaohongshu image post.
  - Poster set.
  - Model display set.
  - Detail page module set.
- Each pack now carries two layers of structure:
  - `items`: semantic deliverables for future low-code orchestration.
  - `specs`: concrete size, ratio, count, naming, model/text/white-background, and quality rules.
- Added a right-panel export-pack section in the canvas inspector.
- Clicking an export pack creates a semantic `output/platform` node on the canvas.
- Export-pack nodes persist metadata for later generation logic:
  - `exportPackId`.
  - `exportItems`.
  - `exportSpecs`.
  - `platform`.
  - `useCase`.
  - `qualityRules`.
- New export-pack nodes connect to the selected compatible node when possible, otherwise fall back to the latest compatible canvas node.
- Export-pack creation is included in undo/redo history.

### Verified In This Round

- `npm run build` passed.
- `npx tsc --noEmit` passed.
- Browser smoke ran against `http://localhost:3458/canvas` because `3457` was already occupied:
  - initial React Flow nodes: 13.
  - initial React Flow edges: 11.
  - the export-pack panel is visible.
  - clicking `淘宝详情页` creates a new export-pack node.
  - React Flow nodes increased to 14.
  - React Flow edges increased to 12.
  - the creation message `已创建导出包：淘宝详情页` appears.
- No real image-generation provider call was made in this round.

### Current State After Round 9

- The right panel now supports:
  - task queue.
  - artifact filters.
  - export packs.
  - workflow templates.
  - AI component factory.
- Export packs are currently planning/metadata nodes only; they do not yet call a provider.

## 26. Implementation Update: 2026-05-16 Round 10

### Completed

- Added a lightweight canvas focus request mechanism in `components/canvas/visual-workbench.tsx`.
- Focus requests are intentionally kept out of undo/redo snapshots.
- `CanvasStage` now uses React Flow `fitView` for newly created or recovered nodes.
- Focus behavior is now wired into:
  - workflow template application.
  - export-pack creation.
  - artifact run results.
  - artifact-history selection and recovery.
  - asset drag/drop.
  - AI component factory output.
- Focus waits briefly for React Flow to mount the node, then retries a few times before silently skipping missing nodes.
- Hidden artifact result nodes can now be recovered from artifact history by clicking the artifact again.

### Verified In This Round

- `npm run build` passed.
- `npx tsc --noEmit` passed.
- Browser smoke ran against `http://localhost:3458/canvas`:
  - before creating an export pack: 13 nodes / 11 edges.
  - after clicking `淘宝详情页`: 14 nodes / 12 edges.
  - the new export-pack node is selected.
  - the React Flow viewport transform changed from the initial fit to the focused node view.
- The local `3458` validation server was stopped after the smoke test.
- No real image-generation provider call was made in this round.

### Current State After Round 10

- Primary demo server from the earlier round is still expected on:
  - `http://localhost:3457/canvas`
- Current saved demo workflow remains:
  - `workflow_1778835125220_5180fc86`
  - saved baseline: 13 nodes / 11 edges.
- Unsaved export-pack smoke changes were only browser-session validation changes.

### Remaining Gaps

- Durable queue semantics are still missing:
  - current background runner is local-process only.
  - no persisted retry/cancel lease state yet.
  - no multi-process worker recovery yet.
- Local generated-image lifecycle is still missing:
  - no retention policy.
  - no cleanup command.
  - no migration path for older data-url artifacts.
- Export packs are not yet executable:
  - pack `items` are not expanded into individual generation jobs.
  - platform-specific QA is stored as metadata but not enforced.
  - export packaging/download is still missing.
- README/open-source demo docs need a refresh to match the canvas/workflow direction.
- The platform rules are practical starter defaults, not a legally exhaustive compliance source.

### Next Execution Order

1. Add durable job state for background runs:
   - persisted `queued/running/completed/failed/cancelled` transitions.
   - retry count and last error.
   - cancel endpoint or cancel action.
2. Add local generated-image retention tooling:
   - list stored generated files.
   - identify orphaned files.
   - dry-run cleanup.
3. Make export packs executable:
   - expand pack `items` into job batches.
   - attach generated artifacts back to the pack node.
   - expose basic export/download manifest.
4. Add platform QA checks:
   - validate expected count, ratio, text allowance, white-background requirement, and required model/product assets.
5. Refresh README and demo docs:
   - explain MIT-safe React Flow direction.
   - explain local setup, canvas demo, and non-commercial/provider caveats.

## 27. Implementation Update: 2026-05-16 Round 11

### Completed

- Added a persistent job lifecycle helper in `lib/store/job-lifecycle.ts`.
- The canonical job status set is now documented in code:
  - `pending`.
  - `queued`.
  - `running`.
  - `done`.
  - `completed`.
  - `failed`.
  - `cancelled`.
- Job lifecycle metadata now tracks:
  - `queuedAt`.
  - `startedAt`.
  - `startCount`.
  - `attempt`.
  - `lastRunId`.
  - `completedAt`.
  - `failedAt`.
  - `cancelledAt`.
  - `cancelReason`.
  - `retryCount`.
  - `retriedAt`.
- The background runner now persists `queued` before local execution begins.
- The runner prevents duplicate starts for `queued`, `running`, and completed jobs.
- The runner checks latest job state during the async generation path so a cancelled job does not get overwritten to `done` or `failed`.
- Added cancel and retry endpoints:
  - `POST /api/jobs/[id]/cancel`.
  - `POST /api/jobs/[id]/retry`.
- Run endpoint behavior is stricter:
  - completed jobs return existing artifact/asset data.
  - queued/running jobs return already-running semantics.
  - failed/cancelled jobs must be retried before running again.
- The right-panel task queue now has:
  - run for pending jobs.
  - cancel for pending/queued/running jobs.
  - retry for failed/cancelled jobs.
  - clearer captions for failed/cancelled/queued/running states.

### Verified In This Round

- `npm run build` passed.
- `npx tsc --noEmit` passed.
- API smoke ran against `http://localhost:3458` without invoking the real generation provider:
  - missing job cancel returned `404`.
  - pending job cancel returned `200` and `status=cancelled`.
  - cancelled job retry returned `200` and `status=pending`.
  - pending job retry returned `409`.
  - done job cancel returned `409`.
  - failed job retry returned `200` and `status=pending`.
- Smoke-created temporary jobs were removed from the SQLite DB after validation.
- The local `3458` validation server was stopped after the smoke test.

### Current State After Round 11

- Local job execution is still an in-process prototype, but job lifecycle state is now persisted and visible through APIs.
- Users can cancel and retry jobs from the canvas task queue.
- No destructive DB migration was introduced; lifecycle state is carried in existing job metadata.

### Remaining Gaps

- The runner still cannot truly abort an in-flight provider HTTP request.
- A cancelled job may still leave an orphaned local generated file if cancellation happens after file write and before the next cancellation check.
- There is no cleanup/retention command for `.data/generated` yet.
- There is no separate durable worker process or queue backend yet.
- Export packs still do not expand into executable batch jobs.

### Next Execution Order

1. Add generated-file retention and cleanup tooling:
   - list generated files.
   - detect orphaned files.
   - dry-run cleanup.
   - optional delete mode.
2. Make export packs executable as batch job planners.
3. Add platform QA checks and pack-level status summaries.
4. Refresh README and open-source demo docs.

## 28. Implementation Update: 2026-05-16 Round 12

### Completed

- Added local generated-file maintenance tooling in `scripts/cleanup-generated-files.mjs`.
- Added package scripts:
  - `npm run generated:cleanup`.
  - `npm run generated:cleanup:delete`.
- The cleanup script scans `.data/generated/`.
- The script reads SQLite references from:
  - `assets.url`.
  - `assets.metadata`.
  - `generated_artifacts.url`.
  - `generated_artifacts.metadata`.
  - `generation_jobs.resultUrl`.
  - `generation_jobs.metadata`.
- Referenced files are kept.
- Safe orphan files are listed as deletable.
- Unsafe filenames are skipped and never deleted.
- The default mode is dry-run JSON output.
- `--delete` is required for actual deletion.
- `--max-age-days N` can delay deletion until orphan files are old enough.

### Verified In This Round

- `node scripts/cleanup-generated-files.mjs --json` passed with the current empty generated-file directory.
- Targeted cleanup smoke passed:
  - temporary DB-referenced generated file was preserved.
  - temporary safe orphan file was deleted only in `--delete` mode.
  - temporary unsafe file was skipped and not deleted by the script.
  - temporary DB row and files were cleaned after the smoke.
- Worker verification also covered:
  - `npm run generated:cleanup`.
  - `npm run build`.
  - `npx tsc --noEmit`.

### Current State After Round 12

- Local generated-image storage now has a maintenance path.
- The cancellation race from Round 11 is no longer dangerous long-term because orphan files can be detected and cleaned with a dry-run-first tool.
- `.data/generated/` currently has no real generated files in this workspace snapshot.

### Remaining Gaps

- Export packs are still planning nodes only.
- Pack `items` do not yet expand into concrete job batches.
- Pack-level progress, artifact grouping, manifest/export, and QA summary are still missing.
- Platform QA rules are stored but not enforced.
- README still describes the older simple product-image generator more than the current canvas/workflow product.

### Next Execution Order

1. Make export packs executable as batch job planners.
2. Add pack-level artifact grouping and output manifest.
3. Add platform QA checks and pack status summaries.
4. Refresh README/open-source demo docs.

## 29. Implementation Update: 2026-05-16 Round 13

### Completed

- Added `lib/canvas/export-pack-planner.ts`.
- Export-pack nodes can now be identified as batch-planning nodes.
- Export-pack `items` and `specs` are normalized before planning.
- `spec.count` now expands into multiple pending generation jobs.
- Each planned job carries batch metadata:
  - `batchId`.
  - `batchIndex`.
  - `batchTotal`.
  - `batchJobTitle`.
  - `batchCaption`.
  - `exportPackId`.
  - `exportPackTitle`.
  - `exportItemId`.
  - `exportSpecId`.
  - `platform`.
  - `size`.
  - `ratio`.
  - `naming`.
  - `qualityRules`.
- `handleCreateJobForNode` now branches:
  - normal nodes create one pending job.
  - export-pack nodes create a pending batch.
- The inspector button changes to `规划导出包任务` when an export-pack node is selected.
- Task queue labels now prefer `batchJobTitle`.
- Task queue captions now show pack progress such as `导出包 1/6 · 800x800`.
- No real image-generation run is triggered by the planner.

### Verified In This Round

- `npm run build` passed.
- `npx tsc --noEmit` passed.
- DB/API smoke confirmed the latest Taobao export-pack batch:
  - `batch_1778867721799_efbcc641`.
  - job count: 6.
  - status set: `pending`.
  - no `queuedAt`, `startedAt`, or `completedAt` run signals.
  - sample job caption: `导出包 6/6 · 750x1200`.

### Current State After Round 13

- Export packs can now plan concrete job batches.
- The demo DB currently contains one visible Taobao pending batch created during smoke validation.
- Batch jobs are still not grouped into a pack-level status UI beyond the task queue labels/captions.

### Remaining Gaps

- Pack-level progress summaries are missing.
- Pack-level manifest/export is missing.
- Platform QA checks are not enforced yet.
- Batch jobs do not yet auto-link generated artifacts back into a pack manifest.
- README still needs to be updated for the canvas/workflow direction.

### Next Execution Order

1. Add pack-level QA/progress summaries.
2. Add output manifest and artifact grouping for batches.
3. Add README/open-source demo documentation refresh.

## 30. Implementation Update: 2026-05-16 Round 14

### Completed

- Added `lib/canvas/export-pack-summary.ts`.
- Batch jobs are grouped by `metadata.batchId`.
- Each export-pack batch summary includes:
  - title.
  - platform.
  - total jobs.
  - pending count.
  - queued/running count.
  - completed count.
  - failed count.
  - cancelled count.
  - progress label.
  - status label.
  - size summary.
  - quality rules.
  - QA checklist.
  - QA gaps.
- Added a right-panel `导出包批次` section above the task queue.
- The panel shows up to three recent batches.
- When an export-pack node is selected, related batches are prioritized.
- Clicking a batch updates a lightweight message only; it does not run jobs.
- Basic QA readiness now flags:
  - missing model asset when a pack requires a model.
  - white-background requirements.
  - text allowance.
  - ratio and size requirements.
  - first quality rules from the pack metadata.

### Verified In This Round

- `npm run build` passed.
- `npx tsc --noEmit` passed.
- DB smoke confirmed the latest Taobao batch:
  - total jobs: 6.
  - pending jobs: 6.
  - completed jobs: 0.
  - platform: `taobao`.
  - sizes: `750x1200`, `800x800`.
- Browser smoke against `http://localhost:3458/canvas` confirmed:
  - `导出包批次` is visible.
  - `0/6 完成` is visible.
  - `6 pending/排队` is visible.
  - platform and size summaries are visible.
  - QA chips such as `白底要求` and `允许文字` are visible.
  - no run/start message appeared.
- The local `3458` validation server was stopped after the smoke test.

### Current State After Round 14

- Export packs now have a visible planning loop:
  - create export-pack node.
  - plan pending jobs from pack specs.
  - view pack-level progress and QA readiness.
- No real image-generation provider call is required for this loop.

### Remaining Gaps

- Output manifest/download for a completed batch is still missing.
- Generated artifacts are not yet grouped into a pack-level manifest.
- QA checks are still readiness/checklist checks, not image-level validation.
- README/open-source demo docs still need to describe the new canvas workflow.

### Next Execution Order

1. Add batch output manifest and artifact grouping.
2. Refresh README/open-source demo documentation.
3. Later: add real image-level QA checks after generation outputs exist.

## 31. Implementation Update: 2026-05-16 Round 15

### Completed

- Added `lib/canvas/export-pack-manifest.ts`.
- Batch jobs now have a manifest grouping layer.
- The manifest groups jobs and generated artifacts by `batchId`.
- Each manifest item tracks:
  - job id.
  - job status.
  - title.
  - naming.
  - size.
  - ratio.
  - export spec id.
  - artifact id, URL, and status when available.
- Manifest counts include:
  - planned.
  - completed.
  - failed.
  - missing artifact.
- The `导出包批次` panel now displays:
  - planned/ready manifest summary.
  - first naming hint such as `taobao_main_01`.
- Clicking a batch now includes manifest readiness in the message:
  - `Manifest: 0/6 artifacts ready`.

### Verified In This Round

- `npm run build` passed.
- `npx tsc --noEmit` passed.
- DB smoke confirmed:
  - latest batch: `batch_1778867721799_efbcc641`.
  - planned pending jobs: 6.
  - artifact matches: 0.
  - naming metadata is present.
- No real image-generation provider call was made.

### Current State After Round 15

- The export-pack loop now covers:
  - rule catalog.
  - canvas node creation.
  - batch job planning.
  - batch progress summary.
  - QA readiness summary.
  - output manifest readiness.
- This is now a coherent demo loop without requiring real image generation.

### Remaining Gaps

- Real generated artifacts need to write batch metadata back into artifact metadata for stronger manifest matching.
- Download/export packaging is still missing.
- Image-level QA validation is still missing.
- README/open-source demo docs were refreshed after this round.

## 32. Implementation Update: 2026-05-16 Round 16

### Completed

- Refreshed `README.md` for the current canvas/workflow product direction.
- README now describes:
  - local-first commercial image production workbench positioning.
  - `/canvas` as the primary route.
  - asset library, inspector, export packs, batch summaries, manifest readiness, and job lifecycle.
  - provider-safe planning flow that does not require real image generation until a job is run.
  - generated-file cleanup commands.
  - open-source notes around React Flow, local data, and practical platform-rule caveats.

### Verified In This Round

- `npm run build` passed.
- `npx tsc --noEmit` passed.

### Current State After Round 16

- The project now has a coherent no-provider demo loop:
  - open `/canvas`.
  - create an export-pack node.
  - plan a batch.
  - view progress, QA readiness, and manifest readiness.
  - cancel/retry jobs if needed.
  - clean generated local files with dry-run tooling.

### Remaining Gaps

- Real generated artifacts should copy batch metadata into artifact metadata for exact manifest matching.
- Export/download packaging is still missing.
- Image-level QA validation is still missing.
- The old `/` and `/result` flows still exist and are less aligned with the new canvas-first product.

### Next Execution Order

1. Persist batch metadata into generated artifacts during job completion.
2. Add a lightweight manifest export endpoint or JSON download.
3. Add image-level QA after real generated outputs exist.
4. Decide whether to retire, redirect, or modernize the older `/` and `/result` flows.

## 33. Implementation Update: 2026-05-16 Round 17

### Completed

- Updated `lib/store/job-runner.ts` so completed batch jobs copy export-pack metadata into output assets and generated artifacts.
- Batch metadata now includes:
  - `batchId`.
  - `batchIndex`.
  - `batchTotal`.
  - `exportPackId`.
  - `exportPackTitle`.
  - `exportItemId`.
  - `exportItemTitle`.
  - `exportSpecId`.
  - `exportSpecTitle`.
  - `platform`.
  - `size`.
  - `ratio`.
  - `naming`.
  - `qualityRules`.
  - `useCase`.
  - `whiteBackground`.
  - `textAllowed`.
  - `modelRequired`.
- Normal non-batch jobs remain unchanged because metadata extraction only activates for strong batch markers.

### Verified In This Round

- `npm run build` passed.
- `npx tsc --noEmit` passed.
- Static smoke confirmed the runner includes batch metadata in asset, artifact, and completed-job metadata paths.
- No real provider call was made.

## 34. Implementation Update: 2026-05-16 Round 18

### Completed

- Added `GET /api/export-packs/[batchId]/manifest`.
- The endpoint reads jobs and artifacts, builds export-pack manifests, and returns the requested batch manifest.
- `?download=1` returns the same JSON with a `Content-Disposition` attachment header.
- Missing batches return `404`.
- The `导出包批次` card now includes a `JSON` button for manifest download.
- The JSON button stops event propagation so it does not also select the batch card.

### Verified In This Round

- `npm run build` passed.
- `npx tsc --noEmit` passed.
- API smoke against `http://localhost:3458` confirmed:
  - existing batch manifest returned `200`.
  - manifest items count was `6`.
  - missing batch returned `404`.
  - `download=1` returned a `Content-Disposition` attachment header.

## 35. Implementation Update: 2026-05-16 Round 19

### Completed

- Updated the old root route:
  - `/` now redirects to `/canvas`.
- Kept `/result` available for legacy in-session generated results.
- Updated `/result` empty state to send users back to the canvas workflow.
- Updated README route notes for the canvas-first entry behavior.

### Verified In This Round

- `npm run build` passed.
- `npx tsc --noEmit` passed.
- Browser smoke against `http://localhost:3458` confirmed:
  - `/` redirects to `/canvas`.
  - `/canvas` shows the canvas workbench and manifest JSON button.
  - `/result` empty state says the result page has moved to the canvas workflow.
- The local `3458` validation server was stopped after smoke testing.

### Current State After Round 19

- The app is now canvas-first.
- The no-provider demo loop is complete enough for public GitHub demonstration:
  - enter at `/canvas`.
  - create export-pack node.
  - plan batch jobs.
  - view progress, QA readiness, and manifest readiness.
  - export manifest JSON.
  - cancel/retry jobs.
  - clean generated local files safely.

### Remaining Gaps

- Image-level QA validation after generation is still missing.
- Manifest export is JSON only; no packaged image download/zip yet.
- In-flight provider cancellation still cannot abort the underlying HTTP call.
- The old `/result` path is retained only for compatibility and should be revisited if the old one-shot flow is retired fully.

### Next Execution Order

1. Add packaged export/download once artifacts are present.
2. Add reviewer UI / manual QA writeback for visual checks.
3. Consider a true worker/queue backend if the local in-process runner becomes too limiting.

## 36. Implementation Update: 2026-05-16 Round 20

### Completed

- Added `lib/canvas/export-pack-qa.ts`.
- Added `GET /api/export-packs/[batchId]/qa`.
- The QA report now evaluates each manifest item with:
  - artifact availability.
  - local/data image URL safety.
  - declared size matching when image dimensions are readable.
  - declared ratio matching when image dimensions are readable.
  - manual checks for background, text/watermark, model/product fit, and commercial quality.
- The API reads local `/api/generated-images/...` files or `data:image/...` payloads without adding image-processing dependencies.
- Lightweight dimension parsing covers PNG, JPEG, and WebP headers.
- The `导出包批次` card now includes:
  - a `QA` JSON entry.
  - a visible QA status badge such as `QA 待生成 6`.

### Verified In This Round

- `npm run build` passed.
- `npx tsc --noEmit` passed.
- API smoke against `http://localhost:3461` confirmed:
  - existing batch QA returned `200`.
  - current demo batch returned `QA 待生成 6`.
  - total QA items: `6`.
  - pending artifacts: `6`.
  - first item artifact, URL, size, and ratio checks are pending instead of false-passing.
  - missing batch returned `404`.
- Manifest download still returns a `Content-Disposition` attachment header.
- Browser smoke against `/canvas` confirmed:
  - export-pack batch card renders.
  - `JSON` button renders.
  - `QA` button renders.
  - `QA 待生成 6` badge renders.
  - no browser console errors were observed.
- Screenshot artifact:
  - `test_artifacts/canvas-qa-smoke.png`.
- No real image-generation provider call was made.

### Current State After Round 20

- The no-provider public demo loop now includes:
  - canvas-first entry.
  - export-pack planning.
  - batch progress.
  - manifest JSON export.
  - QA report JSON.
  - pending/missing artifact semantics.
  - first-pass generated-image dimension checks once artifacts exist.

### Remaining Gaps

- QA manual checks are not yet persisted through a reviewer UI.
- Packaged image download/zip is still missing.
- Generated outputs need a real completed batch before dimension and ratio checks can be demonstrated end to end.
- In-flight provider cancellation still cannot abort the underlying HTTP call.

### Next Execution Order

1. Add manual QA reviewer UI and writeback.
2. Add a demo fixture or safe mock-completed batch for public screenshots without provider spend.
3. Consider a true worker/queue backend if the local in-process runner becomes too limiting.

## 37. Implementation Update: 2026-05-16 Round 21

### Completed

- Added `lib/canvas/export-pack-archive.ts`.
- Added `GET /api/export-packs/[batchId]/download`.
- The download endpoint builds a dependency-free ZIP archive with:
  - `manifest.json`.
  - `qa-report.json`.
  - `summary.txt`.
  - `archive-summary.json`.
  - generated images when local files or `data:image/...` outputs are present.
- The archive helper uses a minimal store-only ZIP writer with CRC32.
- Current pending batches still produce a valid ZIP and record missing artifacts instead of failing.
- Local generated image paths are validated against `.data/generated`.
- Unsafe, remote, or unreadable outputs are skipped and recorded in the summary.
- The `导出包批次` card now includes a `ZIP` download button next to `JSON` and `QA`.
- README now mentions ZIP, manifest, and QA report endpoints.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run build` passed.
- API smoke against `http://localhost:3461` confirmed:
  - existing batch download returned `200`.
  - `Content-Type: application/zip`.
  - `Content-Disposition: attachment; filename="batch_1778867721799_efbcc641-export-pack.zip"`.
  - `X-Export-Pack-Images: 0`.
  - `X-Export-Pack-Missing-Artifacts: 6`.
  - missing batch returned `404`.
- ZIP smoke artifact:
  - `test_artifacts/export-pack-download-smoke.zip`.
- `unzip -t` passed with no errors.
- `unzip -l` confirmed the archive contains:
  - `manifest.json`.
  - `qa-report.json`.
  - `summary.txt`.
  - `archive-summary.json`.
- Browser smoke against `/canvas` confirmed:
  - one `ZIP` button renders.
  - `JSON` button renders.
  - `QA` button renders.
  - `QA 待生成 6` badge renders.
  - no browser console errors were observed.
- Screenshot artifact:
  - `test_artifacts/canvas-zip-smoke.png`.
- No real image-generation provider call was made.

### Current State After Round 21

- The no-provider public demo loop now covers:
  - canvas-first entry.
  - export-pack planning.
  - batch progress.
  - manifest JSON export.
  - QA report JSON.
  - downloadable ZIP bundle.
  - valid missing-artifact summaries for pending batches.

### Remaining Gaps

- QA manual checks are still read-only and need reviewer UI / persistence.
- There is no mock-completed demo batch with safe local images for showing completed QA and ZIP image inclusion.
- Generated ZIP images can only include local generated files and `data:image/...` payloads; remote provider URLs are intentionally skipped until a fetch/cache policy exists.
- In-flight provider cancellation still cannot abort the underlying HTTP call.

### Next Execution Order

1. Add a safe mock-completed batch / fixture for public demo screenshots.
2. Add a real worker/queue backend if the in-process runner starts limiting reliability.
3. Add deeper per-image reviewer UI when real generated batches exist.

## 38. Implementation Update: 2026-05-16 Round 22

### Completed

- Extended `lib/canvas/export-pack-qa.ts` with manual review support.
- QA reports can now merge persisted manual review states from job metadata.
- Added `PATCH /api/export-packs/[batchId]/qa/review`.
- Manual review writes are stored under job metadata as `exportPackQaReview.checks`.
- Review writes validate:
  - batch exists.
  - job belongs to the batch.
  - check id is one of the known manual QA checks.
  - status is `pass`, `fail`, or `manual`.
  - artifact is ready before manual review can be written.
- `GET /api/export-packs/[batchId]/qa` now includes persisted review states.
- ZIP download QA reports also include persisted review states.
- The `导出包批次` card now includes a lightweight `验收` button.
- The `验收` button only writes review states for completed items that still have manual checks.
- Current pending demo batches keep the button disabled and do not mutate metadata.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run build` passed.
- API smoke against `http://localhost:3461` confirmed:
  - review write against the current pending batch returns `409`.
  - missing batch returns `404`.
  - invalid check id returns `400`.
- Browser smoke against `/canvas` confirmed:
  - `ZIP` button renders.
  - `JSON` button renders.
  - `QA` button renders.
  - `验收` button renders.
  - `QA 待生成 6` badge renders.
  - no browser console errors were observed.
- Screenshot artifact:
  - `test_artifacts/canvas-qa-review-smoke.png`.
- No real image-generation provider call was made.

### Current State After Round 22

- The export-pack loop now has:
  - planning.
  - queue progress.
  - manifest export.
  - QA report.
  - ZIP bundle.
  - manual QA writeback path for completed artifacts.

### Remaining Gaps

- There is still no safe completed demo fixture with local images, so completed QA/pass states are not visually demonstrated yet.
- The reviewer UI is a quick batch-level pass action, not a full per-image review table.
- In-flight provider cancellation still cannot abort the underlying HTTP call.

### Next Execution Order

1. Add a real worker/queue backend if the in-process runner starts limiting reliability.
2. Expand the reviewer UI into a per-image review table once real batches exist.
3. Add richer style/component templates for more commercial scenarios.

## 39. Implementation Update: 2026-05-16 Round 23

### Completed

- Added `scripts/seed-demo-export-pack.mjs`.
- Added npm scripts:
  - `npm run demo:export-pack:dry-run`.
  - `npm run demo:export-pack`.
- The demo seed script:
  - defaults to dry-run.
  - writes only when `--write` is present.
  - creates two local generated PNG fixtures without provider calls.
  - inserts a completed demo batch into SQLite.
  - attaches the demo batch to the latest saved canvas workflow when available.
  - stores image dimensions in artifact/job metadata for client-side QA badges.
- Added shared server helper `lib/canvas/export-pack-image-info.ts`.
- `GET /api/export-packs/[batchId]/qa` and ZIP download now share the same image-dimension parsing logic.
- Client-side batch QA badges can now use artifact metadata dimensions when present.
- Seeded `demo_batch_showcase` locally with:
  - `800x800` Taobao main image.
  - `750x1200` Taobao detail image.
  - completed jobs and ready artifacts.
- Wrote manual QA review states for the demo batch so the visible badge can show `QA 通过 2`.

### Verified In This Round

- `npm run demo:export-pack:dry-run` passed.
- `node scripts/seed-demo-export-pack.mjs --write --reset` passed.
- `npx tsc --noEmit` passed.
- `npm run build` passed.
- API smoke confirmed:
  - `GET /api/export-packs/demo_batch_showcase/qa` returns `QA 通过 2`.
  - demo ZIP download includes `2` images.
  - ZIP summary reports `QA 通过 2`.
  - `unzip -t` reports no archive errors.
- Browser smoke against `/canvas` confirmed:
  - `Demo 淘宝图组` batch renders.
  - `2/2 完成` renders.
  - `ZIP`, `JSON`, `QA`, and `验收` buttons render.
  - `QA 通过 2` badge renders.
  - demo output images render.
  - no browser console errors were observed.
- Screenshot artifact:
  - `test_artifacts/canvas-demo-completed-smoke.png`.
- Download artifact:
  - `test_artifacts/demo-export-pack-reviewed-download-smoke.zip`.
- No real image-generation provider call was made.

### Current State After Round 23

- The project now has two demo surfaces:
  - a pending real planned batch showing `QA 待生成`.
  - a completed local demo batch showing `QA 通过`, real local images, and ZIP image inclusion.
- This is now much stronger for GitHub screenshots and mobile remote review because the successful path is visible without spending provider credits.

### Remaining Gaps

- The worker/queue backend is still local and in-process.
- The reviewer UI is still batch-level quick pass, not a full per-image review table.
- Demo images are solid PNG fixtures, not visually rich commercial examples.

### Next Execution Order

1. Expand the reviewer UI into a per-image QA table.
2. Add richer reusable style/scene/template components for broader commercial scenarios.
3. Consider a separate durable worker process if provider execution needs to survive server restarts.

## 40. Implementation Update: 2026-05-16 Round 24

### Completed

- Refactored `lib/store/job-runner.ts` from immediate background promise execution into a bounded local runtime queue.
- Added in-process queue state:
  - waiting job ids.
  - running job ids.
  - configurable concurrency via `IMAGE_MASTER_JOB_CONCURRENCY`.
- `startGenerationJob` now queues jobs first and lets `processQueue` run them under the concurrency limit.
- Queued jobs can be re-enqueued when `/run` is called after a process restart.
- Stale `running` jobs that are no longer active in memory can be requeued by `/run`.
- Cancelling a queued job now removes it from the runtime queue.
- Added `GET /api/jobs/queue`.
- Queue snapshot includes:
  - configured concurrency.
  - runtime queued/running ids and counts.
  - database status counts.
  - stale queued/running ids not present in memory.
- The canvas inspector task queue now shows:
  - local queue runtime status.
  - concurrency.
  - DB pending/queued/running counts.
  - stale task status.
- README now documents `IMAGE_MASTER_JOB_CONCURRENCY`.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run build` passed.
- API smoke against `http://localhost:3461` confirmed:
  - `GET /api/jobs/queue` returns concurrency, runtime, DB counts, and stale state.
  - current runtime queue is idle.
  - current DB has `7` pending jobs and `2` done demo jobs.
  - `GET /api/export-packs/demo_batch_showcase/qa` still returns `QA 通过 2`.
- Browser smoke against `/canvas` confirmed:
  - task queue heading renders.
  - `本地队列空闲` renders.
  - `并发 1` renders.
  - DB queue summary renders.
  - `无卡住任务` renders.
  - completed demo batch still renders `QA 通过 2`.
  - no browser console errors were observed.
- Screenshot artifact:
  - `test_artifacts/canvas-queue-smoke.png`.
- No real image-generation provider call was made.

### Current State After Round 24

- The app now has a more reliable local execution model:
  - queue visibility.
  - concurrency control.
  - stale-state detection.
  - safer cancel behavior for queued jobs.
- This is still in-process, but it is much less opaque than the previous fire-and-forget runner.

### Remaining Gaps

- Jobs still do not survive as actively running provider calls across server restarts.
- There is no separate worker process or durable lease table yet.
- The reviewer UI is still batch-level quick action, not a full per-image QA table.

### Next Execution Order

1. Expand the reviewer UI into a per-image QA table.
2. Add richer reusable style/scene/template components for broader commercial scenarios.
3. Consider a separate durable worker process if provider execution needs to survive server restarts.

## 41. Implementation Update: 2026-05-16 Round 25

### Completed

- Expanded the export-pack reviewer UI from a batch-level quick action into a per-image QA detail table.
- The inspector now tracks a focused export-pack batch and shows `QA 明细` for that batch.
- Each completed export-pack item now shows:
  - artifact readiness.
  - URL safety.
  - expected and actual dimensions.
  - expected and actual aspect ratio.
  - manual commercial checks such as scene/background, text policy, model/product quality, and commercial quality.
- Ready items with unresolved manual checks can be marked `过` or `退` directly from the QA detail table.
- The existing `PATCH /api/export-packs/[batchId]/qa/review` endpoint is reused for per-check writeback.
- README now documents the per-image QA detail table in the current demo loop.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run build` passed.
- API smoke against `http://localhost:3461` confirmed:
  - `GET /api/jobs/queue` returns concurrency `1`, an idle runtime queue, DB totals, and no stale queued/running jobs.
  - `GET /api/export-packs/demo_batch_showcase/qa` returns `QA 通过 2`.
- Browser smoke against `/canvas` confirmed:
  - `QA 明细` renders.
  - `Demo 淘宝图组` renders.
  - `淘宝主图` and `淘宝详情页` render in the detail table.
  - automatic checks render: `产物状态`, `URL 安全`, `尺寸`, and `宽高比`.
  - manual checks render: `白底/场景要求` and `商业质量`.
  - queue labels still render: `本地队列空闲`, `并发 1`, and `无卡住任务`.
  - completed demo batch still renders `QA 通过 2`.
  - no browser console errors were observed.
- Screenshot artifact:
  - `test_artifacts/canvas-qa-detail-final-smoke.png`.
- No real image-generation provider call was made.

### Current State After Round 25

- The canvas demo can now show a more complete commercial production loop:
  - plan export-pack jobs.
  - see queue status.
  - inspect pack-level progress.
  - download ZIP and JSON manifest.
  - open QA report JSON.
  - inspect per-image QA checks inside the canvas.
  - write manual QA decisions for ready artifacts.
- The successful demo path remains provider-free through the local seeded batch.

### Remaining Gaps

- The per-image QA table is compact and inspector-bound; it is not yet a large dedicated reviewer workspace with image zoom, before/after comparison, notes, or keyboard review flow.
- Manual QA uses simple pass/fail states; it does not yet support severity, reviewer comments per check from the UI, or approval history.
- The queue is still in-process; production-grade provider execution still needs durable leases or a separate worker process.
- Demo images are still simple local PNG fixtures rather than visually rich commercial examples.

### Next Execution Order

1. Add richer reusable style/scene/template components for broader commercial scenarios.
2. Add a larger reviewer workspace with image preview, comments, and keyboard-friendly pass/fail flow.
3. Consider a separate durable worker process if provider execution needs to survive server restarts.

## 42. Implementation Update: 2026-05-16 Round 26

### Completed

- Added a backend/data-model slice for the reusable low-code component system.
- Component types now support the standard reusable taxonomy:
  - `product_asset`
  - `model_asset`
  - `visual_style`
  - `scene`
  - `platform_rule`
  - `quality_rule`
  - `output_pack`
  - `brand_kit`
  - `prompt_source`
  - `image_recipe`
- Legacy component type aliases remain accepted for compatibility:
  - `product` -> `product_asset`
  - `model` -> `model_asset`
  - `style` -> `visual_style`
  - `prompt` -> `prompt_source`
- Added `lib/canvas/component-schema.ts` for:
  - canonical type normalization.
  - type labels.
  - default metadata templates.
  - metadata/rules normalization.
  - legacy-aware type filtering.
- `/api/components` create/update now persists normalized component metadata with stable fields such as `schemaVersion`, `componentType`, `inputs`, `outputs`, `parameters`, `constraints`, `promptFragments`, `negativeRules`, `qualityRules`, `compatibleWith`, and `source`.
- Existing rows remain readable without a destructive migration; readback normalizes metadata in memory.
- Added `npm run smoke:components`, which starts a local Next dev server, creates and reads all 10 canonical component types through `/api/components`, then cleans them up.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run smoke:components` passed:
  - created/read/deleted all 10 canonical component types.
  - verified normalized `metadata.componentType`.
  - verified normalized `inputs` and `outputs`.
- No real image-generation provider call was made.

### Remaining Gaps

- The front-end component editor/library still needs to consume the normalized metadata fields.
- The AI component factory still creates canvas nodes; the main thread can now wire it to save schema-normalized reusable components.
- Richer hand-authored templates for specific commercial scenarios should be added on top of this backend schema.

## 43. Implementation Update: 2026-05-16 Round 27

### Completed

- Added a reusable commercial component seed library for the normalized component schema.
- Seed coverage now includes:
  - visual styles: clean ecommerce white background, premium business model, warm lifestyle.
  - scenes: home lifestyle, cafe lifestyle, office business.
  - platform rules: Amazon main image, Taobao detail page, Xiaohongshu cover.
  - a default commerce brand kit.
  - quality rules: product consistency, platform compliance, commercial polish.
  - image recipes and output packs for Taobao detail, Amazon main image, and model display workflows.
- Added `lib/canvas/commercial-component-seeds.json` as the data source and `lib/canvas/commercial-component-seeds.ts` as the typed normalize helper for future UI/API reuse.
- Added `npm run seed:components`, which writes the seed set through `/api/components` and uses `metadata.seedKey` to avoid duplicate rows across repeated runs.
- Added `npm run smoke:commercial-components`, which runs the seed path on a temporary dev port, reads back the seeded records, and verifies key seed types, counts, seed keys, and normalized metadata ports.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run seed:components` passed on temporary port `3463`.
- `npm run smoke:commercial-components` passed on temporary port `3464`.
- No real image-generation provider call was made.

### Remaining Front-End Integration Points

- The component library UI can list/filter seeds by `metadata.seedKey`, `metadata.componentType`, and `metadata.compatibleWith`.
- Canvas node creation can map `visual_style`, `scene`, `platform_rule`, `quality_rule`, `image_recipe`, and `output_pack` seeds into reusable workflow blocks.
- The inspector can expose seed parameters as editable fields while preserving `seedKey` for future re-seeding and update detection.

## 44. Implementation Update: 2026-05-16 Round 28

### Completed

- Added `lib/canvas/component-factory-normalizer.ts` to convert AI canvas factory suggestions into schema-normalized reusable component create params.
- The normalizer maps factory output into the standard component taxonomy:
  - 商品 Brief -> `product_asset` or `prompt_source`.
  - 模特展示 -> `image_recipe` or `output_pack`.
  - 详情页 -> `image_recipe` or `output_pack`.
  - 平台输出包 -> `output_pack` or `platform_rule`.
  - AI 质检 -> `quality_rule`.
- Extended `/api/canvas-components` with optional `persistComponents: true`.
- Default response behavior remains compatible: callers still receive `components` and `fallback`.
- When persistence is requested, the route saves normalized reusable components through `componentDB.add` and returns `savedComponents`.
- Added lightweight duplicate avoidance using `metadata.factoryKey` plus generated-source/title/type keys against existing components and the current request.
- Added `useLocalFallback: true` as a smoke/test escape hatch so the API path can be verified without calling an AI provider.
- Added `npm run smoke:canvas-component-factory`, which posts to `/api/canvas-components` with persistence enabled, verifies suggestions plus saved components, checks normalized metadata fields and ports, then deletes smoke-created rows.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run smoke:canvas-component-factory` passed on temporary port `3465`.
- No real image-generation provider call was made.
- The smoke path used local fallback and did not require text AI availability.

### Remaining Front-End Integration Points

- The main canvas UI can decide when to send `persistComponents: true`; current default calls remain node-suggestion-only.
- The component library UI can surface `metadata.factoryKey`, `metadata.source.kind = "generated"`, and `metadata.factoryItem` for AI-generated reusable components.
- Canvas insertion can later use returned `savedComponents[].id` to bind generated nodes to durable component references.

## 45. Implementation Update: 2026-05-16 Round 29

### Completed

- Added `lib/canvas/workflow-composer.ts`, a rules-only workflow draft composer for turning a natural-language brief into a structured canvas workflow.
- Added `POST /api/workflow-compose`.
- The route accepts:
  - `brief`
  - optional `scenario`, `productTitle`, `productDescription`
  - optional `componentIds`, `platforms`, `outputPacks`
  - optional `saveWorkflow`
- Default behavior returns `{ workflowDraft }` only and does not write to the database.
- When `saveWorkflow: true` is passed, the route saves the composed draft through `workflowDB.add` and returns both `{ workflowDraft, workflow }`.
- The composer uses existing component/template data and prioritizes standard component metadata:
  - `metadata.componentType`
  - `metadata.seedKey`
  - `metadata.compatibleWith`
  - `metadata.parameters`
  - `metadata.promptFragments`
  - `metadata.qualityRules`
- The generated chain covers product brief, visual style, scene, image recipe, platform rules, quality rules, and output pack nodes when matching seed components are available.
- Added `npm run smoke:workflow-compose`, which starts a temporary dev server, ensures commercial seed components exist, posts to `/api/workflow-compose`, verifies nodes/edges plus product/recipe/output/quality coverage, verifies seed metadata on reusable component nodes, exercises `saveWorkflow: true`, and deletes the smoke-created workflow.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run smoke:workflow-compose` passed on temporary port `3466`.
- No real image-generation provider call was made.
- No frontend canvas file was changed in this round.

### Remaining Front-End Integration Points

- The main canvas UI can call `/api/workflow-compose` from a natural-language brief panel and render `workflowDraft.nodes` / `workflowDraft.edges` without saving by default.
- A deliberate "save draft" action can resend with `saveWorkflow: true` or post the returned draft to `/api/workflows`.
- The inspector can expose `node.data.componentId`, `componentType`, `seedKey`, `compatibleWith`, and `parameters` for seed-aware editing.

## 46. Implementation Update: 2026-05-16 Round 30

### Completed

- Added a front-end natural-language workflow compose entry in the canvas inspector.
- The right panel now includes `需求生成工作流` with a brief textarea and `生成工作流` action.
- The UI calls `POST /api/workflow-compose` with `saveWorkflow: false`.
- Returned `workflowDraft.nodes` and `workflowDraft.edges` are normalized into canvas nodes/edges and rendered directly on the current canvas.
- The composed canvas is treated as an unsaved draft:
  - `workflowId` is cleared.
  - hidden artifact node state is reset.
  - normal save action can persist the draft later.
- Composed nodes keep reusable component metadata such as `componentId`, `componentType`, `seedKey`, `compatibleWith`, `parameters`, `promptFragments`, and `qualityRules`.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run smoke:workflow-compose` passed on temporary port `3466`.
- `npm run smoke:canvas-component-factory` passed on temporary port `3465`.
- `npm run build` passed after rerunning without concurrent temporary dev servers.
- Browser smoke against `http://localhost:3461/canvas` confirmed:
  - `需求生成工作流` renders.
  - filling a Chinese brief and clicking `生成工作流` renders a composed canvas.
  - composed nodes include `Product Brief`, `Taobao Detail Image Recipe`, `Taobao Detail Output Pack`, and `Product Consistency Check`.
  - `已生成工作流草案` renders.
  - no browser console errors were observed.
- Screenshot artifact:
  - `test_artifacts/canvas-workflow-compose-smoke.png`.
- No real AI provider or image-generation provider call was made.

### Remaining Gaps

- The compose form is intentionally small; it does not yet expose platform chips, output-pack selectors, or component pinning.
- The composed draft is not yet shown as a reviewable plan before replacing the canvas.
- The inspector still needs editable parameter fields for composed component nodes.

### Next Execution Order

1. Add batch product-parameter import.

## 47. Implementation Update: 2026-05-16 Round 31

### Completed

- Added `lib/canvas/product-importer.ts`, a rules-only batch product importer for turning pasted JSON, NDJSON, CSV-ish, or key-value block text into normalized `product_asset` component create params.
- Added `POST /api/product-import`.
- The route accepts:
  - `text`
  - or `products`
  - optional `dryRun`
  - optional `createComponents`
- Supported product fields include title/name, category, description, sellingPoints/features, materials, brand, price, sku, platformHints, and imageUrl/referenceImage.
- Default behavior returns `{ parsedProducts, rejectedRows, componentsPreview }` only.
- When `createComponents: true` is passed without `dryRun`, the route saves product assets through `componentDB.add`.
- Saved components use schema-normalized metadata:
  - `metadata.componentType = "product_asset"`
  - `metadata.parameters.sellingPoints`
  - `metadata.parameters.materials`
  - `metadata.parameters.platformHints`
  - `metadata.source.kind = "ai_import"`
  - `metadata.importKey` derived from SKU first, then title.
- Obvious duplicates are skipped by existing `metadata.importKey`, SKU, or title key.
- Added `npm run smoke:product-import`, which starts a temporary Next dev server on port `3467`, exercises dry-run and create flows, verifies saved `product_asset` metadata and selling points, verifies duplicate skipping, then deletes smoke-created components.

### Verified In This Round

- `npm run smoke:product-import` passed on temporary port `3467`.
- No real image-generation provider call was made.
- No `.data` deletion was performed.
- No frontend canvas file was changed in this round.
- Port `3461` was not used.

### Remaining Front-End Integration Points

- Connect imported product components directly into workflow compose and canvas insertion.
- Let composed workflows pin a newly imported product as the first product node.

## 48. Implementation Update: 2026-05-16 Round 32

### Completed

- Added a front-end batch product import entry in the canvas inspector.
- The right panel now includes `批量商品导入` with a textarea for pasted JSON, CSV-ish, NDJSON, or key-value product parameters.
- The preview action calls `POST /api/product-import` with `dryRun: true`.
- The commit action calls `POST /api/product-import` with `createComponents: true`.
- Imported components are normalized through the existing persisted component mapper and merged into the left component library.
- After a successful import, the left asset library switches to `商品` so the new product component is immediately visible.
- The panel renders parsed product previews, rejected-row counts, and commit status.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run smoke:product-import` passed.
- Browser smoke against `http://localhost:3461/canvas` confirmed:
  - `批量商品导入` renders.
  - pasted CSV-ish product parameters enable `预览`.
  - preview returns `已解析 1 个商品`.
  - save returns `已保存 1 个商品组件`.
  - the smoke-created product component was deleted after verification.
  - no browser console errors were observed.
- Screenshot artifact:
  - `test_artifacts/canvas-product-import-smoke.png`.
- No real AI provider or image-generation provider call was made.

### Runtime Note

- A stale `.next` dev cache briefly caused `/canvas` to render server HTML while the client chunk returned 404, leaving React form state disconnected.
- Clearing `.next` and restarting the dev server fixed the mismatch.
- Avoid running `npm run build` against the same active `.next` directory while relying on an already-running dev server for browser smoke.

## 49. Implementation Update: 2026-05-16 Round 33

### Completed

- Added `lib/canvas/reviewer-session.ts`, a reviewer session summary helper for future image-set review workspaces.
- Added `lib/store/review-session-db.ts`.
- Added the `review_sessions` SQLite table and indexes in `lib/store/db.ts`.
- Added `POST /api/review-sessions`.
- Added `GET /api/review-sessions`.
- Added `GET /api/review-sessions?id=...`.
- Added deterministic demo output through `GET /api/review-sessions?demo=1`.
- Added `DELETE /api/review-sessions?id=...`.
- Added `npm run smoke:review-sessions`, which starts a temporary dev server, creates a session, reads it by id, checks list/demo behavior, deletes the smoke-created session, and verifies cleanup.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run smoke:review-sessions` passed on temporary port `3468`.
- `npm run build` passed and includes `/api/review-sessions`.
- No real image-generation provider call was made.
- No reviewer front-end was added in this round.

## 50. Implementation Update: 2026-05-16 Round 34

### Completed

- Connected imported product components to the canvas product node.
- After saving a batch product import, the first new `product_asset` component is attached to the current `product` node when it exists.
- The attached product node keeps product metadata from the component:
  - `componentId`
  - `componentType`
  - `parameters`
  - product category
  - selling-point/material/platform metrics
  - preview URL when available
- Added `生成商品工作流` in the product import panel after a product component is attached.
- The action uses the active product component and calls `/api/workflow-compose` with:
  - generated product-aware brief when the normal brief field is empty.
  - `componentIds: [activeProductComponent.id]`.
  - product title and product description derived from component metadata.
- Updated `lib/canvas/workflow-composer.ts` so requested `product_asset` components can become the composed workflow's first product node instead of being reduced to a plain text brief.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run smoke:workflow-compose` passed on temporary port `3466`.
- `npm run smoke:product-import` passed on temporary port `3467` after rerunning without concurrent temporary Next dev servers.
- Browser smoke against `http://localhost:3461/canvas` confirmed:
  - imported product save attaches the product to the canvas.
  - `生成商品工作流` appears.
  - clicking it renders the imported product title in the composed workflow.
  - composed workflow still includes reusable commerce nodes such as `Taobao Detail Image Recipe`.
  - the smoke-created product component was deleted after verification.
  - no browser console errors were observed.
- Screenshot artifact:
  - `test_artifacts/canvas-imported-product-workflow-smoke.png`.
- No real AI provider or image-generation provider call was made.

### Runtime Note

- Running temporary Next dev smoke scripts in parallel can cause transient route 404s because each server mutates `.next`.
- For these smoke scripts, run them sequentially unless the scripts are changed to use isolated build directories.

## 51. Implementation Update: 2026-05-16 Round 35

### Completed

- Extended `lib/canvas/reviewer-session.ts` with review session update/action support.
- Added support for:
  - `approve_item`
  - `reject_item`
  - `request_revision`
  - `add_note`
- Added `reviewSessionDB.update()`.
- Added `PATCH /api/review-sessions?id=...`.
- PATCH actions append history/notes, update item status, recompute session counters, recompute session status, and return the updated session.
- Extended `npm run smoke:review-sessions` to cover create, action updates, readback, and cleanup.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run smoke:review-sessions` passed on temporary port `3468`.
- `npm run build` passed and includes `/api/review-sessions`.
- Smoke-created review sessions were cleaned up.
- No reviewer front-end was added in this round.

### Next Execution Order

1. Build reviewer workspace UI over `/api/review-sessions` and existing export-pack QA.
2. Add product-to-workflow plan preview before replacing the canvas.
3. Add parameter editing for composed product/recipe/output-pack nodes.
4. Upgrade the in-process queue into a durable worker/lease model.
5. Add provider-adapter safety gates before heavier image-generation API usage.

## 52. Implementation Update: 2026-05-16 Round 36

### Completed

- Added reviewer workspace UI to the canvas inspector.
- The new `审核工作台` panel can:
  - create a review session from the current export batch/QA manifest when the current canvas state has a batch.
  - create a demo review session from local `/canvas-assets/*.svg` assets.
  - refresh the latest stored review session.
  - apply `通过`, `打回`, `需改`, and note actions through `/api/review-sessions`.
- Review items show thumbnail, status, quality checks, and per-item notes.
- Session counters are shown in the inspector so a user can understand whether a generated set is accepted, rejected, or still needs revision.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run smoke:review-sessions` passed.
- Browser smoke against `http://localhost:3461/canvas` confirmed:
  - `审核工作台` renders.
  - `演示` creates a session.
  - an item approval action persists and updates the UI.
  - no app console errors were observed.
- Smoke-created demo review sessions were deleted after verification.
- Fixed a demo reviewer thumbnail reference from missing `/canvas-assets/scene-studio.svg` to existing `/canvas-assets/scene-cafe.svg`.

## 53. Implementation Update: 2026-05-16 Round 37

### Completed

- Added workflow plan preview support before applying generated workflows to the canvas.
- Added `lib/canvas/workflow-plan-preview.ts`.
- Extended `POST /api/workflow-compose` with `previewPlan: true`.
- The API now returns `planPreview` alongside `workflowDraft`.
- The canvas no longer immediately replaces itself when a generated workflow is requested from the main brief panel.
- The inspector now shows:
  - `计划预览`
  - plan stages/components.
  - `应用计划`
  - `关闭预览`
- Applying the plan uses the pending workflow draft and then replaces the canvas.

### Verified In This Round

- `npm run smoke:workflow-compose` passed and validated preview items.
- `npx tsc --noEmit` passed after UI integration.
- Browser smoke confirmed:
  - `需求生成工作流` returns `计划预览`.
  - `应用计划` applies the pending plan to the canvas.
  - no app console errors were observed.

## 54. Implementation Update: 2026-05-16 Round 38

### Completed

- Added editable parameter controls for plan-preview fields.
- Plan parameter edits are mirrored into both:
  - the visible `planPreview`.
  - the pending `workflowDraft` that will be applied to the canvas.
- Added field rendering for boolean, select, textarea, list/JSON, text, and number-style values.
- Added a `生成安全` inspector section that reads `/api/settings` and surfaces:
  - image API key readiness.
  - current image model.
  - provider/queue safety notes.
  - a direct `/settings` link for configuration.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run smoke:workflow-compose` passed.
- `npm run smoke:review-sessions` passed.
- `npm run smoke:product-import` passed.
- `npm run build` passed.
- Browser smoke confirmed:
  - plan preview renders.
  - editable plan controls render.
  - applying a plan updates the canvas.
  - provider-readiness UI renders under `生成安全`.
  - no app console errors were observed.
- Browser screenshot:
  - `test_artifacts/canvas-mvp-reviewer-plan-smoke.png`.

### Current State After Round 38

- The MVP has crossed from a static canvas/workflow prototype into a usable local production workbench:
  - reusable commercial component library.
  - product import.
  - natural-language workflow planning.
  - preview-before-apply control.
  - review sessions.
  - export-pack and QA surfaces.
  - provider-readiness surfacing.
- No real image-generation API call was made in this round.
- The remaining high-risk work is runtime hardening and controlled real-provider generation, not basic UI scaffolding.

### Next Execution Order

1. Run a controlled real-provider end-to-end generation only after explicit API-spend approval.
2. Polish the export-pack/reviewer bridge so approved images flow cleanly into download-ready packs.
3. Upgrade the in-process queue into a durable worker/lease model.
4. Expand plan-preview parameters for multi-product, multi-platform, and brand-kit scenarios.
5. Package a clean MVP demo state with seeded components, demo workflows, and no smoke-test residue.

## 55. Implementation Update: 2026-05-16 Round 39

### Completed

- Ran one controlled real-provider end-to-end generation through the existing job runner.
- No code files were changed for the provider smoke.
- The smoke created one local job through `/api/jobs`.
- The smoke invoked `/api/jobs/{id}/run` once.
- The saved image provider was used through the app's existing settings.
- The generated result was stored as a local PNG and linked to an artifact record.

### Verified In This Round

- `createStatus`: `201`.
- `runStatus`: `200`.
- final job status: `done`.
- provider: `hk.lanyiapi.com`.
- model: `gpt-image-2`.
- job: `job_1778913086673_e5115369`.
- artifact: `artifact_1778913110178_4fc04221`.
- generated image:
  - `.data/generated/job_1778913086673_e5115369-smoke-48a8e52ad402.png`.
  - PNG, `1024 x 1024`.
  - `1,196,599` bytes.
- public image route returned `200`:
  - `/api/generated-images/job_1778913086673_e5115369-smoke-48a8e52ad402.png`.
- smoke report:
  - `test_artifacts/api-smoke/real-provider-job-smoke-2026-05-16T06-31-26-549Z.json`.
- Provider call count was `1`.

### Current State After Round 39

- The app now has proof that saved settings, job runner, real provider generation, local image storage, artifact persistence, and public generated-image serving can work as one chain.
- This smoke only covers a single text-to-image job.
- Still not covered:
  - image-to-image with product reference.
  - multi-image batch generation.
  - provider failure status surfacing.
  - full canvas workflow to export-pack handoff using real generated outputs.

### Next Execution Order

1. Polish the export-pack/reviewer bridge so approved images flow cleanly into download-ready packs.
2. Upgrade the in-process queue into a durable worker/lease model.
3. Expand plan-preview parameters for multi-product, multi-platform, and brand-kit scenarios.
4. Add guarded coverage for image-to-image and multi-image batch generation when API spend is approved.
5. Package a clean MVP demo state with seeded components, demo workflows, and no smoke-test residue.

## 56. Implementation Update: 2026-05-16 Round 40

### Completed

- Added `lib/canvas/review-export-pack-sync.ts`.
- Review session item actions now have a bridge back into export-pack QA when the review session was created from an export pack.
- `PATCH /api/review-sessions?id=...` now returns `exportPackSync` when a review item can be synced to a batch job.
- Mapping:
  - `approve_item` -> all manual export-pack QA checks for that job become `pass`.
  - `reject_item` -> all manual export-pack QA checks for that job become `fail`.
  - `request_revision` -> all manual export-pack QA checks for that job become `manual`.
  - `add_note` stays local to the review session and does not mutate export-pack QA.
- The canvas review workspace refreshes job-derived QA state after a successful export-pack sync.
- Added `approvedOnly=1`, `approved=1`, and `mode=approved` support to `GET /api/export-packs/[batchId]/download`.
- Approved-only ZIPs include only QA-passed images and skip unapproved/manual/failed/pending items with a reason in `archive-summary.json`.
- Added `X-Export-Pack-Mode` and `X-Export-Pack-QA-Status` response headers.
- Added a `过审` button to export-pack batch cards for approved-only ZIP download.
- Added `scripts/smoke-review-export-pack-bridge.mjs`.
- Added `npm run smoke:review-export-pack-bridge`.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run smoke:review-export-pack-bridge` passed against `http://127.0.0.1:3461`.
- `npm run smoke:review-sessions` passed.
- `npm run build` passed.
- `unzip -t test_artifacts/review-export-pack-bridge-approved.zip` passed.
- `unzip -t test_artifacts/review-export-pack-bridge-all.zip` passed.
- Smoke report:
  - `test_artifacts/review-export-pack-bridge-smoke.json`.
- Smoke ZIP artifacts:
  - `test_artifacts/review-export-pack-bridge-approved.zip`.
  - `test_artifacts/review-export-pack-bridge-all.zip`.
- The bridge smoke verified:
  - review session approval returned `exportPackSync.status = synced`.
  - the synced job updated 4 manual QA checks.
  - approved-only ZIP included 1 image.
  - all-items ZIP included 2 images.
  - smoke-created jobs, artifacts, and review sessions were cleaned up.
- Browser verification after restarting dev server on `http://localhost:3461/canvas` confirmed:
  - `Demo 淘宝图组` renders.
  - `ZIP`, `过审`, `JSON`, `QA`, and `验收` render on batch cards.
  - QA detail rows expose per-check `过` / `退` actions.

### Current State After Round 40

- Review decisions now affect export-pack deliverables.
- There are two ZIP paths:
  - full ZIP for all readable artifacts.
  - approved-only ZIP for QA-passed images.
- The remaining export-pack work is less about basic plumbing and more about release semantics:
  - finalization/locking.
  - delivery states.
  - batch-level review history.
  - durable worker guarantees for long-running generation.

### Next Execution Order

1. Upgrade the in-process queue into a durable worker/lease model.
2. Expand plan-preview parameters for multi-product, multi-platform, and brand-kit scenarios.
3. Add guarded coverage for image-to-image and multi-image batch generation when API spend is approved.
4. Package a clean MVP demo state with seeded components, demo workflows, and no smoke-test residue.
5. Add export-pack finalization states such as draft, reviewed, locked, and delivered.

## 57. Implementation Update: 2026-05-16 Round 41

### Completed

- Added durable lease metadata to the existing job lifecycle without changing the public job status model.
- Lease metadata now tracks:
  - `leaseId`.
  - `leaseOwner`.
  - `leaseStatus`.
  - `leaseExpiresAt`.
  - `leaseHeartbeatAt`.
- `startGenerationJob` now creates or refreshes a lease before a provider run.
- Running jobs update lease heartbeat state.
- Completed, failed, cancelled, and retried jobs release active lease metadata.
- `/api/jobs/queue` now reports queue owner, concurrency, stale counts, expired leases, missing-lease running jobs, and active lease details.
- `POST /api/jobs/queue` can reclaim stale jobs without starting provider work.
- Added `scripts/smoke-durable-queue.mjs`.
- Added `npm run smoke:durable-queue`.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run smoke:durable-queue` passed.
- Durable queue smoke confirmed 4 reclaimed jobs.
- Cancel and retry lease release were verified.
- No provider call was made.

### Current State After Round 41

- The queue is no longer only an opaque in-process list; stale jobs and active leases are visible through API state.
- This is still not the final hard queue:
  - lease state is stored in job metadata.
  - there is not yet a dedicated lease table.
  - there is not yet an atomic compare-and-swap claim path.

## 58. Implementation Update: 2026-05-16 Round 42

### Completed

- Expanded commercial component seeds from the earlier basic library to 27 reusable components.
- Added scenario coverage for:
  - Taobao detail.
  - Amazon main image.
  - Xiaohongshu cover.
  - Poster campaign.
  - Model display.
  - Product detail page.
- Added stronger `platform_rule`, `image_recipe`, and `output_pack` components for the scenario set.
- Strengthened workflow template metadata with:
  - platform.
  - target size / aspect.
  - image count.
  - required assets.
  - QA rules.
  - cost tier.
  - forbidden rules.
  - naming guidance.
  - target scenarios.
- Updated the commercial component smoke so it validates scenario coverage instead of only seed count.

### Verified In This Round

- `npm run smoke:commercial-components` passed.
- `npx tsc --noEmit` passed.
- Smoke result:
  - 27 seeds.
  - `output_pack=6`.
  - `image_recipe=6`.
  - `platform_rule=5`.
  - scenario coverage includes `taobao_detail`, `amazon_main`, `xiaohongshu_cover`, `poster_campaign`, `model_display`, and `product_detail_page`.

### Current State After Round 42

- The asset/component library is closer to a low-code commercial image-production toolkit.
- The user can now build from platform and output intent, not just from generic prompt fragments.
- The next template step is to expose more of these parameters in the UI and connect them to real generation runs.

## 59. Implementation Update: 2026-05-16 Round 43

### Completed

- Added `scripts/smoke-plan-to-approved-export-pack.mjs`.
- Added `npm run smoke:plan-to-approved-export-pack`.
- The smoke covers the no-provider closed loop:
  - `POST /api/workflow-compose` with `previewPlan: true`.
  - creation of four generation-job fixtures.
  - creation of readable PNG artifacts from local data URLs.
  - review session creation from the batch.
  - approval of one review item.
  - export-pack QA sync from reviewer approval.
  - approved-only ZIP download.
  - all-items ZIP download.
  - cleanup of smoke-created jobs, artifacts, review sessions, and workflow.

### Verified In This Round

- `npm run smoke:plan-to-approved-export-pack` passed.
- Smoke result:
  - plan items: 4.
  - approved ZIP images: 1.
  - all ZIP images: 4.
  - cleanup: clean.
- Report:
  - `test_artifacts/plan-to-approved-export-pack-smoke.json`.
- ZIP artifacts:
  - `test_artifacts/plan-to-approved-export-pack-approved.zip`.
  - `test_artifacts/plan-to-approved-export-pack-all.zip`.

### Current State After Round 43

- The product now has a local proof of the real production shape:
  - plan preview.
  - batch job set.
  - review action.
  - QA sync.
  - approved delivery package.
- This smoke intentionally does not call the image provider.

## 60. Implementation Update: 2026-05-16 Round 44

### Completed

- Added generation safety guardrails to `POST /api/images/generate/batch`.
- Added `dryRun` support so the app can show rough cost/size estimates without invoking a provider.
- Added max image count protection:
  - default: 6.
  - configurable with `IMAGE_MASTER_MAX_BATCH_IMAGES`.
- Added prompt length protection.
- Added product reference guardrails:
  - data URL must be `data:image/...;base64`.
  - decoded reference image must stay under the byte limit.
- Provider failures are now sanitized into stable `error.message` and `error.code` fields in batch results.
- Added `scripts/smoke-generation-safety.mjs`.
- Added `npm run smoke:generation-safety`.

### Verified In This Round

- `npm run smoke:generation-safety` passed.
- `npm run build` passed.
- Safety smoke verified:
  - dry-run estimate path.
  - dry-run estimate with product reference.
  - image-count guard.
  - product-reference guard.
  - no real provider call.

### Current State After Round 44

- P0 now has a better protected provider boundary:
  - users can preview before spending.
  - oversize requests are blocked early.
  - bad reference images are blocked early.
  - failures should be easier to surface in UI.
- The remaining real-provider gap is a guarded image-to-image run using product/model/style references, which should only be executed after explicit API-spend approval.

### Next Execution Order

1. Upgrade lease metadata into stronger SQLite-backed atomic locking or a dedicated lease table.
2. Wire durable queue status and reclaim actions into the canvas UI.
3. Add guarded real image-to-image smoke with explicit API-spend approval.
4. Add project/campaign/batch management so a product can own canvases, assets, jobs, review sessions, and export packs.
5. Add export-pack finalization states such as draft, generated, in_review, reviewed, locked, and delivered.
6. Package a clean MVP demo state with seeded components, demo workflows, and no smoke-test residue.

## 61. Implementation Update: 2026-05-16 Round 45

### Completed

- Added a dedicated SQLite `job_leases` table.
- Added `lib/store/job-lease-db.ts`.
- Lease rows now persist:
  - `job_id`.
  - `lease_id`.
  - `owner`.
  - `status`.
  - `claimed_at`.
  - `heartbeat_at`.
  - `expires_at`.
  - `released_at`.
  - `updated_at`.
- Job start/reclaim now uses SQLite transactional claim semantics.
- Heartbeats and release events update the lease table.
- Queue snapshots include lease-table totals and rows.

### Verified In This Round

- `npx tsc --noEmit` passed.
- `npm run smoke:durable-queue` passed.
- Durable queue smoke confirmed:
  - atomic claim behavior.
  - 2 stale jobs reclaimed.
  - cancel/retry release.
  - no provider call.

## 62. Implementation Update: 2026-05-16 Round 46

### Completed

- Added a compact queue status panel to the canvas inspector.
- The panel reads `GET /api/jobs/queue`.
- It displays:
  - queue owner.
  - concurrency.
  - pending/queued/running counts.
  - active lease count.
  - stale/expired/missing lease counts.
  - recent active lease rows when available.
- Added refresh and stale-reclaim actions.
- Reclaim action calls `POST /api/jobs/queue` with `enqueue:false`, so it does not start provider work.
- The UI mapper tolerates missing queue fields for older snapshots.

### Verified In This Round

- Browser DOM verification on `http://127.0.0.1:3461/canvas` confirmed:
  - `队列状态`.
  - `回收 stale jobs`.
  - `待运行`.
  - `活动租约`.
  - `任务队列`.
- Screenshot capture timed out in the browser runtime, but the DOM state and `/canvas` HTTP probe were healthy.

## 63. Implementation Update: 2026-05-16 Round 47

### Completed

- Added `scripts/smoke-real-image-edit-batch.mjs`.
- Added `npm run smoke:real-image-edit-batch`.
- The smoke:
  - creates a small local product reference PNG if needed.
  - calls `/api/images/generate/batch` with `dryRun:true`.
  - verifies product-reference estimate before spending.
  - calls the real provider for exactly one image.
  - writes the generated PNG and JSON report under `test_artifacts/api-smoke`.

### Verified In This Round

- `npm run smoke:real-image-edit-batch` passed.
- Provider:
  - `https://hk.lanyiapi.com/v1`.
- Model:
  - `gpt-image-2`.
- Provider call count:
  - `1`.
- Reference:
  - `test_artifacts/api-smoke/product-reference-smoke.png`.
  - `41,812` bytes.
- Output:
  - `test_artifacts/api-smoke/real-image-edit-batch-smoke-2026-05-16T07-32-05-645Z.png`.
  - PNG, `1024 x 1024`.
  - `1,117,353` bytes.
- Report:
  - `test_artifacts/api-smoke/real-image-edit-batch-smoke-2026-05-16T07-32-05-645Z.json`.

### Current State After Round 47

- The platform has now proven both:
  - text-to-image through the job runner.
  - product-reference image-to-image through the batch API.
- The next provider step should be a tiny real batch only after an explicit spend check.

## 64. Implementation Update: 2026-05-16 Round 48

### Completed

- Added project/campaign/batch tables:
  - `projects`.
  - `campaigns`.
  - `project_batches`.
- Added `lib/store/project-db.ts`.
- Added project APIs:
  - `GET /api/projects`.
  - `POST /api/projects`.
  - `GET /api/projects/[id]`.
  - `PATCH /api/projects/[id]`.
- Legacy export packs can be lazily assigned to a default project/campaign/batch model.
- Batch metadata can carry related product, workflow, job, artifact, review session, and export-pack ids.

### Verified In This Round

- Project API probe passed against `http://127.0.0.1:3461`.
- The probe created a project, campaign, and batch.
- The probe-created project was removed from SQLite afterward.

## 65. Implementation Update: 2026-05-16 Round 49

### Completed

- Added `lib/canvas/export-pack-state.ts`.
- Added export-pack batch states:
  - `draft`.
  - `generated`.
  - `in_review`.
  - `reviewed`.
  - `locked`.
  - `delivered`.
- Manifest responses now include `batchState`.
- QA review responses can advance batch state.
- Locked batches reject content edits.
- Delivered batches are terminal.

### Verified In This Round

- `demo_batch_showcase` manifest returned `batchState: generated`.
- A probe batch moved through:
  - `draft -> generated -> in_review -> reviewed -> locked -> delivered`.
- Locked batch content edit returned `409`.
- `npm run smoke:review-export-pack-bridge` still passed.
- `npm run smoke:plan-to-approved-export-pack` still passed.

## 66. Implementation Update: 2026-05-16 Round 50

### Completed

- Strengthened `scripts/seed-demo-export-pack.mjs`.
- Added `scripts/smoke-demo-state.mjs`.
- Added `npm run smoke:demo-state`.
- Demo reset now restores:
  - clean MVP canvas state.
  - `demo_batch_showcase`.
  - 2 demo jobs.
  - 2 demo artifacts.
  - generated demo image files.
- Demo verification checks that smoke/test residue is not part of the display state.

### Verified In This Round

- `npm run demo:export-pack -- --reset` passed.
- `npm run smoke:demo-state` passed.
- `npm run smoke:generation-safety` passed.
- `npm run smoke:commercial-components` passed.
- `npm run build` passed.

### Current State After Round 50

- The MVP is now meaningfully closer to a production workbench:
  - durable worker lease foundation.
  - visible queue operations.
  - real product-reference generation.
  - project-level ownership model.
  - export-pack delivery state.
  - clean demo presentation state.

## 67. Implementation Update: 2026-05-16 Round 51

### Completed

- Surfaced project/campaign/batch ownership in the canvas inspector:
  - project select.
  - batch select.
  - persisted batch-state badge.
  - campaign/batch counts.
- Connected `/api/jobs` creation to project batches:
  - jobs with `metadata.batchId` now ensure a default project/campaign/batch record.
  - returned job metadata includes `projectId`, `campaignId`, and `batchState` when linking succeeds.
  - batch metadata accumulates related workflow, product, job, artifact, review, and export-pack ids.
- Added export-pack batch state controls in the UI:
  - current batch state on each batch card.
  - `锁定` action.
  - `交付` action.
  - actions remain visible but disabled until the state machine allows them.
- Added project-state smoke coverage:
  - `scripts/smoke-project-state.mjs`.
  - `npm run smoke:project-state`.
  - verifies job auto-linking, generated state, state transitions, locked edit rejection, and cleanup.
- Cleaned demo-state project-batch residue:
  - `scripts/seed-demo-export-pack.mjs` removes smoke/test `project_batches`.
  - `scripts/smoke-demo-state.mjs` now fails if smoke/test project batches leak into demo state.

### Verified In This Round

- `node --check scripts/seed-demo-export-pack.mjs`.
- `node --check scripts/smoke-demo-state.mjs`.
- `npm run demo:export-pack -- --reset`.
- `npm run smoke:demo-state`.
- `PROJECT_STATE_SMOKE_BASE_URL=http://127.0.0.1:3461 npm run smoke:project-state`.
- `npx tsc --noEmit`.
- `npm run build`.
- `curl -I http://127.0.0.1:3461/canvas`.
- Browser DOM verification on `http://127.0.0.1:3461/canvas` confirmed:
  - `项目批次`.
  - `Default Canvas Project`.
  - `Demo 淘宝图组 · 已生成`.
  - `导出包批次`.
  - `锁定`.
  - `交付`.
  - no `Smoke` / `smoke_` text in the demo/project-batch surface.

### Notes

- No new real image-provider call was made in this round.
- `next dev` and `next build` both mutate `.next`; do not run them concurrently during verification. Restart the dev server after production build QA.

### Current State After Round 51

- Project-level ownership is now visible and durable enough for MVP work.
- Export-pack delivery state is no longer backend-only.
- Demo reset now produces a cleaner project/batch selector.
- Remaining P0/P1 work is mostly workflow depth rather than foundational plumbing:
  - richer review history.
  - user-created project/campaign switching.
  - old pending batch cleanup controls.
  - responsive polish.
  - a small multi-image real-provider smoke after explicit spend approval.

### Next Execution Order

## 68. Implementation Update: 2026-05-16 Round 52

### Completed

- Added project/batch review summary aggregation in `lib/store/project-db.ts`:
  - project-level `reviewSummary`.
  - batch-level `reviewSummary`.
  - session count.
  - item counters.
  - latest session title/time.
  - recent review history entries.
- Reused existing `review_sessions.history` and `review_sessions.metadata` instead of adding another persistence table.
- Extended review-session payloads created from export-pack batches with project/campaign metadata when available.
- Added lightweight project/campaign creation inside the canvas inspector:
  - `新项目名`.
  - `当前项目下的新活动`.
  - create project via `POST /api/projects`.
  - create campaign via `POST /api/projects`.
  - refreshes the project selector after creation.
- Added project/batch review summary UI in the project panel:
  - `项目审核`.
  - `批次审核`.
  - approved / needs revision / rejected counters.
  - latest activity.
- Added `scripts/smoke-project-review-history.mjs`.
- Added `npm run smoke:project-review-history`.

### Verified In This Round

- `node --check scripts/smoke-project-review-history.mjs`.
- `npm run smoke:project-review-history`.
- `npx tsc --noEmit`.
- `npm run smoke:demo-state`.
- `npm run smoke:project-state`.
- `npm run build`.
- Browser DOM verification on `http://127.0.0.1:3461/canvas` confirmed:
  - `新项目名`.
  - `当前项目下的新活动`.
  - `项目审核`.
  - `批次审核`.
  - `Default Canvas Project`.
  - `Demo 淘宝图组 · 已生成`.

### Notes

- No new real image-provider call was made in this round.
- The build still emits the known multiple-lockfile workspace-root warning.

### Current State After Round 52

- The project layer now supports basic user-created organization and visible review history.
- Project/batch review summaries are computed from existing review sessions and remain compatible with the current SQLite schema.
- The next round should move into operational cleanup and UX polish rather than another data-foundation pass.

### Next Execution Order

1. Add batch-level archive/cleanup controls for old pending export-pack jobs.
2. Add project/campaign edit or rename flows.
3. Continue mobile/responsive polish for the right inspector and review/export panels.
4. Add a small batch real-provider smoke with 2-3 images only after another explicit API-spend check.

## 69. Implementation Update: 2026-05-16 Round 53

### Completed

- Added project-level batch archive cleanup in `lib/store/project-db.ts`:
  - finds jobs by `metadata.batchId` and batch-owned `metadata.jobIds`.
  - cancels only cancellable jobs.
  - routes cancellation through `markJobCancelledMetadata`, so SQLite lease rows are released consistently.
  - removes queued jobs from the in-process runner queue when applicable.
  - stores cleanup metadata on the project batch instead of deleting rows.
- Added `archive_cleanup` support to `PATCH /api/projects/[id]`.
- Added a `归档` action to export-pack batch cards in the canvas inspector.
- Added archive-cleanup summary text to the selected project batch panel.
- Added `scripts/smoke-batch-archive-cleanup.mjs`.
- Added `npm run smoke:batch-archive-cleanup`.

### Verified In This Round

- `node --check scripts/smoke-batch-archive-cleanup.mjs`.
- `npx tsc --noEmit`.
- `npm run smoke:batch-archive-cleanup`.
- `npm run smoke:project-state`.
- `npm run smoke:project-review-history`.
- `npm run smoke:demo-state`.
- `npm run smoke:durable-queue`.
- `npm run build`.
- Browser DOM verification on `http://127.0.0.1:3461/canvas` with a temporary workflow-scoped pending job confirmed:
  - `项目批次`.
  - `导出包批次`.
  - `归档`.
  - `锁定`.
  - `交付`.
  - `Round 53 UI Pack`.
  - the temporary UI job and batch were deleted afterward, then `npm run smoke:demo-state` passed again.

### Notes

- No real image-provider call was made in this round.
- The build still emits the known multiple-lockfile workspace-root warning.
- The archive action is intentionally non-destructive: it cancels active jobs and records cleanup metadata, but keeps completed images, job rows, and review evidence.

### Current State After Round 53

- Batch cleanup is now usable from the main canvas surface.
- Queue cancellation, lease release, and project-batch metadata now line up in one operator action.
- The project/export-pack foundation is close to MVP-ready; the remaining work is mostly UX control, responsive polish, and a carefully bounded real-provider smoke.

### Next Execution Order

1. Add project/campaign edit or rename flows.
2. Continue mobile/responsive polish for the right inspector and review/export panels.
3. Add a small batch real-provider smoke with 2-3 images only after another explicit API-spend check.

## 70. Implementation Update: 2026-05-16 Round 54

### Completed

- Added project/campaign rename controls to `components/canvas/visual-workbench.tsx`:
  - `项目显示名` edit field.
  - project `改名` action.
  - campaign selector.
  - `活动显示名` edit field.
  - campaign `改名` action.
  - loading/disabled guards for create and rename actions.
- Reused the existing project PATCH API instead of adding another endpoint.
- Added `scripts/smoke-project-rename.mjs`.
- Added `npm run smoke:project-rename`.

### Verified In This Round

- `node --check scripts/smoke-project-rename.mjs`.
- `npx tsc --noEmit`.
- `npm run smoke:project-rename`.
- `npm run smoke:project-state`.
- `npm run smoke:project-review-history`.
- `npm run smoke:batch-archive-cleanup`.
- `npm run smoke:demo-state`.
- `npm run build`.
- Browser DOM verification on `http://127.0.0.1:3461/canvas` with a temporary project/campaign confirmed:
  - `项目批次`.
  - `项目显示名`.
  - `Campaign`.
  - `活动显示名`.
  - `新项目名`.
  - `当前项目下的新活动`.
  - `改名`.
  - temporary project/campaign names.
  - the temporary project/campaign were deleted afterward, then `npm run smoke:demo-state` passed again.

### Notes

- No real image-provider call was made in this round.
- The build still emits the known multiple-lockfile workspace-root warning.

### Current State After Round 54

- Project/campaign organization can now be created and maintained from the canvas inspector.
- The workbench is closer to a usable MVP operator surface: project, campaign, batch, queue, review, export-pack state, and archive cleanup are all visible in one place.

### Next Execution Order

1. Continue mobile/responsive polish for the right inspector and review/export panels.
2. Add a small batch real-provider smoke with 2-3 images only after another explicit API-spend check.

## 71. Implementation Update: 2026-05-16 Round 55

### Completed

- Polished the canvas workbench responsive layout:
  - mobile/narrow screens no longer inherit the desktop fixed-width grid.
  - canvas toolbar/header wraps instead of clipping.
  - asset library and inspector panels scroll within their regions.
  - queue metrics, export-pack cards, project review metrics, and batch actions wrap more cleanly.
- Added `apiFetch` in `components/canvas/visual-workbench.tsx`:
  - uses native `window.fetch` when available.
  - falls back to `XMLHttpRequest` when available.
  - returns a clear browser-network-API error when neither API exists.
- Ran a confirmed one-call real product-reference image smoke.

### Verified In This Round

- `npx tsc --noEmit`.
- `npm run smoke:real-image-edit-batch`.
- `npm run smoke:project-rename`.
- `npm run smoke:batch-archive-cleanup`.
- `npm run smoke:project-state`.
- `npm run smoke:demo-state`.
- `npm run build`.
- Playwright desktop verification on `http://127.0.0.1:3461/canvas` after dev-server restart confirmed project, queue, provider, export-pack, and QA data loaded.
- Playwright mobile verification at `390x844` confirmed no horizontal page overflow.

### Evidence

- Real single image output: `/Users/lichenhao/Desktop/image master/test_artifacts/api-smoke/real-image-edit-batch-smoke-2026-05-16T09-36-34-789Z.png`.
- Real single image report: `/Users/lichenhao/Desktop/image master/test_artifacts/api-smoke/real-image-edit-batch-smoke-2026-05-16T09-36-34-789Z.json`.

### Notes

- The in-app browser environment had neither `fetch` nor `XMLHttpRequest`, so it cannot fully exercise client-side API loading. Playwright Chromium was used for actual browser verification.
- A stale Next dev server caused `_next/static` chunk 404s during verification; restarting the dev server fixed hydration.

## 72. Implementation Update: 2026-05-16 Round 56

### Completed

- Added provider cost confirmation to `app/api/images/generate/batch/route.ts`:
  - real runs require `confirmedProviderCallLimit`.
  - unconfirmed real runs are rejected before any provider call.
  - dry-runs now expose `providerCallCount`, `maxProviderCallCount`, `retryPolicy`, and guardrails.
- Hardened product-reference batch behavior:
  - product-reference image generation now runs sequentially.
  - `EMPTY_RESULT` responses retry once per image, only within the confirmed call budget.
  - responses report `providerCallCountUsed`, `retryCount`, and `retryCounts`.
- Updated generation entrypoints to dry-run before real calls:
  - `components/generate/generate-button.tsx`.
  - `components/generate/ai-chat.tsx`.
- Added `scripts/smoke-real-plan-batch.mjs`.
- Added `npm run smoke:real-plan-batch`.

### Verified In This Round

- `node --check scripts/smoke-real-plan-batch.mjs`.
- `node --check scripts/smoke-real-image-edit-batch.mjs`.
- `node --check scripts/smoke-generation-safety.mjs`.
- `npx tsc --noEmit`.
- `npm run smoke:generation-safety`.
- `npm run build`.

### Provider Findings

- Single product-reference image generation is confirmed working.
- The 2-image product-reference batch still hits provider `EMPTY_RESULT` instability:
  - latest report: `/Users/lichenhao/Desktop/image master/test_artifacts/api-smoke/real-plan-batch-smoke-2026-05-16T11-33-55-336Z.json`.
  - latest successful partial hero: `/Users/lichenhao/Desktop/image master/test_artifacts/api-smoke/real-plan-batch-smoke-2026-05-16T11-33-55-336Z-1-hero.png`.
  - earlier successful partial detail: `/Users/lichenhao/Desktop/image master/test_artifacts/api-smoke/real-plan-batch-smoke-2026-05-16T11-28-29-211Z-2-detail.png`.
  - latest run used 3 provider calls: 2 initial calls plus 1 retry.

### Current State After Round 56

- The app now has real cost guards for provider calls.
- The remaining batch blocker is provider empty-result stability and partial-output recovery, not local state or queue plumbing.

### Next Execution Order

1. Add partial-batch recovery UI and persistence: keep successful images, show failed items, and retry only failed outputs.
2. Add provider adapter diagnostics for empty responses without leaking secrets.
3. Expand commercial channel templates once partial-batch recovery is visible in the workbench.

## 73. Implementation Update: 2026-05-16 Round 57

### Completed

- Added partial-result fields to `GeneratedImage`:
  - `prompt`.
  - `error`.
  - `errorCode`.
- Updated `/api/images/generate/batch` to include each image prompt in success and failure payloads.
- Updated the legacy result UI:
  - failed images show provider error and error code.
  - partial batches show a `PARTIAL` status.
  - download-all skips failed images.
  - failed items can be retried one at a time.
  - single-item retry performs dry-run first and confirms provider-call budget before the real call.

### Verified In This Round

- `npx tsc --noEmit`.
- `npm run smoke:generation-safety`.
- `npm run smoke:demo-state`.
- `npm run build`.

### Notes

- The single-item retry button can trigger real provider calls, so it was not clicked during automated verification.
- This round handles partial recovery in the session result UI. Canvas/project persistence still needs the same partial-result behavior.

### Next Execution Order

1. Persist partial provider results into project batches and generated artifacts.
2. Add canvas-side retry for failed batch items only.
3. Add provider adapter diagnostics for empty responses.
4. Continue commercial template expansion.

## 74. Implementation Update: 2026-05-16 Round 58

### Completed

- Added persistent partial-batch handling for `POST /api/images/generate/batch`.
- Created `lib/store/batch-generation-persistence.ts`:
  - successful batch items are stored through `storeOutputImage`.
  - successful items create `generated_artifacts`.
  - failed items create failed `generation_jobs`.
  - project-batch metadata records `partialResult`, `successCount`, `failedCount`, `jobIds`, and `artifactIds`.
- Added a default-off mock result path for non-provider smoke tests:
  - enabled only by `IMAGE_MASTER_ENABLE_MOCK_BATCH=1`.
- Added `scripts/smoke-batch-persistence.mjs`.
- Added `npm run smoke:batch-persistence`.
- Added a canvas project-batch partial-result label.

### Verified In This Round

- `node --check scripts/smoke-batch-persistence.mjs`.
- `npx tsc --noEmit`.
- `npm run smoke:batch-persistence`.
- `npm run smoke:generation-safety`.
- `npm run smoke:demo-state`.
- DB residue check for `smoke_batch_persist_%`: `0` batches, `0` jobs, `0` artifacts after cleanup.
- `npm run build`.
- Browser verification on `http://127.0.0.1:3461/canvas` confirmed project, queue, and provider data loaded with no console errors.

### Current State After Round 58

- Partial batch outputs no longer have to be lost just because one item fails.
- The canvas can now display partial-result metadata at the project-batch level.
- The next missing piece is a canvas action that retries only failed items in a persisted partial batch.

### Next Execution Order

1. Add canvas-side retry for failed batch items only.
2. Add provider adapter diagnostics for empty responses.
3. Expand commercial channel templates.

## 75. Implementation Update: 2026-05-16 Round 59

### Completed

- Added persisted product-reference storage for batch generation:
  - `POST /api/images/generate/batch` passes `productImageBase64` into persistence.
  - `lib/store/batch-generation-persistence.ts` stores the reference image once per batch.
  - batch jobs and project batches now carry `referenceImageUrl` and `referenceImageStorage`.
- Added output-image readback support:
  - `readOutputImageAsDataUrl(publicUrl)` reads locally stored generated images back into provider-ready data URLs.
- Added persisted failed-item image retry:
  - new endpoint: `POST /api/jobs/[id]/retry-image`.
  - supports `dryRun=true`.
  - requires `confirmedProviderCallLimit` before real provider work.
  - supports mock results only under `IMAGE_MASTER_ENABLE_MOCK_BATCH=1`.
  - on success, stores the image, creates an artifact, marks the job done, and recomputes project-batch `successCount`, `failedCount`, `partialResult`, `jobIds`, and `artifactIds`.
  - on failure, leaves the job failed and records retry error metadata.
- Added a canvas task-card button for failed batch-image jobs:
  - icon action title: `带参考图重试失败图片`.
  - performs dry-run first, then sends the confirmed provider-call cap.
- Added `scripts/smoke-batch-item-retry.mjs`.
- Added `npm run smoke:batch-item-retry`.
- Updated `scripts/smoke-batch-persistence.mjs` to verify reference-image metadata and clean up generated reference files.

### Verified In This Round

- `node --check scripts/smoke-batch-item-retry.mjs`.
- `node --check scripts/smoke-batch-persistence.mjs`.
- `npx tsc --noEmit`.
- `npm run smoke:batch-persistence`.
- `npm run smoke:batch-item-retry`.
- `npm run smoke:generation-safety`.
- `npm run smoke:demo-state`.
- `npm run build`.
- Browser verification on `http://localhost:3461/canvas`:
  - canvas loaded.
  - console error log was empty.
  - screenshot artifact: `/Users/lichenhao/Desktop/image master/test_artifacts/browser-smoke/canvas-round59-1778940762925.png`.

### Notes

- This round intentionally did not run real provider/API image generation.
- The single failed-image retry button can call the real provider when clicked by an operator.

### Current State After Round 59

- The persisted partial-batch loop is now usable from the canvas:
  - saved successful images survive.
  - failed image jobs remain visible.
  - failed jobs can be retried one by one.
  - successful retries repair the project-batch counts and artifact list.

### Next Execution Order

1. Add provider adapter diagnostics for empty image responses.
2. Expand commercial templates for Amazon, Taobao, Xiaohongshu, poster, model display, and detail-page packs.
3. Polish the focused export-pack panel so failed-item counts and retry affordances are easier to see.

## 76. Implementation Update: 2026-05-16 Round 60

### Completed

- Added a safe provider diagnostics module:
  - `lib/ai/image-provider-diagnostics.ts`.
  - builds a provider-response shape summary for image generation calls.
  - normalizes diagnostics through a whitelist so unknown fields are dropped.
- Extended `AIError` in `lib/ai/client.ts` with optional diagnostics.
- Updated `generateSingleImage`:
  - records diagnostics for non-OK provider responses.
  - records diagnostics for `EMPTY_RESULT`.
  - keeps prompt text, image data, API keys, request headers, and raw response payloads out of diagnostics.
- Updated `generateBatchImages`:
  - batch image errors now preserve sanitized diagnostics.
- Updated `POST /api/images/generate/batch`:
  - failed image payloads can include diagnostics.
  - mock diagnostics are normalized through the same whitelist under `IMAGE_MASTER_ENABLE_MOCK_BATCH=1`.
- Updated `lib/store/batch-generation-persistence.ts`:
  - failed batch jobs now persist `metadata.providerDiagnostics`.
- Updated `POST /api/jobs/[id]/retry-image`:
  - retry failures persist `metadata.providerDiagnostics`.
  - retry failure responses expose only sanitized diagnostics.
- Added `scripts/smoke-provider-diagnostics.mjs`.
- Added `npm run smoke:provider-diagnostics`.

### Diagnostics Fields

- `mode`: `text_to_image` or `image_to_image`.
- `endpoint`: `/images/generations` or `/images/edits`.
- `providerHost`, `model`, `status`, `ok`, `contentType`, `requestId`.
- `promptChars` and optional `referenceImageBytes`.
- `responseShape`:
  - top-level type and keys.
  - `data` type and length.
  - first `data` item type and keys.
  - booleans for `firstDataHasB64Json`, `firstDataHasUrl`, and `firstDataHasRevisedPrompt`.
  - safe provider error `type/code` when present.

### Verified In This Round

- `node --check scripts/smoke-provider-diagnostics.mjs`.
- `npx tsc --noEmit`.
- `npm run smoke:provider-diagnostics`.
- `npm run smoke:generation-safety`.
- `npm run smoke:batch-item-retry`.
- `npm run smoke:demo-state`.
- `npm run smoke:batch-persistence`.
- `npm run build`.

### Notes

- The provider diagnostics smoke intentionally injects forbidden fields such as `SECRET_API_KEY`, `rawPayload`, and `requestHeaders`; the persisted diagnostics drop them.
- This round did not run real provider/API image generation.

### Current State After Round 60

- The next real `EMPTY_RESULT` failure can be investigated from job metadata without exposing secrets.
- We should be able to distinguish:
  - empty `data`.
  - first `data` item missing both `b64_json` and `url`.
  - provider returning only `revised_prompt`.
  - non-JSON or unexpected top-level response shape.

### Next Execution Order

1. Inspect diagnostics from the next real provider failure and decide whether a provider-specific adapter patch is needed.
2. Continue commercial templates for Amazon, Taobao, Xiaohongshu, poster, model display, and detail-page packs.
3. Improve export-pack panel visibility for failed item counts and one-click retry actions.

## 77. Implementation Update: 2026-05-16 Round 61

### Completed

- Converted image-bearing canvas nodes into image-first visual nodes:
  - product nodes.
  - model nodes.
  - scene nodes.
  - generated output and artifact-history nodes.
- Kept non-visual operational nodes compact:
  - factory/brief nodes.
  - review nodes.
  - platform/rule-like nodes when not acting as output packages.
- Extended `components/canvas/asset-preview.tsx`:
  - added `node` and `nodeTall` preview sizes.
  - added `fit="contain"` so product and generated references are inspectable instead of cropped.
- Updated `components/canvas/workflow-node.tsx`:
  - visual nodes now render a large image plane with badges overlaid on the image.
  - compact nodes keep the old thumbnail-left layout.
- Updated canvas layout defaults for larger image nodes in `lib/canvas/workbench-data.ts`.
- Added `VISUAL_NODE_LAYOUT_VERSION` to saved workflow metadata.
- Added a one-time migration for older saved canvas workflows without `visualNodeLayoutVersion`.
- Adjusted artifact result-node placement so restored generated outputs do not stack on top of the main workflow.

### Verified In This Round

- `npx tsc --noEmit`.
- Browser verification on `http://localhost:3461/canvas`:
  - image nodes render real previews.
  - console error log was empty.
  - screenshot: `/Users/lichenhao/Desktop/image master/test_artifacts/browser-smoke/canvas-image-nodes-final-1778946221285.png`.
- `npm run smoke:demo-state`.
- `npm run build`.

### Current State After Round 61

- The canvas is now visually inspectable:商品图、模特图、场景图和输出图不再只是 tiny thumbnails inside cards.
- The main remaining UX gap is the export-pack/batch panel: outputs, failed items, retry actions, and status counts should become more visible and less buried in task cards.

## 78. Implementation Update: 2026-05-17 Round 62

### Completed

- Added a focused batch image panel inside the right inspector's export-pack section.
- The panel now turns each manifest item into a production-facing image card:
  - ready items show the generated image thumbnail.
  - failed items show a red state and a readable failure reason.
  - missing-artifact items show a yellow state.
  - queued/running/planned items show a waiting state.
- Wired retryable failed image jobs into the existing `onRetryImageJob` action with a visible "带参考图重试" button.
- Added a safe provider diagnostics formatter for inspector display:
  - supports sanitized `providerDiagnostics` objects from batch generation and retry-image failures.
  - shows provider response structure such as code, endpoint, provider host, data length/type, and first data keys.
- Kept this slice on existing data only:
  - `focusedBatch`.
  - `focusedManifest`.
  - `focusedQaReport`.
  - `jobs`.
  - `artifacts`.
  - `exportPackImageInfoByUrl`.
- Completed a read-only implementation map for the next reference-context slice:
  - canvas job creation currently creates prompt/metadata but does not pass model/style/scene references into the provider path.
  - next minimum patch should store `referenceImages` and `referenceContext` in job metadata, enrich prompts, and let `job-runner` pass a product reference data URL into `generateSingleImage`.

### Verified In This Round

- `npx tsc --noEmit`.
- `npm run smoke:demo-state`.
- `npm run smoke:batch-item-retry`.
- `npm run smoke:generation-safety`.
- `npm run smoke:provider-diagnostics`.
- `npm run smoke:workflow-compose`.
- `npm run build`.
- Browser verification on `http://127.0.0.1:3461/canvas`:
  - export-pack image panel rendered in the inspector.
  - no app runtime error was observed; dev-mode console only showed Next HMR WebSocket connection logs.
  - screenshot: `/Users/lichenhao/Desktop/image master/test_artifacts/browser-smoke/export-pack-image-panel-round62-1778947791052.png`.

### Current State After Round 62

- Export-pack review is now image-first enough for demo and partial-failure debugging.
- The next P0 gap is no longer UI visibility; it is generation semantics:
  - product reference should flow into canvas job runner image-to-image.
  - model/style/scene components should flow into prompt constraints and metadata.
  - multi-reference provider support should remain P1 until provider behavior is confirmed.

## 79. Implementation Update: 2026-05-17 Round 63

### Completed

- Added `lib/canvas/generation-reference-context.ts`.
- Standardized reference data around four roles:
  - product.
  - model.
  - style.
  - scene.
- Canvas job creation now collects upstream/reference nodes and writes:
  - `referenceImages`.
  - `referenceContext`.
  - `referenceImageUrl`.
  - `usesProductReference`.
- Canvas prompts now receive a compact `Reference context:` block:
  - product rules preserve structure, material, color, logo regions, and proportions.
  - model rules can carry identity anchors and consistency rules.
  - style rules can carry prompt fragments, constraints, negative rules, and parameters.
  - scene rules can carry placement and environment constraints.
- Export-pack planned jobs now inherit the same reference context instead of being only platform/spec prompts.
- Component drops now preserve generation-relevant metadata in canvas nodes:
  - `parameters`.
  - `promptFragments`.
  - `constraints`.
  - `negativeRules`.
  - `qualityRules`.
- Background job runner now uses the product reference when safe:
  - inline `data:image/...` references are passed through.
  - `/api/generated-images/...` references are read back as data URLs.
  - static SVG/demo assets and arbitrary remote URLs are not passed into provider image edit.
- Runner outputs now keep reference metadata on assets, artifacts, and completed jobs.
- Runner failure handling now preserves safe `AIError` provider diagnostics when available.

### Verified In This Round

- `npx tsc --noEmit`.
- UI job-create smoke on `http://127.0.0.1:3461/canvas`:
  - created a job from the canvas without running provider.
  - confirmed `referenceContext` and `referenceImages` in SQLite metadata.
  - confirmed prompt contained `Reference context:`.
  - confirmed the static demo SVG was not marked provider-usable.
  - deleted the temporary smoke job.
- `npm run smoke:demo-state`.
- `npm run smoke:generation-safety`.
- `npm run smoke:workflow-compose`.
- `npm run smoke:durable-queue`.
- `npm run smoke:provider-diagnostics`.
- `npm run build`.
- Browser verification on `http://127.0.0.1:3461/canvas`:
  - canvas rendered.
  - queue affordance rendered.
  - export-pack image panel rendered.
  - console error log was empty.
  - screenshot: `/Users/lichenhao/Desktop/image master/test_artifacts/browser-smoke/reference-context-round63-1778949878243.png`.

### Current State After Round 63

- The MVP no longer treats canvas components as labels only; they are now generation context.
- P0 reference flow is intentionally conservative:
  - product image-to-image uses only safe local or inline references.
  - model/style/scene stay as prompt/metadata constraints.
- The next practical step is a mock or real local generated product-reference job to prove the runner uses `/api/generated-images/...` references before spending real provider calls.

## 80. Implementation Update: 2026-05-17 Round 64

### Completed

- Added a no-provider reference smoke for the background runner:
  - new script: `scripts/smoke-job-runner-reference.mjs`.
  - new npm script: `npm run smoke:job-runner-reference`.
  - seeds a local `/api/generated-images/...` product reference.
  - creates a canvas-style generation job through `/api/jobs`.
  - runs the job through `/api/jobs/[id]/run` and the durable queue.
  - enables `IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER=1`, so no real provider call occurs.
- Added a gated mock path inside `lib/store/job-runner.ts`:
  - `IMAGE_MASTER_ENABLE_MOCK_JOB_RUNNER=1` returns a tiny local PNG.
  - `IMAGE_MASTER_MOCK_JOB_RUNNER_REQUIRE_REFERENCE=1` fails the smoke if the runner did not receive a product reference.
- Tightened reference metadata preservation:
  - generated artifacts keep the enriched prompt with `Reference context:`.
  - completed jobs, output assets, and artifacts keep `usesProductReference`, `referenceImageUrl`, `referenceImages`, and `referenceContext`.
- Added selected-node reference visibility in the right inspector:
  - product/model/style/scene roles are visible before job creation.
  - image and rule counts are visible before job creation.
  - product references are labeled as provider-usable or prompt-only.

### Verified In This Round

- `node --check scripts/smoke-job-runner-reference.mjs`.
- `npx tsc --noEmit`.
- `npm run smoke:job-runner-reference`.
- `npm run smoke:demo-state`.
- `npm run smoke:generation-safety`.
- `npm run smoke:batch-item-retry`.
- `npm run smoke:provider-diagnostics`.
- `npm run build`.
- Browser verification on `http://127.0.0.1:3461/canvas`:
  - `生成引用`, `生成安全`, and `队列状态` rendered.
  - browser error log count was `0`.
  - screenshot: `/Users/lichenhao/Desktop/image master/test_artifacts/browser-smoke/reference-panel-round64-1778981910567.png`.

### Current State After Round 64

- The app can now verify local product-reference handoff in the job runner without spending API calls.
- The UI now shows reference readiness before the user creates a generation job.
- The next real-provider smoke can focus on provider-specific behavior, especially whether multi-image/product-reference batch instability still returns `EMPTY_RESULT`.

## 81. Implementation Update: 2026-05-17 Round 65

### Completed

- Extended reference readiness from the selected-node inspector into export-pack batch image cards.
- Each visible batch image item now exposes:
  - product-reference state: `商品图 provider`, `商品图 prompt`, or `无商品图`.
  - image count and provider-usable reference count.
  - reference rule count.
  - product/model/style/scene role chips when structured metadata exists.
  - provider diagnostic summary for failed or missing items.
- Added dev-server watch hygiene in `next.config.ts`:
  - ignores `.data`, `.playwright-mcp`, `test_artifacts`, PNGs, and ZIPs during dev watch.
  - avoids repeated Fast Refresh when smoke tests, browser tools, generated files, or screenshots write project artifacts.
- No real provider/API image calls were run.

### Verified In This Round

- `npx tsc --noEmit`.
- `npm run smoke:batch-item-retry`.
- `npm run smoke:provider-diagnostics`.
- `npm run smoke:demo-state`.
- `npm run smoke:job-runner-reference`.
- `npm run build`.
- Browser/Playwright verification on `http://127.0.0.1:3461/canvas`:
  - no runtime error overlay after dev-server restart.
  - `生成引用`, `导出包批次`, `图片项`, and `无商品图` rendered in DOM.
  - screenshot: `/Users/lichenhao/Desktop/image master/test_artifacts/browser-smoke/batch-reference-strip-round65-playwright.png`.

### Current State After Round 65

- Export-pack image debugging now combines image preview, retry entry, provider diagnostics, and reference readiness.
- Dev verification is quieter because smoke artifacts no longer cause watcher churn.
- The next valuable step is to add a real-provider guarded smoke for one export-pack item using a local generated product reference, then inspect whether provider diagnostics still show `EMPTY_RESULT`.
