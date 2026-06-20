# 跨项目演示视频 Skills 方案

这份方案用于把“项目展示视频”做成可复用的 Codex Skills。目标不是只服务 Image Master，而是以后 `new vibe directing`、知识库、写作工具、Electron app、网页工具都能复用同一套方法。

## 目标

用户只需要说：

```text
帮我给这个项目录一条完整展示视频。
```

Skill 应该自动完成：

1. 读项目 README、使用说明、Demo 文档和可运行入口。
2. 判断项目类型：Web、本地 Electron、静态页面、CLI 工具、内容项目。
3. 设计一条 60-120 秒的展示脚本。
4. 准备稳定演示数据，优先不用真实外部 API。
5. 选择录制方式：自动化录制、手动录制、截图合成或代码化视频。
6. 生成录制脚本、旁白稿、镜头清单、字幕文案和交付检查表。
7. 导出一份可复用的 demo package。

## 总原则

- 不把某个项目的业务逻辑写死进 Skill；项目差异放到 `project profile`。
- 先做稳定 demo，再做真实 live demo。
- 能用 mock/demo data 展示的，不默认烧真实 API。
- 每条视频都要有：脚本、镜头表、录制方式、输出路径、复拍说明。
- 录制不是一次性手工活，要尽量能重跑。

## 推荐 Skill 结构

### 主 Skill：`project-demo-video`

这是唯一需要用户主动调用的入口。

触发场景：

- 录制项目展示视频
- 做产品 demo 视频
- 给 GitHub/README/发布页准备演示视频
- 把一个本地项目变成可展示视频
- 给 Electron/Web app 做 walkthrough

职责：

- 项目理解
- 演示路径设计
- 工具选择
- 输出完整执行包
- 必要时调用子流程

输出：

- `demo-video-plan.md`
- `demo-storyboard.md`
- `demo-script.md`
- `demo-recording-manifest.json`
- `demo-checklist.md`
- 可选：`record-demo.mjs`
- 可选：`remotion/` 或 `hyperframes/` 包装工程

### 技术子 Skill 1：`playwright-demo-recorder`

只在项目是 Web app、Next.js、Vite、Electron 内嵌网页或 localhost 页面时使用。

职责：

- 写 Playwright 录制脚本
- 设置 viewport、录制尺寸、等待策略
- 使用固定 demo 数据
- 录制 WebM
- 截图关键帧
- 输出 manifest

适合：

- Image Master `/canvas`
- Vibe Director Studio
- 知识库 Web UI
- 任何可打开 URL 的产品界面

不适合：

- 需要复杂桌面多窗口操作
- 需要真实系统音频
- 需要人工即兴演示

### 技术子 Skill 2：`demo-video-editorial`

用于把录屏素材包装成正式展示片。

职责：

- 生成片头、章节、字幕、旁白
- 设计视频节奏
- 接 Remotion、HyperFrames 或 ffmpeg
- 导出 16:9、4:5、9:16 等版本

适合：

- README/GitHub 首页展示
- 产品发布视频
- 小红书/社媒短视频
- 给别人快速理解项目的 60-90 秒介绍片

### 可选子 Skill：`manual-demo-recording`

用于需要人工操作或桌面录制时。

职责：

- 生成 OpenScreen/Cap/OBS 录制清单
- 给出录制区域、窗口尺寸、权限检查、分段录法
- 输出手动录制脚本和补拍清单

适合：

- Electron 桌面壳
- 需要展示 Finder、本地文件夹、导出目录
- 需要真人旁白或即兴操作

## 为什么这样拆

只做一个大 Skill 会太重，容易每次都读一堆无关规则。

拆成一主两辅后：

- 用户只记一个入口：`project-demo-video`
- 主 Skill 负责判断路线
- 技术细节由子 Skill 按需展开
- 不同项目只需要换 `project profile`

## 工具路线

### 自动录制：Playwright

Playwright 官方支持录制测试视频，可以通过 `recordVideo` 或 test config 打开视频录制。视频会在 browser context 关闭后保存。

适合做稳定、可复拍的项目演示。

### 美化录制：Testreel

Testreel 是基于 Playwright 的程序化产品 demo 录制工具。它支持 JSON 定义交互步骤，输出 WebM、MP4、GIF，并带窗口外壳、光标、缩放、背景等包装。

适合快速做 ScreenStudio 风格的 Web app demo。

### 手动录制：OpenScreen

OpenScreen 是开源 Screen Studio 替代方案，支持窗口/区域录制、麦克风、系统音、自动/手动缩放、光标高亮、裁剪、注释和导出 MP4/GIF。

适合人工演示、Electron、多窗口和本地文件夹展示。

### 代码化包装：Remotion / HyperFrames

Remotion 用 React 程序化生成视频，适合片头、字幕、章节、转场、产品截图组合。

HyperFrames 更适合 HTML 视频包装、旁白、字幕、节奏化展示，也适合我们已有 Codex 插件能力。

## Skill 文件结构建议

```text
/Users/lichenhao/.codex/skills/project-demo-video/
  SKILL.md
  references/
    project-intake.md
    demo-story-structure.md
    capture-strategy.md
    video-style-guide.md
    qa-checklist.md
  templates/
    demo-video-plan.md
    demo-storyboard.md
    demo-script.md
    recording-manifest.json
    project-profile.yaml
  scripts/
    inspect-project-entrypoints.mjs
    create-demo-package.mjs
    validate-demo-package.mjs
```

可选：

```text
/Users/lichenhao/.codex/skills/playwright-demo-recorder/
  SKILL.md
  references/
    playwright-recording.md
    locator-strategy.md
    stable-demo-data.md
  templates/
    record-demo.mjs
    recording-definition.json
  scripts/
    record-local-web-demo.mjs
    collect-demo-screenshots.mjs
```

```text
/Users/lichenhao/.codex/skills/demo-video-editorial/
  SKILL.md
  references/
    remotion-packaging.md
    hyperframes-packaging.md
    narration-and-captions.md
    export-ratios.md
  templates/
    video-outline.md
    subtitle.srt
    narration.md
```

## 主 Skill 的执行流程

### 0. 最小确认

只在必要时问问题，默认最多 3 个：

1. 视频用途：内部演示、GitHub README、客户展示、社媒发布？
2. 目标时长：30 秒、60 秒、90 秒、3 分钟？
3. 是否允许真实 API / 真实登录 / 真实生成？

如果用户没回答，默认：

```text
用途：内部演示
时长：60-90 秒
策略：不用真实 API，优先 demo data
```

### 1. 项目扫描

读取：

- README
- docs
- package scripts
- app routes
- existing demo artifacts
- smoke/verification scripts
- `.env.example`

输出项目画像：

```text
project_type: web_app | electron_app | static_site | cli_tool | content_project
entrypoint: http://localhost:3000/canvas
demo_data: available | missing | needs_seed
recording_mode: playwright | testreel | manual | screenshots
risk_level: low | medium | high
```

### 2. Demo 叙事

固定结构：

```text
Hook：这个项目解决什么问题
Setup：打开项目/导入素材/准备数据
Action：核心操作流程
Proof：结果、细节、可追溯性
Iteration：修改、重做、保存、导出
Close：适合什么场景，下一步是什么
```

### 3. 录制策略选择

优先级：

1. 项目可用 localhost + 操作稳定 -> Playwright/Testreel
2. 需要高级包装 -> Playwright footage + Remotion/HyperFrames
3. 需要展示桌面文件夹/Electron shell -> OpenScreen/manual
4. 项目很不稳定 -> 截图 + 编排成视频

### 4. 输出 demo package

每个项目生成：

```text
demo-video/
  README.md
  demo-video-plan.md
  demo-storyboard.md
  demo-script.md
  recording-manifest.json
  record-demo.mjs
  assets/
  output/
```

### 5. 质量检查

检查：

- 是否避开真实 key、隐私数据、真实客户数据
- 是否有稳定 demo 数据
- 是否能重跑录制
- 是否有每个镜头的预期画面
- 是否有失败兜底方案
- 是否明确不能对外承诺的点

## Project Profile 设计

每个项目只需要一份 profile，不把项目规则写进 Skill 本体。

示例：

```yaml
projectName: Image Master
projectType: web_app
entrypoints:
  dev: http://localhost:3000/canvas
  electron: Image Master.app
recommendedMode: playwright_then_editorial
demoData:
  preferred: saved_projector_sample
  realProviderCalls: avoid_by_default
coreStory:
  - project_asset_agent_result_wall
  - click_image_details
  - agent_revision
  - open_local_folder
doNotClaim:
  - public_production_ready
  - provider_always_stable
  - perfect_product_identity
  - perfect_model_identity
privacy:
  hideEnv: true
  hideProviderKeys: true
```

## Image Master 的专属 profile 草案

```yaml
projectName: Image Master
projectType: web_app
entrypoints:
  canvas: http://localhost:3000/canvas
  settings: http://localhost:3000/settings
stableDemo:
  guide: docs/demo-closeout-guide.md
  userGuide: docs/user-guide.md
  sampleOutputDir: test_artifacts/goal5-large-real/2026-06-02T14-29-33-028Z/controlled-run-2026-06-02T14-42-05-603Z
videoStory:
  hook: 用自然语言把商品素材变成一整套商业图
  scenes:
    - 打开项目画布
    - 展示素材库和项目资产
    - 输入 Agent 需求
    - 展示 Agent 计划
    - 展示结果墙
    - 点击图片查看 prompt/reference/provider
    - 点击修改，把图片交给 Agent 二次生成
    - 打开本地输出文件夹
recommendedRecording:
  first: playwright_or_testreel
  fallback: openscreen_manual
  packaging: hyperframes_or_remotion
liveGeneration:
  default: false
  reason: provider 波动会影响演示稳定性
```

## 产物模板

### `demo-video-plan.md`

```md
# Demo Video Plan

## Goal

## Audience

## Duration

## Recording Mode

## Demo Data

## Scenes

## Risks

## Fallback

## Output Checklist
```

### `demo-storyboard.md`

```md
| Time | Scene | Visual | Action | Narration | Notes |
| --- | --- | --- | --- | --- | --- |
| 0-5s | Hook | First screen | Show product name | ... | ... |
```

### `recording-manifest.json`

```json
{
  "project": "Image Master",
  "url": "http://localhost:3000/canvas",
  "viewport": { "width": 1440, "height": 900 },
  "output": "demo-video/output/image-master-demo.webm",
  "steps": []
}
```

## 实施顺序

### 第 1 轮：主 Skill

创建 `project-demo-video`。

只做：

- 项目扫描
- demo plan
- storyboard
- script
- checklist

不做真实录制。

验收：

- 对 Image Master 能输出完整 demo package
- 对另一个 Web 项目也能输出 demo package
- 不读取无关大目录

### 第 2 轮：Playwright/Testreel 录制

创建 `playwright-demo-recorder` 或作为主 Skill 的 `scripts/record-local-web-demo.mjs`。

验收：

- 能打开 localhost
- 能录一段 WebM
- 能保存截图和 manifest
- 失败时能说明是 locator、启动、权限还是页面状态问题

### 第 3 轮：视频包装

创建 `demo-video-editorial`。

验收：

- 能把录屏素材转成带片头/字幕/章节的 MP4
- 至少支持 16:9
- 可选支持 4:5 / 9:16

### 第 4 轮：多项目 profiles

为常用项目准备 profile：

- Image Master
- Vibe Director Studio
- Knowledge_System
- 写作/公众号工具
- AI 大小姐 storyboard 项目

验收：

- 每个项目都有默认入口、演示主线、禁用声明、稳定数据策略。

## 最小可用版本

第一版只需要一个 Skill：

```text
project-demo-video
```

它不一定立刻录制视频，但必须稳定产出：

- 项目演示方案
- 镜头脚本
- 录制 manifest
- 录制工具建议
- 后续执行命令

然后再逐步加自动录制和视频包装。

## 推荐结论

先不要一口气做 4 个 Skill。

最优路线：

1. 先做 `project-demo-video` 主 Skill。
2. 里面预留 `recording-strategy` 路由。
3. 等 Image Master 和另一个项目都跑通后，再拆出 `playwright-demo-recorder`。
4. 等需要正式发布视频时，再拆出 `demo-video-editorial`。

这样不会过早工程化，也能真正服务你“还有别的项目也要做”的需求。
