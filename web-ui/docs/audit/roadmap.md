# Web UI 改造路线图（从审计到落地）

目标：在不牺牲信息密度的前提下，把 Web UI 变成“精致科技”的通用控制台，同时建立可规模化的 A11y/性能/主题一致性门槛（收敛到 Antd 为主）。

## Phase A — P0/P1 基线（A11y + 反模式清理）

### Epic A1：Chat 输入区 A11y 阻断项清零
- Scope：Chat 输入区的开关/选择器/附件按钮与可点击文本
- Evidence：审计中对应 P0/P1（见 `docs/audit/audit-report.md`）
- DoD：
  - `npm run test:e2e:a11y` 通过（至少覆盖 `/chat` 的关键交互）
  - icon-only Button 均有可访问名称（aria-label 或可读文本）
  - Switch/Select 等表单控件具备 label 语义
  - 所有“可点文本”可键盘触达且有 focus 样式
- 回归范围：`test:e2e:a11y` + chat 相关 smoke

### Epic A2：移除 Impeccable 明确禁止的视觉反模式
- Scope：全站清理 `border-left/right > 1px` 的“强调条纹”用法（尤其是 Markdown 引用/提示块）
- DoD：
  - 不再使用 >1px 的边条纹作为“设计装饰”
  - 统一改为结构性方案（背景 tint、图标、引用符号、块级布局等）
- 回归范围：chat/markdown 渲染页面（chat、runs 结果、knowledge 富文本等）

## Phase B — 主题与样式体系收敛（收敛到 Antd）

### Epic B1：定义单一“语义来源”（Token 分层）
- 目标：把“同一语义多套实现”收敛到明确层级，避免后续改造打地鼠
- 建议分层（推荐）：
  - Antd Token：承载所有组件语义（文本/边框/交互态/阴影/圆角/密度）
  - CSS Variables：仅承载 app surface/brand 级（layout 背景、sider surface、特殊材质）
  - Tailwind：仅承载布局/网格/间距，不承载颜色语义，不直接表达“danger/success/info”
  - Inline style：仅保留“计算型/局部一次性”的样式（例如来自数据的颜色），其余逐步消减
- DoD：
  - 形成 `Token 使用规范` 文档（落在 `docs/audit` 或 `docs/design`）
  - 关键页面不再出现“同一语义颜色”从 3 个来源获取的情况（抽样检查）

### Epic B2：暗黑/亮色同等质量（对比度下限与色板校准）
- 目标：把 A11y 对比度与视觉一致性提升到 token 层一次性解决
- DoD：
  - `secondary/tertiary` 文本在主要 surface 上满足 WCAG AA（优先修 chat 与 sider）
  - 主题切换（跟随系统 + 可覆盖）在主要页面不出现“反相失败”的角落
- 回归范围：A11y smoke + 关键页面人工抽样（chat/models/knowledge/channels/system）

## Phase C — 性能与动效治理（体验稳定）

### Epic C1：构建产物与按需边界
- Evidence：`vite build` 存在 chunk 循环与超大 vendor（见审计报告）
- DoD：
  - 消除 `Circular chunk: markdown -> vendor -> markdown`（manualChunks 规则调整）
  - 定义“重依赖”页面边界：markdown/highlight/katex/antv 仅在需要的路由加载
  - 关键路由冷启动与首屏渲染不会被 markdown 相关包拖累

### Epic C2：玻璃化/blur 的允许清单与降级策略
- 目标：让“精致科技”的材质感可控、不伤性能
- DoD：
  - 明确允许 blur 的组件与场景（例如仅 header、仅单层）
  - reduced motion / 低性能设备（或特定浏览器）具备可配置降级
  - 避免多层叠加 blur（视觉上等价但成本翻倍）

## Phase D — 可维护性工程化（为长期迭代铺路）

### Epic D1：大页面组件拆分为“容器 + 展示组件”
- Scope（优先）：models/channels/mcp/runs/knowledge（文件偏大、状态密集的页面）
- DoD：
  - 每个页面形成稳定的模块边界：`data/hooks`（加载/副作用）与 `view/components`（纯展示）
  - UI 复用组件沉淀到 `src/components/console` 或更明确的域内目录

### Epic D2：测试门槛可用化（减少噪音）
- Evidence：vitest smoke 存在 antd mock 不完整导致的失败噪音
- DoD：
  - smoke 可稳定运行并反映真实回归（mock 采用 partial mock 或共享测试工具）
  - A11y smoke 扩展到 4–6 个关键页面（抽样即可，不追求全覆盖）

## 推荐执行顺序（对应 Impeccable 技能）
- `/audit`：以 A11y 阻断项为第一优先（Phase A）
- `/layout`：确立“收敛到 Antd”的结构性规范（Phase B 的前置）
- `/typeset`：修正层级与对比度底线（Phase B）
- `/optimize`：分包与 blur 治理（Phase C）
- `/adapt`：移动端/大字号抽样适配（贯穿 Phase A–C）
- `/polish`：最后做一致性收口与微细节（Phase D 收尾）

