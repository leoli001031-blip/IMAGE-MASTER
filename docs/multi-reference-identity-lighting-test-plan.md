# Multi-Reference Identity / Lighting Test Plan

This plan tests one specific failure mode:

> Preserve the model identity, but do not preserve the model reference's original studio lighting.

The current product image workflow uses four reference roles:

1. `PRODUCT_REFERENCE`: product identity, structure, material, hardware, logo region, scale.
2. `MODEL_IDENTITY_REFERENCE`: face geometry, facial proportions, hair, body type, posture language, temperament.
3. `SCENE_LIGHTING_REFERENCE`: room geometry, camera perspective, window direction, ambient light, shadow direction, contrast, occlusion.
4. `STYLE_FINISH_REFERENCE`: final commercial finish, color grade, lens feel, polish.

## Current Evidence

Already tested in `test_artifacts/api-smoke`:

| Case | Path | Notes |
| --- | --- | --- |
| `gpt-image-2 + full identity sheet` | `direct-mixed-reference-full-2026-05-19T16-22-12-499Z.png` | Stronger identity, stronger studio-face contamination. |
| `gpt-image-2 + neutral/soft reference` | `direct-mixed-reference-soft-2026-05-19T16-26-00-574Z.png` | Better scene lighting, weaker identity. |
| `gpt-5.5 + neutral/soft reference` | `direct-mixed-reference-soft-2026-05-19T16-40-12-679Z.png` | Better commercial composition, identity still weaker than full. |
| `gpt-5.5 + full identity sheet` | `direct-mixed-reference-full-2026-05-19T16-44-31-876Z.png` | Best current baseline: identity returns, studio-face contamination still present. |

Important: the `gpt-5.5` cases were run through a Responses-style image generation call via the configured provider gateway. They still emit `response.image_generation_call` events, so the practical gain is likely better planning / prompt rewriting before image generation, not pure language-model pixels.

## Assets

Default local inputs:

```text
test_artifacts/api-smoke/product-multiview-white-sheet-2026-05-19T00-02-32-476Z.png
test_artifacts/api-smoke/milan-runway-model-asset-eastern-europe-warsaw-couture-2026-05-18T20-29-15-235Z.png
test_artifacts/api-smoke/scene-main-asset-nordic-home-interior-2026-05-18T23-03-50-494Z.png
test_artifacts/api-smoke/style-reference-warm-lifestyle-photography.png
```

Prepare a downstream compositing model reference:

```bash
npm run prepare:model-neutral-reference
```

This writes:

```text
test_artifacts/api-smoke/model-neutral-identity-reference.png
test_artifacts/api-smoke/model-neutral-identity-reference.metadata.json
```

This is not the original archival identity sheet. It is a downstream reference designed to reduce white-card / close-up portrait transfer while preserving broad identity cues.

## Reference Role Contract

Use this exact contract in every provider test:

```text
REFERENCE ROLE CONTRACT

Image 1 = PRODUCT_REFERENCE.
Use it only for exact product identity: bag shape, proportions, material, hardware, stitching, handle structure, logo position, color, texture, and scale. Do not redesign the product.

Image 2 = MODEL_IDENTITY_REFERENCE.
Use it only for the person's identity: face geometry, facial proportions, hairstyle, body type, posture language, and overall temperament. Do not copy its original background, white backdrop, studio portrait lighting, frontal fill light, beauty retouching, skin gloss, eye-light pattern, close-up portrait-card composition, or clean catalog-shot lighting.

Image 3 = SCENE_LIGHTING_REFERENCE.
This is the lighting authority. Use it for room geometry, camera perspective, window direction, ambient light, shadow direction, shadow softness, contrast, depth, occlusion, and how light wraps around the subject and product.

Image 4 = STYLE_FINISH_REFERENCE.
Use it only for commercial photography finish: lens feel, color grade, contrast curve, polish, editorial quality, and final retouching level. Do not let it override product identity, model identity, or scene lighting.

Highest priority:
The final person, including face, neck, arms, hands, legs, hair, clothing, and skin, must be physically relit by Image 3's scene lighting. The model reference is identity-only, not lighting. The output must look like the model was actually photographed inside the scene, not composited from a studio portrait.
```

Negative constraints:

```text
Avoid: studio portrait lighting, white backdrop, catalog model sheet, beauty dish lighting, frontal fill light, floating face light, over-retouched face, plastic skin, isolated headshot look, inconsistent face lighting, mismatched shadows, pasted-on face, separate face exposure, product redesign, wrong bag hardware, wrong logo placement, unrealistic hand-bag contact, inconsistent leg shadows.
```

## First Test Round

Run only these first. Do not fan out to every provider until the first round is scored.

| ID | Provider / model | Model reference | Goal |
| --- | --- | --- | --- |
| A1 | OpenAI-compatible Responses, `gpt-5.5` | full identity sheet | Current best baseline. |
| A2 | OpenAI-compatible Responses, `gpt-5.5` | neutral identity reference | Test whether asset-format change reduces studio-face contamination. |
| A3 | OpenAI-compatible Responses, `gpt-image-2` | neutral identity reference | Test whether the stronger main model / planner matters. |
| A4 | A2 result + masked relighting edit | neutral identity reference | Test whether second-stage relighting can fix remaining face/body mismatch. |
| B1 | FLUX.2 Pro / Max | neutral identity reference | Test multi-reference handling. |
| B2 | Gemini 3 Pro Image / Nano Banana Pro | neutral identity reference | Test professional multi-image reasoning. |
| B3 | Qwen Image Edit Max / Qwen Image 2.0 Pro | neutral identity reference | Test multi-image edit fusion. |
| B4 | Seedream 4.0 / 4.5 | neutral identity reference | Test Chinese/Asian provider multi-reference consistency. |
| C1 | Runway Gen-4 References | neutral identity reference | Test character consistency across treatment / lighting. |

Current repo can directly run A1/A2/A3 through:

```bash
IMAGE_MODEL=gpt-5.5 DIRECT_MIXED_REF_MODEL_MODE=full npm run smoke:direct-mixed-reference
IMAGE_MODEL=gpt-5.5 DIRECT_MIXED_REF_MODEL_MODE=neutral npm run smoke:direct-mixed-reference
IMAGE_MODEL=gpt-image-2 DIRECT_MIXED_REF_MODEL_MODE=neutral npm run smoke:direct-mixed-reference
```

The script records prompt, raw SSE payload, response id, image-generation call ids, revised prompt when present, and output image path.

## A4 Relighting Edit Prompt

Use after A2 if the image has good identity but face/body lighting is still contaminated.

```text
Relight only the masked human areas so they match the scene lighting exactly. Preserve the same person's identity, face shape, facial proportions, expression, hairstyle, body shape, pose, product, clothing, background, camera angle, and composition. Remove any remaining studio portrait lighting, frontal face fill, beauty-card look, or separate face exposure. The masked areas must share the same window light direction, ambient fill, shadow softness, contrast, and color temperature as the room.
```

Mask area:

```text
face, neck, arms, hands, legs, hair edges, skin highlights, black-clothing highlight regions
```

## Scoring

Score every image from 0 to 5.

| Metric | Meaning |
| --- | --- |
| `model_identity_consistency` | Face geometry, facial proportions, hair, body shape, temperament. |
| `product_fidelity` | Product shape, material, hardware, logo region, scale. |
| `scene_lighting_match` | Face, body, legs, product obey window light, ambient fill, shadow direction. |
| `studio_contamination` | Lower is better. White-card face, beauty lighting, separate face exposure. |
| `physical_integration` | Contact shadows, scale, perspective, hand/product contact. |
| `commercial_finish` | Real commercial editorial photograph, not collage / AI composite. |

Pass threshold:

```text
model_identity_consistency >= 4
product_fidelity >= 4
scene_lighting_match >= 4
physical_integration >= 4
commercial_finish >= 4
studio_contamination <= 1.5
```

## Output Naming

Use:

```text
provider_group_asset_prompt_iteration_score.png
```

Example:

```text
openai_A2_neutral_identity_role_contract_v1_score_4-4-4-1-4.png
```

## Provider Expansion Questions

Ask every provider or gateway these before judging quality:

1. Is the request routed to Responses + image generation tool, or directly to images/edit/generate?
2. What is the main model field?
3. What is the final image-generation model, if visible?
4. Can it return `revised_prompt`?
5. Are reference image order and role labels preserved?
6. Can different references have role / weight / strength / mask / region controls?
7. Can one image be treated as base image while others are references?
8. Does it support masked second-stage relighting?

## Final Decision Questions

After first round, answer only:

1. What is the most usable current chain?
2. Does `model-neutral-identity-reference.png` outperform the full identity sheet for downstream compositing?
3. Do we need second-stage relighting / mask edit / local PuLID + IC-Light style control?
