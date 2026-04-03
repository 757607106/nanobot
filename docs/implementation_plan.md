# Nanobot 前端 UI 排版交互设计深度审计报告

## 审计背景

对 `web-ui/src` 下所有核心页面进行了代码级逐行审计，涵盖布局结构、组件体系、CSS 设计系统、交互细节和视觉一致性。以下是系统性的问题分析与逐页改造建议。

---

## 一、全局架构层面的核心问题

### 1.1 设计系统割裂：三套样式体系混战

当前项目**同时存在三套样式方案**，导致视觉和维护极度混乱：

| 样式方案 | 使用位置 | 问题 |
|---------|---------|------|
| **Vanilla CSS 变量** (`--nb-*`) | `index.css` 3164 行 | 定义了完整设计Token，但很多页面不使用 |
| **Tailwind CSS** (`className="flex gap-4"`) | SkillsPage, MCP, Login, Dashboard | 与 CSS 变量体系冲突，语义断裂 |
| **Ant Design 内联样式** (`style={{ padding: 16 }}`) | 几乎所有页面 | 大量魔法数字，无法响应主题切换 |

> [!CAUTION]
> `index.css` 第 2 行 `@import "tailwindcss"` 直接引入了 TailwindCSS，但大量页面仍使用 `style={{}}` 内联硬编码。即使定义了 `--nb-panel-padding: 24px` 等Token，实际代码中 `padding: 14`、`padding: 16`、`padding: 20`、`padding: 24` 四种数值随机出现。

**建议方案**：
- 选定 **单一样式主干**（推荐 CSS 变量 + Ant Design `theme.useToken`），废弃 Tailwind 或将其限定为辅助工具类
- 统一所有间距到 8px 网格：`8 / 12 / 16 / 24 / 32 / 48`
- 将内联 `style={{}}` 全部迁移到 CSS class 或 theme token

---

### 1.2 页面头部组件不统一

当前存在 **三个不同的页面头部组件**：

| 组件 | 文件 | 使用页面 |
|------|------|---------|
| `PageHero` | `components/PageHero.tsx` | Dashboard, Skills |
| `PageHeader` | `components/console/PageHeader.tsx` | Models, System, Agent Studio |
| **无头部** / 手写 `Typography.Title` | — | MCP, Channels |

> [!WARNING]
> MCP 页面直接手写 `<Title level={4}>` 作为页面标题，没有 eyebrow/subtitle/actions 插槽，跟其他页面视觉层级完全不一致。ChannelsPage 更是完整缺失页面头部区域，直接以 `Tag` 和 `Switch` 开头。

**建议方案**：
- 统一为 **单一 `PageHeader` 组件**，包含 eyebrow / title / subtitle / actions 四个插槽
- 废弃 `PageHero`（功能上与 `PageHeader` 高度重叠）
- 确保所有页面顶部有一致的「标题 + 副标题 + 操作区」结构

---

### 1.3 卡片容器不统一

| 容器类 | 出现方式 | 问题 |
|--------|---------|------|
| `.page-card` | CSS class | 有 glassmorphism 效果 |
| `.surface-card` | CSS class | 用于 ChannelsPage 左右面板 |
| `<SectionCard>` | React 组件 | 有 title/description/action，最规范 |
| `<Card>` (Ant原生) | 直接使用 | Dashboard 大量使用，样式不统一 |
| `<MetricCard>` | React 组件 | 指标卡片，样式一致 |

**建议方案**：
- 以 `SectionCard` 为唯一的内容容器组件，所有用到 Ant `<Card>` 的地方迁移过来
- `MetricCard` 保留，但统一其圆角和阴影到设计 token
- 清理掉 `.page-card` / `.surface-card` 等冗余 CSS 类

---

## 二、逐页分析与修改建议

---

### 📊 Dashboard（平台总览）

[DashboardPage.tsx](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/pages/DashboardPage.tsx)

**当前问题**：
1. **外层容器不统一** — 使用 `className="max-w-[1600px] mx-auto px-6 py-6"`（Tailwind），但其他页面由 `.app-content-motion` 的 `max-width: var(--nb-content-max-width)` 控制
2. **快速操作区的卡片** — 直接用 Ant原生 `<Card hoverable>` + 内联样式 `borderColor: token.colorBorderSecondary`，没有使用设计系统的 `SectionCard`
3. **渠道状态/会话/技能/自动化四大列表卡片** — 每个卡片内部的 item 样式全部硬编码（`padding: 12, borderRadius: token.borderRadiusLG, border: 1px solid...`），重复代码约 4×15 行
4. **MetricCard 与下方列表无视觉分隔** — Row gutter `[16, 16]` 但页面竖向 gap 24，网格节奏不一致

**修改建议**：
```
排版结构（从上到下）：
┌──────────────────────────────────────────────────┐
│  PageHeader                                        │
│  eyebrow: "总览" | title: "平台总览"                  │
│  subtitle: "运行态、渠道、技能和调度一览"              │
│  actions: [刷新]                                    │
├──────────────────────────────────────────────────┤
│  MetricCard Grid (4列)                             │
│  Agent数 | 活跃会话 | 运行次数 | 知识库数              │
├──────────────────────────────────────────────────┤
│  快速操作 Grid (3×2)                                │
│  (改用 SectionCard 替代原生 Card)                    │
├────────────────────┬─────────────────────────────┤
│  渠道状态 SectionCard │ 最近会话 SectionCard           │
├────────────────────┼─────────────────────────────┤
│  技能部署 SectionCard │ 自动化状态 SectionCard         │
└────────────────────┴─────────────────────────────┘
```

- 去掉 `className="max-w-[1600px] mx-auto px-6 py-6"`，交给 `.app-content-motion` 全局控制
- 抽取 `DashboardListItem` 子组件，统一 item 的 padding / border / radius
- 统一所有竖向 gap 为 24px（`var(--nb-section-gap)`）

---

### 🤖 Agent Studio（员工列表）

[AgentList.tsx](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/pages/agents/AgentList.tsx)

**当前问题**：
1. **卡片网格** — `gridTemplateColumns: repeat(auto-fill, minmax(300px, 1fr))` 在大屏上会出4列甚至5列，但每行卡片内容密度不够，显得空旷
2. **选中高亮样式** — `background: isSelected ? 'var(--nb-card-subtle-bg)' : 'transparent'` 但 border 用了 `var(--nb-card-subtle-border)`（未选中），视觉对比度不够
3. **底部信息区** — 绑定模型名放在一个透明无 border 的 `<Tag>` 里（`border: 'none', background: 'transparent'`），语义模糊

**修改建议**：
- 卡片最大列数限制为 3 列：`repeat(auto-fill, minmax(340px, 1fr))` + `max-width: calc(3 * 340px + 2 * 16px)` 居中
- 未选中状态给一个微弱的 `background: var(--nb-card-subtle-bg)` + `border: 1px solid var(--nb-card-subtle-border)`，形成「纸张感」
- 底部模型名改用 `<Typography.Text type="secondary" style={{ fontSize: 12 }}>` 纯文字展示，去掉无意义的 `<Tag>` 包装
- 添加 Avatar/Icon 在卡片左上角区分不同 Agent 身份

---

### 📡 渠道管理（ChannelsPage）

[ChannelsPage.tsx](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/pages/channels/ChannelsPage.tsx)

> [!IMPORTANT]
> 这是当前**问题最严重的页面**：完全没有页面头部，操作区过于密集，左右分栏比例失调。

**当前问题**：
1. **没有 PageHeader** — 页面直接以三个 `<Tag>` 开头（`N 个已接入`），缺乏页面标识和导航上下文
2. **顶部操作栏挤成一团** — 投递设置的两个 Switch + 保存按钮 + 刷新按钮，跟统计 Tag 混在同一行，信息层级混乱
3. **左侧渠道列表宽度硬编码 `320px`** — 不响应屏幕尺寸，小屏直接溢出
4. **右侧配置面板** — Form 字段用 `gridTemplateColumns: repeat(auto-fit, minmax(240px, 1fr))`，在窄屏下只有一列，宽屏可能出3列，表单密度不均
5. **左侧列表容器高度固定** `maxHeight: 520` — 不跟随视口高度

**修改建议**：
```
排版结构：
┌──────────────────────────────────────────────────┐
│  PageHeader                                        │
│  eyebrow: "工作台" | title: "渠道注册表"              │
│  subtitle: "管理消息渠道接入和投递设置"                │
│  actions: [投递设置(下拉) | 刷新]                    │
├──────────────────────────────────────────────────┤
│  MetricCard Grid (3列)                             │
│  已接入 | 已启用 | 待补全                             │
├──────────────────────────────────────────────────┤
│  Splitter (可拖拽分栏)                              │
│  ┌──────────┬───────────────────────────────────┐  │
│  │ 渠道列表  │ 渠道配置详情                        │  │
│  │ SectionCard│ SectionCard                      │  │
│  │ (搜索+列表)│ (标题+字段+测试结果)                │  │
│  └──────────┴───────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

- 添加 `PageHeader` 组件
- 将「投递设置」改为下拉面板或独立设置区，不要跟统计 Tag 混在一行
- 三个统计数据改用 `MetricCard` 展示
- 用 `<Splitter>` 替代 `Flex + 固定 width:320`，与 ModelsPage 保持一致
- 左侧列表高度改为 `calc(100vh - PageHeader - MetricCards - padding)`，自动适配

---

### 📚 知识工作区（KnowledgePage）

[KnowledgePage.tsx](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/pages/KnowledgePage.tsx)

**当前问题**：
1. **单文件 2187 行** — 业务逻辑、状态管理、渲染全部耦合在一个组件里，难以维护
2. **左侧知识库列表面板宽度** — `gridTemplateColumns: minmax(280px, 320px) minmax(0, 1fr)`，在 1366px 屏幕上只留大约 1000px 给右侧多 Tab 工作区，内容拥挤
3. **文件操作按钮组过于密集** — 添加文件/新建文件夹/解析/索引配置/建索引/移动/删除 7 个按钮一字排开，在普通笔记本屏幕上必定换行
4. **Tabs 在 SectionCard 内部** — Tab 导航被压在右侧面板内部，Tab 切换时整块右面板内容跳动

**修改建议**：
- 将 KnowledgePage 拆分为：`KnowledgeLayout` (路由+状态) + `KnowledgeList` (左侧) + `KnowledgeWorkspace` (右侧 Tabs)
- 左侧改用 `<Splitter>` 可拖拽分栏，默认 300px
- 文件操作按钮改为 **工具栏 + 更多操作下拉**：
  - 主要操作（出显按钮）：添加文件、建索引
  - 次要操作（`<Dropdown>`）：新建文件夹、解析、索引配置、移动、删除
- Tabs 的 `pendingParseCount` 和 `pendingIndexCount` 悬浮提示改为 Tab label 右上角的 Badge

---

### ⚙️ 模型配置（ModelsPage）

[models/index.tsx](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/pages/models/index.tsx)

**当前问题**：
1. **这是全站做得最好的页面** — 使用了 `<Splitter>`, `PageHeader`, `SectionCard`，结构清晰
2. **Splitter 左右面板** — `defaultSize={280}` min=260 max=340，合理
3. **右侧双卡片** — `ProviderConfig` + `ModelBindings` 用 `Flex vertical gap={12}` 叠放，结构优良

**改进空间**：
- `PageHeader` 的 `eyebrow="Registry"` 应改为中文 "配置" 以跟侧边栏一致
- 保存按钮成功后可以增加一个微动画反馈（checkmark 弹出）
- 这个页面的结构可以作为 **其他分栏页面的标准模板**

---

### 🧩 技能中心（SkillsPage）

[SkillsPage.tsx](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/pages/SkillsPage.tsx)

**当前问题**：
1. **PageHero 过于简洁** — 只有标题 `技能中心`，没有 subtitle 和 actions
2. **Tabs 的 type="card"** — 跟其他页面的 Tabs 默认线条样式不统一
3. **上传/搜索工具栏** — 放在 Tab panel 内部而非 Tab 外部，切换 Tab 时工具栏消失/变化不连贯
4. **Tailwind className 大量使用** — `className="h-full"`, `className="!m-0 !text-xs"`，与其他页面混用 CSS 变量风格不一致

**修改建议**：
- 改用 `PageHeader`，添加 subtitle: "管理已安装技能和技能市场"
- Tabs 改为默认 `type="line"`，跟知识库、Agent Studio 保持一致
- 「上传文件夹」和「上传 ZIP」放到 `PageHeader` 的 `actions` 区域
- 将 Tailwind 类逐步替换为设计系统的 CSS class

---

### 🔌 MCP 服务器

[mcp/index.tsx](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/pages/mcp/index.tsx)

**当前问题**：
1. **完全没有使用任何全局组件** — 没有 PageHeader, SectionCard, MetricCard
2. **页面标题手写** — `<Title level={4}>MCP 服务器</Title>` + `<Text type="secondary">管理...`，跟全局风格脱节
3. **统计行太随意** — `<span>共 N 个</span><span>已启用 N</span><span>待配置 N</span>`，应该用 MetricCard
4. **纯 Tailwind 布局** — `className="flex flex-col gap-6"`, `className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"`

**修改建议**：
- 添加 `PageHeader` eyebrow="配置" title="MCP 扩展" subtitle="管理 Model Context Protocol 服务器配置"
- 统计数据改为 3 个 MetricCard
- 服务器列表改用 `SectionCard` 包裹
- 将 Tailwind 类替换为设计系统 class

---

### 🔒 登录页（LoginPage）

[LoginPage.tsx](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/pages/LoginPage.tsx)

**评价**：这是当前做得**比较好的独立页面**，渐变背景 + 圆角卡片 + MotionPanel 包裹，视觉质量较高。

**改进空间**：
- Logo 区域 `120×120` 过大，建议缩减到 `80×80`
- 标题 `fontSize: 42` 过大，建议 `32-36px`
- 表单 label `<span className="text-sm font-medium">` 使用 Tailwind，应改为 `<Typography.Text>`
- 密码输入框增加「强度提示条」

---

### 💬 对话工作台 (ChatPage) - 核心交互升级 [NEW PHASE]

这是全站最重要的交互入口。当前的视觉质量尚可，但交互细节（微动效、输入框聚焦形态、消息流分组感）仍有巨大提升空间。

**当前问题**：
1. **输入框形态过于陈旧** — 原生 `TextArea` 缺乏动态边框和深度感。
2. **消息流密度过高** — 连续的消息之间缺乏节奏感，`Avatar` 的尺寸与文本对齐不够精致。
3. **侧边栏会话列表** — 选中态不够醒目，缺少 Premium 级别的 HSL 渐变阴影。

**修改建议**：
1. **重构 `ChatInput`**：使用悬浮式设计，增加 `var(--nb-accent)` 线条呼吸效果和内外部阴影。
2. **优化消息气泡**：
   - 使用更柔和的圆角（User: 20px 20px 4px 20px, AI: 20px 20px 20px 4px）。
   - 为 AI 回复增加极细的 `1px` HSL 边框。
   - 增加 `framer-motion` 的 `layout` 属性实现平滑的消息推移。
3. **会话列表升级**：使用 `SectionCard` 风格的轻量化条目，增加侧边状态指示条。

---

### 🛠️ 初始化引导 (SetupPage) - 第一印象重塑 [NEW PHASE]

**当前问题**：
1. **布局松散** — `Card` 直接堆叠在页面中央，缺乏引导感。
2. **进度标识不强** — 必填项与可选项虽然有 `Tag`，但在大屏幕上视觉重心分散。

**修改建议**：
1. **统一 `page-stack` 布局**。
2. **改用分步式导航理念** — 即使是在单页内，也要通过明显的 `SectionCard` 标题和序号增强引导感。
3. **优化模型配置表单** — 适配 8px 网格，增加字段间的 HSL 分割线。

---

### ⚕️ 系统设置（SystemPage）

[SystemPage.tsx](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/pages/SystemPage.tsx)

**评价**：结构较好，使用了 PageHeader + MetricCard + SectionCard。

**改进空间**：
- `DetailRow` 的 `padding: 16` 硬编码，应使用 token
- 右侧两个 SectionCard 高度不等，建议使用 `align-items: stretch` 让它们等高
- grid `gridTemplateColumns: minmax(0,1.12fr)_minmax(320px,0.88fr)` 在小屏硬编码了 `320px` min，可能溢出

---

## 三、交互设计统一规范建议

### 3.1 全局间距节奏

| 使用场景 | 推荐值 | 当前现状 |
|---------|-------|---------|
| 页面顶部与第一个内容块 | 0（由 `.app-content` padding 控制） | ✅ 正确 |
| 同级内容块间距 | 24px | ❌ 混用 16/18/24 |
| 卡片内部 padding | 24px（桌面）/ 16px（移动） | ❌ 混用 14/16/18/20/24 |
| 表单字段间距 | 16px | ❌ 混用 12/16/18 |
| 按钮组间距 | 8px | ✅ 大多正确 |

### 3.2 圆角统一

| 元素 | 推荐值 | 当前现状 |
|------|-------|---------|
| 页面级卡片 | 16px | ❌ 混用 14/16/20 |
| 按钮 | 12px | ❌ 混用 10/12/14 |
| 输入框 | 12px | ✅ 大多 12 |
| Tag | 10px | ✅ 大多正确 |
| Modal | 24px | ✅ 28px (稍大但统一) |
| Avatar | 12px (方) / 50% (圆) | ✅ 正确 |

### 3.3 动画统一

目前 framer-motion 的使用相对合理，但建议：
- 列表 item 的 `delay: index * 0.05` 最大值应封顶（如 `Math.min(index * 0.05, 0.5)`），防止长列表动画延迟过长
- `whileHover: { y: -2 }` 是好的微交互，应全局统一使用
- 页面切换的 `AnimatePresence` transition 保持不变

---

## 四、推荐执行优先级

| 优先级 | 改造范围 | 预期工作量 | 影响面 |
|--------|---------|-----------|-------|
| 🔴 P0 | 统一 PageHeader, 清理 PageHero | 1 天 | 影响所有页面 |
| 🔴 P0 | ChannelsPage 添加 PageHeader + Splitter + MetricCard | 0.5 天 | 当前最丑的页面 |
| 🟠 P1 | MCP 页面使用全局组件重构 | 0.5 天 | 独立页面 |
| 🟠 P1 | 统一间距/圆角/padding 到 8px 网格 | 1 天 | 全局CSS |
| 🟡 P2 | Dashboard 改用 SectionCard 替代原生 Card | 0.5 天 | 首页 |
| 🟡 P2 | KnowledgePage 文件操作按钮精简 + 拆分组件 | 1 天 | 核心功能页 |
| 🟢 P3 | SkillsPage 改用 PageHeader + line-type Tabs | 0.5 天 | 低频页面 |
| 🟢 P3 | 清理 Tailwind 与 CSS 变量混用 | 1-2 天 | 全局 |

---

## 五、与行业标杆的差距参考

对标产品：**Dify / Coze / Langflow / Vercel Dashboard**

| 维度 | 行业标杆 | 当前项目 | 差距 |
|------|---------|---------|------|
| 设计一致性 | 单一设计系统Token | 三套混战 | 🔴 严重 |
| 页面头部 | 统一 Breadcrumb + Title + Actions | 不统一 | 🔴 严重 |
| 内容卡片 | 无边框 + 微阴影 + 统一圆角 | 混用多种容器 | 🟠 中等 |
| 分栏布局 | 可拖拽 Splitter | 仅 Models 使用 | 🟠 中等 |
| 响应式 | 完整 breakpoint 系统 | 部分硬编码宽度 | 🟡 轻微 |
| 微交互 | hover/active/loading 全覆盖 | 大部分有 | 🟢 较好 |
| 暗色模式 | Token 完整映射 | Token 已定义但部分内联绕过 | 🟠 中等 |

## Open Questions

> [!IMPORTANT]
> 1. **关于 Tailwind**：项目已引入 TailwindCSS，是否要保留它？如果保留，需要制定严格的使用边界（例如仅用于 utility 类如 `flex`, `gap`，所有颜色和间距走 CSS 变量）。如果移除，工作量较大但长期维护更好。
> 2. **关于执行节奏**：你希望逐页渐进式改造，还是一次性全页面统一重构？
> 3. **关于视觉风格**：当前的 Indigo/Violet 色调和 Glassmorphism 效果保留还是需要调整？

## Verification Plan

### Automated Tests
- 改造后运行 `npm run test` 确保所有单元测试通过
- 运行 `npm run test:e2e:critical` 确保关键路径 E2E 测试通过

### Manual Verification
- 在浏览器中逐页截图对比改造前后效果
- 验证暗色模式下所有页面的视觉一致性
- 验证 1366px / 1920px / 2560px 三种常见分辨率下的响应式布局
