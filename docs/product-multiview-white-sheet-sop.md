# Product Multi-View White Sheet SOP

This is the canonical product onboarding prompt for Image Master.

Use it when the user uploads one or more photos of the same product, especially phone photos from front, side, back, top, bottom, or detail angles. The output should be one clean white-background multi-view product identity sheet. This sheet becomes the locked product reference for later main images, scene images, model holding/wearing images, posters, Amazon/Taobao images, and detail-page generation.

## Product Layer Rule

Product asset generation is only responsible for product identity.

It should preserve:

- silhouette and proportions
- material, color family, texture, transparency, gloss, or reflectivity
- construction details such as seams, handles, straps, zippers, ports, buttons, closures, soles, labels, and packaging geometry
- logo or brand regions when actually visible
- front, side, back, top/bottom, and key-detail evidence when references support them

It should not introduce:

- models, hands, bodies, scenes, tables, rooms, plants, lifestyle props, or marketing copy
- fake logos, fake labels, fake accessories, extra colorways, or extra product variants
- unsupported ports, seams, buttons, closures, straps, pockets, or packaging

## Current Prompt Family

`product.multiview-white-sheet.v1`

The implementation lives in:

`lib/ai/prompts/product-multiview.ts`

Product asset generation in:

`lib/canvas/asset-pack-generation.ts`

should keep using this prompt family by default for `product_asset`.

## Prompt Template

```text
Create one white-background multi-view product reference sheet for downstream commercial image generation.

Purpose:
- Consolidate the attached product reference photos into one clean product identity asset.
- The output is not a lifestyle ad, not a poster, and not a scene image. It is a reusable product reference sheet.
- Prioritize product identity accuracy over decorative styling.

User request: {userRequest}
Product category hint: {productCategoryHint}
Attached product references: {referenceCount} images of the same product from different angles.

Reference usage:
- Treat every attached image as the same physical product seen from different angles.
- Source photos may be casual phone snapshots, messy, unevenly lit, compressed, or taken in a real room. Use them only to extract the product identity; do not preserve the phone-photo background or accidental props in the final output.
- Cross-check all references to preserve silhouette, proportions, material, color family, construction details, buttons, seams, ports, labels, closures, straps, handles, texture, transparency, and logo/brand regions.
- Use the clearest reference for front identity, then use the other references to infer side, back, top, bottom, thickness, and detail views.
- If references conflict, prefer visible physical evidence and keep uncertain areas simple rather than inventing new features.

Output layout:
- One single 1024x1024 image on pure or near-pure white background.
- Show 4-6 views of the same product in a clean catalog-style arrangement.
- Recommended layout: largest front or 3/4 hero view in the center or left, plus smaller front, left side, right side, back, top/bottom, and detail/macro views arranged around it.
- Keep all views from the same product, same colorway, same material finish, and consistent scale.
- Use even studio lighting, soft contact shadows, crisp edges, and enough whitespace between views.
- No captions, no arrows, no labels, no UI panels, no measuring grid, no watermark, no decorative background.

Category adaptation:
- For hard goods, show front, 3/4, side, back, top, and one important functional detail.
- For bags, shoes, accessories, and apparel, show front, back, side/3/4, bottom or sole/base, material close-up, and closure/strap/detail view.
- For packaging or bottles, preserve label region and cap/closure geometry; do not invent unreadable brand text.
- For transparent, reflective, or glossy products, keep reflections controlled and product edges readable.

Negative rules:
- Do not add people, hands, model bodies, lifestyle props, scenes, room backgrounds, plants, tables, marketing copy, sale badges, fake logos, fake labels, extra accessories, or extra product variants.
- Do not turn one product into a product family or color set.
- Do not mirror asymmetric logos or text regions.
- Do not hallucinate ports, straps, seams, pockets, buttons, closures, handles, packaging, or labels that are not supported by the references.
- Do not crop off important parts of the product.

Quality target:
- Premium e-commerce product asset, accurate enough to become a locked product reference for later scene, model, poster, Amazon, Taobao, or detail-page image generation.
- Clean geometry, coherent perspective, stable product identity, realistic material, sharp details, and no visible text except real product marks that are clearly present in the references.

Return only the final single image.
```

## Verified Smoke

Validated with four casual phone-style handbag references:

- source sheet: `test_artifacts/api-smoke/bag-phone-reference-crops-2026-05-19T00-00-57-263Z-source-sheet.png`
- generated white sheet: `test_artifacts/api-smoke/product-multiview-white-sheet-2026-05-19T00-02-32-476Z.png`

The result correctly consolidated the same bag into a clean white-background product identity sheet with front, side, bottom, and hardware detail views.
