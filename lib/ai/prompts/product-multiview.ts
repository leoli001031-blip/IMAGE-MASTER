export const PRODUCT_MULTIVIEW_WHITE_SHEET_PROMPT_FAMILY =
  "product.multiview-white-sheet.v1";

/**
 * Canonical product asset prompt.
 *
 * Use this for future product onboarding when the user supplies one or more
 * product photos. The generated image is a reusable white-background product
 * identity sheet, not a final campaign creative.
 */

export interface ProductMultiviewWhiteSheetPromptInput {
  userRequest?: string;
  referenceCount?: number;
  productCategoryHint?: string;
  viewCount?: number;
  outputSize?: string;
}

export function buildProductMultiviewWhiteSheetPrompt({
  userRequest,
  referenceCount = 0,
  productCategoryHint,
  viewCount = 6,
  outputSize = "1536x1024",
}: ProductMultiviewWhiteSheetPromptInput = {}): string {
  const safeViewCount = Math.max(4, Math.min(6, Math.floor(viewCount) || 6));
  const safeReferenceCount = Math.max(0, Math.floor(referenceCount) || 0);

  const hasReferences = safeReferenceCount > 0;

  return [
    "Create one white-background multi-view product reference sheet for downstream commercial image generation.",
    "",
    "Purpose:",
    "- Consolidate the attached product reference photos into one clean product identity asset.",
    "- The output is not a lifestyle ad, not a poster, and not a scene image. It is a reusable product reference sheet.",
    "- Prioritize product identity accuracy over decorative styling.",
    hasReferences
      ? "- Because source product photos are attached, product identity accuracy is mandatory."
      : "- No source product photo is attached. Treat this as a concept product mockup only, not a locked real-product identity sheet.",
    "",
    `User request: ${userRequest?.trim() || "Generate a clean multi-angle white-background product reference sheet."}`,
    productCategoryHint ? `Product category hint: ${productCategoryHint}.` : "",
    `Attached product references: ${hasReferences ? `${safeReferenceCount} images of the same product from different angles.` : "none. Do not claim this output matches a real uploaded product."}`,
    "",
    "Reference usage:",
    hasReferences
      ? "- Treat every attached image as the same physical product seen from different angles."
      : "- Since there is no real product photo, create only a plausible concept object from the text brief.",
    hasReferences
      ? "- Source photos may be casual phone snapshots, messy, unevenly lit, compressed, or taken in a real room. Use them only to extract the product identity; do not preserve the phone-photo background or accidental props in the final output."
      : "- Do not use the result as a source of truth for later commercial fidelity checks against a real item.",
    hasReferences
      ? "- Cross-check all references to preserve silhouette, proportions, material, color family, construction details, buttons, seams, ports, labels, closures, straps, handles, texture, transparency, and logo/brand regions."
      : "- Keep the design simple, internally consistent, and easy to replace later with uploaded real product photos.",
    hasReferences
      ? "- Use the clearest reference for front identity, then use the other references to infer side, back, top, bottom, thickness, and detail views."
      : "- Do not invent complex logos, hardware, stitching, seams, ports, labels, or closures beyond the brief.",
    hasReferences
      ? "- If references conflict, prefer visible physical evidence and keep uncertain areas simple rather than inventing new features."
      : "- Any uncertain view should stay conservative and generic rather than pretending to be factual.",
    "",
    "Output layout:",
    `- One single ${outputSize} image on pure or near-pure white background, using a wide reference-board layout when supported.`,
    `- Show ${safeViewCount} views of the same product in a clean catalog-style arrangement.`,
    "- Recommended layout: largest front or 3/4 hero view in the center or left, plus smaller front, left side, right side, back, top/bottom, and detail/macro views arranged around it.",
    "- Keep all views from the same product, same colorway, same material finish, and consistent scale.",
    "- Use even studio lighting, soft contact shadows, crisp edges, and enough whitespace between views.",
    "- No captions, no arrows, no labels, no UI panels, no measuring grid, no watermark, no decorative background.",
    "",
    "Category adaptation:",
    "- For hard goods, show front, 3/4, side, back, top, and one important functional detail.",
    "- For bags, shoes, accessories, and apparel, show front, back, side/3/4, bottom or sole/base, material close-up, and closure/strap/detail view.",
    "- For packaging or bottles, preserve label region and cap/closure geometry; do not invent unreadable brand text.",
    "- For transparent, reflective, or glossy products, keep reflections controlled and product edges readable.",
    "",
    "Negative rules:",
    "- Do not add people, hands, model bodies, lifestyle props, scenes, room backgrounds, plants, tables, marketing copy, sale badges, fake logos, fake labels, extra accessories, or extra product variants.",
    "- Do not turn one product into a product family or color set.",
    "- Do not mirror asymmetric logos or text regions.",
    "- Do not hallucinate ports, straps, seams, pockets, buttons, closures, handles, packaging, or labels that are not supported by the references.",
    "- Do not crop off important parts of the product.",
    "",
    "Quality target:",
    hasReferences
      ? "- Premium e-commerce product asset, accurate enough to become a locked product reference for later scene, model, poster, Amazon, Taobao, or detail-page image generation."
      : "- Premium concept product plate for early ideation only. It must be replaced by uploaded source photos before real-product commercial delivery.",
    "- Clean geometry, coherent perspective, stable product identity, realistic material, sharp details, and no visible text except real product marks that are clearly present in the references.",
    "",
    "Return only the final single image.",
  ]
    .filter(Boolean)
    .join("\n");
}
