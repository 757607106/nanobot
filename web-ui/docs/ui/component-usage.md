# UI 组件使用规范（单一体系）

## 设计风格
- 风格选型：Apple（克制、高密度但不拥挤、层级清晰、对比稳定、动效用于状态而非装饰）。
- 字体：本地字体优先（Noto Sans SC Variable + 系统 UI 字体回退），不引入远程字体。
- 色彩：单一主色（蓝）+ 中性色面板体系；强调色只用于状态与关键动作。

## 单一组件体系红线
- 仅允许使用 Ant Design（antd）作为 UI 组件库。
- 禁止引入或混用其他 UI 组件库。
- 允许页面级样式文件（例如复杂模块的独立样式），但必须：只使用设计 Token、只做结构/排版/布局，不得引入新的颜色语义体系或 utility 风格碎片。
- 允许存在的样式入口：`src/styles/layers/theme.css`（设计令牌）、`src/styles/layers/base.css`（reset）、`src/styles/layers/components.css`（组件壳层）、`src/index.css`（历史兼容层），以及 antd Theme（`src/ui/antd/theme.ts`）。

## 设计令牌（原子化）
- Token 源：`src/ui/design/tokens.ts`
- 覆盖维度：
  - color：accent/success/warning/error/bg/text/border/hover/selected（light/dark）
  - radius：xs/sm/md/lg/xl
  - space：xs/sm/md/lg/xl/2xl/3xl
  - shadow：sm/md（light/dark）
  - motion：duration/easing

## 基础组件（统一交互态）
- 基础组件统一入口：`src/ui/kit`（聚合导出 `src/components/console` 的控制台组件）
- 需要统一的交互态：hover / active / disabled / loading / focus ring
- 默认行为由 antd theme 负责，不允许在页面里重复实现同一套交互态

## 页面开发约束
- 布局：优先使用 antd 的 `Flex/Space/Grid/Row/Col`，避免“手写 utility class”。
- 样式：优先通过 antd theme token 与组件 token 配置完成；必要的布局样式用最小 inline style（仅限结构性布局，不表达颜色语义）。
- 代码结构：容器负责数据加载与副作用；展示组件纯渲染；禁止复制粘贴业务逻辑。

## 质量门槛（交付前必须通过）
- 静态扫描：`npm run ui:scan`
- 重复代码检测：`npm run ui:dup`
- 构建与体积报告：`npm run build && npm run ui:report`
- 功能回归：`npm test -- --run && npm run test:e2e:critical && npm run test:e2e:a11y`
