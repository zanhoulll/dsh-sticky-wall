<p align="center">
  <img src="./icon.svg" width="76" height="76" alt="便签墙图标" />
</p>

<h1 align="center">便签墙 · dsh-sticky-wall</h1>

<p align="center">
  <a href="https://github.com/deepseek-ai/deepseek-harness">
    <img src="https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white" alt="powered by dsh" />
  </a>
</p>

<p align="center">
  <em>每个灵感，都值得记下。便签自动保存。</em>
</p>

> 灵感来源：本插件源自 DeepSeek Harness 官方发布的视频。

一个给 **DeepSeek Harness** 的便签墙插件。左侧栏新增「便签墙」入口，点开即是一面可以随手贴灵感的墙：顶部输入、彩色便签、搜索编辑、自动保存。无需构建、零第三方依赖。

<p align="center">
  <img src="./docs/preview.png" alt="便签墙界面预览（深色主题）" width="900" />
</p>

## 特性

- **侧栏入口** — 一个便签折角图标注入左侧栏，点击打开独立主面板。
- **快速记录** — 顶部黄色输入区，6 种马卡龙色可选，`⌘/Ctrl + Enter` 快捷添加，或点「+ 添加到墙上」。
- **便签墙** — 卡片轻微错落旋转，悬停扶正浮起并露出编辑 / 删除按钮。
- **就地编辑** — 双击卡片文字即改，`⌘/Ctrl + Enter` 保存、`Esc` 取消。
- **搜索与计数** — 顶部搜索框按内容实时过滤，右上角显示便签总数。
- **自动保存** — 变更即持久化，刷新、换端口、重启都不丢；断网时仍有本地镜像兜底。
- **中英双语** — UI 文案与插件展示元数据均提供 `zh` / `en`。

## 前置要求

- **DeepSeek Harness（Desktop 客户端内置的 Web GUI）**：本插件运行在 DSH 的 Web 界面内——即由 **DSH Desktop 桌面客户端**启动、并通过 `dsh web` 提供的 Web GUI 实例中。它依赖 DSH 的 Cordis 插件体系与左侧栏 / 主面板插槽，**不是独立网页应用**，无需也不应单独部署前端服务，无法脱离 DSH 单独打开。
- **web profile**：持久化路由需要宿主 `webServer` 服务；在无 Web 的 profile（如 headless）中插件其余部分仍可加载，但便签不会落盘。
- **安装方式**：通过 DSH 内置的 `plugin_manager` 以本地目录安装（见下），无需手动 `npm install` 或构建；Host 半只用到 Node 内建 `fs`。
- **浏览器**：任意现代浏览器即可；数据保存在本机，不依赖外部网络。

## 快速开始

### 安装

通过 DSH 插件管理器，以本目录为包安装（一次工具调用）：

- 工具：`plugin_manager`
- `action`: `install_bundle`
- `target`: 本插件目录的绝对路径，例如 `<本插件目录绝对路径>`

> [!NOTE]
> `install_bundle` 是工具动作名，下划线是它的一部分，不是占位符。

### 使用

安装后刷新页面，左侧栏出现「便签墙」入口，点击即可打开面板开始记录。

## 数据与持久化

插件由两半组成，各司其职：

- **Host 半**（`index.js`）用 Node 内建 `fs` 把便签原子写入 `~/.dsh/sticky-wall/notes.json`（临时文件 + `rename`，写入中断也不会留下截断文件），并通过一个同源 JSON 路由提供读写。
- **浏览器半**（`client.js`）优先读宿主路由，同时在 `localStorage` 保留一份镜像，保证首屏秒开、且宿主不可用时仍能回显。

| 接口 | 说明 |
| --- | --- |
| `GET /sticky-wall/notes` | 返回 `{ notes: StickyNote[] }` |
| `POST /sticky-wall/notes` | 请求体 `{ notes: StickyNote[] }`，返回 `{ ok: true, count }` |

单条便签结构：`{ id, text, color, createdAt, updatedAt }`。为安全起见宿主会做边界限制（正文 ≤ 20000 字符、便签数 ≤ 2000、请求体 ≤ 2MB、颜色索引夹取到有效范围）。

> [!TIP]
> 主存储文件在 `~/.dsh/sticky-wall/notes.json`，备份或迁移直接拷贝该文件即可。

## 项目结构

```
dsh-sticky-wall/
├─ package.json          # dsh.bundle + dsh.client 清单
├─ cordis.patch.yml      # 挂载插件
├─ index.js              # Host 半：/sticky-wall/notes 持久化路由
├─ client.js             # 浏览器半：侧栏入口 + 主面板（window.__ModuleLoader__）
├─ locale/en.json        # 展示元数据（英文）
├─ locale/zh.json        # 展示元数据（中文）
├─ docs/preview.png      # README 界面预览截图
├─ test/smoke.mjs        # 渲染冒烟测试
└─ icon.svg              # 插件图标
```

- **无构建步骤**：浏览器半走 `window.__ModuleLoader__` 懒加载协议，纯 DOM 元素 + 内联样式，不引入任何 DSH 客户端包。
- **按需休眠**：Host 半仅在 web profile 下通过 `ctx.inject(['webServer'])` 注册路由；headless 等无 Web 环境的 profile 会自动跳过，不影响插件其余部分。

## 开发与测试

渲染冒烟测试不需要真实浏览器，用 Node 以「React shim + 假 ctx」直接执行 `client.js` 并调用注册的组件：

```bash
node test/smoke.mjs
# 或
npm test
```

覆盖四项断言：侧栏图标、空态、卡片列表、编辑态。改动 `client.js` 后建议先跑一遍。
