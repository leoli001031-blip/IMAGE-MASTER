# Image Master

Image Master is a local-first canvas workbench for commercial image generation.

The current direction is a blank-canvas production desk: start with an empty canvas, create asset boxes or template boxes from the canvas context menu, connect them into generation frames, then run and review outputs before saving anything into the reusable asset library.

## What It Does Now

- Blank React Flow canvas at `/canvas`, with right-click creation for asset boxes, template boxes, and generation frames.
- Asset library drawer for existing products, models, styles, scenes, platform rules, QA assets, and previously collected outputs.
- Canvas-first workflow composition: drop existing assets from the drawer, create new placeholders from the canvas, connect references, and generate from the frame.
- Generation outputs appear as reviewable results first; collect/save them into the asset library only after they are useful.
- Export pack and batch paths still exist for production packaging, but they are no longer the main first-run path.
- Batch outputs can expose manifest, QA report, and downloadable bundle endpoints when a pack flow is used.
- Completed images can receive lightweight manual QA review writeback.
- Job lifecycle supports pending, queued, running, done, failed, and cancelled states.
- The local job runner now has a bounded in-process queue snapshot endpoint.
- Jobs can be cancelled or retried from the canvas.
- Generated local files can be audited and cleaned with dry-run-first tooling.

## Tech Stack

- Next.js 15 + App Router + TypeScript
- React 19
- React Flow / `@xyflow/react` for the canvas
- Tailwind CSS
- SQLite via `better-sqlite3`
- Vercel AI SDK + OpenAI-compatible API

## Quick Start

```bash
npm install
cp env.example .env
npm run dev
```

Open:

- `http://localhost:3000/canvas` for the canvas workbench.
- `http://localhost:3000/settings` for API configuration.
- `http://localhost:3000/models` for model asset experiments.

For a production-style local smoke:

```bash
npm run build
npm start -- -p 3457
```

## Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `OPENAI_API_KEY` | API key | Required for real provider calls |
| `OPENAI_BASE_URL` | OpenAI-compatible API base URL | `https://api.openai.com/v1` |
| `VISION_MODEL` | Vision model for product analysis | `gpt-4o` |
| `IMAGE_MODEL` | Image generation model | `dall-e-3` |
| `TEXT_MODEL` | Text planning model | `gpt-4o` |
| `IMAGE_MASTER_MAX_BATCH_IMAGES` | Max images per batch generation request | `10` |
| `IMAGE_MASTER_JOB_CONCURRENCY` | Local job runner concurrency | `10` |

The canvas planning flow can be tested without running image generation. Avoid clicking job run buttons if you do not want provider calls.

## Useful Commands

```bash
npm run build
npm run typecheck
npm run verify:smoke:local
npm run demo:export-pack:dry-run
npm run demo:export-pack
npm run generated:cleanup
npm run generated:cleanup:delete
```

`demo:export-pack` creates a local completed demo batch with generated PNG fixtures. It does not call the image provider.

`generated:cleanup` scans `.data/generated/`, detects local generated-image files that are not referenced by SQLite records, and prints a JSON dry-run summary. `generated:cleanup:delete` deletes only safe orphan files.

## Main Routes

- `/canvas` - low-code image generation canvas.
- `/settings` - API and model settings.
- `/models` - model asset management experiments.
- `/result` - legacy generated-result view for temporary in-session results, with canvas-first empty state.
- `/` - redirects to `/canvas`.

## Current Demo Loop

1. Open `/canvas`.
2. Right-click the blank canvas to create an asset box, template box, or generation frame.
3. Open the asset library drawer only when you want to reuse an existing product, model, scene, rule, or collected output.
4. Connect product/model/style/template references into a generation frame.
5. Run the generation frame when you are ready to create output jobs.
6. Review generated results on the canvas.
7. Collect/save useful outputs into the asset library after review.
8. Use export-pack or batch controls only when you need manifests, QA reports, or bundle downloads.

This loop does not require a real image-generation call until you explicitly run jobs.

## Notes For Open Source Use

- The canvas engine is React Flow / xyflow, which fits a public open-source direction better than production-restricted whiteboard SDKs.
- Platform rules included here are practical starter defaults, not legal or marketplace compliance guarantees.
- Generated outputs and provider credentials stay local by default in `.data/` and `.env`.
- Before publishing a public demo, avoid committing `.data/`, `.env`, generated images, or private provider logs.

## Development Report

See [CANVAS_WORKFLOW_DEV_REPORT.md](./CANVAS_WORKFLOW_DEV_REPORT.md) for the full product research, architecture decisions, implementation rounds, verification notes, and remaining roadmap.
