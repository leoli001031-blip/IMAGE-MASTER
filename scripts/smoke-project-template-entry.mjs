import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const projectsPagePath = path.join(root, "app/projects/page.tsx");
const readmePath = path.join(root, "README.md");
const source = fs.readFileSync(projectsPagePath, "utf8");
const readmeSource = fs.readFileSync(readmePath, "utf8");

const templateIds = [
  "taobao-detail-product-set",
  "model-multi-scene-campaign",
  "cross-platform-launch-kit",
];

const requiredSnippets = [
  "sampleProjectTemplates",
  ...templateIds,
  "agentStarterPrompt",
  "autoPopulateCanvas: false",
  "source: \"sample-template\"",
  "router.push(`/canvas?projectId=${encodeURIComponent(payload.project.id)}`)",
];

const missing = requiredSnippets.filter((snippet) => !source.includes(snippet));
if (missing.length > 0) {
  console.error("Project template entry smoke failed: missing snippets", missing);
  process.exit(1);
}

const templateCreateBody = source.slice(
  source.indexOf("const createProjectFromTemplate"),
  source.indexOf("<section className=\"space-y-3\">")
);

if (!templateCreateBody.includes("autoPopulateCanvas: false")) {
  console.error("Project templates must not auto-populate the canvas.");
  process.exit(1);
}

if (templateCreateBody.includes("canvasWorkflowId")) {
  console.error("Project templates must not create or bind a canvas workflow.");
  process.exit(1);
}

if (templateCreateBody.includes("assetIds")) {
  console.error("Project templates must not seed asset references.");
  process.exit(1);
}

const declaredTemplateCount = templateIds.filter((id) => source.includes(`id: "${id}"`)).length;
if (declaredTemplateCount !== 3) {
  console.error(`Expected exactly 3 sample project templates, found ${declaredTemplateCount}.`);
  process.exit(1);
}

const readmeMissing = [
  "淘宝详情页图组",
  "模特多场景宣传图",
  "跨平台上市套图",
  "do not auto-populate",
].filter((snippet) => !readmeSource.includes(snippet));
if (readmeMissing.length > 0) {
  console.error("README should document the non-seeded sample templates:", readmeMissing);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      templateCount: declaredTemplateCount,
      guarded: ["autoPopulateCanvas=false", "no canvasWorkflowId", "no seeded assetIds", "README documents templates"],
    },
    null,
    2
  )
);
