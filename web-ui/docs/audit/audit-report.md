# Web UI Frontend Audit Report (Impeccable /audit)

范围：`/Users/pusonglin/PycharmProjects/nanobot/web-ui`（Vite + React + Antd + Ant Design X）

## Audit Health Score

| # | Dimension | Score (0-4) | Key Finding |
|---|-----------|-------------|-------------|
| 1 | Accessibility | 1 | 现有 Playwright + axe A11y smoke 已出现 critical/serious 违规（chat 场景） |
| 2 | Performance | 2 | 构建产物存在超大 chunk（vendor + highlight.js 等），并叠加多处 backdrop-filter |
| 3 | Responsive Design | 2 | 有桌面/移动端分支，但固定尺寸与 inline style 较多，边角适配风险高 |
| 4 | Theming | 2 | Antd Token + CSS 变量 + Tailwind 并行，语义分裂导致一致性成本高 |
| 5 | Anti-Patterns | 2 | 存在 Impeccable 明确禁止的边条纹（blockquote），且玻璃化倾向明显 |
| **Total** | | **9/20** | **Acceptable（需要显著改造）** |

## Anti-Patterns Verdict
- **Fail（可被认为“像 AI 做的”）**：至少存在 2 个明显 tell
  - 彩色边条纹：`.markdown-bubble blockquote { border-left: 3px ... }`，见 [chat.css](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/chat/chat.css#L160-L165)
  - 玻璃化堆叠：多处 `backdropFilter: 'blur(...)'`，见 [AppShell](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/components/AppShell.tsx#L295-L352)

## Executive Summary
- 主要阻断点：A11y 基线（axe critical/serious）未通过，且集中在核心工作流 `/chat`
- 系统性问题：样式/Token 体系分裂 + inline style 普遍化，导致主题一致性与 A11y 修复“难以规模化”
- 性能风险：构建产物 vendor 体积与 markdown/highlight 相关包偏大；backdrop-filter 易造成 GPU/合成层压力
- 发现问题数量（按严重度）：P0=2，P1=6，P2=3，P3=3

## Detailed Findings by Severity

### P0 Blocking

#### [P0] Chat 输入区：开关/选择器缺少可访问名称与表单标签
- Location：
  - “深度思考”开关与 Select，见 [ChatInput.tsx](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/chat/ChatInput.tsx#L187-L221)
  - A11y smoke 断言位置，见 [a11y.spec.ts](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/e2e/a11y.spec.ts#L17-L22)
- Category：Accessibility
- Impact：
  - 屏幕阅读器无法理解该 Switch/Select 的语义与含义；键盘用户对“可点文本”缺少可达路径
  - 当前会直接导致 `npm run test:e2e:a11y` 失败（axe `button-name` / `label`）
- WCAG/Standard：WCAG 2.1 A / 4.1.2（Name, Role, Value），1.3.1（Info and Relationships）
- Recommendation：
  - Switch：提供可访问名称（`aria-label` 或 `aria-labelledby`），并确保对应文本是 label 语义而非仅 onClick 的 span
  - Select：为 “reasoningEffort” Select 提供 label 语义（显式 label 或 `aria-label`）
  - “深度思考”文字：若可点击，应改为 Button/Link，或补齐 role/tabIndex/键盘事件
- Suggested command：`/polish`（作为修复落地的最后收尾），修复本项本身需要工程实现

#### [P0] Icon-only 按钮缺少可访问名称（Chat 输入区附件按钮）
- Location：附件按钮无 `aria-label`，见 [ChatInput.tsx](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/chat/ChatInput.tsx#L174-L184)
- Category：Accessibility
- Impact：屏幕阅读器读不到按钮含义；axe `button-name` 会持续报错
- WCAG/Standard：WCAG 2.1 A / 4.1.2
- Recommendation：为 icon-only Button 添加 `aria-label`（或给 Button children 文本并视觉隐藏）
- Suggested command：`/polish`

### P1 Major

#### [P1] 低对比度文本：chat 场景出现 WCAG AA 对比度不足
- Location：
  - “深度思考”文本使用 `token.colorTextTertiary` 等低对比色，见 [ChatInput.tsx](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/chat/ChatInput.tsx#L194-L205)
  - 另有 sidebar 二级标题等在 a11y 报告中出现 2.7–2.87 的对比度（axe `color-contrast`）
- Category：Accessibility / Theming
- Impact：弱视用户与普通用户在亮色背景上可读性下降；A11y smoke 失败
- WCAG/Standard：WCAG 2.1 AA / 1.4.3（Contrast Minimum）
- Recommendation：提升 tertiary/secondary text 在浅色 surface 的最小对比；把“二级信息”颜色从 token/变量层统一修正，避免组件内单点修补
- Suggested command：`/typeset`（信息层级与可读性）→ `/_polish`

#### [P1] Impeccable 禁止的边条纹反模式（blockquote）
- Location：`.markdown-bubble blockquote`，见 [chat.css](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/chat/chat.css#L160-L165)
- Category：Anti-Pattern / Theming
- Impact：显著 AI tell；视觉风格不统一，且在暗色/亮色切换中容易显得廉价
- Recommendation：改用背景 tint、图标引导、引用符号等结构性重写，避免 >1px 的 `border-left/right`
- Suggested command：`/distill`（去掉不赚分的装饰结构）→ `/polish`

#### [P1] 玻璃化与高 blur 使用频繁（性能与一致性双风险）
- Location：例如侧栏与移动端 header 使用 `backdropFilter: 'blur(...)'`，见 [AppShell](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/components/AppShell.tsx#L295-L352)
- Category：Performance / Anti-Pattern
- Impact：低端设备/长时间使用易出现卡顿与电量压力；不同浏览器渲染差异导致一致性问题
- Recommendation：建立“允许 blur 的场景清单 + 默认降级策略”；减少重叠 blur；必要时用不透明 surface + 阴影/边框层次替代
- Suggested command：`/quieter`（收敛视觉噪音）→ `/optimize`

#### [P1] 构建体积与分包警告：超大 vendor chunk + markdown chunk 循环
- Evidence：
  - `vite build` 提示 `Circular chunk: markdown -> vendor -> markdown`，manualChunks 见 [vite.config.ts](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/vite.config.ts#L71-L124)
  - 构建产物中 `vendor`、`pkg-highlight.js`、`pkg-katex` 等 chunk 体积偏大（gzip 仍显著）
- Category：Performance
- Impact：冷启动与首次路由切换成本高；缓存粒度不理想
- Recommendation：调整 `manualChunks` 规则，避免 markdown 与 vendor 交叉；对 `highlight/katex/antv` 等重依赖做更明确的路由级按需加载边界
- Suggested command：`/optimize`

#### [P1] 主题与样式语义分裂：Antd Token / CSS 变量 / Tailwind / inline style 并存
- Evidence：
  - Antd Token 大量组件级定制见 [theme.ts](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/ui/antd/theme.ts#L24-L275)
-  - 设计令牌统一来源为 [tokens.ts](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/ui/design/tokens.ts)
  - AppShell/各页面大量 `style={{ ... 'var(--nb-*)' }}` 与 Tailwind class 混用（例如 [AppShell](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/components/AppShell.tsx#L295-L352)）
- Category：Theming / Maintainability
- Impact：暗黑模式边角不一致；同一语义颜色/间距多套来源，改版成本指数增长
- Recommendation：以 Antd token 为主收敛语义；CSS 变量仅承载 surface/brand；Tailwind 仅保留布局与间距；逐步减少 inline style
- Suggested command：`/layout`（建立结构性规范）→ `/polish`

#### [P1] 可点击但非语义元素（导航 Logo 区域）
- Location：Logo 区域使用 `onClick` 绑定在容器上，见 [AppShell](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/components/AppShell.tsx#L193-L207)
- Category：Accessibility
- Impact：键盘不可达；屏幕阅读器无法识别为可操作控件；焦点样式缺失
- Recommendation：使用 `<Button type="text">` 或 `<Link>` 承载点击行为，并保证焦点可见
- Suggested command：`/polish`

### P2 Minor

#### [P2] A11y smoke 覆盖面较窄（仅 login/chat/mcp）
- Location：测试入口见 [a11y.spec.ts](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/e2e/a11y.spec.ts#L24-L40)
- Category：Accessibility / QA
- Impact：其他关键页面（models/knowledge/channels/runs/system/studio）无 A11y 回归门槛
- Recommendation：扩展到关键工作流（抽样即可），并把“主题切换”纳入 smoke
- Suggested command：`/audit`（修复后复审）

#### [P2] Vitest smoke 存在 antd mock 不完整导致的失败噪音
- Evidence：`vi.mock('antd', ...)` 未导出 `Popover`，见 [app-smoke.test.tsx](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/smoke/app-smoke.test.tsx#L419-L456)
- Category：Maintainability / QA
- Impact：单测红灯会掩盖真正回归；降低持续集成价值
- Recommendation：改为 partial mock（`importOriginal`）或补齐导出；将 UI mock 迁移到可复用的测试工具层
- Suggested command：`/polish`

#### [P2] 固定宽度/高度与 inline 尺寸散落，移动端边界风险较高
- Evidence：`width: Npx` 在多个 CSS/TSX 中出现（例如侧栏宽度等）
- Category：Responsive
- Impact：窄屏/大字号/多语言可能引发溢出与横向滚动
- Recommendation：把关键布局尺寸收敛到 token（如 [tokens.ts](file:///Users/pusonglin/PycharmProjects/nanobot/web-ui/src/ui/design/tokens.ts)）并用断点/容器自适应替换“到处写 px”
- Suggested command：`/adapt`

### P3 Polish

#### [P3] CSS/inline 中存在 `transition: all`，可能引发不必要的重绘
- Evidence：构建快照中多处 `transition: all 300ms ease;`（例如 dashboard metric 卡片水印）
- Category：Performance
- Recommendation：限定到具体属性（opacity/transform）以降低 layout 影响
- Suggested command：`/optimize`

#### [P3] 字体体系与排版层级存在“字号多但层级不够硬”的迹象
- Evidence：同时使用 Antd token fontSize 与 `--nb-text-*`；部分 label 使用 uppercase + 较低对比
- Category：Typography / Theming
- Recommendation：收敛到少数层级（标题/正文/注释/标签），并对浅色背景的次级信息做对比下限
- Suggested command：`/typeset`

#### [P3] 全局样式文件较多，页面 CSS 命名与作用域策略需明确
- Evidence：`index.css` + 多页面专用 css 并存（`knowledge.css/workbench.css/setup.css/chat.css/...`）
- Category：Maintainability
- Recommendation：明确“全局/页面/组件”三层边界与命名规则，避免样式泄漏
- Suggested command：`/distill`

## Patterns & Systemic Issues
- “多套 token/变量/inline”导致的一致性问题会把 A11y/对比度修复变成“打地鼠”；应优先在 token 层建立对比度底线，再在组件层补齐语义。
- 玻璃化与 blur 既是风格问题也是性能问题：建议从“允许列表”治理，而非逐处改。
- Markdown/富文本相关依赖较重：需要明确按需加载边界，否则 vendor 将长期保持高位。

## Positive Findings
- 路由懒加载与分包策略存在主动设计（manualChunks），并且 build 能稳定通过。
- 主题切换有明确入口（写入 `data-theme` 与 `colorScheme`），具备做一致性收敛的基础。

## Recommended Actions（按优先级映射 Impeccable 技能）
1. **[P0] `/audit`** — 以 A11y 为第一阻断项：先修复 chat 的 `button-name/label/color-contrast`，跑通 `npm run test:e2e:a11y` 再继续。
2. **[P1] `/layout`** — 建立“收敛到 Antd”的样式边界与语义规范（Token/变量/Tailwind/inline 的使用范围）。
3. **[P1] `/optimize`** — 处理大 chunk 与 markdown/vendor 循环分包，定义重依赖的路由级按需边界；治理 blur 造成的渲染成本。
4. **[P1] `/typeset`** — 统一信息层级与对比度下限，尤其是浅色 surface 的 secondary/tertiary 文本。
5. **[P2] `/adapt`** — 抽样关键页面做移动端与大字号适配（避免横向滚动、触控目标不足）。
6. **[P3] `/polish`** — 最后做一次全局收口（focus 样式、hover/active 反馈、微细节一致性）。

你可以让我按这些命令一次跑一个、全部跑完，或者按你喜欢的顺序执行；修复后再重跑 `/audit` 观察评分变化。
