import type {
  CreateWorkflowTemplateParams,
  UpdateWorkflowTemplateParams,
  WorkflowEdge,
  WorkflowNode,
  WorkflowTemplate,
  WorkflowTemplateCategory,
  WorkflowTemplateStatus,
} from "@/lib/types";
import "server-only";
import db from "./db";

const TEMPLATE_CATEGORIES = new Set<WorkflowTemplateCategory>([
  "model_display",
  "product_detail_page",
  "platform_output_pack",
  "poster_set",
  "quality_review",
]);

const TEMPLATE_STATUSES = new Set<WorkflowTemplateStatus>([
  "draft",
  "published",
  "archived",
]);

type WorkflowTemplateRow = Omit<WorkflowTemplate, "nodes" | "edges" | "metadata"> & {
  nodes: string;
  edges: string;
  metadata: string;
};

export interface WorkflowTemplateListFilters {
  category?: WorkflowTemplateCategory;
  status?: WorkflowTemplateStatus;
}

function parseArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function serializeArray<T>(value: T[] | undefined): string {
  return JSON.stringify(value || []);
}

function serializeRecord(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value || {});
}

function toTemplate(row: WorkflowTemplateRow): WorkflowTemplate {
  return {
    ...row,
    nodes: parseArray<WorkflowNode>(row.nodes),
    edges: parseArray<WorkflowEdge>(row.edges),
    metadata: parseRecord(row.metadata),
  };
}

function writeTemplate(template: WorkflowTemplate): void {
  db.prepare(
    `INSERT INTO workflow_templates (
      id, title, description, category, status, version, nodes, edges, metadata, createdAt, updatedAt
    )
     VALUES (
      @id, @title, @description, @category, @status, @version, @nodes, @edges, @metadata,
      @createdAt, @updatedAt
    )`
  ).run({
    ...template,
    nodes: serializeArray(template.nodes),
    edges: serializeArray(template.edges),
    metadata: serializeRecord(template.metadata),
  });
}

function updateDefaultTemplate(template: WorkflowTemplate): void {
  db.prepare(
    `UPDATE workflow_templates
     SET title=@title, description=@description, category=@category, status=@status,
       version=@version, nodes=@nodes, edges=@edges, metadata=@metadata, updatedAt=@updatedAt
     WHERE id=@id`
  ).run({
    ...template,
    nodes: serializeArray(template.nodes),
    edges: serializeArray(template.edges),
    metadata: serializeRecord(template.metadata),
  });
}

function defaultTemplateNeedsUpdate(existing: WorkflowTemplateRow, template: WorkflowTemplate): boolean {
  return (
    existing.title !== template.title ||
    existing.description !== template.description ||
    existing.category !== template.category ||
    existing.status !== template.status ||
    existing.version !== template.version ||
    existing.nodes !== serializeArray(template.nodes) ||
    existing.edges !== serializeArray(template.edges) ||
    existing.metadata !== serializeRecord(template.metadata)
  );
}

function ensureDefaultTemplatesSeeded(): void {
  const now = new Date().toISOString();
  const syncDefaults = db.transaction(() => {
    for (const template of createDefaultTemplates(now)) {
      const existing = db
        .prepare("SELECT * FROM workflow_templates WHERE id = ?")
        .get(template.id) as WorkflowTemplateRow | undefined;

      if (existing && defaultTemplateNeedsUpdate(existing, template)) {
        updateDefaultTemplate(template);
      } else if (!existing) {
        writeTemplate(template);
      }
    }
  });

  syncDefaults();
}

function createNode(
  id: string,
  x: number,
  y: number,
  data: WorkflowNode["data"],
  options: Omit<Partial<WorkflowNode>, "id" | "position" | "data"> = {}
): WorkflowNode {
  return {
    id,
    position: { x, y },
    data,
    ...options,
  };
}

function createEdge(
  id: string,
  source: string,
  target: string,
  label: string,
  animated = false
): WorkflowEdge {
  return { id, source, target, label, animated };
}

function createDefaultTemplates(now: string): WorkflowTemplate[] {
  return [
    {
      id: "template_model_display",
      title: "Model Display Set",
      description: "Turn one product asset into a reusable model-display image set.",
      category: "model_display",
      status: "published",
      version: 1,
      nodes: [
        createNode(
          "product",
          40,
          120,
          {
            label: "Product Asset",
            caption: "Main product image and immutable visual facts.",
            kind: "asset",
            status: "ready",
            metrics: ["material", "color", "shape lock"],
            iconName: "product",
          },
          { type: "asset", title: "Product Asset", status: "ready" }
        ),
        createNode(
          "model_rules",
          330,
          60,
          {
            label: "Model Rules",
            caption: "Model persona, pose, crop, and lighting constraints.",
            kind: "factory",
            status: "ready",
            metrics: ["persona", "pose", "lighting"],
            iconName: "model",
          },
          { type: "model", title: "Model Rules", status: "ready" }
        ),
        createNode(
          "display_set",
          620,
          120,
          {
            label: "Display Set",
            caption: "Commerce-ready model display outputs.",
            kind: "output",
            status: "queued",
            metrics: ["3 images", "4:5", "detail-safe"],
            iconName: "output",
          },
          { type: "output", title: "Display Set", status: "queued" }
        ),
      ],
      edges: [
        createEdge("product-model_rules", "product", "model_rules", "fit"),
        createEdge("model_rules-display_set", "model_rules", "display_set", "generate", true),
      ],
      metadata: {
        default: true,
        scenario: "model_display",
        platforms: ["Taobao", "Xiaohongshu", "Storefront"],
        sizes: ["1600x2000", "1500x2000", "1600x1600"],
        aspectRatios: ["4:5", "3:4", "1:1"],
        imageCount: 3,
        requiredAssets: ["product_asset", "model_rules"],
        qualityRules: [
          "Keep model identity anchors stable when a model asset is connected.",
          "Product scale, color, material, and logo regions must stay truthful.",
          "Hands, face, and contact shadows must look commercially credible.",
        ],
        costTier: "medium",
        prohibitions: [
          "No sexualized poses.",
          "No invented product features or bundled accessories.",
          "No face or hand distortion.",
        ],
        outputNaming: "{sku}_model_display_{slot}_{index}.png",
        suitableFor: ["apparel/accessory storefront", "premium business product display", "social commerce model shot"],
        tags: ["model", "commerce", "display"],
        outputs: ["model_display_images", "qa_manifest"],
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "template_product_detail_page",
      title: "Product Detail Page",
      description: "Build a detail-page sequence from brief, selling points, close-ups, and review.",
      category: "product_detail_page",
      status: "published",
      version: 1,
      nodes: [
        createNode(
          "product",
          40,
          170,
          {
            label: "Product Asset",
            caption: "Source product and extracted feature locks.",
            kind: "asset",
            status: "ready",
            metrics: ["shape", "fabric", "logo"],
            iconName: "product",
          },
          { type: "asset", title: "Product Asset", status: "ready" }
        ),
        createNode(
          "brief",
          320,
          80,
          {
            label: "Product Brief",
            caption: "Structured copy and visual constraints.",
            kind: "factory",
            status: "ready",
            metrics: ["claims", "must keep", "do not alter"],
            iconName: "ai",
          },
          { type: "prompt", title: "Product Brief", status: "ready" }
        ),
        createNode(
          "detail_modules",
          610,
          170,
          {
            label: "Detail Modules",
            caption: "Hero, selling-point strips, close-ups, and comparisons.",
            kind: "output",
            status: "queued",
            metrics: ["hero", "close-up", "comparison"],
            iconName: "output",
          },
          { type: "output", title: "Detail Modules", status: "queued" }
        ),
        createNode(
          "quality_review",
          900,
          170,
          {
            label: "Quality Review",
            caption: "Check consistency before export.",
            kind: "review",
            status: "review",
            metrics: ["color", "copy", "platform risk"],
            iconName: "review",
          },
          { type: "review", title: "Quality Review", status: "review" }
        ),
      ],
      edges: [
        createEdge("product-brief", "product", "brief", "analyze", true),
        createEdge("brief-detail_modules", "brief", "detail_modules", "compose", true),
        createEdge("detail_modules-quality_review", "detail_modules", "quality_review", "review"),
      ],
      metadata: {
        default: true,
        scenario: "product_detail_page",
        platforms: ["Taobao", "Tmall", "DTC storefront"],
        sizes: ["1200x1200", "1200x1600", "1200x1500", "750x1000"],
        aspectRatios: ["1:1", "3:4", "4:5", "750:1000"],
        imageCount: 4,
        requiredAssets: ["product_asset", "product_brief", "selling_points"],
        qualityRules: [
          "Every claim must come from supplied product data.",
          "Close-ups must preserve material, color, logo, and structure.",
          "Copy areas must not cover product-critical detail.",
        ],
        costTier: "medium",
        prohibitions: [
          "No unsupported absolute claims.",
          "No fake certification marks.",
          "No comparison image unless comparison data is supplied.",
        ],
        outputNaming: "{sku}_detail_{slot}_{index}.png",
        suitableFor: ["product detail page", "launch listing", "feature education module"],
        tags: ["detail-page", "commerce", "copy"],
        outputs: ["detail_page_modules", "manifest", "qa_report"],
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "template_platform_output_pack",
      title: "Platform Output Pack",
      description: "Adapt approved outputs into channel-specific sizes, naming, and copy bundles.",
      category: "platform_output_pack",
      status: "published",
      version: 1,
      nodes: [
        createNode(
          "approved_outputs",
          40,
          120,
          {
            label: "Approved Outputs",
            caption: "Images cleared by human or AI review.",
            kind: "asset",
            status: "ready",
            metrics: ["selected", "approved", "source linked"],
            iconName: "package",
          },
          { type: "asset", title: "Approved Outputs", status: "ready" }
        ),
        createNode(
          "platform_rules",
          330,
          60,
          {
            label: "Platform Rules",
            caption: "Channel specs for Taobao, Xiaohongshu, Amazon, and banners.",
            kind: "factory",
            status: "ready",
            metrics: ["sizes", "safe area", "copy rules"],
            iconName: "platform",
          },
          { type: "platform_rule", title: "Platform Rules", status: "ready" }
        ),
        createNode(
          "output_pack",
          620,
          120,
          {
            label: "Output Pack",
            caption: "Named folders, resized images, and copy exports.",
            kind: "output",
            status: "queued",
            metrics: ["naming", "resize", "copy pack"],
            iconName: "output",
          },
          { type: "output_pack", title: "Output Pack", status: "queued" }
        ),
      ],
      edges: [
        createEdge("approved_outputs-platform_rules", "approved_outputs", "platform_rules", "adapt"),
        createEdge("platform_rules-output_pack", "platform_rules", "output_pack", "export", true),
      ],
      metadata: {
        default: true,
        scenario: "platform_output_pack",
        platforms: ["Taobao", "Amazon", "Xiaohongshu", "Poster"],
        sizes: ["2000x2000", "1200x1600", "1242x1660", "1080x1920", "1920x1080"],
        aspectRatios: ["1:1", "3:4", "4:5", "9:16", "16:9"],
        imageCount: 6,
        requiredAssets: ["approved_outputs", "platform_rules"],
        qualityRules: [
          "Every exported slot must match connected platform ratio and safe area.",
          "Manifest must preserve source image and prompt lineage.",
          "Copy pack must separate no-text marketplace slots from social/poster slots.",
        ],
        costTier: "low",
        prohibitions: [
          "No provider regeneration in export-only mode.",
          "No overwriting source approvals.",
          "No text on Amazon main image slots.",
        ],
        outputNaming: "{sku}_{platform}_{slot}_{index}.{ext}",
        suitableFor: ["multi-channel launch", "listing handoff", "review/export pack"],
        tags: ["platform", "export", "channel"],
        outputs: ["platform_image_pack", "copy_pack", "manifest"],
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "template_poster_set",
      title: "Poster Set",
      description: "Create a reusable poster campaign set from product, scene, and style components.",
      category: "poster_set",
      status: "published",
      version: 1,
      nodes: [
        createNode(
          "product",
          40,
          170,
          {
            label: "Product Asset",
            caption: "Hero product with visual identity locks.",
            kind: "asset",
            status: "ready",
            metrics: ["hero angle", "color", "silhouette"],
            iconName: "product",
          },
          { type: "asset", title: "Product Asset", status: "ready" }
        ),
        createNode(
          "style",
          320,
          70,
          {
            label: "Visual Style",
            caption: "Campaign mood, palette, typography, and layout direction.",
            kind: "factory",
            status: "ready",
            metrics: ["palette", "type", "layout"],
            iconName: "style",
          },
          { type: "visual_style", title: "Visual Style", status: "ready" }
        ),
        createNode(
          "scene",
          320,
          270,
          {
            label: "Scene Context",
            caption: "Lifestyle or studio scene constraints.",
            kind: "factory",
            status: "ready",
            metrics: ["background", "props", "lighting"],
            iconName: "scene",
          },
          { type: "scene", title: "Scene Context", status: "ready" }
        ),
        createNode(
          "poster_set",
          640,
          170,
          {
            label: "Poster Set",
            caption: "Campaign posters across formats.",
            kind: "output",
            status: "queued",
            metrics: ["1:1", "3:4", "banner"],
            iconName: "output",
          },
          { type: "output", title: "Poster Set", status: "queued" }
        ),
      ],
      edges: [
        createEdge("product-poster_set", "product", "poster_set", "hero"),
        createEdge("style-poster_set", "style", "poster_set", "style", true),
        createEdge("scene-poster_set", "scene", "poster_set", "context"),
      ],
      metadata: {
        default: true,
        scenario: "poster_campaign",
        platforms: ["Poster", "Xiaohongshu", "WeChat", "Store banner"],
        sizes: ["1080x1920", "1920x1080", "1242x1660", "1080x1080"],
        aspectRatios: ["9:16", "16:9", "3:4", "1:1"],
        imageCount: 4,
        requiredAssets: ["product_asset", "visual_style", "scene_context"],
        qualityRules: [
          "Hero product must remain readable within two seconds.",
          "Campaign type, palette, and scene must stay consistent across the set.",
          "Headline zone must be clear and separated from product edges.",
        ],
        costTier: "medium",
        prohibitions: [
          "No fake brand endorsements.",
          "No decorative effects that hide product detail.",
          "No illegible campaign copy.",
        ],
        outputNaming: "{sku}_poster_{format}_{index}.png",
        suitableFor: ["campaign poster", "launch teaser", "store banner", "social announcement"],
        tags: ["poster", "campaign", "style"],
        outputs: ["poster_images", "copy_slots", "manifest"],
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "template_quality_review",
      title: "Quality Review",
      description: "Review generated images for product consistency, platform compliance, and fix paths.",
      category: "quality_review",
      status: "published",
      version: 1,
      nodes: [
        createNode(
          "generated_set",
          40,
          120,
          {
            label: "Generated Set",
            caption: "Candidate output images with prompts and source links.",
            kind: "asset",
            status: "ready",
            metrics: ["prompt linked", "source linked", "batch"],
            iconName: "package",
          },
          { type: "asset", title: "Generated Set", status: "ready" }
        ),
        createNode(
          "review_rules",
          330,
          60,
          {
            label: "Review Rules",
            caption: "Consistency, artifacts, text, and compliance checks.",
            kind: "review",
            status: "review",
            metrics: ["structure", "logo", "compliance"],
            iconName: "review",
          },
          { type: "quality_rule", title: "Review Rules", status: "review" }
        ),
        createNode(
          "fix_plan",
          620,
          120,
          {
            label: "Fix Plan",
            caption: "Regenerate, retouch, approve, or export decision.",
            kind: "factory",
            status: "queued",
            metrics: ["approve", "regenerate", "retouch"],
            iconName: "ai",
          },
          { type: "prompt", title: "Fix Plan", status: "queued" }
        ),
      ],
      edges: [
        createEdge("generated_set-review_rules", "generated_set", "review_rules", "inspect", true),
        createEdge("review_rules-fix_plan", "review_rules", "fix_plan", "decide"),
      ],
      metadata: {
        default: true,
        scenario: "quality_review",
        platforms: ["Taobao", "Amazon", "Xiaohongshu", "Poster", "Storefront"],
        sizes: ["source-size"],
        aspectRatios: ["source-ratio"],
        imageCount: 1,
        requiredAssets: ["generated_set", "review_rules"],
        qualityRules: [
          "Score product consistency, platform compliance, and commercial polish separately.",
          "Return a clear approve/regenerate/retouch/export decision.",
          "Preserve prompt, source asset, and failing rule references.",
        ],
        costTier: "low",
        prohibitions: [
          "No silent approval when product identity changes.",
          "No policy override without human note.",
          "No real provider call during review-only smoke.",
        ],
        outputNaming: "{batch}_review_{decision}_{index}.json",
        suitableFor: ["human QA", "batch review", "provider-free smoke validation"],
        tags: ["quality", "review", "compliance"],
        outputs: ["review_report", "fix_plan"],
      },
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function isWorkflowTemplateCategory(value: unknown): value is WorkflowTemplateCategory {
  return typeof value === "string" && TEMPLATE_CATEGORIES.has(value as WorkflowTemplateCategory);
}

export function isWorkflowTemplateStatus(value: unknown): value is WorkflowTemplateStatus {
  return typeof value === "string" && TEMPLATE_STATUSES.has(value as WorkflowTemplateStatus);
}

export async function list(filters: WorkflowTemplateListFilters = {}): Promise<WorkflowTemplate[]> {
  ensureDefaultTemplatesSeeded();

  const clauses: string[] = [];
  const values: string[] = [];

  if (filters.category) {
    clauses.push("category = ?");
    values.push(filters.category);
  }

  if (filters.status) {
    clauses.push("status = ?");
    values.push(filters.status);
  }

  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM workflow_templates${where} ORDER BY updatedAt DESC`)
    .all(...values);

  return (rows as WorkflowTemplateRow[]).map(toTemplate);
}

export async function get(id: string): Promise<WorkflowTemplate | undefined> {
  ensureDefaultTemplatesSeeded();
  const row = db
    .prepare("SELECT * FROM workflow_templates WHERE id = ?")
    .get(id) as WorkflowTemplateRow | undefined;
  return row ? toTemplate(row) : undefined;
}

export async function add(params: CreateWorkflowTemplateParams): Promise<WorkflowTemplate> {
  const now = new Date().toISOString();
  const template: WorkflowTemplate = {
    id: `workflow_template_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    title: params.title.trim(),
    description: params.description?.trim() || "",
    category: params.category,
    status: params.status ?? "draft",
    version: params.version ?? 1,
    nodes: params.nodes || [],
    edges: params.edges || [],
    metadata: params.metadata || {},
    createdAt: now,
    updatedAt: now,
  };

  writeTemplate(template);
  return template;
}

export async function update(
  id: string,
  updates: UpdateWorkflowTemplateParams
): Promise<WorkflowTemplate | null> {
  const existing = await get(id);
  if (!existing) return null;

  const merged: WorkflowTemplate = {
    ...existing,
    title: updates.title !== undefined ? updates.title.trim() : existing.title,
    description: updates.description !== undefined ? updates.description.trim() : existing.description,
    category: updates.category ?? existing.category,
    status: updates.status ?? existing.status,
    version: updates.version ?? existing.version + 1,
    nodes: updates.nodes ?? existing.nodes,
    edges: updates.edges ?? existing.edges,
    metadata: updates.metadata ?? existing.metadata,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(
    `UPDATE workflow_templates
     SET title=@title, description=@description, category=@category, status=@status,
       version=@version, nodes=@nodes, edges=@edges, metadata=@metadata, updatedAt=@updatedAt
     WHERE id=@id`
  ).run({
    ...merged,
    nodes: serializeArray(merged.nodes),
    edges: serializeArray(merged.edges),
    metadata: serializeRecord(merged.metadata),
  });

  return merged;
}

export async function remove(id: string): Promise<boolean> {
  const result = db.prepare("DELETE FROM workflow_templates WHERE id = ?").run(id);
  return result.changes > 0;
}
