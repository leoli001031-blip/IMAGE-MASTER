# Image Master

Image Master is a local-first Agent workbench for commercial image generation.

The current direction is simple: a project, a reusable asset library, an infinite canvas for visual results, and one Agent input that plans and runs the work. Generation frames still exist as internal task objects, but they should not be the main user-facing interaction.

## What It Does Now

- Project-oriented canvas at `/canvas`: open a project, add or reuse assets, then let the Agent plan image sets.
- Top-right Agent controller: users describe what they want in natural language; the Agent decides shots, ratios, references, copy policy, and job structure.
- Bottom asset library: view, upload, drag out, rename, favorite, delete, and save good outputs back as reusable assets.
- Infinite canvas result wall: generated images are laid out by real aspect ratio and grouped by use, such as main images, posters, detail images, model images, scene images, and copy images.
- Click any image to inspect the large image, prompt, reference plan, provider metadata, diagnostics, retry actions, and "save as asset".
- Background job queue supports queued, running, done, failed, cancelled, stale reclaim, partial batch save, and per-image retry.
- Local generated files can be audited and cleaned with dry-run-first tooling.
- Export pack and review endpoints still exist, but they are advanced paths rather than the first-run workflow.

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

## Electron

The Electron build uses a standalone Next.js server bundled into `dist-electron/app-server`.

```bash
npm run build:standalone
npm run electron:prepare-server
npm run electron
```

For a private local package that includes your current `.env`:

```bash
npm run electron:build:dir
npm run electron:build:dmg
```

`build:standalone` writes to `.next-standalone-build/` so it does not fight with a running dev server on `.next/`. Runtime data for the Electron app is written to the Electron user-data directory, not the repo `.data/` folder.

To verify the bundled Electron server without opening the desktop shell:

```bash
npm run verify:electron
```

## Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `OPENAI_API_KEY` | Global fallback API key | Required for real provider calls |
| `OPENAI_BASE_URL` | OpenAI-compatible API base URL. Demo primary: `https://slb.apikey.fun/v1`; backup: `https://api.apikey.fun/v1` | `https://slb.apikey.fun/v1` |
| `VISION_MODEL` / `VISION_API_KEY` / `VISION_BASE_URL` | Vision analysis model and optional dedicated provider config | falls back to global config |
| `IMAGE_MODEL` / `IMAGE_API_KEY` / `IMAGE_BASE_URL` | Image generation model and optional dedicated provider config | falls back to global config |
| `TEXT_MODEL` / `TEXT_API_KEY` / `TEXT_BASE_URL` | Agent planning and prompt-writing model config | falls back to global config |
| `IMAGE_MASTER_MAX_BATCH_IMAGES` | Max images per batch generation request | `10` |
| `IMAGE_MASTER_JOB_CONCURRENCY` | Local job runner concurrency | `10` |
| `IMAGE_MASTER_IMAGE_TIMEOUT_MS` | Image call timeout for long provider responses | `900000` |
| `IMAGE_MASTER_DISABLE_AGENT_PLAN_LLM` | Emergency fallback switch for plan Agent | unset |
| `IMAGE_MASTER_DISABLE_AI_PROMPT_WRITER` | Emergency fallback switch for prompt Agent | unset |

See `env.example` for the full list. Real image generation can spend provider credits; plan-only and smoke scripts are safer for development.

Demo recording checklist: [`docs/demo-recording-runbook.md`](docs/demo-recording-runbook.md).

## Useful Commands

```bash
npm run build
npm run build:standalone
npm run electron:prepare-server
npm run typecheck
npm run verify:smoke:local
npm run verify:trial
npm run verify:electron
npm run smoke:agent-plan-20
npm run smoke:canvas-result-wall-50
npm run demo:export-pack:dry-run
npm run demo:export-pack
npm run generated:cleanup
npm run generated:cleanup:delete
```

`demo:export-pack` creates a local completed demo batch with generated PNG fixtures. It does not call the image provider.

`generated:cleanup` scans `.data/generated/`, detects local generated-image files that are not referenced by SQLite records, and prints a JSON dry-run summary. `generated:cleanup:delete` deletes only safe orphan files.

## Demo Closeout

For the current internal demo script, fixed sample output, pre-demo checklist, known risks, and follow-up list, see [docs/demo-closeout-guide.md](./docs/demo-closeout-guide.md).

Short version: the app is ready for an internal demo closeout, but not yet for a public trial. Use the saved sample set or plan-only checks for stable demos; run real provider generation only when the key and upstream provider are known to be healthy.

## User Guide

For a complete Chinese usage guide covering startup, API configuration, project flow, asset types, Agent prompts, copy burn-in, reference-image rules, troubleshooting, and verification commands, see [docs/user-guide.md](./docs/user-guide.md).

## Demo Video Skills

For a reusable cross-project Codex Skills plan for recording and packaging project showcase videos, see [docs/demo-video-skills-plan.md](./docs/demo-video-skills-plan.md).

For the Image Master-specific showcase script, packaged app paths, recording storyboard, and demo safety boundaries, see [docs/image-master-project-showcase-plan.md](./docs/image-master-project-showcase-plan.md).

## Main Routes

- `/canvas` - low-code image generation canvas.
- `/settings` - API and model settings.
- `/models` - model asset management experiments.
- `/result` - legacy generated-result view for temporary in-session results, with canvas-first empty state.
- `/` - redirects to `/canvas`.

## Current Product Loop

1. Open `/canvas`.
2. Start from an empty project canvas.
3. Upload or generate assets: product, model, scene, style, copy, or knowledge references.
4. Ask the Agent for the image set you need, such as "make a Taobao detail-page set with model shots and copy burned into the poster images".
5. Review the Agent plan: shots, ratios, strong references, weak references, copy policy, and expected batch size.
6. Generate the set and watch jobs land on the canvas as a result wall.
7. Click images to inspect prompt/reference/provider details, retry one image, revise with a short instruction, or save it as a reusable asset.
8. Open the local output folder when you want to copy deliverables.

This loop does not require a real image-generation call until you explicitly run jobs.

## Sample Project Templates

The `/projects` page offers three starter templates:

- 淘宝详情页图组
- 模特多场景宣传图
- 跨平台上市套图

They only save an Agent starter prompt and onboarding hints. They do not auto-populate the canvas, do not create demo nodes, and do not attach seeded asset references.

## Testing Without Spending API Credits

Use this first before calling the product internally trialable:

```bash
npm run verify:trial
```

`verify:trial` does not call the real image provider. It covers the current first-run path: empty canvas entry, project templates, project canvas persistence, scoped API polling, a 50-image result wall, click-to-revise context, output metadata, save-result-as-asset metadata, and mock per-image retry/regenerate with original references and prompt preserved.

For narrower checks while changing planning, reference routing, or result rendering:

```bash
npm run verify:agent-plan
npm run smoke:agent-plan-20
npm run smoke:agent-output-scenarios
npm run smoke:canvas-entry-surface
npm run smoke:canvas-result-nodes
npm run smoke:canvas-result-wall-50
```

`verify:agent-plan` runs the 20+ scenario plan-only suite. It uses the configured text Agent/LLM and does not start image generation jobs, so it is the right check for natural-language planning, matrix splitting, reference roles, and copy burn-in policy.

`smoke:canvas-result-wall-50` seeds a temporary 50-image project, checks thumbnail/original metadata, and cleans itself up unless run with `-- --keep`.

For the current MVP acceptance shape, use the three-project acceptance harness:

```bash
npm run smoke:real-acceptance-projects
```

By default this is plan-only: it checks the three required project families without calling the image provider:

- product-only image set
- product + model image set
- product + model + scene + copy image set

Each project requests 12 planned outputs and verifies reference routing, copy burn-in policy, and missing-input status. To intentionally spend image provider credits and enqueue all 36 images, run:

```bash
npm run smoke:real-acceptance-projects:real -- --confirm-provider-calls 36
```

`smoke:real-acceptance-projects:real` always performs the plan preflight first, counts the planned provider calls, and refuses to enqueue image jobs unless the confirmation value exactly matches the planned count. To test that the guard is working without spending image credits:

```bash
npm run smoke:real-acceptance-projects:guard
```

Scripts named `smoke:real-*`, `smoke:direct-mixed-reference*`, or `smoke:scene-*` can spend provider credits. Run them only when intentionally testing a real provider.

For Electron runtime checks:

```bash
npm run build:standalone
npm run electron:prepare-server
IMAGE_MASTER_ELECTRON_USER_DATA_DIR="$PWD/.data-electron-smoke" IMAGE_MASTER_PORT=3467 npm run electron
```

The `IMAGE_MASTER_ELECTRON_USER_DATA_DIR` override is intended for local verification so Electron can be tested against an isolated runtime data directory.

## Notes For Open Source Use

- The canvas engine is React Flow / xyflow, which fits a public open-source direction better than production-restricted whiteboard SDKs.
- Platform rules included here are practical starter defaults, not legal or marketplace compliance guarantees.
- Generated outputs and provider credentials stay local by default in `.data/` and `.env`.
- Before publishing a public demo, avoid committing `.data/`, `.env`, generated images, or private provider logs.
- Do not expose the local settings API or bundled private `.env` builds to the public internet.

## Development Report

See [CANVAS_WORKFLOW_DEV_REPORT.md](./CANVAS_WORKFLOW_DEV_REPORT.md) for the full product research, architecture decisions, implementation rounds, verification notes, and remaining roadmap.
