# Design Tokens（设计令牌）

本项目的视觉一致性通过两层 Token 驱动：

- CSS 变量：`src/styles/layers/theme.css`（页面与自定义样式统一引用）
- Ant Design 主题：`src/ui/antd/theme.ts`（antd 组件统一引用，同源于 `src/ui/design/tokens.ts`）

## 色彩

### 基础语义
- `--nb-ink`：主文字
- `--nb-muted`：次级文字
- `--nb-text-tertiary`：弱化文字（注释/辅助信息）
- `--nb-accent`：主色（关键动作、选中态）
- `--nb-success` / `--nb-warning` / `--nb-error`：状态色

### 表面体系
- `--nb-bg`：页面背景（与 `--nb-body-bg` 同义）
- `--nb-surface`：默认表面（与 `--nb-card-bg` 同源）
- `--nb-surface-strong`：强调/浮层表面（与 `--nb-surface-panel-bg` 同源）
- `--nb-border` / `--nb-border-strong`：分隔线与强调分隔线
- `--nb-shadow-soft`：常用柔和阴影（与 `--nb-shadow-sm` 同源）

## 排版
- `--nb-font-display`：标题字体
- `--nb-font-body`：正文字体
- `--nb-font-mono`：代码字体
- 字号：`--nb-text-*`、`--nb-title-*`
- 行高：`--nb-line-*`

## 间距 / 圆角
- 间距：`--nb-spacing-*`（建议优先用 `gap` 控制节奏）
- 圆角：`--nb-radius-*`（面板与卡片建议 `--nb-radius-lg`）

## 使用规则
- 页面/组件禁止硬编码颜色语义，统一用 Token（CSS 变量或 antd token）
- 同一语义只允许一个来源：不要在页面里另起一套“自定义 token 命名体系”
- 新增样式优先落到壳层：`src/styles/layers/components.css`，仅在复杂模块下使用页面级 CSS

