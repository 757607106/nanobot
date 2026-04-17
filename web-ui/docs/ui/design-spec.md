# Nanobot UI Design Specification (Tech Luxury)

## 1. 设计基调 (Design Direction)
- **Console 级高颜值后台**：摒弃传统“玩具感”AI 面板，采用严谨、高密度、信息层次清晰的 Desktop-class 体验。
- **色彩感知均质化**：全面采用 `oklch()` 取代 HSL/RGB，实现绝对视觉匀称。基准色相设定为 **Hue 250 (Slate/Blue)**。
- **克制但不冷漠**：采用细致的阴影 (`--nb-shadow-soft`)、微弱的边框 (`--nb-card-subtle-border`) 和优雅的交互动画提升质感。

## 2. 排版与字体 (Typography)
采用了具有物理特质的现代排版：
- **Display / Body (标题与正文)**：`Noto Sans SC Variable`（优先）+ 系统字体回退（确保中文字形与字重一致性）
- **Mono (代码)**：采用 `tokens.ts` 中的 `font.mono` 栈（ui-monospace / SFMono / Menlo / Consolas 等）
- **字号体系**：严格基于设计系统 Token，避免使用随意的字号。

## 3. 核心红线 (Absolute Bans)
为避免产生 Generic AI Slop 风格，前端实现必须遵循以下红线：
1. **禁止渐变滥用**：除登录背景等特定首屏大面积渲染外，文本和常规按钮必须为纯色。
2. **禁止双重间距**：禁用组件内硬编码 `marginBottom` 和容器 `gap` 造成的间距叠加，严格遵守 Flex/Grid `gap` 进行流式布局统一管理。
3. **禁止幽灵颜色**：所有色彩必须来源于 `tokens.ts` 或 `theme.css` (如 `--nb-surface-strong`)，禁止在代码内裸写 Hardcode 颜色 (`#hex`)。

## 4. 色彩变量规范 (OKLCH Color Palette)
采用带 Hue 偏移的 Neutral (中性色) 产生环境光反射效应：
- **Brand 的主色 (高辨识度)**：`oklch(0.44 0.14 250)` (Light) / `oklch(0.78 0.14 250)` (Dark)
- **Surface (背景与面板)**：使用 `--nb-surface` / `--nb-surface-strong` 区分卡片层级，确保内容具有容器感。
- **阴影**：通过 `--nb-shadow-xs` / `--nb-shadow-soft` 等产生厚度，摒弃脏乱差的大面积全扩阴影。

## 5. 可复用 UI 组件库 (Reusable Component Library)
系统页面必须且仅能使用以下经过精心打磨的核心控制台组件（位于 `src/components/console/`）：

| 组件名 | 适用场景 | 核心特点与规范 |
|---|---|---|
| **PageHeader** | 所有一级/二级的页面顶部 | 提供标准的标题、eyebrow 描述及右侧 actions 区，控制台调性的紧凑排版。 |
| **SectionCard** | 页面内的主要内容区块 | 自带边框和阴影的 subtle 容器感，规范化的标题层级，替代散乱的裸 div。 |
| **MetricCard** | 数据展示、仪表盘指标 | 包含统一的语义色带、icon 软背景容器及紧凑化数字排版，避免呈现为纯裸数据。 |
| **FormField** | 表单输入、配置项包装 | 提供规范的 500-weight label，统一的 error color 必填标记 (\*) 和辅助文本节奏。 |

## 6. 页面级宏观布局 (Page Layout Standards)
- **流式栈 (Stack)**：根容器结构严格使用 `<Flex vertical gap={18} className="page-stack">`
- **控制台主栏 (Dashboard)**：适用类名 `.dashboard-main-grid` (实现 Desktop 1.4fr + 0.6fr 对比结构，响应式 1024px 折叠单栏)。
- **响应式网格**：适用类名 `.skills-page-grid` 或 `.profile-page-grid` 进行不同断点下的流式内容卡栅格。
