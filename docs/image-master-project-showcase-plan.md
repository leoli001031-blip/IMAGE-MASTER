# Image Master 项目展示方案

这份方案用于演示、录制视频和给外部协作者快速理解项目。当前建议定位为“内部 Demo / 私有试用展示”，不要说成公开生产版本。

## 1. 展示目标

用 60-90 秒讲清楚：

```text
Image Master 是一个本地优先的商业图片 Agent 工作台。
用户准备商品、模特、场景、风格、文案等资产后，用一句自然语言让 Agent 规划整套商业图。
生成结果以无限画布图片墙呈现，并且每张图都能追溯 prompt、参考图和 provider 信息。
```

核心卖点：

- 项目化工作台，不是一次性生图页面。
- 素材资产可以复用。
- Agent 负责拆图组、比例、参考图和文案策略。
- 结果墙按真实图片比例展示。
- 点击图片可看详情、重做、交给 Agent 修改、保存成资产。
- 本地文件夹可直接打开，方便复制交付图。

## 2. 当前打包状态

本次演示建议使用本地 `.env` 或设置页，API base 主用专线：

```text
https://slb.apikey.fun/v1
```

普通线路只作为备用：

```text
https://api.apikey.fun/v1
```

不再使用 Lanyi 作为演示或全局 base。

已生成产物示例：

```text
/Users/lichenhao/Desktop/image master/dist-electron/release/mac-arm64/Image Master.app
/Users/lichenhao/Desktop/image master/dist-electron/release/Image Master-0.1.0-arm64.dmg
```

已验证：

```bash
npx tsc --noEmit --pretty false
npm run electron:build:dir
npm run smoke:electron-server
```

`smoke:electron-server` 通过，说明打包进 Electron 的 Next server 可以启动。

注意：

- 当前 macOS 包未签名，首次打开可能需要右键打开或在系统安全设置里允许。
- 包里带的是本机私有 `.env`，只适合你自己测试，不要公开分发。
- 不要在录制里展示 `/settings` 里的 API key。

## 3. 推荐展示方式

优先使用稳定样例，不现场跑真实 provider。

原因：

- 真实 provider 可能出现 socket close、timeout、空返回。
- 展示视频更重要的是讲清楚产品闭环，而不是现场等生成。
- 真实生成可以作为补充镜头，不作为主线。

推荐展示路线：

```text
打开软件 -> 进入项目画布 -> 展示资产库 -> 说一句 Agent 需求 -> 展示 Agent 计划 -> 展示结果墙 -> 点击图片详情 -> 交给 Agent 修改 -> 打开输出文件夹
```

## 4. 视频结构

目标时长：75 秒左右。

| 时间 | 镜头 | 画面 | 操作 | 旁白/字幕 |
| --- | --- | --- | --- | --- |
| 0-6s | Hook | Image Master 画布总览 | 打开 app，停在 `/canvas` | “用一句话，把商品素材变成一整套商业图。” |
| 6-15s | 项目和资产 | 底部素材库、画布资产 | 展示商品/模特/场景/文案资产 | “素材先沉淀成资产，后续项目可以复用。” |
| 15-28s | Agent 输入 | 右上角 Agent | 输入淘宝详情页/小红书/模特图需求 | “用户只说目标，Agent 判断图组、比例、参考图和文案策略。” |
| 28-40s | 计划预览 | Agent 计划矩阵 | 展示输出数量、比例、强参考、烧字策略 | “生成前能先看计划，不必盲跑。” |
| 40-55s | 结果墙 | 多比例图片铺在无限画布 | 平移/缩放结果墙 | “结果按真实比例铺开，主图、海报、详情图、模特图一眼可扫。” |
| 55-66s | 图片详情 | 点击一张海报/模特图 | 打开详情面板 | “每张图都能回看 prompt、参考图、provider 和诊断信息。” |
| 66-75s | 修改闭环 | 点击修改 | 让 Agent 修改单张图 | “不满意可以点图再说一句，让 Agent 基于上一版修改。” |
| 75-85s | 输出 | 打开本地文件夹 | 展示导出目录 | “最后直接打开本地文件夹，复制交付图。” |

## 5. 演示脚本

### 片头字幕

```text
Image Master
Agent-powered commercial image workbench
```

### 旁白稿

```text
Image Master 是一个本地优先的商业图片 Agent 工作台。

它不是单张生图工具，而是以项目为单位管理商品、模特、场景、风格和文案资产。

用户只需要说清楚目标，比如做一套淘宝详情页、小红书封面和模特展示图。

Agent 会先规划整套图：每张图的用途、比例、参考图角色，以及文案是否需要烧进画面。

生成结果会落到无限画布里，按真实比例组成图片墙。

点击任意图片，可以看到它使用的 prompt、参考图、provider 信息和诊断记录。

如果某张图需要调整，可以直接把这张图交给 Agent，再用一句话说明怎么改。

最后，结果可以保存成资产复用，也可以一键打开本地文件夹复制交付。
```

### 屏幕字幕短句

- Project + Assets + Agent
- Agent plans the whole image set
- Real ratios, real result wall
- Trace every image back to prompt and references
- Click an image, ask Agent to revise
- Open local folder and deliver

## 6. 演示数据

优先使用固定样例：

```text
/Users/lichenhao/Desktop/image master/test_artifacts/goal5-large-real/2026-06-02T14-29-33-028Z/controlled-run-2026-06-02T14-42-05-603Z
```

这套样例包含 16 张投影仪商业图：

- 白底主图
- 多角度白底合集
- 商品细节
- 淘宝首屏海报
- 卖点图
- 客厅/办公/观影场景
- 模特使用图
- 小红书封面
- 详情页三卖点
- 横版主视觉

如果这套样例没有导入到当前画布，展示时可以先使用结果文件夹作为 Proof 镜头，再用 app 内 mock/result wall 演示交互。

## 7. 自动录制路线

推荐使用刚创建的 Codex Skills：

```text
project-demo-video
computer-use-demo-recorder
```

执行思路：

1. `project-demo-video` 扫描项目，读取本文件、README 和 Demo 指南。
2. 选择 `computer_use` 路线，因为 Image Master 同时有 Electron、画布和本地文件夹展示。
3. `computer-use-demo-recorder` 启动 ffmpeg 录屏。
4. Codex 用 Computer Use 打开 app、操作画布、展示结果和文件夹。
5. 停止录屏，输出 MP4/WebM 和 `recording-report.md`。

本机录屏状态：

```text
ffmpeg: /opt/homebrew/bin/ffmpeg
recommendedDevice: 5:none
device: Capture screen 0
```

如果录制失败，优先检查 macOS 权限：

```text
System Settings -> Privacy & Security -> Screen Recording
System Settings -> Privacy & Security -> Accessibility
```

## 8. 录制前检查

```bash
npx tsc --noEmit --pretty false
npm run smoke:electron-server
node /Users/lichenhao/.codex/skills/computer-use-demo-recorder/scripts/recording-status.mjs
```

确认：

- 不打开 `/settings` 或任何显示 key 的页面。
- 桌面没有私人窗口、聊天、账号、密码弹窗。
- 使用固定样例或 mock 数据，不现场等待大批量真实生成。
- 如果要展示真实生成，只展示 1 张小样，不把它作为主线。

## 9. 不要在展示里承诺

不要说：

- 已经公开可用。
- provider 永远稳定。
- 商品细节像素级锁定。
- 模特身份 100% 一致。
- 所有平台规则自动合规。
- 带 `.env` 的包可以公开分发。

可以说：

- 内部 Demo 链路已经闭环。
- 适合本地私有试用。
- Agent 能规划图组和参考图策略。
- 结果可追溯、可重做、可保存资产。
- 商品真实身份需要真实商品参考图。

## 10. 建议展示输出

最终输出目录建议：

```text
/Users/lichenhao/Desktop/image master/demo-video/image-master-showcase/
```

内容：

```text
image-master-showcase.mp4
image-master-showcase.webm
recording-report.md
demo-storyboard.md
demo-script.md
screenshots/
```

第一版目标不是剪得很炫，而是完整、稳定、能复拍。

后续可以再用 Remotion 或 HyperFrames 包装片头、字幕、章节和竖版短视频。
